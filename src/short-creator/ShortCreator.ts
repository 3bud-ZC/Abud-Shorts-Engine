/* eslint-disable @remotion/deterministic-randomness */
import fs from "fs-extra";
import cuid from "cuid";
import path from "path";
import https from "https";
import http from "http";
import axios from "axios";

import { Kokoro } from "./libraries/Kokoro";
import { Remotion } from "./libraries/Remotion";
import { Whisper } from "./libraries/Whisper";
import {
  isAlignmentConfident,
  mapAlignmentToCaptionTokens,
} from "../server/v2/voice-providers/elevenLabsAlignment";
import { renderArabicCaptions } from "../server/v2/captions/arabicCaptionRendererV3";
import { runCaptionQa } from "../server/v2/captions/captionQa";
import { resolveCaptionStyle } from "../server/v2/captions/captionStyles";
import {
  buildEditDecisionList,
  intentForPurpose,
  type VisualShot,
} from "../server/v2/editing/editDecisionList";
import { composeVisualBed } from "../server/v2/editing/visualBedComposer";
import { mockupForIntent } from "../server/v2/mockups/websiteMockupRenderer";
import {
  buildCreativePlan,
  creativePlanFacts,
  type CreativePlan,
  type CreativeStylePresetId,
} from "../server/v2/creative/creativePlan";
import {
  isMotionTreatment,
  TREATMENT_MOTION_TEMPLATE,
  TREATMENT_RUNTIME,
  type VisualTreatment,
} from "../server/v2/creative/visualTreatment";
import { splitNarrationBeats } from "../server/v2/creative/visualIntentClassifier";
import { resolveBrandStyle } from "../server/v2/creative/brandStyle";
import {
  buildStockQueryFamilies,
  queryFamilyTerms,
} from "../server/v2/creative/stockQueryFamilies";
import {
  cropMetadata,
  planSmartCrop,
  probeVisualFocus,
  type SmartCropPlan,
} from "../server/v2/media-intelligence/smartCrop";
import { applyVisualIntentPolicy } from "../server/v2/media-intelligence/visualIntentPolicy";
import { detectShots, selectBestWindow } from "../server/v2/quality/sceneDetectionAdapter";
import { FFMpeg } from "./libraries/FFmpeg";
import { PexelsAPI } from "./libraries/Pexels";
import { Config } from "../config";
import { logger } from "../logger";
import { MusicManager } from "./music";
import {
  readMetadata,
  writeMetadata,
  deleteMetadata,
  type VideoMetadata,
} from "../server/videoMetadata";
import {
  OrientationEnum,
  type Caption,
  type RenderConfig,
  type Scene,
  type VideoStatus,
  type MusicMoodEnum,
  type MusicTag,
  type MusicForVideo,
  type SceneInputWithFallback,
  type BusinessTemplateId,
} from "../types/shorts";
import {
  type ProductionSpec,
  type ProductionSceneSpec,
  type ResolvedProductionTimeline,
  compactNarrationToBudget,
  resolveProductionTimeline,
  validateProductionSpec,
} from "../types/productionSpec";
import { convertTemplateToProductionSpec } from "../server/v2/templateToSpec";
import { VisualRegistry } from "../server/v2/visual-providers/registry";
import { VoiceRegistry } from "../server/v2/voice-providers/registry";
import type { VoiceProviderId, VoiceQualityProfile } from "../server/v2/voice-providers/types";
import { AutoVisualRouter } from "../server/v2/visual-providers/router";
import { sceneSourceRouter } from "../server/v2/visual-providers/sceneSourceRouter";
import { mediaIntelligenceService } from "../server/v2/media-intelligence/mediaIntelligenceService";
import { mediaCache } from "../server/v2/media-cache/mediaCache";
import { AudioMasteringService } from "./audioMasteringService";
import { postProductionPipeline } from "../server/v2/post-production/postProductionPipeline";
import { qualityEngine } from "../server/v2/quality/qualityEngine";
import { motionEngine, type MotionTemplateType } from "../server/v2/motion/motionEngine";
import { mediaUploadService } from "../server/v2/media/mediaUploadService";
import { capabilityManager } from "../server/v2/capabilities/capabilityManager";
import {
  DurableArtifactStore,
  type DurableSceneArtifact,
  createCaptionInputHash,
  createMediaInputHash,
  createVoiceInputHash,
  filterReusableArtifacts,
} from "../server/v2/artifacts/durableArtifacts";
import { assertStorageReady } from "../server/v2/storage/storagePolicy";

type RenderProgressEvent = {
  status:
    | "preparing"
    | "generating_content"
    | "searching_assets"
    | "generating_voice"
    | "generating_captions"
    | "rendering"
    | "finalizing";
  progress: number;
  currentStage: string;
  message: string;
  stageKey?: "planning" | "media" | "voice" | "captions" | "render" | "mastering" | "validation";
  checkpointStatus?: "running" | "completed" | "failed";
  provider?: string;
  artifacts?: Record<string, unknown>;
  inputHashSource?: unknown;
  timingMs?: number;
};

type RenderProgressCallback = (event: RenderProgressEvent) => Promise<void> | void;

/**
 * Bottom band of a 9:16 frame commonly covered by TikTok / Reels UI. Captions
 * are held above it so the platform chrome cannot sit on the words.
 */
const PLATFORM_SAFE_BOTTOM_RATIO = 0.14;

export class ShortCreator {
  private queue: {
    spec: ProductionSpec;
    id: string;
  }[] = [];

  private visualRegistry: VisualRegistry;
  private voiceRegistry: VoiceRegistry;
  private visualRouter: AutoVisualRouter;
  private audioMastering: AudioMasteringService;

  constructor(
    private config: Config,
    private remotion: Remotion,
    private kokoro: Kokoro,
    private whisper: Whisper,
    private ffmpeg: FFMpeg,
    private pexelsApi: PexelsAPI,
    private musicManager: MusicManager,
  ) {
    this.visualRegistry = new VisualRegistry(this.pexelsApi, this.config);
    this.visualRouter = this.visualRegistry.getRouter();
    this.voiceRegistry = new VoiceRegistry(this.kokoro);
    this.audioMastering = new AudioMasteringService(this.ffmpeg);
  }

  public status(id: string): VideoStatus {
    const videoPath = this.getVideoPath(id);
    if (this.queue.find((item) => item.id === id)) {
      return "processing";
    }
    const sidecar = readMetadata(this.config.videosDirPath, id);
    if (sidecar?.status === "failed") {
      return "failed";
    }
    if (fs.existsSync(videoPath)) {
      return "ready";
    }
    return "failed";
  }

  public addToQueue(
    sceneInput: SceneInputWithFallback[],
    config: RenderConfig,
    businessTemplateId?: string,
    businessTemplateData?: Record<string, string>,
  ): string {
    const id = cuid();
    let spec: ProductionSpec;
    if (businessTemplateId) {
      spec = convertTemplateToProductionSpec({
        templateId: businessTemplateId as BusinessTemplateId,
        templateData: businessTemplateData,
        config,
        id,
      });
    } else {
      spec = this.legacyInputToSpec(id, sceneInput, config);
    }

    this.queue.push({ spec, id });
    if (this.queue.length === 1) {
      this.processQueue();
    }
    return id;
  }

  public async createShortNow(
    videoId: string,
    input: any,
    onProgress?: RenderProgressCallback,
  ): Promise<string> {
    const spec = this.resolveInputToSpec(videoId, input);
    return this.renderProductionSpec(videoId, spec, onProgress);
  }

  private async processQueue(): Promise<void> {
    if (this.queue.length === 0) {
      return;
    }
    const { spec, id } = this.queue[0];
    logger.debug({ id, title: spec.title }, "Processing video item in the queue");
    try {
      await this.renderProductionSpec(id, spec);
      logger.debug({ id }, "Video created successfully");
    } catch (error: unknown) {
      logger.error(error, "Error creating video");
      try {
        this.saveFailureMetadata(id, spec, error);
      } catch (metaErr) {
        logger.error(metaErr, "Error saving failure metadata");
      }
    } finally {
      this.queue.shift();
      this.processQueue();
    }
  }

  private resolveInputToSpec(videoId: string, input: any): ProductionSpec {
    if (input && input.scenes && input.scenes.length > 0 && typeof input.scenes[0].narration === "string") {
      return validateProductionSpec({ ...input, id: videoId });
    }
    if (input && input.productionSpec) {
      return validateProductionSpec({ ...input.productionSpec, id: videoId });
    }
    if (input && input.businessTemplateId) {
      return convertTemplateToProductionSpec({
        templateId: input.businessTemplateId as BusinessTemplateId,
        templateData: input.businessTemplateData,
        config: input.config,
        title: input.title,
        id: videoId,
      });
    }
    if (input && input.scenes && input.scenes.length > 0 && typeof input.scenes[0].text === "string") {
      return this.legacyInputToSpec(videoId, input.scenes, input.config || {});
    }
    throw new Error("Invalid video render input. Could not resolve ProductionSpec.");
  }

  private legacyInputToSpec(
    videoId: string,
    scenes: SceneInputWithFallback[],
    config: RenderConfig,
  ): ProductionSpec {
    const brandKit = config.brandKit;
    const productionScenes: ProductionSceneSpec[] = scenes.map((s, idx) => ({
      sceneIndex: idx,
      purpose: idx === 0 ? "hook" : idx === scenes.length - 1 ? "cta" : "solution",
      durationSeconds: 6,
      narration: s.text,
      stockSearchTerms: s.searchTerms && s.searchTerms.length > 0 ? s.searchTerms : ["video"],
      visualSource: "stock",
      visualProvider: "pexels",
      transition: "cut",
    }));

    return validateProductionSpec({
      id: videoId,
      creationMode: "template",
      title: brandKit?.brandName || "Video Production",
      language: "auto",
      dialect: "none",
      tone: "energetic",
      contentStyle: "advertisement",
      durationSeconds: scenes.length * 6,
      aspectRatio: config.orientation === OrientationEnum.landscape ? "16:9" : "9:16",
      resolution: "1080p",
      quality: "standard",
      sceneCount: productionScenes.length,
      visualMode: "stock",
      voiceProvider: "kokoro",
      voiceId: config.voice || "af_heart",
      captionStyle: brandKit?.captionStyle || "bold",
      scenes: productionScenes,
      brandKit,
    });
  }

  private async renderProductionSpec(
    videoId: string,
    spec: ProductionSpec,
    onProgress?: RenderProgressCallback,
  ): Promise<string> {
    await assertStorageReady(this.config);
    const totalStartedAt = Date.now();
    const planningStartedAt = Date.now();
    const timeline: ResolvedProductionTimeline = resolveProductionTimeline(spec, 25);
    const mediaPlan = mediaIntelligenceService.generateMediaPlan(spec, {
      pacingProfile: (spec.metadata?.pacing as any) || (spec.quality === "high" || spec.quality === "premium" || spec.quality === "max_quality_local" ? "fast" : undefined),
      captionPreset: (spec.captionStyle as any) || "bold",
    });
    const sceneSourceDecisions = sceneSourceRouter.routeSpec(spec);
    const postProductionProcessors = postProductionPipeline.listProcessors();

    logger.info(
      {
        videoId,
        title: spec.title,
        requestedDuration: timeline.requestedDurationSeconds,
        targetDuration: timeline.targetDurationSeconds,
        contentDuration: timeline.contentDurationSeconds,
        outroDuration: timeline.outroDurationSeconds,
        expectedDuration: timeline.finalExpectedDurationSeconds,
        sceneCount: timeline.scenes.length,
        pacingProfile: mediaPlan.pacingProfile,
        mode: spec.creationMode,
      },
      "Rendering Production Spec video with Media Intelligence & Resolved Timeline",
    );

    // Music and its beat map are resolved before the scene loop so the shot
    // planner can use beats as cutting hints. Neither depends on scene work.
    const selectedMusic = this.findMusic(
      timeline.finalExpectedDurationSeconds,
      mediaPlan.recommendedMusicMood as any,
    );
    let beatMap: any = null;
    if (capabilityManager.isPythonQualityVenvInstalled() && selectedMusic?.file) {
      try {
        const musicPath = path.join(this.config.musicDirPath, selectedMusic.file);
        if (fs.existsSync(musicPath) && fs.statSync(musicPath).size > 1024) {
          beatMap = await qualityEngine.analyzeBeats(musicPath);
        }
      } catch (beatErr) {
        logger.warn(beatErr, "Beat analysis notice; proceeding with standard timeline");
      }
    }
    // qualityEngine returns beatTimestamps; this previously read beatMap.beats,
    // which never existed, so every production reported beatMapUsed:false and
    // no cut was ever beat-aware even with librosa installed and working.
    const beatTimestamps: number[] = Array.isArray(beatMap?.beatTimestamps)
      ? (beatMap.beatTimestamps as number[])
      : Array.isArray((beatMap as any)?.beats)
        ? ((beatMap as any).beats as number[])
        : [];

    // ------------------------------------------------------------------
    // CREATIVE PLAN
    // One resolved description of creative intent for the whole production,
    // built before any scene work so every shot decision can be traced back to
    // it. Availability is reported honestly: a treatment whose runtime is not
    // configured is never planned, it falls back and records why.
    // ------------------------------------------------------------------
    const hasUploadedMediaForProduction = Boolean(
      (spec.metadata as any)?.uploadedMediaId ||
      spec.scenes.some((scene: any) => scene.uploadedMediaId || scene.visualProvider === "uploaded_media"),
    );
    const hasProductMediaForProduction = Boolean(
      (spec.metadata as any)?.productImageId || spec.productionMode === "product_ad",
    );
    const motionRuntimeAvailable = capabilityManager.isPythonQualityVenvInstalled();
    const stockRuntimeAvailable = Boolean(this.config.pexelsApiKey) || Boolean(process.env.PIXABAY_API_KEY);

    // An explicitly graphic production must not depend on stock footage: asking
    // for Motion Graphics and receiving four stock clips is not the mode the
    // customer chose. Auto Hybrid keeps every source available.
    const graphicOnlyMode =
      spec.productionMode === "motion_graphics" || spec.productionMode === "animated_explainer";

    const isTreatmentAvailable = (treatment: VisualTreatment): boolean => {
      const runtime = TREATMENT_RUNTIME[treatment];
      if (graphicOnlyMode) return runtime === "motion";
      if (runtime === "motion") return motionRuntimeAvailable;
      if (runtime === "stock") return stockRuntimeAvailable;
      if (runtime === "upload") return hasUploadedMediaForProduction;
      if (runtime === "product") return hasProductMediaForProduction;
      // Mockups are rendered locally and always available.
      return true;
    };

    const creativePlan: CreativePlan = buildCreativePlan({
      productionMode: spec.productionMode,
      stylePreset: ((spec as any).creativeStyle as CreativeStylePresetId) || undefined,
      motionIntensity: ((spec as any).animationIntensity as any) || undefined,
      scenes: spec.scenes.map((scene: any, sceneIdx: number) => ({
        sceneIndex: sceneIdx,
        narration: String(scene.narration || ""),
        purpose: scene.purpose,
        durationSeconds: Number(scene.durationSeconds) || 0,
      })),
      hasProductMedia: hasProductMediaForProduction,
      hasUploadedMedia: hasUploadedMediaForProduction,
      hasBrandProfile: Boolean(spec.brandKit?.brandName),
      isTreatmentAvailable,
    });
    logger.info(
      { facts: creativePlanFacts(creativePlan), preset: creativePlan.stylePreset },
      "Creative plan resolved",
    );

    // Brand system for every generated graphic in this production. Fields the
    // customer did not supply are reported as derived or default rather than
    // presented as their choice, and every text/surface pairing is contrast
    // checked before a template can draw with it.
    const brandStyle = resolveBrandStyle({
      brandKit: spec.brandKit,
      ctaText: spec.cta?.text,
      contactText: spec.contact,
      presence: creativePlan.brandPresence,
    });
    logger.info(
      {
        hasBrand: brandStyle.hasBrand,
        sources: brandStyle.sources,
        contrastCorrections: brandStyle.contrastCorrections,
      },
      "Brand style resolved for generated graphics",
    );
    const motionBrandFields = {
      brandName: brandStyle.sources.brandName === "customer" ? brandStyle.brandName : undefined,
      website: brandStyle.sources.website === "customer" ? brandStyle.website : undefined,
      socialHandle:
        brandStyle.sources.socialHandle === "customer" ? brandStyle.socialHandle : undefined,
    };
    const motionPalette = {
      primary: brandStyle.palette.primary,
      secondary: brandStyle.palette.secondary,
      accent: brandStyle.palette.accent,
      background: brandStyle.palette.background,
      surface: brandStyle.palette.surface,
      text: brandStyle.palette.text,
      textMuted: brandStyle.palette.textMuted,
      onPrimary: brandStyle.palette.onPrimary,
      onAccent: brandStyle.palette.onAccent,
    };

    /**
     * True when the production is advertising websites or web design. Only then
     * does a programmatic site mockup beat real footage; a generic coding clip
     * is not what "modern website" means.
     */
    const websiteAdContext = (() => {
      const haystack = [
        spec.title,
        spec.userPrompt,
        ...(spec.scenes || []).map((scene: any) => scene.narration),
        ...(spec.scenes || []).flatMap((scene: any) => scene.stockSearchTerms || []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return /website|web design|webdesign|landing page|موقع|مواقع|ويب/.test(haystack);
    })();

    // libass owns spoken captions whenever the bundled font pack is present.
    // Without it we keep the Remotion caption layer rather than shipping a
    // video with no captions at all. Decided before the scene loop because
    // scene assembly must know which engine will draw the words.
    const captionStyleSpec = resolveCaptionStyle(spec.captionStyle as string);
    const fontsDir = process.env.ABUD_FONT_DIR || "";
    const burnCaptionsWithLibass =
      Boolean(fontsDir) && fs.existsSync(fontsDir) && spec.captionStyle !== "none";

    const scenes: any[] = [];
    /** Caption words per scene, kept out of the Remotion payload when libass draws them. */
    const sceneCaptionWords: Array<Array<{ text: string; startMs: number; endMs: number }>> = [];
    const excludeVideoIds: (string | number)[] = [];
    const previousVisualCandidates: any[] = [];
    const tempFiles: string[] = [];
    const visualProvidersUsed = new Set<string>();
    const voiceProvidersUsed = new Set<string>();
    const captionTimingSources = new Set<string>();
    const plannedShots: VisualShot[] = [];
    const visualIntentPolicyLog: Array<Record<string, unknown>> = [];
    /** Which query families were asked for each scene, and what came back. */
    const stockQueryLog: Array<Record<string, unknown>> = [];
    const shotSourceCounts: Record<string, number> = {};
    const voiceArtifacts: any[] = [];
    // Single-speaker guarantee: the first synthesized scene pins the concrete
    // voice ID (ElevenLabs resolves account voices at generation time) and every
    // later scene - including narration-fitting retries - reuses exactly it.
    let pinnedVoiceId: string | undefined;
    const selectedVisuals: any[] = [];
    const sceneQa: any[] = [];
    const durableArtifacts: DurableSceneArtifact[] = [];
    const artifactReuse = {
      reusedArtifacts: [] as DurableSceneArtifact[],
      regeneratedArtifacts: [] as DurableSceneArtifact[],
      providerInvocations: { piper: 0, kokoro: 0, google_cloud_tts: 0, elevenlabs: 0, whisper: 0, pexels: 0 },
    };
    const artifactStore = new DurableArtifactStore(this.config);
    const revision = (spec.metadata?.revision || {}) as any;
    const reusableMediaAssets = Array.isArray(revision.reuseMediaAssets) ? revision.reuseMediaAssets : [];
    const reusableArtifacts = filterReusableArtifacts({
      artifacts: Array.isArray(revision.reuseArtifacts) ? revision.reuseArtifacts as DurableSceneArtifact[] : [],
    });
    const reusableArtifactFor = (
      type: DurableSceneArtifact["type"],
      sceneIndex: number,
      predicate?: (artifact: DurableSceneArtifact) => boolean,
    ) =>
      reusableArtifacts.find((artifact) =>
        artifact.type === type &&
        artifact.sceneIndex === sceneIndex &&
        artifact.valid === true &&
        (!predicate || predicate(artifact)),
      );

    const orientation: OrientationEnum =
      spec.aspectRatio === "16:9" ? OrientationEnum.landscape : OrientationEnum.portrait;

    await this.emitProgress(onProgress, {
      status: "generating_content",
      progress: 10,
      currentStage: "Generating content",
      message: "Media Intelligence plan, pacing profile, and canonical timeline are resolved.",
      stageKey: "planning",
      checkpointStatus: "completed",
      provider: String(spec.metadata?.planner || "local_ai"),
      artifacts: { mediaPlanId: mediaPlan.id, sceneCount: mediaPlan.scenes.length },
      inputHashSource: spec,
      timingMs: Date.now() - planningStartedAt,
    });

    let index = 0;
    for (const sceneTimeline of timeline.scenes) {
      const originalSceneSpec = spec.scenes[sceneTimeline.sceneIndex] || {
        ...sceneTimeline,
        stockSearchTerms: ["video"],
        visualSource: "stock",
      };

      const sceneMediaPlan = mediaPlan.scenes[index] || {
        sceneIndex: index,
        purpose: originalSceneSpec.purpose,
        visualIntent: "lifestyle",
        targetDurationSeconds: sceneTimeline.durationSeconds,
        segments: [],
        preferredVisualSource: originalSceneSpec.visualSource || "stock",
        motion: "slow_zoom",
        transitionToNext: "cut",
        needsTextOverlay: false,
        searchTerms: originalSceneSpec.stockSearchTerms || ["video"],
      };

      const sceneProgressBase = 15 + Math.round((index / timeline.scenes.length) * 55);

      const voiceStartedAt = Date.now();
      await this.emitProgress(onProgress, {
        status: "generating_voice",
        progress: sceneProgressBase,
        currentStage: "Generating voice",
        message: `Generating narration audio for scene ${index + 1}/${timeline.scenes.length}.`,
        stageKey: "voice",
        checkpointStatus: "running",
        inputHashSource: { sceneIndex: index, narration: sceneTimeline.narration, voiceProvider: spec.voiceProvider },
      });

      const brandVoiceProfile = spec.brandKit?.voiceProfile as any;
      const requestedSpokenNarration = String((originalSceneSpec as any).spokenNarration || originalSceneSpec.narration || sceneTimeline.narration);
      let targetSceneDuration = sceneTimeline.durationSeconds;
      const requestedVoiceQuality = this.mapVoiceQuality(spec.quality);
      const requestedVoiceProvider = ((brandVoiceProfile?.provider || spec.voiceProvider || "auto") as VoiceProviderId | "auto");
      const requestedVoiceId = pinnedVoiceId || brandVoiceProfile?.voiceId || spec.voiceId || undefined;
      // The preset is the delivery setting a human approved in the Voice Lab.
      // It travels on the spec so every scene narrates identically and a retry
      // cannot quietly drop back to the provider's "natural" default.
      const requestedVoicePreset = spec.voicePreset || undefined;
      const requestedVoiceModelId = spec.voiceModelId || undefined;

      const tempId = cuid();
      const tempWavFileName = `${tempId}.wav`;
      const tempMasteredWavFileName = `${tempId}.mastered.wav`;
      const tempMp3FileName = `${tempId}.mp3`;
      const tempWavPath = path.join(this.config.tempDirPath, tempWavFileName);
      const tempMasteredWavPath = path.join(this.config.tempDirPath, tempMasteredWavFileName);
      const tempMp3Path = path.join(this.config.tempDirPath, tempMp3FileName);
      tempFiles.push(tempWavPath, tempMasteredWavPath, tempMp3Path);

      let voiceAudio: any = null;
      let voiceMastering: any = null;
      let speedFactor = 1.0;
      let actualVoiceDuration = targetSceneDuration;
      let captionAudioPath = tempMasteredWavPath;
      let voiceArtifact: DurableSceneArtifact | undefined;
      const revisionType = String(revision.type || "");
      const upstreamVoiceIsExplicitlyReusable = ["media", "caption", "display_text", "music"].includes(revisionType);
      const reusableVoice = reusableArtifactFor("voice", index, (artifact) => {
        if (upstreamVoiceIsExplicitlyReusable) return true;
        const key = (artifact.metadata?.reuseKey || {}) as Record<string, unknown>;
        const artifactProvider = artifact.provider || key.provider;
        const providerCompatible = requestedVoiceProvider === "auto" ||
          artifactProvider === requestedVoiceProvider ||
          (spec.language === "ar" && requestedVoiceProvider === "kokoro" && artifactProvider === "piper");
        return (
          key.spokenNarration === requestedSpokenNarration &&
          key.language === spec.language &&
          key.dialect === (brandVoiceProfile?.dialect || spec.dialect) &&
          key.qualityProfile === requestedVoiceQuality &&
          (!requestedVoiceId || key.voiceId === requestedVoiceId) &&
          (key.voicePreset || undefined) === requestedVoicePreset &&
          providerCompatible
        );
      });

      if (reusableVoice) {
        artifactStore.copyToTemp(reusableVoice, tempMp3Path);
        actualVoiceDuration = reusableVoice.duration || await this.ffmpeg.getMediaDuration(tempMp3Path);
        captionAudioPath = tempMp3Path;
        voiceArtifact = reusableVoice;
        artifactReuse.reusedArtifacts.push(reusableVoice);
        voiceProvidersUsed.add(String(reusableVoice.provider || "reused"));
        const priorVoice = (reusableVoice.metadata?.voiceArtifact || {}) as Record<string, unknown>;
        voiceArtifacts.push({
          ...priorVoice,
          sceneIndex: index,
          artifactId: reusableVoice.artifactId,
          reused: true,
          reuseSourceJobId: reusableVoice.sourceJobId,
          reuseSourceRevisionId: reusableVoice.sourceRevisionId,
        });
      } else {
        voiceAudio = await this.voiceRegistry.synthesize({
          text: requestedSpokenNarration,
          language: spec.language,
          dialect: (brandVoiceProfile?.dialect || spec.dialect) as any,
          qualityProfile: requestedVoiceQuality,
          requestedProvider: requestedVoiceProvider,
          voiceId: requestedVoiceId,
          voicePreset: requestedVoicePreset,
          modelId: requestedVoiceModelId,
          // Native alignment rides along with the audio; no second billed call.
          requestAlignment: true,
          fallbackPolicy: "local",
          brandPronunciations: brandVoiceProfile?.pronunciationDictionary,
        });
        pinnedVoiceId = voiceAudio.voiceId || voiceAudio.decision.voiceId || pinnedVoiceId;
        const firstProvider = voiceAudio.provider || voiceAudio.decision.providerId;
        if (firstProvider in artifactReuse.providerInvocations) {
          artifactReuse.providerInvocations[firstProvider as keyof typeof artifactReuse.providerInvocations]++;
        }

        let normalized = await this.ffmpeg.saveNormalizedAudioWithSpeed(
          voiceAudio.audio,
          tempWavPath,
          1,
        );
        let measuredVoiceDuration = normalized.duration || voiceAudio.audioLength || targetSceneDuration;

        if (measuredVoiceDuration > targetSceneDuration * 1.05) {
          const compactedText = compactNarrationToBudget(
            voiceAudio.processedText || requestedSpokenNarration,
            Math.max(1.5, targetSceneDuration * 0.88),
            spec.language === "ar",
          );
          if (compactedText && compactedText !== (voiceAudio.processedText || requestedSpokenNarration)) {
            voiceAudio = await this.voiceRegistry.synthesize({
              text: compactedText,
              language: spec.language,
              dialect: (brandVoiceProfile?.dialect || spec.dialect) as any,
              qualityProfile: requestedVoiceQuality,
              requestedProvider: requestedVoiceProvider,
              // Retries must never change the speaker or the delivery settings.
              voiceId: pinnedVoiceId || requestedVoiceId,
              voicePreset: requestedVoicePreset,
              modelId: requestedVoiceModelId,
              requestAlignment: true,
              fallbackPolicy: "local",
              brandPronunciations: brandVoiceProfile?.pronunciationDictionary,
            });
            const retryProvider = voiceAudio.provider || voiceAudio.decision.providerId;
            if (retryProvider in artifactReuse.providerInvocations) {
              artifactReuse.providerInvocations[retryProvider as keyof typeof artifactReuse.providerInvocations]++;
            }
            normalized = await this.ffmpeg.saveNormalizedAudioWithSpeed(
              voiceAudio.audio,
              tempWavPath,
              1,
            );
            measuredVoiceDuration = normalized.duration || voiceAudio.audioLength || measuredVoiceDuration;
          }
        }

        // Keep any final tempo correction small; rewriting narration is the main fitting strategy.
        if (measuredVoiceDuration > targetSceneDuration * 1.08) {
          speedFactor = Math.min(1.08, measuredVoiceDuration / targetSceneDuration);
          normalized = await this.ffmpeg.saveNormalizedAudioWithSpeed(
            voiceAudio.audio,
            tempWavPath,
            speedFactor,
          );
          measuredVoiceDuration = normalized.duration || measuredVoiceDuration;
        }

        voiceMastering = await this.audioMastering.masterVoice(tempWavPath, tempMasteredWavPath);
        await this.ffmpeg.saveWavToMp3(tempMasteredWavPath, tempMp3Path);
        actualVoiceDuration = await this.ffmpeg.getMediaDuration(tempMasteredWavPath);
        captionAudioPath = tempMasteredWavPath;
      }

      // Canonical continuous narration timeline calculation:
      // Chain spoken scenes with bounded natural breath pauses (160ms)
      // and eliminate dead silence between scenes.
      const isLastScene = index === timeline.scenes.length - 1;
      const interSceneGapSeconds = 0.16;
      const sceneSpeechDuration = actualVoiceDuration || sceneTimeline.durationSeconds;
      let calculatedVisualDuration: number;
      if (!isLastScene) {
        calculatedVisualDuration = Math.max(0.5, Math.round((sceneSpeechDuration + interSceneGapSeconds) * 100) / 100);
      } else {
        const lastSceneCtaHoldSeconds = 0.35;
        calculatedVisualDuration = Math.max(0.5, Math.round((sceneSpeechDuration + lastSceneCtaHoldSeconds) * 100) / 100);
      }
      targetSceneDuration = calculatedVisualDuration;
      sceneTimeline.actualSpeechDurationSeconds = sceneSpeechDuration;
      sceneTimeline.durationSeconds = calculatedVisualDuration;
      sceneTimeline.audioSpeedFactor = speedFactor;
      const speechWindowStartMs = 0;
      const speechWindowEndMs = Math.round(sceneSpeechDuration * 1000);

      if (!voiceArtifact && voiceAudio && voiceMastering) {
        voiceProvidersUsed.add(voiceAudio.provider || voiceAudio.decision.providerId);
        const voiceInputHash = createVoiceInputHash({
          spokenNarration: requestedSpokenNarration,
          provider: voiceAudio.provider || voiceAudio.decision.providerId,
          model: voiceAudio.model,
          voiceId: voiceAudio.voiceId,
          voicePreset: requestedVoicePreset,
          language: voiceAudio.language,
          dialect: voiceAudio.dialect,
          qualityProfile: requestedVoiceQuality,
          pace: brandVoiceProfile?.pace,
          style: brandVoiceProfile?.style,
        });
        const voiceArtifactDetails = {
          sceneIndex: index,
          provider: voiceAudio.provider || voiceAudio.decision.providerId,
          model: voiceAudio.model,
          voiceId: voiceAudio.voiceId,
          voiceFamily: voiceAudio.voiceFamily,
          language: voiceAudio.language,
          dialect: voiceAudio.dialect,
          estimatedCostTier: voiceAudio.estimatedCostTier || (voiceAudio.provider === "google_cloud_tts" ? "cloud_free_tier" : voiceAudio.provider === "elevenlabs" ? "premium" : "local_free"),
          usageBasedCost: Boolean(voiceAudio.usageBasedCost),
          charactersBilled: voiceAudio.charactersBilled,
          modelId: voiceAudio.modelId,
          voicePreset: requestedVoicePreset,
          voiceSettings: voiceAudio.voiceSettings,
          generationMs: voiceAudio.generationMs,
          sampleRate: voiceAudio.sampleRate,
          processedText: voiceAudio.processedText,
          requestedSpokenNarration,
          displayText: (originalSceneSpec as any).displayText || originalSceneSpec.onScreenText,
          captionText: (originalSceneSpec as any).captionText || originalSceneSpec.narration,
          visualIntent: sceneMediaPlan.visualIntent,
          routingReason: voiceAudio.decision.reason,
          warnings: voiceAudio.decision.warnings,
          inputVoiceLufs: voiceMastering.inputMetrics.integratedLufs,
          masteredVoiceLufs: voiceMastering.masteredMetrics.integratedLufs,
          masteredTruePeakDbtp: voiceMastering.masteredMetrics.truePeakDbtp,
          masteringIssues: voiceMastering.issues,
          speechWindowMs: { startMs: speechWindowStartMs, endMs: speechWindowEndMs },
        };
        voiceArtifact = artifactStore.persistFile({
          type: "voice",
          sceneIndex: index,
          sourceJobId: videoId,
          sourceRevisionId: revision.revisionId,
          provider: voiceArtifactDetails.provider,
          model: voiceArtifactDetails.model,
          inputHash: voiceInputHash,
          sourcePath: tempMp3Path,
          extension: "mp3",
          duration: actualVoiceDuration,
          metadata: {
            voiceArtifact: voiceArtifactDetails,
            reuseKey: {
              spokenNarration: requestedSpokenNarration,
              voicePreset: requestedVoicePreset,
              provider: voiceArtifactDetails.provider,
              model: voiceArtifactDetails.model,
              voiceId: voiceArtifactDetails.voiceId,
              language: voiceArtifactDetails.language,
              dialect: voiceArtifactDetails.dialect,
              qualityProfile: requestedVoiceQuality,
              pace: brandVoiceProfile?.pace || "normal",
              style: brandVoiceProfile?.style || "default",
              preprocessingVersion: "arabic-preprocessor-v2",
            },
          },
        });
        durableArtifacts.push(voiceArtifact);
        artifactReuse.regeneratedArtifacts.push(voiceArtifact);
        voiceArtifacts.push({ ...voiceArtifactDetails, artifactId: voiceArtifact.artifactId, reused: false });
      }
      await this.emitProgress(onProgress, {
        status: "generating_voice",
        progress: Math.min(sceneProgressBase + 6, 68),
        currentStage: reusableVoice ? "Voice reused" : "Voice generated",
        message: reusableVoice ? `Reused voice artifact for scene ${index + 1}.` : `Voice completed for scene ${index + 1}.`,
        stageKey: "voice",
        checkpointStatus: "completed",
        provider: String(voiceArtifact?.provider || voiceAudio?.provider || voiceAudio?.decision?.providerId || "reused"),
        artifacts: {
          sceneIndex: index,
          artifactId: voiceArtifact?.artifactId,
          reused: Boolean(reusableVoice),
          type: "voice",
          sourceRevisionId: voiceArtifact?.sourceRevisionId,
          provider: voiceArtifact?.provider || voiceAudio?.provider || voiceAudio?.decision?.providerId,
          model: voiceArtifact?.model || voiceAudio?.model,
          voiceId: voiceAudio?.voiceId || (voiceArtifact?.metadata?.reuseKey as any)?.voiceId,
          durationSeconds: actualVoiceDuration,
        },
        timingMs: Date.now() - voiceStartedAt,
      });

      const captionsStartedAt = Date.now();
      await this.emitProgress(onProgress, {
        status: "generating_captions",
        progress: Math.min(sceneProgressBase + 8, 70),
        currentStage: "Generating captions",
        message: `Generating Whisper captions for scene ${index + 1}.`,
        stageKey: "captions",
        checkpointStatus: "running",
        inputHashSource: { sceneIndex: index, audioDuration: actualVoiceDuration },
      });
      let rawCaptions: Caption[] = [];
      // Canonical vocabulary persisted as captionTimingSource.
      let timingSource: "elevenlabs_alignment" | "whisper" | "synthetic" = "synthetic";
      let alignmentConfidence: number | undefined;
      let alignmentUnmapped: string[] | undefined;
      let captionArtifact: DurableSceneArtifact | undefined;
      const captionInputHash = createCaptionInputHash({
        voiceChecksum: voiceArtifact?.checksum || "",
        whisperModel: this.config.whisperModel,
        language: spec.language,
      });
      const reusableCaption = reusableArtifactFor("captions", index, (artifact) =>
        artifact.inputHash === captionInputHash &&
        (artifact.metadata as any)?.voiceArtifactId === voiceArtifact?.artifactId,
      );
      if (reusableCaption) {
        const payload = artifactStore.readJsonArtifact<{ captions: Caption[]; timingSource?: typeof timingSource }>(reusableCaption);
        rawCaptions = payload.captions || [];
        timingSource = payload.timingSource || "whisper";
        captionArtifact = reusableCaption;
        artifactReuse.reusedArtifacts.push(reusableCaption);
      }

      // 1. ElevenLabs native character alignment, mapped onto the DISPLAY
      //    caption tokens. The alignment describes the TTS string, which may
      //    contain pronunciation expansions the viewer must never see, so a
      //    segment whose mapping is not confident falls through to Whisper
      //    rather than showing a spoken form or a guessed time.
      if (!captionArtifact && voiceAudio?.characterAlignment && voiceAudio.alignmentText) {
        const displayText = String(
          (originalSceneSpec as any).captionText || sceneTimeline.narration || "",
        );
        const displayTokens = displayText.trim().split(/\s+/).filter(Boolean);
        const mapping = mapAlignmentToCaptionTokens(
          voiceAudio.characterAlignment,
          voiceAudio.alignmentText,
          displayTokens,
        );
        alignmentConfidence = mapping.confidence;
        alignmentUnmapped = mapping.unmappedTokens;
        if (isAlignmentConfident(mapping)) {
          rawCaptions = mapping.timings.map((timing) => ({
            text: timing.word,
            startMs: timing.startMs,
            endMs: timing.endMs,
          }));
          timingSource = "elevenlabs_alignment";
        } else {
          logger.info(
            { sceneIndex: index, confidence: mapping.confidence, unmapped: mapping.unmappedTokens },
            "ElevenLabs alignment mapping below confidence threshold; using Whisper for this scene",
          );
        }
      }

      // 2. Whisper.
      if (!captionArtifact && rawCaptions.length === 0) {
        try {
          artifactReuse.providerInvocations.whisper++;
          rawCaptions = await this.whisper.CreateCaption(
            captionAudioPath,
            voiceAudio?.language || (voiceArtifact?.metadata?.reuseKey as any)?.language || spec.language,
          );
          if (rawCaptions.length > 0) {
            timingSource = "whisper";
          }
        } catch (whisperErr) {
          logger.warn(whisperErr, `Whisper transcription notice for scene ${index + 1}; using synthesized word timestamps`);
        }
      }

      // 3. Deterministic synthetic fallback.
      if (!rawCaptions || rawCaptions.length === 0) {
        timingSource = "synthetic";
        const captionText = String((originalSceneSpec as any).captionText || sceneTimeline.narration || "");
        const words = captionText.trim().split(/\s+/).filter(Boolean);
        if (words.length > 0) {
          const totalMs = Math.round(targetSceneDuration * 1000);
          const wordMs = Math.max(250, Math.floor(totalMs / words.length));
          rawCaptions = words.map((w, wIdx) => {
            const startMs = wIdx * wordMs;
            const endMs = Math.min(totalMs, startMs + wordMs);
            return {
              text: (wIdx > 0 ? " " : "") + w,
              startMs,
              endMs,
            };
          });
        }
      }
      voiceArtifacts[voiceArtifacts.length - 1].timingSource = timingSource;
      voiceArtifacts[voiceArtifacts.length - 1].captionTimingSource = timingSource;
      if (alignmentConfidence !== undefined) {
        voiceArtifacts[voiceArtifacts.length - 1].alignmentConfidence = alignmentConfidence;
        voiceArtifacts[voiceArtifacts.length - 1].alignmentUnmappedTokens = alignmentUnmapped;
      }
      captionTimingSources.add(timingSource);

      // Enforce caption boundaries strictly within the scene duration
      const maxSceneMs = Math.round(targetSceneDuration * 1000) + 100;
      const captions: Caption[] = rawCaptions
        .filter((c) => c.startMs < maxSceneMs)
        .map((c) => ({
          ...c,
          endMs: Math.min(c.endMs, maxSceneMs),
        }));
      if (!captionArtifact && voiceArtifact) {
        captionArtifact = artifactStore.persistJson({
          type: "captions",
          sceneIndex: index,
          sourceJobId: videoId,
          sourceRevisionId: revision.revisionId,
          provider: timingSource,
          model: timingSource === "whisper" ? this.config.whisperModel : timingSource,
          inputHash: captionInputHash,
          payload: {
            captions,
            timingSource,
            sceneIndex: index,
            voiceArtifactId: voiceArtifact.artifactId,
          },
          duration: targetSceneDuration,
          metadata: {
            voiceArtifactId: voiceArtifact.artifactId,
            voiceChecksum: voiceArtifact.checksum,
            timingConfig: "word-timings-v1",
          },
        });
        durableArtifacts.push(captionArtifact);
        artifactReuse.regeneratedArtifacts.push(captionArtifact);
      }
      await this.emitProgress(onProgress, {
        status: "generating_captions",
        progress: Math.min(sceneProgressBase + 12, 72),
        currentStage: reusableCaption ? "Captions reused" : "Captions generated",
        message: reusableCaption ? `Reused caption timing artifact for scene ${index + 1}.` : `Caption timing completed for scene ${index + 1}.`,
        stageKey: "captions",
        checkpointStatus: "completed",
        provider: timingSource,
        artifacts: {
          sceneIndex: index,
          artifactId: captionArtifact?.artifactId,
          reused: Boolean(reusableCaption),
          type: "captions",
          sourceRevisionId: captionArtifact?.sourceRevisionId,
          timingSource,
          captionCount: captions.length,
        },
        timingMs: Date.now() - captionsStartedAt,
      });

      const mediaStartedAt = Date.now();
      await this.emitProgress(onProgress, {
        status: "searching_assets",
        progress: Math.min(sceneProgressBase + 15, 75),
        currentStage: "Searching footage",
        message: `Resolving media asset(s) for scene ${index + 1} (${sceneMediaPlan.visualIntent || "stock"}).`,
        stageKey: "media",
        checkpointStatus: "running",
        inputHashSource: {
          sceneIndex: index,
          searchTerms: sceneMediaPlan.searchCandidates || sceneMediaPlan.searchTerms,
          visualIntent: sceneMediaPlan.visualIntent,
        },
      });

      // Handle multi-asset segment scenes if planned
      if (sceneMediaPlan.segments && sceneMediaPlan.segments.length > 1) {
        // Strict invariant: sum(segment durations) strictly equals targetSceneDuration
        const normalizedSegments = mediaIntelligenceService.normalizeSceneSegments(
          sceneMediaPlan.segments,
          targetSceneDuration,
        );
        const renderedSegments: { video: string; duration: number; motion?: string }[] = [];

        for (const seg of normalizedSegments) {
          const segTempId = cuid();
          const segVideoFileName = `${segTempId}.mp4`;
          const segVideoPath = path.join(this.config.tempDirPath, segVideoFileName);
          tempFiles.push(segVideoPath);

          const reusableMediaArtifact = reusableArtifacts.find((artifact) =>
            artifact.type === "media" &&
            artifact.sceneIndex === index &&
            artifact.segmentIndex === seg.segmentIndex &&
            artifact.valid === true,
          );
          const reusedSeg = reusableMediaAssets.find((asset: any) => asset.sceneIndex === index && asset.segmentIndex === seg.segmentIndex);
          let segAsset: any = reusableMediaArtifact?.metadata?.visualAsset || reusedSeg;
          let mediaArtifact: DurableSceneArtifact | undefined = reusableMediaArtifact;
          if (reusableMediaArtifact) {
            artifactStore.copyToTemp(reusableMediaArtifact, segVideoPath);
            artifactReuse.reusedArtifacts.push(reusableMediaArtifact);
          } else {
            segAsset = reusedSeg || await this.visualRouter.resolveSceneVisual(
              {
                ...originalSceneSpec,
                stockSearchTerms: sceneMediaPlan.searchCandidates || seg.searchTerms,
                visualPrompt: seg.visualPrompt || originalSceneSpec.visualPrompt,
              } as any,
              spec,
              {
                excludeIds: excludeVideoIds,
                orientation,
                tempDirPath: this.config.tempDirPath,
                targetDurationSeconds: seg.durationSeconds,
                previousCandidates: previousVisualCandidates,
              },
            );
            if (!reusedSeg && segAsset.provider === "pexels") artifactReuse.providerInvocations.pexels++;
            const cacheId = segAsset.metadata?.pexelsVideoId || segAsset.url;
            const cached = cacheId ? mediaCache.getCachedAsset(segAsset.provider, cacheId as any) : null;
            if (cached) {
              fs.copySync(cached.filePath, segVideoPath);
            } else {
              await this.downloadFile(segAsset.url, segVideoPath);
              if (cacheId) mediaCache.saveCachedAsset(segAsset.provider, cacheId as any, segVideoPath);
            }
            const mediaInputHash = createMediaInputHash({
              provider: segAsset.provider,
              sourceId: segAsset.metadata?.pexelsVideoId,
              url: segAsset.url,
              selectedClip: segAsset.metadata?.smartClip,
              crop: segAsset.metadata?.smartCrop,
              visualIntent: sceneMediaPlan.visualIntent,
              sceneIndex: index,
              segmentIndex: seg.segmentIndex,
            });
            mediaArtifact = artifactStore.persistFile({
              type: "media",
              sceneIndex: index,
              segmentIndex: seg.segmentIndex,
              sourceJobId: videoId,
              sourceRevisionId: revision.revisionId,
              provider: segAsset.provider,
              model: segAsset.metadata?.pexelsVideoId,
              inputHash: mediaInputHash,
              sourcePath: segVideoPath,
              extension: "mp4",
              duration: seg.durationSeconds,
              metadata: { visualAsset: segAsset, visualIntent: sceneMediaPlan.visualIntent },
            });
            durableArtifacts.push(mediaArtifact);
            artifactReuse.regeneratedArtifacts.push(mediaArtifact);
          }

          visualProvidersUsed.add(segAsset.provider || mediaArtifact?.provider || "reused");

          if (segAsset.metadata?.pexelsVideoId) {
            excludeVideoIds.push(segAsset.metadata.pexelsVideoId as string | number);
          }
          previousVisualCandidates.push({
            id: segAsset.metadata?.pexelsVideoId || segAsset.url,
            url: segAsset.url,
            width: segAsset.metadata?.width || 0,
            height: segAsset.metadata?.height || 0,
            duration: segAsset.durationSeconds,
            tags: segAsset.metadata?.searchTermsUsed,
          });
          selectedVisuals.push({
            sceneIndex: index,
            segmentIndex: seg.segmentIndex,
            artifactId: mediaArtifact?.artifactId,
            reused: Boolean(reusableMediaArtifact),
            provider: segAsset.provider,
            source: segAsset.source,
            url: segAsset.url,
            durationSeconds: segAsset.durationSeconds,
            metadata: segAsset.metadata,
          });

          renderedSegments.push({
            video: `http://localhost:${this.config.port}/api/tmp/${segVideoFileName}`,
            duration: seg.durationSeconds,
            motion: seg.motion || sceneMediaPlan.motion,
          });
        }

        sceneCaptionWords[index] = captions.map((caption) => ({
          text: String(caption.text || ""),
          startMs: caption.startMs,
          endMs: caption.endMs,
        }));
        scenes.push({
          // Remotion cannot draw captions it was never given. Passing an empty
          // list is what actually prevents a second caption layer under the
          // libass one; suppressing captionPreset alone did not.
          captions: burnCaptionsWithLibass ? [] : captions,
          video: renderedSegments[0].video,
          motion: sceneMediaPlan.motion,
          transition: sceneMediaPlan.transitionToNext,
          segments: renderedSegments,
          audio: {
            url: `http://localhost:${this.config.port}/api/tmp/${tempMp3FileName}`,
            duration: targetSceneDuration,
          },
          speechWindowsMs: [{ startMs: speechWindowStartMs, endMs: speechWindowEndMs }],
        });
      } else {
        // Single segment scene
        const tempVideoFileName = `${tempId}.mp4`;
        const tempVideoPath = path.join(this.config.tempDirPath, tempVideoFileName);
        tempFiles.push(tempVideoPath);

        const reusableMediaArtifact = reusableArtifactFor("media", index, (artifact) => artifact.segmentIndex === undefined);
        let visualAsset: any;
        let mediaArtifact: DurableSceneArtifact | undefined;

        const isMotionGraphics =
          spec.productionMode === "motion_graphics" ||
          spec.productionMode === "animated_explainer" ||
          spec.visualMode === "motion_graphics" ||
          originalSceneSpec.visualSource === "motion_graphics";

        const isProductAd =
          spec.productionMode === "product_ad" ||
          spec.visualMode === "product_ad" ||
          originalSceneSpec.visualSource === "product_composition";

        if (reusableMediaArtifact) {
          artifactStore.copyToTemp(reusableMediaArtifact, tempVideoPath);
          mediaArtifact = reusableMediaArtifact;
          artifactReuse.reusedArtifacts.push(reusableMediaArtifact);
          visualAsset = (reusableMediaArtifact.metadata?.visualAsset || reusableMediaArtifact.metadata || {}) as any;
        } else if (isMotionGraphics) {
          // The creative plan already decided what this scene shows, so the
          // template follows the plan rather than the scene index. A pure
          // graphic production must never need a stock clip, so every scene
          // resolves to a motion template with a local generated ground.
          const plannedTreatment = creativePlan.sceneTreatments.find(
            (entry) => entry.sceneIndex === index,
          );
          const motionTemplate: MotionTemplateType =
            (plannedTreatment && TREATMENT_MOTION_TEMPLATE[plannedTreatment.treatment]) ||
            (spec.productionMode === "animated_explainer"
              ? index === 0
                ? "kinetic_typography"
                : index === 1
                  ? "explainer_diagram"
                  : "cta_card"
              : index === 0
                ? "kinetic_typography"
                : index === 1
                  ? "stat_animation"
                  : "cta_card");

          // Every value drawn comes from the script or the classifier. The
          // rejected build hardcoded "99.9%" and a fixed feature list, so a
          // motion-graphics video asserted statistics nobody had claimed.
          const narrationBeats = splitNarrationBeats(String(sceneTimeline.narration || ""));
          const extracted = plannedTreatment?.extracted;
          const motionResult = await motionEngine.renderMotionScene({
            template: motionTemplate,
            title:
              (originalSceneSpec as any).displayText ||
              originalSceneSpec.onScreenText ||
              originalSceneSpec.narration.slice(0, 60),
            subtitle:
              originalSceneSpec.narration.length > 60
                ? originalSceneSpec.narration.slice(0, 120)
                : undefined,
            numberStat: extracted?.statValue
              ? {
                  value: extracted.statValue,
                  label: String(originalSceneSpec.onScreenText || ""),
                  suffix: extracted.statSuffix,
                }
              : undefined,
            features:
              motionTemplate === "feature_list"
                ? narrationBeats.slice(0, extracted?.stepCount || 3)
                : undefined,
            steps:
              motionTemplate === "explainer_diagram"
                ? narrationBeats.slice(0, extracted?.stepCount || 3)
                : undefined,
            ctaText: brandStyle.ctaText,
            contactText: spec.contact || spec.brandKit?.contactText,
            durationSeconds: targetSceneDuration,
            width: orientation === OrientationEnum.portrait ? 1080 : 1920,
            height: orientation === OrientationEnum.portrait ? 1920 : 1080,
            brandColors: motionPalette,
            brand: motionBrandFields,
            language: spec.language,
          });

          fs.copySync(motionResult.absolutePath, tempVideoPath);
          visualAsset = {
            sceneIndex: index,
            provider: "motion_canvas",
            source: "motion_graphics",
            url: `file://${motionResult.absolutePath}`,
            durationSeconds: targetSceneDuration,
            fallbackUsed: false,
            estimatedCost: 0,
            metadata: {
              template: motionTemplate,
              motionArtifactId: motionResult.artifactId,
              durationSeconds: targetSceneDuration,
              source: "motion_canvas",
              stockRequired: false,
              fontPath: motionResult.fontPath,
              preShapedArabic: motionResult.preShapedArabic,
              missingGlyphs: motionResult.missingGlyphs,
              brandFieldsDrawn: motionResult.brandFieldsDrawn,
            },
          };
        } else if (isProductAd) {
          let productMedia = null;
          const prodId = (spec.metadata as any)?.productImageId || (originalSceneSpec as any).productImageId;
          if (prodId) {
            productMedia = await mediaUploadService.getProductImage(prodId);
          }

          let nobgUrl: string | undefined;
          let productImageUrl: string | undefined;

          if (productMedia) {
            if (productMedia.nobgRelativePath) {
              const baseDataDir = this.config.dataDirPath || path.resolve(process.cwd(), "data-dev");
              const nobgAbs = path.resolve(baseDataDir, productMedia.nobgRelativePath);
              if (fs.existsSync(nobgAbs)) {
                const nobgTemp = path.join(this.config.tempDirPath, `${cuid()}-nobg.png`);
                fs.copySync(nobgAbs, nobgTemp);
                tempFiles.push(nobgTemp);
                nobgUrl = `http://localhost:${this.config.port}/api/tmp/${path.basename(nobgTemp)}`;
              }
            }
            if (productMedia.storagePath && fs.existsSync(productMedia.storagePath)) {
              const prodTemp = path.join(this.config.tempDirPath, `${cuid()}-prod${path.extname(productMedia.storagePath)}`);
              fs.copySync(productMedia.storagePath, prodTemp);
              tempFiles.push(prodTemp);
              productImageUrl = `http://localhost:${this.config.port}/api/tmp/${path.basename(prodTemp)}`;
            }
          }

          await this.ffmpeg.createSolidVideo(
            tempVideoPath,
            targetSceneDuration,
            orientation === OrientationEnum.landscape ? 1920 : 1080,
            orientation === OrientationEnum.landscape ? 1080 : 1920,
            spec.brandKit?.primaryColor || "#020617",
          );

          visualAsset = {
            sceneIndex: index,
            provider: "product_composition",
            source: "product_ad",
            url: nobgUrl || productImageUrl || "product_composition",
            durationSeconds: targetSceneDuration,
            fallbackUsed: false,
            estimatedCost: 0,
            metadata: {
              productNobgUrl: nobgUrl,
              productImageUrl,
              productHeadline: (originalSceneSpec as any).productHeadline || originalSceneSpec.narration.slice(0, 30),
              productOffer: (originalSceneSpec as any).productOffer || (spec.metadata as any)?.productOffer || "عرض خاص",
              productPrice: (originalSceneSpec as any).productPrice || (spec.metadata as any)?.productPrice,
              productCta: (originalSceneSpec as any).productCta || spec.brandKit?.outroText || (spec.metadata as any)?.productCta || "اطلب الآن عبر واتساب",
              productPlacement: (originalSceneSpec as any).productPlacement || (spec.metadata as any)?.productPlacement || "center",
              source: "product_composition",
            },
          };
        } else {
          const reusedAsset = reusableMediaAssets.find((asset: any) => asset.sceneIndex === index && asset.segmentIndex === undefined);
          // "Modern website" must not be illustrated with a screen of code.
          // The policy only fires for website ads whose narration is not about
          // engineering; everything else passes through unchanged.
          const plannedTerms =
            sceneMediaPlan.searchCandidates || sceneMediaPlan.searchTerms || originalSceneSpec.stockSearchTerms || [];

          // One scene intent becomes several visual angles - the subject, the
          // action around it, the environment, the audience and a supporting
          // texture - rather than one literal restatement of the sentence with
          // a joker list of "nature / globe / ocean" behind it.
          const queryFamilies = buildStockQueryFamilies({
            narration: String(originalSceneSpec.narration || ""),
            onScreenText: String(originalSceneSpec.onScreenText || ""),
            purpose: String(originalSceneSpec.purpose || ""),
            visualIntent: sceneMediaPlan.visualIntent,
            industryHint: String((spec.metadata as any)?.creativeProfile?.industryHint || spec.title || ""),
            mood: creativePlan.pacing,
            providedTerms: plannedTerms as string[],
            orientation: orientation === OrientationEnum.portrait ? "portrait" : "landscape",
          });
          stockQueryLog.push({
            sceneIndex: index,
            families: queryFamilies.families,
            queries: queryFamilies.queries.map((entry) => entry.query),
            matchedConcepts: queryFamilies.matchedConcepts,
            genericOnly: queryFamilies.genericOnly,
          });

          const intentPolicy = applyVisualIntentPolicy({
            terms: queryFamilyTerms(queryFamilies),
            narration: String(originalSceneSpec.narration || ""),
            isWebsiteAd: websiteAdContext,
            sceneIndex: index,
          });
          if (intentPolicy.applied) {
            logger.info(
              { sceneIndex: index, removed: intentPolicy.removed, substituted: intentPolicy.substituted },
              "Visual intent policy replaced code-shop footage terms for a website advertisement",
            );
            visualIntentPolicyLog.push({
              sceneIndex: index,
              removed: intentPolicy.removed,
              substituted: intentPolicy.substituted,
            });
          }
          visualAsset = reusedAsset || await this.visualRouter.resolveSceneVisual(
            {
              ...originalSceneSpec,
              stockSearchTerms: intentPolicy.terms,
            } as any,
            spec,
            {
              excludeIds: excludeVideoIds,
              orientation,
              tempDirPath: this.config.tempDirPath,
              targetDurationSeconds: targetSceneDuration,
              previousCandidates: previousVisualCandidates,
            },
          );
          if (!reusedAsset && visualAsset.provider === "pexels") artifactReuse.providerInvocations.pexels++;
          const sceneQueryRecord = stockQueryLog[stockQueryLog.length - 1];
          if (sceneQueryRecord) {
            sceneQueryRecord.provider = visualAsset.provider;
            sceneQueryRecord.queryUsed = visualAsset.metadata?.searchTerm;
            sceneQueryRecord.candidateCount = visualAsset.metadata?.candidateCount;
            sceneQueryRecord.winner = visualAsset.metadata?.pexelsVideoId || visualAsset.url;
            sceneQueryRecord.fallbackReason = visualAsset.metadata?.fallback
              ? "provider_scoring_found_no_passing_candidate"
              : undefined;
          }

          const cacheId = visualAsset.metadata?.pexelsVideoId || visualAsset.url;
          const cached = cacheId ? mediaCache.getCachedAsset(visualAsset.provider, cacheId as any) : null;
          if (cached) {
            fs.copySync(cached.filePath, tempVideoPath);
          } else {
            await this.downloadFile(visualAsset.url, tempVideoPath);
            if (cacheId) mediaCache.saveCachedAsset(visualAsset.provider, cacheId as any, tempVideoPath);
          }

          if (capabilityManager.isPythonQualityVenvInstalled() && fs.existsSync(tempVideoPath) && fs.statSync(tempVideoPath).size > 1024) {
            try {
              const sceneAnalysis = await qualityEngine.analyzeScenes(tempVideoPath, targetSceneDuration);
              if (visualAsset.metadata) {
                visualAsset.metadata.sceneAnalysis = sceneAnalysis;
                visualAsset.metadata.selectedClip = sceneAnalysis.chosenWindow;
                visualAsset.metadata.detectedScenesCount = sceneAnalysis.detectedScenes.length;
                visualAsset.metadata.windowSelectionReason = sceneAnalysis.reason;
              }
            } catch (sdErr) {
              logger.warn(sdErr, "PySceneDetect analysis notice; continuing with standard window");
            }
          }
        }

        if (!reusableMediaArtifact && visualAsset) {
          const mediaDurationForArtifact = await this.ffmpeg.getMediaDuration(tempVideoPath).catch(() => undefined);
          const mediaInputHash = createMediaInputHash({
            provider: visualAsset.provider,
            sourceId: visualAsset.metadata?.pexelsVideoId || visualAsset.source || visualAsset.url,
            url: visualAsset.url,
            selectedClip: visualAsset.metadata?.selectedClip,
            crop: visualAsset.metadata?.smartCrop,
            visualIntent: originalSceneSpec.visualIntent,
            sceneIndex: index,
          });
          mediaArtifact = artifactStore.persistFile({
            type: "media",
            sceneIndex: index,
            sourceJobId: videoId,
            sourceRevisionId: revision.revisionId,
            provider: visualAsset.provider,
            model: String(visualAsset.metadata?.source || visualAsset.source || visualAsset.provider),
            inputHash: mediaInputHash,
            sourcePath: tempVideoPath,
            extension: "mp4",
            duration: mediaDurationForArtifact,
            metadata: {
              visualAsset,
              reuseKey: {
                provider: visualAsset.provider,
                sourceId: visualAsset.metadata?.pexelsVideoId || visualAsset.source || visualAsset.url,
                selectedClip: visualAsset.metadata?.selectedClip,
                crop: visualAsset.metadata?.smartCrop,
                visualIntent: originalSceneSpec.visualIntent,
              },
            },
          });
          durableArtifacts.push(mediaArtifact);
          artifactReuse.regeneratedArtifacts.push(mediaArtifact);
        }

        visualProvidersUsed.add(visualAsset.provider);
        if (visualAsset.metadata?.pexelsVideoId) {
          excludeVideoIds.push(visualAsset.metadata.pexelsVideoId as string | number);
        }
        previousVisualCandidates.push({
          id: visualAsset.metadata?.pexelsVideoId || visualAsset.url,
          url: visualAsset.url,
          width: visualAsset.width || 0,
          height: visualAsset.height || 0,
          duration: visualAsset.durationSeconds,
          tags: visualAsset.metadata?.searchTermsUsed,
        });
        selectedVisuals.push({
          sceneIndex: index,
          provider: visualAsset.provider,
          source: visualAsset.source,
          url: visualAsset.url,
          durationSeconds: visualAsset.durationSeconds,
          metadata: visualAsset.metadata,
          artifactId: mediaArtifact?.artifactId,
          reused: Boolean(reusableMediaArtifact),
        });
        const mediaDuration = await this.ffmpeg.getMediaDuration(tempVideoPath).catch(() => 0);

        // ------------------------------------------------------------------
        // Multi-shot visual bed.
        //
        // One narration scene becomes several visual shots. The narration, its
        // captions and its audio are untouched: only the picture is cut, so a
        // three-scene script can still carry six or more shots.
        // ------------------------------------------------------------------
        if (!isProductAd && mediaDuration > 0) {
          const sceneStartSeconds = sceneTimeline.startSeconds || 0;
          const sceneEdl = buildEditDecisionList({
            scenes: [{
              sceneId: `scene${index}`,
              sceneIndex: index,
              purpose: String(originalSceneSpec.purpose || ""),
              durationSeconds: targetSceneDuration,
              startSeconds: sceneStartSeconds,
              searchTerms: sceneMediaPlan.searchTerms,
            }],
            totalDurationSeconds: sceneStartSeconds + targetSceneDuration,
            pacingProfile: "editorial_ad",
            beats: beatTimestamps,
            assignSource: (shot, indexInScene) => {
              // The creative plan already decided what this narration scene
              // should look like. The first shot of a scene carries that
              // treatment; later shots in the same scene vary so a single
              // narration beat is not four copies of the same card.
              const planned = creativePlan.sceneTreatments.find(
                (entry) => entry.sceneIndex === index,
              );

              if (planned && isMotionTreatment(planned.treatment) && (indexInScene === 0 || graphicOnlyMode)) {
                return {
                  sourceType: "motion",
                  provider: "abud_motion",
                  routingReason: `creative_plan:${planned.treatment}:${planned.signal}`,
                };
              }

              if (planned && indexInScene === 0 && TREATMENT_RUNTIME[planned.treatment] === "mockup") {
                return {
                  sourceType: "mockup",
                  provider: "abud_mockup",
                  routingReason: `creative_plan:${planned.treatment}`,
                };
              }

              // A website-design ad is better served by a real mockup than by
              // more generic footage, but only where the intent calls for it
              // and never for every shot in the scene.
              const template = websiteAdContext ? mockupForIntent(shot.intent) : null;
              if (template && indexInScene > 0) {
                return { sourceType: "mockup", provider: "abud_mockup", routingReason: `website_intent:${shot.intent}` };
              }
              return { sourceType: "stock", provider: visualAsset.provider, routingReason: "stock_footage_best_available" };
            },
          });

          // Pick a clean window inside the downloaded clip rather than its
          // first seconds, which are often a logo card or a fade.
          const detection = await detectShots(tempVideoPath, { scriptDir: this.config.tempDirPath });

          // Where the picture actually is. Measured once per clip and reused for
          // every shot cut from it, so the reframe cannot swim between shots.
          // Absent runtime means an honest fall back to the safe centre crop.
          const focusProbe = await probeVisualFocus(tempVideoPath, {
            windowSeconds: Math.min(mediaDuration, targetSceneDuration * 2),
          });
          const frameWidth = orientation === OrientationEnum.portrait ? 1080 : 1920;
          const frameHeight = orientation === OrientationEnum.portrait ? 1920 : 1080;
          let previousCropPlan: SmartCropPlan | null = null;
          const shotInputs = await Promise.all(sceneEdl.shots.map(async (shot, shotIndex) => {
            // A motion-treated shot is rendered to its own short MP4 and then
            // handed to the composer as an ordinary clip, so graphic scenes and
            // footage go through exactly one compositing path.
            if (shot.sourceType === "motion") {
              const planned = creativePlan.sceneTreatments.find((entry) => entry.sceneIndex === index);
              const template = planned
                ? TREATMENT_MOTION_TEMPLATE[planned.treatment] || "kinetic_typography"
                : "kinetic_typography";
              try {
                const motionScene = await motionEngine.renderMotionScene({
                  template: template as MotionTemplateType,
                  title: String(originalSceneSpec.onScreenText || sceneTimeline.narration || spec.title || ""),
                  subtitle: String((originalSceneSpec as any).displayText || ""),
                  numberStat: planned?.extracted?.statValue
                    ? {
                        value: planned.extracted.statValue,
                        label: String(originalSceneSpec.onScreenText || ""),
                        suffix: planned.extracted.statSuffix,
                      }
                    : undefined,
                  features: planned?.extracted?.stepCount
                    ? splitNarrationBeats(String(sceneTimeline.narration || "")).slice(
                        0,
                        planned.extracted.stepCount,
                      )
                    : undefined,
                  steps: planned?.extracted?.stepCount
                    ? splitNarrationBeats(String(sceneTimeline.narration || "")).slice(
                        0,
                        planned.extracted.stepCount,
                      )
                    : undefined,
                  ctaText: brandStyle.ctaText,
                  contactText: spec.contact || spec.brandKit?.contactText,
                  durationSeconds: shot.duration,
                  width: orientation === "portrait" ? 1080 : 1920,
                  height: orientation === "portrait" ? 1920 : 1080,
                  fps: 25,
                  brandColors: motionPalette,
                  brand: motionBrandFields,
                  language: spec.language,
                });
                if (fs.existsSync(motionScene.absolutePath)) {
                  return { shot, sourcePath: motionScene.absolutePath, sourceStartSeconds: 0 };
                }
              } catch (motionError) {
                logger.warn(
                  { err: String(motionError), sceneIndex: index, template },
                  "Motion scene render failed",
                );
                if (graphicOnlyMode) {
                  // An explicitly graphic production must not silently acquire a
                  // stock dependency because one template failed. The shot is
                  // dropped from the bed instead, and the scene keeps whatever
                  // other graphic shots rendered.
                  shot.routingReason = `${shot.routingReason || ""}|motion_failed_graphic_only`;
                  return { shot };
                }
                shot.routingReason = `${shot.routingReason || ""}|motion_fallback_to_stock`;
                shot.sourceType = "stock";
              }
            }
            if (shot.sourceType === "mockup") {
              return {
                shot,
                mockupTemplate: mockupForIntent(shot.intent) || undefined,
                // A mockup carries the customer's own brand when they supplied
                // one; the placeholder brand is used only when they did not.
                mockupPalette: {
                  background: brandStyle.palette.background,
                  primary: brandStyle.palette.primary,
                  accent: brandStyle.palette.accent,
                },
                mockupContent: {
                  brandName: brandStyle.brandName || undefined,
                  headline: String(originalSceneSpec.onScreenText || spec.title || ""),
                  subheadline: String((originalSceneSpec as any).displayText || ""),
                  ctaLabel: String(brandStyle.ctaText || spec.cta?.text || "ابدأ دلوقتي"),
                },
              };
            }
            const window = selectBestWindow(detection, mediaDuration, shot.duration);
            // Different shots from the same clip must not repeat the same
            // seconds, so later shots step further into the source.
            const offset = Math.min(
              Math.max(0, mediaDuration - shot.duration),
              window.startSeconds + shotIndex * shot.duration,
            );
            const cropPlan = planSmartCrop({
              sourceWidth: Number(visualAsset?.width || visualAsset?.metadata?.width) || frameWidth,
              sourceHeight: Number(visualAsset?.height || visualAsset?.metadata?.height) || frameHeight,
              targetWidth: frameWidth,
              targetHeight: frameHeight,
              tags: visualAsset?.metadata?.searchTermsUsed || sceneMediaPlan.searchTerms,
              visualIntent: sceneMediaPlan.visualIntent,
              manualFocalPoint: (originalSceneSpec as any).focalPoint,
              probe: focusProbe,
              previousPlan: previousCropPlan,
            });
            previousCropPlan = cropPlan;
            shot.crop = {
              mode: cropPlan.mode,
              xCenter: cropPlan.xCenter,
              yCenter: cropPlan.yCenter,
              safetyScore: Math.round(cropPlan.confidence * 100),
            };
            shot.routingReason = `${shot.routingReason || ""}|crop:${cropPlan.mode}`;
            return { shot, sourcePath: tempVideoPath, sourceStartSeconds: offset, cropPlan };
          }));

          // Persist the reframing decision so a rejected video can be explained
          // rather than guessed at, and so a revision reuses the same framing.
          const cropPlansUsed = shotInputs
            .map((entry) => (entry as { cropPlan?: SmartCropPlan }).cropPlan)
            .filter(Boolean) as SmartCropPlan[];
          if (visualAsset?.metadata && cropPlansUsed.length > 0) {
            visualAsset.metadata.smartCropPlan = cropMetadata(cropPlansUsed[0]);
            visualAsset.metadata.smartCropShots = cropPlansUsed.map(cropMetadata);
            visualAsset.metadata.focusProbe = {
              available: focusProbe.available,
              source: focusProbe.source,
              concentration: focusProbe.concentration,
            };
          }

          if (shotInputs.length > 1) {
            const bedPath = path.join(this.config.tempDirPath, `${tempId}.bed.mp4`);
            const workDir = path.join(this.config.tempDirPath, `${tempId}_shots`);
            const composed = await composeVisualBed({
              shots: shotInputs,
              outputPath: bedPath,
              width: orientation === "portrait" ? 1080 : 1920,
              height: orientation === "portrait" ? 1920 : 1080,
              fps: 25,
              workDir,
              colorNormalize: true,
            });
            if (composed.composed && fs.existsSync(bedPath)) {
              fs.moveSync(bedPath, tempVideoPath, { overwrite: true });
              sceneEdl.shots.forEach((shot) => {
                plannedShots.push(shot);
                shotSourceCounts[shot.sourceType] = (shotSourceCounts[shot.sourceType] || 0) + 1;
              });
            } else {
              // Composition declined or failed: the single clip still stands.
              // The source type is the one the plan actually chose - reporting
              // every uncomposed scene as "stock" is what made a pure motion
              // production look as though it still depended on footage.
              const fallbackShot = {
                ...sceneEdl.shots[0],
                duration: targetSceneDuration,
                routingReason: `single_clip:${composed.reason || "not_composed"}`,
              };
              plannedShots.push(fallbackShot);
              shotSourceCounts[fallbackShot.sourceType] =
                (shotSourceCounts[fallbackShot.sourceType] || 0) + 1;
            }
            if (fs.existsSync(workDir)) fs.removeSync(workDir);
            if (fs.existsSync(bedPath)) fs.removeSync(bedPath);
          } else {
            const onlyShot = { ...sceneEdl.shots[0], duration: targetSceneDuration };
            plannedShots.push(onlyShot);
            shotSourceCounts[onlyShot.sourceType] =
              (shotSourceCounts[onlyShot.sourceType] || 0) + 1;
          }
        }
        sceneQa.push({
          sceneIndex: index,
          assetExists: fs.existsSync(tempVideoPath),
          assetReadable: mediaDuration > 0 || isProductAd,
          durationFit: mediaDuration >= targetSceneDuration * 0.5 || isProductAd,
          visualRelevanceScore: visualAsset.metadata?.selectedScore || 95,
          duplicateRisk: visualAsset.metadata?.scoreBreakdown?.nearDuplicateRisk,
          cropSafety: visualAsset.metadata?.smartCrop,
          smartCrop: visualAsset.metadata?.smartCropPlan,
          captionSafeLayout: true,
          voiceDurationFit: actualVoiceDuration <= targetSceneDuration * 1.08,
        });

        sceneCaptionWords[index] = captions.map((caption) => ({
          text: String(caption.text || ""),
          startMs: caption.startMs,
          endMs: caption.endMs,
        }));
        scenes.push({
          // Remotion cannot draw captions it was never given; this is what
          // actually prevents a second caption layer under the libass one.
          captions: burnCaptionsWithLibass ? [] : captions,
          video: `http://localhost:${this.config.port}/api/tmp/${tempVideoFileName}`,
          motion: sceneMediaPlan.motion,
          transition: sceneMediaPlan.transitionToNext,
          audio: {
            url: `http://localhost:${this.config.port}/api/tmp/${tempMp3FileName}`,
            duration: targetSceneDuration,
          },
          speechWindowsMs: [{ startMs: speechWindowStartMs, endMs: speechWindowEndMs }],
          productNobgUrl: visualAsset?.metadata?.productNobgUrl,
          productImageUrl: visualAsset?.metadata?.productImageUrl,
          productHeadline: visualAsset?.metadata?.productHeadline,
          productOffer: visualAsset?.metadata?.productOffer,
          productPrice: visualAsset?.metadata?.productPrice,
          productCta: visualAsset?.metadata?.productCta,
          productPlacement: visualAsset?.metadata?.productPlacement,
          visualSource: visualAsset?.source,
        } as any);
      }
      await this.emitProgress(onProgress, {
        status: "searching_assets",
        progress: Math.min(sceneProgressBase + 20, 78),
        currentStage: "Media selected",
        message: `Media QA completed for scene ${index + 1}.`,
        stageKey: "media",
        checkpointStatus: "completed",
        provider: Array.from(visualProvidersUsed).join(","),
        artifacts: {
          sceneIndex: index,
          type: "media",
          reused: selectedVisuals.filter((asset) => asset.sceneIndex === index).every((asset) => Boolean((asset as any).reused)),
          selectedVisuals: selectedVisuals.filter((asset) => asset.sceneIndex === index),
          sceneQa: sceneQa.filter((item) => item.sceneIndex === index),
        },
        timingMs: Date.now() - mediaStartedAt,
      });

      index++;
    }

    const totalDurationSeconds = Math.round(scenes.reduce((acc, curr) => acc + (curr.audio?.duration || 0), 0) * 100) / 100;


    await this.emitProgress(onProgress, {
      status: "rendering",
      progress: 82,
      currentStage: "Rendering",
      message: burnCaptionsWithLibass
        ? "Rendering visuals and motion graphics with Remotion."
        : "Rendering video with Remotion Motion Design and Advanced Captions.",
      stageKey: "render",
      checkpointStatus: "running",
      inputHashSource: { scenes: scenes.length, duration: totalDurationSeconds },
    });
    const renderStartedAt = Date.now();

    await this.remotion.render(
      {
        music: selectedMusic,
        scenes,
        config: {
          durationMs: Math.round(totalDurationSeconds * 1000),
          paddingBack: 0,
          captionBackgroundColor: "rgba(11, 27, 31, 0.84)",
          captionPosition: "bottom" as any,
          // Remotion still draws motion graphics, CTA, titles and brand
          // overlays. Spoken captions are burned afterwards by libass, which
          // shapes Arabic correctly, so they are suppressed here to avoid two
          // caption layers on the same frame.
          captionPreset: burnCaptionsWithLibass ? ("none" as any) : (mediaPlan.captionPreset || spec.captionStyle || "bold"),
          ctaLayout: mediaPlan.ctaLayout || "centered",
          musicVolume: "medium" as any,
          musicDuckingProfile: "balanced",
          brandKit: spec.brandKit,
        },
      },
      videoId,
      orientation,
      spec.quality === "max_quality_local" ? "high" : spec.quality || "standard",
    );
    await this.emitProgress(onProgress, {
      status: "rendering",
      progress: 88,
      currentStage: "Rendered",
      message: "Remotion render completed.",
      stageKey: "render",
      checkpointStatus: "completed",
      provider: "remotion",
      artifacts: { videoId, sceneCount: scenes.length },
      timingMs: Date.now() - renderStartedAt,
    });

    let captionRenderer: "libass" | "remotion" = "remotion";
    let captionFontFamily: string | undefined;
    let captionQaResult: any = null;
    if (burnCaptionsWithLibass) {
      const burnStartedAt = Date.now();
      await this.emitProgress(onProgress, {
        status: "rendering",
        progress: 90,
        currentStage: "Captions",
        message: "Burning Arabic captions with libass.",
        stageKey: "render",
        checkpointStatus: "running",
      });
      // Scene captions are scene-relative; shift them onto the video timeline.
      const sceneStartMs = scenes.map((_s, i) =>
        scenes.slice(0, i).reduce((acc, curr) => acc + (curr.audio?.duration || 0) * 1000, 0),
      );
      const timelineWords = sceneCaptionWords.flatMap((words, sceneIndex) => {
        const offsetMs = Math.round(sceneStartMs[sceneIndex] || 0);
        return (words || [])
          .map((word) => ({
            text: word.text.trim(),
            startMs: offsetMs + word.startMs,
            endMs: offsetMs + word.endMs,
          }))
          .filter((word) => word.text.length > 0);
      });

      if (timelineWords.length > 0) {
        const frame = { width: orientation === "portrait" ? 1080 : 1920, height: orientation === "portrait" ? 1920 : 1080 };
        const built = renderArabicCaptions(
          timelineWords,
          spec.captionStyle as string,
          frame,
          // Keep clear of the TikTok/Reels bottom UI band.
          PLATFORM_SAFE_BOTTOM_RATIO,
        );
        captionQaResult = runCaptionQa(built, {
          style: captionStyleSpec,
          frame,
          platformSafeBottomRatio: PLATFORM_SAFE_BOTTOM_RATIO,
        });
        const assPath = path.join(this.config.tempDirPath, `${videoId}.captions.ass`);
        fs.writeFileSync(assPath, built.content, "utf8");
        const renderedPath = this.getVideoPath(videoId);
        const burnedPath = path.join(this.config.tempDirPath, `${videoId}.captioned.mp4`);
        try {
          await this.ffmpeg.burnAssSubtitles(renderedPath, assPath, burnedPath, fontsDir);
          fs.moveSync(burnedPath, renderedPath, { overwrite: true });
          captionRenderer = "libass";
          captionFontFamily = built.fontFamily;
        } catch (burnErr) {
          // A failed burn must not lose the video; keep the Remotion output.
          logger.error(burnErr, "libass caption burn failed; keeping the uncaptioned Remotion render");
        } finally {
          if (fs.existsSync(burnedPath)) fs.removeSync(burnedPath);
          if (fs.existsSync(assPath)) fs.removeSync(assPath);
        }
      }
      await this.emitProgress(onProgress, {
        status: "rendering",
        progress: 92,
        currentStage: "Captions",
        message: captionRenderer === "libass" ? "Arabic captions burned." : "Caption burn skipped.",
        stageKey: "render",
        checkpointStatus: "completed",
        provider: captionRenderer,
        timingMs: Date.now() - burnStartedAt,
      });
    }

    const validationStartedAt = Date.now();
    await this.emitProgress(onProgress, {
      status: "finalizing",
      progress: 94,
      currentStage: "Finalizing",
      message: "Generating thumbnail cover and validating output quality.",
      stageKey: "validation",
      checkpointStatus: "running",
      inputHashSource: { videoId, requestedDuration: timeline.requestedDurationSeconds },
    });

    for (const file of tempFiles) {
      fs.removeSync(file);
    }

    try {
      const videoPath = this.getVideoPath(videoId);
      const thumbnailPath = path.join(this.config.videosDirPath, `${videoId}.thumb.jpg`);

      // Generate video cover thumbnail
      await this.ffmpeg.generateThumbnail(videoPath, thumbnailPath, 1.5);

      // Perform deterministic post-render quality validation against canonical requestedDurationSeconds
      const validationResult = await this.ffmpeg.validateRenderedVideo(
        videoPath,
        timeline.requestedDurationSeconds,
      );
      const masteringStartedAt = Date.now();
      await this.emitProgress(onProgress, {
        status: "finalizing",
        progress: 96,
        currentStage: "Mastering final mix",
        message: "Measuring mastered final mix loudness and peak levels.",
        stageKey: "mastering",
        checkpointStatus: "running",
        provider: "ffmpeg",
        inputHashSource: { videoId, selectedMusic: selectedMusic.file },
      });
      const finalAudioQa = await this.audioMastering.validateFinalMix(videoPath);
      await this.emitProgress(onProgress, {
        status: "finalizing",
        progress: 97,
        currentStage: "Mastering completed",
        message: "Final mix mastering metrics recorded.",
        stageKey: "mastering",
        checkpointStatus: finalAudioQa.pass ? "completed" : "failed",
        provider: "ffmpeg",
        artifacts: {
          finalMixLufs: finalAudioQa.finalMixMetrics.integratedLufs,
          truePeakDbtp: finalAudioQa.finalMixMetrics.truePeakDbtp,
          clippingDetected: finalAudioQa.finalMixMetrics.clippingDetected,
        },
        timingMs: Date.now() - masteringStartedAt,
      });

      const stats = fs.statSync(videoPath);
      const totalVoiceDuration = timeline.scenes.reduce(
        (sum, s) => sum + (s.actualSpeechDurationSeconds || s.durationSeconds),
        0,
      );

      const motionPresetsUsed = Array.from(
        new Set(
          scenes
            .flatMap((s) => (s.segments ? s.segments.map((seg: any) => seg.motion) : [s.motion]))
            .filter(Boolean),
        ),
      );
      const transitionPresetsUsed = Array.from(
        new Set(scenes.map((s) => s.transition).filter(Boolean)),
      );
      const mediaSegmentCount = scenes.reduce(
        (acc, s) => acc + (s.segments ? s.segments.length : 1),
        0,
      );

      const sceneStartMsForQa = scenes.map((_s, i) =>
        scenes.slice(0, i).reduce((acc, curr) => acc + (curr.audio?.duration || 0) * 1000, 0),
      );
      const speechWindowsForDeadAir = scenes.map((s, i) => ({
        sceneIndex: i,
        startMs: Math.round(sceneStartMsForQa[i] || 0),
        endMs: Math.round((sceneStartMsForQa[i] || 0) + (s.speechWindowsMs?.[0]?.endMs || (s.audio?.duration || 0) * 1000)),
      }));
      const deadAirReport = this.audioMastering.analyzeDeadAir(speechWindowsForDeadAir);

      const creativeQualityResult = qualityEngine.calculateCreativeQualityScore({
        deadAirDurationMs: deadAirReport.totalNarrationSilenceMs,
        maxNarrationSilenceMs: deadAirReport.maxNarrationSilenceMs,
        totalDurationSeconds: validationResult.durationSeconds,
        sceneCount: scenes.length,
        distinctAssetCount: new Set(selectedVisuals.map((item) => item.metadata?.pexelsVideoId || item.url)).size,
        fallbackCount: selectedVisuals.filter((item) => item.metadata?.fallback || item.metadata?.fallbackReason).length,
        hasCta: spec.scenes.some((s) => s.purpose === "cta" || (spec.cta && spec.cta.text)),
        captionStyle: spec.captionStyle,
        hasCaptions: spec.captionStyle !== "none",
        mediaRelevanceScores: sceneQa.map((item) => Number(item.visualRelevanceScore) || 90),
      });

      const metadata: VideoMetadata = {
        videoId,
        filename: `${videoId}.mp4`,
        thumbnailUrl: `/api/videos/${videoId}/thumbnail`,
        status: finalAudioQa.pass ? "ready" : "failed",
        creationMode: spec.creationMode,
        originalPrompt: spec.userPrompt,
        templateId: spec.templateId,
        templateName: spec.templateId || spec.title,
        brandName: spec.brandKit?.brandName,
        watermarkText: spec.brandKit?.watermarkText,
        captionStyle: spec.captionStyle,
        captionProfileUsed: mediaPlan.captionPreset || spec.captionStyle || "bold",
        captionRenderer,
        // Canonical shot plan: what the viewer actually looks at, and why.
        // The creative plan that produced this edit, kept so a rejected video
        // can be explained rather than guessed at.
        creativePlan,
        creativeFacts: creativePlanFacts(creativePlan),
        editDecisionList: {
          version: 'edl.v1',
          totalDurationSeconds,
          shots: plannedShots,
          averageShotSeconds: plannedShots.length
            ? Number((totalDurationSeconds / plannedShots.length).toFixed(2))
            : 0,
          sourceTypeCounts: shotSourceCounts,
          beatMapUsed: beatTimestamps.length > 0,
          // How many cuts actually landed on a detected beat, as opposed to how
          // many beats were available. Reporting only `beatMapUsed` hid the case
          // where a beat map was produced and then influenced nothing.
          beatAlignedCutCount: plannedShots.filter((shot) => typeof shot.beatHint === "number").length,
          beatCount: beatTimestamps.length,
          bpm: beatMap?.bpm,
          pacingProfile: 'editorial_ad',
        },
        visualShotCount: plannedShots.length,
        visualIntentPolicy: visualIntentPolicyLog.length > 0 ? visualIntentPolicyLog : undefined,
        // Which visual angles were asked for, what came back and which clip won.
        stockQueryPlan: stockQueryLog.length > 0 ? stockQueryLog : undefined,
        // What the Brand Profile actually contributed, field by field, so the
        // UI never implies the engine knew a brand colour it was never given.
        brandStyle: {
          hasBrand: brandStyle.hasBrand,
          presence: brandStyle.presence,
          palette: brandStyle.palette,
          sources: brandStyle.sources,
          contrast: brandStyle.contrast,
          contrastCorrections: brandStyle.contrastCorrections,
        },
        sourceTypeCounts: shotSourceCounts,
        captionFont: captionFontFamily,
        captionStyleId: captionStyleSpec.id,
        captionQa: captionQaResult || undefined,
        musicTrack: selectedMusic.file,
        musicMood: selectedMusic.mood,
        motionPresetsUsed,
        transitionPresetsUsed,
        mediaSegmentCount,
        language: spec.language,
        dialect: spec.dialect,
        quality: spec.quality,
        resolution: spec.resolution,
        aspectRatio: spec.aspectRatio,
        visualMode: spec.visualMode,
        aiProvider: spec.metadata?.planner ? String(spec.metadata.planner) : undefined,
        visualProvidersUsed: Array.from(visualProvidersUsed),
        voiceProvider: spec.voiceProvider,
        voiceProvidersUsed: Array.from(voiceProvidersUsed) as any,
        // Caption timing provenance, so Video Details can state how the words
        // were timed rather than implying Whisper for every production.
        captionTimingSource: captionTimingSources.size === 1
          ? Array.from(captionTimingSources)[0]
          : Array.from(captionTimingSources).join('+') || 'synthetic',
        captionTimingSources: Array.from(captionTimingSources),
        voiceArtifacts,
        costEstimate: spec.costEstimate as any,
        productionSpec: spec as any,
        timeline: timeline as any,
        mediaPlan: mediaPlan as any,
        sceneSourceDecisions,
        postProductionProcessors,
        selectedVisuals,
        sceneQa,
        beatMap: beatMap || undefined,
        durableArtifacts,
        artifactReuse: {
          reusedStages: revision.reuseStages || [],
          regeneratedStages: revision.regeneratedStages || [],
          reusedArtifacts: artifactReuse.reusedArtifacts,
          regeneratedArtifacts: artifactReuse.regeneratedArtifacts,
          providerInvocations: artifactReuse.providerInvocations,
        },
        schemaVersion: "ProductionSpecV3",
        revisionMetadata: revision,
        stageTimings: {
          totalMs: Date.now() - totalStartedAt,
          validationMs: Date.now() - validationStartedAt,
        },
        qualityScore: validationResult.technicalScore,
        technicalScore: validationResult.technicalScore,
        creativeScore: creativeQualityResult.creativeScore,
        creativeGrade: creativeQualityResult.creativeGrade,
        creativeDiagnostics: creativeQualityResult.diagnostics,
        creativeWarnings: creativeQualityResult.warnings,
        maxNarrationSilenceMs: deadAirReport.maxNarrationSilenceMs,
        deadAirReport,
        mediaPlanScore: mediaPlan.qualityReview?.overallScore || 90,
        qualityScoreV2: {
          technical: validationResult.technicalScore,
          audioQa: finalAudioQa.pass ? 100 : 0,
          duration: Math.max(0, 100 - Math.round(Math.abs(validationResult.durationVariance) * 10)),
          captionAlignment: voiceArtifacts.every((artifact) => artifact.timingSource !== "synthetic_fallback") ? 90 : 55,
          mediaTechnicalQuality: Math.round(sceneQa.reduce((sum, item) => sum + (item.assetReadable ? 90 : 30), 0) / Math.max(1, sceneQa.length)),
          mediaRelevance: Math.round(sceneQa.reduce((sum, item) => sum + (Number(item.visualRelevanceScore) || 70), 0) / Math.max(1, sceneQa.length)),
          mediaDiversity: selectedVisuals.length === new Set(selectedVisuals.map((item) => item.metadata?.pexelsVideoId || item.url)).size ? 95 : 65,
          subjectiveQuality: "Human Review Required",
        },
        overallProductionScore: undefined,
        validationResult: validationResult as any,
        audioQa: {
          pass: finalAudioQa.pass,
          issues: finalAudioQa.issues,
          stream: finalAudioQa.stream,
          finalMixLufs: finalAudioQa.finalMixMetrics.integratedLufs,
          truePeakDbtp: finalAudioQa.finalMixMetrics.truePeakDbtp,
          clippingDetected: finalAudioQa.finalMixMetrics.clippingDetected,
          effectivelySilent: finalAudioQa.finalMixMetrics.effectivelySilent,
          duckingProfile: "balanced",
        },
        createdAt: stats.mtime.toISOString(),
        updatedAt: new Date().toISOString(),
        durationSeconds: validationResult.durationSeconds,
        requestedDurationSeconds: timeline.requestedDurationSeconds,
        resolvedDurationSeconds: timeline.finalExpectedDurationSeconds,
        voiceDurationSeconds: Math.round(totalVoiceDuration * 100) / 100,
        finalDurationSeconds: validationResult.durationSeconds,
        durationVarianceSeconds: validationResult.durationVariance,
        durationVariancePercent: (validationResult as any).durationVariancePercent,
        sizeBytes: stats.size,
        pexelsTerms: spec.scenes.flatMap((s) => s.stockSearchTerms || []),
        narrationLines: timeline.scenes.map((s) => s.narration),
        spokenNarrationLines: voiceArtifacts.map((artifact) => artifact.processedText).filter(Boolean),
        downloadUrl: `/api/videos/${videoId}/download`,
        previewUrl: `/api/short-video/${videoId}`,
      };
      writeMetadata(this.config.videosDirPath, metadata);
      await this.emitProgress(onProgress, {
        status: "finalizing",
        progress: 98,
        currentStage: "Validation completed",
        message: "Objective final QA completed.",
        stageKey: "validation",
        checkpointStatus: finalAudioQa.pass ? "completed" : "failed",
        provider: "ffmpeg",
        artifacts: { videoId, thumbnailPath, audioQa: metadata.audioQa, validationResult },
        timingMs: Date.now() - validationStartedAt,
      });
      if (!finalAudioQa.pass) {
        throw new Error(`Audio QA gate failed: ${finalAudioQa.issues.join("; ")}`);
      }
      logger.info(
        {
          videoId,
          actualFinalDuration: validationResult.durationSeconds,
          requestedDuration: timeline.requestedDurationSeconds,
          durationVariance: validationResult.durationVariance,
          technicalScore: validationResult.technicalScore,
          mediaPlanScore: metadata.mediaPlanScore,
          overallScore: metadata.overallProductionScore,
          musicTrack: metadata.musicTrack,
          musicMood: metadata.musicMood,
        },
        "Successfully saved video metadata sidecar with Media Intelligence and Thumbnail verification",
      );
    } catch (metaErr) {
      logger.error(metaErr, "Failed to save video metadata sidecar");
      throw metaErr;
    }

    return videoId;
  }

  private async downloadFile(url: string, destPath: string, maxRetries = 3): Promise<void> {
    if (url.startsWith("file://") || url.startsWith("/")) {
      fs.copySync(url.replace("file://", ""), destPath);
      return;
    }

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await axios({
          method: "GET",
          url,
          responseType: "stream",
          timeout: 30000,
          maxRedirects: 5,
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });

        await new Promise<void>((resolve, reject) => {
          const writer = fs.createWriteStream(destPath);
          response.data.pipe(writer);
          writer.on("finish", () => {
            writer.close();
            resolve();
          });
          writer.on("error", (err: Error) => {
            fs.unlink(destPath, () => {});
            reject(err);
          });
        });

        return;
      } catch (err: any) {
        lastError = err instanceof Error ? err : new Error(String(err));
        logger.warn(
          { attempt, maxRetries, url, error: lastError.message },
          "Download attempt failed; retrying...",
        );
        fs.removeSync(destPath);
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 1500 * attempt));
        }
      }
    }

    throw lastError || new Error(`Failed to download file from ${url}`);
  }

  private async emitProgress(
    callback: RenderProgressCallback | undefined,
    event: RenderProgressEvent,
  ): Promise<void> {
    if (!callback) return;
    try {
      await callback(event);
    } catch {
      // Progress reporting is advisory and must never interrupt video rendering
    }
  }

  private saveFailureMetadata(
    videoId: string,
    spec: ProductionSpec,
    error: unknown,
  ): void {
    const brandKit = spec.brandKit;
    const metadata: VideoMetadata = {
      videoId,
      filename: `${videoId}.mp4`,
      status: "failed",
      creationMode: spec.creationMode,
      originalPrompt: spec.userPrompt,
      templateId: spec.templateId,
      templateName: spec.title,
      brandName: brandKit?.brandName,
      watermarkText: brandKit?.watermarkText,
      captionStyle: spec.captionStyle,
      language: spec.language,
      dialect: spec.dialect,
      quality: spec.quality,
      resolution: spec.resolution,
      aspectRatio: spec.aspectRatio,
      visualMode: spec.visualMode,
      voiceProvider: spec.voiceProvider,
      costEstimate: spec.costEstimate as any,
      productionSpec: spec as any,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      downloadUrl: `/api/videos/${videoId}/download`,
      previewUrl: `/api/short-video/${videoId}`,
    };
    writeMetadata(this.config.videosDirPath, metadata);
  }

  public getThumbnailPath(videoId: string): string {
    return path.join(this.config.videosDirPath, `${videoId}.thumb.jpg`);
  }

  /**
   * Produces the cover image for an already-rendered video.
   *
   * Videos made before cover generation existed have a valid MP4 but no
   * thumbnail, so the library used to show a broken image for them. This is
   * called on demand for those, and the result is cached on disk so the work
   * happens once rather than on every request.
   *
   * Writes to a temporary file and renames it into place, so a concurrent
   * request can never observe a half-written JPEG.
   */
  public async ensureThumbnail(videoId: string): Promise<string | null> {
    const thumbnailPath = this.getThumbnailPath(videoId);
    if (fs.existsSync(thumbnailPath) && fs.statSync(thumbnailPath).size > 0) {
      return thumbnailPath;
    }

    const videoPath = this.getVideoPath(videoId);
    if (!fs.existsSync(videoPath) || fs.statSync(videoPath).size === 0) return null;

    const pendingPath = path.join(
      this.config.videosDirPath,
      `${videoId}.thumb.pending-${process.pid}.jpg`,
    );
    try {
      await this.ffmpeg.generateThumbnail(videoPath, pendingPath, 1.5);
      if (!fs.existsSync(pendingPath) || fs.statSync(pendingPath).size === 0) return null;
      fs.moveSync(pendingPath, thumbnailPath, { overwrite: true });
      return thumbnailPath;
    } catch (error) {
      logger.warn({ err: String(error), videoId }, "On-demand thumbnail generation failed");
      return null;
    } finally {
      if (fs.existsSync(pendingPath)) {
        try { fs.removeSync(pendingPath); } catch { /* best effort */ }
      }
    }
  }

  public getVideoPath(videoId: string): string {
    return path.join(this.config.videosDirPath, `${videoId}.mp4`);
  }

  public deleteVideo(videoId: string): void {
    const videoPath = this.getVideoPath(videoId);
    fs.removeSync(videoPath);
    deleteMetadata(this.config.videosDirPath, videoId);
    logger.debug({ videoId }, "Deleted video file and metadata");
  }

  public getVideo(videoId: string): Buffer {
    const videoPath = this.getVideoPath(videoId);
    if (!fs.existsSync(videoPath)) {
      throw new Error(`Video ${videoId} not found`);
    }
    return fs.readFileSync(videoPath);
  }

  private findMusic(videoDuration: number, tag?: MusicMoodEnum): MusicForVideo {
    const musicFiles = this.musicManager.musicList().filter((music) => {
      if (tag) {
        return music.mood === tag;
      }
      return true;
    });
    return musicFiles[Math.floor(Math.random() * musicFiles.length)];
  }

  public ListAvailableMusicTags(): MusicTag[] {
    const tags = new Set<MusicTag>();
    this.musicManager.musicList().forEach((music) => {
      tags.add(music.mood as MusicTag);
    });
    return Array.from(tags.values());
  }

  public listAllVideos(): { id: string; status: VideoStatus }[] {
    const videos: { id: string; status: VideoStatus }[] = [];
    if (!fs.existsSync(this.config.videosDirPath)) {
      return videos;
    }
    const files = fs.readdirSync(this.config.videosDirPath);
    for (const file of files) {
      if (file.endsWith(".mp4")) {
        const videoId = file.replace(".mp4", "");
        let status: VideoStatus = "ready";
        const inQueue = this.queue.find((item) => item.id === videoId);
        if (inQueue) {
          status = "processing";
        }
        videos.push({ id: videoId, status });
      }
    }
    for (const queueItem of this.queue) {
      const existingVideo = videos.find((v) => v.id === queueItem.id);
      if (!existingVideo) {
        videos.push({ id: queueItem.id, status: "processing" });
      }
    }
    return videos;
  }

  public ListAvailableVoices(): string[] {
    return this.kokoro.listAvailableVoices();
  }

  public async previewVoice(input: {
    text: string;
    language?: string;
    dialect?: any;
    qualityProfile?: VoiceQualityProfile;
    provider?: VoiceProviderId | "auto";
    voiceId?: string;
    pronunciationDictionary?: Record<string, string>;
  }): Promise<{
    audioUrl: string;
    provider: string;
    voiceId: string;
    language: string;
    dialect?: string;
    processedText: string;
    durationSeconds: number;
    generationMs?: number;
    warnings: string[];
  }> {
    const result = await this.voiceRegistry.synthesize({
      text: input.text,
      language: input.language,
      dialect: input.dialect,
      qualityProfile: input.qualityProfile || "balanced",
      requestedProvider: input.provider || "auto",
      voiceId: input.voiceId,
      fallbackPolicy: "none",
      brandPronunciations: input.pronunciationDictionary,
    });
    const tempId = cuid();
    const wavPath = path.join(this.config.tempDirPath, `${tempId}.wav`);
    const masteredWavPath = path.join(this.config.tempDirPath, `${tempId}.mastered.wav`);
    const mp3Path = path.join(this.config.tempDirPath, `${tempId}.mp3`);
    await this.ffmpeg.saveNormalizedAudioWithSpeed(result.audio, wavPath, 1.0);
    await this.audioMastering.masterVoice(wavPath, masteredWavPath);
    await this.ffmpeg.saveWavToMp3(masteredWavPath, mp3Path);
    const durationSeconds = await this.ffmpeg.getMediaDuration(masteredWavPath);
    fs.removeSync(wavPath);
    fs.removeSync(masteredWavPath);
    return {
      audioUrl: `/api/voice-preview/${tempId}.mp3`,
      provider: result.provider || result.decision.providerId,
      voiceId: result.voiceId || result.decision.voiceId,
      language: result.language || result.decision.language,
      dialect: result.dialect,
      processedText: result.processedText || result.decision.processedText,
      durationSeconds: Math.round((durationSeconds || result.audioLength || 0) * 100) / 100,
      generationMs: result.generationMs,
      warnings: result.decision.warnings,
    };
  }

  private mapVoiceQuality(quality?: string): VoiceQualityProfile {
    if (quality === "premium" || quality === "high") return "premium";
    if (quality === "draft") return "fast";
    return "balanced";
  }
}
