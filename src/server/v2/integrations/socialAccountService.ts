import axios from "axios";
import crypto from "crypto";
import cuid from "cuid";
import { logger } from "../../../logger";
import type { V2Database } from "../db";
import type { ProviderCredentialsVault } from "../provider-vault/providerCredentialsVault";
import {
  OAUTH_CONTRACTS,
  buildRefreshBody,
  parseTokenResponse,
  type OAuthAppConfig,
  type OAuthTokenSet,
} from "./oauthProviders";
import type { OAuthProviderId } from "./oauthService";
import { normalizedError, type NormalizedProviderError } from "./providerErrors";

/**
 * CONNECTED ACCOUNT LIFECYCLE
 * ---------------------------
 * Storing, refreshing, reading and removing the per-customer account
 * connections that sit behind publishing.
 *
 * Tokens are encrypted with the same vault primitives as provider credentials
 * and are never returned to a browser. The account row keeps only what the UI
 * legitimately shows - the channel or Page name, when it was connected, how it
 * is doing - and the identifiers stay server-side.
 *
 * Refresh is the part that is easy to get wrong. Two publishes starting at once
 * on an almost-expired token would each notice the expiry and each spend the
 * refresh token; the second one then fails because most providers invalidate the
 * previous refresh token. An advisory lock makes the refresh atomic so only one
 * caller performs it and the other waits for the result.
 */

/** Refresh this far ahead of the real expiry so an in-flight upload cannot age out. */
export const REFRESH_SKEW_MS = 5 * 60 * 1000;

export type ConnectedAccount = {
  id: string;
  platform: string;
  provider: string;
  accountName: string;
  accountId: string;
  connectionStatus: "connected" | "disconnected" | "expired" | "error";
  avatarUrl?: string;
  grantedScopes: string[];
  connectedAt: string;
  tokenExpiresAt?: string;
  lastRefreshAt?: string;
  lastSuccessAt?: string;
  lastCheckedAt: string;
  /** Provider-reported capabilities, e.g. TikTok privacy options. */
  capabilities: Record<string, unknown>;
};

type AccountRow = {
  id: string;
  platform: string;
  provider: string;
  account_name: string;
  account_id: string;
  connection_status: string;
  capabilities: Record<string, unknown>;
  encrypted_credentials: string | null;
  avatar_url: string | null;
  granted_scopes: string[] | null;
  oauth_provider: string | null;
  token_expires_at: Date | null;
  last_refresh_at: Date | null;
  last_success_at: Date | null;
  last_checked_at: Date;
  created_at: Date;
  updated_at: Date;
};

/** Nothing sensitive survives this mapping; it is what the API returns. */
function toPublicAccount(row: AccountRow): ConnectedAccount {
  return {
    id: row.id,
    platform: row.platform,
    provider: row.provider,
    accountName: row.account_name,
    // The provider-scoped id is needed by the publish screen to target a
    // destination, but it is never rendered as primary UI text.
    accountId: row.account_id,
    connectionStatus: (row.connection_status as ConnectedAccount["connectionStatus"]) || "connected",
    avatarUrl: row.avatar_url || undefined,
    grantedScopes: row.granted_scopes || [],
    connectedAt: row.created_at.toISOString(),
    tokenExpiresAt: row.token_expires_at?.toISOString(),
    lastRefreshAt: row.last_refresh_at?.toISOString(),
    lastSuccessAt: row.last_success_at?.toISOString(),
    lastCheckedAt: row.last_checked_at.toISOString(),
    capabilities: row.capabilities || {},
  };
}

export class SocialAccountService {
  constructor(
    private db: V2Database,
    private vault: ProviderCredentialsVault,
    private masterKey: string,
  ) {}

  // ------------------------------------------------------------ encryption

  private key(): Buffer {
    const trimmed = (this.masterKey || "").trim();
    if (!trimmed) throw new Error("PROVIDER_VAULT_MASTER_KEY is not configured.");
    const maybeBase64 = Buffer.from(trimmed, "base64");
    if (maybeBase64.length === 32) return maybeBase64;
    return crypto.createHash("sha256").update(trimmed, "utf8").digest();
  }

  private encrypt(payload: Record<string, unknown>, accountId: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key(), iv);
    // Binding the ciphertext to the account id stops a row's credentials being
    // pasted onto a different account.
    cipher.setAAD(Buffer.from(`social_account:${accountId}`, "utf8"));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(payload), "utf8"),
      cipher.final(),
    ]);
    return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(".");
  }

  private decrypt(blob: string, accountId: string): Record<string, unknown> | null {
    try {
      const [iv, tag, data] = blob.split(".");
      if (!iv || !tag || !data) return null;
      const decipher = crypto.createDecipheriv("aes-256-gcm", this.key(), Buffer.from(iv, "base64"));
      decipher.setAAD(Buffer.from(`social_account:${accountId}`, "utf8"));
      decipher.setAuthTag(Buffer.from(tag, "base64"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(data, "base64")),
        decipher.final(),
      ]).toString("utf8");
      return JSON.parse(plaintext);
    } catch {
      // A credential that will not decrypt is unusable; the caller treats this
      // as "needs reconnect" rather than crashing a publish.
      return null;
    }
  }

  // --------------------------------------------------------------- storage

  /**
   * Stores or replaces a connection.
   *
   * Keyed on (platform, account_id) so reconnecting the same channel updates the
   * existing row instead of leaving a duplicate behind - which would let a
   * scheduled publication keep using an old, revoked token.
   */
  public async upsertAccount(input: {
    platform: string;
    provider: string;
    oauthProvider?: OAuthProviderId;
    accountId: string;
    accountName: string;
    avatarUrl?: string;
    tokens: OAuthTokenSet;
    capabilities?: Record<string, unknown>;
    /** Extra secrets to store alongside the tokens, e.g. a Page access token. */
    extraCredentials?: Record<string, unknown>;
  }): Promise<ConnectedAccount> {
    const existing = await this.db.query<{ id: string }>(
      `SELECT id FROM social_accounts WHERE platform = $1 AND account_id = $2 LIMIT 1`,
      [input.platform, input.accountId],
    );
    const id = existing[0]?.id || `acct_${cuid()}`;

    const credentials = this.encrypt(
      {
        accessToken: input.tokens.accessToken,
        refreshToken: input.tokens.refreshToken,
        ...(input.extraCredentials || {}),
      },
      id,
    );

    const rows = await this.db.query<AccountRow>(
      `INSERT INTO social_accounts (
         id, platform, account_name, account_id, provider, connection_status,
         capabilities, encrypted_credentials, avatar_url, granted_scopes,
         oauth_provider, token_expires_at, last_refresh_at, last_checked_at,
         created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,'connected',$6,$7,$8,$9,$10,$11,now(),now(),now(),now())
       ON CONFLICT (id) DO UPDATE SET
         account_name = EXCLUDED.account_name,
         provider = EXCLUDED.provider,
         connection_status = 'connected',
         capabilities = EXCLUDED.capabilities,
         encrypted_credentials = EXCLUDED.encrypted_credentials,
         avatar_url = EXCLUDED.avatar_url,
         granted_scopes = EXCLUDED.granted_scopes,
         oauth_provider = EXCLUDED.oauth_provider,
         token_expires_at = EXCLUDED.token_expires_at,
         last_refresh_at = now(),
         last_checked_at = now(),
         updated_at = now()
       RETURNING *`,
      [
        id,
        input.platform,
        input.accountName,
        input.accountId,
        input.provider,
        JSON.stringify(input.capabilities || {}),
        credentials,
        input.avatarUrl || null,
        input.tokens.scopes,
        input.oauthProvider || null,
        input.tokens.expiresAt || null,
      ],
    );

    return toPublicAccount(rows[0]);
  }

  public async listAccounts(): Promise<ConnectedAccount[]> {
    const rows = await this.db.query<AccountRow>(
      `SELECT * FROM social_accounts ORDER BY created_at DESC`,
    );
    return rows.map(toPublicAccount);
  }

  public async getAccount(id: string): Promise<ConnectedAccount | null> {
    const rows = await this.db.query<AccountRow>(`SELECT * FROM social_accounts WHERE id = $1`, [id]);
    return rows[0] ? toPublicAccount(rows[0]) : null;
  }

  /**
   * The only way publishing gets a usable token.
   *
   * Refreshes first when the token is close to expiry, so the caller never has
   * to reason about token lifetime.
   */
  public async getUsableCredentials(
    accountId: string,
  ): Promise<
    | { ok: true; credentials: Record<string, unknown> }
    | { ok: false; error: NormalizedProviderError }
  > {
    const rows = await this.db.query<AccountRow>(`SELECT * FROM social_accounts WHERE id = $1`, [accountId]);
    const row = rows[0];
    if (!row) {
      return { ok: false, error: normalizedError("authorization_required", "account:not_found") };
    }
    if (row.connection_status === "disconnected") {
      return { ok: false, error: normalizedError("authorization_required", "account:disconnected") };
    }
    if (!row.encrypted_credentials) {
      return { ok: false, error: normalizedError("authorization_required", "account:no_credentials") };
    }

    const credentials = this.decrypt(row.encrypted_credentials, row.id);
    if (!credentials) {
      await this.markStatus(row.id, "error");
      return { ok: false, error: normalizedError("refresh_failed", "account:credentials_unreadable") };
    }

    const expiresAt = row.token_expires_at ? row.token_expires_at.getTime() : undefined;
    const needsRefresh = expiresAt !== undefined && expiresAt - Date.now() <= REFRESH_SKEW_MS;
    if (!needsRefresh) return { ok: true, credentials };

    const refreshed = await this.refreshAccount(row.id);
    if (!refreshed.ok) return refreshed;
    return { ok: true, credentials: refreshed.credentials };
  }

  /**
   * Renews a token exactly once, even under concurrent callers.
   *
   * `pg_advisory_xact_lock` serialises refreshes for one account; the second
   * caller blocks, then re-reads the row and finds a fresh token rather than
   * spending the refresh token a second time.
   */
  public async refreshAccount(
    accountId: string,
  ): Promise<
    | { ok: true; credentials: Record<string, unknown> }
    | { ok: false; error: NormalizedProviderError }
  > {
    return this.db.transaction(async (tx) => {
      await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`social_account_refresh:${accountId}`]);

      const rows = await tx.query<AccountRow>(`SELECT * FROM social_accounts WHERE id = $1`, [accountId]);
      const row = rows[0];
      if (!row || !row.encrypted_credentials) {
        return { ok: false as const, error: normalizedError("authorization_required", "account:not_found") };
      }

      const credentials = this.decrypt(row.encrypted_credentials, row.id);
      if (!credentials) {
        return { ok: false as const, error: normalizedError("refresh_failed", "account:credentials_unreadable") };
      }

      // Another caller may have refreshed while this one waited on the lock.
      const expiresAt = row.token_expires_at ? row.token_expires_at.getTime() : undefined;
      if (expiresAt !== undefined && expiresAt - Date.now() > REFRESH_SKEW_MS) {
        return { ok: true as const, credentials };
      }

      const oauthProvider = row.oauth_provider as OAuthProviderId | null;
      const refreshToken = credentials.refreshToken as string | undefined;
      if (!oauthProvider || !refreshToken) {
        // Meta long-lived Page tokens have no refresh grant; they simply expire
        // and the customer reconnects. Saying so is better than pretending.
        await tx.query(
          `UPDATE social_accounts SET connection_status = 'expired', updated_at = now() WHERE id = $1`,
          [accountId],
        );
        return { ok: false as const, error: normalizedError("expired_token", "account:no_refresh_grant") };
      }

      const app = await this.readAppConfig(oauthProvider);
      if (!app) {
        return { ok: false as const, error: normalizedError("invalid_credentials", "account:app_not_configured") };
      }

      const contract = OAUTH_CONTRACTS[oauthProvider];
      const body = buildRefreshBody({ contract, app, refreshToken });

      const response = await axios.post(contract.tokenUrl, body.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 20000,
        validateStatus: () => true,
      });

      const tokens =
        response.status >= 200 && response.status < 300
          ? parseTokenResponse(contract, response.data || {}, contract.scopes)
          : null;

      if (!tokens) {
        // A refresh that fails permanently must stop, not spin: the state moves
        // to EXPIRED and the customer is asked to reconnect.
        await tx.query(
          `UPDATE social_accounts SET connection_status = 'expired', updated_at = now() WHERE id = $1`,
          [accountId],
        );
        logger.warn({ accountId, provider: oauthProvider }, "OAuth refresh failed; account marked expired");
        return { ok: false as const, error: normalizedError("refresh_failed", `${oauthProvider}:refresh_rejected`) };
      }

      const next = {
        ...credentials,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken || refreshToken,
      };

      await tx.query(
        `UPDATE social_accounts
            SET encrypted_credentials = $2,
                token_expires_at = $3,
                last_refresh_at = now(),
                connection_status = 'connected',
                updated_at = now()
          WHERE id = $1`,
        [accountId, this.encrypt(next, accountId), tokens.expiresAt || null],
      );

      return { ok: true as const, credentials: next };
    });
  }

  public async markStatus(
    accountId: string,
    status: ConnectedAccount["connectionStatus"],
  ): Promise<void> {
    await this.db.query(
      `UPDATE social_accounts SET connection_status = $2, last_checked_at = now(), updated_at = now() WHERE id = $1`,
      [accountId, status],
    );
  }

  public async markSuccess(accountId: string): Promise<void> {
    await this.db.query(
      `UPDATE social_accounts SET last_success_at = now(), connection_status = 'connected', updated_at = now() WHERE id = $1`,
      [accountId],
    );
  }

  /**
   * Disconnects an account.
   *
   * Three things happen, in this order, and the order matters:
   *  1. the provider is asked to revoke, where it supports revocation
   *  2. the stored credentials are destroyed so nothing can publish with them
   *  3. pending scheduled publications for the account are flagged Needs
   *     Attention rather than deleted
   *
   * Historical publications, their post URLs and the attempt history are left
   * completely untouched - the customer's record of what was published does not
   * depend on the connection still existing.
   */
  public async disconnect(accountId: string): Promise<{
    revoked: boolean;
    scheduledNeedingAttention: number;
  }> {
    const rows = await this.db.query<AccountRow>(`SELECT * FROM social_accounts WHERE id = $1`, [accountId]);
    const row = rows[0];
    if (!row) return { revoked: false, scheduledNeedingAttention: 0 };

    let revoked = false;
    const credentials = row.encrypted_credentials ? this.decrypt(row.encrypted_credentials, row.id) : null;
    const oauthProvider = row.oauth_provider as OAuthProviderId | null;

    if (oauthProvider && credentials?.accessToken) {
      const contract = OAUTH_CONTRACTS[oauthProvider];
      if (contract.revokeUrl) {
        try {
          const app = await this.readAppConfig(oauthProvider);
          const body =
            oauthProvider === "tiktok" && app
              ? new URLSearchParams({
                  client_key: app.clientId,
                  client_secret: app.clientSecret,
                  token: String(credentials.accessToken),
                })
              : new URLSearchParams({ token: String(credentials.accessToken) });
          const response = await axios.post(contract.revokeUrl, body.toString(), {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            timeout: 15000,
            validateStatus: () => true,
          });
          revoked = response.status >= 200 && response.status < 300;
        } catch {
          // A provider that will not answer must not block the local removal;
          // destroying the stored token still makes it unusable from here.
          revoked = false;
        }
      }
    }

    await this.db.query(
      `UPDATE social_accounts
          SET connection_status = 'disconnected',
              encrypted_credentials = NULL,
              token_expires_at = NULL,
              updated_at = now()
        WHERE id = $1`,
      [accountId],
    );

    // Anything queued against this account can no longer run. Flagging rather
    // than deleting keeps the customer's schedule visible so they can reconnect
    // and re-arm it.
    const flagged = await this.db.query<{ id: string }>(
      `UPDATE scheduled_publications sp
          SET status = 'needs_attention', updated_at = now()
         FROM publications p
        WHERE sp.publication_id = p.id
          AND p.account_id = $1
          AND sp.status = 'pending'
      RETURNING sp.id`,
      [accountId],
    );

    logger.info(
      { accountId, revoked, flagged: flagged.length },
      "Social account disconnected; credentials destroyed and pending schedules flagged",
    );

    return { revoked, scheduledNeedingAttention: flagged.length };
  }

  /** Reads the OAuth app credentials the customer configured in the browser. */
  public async readAppConfig(providerId: OAuthProviderId): Promise<OAuthAppConfig | null> {
    const raw = await this.vault.readPlaintext(providerId, "app_config");
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed.clientId || !parsed.clientSecret) return null;
      return { clientId: String(parsed.clientId), clientSecret: String(parsed.clientSecret) };
    } catch {
      return null;
    }
  }
}
