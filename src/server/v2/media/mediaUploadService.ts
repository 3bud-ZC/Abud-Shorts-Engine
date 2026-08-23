import crypto from "crypto";
import fs from "fs-extra";
import path from "path";
import cuid from "cuid";
import { qualityEngine } from "../quality/qualityEngine";

export type UploadedProductMedia = {
  id: string;
  filename: string;
  originalName: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  sizeBytes: number;
  width: number;
  height: number;
  checksum: string;
  storagePath: string;
  relativePath: string;
  uploadedAt: string;
  nobgArtifactId?: string;
  nobgRelativePath?: string;
};

// Check magic bytes for PNG, JPEG, WEBP
function validateImageMagicBytes(buffer: Buffer): "image/png" | "image/jpeg" | "image/webp" | null {
  if (buffer.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  // WEBP: 'RIFF' .... 'WEBP'
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}

// Extract basic dimensions for PNG / JPEG
function extractDimensions(buffer: Buffer, mime: "image/png" | "image/jpeg" | "image/webp"): { width: number; height: number } {
  if (mime === "image/png" && buffer.length >= 24) {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return { width, height };
  }

  // Default fallback for JPEG/WEBP if not parsed header
  return { width: 1080, height: 1080 };
}

export class MediaUploadService {
  private uploadsDir: string;
  private metadataStorePath: string;

  constructor() {
    const baseDataDir = process.env.DATA_DIR_PATH
      ? path.resolve(process.env.DATA_DIR_PATH)
      : path.resolve(process.cwd(), "data-dev");
    this.uploadsDir = path.join(baseDataDir, "uploads", "products");
    this.metadataStorePath = path.join(baseDataDir, "uploads", "products_manifest.json");
    fs.ensureDirSync(this.uploadsDir);
  }

  private async getManifest(): Promise<Record<string, UploadedProductMedia>> {
    if (await fs.pathExists(this.metadataStorePath)) {
      try {
        return await fs.readJson(this.metadataStorePath);
      } catch {
        return {};
      }
    }
    return {};
  }

  private async saveManifest(manifest: Record<string, UploadedProductMedia>): Promise<void> {
    await fs.writeJson(this.metadataStorePath, manifest, { spaces: 2 });
  }

  public async saveProductImage(
    buffer: Buffer,
    originalName: string,
    options: { removeBackground?: boolean } = {},
  ): Promise<UploadedProductMedia> {
    const maxSizeBytes = 25 * 1024 * 1024; // 25MB
    if (buffer.length > maxSizeBytes) {
      throw new Error(`File size ${buffer.length} bytes exceeds maximum limit of 25MB`);
    }

    const detectedMime = validateImageMagicBytes(buffer);
    if (!detectedMime) {
      throw new Error("Invalid image file format. Only valid PNG, JPEG, and WEBP images are supported.");
    }

    const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
    const id = `prod_${cuid()}`;
    const extension = detectedMime === "image/png" ? "png" : detectedMime === "image/jpeg" ? "jpg" : "webp";
    const filename = `${id}.${extension}`;
    const storagePath = path.join(this.uploadsDir, filename);

    await fs.writeFile(storagePath, buffer);

    const dims = extractDimensions(buffer, detectedMime);
    const baseDataDir = process.env.DATA_DIR_PATH
      ? path.resolve(process.env.DATA_DIR_PATH)
      : path.resolve(process.cwd(), "data-dev");
    const relativePath = path.relative(baseDataDir, storagePath).replace(/\\/g, "/");

    let nobgArtifactId: string | undefined;
    let nobgRelativePath: string | undefined;

    if (options.removeBackground !== false) {
      try {
        const rembgRes = await qualityEngine.removeBackground(storagePath);
        nobgArtifactId = rembgRes.artifactId;
        nobgRelativePath = rembgRes.relativePath;
      } catch (err) {
        // rembg failure can fallback gracefully
      }
    }

    const record: UploadedProductMedia = {
      id,
      filename,
      originalName: originalName.replace(/[^a-zA-Z0-9._-]/g, "_"),
      mimeType: detectedMime,
      sizeBytes: buffer.length,
      width: dims.width,
      height: dims.height,
      checksum,
      storagePath,
      relativePath,
      uploadedAt: new Date().toISOString(),
      nobgArtifactId,
      nobgRelativePath,
    };

    const manifest = await this.getManifest();
    manifest[id] = record;
    await this.saveManifest(manifest);

    return record;
  }

  public async getProductImage(id: string): Promise<UploadedProductMedia | null> {
    const manifest = await this.getManifest();
    return manifest[id] || null;
  }

  public async listProductImages(): Promise<UploadedProductMedia[]> {
    const manifest = await this.getManifest();
    return Object.values(manifest).sort(
      (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
    );
  }
}

export const mediaUploadService = new MediaUploadService();
