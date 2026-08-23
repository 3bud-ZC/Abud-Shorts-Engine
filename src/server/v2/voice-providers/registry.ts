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
import { KokoroVoiceProvider } from "./kokoroVoiceProvider";
import { ElevenLabsVoiceProvider } from "./elevenlabsVoiceProvider";
import { PiperVoiceProvider } from "./piperVoiceProvider";
import { GoogleCloudTtsProvider } from "./googleCloudTtsProvider";
import { preprocessArabicSpeech } from "./arabicSpeechPreprocessor";

export class VoiceRegistry {
  private kokoroProvider: KokoroVoiceProvider;
  private elevenlabsProvider: ElevenLabsVoiceProvider;
  private piperProvider: PiperVoiceProvider;
  private googleCloudTtsProvider: GoogleCloudTtsProvider;

  constructor(kokoro: Kokoro, elevenlabsApiKey?: string) {
    this.kokoroProvider = new KokoroVoiceProvider(kokoro);
    this.elevenlabsProvider = new ElevenLabsVoiceProvider(
      elevenlabsApiKey || process.env.ELEVENLABS_API_KEY,
    );
    this.piperProvider = new PiperVoiceProvider();
    this.googleCloudTtsProvider = new GoogleCloudTtsProvider();
  }

  public getProvider(providerId?: string): VoiceProvider {
    if (providerId === "elevenlabs") {
      return this.elevenlabsProvider.isConfigured() ? this.elevenlabsProvider : this.kokoroProvider;
    }
    if (providerId === "piper") {
      return this.piperProvider.isConfigured() ? this.piperProvider : this.kokoroProvider;
    }
    if (providerId === "google_cloud_tts") {
      return this.googleCloudTtsProvider.isConfigured() ? this.googleCloudTtsProvider : this.kokoroProvider;
    }
    return this.kokoroProvider;
  }

  public route(request: VoiceRouteRequest): VoiceRouteDecision {
    const detectedArabic = request.language === "ar" || /[\u0600-\u06FF]/.test(request.text);
    const language = detectedArabic ? "ar" : request.language && request.language !== "auto" ? request.language : "en";
    const warnings: string[] = [];
    const processed = detectedArabic
      ? preprocessArabicSpeech(request.text, {
          dialect: request.dialect,
          pronunciationOverrides: request.brandPronunciations,
        }).spokenText
      : request.text.trim();

    const requestedProvider = request.requestedProvider === "auto" ? undefined : request.requestedProvider;
    const qualityProfile = request.qualityProfile || "balanced";
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
    });

    if (requestedProvider) {
      const provider = this.getStrictProvider(requestedProvider);
      if (provider?.isConfigured() && provider.supportsLanguage(language, request.dialect)) {
        if (requestedProvider === "google_cloud_tts" && request.dialect === "egyptian") {
          warnings.push("Google Cloud ar-XA is Arabic - Modern Standard Arabic; Egyptian pronunciation is not specifically verified.");
        }
        return pick(provider, request.voiceId || this.defaultVoiceFor(provider.id as VoiceProviderId), "user_selected_provider");
      }
      warnings.push(`${requestedProvider} is not configured or does not support ${language}.`);
      if (!fallbackAllowed || requestedProvider === "google_cloud_tts" || requestedProvider === "elevenlabs") {
        throw new Error(`Voice provider ${requestedProvider} is unavailable for ${language} and fallback is disabled.`);
      }
    }

    if (language === "ar") {
      if (qualityProfile === "premium" && this.elevenlabsProvider.isConfigured()) {
        return pick(this.elevenlabsProvider, request.voiceId || "MF3mGyEYCl7XYWbV9V6O", "premium_arabic_configured");
      }
      if (
        request.dialect === "msa" &&
        qualityProfile === "balanced" &&
        this.googleCloudTtsProvider.isConfigured()
      ) {
        return pick(this.googleCloudTtsProvider, request.voiceId || this.defaultVoiceFor("google_cloud_tts"), "balanced_msa_google_cloud_configured");
      }
      return pick(this.piperProvider, request.voiceId || process.env.PIPER_AR_VOICE_ID || "ar_JO-kareem-medium", "balanced_local_arabic");
    }

    if (qualityProfile === "premium" && this.elevenlabsProvider.isConfigured()) {
      return pick(this.elevenlabsProvider, request.voiceId || "21m00Tcm4TlvDq8ikWAM", "premium_english_configured");
    }

    return pick(this.kokoroProvider, request.voiceId || "af_heart", "local_english_default");
  }

  private getStrictProvider(providerId: VoiceProviderId): VoiceProvider | undefined {
    if (providerId === "kokoro") return this.kokoroProvider;
    if (providerId === "elevenlabs") return this.elevenlabsProvider;
    if (providerId === "piper") return this.piperProvider;
    if (providerId === "google_cloud_tts") return this.googleCloudTtsProvider;
    return undefined;
  }

  public getProviderStrict(providerId: VoiceProviderId): VoiceProvider | undefined {
    return this.getStrictProvider(providerId);
  }

  private defaultVoiceFor(providerId: VoiceProviderId): string {
    if (providerId === "elevenlabs") return "21m00Tcm4TlvDq8ikWAM";
    if (providerId === "piper") return process.env.PIPER_AR_VOICE_ID || "ar_JO-kareem-medium";
    if (providerId === "google_cloud_tts") return process.env.GOOGLE_CLOUD_TTS_DEFAULT_VOICE || "";
    return "af_heart";
  }

  private resolveVoiceFor(providerId: VoiceProviderId, voiceId?: string): string {
    if (providerId === "piper") {
      const configuredVoice = process.env.PIPER_AR_VOICE_ID || "ar_JO-kareem-medium";
      return voiceId && (voiceId === "ar_JO-kareem-medium" || voiceId === configuredVoice)
        ? voiceId
        : this.defaultVoiceFor("piper");
    }
    if (providerId === "kokoro") {
      return voiceId && voiceId !== "ar_JO-kareem-medium" ? voiceId : "af_heart";
    }
    if (providerId === "google_cloud_tts") {
      return voiceId || this.defaultVoiceFor("google_cloud_tts");
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
    const result = await decision.provider.generateVoice(decision.processedText, decision.voiceId);
    return {
      ...result,
      provider: decision.providerId,
      voiceId: decision.voiceId,
      language: decision.language,
      dialect: decision.dialect,
      processedText: decision.processedText,
      generationMs: result.generationMs || Date.now() - started,
    };
  }

  public async synthesize(request: VoiceRouteRequest): Promise<VoiceAudioResult & { decision: Omit<VoiceRouteDecision, "provider"> }> {
    const decision = this.route(request);
    const started = Date.now();
    const result = await decision.provider.generateVoice(decision.processedText, decision.voiceId);
    const { provider, ...publicDecision } = decision;
    return {
      ...result,
      provider: decision.providerId,
      voiceId: decision.voiceId,
      language: decision.language,
      dialect: decision.dialect,
      processedText: decision.processedText,
      generationMs: result.generationMs || Date.now() - started,
      decision: publicDecision,
    };
  }

  public async listAllVoices(language?: string): Promise<VoiceOption[]> {
    const kokoroVoices = await this.kokoroProvider.listVoices();
    const elevenlabsVoices = await this.elevenlabsProvider.listVoices(language);
    const piperVoices = await this.piperProvider.listVoices(language);
    const googleVoices = await this.googleCloudTtsProvider.listVoices(language === "ar" ? "ar-XA" : language);
    return [...kokoroVoices, ...piperVoices, ...googleVoices, ...elevenlabsVoices];
  }

  public async validateAll(): Promise<VoiceProviderValidationResult[]> {
    return [
      await this.kokoroProvider.validate(),
      await this.piperProvider.validate(),
      await this.googleCloudTtsProvider.validate(),
      await this.elevenlabsProvider.validate(),
    ];
  }
}
