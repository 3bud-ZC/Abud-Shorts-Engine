import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { logger } from "../../../config";
import { capabilityManager } from "../capabilities/capabilityManager";

/**
 * PERSISTENT OPENCLIP WORKER POOL
 * --------------------------------
 * `analyzeVideoSemanticSimilarity` (semanticSimilarity.ts) used to spawn a
 * brand new `python -c <script>` process for EVERY candidate video, and that
 * script called `open_clip.create_model_and_transforms(...)` - loading the
 * full CLIP checkpoint from disk into torch - on every single invocation. A
 * scene ranks up to 4 candidates concurrently (`Promise.all`), and a
 * typical production has several scenes, so a single render could cold-load
 * the model a dozen times. This is the leading suspect for the "media" stage
 * timing swinging between 6.8s and 50.1s across otherwise-similar Pass 4
 * benchmarks (V2.4 Pass 5, section 19).
 *
 * This module keeps a small pool of long-lived Python worker processes, each
 * loading the model once and then answering many requests over its lifetime
 * (for the rest of the render-worker container's uptime, not just one
 * video), via newline-delimited JSON over stdin/stdout. If the pool cannot
 * start, or a worker misbehaves, callers fall back to the original
 * spawn-per-call path - this is a pure acceleration layer, never a new
 * correctness requirement.
 */

export type OpenClipWorkerRequest = {
  videoPath: string;
  intentText: string;
  modelId: string;
};

export type OpenClipWorkerResponse = {
  frameSamplePercents: number[];
  frameSampleCount: number;
  perceptualAvailable: boolean;
  perceptualHashes: string[];
  semanticAvailable: boolean;
  visualSemanticScore?: number;
  blackFramePercent: number;
  longestBlackRunMs: number;
  runtime: "open_clip" | "perceptual_hash_only" | "unavailable";
  error?: string;
};

/**
 * Newline-delimited JSON worker loop. The model is loaded lazily on the
 * first request that actually needs OpenCLIP (so a worker that only ever
 * serves perceptual-hash-only requests never pays the torch import cost),
 * then kept warm in the module-level `_model` global for the rest of the
 * process's life.
 */
const WORKER_SCRIPT = String.raw`
import json, os, sys, traceback

sample_percents = [20, 50, 80]

_model = None
_preprocess = None
_tokenizer = None
_device = None
_model_name = None

def load_model_if_needed(model_name):
    global _model, _preprocess, _tokenizer, _device, _model_name
    if _model is not None and _model_name == model_name:
        return
    import torch, open_clip
    checkpoint = os.environ.get("ABUD_OPENCLIP_LOCAL_WEIGHTS") or ""
    if not checkpoint or not os.path.exists(checkpoint):
        raise RuntimeError("openclip_checkpoint_not_configured")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model, _xform, preprocess = open_clip.create_model_and_transforms(model_name, pretrained=checkpoint)
    tokenizer = open_clip.get_tokenizer(model_name)
    model.to(device)
    model.eval()
    _model, _preprocess, _tokenizer, _device, _model_name = model, preprocess, tokenizer, device, model_name

def phash(cv2, np, frame):
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

def measure_black_frames(cv2, cap, duration, fps):
    if duration <= 0 or fps <= 0:
        return {"blackFramePercent": 0.0, "longestBlackRunMs": 0}
    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
    step = max(1, int(round(fps / 10.0)))
    frame_index = 0
    current_start = None
    current_end = None
    runs = []
    while True:
        ok, frame = cap.read()
        if not ok or frame is None:
            break
        if frame_index % step == 0:
            t = frame_index / fps
            small = cv2.resize(frame, (64, 64), interpolation=cv2.INTER_AREA)
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            dark_ratio = float((gray < 16).mean())
            is_black = dark_ratio >= 0.98 and float(gray.mean()) < 10.0
            window_end = min(duration, t + (step / fps))
            if is_black:
                if current_start is None:
                    current_start = t
                current_end = window_end
            elif current_start is not None:
                runs.append((current_start, current_end or t))
                current_start = None
                current_end = None
        frame_index += 1
    if current_start is not None:
        runs.append((current_start, current_end or duration))
    total = sum(max(0.0, end - start) for start, end in runs)
    longest = max([0.0] + [max(0.0, end - start) for start, end in runs])
    return {
        "blackFramePercent": round((total / max(0.01, duration)) * 100.0, 1),
        "longestBlackRunMs": int(round(longest * 1000.0)),
    }

def analyze_one(video_path, intent_text, model_id):
    black_default = {"blackFramePercent": 0.0, "longestBlackRunMs": 0}

    def fail(error, hashes=None, black_metrics=None):
        black_metrics = black_metrics or black_default
        return {
            "frameSamplePercents": sample_percents,
            "frameSampleCount": len(hashes or []),
            "perceptualAvailable": bool(hashes),
            "perceptualHashes": hashes or [],
            "semanticAvailable": False,
            "blackFramePercent": black_metrics["blackFramePercent"],
            "longestBlackRunMs": black_metrics["longestBlackRunMs"],
            "runtime": "perceptual_hash_only" if hashes else "unavailable",
            "error": error,
        }

    try:
        import cv2
        import numpy as np
    except Exception as exc:
        return fail("opencv_unavailable:" + str(exc))

    capture = cv2.VideoCapture(video_path)
    if not capture.isOpened():
        return fail("video_unreadable")

    fps = capture.get(cv2.CAP_PROP_FPS) or 25.0
    frame_count = capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0
    duration = frame_count / fps if fps > 0 else 0.0
    frames = []
    hashes = []

    for percent in sample_percents:
        if duration > 0:
            capture.set(cv2.CAP_PROP_POS_MSEC, max(0.0, duration * percent / 100.0) * 1000.0)
        else:
            capture.set(cv2.CAP_PROP_POS_FRAMES, max(0, int(frame_count * percent / 100.0)))
        ok, frame = capture.read()
        if not ok or frame is None:
            continue
        frames.append(frame)
        hashes.append(phash(cv2, np, frame))

    black_metrics = measure_black_frames(cv2, capture, duration, fps)
    capture.release()

    if not hashes:
        return fail("no_sampled_frames", black_metrics=black_metrics)

    if os.environ.get("ABUD_ENABLE_OPENCLIP_SEMANTICS") != "true":
        return fail("openclip_disabled", hashes, black_metrics)

    try:
        load_model_if_needed(os.environ.get("ABUD_OPENCLIP_MODEL_NAME") or "ViT-B-32")
        from PIL import Image
        import torch

        pil_frames = [Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)) for frame in frames]
        image_batch = torch.stack([_preprocess(image) for image in pil_frames]).to(_device)
        text_tokens = _tokenizer([intent_text]).to(_device)

        with torch.no_grad():
            image_features = _model.encode_image(image_batch)
            text_features = _model.encode_text(text_tokens)
            image_features = image_features / image_features.norm(dim=-1, keepdim=True)
            text_features = text_features / text_features.norm(dim=-1, keepdim=True)
            sims = (image_features @ text_features.T).squeeze(1)
            score = float(sims.mean().cpu().item())

        return {
            "frameSamplePercents": sample_percents,
            "frameSampleCount": len(hashes),
            "perceptualAvailable": True,
            "perceptualHashes": hashes,
            "semanticAvailable": True,
            "visualSemanticScore": round(max(0.0, min(100.0, (score + 1.0) * 50.0)), 2),
            "blackFramePercent": black_metrics["blackFramePercent"],
            "longestBlackRunMs": black_metrics["longestBlackRunMs"],
            "runtime": "open_clip",
        }
    except Exception as exc:
        return fail("openclip_failed:" + str(exc), hashes, black_metrics)

def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request_id = None
        try:
            req = json.loads(line)
            request_id = req.get("requestId")
            result = analyze_one(req["videoPath"], req["intentText"], req["modelId"])
            result["requestId"] = request_id
        except Exception as exc:
            result = {
                "requestId": request_id,
                "frameSamplePercents": sample_percents,
                "frameSampleCount": 0,
                "perceptualAvailable": False,
                "perceptualHashes": [],
                "semanticAvailable": False,
                "blackFramePercent": 0.0,
                "longestBlackRunMs": 0,
                "runtime": "unavailable",
                "error": "worker_exception:" + str(exc) + " " + traceback.format_exc(limit=2),
            }
        sys.stdout.write(json.dumps(result) + "\n")
        sys.stdout.flush()

main()
`;

type PendingRequest = {
  resolve: (value: OpenClipWorkerResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

class OpenClipWorker {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private stdoutBuffer = "";
  private pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private ready = false;
  public startupError: string | null = null;

  constructor(private pythonBin: string) {}

  start(): void {
    try {
      this.proc = spawn(this.pythonBin, ["-u", "-c", WORKER_SCRIPT], { windowsHide: true });
    } catch (error) {
      this.startupError = error instanceof Error ? error.message : String(error);
      return;
    }
    this.ready = true;
    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk: string) => this.onStdout(chunk));
    this.proc.stderr.setEncoding("utf8");
    this.proc.stderr.on("data", (chunk: string) => {
      logger.debug({ chunk }, "OpenCLIP worker stderr");
    });
    this.proc.on("exit", (code) => {
      this.ready = false;
      const err = new Error(`OpenCLIP worker exited (code ${code})`);
      for (const [, entry] of this.pending) {
        clearTimeout(entry.timeout);
        entry.reject(err);
      }
      this.pending.clear();
    });
    this.proc.on("error", (error) => {
      this.ready = false;
      this.startupError = error.message;
    });
  }

  isReady(): boolean {
    return this.ready && this.proc != null;
  }

  isIdle(): boolean {
    return this.isReady() && this.pending.size === 0;
  }

  private onStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newlineIndex: number;
    while ((newlineIndex = this.stdoutBuffer.indexOf("\n")) >= 0) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (!line) continue;
      this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    let parsed: any;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    const requestId = Number(parsed.requestId);
    const entry = this.pending.get(requestId);
    if (!entry) return;
    this.pending.delete(requestId);
    clearTimeout(entry.timeout);
    entry.resolve(parsed as OpenClipWorkerResponse);
  }

  async request(payload: OpenClipWorkerRequest, timeoutMs: number): Promise<OpenClipWorkerResponse> {
    if (!this.isReady() || !this.proc) {
      throw new Error(this.startupError || "OpenCLIP worker is not running");
    }
    const requestId = this.nextRequestId++;
    const line = JSON.stringify({ ...payload, requestId }) + "\n";
    return new Promise<OpenClipWorkerResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        // A stuck worker likely has a corrupted stdin/stdout protocol state -
        // killing it forces a clean respawn on the next request rather than
        // silently returning wrong data for a future request.
        this.kill();
        reject(new Error("OpenCLIP worker request timed out"));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timeout });
      this.proc!.stdin.write(line, (error) => {
        if (error) {
          clearTimeout(timeout);
          this.pending.delete(requestId);
          reject(error);
        }
      });
    });
  }

  kill(): void {
    this.ready = false;
    try {
      this.proc?.kill();
    } catch {
      // already dead
    }
  }
}

export class OpenClipWorkerPool {
  private workers: OpenClipWorker[] = [];
  private roundRobinIndex = 0;
  private initStartedAt: number | null = null;
  private initDurationMs: number | null = null;

  constructor(
    private pythonBin: string,
    private poolSize: number,
  ) {}

  /** Measured once: time to spawn the pool's worker processes (not the model load itself, which is lazy on first real request). */
  getInitMs(): number | null {
    return this.initDurationMs;
  }

  /**
   * Spawns workers up to `poolSize` and prunes dead ones. Called before every
   * `analyze()`, not just once, so a worker killed after a timeout or crash
   * (see OpenClipWorker's "exit" handler) is replaced on the next request
   * instead of permanently shrinking the pool to zero.
   */
  ensureStarted(): void {
    this.workers = this.workers.filter((w) => w.isReady());
    const firstStart = this.initStartedAt === null;
    if (firstStart) this.initStartedAt = Date.now();
    while (this.workers.length < this.poolSize) {
      const worker = new OpenClipWorker(this.pythonBin);
      worker.start();
      this.workers.push(worker);
    }
    if (firstStart) this.initDurationMs = Date.now() - this.initStartedAt!;
  }

  private pickWorker(): OpenClipWorker | null {
    const idle = this.workers.find((w) => w.isIdle());
    if (idle) return idle;
    const ready = this.workers.filter((w) => w.isReady());
    if (ready.length === 0) return null;
    this.roundRobinIndex = (this.roundRobinIndex + 1) % ready.length;
    return ready[this.roundRobinIndex];
  }

  async analyze(payload: OpenClipWorkerRequest, timeoutMs: number): Promise<OpenClipWorkerResponse> {
    this.ensureStarted();
    const worker = this.pickWorker();
    if (!worker) throw new Error("OpenCLIP worker pool has no running workers");
    return worker.request(payload, timeoutMs);
  }

  shutdown(): void {
    this.workers.forEach((w) => w.kill());
    this.workers = [];
  }
}

let sharedPool: OpenClipWorkerPool | null = null;

/**
 * The shared, process-lifetime pool. Lazily created on first use and kept
 * alive for as long as the render-worker process runs, so the model-load
 * cost is amortized across every video this process ever renders - not just
 * one. Returns null when the quality Python runtime isn't installed, so
 * callers can fall back to the per-call path without ever touching the pool.
 */
export function getSharedOpenClipWorkerPool(): OpenClipWorkerPool | null {
  const pythonBin = process.env.ABUD_OPENCLIP_PYTHON_BIN?.trim() || capabilityManager.getQualityPythonPath();
  if (!pythonBin) return null;
  if (!sharedPool) {
    const poolSize = Math.max(1, Math.min(8, Number(process.env.ABUD_OPENCLIP_WORKER_POOL_SIZE) || 2));
    sharedPool = new OpenClipWorkerPool(pythonBin, poolSize);
  }
  return sharedPool;
}

/** Test-only: forces a fresh pool on next getSharedOpenClipWorkerPool() call. */
export function resetSharedOpenClipWorkerPoolForTests(): void {
  sharedPool?.shutdown();
  sharedPool = null;
}
