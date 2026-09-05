import fs from "fs-extra";
import axios from "axios";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import type {
  ProviderGenerationJob,
  ProviderLifecycleStatus,
  VisualAssetResult,
} from "./types";

type ProbedVisualAsset = {
  durationSeconds: number;
  width: number;
  height: number;
  fps?: number;
  hasVideoStream: boolean;
  fileSizeBytes: number;
  containerFormat?: string;
  videoCodec?: string;
  issues: string[];
};

export function normalizeAsyncStatus(status: unknown): ProviderLifecycleStatus {
  const value = String(status || "").toLowerCase();
  if (["queued", "pending", "starting", "submitted", "in_queue"].includes(value)) return "QUEUED";
  if (["processing", "running", "in_progress", "executing"].includes(value)) return "PROCESSING";
  if (["complete", "completed", "succeeded", "success", "finished"].includes(value)) return "COMPLETE";
  if (["cancelled", "canceled"].includes(value)) return "CANCELLED";
  if (["timeout", "timed_out"].includes(value)) return "TIMED_OUT";
  if (["failed", "error"].includes(value)) return "FAILED";
  return "PROCESSING";
}

export function extractFirstUrl(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string" && /^https?:\/\//i.test(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractFirstUrl(item);
      if (found) return found;
    }
  }
  if (typeof value === "object") {
    for (const key of ["url", "video", "video_url", "output", "file", "download_url", "uri"]) {
      const found = extractFirstUrl((value as Record<string, unknown>)[key]);
      if (found) return found;
    }
  }
  return undefined;
}

function probeDownloadedVisualAsset(filePath: string): Promise<ProbedVisualAsset> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      return reject(new Error("Downloaded provider asset does not exist on disk."));
    }

    const fileStats = fs.statSync(filePath);
    ffmpeg.ffprobe(filePath, (error, metadata) => {
      if (error) {
        return reject(new Error(`Downloaded provider asset failed ffprobe validation: ${error.message}`));
      }

      const videoStream = metadata?.streams?.find((stream) => stream.codec_type === "video");
      const durationSeconds = Number(metadata?.format?.duration || videoStream?.duration || 0);
      const width = Number(videoStream?.width || 0);
      const height = Number(videoStream?.height || 0);
      const avgFrameRate = String(videoStream?.avg_frame_rate || videoStream?.r_frame_rate || "");
      const [fpsNumerator, fpsDenominator] = avgFrameRate.split("/").map(Number);
      const fps = fpsNumerator && fpsDenominator ? Math.round((fpsNumerator / fpsDenominator) * 100) / 100 : undefined;
      const issues: string[] = [];

      if (!videoStream) issues.push("missing_video_stream");
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) issues.push("missing_or_zero_duration");
      if (!width || !height) issues.push("missing_video_dimensions");
      if (fileStats.size < 10_000) issues.push("suspiciously_small_download");

      const probe: ProbedVisualAsset = {
        durationSeconds: Number.isFinite(durationSeconds) ? Math.round(durationSeconds * 100) / 100 : 0,
        width,
        height,
        fps,
        hasVideoStream: Boolean(videoStream),
        fileSizeBytes: fileStats.size,
        containerFormat: metadata?.format?.format_name,
        videoCodec: videoStream?.codec_name,
        issues,
      };

      if (issues.length > 0) {
        return reject(new Error(`Downloaded provider asset failed validation: ${issues.join(", ")}`));
      }

      resolve(probe);
    });
  });
}

export async function downloadGeneratedAsset(
  job: ProviderGenerationJob,
  destinationPath: string,
  headers: Record<string, string> = {},
): Promise<VisualAssetResult> {
  if (!job.outputUrl) {
    throw new Error(`${job.provider} job ${job.providerRequestId} has no downloadable output URL.`);
  }
  const response = await axios({
    method: "GET",
    url: job.outputUrl,
    responseType: "stream",
    timeout: 120000,
    maxRedirects: 5,
    headers,
  });
  await fs.ensureDir(path.dirname(destinationPath));
  await new Promise<void>((resolve, reject) => {
    const writer = fs.createWriteStream(destinationPath);
    response.data.pipe(writer);
    writer.on("finish", () => {
      writer.close();
      resolve();
    });
    writer.on("error", reject);
  });
  let probe: ProbedVisualAsset;
  try {
    probe = await probeDownloadedVisualAsset(destinationPath);
  } catch (error) {
    await fs.remove(destinationPath).catch(() => undefined);
    throw error;
  }
  return {
    provider: job.provider,
    source: job.provider === "comfyui" ? "local_ai" : "ai",
    url: job.outputUrl,
    localPath: destinationPath,
    durationSeconds: probe.durationSeconds || Number(job.metadata?.durationSeconds) || 0,
    width: probe.width,
    height: probe.height,
    fps: probe.fps,
    estimatedCost: null,
    metadata: {
      ...(job.metadata || {}),
      providerRequestId: job.providerRequestId,
      lifecycleStatus: job.status,
      technicalValidation: {
        valid: true,
        ffprobeBacked: true,
        width: probe.width,
        height: probe.height,
        durationSeconds: probe.durationSeconds,
        fps: probe.fps,
        fileSizeBytes: probe.fileSizeBytes,
        containerFormat: probe.containerFormat,
        videoCodec: probe.videoCodec,
      },
    },
  };
}
