export type CapabilityPackId = "CORE" | "QUALITY_CPU" | "MOTION" | "AI_GPU";

export type CapabilityId =
  | "scene_detection"
  | "background_removal"
  | "image_upscale"
  | "beat_analysis"
  | "motion_canvas"
  | "comfyui"
  | "wan22"
  | "edge_tts"
  | "ollama"
  | "mediapipe";

export type CapabilityStatus = {
  id: CapabilityId;
  name: string;
  pack: CapabilityPackId;
  implemented: boolean;
  installed: boolean;
  enabled: boolean;
  healthy: boolean;
  version: string;
  runtime: string;
  hardwareRequired: string;
  diskRequirement: string;
  license: string;
  lastCheck: string;
  failureReason?: string;
  metadata?: Record<string, unknown>;
};

export type CapabilityPackStatus = {
  id: CapabilityPackId;
  name: string;
  description: string;
  installed: boolean;
  enabled: boolean;
  healthy: boolean;
  capabilities: CapabilityId[];
  diskUsageBytes?: number;
  hardwareRequired?: string;
};

export type HardwareInfo = {
  hasGpu: boolean;
  hasNvidiaGpu?: boolean;
  gpuName?: string;
  vramMb?: number;
  vramGb?: number;
  cudaAvailable: boolean;
  dockerGpuAccess: boolean;
  cpuCores: number;
  freeDiskBytes: number;
  totalMemoryBytes: number;
  totalMemoryGb?: number;
  platform: string;
};

export type ModeReadiness = {
  mode: string;
  ready: boolean;
  missingRequirements: string[];
  capabilities: { id: CapabilityId; name: string; ready: boolean; required: boolean }[];
};

/**
 * Arabic production readiness is independent from overall system readiness.
 * The engine stays healthy without ElevenLabs; only new Arabic narration is
 * blocked when no ElevenLabs credential is configured and verified.
 */
export type ArabicProductionReadiness = {
  ready: boolean;
  statusText: string;
  message: string;
  provider: "elevenlabs";
  configured: boolean;
  liveVerified: boolean;
  blocksSystemHealth: false;
};
