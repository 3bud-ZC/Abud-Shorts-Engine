import { z } from "zod";

/**
 * The canonical public URL of an installation.
 *
 * A local installation answers on http://localhost:3130; a VPS installation
 * answers on the customer's own domain over HTTPS. Everything that has to hand
 * an address to somebody else - most importantly the OAuth callback URLs the
 * customer pastes into Google, TikTok and Meta - derives it from here, so
 * moving an installation onto a domain never requires editing source.
 *
 * Resolution order, most specific first:
 *   1. the value the operator saved in Settings (stored in app_settings)
 *   2. V2_PUBLIC_URL from the installation's environment
 *   3. http://localhost:<host port>, which keeps a local install working
 */

export const canonicalPublicUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .superRefine((value, ctx) => {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter a full address, for example https://shorts.example.com",
      });
      return;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The address must start with http:// or https://",
      });
      return;
    }
    if (parsed.search || parsed.hash) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The address must not contain a query string or a fragment",
      });
    }
  });

/** Strips a trailing slash so callbacks never contain a double slash. */
export function normalizePublicUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed;
}

export interface PublicUrlSources {
  /** What the operator saved in Settings, if anything. */
  configured?: string | null;
  /** V2_PUBLIC_URL, set by the installer. */
  environment?: string | null;
  /** The port the installation is published on. */
  hostPort?: string | number | null;
}

export interface ResolvedPublicUrl {
  url: string;
  source: "configured" | "environment" | "default";
  isLocal: boolean;
  isSecure: boolean;
}

export function resolvePublicUrl(sources: PublicUrlSources): ResolvedPublicUrl {
  const candidates: Array<{ value?: string | null; source: ResolvedPublicUrl["source"] }> = [
    { value: sources.configured, source: "configured" },
    { value: sources.environment, source: "environment" },
  ];

  for (const candidate of candidates) {
    if (candidate.value && canonicalPublicUrlSchema.safeParse(candidate.value).success) {
      return describe(normalizePublicUrl(candidate.value), candidate.source);
    }
  }

  const port = sources.hostPort ? String(sources.hostPort) : "3130";
  return describe(`http://localhost:${port}`, "default");
}

function describe(url: string, source: ResolvedPublicUrl["source"]): ResolvedPublicUrl {
  const parsed = new URL(url);
  return {
    url,
    source,
    isLocal: parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1",
    isSecure: parsed.protocol === "https:",
  };
}

/**
 * The callback URL a customer registers with an OAuth provider. It is always
 * built from the canonical URL, so a customer who moves from localhost to a
 * domain sees the new value in Integrations without touching a file.
 */
export function oauthCallbackUrl(publicUrl: string, provider: string): string {
  return `${normalizePublicUrl(publicUrl)}/api/v2/integrations/providers/${provider}/oauth/callback`;
}

/** Providers whose OAuth callback URL the customer registers by hand. */
export const OAUTH_CALLBACK_PROVIDERS = ["youtube", "tiktok", "meta"] as const;

/**
 * The minimum this resolver needs, so it does not drag the whole DB class in
 * and create an import cycle with the route module. Rows come back untyped and
 * are narrowed below, because V2Database constrains its own row generic.
 */
interface SettingsReader {
  query: (sql: string, params?: unknown[]) => Promise<unknown[]>;
}

/**
 * The address this installation is published on: what the operator saved in
 * Settings first, then the installer's V2_PUBLIC_URL, then localhost.
 *
 * Lives here rather than in the route module so the OAuth router can reuse it
 * without the two modules importing each other.
 */
export async function resolveInstallationPublicUrl(
  db: SettingsReader,
  config: { port: number },
): Promise<ResolvedPublicUrl> {
  let configured: string | null = null;
  try {
    const rows = (await db.query(
      "SELECT key, value, updated_at FROM app_settings WHERE key = $1",
      ["dashboard"],
    )) as Array<{ value?: { canonicalPublicUrl?: string | null } }>;
    configured = rows[0]?.value?.canonicalPublicUrl ?? null;
  } catch {
    // A database that is not reachable must not stop the app describing itself.
  }
  return resolvePublicUrl({
    configured,
    environment: process.env.V2_PUBLIC_URL,
    hostPort: process.env.HOST_PORT || config.port,
  });
}

/**
 * A local address is fine for a workstation install but cannot receive a
 * provider callback from the internet. The UI surfaces this rather than letting
 * a customer register a callback that can never fire.
 */
export function publicUrlWarnings(resolved: ResolvedPublicUrl): string[] {
  const warnings: string[] = [];
  if (resolved.isLocal) {
    warnings.push(
      "This installation is published on a local address. Social accounts that " +
        "call back over the internet need a public address configured here first.",
    );
  } else if (!resolved.isSecure) {
    warnings.push(
      "This installation is published over http. Most social platforms require " +
        "an https callback address.",
    );
  }
  return warnings;
}
