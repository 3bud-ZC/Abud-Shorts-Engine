import axios from "axios";
import { GoogleAuth } from "google-auth-library";
import type { OAuth2Client } from "google-auth-library";
import type {
  VoiceAudioResult,
  VoiceCapabilities,
  VoiceOption,
  VoiceProvider,
  VoiceProviderValidationResult,
} from "./types";

const GOOGLE_TTS_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const GOOGLE_TTS_BASE_URL = "https://texttospeech.googleapis.com/v1";
const DEFAULT_LANGUAGE_CODE = "ar-XA";
const DEFAULT_SAMPLE_RATE = 24000;

type GoogleVoice = {
  languageCodes?: string[];
  name?: string;
  ssmlGender?: "MALE" | "FEMALE" | "NEUTRAL" | string;
  naturalSampleRateHertz?: number;
};

function hasUsableCredentialHint(): boolean {
  return Boolean(
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      process.env.GOOGLE_CLOUD_TTS_CREDENTIALS_JSON ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCLOUD_PROJECT ||
      process.env.GOOGLE_CLOUD_PROJECT_ID,
  );
}

export function escapeSsmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function parseGoogleVoiceFamily(voiceName: string): string {
  if (/chirp\s*3|chirp3|chirp[-_]?hd/i.test(voiceName)) return "Chirp 3 HD";
  if (/wavenet/i.test(voiceName)) return "WaveNet";
  if (/standard/i.test(voiceName)) return "Standard";
  if (/neural2/i.test(voiceName)) return "Neural2";
  if (/studio/i.test(voiceName)) return "Studio";
  return "Google Cloud TTS";
}

export function normalizeGoogleVoice(voice: GoogleVoice, language = DEFAULT_LANGUAGE_CODE): VoiceOption | null {
  if (!voice.name) return null;
  const languageCodes = voice.languageCodes || [];
  if (language && languageCodes.length > 0 && !languageCodes.includes(language)) return null;
  const gender =
    voice.ssmlGender === "MALE" ? "male" : voice.ssmlGender === "FEMALE" ? "female" : undefined;
  const voiceFamily = parseGoogleVoiceFamily(voice.name);
  return {
    id: voice.name,
    name: voice.name,
    provider: "google_cloud_tts",
    tier: "cloud_free_tier",
    language: languageCodes[0] || language,
    dialect: "msa",
    gender,
    voiceFamily,
    sampleRate: voice.naturalSampleRateHertz || DEFAULT_SAMPLE_RATE,
    supportsSSML: true,
    supportsSpeakingRate: true,
    supportsPitch: true,
    license: "Google Cloud Text-to-Speech service terms; generated audio subject to configured account terms.",
    commercialUse: "allowed",
  };
}

export function buildGoogleSsml(text: string, speakingRate = 1): string {
  const escaped = escapeSsmlText(text.trim());
  const safeRate = Number.isFinite(speakingRate)
    ? Math.min(1.25, Math.max(0.75, speakingRate))
    : 1;
  const ratePercent = Math.round(safeRate * 100);
  const withLinePauses = escaped.replace(/\r?\n+/g, '<break time="250ms"/>');
  return `<speak><prosody rate="${ratePercent}%">${withLinePauses}</prosody></speak>`;
}

export class GoogleCloudTtsProvider implements VoiceProvider {
  public readonly id = "google_cloud_tts";
  public readonly displayName = "Google Cloud Text-to-Speech";
  public readonly tier = "cloud_free_tier" as const;

  constructor(private readonly authFactory?: () => GoogleAuth) {}

  public isConfigured(): boolean {
    return hasUsableCredentialHint();
  }

  public getCapabilities(): VoiceCapabilities {
    return {
      languages: [DEFAULT_LANGUAGE_CODE],
      dialects: ["msa"],
      supportsLanguageDetection: false,
      supportsWordTimings: false,
      supportsStyles: false,
      supportsPace: true,
      supportsSSML: true,
      supportsSpeakingRate: true,
      supportsPitch: true,
      local: false,
      costTier: "cloud_free_tier",
      commercialUse: "allowed",
      license: "Google Cloud Text-to-Speech service terms; requires a configured Google Cloud account.",
      notes:
        "Arabic support is exposed as ar-XA (Arabic - Modern Standard Arabic). Billing may be required and usage above Google's free monthly allowance may incur charges.",
    };
  }

  public supportsLanguage(language?: string, dialect?: any): boolean {
    if (dialect && dialect !== "none" && dialect !== "msa") return false;
    return !language || language === "auto" || language === "ar" || language === DEFAULT_LANGUAGE_CODE;
  }

  public async listVoices(language = DEFAULT_LANGUAGE_CODE): Promise<VoiceOption[]> {
    if (!this.isConfigured()) return [];
    const token = await this.getAccessToken();
    const response = await axios.get(`${GOOGLE_TTS_BASE_URL}/voices`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { languageCode: language === "ar" ? DEFAULT_LANGUAGE_CODE : language },
      timeout: 10000,
    });
    const voices = Array.isArray(response.data?.voices) ? response.data.voices : [];
    return voices
      .map((voice: GoogleVoice) => normalizeGoogleVoice(voice, language === "ar" ? DEFAULT_LANGUAGE_CODE : language))
      .filter(Boolean) as VoiceOption[];
  }

  public async generateVoice(text: string, voiceId?: string): Promise<VoiceAudioResult> {
    if (!this.isConfigured()) {
      throw new Error(
        "Google Cloud TTS is not configured. Set GOOGLE_APPLICATION_CREDENTIALS or configure Application Default Credentials.",
      );
    }
    const started = Date.now();
    const voice = voiceId || (await this.resolveDefaultVoice());
    if (!voice) {
      throw new Error("Google Cloud TTS did not return an ar-XA voice. Configure a valid Google Cloud TTS voice.");
    }
    const token = await this.getAccessToken();
    const speakingRate = process.env.GOOGLE_CLOUD_TTS_SPEAKING_RATE
      ? Number(process.env.GOOGLE_CLOUD_TTS_SPEAKING_RATE)
      : 1;
    const pitch = process.env.GOOGLE_CLOUD_TTS_PITCH ? Number(process.env.GOOGLE_CLOUD_TTS_PITCH) : 0;
    const sampleRate = process.env.GOOGLE_CLOUD_TTS_SAMPLE_RATE
      ? Number(process.env.GOOGLE_CLOUD_TTS_SAMPLE_RATE)
      : DEFAULT_SAMPLE_RATE;

    const response = await axios.post(
      `${GOOGLE_TTS_BASE_URL}/text:synthesize`,
      {
        input: { ssml: buildGoogleSsml(text, speakingRate) },
        voice: { languageCode: DEFAULT_LANGUAGE_CODE, name: voice },
        audioConfig: {
          audioEncoding: "MP3",
          speakingRate: Number.isFinite(speakingRate) ? Math.min(1.25, Math.max(0.75, speakingRate)) : 1,
          pitch: Number.isFinite(pitch) ? Math.min(8, Math.max(-8, pitch)) : 0,
          sampleRateHertz: Number.isFinite(sampleRate) ? sampleRate : DEFAULT_SAMPLE_RATE,
        },
      },
      {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        timeout: 30000,
      },
    );

    if (!response.data?.audioContent) {
      throw new Error("Google Cloud TTS response did not include audio content.");
    }
    const buffer = Buffer.from(response.data.audioContent, "base64");
    return {
      audio: buffer,
      audioLength: Math.max(1.2, text.trim().split(/\s+/).filter(Boolean).length / 2.25),
      sampleRate: Number.isFinite(sampleRate) ? sampleRate : DEFAULT_SAMPLE_RATE,
      provider: "google_cloud_tts",
      model: parseGoogleVoiceFamily(voice),
      voiceFamily: parseGoogleVoiceFamily(voice),
      voiceId: voice,
      language: DEFAULT_LANGUAGE_CODE,
      dialect: "msa",
      processedText: text,
      generationMs: Date.now() - started,
      estimatedCostTier: "cloud_free_tier",
    };
  }

  public async validate(): Promise<VoiceProviderValidationResult> {
    const checkedAt = new Date().toISOString();
    if (!this.isConfigured()) {
      return {
        provider: "Google Cloud TTS",
        category: "Voice",
        tier: "cloud_free_tier",
        configured: false,
        healthy: false,
        status: "not_configured",
        message: "Google Cloud credentials are not configured. Use ADC or GOOGLE_APPLICATION_CREDENTIALS.",
        checkedAt,
      };
    }
    const started = Date.now();
    try {
      const voices = await this.listVoices(DEFAULT_LANGUAGE_CODE);
      return {
        provider: "Google Cloud TTS",
        category: "Voice",
        tier: "cloud_free_tier",
        configured: true,
        healthy: voices.length > 0,
        status: voices.length > 0 ? "healthy" : "provider_unavailable",
        message:
          voices.length > 0
            ? `Google Cloud TTS listed ${voices.length} ar-XA voice(s).`
            : "Google Cloud TTS is reachable but returned no ar-XA voices.",
        checkedAt,
        latencyMs: Date.now() - started,
      };
    } catch (err: any) {
      const status = err?.response?.status;
      return {
        provider: "Google Cloud TTS",
        category: "Voice",
        tier: "cloud_free_tier",
        configured: true,
        healthy: false,
        status: status === 401 || status === 403 ? "invalid_credentials" : "provider_unavailable",
        message:
          status === 401 || status === 403
            ? "Google Cloud TTS credentials were rejected."
            : err?.message || "Google Cloud TTS validation failed.",
        checkedAt,
        latencyMs: Date.now() - started,
      };
    }
  }

  private async resolveDefaultVoice(): Promise<string | undefined> {
    if (process.env.GOOGLE_CLOUD_TTS_DEFAULT_VOICE) {
      return process.env.GOOGLE_CLOUD_TTS_DEFAULT_VOICE;
    }
    const voices = await this.listVoices(DEFAULT_LANGUAGE_CODE);
    return voices[0]?.id;
  }

  private buildAuth(): GoogleAuth {
    if (this.authFactory) return this.authFactory();
    const projectId =
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCLOUD_PROJECT ||
      process.env.GOOGLE_CLOUD_PROJECT_ID;
    if (process.env.GOOGLE_CLOUD_TTS_CREDENTIALS_JSON) {
      const credentials = JSON.parse(process.env.GOOGLE_CLOUD_TTS_CREDENTIALS_JSON);
      return new GoogleAuth({ credentials, projectId, scopes: [GOOGLE_TTS_SCOPE] });
    }
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      return new GoogleAuth({
        keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
        projectId,
        scopes: [GOOGLE_TTS_SCOPE],
      });
    }
    return new GoogleAuth({ projectId, scopes: [GOOGLE_TTS_SCOPE] });
  }

  private async getAccessToken(): Promise<string> {
    const auth = this.buildAuth();
    const client = (await auth.getClient()) as OAuth2Client;
    const tokenResponse = await client.getAccessToken();
    const token = typeof tokenResponse === "string" ? tokenResponse : tokenResponse?.token;
    if (!token) {
      throw new Error("Google Cloud authentication did not return an access token.");
    }
    return token;
  }
}
