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
  resolveProductionTimeline,
  validateProductionSpec,
} from "../types/productionSpec";
import { convertTemplateToProductionSpec } from "../server/v2/templateToSpec";
import { VisualRegistry } from "../server/v2/visual-providers/registry";
import { VoiceRegistry } from "../server/v2/voice-providers/registry";
import { AutoVisualRouter } from "../server/v2/visual-providers/router";
import { mediaIntelligenceService } from "../server/v2/media-intelligence/mediaIntelligenceService";

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
  }

  public status(id: string): VideoStatus {
    const videoPath = this.getVideoPath(id);
    if (this.queue.find((item) => item.id === id)) {
      return "processing";
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
    const timeline: ResolvedProductionTimeline = resolveProductionTimeline(spec, 25);
    const mediaPlan = mediaIntelligenceService.generateMediaPlan(spec, {
      pacingProfile: (spec.metadata?.pacing as any) || (spec.quality === "high" || spec.quality === "premium" ? "fast" : undefined),
      captionPreset: (spec.captionStyle as any) || "bold",
    });

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
    const tempFiles: string[] = [];
    const visualProvidersUsed = new Set<string>();

    const orientation: OrientationEnum =
      spec.aspectRatio === "16:9" ? OrientationEnum.landscape : OrientationEnum.portrait;

    await this.emitProgress(onProgress, {
      status: "generating_content",
      progress: 10,
      currentStage: "Generating content",
      message: "Media Intelligence plan, pacing profile, and canonical timeline are resolved.",
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

      await this.emitProgress(onProgress, {
        status: "generating_voice",
        progress: sceneProgressBase,
        currentStage: "Generating voice",
        message: `Generating narration audio for scene ${index + 1}/${timeline.scenes.length}.`,
      });

      const voiceAudio = await this.voiceRegistry.generateVoice(
        sceneTimeline.narration,
        spec.voiceId || "af_heart",
        spec.voiceProvider,
      );

      const rawAudioLength = voiceAudio.audioLength || 5;
      const targetSceneDuration = sceneTimeline.durationSeconds;

      const tempId = cuid();
      const tempWavFileName = `${tempId}.wav`;
      const tempMp3FileName = `${tempId}.mp3`;
      const tempWavPath = path.join(this.config.tempDirPath, tempWavFileName);
      const tempMp3Path = path.join(this.config.tempDirPath, tempMp3FileName);
      tempFiles.push(tempWavPath, tempMp3Path);

      // Determine audio speed adjustment if raw audio length exceeds target duration budget
      let speedFactor = 1.0;
      if (rawAudioLength > targetSceneDuration * 1.05) {
        speedFactor = Math.min(1.35, Math.max(0.85, rawAudioLength / targetSceneDuration));
      }

      const { duration: actualVoiceDuration } = await this.ffmpeg.saveNormalizedAudioWithSpeed(
        voiceAudio.audio,
        tempWavPath,
        speedFactor,
      );
      await this.ffmpeg.saveWavToMp3(tempWavPath, tempMp3Path);

      sceneTimeline.actualSpeechDurationSeconds = actualVoiceDuration || rawAudioLength;
      sceneTimeline.audioSpeedFactor = speedFactor;

      await this.emitProgress(onProgress, {
        status: "generating_captions",
        progress: Math.min(sceneProgressBase + 8, 70),
        currentStage: "Generating captions",
        message: `Generating Whisper captions for scene ${index + 1}.`,
      });
      let rawCaptions: Caption[] = [];
      try {
        rawCaptions = await this.whisper.CreateCaption(tempWavPath);
      } catch (whisperErr) {
        logger.warn(whisperErr, `Whisper transcription notice for scene ${index + 1}; using synthesized word timestamps`);
      }

      if (!rawCaptions || rawCaptions.length === 0) {
        const words = (sceneTimeline.narration || "").trim().split(/\s+/).filter(Boolean);
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

      // Enforce caption boundaries strictly within the scene duration
      const maxSceneMs = Math.round(targetSceneDuration * 1000) + 100;
      const captions: Caption[] = rawCaptions
        .filter((c) => c.startMs < maxSceneMs)
        .map((c) => ({
          ...c,
          endMs: Math.min(c.endMs, maxSceneMs),
        }));

      await this.emitProgress(onProgress, {
        status: "searching_assets",
        progress: Math.min(sceneProgressBase + 15, 75),
        currentStage: "Searching footage",
        message: `Resolving media asset(s) for scene ${index + 1} (${sceneMediaPlan.visualIntent || "stock"}).`,
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

          const segAsset = await this.visualRouter.resolveSceneVisual(
            {
              ...originalSceneSpec,
              stockSearchTerms: seg.searchTerms,
              visualPrompt: seg.visualPrompt || originalSceneSpec.visualPrompt,
            } as any,
            spec,
            {
              excludeIds: excludeVideoIds,
              orientation,
              tempDirPath: this.config.tempDirPath,
              targetDurationSeconds: seg.durationSeconds,
            },
          );

          visualProvidersUsed.add(segAsset.provider);
          await this.downloadFile(segAsset.url, segVideoPath);

          if (segAsset.metadata?.pexelsVideoId) {
            excludeVideoIds.push(segAsset.metadata.pexelsVideoId as string | number);
          }

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
        });
      } else {
        // Single segment scene
        const tempVideoFileName = `${tempId}.mp4`;
        const tempVideoPath = path.join(this.config.tempDirPath, tempVideoFileName);
        tempFiles.push(tempVideoPath);

        const visualAsset = await this.visualRouter.resolveSceneVisual(
          {
            ...originalSceneSpec,
            stockSearchTerms: sceneMediaPlan.searchTerms || originalSceneSpec.stockSearchTerms,
          } as any,
          spec,
          {
            excludeIds: excludeVideoIds,
            orientation,
            tempDirPath: this.config.tempDirPath,
            targetDurationSeconds: targetSceneDuration,
          },
        );

        visualProvidersUsed.add(visualAsset.provider);
        await this.downloadFile(visualAsset.url, tempVideoPath);

        if (visualAsset.metadata?.pexelsVideoId) {
          excludeVideoIds.push(visualAsset.metadata.pexelsVideoId as string | number);
        }

        scenes.push({
          captions,
          video: `http://localhost:${this.config.port}/api/tmp/${tempVideoFileName}`,
          motion: sceneMediaPlan.motion,
          transition: sceneMediaPlan.transitionToNext,
          audio: {
            url: `http://localhost:${this.config.port}/api/tmp/${tempMp3FileName}`,
            duration: targetSceneDuration,
          },
        });
      }

      index++;
    }

    const totalDurationSeconds = timeline.finalExpectedDurationSeconds;
    const selectedMusic = this.findMusic(totalDurationSeconds, mediaPlan.recommendedMusicMood as any);

    await this.emitProgress(onProgress, {
      status: "rendering",
      progress: 82,
      currentStage: "Rendering",
      message: "Rendering video with Remotion Motion Design and Advanced Captions.",
    });

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
          musicVolume: "high" as any,
          brandKit: spec.brandKit,
        },
      },
      videoId,
      orientation,
      spec.quality || "standard",
    );

    await this.emitProgress(onProgress, {
      status: "finalizing",
      progress: 94,
      currentStage: "Finalizing",
      message: "Generating thumbnail cover and validating output quality.",
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
        status: "ready",
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
        costEstimate: spec.costEstimate as any,
        productionSpec: spec as any,
        timeline: timeline as any,
        mediaPlan: mediaPlan as any,
        qualityScore: validationResult.technicalScore,
        technicalScore: validationResult.technicalScore,
        mediaPlanScore: mediaPlan.qualityReview?.overallScore || 90,
        overallProductionScore: Math.round(
          (validationResult.technicalScore * 0.5) + ((mediaPlan.qualityReview?.overallScore || 90) * 0.5),
        ),
        validationResult: validationResult as any,
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
        downloadUrl: `/api/videos/${videoId}/download`,
        previewUrl: `/api/short-video/${videoId}`,
      };
      writeMetadata(this.config.videosDirPath, metadata);
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
}
