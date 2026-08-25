/**
 * PROVIDER ERROR TAXONOMY AND TEST-CONNECTION CONTRACT
 * ---------------------------------------------------
 * Every external provider fails in its own vocabulary. Before F3 those failures
 * reached the customer as whatever the provider happened to say - an HTTP code,
 * a Graph API subcode, or a raw axios message - so "your Instagram account is a
 * personal account and cannot publish" and "your token expired" both surfaced as
 * the same red box.
 *
 * Everything here maps a provider failure onto one category, one sentence the
 * customer can act on, and a short technical code kept for support. Raw provider
 * bodies, tokens and stack traces never travel to the client.
 */

export type ProviderErrorCategory =
  | "invalid_credentials"
  | "authorization_required"
  | "permission_missing"
  | "plan_upgrade_required"
  | "rate_limited"
  | "quota_exceeded"
  | "provider_unavailable"
  | "network_error"
  | "expired_token"
  | "refresh_failed"
  | "account_not_eligible"
  | "app_review_required"
  | "unsupported_media"
  | "unknown";

export type NormalizedProviderError = {
  category: ProviderErrorCategory;
  /** Plain sentence shown to the customer. Never contains provider jargon. */
  userMessage: string;
  /** Short stable code for support, e.g. "youtube:403:quotaExceeded". */
  technicalCode: string;
  /** True when a bounded retry could plausibly succeed. */
  retryable: boolean;
  /** Seconds the provider asked us to wait, when it said so. */
  retryAfterSeconds?: number;
};

/** Categories that are worth retrying; everything else needs a human. */
const RETRYABLE: ProviderErrorCategory[] = [
  "rate_limited",
  "provider_unavailable",
  "network_error",
];

const USER_MESSAGES: Record<ProviderErrorCategory, string> = {
  invalid_credentials: "The credentials for this provider were rejected. Replace them and try again.",
  authorization_required: "This account needs to be connected before it can be used.",
  permission_missing: "The connected account did not grant a permission this action needs. Reconnect and accept all requested permissions.",
  plan_upgrade_required: "The provider account plan does not include this feature.",
  rate_limited: "The provider is rate limiting requests right now. This will be retried automatically.",
  quota_exceeded: "The provider quota for today has been used up. Try again after it resets.",
  provider_unavailable: "The provider is not responding. This is outside ABUD Shorts.",
  network_error: "The provider could not be reached from this machine.",
  expired_token: "The connection to this account expired. Reconnect it to continue.",
  refresh_failed: "The connection could not be renewed automatically. Reconnect the account.",
  account_not_eligible: "This account type cannot publish through the provider's API.",
  app_review_required: "The provider has not approved this application for this action yet.",
  unsupported_media: "The video does not meet this platform's requirements.",
  unknown: "The provider returned an error that ABUD Shorts does not recognise.",
};

export function normalizedError(
  category: ProviderErrorCategory,
  technicalCode: string,
  options: { userMessage?: string; retryAfterSeconds?: number } = {},
): NormalizedProviderError {
  return {
    category,
    userMessage: options.userMessage || USER_MESSAGES[category],
    technicalCode,
    retryable: RETRYABLE.includes(category),
    retryAfterSeconds: options.retryAfterSeconds,
  };
}

/** Parses a `Retry-After` header, which may be seconds or an HTTP date. */
export function parseRetryAfter(header?: string | number | null): number | undefined {
  if (header === undefined || header === null) return undefined;
  const asNumber = Number(header);
  if (Number.isFinite(asNumber) && asNumber >= 0) return Math.round(asNumber);
  const asDate = Date.parse(String(header));
  if (!Number.isNaN(asDate)) {
    return Math.max(0, Math.round((asDate - Date.now()) / 1000));
  }
  return undefined;
}

/**
 * Generic HTTP mapping, used when a provider gives nothing more specific.
 * Provider adapters layer their own rules on top of this.
 */
export function categoryForHttpStatus(status: number): ProviderErrorCategory {
  if (status === 401) return "invalid_credentials";
  if (status === 403) return "permission_missing";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "provider_unavailable";
  if (status === 0) return "network_error";
  return "unknown";
}

// --------------------------------------------------------------- per provider

/**
 * Google / YouTube Data API.
 *
 * Google reports the interesting part in `error.errors[].reason`; the HTTP code
 * alone cannot tell a quota exhaustion from a missing scope, and both arrive as
 * 403.
 */
export function normalizeGoogleError(
  status: number,
  body: unknown,
  headers?: Record<string, unknown>,
): NormalizedProviderError {
  const error = (body as { error?: { errors?: Array<{ reason?: string; message?: string }>; message?: string } })?.error;
  const reason = error?.errors?.[0]?.reason || "";
  const code = `youtube:${status}:${reason || "unknown"}`;
  const retryAfter = parseRetryAfter(headers?.["retry-after"] as string);

  if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") {
    return normalizedError("quota_exceeded", code);
  }
  if (reason === "rateLimitExceeded" || reason === "userRateLimitExceeded" || status === 429) {
    return normalizedError("rate_limited", code, { retryAfterSeconds: retryAfter });
  }
  if (reason === "insufficientPermissions" || reason === "forbidden") {
    return normalizedError("permission_missing", code);
  }
  if (reason === "youtubeSignupRequired") {
    return normalizedError("account_not_eligible", code, {
      userMessage: "This Google account has no YouTube channel. Create a channel, then reconnect.",
    });
  }
  if (reason === "authError" || status === 401) {
    return normalizedError("expired_token", code);
  }
  if (reason === "invalidVideoMetadata" || reason === "invalidTitle" || reason === "invalidDescription") {
    return normalizedError("unsupported_media", code, {
      userMessage: "YouTube rejected the video title or description. Shorten it and try again.",
    });
  }
  return normalizedError(categoryForHttpStatus(status), code);
}

/**
 * Meta Graph API (Instagram and Facebook).
 *
 * Meta's `code` / `error_subcode` pairs are the only reliable signal; the HTTP
 * status is 400 for a very wide range of unrelated problems.
 */
export function normalizeMetaError(
  status: number,
  body: unknown,
): NormalizedProviderError {
  const error = (body as { error?: { code?: number; error_subcode?: number; message?: string; type?: string } })?.error;
  const metaCode = error?.code;
  const subCode = error?.error_subcode;
  const code = `meta:${status}:${metaCode ?? "na"}${subCode ? `.${subCode}` : ""}`;

  if (metaCode === 190) {
    // 463 = expired, 467 = invalidated, 460 = password changed.
    return normalizedError("expired_token", code);
  }
  if (metaCode === 200 || metaCode === 10 || metaCode === 3) {
    return normalizedError("permission_missing", code, {
      userMessage:
        "This Meta app is missing a permission this action needs. If the app has not passed App Review, " +
        "publishing stays limited to app roles.",
    });
  }
  if (metaCode === 4 || metaCode === 17 || metaCode === 32 || metaCode === 613) {
    return normalizedError("rate_limited", code);
  }
  if (metaCode === 100 && subCode === 2207026) {
    return normalizedError("unsupported_media", code, {
      userMessage: "Instagram rejected the video format. Reels need an MP4 with H.264 video and AAC audio.",
    });
  }
  if (metaCode === 9007 || subCode === 2207050) {
    return normalizedError("account_not_eligible", code, {
      userMessage: "Professional Account Required. Instagram publishing through the API needs a Business or Creator account.",
    });
  }
  if (status >= 500) return normalizedError("provider_unavailable", code);
  return normalizedError(categoryForHttpStatus(status), code);
}

/**
 * TikTok Content Posting API.
 *
 * TikTok returns HTTP 200 with an `error.code` string for most failures, so the
 * status code on its own is close to useless here.
 */
export function normalizeTikTokError(
  status: number,
  body: unknown,
): NormalizedProviderError {
  const error = (body as { error?: { code?: string; message?: string } })?.error;
  const tiktokCode = String(error?.code || "").toLowerCase();
  const code = `tiktok:${status}:${tiktokCode || "unknown"}`;

  if (tiktokCode === "access_token_invalid" || tiktokCode === "invalid_access_token") {
    return normalizedError("expired_token", code);
  }
  if (tiktokCode === "scope_not_authorized" || tiktokCode === "scope_permission_missed") {
    return normalizedError("permission_missing", code, {
      userMessage: "The TikTok account did not grant the publishing permission. Reconnect and accept it.",
    });
  }
  if (tiktokCode === "rate_limit_exceeded" || status === 429) {
    return normalizedError("rate_limited", code);
  }
  if (tiktokCode === "spam_risk_too_many_posts" || tiktokCode === "spam_risk_user_banned_from_posting") {
    return normalizedError("quota_exceeded", code, {
      userMessage: "TikTok is temporarily blocking new posts from this account. Try again later.",
    });
  }
  if (tiktokCode === "unaudited_client_can_only_post_to_private_accounts") {
    return normalizedError("app_review_required", code, {
      userMessage:
        "TikTok App Approval Required for Public Direct Posts. Until this TikTok app is audited, posts are " +
        "restricted to private visibility.",
    });
  }
  if (tiktokCode === "file_format_check_failed" || tiktokCode === "video_pull_failed") {
    return normalizedError("unsupported_media", code, {
      userMessage: "TikTok rejected the video file. It must be an MP4, MOV or WEBM within the account's duration limit.",
    });
  }
  if (tiktokCode === "url_ownership_unverified") {
    return normalizedError("permission_missing", code, {
      userMessage: "TikTok could not verify the source URL. ABUD Shorts uploads the file directly instead.",
    });
  }
  if (status >= 500) return normalizedError("provider_unavailable", code);
  if (tiktokCode && tiktokCode !== "ok") return normalizedError("unknown", code);
  return normalizedError(categoryForHttpStatus(status), code);
}

/**
 * Telegram Bot API.
 *
 * Telegram answers with `ok: false` plus a description string; the numeric
 * error_code is coarse, so the description carries the meaning.
 */
export function normalizeTelegramError(
  status: number,
  body: unknown,
): NormalizedProviderError {
  const payload = body as { error_code?: number; description?: string; parameters?: { retry_after?: number } };
  const description = String(payload?.description || "").toLowerCase();
  const code = `telegram:${payload?.error_code ?? status}`;

  if (description.includes("unauthorized") || description.includes("bot token")) {
    return normalizedError("invalid_credentials", code, {
      userMessage: "Telegram rejected the bot token. Check it in BotFather and save it again.",
    });
  }
  if (description.includes("chat not found")) {
    return normalizedError("account_not_eligible", code, {
      userMessage: "Telegram could not find that chat or channel. Check the ID and that the bot has been added to it.",
    });
  }
  if (description.includes("not enough rights") || description.includes("have no rights")) {
    return normalizedError("permission_missing", code, {
      userMessage: "The bot is in the chat but is not allowed to post. Give it permission to send media.",
    });
  }
  if (description.includes("bot was kicked") || description.includes("bot is not a member")) {
    return normalizedError("authorization_required", code, {
      userMessage: "The bot is not a member of that chat. Add it, then test the connection again.",
    });
  }
  if (description.includes("too many requests") || payload?.error_code === 429) {
    return normalizedError("rate_limited", code, {
      retryAfterSeconds: payload?.parameters?.retry_after,
    });
  }
  if (description.includes("file is too big") || description.includes("request entity too large")) {
    return normalizedError("unsupported_media", code, {
      userMessage:
        "Telegram bots can upload files up to 50 MB through the standard Bot API. This video is larger.",
    });
  }
  if (status >= 500) return normalizedError("provider_unavailable", code);
  return normalizedError(categoryForHttpStatus(status), code);
}

/** Network / transport failures that never reached the provider. */
export function normalizeTransportError(providerId: string, error: unknown): NormalizedProviderError {
  const message = error instanceof Error ? error.message : String(error);
  const timedOut = /timeout|ETIMEDOUT|ECONNABORTED/i.test(message);
  return normalizedError("network_error", `${providerId}:transport:${timedOut ? "timeout" : "unreachable"}`, {
    userMessage: timedOut
      ? "The provider did not answer in time. This is usually temporary."
      : "The provider could not be reached from this machine. Check the network and try again.",
  });
}

// ------------------------------------------------- test connection contract

export type ConnectionTestResult = {
  success: boolean;
  provider: string;
  /** True only when a real customer account answered, not merely a valid key. */
  authenticated: boolean;
  /** What this connection can actually do right now. */
  capabilities: string[];
  latencyMs: number;
  /** Only when the provider returns a name that is safe to show. */
  accountName?: string;
  testedAt: string;
  errorCategory?: ProviderErrorCategory;
  /** Customer-facing sentence. Present on failure. */
  userMessage?: string;
  /** Short support code. Never a raw provider body or stack trace. */
  technicalCode?: string;
};

export function successfulTest(input: {
  provider: string;
  authenticated: boolean;
  capabilities?: string[];
  latencyMs: number;
  accountName?: string;
}): ConnectionTestResult {
  return {
    success: true,
    provider: input.provider,
    authenticated: input.authenticated,
    capabilities: input.capabilities || [],
    latencyMs: input.latencyMs,
    accountName: input.accountName,
    testedAt: new Date().toISOString(),
  };
}

export function failedTest(input: {
  provider: string;
  latencyMs: number;
  error: NormalizedProviderError;
  authenticated?: boolean;
}): ConnectionTestResult {
  return {
    success: false,
    provider: input.provider,
    authenticated: input.authenticated ?? false,
    capabilities: [],
    latencyMs: input.latencyMs,
    testedAt: new Date().toISOString(),
    errorCategory: input.error.category,
    userMessage: input.error.userMessage,
    technicalCode: input.error.technicalCode,
  };
}
