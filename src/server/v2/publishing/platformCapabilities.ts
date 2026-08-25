import { PLATFORM_REQUIREMENTS, requirementsFor } from "./platformLimits";
import type { PlatformCapabilities, PrivacySetting, PublishingPlatform } from "./types";

/**
 * BRIDGE: SOURCED REQUIREMENTS -> LEGACY CAPABILITY SHAPE
 * ------------------------------------------------------
 * `PlatformCapabilities` is the shape the publishing service, the API and the
 * UI already speak. `PLATFORM_REQUIREMENTS` is the shape that carries where each
 * number came from and when it was checked.
 *
 * Deriving the first from the second means there is exactly one place to correct
 * when a platform changes its rules. The previous build kept the two ideas in
 * one hand-maintained table, which is how Telegram ended up advertising a 2000 MB
 * limit that the standard Bot API has never allowed.
 */

function toPrivacySettings(values: string[]): PrivacySetting[] {
  const allowed: PrivacySetting[] = [];
  if (values.includes("private")) allowed.push("private");
  if (values.includes("unlisted")) allowed.push("unlisted");
  if (values.includes("public")) allowed.push("public");
  return allowed;
}

export function capabilitiesFromRequirements(platform: PublishingPlatform): PlatformCapabilities {
  const requirements = requirementsFor(platform);
  const privacyOptions = toPrivacySettings(requirements.privacyOptions);

  return {
    platform,
    displayName: requirements.displayName,
    maxDurationSeconds: requirements.maxDurationSeconds,
    minDurationSeconds: requirements.minDurationSeconds,
    maxFileSizeMB: requirements.maxFileSizeMB,
    supportedAspectRatios: requirements.supportedAspectRatios,
    supportedFormats: requirements.supportedContainers,
    // Every platform ABUD Shorts publishes to can be scheduled by the engine's
    // own scheduler, whether or not the platform has a native scheduling field.
    supportsScheduling: true,
    supportsThumbnail: platform === "youtube" || platform === "facebook" || platform === "telegram",
    // An account-specific privacy model is still privacy support; the options
    // simply have to be fetched per creator rather than read from a table.
    supportsPrivacy: privacyOptions.length > 1 || requirements.privacyIsAccountSpecific,
    privacyOptions: privacyOptions.length > 0 ? privacyOptions : ["public"],
    titleMaxChars: requirements.titleMaxChars || requirements.captionMaxChars,
    captionMaxChars: requirements.captionMaxChars,
    descriptionMaxChars: requirements.captionMaxChars,
    hashtagsMaxCount: requirements.hashtagsMaxCount,
    requiresAccount: true,
  };
}

/**
 * The capability table the rest of the engine reads, now generated rather than
 * hand-written.
 */
export const DERIVED_PLATFORM_CAPABILITIES: Record<PublishingPlatform, PlatformCapabilities> =
  Object.fromEntries(
    (Object.keys(PLATFORM_REQUIREMENTS) as PublishingPlatform[]).map((platform) => [
      platform,
      capabilitiesFromRequirements(platform),
    ]),
  ) as Record<PublishingPlatform, PlatformCapabilities>;
