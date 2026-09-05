import { describe, expect, it } from "vitest";
import type { ProductionSpec } from "../../../types/productionSpec";
import type { VisualShot } from "../editing/editDecisionList";
import { decideRenderStrategy } from "./renderStrategy";

function spec(overrides: Partial<ProductionSpec> = {}): ProductionSpec {
  return {
    id: "render-strategy-test",
    creationMode: "prompt",
    title: "Strategy Test",
    language: "en",
    dialect: "none",
    tone: "clear",
    contentStyle: "advertisement",
    durationSeconds: 20,
    aspectRatio: "9:16",
    resolution: "1080p",
    quality: "standard",
    sceneCount: 1,
    productionMode: "auto_hybrid",
    visualMode: "stock",
    voiceProvider: "kokoro",
    voiceId: "",
    captionStyle: "clean",
    scenes: [{
      sceneIndex: 0,
      purpose: "hook",
      durationSeconds: 20,
      narration: "A clean business reel.",
      stockSearchTerms: ["business laptop"],
      visualSource: "stock",
      transition: "cut",
    }],
    ...overrides,
  };
}

function shot(sourceType: VisualShot["sourceType"], overrides: Partial<VisualShot> = {}): VisualShot {
  return {
    shotId: `${sourceType}-shot`,
    narrationSceneId: "scene0",
    narrationSceneIndex: 0,
    sceneIndex: 0,
    intent: "hook",
    sourceType,
    start: 0,
    duration: 20,
    ...overrides,
  };
}

describe("render strategy selection", () => {
  it("selects FFmpeg Fast for stock/upload/generated-video timelines with native captions", () => {
    const decision = decideRenderStrategy({
      spec: spec(),
      shots: [shot("stock"), shot("upload"), shot("image")],
      captionsNativeAvailable: true,
      durationSeconds: 20,
    });

    expect(decision.strategy).toBe("FFMPEG_FAST");
    expect(decision.fastPathEligible).toBe(true);
    expect(decision.baseFootageFramesThroughChromium).toBe(0);
  });

  it("selects Hybrid when pre-rendered overlay assets ride on a native visual bed", () => {
    const decision = decideRenderStrategy({
      spec: spec({ visualMode: "auto" }),
      shots: [shot("stock"), shot("mockup")],
      captionsNativeAvailable: true,
      durationSeconds: 20,
    });

    expect(decision.strategy).toBe("HYBRID");
    expect(decision.fastPathEligible).toBe(true);
    expect(decision.reasons).toContain("native_footage_with_pre_rendered_overlay_assets");
  });

  it("keeps full Remotion for intentionally graphics-led productions", () => {
    const decision = decideRenderStrategy({
      spec: spec({ productionMode: "motion_graphics", visualMode: "motion_graphics" }),
      shots: [shot("motion")],
      captionsNativeAvailable: true,
      durationSeconds: 20,
    });

    expect(decision.strategy).toBe("REMOTION_FULL");
    expect(decision.fastPathEligible).toBe(false);
    expect(decision.remotionRequiredReasons).toContain("graphics_led_production");
    expect(decision.baseFootageFramesThroughChromium).toBe(500);
  });

  it("falls back to Remotion when captions cannot be drawn natively", () => {
    const decision = decideRenderStrategy({
      spec: spec({ captionStyle: "viral_bold" }),
      shots: [shot("stock")],
      captionsNativeAvailable: false,
      durationSeconds: 20,
    });

    expect(decision.strategy).toBe("REMOTION_FULL");
    expect(decision.remotionRequiredReasons).toContain("caption_renderer_requires_remotion");
  });

  it("keeps product composition on Remotion because its overlay is not pre-rendered", () => {
    const decision = decideRenderStrategy({
      spec: spec({ productionMode: "product_ad", visualMode: "product_ad" }),
      shots: [shot("stock")],
      captionsNativeAvailable: true,
      hasProductComposition: true,
      durationSeconds: 20,
    });

    expect(decision.strategy).toBe("REMOTION_FULL");
    expect(decision.remotionRequiredReasons).toContain("product_composition_overlay");
  });
});
