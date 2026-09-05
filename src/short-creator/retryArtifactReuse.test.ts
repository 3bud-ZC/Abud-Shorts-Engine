import fs from "fs-extra";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";

import type { Config } from "../config";
import {
  RETRY_ARTIFACT_REUSE_INVALID,
  retryContentFingerprint,
  validateExplicitRetryReuseArtifact,
} from "./ShortCreator";
import {
  DurableArtifactStore,
  attachRetryReuseManifest,
  createVoiceInputHash,
  type DurableSceneArtifact,
} from "../server/v2/artifacts/durableArtifacts";

const sourceJobId = "cmtknn0vk000007lfgwx6cqyx";
const retryJobId = "cmtljdwcb000007qkbbvpguw6";
const voiceId = "68MRVrnQAt8vLbu0FCzw";
const voiceModel = "eleven_multilingual_v2";
const provider = "elevenlabs";
const scene1HistoricalInputHash = "76dd9485bc4d4ee56aa39705e4c18e53b4f8ec59237133787c85067ac9e7df21";
const scene1CurrentNarration = "مع كولكشن ABUD Demo الجديد، قطن مية في المية وقصة أوفر سايز رايقة.";
const scene1CurrentSpoken = "مع كولكشن عبود ديمو الجديد، قطن مية في المية وقصة أوفر سايز رايقة.";

function tempConfig(): Config {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "abud-retry-reuse-"));
  return {
    port: 3130,
    publicBaseUrl: "http://localhost:3130",
    tempDirPath: path.join(root, "temp"),
    videosDirPath: path.join(root, "videos"),
    dataDirPath: path.join(root, "data"),
  } as Config;
}

function fingerprintPair(scene: { narration: string; spoken: string }) {
  return {
    canonicalSpokenContentFingerprint: retryContentFingerprint({
      text: scene.spoken,
      language: "ar",
      dialect: "egyptian",
    }),
    displayContentFingerprint: retryContentFingerprint({
      text: scene.narration,
      language: "ar",
      dialect: "egyptian",
    }),
  };
}

function artifact(overrides: Partial<DurableSceneArtifact>): DurableSceneArtifact {
  return {
    artifactId: overrides.artifactId || `${overrides.type || "voice"}_${overrides.sceneIndex ?? 0}`,
    type: overrides.type || "voice",
    sceneIndex: overrides.sceneIndex ?? 0,
    sourceJobId: overrides.sourceJobId || sourceJobId,
    sourceRevisionId: overrides.sourceRevisionId || "rev-pass-95",
    provider: overrides.provider || provider,
    model: overrides.model || voiceModel,
    inputHash: overrides.inputHash || "a".repeat(64),
    storageRef: overrides.storageRef || `artifacts/scene/${overrides.type || "voice"}/fixture.bin`,
    checksum: overrides.checksum || "b".repeat(64),
    duration: overrides.duration ?? 2.4,
    createdAt: overrides.createdAt || "2026-09-03T13:20:00.000Z",
    metadata: overrides.metadata || {},
    valid: overrides.valid ?? true,
    supersededAt: overrides.supersededAt,
  };
}

function bindRetryArtifact(
  overrides: Partial<DurableSceneArtifact>,
  scene: { narration: string; spoken: string } = {
    narration: scene1CurrentNarration,
    spoken: scene1CurrentSpoken,
  },
): DurableSceneArtifact {
  const base = artifact({
    metadata: {
      reuseKey: {
        voiceId,
        voiceStrategy: "plain_tts",
      },
    },
    ...overrides,
  });
  return attachRetryReuseManifest(base, {
    ...fingerprintPair(scene),
    voiceId,
    voiceStrategy: "plain_tts",
  });
}

function validateVoice(artifactToValidate: DurableSceneArtifact, scene = {
  narration: scene1CurrentNarration,
  spoken: scene1CurrentSpoken,
}) {
  return validateExplicitRetryReuseArtifact({
    artifact: artifactToValidate,
    expectedType: "voice",
    expectedSceneIndex: artifactToValidate.sceneIndex,
    expectedProvider: provider,
    expectedModel: voiceModel,
    expectedVoiceId: voiceId,
    ...fingerprintPair(scene),
  });
}

describe("explicit retry artifact reuse", () => {
  it("accepts the scene 1 incident voice artifact despite legacy input hash drift", () => {
    const currentInputHash = createVoiceInputHash({
      spokenNarration: scene1CurrentNarration,
      provider,
      model: voiceModel,
      voiceId,
      language: "ar",
      dialect: "egyptian",
      qualityProfile: "balanced",
      voiceStrategy: "plain_tts",
    });
    const incidentVoice = bindRetryArtifact({
      artifactId: "voice_76dd9485bc4d4ee5_e0251a3514e2",
      sceneIndex: 1,
      inputHash: scene1HistoricalInputHash,
    });

    expect(currentInputHash).not.toBe(scene1HistoricalInputHash);
    expect(validateVoice(incidentVoice)).toEqual({ valid: true });
  });

  it("rejects changed narration before provider synthesis can be reached", () => {
    let providerCalls = 0;
    const incidentVoice = bindRetryArtifact({
      artifactId: "voice_76dd9485bc4d4ee5_e0251a3514e2",
      sceneIndex: 1,
      inputHash: scene1HistoricalInputHash,
    });
    const validation = validateVoice(incidentVoice, {
      narration: "نص مختلف تماما",
      spoken: "نص مختلف تماما",
    });

    if (validation.valid) providerCalls++;

    expect(validation).toEqual({ valid: false, reason: "canonical spoken content changed" });
    expect(providerCalls).toBe(0);
  });

  it("rejects invalid explicit bindings without falling through to provider generation", () => {
    const wrongVoice = bindRetryArtifact({});
    wrongVoice.metadata = {
      ...wrongVoice.metadata,
      retryReuseManifest: {
        ...(wrongVoice.metadata?.retryReuseManifest as Record<string, unknown>),
        voiceId: "other_voice",
      },
    };
    const cases: Array<[string, DurableSceneArtifact, Partial<Parameters<typeof validateExplicitRetryReuseArtifact>[0]>]> = [
      ["missing manifest", artifact({ sceneIndex: 1, metadata: { reuseKey: { voiceId, voiceStrategy: "plain_tts" } } }), {}],
      ["invalid flag", bindRetryArtifact({ valid: false }), {}],
      ["superseded", bindRetryArtifact({ supersededAt: "2026-09-03T14:00:00.000Z" }), {}],
      ["wrong type", bindRetryArtifact({ type: "captions" }), { expectedType: "voice" }],
      ["wrong scene", bindRetryArtifact({ sceneIndex: 0 }), { expectedSceneIndex: 1 }],
      ["unsafe storage", bindRetryArtifact({ storageRef: "../voice.mp3" }), {}],
      ["bad checksum metadata", bindRetryArtifact({ checksum: "deadbeef" }), {}],
      ["wrong provider", bindRetryArtifact({ provider: "piper" }), {}],
      ["wrong model", bindRetryArtifact({ model: "eleven_turbo_v2_5" }), {}],
      ["wrong voice", wrongVoice, {}],
    ];

    for (const [, candidate, overrides] of cases) {
      let providerCalls = 0;
      const validation = validateExplicitRetryReuseArtifact({
        artifact: candidate,
        expectedType: "voice",
        expectedSceneIndex: 1,
        expectedProvider: provider,
        expectedModel: voiceModel,
        expectedVoiceId: voiceId,
        ...fingerprintPair({
          narration: scene1CurrentNarration,
          spoken: scene1CurrentSpoken,
        }),
        ...overrides,
      });
      if (validation.valid) providerCalls++;

      expect(validation.valid).toBe(false);
      expect(providerCalls).toBe(0);
    }
  });

  it("stops on missing or checksum-invalid files before provider generation", () => {
    const config = tempConfig();
    const store = new DurableArtifactStore(config);
    fs.ensureDirSync(config.tempDirPath);
    const source = path.join(config.tempDirPath, "voice.mp3");
    fs.writeFileSync(source, "voice-audio");
    const saved = store.persistFile({
      type: "voice",
      sceneIndex: 1,
      sourceJobId,
      provider,
      model: voiceModel,
      inputHash: scene1HistoricalInputHash,
      sourcePath: source,
      extension: "mp3",
      metadata: { reuseKey: { voiceId, voiceStrategy: "plain_tts" } },
    });
    const bound = attachRetryReuseManifest(saved, {
      ...fingerprintPair({
        narration: scene1CurrentNarration,
        spoken: scene1CurrentSpoken,
      }),
      voiceId,
      voiceStrategy: "plain_tts",
    });
    const destination = path.join(config.tempDirPath, "copy.mp3");

    let providerCalls = 0;
    expect(validateVoice(bound)).toEqual({ valid: true });
    fs.removeSync(store.resolveStorageRef(bound.storageRef));
    expect(() => store.copyToTemp(bound, destination)).toThrow(/unavailable/);
    expect(providerCalls).toBe(0);

    fs.writeFileSync(source, "voice-audio");
    const checksumSaved = store.persistFile({
      type: "voice",
      sceneIndex: 1,
      sourceJobId,
      provider,
      model: voiceModel,
      inputHash: scene1HistoricalInputHash,
      sourcePath: source,
      extension: "mp3",
      metadata: { reuseKey: { voiceId, voiceStrategy: "plain_tts" } },
    });
    const checksumBound = attachRetryReuseManifest(checksumSaved, {
      ...fingerprintPair({
        narration: scene1CurrentNarration,
        spoken: scene1CurrentSpoken,
      }),
      voiceId,
      voiceStrategy: "plain_tts",
    });
    fs.writeFileSync(store.resolveStorageRef(checksumBound.storageRef), "changed-audio");
    expect(() => store.copyToTemp(checksumBound, destination)).toThrow(/checksum mismatch/);
    expect(providerCalls).toBe(0);
    fs.removeSync(path.dirname(config.dataDirPath));
  });

  it("dry-runs the pass 9.5 incident so scenes 0 and 1 reuse and scene 2 is first synthesis boundary", () => {
    const scenes = [
      { narration: "أول مشهد جاهز", spoken: "أول مشهد جاهز" },
      { narration: scene1CurrentNarration, spoken: scene1CurrentSpoken },
      { narration: "تابعنا وشوف التفاصيل", spoken: "تابعنا وشوف التفاصيل" },
    ];
    const incidentArtifacts = [
      bindRetryArtifact({
        artifactId: "voice_376f5d939a42e63b_83630c60680d",
        sceneIndex: 0,
      }, scenes[0]),
      bindRetryArtifact({
        artifactId: "captions_2e2e3060c9f77ec6_fa3d7d5e8548",
        type: "captions",
        sceneIndex: 0,
        provider: "whisper",
        model: "whisper",
      }, scenes[0]),
      bindRetryArtifact({
        artifactId: "voice_76dd9485bc4d4ee5_e0251a3514e2",
        sceneIndex: 1,
        inputHash: scene1HistoricalInputHash,
      }, scenes[1]),
      bindRetryArtifact({
        artifactId: "captions_e76ddee264b42581_c092a9c0cc26",
        type: "captions",
        sceneIndex: 1,
        provider: "whisper",
        model: "whisper",
      }, scenes[1]),
    ];

    const reused: string[] = [];
    let providerCalls = 0;
    let firstWouldBeSynthesisScene: number | undefined;

    for (const [sceneIndex, scene] of scenes.entries()) {
      const voice = incidentArtifacts.find((candidate) => candidate.type === "voice" && candidate.sceneIndex === sceneIndex);
      if (!voice) {
        firstWouldBeSynthesisScene = sceneIndex;
        break;
      }
      expect(validateExplicitRetryReuseArtifact({
        artifact: voice,
        expectedType: "voice",
        expectedSceneIndex: sceneIndex,
        expectedProvider: provider,
        expectedModel: voiceModel,
        expectedVoiceId: voiceId,
        ...fingerprintPair(scene),
      })).toEqual({ valid: true });
      reused.push(voice.artifactId);

      const captions = incidentArtifacts.find((candidate) => candidate.type === "captions" && candidate.sceneIndex === sceneIndex);
      expect(captions).toBeTruthy();
      expect(validateExplicitRetryReuseArtifact({
        artifact: captions!,
        expectedType: "captions",
        expectedSceneIndex: sceneIndex,
        ...fingerprintPair(scene),
      })).toEqual({ valid: true });
      reused.push(captions!.artifactId);
    }

    expect(reused).toEqual([
      "voice_376f5d939a42e63b_83630c60680d",
      "captions_2e2e3060c9f77ec6_fa3d7d5e8548",
      "voice_76dd9485bc4d4ee5_e0251a3514e2",
      "captions_e76ddee264b42581_c092a9c0cc26",
    ]);
    expect(firstWouldBeSynthesisScene).toBe(2);
    expect(providerCalls).toBe(0);
    expect(retryJobId).toBe("cmtljdwcb000007qkbbvpguw6");
  });

  it("tags explicit retry reuse failures with a stable error code", () => {
    expect(RETRY_ARTIFACT_REUSE_INVALID).toBe("RETRY_ARTIFACT_REUSE_INVALID");
  });
});
