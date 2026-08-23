import express from "express";
import fs from "fs-extra";
import os from "os";
import path from "path";
import nock from "nock";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { Config } from "../../config";
import { ShortCreator } from "../../short-creator/ShortCreator";
import { listVideoFiles, mergeMetadata, readMetadata, writeMetadata } from "../videoMetadata";
import { validatePexelsProvider } from "./health";
import { createV2InternalRouter, createV2PublicRouter } from "./routes";
import { isValidJobTransition, JobService } from "./jobs";
import type { JobStatus } from "./types";

type JobRow = {
  id: string;
  type: "video";
  status: JobStatus;
  progress: number;
  current_stage: string;
  title?: string;
  creation_mode?: "prompt" | "template";
  original_prompt?: string;
  production_spec?: any;
  ai_provider?: string;
  visual_mode?: string;
  voice_provider?: string;
  quality_profile?: string;
  resolution?: string;
  aspect_ratio?: string;
  language?: string;
  dialect?: string;
  cost_estimate?: any;
  template_id?: string;
  brand_name?: string;
  input: any;
  output?: any;
  error?: string;
  technical_error?: string;
  created_at: Date;
  started_at?: Date;
  completed_at?: Date;
  updated_at: Date;
};

class FakeDb {
  public jobs = new Map<string, JobRow>();
  public events: any[] = [];
  public assets: any[] = [];
  public brands = new Map<string, any>();
  public settings = new Map<string, any>();

  async query(text: string, values: any[] = []) {
    if (text.includes("SELECT key, value, updated_at FROM app_settings")) {
      const value = this.settings.get(values[0]);
      return value ? [{ key: values[0], value, updated_at: new Date() }] : [];
    }
    if (text.includes("INSERT INTO app_settings")) {
      this.settings.set(values[0], values[1]);
      return [{ key: values[0], value: values[1], updated_at: new Date() }];
    }
    if (text.includes("SELECT * FROM brands")) {
      return Array.from(this.brands.values());
    }
    if (text.includes("UPDATE brands SET is_default = false WHERE id <>")) {
      for (const [id, row] of this.brands) {
        if (id !== values[0]) row.is_default = false;
      }
      return [];
    }
    if (text.includes("UPDATE brands SET is_default = false")) {
      for (const row of this.brands.values()) row.is_default = false;
      return [];
    }
    if (text.includes("INSERT INTO brands")) {
      const now = new Date();
      const row = {
        id: values[0],
        name: values[1],
        watermark_text: values[2],
        primary_color: values[3],
        accent_color: values[4],
        caption_style: values[5],
        include_outro: values[6],
        outro_text: values[7],
        contact_text: values[8],
        is_default: values[9],
        created_at: now,
        updated_at: now,
      };
      this.brands.set(row.id, row);
      return [row];
    }
    if (text.includes("UPDATE brands") && text.includes("RETURNING *")) {
      const row = this.brands.get(values[0]);
      if (!row) return [];
      if (text.includes("SET is_default = true")) {
        row.is_default = true;
      } else {
        row.name = values[1];
        row.watermark_text = values[2];
        row.primary_color = values[3];
        row.accent_color = values[4];
        row.caption_style = values[5];
        row.include_outro = values[6];
        row.outro_text = values[7];
        row.contact_text = values[8];
        row.is_default = values[9];
      }
      row.updated_at = new Date();
      return [row];
    }
    if (text.includes("DELETE FROM brands")) {
      const row = this.brands.get(values[0]);
      if (!row) return [];
      this.brands.delete(values[0]);
      return [row];
    }
    if (text.includes("INSERT INTO jobs")) {
      const [
        id,
        title,
        templateId,
        brandName,
        input,
        creationMode,
        originalPrompt,
        productionSpecJson,
        aiProvider,
        visualMode,
        voiceProvider,
        qualityProfile,
        resolution,
        aspectRatio,
        language,
        dialect,
        costEstimateJson,
      ] = values;
      const now = new Date();
      const row: JobRow = {
        id,
        type: "video",
        status: "queued",
        progress: 0,
        current_stage: "Queued",
        title,
        template_id: templateId,
        brand_name: brandName,
        input,
        creation_mode: creationMode,
        original_prompt: originalPrompt,
        production_spec: productionSpecJson ? JSON.parse(productionSpecJson) : undefined,
        ai_provider: aiProvider,
        visual_mode: visualMode,
        voice_provider: voiceProvider,
        quality_profile: qualityProfile,
        resolution,
        aspect_ratio: aspectRatio,
        language,
        dialect,
        cost_estimate: costEstimateJson ? JSON.parse(costEstimateJson) : undefined,
        created_at: now,
        updated_at: now,
      };
      this.jobs.set(id, row);
      return [row];
    }
    if (text.includes("INSERT INTO job_events")) {
      const row = {
        id: String(this.events.length + 1),
        job_id: values[0],
        status: values[1],
        progress: values[2],
        stage: values[3],
        message: values[4],
        technical_message: values[5],
        created_at: new Date(),
      };
      this.events.push(row);
      return [row];
    }
    if (text.includes("SELECT * FROM jobs WHERE id")) {
      const row = this.jobs.get(values[0]);
      return row ? [row] : [];
    }
    if (text.includes("SELECT * FROM jobs WHERE status")) {
      return Array.from(this.jobs.values()).filter((job) => job.status === values[0]);
    }
    if (text.includes("SELECT * FROM jobs ORDER BY")) {
      return Array.from(this.jobs.values());
    }
    if (text.includes("SELECT * FROM job_events")) {
      return this.events.filter((event) => event.job_id === values[0]);
    }
    if (text.includes("UPDATE jobs")) {
      const row = this.jobs.get(values[0]);
      if (!row) return [];
      row.status = values[1];
      row.progress = values[2];
      row.current_stage = values[3];
      row.output = values[4] || row.output;
      row.error = values[5] || row.error;
      row.technical_error = values[6] || row.technical_error;
      row.started_at = row.started_at || new Date();
      if (["ready", "failed", "canceled"].includes(row.status)) {
        row.completed_at = new Date();
      }
      row.updated_at = new Date();
      return [row];
    }
    if (text.includes("INSERT INTO generated_assets")) {
      this.assets.push(values);
      return [];
    }
    return [];
  }

  async health() {
    return { ok: true, message: "PostgreSQL connection is healthy." };
  }
}

const validInput = {
  scenes: [{ text: "A short test narration", searchTerms: ["retail", "shop"] }],
  config: { brandKit: { brandName: "ABUD Test" } },
};

function makeConfig(): Config {
  process.env.PEXELS_API_KEY = "A".repeat(56);
  process.env.INTERNAL_SERVICE_TOKEN = "test-internal-token-value";
  process.env.V2_ENABLED = "true";
  const config = new Config();
  config.n8nBaseUrl = "http://127.0.0.1:1";
  config.renderWorkerBaseUrl = "http://127.0.0.1:1";
  return config;
}

describe("V2 jobs", () => {
  it("creates, transitions, completes, fails, and cancels jobs with events", async () => {
    const db = new FakeDb();
    const service = new JobService(db as any);
    const job = await service.createVideoJob(validInput as any);

    expect(job.status).toBe("queued");
    expect((await service.getEvents(job.id))).toHaveLength(1);

    await service.updateJob(job.id, "preparing", 5, "Preparing", "Preparing.");
    await service.updateJob(job.id, "generating_voice", 30, "Generating voice", "Voice.");
    await service.updateJob(job.id, "generating_captions", 50, "Captions", "Captions.");
    await service.updateJob(job.id, "searching_assets", 60, "Footage", "Footage.");
    await service.updateJob(job.id, "rendering", 80, "Rendering", "Rendering.");
    await service.updateJob(job.id, "finalizing", 95, "Finalizing", "Finalizing.");
    const complete = await service.completeJob(job.id, job.id, { path: "/app/data/videos/test.mp4" });
    expect(complete.status).toBe("ready");
    expect(complete.output?.videoId).toBe(job.id);

    const failed = await service.createVideoJob(validInput as any);
    await service.updateJob(failed.id, "failed", 100, "Failed", "Failed.", { error: "Render failed" });
    expect((await service.getJob(failed.id))?.error).toBe("Render failed");

    const canceled = await service.createVideoJob(validInput as any);
    expect((await service.cancelJob(canceled.id)).status).toBe("canceled");
  });

  it("rejects invalid transitions", () => {
    expect(isValidJobTransition("queued", "ready")).toBe(false);
    expect(isValidJobTransition("queued", "preparing")).toBe(true);
    expect(isValidJobTransition("ready", "rendering")).toBe(false);
  });
});

describe("V2 routes", () => {
  afterEach(() => {
    nock.cleanAll();
  });

  it("protects internal endpoints", async () => {
    const app = express();
    app.use("/internal/v1", createV2InternalRouter(makeConfig(), {} as ShortCreator));
    await request(app).post("/internal/v1/render/jobs/test/start").send({}).expect(401);
  });

  it("validates public job payloads and redacts settings secrets", async () => {
    const config = makeConfig();
    const db = new FakeDb();
    const app = express();
    app.use("/api/v2", createV2PublicRouter(config, db as any, new JobService(db as any)));

    await request(app).post("/api/v2/jobs").send({ scenes: [] }).expect(400);
    const settings = await request(app).get("/api/v2/settings").expect(200);
    expect(settings.body.pexels.redactedKey).toBe("••••••••");
    expect(JSON.stringify(settings.body)).not.toContain("A".repeat(56));
  });

  it("generates production spec preview and prompt enhancement via API", async () => {
    const config = makeConfig();
    const db = new FakeDb();
    const app = express();
    app.use("/api/v2", createV2PublicRouter(config, db as any, new JobService(db as any)));

    const preview = await request(app)
      .post("/api/v2/production-spec/preview")
      .send({ prompt: "اعمل اعلان 20 ثانية لبراند ملابس" })
      .expect(200);

    expect(preview.body.spec.creationMode).toBe("prompt");
    expect(preview.body.spec.scenes.length).toBeGreaterThanOrEqual(3);
    expect(preview.body.costEstimate.isFree).toBe(true);

    const enhance = await request(app)
      .post("/api/v2/prompt/enhance")
      .send({ prompt: "اعمل اعلان لكافيه" })
      .expect(200);

    expect(enhance.body.enhancedPrompt.length).toBeGreaterThan(15);
    expect(enhance.body.changesSummary.length).toBeGreaterThan(0);
  });

  it("creates a Prompt Mode job and persists ProductionSpec", async () => {
    nock("http://127.0.0.1:1")
      .post("/webhook/abud-v2/jobs/start")
      .reply(202, { accepted: true });

    const config = makeConfig();
    const db = new FakeDb();
    const app = express();
    app.use("/api/v2", createV2PublicRouter(config, db as any, new JobService(db as any)));

    const res = await request(app)
      .post("/api/v2/jobs")
      .send({
        creationMode: "prompt",
        prompt: "Create a 30-second English tech tutorial about automated cloud backups",
        language: "en",
        durationSeconds: 30,
      })
      .expect(201);

    expect(res.body.job.id).toBeDefined();
    expect(res.body.job.creationMode).toBe("prompt");
    expect(res.body.job.language).toBe("en");
    expect(res.body.job.productionSpec).toBeDefined();
  });

  it("lists categorized providers and tests connection endpoints", async () => {
    nock("http://127.0.0.1:1").get("/healthz").reply(200, { ok: true });
    nock("http://127.0.0.1:1").get("/health").reply(200, { ok: true });
    nock("https://api.pexels.com").get("/videos/search").query(true).reply(200, { videos: [] });
    const config = makeConfig();
    const db = new FakeDb();
    const app = express();
    app.use("/api/v2", createV2PublicRouter(config, db as any, new JobService(db as any)));

    const res = await request(app).get("/api/v2/providers").expect(200);
    expect(res.body.providers.some((p: any) => p.category === "Content AI")).toBe(true);
    expect(res.body.providers.some((p: any) => p.category === "Visuals")).toBe(true);
    expect(res.body.providers.some((p: any) => p.category === "Voice")).toBe(true);

    const valGemini = await request(app).post("/api/v2/providers/gemini/validate").expect(200);
    expect(valGemini.body.provider).toBe("Google Gemini");

    const valKokoro = await request(app).post("/api/v2/providers/kokoro/validate").expect(200);
    expect(valKokoro.body.healthy).toBe(true);
  });

  it("aggregates health without exposing provider secrets", async () => {
    nock("https://api.pexels.com")
      .get("/videos/search")
      .query(true)
      .reply(200, { videos: [] });
    const config = makeConfig();
    const db = new FakeDb();
    const app = express();
    app.use("/api/v2", createV2PublicRouter(config, db as any, new JobService(db as any)));

    const response = await request(app).get("/api/v2/system/health").expect(200);
    expect(response.body.components.some((item: any) => item.name === "Database")).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain("A".repeat(56));
  });

  it("validates healthy Pexels provider state without returning the secret", async () => {
    nock("https://api.pexels.com")
      .get("/videos/search")
      .query(true)
      .reply(200, { videos: [] });
    const config = makeConfig();
    const db = new FakeDb();
    const app = express();
    app.use("/api/v2", createV2PublicRouter(config, db as any, new JobService(db as any)));

    const response = await request(app).post("/api/v2/providers/pexels/validate").expect(200);
    expect(response.body.status).toBe("healthy");
    expect(response.body.configured).toBe(true);
    expect(response.body.componentStatus).toBe("healthy");
    expect(JSON.stringify(response.body)).not.toContain("A".repeat(56));
  });

  it("validates invalid Pexels credentials without returning the secret", async () => {
    nock("https://api.pexels.com")
      .get("/videos/search")
      .query(true)
      .reply(401, { error: "invalid" });
    const config = makeConfig();
    const db = new FakeDb();
    const app = express();
    app.use("/api/v2", createV2PublicRouter(config, db as any, new JobService(db as any)));

    const response = await request(app).post("/api/v2/providers/pexels/validate").expect(200);
    expect(response.body.status).toBe("invalid_credentials");
    expect(response.body.configured).toBe(true);
    expect(response.body.componentStatus).toBe("unhealthy");
    expect(JSON.stringify(response.body)).not.toContain("A".repeat(56));
  });

  it("classifies missing, rate-limited, unavailable, and timed-out Pexels checks", async () => {
    const missing = makeConfig();
    missing.pexelsApiKey = "";
    const missingResult = await validatePexelsProvider(missing, { bypassCache: true });
    expect(missingResult.status).toBe("not_configured");
    expect(missingResult.configured).toBe(false);

    const malformed = makeConfig();
    malformed.pexelsApiKey = "invalid-v2-hotfix-key";
    const malformedResult = await validatePexelsProvider(malformed, { bypassCache: true });
    expect(malformedResult.status).toBe("invalid_credentials");
    expect(malformedResult.componentStatus).toBe("unhealthy");

    nock("https://api.pexels.com")
      .get("/videos/search")
      .query(true)
      .reply(429, { error: "rate limited" });
    const limited = makeConfig();
    limited.pexelsApiKey = "B".repeat(56);
    const limitedResult = await validatePexelsProvider(limited, { bypassCache: true });
    expect(limitedResult.status).toBe("rate_limited");
    expect(limitedResult.componentStatus).toBe("degraded");

    nock("https://api.pexels.com")
      .get("/videos/search")
      .query(true)
      .reply(503, { error: "down" });
    const unavailable = makeConfig();
    unavailable.pexelsApiKey = "C".repeat(56);
    const unavailableResult = await validatePexelsProvider(unavailable, { bypassCache: true });
    expect(unavailableResult.status).toBe("provider_unavailable");
    expect(unavailableResult.componentStatus).toBe("degraded");

    nock("https://api.pexels.com")
      .get("/videos/search")
      .query(true)
      .delayConnection(50)
      .reply(200, { videos: [] });
    const timeout = makeConfig();
    timeout.pexelsApiKey = "D".repeat(56);
    const timeoutResult = await validatePexelsProvider(timeout, { bypassCache: true, timeoutMs: 5 });
    expect(timeoutResult.status).toBe("timeout");
    expect(timeoutResult.componentStatus).toBe("degraded");
  });

  it("supports brand CRUD and app settings persistence", async () => {
    const config = makeConfig();
    const db = new FakeDb();
    const app = express();
    app.use("/api/v2", createV2PublicRouter(config, db as any, new JobService(db as any)));

    const created = await request(app)
      .post("/api/v2/brands")
      .send({
        name: "ABUD",
        watermarkText: "ABUD",
        primaryColor: "#24545a",
        accentColor: "#d28b4c",
        captionStyle: "bold",
        includeOutro: true,
        isDefault: true,
      })
      .expect(201);
    expect(created.body.brand.name).toBe("ABUD");
    expect(created.body.brand.isDefault).toBe(true);

    const listed = await request(app).get("/api/v2/brands").expect(200);
    expect(listed.body.brands).toHaveLength(1);

    await request(app)
      .put("/api/v2/settings")
      .send({ defaultBrandId: created.body.brand.id, defaultTemplateId: "product_ad" })
      .expect(200);
    const settings = await request(app).get("/api/v2/settings").expect(200);
    expect(settings.body.settings.defaultTemplateId).toBe("product_ad");

    await request(app).delete(`/api/v2/brands/${created.body.brand.id}`).expect(200);
    const empty = await request(app).get("/api/v2/brands").expect(200);
    expect(empty.body.brands).toHaveLength(0);
  });

  it("serves backend template definitions through V2", async () => {
    const config = makeConfig();
    const db = new FakeDb();
    const app = express();
    app.use("/api/v2", createV2PublicRouter(config, db as any, new JobService(db as any)));

    const response = await request(app).get("/api/v2/templates").expect(200);
    expect(response.body.templates.some((template: any) => template.id === "product_ad")).toBe(true);
  });
});

describe("legacy video compatibility", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const dir of tempRoots) fs.removeSync(dir);
  });

  it("keeps videos visible without V2 database records", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abud-videos-"));
    tempRoots.push(dir);
    fs.writeFileSync(path.join(dir, "legacy-video.mp4"), "fake");
    const files = listVideoFiles(fs.readdirSync(dir));
    const stats = fs.statSync(path.join(dir, files[0]));
    const merged = mergeMetadata({
      videoId: "legacy-video",
      filename: "legacy-video.mp4",
      status: "ready",
      sizeBytes: stats.size,
      createdAt: stats.mtime.toISOString(),
      downloadUrl: "/api/videos/legacy-video/download",
      previewUrl: "/api/short-video/legacy-video",
    }, readMetadata(dir, "legacy-video"));

    expect(merged.videoId).toBe("legacy-video");
    expect(merged.status).toBe("ready");
  });

  it("preserves metadata sidecars for new generated assets", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abud-videos-"));
    tempRoots.push(dir);
    writeMetadata(dir, {
      videoId: "new-video",
      filename: "new-video.mp4",
      status: "ready",
      brandName: "ABUD",
    });
    expect(readMetadata(dir, "new-video")?.brandName).toBe("ABUD");
  });
});
