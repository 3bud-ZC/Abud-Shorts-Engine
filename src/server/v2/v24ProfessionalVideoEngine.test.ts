import { describe, expect, it, vi } from "vitest";
import fs from "fs-extra";
import path from "path";
import nock from "nock";
import fluentFfmpeg from "fluent-ffmpeg";
import { OrientationEnum } from "../../types/shorts";
import type { ProductionSceneSpec, ProductionSpec } from "../../types/productionSpec";
import { LocalContentAIProvider } from "./content-ai/localProvider";
import {
  calculateProfessionalVisualQualityReport,
  containsRawPromptLeak,
  detectInventedClaimRisk,
} from "./quality/professionalVisualQuality";
import {
  StockProviderRegistry,
  scoreCandidateQuality,
  type ScoredCandidate,
} from "./stock-providers/stockProviderRegistry";
import type { StockProvider } from "./stock-providers/types";
import { PexelsStockProvider } from "./stock-providers/pexelsProvider";
import { PixabayProvider } from "./stock-providers/pixabayProvider";
import { PexelsVisualProvider } from "./visual-providers/pexelsVisualProvider";
import { AutoVisualRouter, rankStockCandidatesWithVisualSemantics } from "./visual-providers/router";
import { FalVisualProvider } from "./visual-providers/falVisualProvider";
import { ReplicateVisualProvider } from "./visual-providers/replicateVisualProvider";
import { LumaVisualProvider } from "./visual-providers/lumaVisualProvider";
import { downloadGeneratedAsset } from "./visual-providers/asyncProviderRuntime";
import { buildEditDecisionList } from "./editing/editDecisionList";
import { ProviderCredentialsVault, allowedCredentialTypes } from "./provider-vault/providerCredentialsVault";
import { providerSecrets } from "./provider-vault/providerSecrets";
import { validatePexelsProvider } from "./health";
import {
  arePerceptuallyNearDuplicate,
  perceptualHashDistance,
  semanticAssetIdentity,
  semanticCacheKey,
} from "./media-intelligence/semanticSimilarity";

const scene: ProductionSceneSpec = {
  sceneIndex: 0,
  purpose: "hook",
  durationSeconds: 5,
  narration: "Modern service ad narration",
  stockSearchTerms: ["business owner laptop", "website design"],
  visualSource: "stock",
  transition: "cut",
};

const spec: ProductionSpec = {
  id: "v24-test",
  creationMode: "prompt",
  title: "V2.4 Test",
  userPrompt: "Create a modern 20-second vertical Reel for a small web-design service. No invented discount or phone number.",
  language: "en",
  dialect: "none",
  tone: "professional",
  contentStyle: "advertisement",
  durationSeconds: 20,
  aspectRatio: "9:16",
  resolution: "1080p",
  quality: "standard",
  sceneCount: 1,
  visualMode: "auto",
  voiceProvider: "kokoro",
  voiceId: "af_heart",
  captionStyle: "bold",
  scenes: [scene],
};

function stockProvider(id: "pexels" | "pixabay", candidates: any[], fail = false): StockProvider {
  return {
    id,
    displayName: id,
    license: `${id} license`,
    isConfigured: () => true,
    search: vi.fn(async () => {
      if (fail) throw new Error(`${id} down`);
      return candidates;
    }),
    attributionFor: (candidate: any) => ({
      provider: id,
      assetId: candidate.id,
      credit: `${id} credit`,
      license: `${id} license`,
    }),
  };
}

describe("V2.4 Professional Video Production Engine", () => {
  it("searches stock providers as one ranked mesh and isolates provider failures", async () => {
    const registry = new StockProviderRegistry([
      stockProvider("pexels", [], true),
      stockProvider("pixabay", [{
        provider: "pixabay",
        id: "pb-1",
        kind: "video",
        downloadUrl: "https://cdn.example/pb-1.mp4",
        width: 1080,
        height: 1920,
        durationSeconds: 12,
        contributor: "Creator",
        sourcePageUrl: "https://pixabay.com/videos/pb-1",
        tags: ["business owner laptop"],
      }]),
    ]);

    const results = await registry.searchAll({
      query: "business owner laptop",
      orientation: "portrait",
      kind: "video",
      minDurationSeconds: 4,
    });

    expect(results).toHaveLength(1);
    expect(results[0].provider).toBe("pixabay");
    expect(results[0].totalScore).toBeGreaterThan(60);
  });

  it("routes Auto stock through the unified stock mesh instead of hard-coded Pexels", async () => {
    const registry = new StockProviderRegistry([
      stockProvider("pixabay", [{
        provider: "pixabay",
        id: "selected-pixabay",
        kind: "video",
        downloadUrl: "https://cdn.example/selected-pixabay.mp4",
        width: 1080,
        height: 1920,
        durationSeconds: 9,
        tags: ["business owner laptop"],
      }]),
    ]);
    const legacyPexels = new PexelsVisualProvider({ findVideo: vi.fn() } as any, "");
    const router = new AutoVisualRouter(legacyPexels, [], registry);

    const result = await router.resolveSceneVisual(scene, spec, {
      orientation: OrientationEnum.portrait,
      tempDirPath: "/tmp",
      targetDurationSeconds: 5,
    });

    expect(result.provider).toBe("pixabay");
    expect(result.metadata?.providerAssetId).toBe("selected-pixabay");
    expect(result.metadata?.attribution).toMatchObject({ provider: "pixabay" });
  });

  it("lets OpenCLIP semantic ranking override the lexical stock order before shot selection", async () => {
    const previous = process.env.ABUD_ENABLE_OPENCLIP_SEMANTICS;
    process.env.ABUD_ENABLE_OPENCLIP_SEMANTICS = "true";
    const candidates: ScoredCandidate[] = [
      {
        provider: "pexels",
        id: "lexical-first",
        kind: "video",
        downloadUrl: "https://cdn.example/lexical-first.mp4",
        width: 1080,
        height: 1920,
        durationSeconds: 9,
        tags: ["business", "laptop"],
        qualityScore: 90,
        semanticScore: 95,
        totalScore: 94,
        decisionBreakdown: { semantic: 95, technical: 90, durationFit: 100, orientationFit: 100 },
      },
      {
        provider: "pixabay",
        id: "visually-best",
        kind: "video",
        downloadUrl: "https://cdn.example/visually-best.mp4",
        width: 1080,
        height: 1920,
        durationSeconds: 9,
        tags: ["workspace", "founder"],
        qualityScore: 90,
        semanticScore: 50,
        totalScore: 71,
        decisionBreakdown: { semantic: 50, technical: 90, durationFit: 100, orientationFit: 100 },
      },
    ];

    try {
      const ranked = await rankStockCandidatesWithVisualSemantics(candidates, {
        cacheRoot: "/tmp",
        intentText: "founder reviewing website analytics in a modern workspace",
        downloadCandidate: vi.fn(async (_candidate, destinationPath) => {
          await fs.ensureFile(destinationPath);
        }),
        analyzer: vi.fn(async (input) => ({
          provider: input.provider,
          assetId: input.assetId,
          modelId: "openclip:ViT-B-32/laion2b_s34b_b79k",
          modelVersion: "test",
          license: "MIT",
          cacheKey: input.assetId,
          cacheHit: false,
          frameSampleCount: 3,
          frameSamplePercents: [20, 50, 80],
          perceptualAvailable: true,
          perceptualHashes: ["a", "b", "c"],
          semanticAvailable: true,
          visualSemanticScore: input.assetId.includes("visually-best") ? 98 : 40,
          runtime: "open_clip",
        })),
      });

      expect(ranked[0].id).toBe("visually-best");
      expect(ranked[0].semanticRuntime).toBe("open_clip");
      expect(ranked[0].visualSemanticScore).toBe(98);
      expect(ranked[0].totalScore).toBeGreaterThan(ranked[1].totalScore);
    } finally {
      if (previous === undefined) delete process.env.ABUD_ENABLE_OPENCLIP_SEMANTICS;
      else process.env.ABUD_ENABLE_OPENCLIP_SEMANTICS = previous;
    }
  });

  it("keeps stock clips with long black runs from winning semantic ranking", async () => {
    const previous = process.env.ABUD_ENABLE_OPENCLIP_SEMANTICS;
    process.env.ABUD_ENABLE_OPENCLIP_SEMANTICS = "true";
    const candidates: ScoredCandidate[] = [
      {
        provider: "pexels",
        id: "semantically-strong-black-run",
        kind: "video",
        downloadUrl: "https://cdn.example/semantically-strong-black-run.mp4",
        width: 1080,
        height: 1920,
        durationSeconds: 9,
        tags: ["workspace", "founder"],
        qualityScore: 95,
        semanticScore: 90,
        totalScore: 92,
        decisionBreakdown: { semantic: 90, technical: 95, durationFit: 100, orientationFit: 100 },
      },
      {
        provider: "pixabay",
        id: "clean-stock-clip",
        kind: "video",
        downloadUrl: "https://cdn.example/clean-stock-clip.mp4",
        width: 1080,
        height: 1920,
        durationSeconds: 9,
        tags: ["business", "laptop"],
        qualityScore: 88,
        semanticScore: 70,
        totalScore: 78,
        decisionBreakdown: { semantic: 70, technical: 88, durationFit: 100, orientationFit: 100 },
      },
    ];

    try {
      const ranked = await rankStockCandidatesWithVisualSemantics(candidates, {
        cacheRoot: "/tmp",
        intentText: "founder reviewing website analytics in a modern workspace",
        downloadCandidate: vi.fn(async (_candidate, destinationPath) => {
          await fs.ensureFile(destinationPath);
        }),
        analyzer: vi.fn(async (input) => {
          const hasBlackRun = input.assetId.includes("semantically-strong-black-run");
          return {
            provider: input.provider,
            assetId: input.assetId,
            modelId: "openclip:ViT-B-32/laion2b_s34b_b79k",
            modelVersion: "test",
            license: "MIT",
            cacheKey: input.assetId,
            cacheHit: false,
            frameSampleCount: 3,
            frameSamplePercents: [20, 50, 80],
            perceptualAvailable: true,
            perceptualHashes: ["a", "b", "c"],
            semanticAvailable: true,
            visualSemanticScore: hasBlackRun ? 99 : 82,
            blackFramePercent: hasBlackRun ? 3 : 0,
            longestBlackRunMs: hasBlackRun ? 600 : 0,
            runtime: "open_clip",
          };
        }),
      });

      expect(ranked[0].id).toBe("clean-stock-clip");
      expect(ranked[0].visualHealthPass).toBe(true);
      expect(ranked[1].visualHealthPass).toBe(false);
      expect(ranked[1].longestBlackRunMs).toBe(600);
    } finally {
      if (previous === undefined) delete process.env.ABUD_ENABLE_OPENCLIP_SEMANTICS;
      else process.env.ABUD_ENABLE_OPENCLIP_SEMANTICS = previous;
    }
  });

  it("uses the current Pexels v1 video search contract", async () => {
    const originalFetch = global.fetch;
    const fetchMock = vi.fn(async (url: any, init: any) => {
      const parsed = new URL(String(url));
      expect(parsed.origin + parsed.pathname).toBe("https://api.pexels.com/v1/videos/search");
      expect(parsed.searchParams.get("orientation")).toBe("portrait");
      expect(Number(parsed.searchParams.get("per_page"))).toBeLessThanOrEqual(80);
      expect(init.headers.Authorization).toBe("pexels-test-key");
      return {
        ok: true,
        json: async () => ({
          videos: [{
            id: 123,
            url: "https://www.pexels.com/video/123/",
            image: "https://images.pexels.com/123.jpg",
            duration: 9,
            user: { name: "Creator", url: "https://www.pexels.com/@creator" },
            video_files: [{ id: 1, quality: "hd", width: 1080, height: 1920, fps: 25, link: "https://cdn.pexels.com/123.mp4" }],
          }],
        }),
      } as any;
    });
    global.fetch = fetchMock as any;

    try {
      const provider = new PexelsStockProvider("pexels-test-key");
      const results = await provider.search({
        query: "business owner laptop",
        orientation: "portrait",
        kind: "video",
        perPage: 12,
      });

      expect(results[0]).toMatchObject({
        provider: "pexels",
        id: "123",
        queryUsed: "business owner laptop",
        fileType: "hd",
        fps: 25,
      });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("uses the current Pixabay video search contract", async () => {
    nock("https://pixabay.com")
      .get("/api/videos/")
      .query((query) => query.key === "pixabay-test-key" && query.q === "business owner laptop" && query.orientation === "vertical")
      .reply(200, {
        hits: [{
          id: 77,
          pageURL: "https://pixabay.com/videos/77/",
          duration: 8,
          tags: "business, laptop, office",
          user: "Creator",
          user_id: 55,
          videos: { medium: { url: "https://cdn.pixabay.com/77.mp4", width: 1080, height: 1920, size: 1234567 } },
        }],
      });

    const provider = new PixabayProvider("pixabay-test-key");
    const results = await provider.search({
      query: "business owner laptop",
      orientation: "portrait",
      kind: "video",
      perPage: 12,
    });

    expect(results[0]).toMatchObject({
      provider: "pixabay",
      id: "77",
      queryUsed: "business owner laptop",
      fileSizeBytes: 1234567,
    });
    nock.cleanAll();
  });

  it("keeps Pexels and Pixabay configurable through the encrypted vault contract", async () => {
    expect(allowedCredentialTypes("pexels")).toEqual(["api_key"]);
    expect(allowedCredentialTypes("pixabay")).toEqual(["api_key"]);

    const rows: any[] = [];
    const db = {
      query: vi.fn(async (sql: string, values: unknown[] = []) => {
        if (sql.includes("INSERT INTO provider_credentials_vault")) {
          const row = {
            provider_id: values[0],
            credential_type: values[1],
            ciphertext: values[2],
            iv: values[3],
            auth_tag: values[4],
            key_version: 1,
            masked_hint: values[5],
            metadata: {},
            health: "configured",
            configured_at: new Date("2026-08-28T00:00:00Z"),
            updated_at: new Date("2026-08-28T00:00:00Z"),
          };
          rows.push(row);
          return [row];
        }
        if (sql.includes("SELECT provider_id")) return rows;
        return [];
      }),
    };
    const vault = new ProviderCredentialsVault(db as any, {
      providerVaultMasterKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    } as any);
    const saved = await vault.put({ providerId: "pixabay", credentialType: "api_key", plaintext: "pixabay_secret_key_123456" });

    expect(saved.maskedHint).toBe("pixa••••3456");
    expect(JSON.stringify(saved)).not.toContain("pixabay_secret_key");
    expect(JSON.stringify(rows)).not.toContain("pixabay_secret_key");
  });

  it("prefers Provider Vault credentials over installation config for free stock runtime", async () => {
    const vaultKey = "V".repeat(40);
    providerSecrets.registerResolver(async (providerId, credentialType) => {
      if (providerId === "pexels" && credentialType === "api_key") return vaultKey;
      return null;
    });
    await providerSecrets.refresh("pexels", "api_key");

    try {
      const provider = new PexelsStockProvider("E".repeat(40));
      expect(provider.getApiKey()).toBe(vaultKey);

      nock("https://api.pexels.com", {
        reqheaders: { authorization: vaultKey },
      })
        .get("/v1/videos/search")
        .query((query) => query.query === "business" && query.orientation === "portrait")
        .reply(200, { videos: [] });

      const result = await validatePexelsProvider({
        pexelsApiKey: "",
        pexelsValidationTimeoutMs: 1000,
      } as any, { bypassCache: true });

      expect(result.configured).toBe(true);
      expect(result.status).toBe("healthy");
    } finally {
      providerSecrets.unregisterResolver();
      nock.cleanAll();
    }
  });

  it("blocks professional Auto when no real visual provider exists", async () => {
    // config.ts's `import "dotenv/config"` loads this repo's real dev .env
    // (which carries a real PEXELS_API_KEY for the dev stack) as a side
    // effect of merely importing config - PexelsVisualProvider.getApiKey()
    // falls back to it, so constructing an "unconfigured" provider with an
    // empty string here is silently defeated unless it is cleared for this
    // test, same as the ELEVENLABS_API_KEY isolation elsewhere in this suite.
    const previousPexelsKey = process.env.PEXELS_API_KEY;
    delete process.env.PEXELS_API_KEY;
    try {
      const registry = new StockProviderRegistry([]);
      const legacyPexels = new PexelsVisualProvider({ findVideo: vi.fn() } as any, "");
      const router = new AutoVisualRouter(legacyPexels, [], registry);

      await expect(router.resolveSceneVisual(scene, spec, {
        orientation: OrientationEnum.portrait,
        tempDirPath: "/tmp",
        targetDurationSeconds: 5,
      })).rejects.toThrow("Professional automatic video needs at least one visual source");
    } finally {
      if (previousPexelsKey === undefined) delete process.env.PEXELS_API_KEY;
      else process.env.PEXELS_API_KEY = previousPexelsKey;
    }
  });

  it("fails closed with the canonical error when a configured Pexels provider returns no usable video", async () => {
    // The provider IS "configured" (a real-shaped key), but its own call
    // comes back empty/malformed - the invariant under test is that this
    // never surfaces as a raw property-access crash, regardless of why the
    // provider failed to produce a result.
    const registry = new StockProviderRegistry([]);
    const legacyPexels = new PexelsVisualProvider({ findVideo: vi.fn().mockResolvedValue(undefined) } as any, "P".repeat(40));
    const router = new AutoVisualRouter(legacyPexels, [], registry);

    await expect(router.resolveSceneVisual(scene, spec, {
      orientation: OrientationEnum.portrait,
      tempDirPath: "/tmp",
      targetDurationSeconds: 5,
    })).rejects.toThrow("Professional automatic video needs at least one visual source");
  });

  it("fails closed with the canonical error when the configured Pexels provider throws", async () => {
    const registry = new StockProviderRegistry([]);
    const legacyPexels = new PexelsVisualProvider(
      { findVideo: vi.fn().mockRejectedValue(new Error("Pexels API is unreachable")) } as any,
      "P".repeat(40),
    );
    const router = new AutoVisualRouter(legacyPexels, [], registry);

    await expect(router.resolveSceneVisual(scene, spec, {
      orientation: OrientationEnum.portrait,
      tempDirPath: "/tmp",
      targetDurationSeconds: 5,
    })).rejects.toThrow("Professional automatic video needs at least one visual source");
  });

  it("returns a real scene when the configured Pexels provider succeeds", async () => {
    const registry = new StockProviderRegistry([]);
    const legacyPexels = new PexelsVisualProvider(
      {
        findVideo: vi.fn().mockResolvedValue({
          id: "pexels-123",
          url: "https://videos.pexels.com/real-clip.mp4",
          width: 1080,
          height: 1920,
        }),
      } as any,
      "P".repeat(40),
    );
    const router = new AutoVisualRouter(legacyPexels, [], registry);

    const result = await router.resolveSceneVisual(scene, spec, {
      orientation: OrientationEnum.portrait,
      tempDirPath: "/tmp",
      targetDurationSeconds: 5,
    });

    expect(result.url).toBe("https://videos.pexels.com/real-clip.mp4");
    expect(result.provider).toBe("pexels");
  });

  it("normalizes async generated-video lifecycle without requiring synchronous MP4 output", () => {
    const fal = new FalVisualProvider("configured-fal-key");
    const queued = fal.normalizeResult({
      request_id: "fal-request-1",
      status_url: "https://queue.fal.run/status",
      response_url: "https://queue.fal.run/response",
      status: "IN_QUEUE",
    }, { scene, prompt: "test", durationSeconds: 5 });
    expect(queued.status).toBe("QUEUED");
    expect(queued.outputUrl).toBeUndefined();

    const replicate = new ReplicateVisualProvider("configured-replicate-token");
    const prediction = replicate.normalizeResult({
      id: "pred-1",
      status: "succeeded",
      output: ["https://replicate.delivery/video.mp4"],
      urls: { get: "https://api.replicate.com/v1/predictions/pred-1", cancel: "https://api.replicate.com/v1/predictions/pred-1/cancel" },
    }, { scene, prompt: "test", durationSeconds: 5 });
    expect(prediction.status).toBe("COMPLETE");
    expect(prediction.outputUrl).toContain("replicate.delivery");
  });

  it("submits Luma jobs against the current Agents API contract when paid calls are explicitly authorized", async () => {
    nock("https://agents.lumalabs.ai", {
      reqheaders: { authorization: "Bearer luma-agents-key-123456" },
    })
      .post("/v1/generations", (body: any) => (
        body.prompt === "test prompt" &&
        body.model === "ray-3.2" &&
        body.type === "video" &&
        body.aspect_ratio === "9:16" &&
        body.video?.duration === "5s" &&
        body.video?.resolution === "720p"
      ))
      .reply(200, {
        id: "generation-1",
        state: "queued",
      });

    const provider = new LumaVisualProvider("luma-agents-key-123456");
    const job = await provider.submit({
      scene,
      prompt: "test prompt",
      durationSeconds: 5,
      aspectRatio: "9:16",
      paidCallAuthorized: true,
    });

    expect(job.providerRequestId).toBe("generation-1");
    expect(job.status).toBe("QUEUED");
    expect(job.metadata?.model).toBe("ray-3.2");
    nock.cleanAll();
  });

  it("builds a professional shot plan with richer shot contract fields", () => {
    const edl = buildEditDecisionList({
      totalDurationSeconds: 20,
      pacingProfile: "editorial_ad",
      scenes: [
        { sceneId: "scene0", sceneIndex: 0, purpose: "hook", durationSeconds: 6, startSeconds: 0, narration: "Show a business owner reviewing a website", searchTerms: ["business owner laptop website", "designer presenting responsive website"] },
        { sceneId: "scene1", sceneIndex: 1, purpose: "solution", durationSeconds: 8, startSeconds: 6, narration: "Show the transformed workflow", searchTerms: ["startup team reviewing interface", "website mobile desktop closeup"] },
        { sceneId: "scene2", sceneIndex: 2, purpose: "cta", durationSeconds: 6, startSeconds: 14, narration: "Invite the viewer to follow for more details", searchTerms: ["small business owner smiling laptop"] },
      ],
    });

    expect(edl.shots.length).toBeGreaterThan(3);
    expect(edl.averageShotSeconds).toBeGreaterThanOrEqual(1);
    expect(edl.averageShotSeconds).toBeLessThanOrEqual(3.5);
    expect(edl.shots[0]).toMatchObject({
      sceneIndex: 0,
      visualIntent: expect.any(String),
      subject: expect.any(String),
      framing: expect.any(String),
      cameraMovement: expect.any(String),
      sourcePreference: "stock",
      fallbackClasses: expect.arrayContaining(["STOCK_VIDEO"]),
      overlayIntent: expect.any(String),
      captionPriority: expect.any(String),
      musicEnergy: expect.any(String),
      sfxIntent: expect.any(String),
      timelineIn: 0,
    });
  });

  it("scores candidate decisions from explainable measurable components", () => {
    const portrait = scoreCandidateQuality({
      provider: "pexels",
      id: "portrait",
      kind: "video",
      downloadUrl: "https://cdn.example/portrait.mp4",
      width: 1080,
      height: 1920,
      durationSeconds: 12,
    }, { query: "business", orientation: "portrait", kind: "video", minDurationSeconds: 3 });
    const landscape = scoreCandidateQuality({
      provider: "pixabay",
      id: "landscape",
      kind: "video",
      downloadUrl: "https://cdn.example/landscape.mp4",
      width: 1280,
      height: 720,
      durationSeconds: 2,
    }, { query: "business", orientation: "portrait", kind: "video", minDurationSeconds: 3 });

    expect(portrait).toBeGreaterThan(landscape);
  });

  it("creates stable semantic cache keys and detects perceptual near-duplicates without secrets", () => {
    const key = semanticCacheKey("pexels", "https://cdn.example/video.mp4?token=secret", "model-v1");
    expect(key).toContain("pexels");
    expect(key).toContain("model-v1");
    expect(key).not.toContain("https://");
    expect(key).not.toContain("secret");
    const assetIdentity = semanticAssetIdentity("https://cdn.example/video.mp4?token=secret");
    expect(assetIdentity).toHaveLength(20);
    expect(assetIdentity).not.toContain("https://");
    expect(assetIdentity).not.toContain("secret");

    expect(perceptualHashDistance("ffffffffffffffff", "ffffffffffffffff")).toBe(0);
    expect(arePerceptuallyNearDuplicate("ffffffffffffffff", "fffffffffffffffe")).toBe(true);
    expect(arePerceptuallyNearDuplicate("ffffffffffffffff", "0000000000000000")).toBe(false);
  });

  it("ffprobe-validates generated provider downloads before accepting them", async () => {
    const destinationPath = path.join(process.cwd(), "tmp", "v24-generated-download.mp4");
    await fs.remove(destinationPath);
    nock("https://provider.example")
      .get("/video.mp4")
      .reply(200, Buffer.alloc(12_000, 1), { "content-type": "video/mp4" });
    const mockProbe = vi.spyOn(fluentFfmpeg, "ffprobe").mockImplementation((_path: any, callback: any) => {
      callback(null, {
        format: { duration: "5.240000", format_name: "mov,mp4,m4a,3gp,3g2,mj2" },
        streams: [{ codec_type: "video", width: 1080, height: 1920, codec_name: "h264" }],
      } as any);
      return {} as any;
    });

    const result = await downloadGeneratedAsset({
      provider: "replicate",
      providerRequestId: "prediction-1",
      status: "COMPLETE",
      outputUrl: "https://provider.example/video.mp4",
      submittedAt: new Date().toISOString(),
    }, destinationPath);

    expect(result.localPath).toBe(destinationPath);
    expect(result.durationSeconds).toBe(5.24);
    expect(result.metadata?.technicalValidation).toMatchObject({
      valid: true,
      ffprobeBacked: true,
      width: 1080,
      height: 1920,
      videoCodec: "h264",
    });

    mockProbe.mockRestore();
    nock.cleanAll();
    await fs.remove(destinationPath);
  });

  it("rejects generated provider downloads that are not real video assets", async () => {
    const destinationPath = path.join(process.cwd(), "tmp", "v24-bad-download.mp4");
    await fs.remove(destinationPath);
    nock("https://provider.example")
      .get("/bad.mp4")
      .reply(200, Buffer.alloc(12_000, 1), { "content-type": "text/html" });
    const mockProbe = vi.spyOn(fluentFfmpeg, "ffprobe").mockImplementation((_path: any, callback: any) => {
      callback(null, {
        format: { duration: "0", format_name: "html" },
        streams: [],
      } as any);
      return {} as any;
    });

    await expect(downloadGeneratedAsset({
      provider: "runway",
      providerRequestId: "task-1",
      status: "COMPLETE",
      outputUrl: "https://provider.example/bad.mp4",
      submittedAt: new Date().toISOString(),
    }, destinationPath)).rejects.toThrow("missing_video_stream");
    expect(await fs.pathExists(destinationPath)).toBe(false);

    mockProbe.mockRestore();
    nock.cleanAll();
  });

  it("keeps raw customer prompts and unsupported claims out of script/on-screen text", async () => {
    const provider = new LocalContentAIProvider();
    const generated = await provider.generateProductionSpec({
      prompt: "Create a modern 20-second vertical Reel for a small web-design service. Show people and laptops. No invented discount or phone number.",
      language: "en",
      durationSeconds: 20,
      aspectRatio: "9:16",
      visualMode: "auto",
    } as any);

    const combinedText = [
      generated.cta?.text,
      generated.contact,
      ...generated.scenes.flatMap((item) => [item.narration, item.onScreenText]),
    ].filter(Boolean).join(" ");

    expect(combinedText).not.toMatch(/WhatsApp/i);
    expect(combinedText).not.toMatch(/discount|offer|phone number/i);
    expect(generated.scenes.some((item) => containsRawPromptLeak(generated.userPrompt, item.onScreenText))).toBe(false);
    expect(detectInventedClaimRisk(generated)).toBe(0);
  });

  it("separates technical validity from professional visual coverage", () => {
    const report = calculateProfessionalVisualQualityReport({
      spec,
      totalDurationSeconds: 20,
      selectedVisuals: [
        { provider: "pexels", url: "https://cdn.example/a.mp4", metadata: { providerAssetId: "a", semanticScore: 90 } },
        { provider: "pixabay", url: "https://cdn.example/b.mp4", metadata: { providerAssetId: "b", semanticScore: 82 } },
      ],
      shots: [
        { shotId: "s1", narrationSceneId: "n1", narrationSceneIndex: 0, intent: "hook", sourceType: "stock", start: 0, duration: 10 },
        { shotId: "s2", narrationSceneId: "n1", narrationSceneIndex: 0, intent: "solution", sourceType: "stock", start: 10, duration: 10 },
      ],
    });

    expect(report.realVisualCoveragePercent).toBe(100);
    expect(report.textOnlyTimelinePercent).toBe(0);
    expect(report.repeatedAssetCount).toBe(0);
    expect(report.readyForProfessionalAuto).toBe(true);
  });

  it("flags motion-card dominated output even if the MP4 could be technically valid", () => {
    const report = calculateProfessionalVisualQualityReport({
      spec,
      totalDurationSeconds: 20,
      selectedVisuals: [{ provider: "abud_motion", url: "motion://card", metadata: { providerAssetId: "card" } }],
      shots: [
        { shotId: "s1", narrationSceneId: "n1", narrationSceneIndex: 0, intent: "hook", sourceType: "motion", start: 0, duration: 20 },
      ],
    });

    expect(report.realVisualCoveragePercent).toBe(0);
    expect(report.textOnlyTimelinePercent).toBe(100);
    expect(report.issues).toContain("real_visual_coverage_below_90_percent");
    expect(report.readyForProfessionalAuto).toBe(false);
  });
});
