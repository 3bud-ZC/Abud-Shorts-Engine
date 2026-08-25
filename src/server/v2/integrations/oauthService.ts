import crypto from "crypto";
import type { V2Database } from "../db";

/**
 * OAUTH STATE LIFECYCLE
 * ---------------------
 * The security half of the OAuth flows. Everything provider-specific lives in
 * `oauthProviders.ts`; this file owns the parts that are the same for Google,
 * Meta and TikTok and that are easy to get subtly wrong.
 *
 * Before F3 `createOAuthState` existed but nothing ever consumed a state, so an
 * authorization code could have been replayed indefinitely and the CSRF value
 * was never actually checked. The table also stored a `code_verifier_hash`
 * derived from a random cuid rather than from a real PKCE verifier, which meant
 * PKCE was decorative.
 *
 * Guarantees:
 *  - state carries 32 bytes of CSPRNG entropy
 *  - state expires (10 minutes) and is single-use, enforced by an atomic
 *    conditional UPDATE rather than a read-then-write
 *  - the PKCE verifier is real and is returned only to the server that created it
 *  - the redirect URI is validated against the callback this installation serves,
 *    so a crafted `redirectUri` cannot turn the callback into an open redirect
 */

export type OAuthProviderId = "youtube" | "meta" | "tiktok";

export const OAUTH_PROVIDERS: OAuthProviderId[] = ["youtube", "meta", "tiktok"];

export function isOAuthProvider(value: string): value is OAuthProviderId {
  return (OAUTH_PROVIDERS as string[]).includes(value);
}

/** How long an authorization attempt may stay open. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export type CreatedOAuthState = {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  expiresAt: string;
};

export type ConsumedOAuthState = {
  providerId: OAuthProviderId;
  redirectUri: string;
  codeVerifier: string;
  /** Where to send the browser once the connection is stored. */
  returnPath: string;
};

function base64url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

/** RFC 7636 S256 challenge. */
export function pkceChallenge(verifier: string): string {
  return base64url(crypto.createHash("sha256").update(verifier).digest());
}

/**
 * The callback URL this installation serves for a provider.
 *
 * Derived from the configured public URL, never from a request header: trusting
 * `Host` here is how a callback becomes an open redirect.
 */
export function callbackUrlFor(publicBaseUrl: string, providerId: OAuthProviderId): string {
  const base = publicBaseUrl.replace(/\/+$/, "");
  return `${base}/api/v2/providers/${providerId}/oauth/callback`;
}

/**
 * Accepts a redirect URI only if it is exactly the callback this installation
 * serves. Providers echo the value back, so anything looser is exploitable.
 */
export function isAllowedRedirectUri(
  candidate: string,
  publicBaseUrl: string,
  providerId: OAuthProviderId,
): boolean {
  try {
    const expected = new URL(callbackUrlFor(publicBaseUrl, providerId));
    const actual = new URL(candidate);
    return (
      actual.protocol === expected.protocol &&
      actual.host === expected.host &&
      actual.pathname === expected.pathname
    );
  } catch {
    return false;
  }
}

/**
 * Only same-origin application paths may be used as a post-connection
 * destination, so a crafted `returnTo` cannot bounce the customer off-site.
 */
export function safeReturnPath(candidate: unknown): string {
  const value = typeof candidate === "string" ? candidate.trim() : "";
  if (!value.startsWith("/") || value.startsWith("//")) return "/integrations";
  if (value.includes("\\")) return "/integrations";
  return value.slice(0, 200);
}

export class OAuthStateService {
  constructor(private db: V2Database) {}

  /**
   * Creates a single-use authorization attempt.
   *
   * The verifier is stored hashed; a database reader cannot reconstruct it, and
   * the callback proves possession by presenting the state it was issued with.
   */
  public async create(input: {
    providerId: OAuthProviderId;
    redirectUri: string;
    returnPath?: string;
  }): Promise<CreatedOAuthState> {
    const state = base64url(crypto.randomBytes(32));
    const codeVerifier = base64url(crypto.randomBytes(64));
    const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS);

    await this.db.query(
      `INSERT INTO provider_oauth_states
         (state, provider_id, redirect_uri, code_verifier_hash, code_verifier, return_path, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        state,
        input.providerId,
        input.redirectUri,
        crypto.createHash("sha256").update(codeVerifier).digest("hex"),
        codeVerifier,
        safeReturnPath(input.returnPath),
        expiresAt,
      ],
    );

    return {
      state,
      codeVerifier,
      codeChallenge: pkceChallenge(codeVerifier),
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Redeems a state exactly once.
   *
   * The `used_at IS NULL` predicate lives inside the UPDATE, so two concurrent
   * callbacks with the same state cannot both succeed - the second one updates
   * zero rows. Returns null for unknown, expired or already-used states, which
   * the caller reports as a single generic failure so the difference cannot be
   * probed from outside.
   */
  public async consume(state: string): Promise<ConsumedOAuthState | null> {
    if (!state || typeof state !== "string" || state.length < 20) return null;

    const rows = await this.db.query<{
      provider_id: string;
      redirect_uri: string | null;
      code_verifier: string | null;
      return_path: string | null;
    }>(
      `UPDATE provider_oauth_states
          SET used_at = now()
        WHERE state = $1
          AND used_at IS NULL
          AND expires_at > now()
      RETURNING provider_id, redirect_uri, code_verifier, return_path`,
      [state],
    );

    const row = rows[0];
    if (!row || !isOAuthProvider(row.provider_id)) return null;

    return {
      providerId: row.provider_id,
      redirectUri: row.redirect_uri || "",
      codeVerifier: row.code_verifier || "",
      returnPath: safeReturnPath(row.return_path),
    };
  }

  /** Removes states that can no longer be redeemed. Safe to run on any schedule. */
  public async purgeExpired(): Promise<number> {
    const rows = await this.db.query<{ state: string }>(
      `DELETE FROM provider_oauth_states
        WHERE expires_at < now() - interval '1 hour'
           OR (used_at IS NOT NULL AND used_at < now() - interval '1 hour')
      RETURNING state`,
    );
    return rows.length;
  }
}
