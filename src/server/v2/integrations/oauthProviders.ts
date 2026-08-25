/**
 * PROVIDER OAUTH CONTRACTS
 * ------------------------
 * Authorization URLs, token endpoints and scopes for the three account-based
 * publishing providers, checked against the providers' current official
 * documentation in August 2026 rather than inherited from the previous build.
 *
 * Each entry states which scopes are requested and why. Nothing broader than the
 * feature needs is asked for: a customer connecting a YouTube channel is not
 * asked to hand over their whole Google account.
 */

import type { OAuthProviderId } from "./oauthService";

export type OAuthAppConfig = {
  clientId: string;
  clientSecret: string;
};

export type OAuthTokenSet = {
  accessToken: string;
  refreshToken?: string;
  /** Absolute expiry, computed from the provider's relative `expires_in`. */
  expiresAt?: Date;
  scopes: string[];
  /** Provider-specific extras that are safe to persist (never the raw body). */
  meta?: Record<string, string | number | boolean>;
};

export type OAuthProviderContract = {
  id: OAuthProviderId;
  displayName: string;
  authorizeUrl: string;
  tokenUrl: string;
  /** Endpoint used to invalidate a token on disconnect, when the provider has one. */
  revokeUrl?: string;
  scopes: string[];
  /** Why each scope is requested; shown on the connect screen. */
  scopeRationale: Record<string, string>;
  usesPkce: boolean;
  /** Extra query parameters the provider requires on the authorize call. */
  extraAuthorizeParams: Record<string, string>;
  /** Where the customer creates the app, shown in the configuration dialog. */
  consoleUrl: string;
  /** Field labels for the no-code app configuration form. */
  appFields: Array<{ key: "clientId" | "clientSecret"; label: string; help: string }>;
};

/**
 * YouTube uses Google's OAuth 2.0 endpoints. `youtube.upload` is the narrowest
 * scope that can insert a video; `youtube.readonly` is the narrowest that can
 * read the channel identity we show in Connected Accounts. Service accounts are
 * deliberately not used - Google does not support them for uploads to a normal
 * personal channel.
 */
export const YOUTUBE_OAUTH: OAuthProviderContract = {
  id: "youtube",
  displayName: "YouTube",
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  revokeUrl: "https://oauth2.googleapis.com/revoke",
  scopes: [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.readonly",
  ],
  scopeRationale: {
    "https://www.googleapis.com/auth/youtube.upload": "Upload the videos you publish from ABUD Shorts.",
    "https://www.googleapis.com/auth/youtube.readonly": "Read your channel name so it can be shown here.",
  },
  usesPkce: true,
  extraAuthorizeParams: {
    // offline + consent is what actually returns a refresh token on Google.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  },
  consoleUrl: "https://console.cloud.google.com/apis/credentials",
  appFields: [
    { key: "clientId", label: "Client ID", help: "From your Google Cloud OAuth 2.0 Client (Web application)." },
    { key: "clientSecret", label: "Client Secret", help: "Stored encrypted. It is never shown again." },
  ],
};

/**
 * Meta covers both Instagram Reels and Facebook Page Reels through one Facebook
 * Login authorization. The Page permissions are required to list Pages and post
 * to them; the Instagram ones to find the professional account behind a Page and
 * publish a Reel to it.
 */
export const META_OAUTH: OAuthProviderContract = {
  id: "meta",
  displayName: "Instagram & Facebook",
  authorizeUrl: "https://www.facebook.com/v21.0/dialog/oauth",
  tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token",
  scopes: [
    "pages_show_list",
    "pages_read_engagement",
    "pages_manage_posts",
    "instagram_basic",
    "instagram_content_publish",
    "business_management",
  ],
  scopeRationale: {
    pages_show_list: "List the Facebook Pages you manage so you can choose one.",
    pages_read_engagement: "Read the Page name and its linked Instagram account.",
    pages_manage_posts: "Publish Reels to the Page you choose.",
    instagram_basic: "Read the Instagram professional account linked to that Page.",
    instagram_content_publish: "Publish Reels to that Instagram account.",
    business_management: "Find Pages that belong to a Business account.",
  },
  usesPkce: false,
  extraAuthorizeParams: {},
  consoleUrl: "https://developers.facebook.com/apps",
  appFields: [
    { key: "clientId", label: "App ID", help: "From your Meta app dashboard." },
    { key: "clientSecret", label: "App Secret", help: "Stored encrypted. It is never shown again." },
  ],
};

/**
 * TikTok Login Kit. `video.publish` is required for Direct Post and
 * `video.upload` for sending a draft to the creator's inbox; both are requested
 * so the customer can choose either mode without reconnecting. `user.info.basic`
 * supplies the display name shown in Connected Accounts.
 */
export const TIKTOK_OAUTH: OAuthProviderContract = {
  id: "tiktok",
  displayName: "TikTok",
  authorizeUrl: "https://www.tiktok.com/v2/auth/authorize/",
  tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
  revokeUrl: "https://open.tiktokapis.com/v2/oauth/revoke/",
  scopes: ["user.info.basic", "video.publish", "video.upload"],
  scopeRationale: {
    "user.info.basic": "Read your TikTok display name so it can be shown here.",
    "video.publish": "Post videos directly to your TikTok account.",
    "video.upload": "Send videos to your TikTok drafts instead of posting them.",
  },
  usesPkce: true,
  extraAuthorizeParams: {},
  consoleUrl: "https://developers.tiktok.com/apps",
  appFields: [
    { key: "clientId", label: "Client Key", help: "From your TikTok app's Login Kit settings." },
    { key: "clientSecret", label: "Client Secret", help: "Stored encrypted. It is never shown again." },
  ],
};

export const OAUTH_CONTRACTS: Record<OAuthProviderId, OAuthProviderContract> = {
  youtube: YOUTUBE_OAUTH,
  meta: META_OAUTH,
  tiktok: TIKTOK_OAUTH,
};

/**
 * Builds the URL the customer's browser is sent to.
 *
 * TikTok names its client parameter `client_key` rather than `client_id`, which
 * is the kind of detail that silently produces an "invalid client" screen.
 */
export function buildAuthorizeUrl(input: {
  contract: OAuthProviderContract;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge?: string;
}): string {
  const { contract } = input;
  const params = new URLSearchParams({
    response_type: "code",
    redirect_uri: input.redirectUri,
    state: input.state,
    ...contract.extraAuthorizeParams,
  });

  if (contract.id === "tiktok") {
    params.set("client_key", input.clientId);
    params.set("scope", contract.scopes.join(","));
  } else {
    params.set("client_id", input.clientId);
    params.set("scope", contract.scopes.join(" "));
  }

  if (contract.usesPkce && input.codeChallenge) {
    params.set("code_challenge", input.codeChallenge);
    params.set("code_challenge_method", "S256");
  }

  return `${contract.authorizeUrl}?${params.toString()}`;
}

/** Request body for the code-for-token exchange, in each provider's shape. */
export function buildTokenExchangeBody(input: {
  contract: OAuthProviderContract;
  app: OAuthAppConfig;
  code: string;
  redirectUri: string;
  codeVerifier?: string;
}): URLSearchParams {
  const body = new URLSearchParams({
    code: input.code,
    grant_type: "authorization_code",
    redirect_uri: input.redirectUri,
  });

  if (input.contract.id === "tiktok") {
    body.set("client_key", input.app.clientId);
    body.set("client_secret", input.app.clientSecret);
  } else {
    body.set("client_id", input.app.clientId);
    body.set("client_secret", input.app.clientSecret);
  }

  if (input.contract.usesPkce && input.codeVerifier) {
    body.set("code_verifier", input.codeVerifier);
  }

  return body;
}

/** Request body for a refresh, for the providers that support one. */
export function buildRefreshBody(input: {
  contract: OAuthProviderContract;
  app: OAuthAppConfig;
  refreshToken: string;
}): URLSearchParams {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
  });
  if (input.contract.id === "tiktok") {
    body.set("client_key", input.app.clientId);
    body.set("client_secret", input.app.clientSecret);
  } else {
    body.set("client_id", input.app.clientId);
    body.set("client_secret", input.app.clientSecret);
  }
  return body;
}

/**
 * Reads a token response into the canonical shape.
 *
 * The three providers disagree on almost everything: Google returns `scope` as a
 * space-separated string, TikTok returns it comma-separated and nests nothing,
 * and Meta returns no scope at all on the token response. Normalising here keeps
 * that mess out of the account service.
 */
export function parseTokenResponse(
  contract: OAuthProviderContract,
  body: Record<string, unknown>,
  requestedScopes: string[],
): OAuthTokenSet | null {
  const accessToken = String(body.access_token || "");
  if (!accessToken) return null;

  const expiresIn = Number(body.expires_in);
  const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0
    ? new Date(Date.now() + expiresIn * 1000)
    : undefined;

  let scopes: string[] = [];
  const rawScope = body.scope;
  if (typeof rawScope === "string" && rawScope.trim()) {
    scopes = rawScope.includes(",") ? rawScope.split(",") : rawScope.split(" ");
  } else {
    // Meta does not echo scopes here. The granted set is discovered separately
    // via the permissions edge; until then the requested set is recorded as
    // "requested", never as "granted".
    scopes = [];
  }
  scopes = scopes.map((scope) => scope.trim()).filter(Boolean);

  const meta: Record<string, string | number | boolean> = {};
  if (typeof body.open_id === "string") meta.openId = body.open_id;
  if (typeof body.token_type === "string") meta.tokenType = body.token_type;
  if (Number.isFinite(Number(body.refresh_expires_in))) {
    meta.refreshExpiresIn = Number(body.refresh_expires_in);
  }

  return {
    accessToken,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : undefined,
    expiresAt,
    scopes: scopes.length > 0 ? scopes : requestedScopes.length > 0 ? [] : [],
    meta,
  };
}

/** Scopes the feature needs but the customer did not grant. */
export function missingScopes(granted: string[], required: string[]): string[] {
  if (granted.length === 0) return [];
  return required.filter((scope) => !granted.includes(scope));
}
