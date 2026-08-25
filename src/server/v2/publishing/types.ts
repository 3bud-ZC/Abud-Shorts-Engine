import { z } from "zod";

export const publishingPlatforms = [
  "youtube",
  "tiktok",
  "instagram",
  "facebook",
  "linkedin",
  "twitter",
  "threads",
  "telegram",
] as const;
export type PublishingPlatform = (typeof publishingPlatforms)[number];
export const publishingPlatformSchema = z.enum(publishingPlatforms);

export const publishingStatuses = [
  "draft",
  "scheduled",
  "queued",
  "uploading",
  "processing",
  "published",
  "failed",
  "canceled",
] as const;
export type PublishingStatus = (typeof publishingStatuses)[number];
export const publishingStatusSchema = z.enum(publishingStatuses);

export const overallDistributionStatuses = [
  "not_published",
  "scheduled",
  "publishing",
  "published",
  "partially_published",
  "failed",
] as const;
export type OverallDistributionStatus = (typeof overallDistributionStatuses)[number];

export const publishingProviders = [
  "upload_post",
  "telegram_bot",
  "youtube_direct",
  "meta_direct",
  "tiktok_direct",
  "test_provider",
] as const;
export type PublishingProviderId = (typeof publishingProviders)[number];

export const privacyEnum = z.enum(["private", "unlisted", "public"]);
export type PrivacySetting = z.infer<typeof privacyEnum>;

export type PlatformCapabilities = {
  platform: PublishingPlatform;
  displayName: string;
  maxDurationSeconds: number;
  minDurationSeconds: number;
  maxFileSizeMB: number;
  supportedAspectRatios: string[];
  supportedFormats: string[];
  supportsScheduling: boolean;
  supportsThumbnail: boolean;
  supportsPrivacy: boolean;
  privacyOptions: PrivacySetting[];
  titleMaxChars: number;
  captionMaxChars: number;
  descriptionMaxChars: number;
  hashtagsMaxCount: number;
  requiresAccount: boolean;
};

export type SocialAccountRecord = {
  id: string;
  platform: PublishingPlatform;
  accountName: string;
  accountId: string;
  provider: PublishingProviderId;
  connectionStatus: "connected" | "disconnected" | "expired" | "error";
  capabilities: Partial<PlatformCapabilities>;
  encryptedCredentials?: string;
  maskedToken?: string;
  lastCheckedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type PlatformMetadata = {
  title?: string;
  caption?: string;
  description?: string;
  hashtags?: string[];
  tags?: string[];
  privacy?: PrivacySetting;
  category?: string;
  telegramChatId?: string;
  customThumbnailUrl?: string;
  reelSettings?: {
    shareToFeed?: boolean;
    audioName?: string;
  };
  /** ISO timestamp for a platform-native scheduled release (YouTube publishAt). */
  publishAt?: string;
  /**
   * True when the production was generated with AI assistance. Surfaced to the
   * platforms that expose a declaration field, never assumed.
   */
  containsSyntheticMedia?: boolean;
  /** TikTok Direct Post options, all taken from the creator info query. */
  tiktok?: {
    privacyLevel?: string;
    disableComment?: boolean;
    disableDuet?: boolean;
    disableStitch?: boolean;
    brandContentToggle?: boolean;
    brandOrganicToggle?: boolean;
    /** "direct_post" publishes; "draft" sends it to the creator inbox. */
    mode?: "direct_post" | "draft";
  };
  /** Resolved Meta destination, chosen by the customer after discovery. */
  meta?: {
    pageId?: string;
    instagramUserId?: string;
  };
};

export type PublicationRecord = {
  id: string;
  videoId: string;
  platform: PublishingPlatform;
  accountId?: string;
  accountName?: string;
  status: PublishingStatus;
  title?: string;
  caption?: string;
  description?: string;
  hashtags: string[];
  metadata: PlatformMetadata;
  scheduledAt?: Date;
  publishedAt?: Date;
  sourceTimezone: string;
  provider: PublishingProviderId;
  providerPostId?: string;
  providerUrl?: string;
  attemptCount: number;
  lastError?: string;
  technicalError?: string;
  idempotencyKey?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ScheduledPublicationRecord = {
  id: string;
  publicationId: string;
  videoId: string;
  scheduledAt: Date;
  timezone: string;
  status: "pending" | "claimed" | "executed" | "canceled" | "failed";
  lockedAt?: Date;
  lockedBy?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type PublishingAttemptRecord = {
  id: string;
  publicationId: string;
  attemptNumber: number;
  status: "started" | "succeeded" | "failed";
  error?: string;
  technicalError?: string;
  providerResponse?: Record<string, unknown>;
  startedAt: Date;
  completedAt?: Date;
};

export type PublishingEventRecord = {
  id: string;
  publicationId: string;
  status: PublishingStatus;
  stage: string;
  message: string;
  technicalMessage?: string;
  payload?: Record<string, unknown>;
  createdAt: Date;
};

export type AutomationRuleRecord = {
  id: string;
  name: string;
  triggerEvent: "video_ready";
  action: "publish_immediate" | "schedule_next_day" | "draft_only";
  targetPlatforms: PublishingPlatform[];
  targetAccountIds: string[];
  defaultPrivacy: PrivacySetting;
  scheduleTimeOfDay?: string; // e.g. "18:00"
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

// Zod Request Schemas
export const createSocialAccountSchema = z.object({
  platform: publishingPlatformSchema,
  accountName: z.string().trim().min(1).max(120),
  accountId: z.string().trim().min(1).max(120),
  provider: z.enum(publishingProviders),
  credentials: z.record(z.any()).optional(),
  token: z.string().trim().min(1).optional(),
});

export const updateSocialAccountSchema = z.object({
  accountName: z.string().trim().min(1).max(120).optional(),
  connectionStatus: z.enum(["connected", "disconnected", "expired", "error"]).optional(),
  credentials: z.record(z.any()).optional(),
  token: z.string().trim().min(1).optional(),
});

export const platformMetadataSchema = z.object({
  title: z.string().trim().max(200).optional(),
  caption: z.string().trim().max(4000).optional(),
  description: z.string().trim().max(5000).optional(),
  hashtags: z.array(z.string().trim()).optional(),
  tags: z.array(z.string().trim()).optional(),
  privacy: privacyEnum.optional().default("unlisted"),
  category: z.string().trim().max(80).optional(),
  telegramChatId: z.string().trim().max(120).optional(),
  customThumbnailUrl: z.string().trim().max(500).optional(),
  reelSettings: z.object({
    shareToFeed: z.boolean().optional(),
    audioName: z.string().optional(),
  }).optional(),
  publishAt: z.string().trim().max(40).optional(),
  containsSyntheticMedia: z.boolean().optional(),
  tiktok: z.object({
    privacyLevel: z.string().trim().max(60).optional(),
    disableComment: z.boolean().optional(),
    disableDuet: z.boolean().optional(),
    disableStitch: z.boolean().optional(),
    brandContentToggle: z.boolean().optional(),
    brandOrganicToggle: z.boolean().optional(),
    mode: z.enum(["direct_post", "draft"]).optional(),
  }).optional(),
  meta: z.object({
    pageId: z.string().trim().max(80).optional(),
    instagramUserId: z.string().trim().max(80).optional(),
  }).optional(),
});

export const createPublicationSchema = z.object({
  videoId: z.string().trim().min(1),
  platform: publishingPlatformSchema,
  accountId: z.string().trim().min(1).optional(),
  title: z.string().trim().max(200).optional(),
  caption: z.string().trim().max(4000).optional(),
  description: z.string().trim().max(5000).optional(),
  hashtags: z.array(z.string().trim()).optional().default([]),
  metadata: platformMetadataSchema.optional().default({}),
  scheduledAt: z.string().datetime({ offset: true }).or(z.string()).nullable().optional(),
  sourceTimezone: z.string().trim().min(1).default("UTC"),
  provider: z.enum(publishingProviders).optional(),
  idempotencyKey: z.string().trim().max(128).optional(),
  publishNow: z.boolean().optional().default(false),
});

export const batchPublicationSchema = z.object({
  videoIds: z.array(z.string().trim().min(1)).min(1).max(20),
  platforms: z.array(publishingPlatformSchema).min(1),
  accountIds: z.array(z.string().trim().min(1)).optional(),
  scheduledAt: z.string().datetime({ offset: true }).or(z.string()).nullable().optional(),
  sourceTimezone: z.string().trim().min(1).default("UTC"),
  privacy: privacyEnum.optional().default("unlisted"),
  publishNow: z.boolean().optional().default(false),
});

export const generatePlatformMetadataRequestSchema = z.object({
  videoId: z.string().trim().min(1).optional(),
  prompt: z.string().trim().optional(),
  title: z.string().trim().optional(),
  narrationLines: z.array(z.string().trim()).optional(),
  brandName: z.string().trim().optional(),
  ctaText: z.string().trim().optional(),
  platform: publishingPlatformSchema,
  language: z.string().trim().optional(),
});

export const validateVideoForPlatformSchema = z.object({
  videoId: z.string().trim().min(1),
  platform: publishingPlatformSchema,
});

export type CreateSocialAccountInput = z.infer<typeof createSocialAccountSchema>;
export type UpdateSocialAccountInput = z.infer<typeof updateSocialAccountSchema>;
export type CreatePublicationInput = z.infer<typeof createPublicationSchema>;
export type BatchPublicationInput = z.infer<typeof batchPublicationSchema>;
export type GeneratePlatformMetadataRequest = z.infer<typeof generatePlatformMetadataRequestSchema>;
export type ValidateVideoForPlatformInput = z.infer<typeof validateVideoForPlatformSchema>;

export type PublishingSummary = {
  scheduledCount: number;
  publishingCount: number;
  publishedTodayCount: number;
  failedCount: number;
  totalPublications: number;
};
