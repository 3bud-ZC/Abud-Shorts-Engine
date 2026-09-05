import type { ProductionSpec } from "../../../types/productionSpec";
import type { VisualShot } from "../editing/editDecisionList";

export type RenderStrategy = "FFMPEG_FAST" | "HYBRID" | "REMOTION_FULL";

export type RenderStrategyDecision = {
  strategy: RenderStrategy;
  fastPathEligible: boolean;
  reasons: string[];
  remotionRequiredReasons: string[];
  customerStage: "Editing" | "Rendering";
  baseFootageFramesThroughChromium: number;
};

export type RenderStrategyInput = {
  spec: ProductionSpec;
  shots: VisualShot[];
  captionsNativeAvailable: boolean;
  hasProductComposition?: boolean;
  fps?: number;
  durationSeconds?: number;
};

const FULL_REMOTION_VISUAL_MODES = new Set([
  "motion_graphics",
  "animated_explainer",
  "product_ad",
  "image_animation",
]);

const FULL_REMOTION_PRODUCTION_MODES = new Set([
  "motion_graphics",
  "animated_explainer",
  "product_ad",
]);

const FAST_NATIVE_SOURCES = new Set(["stock", "upload", "image"]);
const HYBRID_NATIVE_SOURCES = new Set(["stock", "upload", "image", "mockup", "motion"]);

export function decideRenderStrategy(input: RenderStrategyInput): RenderStrategyDecision {
  const fps = input.fps ?? 25;
  const durationSeconds = input.durationSeconds ?? input.spec.durationSeconds ?? 0;
  const estimatedFrames = Math.max(0, Math.round(durationSeconds * fps));
  const reasons: string[] = [];
  const remotionRequiredReasons: string[] = [];
  const visualMode = String(input.spec.visualMode || "");
  const productionMode = String(input.spec.productionMode || "");

  if (FULL_REMOTION_VISUAL_MODES.has(visualMode) || FULL_REMOTION_PRODUCTION_MODES.has(productionMode)) {
    remotionRequiredReasons.push("graphics_led_production");
  }
  if (input.hasProductComposition) {
    remotionRequiredReasons.push("product_composition_overlay");
  }
  if (!input.captionsNativeAvailable && input.spec.captionStyle !== "none") {
    remotionRequiredReasons.push("caption_renderer_requires_remotion");
  }

  const sourceTypes = new Set((input.shots || []).map((shot) => shot.sourceType));
  const unsupportedSources = Array.from(sourceTypes).filter((source) => !HYBRID_NATIVE_SOURCES.has(source));
  if (unsupportedSources.length > 0) {
    remotionRequiredReasons.push(`unsupported_source:${unsupportedSources.join(",")}`);
  }

  if (remotionRequiredReasons.length > 0) {
    return {
      strategy: "REMOTION_FULL",
      fastPathEligible: false,
      reasons,
      remotionRequiredReasons,
      customerStage: "Rendering",
      baseFootageFramesThroughChromium: estimatedFrames,
    };
  }

  const needsOverlayAssetAssembly = Array.from(sourceTypes).some((source) => !FAST_NATIVE_SOURCES.has(source));
  if (needsOverlayAssetAssembly) {
    reasons.push("native_footage_with_pre_rendered_overlay_assets");
    return {
      strategy: "HYBRID",
      fastPathEligible: true,
      reasons,
      remotionRequiredReasons,
      customerStage: "Editing",
      baseFootageFramesThroughChromium: 0,
    };
  }

  reasons.push("native_video_timeline");
  return {
    strategy: "FFMPEG_FAST",
    fastPathEligible: true,
    reasons,
    remotionRequiredReasons,
    customerStage: "Editing",
    baseFootageFramesThroughChromium: 0,
  };
}
