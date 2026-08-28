import crypto from "crypto";
import fs from "fs-extra";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import cuid from "cuid";
import { capabilityManager } from "../capabilities/capabilityManager";

export type SceneBoundary = {
  sceneNumber: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  score?: number;
};

export type SceneAnalysisResult = {
  sourceDurationSeconds: number;
  detectedScenes: SceneBoundary[];
  chosenWindow: {
    startSeconds: number;
    endSeconds: number;
    durationSeconds: number;
  };
  reason: string;
};

export type BackgroundRemovalResult = {
  artifactId: string;
  relativePath: string;
  absolutePath: string;
  inputChecksum: string;
  outputChecksum: string;
  width: number;
  height: number;
  processingDurationMs: number;
};

export type ImageUpscaleResult = {
  artifactId: string;
  relativePath: string;
  absolutePath: string;
  inputChecksum: string;
  outputChecksum: string;
  width: number;
  height: number;
  processingDurationMs: number;
};

export type BeatMap = {
  bpm: number;
  beatTimestamps: number[];
  energyEnvelope: number[];
  durationSeconds: number;
  artifactId: string;
};

export type CreativeQualityInput = {
  deadAirDurationMs: number;
  maxNarrationSilenceMs: number;
  totalDurationSeconds: number;
  sceneCount: number;
  distinctAssetCount: number;
  fallbackCount: number;
  genericFallbackCount?: number;
  hasCta?: boolean;
  captionStyle?: string;
  hasCaptions?: boolean;
  mediaRelevanceScores?: number[];
  realVisualCoveragePercent?: number;
  textOnlyTimelinePercent?: number;
  blackFramePercent?: number;
  duplicateAssetCount?: number;
  promptLeakCount?: number;
  inventedClaimRiskCount?: number;
};

export type CreativeQualityDiagnostics = {
  audioContinuityScore: number;
  visualDiversityScore: number;
  mediaRelevanceScore: number;
  realVisualCoverageScore: number;
  textOnlyScore: number;
  blackFrameScore: number;
  fallbackScore: number;
  captionLegibilityScore: number;
  maxNarrationSilenceMs: number;
  duplicateAssetRatio: number;
  visualDiversityRatio: number;
};

export type CreativeQualityResult = {
  creativeScore: number;
  creativeGrade: "A" | "B" | "C" | "D" | "F";
  diagnostics: CreativeQualityDiagnostics;
  warnings: string[];
  issues: string[];
};

export class QualityEngine {
  private baseDataDir: string;

  constructor() {
    this.baseDataDir = process.env.DATA_DIR_PATH
      ? path.resolve(process.env.DATA_DIR_PATH)
      : path.resolve(process.cwd(), "data-dev");
  }

  public calculateCreativeQualityScore(input: CreativeQualityInput): CreativeQualityResult {
    const warnings: string[] = [];
    const issues: string[] = [];

    // 1. Audio Continuity & Dead-Air Score (Weight: 30%)
    let audioContinuityScore = 100;
    if (input.maxNarrationSilenceMs > 1500) {
      audioContinuityScore = Math.max(20, 100 - Math.round((input.maxNarrationSilenceMs - 1500) / 25) - 40);
      issues.push(`Accidental dead-air detected: max gap of ${input.maxNarrationSilenceMs}ms between scenes`);
    } else if (input.maxNarrationSilenceMs > 600) {
      audioContinuityScore = Math.max(60, 100 - Math.round((input.maxNarrationSilenceMs - 600) / 25));
      warnings.push(`Noticeable silence gap of ${input.maxNarrationSilenceMs}ms between narration scenes`);
    }

    // 2. Visual Diversity & Duplicate Asset Score (Weight: 25%)
    const sceneCount = Math.max(1, input.sceneCount);
    const distinctAssets = Math.max(1, Math.min(sceneCount, input.distinctAssetCount));
    const duplicateAssetRatio = sceneCount > 1 ? (sceneCount - distinctAssets) / sceneCount : 0;
    let visualDiversityScore = Math.round(100 - duplicateAssetRatio * 70);
    if (duplicateAssetRatio > 0.35) {
      warnings.push(`High visual repetition: ${sceneCount - distinctAssets} duplicated visual shots`);
    }

    // 3. Media Relevance Score (Weight: 20%)
    let mediaRelevanceScore = 90;
    if (input.mediaRelevanceScores && input.mediaRelevanceScores.length > 0) {
      const avg = input.mediaRelevanceScores.reduce((a, b) => a + b, 0) / input.mediaRelevanceScores.length;
      mediaRelevanceScore = Math.round(Math.max(30, Math.min(100, avg)));
    } else if ((input.genericFallbackCount ?? 0) > 0) {
      mediaRelevanceScore = Math.max(50, 90 - (input.genericFallbackCount ?? 0) * 15);
      warnings.push("Generic fallback queries used for one or more scenes");
    }

    const realVisualCoverageScore = input.realVisualCoveragePercent === undefined
      ? 90
      : Math.max(0, Math.min(100, Math.round(input.realVisualCoveragePercent)));
    if (realVisualCoverageScore < 90) {
      issues.push(`Real visual coverage below professional target: ${realVisualCoverageScore}%`);
    }

    const textOnlyPercent = input.textOnlyTimelinePercent ?? 0;
    const textOnlyScore = Math.max(0, Math.min(100, Math.round(100 - Math.max(0, textOnlyPercent - 10) * 4)));
    if (textOnlyPercent > 10) {
      issues.push(`Text-only timeline exceeds professional target: ${textOnlyPercent}%`);
    }

    const blackFramePercent = input.blackFramePercent ?? 0;
    const blackFrameScore = Math.max(0, Math.min(100, Math.round(100 - blackFramePercent * 25)));
    if (blackFramePercent > 1) {
      issues.push(`Black-frame percentage is high: ${blackFramePercent}%`);
    }

    if ((input.promptLeakCount || 0) > 0) {
      issues.push(`Raw prompt leakage detected: ${input.promptLeakCount}`);
    }
    if ((input.inventedClaimRiskCount || 0) > 0) {
      issues.push(`Invented claim risk detected: ${input.inventedClaimRiskCount}`);
    }

    // 4. Fallback Penalty Score (Weight: 15%)
    const fallbackCount = input.fallbackCount || 0;
    const genericCount = input.genericFallbackCount || 0;
    const fallbackScore = Math.max(30, 100 - fallbackCount * 12 - genericCount * 18);
    if (fallbackCount > 0) {
      warnings.push(`${fallbackCount} visual fallback(s) encountered during production`);
    }

    // 5. Caption Legibility Score (Weight: 10%)
    let captionLegibilityScore = 100;
    if (input.hasCaptions === false || input.captionStyle === "none") {
      captionLegibilityScore = 100; // Intentionally suppressed
    } else if (input.captionStyle === "legacy_cairo") {
      captionLegibilityScore = 85;
    }

    const creativeScore = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          audioContinuityScore * 0.18 +
          visualDiversityScore * 0.14 +
          mediaRelevanceScore * 0.16 +
          realVisualCoverageScore * 0.20 +
          textOnlyScore * 0.10 +
          blackFrameScore * 0.10 +
          fallbackScore * 0.07 +
          captionLegibilityScore * 0.05 -
          (input.promptLeakCount || 0) * 25 -
          (input.inventedClaimRiskCount || 0) * 20,
        ),
      ),
    );

    let creativeGrade: CreativeQualityResult["creativeGrade"] = "A";
    if (creativeScore < 60) creativeGrade = "F";
    else if (creativeScore < 70) creativeGrade = "D";
    else if (creativeScore < 80) creativeGrade = "C";
    else if (creativeScore < 90) creativeGrade = "B";

    return {
      creativeScore,
      creativeGrade,
      diagnostics: {
        audioContinuityScore,
        visualDiversityScore,
        mediaRelevanceScore,
        realVisualCoverageScore,
        textOnlyScore,
        blackFrameScore,
        fallbackScore,
        captionLegibilityScore,
        maxNarrationSilenceMs: input.maxNarrationSilenceMs,
        duplicateAssetRatio,
        visualDiversityRatio: Math.round((1 - duplicateAssetRatio) * 100) / 100,
      },
      warnings,
      issues,
    };
  }

  private resolveSafePath(relativeOrAbsolutePath: string): string {
    const raw = String(relativeOrAbsolutePath || "").trim();
    if (!raw) throw new Error("File path is required");

    let resolved = path.isAbsolute(raw)
      ? path.resolve(raw)
      : path.resolve(this.baseDataDir, raw);

    // Also allow if it is inside cwd or os tmp directory
    const cwd = path.resolve(process.cwd());
    const osTmp = path.resolve(os.tmpdir());
    const isUnderData = resolved.startsWith(this.baseDataDir);
    const isUnderCwd = resolved.startsWith(cwd);
    const isUnderTmp = resolved.startsWith(osTmp);

    if (!isUnderData && !isUnderCwd && !isUnderTmp) {
      throw new Error(`Path security violation: ${raw} is outside authorized directories`);
    }

    if (!fs.existsSync(resolved)) {
      throw new Error(`File not found: ${raw}`);
    }

    return resolved;
  }

  private getPythonBin(): string {
    const bin = capabilityManager.getQualityPythonPath();
    if (!bin) {
      throw new Error("Quality Python runtime not found. Install QUALITY_CPU pack or configure QUALITY_PYTHON_BIN.");
    }
    return bin;
  }

  public async analyzeScenes(videoPath: string, targetDurationSeconds = 5.0): Promise<SceneAnalysisResult> {
    const safeVideoPath = this.resolveSafePath(videoPath);
    const pythonBin = this.getPythonBin();

    const script = `
import sys, json
import scenedetect
from scenedetect import open_video, SceneManager
from scenedetect.detectors import ContentDetector

video_path = sys.argv[1]
target_dur = float(sys.argv[2])

video = open_video(video_path)
scene_manager = SceneManager()
scene_manager.add_detector(ContentDetector(threshold=27.0))
scene_manager.detect_scenes(video, show_progress=False)
scene_list = scene_manager.get_scene_list()

total_dur = video.duration.get_seconds()

scenes = []
for i, (start, end) in enumerate(scene_list):
    scenes.append({
        "sceneNumber": i + 1,
        "startSeconds": start.get_seconds(),
        "endSeconds": end.get_seconds(),
        "durationSeconds": (end - start).get_seconds()
    })

# If no cuts detected, treat whole video as single scene
if not scenes:
    scenes.append({
        "sceneNumber": 1,
        "startSeconds": 0.0,
        "endSeconds": total_dur,
        "durationSeconds": total_dur
    })

# Choose the best segment window
# Prefer a scene with duration >= target_dur or the longest stable middle scene
chosen = None
reason = "Default middle window"

# Find longest scene
longest = max(scenes, key=lambda s: s["durationSeconds"])
if longest["durationSeconds"] >= target_dur:
    # Pick stable middle of this scene
    start_s = longest["startSeconds"] + max(0.0, (longest["durationSeconds"] - target_dur) / 2.0)
    chosen = {
        "startSeconds": round(start_s, 2),
        "endSeconds": round(min(total_dur, start_s + target_dur), 2),
        "durationSeconds": round(min(target_dur, longest["durationSeconds"]), 2)
    }
    reason = f"Selected optimal center segment from scene {longest['sceneNumber']} (length {longest['durationSeconds']:.1f}s)"
else:
    # Start at first stable frame avoiding initial freeze/fade
    start_s = min(max(0.5, total_dur * 0.1), max(0.0, total_dur - target_dur))
    chosen = {
        "startSeconds": round(start_s, 2),
        "endSeconds": round(min(total_dur, start_s + target_dur), 2),
        "durationSeconds": round(min(target_dur, total_dur - start_s), 2)
    }
    reason = f"Extracted {target_dur}s window across {len(scenes)} detected cuts with smooth boundary avoidance"

out = {
    "sourceDurationSeconds": round(total_dur, 2),
    "detectedScenes": scenes,
    "chosenWindow": chosen,
    "reason": reason
}
print(json.dumps(out))
`;

    return new Promise((resolve, reject) => {
      execFile(
        pythonBin,
        ["-c", script, safeVideoPath, String(targetDurationSeconds)],
        { timeout: 30000, windowsHide: true, maxBuffer: 1024 * 1024 * 5 },
        (err, stdout, stderr) => {
          if (err) {
            reject(new Error(`PySceneDetect analysis failed: ${stderr || err.message}`));
            return;
          }
          try {
            const parsed = JSON.parse(stdout.trim().split("\n").pop() || "{}");
            resolve(parsed);
          } catch (pe) {
            reject(new Error(`Failed to parse PySceneDetect output: ${stdout}`));
          }
        },
      );
    });
  }

  public async removeBackground(imagePath: string): Promise<BackgroundRemovalResult> {
    const safeImagePath = this.resolveSafePath(imagePath);
    const pythonBin = this.getPythonBin();

    const inputBuffer = await fs.readFile(safeImagePath);
    const inputChecksum = crypto.createHash("sha256").update(inputBuffer).digest("hex");

    const artifactsDir = path.join(this.baseDataDir, "artifacts", "rembg");
    await fs.ensureDir(artifactsDir);

    const artifactId = `rembg_${cuid()}`;
    const outputFilename = `${artifactId}.png`;
    const outputPath = path.join(artifactsDir, outputFilename);

    const script = `
import sys, time, json
from PIL import Image
import rembg

in_path = sys.argv[1]
out_path = sys.argv[2]

t0 = time.time()
with open(in_path, "rb") as f:
    input_bytes = f.read()

session = rembg.new_session("u2netp")
output_bytes = rembg.remove(input_bytes, session=session)

with open(out_path, "wb") as f:
    f.write(output_bytes)

dt_ms = int((time.time() - t0) * 1000)
img = Image.open(out_path)
w, h = img.size

out = {
    "width": w,
    "height": h,
    "processingDurationMs": dt_ms
}
print(json.dumps(out))
`;

    return new Promise((resolve, reject) => {
      execFile(
        pythonBin,
        ["-c", script, safeImagePath, outputPath],
        { timeout: 45000, windowsHide: true, maxBuffer: 1024 * 1024 * 5 },
        async (err, stdout, stderr) => {
          if (err) {
            reject(new Error(`rembg background removal failed: ${stderr || err.message}`));
            return;
          }
          try {
            const parsed = JSON.parse(stdout.trim().split("\n").pop() || "{}");
            const outputBuffer = await fs.readFile(outputPath);
            const outputChecksum = crypto.createHash("sha256").update(outputBuffer).digest("hex");

            const relativePath = path.relative(this.baseDataDir, outputPath).replace(/\\/g, "/");

            resolve({
              artifactId,
              relativePath,
              absolutePath: outputPath,
              inputChecksum,
              outputChecksum,
              width: parsed.width,
              height: parsed.height,
              processingDurationMs: parsed.processingDurationMs,
            });
          } catch (pe) {
            reject(new Error(`Failed to parse rembg output: ${stdout}`));
          }
        },
      );
    });
  }

  public async upscaleImage(imagePath: string, minWidth = 1080): Promise<ImageUpscaleResult> {
    const safeImagePath = this.resolveSafePath(imagePath);
    const pythonBin = this.getPythonBin();

    const inputBuffer = await fs.readFile(safeImagePath);
    const inputChecksum = crypto.createHash("sha256").update(inputBuffer).digest("hex");

    const artifactsDir = path.join(this.baseDataDir, "artifacts", "upscale");
    await fs.ensureDir(artifactsDir);

    const artifactId = `upscale_${cuid()}`;
    const outputFilename = `${artifactId}.png`;
    const outputPath = path.join(artifactsDir, outputFilename);

    const script = `
import sys, time, json
from PIL import Image, ImageFilter

in_path = sys.argv[1]
out_path = sys.argv[2]
min_w = int(sys.argv[3])

t0 = time.time()
img = Image.open(in_path)
w, h = img.size

if w < min_w:
    scale = min_w / float(w)
    new_w = min_w
    new_h = int(h * scale)
    # High-quality Lanczos resampling with subtle unsharp mask
    enhanced = img.resize((new_w, new_h), resample=Image.Resampling.LANCZOS)
    enhanced = enhanced.filter(ImageFilter.UnsharpMask(radius=1.2, percent=110, threshold=3))
else:
    enhanced = img

enhanced.save(out_path, "PNG")
dt_ms = int((time.time() - t0) * 1000)

out = {
    "width": enhanced.width,
    "height": enhanced.height,
    "processingDurationMs": dt_ms
}
print(json.dumps(out))
`;

    return new Promise((resolve, reject) => {
      execFile(
        pythonBin,
        ["-c", script, safeImagePath, outputPath, String(minWidth)],
        { timeout: 30000, windowsHide: true, maxBuffer: 1024 * 1024 * 5 },
        async (err, stdout, stderr) => {
          if (err) {
            reject(new Error(`Image upscale failed: ${stderr || err.message}`));
            return;
          }
          try {
            const parsed = JSON.parse(stdout.trim().split("\n").pop() || "{}");
            const outputBuffer = await fs.readFile(outputPath);
            const outputChecksum = crypto.createHash("sha256").update(outputBuffer).digest("hex");
            const relativePath = path.relative(this.baseDataDir, outputPath).replace(/\\/g, "/");

            resolve({
              artifactId,
              relativePath,
              absolutePath: outputPath,
              inputChecksum,
              outputChecksum,
              width: parsed.width,
              height: parsed.height,
              processingDurationMs: parsed.processingDurationMs,
            });
          } catch (pe) {
            reject(new Error(`Failed to parse upscale output: ${stdout}`));
          }
        },
      );
    });
  }

  public async analyzeBeats(audioPath: string): Promise<BeatMap> {
    const safeAudioPath = this.resolveSafePath(audioPath);
    const pythonBin = this.getPythonBin();

    const artifactsDir = path.join(this.baseDataDir, "artifacts", "beats");
    await fs.ensureDir(artifactsDir);

    const artifactId = `beats_${cuid()}`;
    const artifactPath = path.join(artifactsDir, `${artifactId}.json`);

    const script = `
import sys, json
import librosa
import numpy as np

audio_path = sys.argv[1]

# Load audio up to 60s
y, sr = librosa.load(audio_path, sr=22050, duration=60.0)
duration = float(librosa.get_duration(y=y, sr=sr))

# Compute tempo & beats
tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
beat_times = librosa.frames_to_time(beat_frames, sr=sr).tolist()

# Compute RMS energy envelope (sampled every 100ms)
hop_length = int(sr * 0.1)
rms = librosa.feature.rms(y=y, hop_length=hop_length)[0]
# Normalize 0..1
if np.max(rms) > 0:
    rms_norm = (rms / np.max(rms)).round(3).tolist()
else:
    rms_norm = [0.5] * len(rms)

bpm = float(tempo[0]) if hasattr(tempo, '__len__') else float(tempo)

out = {
    "bpm": round(bpm, 1),
    "beatTimestamps": [round(t, 3) for t in beat_times],
    "energyEnvelope": rms_norm[:600],
    "durationSeconds": round(duration, 2)
}
print(json.dumps(out))
`;

    return new Promise((resolve, reject) => {
      execFile(
        pythonBin,
        ["-c", script, safeAudioPath],
        { timeout: 35000, windowsHide: true, maxBuffer: 1024 * 1024 * 5 },
        async (err, stdout, stderr) => {
          if (err) {
            reject(new Error(`librosa beat analysis failed: ${stderr || err.message}`));
            return;
          }
          try {
            const parsed = JSON.parse(stdout.trim().split("\n").pop() || "{}");
            const beatMap: BeatMap = {
              bpm: parsed.bpm,
              beatTimestamps: parsed.beatTimestamps || [],
              energyEnvelope: parsed.energyEnvelope || [],
              durationSeconds: parsed.durationSeconds,
              artifactId,
            };

            await fs.writeJson(artifactPath, beatMap, { spaces: 2 });
            resolve(beatMap);
          } catch (pe) {
            reject(new Error(`Failed to parse beat analysis output: ${stdout}`));
          }
        },
      );
    });
  }
}

export const qualityEngine = new QualityEngine();
