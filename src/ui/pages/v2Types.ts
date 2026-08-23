export type V2Job = {
  id: string;
  type: "video";
  status: string;
  progress: number;
  currentStage: string;
  title?: string;
  creationMode?: "prompt" | "template";
  originalPrompt?: string;
  productionSpec?: any;
  aiProvider?: string;
  aiModel?: string;
  visualMode?: string;
  visualProvidersUsed?: string[];
  voiceProvider?: string;
  qualityProfile?: string;
  resolution?: string;
  aspectRatio?: string;
  language?: string;
  dialect?: string;
  costEstimate?: any;
  templateId?: string;
  brandName?: string;
  input?: any;
  output?: any;
  error?: string;
  technicalError?: string;
  stageTimings?: Record<string, number>;
  checkpoint?: Record<string, any>;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
};

export type V2JobEvent = {
  id: number;
  jobId: string;
  status: string;
  progress: number;
  stage: string;
  message: string;
  technicalMessage?: string;
  createdAt: string;
};

export type V2HealthComponent = {
  name: string;
  status: "healthy" | "degraded" | "unhealthy";
  message: string;
  checkedAt: string;
  latencyMs?: number;
  details?: Record<string, unknown>;
};

export type BusinessTemplateField = {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "select";
  required: boolean;
  placeholder?: string;
  helperText?: string;
  options?: string[];
};

export type BusinessTemplateOption = {
  id: string;
  displayName: string;
  description: string;
  targetUseCase: string;
  defaultTone?: string;
  suggestedDurationSeconds?: number;
  recommendedSceneCount?: number;
  targetDurationSeconds?: number;
  hookStyle: string;
  ctaStyle: string;
  examplePrompt: string;
  pexelsSearchHints: string[];
  fallbackPexelsSearchHints?: string[];
  qualityChecklist?: string[];
  fields: BusinessTemplateField[];
};

export type V2Brand = {
  id: string;
  name: string;
  watermarkText?: string;
  primaryColor?: string;
  accentColor?: string;
  captionStyle?: "none" | "clean" | "bold" | "minimal";
  includeOutro?: boolean;
  outroText?: string;
  contactText?: string;
  voiceProfile?: {
    provider?: "auto" | "kokoro" | "piper" | "google_cloud_tts" | "elevenlabs";
    voiceId?: string;
    dialect?: string;
    style?: string;
    pace?: string;
    pronunciationDictionary?: Record<string, string>;
  };
  isDefault?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type VideoItem = {
  videoId: string;
  filename: string;
  status: string;
  sizeBytes: number;
  createdAt: string;
  downloadUrl: string;
  previewUrl: string;
  creationMode?: "prompt" | "template";
  originalPrompt?: string;
  language?: string;
  dialect?: string;
  quality?: string;
  resolution?: string;
  aspectRatio?: string;
  visualMode?: string;
  aiProvider?: string;
  visualProvidersUsed?: string[];
  voiceProvider?: string;
  voiceProvidersUsed?: string[];
  voiceArtifacts?: any[];
  durableArtifacts?: any[];
  artifactReuse?: any;
  audioQa?: any;
  validationResult?: any;
  mediaPlan?: any;
  selectedVisuals?: any[];
  sceneQa?: any[];
  qualityScoreV2?: any;
  stageTimings?: Record<string, number>;
  captionProfileUsed?: string;
  musicTrack?: string;
  musicMood?: string;
  motionPresetsUsed?: string[];
  transitionPresetsUsed?: string[];
  mediaSegmentCount?: number;
  technicalScore?: number;
  mediaPlanScore?: number;
  overallProductionScore?: number;
  requestedDurationSeconds?: number;
  durationVarianceSeconds?: number;
  durationVariancePercent?: number;
  costEstimate?: any;
  productionSpec?: any;
  templateId?: string;
  templateName?: string;
  brandName?: string;
  watermarkText?: string;
  captionStyle?: string;
  durationSeconds?: number;
  pexelsTerms?: string[];
  narrationLines?: string[];
  downloadFilename?: string;
  containerPath?: string;
  hostPathHint?: string;
  error?: string;
};

export type ApiTokenItem = {
  id: string;
  name: string;
  scopes: string[];
  lastUsedAt?: string;
  revokedAt?: string;
  createdAt: string;
  token?: string;
};

export type VideoRevisionItem = {
  id: string;
  projectId: string;
  revisionNumber: number;
  parentRevisionId?: string;
  sourceJobId?: string;
  outputVideoId?: string;
  status: string;
  reason?: string;
  changeType: string;
  changedFields: Record<string, unknown>;
  isFinal: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SystemObservability = {
  queueDepth: number;
  activeWorkers: number;
  activeRenders: number;
  maxConcurrentRenders: number;
  workers: Array<{
    workerId: string;
    status: string;
    activeJobId?: string;
    lastHeartbeat: string;
    leaseExpiresAt?: string;
  }>;
  averageGenerationTimeMs?: number | null;
  recentStageBottleneck?: string;
  cache?: Record<string, unknown>;
  jobCounts?: Record<string, number>;
  recentWebhookDeliveries?: any[];
};

export type ProviderItem = {
  id?: string;
  name: string;
  category: string;
  tier?: string;
  status: string;
  providerStatus?: string;
  configured?: boolean;
  isDefault?: boolean;
  message: string;
  checkedAt?: string;
  details?: Record<string, unknown>;
};

export type PromptEnhanceResult = {
  originalPrompt: string;
  enhancedPrompt: string;
  changesSummary: string;
};

export type CostEstimateData = {
  estimatedCost: number;
  currency: "USD";
  isFree: boolean;
  breakdown: {
    contentAI: number;
    visualAssets: {
      stockCount: number;
      aiCount: number;
      cost: number;
      provider: string;
    };
    voice: {
      provider: string;
      charCount: number;
      cost: number;
    };
    rendering: number;
  };
};

export type PublishingPlatform =
  | "youtube"
  | "tiktok"
  | "instagram"
  | "facebook"
  | "linkedin"
  | "twitter"
  | "threads"
  | "telegram";

export type PublishingStatus =
  | "draft"
  | "scheduled"
  | "queued"
  | "uploading"
  | "processing"
  | "published"
  | "failed"
  | "canceled";

export type OverallDistributionStatus =
  | "not_published"
  | "scheduled"
  | "publishing"
  | "published"
  | "partially_published"
  | "failed";

export type PlatformMetadata = {
  title?: string;
  caption?: string;
  description?: string;
  hashtags?: string[];
  tags?: string[];
  privacy?: "private" | "unlisted" | "public";
  category?: string;
  telegramChatId?: string;
  customThumbnailUrl?: string;
  reelSettings?: {
    shareToFeed?: boolean;
    audioName?: string;
  };
};

export type SocialAccount = {
  id: string;
  platform: PublishingPlatform;
  accountName: string;
  accountId: string;
  provider: string;
  connectionStatus: "connected" | "disconnected" | "expired" | "error";
  capabilities: any;
  maskedToken?: string;
  lastCheckedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type Publication = {
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
  scheduledAt?: string;
  publishedAt?: string;
  sourceTimezone: string;
  provider: string;
  providerPostId?: string;
  providerUrl?: string;
  attemptCount: number;
  lastError?: string;
  technicalError?: string;
  createdAt: string;
  updatedAt: string;
};

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
  privacyOptions: ("private" | "unlisted" | "public")[];
  titleMaxChars: number;
  captionMaxChars: number;
  descriptionMaxChars: number;
  hashtagsMaxCount: number;
  requiresAccount: boolean;
};

export type PublishingSummary = {
  scheduledCount: number;
  publishingCount: number;
  publishedTodayCount: number;
  failedCount: number;
  totalPublications: number;
};

export type VideoPublishingStatus = {
  status: OverallDistributionStatus;
  platforms: Record<PublishingPlatform, { status: PublishingStatus; url?: string; error?: string }>;
  publications: Publication[];
};
