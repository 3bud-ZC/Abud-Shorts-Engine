import { z } from "zod";
import { isValidVersion } from "./semver";

/**
 * The release manifest is the only thing an installation trusts when deciding
 * what to install. It is published as an asset on a versioned GitHub Release;
 * nothing reads a branch, a tag ref or a source tree.
 *
 * Every field an updater acts on is validated here, so a truncated download, a
 * hand-edited file or an unrelated JSON document is rejected before any
 * container is stopped.
 */

const semverString = z
  .string()
  .refine((value) => isValidVersion(value), { message: "Not a valid semantic version" });

const sha256String = z
  .string()
  .regex(/^[a-f0-9]{64}$/i, "Expected a 64-character hex SHA-256 digest");

const imageDigestString = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/i, "Expected a sha256:<hex> image digest");

const httpsUrl = z
  .string()
  .url()
  .refine((value) => value.startsWith("https://"), {
    message: "Release artifacts must be served over HTTPS",
  });

export const releaseEntrySchema = z.object({
  product: z.literal("ABUD Shorts Engine"),
  channel: z.enum(["stable", "development"]),
  version: semverString,
  schemaVersion: semverString,
  publishedAt: z.string().datetime({ offset: true }),
  releaseUrl: z.string().url(),
  releaseNotesUrl: z.string().url().optional(),
  /** Immutable image reference, e.g. ghcr.io/owner/app:2.2.0 */
  image: z.string().min(1),
  imageDigest: imageDigestString,
  /** The client package (installer + updater + compose), not source code. */
  packageUrl: z.string().url(),
  packageSha256: sha256String,
  /** Oldest installed version whose updater understands this release. */
  minimumUpdaterVersion: semverString,
  requiresRestart: z.boolean(),
  /**
   * False when the release contains a migration that an older application
   * cannot run against. Code rollback alone is not enough in that case, so the
   * updater must restore the pre-upgrade database backup instead.
   */
  schemaBackwardsCompatible: z.boolean(),
  /** Present only once F5 actually signs a release. Never assumed. */
  signature: z
    .object({
      algorithm: z.literal("ed25519"),
      publicKeyId: z.string().min(1),
      value: z.string().min(1),
    })
    .optional(),
});

export type ReleaseEntry = z.infer<typeof releaseEntrySchema>;

/**
 * A manifest document may carry either a single release or a channel map. Both
 * shapes are accepted so the same file can serve a stable-only rollout today and
 * a two-channel rollout later without a format break.
 */
export const updateManifestSchema = z.union([
  releaseEntrySchema,
  z.object({
    product: z.literal("ABUD Shorts Engine"),
    manifestVersion: z.literal(1),
    channels: z.record(z.enum(["stable", "development"]), releaseEntrySchema),
  }),
]);

export type UpdateManifest = z.infer<typeof updateManifestSchema>;

export interface ManifestValidationSuccess {
  ok: true;
  manifest: UpdateManifest;
}

export interface ManifestValidationFailure {
  ok: false;
  /** Client-safe reason. Never contains the raw document. */
  reason: string;
  issues: string[];
}

export type ManifestValidationResult = ManifestValidationSuccess | ManifestValidationFailure;

export function validateManifest(input: unknown): ManifestValidationResult {
  const parsed = updateManifestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "The update manifest is not in a format this installation recognises.",
      issues: parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`,
      ),
    };
  }
  return { ok: true, manifest: parsed.data };
}

/**
 * Pulls the release for one channel out of either manifest shape. A single-entry
 * manifest only answers for its own channel, so a stable client can never be
 * handed a development build by a manifest that simply forgot the channel map.
 */
export function selectRelease(
  manifest: UpdateManifest,
  channel: "stable" | "development",
): ReleaseEntry | null {
  if ("channels" in manifest) {
    return manifest.channels[channel] ?? null;
  }
  return manifest.channel === channel ? manifest : null;
}

/**
 * Guards against a manifest whose entry claims a channel other than the one it
 * was filed under - the case that would move a stable client onto a
 * development build.
 */
export function releaseMatchesChannel(
  release: ReleaseEntry,
  channel: "stable" | "development",
): boolean {
  return release.channel === channel;
}
