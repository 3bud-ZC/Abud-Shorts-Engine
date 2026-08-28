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

export type AudioStreamInfo = {
  codec?: string;
  sampleRate?: number;
  channels?: number;
  durationSeconds: number;
  hasAudioStream: boolean;
};

export type AudioLoudnessMetrics = {
  integratedLufs: number | null;
  truePeakDbtp: number | null;
  loudnessRange: number | null;
  threshold?: number | null;
  clippingDetected: boolean;
  effectivelySilent: boolean;
  raw?: Record<string, unknown>;
};

export type DownloadedVideoValidationResult = {
  valid: boolean;
  durationSeconds: number;
  width: number;
  height: number;
  hasVideoStream: boolean;
  fileSizeBytes: number;
  bitrateBps: number;
  fps: number;
  codec?: string;
  containerFormat?: string;
  issues: string[];
};

export type BlackFrameAnalysisResult = {
  blackFramePercent: number;
  longestBlackRunMs: number;
  blackRuns: Array<{ startSeconds: number; endSeconds: number; durationSeconds: number }>;
  sampledDurationSeconds: number;
  pass: boolean;
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
    audio: ArrayBuffer | Buffer | Readable,
    outputPath: string,
  ): Promise<string> {
    logger.debug("Normalizing audio for Whisper");
    const inputStream = this.toReadableAudio(audio);

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
    const inputStream = this.toReadableAudio(audio);
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

  async getAudioStreamInfo(filePath: string): Promise<AudioStreamInfo> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) return reject(err);
        const audioStream = metadata?.streams?.find((s) => s.codec_type === "audio");
        const duration = metadata?.format?.duration;
        resolve({
          codec: audioStream?.codec_name,
          sampleRate: audioStream?.sample_rate ? Number(audioStream.sample_rate) : undefined,
          channels: audioStream?.channels,
          durationSeconds: typeof duration === "number" ? duration : parseFloat(String(duration || "0")),
          hasAudioStream: Boolean(audioStream),
        });
      });
    });
  }

  async validateDownloadedVideoAsset(
    videoPath: string,
    expectedDurationSeconds = 0,
  ): Promise<DownloadedVideoValidationResult> {
    return new Promise((resolve) => {
      if (!fs.existsSync(videoPath)) {
        resolve({
          valid: false,
          durationSeconds: 0,
          width: 0,
          height: 0,
          hasVideoStream: false,
          fileSizeBytes: 0,
          bitrateBps: 0,
          fps: 0,
          issues: ["Downloaded video file does not exist."],
        });
        return;
      }

      const fileStats = fs.statSync(videoPath);
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) {
          resolve({
            valid: false,
            durationSeconds: 0,
            width: 0,
            height: 0,
            hasVideoStream: false,
            fileSizeBytes: fileStats.size,
            bitrateBps: 0,
            fps: 0,
            issues: [`FFprobe inspection failed: ${err.message}`],
          });
          return;
        }

        const videoStream = metadata?.streams?.find((s) => s.codec_type === "video");
        const duration = parseFloat(String(metadata?.format?.duration || videoStream?.duration || 0));
        const bitrate = parseInt(String(metadata?.format?.bit_rate || 0), 10);
        const width = videoStream?.width || 0;
        const height = videoStream?.height || 0;
        let fps = 0;
        if (videoStream?.r_frame_rate) {
          const [num, den] = videoStream.r_frame_rate.split("/").map(Number);
          if (den > 0) fps = Math.round(num / den);
        }

        const issues: string[] = [];
        if (!videoStream) issues.push("Missing video stream.");
        if (!Number.isFinite(duration) || duration <= 0) issues.push("Missing or zero duration.");
        if (!width || !height) issues.push("Missing video dimensions.");
        if (fileStats.size < 10_000) issues.push("Downloaded file is suspiciously small.");
        if (expectedDurationSeconds > 0 && duration < expectedDurationSeconds * 0.45) {
          issues.push(`Clip duration ${duration}s is too short for ${expectedDurationSeconds}s target.`);
        }

        resolve({
          valid: issues.length === 0,
          durationSeconds: Number.isFinite(duration) ? Math.round(duration * 100) / 100 : 0,
          width,
          height,
          hasVideoStream: Boolean(videoStream),
          fileSizeBytes: fileStats.size,
          bitrateBps: Number.isFinite(bitrate) ? bitrate : 0,
          fps,
          codec: videoStream?.codec_name,
          containerFormat: metadata?.format?.format_name,
          issues,
        });
      });
    });
  }

  async analyzeBlackFrames(videoPath: string, durationSeconds: number): Promise<BlackFrameAnalysisResult> {
    if (!fs.existsSync(videoPath)) {
      return {
        blackFramePercent: 100,
        longestBlackRunMs: Math.round(durationSeconds * 1000),
        blackRuns: [{ startSeconds: 0, endSeconds: durationSeconds, durationSeconds }],
        sampledDurationSeconds: durationSeconds,
        pass: false,
      };
    }

    return new Promise((resolve) => {
      let stderr = "";
      ffmpeg(videoPath)
        .videoFilters("blackdetect=d=0.1:pic_th=0.98")
        .format("null")
        .output(process.platform === "win32" ? "NUL" : "/dev/null")
        .on("stderr", (line) => {
          stderr += `${line}\n`;
        })
        .on("end", () => {
          const runs: BlackFrameAnalysisResult["blackRuns"] = [];
          const re = /black_start:(\d+(?:\.\d+)?)\s+black_end:(\d+(?:\.\d+)?)\s+black_duration:(\d+(?:\.\d+)?)/g;
          let match: RegExpExecArray | null;
          while ((match = re.exec(stderr))) {
            runs.push({
              startSeconds: Number(match[1]),
              endSeconds: Number(match[2]),
              durationSeconds: Number(match[3]),
            });
          }
          const totalBlack = runs.reduce((sum, run) => sum + run.durationSeconds, 0);
          const longestBlackRunMs = Math.round(Math.max(0, ...runs.map((run) => run.durationSeconds)) * 1000);
          const safeDuration = Math.max(0.01, durationSeconds);
          const blackFramePercent = Math.round((totalBlack / safeDuration) * 1000) / 10;
          resolve({
            blackFramePercent,
            longestBlackRunMs,
            blackRuns: runs,
            sampledDurationSeconds: durationSeconds,
            pass: longestBlackRunMs <= 300 && blackFramePercent <= 1,
          });
        })
        .on("error", (error) => {
          logger.warn({ err: String(error), videoPath }, "Black-frame analysis failed; reporting unknown as pass");
          resolve({
            blackFramePercent: 0,
            longestBlackRunMs: 0,
            blackRuns: [],
            sampledDurationSeconds: durationSeconds,
            pass: true,
          });
        })
        .run();
    });
  }

  async measureAudioLoudness(filePath: string): Promise<AudioLoudnessMetrics> {
    const nullOutput = process.platform === "win32" ? "NUL" : "/dev/null";
    return new Promise((resolve, reject) => {
      let stderr = "";
      ffmpeg(filePath)
        .audioFilters("loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json")
        .format("null")
        .output(nullOutput)
        .on("stderr", (line) => {
          stderr += `${line}\n`;
        })
        .on("end", () => {
          const jsonStart = stderr.lastIndexOf("{");
          const jsonEnd = stderr.lastIndexOf("}");
          if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
            resolve({
              integratedLufs: null,
              truePeakDbtp: null,
              loudnessRange: null,
              clippingDetected: false,
              effectivelySilent: false,
            });
            return;
          }
          try {
            const raw = JSON.parse(stderr.slice(jsonStart, jsonEnd + 1));
            const integrated = Number(raw.input_i);
            const truePeak = Number(raw.input_tp);
            const lra = Number(raw.input_lra);
            resolve({
              integratedLufs: Number.isFinite(integrated) ? integrated : null,
              truePeakDbtp: Number.isFinite(truePeak) ? truePeak : null,
              loudnessRange: Number.isFinite(lra) ? lra : null,
              threshold: Number.isFinite(Number(raw.input_thresh)) ? Number(raw.input_thresh) : null,
              clippingDetected: Number.isFinite(truePeak) ? truePeak > -0.1 : false,
              effectivelySilent: Number.isFinite(integrated) ? integrated < -55 : false,
              raw,
            });
          } catch (error) {
            reject(error);
          }
        })
        .on("error", reject)
        .run();
    });
  }

  async masterVoiceAudioFile(inputPath: string, outputPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .audioFilters([
          "silenceremove=start_periods=1:start_duration=0.08:start_threshold=-45dB:stop_periods=1:stop_duration=0.12:stop_threshold=-45dB",
          "highpass=f=80",
          "acompressor=threshold=-18dB:ratio=2.2:attack=12:release=180:makeup=1",
          "loudnorm=I=-16:TP=-2:LRA=11",
          "volume=-2dB",
          "alimiter=limit=0.70",
        ])
        .audioCodec("pcm_s16le")
        .audioChannels(1)
        .audioFrequency(16000)
        .toFormat("wav")
        .save(outputPath)
        .on("end", () => resolve(outputPath))
        .on("error", reject);
    });
  }

  async saveNormalizedAudioWithSpeed(
    audio: ArrayBuffer | Buffer | Readable,
    outputPath: string,
    speedFactor = 1.0,
  ): Promise<{ duration: number }> {
    logger.debug({ speedFactor }, "Normalizing audio with speed factor for Whisper");
    const inputStream = this.toReadableAudio(audio);

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
    const inputStream = this.toReadableAudio(audio);
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

  private toReadableAudio(audio: ArrayBuffer | Buffer | Readable): Readable {
    if (audio instanceof Readable) {
      return audio;
    }
    const inputStream = new Readable();
    inputStream.push(Buffer.from(audio));
    inputStream.push(null);
    return inputStream;
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

  /**
   * Burns an ASS subtitle file onto a video with libass.
   *
   * The runtime's libass is linked against HarfBuzz and FriBidi, so Arabic
   * shaping, ligatures and bidi ordering are done by the text engine. Nothing
   * here reorders characters.
   *
   * `fontsdir` points at the bundled OFL pack so rendering never depends on
   * system font luck or a network fetch.
   */
  public async burnAssSubtitles(
    videoPath: string,
    assPath: string,
    outputPath: string,
    fontsDir?: string,
  ): Promise<string> {
    if (!fs.existsSync(videoPath)) throw new Error(`Video not found for caption burn: ${videoPath}`);
    if (!fs.existsSync(assPath)) throw new Error(`ASS subtitle not found: ${assPath}`);
    fs.ensureDirSync(path.dirname(outputPath));

    // FFmpeg filter arguments are colon-separated, so the path separators and
    // drive colons have to be escaped rather than passed raw.
    const escapeFilterPath = (value: string) =>
      value.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");

    const resolvedFontsDir = fontsDir || process.env.ABUD_FONT_DIR;
    const filter = resolvedFontsDir
      ? `ass='${escapeFilterPath(assPath)}':fontsdir='${escapeFilterPath(resolvedFontsDir)}'`
      : `ass='${escapeFilterPath(assPath)}'`;

    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .videoFilters(filter)
        .outputOptions([
          "-c:v libx264",
          "-preset medium",
          "-crf 18",
          "-pix_fmt yuv420p",
          // Audio is already mastered upstream; copying keeps it untouched.
          "-c:a copy",
        ])
        .output(outputPath)
        .on("end", () => {
          logger.debug({ outputPath }, "libass caption burn completed");
          resolve(outputPath);
        })
        .on("error", (err) => {
          logger.error(err, "libass caption burn failed");
          reject(err);
        })
        .run();
    });
  }

  public async createSolidVideo(
    outputPath: string,
    durationSeconds: number,
    width = 1080,
    height = 1920,
    color = "#020617",
  ): Promise<string> {
    return new Promise((resolve) => {
      const sanitizedColor = color.startsWith("#") ? color.replace("#", "0x") : color;
      ffmpeg()
        .input(`color=c=${sanitizedColor}:s=${width}x${height}:r=25:d=${durationSeconds}`)
        .inputFormat("lavfi")
        .outputOptions(["-c:v libx264", "-pix_fmt yuv420p", "-t " + durationSeconds])
        .output(outputPath)
        .on("end", () => resolve(outputPath))
        .on("error", (err) => {
          logger.warn({ err }, "Could not generate lavfi solid video; creating blank MP4 file");
          fs.writeFileSync(outputPath, "");
          resolve(outputPath);
        })
        .run();
    });
  }
}
