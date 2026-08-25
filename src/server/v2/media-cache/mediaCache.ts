import fs from "fs-extra";
import path from "path";
import crypto from "crypto";
import { logger } from "../../../logger";

export type CachedAsset = {
  key: string;
  provider: string;
  assetId: string | number;
  filePath: string;
  fileSizeBytes: number;
  createdAt: string;
  lastUsedAt: string;
};

export class MediaCache {
  private cacheDir: string;
  private uploadsDir: string;
  private memoryIndex: Map<string, CachedAsset> = new Map();

  constructor(baseDataDir: string) {
    this.cacheDir = path.join(baseDataDir, "cache");
    this.uploadsDir = path.join(baseDataDir, "uploads");
    fs.ensureDirSync(this.cacheDir);
    fs.ensureDirSync(this.uploadsDir);
  }

  private generateKey(provider: string, assetId: string | number): string {
    return crypto
      .createHash("sha256")
      .update(`${provider}:${assetId}`)
      .digest("hex")
      .slice(0, 24);
  }

  public getCachedAsset(provider: string, assetId: string | number): CachedAsset | null {
    const key = this.generateKey(provider, assetId);
    const existing = this.memoryIndex.get(key);
    if (existing && fs.existsSync(existing.filePath)) {
      existing.lastUsedAt = new Date().toISOString();
      return existing;
    }

    const potentialPath = path.join(this.cacheDir, `${key}.mp4`);
    if (fs.existsSync(potentialPath)) {
      const stats = fs.statSync(potentialPath);
      const asset: CachedAsset = {
        key,
        provider,
        assetId,
        filePath: potentialPath,
        fileSizeBytes: stats.size,
        createdAt: stats.birthtime.toISOString(),
        lastUsedAt: new Date().toISOString(),
      };
      this.memoryIndex.set(key, asset);
      return asset;
    }

    return null;
  }

  public saveCachedAsset(
    provider: string,
    assetId: string | number,
    sourceFilePath: string,
  ): CachedAsset | null {
    try {
      if (!fs.existsSync(sourceFilePath)) return null;
      const key = this.generateKey(provider, assetId);
      const ext = path.extname(sourceFilePath) || ".mp4";
      const targetPath = path.join(this.cacheDir, `${key}${ext}`);

      if (!fs.existsSync(targetPath)) {
        fs.copyFileSync(sourceFilePath, targetPath);
      }

      const stats = fs.statSync(targetPath);
      const asset: CachedAsset = {
        key,
        provider,
        assetId,
        filePath: targetPath,
        fileSizeBytes: stats.size,
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
      };
      this.memoryIndex.set(key, asset);
      return asset;
    } catch (err: any) {
      logger.warn({ error: err.message, provider, assetId }, "Failed to cache media asset");
      return null;
    }
  }

  public getUploadsDir(): string {
    return this.uploadsDir;
  }

  public cleanupTempFiles(tempDir: string, maxAgeHours = 4): void {
    try {
      if (!fs.existsSync(tempDir)) return;
      const now = Date.now();
      const files = fs.readdirSync(tempDir);
      for (const file of files) {
        const fullPath = path.join(tempDir, file);
        const stats = fs.statSync(fullPath);
        if (now - stats.mtimeMs > maxAgeHours * 3600 * 1000) {
          fs.removeSync(fullPath);
        }
      }
    } catch (err: any) {
      logger.warn({ error: err.message }, "Error cleaning temporary media files");
    }
  }
}

// DATA_DIR_PATH is the storage root every other service reads. This module used
// DATA_DIR, which nothing sets, so the cache silently lived in a different
// directory from the media library and the artifacts - the kind of split that
// makes a store look as though it emptied itself. DATA_DIR is still honoured for
// an existing deployment that set it.
export const mediaCache = new MediaCache(
  process.env.DATA_DIR_PATH || process.env.DATA_DIR || path.join(process.cwd(), "data"),
);
