import crypto from "crypto";
import { execFile } from "child_process";
import fs from "fs-extra";
import path from "path";
import { logger } from "../../../config";
import { capabilityManager } from "../capabilities/capabilityManager";

export type SemanticModelAudit = {
  modelId: string;
  implementation: "open_clip";
  license: "MIT";
  commercialUse: "allowed_by_license_with_model_card_caveats";
  checkpointSource: string;
  checkpointBundled: false;
  downloadSize: "not_bundled";
  runtime: "local_optional_cpu_or_cuda";
};

export type VideoSemanticAnalysis = {
  provider: string;
  assetId: string;
  modelId: string;
  modelVersion: string;
  license: string;
  cacheKey: string;
  cacheHit: boolean;
  frameSampleCount: number;
  frameSamplePercents: number[];
  perceptualAvailable: boolean;
  perceptualHashes: string[];
  perceptualHash?: string;
  semanticAvailable: boolean;
  visualSemanticScore?: number;
  runtime: "open_clip" | "perceptual_hash_only" | "unavailable";
  error?: string;
};

export type VideoSemanticAnalysisInput = {
  videoPath: string;
  intentText: string;
  provider: string;
  assetId: string;
  cacheDir: string;
  modelId?: string;
  timeoutMs?: number;
};

const FRAME_SAMPLE_PERCENTS = [20, 50, 80];
const DEFAULT_MODEL_ID = "openclip:ViT-B-32/laion2b_s34b_b79k";
const MODEL_VERSION = "v24-openclip-optional-phash-1";

export const OPENCLIP_MODEL_AUDIT: SemanticModelAudit = {
  modelId: DEFAULT_MODEL_ID,
  implementation: "open_clip",
  license: "MIT",
  commercialUse: "allowed_by_license_with_model_card_caveats",
  checkpointSource: "laion/CLIP-ViT-B-32-laion2B-s34B-b79K",
  checkpointBundled: false,
  downloadSize: "not_bundled",
  runtime: "local_optional_cpu_or_cuda",
};

function safeCachePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "_").slice(0, 96) || "unknown";
}

export function semanticAssetIdentity(assetId: string): string {
  return crypto.createHash("sha256").update(assetId).digest("hex").slice(0, 20);
}

export function semanticCacheKey(provider: string, assetId: string, modelVersion = MODEL_VERSION): string {
  return [
    safeCachePart(provider),
    semanticAssetIdentity(assetId),
    safeCachePart(modelVersion),
  ].join("__");
}

export function perceptualHashDistance(a?: string, b?: string): number {
  if (!a || !b || a.length !== b.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let index = 0; index < a.length; index += 1) {
    const left = parseInt(a[index], 16);
    const right = parseInt(b[index], 16);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return Number.POSITIVE_INFINITY;
    let xor = left ^ right;
    while (xor) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance;
}

export function arePerceptuallyNearDuplicate(a?: string, b?: string, threshold = 8): boolean {
  return perceptualHashDistance(a, b) <= threshold;
}

const PYTHON_ANALYZER = String.raw`
import json, os, sys

video_path = sys.argv[1]
intent_text = sys.argv[2]
model_id = sys.argv[3]

sample_percents = [20, 50, 80]

def fail(error, hashes=None):
    print(json.dumps({
        "frameSamplePercents": sample_percents,
        "frameSampleCount": len(hashes or []),
        "perceptualAvailable": bool(hashes),
        "perceptualHashes": hashes or [],
        "semanticAvailable": False,
        "runtime": "perceptual_hash_only" if hashes else "unavailable",
        "error": error,
    }))
    sys.exit(0)

try:
    import cv2
    import numpy as np
except Exception as exc:
    fail("opencv_unavailable:" + str(exc))

capture = cv2.VideoCapture(video_path)
if not capture.isOpened():
    fail("video_unreadable")

fps = capture.get(cv2.CAP_PROP_FPS) or 25.0
frame_count = capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0
duration = frame_count / fps if fps > 0 else 0.0
frames = []
hashes = []

def phash(frame):
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    small = cv2.resize(gray, (32, 32), interpolation=cv2.INTER_AREA).astype("float32")
    dct = cv2.dct(small)
    block = dct[1:9, 1:9]
    median = float(np.median(block))
    bits = (block > median).astype("uint8").flatten().tolist()
    value = 0
    out = []
    for i, bit in enumerate(bits):
        value = (value << 1) | int(bit)
        if (i + 1) % 4 == 0:
            out.append(format(value, "x"))
            value = 0
    return "".join(out)

for percent in sample_percents:
    if duration > 0:
        capture.set(cv2.CAP_PROP_POS_MSEC, max(0.0, duration * percent / 100.0) * 1000.0)
    else:
        capture.set(cv2.CAP_PROP_POS_FRAMES, max(0, int(frame_count * percent / 100.0)))
    ok, frame = capture.read()
    if not ok or frame is None:
        continue
    frames.append(frame)
    hashes.append(phash(frame))

capture.release()

if not hashes:
    fail("no_sampled_frames")

if os.environ.get("ABUD_ENABLE_OPENCLIP_SEMANTICS") != "true":
    fail("openclip_disabled", hashes)

checkpoint = os.environ.get("ABUD_OPENCLIP_LOCAL_WEIGHTS") or ""
if not checkpoint or not os.path.exists(checkpoint):
    fail("openclip_checkpoint_not_configured", hashes)

try:
    import torch
    import open_clip
    from PIL import Image
except Exception as exc:
    fail("openclip_runtime_unavailable:" + str(exc), hashes)

try:
    model_name = os.environ.get("ABUD_OPENCLIP_MODEL_NAME") or "ViT-B-32"
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model, _, preprocess = open_clip.create_model_and_transforms(model_name, pretrained=checkpoint)
    tokenizer = open_clip.get_tokenizer(model_name)
    model.to(device)
    model.eval()

    pil_frames = [Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)) for frame in frames]
    image_batch = torch.stack([preprocess(image) for image in pil_frames]).to(device)
    text_tokens = tokenizer([intent_text]).to(device)

    with torch.no_grad():
        image_features = model.encode_image(image_batch)
        text_features = model.encode_text(text_tokens)
        image_features = image_features / image_features.norm(dim=-1, keepdim=True)
        text_features = text_features / text_features.norm(dim=-1, keepdim=True)
        sims = (image_features @ text_features.T).squeeze(1)
        score = float(sims.mean().cpu().item())

    print(json.dumps({
        "frameSamplePercents": sample_percents,
        "frameSampleCount": len(hashes),
        "perceptualAvailable": True,
        "perceptualHashes": hashes,
        "semanticAvailable": True,
        "visualSemanticScore": round(max(0.0, min(100.0, (score + 1.0) * 50.0)), 2),
        "runtime": "open_clip",
    }))
except Exception as exc:
    fail("openclip_failed:" + str(exc), hashes)
`;

export async function analyzeVideoSemanticSimilarity(
  input: VideoSemanticAnalysisInput,
): Promise<VideoSemanticAnalysis> {
  const modelId = input.modelId || DEFAULT_MODEL_ID;
  const cacheKey = semanticCacheKey(input.provider, input.assetId, MODEL_VERSION);
  const cachePath = path.join(input.cacheDir, `${cacheKey}.json`);

  await fs.ensureDir(input.cacheDir);
  if (await fs.pathExists(cachePath)) {
    const cached = await fs.readJson(cachePath).catch(() => null);
    if (cached && cached.modelVersion === MODEL_VERSION) {
      return { ...cached, cacheHit: true };
    }
  }

  const base: Omit<VideoSemanticAnalysis, "cacheHit" | "frameSampleCount" | "perceptualAvailable" | "perceptualHashes" | "semanticAvailable" | "runtime"> = {
    provider: input.provider,
    assetId: semanticAssetIdentity(input.assetId),
    modelId,
    modelVersion: MODEL_VERSION,
    license: OPENCLIP_MODEL_AUDIT.license,
    cacheKey,
    frameSamplePercents: FRAME_SAMPLE_PERCENTS,
  };

  if (!fs.existsSync(input.videoPath)) {
    return {
      ...base,
      cacheHit: false,
      frameSampleCount: 0,
      perceptualAvailable: false,
      perceptualHashes: [],
      semanticAvailable: false,
      runtime: "unavailable",
      error: "video_missing",
    };
  }

  const pythonBin = capabilityManager.getQualityPythonPath();
  return new Promise<VideoSemanticAnalysis>((resolve) => {
    execFile(
      pythonBin || "python",
      ["-c", PYTHON_ANALYZER, input.videoPath, input.intentText, modelId],
      { timeout: input.timeoutMs ?? 45000, windowsHide: true, maxBuffer: 1024 * 1024 * 5 },
      async (error, stdout) => {
        if (error) {
          const result: VideoSemanticAnalysis = {
            ...base,
            cacheHit: false,
            frameSampleCount: 0,
            perceptualAvailable: false,
            perceptualHashes: [],
            semanticAvailable: false,
            runtime: "unavailable",
            error: String(error),
          };
          resolve(result);
          return;
        }
        try {
          const parsed = JSON.parse(String(stdout).trim().split("\n").pop() || "{}");
          const hashes = Array.isArray(parsed.perceptualHashes)
            ? parsed.perceptualHashes.map((item: unknown) => String(item)).filter(Boolean)
            : [];
          const result: VideoSemanticAnalysis = {
            ...base,
            cacheHit: false,
            frameSampleCount: Number(parsed.frameSampleCount || hashes.length || 0),
            frameSamplePercents: Array.isArray(parsed.frameSamplePercents) ? parsed.frameSamplePercents : FRAME_SAMPLE_PERCENTS,
            perceptualAvailable: Boolean(parsed.perceptualAvailable),
            perceptualHashes: hashes,
            perceptualHash: hashes.length
              ? crypto.createHash("sha256").update(hashes.join("|")).digest("hex").slice(0, 16)
              : undefined,
            semanticAvailable: Boolean(parsed.semanticAvailable),
            visualSemanticScore: Number.isFinite(Number(parsed.visualSemanticScore))
              ? Number(parsed.visualSemanticScore)
              : undefined,
            runtime: parsed.runtime === "open_clip"
              ? "open_clip"
              : parsed.runtime === "perceptual_hash_only"
                ? "perceptual_hash_only"
                : "unavailable",
            error: parsed.error ? String(parsed.error) : undefined,
          };
          await fs.writeJson(cachePath, result, { spaces: 2 }).catch((cacheError) => {
            logger.debug({ err: String(cacheError), cacheKey }, "Semantic cache write skipped");
          });
          resolve(result);
        } catch (parseError) {
          resolve({
            ...base,
            cacheHit: false,
            frameSampleCount: 0,
            perceptualAvailable: false,
            perceptualHashes: [],
            semanticAvailable: false,
            runtime: "unavailable",
            error: String(parseError),
          });
        }
      },
    );
  });
}
