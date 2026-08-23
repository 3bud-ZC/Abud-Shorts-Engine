import ffmpeg from "fluent-ffmpeg";
import path from "path";
import fs from "fs-extra";
import { Readable } from "node:stream";
import { logger } from "../../logger";

export type RenderValidationResult = {
  valid: boolean;
  durationSeconds: number;
  durationVariance: number;
  durationVariancePercent?: number;
  hasVideoStream: boolean;
  hasAudioStream: boolean;
  width: number;
  height: number;
  aspectRatio: "9:16" | "16:9" | "1:1" | "other";
  fileSizeBytes: number;
  bitrateBps: number;
  fps: number;
  technicalScore: number; // 0-100
  issues: string[];
};

export class FFMpeg {
  static async init(): Promise<FFMpeg> {
    return import("@ffmpeg-installer/ffmpeg").then((ffmpegInstaller) => {
      ffmpeg.setFfmpegPath(ffmpegInstaller.path);
      logger.info("FFmpeg path set to:", ffmpegInstaller.path);
      return new FFMpeg();
    });
  }

  async saveNormalizedAudio(
    audio: ArrayBuffer,
    outputPath: string,
  ): Promise<string> {
    logger.debug("Normalizing audio for Whisper");
    const inputStream = new Readable();
    inputStream.push(Buffer.from(audio));
    inputStream.push(null);

    return new Promise((resolve, reject) => {
      ffmpeg()
        .input(inputStream)
        .audioCodec("pcm_s16le")
        .audioChannels(1)
        .audioFrequency(16000)
        .toFormat("wav")
        .on("end", () => {
          logger.debug("Audio normalization complete");
          resolve(outputPath);
        })
        .on("error", (error: unknown) => {
          logger.error(error, "Error normalizing audio:");
          reject(error);
        })
        .save(outputPath);
    });
  }

  async createMp3DataUri(audio: ArrayBuffer): Promise<string> {
    const inputStream = new Readable();
    inputStream.push(Buffer.from(audio));
    inputStream.push(null);
    return new Promise((resolve, reject) => {
      const chunk: Buffer[] = [];

      ffmpeg()
        .input(inputStream)
        .audioCodec("libmp3lame")
        .audioBitrate(128)
        .audioChannels(2)
        .toFormat("mp3")
        .on("error", (err) => {
          reject(err);
        })
        .pipe()
        .on("data", (data: Buffer) => {
          chunk.push(data);
        })
        .on("end", () => {
          const buffer = Buffer.concat(chunk);
          resolve(`data:audio/mp3;base64,${buffer.toString("base64")}`);
        })
        .on("error", (err) => {
          reject(err);
        });
    });
  }

  async getMediaDuration(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) return reject(err);
        const duration = metadata?.format?.duration;
        resolve(typeof duration === "number" ? duration : parseFloat(duration || "0"));
      });
    });
  }

  async saveNormalizedAudioWithSpeed(
    audio: ArrayBuffer,
    outputPath: string,
    speedFactor = 1.0,
  ): Promise<{ duration: number }> {
    logger.debug({ speedFactor }, "Normalizing audio with speed factor for Whisper");
    const inputStream = new Readable();
    inputStream.push(Buffer.from(audio));
    inputStream.push(null);

    const safeSpeed = Math.max(0.75, Math.min(1.4, speedFactor));

    return new Promise((resolve, reject) => {
      let command = ffmpeg()
        .input(inputStream)
        .audioCodec("pcm_s16le")
        .audioChannels(1)
        .audioFrequency(16000);

      if (Math.abs(safeSpeed - 1.0) > 0.03) {
        command = command.audioFilters(`atempo=${safeSpeed.toFixed(3)}`);
      }

      command
        .toFormat("wav")
        .on("end", async () => {
          logger.debug("Audio normalization complete");
          try {
            const dur = await this.getMediaDuration(outputPath);
            resolve({ duration: dur });
          } catch {
            resolve({ duration: 0 });
          }
        })
        .on("error", (error: unknown) => {
          logger.error(error, "Error normalizing audio:");
          reject(error);
        })
        .save(outputPath);
    });
  }

  async saveWavToMp3(wavPath: string, mp3Path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      ffmpeg()
        .input(wavPath)
        .audioCodec("libmp3lame")
        .audioBitrate(128)
        .audioChannels(2)
        .toFormat("mp3")
        .save(mp3Path)
        .on("end", () => resolve(mp3Path))
        .on("error", (err) => reject(err));
    });
  }

  async saveToMp3(audio: ArrayBuffer, filePath: string): Promise<string> {
    const inputStream = new Readable();
    inputStream.push(Buffer.from(audio));
    inputStream.push(null);
    return new Promise((resolve, reject) => {
      ffmpeg()
        .input(inputStream)
        .audioCodec("libmp3lame")
        .audioBitrate(128)
        .audioChannels(2)
        .toFormat("mp3")
        .save(filePath)
        .on("end", () => {
          logger.debug("Audio conversion complete");
          resolve(filePath);
        })
        .on("error", (err) => {
          reject(err);
        });
    });
  }

  /**
   * Generates a high-quality video cover thumbnail from the rendered MP4.
   */
  async generateThumbnail(
    videoPath: string,
    outputPath: string,
    timestampSeconds = 1.5,
  ): Promise<string> {
    fs.ensureDirSync(path.dirname(outputPath));

    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .screenshots({
          timestamps: [timestampSeconds],
          filename: path.basename(outputPath),
          folder: path.dirname(outputPath),
        })
        .on("end", () => {
          logger.debug({ outputPath }, "Video thumbnail generated successfully");
          resolve(outputPath);
        })
        .on("error", (err) => {
          logger.error(err, "Failed to generate video thumbnail");
          reject(err);
        });
    });
  }

  /**
   * Performs deterministic post-render quality validation on the generated video file.
   */
  async validateRenderedVideo(
    videoPath: string,
    expectedDurationSeconds: number,
  ): Promise<RenderValidationResult> {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(videoPath)) {
        return resolve({
          valid: false,
          durationSeconds: 0,
          durationVariance: expectedDurationSeconds,
          hasVideoStream: false,
          hasAudioStream: false,
          width: 0,
          height: 0,
          aspectRatio: "other",
          fileSizeBytes: 0,
          bitrateBps: 0,
          fps: 0,
          technicalScore: 0,
          issues: ["Video file does not exist on disk."],
        });
      }

      const fileStats = fs.statSync(videoPath);

      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) {
          return resolve({
            valid: false,
            durationSeconds: 0,
            durationVariance: expectedDurationSeconds,
            hasVideoStream: false,
            hasAudioStream: false,
            width: 0,
            height: 0,
            aspectRatio: "other",
            fileSizeBytes: fileStats.size,
            bitrateBps: 0,
            fps: 0,
            technicalScore: 0,
            issues: [`FFprobe inspection failed: ${err.message}`],
          });
        }

        const duration = parseFloat(String(metadata?.format?.duration || 0));
        const bitrate = parseInt(String(metadata?.format?.bit_rate || 0), 10);
        const videoStream = metadata?.streams?.find((s) => s.codec_type === "video");
        const audioStream = metadata?.streams?.find((s) => s.codec_type === "audio");

        const hasVideoStream = Boolean(videoStream);
        const hasAudioStream = Boolean(audioStream);

        const width = videoStream?.width || 0;
        const height = videoStream?.height || 0;

        let aspectRatio: "9:16" | "16:9" | "1:1" | "other" = "other";
        if (width === 1080 && height === 1920) aspectRatio = "9:16";
        else if (width === 1920 && height === 1080) aspectRatio = "16:9";
        else if (width === height && width > 0) aspectRatio = "1:1";
        else if (height > width) aspectRatio = "9:16";
        else if (width > height) aspectRatio = "16:9";

        let fps = 25;
        if (videoStream?.r_frame_rate) {
          const parts = videoStream.r_frame_rate.split("/");
          if (parts.length === 2 && parseFloat(parts[1]) > 0) {
            fps = Math.round(parseFloat(parts[0]) / parseFloat(parts[1]));
          }
        }

        const durationVariance = Math.abs(Math.round((duration - expectedDurationSeconds) * 100) / 100);
        const durationVariancePercent = expectedDurationSeconds > 0
          ? Math.round((durationVariance / expectedDurationSeconds) * 1000) / 10
          : 0;

        const issues: string[] = [];
        let technicalScore = 100;

        if (!hasVideoStream) {
          issues.push("Missing video stream in MP4.");
          technicalScore -= 50;
        }
        if (!hasAudioStream) {
          issues.push("Missing audio stream in MP4.");
          technicalScore -= 30;
        }

        // Strict Duration Scoring:
        // <= 0.5s variance: 0 deduction (full score)
        // 0.5s - 1.0s: -5 deduction
        // 1.0s - 3.0s: -25 deduction
        // 3.0s - 5.0s: -45 deduction
        // > 5.0s: -70 deduction and marks video as invalid
        if (durationVariance > 5.0) {
          issues.push(
            `Critical duration mismatch: requested ${expectedDurationSeconds}s, produced ${duration}s (variance: ${durationVariance}s / ${durationVariancePercent}% error).`,
          );
          technicalScore -= 70;
        } else if (durationVariance > 3.0) {
          issues.push(
            `Severe duration variance: requested ${expectedDurationSeconds}s, produced ${duration}s (variance: ${durationVariance}s / ${durationVariancePercent}% error).`,
          );
          technicalScore -= 45;
        } else if (durationVariance > 1.0) {
          issues.push(
            `Duration variance of ${durationVariance}s exceeds 1.0s target (${durationVariancePercent}% error).`,
          );
          technicalScore -= 25;
        } else if (durationVariance > 0.5) {
          technicalScore -= 5;
        }

        if (fileStats.size < 500000) {
          issues.push("File size is suspiciously low (< 500KB).");
          technicalScore -= 20;
        }

        const valid = hasVideoStream && hasAudioStream && durationVariance <= 3.0 && fileStats.size >= 500000;

        resolve({
          valid,
          durationSeconds: Math.round(duration * 100) / 100,
          durationVariance,
          durationVariancePercent,
          hasVideoStream,
          hasAudioStream,
          width,
          height,
          aspectRatio,
          fileSizeBytes: fileStats.size,
          bitrateBps: bitrate,
          fps,
          technicalScore: Math.max(0, technicalScore),
          issues,
        });
      });
    });
  }
}
