import { spawn } from "child_process";
import fs from "fs-extra";
import path from "path";
import { logger } from "../../../logger";

/**
 * PYSCENEDETECT ADAPTER
 * ---------------------
 * Downloaded stock clips frequently open on a logo card, a slow fade or a
 * second of unrelated footage. Taking the first N seconds - which is what the
 * rejected build did - therefore often picks the worst part of the clip.
 *
 * This runs PySceneDetect's AdaptiveDetector over the asset, then picks the
 * longest interior shot as the usable window.
 *
 * The runtime is optional. When it is absent every function here degrades to a
 * deterministic fallback and the caller carries on.
 */

export type DetectedShot = { startSeconds: number; endSeconds: number; durationSeconds: number };

export type SceneDetectionResult = {
  available: boolean;
  shots: DetectedShot[];
  /** How the result was produced, recorded in job metadata. */
  source: "pyscenedetect" | "fallback";
  error?: string;
};

const DETECT_SCRIPT = `
import json, sys
try:
    from scenedetect import open_video, SceneManager
    from scenedetect.detectors import AdaptiveDetector
except Exception as exc:  # runtime not installed
    print(json.dumps({"available": False, "error": str(exc)}))
    sys.exit(0)

try:
    video = open_video(sys.argv[1])
    manager = SceneManager()
    # AdaptiveDetector handles camera motion and gradual lighting changes far
    # better than a fixed content threshold on stock footage.
    manager.add_detector(AdaptiveDetector())
    manager.detect_scenes(video, show_progress=False)
    scenes = manager.get_scene_list()
    shots = [
        {
            "startSeconds": round(start.get_seconds(), 3),
            "endSeconds": round(end.get_seconds(), 3),
            "durationSeconds": round(end.get_seconds() - start.get_seconds(), 3),
        }
        for start, end in scenes
    ]
    print(json.dumps({"available": True, "shots": shots}))
except Exception as exc:
    print(json.dumps({"available": False, "error": str(exc)}))
`;

function pythonBin(): string {
  return process.env.PYTHON_BIN || "python3";
}

export function isSceneDetectionEnabled(): boolean {
  return process.env.SCENE_DETECTION_ENABLED === "true";
}

/** Runs the detector. Never throws: failure becomes `available: false`. */
export async function detectShots(
  videoPath: string,
  options: { timeoutMs?: number; scriptDir?: string } = {},
): Promise<SceneDetectionResult> {
  if (!isSceneDetectionEnabled()) {
    return { available: false, shots: [], source: "fallback", error: "scene_detection_disabled" };
  }
  if (!fs.existsSync(videoPath)) {
    return { available: false, shots: [], source: "fallback", error: "video_missing" };
  }

  const scriptDir = options.scriptDir || path.dirname(videoPath);
  const scriptPath = path.join(scriptDir, `.scenedetect_${path.basename(videoPath)}.py`);

  try {
    fs.writeFileSync(scriptPath, DETECT_SCRIPT, "utf8");
    const raw = await new Promise<string>((resolve, reject) => {
      const child = spawn(pythonBin(), [scriptPath, videoPath], { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("scene detection timed out"));
      }, options.timeoutMs ?? 90000);
      child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
      child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on("close", () => {
        clearTimeout(timer);
        if (!stdout.trim()) reject(new Error(stderr.trim() || "no scene detection output"));
        else resolve(stdout);
      });
    });

    const parsed = JSON.parse(raw.trim().split("\n").pop() || "{}");
    if (!parsed.available) {
      return { available: false, shots: [], source: "fallback", error: parsed.error };
    }
    return { available: true, shots: parsed.shots || [], source: "pyscenedetect" };
  } catch (error) {
    logger.warn({ err: String(error), videoPath }, "Scene detection unavailable; using deterministic window");
    return { available: false, shots: [], source: "fallback", error: String(error) };
  } finally {
    if (fs.existsSync(scriptPath)) fs.removeSync(scriptPath);
  }
}

/**
 * Chooses the window to actually use from a clip.
 *
 * Prefers the longest shot that is not the very first or very last of the clip,
 * because those are where logo cards, fades and dead frames live. Falls back to
 * a centred window when detection produced nothing usable, which is still
 * better than starting at zero.
 */
export function selectBestWindow(
  result: SceneDetectionResult,
  clipDurationSeconds: number,
  neededSeconds: number,
): { startSeconds: number; durationSeconds: number; reason: string } {
  const needed = Math.min(neededSeconds, Math.max(0.5, clipDurationSeconds));

  const usable = result.shots.filter((shot) => shot.durationSeconds >= needed);
  if (usable.length > 0) {
    const interior = usable.filter(
      (shot) => shot.startSeconds > 0.35 && shot.endSeconds < clipDurationSeconds - 0.2,
    );
    const pool = interior.length > 0 ? interior : usable;
    const best = pool.reduce((a, b) => (b.durationSeconds > a.durationSeconds ? b : a));
    // Sit slightly inside the shot so the cut itself is never on screen.
    const pad = Math.min(0.25, Math.max(0, (best.durationSeconds - needed) / 2));
    return {
      startSeconds: Number((best.startSeconds + pad).toFixed(3)),
      durationSeconds: Number(needed.toFixed(3)),
      reason: interior.length > 0 ? "interior_shot" : "longest_shot",
    };
  }

  // No detected shot is long enough: centre the window and skip any intro.
  const skipIntro = Math.min(0.6, clipDurationSeconds * 0.08);
  const centred = Math.max(skipIntro, (clipDurationSeconds - needed) / 2);
  const startSeconds = Math.max(0, Math.min(centred, Math.max(0, clipDurationSeconds - needed)));
  return {
    startSeconds: Number(startSeconds.toFixed(3)),
    durationSeconds: Number(needed.toFixed(3)),
    reason: result.available ? "no_shot_long_enough" : "detection_unavailable",
  };
}
