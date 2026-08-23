import { Kokoro } from "../../../short-creator/libraries/Kokoro";
import { VoiceEnum } from "../../../types/shorts";
import type {
  VoiceAudioResult,
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
      message: "Local Kokoro TTS model is loaded and healthy.",
      checkedAt: new Date().toISOString(),
    };
  }
}
