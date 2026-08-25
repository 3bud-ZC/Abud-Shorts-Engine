import type { PublishingPlatform } from "./types";

/**
 * PLATFORM REQUIREMENTS REGISTRY
 * ------------------------------
 * What each platform will actually accept, with a note on where the number came
 * from and when it was checked.
 *
 * The previous build carried one fixed capability table with no provenance, and
 * some of it was simply wrong in ways that produced avoidable failures:
 *
 *  - Telegram was recorded as accepting 2000 MB. The standard Bot API caps *bot*
 *    uploads at 50 MB; 2000 MB is only available to a self-hosted local Bot API
 *    server. Every larger video was uploaded and then rejected.
 *  - YouTube was recorded as 256 MB. The Data API limit is 256 GB, so the engine
 *    was refusing videos YouTube would have taken.
 *  - TikTok was recorded as having no privacy support and a single "public"
 *    option. TikTok returns the allowed values per creator from
 *    `/v2/post/publish/creator_info/query/`, and an unaudited client is
 *    restricted to private posts.
 *
 * Limits carry a `source` and `checkedOn` so the next person can tell a verified
 * number from a guess, and so a provider changing its rules does not require
 * rewriting publishing logic.
 */

export type LimitProvenance = {
  /** Official documentation URL the value was read from. */
  source: string;
  /** ISO date the value was last checked against that source. */
  checkedOn: string;
};

export type PlatformRequirements = {
  platform: PublishingPlatform;
  displayName: string;
  maxDurationSeconds: number;
  minDurationSeconds: number;
  maxFileSizeMB: number;
  supportedContainers: string[];
  /** Codecs the platform documents as accepted for this surface. */
  videoCodecs: string[];
  audioCodecs: string[];
  supportedAspectRatios: string[];
  requiresAudioTrack: boolean;
  titleMaxChars: number;
  captionMaxChars: number;
  hashtagsMaxCount: number;
  /**
   * Privacy values the platform accepts. Empty means the platform decides at
   * publish time and the engine must ask rather than assume - which is what
   * TikTok's creator info query is for.
   */
  privacyOptions: string[];
  /** True when the real options must be fetched per account before publishing. */
  privacyIsAccountSpecific: boolean;
  provenance: LimitProvenance;
  /** Anything the customer should know that is not a hard number. */
  notes?: string[];
};

const CHECKED = "2026-08-25";

export const PLATFORM_REQUIREMENTS: Record<PublishingPlatform, PlatformRequirements> = {
  youtube: {
    platform: "youtube",
    displayName: "YouTube Shorts",
    // Shorts are defined by the video being <= 3 minutes and vertical; the API
    // itself imposes no separate Shorts duration limit.
    maxDurationSeconds: 180,
    minDurationSeconds: 1,
    maxFileSizeMB: 256 * 1024,
    supportedContainers: ["mp4", "mov", "webm", "avi"],
    videoCodecs: ["h264", "hevc", "vp9", "av1"],
    audioCodecs: ["aac", "mp3", "opus"],
    supportedAspectRatios: ["9:16", "16:9", "1:1"],
    requiresAudioTrack: false,
    titleMaxChars: 100,
    captionMaxChars: 5000,
    hashtagsMaxCount: 15,
    privacyOptions: ["private", "unlisted", "public"],
    privacyIsAccountSpecific: false,
    provenance: {
      source: "https://developers.google.com/youtube/v3/docs/videos/insert",
      checkedOn: CHECKED,
    },
    notes: ["A vertical video of three minutes or less is published as a Short automatically."],
  },
  tiktok: {
    platform: "tiktok",
    displayName: "TikTok",
    // The real ceiling is per-creator and is returned by the creator info query;
    // this is the documented upper bound used only when that call is unavailable.
    maxDurationSeconds: 600,
    minDurationSeconds: 3,
    maxFileSizeMB: 4 * 1024,
    supportedContainers: ["mp4", "mov", "webm"],
    videoCodecs: ["h264", "hevc"],
    audioCodecs: ["aac"],
    supportedAspectRatios: ["9:16", "1:1", "16:9"],
    requiresAudioTrack: false,
    titleMaxChars: 2200,
    captionMaxChars: 2200,
    hashtagsMaxCount: 30,
    privacyOptions: [],
    privacyIsAccountSpecific: true,
    provenance: {
      source: "https://developers.tiktok.com/doc/content-posting-api-reference-direct-post/",
      checkedOn: CHECKED,
    },
    notes: [
      "The allowed privacy values and the maximum duration come from the creator, not from this table.",
      "An unaudited TikTok client can only create private posts.",
    ],
  },
  instagram: {
    platform: "instagram",
    displayName: "Instagram Reels",
    maxDurationSeconds: 900,
    minDurationSeconds: 3,
    maxFileSizeMB: 1024,
    supportedContainers: ["mp4", "mov"],
    videoCodecs: ["h264", "hevc"],
    audioCodecs: ["aac"],
    supportedAspectRatios: ["9:16"],
    requiresAudioTrack: true,
    titleMaxChars: 0,
    captionMaxChars: 2200,
    hashtagsMaxCount: 30,
    privacyOptions: ["public"],
    privacyIsAccountSpecific: false,
    provenance: {
      source: "https://developers.facebook.com/docs/instagram-platform/content-publishing",
      checkedOn: CHECKED,
    },
    notes: ["Only Instagram Business and Creator accounts can publish through the API."],
  },
  facebook: {
    platform: "facebook",
    displayName: "Facebook Reels",
    maxDurationSeconds: 90,
    minDurationSeconds: 3,
    maxFileSizeMB: 1024,
    supportedContainers: ["mp4", "mov"],
    videoCodecs: ["h264", "hevc"],
    audioCodecs: ["aac"],
    supportedAspectRatios: ["9:16"],
    requiresAudioTrack: false,
    titleMaxChars: 255,
    captionMaxChars: 5000,
    hashtagsMaxCount: 15,
    privacyOptions: ["public"],
    privacyIsAccountSpecific: false,
    provenance: {
      source: "https://developers.facebook.com/docs/video-api/guides/reels-publishing",
      checkedOn: CHECKED,
    },
    notes: ["Reels are published to a Facebook Page, not to a personal profile."],
  },
  telegram: {
    platform: "telegram",
    displayName: "Telegram Channel / Chat",
    maxDurationSeconds: 3600,
    minDurationSeconds: 1,
    // The Bot API caps bot uploads at 50 MB unless a local Bot API server is
    // used. Recording 2000 MB here is what let oversized videos reach the wire.
    maxFileSizeMB: 50,
    supportedContainers: ["mp4", "mov", "webm"],
    videoCodecs: ["h264", "hevc", "vp9"],
    audioCodecs: ["aac", "opus", "mp3"],
    supportedAspectRatios: ["9:16", "16:9", "1:1"],
    requiresAudioTrack: false,
    titleMaxChars: 0,
    captionMaxChars: 1024,
    hashtagsMaxCount: 10,
    privacyOptions: ["public"],
    privacyIsAccountSpecific: false,
    provenance: {
      source: "https://core.telegram.org/bots/api#sendvideo",
      checkedOn: CHECKED,
    },
    notes: ["A self-hosted local Bot API server raises the upload limit; the standard servers do not."],
  },
  linkedin: {
    platform: "linkedin",
    displayName: "LinkedIn Video",
    maxDurationSeconds: 600,
    minDurationSeconds: 3,
    maxFileSizeMB: 500,
    supportedContainers: ["mp4"],
    videoCodecs: ["h264"],
    audioCodecs: ["aac"],
    supportedAspectRatios: ["16:9", "1:1", "9:16"],
    requiresAudioTrack: false,
    titleMaxChars: 140,
    captionMaxChars: 3000,
    hashtagsMaxCount: 10,
    privacyOptions: ["public"],
    privacyIsAccountSpecific: false,
    provenance: {
      source: "https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api",
      checkedOn: CHECKED,
    },
    notes: ["Reached through the Upload-Post aggregator; ABUD Shorts has no direct LinkedIn adapter."],
  },
  twitter: {
    platform: "twitter",
    displayName: "X / Twitter",
    maxDurationSeconds: 140,
    minDurationSeconds: 1,
    maxFileSizeMB: 512,
    supportedContainers: ["mp4", "mov"],
    videoCodecs: ["h264"],
    audioCodecs: ["aac"],
    supportedAspectRatios: ["16:9", "9:16", "1:1"],
    requiresAudioTrack: false,
    titleMaxChars: 0,
    captionMaxChars: 280,
    hashtagsMaxCount: 5,
    privacyOptions: ["public"],
    privacyIsAccountSpecific: false,
    provenance: {
      source: "https://docs.x.com/x-api/media/quickstart/media-upload-chunked",
      checkedOn: CHECKED,
    },
    notes: ["Reached through the Upload-Post aggregator; ABUD Shorts has no direct X adapter."],
  },
  threads: {
    platform: "threads",
    displayName: "Threads",
    maxDurationSeconds: 300,
    minDurationSeconds: 1,
    maxFileSizeMB: 1024,
    supportedContainers: ["mp4", "mov"],
    videoCodecs: ["h264", "hevc"],
    audioCodecs: ["aac"],
    supportedAspectRatios: ["9:16", "1:1", "16:9"],
    requiresAudioTrack: false,
    titleMaxChars: 0,
    captionMaxChars: 500,
    hashtagsMaxCount: 5,
    privacyOptions: ["public"],
    privacyIsAccountSpecific: false,
    provenance: {
      source: "https://developers.facebook.com/docs/threads/posts",
      checkedOn: CHECKED,
    },
    notes: ["Reached through the Upload-Post aggregator; ABUD Shorts has no direct Threads adapter."],
  },
};

export function requirementsFor(platform: PublishingPlatform): PlatformRequirements {
  return PLATFORM_REQUIREMENTS[platform] || PLATFORM_REQUIREMENTS.youtube;
}

/**
 * Overlays the values a provider reported for this specific account on top of
 * the documented defaults.
 *
 * This is what keeps TikTok honest: when the creator info query says the account
 * may post at most 60 seconds and offers three privacy levels, those are the
 * numbers used, not the table above.
 */
export function withAccountOverrides(
  base: PlatformRequirements,
  overrides: {
    maxDurationSeconds?: number;
    privacyOptions?: string[];
  },
): PlatformRequirements {
  return {
    ...base,
    maxDurationSeconds:
      typeof overrides.maxDurationSeconds === "number" && overrides.maxDurationSeconds > 0
        ? overrides.maxDurationSeconds
        : base.maxDurationSeconds,
    privacyOptions:
      overrides.privacyOptions && overrides.privacyOptions.length > 0
        ? overrides.privacyOptions
        : base.privacyOptions,
  };
}
