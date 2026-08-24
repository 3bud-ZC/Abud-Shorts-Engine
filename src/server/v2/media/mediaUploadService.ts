import crypto from "crypto";
import fs from "fs-extra";
import path from "path";
import cuid from "cuid";
import { qualityEngine } from "../quality/qualityEngine";
import { inspectImage, MIN_USABLE_EDGE_PX } from "./imageInspection";

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
  /** False when the stored bytes are not a usable image (e.g. a 1x1 placeholder). */
  usable?: boolean;
  /** Why the asset is unusable, in the customer's language. */
  unusableReason?: string;
  /** Id of the earlier asset with identical bytes, when this is a duplicate. */
  duplicateOf?: string;
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

    // Magic bytes, real header parse and a usable-size check. An extension is
    // never trusted, and a technically-valid but degenerate image (a 1x1
    // placeholder) is refused rather than stored as a product photo.
    const inspection = inspectImage(buffer);
    if (!inspection.mime) {
      throw new Error("Invalid image file format. Only PNG, JPEG and WEBP images are supported.");
    }
    if (!inspection.decodable) {
      throw new Error(inspection.reason || "This image could not be read.");
    }
    if (!inspection.usable) {
      throw new Error(
        inspection.reason ||
          `Images must be at least ${MIN_USABLE_EDGE_PX}x${MIN_USABLE_EDGE_PX} pixels.`,
      );
    }
    const detectedMime = inspection.mime;

    const checksum = crypto.createHash("sha256").update(buffer).digest("hex");

    // Identical bytes mean an identical asset. Return the existing record so the
    // library does not fill with copies the customer cannot tell apart.
    const existingManifest = await this.getManifest();
    const duplicate = Object.values(existingManifest).find(
      (candidate) => candidate.checksum === checksum,
    );
    if (duplicate) {
      return { ...duplicate, duplicateOf: duplicate.id };
    }
    const id = `prod_${cuid()}`;
    const extension = detectedMime === "image/png" ? "png" : detectedMime === "image/jpeg" ? "jpg" : "webp";
    const filename = `${id}.${extension}`;
    const storagePath = path.join(this.uploadsDir, filename);

    await fs.writeFile(storagePath, buffer);

    const dims = { width: inspection.width, height: inspection.height };
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
      usable: true,
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

  /**
   * Lists stored media, re-inspecting each file so assets uploaded before
   * validation existed are reported accurately. Nothing is deleted: a file that
   * cannot be used is returned with `usable: false` and a reason, and the UI
   * labels it rather than pretending it is a valid image.
   */
  public async listProductImages(): Promise<UploadedProductMedia[]> {
    const manifest = await this.getManifest();
    const records = Object.values(manifest).sort(
      (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
    );

    const seenChecksums = new Map<string, string>();
    const inspected: UploadedProductMedia[] = [];

    for (const record of records) {
      let usable = record.usable;
      let unusableReason = record.unusableReason;
      let width = record.width;
      let height = record.height;

      try {
        if (await fs.pathExists(record.storagePath)) {
          const buffer = await fs.readFile(record.storagePath);
          const inspection = inspectImage(buffer);
          usable = inspection.usable;
          unusableReason = inspection.usable ? undefined : inspection.reason;
          if (inspection.decodable) {
            width = inspection.width;
            height = inspection.height;
          }
        } else {
          usable = false;
          unusableReason = "The file for this item is missing from storage.";
        }
      } catch {
        usable = false;
        unusableReason = "This file could not be read.";
      }

      // The first record with a given checksum is the original; later ones are
      // labelled so identical uploads are not shown as different assets.
      const firstWithChecksum = seenChecksums.get(record.checksum);
      if (!firstWithChecksum) seenChecksums.set(record.checksum, record.id);

      inspected.push({
        ...record,
        width,
        height,
        usable,
        unusableReason,
        duplicateOf: firstWithChecksum && firstWithChecksum !== record.id ? firstWithChecksum : undefined,
      });
    }

    return inspected;
  }

  /** Permanently removes one stored asset and its manifest entry. */
  public async deleteProductImage(id: string): Promise<boolean> {
    const manifest = await this.getManifest();
    const record = manifest[id];
    if (!record) return false;
    try {
      if (await fs.pathExists(record.storagePath)) await fs.remove(record.storagePath);
    } catch {
      // A missing file still leaves the manifest entry to clear.
    }
    delete manifest[id];
    await this.saveManifest(manifest);
    return true;
  }

  /** Renames the display name only; stored bytes and id are untouched. */
  public async renameProductImage(id: string, originalName: string): Promise<UploadedProductMedia | null> {
    const manifest = await this.getManifest();
    const record = manifest[id];
    if (!record) return null;
    record.originalName = originalName.slice(0, 160);
    manifest[id] = record;
    await this.saveManifest(manifest);
    return record;
  }
}

export const mediaUploadService = new MediaUploadService();
