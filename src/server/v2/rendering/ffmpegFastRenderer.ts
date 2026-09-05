import { spawn } from "child_process";
import fs from "fs-extra";
import path from "path";
import { logger } from "../../../logger";

export type FastRenderClip = {
  path: string;
  durationSeconds: number;
  transition?: string;
};

export type FastRenderVoice = {
  path: string;
  durationSeconds: number;
};

export type FfmpegFastRenderRequest = {
  clips: FastRenderClip[];
  voices: FastRenderVoice[];
  outputPath: string;
  width: number;
  height: number;
  fps: number;
  totalDurationSeconds: number;
  musicPath?: string;
  captionsAssPath?: string;
  fontsDir?: string;
  ffmpegPath?: string;
};

export type FfmpegFastRenderPlan = {
  args: string[];
  filterComplex: string;
  videoClipCount: number;
  voiceClipCount: number;
  hasMusic: boolean;
  hasCaptions: boolean;
};

export type FfmpegFastRenderResult = {
  outputPath: string;
  compositionMs: number;
  finalEncodeMs: number;
  videoClipCount: number;
  voiceClipCount: number;
  framesThroughRemotion: number;
};

function ffmpegBin(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const installer = require("@ffmpeg-installer/ffmpeg");
    if (installer?.path && fs.existsSync(installer.path)) return installer.path;
  } catch {
    // Fall through to PATH.
  }
  return "ffmpeg";
}

function escapeFilterPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

function normalizeFilter(width: number, height: number, fps: number): string {
  return [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}`,
    `fps=${fps}`,
    "setsar=1",
    "format=yuv420p",
  ].join(",");
}

export function buildFfmpegFastRenderPlan(request: FfmpegFastRenderRequest): FfmpegFastRenderPlan {
  if (request.clips.length === 0) throw new Error("FFmpeg fast render requires at least one video clip.");
  if (request.voices.length === 0) throw new Error("FFmpeg fast render requires at least one voice clip.");

  const args = ["-y", "-v", "error"];
  request.clips.forEach((clip) => {
    args.push("-i", clip.path);
  });
  request.voices.forEach((voice) => {
    args.push("-i", voice.path);
  });
  const musicInputIndex = request.musicPath ? request.clips.length + request.voices.length : -1;
  if (request.musicPath) {
    args.push("-i", request.musicPath);
  }

  const filters: string[] = [];
  request.clips.forEach((clip, index) => {
    const duration = Math.max(0.1, clip.durationSeconds);
    filters.push(
      `[${index}:v]trim=0:${duration.toFixed(3)},setpts=PTS-STARTPTS,${normalizeFilter(request.width, request.height, request.fps)}[v${index}]`,
    );
  });
  const videoInputs = request.clips.map((_, index) => `[v${index}]`).join("");
  filters.push(`${videoInputs}concat=n=${request.clips.length}:v=1:a=0[vcat]`);

  const videoOut = request.captionsAssPath ? "vcap" : "vout";
  if (request.captionsAssPath) {
    const ass = escapeFilterPath(request.captionsAssPath);
    const fonts = request.fontsDir ? `:fontsdir='${escapeFilterPath(request.fontsDir)}'` : "";
    filters.push(`[vcat]ass='${ass}'${fonts},format=yuv420p[${videoOut}]`);
  } else {
    filters.push("[vcat]format=yuv420p[vout]");
  }

  request.voices.forEach((voice, index) => {
    const inputIndex = request.clips.length + index;
    const duration = Math.max(0.1, voice.durationSeconds);
    filters.push(
      `[${inputIndex}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=0:${duration.toFixed(3)},asetpts=PTS-STARTPTS[a${index}]`,
    );
  });
  const audioInputs = request.voices.map((_, index) => `[a${index}]`).join("");
  filters.push(`${audioInputs}concat=n=${request.voices.length}:v=0:a=1[voicecat]`);

  const audioMaster = "highpass=f=40,acompressor=threshold=-20dB:ratio=2.5:attack=12:release=180:makeup=1,loudnorm=I=-16:TP=-1.5:LRA=11,alimiter=limit=0.95";
  if (request.musicPath) {
    filters.push(`[${musicInputIndex}:a]atrim=0:${request.totalDurationSeconds.toFixed(3)},asetpts=PTS-STARTPTS,volume=0.18[music]`);
    filters.push(`[voicecat][music]amix=inputs=2:duration=first:dropout_transition=0,${audioMaster}[aout]`);
  } else {
    filters.push(`[voicecat]${audioMaster}[aout]`);
  }

  const filterComplex = filters.join(";");
  args.push(
    "-filter_complex", filterComplex,
    "-map", `[${videoOut}]`,
    "-map", "[aout]",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    "-t", request.totalDurationSeconds.toFixed(3),
    request.outputPath,
  );

  return {
    args,
    filterComplex,
    videoClipCount: request.clips.length,
    voiceClipCount: request.voices.length,
    hasMusic: Boolean(request.musicPath),
    hasCaptions: Boolean(request.captionsAssPath),
  };
}

export async function renderFfmpegFast(request: FfmpegFastRenderRequest): Promise<FfmpegFastRenderResult> {
  fs.ensureDirSync(path.dirname(request.outputPath));
  const startedAt = Date.now();
  const plan = buildFfmpegFastRenderPlan(request);
  const bin = request.ffmpegPath || ffmpegBin();

  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, plan.args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.split("\n").slice(-8).join("\n") || `${bin} exited ${code}`));
      }
    });
  });

  const elapsed = Date.now() - startedAt;
  logger.info(
    { outputPath: request.outputPath, elapsed, videoClipCount: plan.videoClipCount },
    "FFmpeg fast render completed",
  );
  return {
    outputPath: request.outputPath,
    compositionMs: elapsed,
    finalEncodeMs: elapsed,
    videoClipCount: plan.videoClipCount,
    voiceClipCount: plan.voiceClipCount,
    framesThroughRemotion: 0,
  };
}
