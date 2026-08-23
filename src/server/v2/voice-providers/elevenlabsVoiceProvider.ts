import axios from "axios";
import { Readable } from "stream";
import { providerSecrets } from "../provider-vault/providerSecrets";
import type {
  ElevenLabsVoicePreset,
  ElevenLabsVoiceSettings,
  VoiceAudioResult,
  VoiceCapabilities,
  VoiceOption,
  VoiceProvider,
  VoiceProviderValidationResult,
} from "./types";

/**
 * Canonical production model for Arabic / Egyptian Arabic / MSA narration.
 * eleven_multilingual_v2 is the currently documented high-quality multilingual
 * model and is the only model this engine defaults to.
 */
export const ELEVENLABS_DEFAULT_MODEL_ID = "eleven_multilingual_v2";

export const ARABIC_NOT_CONFIGURED_MESSAGE =
  "Arabic narration requires ElevenLabs. Configure ElevenLabs in Providers.";

/**
 * Presets map only to voice settings documented by the ElevenLabs
 * text-to-speech API: stability, similarity_boost, style, use_speaker_boost.
 * No invented parameters.
 */
export const ELEVENLABS_PRESETS: Record<ElevenLabsVoicePreset, ElevenLabsVoiceSettings> = {
  natural: {
    stability: 0.5,
    similarity_boost: 0.75,
    style: 0.15,
    use_speaker_boost: true,
  },
  energetic_ad: {
    stability: 0.35,
    similarity_boost: 0.8,
    style: 0.45,
    use_speaker_boost: true,
  },
  professional: {
    stability: 0.7,
    similarity_boost: 0.8,
    style: 0.05,
    use_speaker_boost: true,
  },
  storytelling: {
    stability: 0.4,
    similarity_boost: 0.75,
    style: 0.3,
    use_speaker_boost: true,
  },
  calm: {
    stability: 0.8,
    similarity_boost: 0.7,
    style: 0.0,
    use_speaker_boost: true,
  },
};

export const ELEVENLABS_PRESET_IDS = Object.keys(ELEVENLABS_PRESETS) as ElevenLabsVoicePreset[];

type RawElevenLabsVoice = {
  voice_id?: string;
  name?: string;
  category?: string;
  labels?: Record<string, string>;
  preview_url?: string;
  high_quality_base_model_ids?: string[];
  verified_languages?: Array<{ language?: string; accent?: string; locale?: string }>;
};

/**
 * Normalizes one raw /v1/voices entry into the canonical VoiceOption shape.
 * Language, accent and dialect are only asserted when ElevenLabs actually
 * returned metadata that supports them - nothing is inferred from the name.
 */
export function normalizeElevenLabsVoice(raw: RawElevenLabsVoice): VoiceOption | null {
  if (!raw?.voice_id) return null;
  const labels = raw.labels || {};
  const verified = Array.isArray(raw.verified_languages) ? raw.verified_languages : [];
  const accentLabel = String(labels.accent || "").trim();
  const verifiedArabic = verified.find((entry) => String(entry?.language || "").toLowerCase().startsWith("ar"));
  const accent = accentLabel || String(verifiedArabic?.accent || "").trim() || undefined;
  const accentLower = (accent || "").toLowerCase();
  const localeLower = String(verifiedArabic?.locale || "").toLowerCase();

  const arabicVerified = Boolean(verifiedArabic) || accentLower.includes("arab") || accentLower.includes("egypt");
  const egyptianVerified = accentLower.includes("egypt") || localeLower.startsWith("ar-eg");

  const gender = String(labels.gender || "").toLowerCase();

  return {
    id: raw.voice_id,
    name: raw.name || raw.voice_id,
    provider: "elevenlabs",
    tier: "premium",
    // Every eleven_multilingual_v2 voice can speak Arabic; only voices with
    // real Arabic metadata are additionally tagged as such.
    language: arabicVerified ? "ar" : "multilingual",
    dialect: egyptianVerified ? "egyptian" : undefined,
    gender: gender === "female" ? "female" : gender === "male" ? "male" : undefined,
    voiceFamily: raw.category || undefined,
    category: raw.category || undefined,
    labels: Object.keys(labels).length ? labels : undefined,
    accent,
    previewUrl: raw.preview_url || undefined,
    license: "ElevenLabs SaaS Commercial Terms",
    commercialUse: "allowed",
  };
}

export class ElevenLabsVoiceProvider implements VoiceProvider {
  public readonly id = "elevenlabs";
  public readonly displayName = "ElevenLabs (Production Arabic & Multilingual)";
  public readonly tier = "premium" as const;

  private cachedVoices: VoiceOption[] | null = null;
  private cacheTimestamp = 0;
  private lastDiscoveryError: string | null = null;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(private apiKey?: string) {}

  public setApiKey(key: string): void {
    this.apiKey = key;
    this.cachedVoices = null;
    this.cacheTimestamp = 0;
  }

  /**
   * Resolution order: explicitly injected key, then environment, then the
   * encrypted ProviderCredentialsVault (already resolved into memory).
   */
  public getApiKey(): string | undefined {
    return this.apiKey || process.env.ELEVENLABS_API_KEY || providerSecrets.peekElevenLabsApiKey();
  }

  public isConfigured(): boolean {
    const key = this.getApiKey();
    return Boolean(key && key.trim().length > 10 && !key.includes("your_"));
  }

  public getCapabilities(): VoiceCapabilities {
    return {
      languages: ["ar", "en", "multilingual"],
      dialects: ["egyptian", "msa", "gulf", "levantine"],
      supportsLanguageDetection: true,
      supportsWordTimings: false,
      supportsStyles: true,
      supportsPace: false,
      local: false,
      costTier: "premium",
      commercialUse: "allowed",
      license: "ElevenLabs SaaS Commercial Terms",
      notes: `Canonical production voice provider for Arabic, Egyptian Arabic and MSA narration using ${ELEVENLABS_DEFAULT_MODEL_ID}.`,
    };
  }

  public supportsLanguage(language?: string): boolean {
    return !language || language === "auto" || language === "ar" || language === "en" || language === "multilingual";
  }

  public resolveVoiceSettings(
    preset?: ElevenLabsVoicePreset,
    customSettings?: Partial<ElevenLabsVoiceSettings>,
  ): ElevenLabsVoiceSettings {
    const base = ELEVENLABS_PRESETS[preset as ElevenLabsVoicePreset] || ELEVENLABS_PRESETS.natural;
    const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
    return {
      stability: clamp01(customSettings?.stability ?? base.stability),
      similarity_boost: clamp01(customSettings?.similarity_boost ?? base.similarity_boost),
      style: clamp01(customSettings?.style ?? base.style ?? 0),
      use_speaker_boost: customSettings?.use_speaker_boost ?? base.use_speaker_boost ?? true,
    };
  }

  /**
   * Resolves the voice to narrate with. No voice ID is ever invented: when the
   * caller did not choose one we take the first voice the account actually owns.
   */
  public async resolveVoiceId(requestedVoiceId?: string): Promise<string> {
    const requested = (requestedVoiceId || "").trim();
    if (requested) return requested;

    const configuredDefault = (process.env.ELEVENLABS_DEFAULT_VOICE_ID || "").trim();
    if (configuredDefault) return configuredDefault;

    const voices = await this.listVoices();
    if (!voices.length) {
      throw new Error(
        "No ElevenLabs voice is available for this account. Open Providers → ElevenLabs → Browse Voices and select a voice.",
      );
    }
    return voices[0].id;
  }

  private buildRequestBody(
    text: string,
    modelId: string,
    voiceSettings: ElevenLabsVoiceSettings,
    languageCode?: string,
  ) {
    return {
      text,
      model_id: modelId,
      // language_code is supported by the multilingual/turbo model families and
      // is only sent when we actually know the language.
      ...(languageCode ? { language_code: languageCode } : {}),
      voice_settings: voiceSettings,
    };
  }

  private describeError(err: any): string {
    const status = err?.response?.status;
    if (status === 401 || status === 403) return "Invalid or unauthorized ElevenLabs API key.";
    if (status === 429) return "ElevenLabs rate limit or quota reached.";
    if (status) return `ElevenLabs returned HTTP ${status}.`;
    return err?.message || "ElevenLabs request failed.";
  }

  public async generateVoice(
    text: string,
    voiceId?: string,
    options: {
      modelId?: string;
      preset?: ElevenLabsVoicePreset;
      voiceSettings?: Partial<ElevenLabsVoiceSettings>;
      languageCode?: string;
    } = {},
  ): Promise<VoiceAudioResult> {
    if (!this.isConfigured()) {
      throw new Error(ARABIC_NOT_CONFIGURED_MESSAGE);
    }
    const key = this.getApiKey();
    const modelId = options.modelId || ELEVENLABS_DEFAULT_MODEL_ID;
    const voiceSettings = this.resolveVoiceSettings(options.preset, options.voiceSettings);
    const resolvedVoiceId = await this.resolveVoiceId(voiceId);

    const isArabic = options.languageCode === "ar" || /[\u0600-\u06FF]/.test(text);
    const languageCode = options.languageCode || (isArabic ? "ar" : undefined);

    const startedAt = Date.now();
    let response;
    try {
      response = await axios.post(
        `https://api.elevenlabs.io/v1/text-to-speech/${resolvedVoiceId}?output_format=mp3_44100_128`,
        this.buildRequestBody(text, modelId, voiceSettings, languageCode),
        {
          headers: {
            "xi-api-key": key,
            "Content-Type": "application/json",
          },
          responseType: "arraybuffer",
          timeout: 60000,
        },
      );
    } catch (err: any) {
      throw new Error(this.describeError(err));
    }

    const buffer = Buffer.from(response.data);
    const stream = new Readable();
    stream.push(buffer);
    stream.push(null);

    return {
      audio: stream,
      // Rough pre-decode hint only. The render pipeline measures the real
      // duration with FFmpeg and uses that for scene fitting.
      audioLength: Math.max(text.length / 14, 1.5),
      audioLengthEstimated: true,
      sampleRate: 44100,
      provider: "elevenlabs",
      model: modelId,
      modelId,
      voiceId: resolvedVoiceId,
      language: isArabic ? "ar" : "en",
      voiceSettings,
      generationMs: Date.now() - startedAt,
      // ElevenLabs pricing is subscription/credit based; we do not invent a
      // dollar figure here. The cost is reported as usage-based instead.
      estimatedCostTier: "premium",
      usageBasedCost: true,
      charactersBilled: text.length,
    };
  }

  /**
   * Short audition sample for the Voice Lab. Never used for full renders.
   */
  public async generatePreview(
    text: string,
    voiceId?: string,
    options: {
      modelId?: string;
      preset?: ElevenLabsVoicePreset;
      voiceSettings?: Partial<ElevenLabsVoiceSettings>;
      languageCode?: string;
    } = {},
  ): Promise<{
    audioBase64: string;
    voiceId: string;
    modelId: string;
    preset: ElevenLabsVoicePreset;
    voiceSettings: ElevenLabsVoiceSettings;
    charactersBilled: number;
    generationMs: number;
  }> {
    if (!this.isConfigured()) {
      throw new Error(ARABIC_NOT_CONFIGURED_MESSAGE);
    }
    const key = this.getApiKey();
    const modelId = options.modelId || ELEVENLABS_DEFAULT_MODEL_ID;
    const preset = options.preset || "natural";
    const voiceSettings = this.resolveVoiceSettings(preset, options.voiceSettings);
    const resolvedVoiceId = await this.resolveVoiceId(voiceId);
    const isArabic = options.languageCode === "ar" || /[\u0600-\u06FF]/.test(text);
    const languageCode = options.languageCode || (isArabic ? "ar" : undefined);

    const startedAt = Date.now();
    let response;
    try {
      response = await axios.post(
        `https://api.elevenlabs.io/v1/text-to-speech/${resolvedVoiceId}?output_format=mp3_44100_128`,
        this.buildRequestBody(text, modelId, voiceSettings, languageCode),
        {
          headers: {
            "xi-api-key": key,
            "Content-Type": "application/json",
          },
          responseType: "arraybuffer",
          timeout: 30000,
        },
      );
    } catch (err: any) {
      throw new Error(this.describeError(err));
    }

    const buffer = Buffer.from(response.data);
    return {
      audioBase64: `data:audio/mpeg;base64,${buffer.toString("base64")}`,
      voiceId: resolvedVoiceId,
      modelId,
      preset,
      voiceSettings,
      charactersBilled: text.length,
      generationMs: Date.now() - startedAt,
    };
  }

  /**
   * Dynamic voice discovery. Voices are always read from the live account;
   * nothing is hardcoded and no placeholder catalogue is returned.
   */
  public async listVoices(language?: string): Promise<VoiceOption[]> {
    if (!this.isConfigured()) {
      this.lastDiscoveryError = ARABIC_NOT_CONFIGURED_MESSAGE;
      return [];
    }
    if (this.cachedVoices && Date.now() - this.cacheTimestamp < this.CACHE_TTL_MS) {
      return this.filterVoicesByLanguage(this.cachedVoices, language);
    }

    try {
      const response = await axios.get("https://api.elevenlabs.io/v1/voices", {
        headers: { "xi-api-key": this.getApiKey() },
        timeout: 15000,
      });
      const rawVoices = Array.isArray(response.data?.voices) ? response.data.voices : [];
      const voices = rawVoices
        .map((raw: RawElevenLabsVoice) => normalizeElevenLabsVoice(raw))
        .filter((voice: VoiceOption | null): voice is VoiceOption => Boolean(voice));

      this.cachedVoices = voices;
      this.cacheTimestamp = Date.now();
      this.lastDiscoveryError = null;
      return this.filterVoicesByLanguage(voices, language);
    } catch (err: any) {
      this.lastDiscoveryError = this.describeError(err);
      throw new Error(this.lastDiscoveryError as string);
    }
  }

  public getLastDiscoveryError(): string | null {
    return this.lastDiscoveryError;
  }

  private filterVoicesByLanguage(voices: VoiceOption[], language?: string): VoiceOption[] {
    if (!language || language === "auto") return voices;
    if (language === "ar") {
      // Multilingual voices are legitimate Arabic candidates under
      // eleven_multilingual_v2; Arabic-verified voices are surfaced first.
      const arabicFirst = voices.filter((voice) => voice.language === "ar");
      const multilingual = voices.filter((voice) => voice.language !== "ar");
      return [...arabicFirst, ...multilingual];
    }
    return voices;
  }

  public async validate(): Promise<VoiceProviderValidationResult> {
    if (!this.isConfigured()) {
      return {
        provider: "ElevenLabs",
        category: "Voice",
        tier: "premium",
        configured: false,
        healthy: false,
        status: "not_configured",
        message: "ElevenLabs is not configured. Add an API key in Providers → ElevenLabs → Configure.",
        checkedAt: new Date().toISOString(),
      };
    }

    const start = Date.now();
    try {
      const response = await axios.get("https://api.elevenlabs.io/v1/user", {
        headers: { "xi-api-key": this.getApiKey() },
        timeout: 12000,
      });
      if (response.status === 200) {
        const subscription = response.data?.subscription || {};
        return {
          provider: "ElevenLabs",
          category: "Voice",
          tier: "premium",
          configured: true,
          healthy: true,
          status: "healthy",
          message: "ElevenLabs API connection verified.",
          checkedAt: new Date().toISOString(),
          latencyMs: Date.now() - start,
          accountTier: subscription.tier || undefined,
          characterLimit: typeof subscription.character_limit === "number" ? subscription.character_limit : undefined,
          charactersUsed: typeof subscription.character_count === "number" ? subscription.character_count : undefined,
        };
      }
      return {
        provider: "ElevenLabs",
        category: "Voice",
        tier: "premium",
        configured: true,
        healthy: false,
        status: "provider_unavailable",
        message: `ElevenLabs returned HTTP ${response.status}`,
        checkedAt: new Date().toISOString(),
      };
    } catch (err: any) {
      const status = err?.response?.status;
      return {
        provider: "ElevenLabs",
        category: "Voice",
        tier: "premium",
        configured: true,
        healthy: false,
        status:
          status === 401 || status === 403
            ? "invalid_credentials"
            : status === 429
              ? "rate_limited"
              : "provider_unavailable",
        message: this.describeError(err),
        checkedAt: new Date().toISOString(),
      };
    }
  }
}
