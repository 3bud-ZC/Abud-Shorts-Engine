/**
 * The identity of this build. The updater compares the version here against the
 * version in a published release manifest, so it must always describe the code
 * that is actually running - not the newest version that exists.
 */
export const PRODUCT_NAME = "ABUD Shorts Engine V2";
export const PRODUCT_VERSION = "2.3.1";
export const PRODUCT_STAGE = "General Availability";
export const PRODUCT_BUILD = "2026.08.28.1";
/**
 * The highest migration in `MIGRATIONS`. `verifySchemaVersion()` in the
 * migration runner fails the build if the two drift apart: a stale constant here
 * makes the updater report a schema it never actually applied.
 */
export const DATABASE_SCHEMA_VERSION = "2.13.0";

/** Release channels a client installation may follow. Clients default to stable. */
export type ReleaseChannel = "stable" | "development";

export const DEFAULT_RELEASE_CHANNEL: ReleaseChannel = "stable";

export function isReleaseChannel(value: unknown): value is ReleaseChannel {
  return value === "stable" || value === "development";
}

/**
 * The channel this installation follows. An installation only leaves `stable`
 * when the operator sets ABUD_RELEASE_CHANNEL explicitly, so a client is never
 * moved onto a development build by a default.
 */
export function getReleaseChannel(): ReleaseChannel {
  const configured = (process.env.ABUD_RELEASE_CHANNEL || "").trim().toLowerCase();
  return isReleaseChannel(configured) ? configured : DEFAULT_RELEASE_CHANNEL;
}

export function getProductInfo() {
  return {
    name: PRODUCT_NAME,
    version: PRODUCT_VERSION,
    stage: PRODUCT_STAGE,
    build: PRODUCT_BUILD,
    schemaVersion: DATABASE_SCHEMA_VERSION,
    releaseChannel: getReleaseChannel(),
    canonicalUrl: getCanonicalPublicUrl(),
    docsUrl: "https://github.com/3bud-ZC/Abud-Shorts-Engine",
  };
}

/**
 * The address customers reach this installation on. A VPS install serves a real
 * domain, so localhost is only the fallback for an installation that never
 * configured one.
 */
export function getCanonicalPublicUrl(): string {
  const configured = (process.env.V2_PUBLIC_URL || "").trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  const port = process.env.HOST_PORT || process.env.PORT || "3130";
  return `http://localhost:${port}`;
}
