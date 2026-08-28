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
  type ScoredCandidate,
} from "./stock-providers/stockProviderRegistry";
import type { StockProvider } from "./stock-providers/types";
import { PexelsVisualProvider } from "./visual-providers/pexelsVisualProvider";
import { AutoVisualRouter } from "./visual-providers/router";
import { FalVisualProvider } from "./visual-providers/falVisualProvider";
import { ReplicateVisualProvider } from "./visual-providers/replicateVisualProvider";
import { downloadGeneratedAsset } from "./visual-providers/asyncProviderRuntime";

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

  it("blocks professional Auto when no real visual provider exists", async () => {
    const registry = new StockProviderRegistry([]);
    const legacyPexels = new PexelsVisualProvider({ findVideo: vi.fn() } as any, "");
    const router = new AutoVisualRouter(legacyPexels, [], registry);

    await expect(router.resolveSceneVisual(scene, spec, {
      orientation: OrientationEnum.portrait,
      tempDirPath: "/tmp",
      targetDurationSeconds: 5,
    })).rejects.toThrow("Professional automatic video needs at least one visual source");
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
