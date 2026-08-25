import crypto from "crypto";
import cuid from "cuid";
import type { Config } from "../../../config";
import type { V2Database } from "../db";

export type CredentialType =
  | "api_key"
  | "service_account_json"
  | "bot_token"
  | "chat_config"
  | "oauth_token"
  | "app_config";

export type VaultCredentialPublic = {
  providerId: string;
  credentialType: CredentialType;
  configured: boolean;
  maskedHint?: string;
  keyVersion: number;
  health: string;
  configuredAt: string;
  lastTestedAt?: string;
  updatedAt: string;
};

type CredentialRow = {
  provider_id: string;
  credential_type: CredentialType;
  ciphertext: string;
  iv: string;
  auth_tag: string;
  key_version: number;
  masked_hint?: string;
  metadata: Record<string, unknown>;
  health: string;
  configured_at: Date;
  last_tested_at?: Date;
  updated_at: Date;
};

const PROVIDER_CREDENTIAL_TYPES: Record<string, CredentialType[]> = {
  pexels: ["api_key"],
  // Optional second stock source; absence never blocks readiness.
  pixabay: ["api_key"],
  gemini: ["api_key"],
  google_cloud_tts: ["service_account_json"],
  elevenlabs: ["api_key"],
  telegram: ["bot_token", "chat_config"],
  upload_post: ["api_key"],
  youtube: ["oauth_token", "app_config"],
  meta: ["oauth_token", "app_config"],
  tiktok: ["oauth_token", "app_config"],
};

function deriveKey(masterKey: string): Buffer {
  const trimmed = masterKey.trim();
  if (!trimmed) {
    throw new Error("PROVIDER_VAULT_MASTER_KEY is not configured.");
  }
  const maybeBase64 = Buffer.from(trimmed, "base64");
  if (maybeBase64.length === 32 && maybeBase64.toString("base64").replace(/=+$/, "") === trimmed.replace(/=+$/, "")) {
    return maybeBase64;
  }
  return crypto.createHash("sha256").update(trimmed, "utf8").digest();
}

function maskSecret(value: string): string {
  const compact = value.replace(/\s+/g, "");
  if (compact.length <= 8) return "••••";
  return `${compact.slice(0, 4)}••••${compact.slice(-4)}`;
}

function publicRow(row: CredentialRow): VaultCredentialPublic {
  return {
    providerId: row.provider_id,
    credentialType: row.credential_type,
    configured: true,
    maskedHint: row.masked_hint,
    keyVersion: row.key_version,
    health: row.health,
    configuredAt: row.configured_at.toISOString(),
    lastTestedAt: row.last_tested_at?.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function allowedCredentialTypes(providerId: string): CredentialType[] {
  return PROVIDER_CREDENTIAL_TYPES[providerId] || [];
}

export class ProviderCredentialsVault {
  constructor(private db: V2Database, private config: Config) {}

  public isAvailable(): boolean {
    return Boolean(this.config.providerVaultMasterKey);
  }

  public async list(): Promise<VaultCredentialPublic[]> {
    const rows = await this.db.query<CredentialRow>(
      `SELECT provider_id, credential_type, ciphertext, iv, auth_tag, key_version,
              masked_hint, metadata, health, configured_at, last_tested_at, updated_at
       FROM provider_credentials_vault
       ORDER BY provider_id ASC, credential_type ASC`,
    );
    return rows.map(publicRow);
  }

  public async listForProvider(providerId: string): Promise<VaultCredentialPublic[]> {
    const rows = await this.db.query<CredentialRow>(
      `SELECT provider_id, credential_type, ciphertext, iv, auth_tag, key_version,
              masked_hint, metadata, health, configured_at, last_tested_at, updated_at
       FROM provider_credentials_vault
       WHERE provider_id = $1
       ORDER BY credential_type ASC`,
      [providerId],
    );
    return rows.map(publicRow);
  }

  public async put(input: {
    providerId: string;
    credentialType: CredentialType;
    plaintext: string;
    metadata?: Record<string, unknown>;
  }): Promise<VaultCredentialPublic> {
    if (!allowedCredentialTypes(input.providerId).includes(input.credentialType)) {
      throw new Error(`${input.credentialType} is not a supported credential type for ${input.providerId}.`);
    }
    const value = input.plaintext.trim();
    if (!value) throw new Error("Credential value is required.");
    const key = deriveKey(this.config.providerVaultMasterKey);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const aad = Buffer.from(`${input.providerId}:${input.credentialType}:1`, "utf8");
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const rows = await this.db.query<CredentialRow>(
      `INSERT INTO provider_credentials_vault (
        provider_id, credential_type, ciphertext, iv, auth_tag, key_version,
        masked_hint, metadata, health, configured_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,1,$6,$7,'configured',now(),now())
      ON CONFLICT (provider_id, credential_type) DO UPDATE SET
        ciphertext = EXCLUDED.ciphertext,
        iv = EXCLUDED.iv,
        auth_tag = EXCLUDED.auth_tag,
        key_version = EXCLUDED.key_version,
        masked_hint = EXCLUDED.masked_hint,
        metadata = EXCLUDED.metadata,
        health = 'configured',
        configured_at = now(),
        updated_at = now()
      RETURNING *`,
      [
        input.providerId,
        input.credentialType,
        ciphertext.toString("base64"),
        iv.toString("base64"),
        authTag.toString("base64"),
        maskSecret(value),
        JSON.stringify(input.metadata || {}),
      ],
    );
    return publicRow(rows[0]);
  }

  public async delete(providerId: string, credentialType?: CredentialType): Promise<number> {
    const rows = credentialType
      ? await this.db.query<{ provider_id: string }>(
          `DELETE FROM provider_credentials_vault WHERE provider_id = $1 AND credential_type = $2 RETURNING provider_id`,
          [providerId, credentialType],
        )
      : await this.db.query<{ provider_id: string }>(
          `DELETE FROM provider_credentials_vault WHERE provider_id = $1 RETURNING provider_id`,
          [providerId],
        );
    return rows.length;
  }

  public async readPlaintext(providerId: string, credentialType: CredentialType): Promise<string | null> {
    const rows = await this.db.query<CredentialRow>(
      `SELECT * FROM provider_credentials_vault WHERE provider_id = $1 AND credential_type = $2`,
      [providerId, credentialType],
    );
    const row = rows[0];
    if (!row) return null;
    const key = deriveKey(this.config.providerVaultMasterKey);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(row.iv, "base64"));
    decipher.setAAD(Buffer.from(`${providerId}:${credentialType}:${row.key_version}`, "utf8"));
    decipher.setAuthTag(Buffer.from(row.auth_tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(row.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }

  public async markTested(providerId: string, health: string): Promise<void> {
    await this.db.query(
      `UPDATE provider_credentials_vault SET health = $2, last_tested_at = now(), updated_at = now() WHERE provider_id = $1`,
      [providerId, health],
    );
  }

  public async createOAuthState(providerId: string, redirectUri?: string): Promise<{ state: string; expiresAt: string }> {
    const state = crypto.randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await this.db.query(
      `INSERT INTO provider_oauth_states (state, provider_id, redirect_uri, code_verifier_hash, expires_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [state, providerId, redirectUri || null, crypto.createHash("sha256").update(cuid()).digest("hex"), expiresAt],
    );
    return { state, expiresAt: expiresAt.toISOString() };
  }
}
