import fs from "fs-extra";
import path from "path";
import os from "os";
import { describe, expect, it } from "vitest";
import {
  DurableArtifactStore,
  buildRevisionReusePlan,
  createCaptionInputHash,
  createMediaInputHash,
  createVoiceInputHash,
  filterReusableArtifacts,
  type DurableSceneArtifact,
} from "./durableArtifacts";
import type { Config } from "../../../config";

function tempConfig(): Config {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "abud-artifacts-"));
  return {
    port: 3130,
    publicBaseUrl: "http://localhost:3130",
    tempDirPath: path.join(root, "temp"),
    videosDirPath: path.join(root, "videos"),
    dataDirPath: path.join(root, "data"),
  } as Config;
}

function artifact(overrides: Partial<DurableSceneArtifact>): DurableSceneArtifact {
  return {
    artifactId: overrides.artifactId || `${overrides.type || "voice"}-${overrides.sceneIndex || 0}`,
    type: overrides.type || "voice",
    sceneIndex: overrides.sceneIndex ?? 0,
    segmentIndex: overrides.segmentIndex,
    sourceJobId: overrides.sourceJobId || "job-base",
    sourceRevisionId: overrides.sourceRevisionId || "rev-base",
    provider: overrides.provider || "piper",
    model: overrides.model || "ar_JO-kareem-medium",
    inputHash: overrides.inputHash || "hash",
    storageRef: overrides.storageRef || `artifacts/scene/${overrides.type || "voice"}/x.bin`,
    checksum: overrides.checksum || "checksum",
    duration: overrides.duration ?? 1.25,
    createdAt: overrides.createdAt || "2026-08-23T00:00:00.000Z",
    metadata: overrides.metadata || {},
    valid: overrides.valid ?? true,
    supersededAt: overrides.supersededAt,
  };
}

describe("durable scene artifacts", () => {
  it("persists reusable voice files with checksum validation", () => {
    const config = tempConfig();
    const store = new DurableArtifactStore(config);
    const source = path.join(config.tempDirPath, "voice.mp3");
    fs.ensureDirSync(path.dirname(source));
    fs.writeFileSync(source, Buffer.from("voice-audio"));

    const saved = store.persistFile({
      type: "voice",
      sceneIndex: 0,
      sourceJobId: "job-a",
      sourceRevisionId: "rev-a",
      provider: "piper",
      model: "ar_JO-kareem-medium",
      inputHash: createVoiceInputHash({ spokenNarration: "اهلا", provider: "piper", model: "ar_JO-kareem-medium" }),
      sourcePath: source,
      extension: "mp3",
      duration: 1,
      metadata: { reuseKey: { language: "ar", dialect: "egyptian" } },
    });

    const copied = path.join(config.tempDirPath, "copy.mp3");
    store.copyToTemp(saved, copied);
    expect(fs.readFileSync(copied, "utf8")).toBe("voice-audio");
    expect(saved.storageRef).toMatch(/^artifacts\/scene\/voice\//);
    expect(saved.checksum).toHaveLength(64);
  });

  it("rejects unsafe artifact storage references", () => {
    const store = new DurableArtifactStore(tempConfig());
    expect(() => store.resolveStorageRef("../outside.mp3")).toThrow();
    expect(() => store.resolveStorageRef("C:/outside.mp3")).toThrow();
    expect(filterReusableArtifacts({ artifacts: [artifact({ storageRef: "../outside.mp3" })] })).toHaveLength(0);
  });

  it("uses deterministic hashes for voice, caption, and media reuse keys", () => {
    const voiceA = createVoiceInputHash({ spokenNarration: "AI API SEO", provider: "piper", voiceId: "kareem" });
    const voiceB = createVoiceInputHash({ spokenNarration: "AI API SEO updated", provider: "piper", voiceId: "kareem" });
    expect(voiceA).not.toBe(voiceB);
    expect(createCaptionInputHash({ voiceChecksum: "abc", whisperModel: "ggml-small.bin" }))
      .toBe(createCaptionInputHash({ voiceChecksum: "abc", whisperModel: "ggml-small.bin" }));
    expect(createMediaInputHash({ provider: "pexels", sourceId: 123, sceneIndex: 1 }))
      .not.toBe(createMediaInputHash({ provider: "pexels", sourceId: 456, sceneIndex: 1 }));
  });

  it("plans media-only revisions without voice or Whisper regeneration", () => {
    const artifacts = [
      artifact({ type: "voice", sceneIndex: 0, artifactId: "voice-0" }),
      artifact({ type: "captions", sceneIndex: 0, artifactId: "captions-0" }),
      artifact({ type: "media", sceneIndex: 0, artifactId: "media-0" }),
      artifact({ type: "media", sceneIndex: 1, artifactId: "media-1" }),
    ];
    const plan = buildRevisionReusePlan({ changeType: "media", artifacts, changedSceneIndex: 1 });
    expect(plan.reusedStages).toEqual(["planning", "voice", "captions"]);
    expect(plan.regeneratedStages).toContain("scene:1:media");
    expect(plan.artifacts.map((item) => item.artifactId)).toEqual(["voice-0", "captions-0", "media-0"]);
  });

  it("invalidates voice revisions downstream while retaining media", () => {
    const plan = buildRevisionReusePlan({
      changeType: "voice",
      artifacts: [
        artifact({ type: "voice", sceneIndex: 0, artifactId: "voice-0" }),
        artifact({ type: "captions", sceneIndex: 0, artifactId: "captions-0" }),
        artifact({ type: "media", sceneIndex: 0, artifactId: "media-0" }),
      ],
    });
    expect(plan.artifacts.map((item) => item.type)).toEqual(["media"]);
    expect(plan.regeneratedStages).toContain("captions");
  });

  it("reuses speech timings for caption-style revisions", () => {
    const plan = buildRevisionReusePlan({
      changeType: "caption",
      artifacts: [
        artifact({ type: "voice", artifactId: "voice-0" }),
        artifact({ type: "captions", artifactId: "captions-0" }),
        artifact({ type: "media", artifactId: "media-0" }),
      ],
    });
    expect(plan.reusedStages).toContain("speech_timings");
    expect(plan.regeneratedStages).toEqual(["render", "validation"]);
    expect(plan.artifacts).toHaveLength(3);
  });

  it("handles legacy jobs without canonical artifacts", () => {
    const plan = buildRevisionReusePlan({ changeType: "media", artifacts: [], changedSceneIndex: 0 });
    expect(plan.artifacts).toEqual([]);
    expect(filterReusableArtifacts({ artifacts: [] })).toEqual([]);
  });

  it("does not require duplicate durable files for shared immutable references", () => {
    const config = tempConfig();
    const store = new DurableArtifactStore(config);
    const source = path.join(config.tempDirPath, "caption.json");
    fs.ensureDirSync(path.dirname(source));
    fs.writeJsonSync(source, { captions: [] });
    const hash = createCaptionInputHash({ voiceChecksum: "same-audio" });
    const first = store.persistJson({ type: "captions", sceneIndex: 0, sourceJobId: "job-a", inputHash: hash, payload: { captions: [] } });
    const second = store.persistJson({ type: "captions", sceneIndex: 0, sourceJobId: "job-b", inputHash: hash, payload: { captions: [] } });
    expect(first.artifactId).toBe(second.artifactId);
    expect(fs.existsSync(store.resolveStorageRef(first.storageRef))).toBe(true);
  });
});
