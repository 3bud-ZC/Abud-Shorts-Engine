import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import fs from "fs-extra";
import os from "os";
import path from "path";

/**
 * Semantic acceptance gate regressions (OpenCLIP-enabled path).
 *
 * A candidate must clear the minimum scene-intent relevance gate on REAL
 * visual-semantic evidence - semantically plausible but wrong stock
 * (coffee beans for a banking scene, a shipping metaphor for load
 * balancing) must lose to a genuinely relevant clip, and must be rejected
 * outright when nothing relevant exists so the scene falls back to
 * purposeful motion graphics instead of forced weak stock.
 */

const scoreByFile = new Map<string, number>();

vi.mock("../media-intelligence/semanticSimilarity", () => ({
  analyzeVideoSemanticSimilarity: vi.fn(async (input: { videoPath: string }) => {
    const base = path.basename(input.videoPath);
    const score = scoreByFile.get(base);
    if (score === undefined) {
      return {
        semanticAvailable: false,
        perceptualAvailable: false,
        perceptualHashes: [],
        frameSampleCount: 0,
        runtime: "unavailable",
        error: "test: no canned score",
      };
    }
    return {
      semanticAvailable: true,
      visualSemanticScore: score,
      perceptualAvailable: true,
      perceptualHashes: ["aa"],
      frameSampleCount: 3,
      runtime: "open_clip",
      blackFramePercent: 0,
      longestBlackRunMs: 0,
    };
  }),
}));

import { AutoVisualRouter, StockVisualRejection } from "./router";
import type { ProductionSceneSpec, ProductionSpec } from "../../../types/productionSpec";

const videoCacheDir = path.join(os.tmpdir(), "short-studio-semantic-candidate-videos");

function candidateFileName(provider: string, id: string | number, url: string): string {
  return `${crypto.createHash("sha256").update(`${provider}:${id}:${url}`).digest("hex").slice(0, 24)}.mp4`;
}

function makeCandidate(over: Partial<any>): any {
  const c = {
    provider: "pexels",
    id: "cand-1",
    kind: "video",
    downloadUrl: "https://videos.pexels.com/cand.mp4",
    width: 1080,
    height: 1920,
    durationSeconds: 8,
    queryUsed: "query",
    tags: ["relevant"],
    contributor: "x",
    semanticScore: 72,
    qualityScore: 90,
    totalScore: 80,
    decisionBreakdown: { semantic: 72, technical: 90, durationFit: 100, orientationFit: 100 },
    ...over,
  };
  return c;
}

/** Pre-place a dummy file so the ranker skips the real download. */
async function stageCandidateVideo(c: any, openClipScore: number): Promise<void> {
  const name = candidateFileName(c.provider, c.id, c.downloadUrl);
  await fs.ensureDir(videoCacheDir);
  const filePath = path.join(videoCacheDir, name);
  await fs.writeFile(filePath, "fake-video-bytes");
  scoreByFile.set(name, openClipScore);
}

const spec: ProductionSpec = {
  id: "sem-gate-spec",
  creationMode: "prompt",
  title: "Semantic gate test",
  language: "ar",
  dialect: "egyptian",
  tone: "clear",
  contentStyle: "explainer",
  durationSeconds: 15,
  aspectRatio: "9:16",
  resolution: "1080p",
  quality: "standard",
  sceneCount: 3,
  visualMode: "stock",
  voiceProvider: "voicetut",
  voiceId: "mohamed",
  captionStyle: "bold",
  scenes: [],
};

const bankingScene: ProductionSceneSpec = {
  sceneIndex: 0,
  purpose: "hook",
  durationSeconds: 5,
  narration: "التوفير التلقائي بيحوّل فلوس للحساب لوحده كل شهر.",
  onScreenText: "توفير تلقائي",
  visualPrompt: "person depositing money into a bank account",
  stockSearchTerms: ["person depositing money", "bank counter", "coffee beans"],
  visualSource: "stock",
  transition: "cut",
};

const apiCacheScene: ProductionSceneSpec = {
  sceneIndex: 0,
  purpose: "solution",
  durationSeconds: 5,
  narration: "الـ API caching بيخزن الردود عشان الطلبات التانية تبقى أسرع.",
  onScreenText: "API Cache",
  visualPrompt: "server returning cached api response diagram",
  stockSearchTerms: ["API cache server", "server infrastructure data", "programmer laptop coding"],
  visualSource: "stock",
  transition: "cut",
};

const loadBalanceScene: ProductionSceneSpec = {
  sceneIndex: 0,
  purpose: "solution",
  durationSeconds: 5,
  narration: "الـ load balancing بيوزع الطلبات على السيرفرات عشان مفيش سيرفر يقع.",
  onScreenText: "Load Balancing",
  visualPrompt: "load balancer distributing traffic across servers",
  stockSearchTerms: ["load balancer servers", "server cluster traffic"],
  visualSource: "stock",
  transition: "cut",
};

const options = { tempDirPath: path.join(os.tmpdir(), "ss-semgate-cache") };

function registryReturning(candidates: any[]): any {
  return {
    searchQueries: vi.fn().mockResolvedValue(candidates),
    configuredProviders: () => [{ id: "pexels" }],
    attributionFor: vi.fn().mockReturnValue(undefined),
  };
}

function routerWith(candidates: any[]): AutoVisualRouter {
  const pexels: any = { id: "pexels", isConfigured: () => false, fetchOrGenerateScene: vi.fn() };
  return new AutoVisualRouter(pexels, [], registryReturning(candidates));
}

describe("OpenCLIP semantic acceptance gate", () => {
  const savedEnv = { ...process.env };
  beforeEach(() => {
    process.env.ABUD_ENABLE_OPENCLIP_SEMANTICS = "true";
    scoreByFile.clear();
  });
  afterEach(() => {
    process.env.ABUD_ENABLE_OPENCLIP_SEMANTICS = savedEnv.ABUD_ENABLE_OPENCLIP_SEMANTICS;
  });

  it("banking intent: coffee beans loses to money footage", async () => {
    const money = makeCandidate({ id: "money-1", downloadUrl: "https://v/money.mp4", queryUsed: "person depositing money", tags: ["money", "bank"] });
    const coffee = makeCandidate({ id: "coffee-1", downloadUrl: "https://v/coffee.mp4", queryUsed: "coffee beans", tags: ["coffee"] });
    await stageCandidateVideo(money, 63);
    await stageCandidateVideo(coffee, 58.5);

    const res = await routerWith([coffee, money]).resolveSceneVisual(bankingScene, spec, options);
    expect(res.provider).toBe("pexels");
    expect(res.metadata?.stockAssetId).toBe("money-1");
    expect(res.metadata?.visualSemanticScore).toBe(63);
    expect(res.metadata?.semanticRuntime).toBe("open_clip");
    // persisted decision evidence: lexical, openclip, quality, decision
    const top = (res.metadata?.candidates as any[]) || [];
    const coffeeRow = top.find((c) => c.assetId === "coffee-1");
    expect(coffeeRow?.visualSemanticScore).toBe(58.5);
  });

  it("banking intent: coffee-only pool is rejected, not forced", async () => {
    const coffee = makeCandidate({ id: "coffee-1", downloadUrl: "https://v/coffee.mp4", queryUsed: "coffee beans", tags: ["coffee"] });
    await stageCandidateVideo(coffee, 58.5);
    await expect(
      routerWith([coffee]).resolveSceneVisual(bankingScene, spec, options),
    ).rejects.toBeInstanceOf(StockVisualRejection);
  });

  it("API cache intent: explanatory candidate beats generic laptop shot", async () => {
    const explanatory = makeCandidate({ id: "cache-1", downloadUrl: "https://v/cache.mp4", queryUsed: "API cache server", tags: ["server"] });
    const laptop = makeCandidate({ id: "laptop-1", downloadUrl: "https://v/laptop.mp4", queryUsed: "programmer laptop coding", tags: ["laptop"] });
    await stageCandidateVideo(explanatory, 63);
    await stageCandidateVideo(laptop, 58);

    const res = await routerWith([laptop, explanatory]).resolveSceneVisual(apiCacheScene, spec, options);
    expect(res.metadata?.stockAssetId).toBe("cache-1");
  });

  it("load balancing intent: shipping-envelope metaphor is rejected", async () => {
    const servers = makeCandidate({ id: "srv-1", downloadUrl: "https://v/servers.mp4", queryUsed: "load balancer servers", tags: ["server"] });
    const envelope = makeCandidate({ id: "env-1", downloadUrl: "https://v/envelope.mp4", queryUsed: "shipping packages", tags: ["envelope"] });
    await stageCandidateVideo(servers, 62);
    await stageCandidateVideo(envelope, 58);

    const res = await routerWith([envelope, servers]).resolveSceneVisual(loadBalanceScene, spec, options);
    expect(res.metadata?.stockAssetId).toBe("srv-1");
  });

  it("envelope-only pool for load balancing rejects below the relevance floor", async () => {
    const envelope = makeCandidate({ id: "env-1", downloadUrl: "https://v/envelope.mp4", queryUsed: "shipping packages", tags: ["envelope"] });
    await stageCandidateVideo(envelope, 58);
    try {
      await routerWith([envelope]).resolveSceneVisual(loadBalanceScene, spec, options);
      expect.unreachable("should have rejected");
    } catch (error) {
      const rejection = error as StockVisualRejection;
      expect(rejection).toBeInstanceOf(StockVisualRejection);
      expect(rejection.details.reason).toBe("no_candidate_passed_thresholds");
      expect(rejection.details.topRejected.length).toBeGreaterThan(0);
    }
  });

  it("a clip just below the OpenCLIP floor is rejected despite strong lexical score", async () => {
    // the live banking trap: coffee scored 59.08 - just under 60 - while its
    // lexical score was strong. The semantic floor, not lexical overlap, is
    // what must reject it.
    const belowFloor = makeCandidate({ id: "sub-1", downloadUrl: "https://v/sub.mp4", semanticScore: 85, queryUsed: "bank counter" });
    await stageCandidateVideo(belowFloor, 59.5);
    await expect(
      routerWith([belowFloor]).resolveSceneVisual(bankingScene, spec, options),
    ).rejects.toBeInstanceOf(StockVisualRejection);
  });
});
