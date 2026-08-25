import { describe, expect, it } from "vitest";

import {
  canonicalPublicUrlSchema,
  normalizePublicUrl,
  oauthCallbackUrl,
  publicUrlWarnings,
  resolveInstallationPublicUrl,
  resolvePublicUrl,
  OAUTH_CALLBACK_PROVIDERS,
} from "./publicUrl";
import { effectiveRequestOrigin, resolveTrustedProxy } from "./trustedProxy";
import {
  MIGRATIONS,
  SCHEMA_BACKWARDS_COMPATIBLE,
  getLatestMigrationVersion,
} from "../migrations/migrationRunner";
import { DATABASE_SCHEMA_VERSION } from "../../../version";
import { compareVersions } from "../updates/semver";

describe("F4 - canonical public URL", () => {
  it("keeps a local installation on localhost when nothing is configured", () => {
    const resolved = resolvePublicUrl({ hostPort: 3130 });
    expect(resolved.url).toBe("http://localhost:3130");
    expect(resolved.source).toBe("default");
    expect(resolved.isLocal).toBe(true);
  });

  it("prefers the operator's saved address over the installer's environment", () => {
    const resolved = resolvePublicUrl({
      configured: "https://shorts.example.com",
      environment: "http://localhost:3130",
      hostPort: 3130,
    });
    expect(resolved.url).toBe("https://shorts.example.com");
    expect(resolved.source).toBe("configured");
    expect(resolved.isLocal).toBe(false);
    expect(resolved.isSecure).toBe(true);
  });

  it("falls back to the installer's environment when nothing is saved", () => {
    const resolved = resolvePublicUrl({
      environment: "https://vps.example.com",
      hostPort: 3130,
    });
    expect(resolved.url).toBe("https://vps.example.com");
    expect(resolved.source).toBe("environment");
  });

  it("ignores an invalid configured address rather than serving a broken one", () => {
    const resolved = resolvePublicUrl({
      configured: "not a url",
      environment: "https://vps.example.com",
      hostPort: 3130,
    });
    expect(resolved.url).toBe("https://vps.example.com");
  });

  it("validates what an operator may save", () => {
    expect(canonicalPublicUrlSchema.safeParse("https://shorts.example.com").success).toBe(true);
    expect(canonicalPublicUrlSchema.safeParse("http://localhost:3130").success).toBe(true);
    expect(canonicalPublicUrlSchema.safeParse("shorts.example.com").success).toBe(false);
    expect(canonicalPublicUrlSchema.safeParse("ftp://shorts.example.com").success).toBe(false);
    expect(canonicalPublicUrlSchema.safeParse("https://x.example.com/?a=b").success).toBe(false);
  });

  it("strips a trailing slash so callbacks never double up", () => {
    expect(normalizePublicUrl("https://shorts.example.com/")).toBe("https://shorts.example.com");
    expect(oauthCallbackUrl("https://shorts.example.com/", "youtube")).toBe(
      "https://shorts.example.com/api/v2/integrations/providers/youtube/oauth/callback",
    );
  });

  it("derives every OAuth callback URL from the canonical address", () => {
    for (const provider of OAUTH_CALLBACK_PROVIDERS) {
      const local = oauthCallbackUrl("http://localhost:3130", provider);
      const online = oauthCallbackUrl("https://shorts.example.com", provider);
      expect(local).toContain("http://localhost:3130/");
      expect(online).toContain("https://shorts.example.com/");
      // Same path, different origin: moving to a domain is configuration, not
      // a source change.
      expect(local.replace("http://localhost:3130", "")).toBe(
        online.replace("https://shorts.example.com", ""),
      );
    }
  });

  it("warns that a local address cannot receive a callback from the internet", () => {
    const local = publicUrlWarnings(resolvePublicUrl({ hostPort: 3130 }));
    expect(local.join(" ")).toMatch(/local address/i);

    const insecure = publicUrlWarnings(
      resolvePublicUrl({ configured: "http://shorts.example.com" }),
    );
    expect(insecure.join(" ")).toMatch(/https/i);

    const secure = publicUrlWarnings(
      resolvePublicUrl({ configured: "https://shorts.example.com" }),
    );
    expect(secure).toEqual([]);
  });

  it("reads the saved address from app settings without a live database", async () => {
    const resolved = await resolveInstallationPublicUrl(
      {
        query: async () => [{ value: { canonicalPublicUrl: "https://saved.example.com" } }],
      },
      { port: 3123 },
    );
    expect(resolved.url).toBe("https://saved.example.com");
    expect(resolved.source).toBe("configured");
  });

  it("still describes itself when the database is unreachable", async () => {
    const resolved = await resolveInstallationPublicUrl(
      {
        query: async () => {
          throw new Error("database is down");
        },
      },
      { port: 3123 },
    );
    expect(resolved.url).toMatch(/^http/);
  });
});

describe("F4 - trusted proxy handling", () => {
  it("ignores forwarded headers by default", () => {
    const config = resolveTrustedProxy(undefined);
    expect(config.enabled).toBe(false);
    expect(config.expressSetting).toBe(false);
  });

  it("treats explicit off values as off", () => {
    for (const value of ["", "false", "0", "off"]) {
      expect(resolveTrustedProxy(value).enabled).toBe(false);
    }
  });

  it("accepts a hop count and the common single-proxy case", () => {
    expect(resolveTrustedProxy("true").expressSetting).toBe(1);
    expect(resolveTrustedProxy("1").expressSetting).toBe(1);
    expect(resolveTrustedProxy("2").expressSetting).toBe(2);
  });

  it("accepts explicit proxy addresses", () => {
    const config = resolveTrustedProxy("10.0.0.1, 172.16.0.0/12");
    expect(config.enabled).toBe(true);
    expect(config.expressSetting).toEqual(["10.0.0.1", "172.16.0.0/12"]);
  });

  it("refuses to trust everything when the value cannot be understood", () => {
    // The failure mode that matters: a typo must not silently become
    // "believe every X-Forwarded-* header any client sends".
    const config = resolveTrustedProxy("yes-please");
    expect(config.enabled).toBe(false);
    expect(config.expressSetting).toBe(false);
    expect(config.description).toMatch(/could not be understood/i);
  });

  it("does not believe a spoofed protocol when no proxy is configured", () => {
    const config = resolveTrustedProxy(undefined);
    const origin = effectiveRequestOrigin(config, {
      // Express would still report http here, but an attacker controls the
      // headers; the connection does not lie.
      protocol: "http",
      get: (header: string) =>
        ({ host: "shorts.example.com", "x-forwarded-host": "evil.example.com" })[
          header.toLowerCase()
        ],
      socket: { encrypted: false },
    });
    expect(origin.protocol).toBe("http");
    expect(origin.host).toBe("shorts.example.com");
  });

  it("honours the vetted forwarded values once a proxy is declared", () => {
    const config = resolveTrustedProxy("1");
    const origin = effectiveRequestOrigin(config, {
      // Express populates req.protocol from the header only after validating
      // the hop against `trust proxy`.
      protocol: "https",
      get: (header: string) =>
        ({ host: "127.0.0.1:3130", "x-forwarded-host": "shorts.example.com" })[
          header.toLowerCase()
        ],
    });
    expect(origin.protocol).toBe("https");
    expect(origin.host).toBe("shorts.example.com");
  });
});

describe("F4 - schema and rollback policy", () => {
  it("declares the schema version the migrations actually reach", () => {
    // A stale constant would make the updater report a schema it never
    // applied, and a correct update would look like a failed one.
    expect(getLatestMigrationVersion()).toBe(DATABASE_SCHEMA_VERSION);
  });

  it("keeps the migration list in ascending order", () => {
    for (let i = 1; i < MIGRATIONS.length; i += 1) {
      expect(compareVersions(MIGRATIONS[i].version, MIGRATIONS[i - 1].version)).toBe(1);
    }
  });

  it("gives every migration a unique version", () => {
    const versions = MIGRATIONS.map((migration) => migration.version);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it("declares this build's migrations backwards compatible, and means it", () => {
    expect(SCHEMA_BACKWARDS_COMPATIBLE).toBe(true);

    // The claim is only honest if the newest migrations really are additive.
    // A DROP COLUMN, a type change or a NOT NULL added to an existing column
    // would make an N-1 application unable to run, and the manifest would then
    // have to say schemaBackwardsCompatible: false.
    const recent = MIGRATIONS.slice(-2).map((migration) => migration.up.toString());
    for (const source of recent) {
      expect(source).not.toMatch(/DROP\s+COLUMN/i);
      expect(source).not.toMatch(/DROP\s+TABLE/i);
      expect(source).not.toMatch(/ALTER\s+COLUMN\s+\w+\s+SET\s+NOT\s+NULL/i);
      expect(source).not.toMatch(/ALTER\s+COLUMN\s+\w+\s+TYPE/i);
    }
  });
});
