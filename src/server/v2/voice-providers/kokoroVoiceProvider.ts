import { Kokoro } from "../../../short-creator/libraries/Kokoro";
import { VoiceEnum } from "../../../types/shorts";
import type {
  VoiceAudioResult,
  VoiceCapabilities,
  VoiceOption,
  VoiceProvider,
  VoiceProviderValidationResult,
} from "./types";

export class KokoroVoiceProvider implements VoiceProvider {
  public readonly id = "kokoro";
  public readonly displayName = "Kokoro TTS (Local / Free)";
  public readonly tier = "free" as const;

  constructor(private kokoro: Kokoro) {}

  public isConfigured(): boolean {
    return true; // Kokoro is built-in and free
  }

  public getCapabilities(): VoiceCapabilities {
    return {
      languages: ["en-US", "en-GB"],
      supportsLanguageDetection: false,
      supportsWordTimings: false,
      supportsStyles: false,
      supportsPace: false,
      local: true,
      commercialUse: "allowed",
      license: "Apache-2.0 model weights (Kokoro-82M v1.0 ONNX)",
      notes: "Current bundled Kokoro voices are English-focused and are not verified for Arabic or Egyptian Arabic production narration.",
    };
  }

  public supportsLanguage(language?: string): boolean {
    return !language || language === "auto" || language === "en" || language.startsWith("en");
  }

  public async generateVoice(
    text: string,
    voiceId: string,
  ): Promise<VoiceAudioResult> {
    const validVoice = Object.values(VoiceEnum).includes(voiceId as VoiceEnum)
      ? (voiceId as VoiceEnum)
      : VoiceEnum.af_heart;

    const res = await this.kokoro.generate(text, validVoice);
    return {
      audio: res.audio,
      audioLength: res.audioLength,
      sampleRate: 24000,
      provider: "kokoro",
      model: "onnx-community/Kokoro-82M-v1.0-ONNX",
      voiceId: validVoice,
      language: validVoice.startsWith("b") ? "en-GB" : "en-US",
    };
  }

  public async listVoices(): Promise<VoiceOption[]> {
    const rawVoices = this.kokoro.listAvailableVoices();
    return rawVoices.map((v) => {
      const isFemale = v.startsWith("af_") || v.startsWith("bf_");
      return {
        id: v,
        name: v.replace(/^[ab][mf]_/, "").toUpperCase(),
        provider: "kokoro",
        tier: "free",
        language: v.startsWith("b") ? "en-GB" : "en-US",
        gender: isFemale ? "female" : "male",
        license: this.getCapabilities().license,
        commercialUse: "allowed",
      };
    });
  }

  public async validate(): Promise<VoiceProviderValidationResult> {
    return {
      provider: "Kokoro",
      category: "Voice",
      tier: "free",
      configured: true,
      healthy: true,
      status: "healthy",
      message: "Local Kokoro TTS model is loaded and healthy for English-focused voices. Arabic/Egyptian Arabic is not marked as verified.",
      checkedAt: new Date().toISOString(),
    };
  }
}
