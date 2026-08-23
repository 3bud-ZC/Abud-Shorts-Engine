import fs from "fs-extra";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import cuid from "cuid";
import { defaultPiperConfigPath, defaultPiperModelPath, ensurePiperArabicModel, PIPER_ARABIC_MODEL } from "./piperArabicModel";
import type {
  VoiceAudioResult,
  VoiceCapabilities,
  VoiceOption,
  VoiceProvider,
  VoiceProviderValidationResult,
} from "./types";

function runPiper(
  binaryPath: string,
  modelPath: string,
  configPath: string,
  outputPath: string,
  text: string,
  lengthScale: number,
  sentenceSilence: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      binaryPath,
      [
        "--model",
        modelPath,
        "--config",
        configPath,
        "--output_file",
        outputPath,
        "--length-scale",
        String(lengthScale),
        "--sentence-silence",
        String(sentenceSilence),
      ],
      { timeout: 60000, windowsHide: true },
      (error) => {
        if (error) reject(error);
        else resolve();
      },
    );
    child.stdin?.end(text);
  });
}

export class PiperVoiceProvider implements VoiceProvider {
  public readonly id = "piper";
  public readonly displayName = "Piper TTS (Local Arabic)";
  public readonly tier = "free" as const;

  constructor(
    private binaryPath = process.env.PIPER_BIN || "/opt/piper/bin/piper",
    private arabicModelPath = process.env.PIPER_AR_MODEL_PATH || defaultPiperModelPath(),
    private arabicVoiceId = process.env.PIPER_AR_VOICE_ID || PIPER_ARABIC_MODEL.model,
    private arabicConfigPath = process.env.PIPER_AR_MODEL_CONFIG_PATH || defaultPiperConfigPath(),
    private arabicLengthScale = Number(process.env.PIPER_AR_LENGTH_SCALE || "1.50"),
    private arabicSentenceSilence = Number(process.env.PIPER_AR_SENTENCE_SILENCE || "0.25"),
  ) {}

  public isConfigured(): boolean {
    return Boolean(
      this.binaryPath &&
        this.arabicModelPath &&
        this.arabicConfigPath &&
        fs.existsSync(this.binaryPath) &&
        fs.existsSync(this.arabicModelPath) &&
        fs.existsSync(this.arabicConfigPath),
    );
  }

  public getCapabilities(): VoiceCapabilities {
    return {
      languages: ["ar"],
      dialects: ["msa", "egyptian"],
      supportsLanguageDetection: false,
      supportsWordTimings: false,
      supportsStyles: false,
      supportsPace: false,
      local: true,
      commercialUse: "allowed",
      license: `${PIPER_ARABIC_MODEL.runtimeLicense} runtime; ${PIPER_ARABIC_MODEL.modelLicense} voice model`,
      notes: `${PIPER_ARABIC_MODEL.model} from ${PIPER_ARABIC_MODEL.modelSource}. ${PIPER_ARABIC_MODEL.dialectApplicability}.`,
    };
  }

  public supportsLanguage(language?: string): boolean {
    return language === "ar" || language?.startsWith("ar") || false;
  }

  public async generateVoice(text: string, voiceId = this.arabicVoiceId): Promise<VoiceAudioResult> {
    if (!this.isConfigured()) {
      const provisioned = await ensurePiperArabicModel();
      this.arabicModelPath = provisioned.modelPath;
      this.arabicConfigPath = provisioned.configPath;
    }
    if (!this.isConfigured()) {
      throw new Error("Piper Arabic is not configured. Install piper-tts or set PIPER_BIN to the Piper executable.");
    }

    const started = Date.now();
    const outputPath = path.join(os.tmpdir(), `${cuid()}-${voiceId}.wav`);
    await runPiper(
      this.binaryPath,
      this.arabicModelPath,
      this.arabicConfigPath,
      outputPath,
      text,
      Number.isFinite(this.arabicLengthScale) ? this.arabicLengthScale : 1.50,
      Number.isFinite(this.arabicSentenceSilence) ? this.arabicSentenceSilence : 0.25,
    );
    const buffer = await fs.readFile(outputPath);
    await fs.remove(outputPath);

    const words = text.trim().split(/\s+/).filter(Boolean).length;
    const approxDuration = Math.max(1.2, words / 2.15);

    return {
      audio: buffer,
      audioLength: approxDuration,
      sampleRate: 22050,
      provider: "piper",
      model: PIPER_ARABIC_MODEL.model,
      voiceId,
      language: "ar",
      generationMs: Date.now() - started,
      estimatedCost: 0,
    };
  }

  public async listVoices(language?: string): Promise<VoiceOption[]> {
    if (language && language !== "ar" && !language.startsWith("ar")) {
      return [];
    }
    return [
      {
        id: this.arabicVoiceId,
        name: this.arabicVoiceId,
        provider: "piper",
        tier: "free",
        language: "ar",
        dialect: "msa",
        gender: PIPER_ARABIC_MODEL.gender,
        license: this.getCapabilities().license,
        commercialUse: this.getCapabilities().commercialUse,
      },
    ];
  }

  public async validate(): Promise<VoiceProviderValidationResult> {
    const checkedAt = new Date().toISOString();
    try {
      const provisioned = await ensurePiperArabicModel();
      this.arabicModelPath = provisioned.modelPath;
      this.arabicConfigPath = provisioned.configPath;
    } catch (error) {
      return {
        provider: "Piper Arabic",
        category: "Voice",
        tier: "free",
        configured: Boolean(this.binaryPath),
        healthy: false,
        status: "provider_unavailable",
        message: error instanceof Error ? error.message : String(error),
        checkedAt,
      };
    }
    if (!fs.existsSync(this.binaryPath) || !fs.existsSync(this.arabicModelPath) || !fs.existsSync(this.arabicConfigPath)) {
      return {
        provider: "Piper Arabic",
        category: "Voice",
        tier: "free",
        configured: true,
        healthy: false,
        status: "provider_unavailable",
        message: "Configured Piper binary, Arabic model path, or Arabic model config path does not exist.",
        checkedAt,
      };
    }
    return {
      provider: "Piper Arabic",
      category: "Voice",
      tier: "free",
      configured: true,
      healthy: true,
      status: "healthy",
      message: `Piper local Arabic runtime is configured with ${PIPER_ARABIC_MODEL.model}. License: ${this.getCapabilities().license}`,
      checkedAt,
      latencyMs: 0,
    };
  }
}
