import fs from "fs-extra";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { MediaCache } from "./mediaCache";

function makeCache(limits: { maxCacheBytes?: number; maxCacheAgeMs?: number } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "media-cache-test-"));
  return { dir, cache: new MediaCache(dir, limits) };
}

function writeSource(bytes: number) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "media-src-")), "src.mp4");
  fs.writeFileSync(f, Buffer.alloc(bytes, 1));
  return f;
}

describe("MediaCache bounded retention", () => {
  it("stores and retrieves a cached asset", () => {
    const { cache } = makeCache();
    const src = writeSource(128);
    cache.saveCachedAsset("pexels", "asset-1", src);
    const hit = cache.getCachedAsset("pexels", "asset-1");
    expect(hit).not.toBeNull();
    expect(fs.existsSync(hit!.filePath)).toBe(true);
    expect(hit!.fileSizeBytes).toBe(128);
  });

  it("evicts least-recently-touched entries when total size exceeds the cap", () => {
    const { dir, cache } = makeCache({ maxCacheBytes: 300 });
    const src = writeSource(200);
    const old = cache.saveCachedAsset("pexels", "old-asset", src)!;
    // Age the first entry so it loses LRU to anything written later.
    const past = new Date(Date.now() - 5 * 60 * 1000);
    fs.utimesSync(old.filePath, past, past);
    cache.saveCachedAsset("pexels", "new-asset", src);
    // new-asset (200 bytes) is inside its in-flight grace and survives; the
    // stale old-asset must be evicted to bring the total under the cap.
    expect(fs.existsSync(old.filePath)).toBe(false);
    expect(fs.existsSync(cache.getCachedAsset("pexels", "new-asset")!.filePath)).toBe(true);
    expect(fs.readdirSync(path.join(dir, "cache")).length).toBe(1);
  });

  it("expires entries older than the max age", () => {
    const { dir, cache } = makeCache({ maxCacheAgeMs: 60 * 1000 });
    const src = writeSource(64);
    const stale = cache.saveCachedAsset("pexels", "stale", src)!;
    const past = new Date(Date.now() - 10 * 60 * 1000);
    fs.utimesSync(stale.filePath, past, past);
    cache.saveCachedAsset("pexels", "fresh", src);
    expect(fs.existsSync(stale.filePath)).toBe(false);
    expect(cache.getCachedAsset("pexels", "fresh")).not.toBeNull();
  });

  it("never touches files that do not match the cache-key pattern", () => {
    const { dir, cache } = makeCache({ maxCacheBytes: 1 });
    const foreign = path.join(dir, "cache", "customer-upload.mp4");
    fs.writeFileSync(foreign, Buffer.alloc(64, 2));
    cache.saveCachedAsset("pexels", "asset-9", writeSource(64));
    expect(fs.existsSync(foreign)).toBe(true);
  });

  it("keeps a just-written entry even if it alone exceeds the cap", () => {
    const { cache } = makeCache({ maxCacheBytes: 10 });
    const saved = cache.saveCachedAsset("pexels", "big", writeSource(1024))!;
    expect(fs.existsSync(saved.filePath)).toBe(true);
  });
});
