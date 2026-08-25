import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Config } from "../../config";
import { JobService } from "./jobs";
import { canonicalizeProductionSpecContract, createV2PublicRouter } from "./routes";
import { providerSecrets } from "./provider-vault/providerSecrets";
import {
  parseArabicVoiceDefault,
  resolveArabicVoiceSelection,
  type PersistedArabicVoiceDefault,
} from "./voice-providers/arabicVoiceDefault";
import { ELEVENLABS_DEFAULT_MODEL_ID, ELEVENLABS_PRESET_IDS } from "./voice-providers/elevenlabsVoiceProvider";
import { voicePresetEnum } from "../../types/productionSpec";

/**
 * V2.2 REGRESSION: THE PERSISTED HUMAN ARABIC DEFAULT MUST DRIVE REAL JOBS.
 *
 * The Voice Lab has always written `arabic_voice_default` into `app_settings`,
 * but nothing on the production path read it. Canonicalization resolved the
 * ElevenLabs voice from `ELEVENLABS_DEFAULT_VOICE_ID` instead, so an Arabic
 * "Auto" request silently ignored the voice a human actually approved - and,
 * when that variable was empty, fell through to whatever voice happened to be
 * first in the account.
 *
 * Every test in the first block fails against that old behaviour.
 */

/** The approved production selection, used as the fixture throughout. */
const MAMDOH = {
  voiceId: "68MRVrnQAt8vLbu0FCzw",
  voiceName: "Mamdoh - Deep Egyptian Arabic Male voice",
  preset: "energetic_ad" as const,
  modelId: ELEVENLABS_DEFAULT_MODEL_ID,
};

/** A deliberately wrong legacy environment value the fix must not use. */
const ENV_DECOY_VOICE_ID = "env_legacy_voice_should_not_win";

/** Minimal database stub with working app_settings and jobs tables. */
class SettingsDb {
  // Disabled pool: AuthService falls back to the local admin identity so these
  // tests stay focused on voice routing rather than on auth.
  public enabled = false;
  public settings = new Map<string, any>();
  public jobRows: any[] = [];

  async query<T = any>(sql: string, values: unknown[] = []): Promise<T[]> {
    if (sql.includes("INSERT INTO jobs")) {
      const now = new Date();
      const row = {
        id: values[0],
        type: "video",
        status: "queued",
        progress: 0,
        current_stage: "Queued",
        title: values[1],
        template_id: values[2],
        brand_name: values[3],
        input: values[4],
        creation_mode: values[5],
        original_prompt: values[6],
        // Stored exactly as the route serialized it, so the assertions below
        // read the same JSON PostgreSQL would hold.
        production_spec: values[7] ? JSON.parse(String(values[7])) : null,
        ai_provider: values[8],
        visual_mode: values[9],
        voice_provider: values[10],
        quality_profile: values[11],
        resolution: values[12],
        aspect_ratio: values[13],
        language: values[14],
        dialect: values[15],
        cost_estimate: values[16] ? JSON.parse(String(values[16])) : null,
        idempotency_key: values[17],
        created_at: now,
        updated_at: now,
      };
      this.jobRows.push(row);
      return [row] as T[];
    }
    if (sql.includes("FROM app_settings")) {
      const stored = this.settings.get(String(values[0]));
      return (stored ? [{ key: values[0], value: stored, updated_at: new Date() }] : []) as T[];
    }
    if (sql.includes("INSERT INTO app_settings")) {
      this.settings.set(String(values[0]), values[1]);
      return [{ key: values[0], value: values[1], updated_at: new Date() }] as T[];
    }
    return [] as T[];
  }

  async health() {
    return { ok: true, message: "ok" };
  }

  getPoolState() {
    return { configured: true, totalCount: 1, idleCount: 1, waitingCount: 0, maxConnections: 10 };
  }
}

const AUTH_HEADER = { Authorization: "Bearer test_admin_session" };

function makeApp() {
  const db = new SettingsDb();
  const app = express();
  app.use(express.json());
  app.use("/api/v2", createV2PublicRouter(new Config(), db as any, new JobService(db as any)));
  return { app, db };
}

/** Saves the approved default through the canonical Voice Lab endpoint. */
async function persistMamdohDefault(app: express.Express) {
  return request(app)
    .put("/api/v2/voice-lab/default-voice")
    .set(AUTH_HEADER)
    .send({
      voiceId: MAMDOH.voiceId,
      voiceName: MAMDOH.voiceName,
      preset: MAMDOH.preset,
      modelId: MAMDOH.modelId,
    })
    .expect(200);
}

/** An Arabic Auto request with no explicit voice: the exact production case. */
const ARABIC_AUTO_REQUEST = {
  prompt: "اعمل إعلان 20 ثانية باللهجة المصرية لخدمة تصميم مواقع",
  language: "ar",
  dialect: "egyptian",
  durationSeconds: 20,
  aspectRatio: "9:16",
  resolution: "1080p",
  voiceProvider: "auto",
};

describe("Persisted Arabic voice default drives real production requests", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    providerSecrets.invalidate();
  });

  it("resolves an Arabic Auto spec to the persisted human default instead of the environment voice", async () => {
    // The legacy variable is set to a decoy: if anything still reads it, the
    // assertions below fail loudly rather than passing by coincidence.
    vi.stubEnv("ELEVENLABS_DEFAULT_VOICE_ID", ENV_DECOY_VOICE_ID);
    const { app } = makeApp();
    await persistMamdohDefault(app);

    const preview = await request(app)
      .post("/api/v2/production-spec/preview")
      .set(AUTH_HEADER)
      .send(ARABIC_AUTO_REQUEST)
      .expect(200);

    expect(preview.body.spec.voiceProvider).toBe("elevenlabs");
    expect(preview.body.spec.voiceId).toBe(MAMDOH.voiceId);
    expect(preview.body.spec.voicePreset).toBe("energetic_ad");
    expect(preview.body.spec.voiceModelId).toBe("eleven_multilingual_v2");
    expect(preview.body.spec.voiceId).not.toBe(ENV_DECOY_VOICE_ID);
    // The contract records *how* the voice was chosen so the UI and job
    // metadata can prove it came from the human selection.
    expect(preview.body.spec.metadata.uiContract).toMatchObject({
      requestedVoiceProvider: "auto",
      resolvedVoiceProvider: "elevenlabs",
      voiceId: MAMDOH.voiceId,
      voicePreset: "energetic_ad",
      voiceSource: "persisted_human_default",
    });
  });

  it("carries the persisted default into a created production job spec", async () => {
    vi.stubEnv("ELEVENLABS_DEFAULT_VOICE_ID", ENV_DECOY_VOICE_ID);
    vi.stubEnv("ELEVENLABS_API_KEY", "sk_elevenlabs_live_key_1234567890");
    const { app, db } = makeApp();
    await persistMamdohDefault(app);

    const created = await request(app)
      .post("/api/v2/jobs")
      .set(AUTH_HEADER)
      .send({
        creationMode: "prompt",
        prompt: ARABIC_AUTO_REQUEST.prompt,
        language: "ar",
        dialect: "egyptian",
        durationSeconds: 20,
        voiceProvider: "auto",
      });

    // The job was never refused, and the spec that reached the jobs table names
    // the persisted voice - not the decoy environment value.
    expect(created.status).not.toBe(409);
    expect(db.jobRows.length).toBe(1);
    const row = db.jobRows[0];
    expect(row.voice_provider).toBe("elevenlabs");
    expect(row.production_spec.voiceId).toBe(MAMDOH.voiceId);
    expect(row.production_spec.voicePreset).toBe("energetic_ad");
    expect(row.production_spec.voiceModelId).toBe("eleven_multilingual_v2");
    expect(row.production_spec.metadata.uiContract.voiceSource).toBe("persisted_human_default");
    // The worker is handed exactly this spec, so the same voice reaches render.
    expect(row.input.productionSpec.voiceId).toBe(MAMDOH.voiceId);
  });

  it("lets an explicit voice choice override the persisted default", async () => {
    const { app } = makeApp();
    await persistMamdohDefault(app);

    const preview = await request(app)
      .post("/api/v2/production-spec/preview")
      .set(AUTH_HEADER)
      .send({ ...ARABIC_AUTO_REQUEST, voiceId: "amSNjVC0vWYiE8iGimVb" })
      .expect(200);

    // Mamdoh is the default, not a lock on the product.
    expect(preview.body.spec.voiceId).toBe("amSNjVC0vWYiE8iGimVb");
    expect(preview.body.spec.metadata.uiContract.voiceSource).toBe("explicit_request");
    // Delivery settings auditioned on another speaker are not inherited.
    expect(preview.body.spec.voicePreset).toBeUndefined();
  });

  it("honours an explicit preset alongside an explicit voice", async () => {
    const { app } = makeApp();
    await persistMamdohDefault(app);

    const preview = await request(app)
      .post("/api/v2/production-spec/preview")
      .set(AUTH_HEADER)
      .send({ ...ARABIC_AUTO_REQUEST, voiceId: "amSNjVC0vWYiE8iGimVb", voicePreset: "calm" })
      .expect(200);

    expect(preview.body.spec.voiceId).toBe("amSNjVC0vWYiE8iGimVb");
    expect(preview.body.spec.voicePreset).toBe("calm");
  });

  it("falls back to the legacy environment voice only when no human selection exists", async () => {
    vi.stubEnv("ELEVENLABS_DEFAULT_VOICE_ID", ENV_DECOY_VOICE_ID);
    const { app } = makeApp();

    const preview = await request(app)
      .post("/api/v2/production-spec/preview")
      .set(AUTH_HEADER)
      .send(ARABIC_AUTO_REQUEST)
      .expect(200);

    expect(preview.body.spec.voiceId).toBe(ENV_DECOY_VOICE_ID);
    expect(preview.body.spec.metadata.uiContract.voiceSource).toBe("legacy_env_default");
  });

  it("refuses an Arabic job with a controlled error when no voice can be resolved", async () => {
    vi.stubEnv("ELEVENLABS_DEFAULT_VOICE_ID", "");
    vi.stubEnv("ELEVENLABS_API_KEY", "sk_elevenlabs_live_key_1234567890");
    const { app } = makeApp();

    const response = await request(app)
      .post("/api/v2/jobs")
      .set(AUTH_HEADER)
      .send({
        creationMode: "prompt",
        prompt: ARABIC_AUTO_REQUEST.prompt,
        language: "ar",
        dialect: "egyptian",
      })
      .expect(409);

    // Better an actionable refusal than narration by an arbitrary account voice.
    expect(response.body.error).toBe("arabic_default_voice_not_selected");
    expect(response.body.action).toEqual({ label: "Open Voice Lab", href: "/voice-lab" });
  });

  it("leaves English Auto production untouched by the Arabic default", async () => {
    const { app } = makeApp();
    await persistMamdohDefault(app);

    const preview = await request(app)
      .post("/api/v2/production-spec/preview")
      .set(AUTH_HEADER)
      .send({
        prompt: "Make a 20 second ad for a website design service",
        language: "en",
        dialect: "none",
        durationSeconds: 20,
        voiceProvider: "auto",
      })
      .expect(200);

    expect(preview.body.spec.voiceProvider).toBe("kokoro");
    expect(preview.body.spec.voiceId).toBe("af_heart");
    expect(preview.body.spec.voiceId).not.toBe(MAMDOH.voiceId);
    expect(preview.body.spec.voicePreset).toBeUndefined();
  });

  it("never exposes a provider secret through the routing surface", async () => {
    const secret = "sk_elevenlabs_live_key_1234567890";
    vi.stubEnv("ELEVENLABS_API_KEY", secret);
    const { app } = makeApp();
    await persistMamdohDefault(app);

    const preview = await request(app)
      .post("/api/v2/production-spec/preview")
      .set(AUTH_HEADER)
      .send(ARABIC_AUTO_REQUEST)
      .expect(200);
    const saved = await request(app).get("/api/v2/voice-lab/default-voice").set(AUTH_HEADER).expect(200);

    expect(JSON.stringify(preview.body)).not.toContain(secret);
    expect(JSON.stringify(saved.body)).not.toContain(secret);
  });
});

describe("Arabic voice precedence", () => {
  const persisted: PersistedArabicVoiceDefault = {
    provider: "elevenlabs",
    voiceId: MAMDOH.voiceId,
    voiceName: MAMDOH.voiceName,
    preset: MAMDOH.preset,
    modelId: MAMDOH.modelId,
    selectedAt: "2026-08-24T00:00:00.000Z",
    selectedBy: "human",
  };

  it("prefers an explicit request voice over every stored default", () => {
    const resolved = resolveArabicVoiceSelection({
      requestedVoiceId: "explicit_voice",
      persisted,
      envVoiceId: ENV_DECOY_VOICE_ID,
      defaultModelId: ELEVENLABS_DEFAULT_MODEL_ID,
    });
    expect(resolved).toMatchObject({ voiceId: "explicit_voice", source: "explicit_request" });
  });

  it("prefers the persisted human default over the legacy environment default", () => {
    const resolved = resolveArabicVoiceSelection({
      persisted,
      envVoiceId: ENV_DECOY_VOICE_ID,
      defaultModelId: ELEVENLABS_DEFAULT_MODEL_ID,
    });
    expect(resolved).toMatchObject({
      voiceId: MAMDOH.voiceId,
      preset: "energetic_ad",
      modelId: "eleven_multilingual_v2",
      source: "persisted_human_default",
    });
  });

  it("reports unresolved rather than inventing a voice", () => {
    const resolved = resolveArabicVoiceSelection({ defaultModelId: ELEVENLABS_DEFAULT_MODEL_ID });
    expect(resolved.voiceId).toBe("");
    expect(resolved.source).toBe("unresolved");
  });

  it("never treats a historical Piper model name as an explicit ElevenLabs voice", () => {
    const resolved = resolveArabicVoiceSelection({
      requestedVoiceId: "ar_JO-kareem-medium",
      persisted,
      defaultModelId: ELEVENLABS_DEFAULT_MODEL_ID,
    });
    expect(resolved.voiceId).toBe(MAMDOH.voiceId);
    expect(resolved.source).toBe("persisted_human_default");
  });

  it("ignores a stored row that names no voice", () => {
    expect(parseArabicVoiceDefault({ preset: "energetic_ad" })).toBeNull();
    expect(parseArabicVoiceDefault(undefined)).toBeNull();
  });

  it("drops an unrecognized stored preset instead of forwarding it to the provider", () => {
    const parsed = parseArabicVoiceDefault({ voiceId: "v1", preset: "not_a_real_preset" });
    expect(parsed?.voiceId).toBe("v1");
    expect(parsed?.preset).toBeUndefined();
  });

  it("keeps the spec preset vocabulary and the ElevenLabs preset table in step", () => {
    expect(voicePresetEnum.options).toEqual(ELEVENLABS_PRESET_IDS);
  });
});

describe("Canonicalization stays pure", () => {
  const persisted: PersistedArabicVoiceDefault = {
    provider: "elevenlabs",
    voiceId: MAMDOH.voiceId,
    voiceName: MAMDOH.voiceName,
    preset: MAMDOH.preset,
    modelId: MAMDOH.modelId,
    selectedAt: "2026-08-24T00:00:00.000Z",
    selectedBy: "human",
  };

  const arabicSpec = () => ({
    id: "spec",
    creationMode: "prompt",
    title: "إعلان تصميم مواقع",
    language: "ar",
    dialect: "egyptian",
    durationSeconds: 20,
    sceneCount: 3,
    voiceProvider: "auto",
    scenes: [0, 1, 2].map((sceneIndex) => ({
      sceneIndex,
      purpose: "hook",
      durationSeconds: 6.5,
      narration: "ابدأ دلوقتي",
      stockSearchTerms: ["business"],
      visualSource: "stock",
      transition: "cut",
    })),
  });

  it("does not mutate the persisted selection it was given", () => {
    const snapshot = JSON.stringify(persisted);
    canonicalizeProductionSpecContract(arabicSpec(), { language: "ar", dialect: "egyptian", voiceProvider: "auto" }, {
      arabicVoice: persisted,
    });
    expect(JSON.stringify(persisted)).toBe(snapshot);
  });

  it("applies one voice and one preset to the whole spec, not per scene", () => {
    const canonical = canonicalizeProductionSpecContract(
      arabicSpec(),
      { language: "ar", dialect: "egyptian", voiceProvider: "auto" },
      { arabicVoice: persisted },
    );
    expect(canonical.scenes.length).toBe(3);
    expect(canonical.voiceId).toBe(MAMDOH.voiceId);
    expect(canonical.voicePreset).toBe("energetic_ad");
    // The preset lives on the spec, so no scene can carry a different one.
    expect(canonical.scenes.every((scene: any) => scene.voicePreset === undefined)).toBe(true);
  });

  it("keeps a historical Piper job readable while routing its revision to ElevenLabs", () => {
    const canonical = canonicalizeProductionSpecContract(
      { ...arabicSpec(), voiceProvider: "piper", voiceId: "ar_JO-kareem-medium" },
      { language: "ar", dialect: "egyptian", voiceProvider: "auto" },
      { arabicVoice: persisted },
    );
    expect(canonical.voiceProvider).toBe("elevenlabs");
    expect(canonical.voiceId).toBe(MAMDOH.voiceId);
    expect(canonical.metadata?.uiContract).toMatchObject({ voiceSource: "persisted_human_default" });
  });
});
