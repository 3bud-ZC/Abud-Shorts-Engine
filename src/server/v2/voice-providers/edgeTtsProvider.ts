import { execFile } from "child_process";
import fs from "fs-extra";
import os from "os";
import path from "path";
import cuid from "cuid";
import type {
  VoiceAudioResult,
  VoiceCapabilities,
  VoiceOption,
  VoiceProvider,
  VoiceProviderValidationResult,
} from "./types";

type EdgeVoiceRow = {
  Name?: string;
  ShortName?: string;
  Gender?: string;
  Locale?: string;
  SuggestedCodec?: string;
  FriendlyName?: string;
};

function edgeCommand(): { command: string; argsPrefix: string[] } {
  const configured = process.env.EDGE_TTS_BIN?.trim();
  if (configured) return { command: configured, argsPrefix: [] };
  return {
    command: process.env.PYTHON_BIN?.trim() || "python",
    argsPrefix: ["-m", "edge_tts"],
  };
}

function execEdge(args: string[], options: { timeoutMs?: number } = {}): Promise<{ stdout: string; stderr: string }> {
  const command = edgeCommand();
  return new Promise((resolve, reject) => {
    execFile(
      command.command,
      [...command.argsPrefix, ...args],
      { timeout: options.timeoutMs || 15000, windowsHide: true, maxBuffer: 1024 * 1024 * 3 },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
      },
    );
  });
}

function normalizeEdgeVoice(row: EdgeVoiceRow): VoiceOption | null {
  const id = row.ShortName || row.Name;
  const language = row.Locale || id?.split("-").slice(0, 2).join("-");
  if (!id || !language) return null;
  const gender = String(row.Gender || "").toLowerCase();
  return {
    id,
    name: row.FriendlyName || row.Name || id,
    provider: "edge_tts",
    tier: "experimental_free_online",
    language,
    dialect: language.toLowerCase() === "ar-eg" ? "egyptian" : language.toLowerCase().startsWith("ar") ? "msa" : undefined,
    gender: gender === "male" ? "male" : gender === "female" ? "female" : undefined,
    voiceFamily: "Microsoft Edge Read Aloud",
    supportsSpeakingRate: true,
    supportsPitch: true,
    supportsVolume: true,
    license: "edge-tts LGPL-3.0; Microsoft Edge online speech service terms apply to generated audio.",
    commercialUse: "unknown",
  };
}

function parseVoices(output: string): VoiceOption[] {
  const trimmed = output.trim();
  if (!trimmed) return [];
  try {
    const json = JSON.parse(trimmed);
    if (Array.isArray(json)) {
      return json.map(normalizeEdgeVoice).filter(Boolean) as VoiceOption[];
    }
  } catch {
    // Fall through to the CLI table parser used by edge-tts.
  }

  const voices: VoiceOption[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const match = line.match(/\b([a-z]{2}-[A-Z]{2}-[A-Za-z0-9]+Neural)\b/);
    if (match) {
      const id = match[1];
      const language = id.split("-").slice(0, 2).join("-");
      const gender = /female/i.test(line) ? "female" : /male/i.test(line) ? "male" : undefined;
      voices.push({
        id,
        name: id,
        provider: "edge_tts",
        tier: "experimental_free_online",
        language,
        dialect: language.toLowerCase() === "ar-eg" ? "egyptian" : language.toLowerCase().startsWith("ar") ? "msa" : undefined,
        gender,
        voiceFamily: "Microsoft Edge Read Aloud",
        supportsSpeakingRate: true,
        supportsPitch: true,
        supportsVolume: true,
        license: "edge-tts LGPL-3.0; Microsoft Edge online speech service terms apply to generated audio.",
        commercialUse: "unknown",
      });
    }
  }
  return voices;
}

function normalizeProsody(value: string | undefined, fallback: string): string {
  const v = (value || fallback).trim();
  if (/^[+-]\d{1,3}%$/.test(v) || /^default$/i.test(v)) return v;
  return fallback;
}

export class EdgeTtsProvider implements VoiceProvider {
  public readonly id = "edge_tts";
  public readonly displayName = "Edge TTS (Experimental Free Online)";
  public readonly tier = "experimental_free_online" as const;

  public isConfigured(): boolean {
    return process.env.EDGE_TTS_ENABLED === "true" || Boolean(process.env.EDGE_TTS_BIN);
  }

  public getCapabilities(): VoiceCapabilities {
    return {
      languages: ["ar-EG", "ar", "en-US", "en-GB"],
      dialects: ["egyptian", "msa"],
      supportsLanguageDetection: false,
      supportsWordTimings: false,
      supportsStyles: false,
      supportsPace: true,
      supportsSpeakingRate: true,
      supportsPitch: true,
      supportsVolume: true,
      local: false,
      costTier: "experimental_free_online",
      commercialUse: "unknown",
      license: "edge-tts LGPL-3.0; Microsoft Edge online speech service terms apply to generated audio.",
      notes: "Optional online provider. It is never treated as local/offline and is only available when explicitly enabled and the edge-tts runtime is installed.",
    };
  }

  public supportsLanguage(language?: string, dialect?: any): boolean {
    if (!language || language === "auto") return true;
    if (language === "ar" && dialect && !["egyptian", "msa", "none"].includes(String(dialect))) return false;
    return language === "ar" || language.startsWith("ar") || language === "en" || language.startsWith("en");
  }

  public async listVoices(language?: string): Promise<VoiceOption[]> {
    if (!this.isConfigured()) return [];
    const result = await execEdge(["--list-voices"], { timeoutMs: 15000 });
    const voices = parseVoices(result.stdout);
    if (!language || language === "auto") return voices;
    const normalized = language.toLowerCase();
    return voices.filter((voice) => {
      const lang = voice.language.toLowerCase();
      if (normalized === "ar") return lang.startsWith("ar");
      if (normalized === "en") return lang.startsWith("en");
      return lang === normalized;
    });
  }

  public async generateVoice(text: string, voiceId: string): Promise<VoiceAudioResult> {
    if (!this.isConfigured()) {
      throw new Error("Edge TTS is not enabled. Set EDGE_TTS_ENABLED=true and install the edge-tts Python package.");
    }
    const started = Date.now();
    const outputPath = path.join(os.tmpdir(), `${cuid()}-edge-tts.mp3`);
    const rate = normalizeProsody(process.env.EDGE_TTS_RATE, "+0%");
    const pitch = normalizeProsody(process.env.EDGE_TTS_PITCH, "+0Hz");
    const volume = normalizeProsody(process.env.EDGE_TTS_VOLUME, "+0%");
    const selectedVoice = voiceId || process.env.EDGE_TTS_DEFAULT_VOICE || "ar-EG-SalmaNeural";

    await execEdge(
      [
        "--voice",
        selectedVoice,
        "--rate",
        rate,
        "--pitch",
        pitch,
        "--volume",
        volume,
        "--text",
        text,
        "--write-media",
        outputPath,
      ],
      { timeoutMs: Number(process.env.EDGE_TTS_TIMEOUT_MS || 45000) },
    );
    const audio = await fs.readFile(outputPath);
    await fs.remove(outputPath);
    const language = selectedVoice.split("-").slice(0, 2).join("-");
    return {
      audio,
      audioLength: Math.max(1.2, text.trim().split(/\s+/).filter(Boolean).length / 2.25),
      provider: "edge_tts",
      model: "rany2/edge-tts",
      voiceId: selectedVoice,
      language,
      dialect: language.toLowerCase() === "ar-eg" ? "egyptian" : language.toLowerCase().startsWith("ar") ? "msa" : undefined,
      processedText: text,
      generationMs: Date.now() - started,
      estimatedCost: 0,
      estimatedCostTier: "experimental_free_online",
    };
  }

  public async validate(): Promise<VoiceProviderValidationResult> {
    const checkedAt = new Date().toISOString();
    if (!this.isConfigured()) {
      return {
        provider: "Edge TTS",
        category: "Voice",
        tier: "experimental_free_online",
        configured: false,
        healthy: false,
        status: "not_configured",
        message: "Edge TTS is optional and disabled. Set EDGE_TTS_ENABLED=true after installing edge-tts.",
        checkedAt,
      };
    }
    const started = Date.now();
    try {
      const voices = await this.listVoices("ar-EG");
      return {
        provider: "Edge TTS",
        category: "Voice",
        tier: "experimental_free_online",
        configured: true,
        healthy: voices.length > 0,
        status: voices.length > 0 ? "healthy" : "provider_unavailable",
        message: voices.length > 0
          ? `Edge TTS listed ${voices.length} ar-EG voice(s).`
          : "Edge TTS runtime responded but no ar-EG voices were listed.",
        checkedAt,
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      return {
        provider: "Edge TTS",
        category: "Voice",
        tier: "experimental_free_online",
        configured: true,
        healthy: false,
        status: "provider_unavailable",
        message: error instanceof Error ? error.message : "Edge TTS validation failed.",
        checkedAt,
        latencyMs: Date.now() - started,
      };
    }
  }
}
