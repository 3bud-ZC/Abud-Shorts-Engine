import type { ArabicDialect } from "../../../types/productionSpec";

export type VoiceTier = "free" | "premium";

export type VoiceOption = {
  id: string;
  name: string;
  provider: "kokoro" | "elevenlabs";
  tier: VoiceTier;
  language: string;
  dialect?: ArabicDialect;
  gender?: "male" | "female";
  previewUrl?: string;
};

export type VoiceAudioResult = {
  audio: any; // Audio stream or Buffer
  audioLength: number;
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
  generateVoice(text: string, voiceId: string): Promise<VoiceAudioResult>;
  listVoices(language?: string): Promise<VoiceOption[]>;
  validate(): Promise<VoiceProviderValidationResult>;
}
