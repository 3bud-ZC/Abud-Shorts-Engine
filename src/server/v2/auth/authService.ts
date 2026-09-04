import crypto from "crypto";
import cuid from "cuid";
import { V2Database } from "../db";
import { logger } from "../../../logger";

export interface AdminUser {
  id: string;
  username: string;
  role: string;
  createdAt: Date;
}

export interface AdminSession {
  id: string;
  userId: string;
  username: string;
  role: string;
  token: string;
  expiresAt: Date;
}

export interface SetupState {
  isSetupCompleted: boolean;
  isAdminConfigured: boolean;
  completedAt?: string;
  configuredProvidersCount: number;
}

export class AuthService {
  constructor(private db: V2Database) {}

  public hashPassword(password: string, salt?: string): { hash: string; salt: string } {
    const generatedSalt = salt || crypto.randomBytes(16).toString("hex");
    const hash = crypto
      .pbkdf2Sync(password, generatedSalt, 100000, 64, "sha512")
      .toString("hex");
    return { hash, salt: generatedSalt };
  }

  public verifyPassword(password: string, storedHash: string, salt: string): boolean {
    const { hash } = this.hashPassword(password, salt);
    try {
      return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(storedHash));
    } catch {
      return false;
    }
  }

  public async isSetupComplete(): Promise<boolean> {
    if (!this.db.enabled) return true;
    try {
      const rows = await this.db.query<{ value: any }>(
        `SELECT value FROM system_settings WHERE key = 'setup_completed'`,
      );
      if (rows.length > 0) {
        return Boolean(rows[0].value?.completed);
      }
      return false;
    } catch {
      return false;
    }
  }

  public async getSetupState(): Promise<SetupState> {
    if (!this.db.enabled) {
      return {
        isSetupCompleted: true,
        isAdminConfigured: true,
        configuredProvidersCount: 2,
      };
    }

    try {
      const setupRow = await this.db.query<{ value: any }>(
        `SELECT value FROM system_settings WHERE key = 'setup_completed'`,
      );
      const isSetupCompleted = Boolean(setupRow[0]?.value?.completed);
      const completedAt = setupRow[0]?.value?.completedAt;

      const userRows = await this.db.query<{ count: string }>(
        `SELECT count(*) as count FROM admin_users`,
      );
      const isAdminConfigured = parseInt(userRows[0]?.count || "0", 10) > 0;

      const providerRows = await this.db.query<{ count: string }>(
        `SELECT count(*) as count FROM provider_settings WHERE status = 'healthy' OR encrypted_secret IS NOT NULL`,
      );
      const configuredProvidersCount = parseInt(providerRows[0]?.count || "0", 10);

      return {
        isSetupCompleted,
        isAdminConfigured,
        completedAt,
        configuredProvidersCount,
      };
    } catch (error) {
      logger.error({ error }, "Error fetching setup state");
      return {
        isSetupCompleted: false,
        isAdminConfigured: false,
        configuredProvidersCount: 0,
      };
    }
  }

  public async completeSetup(metadata: Record<string, any> = {}): Promise<void> {
    if (!this.db.enabled) return;
    const value = {
      completed: true,
      completedAt: new Date().toISOString(),
      ...metadata,
    };
    await this.db.query(
      `INSERT INTO system_settings (key, value, updated_at)
       VALUES ('setup_completed', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
      [JSON.stringify(value)],
    );
    logger.info("First-run setup marked as complete");
  }

  public async createInitialAdmin(username: string, password: string): Promise<AdminUser> {
    if (!this.db.enabled) {
      return {
        id: "local_admin",
        username,
        role: "admin",
        createdAt: new Date(),
      };
    }

    const existing = await this.db.query(`SELECT id FROM admin_users LIMIT 1`);
    if (existing.length > 0) {
      throw new Error("Admin account is already configured. Cannot overwrite.");
    }

    if (!username || username.trim().length < 3) {
      throw new Error("Username must be at least 3 characters.");
    }
    if (!password || password.length < 8) {
      throw new Error("Password must be at least 8 characters long.");
    }

    const id = cuid();
    const { hash, salt } = this.hashPassword(password);

    await this.db.query(
      `INSERT INTO admin_users (id, username, password_hash, salt, role, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'admin', now(), now())`,
      [id, username.trim().toLowerCase(), hash, salt],
    );

    logger.info({ username: username.trim().toLowerCase() }, "Admin user created");

    return {
      id,
      username: username.trim().toLowerCase(),
      role: "admin",
      createdAt: new Date(),
    };
  }

  public async authenticate(username: string, password: string): Promise<AdminSession | null> {
    if (!this.db.enabled) {
      return {
        id: cuid(),
        userId: "local_admin",
        username,
        role: "admin",
        token: "dev_session_token_" + Date.now(),
        expiresAt: new Date(Date.now() + 86400000),
      };
    }

    const rows = await this.db.query<{
      id: string;
      username: string;
      password_hash: string;
      salt: string;
      role: string;
    }>(`SELECT id, username, password_hash, salt, role FROM admin_users WHERE username = $1`, [
      username.trim().toLowerCase(),
    ]);

    if (rows.length === 0) return null;
    const user = rows[0];

    const valid = this.verifyPassword(password, user.password_hash, user.salt);
    if (!valid) return null;

    const sessionId = cuid();
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await this.db.query(
      `INSERT INTO admin_sessions (id, user_id, token, expires_at, created_at)
       VALUES ($1, $2, $3, $4, now())`,
      [sessionId, user.id, token, expiresAt],
    );

    return {
      id: sessionId,
      userId: user.id,
      username: user.username,
      role: user.role,
      token,
      expiresAt,
    };
  }

  public async validateSession(token: string): Promise<AdminUser | null> {
    if (!token) return null;
    if (!this.db.enabled) {
      return {
        id: "local_admin",
        username: "admin",
        role: "admin",
        createdAt: new Date(),
      };
    }

    const rows = await this.db.query<{
      user_id: string;
      username: string;
      role: string;
      created_at: string;
      expires_at: string;
    }>(
      `SELECT s.user_id, u.username, u.role, u.created_at, s.expires_at
       FROM admin_sessions s
       JOIN admin_users u ON s.user_id = u.id
       WHERE s.token = $1 AND s.expires_at > now()`,
      [token],
    );

    if (rows.length === 0) return null;
    const row = rows[0];

    return {
      id: row.user_id,
      username: row.username,
      role: row.role,
      createdAt: new Date(row.created_at),
    };
  }

  public async logout(token: string): Promise<void> {
    if (!token || !this.db.enabled) return;
    await this.db.query(`DELETE FROM admin_sessions WHERE token = $1`, [token]);
  }

  /**
   * Changes the owner's password. Requires the current password so a
   * hijacked but still-live session cannot silently lock the real owner out.
   * Revokes every session (including the caller's) - the safest option given
   * there is no per-session "this is me, keep me logged in" signal today.
   */
  public async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    if (!this.db.enabled) return;
    if (!newPassword || newPassword.length < 8) {
      throw new Error("Password must be at least 8 characters long.");
    }

    const rows = await this.db.query<{ password_hash: string; salt: string }>(
      `SELECT password_hash, salt FROM admin_users WHERE id = $1`,
      [userId],
    );
    if (rows.length === 0) throw new Error("Account not found.");

    const valid = this.verifyPassword(currentPassword, rows[0].password_hash, rows[0].salt);
    if (!valid) throw new Error("Current password is incorrect.");

    const { hash, salt } = this.hashPassword(newPassword);
    await this.db.query(
      `UPDATE admin_users SET password_hash = $1, salt = $2, updated_at = now() WHERE id = $3`,
      [hash, salt, userId],
    );
    await this.db.query(`DELETE FROM admin_sessions WHERE user_id = $1`, [userId]);
    logger.info({ userId }, "Owner password changed; all sessions revoked");
  }

  /**
   * Changes the owner's username. Sessions are kept: unlike a password
   * change, the credential an attacker would need (the password) hasn't
   * moved, so there's nothing forcing a re-login protects against here.
   */
  public async changeUsername(userId: string, newUsername: string): Promise<string> {
    if (!this.db.enabled) return newUsername;
    const trimmed = (newUsername || "").trim();
    if (trimmed.length < 3) {
      throw new Error("Username must be at least 3 characters.");
    }
    const normalized = trimmed.toLowerCase();

    const existing = await this.db.query<{ id: string }>(
      `SELECT id FROM admin_users WHERE username = $1 AND id != $2`,
      [normalized, userId],
    );
    if (existing.length > 0) {
      throw new Error("That username is already in use.");
    }

    await this.db.query(
      `UPDATE admin_users SET username = $1, updated_at = now() WHERE id = $2`,
      [normalized, userId],
    );
    logger.info({ userId }, "Owner username changed");
    return normalized;
  }

  /** Safe session metadata only - never the token itself. */
  public async listSessions(
    userId: string,
  ): Promise<Array<{ id: string; createdAt: Date; expiresAt: Date }>> {
    if (!this.db.enabled) return [];
    const rows = await this.db.query<{ id: string; created_at: string; expires_at: string }>(
      `SELECT id, created_at, expires_at FROM admin_sessions WHERE user_id = $1 AND expires_at > now() ORDER BY created_at DESC`,
      [userId],
    );
    return rows.map((r) => ({
      id: r.id,
      createdAt: new Date(r.created_at),
      expiresAt: new Date(r.expires_at),
    }));
  }

  public async revokeOtherSessions(userId: string, currentToken: string): Promise<number> {
    if (!this.db.enabled) return 0;
    const rows = await this.db.query(
      `DELETE FROM admin_sessions WHERE user_id = $1 AND token != $2 RETURNING id`,
      [userId, currentToken],
    );
    return rows.length;
  }
}
