import type { ArabicDialect } from "../../../types/productionSpec";

export type VoiceProviderId = "kokoro" | "elevenlabs" | "piper" | "google_cloud_tts";
export type VoiceTier = "free" | "cloud_free_tier" | "premium";
export type VoiceQualityProfile = "fast" | "balanced" | "premium";

export type VoiceCapabilities = {
  languages: string[];
  dialects?: ArabicDialect[];
  supportsLanguageDetection: boolean;
  supportsWordTimings: boolean;
  supportsStyles: boolean;
  supportsPace: boolean;
  supportsSSML?: boolean;
  supportsSpeakingRate?: boolean;
  supportsPitch?: boolean;
  local: boolean;
  costTier?: VoiceTier;
  commercialUse: "allowed" | "model_dependent" | "not_allowed" | "unknown";
  license: string;
  notes?: string;
};

export type VoiceOption = {
  id: string;
  name: string;
  provider: VoiceProviderId;
  tier: VoiceTier;
  language: string;
  dialect?: ArabicDialect;
  gender?: "male" | "female";
  voiceFamily?: string;
  sampleRate?: number;
  supportsSSML?: boolean;
  supportsSpeakingRate?: boolean;
  supportsPitch?: boolean;
  previewUrl?: string;
  license?: string;
  commercialUse?: VoiceCapabilities["commercialUse"];
};

export type VoiceAudioResult = {
  audio: any; // Audio stream or Buffer
  audioLength: number;
  sampleRate?: number;
  provider?: VoiceProviderId;
  model?: string;
  voiceFamily?: string;
  voiceId?: string;
  language?: string;
  dialect?: ArabicDialect;
  processedText?: string;
  generationMs?: number;
  estimatedCost?: number;
  estimatedCostTier?: VoiceTier;
  wordTimings?: Array<{ word: string; startMs: number; endMs: number }>;
};

export type VoiceProviderValidationResult = {
  provider: string;
  category: "Voice";
  tier: VoiceTier;
  configured: boolean;
  healthy: boolean;
  status: "healthy" | "not_configured" | "invalid_credentials" | "rate_limited" | "timeout" | "provider_unavailable";
  message: string;
  checkedAt: string;
  latencyMs?: number;
};

export interface VoiceProvider {
  readonly id: string;
  readonly displayName: string;
  readonly tier: VoiceTier;

  isConfigured(): boolean;
  getCapabilities(): VoiceCapabilities;
  supportsLanguage(language?: string, dialect?: ArabicDialect): boolean;
  generateVoice(text: string, voiceId: string): Promise<VoiceAudioResult>;
  listVoices(language?: string): Promise<VoiceOption[]>;
  validate(): Promise<VoiceProviderValidationResult>;
}

export type VoiceRouteRequest = {
  text: string;
  language?: string;
  dialect?: ArabicDialect;
  qualityProfile?: VoiceQualityProfile;
  requestedProvider?: VoiceProviderId | "auto";
  voiceId?: string;
  fallbackPolicy?: "none" | "local" | "configured";
  brandPronunciations?: Record<string, string>;
};

export type VoiceRouteDecision = {
  provider: VoiceProvider;
  providerId: VoiceProviderId;
  voiceId: string;
  language: string;
  dialect?: ArabicDialect;
  processedText: string;
  reason: string;
  fallbackAllowed: boolean;
  warnings: string[];
};
