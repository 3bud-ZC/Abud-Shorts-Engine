import { afterEach, describe, expect, it, vi } from "vitest";
import { sceneSourceRouter } from "./visual-providers/sceneSourceRouter";
import { postProductionPipeline } from "./post-production/postProductionPipeline";
import type { ProductionSpec } from "../../types/productionSpec";

function baseSpec(overrides: Partial<ProductionSpec> = {}): ProductionSpec {
  return {
    id: "spec-test",
    creationMode: "prompt",
    title: "Test",
    userPrompt: "اعمل إعلان",
    language: "ar",
    dialect: "egyptian",
    tone: "حماسي",
    contentStyle: "advertisement",
    durationSeconds: 15,
    aspectRatio: "9:16",
    resolution: "1080p",
    quality: "standard",
    sceneCount: 1,
    productionMode: "auto_hybrid",
    visualMode: "auto",
    voiceProvider: "piper",
    voiceId: "ar_JO-kareem-medium",
    captionStyle: "viral_bold",
    scenes: [
      {
        sceneIndex: 0,
        purpose: "hook",
        durationSeconds: 5,
        narration: "بتخسر عملاء بدون موقع؟",
        stockSearchTerms: ["business website"],
        visualSource: "stock",
        transition: "cut",
      },
    ],
    ...overrides,
  };
}

describe("V2.2 Creative Quality Engine", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("routes product ad scenes to product composition without forcing whole-video stock", () => {
    const decisions = sceneSourceRouter.routeSpec(baseSpec({
      productionMode: "product_ad",
      contentStyle: "product_showcase",
      metadata: { productImageId: "upload-1" },
    }));
    expect(decisions[0].source).toBe("product_composition");
    expect(decisions[0].providerId).toBe("rembg_product_pipeline");
    expect(decisions[0].fallbackSource).toBe("stock");
  });

  it("routes animated explainers to Motion Canvas scene assets", () => {
    const decisions = sceneSourceRouter.routeSpec(baseSpec({
      productionMode: "animated_explainer",
      visualMode: "animated_explainer",
    }));
    expect(decisions[0].source).toBe("motion_graphics");
    expect(decisions[0].providerId).toBe("motion_canvas");
  });

  it("keeps AI video behind explicit mode or enabled GPU pack", () => {
    const stock = sceneSourceRouter.routeSpec(baseSpec());
    expect(stock[0].source).toBe("stock");

    const ai = sceneSourceRouter.routeSpec(baseSpec({ productionMode: "ai_generated", visualMode: "ai" }));
    expect(ai[0].source).toBe("ai_generated_video");
  });

  it("reports optional processors as implemented but disabled when runtimes are absent", () => {
    const processors = postProductionPipeline.listProcessors();
    const sceneDetection = processors.find((processor) => processor.id === "scene_detection");
    const captions = processors.find((processor) => processor.id === "caption_composition");

    expect(sceneDetection?.implemented).toBe(true);
    expect(sceneDetection?.enabled).toBe(false);
    expect(sceneDetection?.failurePolicy).toBe("fallback_deterministic");
    expect(captions?.available).toBe(true);
    expect(captions?.failurePolicy).toBe("required");
  });
});
