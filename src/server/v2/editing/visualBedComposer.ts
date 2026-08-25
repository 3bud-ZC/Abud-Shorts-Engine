import { spawn } from "child_process";
import fs from "fs-extra";
import path from "path";
import { logger } from "../../../logger";
import { renderMockupSvg, type MockupPalette, type MockupTemplateId } from "../mockups/websiteMockupRenderer";
import { buildSmartCropFilter, type SmartCropPlan } from "../media-intelligence/smartCrop";
import type { VisualShot } from "./editDecisionList";

/**
 * VISUAL BED COMPOSER
 * -------------------
 * Turns the shot plan into the picture track for one narration scene.
 *
 * The narration, its captions and its audio stay whole; only the visuals are
 * cut. That is what lets three narration scenes carry six or more visual shots
 * without touching the timing of a single spoken word.
 *
 * Each sub-shot is normalized to the same resolution, frame rate and pixel
 * format before concatenation, because the sources are deliberately mixed:
 * stock footage, programmatic mockups and solid motion cards.
 */

export type ComposeShotInput = {
  shot: VisualShot;
  /** Local file for a stock clip. Absent for a generated shot. */
  sourcePath?: string;
  /** Where to start inside the source clip. */
  sourceStartSeconds?: number;
  mockupTemplate?: MockupTemplateId;
  mockupContent?: Record<string, string | undefined>;
  mockupPalette?: Partial<MockupPalette>;
  /**
   * Reframing plan for this shot. When absent the shot falls back to the
   * deterministic centre crop, which is what every shot used to get.
   */
  cropPlan?: SmartCropPlan;
};

export type ComposeRequest = {
  shots: ComposeShotInput[];
  outputPath: string;
  width: number;
  height: number;
  fps: number;
  workDir: string;
  /** Light normalization so mixed sources do not look pasted together. */
  colorNormalize?: boolean;
};

export type ComposeResult = {
  outputPath: string;
  shotCount: number;
  composed: boolean;
  reason?: string;
};

function run(bin: string, args: string[], timeoutMs = 120000): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${bin} timed out`));
    }, timeoutMs);
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr.split("\n").slice(-6).join("\n") || `${bin} exited ${code}`));
    });
  });
}

/**
 * FFmpeg for the composer.
 *
 * This used to be `process.env.FFMPEG_PATH || "ffmpeg"`, which means a bare
 * `ffmpeg` on PATH. On a machine without one - every developer workstation here,
 * and any deployment relying on the bundled binary - every composition failed
 * with ENOENT, was caught, and fell back to the single clip. The result was a
 * multi-shot plan that silently produced one shot, which is why a graphic scene
 * still appeared to carry a base-media shot. The bundled installer is the same
 * binary the Motion Engine and FFMpeg library already use.
 */
function ffmpegBin(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const installer = require("@ffmpeg-installer/ffmpeg");
    if (installer?.path && fs.existsSync(installer.path)) return installer.path;
  } catch {
    // Falls through to whatever is on PATH.
  }
  return "ffmpeg";
}

/**
 * Scale-and-crop to the target frame without distorting the subject.
 *
 * `increase` guarantees full coverage, then the crop trims the overflow; a mild
 * curve/saturation pass keeps clips from different providers reading as one
 * piece rather than unrelated stock.
 *
 * This is the *unplanned* path: a centred window, used when no smart-crop plan
 * was produced for the shot. When a plan exists the caller passes it and
 * `buildSmartCropFilter` positions the window around the measured focal point.
 */
export function buildNormalizeFilter(
  width: number,
  height: number,
  fps: number,
  colorNormalize: boolean,
): string {
  const parts = [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}`,
    `fps=${fps}`,
    "setsar=1",
  ];
  if (colorNormalize) {
    // Deliberately gentle: this evens out exposure and saturation, it is not
    // a look or a LUT.
    parts.push("eq=contrast=1.04:brightness=0.008:saturation=1.06");
  }
  parts.push("format=yuv420p");
  return parts.join(",");
}

/** Filter chain for one stock sub-shot, honouring its crop plan when it has one. */
export function shotFilterChain(input: ComposeShotInput, request: ComposeRequest): string {
  if (input.cropPlan) {
    return buildSmartCropFilter(input.cropPlan, {
      fps: request.fps,
      colorNormalize: request.colorNormalize !== false,
    });
  }
  return buildNormalizeFilter(
    request.width,
    request.height,
    request.fps,
    request.colorNormalize !== false,
  );
}

/** Renders one mockup shot to a still, then to a clip of the right length. */
async function renderMockupShot(
  input: ComposeShotInput,
  request: ComposeRequest,
  index: number,
): Promise<string> {
  const svgPath = path.join(request.workDir, `shot_${index}.svg`);
  const clipPath = path.join(request.workDir, `shot_${index}.mp4`);
  const svg = renderMockupSvg({
    template: input.mockupTemplate as MockupTemplateId,
    width: request.width,
    height: request.height,
    content: input.mockupContent as any,
    palette: input.mockupPalette,
    progress: 1,
  });
  fs.writeFileSync(svgPath, svg, "utf8");

  // A very slow push keeps a static mockup from reading as a frozen frame.
  const zoomFrames = Math.max(1, Math.round(input.shot.duration * request.fps));
  await run(ffmpegBin(), [
    "-v", "error",
    "-loop", "1",
    "-i", svgPath,
    "-t", String(input.shot.duration),
    "-vf",
    // zoompan works on the frame it is given, so the mockup is rendered at the
    // exact output size first. Pre-scaling it larger pushed the design off the
    // edge of the frame.
    `scale=${request.width}:${request.height},zoompan=z='min(zoom+0.0005,1.05)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${zoomFrames}:s=${request.width}x${request.height}:fps=${request.fps},format=yuv420p`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-y", clipPath,
  ]);
  return clipPath;
}

/** Cuts and normalizes one stock sub-shot. */
async function renderStockShot(
  input: ComposeShotInput,
  request: ComposeRequest,
  index: number,
): Promise<string> {
  const clipPath = path.join(request.workDir, `shot_${index}.mp4`);
  await run(ffmpegBin(), [
    "-v", "error",
    "-ss", String(input.sourceStartSeconds ?? 0),
    "-i", input.sourcePath as string,
    "-t", String(input.shot.duration),
    "-an",
    "-vf", shotFilterChain(input, request),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-y", clipPath,
  ]);
  return clipPath;
}

/**
 * Composes the shot list into one clip.
 *
 * Returns `composed: false` (rather than throwing) whenever the plan cannot be
 * honoured, so the caller keeps the single-clip behaviour instead of losing the
 * scene.
 */
export async function composeVisualBed(request: ComposeRequest): Promise<ComposeResult> {
  const usable = request.shots.filter(
    (input) => input.sourcePath || input.mockupTemplate,
  );
  if (usable.length === 0) {
    return { outputPath: request.outputPath, shotCount: 0, composed: false, reason: "no_usable_shots" };
  }
  if (usable.length === 1 && usable[0].sourcePath && !usable[0].mockupTemplate) {
    // Nothing to concatenate; let the caller use the clip directly.
    return { outputPath: request.outputPath, shotCount: 1, composed: false, reason: "single_shot" };
  }

  fs.ensureDirSync(request.workDir);
  const clipPaths: string[] = [];

  try {
    for (let index = 0; index < usable.length; index++) {
      const input = usable[index];
      const clip = input.mockupTemplate
        ? await renderMockupShot(input, request, index)
        : await renderStockShot(input, request, index);
      if (fs.existsSync(clip) && fs.statSync(clip).size > 0) clipPaths.push(clip);
    }

    if (clipPaths.length === 0) {
      return { outputPath: request.outputPath, shotCount: 0, composed: false, reason: "all_shots_failed" };
    }

    const listPath = path.join(request.workDir, "concat.txt");
    fs.writeFileSync(
      listPath,
      clipPaths.map((clip) => `file '${clip.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"),
      "utf8",
    );

    // Every part was encoded with identical parameters above, so the concat
    // demuxer can stream-copy them together.
    await run(ffmpegBin(), [
      "-v", "error",
      "-f", "concat",
      "-safe", "0",
      "-i", listPath,
      "-c", "copy",
      "-y", request.outputPath,
    ]);

    return { outputPath: request.outputPath, shotCount: clipPaths.length, composed: true };
  } catch (error) {
    logger.warn({ err: String(error) }, "Visual bed composition failed; falling back to a single clip");
    return {
      outputPath: request.outputPath,
      shotCount: clipPaths.length,
      composed: false,
      reason: String(error),
    };
  } finally {
    clipPaths.forEach((clip) => {
      if (fs.existsSync(clip)) fs.removeSync(clip);
    });
    const listPath = path.join(request.workDir, "concat.txt");
    if (fs.existsSync(listPath)) fs.removeSync(listPath);
    request.shots.forEach((_, index) => {
      const svgPath = path.join(request.workDir, `shot_${index}.svg`);
      if (fs.existsSync(svgPath)) fs.removeSync(svgPath);
    });
  }
}
