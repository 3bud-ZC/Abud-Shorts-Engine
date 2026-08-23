import fs from "fs";
import path from "path";
import fsp from "fs/promises";
import type { Config } from "../../../config";

export type StoragePolicyCheck = {
  ok: boolean;
  dataDir: string;
  videosDir: string;
  tempDir: string;
  availableDiskBytes?: number;
  minFreeDiskBytes: number;
  issues: string[];
};

export type TempCleanupResult = {
  scanned: number;
  deleted: number;
  skipped: number;
  bytesDeleted: number;
};

export function assertPathInside(parentDir: string, candidatePath: string): string {
  const parent = path.resolve(parentDir);
  const candidate = path.resolve(candidatePath);
  if (candidate !== parent && !candidate.startsWith(parent + path.sep)) {
    throw new Error("Path escapes configured storage root.");
  }
  return candidate;
}

export async function checkStoragePolicy(config: Config): Promise<StoragePolicyCheck> {
  const issues: string[] = [];
  const dataDir = path.resolve(config.dataDirPath);
  const videosDir = assertPathInside(dataDir, config.videosDirPath);
  const tempDir = assertPathInside(dataDir, config.tempDirPath);

  for (const dir of [dataDir, videosDir, tempDir]) {
    try {
      await fsp.mkdir(dir, { recursive: true });
      await fsp.access(dir, fs.constants.R_OK | fs.constants.W_OK);
    } catch (error) {
      issues.push(`${dir}: ${error instanceof Error ? error.message : "not writable"}`);
    }
  }

  const availableDiskBytes = await readAvailableDiskBytes(dataDir);
  if (
    typeof availableDiskBytes === "number" &&
    availableDiskBytes < config.minFreeDiskBytes
  ) {
    issues.push(
      `Available disk ${availableDiskBytes} bytes is below guard ${config.minFreeDiskBytes} bytes.`,
    );
  }

  return {
    ok: issues.length === 0,
    dataDir,
    videosDir,
    tempDir,
    availableDiskBytes,
    minFreeDiskBytes: config.minFreeDiskBytes,
    issues,
  };
}

export async function assertStorageReady(config: Config): Promise<void> {
  const check = await checkStoragePolicy(config);
  if (!check.ok) {
    throw new Error(`Storage policy failed: ${check.issues.join("; ")}`);
  }
}

export async function cleanupTemporaryArtifacts(config: Config): Promise<TempCleanupResult> {
  const tempDir = assertPathInside(config.dataDirPath, config.tempDirPath);
  await fsp.mkdir(tempDir, { recursive: true });
  const cutoff = Date.now() - config.tempMaxAgeMs;
  const result: TempCleanupResult = {
    scanned: 0,
    deleted: 0,
    skipped: 0,
    bytesDeleted: 0,
  };
  await cleanupDirectory(tempDir, cutoff, result, tempDir);
  return result;
}

async function cleanupDirectory(
  dir: string,
  cutoff: number,
  result: TempCleanupResult,
  root: string,
): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const target = assertPathInside(root, path.join(dir, entry.name));
    result.scanned += 1;
    if (entry.isDirectory()) {
      await cleanupDirectory(target, cutoff, result, root);
      try {
        await fsp.rmdir(target);
      } catch {
        result.skipped += 1;
      }
      continue;
    }
    if (!entry.isFile()) {
      result.skipped += 1;
      continue;
    }
    try {
      const stat = await fsp.stat(target);
      if (stat.mtimeMs > cutoff) {
        result.skipped += 1;
        continue;
      }
      await fsp.unlink(target);
      result.deleted += 1;
      result.bytesDeleted += stat.size;
    } catch {
      result.skipped += 1;
    }
  }
}

async function readAvailableDiskBytes(dir: string): Promise<number | undefined> {
  const statfs = (fsp as typeof fsp & {
    statfs?: (path: string) => Promise<{ bavail: number; bsize: number }>;
  }).statfs;
  if (!statfs) return undefined;
  try {
    const stat = await statfs(dir);
    return stat.bavail * stat.bsize;
  } catch {
    return undefined;
  }
}
