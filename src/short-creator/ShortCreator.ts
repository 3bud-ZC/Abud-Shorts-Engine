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

    const scenes: any[] = [];
    const excludeVideoIds: (string | number)[] = [];
    const previousVisualCandidates: any[] = [];
    const tempFiles: string[] = [];
    const visualProvidersUsed = new Set<string>();
    const voiceProvidersUsed = new Set<string>();
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
      const requestedSpokenNarration = String((originalSceneSpec as any).spokenNarration || sceneTimeline.narration);
      const targetSceneDuration = sceneTimeline.durationSeconds;
      const requestedVoiceQuality = this.mapVoiceQuality(spec.quality);
      const requestedVoiceProvider = ((brandVoiceProfile?.provider || spec.voiceProvider || "auto") as VoiceProviderId | "auto");
      const requestedVoiceId = pinnedVoiceId || brandVoiceProfile?.voiceId || spec.voiceId || undefined;

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
              // Retries must never change the speaker.
              voiceId: pinnedVoiceId || requestedVoiceId,
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
      sceneTimeline.actualSpeechDurationSeconds = actualVoiceDuration || targetSceneDuration;
      sceneTimeline.audioSpeedFactor = speedFactor;
      const speechWindowStartMs = 0;
      const speechWindowEndMs = Math.min(
        Math.round((actualVoiceDuration || targetSceneDuration) * 1000),
        Math.round(targetSceneDuration * 1000),
      );

      if (!voiceArtifact && voiceAudio && voiceMastering) {
        voiceProvidersUsed.add(voiceAudio.provider || voiceAudio.decision.providerId);
        const voiceInputHash = createVoiceInputHash({
          spokenNarration: requestedSpokenNarration,
          provider: voiceAudio.provider || voiceAudio.decision.providerId,
          model: voiceAudio.model,
          voiceId: voiceAudio.voiceId,
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
      let timingSource: "provider" | "whisper" | "synthetic_fallback" = "synthetic_fallback";
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
      } else if (voiceAudio?.wordTimings && voiceAudio.wordTimings.length > 0) {
        rawCaptions = voiceAudio.wordTimings.map((timing: any) => ({
          text: timing.word,
          startMs: timing.startMs,
          endMs: timing.endMs,
        }));
        timingSource = "provider";
      } else {
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

      if (!rawCaptions || rawCaptions.length === 0) {
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

        scenes.push({
          captions,
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
          let motionTemplate: MotionTemplateType = "kinetic_typography";
          if (spec.productionMode === "animated_explainer") {
            motionTemplate = index === 0 ? "kinetic_typography" : index === 1 ? "explainer_diagram" : "cta_card";
          } else {
            motionTemplate = index === 0 ? "kinetic_typography" : index === 1 ? "stat_animation" : "cta_card";
          }

          const motionResult = await motionEngine.renderMotionScene({
            template: motionTemplate,
            title: (originalSceneSpec as any).displayText || originalSceneSpec.onScreenText || originalSceneSpec.narration.slice(0, 35),
            subtitle: originalSceneSpec.narration.length > 35 ? originalSceneSpec.narration.slice(0, 75) : undefined,
            numberStat: { value: "99.9%", label: "أداء فائق" },
            features: ["جودة فيديو 1080p فائقة", "تصميم عصري وحركي", "دعم كامل للغة العربية"],
            ctaText: spec.brandKit?.outroText || "اطلب الآن عبر واتساب",
            contactText: spec.brandKit?.contactText,
            durationSeconds: targetSceneDuration,
            brandColors: {
              primary: spec.brandKit?.primaryColor || "#24545a",
              accent: spec.brandKit?.accentColor || "#d97706",
              secondary: (spec.brandKit as any)?.secondaryColor || "#11222c",
            },
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
          visualAsset = reusedAsset || await this.visualRouter.resolveSceneVisual(
            {
              ...originalSceneSpec,
              stockSearchTerms: sceneMediaPlan.searchCandidates || sceneMediaPlan.searchTerms || originalSceneSpec.stockSearchTerms,
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
        sceneQa.push({
          sceneIndex: index,
          assetExists: fs.existsSync(tempVideoPath),
          assetReadable: mediaDuration > 0 || isProductAd,
          durationFit: mediaDuration >= targetSceneDuration * 0.5 || isProductAd,
          visualRelevanceScore: visualAsset.metadata?.selectedScore || 95,
          duplicateRisk: visualAsset.metadata?.scoreBreakdown?.nearDuplicateRisk,
          cropSafety: visualAsset.metadata?.smartCrop,
          captionSafeLayout: true,
          voiceDurationFit: actualVoiceDuration <= targetSceneDuration * 1.08,
        });

        scenes.push({
          captions,
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

    const totalDurationSeconds = timeline.finalExpectedDurationSeconds;
    const selectedMusic = this.findMusic(totalDurationSeconds, mediaPlan.recommendedMusicMood as any);

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

    await this.emitProgress(onProgress, {
      status: "rendering",
      progress: 82,
      currentStage: "Rendering",
      message: "Rendering video with Remotion Motion Design and Advanced Captions.",
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
          captionPreset: mediaPlan.captionPreset || spec.captionStyle || "bold",
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
      progress: 90,
      currentStage: "Rendered",
      message: "Remotion render completed.",
      stageKey: "render",
      checkpointStatus: "completed",
      provider: "remotion",
      artifacts: { videoId, sceneCount: scenes.length },
      timingMs: Date.now() - renderStartedAt,
    });

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
