import { Kokoro } from "../../../short-creator/libraries/Kokoro";
import type {
  VoiceAudioResult,
  VoiceProviderId,
  VoiceOption,
  VoiceProvider,
  VoiceProviderValidationResult,
  VoiceRouteDecision,
  VoiceRouteRequest,
} from "./types";
import {
  ARABIC_ELEVENLABS_REQUIRED_MESSAGE,
  ARABIC_PRODUCTION_PROVIDER,
  isArabicLanguage,
  isLegacyPiperVoiceId,
} from "./types";
import { KokoroVoiceProvider } from "./kokoroVoiceProvider";
import { ElevenLabsVoiceProvider } from "./elevenlabsVoiceProvider";
import { PiperVoiceProvider } from "./piperVoiceProvider";
import { GoogleCloudTtsProvider } from "./googleCloudTtsProvider";
import { EdgeTtsProvider } from "./edgeTtsProvider";
import { preprocessArabicSpeech } from "./arabicSpeechPreprocessor";

/**
 * Voice routing authority.
 *
 * Arabic / Egyptian Arabic / MSA resolve to ElevenLabs and nothing else. If
 * ElevenLabs is not configured the route throws before any job work happens so
 * the failure surfaces in the UI rather than mid-render.
 */
export class VoiceRegistry {
  private kokoroProvider: KokoroVoiceProvider;
  private elevenlabsProvider: ElevenLabsVoiceProvider;
  private piperProvider: PiperVoiceProvider;
  private edgeTtsProvider: EdgeTtsProvider;
  private googleCloudTtsProvider: GoogleCloudTtsProvider;

  constructor(kokoro: Kokoro, elevenlabsApiKey?: string) {
    this.kokoroProvider = new KokoroVoiceProvider(kokoro);
    this.elevenlabsProvider = new ElevenLabsVoiceProvider(elevenlabsApiKey);
    this.piperProvider = new PiperVoiceProvider();
    this.edgeTtsProvider = new EdgeTtsProvider();
    this.googleCloudTtsProvider = new GoogleCloudTtsProvider();
  }

  public setElevenLabsApiKey(key: string): void {
    this.elevenlabsProvider.setApiKey(key);
  }

  public getElevenLabsProvider(): ElevenLabsVoiceProvider {
    return this.elevenlabsProvider;
  }

  /** Arabic production is ready only when ElevenLabs holds a usable credential. */
  public isArabicProductionConfigured(): boolean {
    return this.elevenlabsProvider.isConfigured();
  }

  public getProvider(providerId?: string): VoiceProvider {
    if (providerId === "elevenlabs") {
      return this.elevenlabsProvider.isConfigured() ? this.elevenlabsProvider : this.kokoroProvider;
    }
    if (providerId === "piper") {
      return this.piperProvider.isConfigured() ? this.piperProvider : this.kokoroProvider;
    }
    if (providerId === "edge_tts") {
      return this.edgeTtsProvider.isConfigured() ? this.edgeTtsProvider : this.kokoroProvider;
    }
    if (providerId === "google_cloud_tts") {
      return this.googleCloudTtsProvider.isConfigured() ? this.googleCloudTtsProvider : this.kokoroProvider;
    }
    return this.kokoroProvider;
  }

  public route(request: VoiceRouteRequest): VoiceRouteDecision {
    const detectedArabic =
      isArabicLanguage(request.language, request.dialect) || /[\u0600-\u06FF]/.test(request.text);
    const language = detectedArabic
      ? "ar"
      : request.language && request.language !== "auto"
        ? request.language
        : "en";
    const warnings: string[] = [];
    const processed = detectedArabic
      ? preprocessArabicSpeech(request.text, {
          dialect: request.dialect,
          pronunciationOverrides: request.pronunciationOverrides,
          brandPronunciations: request.brandPronunciations,
        }).ttsNormalizedText
      : request.text.trim();

    const requestedProvider = request.requestedProvider === "auto" ? undefined : request.requestedProvider;
    const fallbackAllowed = request.fallbackPolicy !== "none";

    const pick = (provider: VoiceProvider, voiceId: string, reason: string): VoiceRouteDecision => ({
      provider,
      providerId: provider.id as VoiceProviderId,
      voiceId: this.resolveVoiceFor(provider.id as VoiceProviderId, voiceId),
      language,
      dialect: request.dialect,
      processedText: processed,
      reason,
      fallbackAllowed,
      warnings,
      voicePreset: request.voicePreset,
      voiceSettings: request.voiceSettings,
      modelId: request.modelId,
      requestAlignment: request.requestAlignment,
    });

    // FINAL ARABIC PRODUCTION POLICY: ELEVENLABS ONLY.
    // No Piper / Kokoro / Edge-TTS / Google Cloud TTS fallback is permitted.
    if (language === "ar") {
      if (requestedProvider && requestedProvider !== ARABIC_PRODUCTION_PROVIDER) {
        throw new Error(ARABIC_ELEVENLABS_REQUIRED_MESSAGE);
      }
      if (!this.elevenlabsProvider.isConfigured()) {
        throw new Error(ARABIC_ELEVENLABS_REQUIRED_MESSAGE);
      }
      return pick(
        this.elevenlabsProvider,
        request.voiceId || this.defaultVoiceFor("elevenlabs"),
        "arabic_production_elevenlabs",
      );
    }

    if (requestedProvider) {
      const provider = this.getStrictProvider(requestedProvider);
      if (provider?.isConfigured() && provider.supportsLanguage(language, request.dialect)) {
        return pick(
          provider,
          request.voiceId || this.defaultVoiceFor(provider.id as VoiceProviderId),
          "user_selected_provider",
        );
      }
      warnings.push(`${requestedProvider} is not configured or does not support ${language}.`);
      throw new Error(
        `Voice provider ${requestedProvider} is unavailable for ${language}. Choose a compatible configured provider or Auto.`,
      );
    }

    // English / other languages keep the existing local-first Kokoro route.
    if (this.kokoroProvider.isConfigured()) {
      return pick(this.kokoroProvider, request.voiceId || "af_heart", "auto_local_english_kokoro");
    }
    if (this.elevenlabsProvider.isConfigured()) {
      return pick(
        this.elevenlabsProvider,
        request.voiceId || this.defaultVoiceFor("elevenlabs"),
        "auto_cloud_english_elevenlabs",
      );
    }

    throw new Error("No configured English voice provider is available.");
  }

  private getStrictProvider(providerId: VoiceProviderId): VoiceProvider | undefined {
    if (providerId === "kokoro") return this.kokoroProvider;
    if (providerId === "elevenlabs") return this.elevenlabsProvider;
    if (providerId === "piper") return this.piperProvider;
    if (providerId === "edge_tts") return this.edgeTtsProvider;
    if (providerId === "google_cloud_tts") return this.googleCloudTtsProvider;
    return undefined;
  }

  public getProviderStrict(providerId: VoiceProviderId): VoiceProvider | undefined {
    return this.getStrictProvider(providerId);
  }

  private defaultVoiceFor(providerId: VoiceProviderId): string {
    // ElevenLabs voice IDs are account-specific. We never hardcode one: an empty
    // value means "resolve from live voice discovery at generation time".
    if (providerId === "elevenlabs") return process.env.ELEVENLABS_DEFAULT_VOICE_ID || "";
    if (providerId === "piper") return process.env.PIPER_AR_VOICE_ID || "ar_JO-kareem-medium";
    if (providerId === "edge_tts") return process.env.EDGE_TTS_DEFAULT_VOICE || "ar-EG-SalmaNeural";
    if (providerId === "google_cloud_tts") return process.env.GOOGLE_CLOUD_TTS_DEFAULT_VOICE || "";
    return "af_heart";
  }

  private resolveVoiceFor(providerId: VoiceProviderId, voiceId?: string): string {
    if (providerId === "elevenlabs") {
      // A revision of a historical Piper job can still carry ar_JO-kareem-medium.
      // Drop it rather than sending a Piper model name to ElevenLabs.
      return voiceId && !isLegacyPiperVoiceId(voiceId) ? voiceId : this.defaultVoiceFor("elevenlabs");
    }
    if (providerId === "piper") {
      const configuredVoice = process.env.PIPER_AR_VOICE_ID || "ar_JO-kareem-medium";
      return voiceId && (isLegacyPiperVoiceId(voiceId) || voiceId === configuredVoice)
        ? voiceId
        : this.defaultVoiceFor("piper");
    }
    if (providerId === "kokoro") {
      return voiceId && !isLegacyPiperVoiceId(voiceId) ? voiceId : "af_heart";
    }
    return voiceId || this.defaultVoiceFor(providerId);
  }

  public async generateVoice(
    text: string,
    voiceId: string,
    providerId?: string,
  ): Promise<VoiceAudioResult> {
    const decision = this.route({
      text,
      voiceId,
      requestedProvider: (providerId as VoiceProviderId | "auto") || "auto",
    });
    const started = Date.now();
    const result = await decision.provider.generateVoice(decision.processedText, decision.voiceId, {
      modelId: decision.modelId,
      preset: decision.voicePreset,
      voiceSettings: decision.voiceSettings,
      languageCode: decision.language === "ar" ? "ar" : undefined,
      requestAlignment: decision.requestAlignment,
    });
    return {
      ...result,
      provider: decision.providerId,
      voiceId: result.voiceId || decision.voiceId,
      language: decision.language,
      dialect: decision.dialect,
      processedText: decision.processedText,
      generationMs: result.generationMs || Date.now() - started,
    };
  }

  public async synthesize(
    request: VoiceRouteRequest,
  ): Promise<VoiceAudioResult & { decision: Omit<VoiceRouteDecision, "provider"> }> {
    const decision = this.route(request);
    const started = Date.now();
    const result = await decision.provider.generateVoice(decision.processedText, decision.voiceId, {
      modelId: decision.modelId,
      preset: decision.voicePreset,
      voiceSettings: decision.voiceSettings,
      languageCode: decision.language === "ar" ? "ar" : undefined,
      requestAlignment: decision.requestAlignment,
    });
    const { provider, ...publicDecision } = decision;
    return {
      ...result,
      provider: decision.providerId,
      // The provider may resolve an empty ElevenLabs voice ID into a concrete
      // account voice; that resolved ID is authoritative for the whole video.
      voiceId: result.voiceId || decision.voiceId,
      language: decision.language,
      dialect: decision.dialect,
      processedText: decision.processedText,
      generationMs: result.generationMs || Date.now() - started,
      decision: { ...publicDecision, voiceId: result.voiceId || decision.voiceId },
    };
  }

  public async listAllVoices(language?: string): Promise<VoiceOption[]> {
    const kokoroVoices = await this.kokoroProvider.listVoices();
    const elevenlabsVoices = await this.elevenlabsProvider.listVoices(language).catch(() => []);
    return [...kokoroVoices, ...elevenlabsVoices];
  }

  public async listCompatibleVoices(request: {
    provider?: VoiceProviderId | "auto";
    language?: string;
    dialect?: any;
    includeUnavailable?: boolean;
  }): Promise<{
    voices: VoiceOption[];
    resolvedProvider?: VoiceProviderId;
    warnings: string[];
    blocked?: boolean;
    blockedReason?: string;
  }> {
    const provider = request.provider || "auto";
    const language = request.language === "auto" ? undefined : request.language;
    const isArabic = isArabicLanguage(language, request.dialect);
    const warnings: string[] = [];

    if (isArabic) {
      if (provider !== "auto" && provider !== ARABIC_PRODUCTION_PROVIDER) {
        return {
          voices: [],
          resolvedProvider: ARABIC_PRODUCTION_PROVIDER,
          warnings: [ARABIC_ELEVENLABS_REQUIRED_MESSAGE],
          blocked: true,
          blockedReason: ARABIC_ELEVENLABS_REQUIRED_MESSAGE,
        };
      }
      if (!this.elevenlabsProvider.isConfigured()) {
        return {
          voices: [],
          resolvedProvider: ARABIC_PRODUCTION_PROVIDER,
          warnings: [ARABIC_ELEVENLABS_REQUIRED_MESSAGE],
          blocked: true,
          blockedReason: ARABIC_ELEVENLABS_REQUIRED_MESSAGE,
        };
      }
      try {
        const voices = await this.elevenlabsProvider.listVoices("ar");
        return { voices, resolvedProvider: ARABIC_PRODUCTION_PROVIDER, warnings };
      } catch (error) {
        return {
          voices: [],
          resolvedProvider: ARABIC_PRODUCTION_PROVIDER,
          warnings: [error instanceof Error ? error.message : String(error)],
          blocked: true,
          blockedReason: "ElevenLabs voice discovery failed.",
        };
      }
    }

    if (provider !== "auto") {
      const strict = this.getStrictProvider(provider);
      if (!strict) return { voices: [], resolvedProvider: undefined, warnings: [`Unknown provider ${provider}.`] };
      if (!strict.supportsLanguage(language, request.dialect)) {
        return {
          voices: [],
          resolvedProvider: provider,
          warnings: [`${strict.displayName} does not support ${language || "auto"} ${request.dialect || ""}`.trim()],
        };
      }
      if (!strict.isConfigured() && !request.includeUnavailable) {
        return { voices: [], resolvedProvider: provider, warnings: [`${strict.displayName} is not configured.`] };
      }
      try {
        return { voices: await strict.listVoices(language), resolvedProvider: provider, warnings };
      } catch (error) {
        return {
          voices: [],
          resolvedProvider: provider,
          warnings: [error instanceof Error ? error.message : String(error)],
        };
      }
    }

    const englishVoices = await this.kokoroProvider.listVoices();
    return { voices: englishVoices, resolvedProvider: "kokoro", warnings };
  }

  public async validateAll(): Promise<VoiceProviderValidationResult[]> {
    return [
      await this.kokoroProvider.validate(),
      await this.elevenlabsProvider.validate(),
      await this.piperProvider.validate(),
      await this.edgeTtsProvider.validate(),
      await this.googleCloudTtsProvider.validate(),
    ];
  }
}
