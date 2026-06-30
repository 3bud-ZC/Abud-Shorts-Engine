import express from "express";
import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
} from "express";
import fs from "fs-extra";
import path from "path";

import { validateCreateShortInput } from "../validator";
import { ShortCreator } from "../../short-creator/ShortCreator";
import { logger } from "../../logger";
import { Config } from "../../config";
import {
  readMetadata,
  mergeMetadata,
  buildDownloadFilename,
  listVideoFiles,
  filterVideoList,
} from "../videoMetadata";
import {
  getBusinessTemplateById,
  listBusinessTemplates,
} from "../../short-creator/business-templates";
import {
  TemplateNarrationError,
  applyBusinessTemplateToScenes,
} from "../../short-creator/templateEnrichment";
import type { SceneInputWithFallback } from "../../types/shorts";

// todo abstract class
export class APIRouter {
  public router: express.Router;
  private shortCreator: ShortCreator;
  private config: Config;

  constructor(config: Config, shortCreator: ShortCreator) {
    this.config = config;
    this.router = express.Router();
    this.shortCreator = shortCreator;

    this.router.use(express.json());

    this.setupRoutes();
  }

  private setupRoutes() {
    this.router.post(
      "/short-video",
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const input = validateCreateShortInput(req.body);

          logger.info({ input }, "Creating short video");
          const scenes: SceneInputWithFallback[] = input.businessTemplateId
            ? applyBusinessTemplateToScenes(
              [],
              getBusinessTemplateById(input.businessTemplateId),
              input.businessTemplateData,
            )
            : input.scenes;

          const videoId = this.shortCreator.addToQueue(
            scenes,
            input.config,
            input.businessTemplateId,
            input.businessTemplateData,
          );

          res.status(201).json({
            videoId,
          });
        } catch (error: unknown) {
          if (error instanceof TemplateNarrationError) {
            logger.warn({ error: error.message }, "Template narration invalid");
            res.status(400).json({
              error: "Template narration invalid",
              message: error.message,
            });
            return;
          }
          logger.error(error, "Error validating input");

          // Handle validation errors specifically
          if (error instanceof Error && error.message.startsWith("{")) {
            try {
              const errorData = JSON.parse(error.message);
              res.status(400).json({
                error: "Validation failed",
                message: errorData.message,
                missingFields: errorData.missingFields,
              });
              return;
            } catch (parseError: unknown) {
              logger.error(parseError, "Error parsing validation error");
            }
          }

          // Fallback for other errors
          res.status(400).json({
            error: "Invalid input",
            message: error instanceof Error ? error.message : "Unknown error",
          });
        }
      },
    );

    this.router.get(
      "/short-video/:videoId/status",
      async (req: ExpressRequest, res: ExpressResponse) => {
        const { videoId } = req.params;
        if (!videoId) {
          res.status(400).json({
            error: "videoId is required",
          });
          return;
        }
        const status = this.shortCreator.status(videoId);
        res.status(200).json({
          status,
        });
      },
    );

    this.router.get(
      "/music-tags",
      (req: ExpressRequest, res: ExpressResponse) => {
        res.status(200).json(this.shortCreator.ListAvailableMusicTags());
      },
    );

    this.router.get("/voices", (req: ExpressRequest, res: ExpressResponse) => {
      res.status(200).json(this.shortCreator.ListAvailableVoices());
    });

    this.router.get(
      "/business-templates",
      (req: ExpressRequest, res: ExpressResponse) => {
        res.status(200).json(listBusinessTemplates());
      },
    );

    this.router.get(
      "/short-videos",
      (req: ExpressRequest, res: ExpressResponse) => {
        const videos = this.shortCreator.listAllVideos();
        res.status(200).json({
          videos,
        });
      },
    );

    this.router.delete(
      "/short-video/:videoId",
      (req: ExpressRequest, res: ExpressResponse) => {
        const { videoId } = req.params;
        if (!videoId) {
          res.status(400).json({
            error: "videoId is required",
          });
          return;
        }
        this.shortCreator.deleteVideo(videoId);
        res.status(200).json({
          success: true,
        });
      },
    );

    this.router.get(
      "/tmp/:tmpFile",
      (req: ExpressRequest, res: ExpressResponse) => {
        const { tmpFile } = req.params;
        if (!tmpFile) {
          res.status(400).json({
            error: "tmpFile is required",
          });
          return;
        }
        const tmpFilePath = path.join(this.config.tempDirPath, tmpFile);
        if (!fs.existsSync(tmpFilePath)) {
          res.status(404).json({
            error: "tmpFile not found",
          });
          return;
        }

        if (tmpFile.endsWith(".mp3")) {
          res.setHeader("Content-Type", "audio/mpeg");
        }
        if (tmpFile.endsWith(".wav")) {
          res.setHeader("Content-Type", "audio/wav");
        }
        if (tmpFile.endsWith(".mp4")) {
          res.setHeader("Content-Type", "video/mp4");
        }

        const tmpFileStream = fs.createReadStream(tmpFilePath);
        tmpFileStream.on("error", (error) => {
          logger.error(error, "Error reading tmp file");
          res.status(500).json({
            error: "Error reading tmp file",
            tmpFile,
          });
        });
        tmpFileStream.pipe(res);
      },
    );

    this.router.get(
      "/music/:fileName",
      (req: ExpressRequest, res: ExpressResponse) => {
        const { fileName } = req.params;
        if (!fileName) {
          res.status(400).json({
            error: "fileName is required",
          });
          return;
        }
        const musicFilePath = path.join(this.config.musicDirPath, fileName);
        if (!fs.existsSync(musicFilePath)) {
          res.status(404).json({
            error: "music file not found",
          });
          return;
        }
        const musicFileStream = fs.createReadStream(musicFilePath);
        musicFileStream.on("error", (error) => {
          logger.error(error, "Error reading music file");
          res.status(500).json({
            error: "Error reading music file",
            fileName,
          });
        });
        musicFileStream.pipe(res);
      },
    );

    this.router.get(
      "/short-video/:videoId",
      (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const { videoId } = req.params;
          if (!videoId) {
            res.status(400).json({
              error: "videoId is required",
            });
            return;
          }
          const video = this.shortCreator.getVideo(videoId);
          res.setHeader("Content-Type", "video/mp4");
          res.setHeader(
            "Content-Disposition",
            `inline; filename=${videoId}.mp4`,
          );
          res.send(video);
        } catch (error: unknown) {
          logger.error(error, "Error getting video");
          res.status(404).json({
            error: "Video not found",
          });
        }
      },
    );

    // Delivery API — list all generated videos with metadata
    this.router.get(
      "/videos",
      (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const videosDir = this.config.videosDirPath;
          const hostPathHint = "C:/abud-shorts-engine/data-dev/videos";
          if (!fs.existsSync(videosDir)) {
            res.status(200).json({ videos: [] });
            return;
          }

          const files = listVideoFiles(fs.readdirSync(videosDir));
          const { status: queryStatus, templateId: queryTemplateId } = req.query;

          let videos = files
            .map((file) => {
              const videoId = file.replace(".mp4", "");
              const filePath = path.join(videosDir, file);
              const stats = fs.statSync(filePath);
              const status = this.shortCreator.status(videoId);
              const sidecar = readMetadata(videosDir, videoId);
              const downloadFilename = buildDownloadFilename(videoId, sidecar);
              const containerPath = path.join(this.config.videosDirPath, file);

              const fileMeta = {
                videoId,
                filename: file,
                status,
                sizeBytes: stats.size,
                createdAt: stats.mtime.toISOString(),
                downloadUrl: `/api/videos/${videoId}/download`,
                previewUrl: `/api/short-video/${videoId}`,
                downloadFilename,
                containerPath,
                hostPathHint,
              };

              return mergeMetadata(fileMeta, sidecar);
            })
            .sort(
              (a, b) =>
                new Date(b.createdAt || 0).getTime() -
                new Date(a.createdAt || 0).getTime(),
            );

          // Optional query filtering
          videos = filterVideoList(videos, {
            status: typeof queryStatus === "string" ? queryStatus : undefined,
            templateId:
              typeof queryTemplateId === "string"
                ? queryTemplateId
                : undefined,
          });

          res.status(200).json({ videos });
        } catch (error: unknown) {
          logger.error(error, "Error listing videos");
          res.status(500).json({
            error: "Failed to list videos",
          });
        }
      },
    );

    // Delivery API — get single video metadata
    this.router.get(
      "/videos/:videoId",
      (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const { videoId } = req.params;
          if (!videoId || !isSafeVideoId(videoId)) {
            res.status(400).json({
              error: "Invalid videoId",
            });
            return;
          }

          const videoPath = path.join(this.config.videosDirPath, `${videoId}.mp4`);
          const resolvedPath = path.resolve(videoPath);
          const resolvedVideosDir = path.resolve(this.config.videosDirPath);

          if (!resolvedPath.startsWith(resolvedVideosDir)) {
            res.status(400).json({
              error: "Invalid video path",
            });
            return;
          }

          if (!fs.existsSync(videoPath)) {
            res.status(404).json({
              error: "Video not found",
            });
            return;
          }

          const stats = fs.statSync(videoPath);
          const status = this.shortCreator.status(videoId);
          const sidecar = readMetadata(this.config.videosDirPath, videoId);
          const downloadFilename = buildDownloadFilename(videoId, sidecar);
          const hostPathHint = "C:/abud-shorts-engine/data-dev/videos";

          const fileMeta = {
            videoId,
            filename: `${videoId}.mp4`,
            status,
            sizeBytes: stats.size,
            createdAt: stats.mtime.toISOString(),
            downloadUrl: `/api/videos/${videoId}/download`,
            previewUrl: `/api/short-video/${videoId}`,
            downloadFilename,
            containerPath: videoPath,
            hostPathHint,
          };

          res.status(200).json(mergeMetadata(fileMeta, sidecar));
        } catch (error: unknown) {
          logger.error(error, "Error getting video metadata");
          res.status(500).json({
            error: "Failed to get video metadata",
          });
        }
      },
    );

    // Delivery API — download video with safe filename
    this.router.get(
      "/videos/:videoId/download",
      (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const { videoId } = req.params;
          if (!videoId || !isSafeVideoId(videoId)) {
            res.status(400).json({
              error: "Invalid videoId",
            });
            return;
          }

          const videoPath = path.join(this.config.videosDirPath, `${videoId}.mp4`);
          const resolvedPath = path.resolve(videoPath);
          const resolvedVideosDir = path.resolve(this.config.videosDirPath);

          if (!resolvedPath.startsWith(resolvedVideosDir)) {
            res.status(400).json({
              error: "Invalid video path",
            });
            return;
          }

          if (!fs.existsSync(videoPath)) {
            res.status(404).json({
              error: "Video not found",
            });
            return;
          }

          const sidecar = readMetadata(this.config.videosDirPath, videoId);
          const safeFilename = buildDownloadFilename(videoId, sidecar);
          res.setHeader("Content-Type", "video/mp4");
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="${safeFilename}"`,
          );

          const fileStream = fs.createReadStream(videoPath);
          fileStream.on("error", (error) => {
            logger.error(error, "Error reading video file");
            res.status(500).json({
              error: "Error reading video file",
            });
          });
          fileStream.pipe(res);
        } catch (error: unknown) {
          logger.error(error, "Error downloading video");
          res.status(500).json({
            error: "Failed to download video",
          });
        }
      },
    );
  }
}

export function isSafeVideoId(videoId: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(videoId);
}

export function sanitizeDownloadFilename(videoId: string): string {
  const sanitized = videoId.replace(/[^a-zA-Z0-9_-]/g, "");
  return `abud-short-${sanitized}.mp4`;
}
