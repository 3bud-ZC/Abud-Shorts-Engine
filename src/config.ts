import path from "path";
import "dotenv/config";
import os from "os";
import fs from "fs-extra";
import pino from "pino";
import { kokoroModelPrecision, whisperModels } from "./types/shorts";

const defaultLogLevel: pino.Level = "info";
const defaultPort = 3123;
const whisperVersion = "1.7.1";
const defaultWhisperModel: whisperModels = "medium.en";

// Create the global logger
const versionNumber = process.env.npm_package_version;
export const logger = pino({
  level: process.env.LOG_LEVEL || defaultLogLevel,
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  base: {
    pid: process.pid,
    version: versionNumber,
  },
});

export class Config {
  public dataDirPath: string;
  public libsDirPath: string;
  public staticDirPath: string;

  public installationSuccessfulPath: string;
  public whisperInstallPath: string;
  public videosDirPath: string;
  public tempDirPath: string;
  public packageDirPath: string;
  public musicDirPath: string;
  public pexelsApiKey: string;
  public logLevel: pino.Level;
  public whisperVerbose: boolean;
  public port: number;
  public runningInDocker: boolean;
  public devMode: boolean;
  public whisperVersion: string = whisperVersion;
  public whisperModel: whisperModels = defaultWhisperModel;
  public kokoroModelPrecision: kokoroModelPrecision = "fp32";
  public serviceRole: "app" | "render-worker";
  public databaseUrl?: string;
  public internalServiceToken: string;
  public n8nBaseUrl: string;
  public n8nWebhookPath: string;
  public renderWorkerBaseUrl: string;
  public appInternalBaseUrl: string;
  public v2PublicUrl: string;
  public pexelsValidationTimeoutMs: number;

  // docker-specific, performance-related settings to prevent memory issues
  public concurrency?: number;
  public videoCacheSizeInBytes: number | null = null;

  constructor() {
    this.dataDirPath =
      process.env.DATA_DIR_PATH ||
      path.join(os.homedir(), ".ai-agents-az-video-generator");
    this.libsDirPath = path.join(this.dataDirPath, "libs");

    this.whisperInstallPath = path.join(this.libsDirPath, "whisper");
    this.videosDirPath = path.join(this.dataDirPath, "videos");
    this.tempDirPath = path.join(this.dataDirPath, "temp");
    this.installationSuccessfulPath = path.join(
      this.dataDirPath,
      "installation-successful",
    );

    fs.ensureDirSync(this.dataDirPath);
    fs.ensureDirSync(this.libsDirPath);
    fs.ensureDirSync(this.videosDirPath);
    fs.ensureDirSync(this.tempDirPath);

    this.packageDirPath = path.join(__dirname, "..");
    this.staticDirPath = path.join(this.packageDirPath, "static");
    this.musicDirPath = path.join(this.staticDirPath, "music");

    this.pexelsApiKey = process.env.PEXELS_API_KEY as string;
    this.logLevel = (process.env.LOG_LEVEL || defaultLogLevel) as pino.Level;
    this.whisperVerbose = process.env.WHISPER_VERBOSE === "true";
    this.port = process.env.PORT ? parseInt(process.env.PORT) : defaultPort;
    this.runningInDocker = process.env.DOCKER === "true";
    this.devMode = process.env.DEV === "true";
    this.serviceRole =
      process.env.SERVICE_ROLE === "render-worker" ? "render-worker" : "app";
    this.databaseUrl = process.env.DATABASE_URL;
    this.internalServiceToken = process.env.INTERNAL_SERVICE_TOKEN || "";
    this.n8nBaseUrl = process.env.N8N_BASE_URL || "http://localhost:5678";
    this.n8nWebhookPath =
      process.env.N8N_WEBHOOK_PATH || "/webhook/abud-v2/jobs/start";
    this.renderWorkerBaseUrl =
      process.env.RENDER_WORKER_BASE_URL || "http://localhost:3123";
    this.appInternalBaseUrl =
      process.env.APP_INTERNAL_BASE_URL || `http://localhost:${this.port}`;
    this.v2PublicUrl = process.env.V2_PUBLIC_URL || `http://localhost:${this.port}`;
    this.pexelsValidationTimeoutMs = process.env.PEXELS_VALIDATION_TIMEOUT_MS
      ? parseInt(process.env.PEXELS_VALIDATION_TIMEOUT_MS)
      : 12000;

    if (process.env.WHISPER_MODEL) {
      this.whisperModel = process.env.WHISPER_MODEL as whisperModels;
    }
    if (process.env.KOKORO_MODEL_PRECISION) {
      this.kokoroModelPrecision = process.env
        .KOKORO_MODEL_PRECISION as kokoroModelPrecision;
    }

    this.concurrency = process.env.CONCURRENCY
      ? parseInt(process.env.CONCURRENCY)
      : undefined;

    if (process.env.VIDEO_CACHE_SIZE_IN_BYTES) {
      this.videoCacheSizeInBytes = parseInt(
        process.env.VIDEO_CACHE_SIZE_IN_BYTES,
      );
    }
  }

  public ensureConfig() {
    if (!this.pexelsApiKey) {
      if (process.env.V2_ENABLED === "true") {
        logger.warn(
          "PEXELS_API_KEY is missing. V2 will start, but local video generation will fail until Pexels is configured.",
        );
      } else {
        throw new Error(
          "PEXELS_API_KEY environment variable is missing. Get your free API key: https://www.pexels.com/api/key/ - see how to run the project: https://github.com/gyoridavid/short-video-maker",
        );
      }
    }
    if (process.env.V2_ENABLED === "true" && !this.internalServiceToken) {
      throw new Error(
        "INTERNAL_SERVICE_TOKEN is required when V2_ENABLED=true.",
      );
    }
  }
}

export const KOKORO_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
