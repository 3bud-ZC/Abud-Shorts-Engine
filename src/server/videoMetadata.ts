import fs from "fs-extra";
import path from "path";
import type { VideoStatus } from "../types/shorts";

export interface VideoMetadata {
  videoId: string;
  filename: string;
  status: VideoStatus;
  templateId?: string;
  templateName?: string;
  brandName?: string;
  watermarkText?: string;
  captionStyle?: "clean" | "bold" | "minimal";
  createdAt?: string;
  updatedAt?: string;
  durationSeconds?: number;
  sizeBytes?: number;
  pexelsTerms?: string[];
  narrationLines?: string[];
  downloadUrl?: string;
  previewUrl?: string;
  downloadFilename?: string;
  containerPath?: string;
  hostPathHint?: string;
  error?: string;
}

export function getMetadataPath(videosDir: string, videoId: string): string {
  return path.join(videosDir, `${videoId}.metadata.json`);
}

export function readMetadata(
  videosDir: string,
  videoId: string,
): VideoMetadata | null {
  const metadataPath = getMetadataPath(videosDir, videoId);
  if (!fs.existsSync(metadataPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(metadataPath, "utf-8");
    return JSON.parse(raw) as VideoMetadata;
  } catch {
    return null;
  }
}

export function writeMetadata(
  videosDir: string,
  metadata: VideoMetadata,
): void {
  fs.ensureDirSync(videosDir);
  const metadataPath = getMetadataPath(videosDir, metadata.videoId);
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
}

export function deleteMetadata(videosDir: string, videoId: string): void {
  const metadataPath = getMetadataPath(videosDir, videoId);
  if (fs.existsSync(metadataPath)) {
    fs.removeSync(metadataPath);
  }
}

export function mergeMetadata(
  fileMeta: {
    videoId: string;
    filename: string;
    status: VideoStatus;
    sizeBytes: number;
    createdAt: string;
    downloadUrl: string;
    previewUrl: string;
    downloadFilename?: string;
    containerPath?: string;
    hostPathHint?: string;
  },
  sidecar: VideoMetadata | null,
): VideoMetadata {
  if (!sidecar) {
    return {
      videoId: fileMeta.videoId,
      filename: fileMeta.filename,
      status: fileMeta.status,
      sizeBytes: fileMeta.sizeBytes,
      createdAt: fileMeta.createdAt,
      downloadUrl: fileMeta.downloadUrl,
      previewUrl: fileMeta.previewUrl,
      downloadFilename: fileMeta.downloadFilename,
      containerPath: fileMeta.containerPath,
      hostPathHint: fileMeta.hostPathHint,
    };
  }

  return {
    ...sidecar,
    videoId: fileMeta.videoId,
    filename: fileMeta.filename,
    status: fileMeta.status,
    sizeBytes: fileMeta.sizeBytes,
    createdAt: sidecar.createdAt || fileMeta.createdAt,
    updatedAt: sidecar.updatedAt || fileMeta.createdAt,
    downloadUrl: fileMeta.downloadUrl,
    previewUrl: fileMeta.previewUrl,
    downloadFilename: fileMeta.downloadFilename,
    containerPath: fileMeta.containerPath,
    hostPathHint: fileMeta.hostPathHint,
  };
}

export function sanitizeFilenameSegment(segment: string): string {
  return segment
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function listVideoFiles(files: string[]): string[] {
  return files.filter((file) => file.endsWith(".mp4"));
}

export function filterVideoList(
  videos: VideoMetadata[],
  query: { status?: string; templateId?: string },
): VideoMetadata[] {
  let result = [...videos];
  if (query.status) {
    result = result.filter((v) => v.status === query.status);
  }
  if (query.templateId) {
    result = result.filter((v) => v.templateId === query.templateId);
  }
  return result;
}

export function buildDownloadFilename(
  videoId: string,
  metadata?: VideoMetadata | null,
): string {
  const safeId = sanitizeFilenameSegment(videoId);
  const templateSource = metadata?.templateName || metadata?.templateId;
  const templatePart = templateSource
    ? sanitizeFilenameSegment(templateSource)
    : null;
  const brandSource = metadata?.brandName || metadata?.watermarkText;
  const brandPart = brandSource ? sanitizeFilenameSegment(brandSource) : null;

  const parts = ["abud-short"];
  if (templatePart) parts.push(templatePart);
  if (brandPart) parts.push(brandPart);
  parts.push(safeId);

  const base = parts.join("-");
  // Keep filename reasonable: max ~100 chars for base + .mp4
  const trimmed = base.length > 100 ? base.substring(0, 100) : base;
  return `${trimmed}.mp4`;
}
