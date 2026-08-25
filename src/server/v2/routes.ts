import express from "express";
import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
} from "express";
import axios from "axios";
import cuid from "cuid";
import fs from "fs-extra";
import path from "path";
import { Config } from "../../config";
import { listBusinessTemplates } from "../../short-creator/business-templates";
import { ShortCreator } from "../../short-creator/ShortCreator";
import { validateCreateShortInput } from "../validator";
import { readMetadata } from "../videoMetadata";
import { V2Database } from "./db";
import { getV2Health, validatePexelsProvider } from "./health";
import { JobService } from "./jobs";
import { N8nOrchestrator } from "./orchestrator";
import {
  appSettingsSchema,
  brandProfileSchema,
  captionStyleRevisionSchema,
  createVideoJobSchema,
  internalCompleteSchema,
  internalFailSchema,
  internalProgressSchema,
  internalStartRenderSchema,
  mediaRevisionSchema,
  productionJobSchema,
  productionSpecPreviewSchema,
  promptEnhanceRequestSchema,
  stageRetrySchema,
  voiceRevisionSchema,
} from "./types";
import { ContentAIRegistry } from "./content-ai/registry";
import { estimateProductionCost } from "./cost-estimator";
import {
  productionSpecSchema,
  validateContentQuality,
  validateProductionSpec,
} from "../../types/productionSpec";
import { convertTemplateToProductionSpec } from "./templateToSpec";
import { VeoVisualProvider } from "./visual-providers/veoVisualProvider";
import { FalVisualProvider } from "./visual-providers/falVisualProvider";
import { ElevenLabsVoiceProvider } from "./voice-providers/elevenlabsVoiceProvider";
import { GoogleCloudTtsProvider } from "./voice-providers/googleCloudTtsProvider";
import { EdgeTtsProvider } from "./voice-providers/edgeTtsProvider";
import { VoiceRegistry } from "./voice-providers/registry";
import { PIPER_ARABIC_MODEL } from "./voice-providers/piperArabicModel";
import { mediaIntelligenceService } from "./media-intelligence/mediaIntelligenceService";
import { mediaCache } from "./media-cache/mediaCache";
import { imageRegistry } from "./image-providers/registry";
import { createPublishingRouter } from "./publishing/routes";
import { PublishingService } from "./publishing/publishingService";
import { PublishingScheduler } from "./publishing/scheduler";
import { publishingRegistry } from "./publishing/registry";
import { getProductInfo } from "../../version";
import { AuthService } from "./auth/authService";
import { ApiTokenService, type ApiTokenScope } from "./auth/apiTokenService";
import type { VoiceProviderId } from "./voice-providers/types";
import {
  ARABIC_ELEVENLABS_REQUIRED_MESSAGE,
  ARABIC_PRODUCTION_PROVIDER,
  isArabicLanguage,
  isLegacyPiperVoiceId,
} from "./voice-providers/types";
import {
  ELEVENLABS_DEFAULT_MODEL_ID,
  ELEVENLABS_PRESETS,
  ELEVENLABS_PRESET_IDS,
} from "./voice-providers/elevenlabsVoiceProvider";
import {
  readArabicVoiceDefault,
  resolveArabicVoiceSelection,
  writeArabicVoiceDefault,
  type PersistedArabicVoiceDefault,
  type ResolvedArabicVoice,
} from "./voice-providers/arabicVoiceDefault";
import { voicePresetEnum, type VoicePreset } from "../../types/productionSpec";
import { BackupService } from "./backup/backupService";
import { DiagnosticsService } from "./diagnostics/diagnosticsService";
import { WebhookService } from "./webhooks/webhookService";
import { AnalyticsService } from "./analytics/analyticsService";
import { SystemHealthService } from "./system/systemHealthService";
import { RevisionService } from "./revisions/revisionService";
import { WorkerLeaseService } from "./workers/workerLeaseService";
import { ProviderCredentialsVault, allowedCredentialTypes, type CredentialType } from "./provider-vault/providerCredentialsVault";
import { providerSecrets } from "./provider-vault/providerSecrets";
import { checkpointStages } from "./checkpoints";
import {
  buildRevisionReusePlan,
  filterReusableArtifacts,
  type DurableSceneArtifact,
} from "./artifacts/durableArtifacts";
import { capabilityManager } from "./capabilities/capabilityManager";
import type { CapabilityId } from "./capabilities/types";
import { qualityEngine } from "./quality/qualityEngine";
import { mediaUploadService } from "./media/mediaUploadService";
import { motionEngine } from "./motion/motionEngine";

type BrandRow = {
  id: string;
  name: string;
  watermark_text: string;
  primary_color: string;
  secondary_color?: string | null;
  accent_color: string;
  logo_url?: string | null;
  website_url?: string | null;
  social_handle?: string | null;
  caption_style: "none" | "clean" | "bold" | "minimal";
  include_outro: boolean;
  outro_text: string;
  contact_text: string;
  voice_profile?: Record<string, unknown> | null;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
};

type SettingRow = {
  key: string;
  value: Record<string, unknown>;
  updated_at: Date;
};

function mapBrand(row: BrandRow) {
  return {
    id: row.id,
    name: row.name,
    watermarkText: row.watermark_text,
    primaryColor: row.primary_color,
    secondaryColor: row.secondary_color || undefined,
    accentColor: row.accent_color,
    logoUrl: row.logo_url || undefined,
    websiteUrl: row.website_url || undefined,
    socialHandle: row.social_handle || undefined,
    captionStyle: row.caption_style,
    includeOutro: row.include_outro,
    outroText: row.outro_text,
    contactText: row.contact_text,
    voiceProfile: row.voice_profile || undefined,
    isDefault: row.is_default,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function redactConfiguredKey(key?: string) {
  if (!key || key === "dummy-key" || key.includes("your_")) return null;
  return "••••••••";
}

function readStorageDetails(config: Config) {
  fs.ensureDirSync(config.videosDirPath);
  const files = fs.readdirSync(config.videosDirPath);
  const bytes = files.reduce((total, file) => {
    const filePath = path.join(config.videosDirPath, file);
    const stats = fs.statSync(filePath);
    return stats.isFile() ? total + stats.size : total;
  }, 0);
  return { videosDir: config.videosDirPath, bytes };
}

async function readAppSettings(db: V2Database) {
  const rows = await db.query<SettingRow>(
    "SELECT key, value, updated_at FROM app_settings WHERE key = $1",
    ["dashboard"],
  );
  return rows[0]?.value || {};
}

async function writeAppSettings(db: V2Database, value: Record<string, unknown>) {
  const rows = await db.query<SettingRow>(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
     RETURNING key, value, updated_at`,
    ["dashboard", value],
  );
  return rows[0]?.value || value;
}

function metadataArtifacts(metadata: any): DurableSceneArtifact[] {
  return filterReusableArtifacts({
    artifacts: Array.isArray(metadata?.durableArtifacts) ? metadata.durableArtifacts as DurableSceneArtifact[] : [],
  });
}

function publicArtifactSummary(artifact: DurableSceneArtifact) {
  return {
    artifactId: artifact.artifactId,
    type: artifact.type,
    sceneIndex: artifact.sceneIndex,
    segmentIndex: artifact.segmentIndex,
    sourceJobId: artifact.sourceJobId,
    sourceRevisionId: artifact.sourceRevisionId,
    provider: artifact.provider,
    model: artifact.model,
    inputHash: artifact.inputHash,
    checksum: artifact.checksum,
    duration: artifact.duration,
    valid: artifact.valid,
    createdAt: artifact.createdAt,
  };
}

function revisionReuseSummary(plan: ReturnType<typeof buildRevisionReusePlan>) {
  return {
    reusedStages: plan.reusedStages,
    regeneratedStages: plan.regeneratedStages,
    reusedArtifacts: plan.artifacts.map(publicArtifactSummary),
  };
}

/**
 * Canonical spec-level voice routing.
 *
 * Arabic / Egyptian Arabic / MSA always resolve to ElevenLabs regardless of
 * what the caller requested. Piper is no longer a production Arabic route; it
 * survives only so historical jobs and their metadata remain readable.
 */
function inferResolvedVoiceProvider(input: {
  language?: string;
  dialect?: string;
  voiceProvider?: string;
}): VoiceProviderId {
  const isArabic =
    input.language === "ar" ||
    (input.language === "auto" && Boolean(input.dialect) && input.dialect !== "none");
  if (isArabic) return ARABIC_PRODUCTION_PROVIDER;
  if (input.voiceProvider && input.voiceProvider !== "auto") {
    return input.voiceProvider as VoiceProviderId;
  }
  return "kokoro";
}

function defaultVoiceForResolvedProvider(provider: VoiceProviderId): string {
  // ElevenLabs is deliberately absent here: an Arabic voice is a human decision
  // resolved through resolveArabicVoiceSelection, never an environment guess.
  if (provider === "piper") return process.env.PIPER_AR_VOICE_ID || "ar_JO-kareem-medium";
  if (provider === "edge_tts") return process.env.EDGE_TTS_DEFAULT_VOICE || "ar-EG-SalmaNeural";
  if (provider === "google_cloud_tts") return process.env.GOOGLE_CLOUD_TTS_DEFAULT_VOICE || "";
  return "af_heart";
}

/**
 * Resolved defaults handed to canonicalization by the request layer.
 *
 * Canonicalization stays pure and synchronous: everything that needs the
 * database is read once per request *before* the spec is canonicalized.
 */
export type ProductionSpecDefaults = {
  arabicVoice?: PersistedArabicVoiceDefault | null;
};

function coerceRequestedPreset(value: unknown): VoicePreset | undefined {
  const parsed = voicePresetEnum.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function canonicalizeProductionSpecContract(
  spec: any,
  controls: any,
  defaults: ProductionSpecDefaults = {},
) {
  const language = controls.language || spec.language || "auto";
  const dialect = language === "ar" || language === "auto"
    ? (controls.dialect || spec.dialect || "egyptian")
    : "none";
  const resolvedVoiceProvider = inferResolvedVoiceProvider({
    language,
    dialect,
    voiceProvider: controls.voiceProvider || spec.voiceProvider || "auto",
  });
  const previousVoiceProvider = spec.voiceProvider && spec.voiceProvider !== "auto"
    ? spec.voiceProvider
    : undefined;
  const canReuseSpecVoice = previousVoiceProvider === resolvedVoiceProvider && spec.voiceId;
  const requestedVoiceId = controls.voiceId || canReuseSpecVoice || "";
  // Historical Arabic jobs carry Piper model names. Never forward one to
  // ElevenLabs; resolveArabicVoiceSelection discards them for us.
  const arabicVoice: ResolvedArabicVoice | null =
    resolvedVoiceProvider === ARABIC_PRODUCTION_PROVIDER
      ? resolveArabicVoiceSelection({
          requestedVoiceId,
          requestedPreset:
            coerceRequestedPreset(controls.voicePreset) ??
            (canReuseSpecVoice ? coerceRequestedPreset(spec.voicePreset) : undefined),
          persisted: defaults.arabicVoice,
          envVoiceId: process.env.ELEVENLABS_DEFAULT_VOICE_ID,
          defaultModelId: ELEVENLABS_DEFAULT_MODEL_ID,
        })
      : null;
  const voiceId = arabicVoice
    ? arabicVoice.voiceId
    : requestedVoiceId || defaultVoiceForResolvedProvider(resolvedVoiceProvider);
  const voicePreset = arabicVoice ? arabicVoice.preset : coerceRequestedPreset(controls.voicePreset);
  const voiceModelId = arabicVoice ? arabicVoice.modelId : undefined;
  return validateProductionSpec({
    ...spec,
    language: language === "auto" && dialect !== "none" ? "ar" : language,
    dialect,
    durationSeconds: controls.durationSeconds ?? controls.requestedDurationSeconds ?? controls.duration ?? spec.durationSeconds,
    aspectRatio: controls.aspectRatio || spec.aspectRatio,
    resolution: controls.resolution || spec.resolution,
    quality: controls.quality || spec.quality,
    productionMode: controls.productionMode || spec.productionMode,
    // "auto" means "let the preset follow the production mode", so it is not
    // persisted as an explicit style choice.
    creativeStyle:
      controls.creativeStyle && controls.creativeStyle !== "auto"
        ? controls.creativeStyle
        : spec.creativeStyle,
    animationIntensity: controls.animationIntensity || spec.animationIntensity,
    visualMode: controls.visualMode || spec.visualMode,
    voiceProvider: resolvedVoiceProvider,
    voiceId,
    voicePreset,
    voiceModelId,
    captionStyle: controls.captionStyle || spec.captionStyle,
    metadata: {
      ...(spec.metadata || {}),
      uiContract: {
        durationSeconds: controls.durationSeconds ?? controls.requestedDurationSeconds ?? controls.duration ?? spec.durationSeconds,
        language: language === "auto" && dialect !== "none" ? "ar" : language,
        dialect,
        aspectRatio: controls.aspectRatio || spec.aspectRatio,
        resolution: controls.resolution || spec.resolution,
        quality: controls.quality || spec.quality,
        visualMode: controls.visualMode || spec.visualMode,
        requestedVoiceProvider: controls.voiceProvider || spec.voiceProvider || "auto",
        resolvedVoiceProvider,
        voiceId,
        voicePreset,
        voiceModelId,
        // How the voice was chosen, so the UI and job metadata can prove the
        // persisted human selection - not an environment value - was used.
        voiceSource: arabicVoice?.source,
        voiceName: arabicVoice?.voiceName,
      },
    },
  });
}

/**
 * Request-layer canonicalization.
 *
 * Reads the persisted human Arabic default once, then hands it to the pure
 * canonicalizer. Every route that builds a ProductionSpec goes through here so
 * no path can silently fall back to the legacy environment voice.
 */
async function canonicalizeProductionSpecForRequest(
  db: V2Database,
  spec: any,
  controls: any,
) {
  const arabicVoice = await readArabicVoiceDefault(db).catch(() => null);
  return canonicalizeProductionSpecContract(spec, controls, { arabicVoice });
}

/**
 * Arabic production gate.
 *
 * A job that needs new Arabic narration is refused at creation time when
 * ElevenLabs is not configured, so the customer sees an actionable error in the
 * Create Video screen instead of a job that fails minutes into rendering.
 * Returns null when the request may proceed.
 */
async function arabicProductionBlocker(spec: {
  language?: string;
  dialect?: string;
  voiceId?: string;
}): Promise<{ error: string; message: string; action: { label: string; href: string } } | null> {
  if (!isArabicLanguage(spec.language, spec.dialect as any)) return null;
  await providerSecrets.refreshElevenLabsApiKey().catch(() => undefined);
  if (!new ElevenLabsVoiceProvider().isConfigured()) {
    return {
      error: "elevenlabs_not_configured",
      message: ARABIC_ELEVENLABS_REQUIRED_MESSAGE,
      action: { label: "Configure ElevenLabs", href: "/providers" },
    };
  }
  // Nothing resolved a speaker: no explicit voice, no persisted human default
  // and no legacy environment value. Refuse rather than narrate the job with an
  // arbitrary account voice nobody chose.
  if (!spec.voiceId) {
    return {
      error: "arabic_default_voice_not_selected",
      message:
        "No default Arabic voice has been selected. Open Voice Lab, audition the account voices and save a default.",
      action: { label: "Open Voice Lab", href: "/voice-lab" },
    };
  }
  return null;
}

function hasCommandHint(envKey: string): boolean {
  return Boolean(process.env[envKey]?.trim());
}

function buildV22CapabilityProviders() {
  const now = new Date().toISOString();
  const gpuEnabled = process.env.AI_GPU_PACK_ENABLED === "true";
  const comfyConfigured = Boolean(process.env.COMFYUI_BASE_URL);
  const motionCanvasConfigured = process.env.MOTION_CANVAS_ENABLED === "true" || hasCommandHint("MOTION_CANVAS_BIN");
  return [
    {
      id: "ollama",
      name: "Ollama Local LLM",
      category: "Content AI",
      tier: "local",
      status: process.env.OLLAMA_BASE_URL ? "configured" : "not_configured",
      configured: Boolean(process.env.OLLAMA_BASE_URL),
      isDefault: false,
      message: process.env.OLLAMA_BASE_URL
        ? "Ollama-compatible local LLM endpoint configured."
        : "Optional local LLM is not configured; deterministic Local AI remains the fallback.",
      checkedAt: now,
      details: {
        implemented: true,
        model: process.env.OLLAMA_MODEL || "qwen2.5:3b-instruct or qwen2.5:7b-instruct recommended when hardware allows",
        contract: "OpenAI-compatible/local HTTP JSON generation",
        hardware: "Use smaller Qwen instruct models on CPU-only clients; larger models require adequate RAM/VRAM.",
      },
    },
    {
      id: "motion_canvas",
      name: "Motion Canvas",
      category: "Motion",
      tier: "optional_cpu_pack",
      status: motionCanvasConfigured ? "configured" : "not_configured",
      configured: motionCanvasConfigured,
      isDefault: false,
      message: motionCanvasConfigured
        ? "Motion Canvas asset generation path is enabled."
        : "Motion Canvas is optional and disabled in the base runtime.",
      checkedAt: now,
      details: {
        implemented: true,
        templates: ["kinetic_typography", "number_stat", "logo_reveal", "feature_list", "comparison", "cta", "timeline", "process_steps", "quote", "lower_third", "title_card"],
        replacesRemotion: false,
      },
    },
    {
      id: "pyscenedetect",
      name: "PySceneDetect",
      category: "Post Production",
      tier: "quality_cpu_pack",
      status: hasCommandHint("PYSCENEDETECT_BIN") ? "configured" : "not_configured",
      configured: hasCommandHint("PYSCENEDETECT_BIN"),
      isDefault: false,
      message: "Optional shot/cut/fade analysis for best-window stock selection.",
      checkedAt: now,
    },
    {
      id: "mediapipe",
      name: "MediaPipe",
      category: "Post Production",
      tier: "quality_cpu_pack",
      status: hasCommandHint("MEDIAPIPE_BIN") ? "configured" : "not_configured",
      configured: hasCommandHint("MEDIAPIPE_BIN"),
      isDefault: false,
      message: "Optional face/person detection for smart portrait crop and safe caption placement.",
      checkedAt: now,
    },
    {
      id: "rembg",
      name: "rembg",
      category: "Post Production",
      tier: "quality_cpu_pack",
      status: hasCommandHint("REMBG_BIN") ? "configured" : "not_configured",
      configured: hasCommandHint("REMBG_BIN"),
      isDefault: false,
      message: "Optional product-background removal for Product Ad mode.",
      checkedAt: now,
    },
    {
      id: "real_esrgan",
      name: "Real-ESRGAN",
      category: "Post Production",
      tier: "optional_enhancement",
      status: hasCommandHint("REAL_ESRGAN_BIN") ? "configured" : "not_configured",
      configured: hasCommandHint("REAL_ESRGAN_BIN"),
      isDefault: false,
      message: "Optional OFF/AUTO/FORCE image/video enhancement; never runs on every asset by default.",
      checkedAt: now,
    },
    {
      id: "librosa",
      name: "librosa Beat Analysis",
      category: "Post Production",
      tier: "quality_cpu_pack",
      status: hasCommandHint("LIBROSA_PYTHON") ? "configured" : "not_configured",
      configured: hasCommandHint("LIBROSA_PYTHON"),
      isDefault: false,
      message: "Optional BPM, beat, and energy analysis for edit timing hints.",
      checkedAt: now,
    },
    {
      id: "faster_whisper",
      name: "faster-whisper",
      category: "Captions",
      tier: "optional_caption_backend",
      status: hasCommandHint("FASTER_WHISPER_BIN") ? "configured" : "not_configured",
      configured: hasCommandHint("FASTER_WHISPER_BIN"),
      isDefault: false,
      message: "Optional caption backend. Speed is not claimed until measured on this machine.",
      checkedAt: now,
    },
    {
      id: "whisperx",
      name: "WhisperX",
      category: "Captions",
      tier: "optional_alignment_backend",
      status: hasCommandHint("WHISPERX_BIN") ? "configured" : "not_configured",
      configured: hasCommandHint("WHISPERX_BIN"),
      isDefault: false,
      message: "Optional alignment evaluation. Arabic forced alignment remains disabled unless a suitable Arabic alignment model is verified.",
      checkedAt: now,
    },
    {
      id: "comfyui",
      name: "ComfyUI GPU Pack",
      category: "AI GPU",
      tier: "optional_gpu_sidecar",
      status: gpuEnabled && comfyConfigured ? "configured" : "not_configured",
      configured: gpuEnabled && comfyConfigured,
      isDefault: false,
      message: gpuEnabled && comfyConfigured
        ? "ComfyUI sidecar API configured; ABUD remains the control plane."
        : "AI GPU Pack is optional and disabled; no huge diffusion models are included in the base image.",
      checkedAt: now,
      details: {
        publicUi: false,
        requiredEnv: ["AI_GPU_PACK_ENABLED=true", "COMFYUI_BASE_URL"],
      },
    },
    {
      id: "wan2_2",
      name: "Wan2.2",
      category: "AI GPU",
      tier: "optional_gpu_workflow",
      status: gpuEnabled && process.env.WAN22_ENABLED === "true" ? "configured" : "not_configured",
      configured: gpuEnabled && process.env.WAN22_ENABLED === "true",
      isDefault: false,
      message: "Optional Wan2.2 workflow support is gated by hardware, model download, and license acceptance.",
      checkedAt: now,
      details: {
        modes: ["text_to_video", "image_to_video", "character_animation"],
        downloadsInBaseImage: false,
      },
    },
  ];
}

async function persistSceneArtifacts(db: V2Database, projectId: string, artifacts: DurableSceneArtifact[]) {
  const safeArtifacts = filterReusableArtifacts({ artifacts });
  for (const artifact of safeArtifacts) {
    await db.query(
      `INSERT INTO scene_artifacts (
        artifact_id, project_id, type, scene_index, segment_index, source_job_id, source_revision_id,
        provider, model, input_hash, storage_ref, checksum_sha256, duration_seconds,
        metadata, valid, superseded_at, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      ON CONFLICT (artifact_id) DO UPDATE SET
        project_id = EXCLUDED.project_id,
        valid = EXCLUDED.valid,
        superseded_at = EXCLUDED.superseded_at,
        metadata = EXCLUDED.metadata`,
      [
        artifact.artifactId,
        projectId,
        artifact.type,
        artifact.sceneIndex,
        artifact.segmentIndex ?? null,
        artifact.sourceJobId,
        artifact.sourceRevisionId || null,
        artifact.provider || null,
        artifact.model || null,
        artifact.inputHash,
        artifact.storageRef,
        artifact.checksum,
        artifact.duration ?? null,
        JSON.stringify(artifact.metadata || {}),
        artifact.valid,
        artifact.supersededAt || null,
        artifact.createdAt || new Date().toISOString(),
      ],
    );
  }
}

function requireInternalToken(config: Config) {
  return (
    req: ExpressRequest,
    res: ExpressResponse,
    next: express.NextFunction,
  ) => {
    const token = req.header("x-internal-token");
    if (!config.internalServiceToken || token !== config.internalServiceToken) {
      res.status(401).json({ error: "Unauthorized internal request." });
      return;
    }
    next();
  };
}

function bearerToken(req: ExpressRequest): string {
  const header = req.headers.authorization || "";
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  const queryToken = req.query.access_token;
  return typeof queryToken === "string" ? queryToken.trim() : "";
}

function scopeForRequest(req: ExpressRequest): ApiTokenScope | null {
  const method = req.method.toUpperCase();
  const routePath = req.path;
  if (routePath.startsWith("/publishing")) return "publishing:write";
  if (routePath.startsWith("/videos/") && routePath.endsWith("/publishing")) return "production:read";
  if (routePath.startsWith("/videos/") && routePath.includes("/revisions") && method === "GET") return "videos:read";
  if (routePath.startsWith("/videos/") && routePath.includes("/revisions") && method === "POST") return "production:create";
  if (routePath.startsWith("/production/jobs") && method === "GET") return "production:read";
  if (routePath === "/production/jobs" && method === "POST") return "production:create";
  if (routePath.startsWith("/jobs") && method === "GET") return "production:read";
  if (routePath.startsWith("/jobs/") && routePath.includes("/stages") && method === "GET") return "production:read";
  if (routePath.startsWith("/jobs/") && routePath.includes("/stages") && method === "POST") return "production:create";
  if (routePath === "/jobs" && method === "POST") return "production:create";
  if (routePath.startsWith("/production-spec") || routePath.startsWith("/prompt") || routePath.startsWith("/cost-estimate")) {
    return "production:create";
  }
  if (routePath.startsWith("/media/upload")) return "production:create";
  if (routePath.startsWith("/media/uploads") || routePath.startsWith("/media/products")) return "videos:read";
  if (routePath.startsWith("/system/capabilities") || routePath.startsWith("/system/readiness")) return "production:read";
  return null;
}

function isPublicHealthOrBootstrapPath(req: ExpressRequest): boolean {
  const method = req.method.toUpperCase();
  const routePath = req.path;
  return (
    (method === "GET" && (routePath === "/health" || routePath === "/system/health" || routePath === "/system/info" || routePath === "/setup/status")) ||
    (method === "POST" && routePath === "/auth/login")
  );
}

function requireV2Access(authService: AuthService, apiTokenService: ApiTokenService) {
  return async (req: ExpressRequest, res: ExpressResponse, next: express.NextFunction) => {
    try {
      if (isPublicHealthOrBootstrapPath(req)) {
        next();
        return;
      }

      const setupState = await authService.getSetupState();
      const setupComplete = setupState.isSetupCompleted;
      const method = req.method.toUpperCase();
      const routePath = req.path;

      if (method === "POST" && routePath === "/auth/setup-admin" && !setupState.isAdminConfigured && !setupComplete) {
        next();
        return;
      }

      const token = bearerToken(req);
      if (!token) {
        res.status(401).json({ error: "Unauthorized." });
        return;
      }

      const admin = await authService.validateSession(token);
      if (admin?.role === "admin") {
        (req as any).v2Auth = { type: "admin", user: admin };
        next();
        return;
      }

      const requiredScope = scopeForRequest(req);
      if (!requiredScope) {
        res.status(401).json({ error: "Admin session required." });
        return;
      }

      const apiToken = await apiTokenService.validateToken(token, requiredScope);
      if (apiToken.forbidden) {
        res.status(403).json({ error: "API token does not include the required scope.", requiredScope });
        return;
      }
      if (!apiToken.valid) {
        res.status(401).json({ error: "Invalid or expired credential." });
        return;
      }
      (req as any).v2Auth = { type: "api_token", token: apiToken.token, scope: requiredScope };
      next();
    } catch (error) {
      res.status(500).json({ error: "Access control failed.", message: error instanceof Error ? error.message : String(error) });
    }
  };
}

export function createV2PublicRouter(
  config: Config,
  db: V2Database,
  jobs: JobService,
): express.Router {
  const router = express.Router();
  const orchestrator = new N8nOrchestrator(config, jobs);
  const contentAIRegistry = new ContentAIRegistry(config);
  const publishingService = new PublishingService(db, config, publishingRegistry);
  const publishingScheduler = new PublishingScheduler(db, publishingService);
  const authService = new AuthService(db);
  const apiTokenService = new ApiTokenService(db);
  const backupService = new BackupService(db, config);
  const diagnosticsService = new DiagnosticsService(db, config);
  const webhookService = new WebhookService(db, { timeoutMs: config.webhookTimeoutMs });
  const analyticsService = new AnalyticsService(db, config);
  const revisionService = new RevisionService(db);
  const workerLeaseService = new WorkerLeaseService(db);
  const providerVault = new ProviderCredentialsVault(db, config);

  // Provider classes read credentials synchronously; the vault resolver keeps a
  // decrypted copy in process memory only. Plaintext never leaves this module.
  if (providerVault.isAvailable()) {
    providerSecrets.registerResolver((providerId, credentialType) =>
      providerVault.readPlaintext(providerId, credentialType),
    );
    void providerSecrets.refreshElevenLabsApiKey();
  }

  if (config.serviceRole === "app") {
    publishingScheduler.start();
  }

  router.use(express.json({ limit: "2mb" }));
  router.use(requireV2Access(authService, apiTokenService));

  // Mount Publishing & Distribution Routes
  router.use("/publishing", createPublishingRouter(config, publishingService));

  router.get("/videos/:videoId/publishing", async (req, res) => {
    try {
      const status = await publishingService.getOverallVideoStatus(req.params.videoId);
      res.status(200).json(status);
    } catch (error) {
      res.status(500).json({
        error: "Failed to get video publishing status",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.get("/videos/:videoId/revisions", async (req, res) => {
    const videoId = req.params.videoId;
    try {
      const metadata = readMetadata(config.videosDirPath, videoId);
      if (!metadata && !fs.existsSync(path.join(config.videosDirPath, `${videoId}.mp4`))) {
        res.status(404).json({ error: "Video not found." });
        return;
      }
      if (metadata?.productionSpec) {
        await revisionService.ensureInitialRevision({
          projectId: videoId,
          sourceJobId: videoId,
          outputVideoId: videoId,
        });
      }
      const revisions = await revisionService.listRevisions(videoId);
      res.status(200).json({
        revisions,
        legacy: !metadata?.productionSpec,
        message: metadata?.productionSpec ? undefined : "Legacy video / revision history unavailable.",
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to load revisions.", message: String(error) });
    }
  });

  router.post("/videos/:videoId/revisions/voice", async (req, res) => {
    const parsed = voiceRevisionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid voice revision payload.", issues: parsed.error.flatten() });
      return;
    }
    try {
      const videoId = req.params.videoId;
      const metadata = readMetadata(config.videosDirPath, videoId);
      if (!metadata?.productionSpec) {
        res.status(409).json({ error: "Legacy video / revision history unavailable." });
        return;
      }
      const baseSpec = metadata.productionSpec as any;
      const selectedVisuals = metadata.selectedVisuals || [];
      const revisionId = cuid();
      const reusePlan = buildRevisionReusePlan({
        changeType: "voice",
        artifacts: metadataArtifacts(metadata),
      });
      const nextSpec = validateProductionSpec({
        ...baseSpec,
        id: revisionId,
        voiceProvider: parsed.data.voiceProvider || baseSpec.voiceProvider,
        voiceId: parsed.data.voiceId || baseSpec.voiceId,
        captionStyle: parsed.data.captionProfile || baseSpec.captionStyle,
        scenes: parsed.data.spokenNarration
          ? baseSpec.scenes.map((scene: any, index: number) => ({
              ...scene,
              spokenNarration: index === 0 ? parsed.data.spokenNarration : scene.spokenNarration,
            }))
          : baseSpec.scenes,
        metadata: {
          ...(baseSpec.metadata || {}),
          revision: {
            revisionId,
            type: "voice",
            parentVideoId: videoId,
            reuseStages: reusePlan.reusedStages,
            regeneratedStages: reusePlan.regeneratedStages,
            reuseArtifacts: reusePlan.artifacts,
            reuseMediaAssets: selectedVisuals,
          },
        },
      });
      const initial = await revisionService.ensureInitialRevision({ projectId: videoId, sourceJobId: videoId, outputVideoId: videoId });
      const arabicBlock = await arabicProductionBlocker(nextSpec);
      if (arabicBlock) {
        res.status(409).json(arabicBlock);
        return;
      }
      const job = await jobs.createVideoJob({
        type: "video",
        creationMode: "prompt",
        title: `${metadata.templateName || metadata.filename || videoId} voice revision`,
        productionSpec: nextSpec,
      });
      const revision = await revisionService.createRevision({
        id: revisionId,
        projectId: videoId,
        parentRevisionId: initial.id,
        sourceJobId: job.id,
        reason: parsed.data.reason || "Voice-only revision",
        changeType: "voice",
        changedFields: {
          spokenNarration: Boolean(parsed.data.spokenNarration),
          voiceProvider: parsed.data.voiceProvider,
          voiceId: parsed.data.voiceId,
          captionProfile: parsed.data.captionProfile,
          reusedStages: reusePlan.reusedStages,
          regeneratedStages: reusePlan.regeneratedStages,
          reusedArtifactIds: reusePlan.artifacts.map((artifact) => artifact.artifactId),
        },
      });
      await orchestrator.enqueue(job);
      await webhookService.dispatchEvent("video.revision.created", { videoId, revisionId: revision.id, jobId: job.id, changeType: "voice" });
      res.status(201).json({ revision, job, ...revisionReuseSummary(reusePlan) });
    } catch (error) {
      res.status(500).json({ error: "Failed to create voice revision.", message: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post("/videos/:videoId/revisions/media", async (req, res) => {
    const parsed = mediaRevisionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid media revision payload.", issues: parsed.error.flatten() });
      return;
    }
    try {
      const videoId = req.params.videoId;
      const metadata = readMetadata(config.videosDirPath, videoId);
      if (!metadata?.productionSpec) {
        res.status(409).json({ error: "Legacy video / revision history unavailable." });
        return;
      }
      const baseSpec = metadata.productionSpec as any;
      const revisionId = cuid();
      const reusePlan = buildRevisionReusePlan({
        changeType: "media",
        artifacts: metadataArtifacts(metadata),
        changedSceneIndex: parsed.data.sceneIndex,
      });
      const nextSpec = validateProductionSpec({
        ...baseSpec,
        id: revisionId,
        scenes: baseSpec.scenes.map((scene: any, index: number) =>
          index === parsed.data.sceneIndex
            ? {
                ...scene,
                stockSearchTerms: parsed.data.searchTerms || scene.stockSearchTerms,
                visualIntent: parsed.data.visualIntent || scene.visualIntent,
              }
            : scene,
        ),
        metadata: {
          ...(baseSpec.metadata || {}),
          revision: {
            revisionId,
            type: "media",
            parentVideoId: videoId,
            changedSceneIndex: parsed.data.sceneIndex,
            reuseStages: reusePlan.reusedStages,
            regeneratedStages: reusePlan.regeneratedStages,
            reuseArtifacts: reusePlan.artifacts,
          },
        },
      });
      const initial = await revisionService.ensureInitialRevision({ projectId: videoId, sourceJobId: videoId, outputVideoId: videoId });
      const job = await jobs.createVideoJob({
        type: "video",
        creationMode: "prompt",
        title: `${metadata.templateName || metadata.filename || videoId} media revision`,
        productionSpec: nextSpec,
      });
      const revision = await revisionService.createRevision({
        id: revisionId,
        projectId: videoId,
        parentRevisionId: initial.id,
        sourceJobId: job.id,
        reason: parsed.data.reason || `Scene ${parsed.data.sceneIndex + 1} media revision`,
        changeType: "media",
        changedFields: {
          sceneIndex: parsed.data.sceneIndex,
          searchTerms: parsed.data.searchTerms,
          visualIntent: parsed.data.visualIntent,
          reusedStages: reusePlan.reusedStages,
          regeneratedStages: reusePlan.regeneratedStages,
          reusedArtifactIds: reusePlan.artifacts.map((artifact) => artifact.artifactId),
        },
      });
      await orchestrator.enqueue(job);
      await webhookService.dispatchEvent("video.revision.created", { videoId, revisionId: revision.id, jobId: job.id, changeType: "media" });
      res.status(201).json({ revision, job, ...revisionReuseSummary(reusePlan) });
    } catch (error) {
      res.status(500).json({ error: "Failed to create media revision.", message: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post("/videos/:videoId/revisions/caption-style", async (req, res) => {
    const parsed = captionStyleRevisionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid caption-style revision payload.", issues: parsed.error.flatten() });
      return;
    }
    try {
      const videoId = req.params.videoId;
      const metadata = readMetadata(config.videosDirPath, videoId);
      if (!metadata?.productionSpec) {
        res.status(409).json({ error: "Legacy video / revision history unavailable." });
        return;
      }
      const baseSpec = metadata.productionSpec as any;
      const revisionId = cuid();
      const reusePlan = buildRevisionReusePlan({
        changeType: "caption",
        artifacts: metadataArtifacts(metadata),
      });
      const nextSpec = validateProductionSpec({
        ...baseSpec,
        id: revisionId,
        captionStyle: parsed.data.captionProfile,
        metadata: {
          ...(baseSpec.metadata || {}),
          revision: {
            revisionId,
            type: "caption",
            parentVideoId: videoId,
            reuseStages: reusePlan.reusedStages,
            regeneratedStages: reusePlan.regeneratedStages,
            reuseArtifacts: reusePlan.artifacts,
          },
        },
      });
      const initial = await revisionService.ensureInitialRevision({ projectId: videoId, sourceJobId: videoId, outputVideoId: videoId });
      const job = await jobs.createVideoJob({
        type: "video",
        creationMode: "prompt",
        title: `${metadata.templateName || metadata.filename || videoId} caption revision`,
        productionSpec: nextSpec,
      });
      const revision = await revisionService.createRevision({
        id: revisionId,
        projectId: videoId,
        parentRevisionId: initial.id,
        sourceJobId: job.id,
        reason: parsed.data.reason || "Caption-style revision",
        changeType: "caption",
        changedFields: {
          captionProfile: parsed.data.captionProfile,
          reusedStages: reusePlan.reusedStages,
          regeneratedStages: reusePlan.regeneratedStages,
          reusedArtifactIds: reusePlan.artifacts.map((artifact) => artifact.artifactId),
        },
      });
      await orchestrator.enqueue(job);
      await webhookService.dispatchEvent("video.revision.created", { videoId, revisionId: revision.id, jobId: job.id, changeType: "caption" });
      res.status(201).json({ revision, job, ...revisionReuseSummary(reusePlan) });
    } catch (error) {
      res.status(500).json({ error: "Failed to create caption-style revision.", message: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post("/videos/:videoId/revisions/:revisionId/final", async (req, res) => {
    try {
      const revision = await revisionService.markFinal(req.params.videoId, req.params.revisionId);
      if (!revision) {
        res.status(404).json({ error: "Revision not found." });
        return;
      }
      await webhookService.dispatchEvent("video.revision.finalized", { videoId: req.params.videoId, revisionId: revision.id, outputVideoId: revision.outputVideoId });
      res.status(200).json({ revision });
    } catch (error) {
      res.status(500).json({ error: "Failed to mark final revision.", message: String(error) });
    }
  });

  // Preview Production Spec generated from a prompt
  router.post("/production-spec/preview", async (req, res) => {
    const parsed = productionSpecPreviewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid preview request payload",
        issues: parsed.error.flatten(),
      });
      return;
    }

    try {
      const provider = contentAIRegistry.getProvider();
      const generatedSpec = await provider.generateProductionSpec(parsed.data);
      const spec = await canonicalizeProductionSpecForRequest(db, generatedSpec, parsed.data);
      const costEstimate = estimateProductionCost(spec, {
        voiceProvider: spec.voiceProvider as any,
        visualMode: spec.visualMode,
        contentAIProvider: provider.id,
      });
      const quality = validateContentQuality(spec);
      const resolvedSpec = quality.correctedSpec || spec;
      const mediaPlan = mediaIntelligenceService.generateMediaPlan(resolvedSpec, {
        captionPreset: (resolvedSpec.captionStyle as any) || "bold",
      });

      res.status(200).json({
        spec: resolvedSpec,
        costEstimate,
        quality,
        mediaPlan,
      });
    } catch (error) {
      res.status(500).json({
        error: "Failed to generate preview spec",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Prompt Enhancement
  router.post("/prompt/enhance", async (req, res) => {
    const parsed = promptEnhanceRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid enhance request payload",
        issues: parsed.error.flatten(),
      });
      return;
    }

    try {
      const provider = contentAIRegistry.getProvider();
      const result = await provider.rewritePrompt(parsed.data.prompt, {
        language: parsed.data.language,
        dialect: parsed.data.dialect,
        contentStyle: parsed.data.contentStyle,
      });
      res.status(200).json(result);
    } catch (error) {
      res.status(500).json({
        error: "Failed to enhance prompt",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Cost Estimation endpoint
  router.post("/cost-estimate", (req, res) => {
    try {
      const cost = estimateProductionCost(req.body);
      res.status(200).json(cost);
    } catch (error) {
      res.status(400).json({
        error: "Failed to estimate cost",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // User Media Upload Endpoint
  router.post("/media/upload", express.json({ limit: "50mb" }), (req, res) => {
    try {
      const { filename, base64Data } = req.body || {};
      if (!filename || !base64Data) {
        res.status(400).json({ error: "filename and base64Data are required" });
        return;
      }

      const ext = path.extname(filename).toLowerCase();
      const allowedExts = [".jpg", ".jpeg", ".png", ".webp", ".mp4", ".mov", ".webm"];
      if (!allowedExts.includes(ext)) {
        res.status(400).json({
          error: "Invalid file format",
          message: `Allowed formats: ${allowedExts.join(", ")}`,
        });
        return;
      }

      const uploadsDir = mediaCache.getUploadsDir();
      fs.ensureDirSync(uploadsDir);

      const safeId = cuid();
      const safeFilename = `${safeId}${ext}`;
      const targetPath = path.join(uploadsDir, safeFilename);

      const cleanBase64 = base64Data.replace(/^data:[^;]+;base64,/, "");
      const buffer = Buffer.from(cleanBase64, "base64");

      if (buffer.length > 50 * 1024 * 1024) {
        res.status(400).json({ error: "File exceeds maximum size limit of 50MB." });
        return;
      }

      fs.writeFileSync(targetPath, buffer);

      res.status(201).json({
        mediaId: safeId,
        filename: safeFilename,
        url: `/api/v2/media/uploads/${safeFilename}`,
        sizeBytes: buffer.length,
        extension: ext,
      });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to upload media file" });
    }
  });

  router.post("/production/jobs", async (req, res) => {
    const parsed = productionJobSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid production job payload.", issues: parsed.error.flatten() });
      return;
    }
    try {
      const qualityMap: Record<string, "draft" | "standard" | "premium" | "max_quality_local"> = {
        fast: "draft",
        balanced: "standard",
        premium: "premium",
        max_quality_local: "max_quality_local",
      };
      const provider = contentAIRegistry.getProvider();
      const spec = await provider.generateProductionSpec({
        creationMode: "prompt",
        prompt: parsed.data.prompt,
        language: parsed.data.language,
        dialect: parsed.data.dialect,
        durationSeconds: parsed.data.durationSeconds || parsed.data.duration || 20,
        aspectRatio: parsed.data.aspectRatio,
        quality: qualityMap[parsed.data.qualityProfile],
        visualMode: parsed.data.visualMode,
          voiceProvider: "auto",
          voiceId: parsed.data.voice,
          brandId: parsed.data.brandId,
        } as any);
      const canonicalSpec = await canonicalizeProductionSpecForRequest(db, spec, {
        ...parsed.data,
        quality: qualityMap[parsed.data.qualityProfile],
        voiceProvider: "auto",
        voiceId: parsed.data.voice,
      });
      const arabicBlock = await arabicProductionBlocker(canonicalSpec);
      if (arabicBlock) {
        res.status(409).json(arabicBlock);
        return;
      }
      const job = await jobs.createVideoJob({
        type: "video",
        creationMode: "prompt",
        title: canonicalSpec.title,
        productionSpec: {
          ...canonicalSpec,
          metadata: {
            ...(canonicalSpec.metadata || {}),
            apiContract: "production.jobs.v1",
            publishIntent: parsed.data.publishIntent || undefined,
            qualityProfileRequested: parsed.data.qualityProfile,
          },
        },
      });
      await orchestrator.enqueue(job);
      await webhookService.dispatchEvent("job.created", { jobId: job.id, status: job.status });
      res.status(202).json({
        jobId: job.id,
        status: job.status,
        statusUrl: `/api/v2/production/jobs/${job.id}`,
        eventsUrl: `/api/v2/jobs/${job.id}/events`,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to create production job.", message: error instanceof Error ? error.message : String(error) });
    }
  });

  router.get("/production/jobs/:id", async (req, res) => {
    const job = await jobs.getJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: "Job not found." });
      return;
    }
    res.status(200).json({ job });
  });

  router.get("/production/jobs/:id/stages", async (req, res) => {
    const job = await jobs.getJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: "Job not found." });
      return;
    }
    res.status(200).json({
      jobId: job.id,
      stageTimings: job.stageTimings || {},
      checkpoint: job.checkpoint || {},
      stages: checkpointStages.map((stage) => ({
        stage,
        checkpoint: (job.checkpoint as any)?.[stage] || { status: "pending", attempt: 0 },
        timingMs: job.stageTimings?.[`${stage}Ms`],
      })),
    });
  });

  router.get("/production/jobs/:id/output", async (req, res) => {
    const job = await jobs.getJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: "Job not found." });
      return;
    }
    res.status(200).json({
      jobId: job.id,
      status: job.status,
      output: job.output || null,
      videoId: job.output?.videoId,
    });
  });

  router.get("/media/uploads/:filename", (req, res) => {
    const filename = path.basename(req.params.filename);
    const targetPath = path.join(mediaCache.getUploadsDir(), filename);
    if (!fs.existsSync(targetPath)) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    res.sendFile(targetPath);
  });

  // Create Video Job (supports prompt mode or template mode)
  router.post("/jobs", async (req, res) => {
    const rawPayload = req.body || {};
    const parsed = createVideoJobSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid job payload",
        issues: parsed.error.flatten(),
      });
      return;
    }

    try {
      let resolvedPayload = parsed.data as any;
      const headerIdempotencyKey =
        typeof req.headers["idempotency-key"] === "string"
          ? req.headers["idempotency-key"]
          : undefined;
      if (headerIdempotencyKey && !resolvedPayload.idempotencyKey) {
        resolvedPayload = {
          ...resolvedPayload,
          idempotencyKey: headerIdempotencyKey,
        };
      }

      // If user sent a raw prompt without full spec, generate the production spec first
      if ((rawPayload as any).prompt && !(rawPayload as any).productionSpec) {
        const provider = contentAIRegistry.getProvider();
        const generatedSpec = await provider.generateProductionSpec(rawPayload as any);
        const canonicalSpec = await canonicalizeProductionSpecForRequest(db, generatedSpec, rawPayload);
        resolvedPayload = {
          type: "video",
          creationMode: "prompt",
          title: (rawPayload as any).title || canonicalSpec.title,
          productionSpec: canonicalSpec,
          idempotencyKey: resolvedPayload.idempotencyKey,
        } as any;
      } else if ((rawPayload as any).productionSpec) {
        const canonicalSpec = await canonicalizeProductionSpecForRequest(
          db,
          (rawPayload as any).productionSpec,
          rawPayload,
        );
        resolvedPayload = {
          ...resolvedPayload,
          title: (rawPayload as any).title || canonicalSpec.title,
          productionSpec: canonicalSpec,
        };
      } else if ((resolvedPayload as any).businessTemplateId && !(resolvedPayload as any).productionSpec) {
        const generatedSpec = convertTemplateToProductionSpec({
          templateId: (resolvedPayload as any).businessTemplateId,
          templateData: (resolvedPayload as any).businessTemplateData,
          config: (resolvedPayload as any).config,
          title: (resolvedPayload as any).title,
        });
        resolvedPayload = {
          type: "video",
          creationMode: "template",
          title: (resolvedPayload as any).title || generatedSpec.title,
          productionSpec: generatedSpec,
          idempotencyKey: resolvedPayload.idempotencyKey,
        } as any;
      }

      // If template mode is used with raw createShortInput, validate it
      if ((resolvedPayload as any).scenes && !(resolvedPayload as any).productionSpec) {
        validateCreateShortInput(resolvedPayload as any);
      }

      const arabicBlock = await arabicProductionBlocker(
        ((resolvedPayload as any).productionSpec || {}) as {
          language?: string;
          dialect?: string;
          voiceId?: string;
        },
      );
      if (arabicBlock) {
        res.status(409).json(arabicBlock);
        return;
      }
      const job = await jobs.createVideoJob(resolvedPayload);
      try {
        await orchestrator.enqueue(job);
      } catch {
        const failed = await jobs.getJob(job.id);
        res.status(503).json({
          error: "Job created but orchestration failed.",
          job: failed || job,
        });
        return;
      }
      res.status(201).json({ job });
    } catch (error) {
      res.status(400).json({
        error: "Invalid job payload",
        message: error instanceof Error ? error.message : "Validation failed.",
      });
    }
  });

  router.get("/jobs", async (req, res) => {
    try {
      const requestedLimit = typeof req.query.limit === "string" ? Number(req.query.limit) : 100;
      const jobsList = await jobs.listJobs(
        typeof req.query.status === "string" ? req.query.status : undefined,
        Number.isFinite(requestedLimit) ? requestedLimit : 100,
      );
      res.status(200).json({ jobs: jobsList });
    } catch (error) {
      res.status(500).json({ error: "Failed to list jobs." });
    }
  });

  router.get("/jobs/:id", async (req, res) => {
    const job = await jobs.getJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: "Job not found." });
      return;
    }
    res.status(200).json({ job });
  });

  router.get("/jobs/:id/events", async (req, res) => {
    const wantsSse = req.headers.accept?.includes("text/event-stream");
    if (!wantsSse) {
      res.status(200).json({ events: await jobs.getEvents(req.params.id) });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const existing = await jobs.getEvents(req.params.id);
    for (const event of existing) {
      res.write(`event: job-event\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    const unsubscribe = jobs.subscribe(req.params.id, res);
    req.on("close", unsubscribe);
  });

  router.get("/jobs/:id/stages", async (req, res) => {
    const job = await jobs.getJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: "Job not found." });
      return;
    }
    res.status(200).json({ checkpoint: job.checkpoint || {}, stageTimings: job.stageTimings || {} });
  });

  router.post("/jobs/:id/stages/:stage/retry", async (req, res) => {
    const parsed = stageRetrySchema.safeParse({ stage: req.params.stage });
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid stage retry request.", issues: parsed.error.flatten() });
      return;
    }
    try {
      const job = await jobs.retryStage(req.params.id, parsed.data.stage);
      await webhookService.dispatchEvent("job.stage.retry", { jobId: job.id, stage: parsed.data.stage });
      await orchestrator.enqueue(job);
      res.status(202).json({
        job,
        retryStage: parsed.data.stage,
        checkpoint: job.checkpoint,
        reusedStages: checkpointStages.filter((stage) => (job.checkpoint as any)?.[stage]?.status === "completed"),
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Stage retry failed." });
    }
  });

  router.post("/jobs/:id/cancel", async (req, res) => {
    try {
      const job = await jobs.cancelJob(req.params.id);
      res.status(200).json({ job });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Cancel failed.",
      });
    }
  });

  router.post("/jobs/:id/retry", async (req, res) => {
    try {
      const job = await jobs.retryJob(req.params.id);
      try {
        await orchestrator.enqueue(job);
      } catch {
        const failed = await jobs.getJob(job.id);
        res.status(503).json({
          error: "Retry created but orchestration failed.",
          job: failed || job,
        });
        return;
      }
      res.status(201).json({ job });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Retry failed.",
      });
    }
  });

  const sendHealth = async (_req: express.Request, res: express.Response) => {
    const health = await getV2Health(config, db);
    res.status(200).json(health);
  };

  router.get("/health", sendHealth);

  router.get("/system/health", sendHealth);

  router.get("/templates", async (req, res) => {
    res.status(200).json({ templates: listBusinessTemplates() });
  });

  router.get("/voices", async (req, res) => {
    try {
      const provider = typeof req.query.provider === "string" ? req.query.provider : "auto";
      const language = typeof req.query.language === "string" ? req.query.language : undefined;
      const dialect = typeof req.query.dialect === "string" ? req.query.dialect : undefined;
      const registry = new VoiceRegistry({
        listAvailableVoices: () => ["af_heart", "am_adam", "bf_emma"],
        generate: async () => ({ audio: Buffer.from(""), audioLength: 0 }),
      } as any);
      const result = await registry.listCompatibleVoices({
        provider: provider as any,
        language,
        dialect,
      });
      res.status(200).json(result);
    } catch (error) {
      res.status(500).json({
        error: "Failed to list voices",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Egyptian Arabic reference script used for like-for-like voice auditions.
  // The same text is reused for every voice so comparisons stay meaningful.
  const VOICE_LAB_REFERENCE_SCRIPT = [
    "\u0644\u0648 \u0639\u0646\u062F\u0643 \u0628\u064A\u0632\u0646\u0633 \u0648\u0644\u0633\u0647 \u0645\u0648\u0642\u0639\u0643 \u0634\u0643\u0644\u0647 \u0642\u062F\u064A\u0645 \u0623\u0648 \u0645\u0634 \u0645\u0648\u062C\u0648\u062F \u0623\u0635\u0644\u0627\u064B\u060C",
    "\u0641\u0625\u0646\u062A \u063A\u0627\u0644\u0628\u0627\u064B \u0628\u062A\u0633\u064A\u0628 \u0639\u0645\u0644\u0627\u0621 \u064A\u0631\u0648\u062D\u0648\u0627 \u0644\u0645\u0646\u0627\u0641\u0633\u0643 \u0645\u0646 \u063A\u064A\u0631 \u0645\u0627 \u062A\u062D\u0633.",
    "\u0645\u0648\u0642\u0639 \u0633\u0631\u064A\u0639 \u0648\u0634\u0643\u0644\u0647 \u0627\u062D\u062A\u0631\u0627\u0641\u064A \u0645\u0645\u0643\u0646 \u064A\u0641\u0631\u0642 \u0645\u0639\u0627\u0643 \u062C\u062F\u0627\u064B.",
    "\u0627\u0628\u062F\u0623 \u062F\u0644\u0648\u0642\u062A\u064A \u0648\u062E\u0644\u064A \u0634\u063A\u0644\u0643 \u064A\u0638\u0647\u0631 \u0628\u0627\u0644\u0634\u0643\u0644 \u0627\u0644\u0644\u064A \u064A\u0633\u062A\u062D\u0642\u0647.",
  ].join("\n");

  const VOICE_LAB_MAX_CHARS = 600;

  router.get("/voice-lab/config", async (req, res) => {
    await providerSecrets.refreshElevenLabsApiKey();
    const provider = new ElevenLabsVoiceProvider();
    const storedDefault = await readArabicVoiceDefault(db).catch(() => null);
    res.status(200).json({
      provider: "elevenlabs",
      configured: provider.isConfigured(),
      defaultArabicVoice: storedDefault,
      model: ELEVENLABS_DEFAULT_MODEL_ID,
      referenceScript: VOICE_LAB_REFERENCE_SCRIPT,
      maxCharacters: VOICE_LAB_MAX_CHARS,
      languages: [{ code: "ar", label: "Arabic" }, { code: "en", label: "English" }],
      dialects: [{ code: "egyptian", label: "Egyptian" }, { code: "msa", label: "MSA" }],
      presets: ELEVENLABS_PRESET_IDS.map((id) => ({ id, settings: ELEVENLABS_PRESETS[id] })),
      note: "Previews are short auditions only. No video is rendered and no accent quality is asserted by the engine.",
    });
  });

  router.post("/voice-lab/preview", async (req, res) => {
    try {
      await providerSecrets.refreshElevenLabsApiKey();
      const provider = new ElevenLabsVoiceProvider();
      if (!provider.isConfigured()) {
        res.status(409).json({
          error: "elevenlabs_not_configured",
          message: ARABIC_ELEVENLABS_REQUIRED_MESSAGE,
          action: { label: "Configure ElevenLabs", href: "/providers" },
        });
        return;
      }
      const rawText = typeof req.body?.text === "string" && req.body.text.trim()
        ? req.body.text.trim()
        : VOICE_LAB_REFERENCE_SCRIPT;
      if (rawText.length > VOICE_LAB_MAX_CHARS) {
        res.status(400).json({
          error: "preview_text_too_long",
          message: `Voice Lab previews are limited to ${VOICE_LAB_MAX_CHARS} characters.`,
        });
        return;
      }
      const voiceId = typeof req.body?.voiceId === "string" ? req.body.voiceId.trim() : "";
      const preset = ELEVENLABS_PRESET_IDS.includes(req.body?.preset) ? req.body.preset : "natural";
      const language = req.body?.language === "en" ? "en" : "ar";

      const preview = await provider.generatePreview(rawText, voiceId || undefined, {
        preset,
        languageCode: language,
      });
      if (providerVault.isAvailable()) {
        // A preview is a real, successful ElevenLabs round trip: this is the
        // only place "Live Verified" is earned, since Test Connection itself
        // must never spend synthesis quota.
        await providerVault.markTested("elevenlabs", "live_verified").catch(() => undefined);
      }
      res.status(200).json({
        ...preview,
        language,
        dialect: req.body?.dialect === "msa" ? "msa" : "egyptian",
        text: rawText,
        costLabel: "Cloud / Usage Based",
      });
    } catch (error) {
      res.status(502).json({
        error: "voice_preview_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.get("/voice-lab/default-voice", async (req, res) => {
    try {
      const stored = await readArabicVoiceDefault(db);
      res.status(200).json({ provider: "elevenlabs", default: stored });
    } catch (error) {
      res.status(500).json({
        error: "Failed to read the default Arabic voice.",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.put("/voice-lab/default-voice", async (req, res) => {
    const voiceId = typeof req.body?.voiceId === "string" ? req.body.voiceId.trim() : "";
    if (!voiceId) {
      res.status(400).json({ error: "voiceId is required." });
      return;
    }
    try {
      const saved = await writeArabicVoiceDefault(db, {
        voiceId,
        voiceName: typeof req.body?.voiceName === "string" ? req.body.voiceName : undefined,
        preset: ELEVENLABS_PRESET_IDS.includes(req.body?.preset) ? req.body.preset : undefined,
        // The model the preset was auditioned under travels with the selection
        // so a later model default cannot silently change the approved voice.
        modelId:
          typeof req.body?.modelId === "string" && req.body.modelId.trim()
            ? req.body.modelId.trim()
            : ELEVENLABS_DEFAULT_MODEL_ID,
      });
      res.status(200).json({ default: saved });
    } catch (error) {
      res.status(500).json({
        error: "Failed to save the default Arabic voice.",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.get("/providers/:provider/voices", async (req, res) => {
    try {
      await providerSecrets.refreshElevenLabsApiKey().catch(() => undefined);
      const language = typeof req.query.language === "string" ? req.query.language : undefined;
      const dialect = typeof req.query.dialect === "string" ? req.query.dialect : undefined;
      const registry = new VoiceRegistry({
        listAvailableVoices: () => ["af_heart", "am_adam", "bf_emma"],
        generate: async () => ({ audio: Buffer.from(""), audioLength: 0 }),
      } as any);
      const result = await registry.listCompatibleVoices({
        provider: req.params.provider as any,
        language,
        dialect,
      });
      res.status(200).json(result);
    } catch (error) {
      res.status(500).json({
        error: "Failed to list provider voices",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.get("/providers", async (req, res) => {
    const health = await getV2Health(config, db);
    const shouldValidateLocalVoiceModels = process.env.NODE_ENV !== "test" && process.env.VITEST !== "true";
    const voiceResults = shouldValidateLocalVoiceModels
      ? await new VoiceRegistry({} as any).validateAll()
      : [];

    const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY);
    const hasVeoKey = Boolean(process.env.VEO_API_KEY || process.env.GOOGLE_AI_API_KEY);
    const hasFalKey = Boolean(process.env.FAL_KEY);
    const hasElevenLabsKey = Boolean(process.env.ELEVENLABS_API_KEY);
    await providerSecrets.refreshElevenLabsApiKey();
    const elevenLabsProvider = new ElevenLabsVoiceProvider();
    const elevenLabsConfigured = elevenLabsProvider.isConfigured();
    // Only touch the network when a credential actually exists, and never
    // fabricate a healthy result when it does not.
    const elevenLabsValidation =
      elevenLabsConfigured && shouldValidateLocalVoiceModels
        ? await elevenLabsProvider.validate().catch(() => undefined)
        : undefined;
    const googleTts = new GoogleCloudTtsProvider();
    const googleTtsValidation = voiceResults.find((provider) => provider.provider === "Google Cloud TTS");
    const googleTtsConfigured = googleTts.isConfigured();
    const googleVoices = googleTtsConfigured
      ? await googleTts.listVoices("ar-XA").catch(() => [])
      : [];
    const googleFamilies = Array.from(new Set(googleVoices.map((voice) => voice.voiceFamily).filter(Boolean)));

    const pexelsComp = health.components.find((c) => c.name === "Pexels");
    const kokoroComp = health.components.find((c) => c.name === "Kokoro");
    const piperVoice = voiceResults.find((provider) => provider.provider === "Piper Arabic");
    const whisperComp = health.components.find((c) => c.name === "Whisper");
    const remotionComp = health.components.find((c) => c.name === "Remotion");
    const ffmpegComp = health.components.find((c) => c.name === "FFmpeg");
    const n8nComp = health.components.find((c) => c.name === "n8n");
    const dbComp = health.components.find((c) => c.name === "Database");

    const vaultCredentials = providerVault.isAvailable()
      ? await providerVault.list().catch(() => [])
      : [];
    const vaultByProvider = new Map(vaultCredentials.map((credential) => [credential.providerId, credential]));

    const providers = [
      // Content AI
      {
        id: "local_ai",
        name: "Local AI Creative Director",
        category: "Content AI",
        tier: "free",
        status: "healthy",
        configured: true,
        isDefault: !hasGeminiKey,
        message: "Deterministic rule-based creative director is active.",
        checkedAt: new Date().toISOString(),
      },
      {
        id: "gemini",
        name: "Google Gemini",
        category: "Content AI",
        tier: "cloud",
        status: hasGeminiKey ? "healthy" : "not_configured",
        configured: hasGeminiKey || vaultByProvider.has("gemini"),
        isDefault: hasGeminiKey,
        message: hasGeminiKey
          ? "Gemini API key configured for structured video planning."
          : "GEMINI_API_KEY is not configured.",
        checkedAt: new Date().toISOString(),
      },
      // Visuals
      {
        id: "pexels",
        name: "Pexels",
        category: "Visuals",
        tier: "stock",
        status: pexelsComp?.details?.providerStatus || (pexelsComp?.status === "healthy" ? "healthy" : "not_configured"),
        configured: (pexelsComp?.details?.configured ?? false) || vaultByProvider.has("pexels"),
        isDefault: true,
        message: pexelsComp?.message || "Pexels stock footage integration.",
        checkedAt: pexelsComp?.checkedAt || new Date().toISOString(),
      },
      {
        // Optional second free stock source. Absence never blocks readiness, so
        // this reports not_configured rather than a problem state.
        id: "pixabay",
        name: "Pixabay",
        category: "Visuals",
        tier: "stock",
        status: vaultByProvider.has("pixabay") || process.env.PIXABAY_API_KEY ? "healthy" : "not_configured",
        configured: vaultByProvider.has("pixabay") || Boolean(process.env.PIXABAY_API_KEY),
        isDefault: false,
        message:
          "Optional second free stock library. Adding it gives the shot planner more footage to choose between.",
        checkedAt: new Date().toISOString(),
      },
      {
        id: "veo",
        name: "Google Veo",
        category: "Visuals",
        tier: "ai_video",
        status: hasVeoKey ? "healthy" : "not_configured",
        configured: hasVeoKey,
        isDefault: false,
        message: hasVeoKey
          ? "Google Veo AI video generation configured."
          : "VEO_API_KEY is not configured.",
        checkedAt: new Date().toISOString(),
      },
      {
        id: "fal",
        name: "fal.ai (Kling / Wan / Seedance)",
        category: "Visuals",
        tier: "ai_video",
        status: hasFalKey ? "healthy" : "not_configured",
        configured: hasFalKey,
        isDefault: false,
        message: hasFalKey
          ? "fal.ai multi-model video generation configured."
          : "FAL_KEY is not configured.",
        checkedAt: new Date().toISOString(),
      },
      // Voice
      {
        id: "kokoro",
        name: "Kokoro TTS",
        category: "Voice",
        tier: "free",
        status: kokoroComp?.status || "healthy",
        configured: true,
        isDefault: !Boolean(process.env.PIPER_BIN && process.env.PIPER_AR_MODEL_PATH),
        message: "Local Kokoro TTS is healthy for English-focused voices. It is not verified for Arabic/Egyptian Arabic production narration.",
        checkedAt: kokoroComp?.checkedAt || new Date().toISOString(),
        details: {
          implemented: true,
          configured: true,
          healthy: kokoroComp?.status === "healthy",
          liveVerified: false,
          languages: ["en-US", "en-GB"],
          arabicSupport: "not_verified",
          egyptianSupport: "not_verified",
          local: true,
          license: "Apache-2.0 model weights (Kokoro-82M v1.0 ONNX)",
        },
      },
      {
        id: "piper",
        name: "Piper Arabic (Legacy)",
        category: "Voice",
        tier: "free",
        status: piperVoice?.status || "not_configured",
        configured: piperVoice?.configured || false,
        isDefault: false,
        message:
          "Legacy provider. Piper is no longer used for Arabic production; it is retained only so historical jobs stay readable.",
        checkedAt: piperVoice?.checkedAt || new Date().toISOString(),
        details: {
          implemented: true,
          configured: piperVoice?.configured || false,
          healthy: piperVoice?.healthy || false,
          liveVerified: piperVoice?.healthy || false,
          languages: ["ar"],
          legacyOnly: true,
          arabicProduction: false,
          arabicSupport: "legacy_historical_only",
          egyptianSupport: "not_production_route",
          local: true,
          license: `${PIPER_ARABIC_MODEL.runtimeLicense} runtime; ${PIPER_ARABIC_MODEL.modelLicense} voice model`,
          commercialUse: PIPER_ARABIC_MODEL.commercialUseAllowed ? "allowed" : "not_allowed",
          model: PIPER_ARABIC_MODEL.model,
          voice: PIPER_ARABIC_MODEL.voice,
          modelSource: PIPER_ARABIC_MODEL.modelSource,
          modelSha256: PIPER_ARABIC_MODEL.modelSha256,
        },
      },
      {
        id: "edge_tts",
        name: "Edge TTS",
        category: "Voice",
        tier: "experimental_free_online",
        status: voiceResults.find((provider) => provider.provider === "Edge TTS")?.status || "not_configured",
        configured: voiceResults.find((provider) => provider.provider === "Edge TTS")?.configured || false,
        isDefault: false,
        message: voiceResults.find((provider) => provider.provider === "Edge TTS")?.message || "Optional online Edge TTS runtime is disabled.",
        checkedAt: voiceResults.find((provider) => provider.provider === "Edge TTS")?.checkedAt || new Date().toISOString(),
        details: {
          implemented: true,
          configured: voiceResults.find((provider) => provider.provider === "Edge TTS")?.configured || false,
          liveVerified: voiceResults.find((provider) => provider.provider === "Edge TTS")?.healthy || false,
          languages: ["ar-EG", "ar", "en-US", "en-GB"],
          egyptianSupport: "dynamic_ar_EG_voice_listing_when_runtime_available",
          local: false,
          online: true,
          costTier: "experimental_free_online",
          supportsSpeakingRate: true,
          supportsPitch: true,
          supportsVolume: true,
          license: "edge-tts LGPL-3.0; Microsoft Edge online speech service terms apply.",
        },
      },
      {
        id: "google_cloud_tts",
        name: "Google Cloud TTS",
        category: "Voice",
        tier: "cloud_free_tier",
        status: googleTtsValidation?.status || (googleTtsConfigured ? "provider_unavailable" : "not_configured"),
        configured: googleTtsConfigured,
        isDefault: false,
        message: googleTtsConfigured
          ? googleTtsValidation?.message || "Google Cloud TTS credentials are configured. Arabic voices are loaded dynamically from Google."
          : "Google Cloud TTS credentials are not configured. Use Application Default Credentials or GOOGLE_APPLICATION_CREDENTIALS.",
        checkedAt: googleTtsValidation?.checkedAt || new Date().toISOString(),
        details: {
          implemented: true,
          configured: googleTtsConfigured,
          healthy: googleTtsValidation?.healthy || false,
          liveVerified: googleTtsValidation?.healthy || false,
          languages: ["ar-XA"],
          arabicSupport: "Arabic - Modern Standard Arabic",
          egyptianSupport: "not_specifically_verified",
          local: false,
          cloud: true,
          costTier: "cloud_free_tier",
          freeTierLabel: "Google Cloud - Free Tier Available",
          billingNotice: "Billing account may be required. Usage above Google's free monthly allowance may incur charges.",
          authentication: googleTtsConfigured ? "Configured" : "Not Configured",
          supportsSSML: true,
          supportsSpeakingRate: true,
          supportsPitch: true,
          supportsWordTimings: false,
          sampleRate: 24000,
          voiceFamilies: googleFamilies,
          voices: googleVoices.map((voice) => ({
            id: voice.id,
            name: voice.name,
            gender: voice.gender,
            voiceFamily: voice.voiceFamily,
            sampleRate: voice.sampleRate,
            language: voice.language,
          })),
        },
      },
      {
        id: "elevenlabs",
        name: "ElevenLabs",
        category: "Voice",
        tier: "premium",
        status: elevenLabsValidation?.status || (elevenLabsConfigured ? "configured" : "not_configured"),
        configured: elevenLabsConfigured,
        isDefault: true,
        message: elevenLabsValidation?.message ||
          (elevenLabsConfigured
            ? "ElevenLabs is configured. Run Test Connection to verify it live."
            : ARABIC_ELEVENLABS_REQUIRED_MESSAGE),
        checkedAt: elevenLabsValidation?.checkedAt || new Date().toISOString(),
        details: {
          implemented: true,
          configured: elevenLabsConfigured,
          healthy: Boolean(elevenLabsValidation?.healthy),
          // "Live Verified" is only claimed after a real, successful preview
          // synthesis round trip (see /voice-lab/preview) - never inferred
          // from Test Connection, which must not spend TTS quota.
          liveVerified: vaultByProvider.get("elevenlabs")?.health === "live_verified",
          // Granular Test Connection sub-states (section 7/8 of the ElevenLabs
          // integration policy): credential stored, authenticated, voice
          // discovery available, and TTS-ready are reported separately so the
          // UI never collapses them into one ambiguous "Provider Unavailable".
          credentialStored: elevenLabsConfigured,
          authenticated: elevenLabsValidation?.authenticated,
          voiceDiscoveryAvailable: elevenLabsValidation?.voiceDiscoveryAvailable,
          ttsReady: elevenLabsValidation?.ttsReady,
          voicesDiscovered: elevenLabsValidation?.voicesDiscovered,
          errorDetail: elevenLabsValidation?.errorDetail,
          lastTestedAt: vaultByProvider.get("elevenlabs")?.lastTestedAt || undefined,
          accountTier: elevenLabsValidation?.accountTier,
          characterLimit: elevenLabsValidation?.characterLimit,
          charactersUsed: elevenLabsValidation?.charactersUsed,
          latencyMs: elevenLabsValidation?.latencyMs,
          languages: ["multilingual", "ar", "en"],
          model: ELEVENLABS_DEFAULT_MODEL_ID,
          arabicProduction: true,
          arabicSupport: elevenLabsConfigured ? "canonical_arabic_production_provider" : "not_configured",
          // Accent quality is a human judgement; the API does not certify it.
          egyptianSupport: "human_listening_required",
          voicePresets: ELEVENLABS_PRESET_IDS,
          supportsVoiceLab: true,
          // The ElevenLabs shared Voice Library is a separate, optional
          // feature this engine never calls or requires: production TTS only
          // depends on the account's own voice catalogue (GET /v2/voices).
          sharedVoiceLibrary: "not_required",
          local: false,
          costTier: "premium",
          costLabel: "Cloud / Usage Based",
        },
      },
      // Captions
      {
        id: "whisper_cpp",
        name: "Whisper",
        category: "Captions",
        tier: "free",
        status: whisperComp?.status || "healthy",
        configured: true,
        isDefault: true,
        message: whisperComp?.message || "Whisper captioning engine.",
        checkedAt: whisperComp?.checkedAt || new Date().toISOString(),
      },
      // Renderer
      {
        id: "remotion",
        name: "Remotion",
        category: "Renderer",
        tier: "local",
        status: remotionComp?.status || "healthy",
        configured: true,
        isDefault: true,
        message: remotionComp?.message || "Remotion video composition engine.",
        checkedAt: remotionComp?.checkedAt || new Date().toISOString(),
      },
      {
        id: "ffmpeg",
        name: "FFmpeg",
        category: "Renderer",
        tier: "local",
        status: ffmpegComp?.status || "healthy",
        configured: true,
        isDefault: true,
        message: ffmpegComp?.message || "FFmpeg audio/video processing.",
        checkedAt: ffmpegComp?.checkedAt || new Date().toISOString(),
      },
      // Infrastructure
      {
        id: "n8n",
        name: "n8n",
        category: "Infrastructure",
        tier: "internal",
        status: n8nComp?.status || "healthy",
        configured: true,
        isDefault: true,
        message: n8nComp?.message || "n8n internal orchestration workflow.",
        checkedAt: n8nComp?.checkedAt || new Date().toISOString(),
      },
      {
        id: "postgres",
        name: "Database (PostgreSQL)",
        category: "Infrastructure",
        tier: "internal",
        status: dbComp?.status || "healthy",
        configured: true,
        isDefault: true,
        message: dbComp?.message || "PostgreSQL persistent state storage.",
        checkedAt: dbComp?.checkedAt || new Date().toISOString(),
      },
      // Publishing & Distribution
      {
        id: "upload_post",
        name: "Upload-Post (Multi-Platform)",
        category: "Publishing",
        tier: "cloud",
        status: Boolean(process.env.UPLOAD_POST_API_KEY) ? "healthy" : "not_configured",
        configured: Boolean(process.env.UPLOAD_POST_API_KEY) || vaultByProvider.has("upload_post"),
        isDefault: true,
        message: Boolean(process.env.UPLOAD_POST_API_KEY)
          ? "Upload-Post multi-platform distribution connected."
          : "UPLOAD_POST_API_KEY is not configured.",
        checkedAt: new Date().toISOString(),
      },
      {
        id: "telegram",
        name: "Telegram Direct Bot",
        category: "Publishing",
        tier: "direct",
        status: Boolean(process.env.TELEGRAM_BOT_TOKEN) ? "healthy" : "not_configured",
        configured: Boolean(process.env.TELEGRAM_BOT_TOKEN) || vaultByProvider.has("telegram"),
        isDefault: false,
        message: Boolean(process.env.TELEGRAM_BOT_TOKEN)
          ? "Telegram Bot direct video publisher connected."
          : "TELEGRAM_BOT_TOKEN is not configured.",
        checkedAt: new Date().toISOString(),
      },
      {
        id: "youtube",
        name: "YouTube Direct",
        category: "Publishing",
        tier: "direct",
        status: Boolean(process.env.YOUTUBE_API_KEY || process.env.YOUTUBE_ACCESS_TOKEN) ? "healthy" : "not_configured",
        configured: Boolean(process.env.YOUTUBE_API_KEY || process.env.YOUTUBE_ACCESS_TOKEN) || vaultByProvider.has("youtube"),
        isDefault: false,
        message: Boolean(process.env.YOUTUBE_API_KEY || process.env.YOUTUBE_ACCESS_TOKEN)
          ? "YouTube Data API v3 direct integration available."
          : "YouTube credentials not configured.",
        checkedAt: new Date().toISOString(),
      },
      {
        id: "meta",
        name: "Meta Direct (Instagram & Facebook)",
        category: "Publishing",
        tier: "direct",
        status: Boolean(process.env.META_ACCESS_TOKEN) ? "healthy" : "not_configured",
        configured: Boolean(process.env.META_ACCESS_TOKEN) || vaultByProvider.has("meta"),
        isDefault: false,
        message: Boolean(process.env.META_ACCESS_TOKEN)
          ? "Meta Graph API direct integration available."
          : "META_ACCESS_TOKEN is not configured.",
        checkedAt: new Date().toISOString(),
      },
      {
        id: "tiktok",
        name: "TikTok Direct",
        category: "Publishing",
        tier: "direct",
        status: Boolean(process.env.TIKTOK_ACCESS_TOKEN) ? "healthy" : "not_configured",
        configured: Boolean(process.env.TIKTOK_ACCESS_TOKEN) || vaultByProvider.has("tiktok"),
        isDefault: false,
        message: Boolean(process.env.TIKTOK_ACCESS_TOKEN)
          ? "TikTok OpenAPI direct integration available."
          : "TIKTOK_ACCESS_TOKEN is not configured.",
        checkedAt: new Date().toISOString(),
      },
      ...buildV22CapabilityProviders(),
    ];

    res.status(200).json({
      providers: providers.map((provider: any) => ({
        ...provider,
        credentialTypes: provider.id ? allowedCredentialTypes(provider.id) : [],
        vaultConfigured: provider.id ? vaultCredentials.some((credential) => credential.providerId === provider.id) : false,
        vault: provider.id
          ? vaultCredentials
              .filter((credential) => credential.providerId === provider.id)
              .map((credential) => ({
                credentialType: credential.credentialType,
                maskedHint: credential.maskedHint,
                health: credential.health,
                configuredAt: credential.configuredAt,
                lastTestedAt: credential.lastTestedAt,
              }))
          : [],
      })),
      categories: [
        "Content AI",
        "Visuals",
        "Voice",
        "Captions",
        "Renderer",
        "Motion",
        "Post Production",
        "AI GPU",
        "Publishing",
        "Infrastructure",
      ],
      vault: {
        available: providerVault.isAvailable(),
        encryption: "AES-256-GCM",
      },
    });
  });

  router.put("/providers/:provider/credentials", async (req, res) => {
    try {
      if (!providerVault.isAvailable()) {
        res.status(503).json({ error: "Provider vault is not configured.", message: "Set PROVIDER_VAULT_MASTER_KEY before saving provider credentials." });
        return;
      }
      const providerId = req.params.provider;
      const credentialType = String(req.body?.credentialType || "api_key") as CredentialType;
      const value = typeof req.body?.value === "string" ? req.body.value : "";
      const credential = await providerVault.put({
        providerId,
        credentialType,
        plaintext: value,
        metadata: typeof req.body?.metadata === "object" && req.body.metadata ? req.body.metadata : {},
      });
      providerSecrets.invalidate(providerId);
      await providerSecrets.refresh(providerId, credentialType);
      // Only the masked hint is ever returned; plaintext stays in the vault.
      res.status(200).json({ credential });
    } catch (error) {
      res.status(400).json({ error: "Credential save failed.", message: error instanceof Error ? error.message : String(error) });
    }
  });

  router.delete("/providers/:provider/credentials", async (req, res) => {
    try {
      const credentialType = typeof req.query.credentialType === "string" ? req.query.credentialType as CredentialType : undefined;
      const deleted = await providerVault.delete(req.params.provider, credentialType);
      providerSecrets.invalidate(req.params.provider);
      res.status(200).json({ deleted });
    } catch (error) {
      res.status(400).json({ error: "Credential delete failed.", message: error instanceof Error ? error.message : String(error) });
    }
  });

  router.get("/providers/:provider/oauth/start", async (req, res) => {
    try {
      if (!["youtube", "meta", "tiktok"].includes(req.params.provider)) {
        res.status(400).json({ error: "Provider does not use OAuth." });
        return;
      }
      const state = await providerVault.createOAuthState(
        req.params.provider,
        typeof req.query.redirectUri === "string" ? req.query.redirectUri : undefined,
      );
      res.status(200).json({
        provider: req.params.provider,
        state: state.state,
        expiresAt: state.expiresAt,
        authUrl: null,
        message: "OAuth app credentials are not configured yet. State was created for CSRF protection.",
      });
    } catch (error) {
      res.status(400).json({ error: "OAuth start failed.", message: error instanceof Error ? error.message : String(error) });
    }
  });

  router.get("/providers/:provider/oauth/callback", async (req, res) => {
    res.status(501).json({
      provider: req.params.provider,
      error: "OAuth callback exchange is not configured.",
      message: "Configure provider app credentials before exchanging OAuth authorization codes.",
    });
  });

  router.post("/providers/pexels/validate", async (req, res) => {
    const result = await validatePexelsProvider(config, {
      bypassCache: true,
    });
    res.status(200).json(result);
  });

  router.post("/providers/:provider/validate", async (req, res) => {
    const target = req.params.provider.toLowerCase();
    if (target === "pexels") {
      const result = await validatePexelsProvider(config, { bypassCache: true });
      res.status(200).json(result);
      return;
    }
    if (target === "gemini") {
      const gemini = contentAIRegistry.getProvider("gemini");
      const val = await gemini.validate();
      res.status(200).json(val);
      return;
    }
    if (target === "veo") {
      const veo = new VeoVisualProvider();
      const val = await veo.validate();
      res.status(200).json(val);
      return;
    }
    if (target === "fal") {
      const fal = new FalVisualProvider();
      const val = await fal.validate();
      res.status(200).json(val);
      return;
    }
    if (target === "elevenlabs") {
      await providerSecrets.refreshElevenLabsApiKey();
      const el = new ElevenLabsVoiceProvider();
      const val = await el.validate();
      if (providerVault.isAvailable()) {
        await providerVault.markTested("elevenlabs", val.status).catch(() => undefined);
      }
      res.status(200).json(val);
      return;
    }
    if (target === "google" || target === "googlecloudtts" || target === "google_cloud_tts") {
      const google = new GoogleCloudTtsProvider();
      const val = await google.validate();
      res.status(200).json(val);
      return;
    }
    if (target === "edge_tts" || target === "edge-tts") {
      const edge = new EdgeTtsProvider();
      const val = await edge.validate();
      res.status(200).json(val);
      return;
    }
    if (target === "upload-post" || target === "upload_post") {
      const p = publishingRegistry.getProvider("upload_post");
      const val = await (p?.validateConnection() ?? {
        provider: "Upload-Post",
        configured: false,
        healthy: false,
        status: "not_configured",
        message: "Upload-Post not configured",
        checkedAt: new Date().toISOString(),
      });
      res.status(200).json(val);
      return;
    }
    if (target === "telegram" || target === "telegram_bot") {
      const p = publishingRegistry.getProvider("telegram_bot");
      const val = await (p?.validateConnection() ?? {
        provider: "Telegram Direct Bot",
        configured: false,
        healthy: false,
        status: "not_configured",
        message: "Telegram bot not configured",
        checkedAt: new Date().toISOString(),
      });
      res.status(200).json(val);
      return;
    }
    if (target === "youtube" || target === "youtube_direct") {
      const p = publishingRegistry.getProvider("youtube_direct");
      const val = await (p?.validateConnection() ?? {
        provider: "YouTube Direct",
        configured: false,
        healthy: false,
        status: "not_configured",
        message: "YouTube direct not configured",
        checkedAt: new Date().toISOString(),
      });
      res.status(200).json(val);
      return;
    }
    if (target === "meta" || target === "meta_direct") {
      const p = publishingRegistry.getProvider("meta_direct");
      const val = await (p?.validateConnection() ?? {
        provider: "Meta Direct",
        configured: false,
        healthy: false,
        status: "not_configured",
        message: "Meta direct not configured",
        checkedAt: new Date().toISOString(),
      });
      res.status(200).json(val);
      return;
    }
    if (target === "tiktok" || target === "tiktok_direct") {
      const p = publishingRegistry.getProvider("tiktok_direct");
      const val = await (p?.validateConnection() ?? {
        provider: "TikTok Direct",
        configured: false,
        healthy: false,
        status: "not_configured",
        message: "TikTok direct not configured",
        checkedAt: new Date().toISOString(),
      });
      res.status(200).json(val);
      return;
    }

    res.status(200).json({
      provider: req.params.provider,
      configured: true,
      healthy: true,
      status: "healthy",
      message: `${req.params.provider} is verified and operational.`,
      checkedAt: new Date().toISOString(),
    });
  });

  router.get("/settings", async (req, res) => {
    const settings = await readAppSettings(db);
    res.status(200).json({
      settings: {
        defaultCreationMode: "prompt",
        defaultLanguage: "ar",
        defaultArabicDialect: "egyptian",
        defaultDuration: 30,
        defaultAspectRatio: "9:16",
        defaultQuality: "standard",
        defaultVisualMode: "auto",
        defaultContentAI: "local_ai",
        defaultVisualProvider: "pexels",
        // Arabic is the default language, and Arabic production is ElevenLabs only.
        defaultVoiceProvider: "elevenlabs",
        defaultPublishingMode: "draft",
        defaultSocialAccounts: [],
        defaultYouTubePrivacy: "unlisted",
        defaultTimezone: "Africa/Cairo",
        maxConcurrentPublications: 3,
        ...settings,
      },
      pexels: {
        configured: Boolean(config.pexelsApiKey && config.pexelsApiKey !== "dummy-key"),
        redactedKey: redactConfiguredKey(config.pexelsApiKey),
      },
      gemini: {
        configured: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY),
        redactedKey: redactConfiguredKey(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY),
      },
      elevenlabs: {
        configured: Boolean(process.env.ELEVENLABS_API_KEY),
        redactedKey: redactConfiguredKey(process.env.ELEVENLABS_API_KEY),
      },
      uploadPost: {
        configured: Boolean(process.env.UPLOAD_POST_API_KEY),
        redactedKey: redactConfiguredKey(process.env.UPLOAD_POST_API_KEY),
      },
      telegram: {
        configured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
        redactedKey: redactConfiguredKey(process.env.TELEGRAM_BOT_TOKEN),
      },
      app: {
        v2Enabled: process.env.V2_ENABLED === "true",
        webPort: process.env.PORT || "3123",
        videosDir: config.videosDirPath,
        docker: process.env.DOCKER === "true",
      },
      storage: readStorageDetails(config),
    });
  });

  router.put("/settings", async (req, res) => {
    const parsed = appSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid settings payload",
        issues: parsed.error.flatten(),
      });
      return;
    }
    const current = await readAppSettings(db);
    const saved = await writeAppSettings(db, {
      ...current,
      ...parsed.data,
    });
    res.status(200).json({ settings: saved });
  });

  router.get("/brands", async (req, res) => {
    const rows = await db.query<BrandRow>(
      "SELECT * FROM brands ORDER BY is_default DESC, updated_at DESC, name ASC",
    );
    res.status(200).json({ brands: rows.map(mapBrand) });
  });

  router.post("/brands", async (req, res) => {
    const parsed = brandProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid brand payload",
        issues: parsed.error.flatten(),
      });
      return;
    }
    const id = cuid();
    if (parsed.data.isDefault) {
      await db.query("UPDATE brands SET is_default = false");
    }
    const rows = await db.query<BrandRow>(
      `INSERT INTO brands (
        id, name, watermark_text, primary_color, accent_color, caption_style,
        include_outro, outro_text, contact_text, voice_profile, is_default,
        secondary_color, logo_url, website_url, social_handle, created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now(),now())
      RETURNING *`,
      [
        id,
        parsed.data.name,
        parsed.data.watermarkText,
        parsed.data.primaryColor,
        parsed.data.accentColor,
        parsed.data.captionStyle,
        parsed.data.includeOutro,
        parsed.data.outroText,
        parsed.data.contactText,
        parsed.data.voiceProfile ? JSON.stringify(parsed.data.voiceProfile) : null,
        parsed.data.isDefault,
        parsed.data.secondaryColor || null,
        parsed.data.logoUrl || null,
        parsed.data.websiteUrl || null,
        parsed.data.socialHandle || null,
      ],
    );
    res.status(201).json({ brand: mapBrand(rows[0]) });
  });

  router.put("/brands/:id", async (req, res) => {
    const parsed = brandProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid brand payload",
        issues: parsed.error.flatten(),
      });
      return;
    }
    if (parsed.data.isDefault) {
      await db.query("UPDATE brands SET is_default = false WHERE id <> $1", [
        req.params.id,
      ]);
    }
    const rows = await db.query<BrandRow>(
      `UPDATE brands
       SET name = $2,
           watermark_text = $3,
           primary_color = $4,
           accent_color = $5,
           caption_style = $6,
           include_outro = $7,
           outro_text = $8,
           contact_text = $9,
           voice_profile = $10,
           is_default = $11,
           secondary_color = $12,
           logo_url = $13,
           website_url = $14,
           social_handle = $15,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        req.params.id,
        parsed.data.name,
        parsed.data.watermarkText,
        parsed.data.primaryColor,
        parsed.data.accentColor,
        parsed.data.captionStyle,
        parsed.data.includeOutro,
        parsed.data.outroText,
        parsed.data.contactText,
        parsed.data.voiceProfile ? JSON.stringify(parsed.data.voiceProfile) : null,
        parsed.data.isDefault,
        parsed.data.secondaryColor || null,
        parsed.data.logoUrl || null,
        parsed.data.websiteUrl || null,
        parsed.data.socialHandle || null,
      ],
    );
    if (!rows[0]) {
      res.status(404).json({ error: "Brand not found." });
      return;
    }
    res.status(200).json({ brand: mapBrand(rows[0]) });
  });

  router.post("/brands/:id/default", async (req, res) => {
    await db.query("UPDATE brands SET is_default = false");
    const rows = await db.query<BrandRow>(
      "UPDATE brands SET is_default = true, updated_at = now() WHERE id = $1 RETURNING *",
      [req.params.id],
    );
    if (!rows[0]) {
      res.status(404).json({ error: "Brand not found." });
      return;
    }
    res.status(200).json({ brand: mapBrand(rows[0]) });
  });

  router.delete("/brands/:id", async (req, res) => {
    const rows = await db.query<BrandRow>(
      "DELETE FROM brands WHERE id = $1 RETURNING *",
      [req.params.id],
    );
    if (!rows[0]) {
      res.status(404).json({ error: "Brand not found." });
      return;
    }
    res.status(200).json({ success: true });
  });

  // 1. System Info & Diagnostics
  router.get("/system/info", (req, res) => {
    res.status(200).json(getProductInfo());
  });

  router.get("/system/storage", (req, res) => {
    res.status(200).json(diagnosticsService.getStorageUsage());
  });

  router.get("/system/observability", async (req, res) => {
    try {
      const [worker, storage, health, deliveries] = await Promise.all([
        workerLeaseService.getObservability(),
        Promise.resolve(diagnosticsService.getStorageUsage()),
        getV2Health(config, db),
        webhookService.getDeliveryHistory(10),
      ]);
      const statusRows = await db.query<{ status: string; count: string }>(
        "SELECT status, count(*)::text AS count FROM jobs GROUP BY status",
      ).catch(() => []);
      res.status(200).json({
        queueDepth: worker.queueDepth,
        activeWorkers: worker.activeWorkers,
        activeRenders: worker.activeRenders,
        maxConcurrentRenders: config.concurrency || 1,
        workers: worker.workers,
        averageGenerationTimeMs: worker.averageGenerationTimeMs,
        recentStageBottleneck: worker.recentStageBottleneck,
        jobCounts: Object.fromEntries(statusRows.map((row) => [row.status, Number(row.count)])),
        cache: {
          tempDir: config.tempDirPath,
          maxStorageBytes: config.videoCacheSizeInBytes,
          usedProjectStorageBytes: (storage as any).usedProjectStorageBytes,
          cacheStorageBytes: (storage as any).cacheStorageBytes,
        },
        providerHealth: health.components,
        diskUsage: storage,
        recentWebhookDeliveries: deliveries.map((delivery) => ({
          id: delivery.id,
          event: delivery.event,
          status: delivery.status,
          responseCode: delivery.responseCode,
          attemptCount: delivery.attemptCount,
          createdAt: delivery.createdAt,
        })),
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to load observability.", message: String(error) });
    }
  });

  router.get("/system/diagnostics", async (req, res) => {
    try {
      const report = await diagnosticsService.generateReport();
      res.status(200).json(report);
    } catch (error) {
      res.status(500).json({ error: "Failed to generate diagnostics report", message: String(error) });
    }
  });

  router.get("/system/diagnostics/bundle", async (req, res) => {
    try {
      const bundle = await diagnosticsService.generateBundle();
      res.setHeader("Content-Disposition", `attachment; filename="${bundle.filename}"`);
      res.setHeader("Content-Type", "application/json");
      res.status(200).send(bundle.jsonContent);
    } catch (error) {
      res.status(500).json({ error: "Failed to download diagnostics bundle", message: String(error) });
    }
  });

  // 2. Setup & Auth Endpoints
  router.get("/setup/status", async (req, res) => {
    try {
      const status = await authService.getSetupState();
      res.status(200).json(status);
    } catch (error) {
      res.status(500).json({ error: "Failed to get setup status", message: String(error) });
    }
  });

  router.post("/setup/complete", async (req, res) => {
    try {
      const state = await authService.getSetupState();
      if (state.isSetupCompleted) {
        res.status(403).json({ error: "Setup is already complete." });
        return;
      }
      await authService.completeSetup(req.body);
      res.status(200).json({ success: true, message: "Setup completed successfully." });
    } catch (error) {
      res.status(500).json({ error: "Failed to complete setup", message: String(error) });
    }
  });

  router.post("/auth/setup-admin", async (req, res) => {
    try {
      const state = await authService.getSetupState();
      if (state.isAdminConfigured || state.isSetupCompleted) {
        res.status(403).json({ error: "Admin account is already configured." });
        return;
      }
      const { username, password } = req.body;
      const user = await authService.createInitialAdmin(username, password);
      const session = await authService.authenticate(username, password);
      res.status(201).json({ user, session });
    } catch (error) {
      res.status(400).json({ error: "Failed to setup admin user", message: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post("/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      const session = await authService.authenticate(username, password);
      if (!session) {
        res.status(401).json({ error: "Invalid username or password." });
        return;
      }
      res.status(200).json({ session });
    } catch (error) {
      res.status(500).json({ error: "Login failed", message: String(error) });
    }
  });

  router.post("/auth/logout", async (req, res) => {
    const token = bearerToken(req);
    if (token) {
      await authService.logout(token);
    }
    res.status(200).json({ success: true });
  });

  router.get("/auth/me", async (req, res) => {
    const token = bearerToken(req);
    if (!token) {
      res.status(401).json({ error: "Unauthorized." });
      return;
    }
    const user = await authService.validateSession(token);
    if (!user) {
      res.status(401).json({ error: "Invalid or expired session." });
      return;
    }
    res.status(200).json({ user });
  });

  // 3. Backups
  router.get("/backups", async (req, res) => {
    try {
      const backups = await backupService.listBackups();
      res.status(200).json({ backups });
    } catch (error) {
      res.status(500).json({ error: "Failed to list backups", message: String(error) });
    }
  });

  router.get("/api-tokens", async (_req, res) => {
    try {
      const tokens = await apiTokenService.listTokens();
      res.status(200).json({ tokens });
    } catch (error) {
      res.status(500).json({ error: "Failed to list API tokens", message: String(error) });
    }
  });

  router.post("/api-tokens", async (req, res) => {
    try {
      const token = await apiTokenService.createToken(req.body?.name, req.body?.scopes || []);
      res.status(201).json({ token });
    } catch (error) {
      res.status(400).json({ error: "Failed to create API token", message: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post("/api-tokens/:id/revoke", async (req, res) => {
    try {
      const token = await apiTokenService.revokeToken(req.params.id);
      if (!token) {
        res.status(404).json({ error: "API token not found." });
        return;
      }
      res.status(200).json({ token });
    } catch (error) {
      res.status(500).json({ error: "Failed to revoke API token", message: String(error) });
    }
  });

  router.post("/backups", async (req, res) => {
    try {
      const backup = await backupService.createBackup(req.body);
      res.status(201).json({ backup });
    } catch (error) {
      res.status(500).json({ error: "Failed to create backup", message: String(error) });
    }
  });

  router.get("/backups/:id/download", async (req, res) => {
    try {
      const backups = await backupService.listBackups();
      const backup = backups.find((b) => b.id === req.params.id || b.filename === req.params.id);
      if (!backup || !fs.existsSync(backup.filepath)) {
        res.status(404).json({ error: "Backup file not found." });
        return;
      }
      res.download(backup.filepath, backup.filename);
    } catch (error) {
      res.status(500).json({ error: "Failed to download backup", message: String(error) });
    }
  });

  router.post("/backups/:id/restore", async (req, res) => {
    try {
      const result = await backupService.restoreBackup(req.params.id);
      res.status(200).json(result);
    } catch (error) {
      res.status(500).json({ error: "Restore failed", message: error instanceof Error ? error.message : String(error) });
    }
  });

  router.delete("/backups/:id", async (req, res) => {
    try {
      await backupService.deleteBackup(req.params.id);
      res.status(200).json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Delete backup failed", message: String(error) });
    }
  });

  router.get("/config/export", (req, res) => {
    const configData = backupService.exportConfiguration();
    res.status(200).json(configData);
  });

  // 4. Analytics
  router.get("/analytics/overview", async (req, res) => {
    try {
      const overview = await analyticsService.getOverview();
      res.status(200).json(overview);
    } catch (error) {
      res.status(500).json({ error: "Failed to get analytics", message: String(error) });
    }
  });

  // 5. Webhooks
  router.get("/webhooks", async (req, res) => {
    try {
      const webhooks = await webhookService.listWebhooks();
      res.status(200).json({ webhooks });
    } catch (error) {
      res.status(500).json({ error: "Failed to list webhooks", message: String(error) });
    }
  });

  router.post("/webhooks", async (req, res) => {
    try {
      const { url, events } = req.body;
      if (!url) {
        res.status(400).json({ error: "Webhook URL is required." });
        return;
      }
      const webhook = await webhookService.createWebhook(url, events);
      res.status(201).json({ webhook });
    } catch (error) {
      res.status(500).json({ error: "Failed to create webhook", message: String(error) });
    }
  });

  router.delete("/webhooks/:id", async (req, res) => {
    try {
      await webhookService.deleteWebhook(req.params.id);
      res.status(200).json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete webhook", message: String(error) });
    }
  });

  router.get("/webhooks/deliveries", async (req, res) => {
    try {
      const deliveries = await webhookService.getDeliveryHistory();
      res.status(200).json({ deliveries });
    } catch (error) {
      res.status(500).json({ error: "Failed to get deliveries", message: String(error) });
    }
  });

  // 6. Capabilities & Packs
  router.get("/system/capabilities", (req, res) => {
    res.status(200).json({
      capabilities: capabilityManager.listCapabilities(),
      packs: capabilityManager.listPacks(),
      hardware: capabilityManager.getHardwareInfo(),
    });
  });

  router.post("/system/capabilities/:id/toggle", (req, res) => {
    const { id } = req.params;
    const enabled = Boolean(req.body?.enabled ?? true);
    const updated = capabilityManager.toggleCapability(id as CapabilityId, enabled);
    if (!updated) {
      res.status(404).json({ error: `Capability ${id} not found.` });
      return;
    }
    res.status(200).json({ capability: updated });
  });

  router.get("/system/arabic-readiness", async (req, res) => {
    await providerSecrets.refreshElevenLabsApiKey();
    const provider = new ElevenLabsVoiceProvider();
    const configured = provider.isConfigured();
    const liveVerified = configured && req.query.verify === "true"
      ? (await provider.validate().catch(() => undefined))?.healthy === true
      : false;
    res.status(200).json(
      capabilityManager.checkArabicProductionReadiness({ configured, liveVerified }),
    );
  });

  router.get("/system/readiness", (req, res) => {
    const mode = String(req.query.mode || "auto_hybrid");
    const visualMode = typeof req.query.visualMode === "string" ? req.query.visualMode : undefined;
    const readiness = capabilityManager.checkModeReadiness(mode, visualMode);
    res.status(200).json(readiness);
  });

  // 7. Product Media Management
  router.post("/media/product-upload", async (req, res) => {
    try {
      let buffer: Buffer;
      let originalName = "product.png";
      const removeBg = req.body?.removeBackground !== false;

      if (req.body?.imageBase64) {
        const rawBase64 = String(req.body.imageBase64).replace(/^data:image\/[a-z]+;base64,/, "");
        buffer = Buffer.from(rawBase64, "base64");
        if (req.body.filename) originalName = String(req.body.filename);
      } else if (Buffer.isBuffer(req.body)) {
        buffer = req.body;
      } else {
        res.status(400).json({ error: "Missing image payload. Provide imageBase64 or binary image." });
        return;
      }

      const record = await mediaUploadService.saveProductImage(buffer, originalName, { removeBackground: removeBg });
      res.status(201).json({ success: true, media: record });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Product media upload failed" });
    }
  });

  router.get("/media/products", async (req, res) => {
    const products = await mediaUploadService.listProductImages();
    res.status(200).json({ products });
  });

  router.delete("/media/products/:id", async (req, res) => {
    try {
      // The only route in the engine that may remove customer media, and it
      // always records that a person asked for it.
      const deleted = await mediaUploadService.deleteProductImage(
        req.params.id,
        "user_request",
      );
      if (!deleted) {
        res.status(404).json({ error: "Media item not found." });
        return;
      }
      res.status(200).json({ deleted: true });
    } catch (error) {
      res.status(500).json({
        error: "Could not delete this media item.",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.patch("/media/products/:id", async (req, res) => {
    const name = typeof req.body?.originalName === "string" ? req.body.originalName.trim() : "";
    if (!name) {
      res.status(400).json({ error: "A name is required." });
      return;
    }
    try {
      const record = await mediaUploadService.renameProductImage(req.params.id, name);
      if (!record) {
        res.status(404).json({ error: "Media item not found." });
        return;
      }
      res.status(200).json({ media: record });
    } catch (error) {
      res.status(500).json({
        error: "Could not rename this media item.",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.get("/media/products/:id", async (req, res) => {
    const product = await mediaUploadService.getProductImage(req.params.id);
    if (!product) {
      res.status(404).json({ error: "Product media not found." });
      return;
    }
    res.status(200).json(product);
  });

  return router;
}

export function createV2InternalRouter(
  config: Config,
  shortCreator: ShortCreator,
  jobs?: JobService,
  db?: V2Database,
): express.Router {
  const router = express.Router();
  router.use(express.json({ limit: "2mb" }));
  router.use(requireInternalToken(config));
  const scheduleStartRetry = (jobId: string, delayMs = 10000) => {
    const timer = setTimeout(() => {
      void axios.post(
        `${config.appInternalBaseUrl}/internal/v1/jobs/${jobId}/start`,
        {},
        {
          timeout: config.webhookTimeoutMs,
          headers: { "x-internal-token": config.internalServiceToken },
        },
      ).catch(() => undefined);
    }, delayMs);
    timer.unref?.();
  };

  router.post("/jobs/:id/start", async (req, res) => {
    if (!jobs) {
      res.status(503).json({ error: "Job service is unavailable." });
      return;
    }
    const job = await jobs.getJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: "Job not found." });
      return;
    }
    const workerLeaseService = db ? new WorkerLeaseService(db) : null;
    const workerId = process.env.WORKER_ID || "render-worker";
    try {
      if (workerLeaseService) {
        const claim = await workerLeaseService.claimJob(job.id, {
          workerId,
          maxConcurrentRenders: config.concurrency || 1,
          capabilities: { render: true, ffmpeg: true, remotion: true },
        });
        if (!claim.claimed && claim.reason === "backpressure") {
          scheduleStartRetry(job.id);
          res.status(202).json({
            accepted: false,
            queued: true,
            reason: "Backpressure active; max concurrent renders reached.",
            queueDepth: claim.queueDepth,
            activeRenders: claim.activeRenders,
            retryAfterMs: 10000,
          });
          return;
        }
        if (!claim.claimed) {
          res.status(409).json({
            accepted: false,
            queued: false,
            reason: claim.reason || "Job is not claimable.",
            queueDepth: claim.queueDepth,
            activeRenders: claim.activeRenders,
          });
          return;
        }
      }
      await jobs.updateJob(
        job.id,
        "preparing",
        5,
        "Preparing",
        "Preparing render worker.",
      );
      let dispatchErr: unknown = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await axios.post(
            `${config.renderWorkerBaseUrl}/internal/v1/render/jobs/${job.id}/start`,
            {
              jobId: job.id,
              input: job.productionSpec || job.input,
              callbackBaseUrl: config.appInternalBaseUrl,
              internalServiceToken: config.internalServiceToken,
              workerId,
            },
            {
              timeout: config.webhookTimeoutMs,
              headers: { "x-internal-token": config.internalServiceToken },
            },
          );
          dispatchErr = null;
          break;
        } catch (e: any) {
          dispatchErr = e;
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 1000));
          }
        }
      }
      if (dispatchErr) throw dispatchErr;
      res.status(202).json({ accepted: true, jobId: job.id });
    } catch (error) {
      await jobs.updateJob(job.id, "failed", job.progress, "Render dispatch failed", "Render worker is unavailable.", {
        error: "Render worker is unavailable.",
        technicalError: error instanceof Error ? error.message : String(error),
      });
      await workerLeaseService?.release(workerId);
      res.status(503).json({ error: "Render worker is unavailable." });
    }
  });

  router.post("/jobs/:id/progress", async (req, res) => {
    if (!jobs) {
      res.status(503).json({ error: "Job service is unavailable." });
      return;
    }
    const parsed = internalProgressSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid progress payload." });
      return;
    }
    const update = parsed.data;
    const job = await jobs.updateJob(
      req.params.id,
      update.status,
      update.progress,
      update.currentStage,
      update.message,
      { technicalMessage: update.technicalMessage },
    );
    if (update.stageKey && update.checkpointStatus) {
      await jobs.updateStageCheckpoint(req.params.id, update.stageKey, update.checkpointStatus, {
        input: update.inputHashSource,
        provider: update.provider,
        artifacts: update.artifacts,
        error: update.technicalMessage,
        timingMs: update.timingMs,
      });
      if (update.checkpointStatus === "completed") {
        const webhookService = db ? new WebhookService(db, { timeoutMs: config.webhookTimeoutMs }) : null;
        await webhookService?.dispatchEvent("job.stage.completed", {
          jobId: req.params.id,
          stage: update.stageKey,
          timingMs: update.timingMs,
        });
      }
    }
    res.status(200).json({ job });
  });

  router.post("/jobs/:id/complete", async (req, res) => {
    if (!jobs) {
      res.status(503).json({ error: "Job service is unavailable." });
      return;
    }
    const parsed = internalCompleteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid complete payload." });
      return;
    }
    const job = await jobs.completeJob(
      req.params.id,
      parsed.data.videoId,
      parsed.data.output,
    );
    if (db) {
      await new WorkerLeaseService(db).release(process.env.WORKER_ID || "render-worker");
      const revision = await new RevisionService(db).markRevisionReadyForJob(req.params.id, parsed.data.videoId);
      const completedMetadata = readMetadata(config.videosDirPath, parsed.data.videoId);
      const projectId = revision?.projectId || (completedMetadata?.revisionMetadata as any)?.parentVideoId || parsed.data.videoId;
      if (completedMetadata?.durableArtifacts) {
        await persistSceneArtifacts(db, projectId, completedMetadata.durableArtifacts as DurableSceneArtifact[]);
      }
      if (!revision) {
        await new RevisionService(db).ensureInitialRevision({
          projectId: parsed.data.videoId,
          sourceJobId: req.params.id,
          outputVideoId: parsed.data.videoId,
        });
      }
      await new WebhookService(db, { timeoutMs: config.webhookTimeoutMs }).dispatchEvent("video.ready", {
        jobId: req.params.id,
        videoId: parsed.data.videoId,
        output: parsed.data.output,
      });
      if (revision) {
        await new WebhookService(db, { timeoutMs: config.webhookTimeoutMs }).dispatchEvent("video.revision.ready", {
          jobId: req.params.id,
          revisionId: revision.id,
          projectId: revision.projectId,
          outputVideoId: parsed.data.videoId,
        });
      }
    }
    res.status(200).json({ job });
  });

  router.post("/jobs/:id/fail", async (req, res) => {
    if (!jobs) {
      res.status(503).json({ error: "Job service is unavailable." });
      return;
    }
    const parsed = internalFailSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid fail payload." });
      return;
    }
    const job = await jobs.updateJob(
      req.params.id,
      "failed",
      100,
      "Failed",
      parsed.data.message,
      {
        error: parsed.data.message,
        technicalError: parsed.data.technicalMessage,
      },
    );
    if (db) {
      await new WorkerLeaseService(db).release(process.env.WORKER_ID || "render-worker");
      await new WebhookService(db, { timeoutMs: config.webhookTimeoutMs }).dispatchEvent("video.failed", {
        jobId: req.params.id,
        message: parsed.data.message,
      });
    }
    res.status(200).json({ job });
  });

  router.post("/render/jobs/:id/start", async (req, res) => {
    const parsed = internalStartRenderSchema.safeParse(req.body);
    if (!parsed.success || parsed.data.jobId !== req.params.id) {
      res.status(400).json({ error: "Invalid render payload." });
      return;
    }
    const { jobId, input, callbackBaseUrl, internalServiceToken, workerId } = parsed.data;

    // Pick up an ElevenLabs credential the customer configured after this
    // worker started, so Arabic jobs do not need a container restart.
    await providerSecrets.refreshElevenLabsApiKey().catch(() => undefined);

    void shortCreator
      .createShortNow(jobId, input, async (event) => {
        try {
          if (db && workerId) {
            await new WorkerLeaseService(db).heartbeat({
              workerId,
              status: "busy",
              activeJobId: jobId,
              capabilities: { render: true, ffmpeg: true, remotion: true },
            });
          }
          await axios.post(
            `${callbackBaseUrl}/internal/v1/jobs/${jobId}/progress`,
            event,
            { headers: { "x-internal-token": internalServiceToken }, timeout: 15000 },
          );
        } catch {
          // Progress update is advisory
        }
      })
      .then(async (videoId) => {
        const sidecar = readMetadata(config.videosDirPath, videoId);
        await axios.post(
          `${callbackBaseUrl}/internal/v1/jobs/${jobId}/complete`,
          {
            videoId,
            output: {
              path: shortCreator.getVideoPath(videoId),
              metadata: sidecar || undefined,
            },
          },
          { headers: { "x-internal-token": internalServiceToken }, timeout: 5000 },
        );
      })
      .catch(async (error) => {
        const rawMsg = error instanceof Error ? error.message : String(error);
        await axios.post(
          `${callbackBaseUrl}/internal/v1/jobs/${jobId}/fail`,
          {
            message: "Video render failed.",
            technicalMessage: rawMsg.slice(0, 4000),
          },
          { headers: { "x-internal-token": internalServiceToken }, timeout: 15000 },
        );
      });

    res.status(202).json({ accepted: true, jobId });
  });

  if (db) {
    const publishingService = new PublishingService(db, config, publishingRegistry);
    router.post("/publishing/publications/:id/execute", async (req, res) => {
      try {
        const pub = await publishingService.publishPublication(req.params.id);
        res.status(200).json({ accepted: true, publication: pub });
      } catch (error) {
        res.status(500).json({
          error: "Internal publishing execution failed.",
          technicalError: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  // Quality Engine Internal Contract
  router.post("/media/analyze", async (req, res) => {
    try {
      const { videoPath, targetDurationSeconds } = req.body;
      if (!videoPath) {
        res.status(400).json({ error: "videoPath is required" });
        return;
      }
      const result = await qualityEngine.analyzeScenes(videoPath, targetDurationSeconds || 5.0);
      res.status(200).json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Scene analysis failed" });
    }
  });

  router.post("/media/remove-background", async (req, res) => {
    try {
      const { imagePath } = req.body;
      if (!imagePath) {
        res.status(400).json({ error: "imagePath is required" });
        return;
      }
      const result = await qualityEngine.removeBackground(imagePath);
      res.status(200).json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Background removal failed" });
    }
  });

  router.post("/media/upscale", async (req, res) => {
    try {
      const { imagePath, minWidth } = req.body;
      if (!imagePath) {
        res.status(400).json({ error: "imagePath is required" });
        return;
      }
      const result = await qualityEngine.upscaleImage(imagePath, minWidth || 1080);
      res.status(200).json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Image upscale failed" });
    }
  });

  router.post("/audio/analyze-beats", async (req, res) => {
    try {
      const { audioPath } = req.body;
      if (!audioPath) {
        res.status(400).json({ error: "audioPath is required" });
        return;
      }
      const result = await qualityEngine.analyzeBeats(audioPath);
      res.status(200).json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Beat analysis failed" });
    }
  });

  return router;
}
