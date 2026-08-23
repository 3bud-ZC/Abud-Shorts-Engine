import axios from "axios";
import { Readable } from "stream";
import type {
  VoiceAudioResult,
  VoiceCapabilities,
  VoiceOption,
  VoiceProvider,
  VoiceProviderValidationResult,
} from "./types";

export class ElevenLabsVoiceProvider implements VoiceProvider {
  public readonly id = "elevenlabs";
  public readonly displayName = "ElevenLabs Multilingual & Arabic (Premium)";
  public readonly tier = "premium" as const;

  constructor(private apiKey?: string) {}

  public isConfigured(): boolean {
    const key = this.apiKey || process.env.ELEVENLABS_API_KEY;
    return Boolean(key && key.trim().length > 10 && !key.includes("your_"));
  }

  public getCapabilities(): VoiceCapabilities {
    return {
      languages: ["multilingual", "ar", "en"],
      dialects: ["egyptian", "msa"],
      supportsLanguageDetection: true,
      supportsWordTimings: false,
      supportsStyles: true,
      supportsPace: true,
      local: false,
      commercialUse: "allowed",
      license: "Commercial SaaS provider terms; requires configured ElevenLabs account.",
      notes: "Premium provider. Do not use unless explicitly selected/configured by the operator.",
    };
  }

  public supportsLanguage(language?: string): boolean {
    return !language || language === "auto" || language === "ar" || language === "en" || language === "multilingual";
  }

  public async generateVoice(
    text: string,
    voiceId: string = "21m00Tcm4TlvDq8ikWAM", // Default Rachel
  ): Promise<VoiceAudioResult> {
    if (!this.isConfigured()) {
      throw new Error("ElevenLabs is not configured. Missing ELEVENLABS_API_KEY.");
    }
    const key = this.apiKey || process.env.ELEVENLABS_API_KEY;

    const response = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      },
      {
        headers: {
          "xi-api-key": key,
          "Content-Type": "application/json",
        },
        responseType: "arraybuffer",
        timeout: 20000,
      },
    );

    const buffer = Buffer.from(response.data);
    // Approximate length: ~130 words/minute or ~15 chars/second
    const approxDuration = Math.max(text.length / 14, 1.5);

    const stream = new Readable();
    stream.push(buffer);
    stream.push(null);

    return {
      audio: stream,
      audioLength: approxDuration,
      sampleRate: 44100,
      provider: "elevenlabs",
      model: "eleven_multilingual_v2",
      voiceId,
      language: "multilingual",
      estimatedCost: text.length * 0.00003,
    };
  }

  public async listVoices(language?: string): Promise<VoiceOption[]> {
    const premiumVoices: VoiceOption[] = [
      {
        id: "21m00Tcm4TlvDq8ikWAM",
        name: "Rachel (Multilingual)",
        provider: "elevenlabs",
        tier: "premium",
        language: "multilingual",
        gender: "female",
        license: this.getCapabilities().license,
        commercialUse: "allowed",
      },
      {
        id: "AZnzlk1XvdvUeBnXmlld",
        name: "Domi (Multilingual)",
        provider: "elevenlabs",
        tier: "premium",
        language: "multilingual",
        gender: "female",
        license: this.getCapabilities().license,
        commercialUse: "allowed",
      },
      {
        id: "EXAVITQu4vr4xnSDxMaL",
        name: "Bella (Multilingual)",
        provider: "elevenlabs",
        tier: "premium",
        language: "multilingual",
        gender: "female",
        license: this.getCapabilities().license,
        commercialUse: "allowed",
      },
      {
        id: "ErXwobaYiN019PkySvjV",
        name: "Antoni (Multilingual)",
        provider: "elevenlabs",
        tier: "premium",
        language: "multilingual",
        gender: "male",
        license: this.getCapabilities().license,
        commercialUse: "allowed",
      },
      {
        id: "MF3mGyEYCl7XYWbV9V6O",
        name: "Tariq (Arabic Natural)",
        provider: "elevenlabs",
        tier: "premium",
        language: "ar",
        dialect: "egyptian",
        gender: "male",
        license: this.getCapabilities().license,
        commercialUse: "allowed",
      },
    ];

    if (language === "ar") {
      return premiumVoices.filter((v) => v.language === "ar" || v.language === "multilingual");
    }
    return premiumVoices;
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
        message: "ELEVENLABS_API_KEY is not configured.",
        checkedAt: new Date().toISOString(),
      };
    }

    const key = this.apiKey || process.env.ELEVENLABS_API_KEY;
    const start = Date.now();
    try {
      const response = await axios.get("https://api.elevenlabs.io/v1/user", {
        headers: { "xi-api-key": key },
        timeout: 8000,
      });
      if (response.status === 200) {
        return {
          provider: "ElevenLabs",
          category: "Voice",
          tier: "premium",
          configured: true,
          healthy: true,
          status: "healthy",
          message: "ElevenLabs API connection is healthy.",
          checkedAt: new Date().toISOString(),
          latencyMs: Date.now() - start,
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
      if (err.response?.status === 401 || err.response?.status === 403) {
        return {
          provider: "ElevenLabs",
          category: "Voice",
          tier: "premium",
          configured: true,
          healthy: false,
          status: "invalid_credentials",
          message: "Invalid ElevenLabs API key.",
          checkedAt: new Date().toISOString(),
        };
      }
      return {
        provider: "ElevenLabs",
        category: "Voice",
        tier: "premium",
        configured: true,
        healthy: false,
        status: "provider_unavailable",
        message: err.message || "ElevenLabs connection failed.",
        checkedAt: new Date().toISOString(),
      };
    }
  }
}
