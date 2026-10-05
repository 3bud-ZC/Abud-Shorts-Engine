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

const DEFAULT_MAX_CACHE_BYTES = 512 * 1024 * 1024;
const DEFAULT_MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// Only hash-keyed files this class wrote may be evicted - never anything else.
const CACHE_FILE_RE = /^[0-9a-f]{24}\.[a-z0-9]+$/i;

export class MediaCache {
  private cacheDir: string;
  private uploadsDir: string;
  private memoryIndex: Map<string, CachedAsset> = new Map();
  private maxCacheBytes: number;
  private maxCacheAgeMs: number;

  constructor(
    baseDataDir: string,
    limits: { maxCacheBytes?: number; maxCacheAgeMs?: number } = {},
  ) {
    this.cacheDir = path.join(baseDataDir, "cache");
    this.uploadsDir = path.join(baseDataDir, "uploads");
    this.maxCacheBytes =
      limits.maxCacheBytes ??
      (Math.max(0, Number(process.env.ABUD_MEDIA_CACHE_MAX_MB || 0) * 1024 * 1024) ||
        DEFAULT_MAX_CACHE_BYTES);
    this.maxCacheAgeMs =
      limits.maxCacheAgeMs ??
      (Math.max(0, Number(process.env.ABUD_MEDIA_CACHE_MAX_AGE_HOURS || 0) * 3600 * 1000) ||
        DEFAULT_MAX_CACHE_AGE_MS);
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

      this.pruneCacheDir();

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

  // The cache is a pure re-download accelerator - durable copies live under
  // artifacts/scene/media, so every entry here is disposable. Still bounded:
  // entries older than maxCacheAgeMs expire first, then least-recently-touched
  // entries are evicted until total size is under maxCacheBytes. Files touched
  // in the last minute are never evicted (in-flight stages may still copy
  // them out), and files not matching the cache-key pattern are never touched.
  private pruneCacheDir(): void {
    try {
      const now = Date.now();
      const inFlightMs = 60 * 1000;
      let reclaimed = 0;
      const entries = fs
        .readdirSync(this.cacheDir)
        .filter((name) => CACHE_FILE_RE.test(name))
        .map((name) => {
          try {
            return { name, stats: fs.statSync(path.join(this.cacheDir, name)) };
          } catch {
            return null;
          }
        })
        .filter((entry): entry is { name: string; stats: fs.Stats } => entry !== null);

      const expired = entries.filter(
        (e) => now - e.stats.mtimeMs > this.maxCacheAgeMs && now - e.stats.mtimeMs > inFlightMs,
      );
      for (const e of expired) {
        try {
          fs.removeSync(path.join(this.cacheDir, e.name));
          reclaimed += e.stats.size;
        } catch {
          // leave it; retry next save
        }
      }

      let total = entries.reduce((sum, e) => sum + (fs.existsSync(path.join(this.cacheDir, e.name)) ? e.stats.size : 0), 0);
      if (total > this.maxCacheBytes) {
        const survivors = entries
          .filter((e) => fs.existsSync(path.join(this.cacheDir, e.name)))
          .sort((a, b) => a.stats.mtimeMs - b.stats.mtimeMs);
        for (const e of survivors) {
          if (total <= this.maxCacheBytes) break;
          if (now - e.stats.mtimeMs < inFlightMs) continue;
          try {
            fs.removeSync(path.join(this.cacheDir, e.name));
            total -= e.stats.size;
            reclaimed += e.stats.size;
          } catch {
            // leave it; retry next save
          }
        }
      }
      if (reclaimed > 0) {
        logger.info({ reclaimedBytes: reclaimed }, "Media cache eviction reclaimed storage");
      }
    } catch (err: any) {
      logger.warn({ error: err.message }, "Media cache eviction failed; continuing");
    }
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
