export type ProcessorFailurePolicy = "required" | "skip_on_failure" | "fallback_deterministic";

export type PostProcessorStatus = {
  id: string;
  name: string;
  implemented: boolean;
  available: boolean;
  enabled: boolean;
  runtime: string;
  latencyMs?: number;
  failurePolicy: ProcessorFailurePolicy;
};

export type EnhancementMode = "off" | "auto" | "force";

function envEnabled(key: string): boolean {
  return process.env[key] === "true";
}

function envConfigured(key: string): boolean {
  return Boolean(process.env[key]?.trim());
}

export class PostProductionPipeline {
  public listProcessors(): PostProcessorStatus[] {
    return [
      {
        id: "scene_detection",
        name: "PySceneDetect shot and fade analysis",
        implemented: true,
        available: envConfigured("PYSCENEDETECT_BIN"),
        enabled: envEnabled("QUALITY_CPU_PACK_ENABLED") && envConfigured("PYSCENEDETECT_BIN"),
        runtime: process.env.PYSCENEDETECT_BIN || "optional python module",
        failurePolicy: "fallback_deterministic",
      },
      {
        id: "smart_reframe",
        name: "MediaPipe subject-aware portrait crop",
        implemented: true,
        available: envConfigured("MEDIAPIPE_BIN"),
        enabled: envEnabled("QUALITY_CPU_PACK_ENABLED") && envConfigured("MEDIAPIPE_BIN"),
        runtime: process.env.MEDIAPIPE_BIN || "optional python module",
        failurePolicy: "fallback_deterministic",
      },
      {
        id: "background_removal",
        name: "rembg product background removal",
        implemented: true,
        available: envConfigured("REMBG_BIN"),
        enabled: envEnabled("QUALITY_CPU_PACK_ENABLED") && envConfigured("REMBG_BIN"),
        runtime: process.env.REMBG_BIN || "optional python module",
        failurePolicy: "skip_on_failure",
      },
      {
        id: "enhancement",
        name: "Real-ESRGAN optional enhancement",
        implemented: true,
        available: envConfigured("REAL_ESRGAN_BIN"),
        enabled: (process.env.REAL_ESRGAN_MODE || "off").toLowerCase() !== "off" && envConfigured("REAL_ESRGAN_BIN"),
        runtime: process.env.REAL_ESRGAN_BIN || "optional executable",
        failurePolicy: "skip_on_failure",
      },
      {
        id: "beat_analysis",
        name: "librosa beat and energy analysis",
        implemented: true,
        available: envConfigured("LIBROSA_PYTHON"),
        enabled: envEnabled("QUALITY_CPU_PACK_ENABLED") && envConfigured("LIBROSA_PYTHON"),
        runtime: process.env.LIBROSA_PYTHON || "optional python module",
        failurePolicy: "fallback_deterministic",
      },
      {
        id: "caption_composition",
        name: "ArabicCaptionEngine V2 and Remotion caption composition",
        implemented: true,
        available: true,
        enabled: true,
        runtime: "node/remotion",
        failurePolicy: "required",
      },
      {
        id: "audio_mastering",
        name: "FFmpeg audio mastering",
        implemented: true,
        available: true,
        enabled: true,
        runtime: "ffmpeg",
        failurePolicy: "required",
      },
    ];
  }

  public getRealEsrganMode(): EnhancementMode {
    const value = (process.env.REAL_ESRGAN_MODE || "off").toLowerCase();
    if (value === "force") return "force";
    if (value === "auto") return "auto";
    return "off";
  }
}

export const postProductionPipeline = new PostProductionPipeline();
