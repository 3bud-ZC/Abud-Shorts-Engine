import { execFile } from "child_process";
import fs from "fs-extra";
import { logger } from "../../../logger";
import { capabilityManager } from "../capabilities/capabilityManager";

/**
 * SMART CROP
 * ----------
 * Reframing a source clip into the delivery aspect ratio without distorting it
 * and without cutting away the part a viewer is actually looking at.
 *
 * Before F2.1 the only reframing in the engine was `crop=W:H` in the visual bed
 * composer, which is an unconditional centre crop, plus an `estimatePortraitCrop`
 * guess whose result was recorded in metadata and then never used by any filter.
 * A landscape interview clip in a 9:16 production therefore lost whichever half
 * of the frame the speaker happened to be standing in.
 *
 * The decision lives in one deterministic planner and is applied in the FFmpeg
 * filter chain. No ML model is installed: the signals are the ones this engine
 * already has - source geometry, the delivery target, an OpenCV motion/detail
 * probe when the QUALITY_CPU runtime is present, provider tags, and any manually
 * supplied focal point.
 *
 * Guarantees, in the order they matter:
 *  1. No distortion. The source is always scaled with its aspect ratio locked
 *     and then cropped; it is never stretched to fit.
 *  2. No off-frame subject when a focal signal exists and is trusted.
 *  3. No jitter. A crop centre may only move a bounded amount between
 *     consecutive shots, so successive shots do not swim.
 *  4. A safe centre crop whenever nothing better is known.
 */

export type CropMode =
  /** Source already matches the target ratio closely enough to fill it. */
  | "native_fit"
  /** Cropped around a focal point derived from real signals. */
  | "focal_crop"
  /** Deterministic centre crop: the guaranteed-safe fallback. */
  | "center_crop";

export type FocalSignalId =
  | "manual_focal_point"
  | "motion_probe"
  | "detail_probe"
  | "provider_tags"
  | "visual_intent"
  | "native_geometry"
  | "center_fallback";

export type SmartCropPlan = {
  mode: CropMode;
  /** Focal point in normalized source coordinates (0 = left/top, 1 = right/bottom). */
  xCenter: number;
  yCenter: number;
  /** Scale factor applied to the source before cropping. Always >= 1 for smaller sources. */
  scale: number;
  /** Crop window in target pixels; equals the target frame by construction. */
  cropWidth: number;
  cropHeight: number;
  /** Top-left of the crop window inside the scaled source, in pixels. */
  offsetX: number;
  offsetY: number;
  /** How much of the source's own area survives the crop, 0..1. */
  coverage: number;
  confidence: number;
  /** Which signals actually contributed. Recorded in shot metadata. */
  signals: FocalSignalId[];
  reason: string;
  /** True when the centre was pulled back toward the previous shot's centre. */
  jitterClamped: boolean;
  /** True when the focal point had to be pulled inside the frame bounds. */
  edgeClamped: boolean;
};

export type FocalProbe = {
  available: boolean;
  /** Motion-energy centroid in normalized coordinates. */
  motionX?: number;
  motionY?: number;
  /** Detail (Laplacian energy) centroid in normalized coordinates. */
  detailX?: number;
  detailY?: number;
  /** 0..1; how concentrated the energy is. Diffuse energy is not a subject. */
  concentration?: number;
  sampledFrames?: number;
  source: "opencv" | "unavailable";
  error?: string;
};

export type SmartCropRequest = {
  sourceWidth: number;
  sourceHeight: number;
  targetWidth: number;
  targetHeight: number;
  /** Provider tags, used only as a weak people-prior. */
  tags?: string[];
  visualIntent?: string;
  /** Operator-supplied focal point in normalized source coordinates. */
  manualFocalPoint?: { x: number; y: number };
  probe?: FocalProbe;
  /** Plan used by the preceding shot; enables jitter control. */
  previousPlan?: Pick<SmartCropPlan, "xCenter" | "yCenter"> | null;
};

/**
 * Largest change in normalized crop centre permitted between consecutive shots.
 * Chosen so a reframe reads as a deliberate adjustment rather than a wobble; at
 * 1080 wide this is about 65 pixels.
 */
export const MAX_CENTER_DELTA_PER_SHOT = 0.06;

/** Aspect ratios within this tolerance are treated as already matching. */
const NATIVE_FIT_TOLERANCE = 0.04;

/** Below this the probe is diffuse - a landscape, not a subject - and is ignored. */
const MIN_PROBE_CONCENTRATION = 0.28;

const PEOPLE_TAG_PATTERN =
  /\b(person|people|man|woman|owner|team|customer|face|portrait|hands|talking|interview|chef|model|worker|staff)\b/i;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Weighted blend of the available focal signals.
 *
 * The weights encode how much each signal is actually worth: a human-supplied
 * focal point is authoritative, a measured motion centroid is strong, provider
 * tags are a hint and nothing more.
 */
function resolveFocalPoint(request: SmartCropRequest): {
  x: number;
  y: number;
  confidence: number;
  signals: FocalSignalId[];
} {
  const contributions: Array<{ x: number; y: number; weight: number; signal: FocalSignalId }> = [];

  if (
    request.manualFocalPoint &&
    Number.isFinite(request.manualFocalPoint.x) &&
    Number.isFinite(request.manualFocalPoint.y)
  ) {
    contributions.push({
      x: clamp(request.manualFocalPoint.x, 0, 1),
      y: clamp(request.manualFocalPoint.y, 0, 1),
      weight: 6,
      signal: "manual_focal_point",
    });
  }

  const probe = request.probe;
  const concentration = probe?.concentration ?? 0;
  if (probe?.available && concentration >= MIN_PROBE_CONCENTRATION) {
    if (typeof probe.motionX === "number" && typeof probe.motionY === "number") {
      contributions.push({
        x: clamp(probe.motionX, 0, 1),
        y: clamp(probe.motionY, 0, 1),
        weight: 3 * concentration,
        signal: "motion_probe",
      });
    }
    if (typeof probe.detailX === "number" && typeof probe.detailY === "number") {
      contributions.push({
        x: clamp(probe.detailX, 0, 1),
        y: clamp(probe.detailY, 0, 1),
        weight: 1.5 * concentration,
        signal: "detail_probe",
      });
    }
  }

  // Weak priors. People are framed slightly above centre in stock footage, so a
  // people-tagged clip is cropped a little higher rather than through the chin.
  const tagText = (request.tags || []).join(" ");
  if (PEOPLE_TAG_PATTERN.test(tagText)) {
    contributions.push({ x: 0.5, y: 0.42, weight: 0.8, signal: "provider_tags" });
  }
  if (request.visualIntent === "product_hero" || request.visualIntent === "detail") {
    contributions.push({ x: 0.5, y: 0.5, weight: 0.5, signal: "visual_intent" });
  }

  if (contributions.length === 0) {
    return { x: 0.5, y: 0.5, confidence: 0.4, signals: ["center_fallback"] };
  }

  const totalWeight = contributions.reduce((sum, item) => sum + item.weight, 0);
  const x = contributions.reduce((sum, item) => sum + item.x * item.weight, 0) / totalWeight;
  const y = contributions.reduce((sum, item) => sum + item.y * item.weight, 0) / totalWeight;

  // Confidence saturates rather than growing without bound: several weak hints
  // never add up to the certainty of a measured or human-supplied point.
  const confidence = clamp(0.4 + totalWeight * 0.08, 0.4, 0.95);
  return {
    x,
    y,
    confidence: round(confidence, 3),
    signals: contributions.map((item) => item.signal),
  };
}

/**
 * Plans the reframe. Pure: identical inputs always produce an identical plan,
 * which is what allows the choice to be asserted in tests and reproduced on a
 * retry rather than guessed again.
 */
export function planSmartCrop(request: SmartCropRequest): SmartCropPlan {
  const sourceWidth = Math.max(1, Math.round(request.sourceWidth || 0));
  const sourceHeight = Math.max(1, Math.round(request.sourceHeight || 0));
  const targetWidth = Math.max(1, Math.round(request.targetWidth || 0));
  const targetHeight = Math.max(1, Math.round(request.targetHeight || 0));

  const sourceAspect = sourceWidth / sourceHeight;
  const targetAspect = targetWidth / targetHeight;

  // `increase` scaling: whichever dimension falls short after fitting decides
  // the factor, so the frame is always fully covered and never letterboxed.
  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const scaledWidth = sourceWidth * scale;
  const scaledHeight = sourceHeight * scale;
  const overflowX = Math.max(0, scaledWidth - targetWidth);
  const overflowY = Math.max(0, scaledHeight - targetHeight);
  const coverage = round((targetWidth * targetHeight) / (scaledWidth * scaledHeight), 4);

  const aspectDelta = Math.abs(sourceAspect - targetAspect) / targetAspect;
  if (aspectDelta <= NATIVE_FIT_TOLERANCE) {
    // Nothing meaningful is discarded, so there is no focal decision to make and
    // no opportunity for the crop to drift between shots.
    return {
      mode: "native_fit",
      xCenter: 0.5,
      yCenter: 0.5,
      scale: round(scale),
      cropWidth: targetWidth,
      cropHeight: targetHeight,
      offsetX: Math.round(overflowX / 2),
      offsetY: Math.round(overflowY / 2),
      coverage,
      confidence: 0.96,
      signals: ["native_geometry"],
      reason: "Source aspect already matches the delivery frame; no reframing needed",
      jitterClamped: false,
      edgeClamped: false,
    };
  }

  const focal = resolveFocalPoint(request);
  let xCenter = focal.x;
  let yCenter = focal.y;

  // Jitter control. Successive shots cut from one clip must not swing the frame
  // around, so the centre may only travel a bounded distance per shot.
  let jitterClamped = false;
  if (request.previousPlan) {
    const previousX = clamp(request.previousPlan.xCenter, 0, 1);
    const previousY = clamp(request.previousPlan.yCenter, 0, 1);
    const clampedX = clamp(
      xCenter,
      previousX - MAX_CENTER_DELTA_PER_SHOT,
      previousX + MAX_CENTER_DELTA_PER_SHOT,
    );
    const clampedY = clamp(
      yCenter,
      previousY - MAX_CENTER_DELTA_PER_SHOT,
      previousY + MAX_CENTER_DELTA_PER_SHOT,
    );
    jitterClamped = clampedX !== xCenter || clampedY !== yCenter;
    xCenter = clampedX;
    yCenter = clampedY;
  }

  // Edge control. The crop window has to stay inside the scaled source, so a
  // focal point near an edge is pulled in rather than producing a black band.
  const halfWindowX = overflowX > 0 ? targetWidth / (2 * scaledWidth) : 0.5;
  const halfWindowY = overflowY > 0 ? targetHeight / (2 * scaledHeight) : 0.5;
  const boundedX = clamp(xCenter, halfWindowX, 1 - halfWindowX);
  const boundedY = clamp(yCenter, halfWindowY, 1 - halfWindowY);
  const edgeClamped = boundedX !== xCenter || boundedY !== yCenter;
  xCenter = boundedX;
  yCenter = boundedY;

  const offsetX = Math.round(clamp(xCenter * scaledWidth - targetWidth / 2, 0, overflowX));
  const offsetY = Math.round(clamp(yCenter * scaledHeight - targetHeight / 2, 0, overflowY));

  const usedRealSignal = focal.signals.some(
    (signal) =>
      signal === "manual_focal_point" || signal === "motion_probe" || signal === "detail_probe",
  );

  return {
    mode: usedRealSignal ? "focal_crop" : "center_crop",
    xCenter: round(xCenter),
    yCenter: round(yCenter),
    scale: round(scale),
    cropWidth: targetWidth,
    cropHeight: targetHeight,
    offsetX,
    offsetY,
    coverage,
    confidence: usedRealSignal ? focal.confidence : 0.5,
    signals: focal.signals,
    reason: usedRealSignal
      ? `Reframed around a measured focal point (${focal.signals.join(", ")})`
      : "Deterministic safe centre crop; no trusted focal signal available",
    jitterClamped,
    edgeClamped,
  };
}

/**
 * The FFmpeg video filter chain for the plan.
 *
 * Aspect ratio is locked by `force_original_aspect_ratio=increase`, so the only
 * thing the plan controls is *where* the window sits - the picture itself can
 * never be squeezed.
 */
export function buildSmartCropFilter(
  plan: SmartCropPlan,
  options: { fps: number; colorNormalize?: boolean },
): string {
  const parts = [
    `scale=${plan.cropWidth}:${plan.cropHeight}:force_original_aspect_ratio=increase`,
    `crop=${plan.cropWidth}:${plan.cropHeight}:${plan.offsetX}:${plan.offsetY}`,
    `fps=${options.fps}`,
    "setsar=1",
  ];
  if (options.colorNormalize !== false) {
    // Deliberately gentle: this evens out exposure and saturation across mixed
    // providers. It is not a look and not a LUT.
    parts.push("eq=contrast=1.04:brightness=0.008:saturation=1.06");
  }
  parts.push("format=yuv420p");
  return parts.join(",");
}

const PROBE_SCRIPT = `
import json, sys
try:
    import cv2
    import numpy as np
except Exception as exc:
    print(json.dumps({"available": False, "error": str(exc)}))
    sys.exit(0)

try:
    path = sys.argv[1]
    start = float(sys.argv[2])
    window = float(sys.argv[3])
    capture = cv2.VideoCapture(path)
    if not capture.isOpened():
        print(json.dumps({"available": False, "error": "clip_unreadable"}))
        sys.exit(0)

    fps = capture.get(cv2.CAP_PROP_FPS) or 25.0
    frame_count = capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0
    duration = frame_count / fps if fps > 0 else 0.0
    if window <= 0 or window > duration:
        window = duration
    samples = 10
    step = window / float(samples) if samples else window

    grays = []
    for i in range(samples):
        capture.set(cv2.CAP_PROP_POS_MSEC, (start + i * step) * 1000.0)
        ok, frame = capture.read()
        if not ok or frame is None:
            continue
        target = (160, 90) if frame.shape[1] >= frame.shape[0] else (90, 160)
        small = cv2.resize(frame, target)
        grays.append(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY).astype("float32"))
    capture.release()

    if len(grays) < 2:
        print(json.dumps({"available": False, "error": "not_enough_frames"}))
        sys.exit(0)

    motion = np.zeros_like(grays[0])
    for a, b in zip(grays, grays[1:]):
        motion += np.abs(b - a)

    detail = np.zeros_like(grays[0])
    for g in grays:
        detail += np.abs(cv2.Laplacian(g, cv2.CV_32F))

    def centroid(field):
        total = float(field.sum())
        if total <= 1e-6:
            return 0.5, 0.5, 0.0
        h, w = field.shape
        ys, xs = np.mgrid[0:h, 0:w]
        cx = float((field * xs).sum() / total) / max(1, w - 1)
        cy = float((field * ys).sum() / total) / max(1, h - 1)
        flat = np.sort(field.flatten())[::-1]
        top = flat[: max(1, flat.size // 10)].sum()
        return cx, cy, float(top / total)

    mx, my, m_conc = centroid(motion)
    dx, dy, d_conc = centroid(detail)

    print(json.dumps({
        "available": True,
        "motionX": round(mx, 4),
        "motionY": round(my, 4),
        "detailX": round(dx, 4),
        "detailY": round(dy, 4),
        "concentration": round(max(m_conc, 0.0), 4),
        "sampledFrames": len(grays),
    }))
except Exception as exc:
    print(json.dumps({"available": False, "error": str(exc)}))
`;

/**
 * Measures where the picture actually is, using the OpenCV already installed by
 * the QUALITY_CPU pack. Never throws and never blocks a render: when the runtime
 * is absent the caller falls back to the safe centre crop.
 */
export async function probeVisualFocus(
  videoPath: string,
  options: { startSeconds?: number; windowSeconds?: number; timeoutMs?: number } = {},
): Promise<FocalProbe> {
  if (!capabilityManager.isPythonQualityVenvInstalled()) {
    return { available: false, source: "unavailable", error: "quality_runtime_missing" };
  }
  if (!fs.existsSync(videoPath)) {
    return { available: false, source: "unavailable", error: "clip_missing" };
  }
  const pythonBin = capabilityManager.getQualityPythonPath();
  if (!pythonBin) {
    return { available: false, source: "unavailable", error: "python_missing" };
  }

  return new Promise<FocalProbe>((resolve) => {
    execFile(
      pythonBin,
      [
        "-c",
        PROBE_SCRIPT,
        videoPath,
        String(options.startSeconds ?? 0),
        String(options.windowSeconds ?? 0),
      ],
      { timeout: options.timeoutMs ?? 25000, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          logger.debug(
            { err: String(error) },
            "Smart crop focus probe unavailable; using centre crop",
          );
          resolve({ available: false, source: "unavailable", error: String(error) });
          return;
        }
        try {
          const parsed = JSON.parse(String(stdout).trim().split("\n").pop() || "{}");
          if (!parsed.available) {
            resolve({ available: false, source: "unavailable", error: parsed.error });
            return;
          }
          resolve({ ...parsed, source: "opencv" });
        } catch (parseError) {
          resolve({ available: false, source: "unavailable", error: String(parseError) });
        }
      },
    );
  });
}

/** Compact record persisted on the shot and in scene QA. */
export function cropMetadata(plan: SmartCropPlan) {
  return {
    mode: plan.mode,
    xCenter: plan.xCenter,
    yCenter: plan.yCenter,
    coverage: plan.coverage,
    confidence: plan.confidence,
    signals: plan.signals,
    reason: plan.reason,
    jitterClamped: plan.jitterClamped,
    edgeClamped: plan.edgeClamped,
  };
}
