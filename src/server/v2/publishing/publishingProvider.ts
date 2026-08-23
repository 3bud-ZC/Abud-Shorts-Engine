import type {
  PlatformCapabilities,
  PlatformMetadata,
  PublishingPlatform,
  PublishingProviderId,
  SocialAccountRecord,
} from "./types";

export type { PlatformCapabilities };

export const DEFAULT_PLATFORM_CAPABILITIES: Record<PublishingPlatform, PlatformCapabilities> = {
  youtube: {
    platform: "youtube",
    displayName: "YouTube Shorts",
    maxDurationSeconds: 60,
    minDurationSeconds: 3,
    maxFileSizeMB: 256,
    supportedAspectRatios: ["9:16", "16:9", "1:1"],
    supportedFormats: ["mp4", "mov"],
    supportsScheduling: true,
    supportsThumbnail: true,
    supportsPrivacy: true,
    privacyOptions: ["unlisted", "private", "public"],
    titleMaxChars: 100,
    captionMaxChars: 5000,
    descriptionMaxChars: 5000,
    hashtagsMaxCount: 15,
    requiresAccount: true,
  },
  tiktok: {
    platform: "tiktok",
    displayName: "TikTok",
    maxDurationSeconds: 600,
    minDurationSeconds: 3,
    maxFileSizeMB: 287,
    supportedAspectRatios: ["9:16", "1:1"],
    supportedFormats: ["mp4", "mov", "webm"],
    supportsScheduling: true,
    supportsThumbnail: false,
    supportsPrivacy: false,
    privacyOptions: ["public"],
    titleMaxChars: 150,
    captionMaxChars: 2200,
    descriptionMaxChars: 2200,
    hashtagsMaxCount: 10,
    requiresAccount: true,
  },
  instagram: {
    platform: "instagram",
    displayName: "Instagram Reels",
    maxDurationSeconds: 90,
    minDurationSeconds: 3,
    maxFileSizeMB: 100,
    supportedAspectRatios: ["9:16", "1:1"],
    supportedFormats: ["mp4", "mov"],
    supportsScheduling: true,
    supportsThumbnail: true,
    supportsPrivacy: false,
    privacyOptions: ["public"],
    titleMaxChars: 120,
    captionMaxChars: 2200,
    descriptionMaxChars: 2200,
    hashtagsMaxCount: 30,
    requiresAccount: true,
  },
  facebook: {
    platform: "facebook",
    displayName: "Facebook Reels",
    maxDurationSeconds: 600,
    minDurationSeconds: 3,
    maxFileSizeMB: 500,
    supportedAspectRatios: ["9:16", "16:9", "1:1"],
    supportedFormats: ["mp4", "mov"],
    supportsScheduling: true,
    supportsThumbnail: true,
    supportsPrivacy: true,
    privacyOptions: ["public", "private"],
    titleMaxChars: 150,
    captionMaxChars: 5000,
    descriptionMaxChars: 5000,
    hashtagsMaxCount: 15,
    requiresAccount: true,
  },
  linkedin: {
    platform: "linkedin",
    displayName: "LinkedIn Video",
    maxDurationSeconds: 600,
    minDurationSeconds: 3,
    maxFileSizeMB: 500,
    supportedAspectRatios: ["16:9", "1:1", "9:16"],
    supportedFormats: ["mp4"],
    supportsScheduling: true,
    supportsThumbnail: true,
    supportsPrivacy: false,
    privacyOptions: ["public"],
    titleMaxChars: 140,
    captionMaxChars: 3000,
    descriptionMaxChars: 3000,
    hashtagsMaxCount: 10,
    requiresAccount: true,
  },
  twitter: {
    platform: "twitter",
    displayName: "X / Twitter",
    maxDurationSeconds: 140,
    minDurationSeconds: 1,
    maxFileSizeMB: 512,
    supportedAspectRatios: ["16:9", "9:16", "1:1"],
    supportedFormats: ["mp4", "mov"],
    supportsScheduling: true,
    supportsThumbnail: false,
    supportsPrivacy: false,
    privacyOptions: ["public"],
    titleMaxChars: 100,
    captionMaxChars: 280,
    descriptionMaxChars: 280,
    hashtagsMaxCount: 5,
    requiresAccount: true,
  },
  threads: {
    platform: "threads",
    displayName: "Threads",
    maxDurationSeconds: 300,
    minDurationSeconds: 1,
    maxFileSizeMB: 100,
    supportedAspectRatios: ["9:16", "1:1", "16:9"],
    supportedFormats: ["mp4", "mov"],
    supportsScheduling: false,
    supportsThumbnail: false,
    supportsPrivacy: false,
    privacyOptions: ["public"],
    titleMaxChars: 100,
    captionMaxChars: 500,
    descriptionMaxChars: 500,
    hashtagsMaxCount: 5,
    requiresAccount: true,
  },
  telegram: {
    platform: "telegram",
    displayName: "Telegram Channel / Chat",
    maxDurationSeconds: 3600,
    minDurationSeconds: 1,
    maxFileSizeMB: 2000,
    supportedAspectRatios: ["9:16", "16:9", "1:1"],
    supportedFormats: ["mp4", "mov", "webm"],
    supportsScheduling: false,
    supportsThumbnail: true,
    supportsPrivacy: false,
    privacyOptions: ["public"],
    titleMaxChars: 120,
    captionMaxChars: 1024,
    descriptionMaxChars: 1024,
    hashtagsMaxCount: 10,
    requiresAccount: true,
  },
};

export type PublishVideoParams = {
  publicationId: string;
  videoId: string;
  videoFilePath: string;
  videoUrl: string;
  thumbnailFilePath?: string;
  thumbnailUrl?: string;
  platform: PublishingPlatform;
  account?: SocialAccountRecord;
  title?: string;
  caption?: string;
  description?: string;
  hashtags?: string[];
  metadata?: PlatformMetadata;
  idempotencyKey?: string;
};

export type ScheduleVideoParams = PublishVideoParams & {
  scheduledAt: Date;
  sourceTimezone: string;
};

export type PublishResult = {
  success: boolean;
  providerPostId?: string;
  providerUrl?: string;
  status: "published" | "scheduled" | "processing" | "failed";
  message?: string;
  error?: string;
  technicalError?: string;
  rawResponse?: Record<string, unknown>;
  retryable?: boolean;
};

export type PublishStatusResult = {
  status: "processing" | "published" | "failed";
  providerPostId: string;
  providerUrl?: string;
  progressPercent?: number;
  message?: string;
  error?: string;
  rawResponse?: Record<string, unknown>;
};

export type PublishingValidationResult = {
  provider: string;
  platform?: PublishingPlatform;
  configured: boolean;
  healthy: boolean;
  status: "healthy" | "not_configured" | "invalid_credentials" | "rate_limited" | "timeout" | "provider_unavailable";
  message: string;
  accountDetails?: {
    accountName?: string;
    accountId?: string;
    avatarUrl?: string;
    channelTitle?: string;
  };
  checkedAt: string;
  latencyMs?: number;
};

export interface PublishingProvider {
  readonly id: PublishingProviderId;
  readonly displayName: string;
  readonly category: "publishing";

  getSupportedPlatforms(): PublishingPlatform[];
  getCapabilities(platform: PublishingPlatform): PlatformCapabilities;

  validateConnection(
    credentials?: Record<string, unknown>,
    accountId?: string,
  ): Promise<PublishingValidationResult>;

  publishVideo(params: PublishVideoParams): Promise<PublishResult>;
  scheduleVideo(params: ScheduleVideoParams): Promise<PublishResult>;

  getStatus(providerPostId: string, context?: Record<string, unknown>): Promise<PublishStatusResult>;
  cancel(providerPostId: string, context?: Record<string, unknown>): Promise<boolean>;

  getPublishedUrl(providerPostId: string, data?: Record<string, unknown>): string | undefined;
}
