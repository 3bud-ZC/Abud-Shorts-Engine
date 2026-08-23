import { Kokoro } from "../../../short-creator/libraries/Kokoro";
import type {
  VoiceAudioResult,
  VoiceOption,
  VoiceProvider,
  VoiceProviderValidationResult,
} from "./types";
import { KokoroVoiceProvider } from "./kokoroVoiceProvider";
import { ElevenLabsVoiceProvider } from "./elevenlabsVoiceProvider";

export class VoiceRegistry {
  private kokoroProvider: KokoroVoiceProvider;
  private elevenlabsProvider: ElevenLabsVoiceProvider;

  constructor(kokoro: Kokoro, elevenlabsApiKey?: string) {
    this.kokoroProvider = new KokoroVoiceProvider(kokoro);
    this.elevenlabsProvider = new ElevenLabsVoiceProvider(
      elevenlabsApiKey || process.env.ELEVENLABS_API_KEY,
    );
  }

  public getProvider(providerId?: string): VoiceProvider {
    if (providerId === "elevenlabs" && this.elevenlabsProvider.isConfigured()) {
      return this.elevenlabsProvider;
    }
    return this.kokoroProvider;
  }

  public async generateVoice(
    text: string,
    voiceId: string,
    providerId?: string,
  ): Promise<VoiceAudioResult> {
    const provider = this.getProvider(providerId);
    try {
      return await provider.generateVoice(text, voiceId);
    } catch (error) {
      if (provider.id !== "kokoro") {
        // Fall back to local Kokoro if premium voice provider fails
        return await this.kokoroProvider.generateVoice(text, "af_heart");
      }
      throw error;
    }
  }

  public async listAllVoices(language?: string): Promise<VoiceOption[]> {
    const kokoroVoices = await this.kokoroProvider.listVoices();
    const elevenlabsVoices = await this.elevenlabsProvider.listVoices(language);
    return [...kokoroVoices, ...elevenlabsVoices];
  }

  public async validateAll(): Promise<VoiceProviderValidationResult[]> {
    return [
      await this.kokoroProvider.validate(),
      await this.elevenlabsProvider.validate(),
    ];
  }
}
