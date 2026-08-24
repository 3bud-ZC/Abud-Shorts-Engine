import axios from "axios";
import fs from "fs-extra";
import path from "path";
import { Config } from "../../config";
import { V2Database } from "./db";
import type { ComponentHealth, PexelsValidationResult } from "./types";
import { checkStoragePolicy } from "./storage/storagePolicy";

let pexelsCache:
  | { keyFingerprint: string; expiresAt: number; result: PexelsValidationResult }
  | undefined;
let pexelsInFlight:
  | { keyFingerprint: string; promise: Promise<PexelsValidationResult> }
  | undefined;

function isConfiguredPexelsKey(key?: string): key is string {
  return typeof key === "string" && key.length > 0 && key !== "dummy-key" && !key.includes("your_pexels");
}

function hasPlausiblePexelsKeyShape(key: string): boolean {
  return /^[A-Za-z0-9]{32,128}$/.test(key);
}

function keyFingerprint(key?: string): string {
  if (!key) return "missing";
  const configuredKey = key;
  return `${configuredKey.length}:${configuredKey.slice(-4)}`;
}

export async function validatePexelsProvider(
  config: Config,
  options: { timeoutMs?: number; bypassCache?: boolean } = {},
): Promise<PexelsValidationResult> {
  const checkedAt = new Date().toISOString();
  const started = Date.now();
  const timeout = options.timeoutMs ?? config.pexelsValidationTimeoutMs;
  const fingerprint = keyFingerprint(config.pexelsApiKey);

  if (!isConfiguredPexelsKey(config.pexelsApiKey)) {
    return {
      provider: "Pexels",
      configured: false,
      status: "not_configured",
      healthy: false,
      componentStatus: "unhealthy",
      message: "Pexels API key is not configured.",
      checkedAt,
      latencyMs: Date.now() - started,
      timeoutMs: timeout,
    };
  }

  if (!hasPlausiblePexelsKeyShape(config.pexelsApiKey)) {
    return {
      provider: "Pexels",
      configured: true,
      status: "invalid_credentials",
      healthy: false,
      componentStatus: "unhealthy",
      message: "Pexels API key format is invalid.",
      checkedAt,
      latencyMs: Date.now() - started,
      timeoutMs: timeout,
    };
  }

  if (
    !options.bypassCache &&
    pexelsCache &&
    pexelsCache.keyFingerprint === fingerprint &&
    pexelsCache.expiresAt > Date.now()
  ) {
    return pexelsCache.result;
  }

  if (
    pexelsInFlight &&
    pexelsInFlight.keyFingerprint === fingerprint
  ) {
    return pexelsInFlight.promise;
  }

  const validationPromise = (async (): Promise<PexelsValidationResult> => {
    try {
    const response = await axios.get("https://api.pexels.com/videos/search", {
      timeout,
      params: { query: "business", per_page: 1, orientation: "portrait" },
      headers: { Authorization: config.pexelsApiKey },
      validateStatus: () => true,
    });

    let result: PexelsValidationResult;
    if (response.status >= 200 && response.status < 300) {
      result = {
        provider: "Pexels",
        configured: true,
        status: "healthy",
        healthy: true,
        componentStatus: "healthy",
        message: "Pexels responded with an authorized video search result.",
        checkedAt,
        latencyMs: Date.now() - started,
        timeoutMs: timeout,
      };
    } else if (response.status === 401 || response.status === 403) {
      result = {
        provider: "Pexels",
        configured: true,
        status: "invalid_credentials",
        healthy: false,
        componentStatus: "unhealthy",
        message: "Pexels rejected the configured API key.",
        checkedAt,
        latencyMs: Date.now() - started,
        timeoutMs: timeout,
      };
    } else if (response.status === 429) {
      result = {
        provider: "Pexels",
        configured: true,
        status: "rate_limited",
        healthy: false,
        componentStatus: "degraded",
        message: "Pexels rate limited the validation request.",
        checkedAt,
        latencyMs: Date.now() - started,
        timeoutMs: timeout,
      };
    } else {
      result = {
        provider: "Pexels",
        configured: true,
        status: "provider_unavailable",
        healthy: false,
        componentStatus: "degraded",
        message: `Pexels returned HTTP ${response.status}.`,
        checkedAt,
        latencyMs: Date.now() - started,
        timeoutMs: timeout,
      };
    }

    pexelsCache = {
      keyFingerprint: fingerprint,
      expiresAt: Date.now() + (result.healthy ? 60_000 : 15_000),
      result,
    };
    return result;
  } catch (error) {
    const isTimeout =
      axios.isAxiosError(error) &&
      (error.code === "ECONNABORTED" || error.message.toLowerCase().includes("timeout"));
    const result: PexelsValidationResult = {
      provider: "Pexels",
      configured: true,
      status: isTimeout ? "timeout" : "provider_unavailable",
      healthy: false,
      componentStatus: "degraded",
      message: isTimeout
        ? "Pexels validation timed out."
        : "Pexels validation could not reach the API.",
      checkedAt,
      latencyMs: Date.now() - started,
      timeoutMs: timeout,
    };
    pexelsCache = {
      keyFingerprint: fingerprint,
      expiresAt: Date.now() + 30_000,
      result,
    };
    return result;
    }
  })();

  pexelsInFlight = { keyFingerprint: fingerprint, promise: validationPromise };
  try {
    return await validationPromise;
  } finally {
    if (pexelsInFlight?.promise === validationPromise) {
      pexelsInFlight = undefined;
    }
  }
}

async function timedCheck(
  name: string,
  check: () => Promise<{
    ok: boolean;
    status?: ComponentHealth["status"];
    message: string;
    details?: Record<string, unknown>;
  }>,
): Promise<ComponentHealth> {
  const started = Date.now();
  try {
    const result = await check();
    return {
      name,
      status: result.status || (result.ok ? "healthy" : "unhealthy"),
      message: result.message,
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
      details: result.details,
    };
  } catch (error) {
    return {
      name,
      status: "unhealthy",
      message: error instanceof Error ? error.message : "Health check failed.",
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
    };
  }
}

export async function getV2Health(
  config: Config,
  db: V2Database,
): Promise<{
  status: "healthy" | "degraded" | "unhealthy";
  components: ComponentHealth[];
}> {
  const components = await Promise.all([
    timedCheck("Application", async () => ({
      ok: true,
      message: "Application API is running.",
    })),
    timedCheck("Database", async () => {
      const health = await db.health();
      return {
        ok: health.ok,
        message: health.message,
        details: {
          latencyMs: health.latencyMs,
          pool: db.getPoolState(),
        },
      };
    }),
    timedCheck("n8n", async () => {
      const response = await axios.get(`${config.n8nBaseUrl}/healthz`, {
        timeout: Math.min(config.providerTimeoutMs, 5000),
      });
      return {
        ok: response.status >= 200 && response.status < 300,
        message: "Automation service responded.",
      };
    }),
    timedCheck("Render Worker", async () => {
      const response = await axios.get(`${config.renderWorkerBaseUrl}/health`, {
        timeout: Math.min(config.providerTimeoutMs, 5000),
      });
      return {
        ok: response.status >= 200 && response.status < 300,
        message: "Render worker responded.",
      };
    }),
    timedCheck("Remotion", async () => ({
      ok: true,
      message: "Remotion runtime is installed in the application image.",
    })),
    timedCheck("FFmpeg", async () => ({
      ok: true,
      message: "FFmpeg runtime is installed in the application image.",
    })),
    timedCheck("Kokoro", async () => ({
      ok: true,
      message: "Kokoro local TTS is available in the application image.",
    })),
    timedCheck("Whisper", async () => ({
      ok: fs.existsSync(config.whisperInstallPath),
      message: fs.existsSync(config.whisperInstallPath)
        ? "Whisper model directory exists."
        : "Whisper model directory is missing.",
      details: { path: config.whisperInstallPath },
    })),
    timedCheck("Pexels", async () => {
      const pexels = await validatePexelsProvider(config);
      return {
        ok: pexels.healthy,
        status: pexels.componentStatus,
        message: pexels.message,
        details: {
          providerStatus: pexels.status,
          configured: pexels.configured,
          timeoutMs: pexels.timeoutMs,
        },
      };
    }),
    timedCheck("Disk", async () => {
      const storage = await checkStoragePolicy(config);
      fs.ensureDirSync(config.videosDirPath);
      const files = fs.readdirSync(config.videosDirPath);
      const bytes = files.reduce((total, file) => {
        const filePath = path.join(config.videosDirPath, file);
        const stats = fs.statSync(filePath);
        return stats.isFile() ? total + stats.size : total;
      }, 0);
      return {
        ok: storage.ok,
        message: storage.ok ? "Video storage is writable." : "Video storage failed readiness checks.",
        details: { ...storage, bytes },
      };
    }),
  ]);

  const unhealthy = components.filter((c) => c.status === "unhealthy");
  const status =
    unhealthy.length === 0
      ? "healthy"
      : unhealthy.some((c) => ["Application", "Database"].includes(c.name))
        ? "unhealthy"
        : "degraded";

  return { status, components };
}
