import crypto from "crypto";
import path from "path";
import fs from "fs-extra";
import type { Config } from "../../../config";

export type DurableArtifactType = "voice" | "captions" | "media" | "mastered_voice";

export type DurableSceneArtifact = {
  artifactId: string;
  type: DurableArtifactType;
  sceneIndex: number;
  segmentIndex?: number;
  sourceJobId: string;
  sourceRevisionId?: string;
  provider?: string;
  model?: string;
  inputHash: string;
  storageRef: string;
  checksum: string;
  duration?: number;
  createdAt: string;
  metadata: Record<string, unknown>;
  valid: boolean;
  supersededAt?: string;
};

export type ReusePlan = {
  artifacts: DurableSceneArtifact[];
  reusedStages: string[];
  regeneratedStages: string[];
};

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
}

export function sha256Text(value: unknown): string {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function createVoiceInputHash(input: {
  spokenNarration: string;
  provider?: string;
  model?: string;
  voiceId?: string;
  language?: string;
  dialect?: string;
  qualityProfile?: string;
  pace?: string;
  style?: string;
  /** ElevenLabs delivery preset, when one was selected. */
  voicePreset?: string;
  preprocessingVersion?: string;
}): string {
  return sha256Text({
    type: "voice",
    spokenNarration: input.spokenNarration.trim(),
    provider: input.provider || "auto",
    model: input.model || "auto",
    voiceId: input.voiceId || "default",
    language: input.language || "auto",
    dialect: input.dialect || "none",
    qualityProfile: input.qualityProfile || "balanced",
    pace: input.pace || "normal",
    style: input.style || "default",
    preprocessingVersion: input.preprocessingVersion || "arabic-preprocessor-v2",
    // Only hashed when a preset is actually in play, so hashes recorded before
    // presets existed keep matching and historical artifacts stay reusable.
    ...(input.voicePreset ? { voicePreset: input.voicePreset } : {}),
  });
}

export function createCaptionInputHash(input: {
  voiceChecksum: string;
  whisperModel?: string;
  language?: string;
  timingConfig?: string;
}): string {
  return sha256Text({
    type: "captions",
    voiceChecksum: input.voiceChecksum,
    whisperModel: input.whisperModel || "small",
    language: input.language || "auto",
    timingConfig: input.timingConfig || "word-timings-v1",
  });
}

export function createMediaInputHash(input: {
  provider?: string;
  sourceId?: string | number;
  url?: string;
  selectedClip?: unknown;
  crop?: unknown;
  visualIntent?: string;
  sceneIndex: number;
  segmentIndex?: number;
}): string {
  return sha256Text({
    type: "media",
    provider: input.provider || "unknown",
    sourceId: input.sourceId || input.url || "unknown",
    selectedClip: input.selectedClip || null,
    crop: input.crop || null,
    visualIntent: input.visualIntent || "",
    sceneIndex: input.sceneIndex,
    segmentIndex: input.segmentIndex ?? null,
  });
}

function safeTypeDir(type: DurableArtifactType): string {
  return type === "mastered_voice" ? "mastered_voice" : type;
}

export class DurableArtifactStore {
  private artifactRoot: string;

  constructor(private config: Config) {
    this.artifactRoot = path.join(config.dataDirPath, "artifacts", "scene");
    fs.ensureDirSync(this.artifactRoot);
  }

  public root(): string {
    return this.artifactRoot;
  }

  public resolveStorageRef(storageRef: string): string {
    const normalized = String(storageRef || "").replace(/\\/g, "/");
    if (!normalized.startsWith("artifacts/scene/") || normalized.includes("..")) {
      throw new Error("Invalid durable artifact storage reference.");
    }
    const resolved = path.resolve(this.config.dataDirPath, normalized);
    const dataRoot = path.resolve(this.config.dataDirPath);
    if (!resolved.startsWith(dataRoot + path.sep)) {
      throw new Error("Durable artifact reference escapes data directory.");
    }
    return resolved;
  }

  public readJsonArtifact<T = unknown>(artifact: DurableSceneArtifact): T {
    if (artifact.type !== "captions") throw new Error("Artifact is not JSON caption data.");
    return fs.readJsonSync(this.resolveStorageRef(artifact.storageRef)) as T;
  }

  public copyToTemp(artifact: DurableSceneArtifact, destinationPath: string): void {
    const src = this.resolveStorageRef(artifact.storageRef);
    if (!artifact.valid || !fs.existsSync(src)) {
      throw new Error(`Reusable artifact ${artifact.artifactId} is unavailable.`);
    }
    const checksum = sha256File(src);
    if (checksum !== artifact.checksum) {
      throw new Error(`Reusable artifact ${artifact.artifactId} checksum mismatch.`);
    }
    fs.copySync(src, destinationPath);
  }

  public persistFile(input: {
    type: DurableArtifactType;
    sceneIndex: number;
    segmentIndex?: number;
    sourceJobId: string;
    sourceRevisionId?: string;
    provider?: string;
    model?: string;
    inputHash: string;
    sourcePath: string;
    extension: string;
    duration?: number;
    metadata?: Record<string, unknown>;
  }): DurableSceneArtifact {
    const checksum = sha256File(input.sourcePath);
    const artifactId = `${input.type}_${input.inputHash.slice(0, 16)}_${checksum.slice(0, 12)}`;
    const relative = path.posix.join(
      "artifacts",
      "scene",
      safeTypeDir(input.type),
      `${artifactId}.${input.extension.replace(/^\./, "")}`,
    );
    const dest = this.resolveStorageRef(relative);
    fs.ensureDirSync(path.dirname(dest));
    if (!fs.existsSync(dest)) {
      fs.copySync(input.sourcePath, dest);
    }
    return this.writeManifest({
      artifactId,
      type: input.type,
      sceneIndex: input.sceneIndex,
      segmentIndex: input.segmentIndex,
      sourceJobId: input.sourceJobId,
      sourceRevisionId: input.sourceRevisionId,
      provider: input.provider,
      model: input.model,
      inputHash: input.inputHash,
      storageRef: relative,
      checksum,
      duration: input.duration,
      createdAt: new Date().toISOString(),
      metadata: input.metadata || {},
      valid: true,
    });
  }

  public persistJson(input: {
    type: "captions";
    sceneIndex: number;
    sourceJobId: string;
    sourceRevisionId?: string;
    provider?: string;
    model?: string;
    inputHash: string;
    payload: unknown;
    duration?: number;
    metadata?: Record<string, unknown>;
  }): DurableSceneArtifact {
    const payloadText = JSON.stringify(input.payload, null, 2);
    const checksum = crypto.createHash("sha256").update(payloadText).digest("hex");
    const artifactId = `${input.type}_${input.inputHash.slice(0, 16)}_${checksum.slice(0, 12)}`;
    const relative = path.posix.join("artifacts", "scene", "captions", `${artifactId}.json`);
    const dest = this.resolveStorageRef(relative);
    fs.ensureDirSync(path.dirname(dest));
    if (!fs.existsSync(dest)) {
      fs.writeFileSync(dest, payloadText);
    }
    return this.writeManifest({
      artifactId,
      type: input.type,
      sceneIndex: input.sceneIndex,
      sourceJobId: input.sourceJobId,
      sourceRevisionId: input.sourceRevisionId,
      provider: input.provider,
      model: input.model,
      inputHash: input.inputHash,
      storageRef: relative,
      checksum,
      duration: input.duration,
      createdAt: new Date().toISOString(),
      metadata: input.metadata || {},
      valid: true,
    });
  }

  public writeManifest(artifact: DurableSceneArtifact): DurableSceneArtifact {
    const manifestPath = this.manifestPath(artifact);
    fs.ensureDirSync(path.dirname(manifestPath));
    fs.writeJsonSync(manifestPath, artifact, { spaces: 2 });
    return artifact;
  }

  private manifestPath(artifact: DurableSceneArtifact): string {
    return path.join(this.artifactRoot, safeTypeDir(artifact.type), `${artifact.artifactId}.manifest.json`);
  }
}

function manifestTypeFromArtifactId(artifactId: string): DurableArtifactType | null {
  if (artifactId.startsWith("voice_")) return "voice";
  if (artifactId.startsWith("captions_")) return "captions";
  if (artifactId.startsWith("media_")) return "media";
  if (artifactId.startsWith("mastered_voice_")) return "mastered_voice";
  return null;
}

export function readDurableArtifactsForSourceJob(config: Config, sourceJobId: string): DurableSceneArtifact[] {
  const root = path.join(config.dataDirPath, "artifacts", "scene");
  if (!sourceJobId || !fs.existsSync(root)) return [];
  const found: DurableSceneArtifact[] = [];
  const scan = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(fullPath);
        continue;
      }
      if (!entry.name.endsWith(".manifest.json")) continue;
      try {
        const artifact = fs.readJsonSync(fullPath) as DurableSceneArtifact;
        if (artifact?.sourceJobId === sourceJobId && filterReusableArtifacts({ artifacts: [artifact] }).length === 1) {
          found.push(artifact);
        }
      } catch {
        // Ignore malformed historical manifests; retry can still proceed with
        // the artifacts that validate.
      }
    }
  };
  scan(root);
  return found.sort((a, b) => {
    if (a.sceneIndex !== b.sceneIndex) return a.sceneIndex - b.sceneIndex;
    return a.type.localeCompare(b.type);
  });
}

export function readDurableArtifactsById(config: Config, artifactIds: string[]): DurableSceneArtifact[] {
  const store = new DurableArtifactStore(config);
  const unique = Array.from(new Set(artifactIds.filter(Boolean)));
  const found: DurableSceneArtifact[] = [];
  for (const artifactId of unique) {
    const type = manifestTypeFromArtifactId(artifactId);
    if (!type) continue;
    const relative = path.posix.join(
      "artifacts",
      "scene",
      type === "mastered_voice" ? "mastered_voice" : type,
      `${artifactId}.manifest.json`,
    );
    try {
      const manifestPath = store.resolveStorageRef(relative);
      if (!fs.existsSync(manifestPath)) continue;
      const artifact = fs.readJsonSync(manifestPath) as DurableSceneArtifact;
      if (filterReusableArtifacts({ artifacts: [artifact] }).length === 1) found.push(artifact);
    } catch {
      // Invalid IDs or missing manifests are ignored; retry remains bounded.
    }
  }
  return found;
}

export function filterReusableArtifacts(input: {
  artifacts: DurableSceneArtifact[];
  type?: DurableArtifactType;
  sceneIndex?: number;
  validOnly?: boolean;
}): DurableSceneArtifact[] {
  return (input.artifacts || []).filter((artifact) => {
    if (!artifact || typeof artifact.artifactId !== "string") return false;
    if (input.type && artifact.type !== input.type) return false;
    if (typeof input.sceneIndex === "number" && artifact.sceneIndex !== input.sceneIndex) return false;
    if (input.validOnly !== false && artifact.valid !== true) return false;
    if (!artifact.storageRef || artifact.storageRef.includes("..") || artifact.storageRef.startsWith("/") || /^[a-zA-Z]:/.test(artifact.storageRef)) {
      return false;
    }
    return true;
  });
}

export function buildRevisionReusePlan(params: {
  changeType: "voice" | "media" | "caption" | "display_text" | "music";
  artifacts: DurableSceneArtifact[];
  changedSceneIndex?: number;
}): ReusePlan {
  const artifacts = filterReusableArtifacts({ artifacts: params.artifacts });
  if (params.changeType === "voice") {
    return {
      artifacts: artifacts.filter((artifact) => artifact.type === "media"),
      reusedStages: ["planning", "media"],
      regeneratedStages: ["voice", "captions", "mastering", "render", "validation"],
    };
  }
  if (params.changeType === "media") {
    return {
      artifacts: artifacts.filter((artifact) => {
        if (artifact.type === "voice" || artifact.type === "captions" || artifact.type === "mastered_voice") return true;
        return artifact.type === "media" && artifact.sceneIndex !== params.changedSceneIndex;
      }),
      reusedStages: ["planning", "voice", "captions"],
      regeneratedStages: [`scene:${params.changedSceneIndex}:media`, "render", "mastering", "validation"],
    };
  }
  if (params.changeType === "caption") {
    return {
      artifacts,
      reusedStages: ["planning", "media", "voice", "speech_timings"],
      regeneratedStages: ["render", "validation"],
    };
  }
  if (params.changeType === "display_text") {
    return {
      artifacts,
      reusedStages: ["voice", "speech_timings", "media"],
      regeneratedStages: ["render", "validation"],
    };
  }
  return {
    artifacts: artifacts.filter((artifact) => artifact.type === "voice" || artifact.type === "captions" || artifact.type === "media" || artifact.type === "mastered_voice"),
    reusedStages: ["planning", "media", "voice", "captions"],
    regeneratedStages: ["final_audio_mix", "mastering", "render", "validation"],
  };
}
