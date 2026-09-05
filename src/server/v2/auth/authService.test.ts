import { describe, expect, it } from "vitest";
import { AuthService } from "./authService";

/** Minimal in-memory stand-in for V2Database, scoped to what AuthService uses. */
class FakeDb {
  public enabled = true;
  public users: Array<{ id: string; username: string; password_hash: string; salt: string; role: string }> = [];
  public sessions: Array<{ id: string; user_id: string; token: string; expires_at: Date }> = [];

  async query<T = any>(text: string, values: any[] = []): Promise<T[]> {
    if (text.startsWith("SELECT id FROM admin_users LIMIT 1")) {
      return this.users.slice(0, 1) as any;
    }
    if (text.startsWith("INSERT INTO admin_users")) {
      const [id, username, hash, salt] = values;
      this.users.push({ id, username, password_hash: hash, salt, role: "admin" });
      return [] as any;
    }
    if (text.startsWith("SELECT id, username, password_hash, salt, role FROM admin_users WHERE username")) {
      return this.users.filter((u) => u.username === values[0]) as any;
    }
    if (text.startsWith("INSERT INTO admin_sessions")) {
      const [id, userId, token, expiresAt] = values;
      this.sessions.push({ id, user_id: userId, token, expires_at: expiresAt });
      return [] as any;
    }
    if (text.startsWith("SELECT password_hash, salt FROM admin_users WHERE id")) {
      return this.users.filter((u) => u.id === values[0]).map((u) => ({ password_hash: u.password_hash, salt: u.salt })) as any;
    }
    if (text.startsWith("UPDATE admin_users SET password_hash")) {
      const [hash, salt, id] = values;
      const user = this.users.find((u) => u.id === id);
      if (user) {
        user.password_hash = hash;
        user.salt = salt;
      }
      return [] as any;
    }
    if (text.startsWith("DELETE FROM admin_sessions WHERE user_id = $1 AND token")) {
      const [userId, token] = values;
      const before = this.sessions.length;
      this.sessions = this.sessions.filter((s) => !(s.user_id === userId && s.token !== token));
      return Array(before - this.sessions.length).fill({ id: "x" }) as any;
    }
    if (text.startsWith("DELETE FROM admin_sessions WHERE user_id")) {
      const [userId] = values;
      this.sessions = this.sessions.filter((s) => s.user_id !== userId);
      return [] as any;
    }
    if (text.startsWith("SELECT id FROM admin_users WHERE username = $1 AND id !=")) {
      const [username, id] = values;
      return this.users.filter((u) => u.username === username && u.id !== id) as any;
    }
    if (text.startsWith("UPDATE admin_users SET username")) {
      const [username, id] = values;
      const user = this.users.find((u) => u.id === id);
      if (user) user.username = username;
      return [] as any;
    }
    if (text.startsWith("SELECT id, created_at, expires_at FROM admin_sessions")) {
      const [userId] = values;
      return this.sessions
        .filter((s) => s.user_id === userId)
        .map((s) => ({ id: s.id, created_at: new Date().toISOString(), expires_at: s.expires_at.toISOString() })) as any;
    }
    return [] as any;
  }
}

describe("AuthService owner account lifecycle", () => {
  it("creates the initial owner and rejects a second bootstrap", async () => {
    const db = new FakeDb();
    const auth = new AuthService(db as any);

    const owner = await auth.createInitialAdmin("owner", "correct horse battery");
    expect(owner.username).toBe("owner");
    expect(db.users).toHaveLength(1);

    await expect(auth.createInitialAdmin("someoneElse", "another password")).rejects.toThrow(
      /already configured/i,
    );
  });

  it("logs in with correct credentials and rejects incorrect ones", async () => {
    const db = new FakeDb();
    const auth = new AuthService(db as any);
    await auth.createInitialAdmin("owner", "correct horse battery");

    const session = await auth.authenticate("owner", "correct horse battery");
    expect(session).not.toBeNull();
    expect(session?.username).toBe("owner");

    const wrongPassword = await auth.authenticate("owner", "wrong password entirely");
    expect(wrongPassword).toBeNull();

    const wrongUsername = await auth.authenticate("nobody", "correct horse battery");
    expect(wrongUsername).toBeNull();
  });

  it("changes password, rejects a wrong current password, and revokes every session", async () => {
    const db = new FakeDb();
    const auth = new AuthService(db as any);
    const owner = await auth.createInitialAdmin("owner", "correct horse battery");
    const session1 = await auth.authenticate("owner", "correct horse battery");
    const session2 = await auth.authenticate("owner", "correct horse battery");
    expect(db.sessions).toHaveLength(2);

    await expect(
      auth.changePassword(owner.id, "totally wrong", "brand new password"),
    ).rejects.toThrow(/incorrect/i);
    expect(db.sessions).toHaveLength(2); // untouched by the failed attempt

    await auth.changePassword(owner.id, "correct horse battery", "brand new password");
    expect(db.sessions).toHaveLength(0);

    const oldPasswordLogin = await auth.authenticate("owner", "correct horse battery");
    expect(oldPasswordLogin).toBeNull();
    const newPasswordLogin = await auth.authenticate("owner", "brand new password");
    expect(newPasswordLogin).not.toBeNull();
    void session1;
    void session2;
  });

  it("changes username, blocks duplicates, and logs in with the new username afterward", async () => {
    const db = new FakeDb();
    const auth = new AuthService(db as any);
    const owner = await auth.createInitialAdmin("owner", "correct horse battery");
    // A second row, standing in for another account this DB could contain -
    // AuthService's own single-owner rule is enforced by createInitialAdmin,
    // not by changeUsername, so this exercises the duplicate-username guard.
    db.users.push({ id: "id_other", username: "taken", password_hash: "x", salt: "y", role: "admin" });

    await expect(auth.changeUsername(owner.id, "taken")).rejects.toThrow(/already in use/i);
    await expect(auth.changeUsername(owner.id, "ab")).rejects.toThrow(/at least 3/i);

    const updated = await auth.changeUsername(owner.id, "  NewOwnerName  ");
    expect(updated).toBe("newownername");

    const loginOld = await auth.authenticate("owner", "correct horse battery");
    expect(loginOld).toBeNull();
    const loginNew = await auth.authenticate("newownername", "correct horse battery");
    expect(loginNew).not.toBeNull();
  });

  it("revokes only other sessions, keeping the caller's own session alive", async () => {
    const db = new FakeDb();
    const auth = new AuthService(db as any);
    const owner = await auth.createInitialAdmin("owner", "correct horse battery");
    const keep = await auth.authenticate("owner", "correct horse battery");
    const other1 = await auth.authenticate("owner", "correct horse battery");
    const other2 = await auth.authenticate("owner", "correct horse battery");
    expect(db.sessions).toHaveLength(3);

    const revoked = await auth.revokeOtherSessions(owner.id, keep!.token);
    expect(revoked).toBe(2);
    expect(db.sessions).toHaveLength(1);
    expect(db.sessions[0].token).toBe(keep!.token);
    void other1;
    void other2;
  });
});
