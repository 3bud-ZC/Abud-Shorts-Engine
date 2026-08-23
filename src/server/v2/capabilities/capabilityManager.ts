import os from "os";
import fs from "fs-extra";
import path from "path";
import { execSync } from "child_process";
import { ARABIC_ELEVENLABS_REQUIRED_MESSAGE } from "../voice-providers/types";
import type {
  ArabicProductionReadiness,
  CapabilityId,
  CapabilityPackId,
  CapabilityPackStatus,
  CapabilityStatus,
  HardwareInfo,
  ModeReadiness,
} from "./types";

export class CapabilityManager {
  private enabledOverrides: Map<CapabilityId, boolean> = new Map();
  private cachedHardwareInfo: HardwareInfo | null = null;
  private lastHardwareCheck: number = 0;

  constructor() {
    // Default enabled state from env vars if present
    if (process.env.QUALITY_CPU_PACK_ENABLED === "true") {
      this.enabledOverrides.set("scene_detection", true);
      this.enabledOverrides.set("background_removal", true);
      this.enabledOverrides.set("beat_analysis", true);
    }
    if (process.env.MOTION_PACK_ENABLED === "true") {
      this.enabledOverrides.set("motion_canvas", true);
    }
    if (process.env.EDGE_TTS_ENABLED === "true") {
      this.enabledOverrides.set("edge_tts", true);
    }
  }

  public getHardwareInfo(): HardwareInfo {
    const now = Date.now();
    if (this.cachedHardwareInfo && now - this.lastHardwareCheck < 60000) {
      return this.cachedHardwareInfo;
    }

    let hasGpu = false;
    let gpuName: string | undefined;
    let vramMb: number | undefined;
    let cudaAvailable = false;

    try {
      const smi = execSync("nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits", {
        timeout: 3000,
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      }).toString().trim();

      if (smi) {
        const [name, mem] = smi.split(",").map((s) => s.trim());
        hasGpu = true;
        gpuName = name || "NVIDIA GPU";
        vramMb = mem ? parseInt(mem, 10) : undefined;
        cudaAvailable = true;
      }
    } catch {
      // No nvidia-smi on PATH or no NVIDIA GPU
    }

    const cpus = os.cpus();
    const totalMemoryBytes = os.totalmem();
    let freeDiskBytes = 10 * 1024 * 1024 * 1024; // Default 10GB estimation

    try {
      if (process.platform === "win32") {
        const stdout = execSync("wmic logicaldisk get FreeSpace,DeviceID /format:csv", {
          timeout: 3000,
          windowsHide: true,
          stdio: ["ignore", "pipe", "ignore"],
        }).toString();
        const lines = stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
        for (const line of lines) {
          const parts = line.split(",").map((p) => p.trim());
          if (parts.length >= 2 && !isNaN(Number(parts[parts.length - 1]))) {
            const free = Number(parts[parts.length - 1]);
            if (free > 0) {
              freeDiskBytes = free;
              break;
            }
          }
        }
      }
    } catch {
      // Fallback
    }

    this.cachedHardwareInfo = {
      hasGpu,
      hasNvidiaGpu: hasGpu,
      gpuName,
      vramMb,
      vramGb: vramMb ? Math.round(vramMb / 1024) : undefined,
      cudaAvailable,
      dockerGpuAccess: cudaAvailable,
      cpuCores: cpus.length,
      freeDiskBytes,
      totalMemoryBytes,
      totalMemoryGb: Math.round(totalMemoryBytes / (1024 * 1024 * 1024)),
      platform: process.platform,
    };
    this.lastHardwareCheck = now;
    return this.cachedHardwareInfo;
  }

  public getCapability(id: string): CapabilityStatus | undefined {
    return this.listCapabilities().find((c) => c.id.toLowerCase() === id.toLowerCase());
  }

  public isPythonQualityVenvInstalled(): boolean {
    const paths = [
      path.resolve(process.cwd(), ".venv-quality/Scripts/python.exe"),
      path.resolve(process.cwd(), ".venv-quality/bin/python"),
      path.resolve(process.cwd(), "../.venv-quality/Scripts/python.exe"),
      process.env.QUALITY_PYTHON_BIN,
    ].filter(Boolean) as string[];

    return paths.some((p) => fs.existsSync(p));
  }

  public getQualityPythonPath(): string | null {
    const candidates = [
      path.resolve(process.cwd(), ".venv-quality/Scripts/python.exe"),
      path.resolve(process.cwd(), ".venv-quality/bin/python"),
      path.resolve(process.cwd(), "../.venv-quality/Scripts/python.exe"),
      process.env.QUALITY_PYTHON_BIN,
      process.env.PYTHON_BIN,
      // Shared Python runtime in the container image (formerly /opt/piper).
      "/opt/pyruntime/bin/python",
      "/opt/piper/bin/python",
      "/usr/bin/python3",
      "/usr/bin/python",
    ].filter(Boolean) as string[];

    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return process.platform === "win32" ? "python" : "python3";
  }

  public listCapabilities(): CapabilityStatus[] {
    const now = new Date().toISOString();
    const hasQualityVenv = this.isPythonQualityVenvInstalled();
    const qualityBin = this.getQualityPythonPath();
    const hw = this.getHardwareInfo();

    const capabilities: CapabilityStatus[] = [
      {
        id: "scene_detection",
        name: "PySceneDetect Shot Boundary & Cut Analysis",
        pack: "QUALITY_CPU",
        implemented: true,
        installed: hasQualityVenv || Boolean(process.env.PYSCENEDETECT_BIN),
        enabled: this.enabledOverrides.get("scene_detection") ?? true,
        healthy: hasQualityVenv || Boolean(process.env.PYSCENEDETECT_BIN),
        version: "0.7.1",
        runtime: qualityBin ? `${qualityBin} (PySceneDetect)` : "scenedetect CLI / Python 3.11",
        hardwareRequired: "Standard CPU",
        diskRequirement: "~80 MB",
        license: "BSD-3-Clause",
        lastCheck: now,
      },
      {
        id: "background_removal",
        name: "rembg Product Background Removal (u2netp ONNX)",
        pack: "QUALITY_CPU",
        implemented: true,
        installed: hasQualityVenv || Boolean(process.env.REMBG_BIN),
        enabled: this.enabledOverrides.get("background_removal") ?? true,
        healthy: hasQualityVenv || Boolean(process.env.REMBG_BIN),
        version: "2.0.81",
        runtime: qualityBin ? `${qualityBin} (rembg / onnxruntime)` : "rembg Python / ONNX runtime",
        hardwareRequired: "Standard CPU (ONNX)",
        diskRequirement: "~5 MB (u2netp model)",
        license: "MIT",
        lastCheck: now,
      },
      {
        id: "beat_analysis",
        name: "librosa Beat Tracking & Energy Envelope Analysis",
        pack: "QUALITY_CPU",
        implemented: true,
        installed: hasQualityVenv || Boolean(process.env.LIBROSA_PYTHON),
        enabled: this.enabledOverrides.get("beat_analysis") ?? true,
        healthy: hasQualityVenv || Boolean(process.env.LIBROSA_PYTHON),
        version: "0.11.0",
        runtime: qualityBin ? `${qualityBin} (librosa / soundfile)` : "librosa Python module",
        hardwareRequired: "Standard CPU",
        diskRequirement: "~60 MB",
        license: "ISC",
        lastCheck: now,
      },
      {
        id: "image_upscale",
        name: "Real-ESRGAN / High-Quality Image Enhancement",
        pack: "QUALITY_CPU",
        implemented: true,
        installed: true,
        enabled: this.enabledOverrides.get("image_upscale") ?? (process.env.REAL_ESRGAN_MODE !== "off"),
        healthy: true,
        version: "0.3.0",
        runtime: "Pillow High-Quality Lanczos / Real-ESRGAN bridge",
        hardwareRequired: "Standard CPU / Optional CUDA",
        diskRequirement: "~20 MB",
        license: "BSD-3-Clause",
        lastCheck: now,
      },
      {
        id: "motion_canvas",
        name: "Motion Canvas & Programmatic Animation Engine",
        pack: "MOTION",
        implemented: true,
        installed: true,
        enabled: this.enabledOverrides.get("motion_canvas") ?? true,
        healthy: true,
        version: "2.16.0",
        runtime: "Node.js / Cairo-compatible Remotion Motion Canvas",
        hardwareRequired: "Standard CPU",
        diskRequirement: "~40 MB",
        license: "MIT",
        lastCheck: now,
      },
      {
        id: "edge_tts",
        name: "Edge TTS (Experimental Free Online Voice Provider)",
        pack: "QUALITY_CPU",
        implemented: true,
        installed: hasQualityVenv || Boolean(process.env.EDGE_TTS_BIN),
        enabled: this.enabledOverrides.get("edge_tts") ?? true,
        healthy: hasQualityVenv || Boolean(process.env.EDGE_TTS_BIN),
        version: "7.2.8",
        runtime: qualityBin ? `${qualityBin} (edge-tts)` : "edge-tts Python module",
        hardwareRequired: "Internet Connection",
        diskRequirement: "~15 MB",
        license: "LGPL-3.0 (Microsoft Edge speech terms apply)",
        lastCheck: now,
      },
      {
        id: "mediapipe",
        name: "MediaPipe Subject & Face Reframe",
        pack: "QUALITY_CPU",
        implemented: false,
        installed: false,
        enabled: false,
        healthy: false,
        version: "N/A",
        runtime: "Not installed in CPU baseline",
        hardwareRequired: "CPU / OpenCV",
        diskRequirement: "~120 MB",
        license: "Apache-2.0",
        lastCheck: now,
        failureReason: "MediaPipe not bundled in base CPU container; deterministic smart crop V2 active as reliable fallback",
      },
      {
        id: "ollama",
        name: "Ollama Local Content AI (LLM)",
        pack: "CORE",
        implemented: true,
        installed: false,
        enabled: false,
        healthy: false,
        version: "Optional",
        runtime: "http://localhost:11434",
        hardwareRequired: "8GB+ RAM",
        diskRequirement: "~2-4 GB per model (e.g. Qwen2.5-3B)",
        license: "Operator Model License (Apache-2.0 / MIT)",
        lastCheck: now,
        failureReason: "Ollama service not running on localhost:11434 (Deterministic Local Content AI active as fail-safe)",
      },
      {
        id: "comfyui",
        name: "ComfyUI Local Generative Sidecar",
        pack: "AI_GPU",
        implemented: true,
        installed: false,
        enabled: false,
        healthy: false,
        version: "0.3.0",
        runtime: "Isolated Docker GPU sidecar",
        hardwareRequired: hw.hasGpu ? `${hw.gpuName} (${Math.round((hw.vramMb || 0) / 1024)}GB VRAM detected)` : "NVIDIA GPU (CUDA)",
        diskRequirement: "~5-10 GB",
        license: "GPL-3.0",
        lastCheck: now,
        failureReason: hw.hasGpu ? "AI GPU pack not installed (GPU detected & compatible)" : "Unavailable on current hardware (No NVIDIA GPU detected)",
      },
      {
        id: "wan22",
        name: "Wan2.2 Generative Video Pipeline",
        pack: "AI_GPU",
        implemented: true,
        installed: false,
        enabled: false,
        healthy: false,
        version: "2.2",
        runtime: "ComfyUI / PyTorch CUDA",
        hardwareRequired: ">= 12GB VRAM NVIDIA GPU",
        diskRequirement: "~14 GB checkpoint",
        license: "Wan2.2 License Agreement",
        lastCheck: now,
        failureReason: hw.hasGpu ? "Wan2.2 model checkpoint not downloaded (Requires ~14GB download)" : "Unavailable on current hardware",
      },
    ];

    return capabilities;
  }

  public listPacks(): CapabilityPackStatus[] {
    const caps = this.listCapabilities();
    const hw = this.getHardwareInfo();

    const getCapsForPack = (packId: CapabilityPackId) => caps.filter((c) => c.pack === packId);

    const qualityCaps = getCapsForPack("QUALITY_CPU");
    const motionCaps = getCapsForPack("MOTION");
    const gpuCaps = getCapsForPack("AI_GPU");

    return [
      {
        id: "CORE",
        name: "Core Video & Audio Engine",
        description: "Essential baseline runtime including Remotion, Cairo fonts, Kokoro English voice, Whisper small captions, and PostgreSQL. Arabic narration is served by ElevenLabs and is configured separately in Providers.",
        installed: true,
        enabled: true,
        healthy: true,
        capabilities: ["ollama"],
        hardwareRequired: "Standard CPU",
      },
      {
        id: "QUALITY_CPU",
        name: "Creative Quality CPU Pack",
        description: "Advanced video intelligence including PySceneDetect scene boundaries, rembg background removal, and librosa beat tracking. Edge-TTS ships disabled as experimental compatibility only.",
        installed: qualityCaps.some((c) => c.installed),
        enabled: qualityCaps.some((c) => c.enabled && c.installed),
        healthy: qualityCaps.filter((c) => c.implemented).some((c) => c.healthy),
        capabilities: qualityCaps.map((c) => c.id),
        diskUsageBytes: 250 * 1024 * 1024,
        hardwareRequired: "Standard CPU",
      },
      {
        id: "MOTION",
        name: "Motion Graphics & Animation Pack",
        description: "Programmatic Motion Canvas runtime with Kinetic Typography, Stat Animations, Feature Lists, CTA cards, and Logo reveals in Arabic and English.",
        installed: motionCaps.every((c) => c.installed),
        enabled: motionCaps.every((c) => c.enabled),
        healthy: motionCaps.every((c) => c.healthy),
        capabilities: motionCaps.map((c) => c.id),
        diskUsageBytes: 40 * 1024 * 1024,
        hardwareRequired: "Standard CPU",
      },
      {
        id: "AI_GPU",
        name: "Generative AI GPU Pack (Optional)",
        description: "Optional ComfyUI sidecar and Wan2.2 generative video model for local AI video rendering.",
        installed: gpuCaps.some((c) => c.installed),
        enabled: gpuCaps.some((c) => c.enabled),
        healthy: gpuCaps.some((c) => c.healthy),
        capabilities: gpuCaps.map((c) => c.id),
        diskUsageBytes: 0,
        hardwareRequired: hw.hasGpu ? `${hw.gpuName} (${Math.round((hw.vramMb || 0) / 1024)}GB VRAM)` : "NVIDIA GPU with CUDA (>= 12GB VRAM)",
      },
    ];
  }

  public toggleCapability(id: CapabilityId, enabled: boolean): CapabilityStatus | null {
    this.enabledOverrides.set(id, enabled);
    const caps = this.listCapabilities();
    return caps.find((c) => c.id === id) || null;
  }

  public checkModeReadiness(productionMode: string, visualMode?: string): ModeReadiness {
    const caps = this.listCapabilities();
    const capMap = new Map(caps.map((c) => [c.id, c]));

    const missing: string[] = [];
    const requiredCaps: { id: CapabilityId; name: string; ready: boolean; required: boolean }[] = [];

    const addCheck = (id: CapabilityId, required: boolean, customName?: string) => {
      const cap = capMap.get(id);
      const ready = Boolean(cap && cap.installed && cap.enabled && cap.healthy);
      requiredCaps.push({
        id,
        name: customName || cap?.name || id,
        ready,
        required,
      });
      if (required && !ready) {
        missing.push(cap?.failureReason || `${cap?.name || id} is not installed or enabled.`);
      }
    };

    switch (productionMode) {
      case "product_ad":
        addCheck("background_removal", true, "rembg Background Removal");
        addCheck("beat_analysis", false, "librosa Beat Tracking (Optional)");
        addCheck("image_upscale", false, "Image Enhancement (Optional)");
        break;

      case "motion_graphics":
      case "animated_explainer":
        addCheck("motion_canvas", true, "Motion Canvas Animation Runtime");
        addCheck("beat_analysis", false, "librosa Beat Tracking (Optional)");
        break;

      case "stock_cinematic":
      case "social_viral":
        addCheck("scene_detection", false, "PySceneDetect Smart Window (Optional)");
        addCheck("beat_analysis", false, "librosa Beat-Aware Editing (Optional)");
        break;

      case "ai_generated":
        addCheck("comfyui", true, "ComfyUI Generative Sidecar");
        addCheck("wan22", true, "Wan2.2 Video Checkpoint");
        break;

      default:
        // auto_hybrid / general
        if (visualMode === "ai") {
          addCheck("comfyui", true, "ComfyUI Generative Sidecar");
        } else if (visualMode === "motion_graphics") {
          addCheck("motion_canvas", true, "Motion Canvas Animation Runtime");
        } else if (visualMode === "product_ad") {
          addCheck("background_removal", true, "rembg Background Removal");
        }
        break;
    }

    return {
      mode: productionMode,
      ready: missing.length === 0,
      missingRequirements: missing,
      capabilities: requiredCaps,
    };
  }

  /**
   * Arabic production readiness depends on ElevenLabs alone - never on local
   * Piper model health. A missing ElevenLabs credential blocks new Arabic jobs
   * but must never mark the engine itself unhealthy: English and local
   * production stay fully available.
   */
  public checkArabicProductionReadiness(
    elevenLabs: boolean | { configured: boolean; liveVerified?: boolean },
  ): ArabicProductionReadiness {
    const configured = typeof elevenLabs === "boolean" ? elevenLabs : Boolean(elevenLabs.configured);
    const liveVerified =
      typeof elevenLabs === "boolean" ? false : Boolean(elevenLabs.liveVerified);

    if (!configured) {
      return {
        ready: false,
        statusText: "NOT READY — ELEVENLABS NOT CONFIGURED",
        message: ARABIC_ELEVENLABS_REQUIRED_MESSAGE,
        provider: "elevenlabs",
        configured: false,
        liveVerified: false,
        blocksSystemHealth: false,
      };
    }

    return {
      ready: true,
      statusText: liveVerified ? "READY — ELEVENLABS LIVE VERIFIED" : "READY — ELEVENLABS CONFIGURED",
      message: liveVerified
        ? "ElevenLabs credential verified against the live API for Arabic narration."
        : "ElevenLabs is configured for Arabic narration. Run Test Connection to verify it live.",
      provider: "elevenlabs",
      configured: true,
      liveVerified,
      blocksSystemHealth: false,
    };
  }
}

export const capabilityManager = new CapabilityManager();
