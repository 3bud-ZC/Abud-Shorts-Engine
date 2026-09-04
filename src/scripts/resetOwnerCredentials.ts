/**
 * Local owner-credential recovery. Run inside the app container by the
 * "ABUD Shorts - Reset Owner Password" host command
 * (scripts/host/abud-shorts.ps1 -> `owner reset-password`) when the owner is
 * locked out and cannot sign in. Requires local machine access - there is no
 * network-reachable equivalent of this by design.
 *
 * The new password is only ever read from an interactive TTY prompt (never a
 * CLI argument or env var) so it cannot end up in shell history, process
 * lists, or logs. It is hashed with the same AuthService.hashPassword the
 * product uses for every other credential, then written straight to
 * admin_users - no separate "reset" table, no email, no token.
 */
import readline from "readline";
import { Config } from "../config";
import { V2Database } from "../server/v2/db";
import { AuthService } from "../server/v2/auth/authService";

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, (answer) => resolve(answer)));
}

function askSecret(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const rlAny = rl as any;
    let muted = false;
    rlAny._writeToOutput = (str: string) => {
      if (!muted) rlAny.output.write(str);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

async function main() {
  const config = new Config();
  const db = new V2Database(config);
  if (!db.enabled) {
    console.error("DATABASE_URL is not configured. Cannot reach the product database.");
    process.exitCode = 1;
    return;
  }
  const authService = new AuthService(db);

  const owners = await db.query<{ id: string; username: string }>(
    `SELECT id, username FROM admin_users ORDER BY created_at ASC`,
  );
  if (owners.length === 0) {
    console.error("No owner account exists yet. Use the Setup Wizard instead of recovery.");
    process.exitCode = 1;
    return;
  }
  if (owners.length > 1) {
    console.error(
      `Found ${owners.length} accounts in admin_users, but this product expects exactly one owner. ` +
        "Refusing to guess which one to reset - this needs a manual look, not an automated recovery.",
    );
    process.exitCode = 1;
    return;
  }
  const owner = owners[0];

  console.log(`Current owner username: ${owner.username}`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const newUsernameInput = await ask(rl, "New username (leave blank to keep the current one): ");
  rl.close();

  const password1 = await askSecret("New password (min 8 characters): ");
  const password2 = await askSecret("Confirm new password: ");

  if (password1 !== password2) {
    console.error("Passwords did not match. Nothing was changed.");
    process.exitCode = 1;
    return;
  }
  if (!password1 || password1.length < 8) {
    console.error("Password must be at least 8 characters long. Nothing was changed.");
    process.exitCode = 1;
    return;
  }

  const { hash, salt } = authService.hashPassword(password1);
  const finalUsername = newUsernameInput.trim() ? newUsernameInput.trim().toLowerCase() : owner.username;

  if (finalUsername !== owner.username) {
    const clash = await db.query(`SELECT id FROM admin_users WHERE username = $1 AND id != $2`, [
      finalUsername,
      owner.id,
    ]);
    if (clash.length > 0) {
      console.error("That username is already in use. Nothing was changed.");
      process.exitCode = 1;
      return;
    }
  }

  await db.query(
    `UPDATE admin_users SET username = $1, password_hash = $2, salt = $3, updated_at = now() WHERE id = $4`,
    [finalUsername, hash, salt, owner.id],
  );
  const revoked = await db.query(`DELETE FROM admin_sessions WHERE user_id = $1 RETURNING id`, [owner.id]);

  console.log("");
  console.log(`Owner credentials updated. Username: ${finalUsername}`);
  console.log(`${revoked.length} existing session(s) revoked - sign in again with the new password.`);
  console.log("No customer data, projects, videos, or settings were touched.");
}

main()
  .catch((error) => {
    console.error("Recovery failed:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => process.exit());
