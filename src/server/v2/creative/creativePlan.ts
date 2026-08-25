import {
  classifyVisualIntent,
  type ClassifyContext,
  type IntentClassification,
} from "./visualIntentClassifier";
import {
  isMotionTreatment,
  resolveAvailableTreatment,
  TREATMENT_RUNTIME,
  type TreatmentRuntime,
  type VisualTreatment,
} from "./visualTreatment";

/**
 * CANONICAL CREATIVE PLAN
 * -----------------------
 * One inspectable description of creative *intent*, resolved once per
 * production and sitting between script planning and the low-level shot plan.
 *
 * Before F2 there was no such layer: production mode was consulted directly at
 * render time, so every mode ultimately produced the same stock-led edit and
 * the reasoning behind a choice was never recorded. The plan is persisted with
 * the production so a rejected video can be explained rather than guessed at.
 */

export type HookStyle = "question" | "provocation" | "statistic" | "direct" | "story";
export type VisualLanguage = "editorial_stock" | "product_led" | "graphic_led" | "mixed_hybrid" | "customer_media";
export type PacingIntensity = "calm" | "balanced" | "energetic";
export type MotionIntensity = "low" | "balanced" | "high";
export type CaptionEnergy = "minimal" | "clean" | "punchy";
export type BrandPresence = "none" | "subtle" | "prominent";
export type CtaTreatment = "spoken_only" | "card" | "card_with_brand";

export type SceneTreatmentPlan = {
  sceneIndex: number;
  narration: string;
  purpose?: string;
  treatment: VisualTreatment;
  runtime: TreatmentRuntime;
  signal: IntentClassification["signal"];
  confidence: number;
  reason: string;
  extracted?: IntentClassification["extracted"];
  /** Set when the preferred treatment was unavailable in this runtime. */
  fellBackFrom?: VisualTreatment;
  fallbackReason?: string;
};

export type CreativePlan = {
  version: "creative.v1";
  stylePreset: CreativeStylePresetId;
  hookStyle: HookStyle;
  visualLanguage: VisualLanguage;
  pacing: PacingIntensity;
  /** Target visual shots per narration second; the EDL turns this into cuts. */
  shotDensity: number;
  motionIntensity: MotionIntensity;
  captionEnergy: CaptionEnergy;
  brandPresence: BrandPresence;
  musicEnergy: "low" | "medium" | "high";
  ctaTreatment: CtaTreatment;
  sceneTreatments: SceneTreatmentPlan[];
  /** Distinct treatments actually planned; a diversity fact, not a score. */
  treatmentCounts: Record<string, number>;
  runtimeCounts: Record<string, number>;
  generatedAt: string;
};

// ------------------------------------------------------------- presets

export type CreativeStylePresetId =
  | "auto"
  | "clean_professional"
  | "viral_social"
  | "cinematic"
  | "motion_explainer"
  | "product_showcase"
  | "tech_saas"
  | "educational";

type PresetDefaults = {
  label: string;
  hookStyle: HookStyle;
  visualLanguage: VisualLanguage;
  pacing: PacingIntensity;
  shotDensity: number;
  motionIntensity: MotionIntensity;
  captionEnergy: CaptionEnergy;
  brandPresence: BrandPresence;
  musicEnergy: "low" | "medium" | "high";
  ctaTreatment: CtaTreatment;
  /** Treatments this preset leans on when the classifier is unsure. */
  preferredTreatments: VisualTreatment[];
};

/**
 * A small curated set. Each maps onto controls that already exist, so a preset
 * is a shorthand for the operator rather than a new engine.
 */
export const CREATIVE_PRESETS: Record<CreativeStylePresetId, PresetDefaults> = {
  auto: {
    label: "Auto",
    hookStyle: "provocation",
    visualLanguage: "mixed_hybrid",
    pacing: "energetic",
    shotDensity: 0.42,
    motionIntensity: "balanced",
    captionEnergy: "punchy",
    brandPresence: "subtle",
    musicEnergy: "medium",
    ctaTreatment: "card",
    preferredTreatments: ["STOCK_FOOTAGE", "WEBSITE_MOCKUP", "KINETIC_TYPOGRAPHY"],
  },
  clean_professional: {
    label: "Clean Professional",
    hookStyle: "direct",
    visualLanguage: "editorial_stock",
    pacing: "balanced",
    shotDensity: 0.32,
    motionIntensity: "low",
    captionEnergy: "clean",
    brandPresence: "subtle",
    musicEnergy: "low",
    ctaTreatment: "card",
    preferredTreatments: ["STOCK_FOOTAGE", "WEBSITE_MOCKUP", "FEATURE_LIST"],
  },
  viral_social: {
    label: "Viral Social",
    hookStyle: "provocation",
    visualLanguage: "mixed_hybrid",
    pacing: "energetic",
    shotDensity: 0.5,
    motionIntensity: "high",
    captionEnergy: "punchy",
    brandPresence: "subtle",
    musicEnergy: "high",
    ctaTreatment: "card",
    preferredTreatments: ["KINETIC_TYPOGRAPHY", "STOCK_FOOTAGE", "STATS_CARD"],
  },
  cinematic: {
    label: "Cinematic",
    hookStyle: "story",
    visualLanguage: "editorial_stock",
    pacing: "calm",
    shotDensity: 0.24,
    motionIntensity: "low",
    captionEnergy: "minimal",
    brandPresence: "none",
    musicEnergy: "medium",
    ctaTreatment: "card",
    preferredTreatments: ["STOCK_FOOTAGE", "QUOTE_CALLOUT"],
  },
  motion_explainer: {
    label: "Motion Explainer",
    hookStyle: "question",
    visualLanguage: "graphic_led",
    pacing: "balanced",
    shotDensity: 0.36,
    motionIntensity: "high",
    captionEnergy: "clean",
    brandPresence: "prominent",
    musicEnergy: "medium",
    ctaTreatment: "card_with_brand",
    preferredTreatments: ["ANIMATED_EXPLAINER", "PROCESS_STEPS", "FEATURE_LIST", "STATS_CARD"],
  },
  product_showcase: {
    label: "Product Showcase",
    hookStyle: "direct",
    visualLanguage: "product_led",
    pacing: "balanced",
    shotDensity: 0.34,
    motionIntensity: "balanced",
    captionEnergy: "clean",
    brandPresence: "prominent",
    musicEnergy: "medium",
    ctaTreatment: "card_with_brand",
    preferredTreatments: ["PRODUCT_HERO", "PRODUCT_COMPOSITION", "FEATURE_LIST"],
  },
  tech_saas: {
    label: "Tech / SaaS",
    hookStyle: "statistic",
    visualLanguage: "graphic_led",
    pacing: "balanced",
    shotDensity: 0.38,
    motionIntensity: "balanced",
    captionEnergy: "clean",
    brandPresence: "prominent",
    musicEnergy: "medium",
    ctaTreatment: "card_with_brand",
    preferredTreatments: ["WEBSITE_MOCKUP", "DEVICE_MOCKUP", "STATS_CARD", "FEATURE_LIST"],
  },
  educational: {
    label: "Educational",
    hookStyle: "question",
    visualLanguage: "graphic_led",
    pacing: "calm",
    shotDensity: 0.26,
    motionIntensity: "low",
    captionEnergy: "clean",
    brandPresence: "subtle",
    musicEnergy: "low",
    ctaTreatment: "card",
    preferredTreatments: ["PROCESS_STEPS", "ANIMATED_EXPLAINER", "STOCK_FOOTAGE"],
  },
};

/** Maps the engine's production modes onto a starting preset. */
export function presetForProductionMode(mode?: string): CreativeStylePresetId {
  switch ((mode || "").toLowerCase()) {
    case "social_viral": return "viral_social";
    case "stock_cinematic": return "cinematic";
    case "motion_graphics": return "motion_explainer";
    case "animated_explainer": return "motion_explainer";
    case "product_ad": return "product_showcase";
    case "educational": return "educational";
    case "custom_media": return "clean_professional";
    default: return "auto";
  }
}

const MOTION_INTENSITY_DENSITY: Record<MotionIntensity, number> = {
  low: 0.85,
  balanced: 1,
  high: 1.15,
};

// -------------------------------------------------------------- builder

export type CreativePlanInput = {
  productionMode?: string;
  stylePreset?: CreativeStylePresetId;
  motionIntensity?: MotionIntensity;
  scenes: Array<{ sceneIndex: number; narration: string; purpose?: string; durationSeconds: number }>;
  hasProductMedia?: boolean;
  hasUploadedMedia?: boolean;
  hasBrandProfile?: boolean;
  topicHint?: string;
  /** Which treatments the current runtime can actually serve. */
  isTreatmentAvailable?: (treatment: VisualTreatment) => boolean;
};

/**
 * Builds the plan.
 *
 * Repetition control runs here rather than at render time: a treatment that has
 * just been used is discouraged for the next scene, so the finished video does
 * not read as the same card four times. Deliberate repetition is still allowed
 * for the CTA, which benefits from consistency.
 */
export function buildCreativePlan(input: CreativePlanInput): CreativePlan {
  const presetId = input.stylePreset || presetForProductionMode(input.productionMode);
  const preset = CREATIVE_PRESETS[presetId] || CREATIVE_PRESETS.auto;
  const motionIntensity = input.motionIntensity || preset.motionIntensity;
  const isAvailable = input.isTreatmentAvailable || (() => true);

  const sceneCount = input.scenes.length || 1;
  const sceneTreatments: SceneTreatmentPlan[] = [];
  const recentTreatments: VisualTreatment[] = [];

  input.scenes.forEach((scene, index) => {
    const positionRatio = sceneCount <= 1 ? 0 : index / (sceneCount - 1);
    const context: ClassifyContext = {
      purpose: scene.purpose,
      positionRatio,
      hasProductMedia: input.hasProductMedia,
      hasUploadedMedia: input.hasUploadedMedia,
      topicHint: input.topicHint,
    };

    const classification = classifyVisualIntent(scene.narration, context);
    let preferred = classification.treatment;
    let repetitionReason: string | undefined;

    // Discourage an immediate repeat unless the classifier is confident or the
    // scene is the CTA, where consistency is the point.
    const justUsed = recentTreatments[recentTreatments.length - 1];
    if (
      justUsed === preferred &&
      classification.signal !== "cta" &&
      classification.confidence < 0.85
    ) {
      const alternative = preset.preferredTreatments.find(
        (candidate) => candidate !== preferred && isAvailable(candidate),
      );
      if (alternative) {
        repetitionReason = `avoided repeating ${preferred} back-to-back`;
        preferred = alternative;
      }
    }

    const resolved = resolveAvailableTreatment(preferred, isAvailable);
    sceneTreatments.push({
      sceneIndex: scene.sceneIndex,
      narration: scene.narration,
      purpose: scene.purpose,
      treatment: resolved.treatment,
      runtime: TREATMENT_RUNTIME[resolved.treatment],
      signal: classification.signal,
      confidence: classification.confidence,
      reason: [classification.reason, repetitionReason].filter(Boolean).join("; "),
      extracted: classification.extracted,
      fellBackFrom: resolved.fellBackFrom,
      fallbackReason: resolved.reason,
    });
    recentTreatments.push(resolved.treatment);
  });

  const treatmentCounts: Record<string, number> = {};
  const runtimeCounts: Record<string, number> = {};
  sceneTreatments.forEach((plan) => {
    treatmentCounts[plan.treatment] = (treatmentCounts[plan.treatment] || 0) + 1;
    runtimeCounts[plan.runtime] = (runtimeCounts[plan.runtime] || 0) + 1;
  });

  const first = sceneTreatments[0];
  const hookStyle: HookStyle =
    first?.signal === "statistic" ? "statistic"
    : first?.signal === "hook" ? "provocation"
    : preset.hookStyle;

  return {
    version: "creative.v1",
    stylePreset: presetId,
    hookStyle,
    visualLanguage: preset.visualLanguage,
    pacing: preset.pacing,
    shotDensity: Number((preset.shotDensity * MOTION_INTENSITY_DENSITY[motionIntensity]).toFixed(3)),
    motionIntensity,
    captionEnergy: preset.captionEnergy,
    brandPresence: input.hasBrandProfile ? preset.brandPresence : "none",
    musicEnergy: preset.musicEnergy,
    ctaTreatment: input.hasBrandProfile ? preset.ctaTreatment : "card",
    sceneTreatments,
    treatmentCounts,
    runtimeCounts,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Objective facts about the plan. Deliberately not a score: whether the result
 * is good is a human judgement, and the engine must not claim otherwise.
 */
export function creativePlanFacts(plan: CreativePlan) {
  const treatments = Object.keys(plan.treatmentCounts);
  const motionScenes = plan.sceneTreatments.filter((scene) => isMotionTreatment(scene.treatment)).length;
  const fallbacks = plan.sceneTreatments.filter((scene) => scene.fellBackFrom).length;
  return {
    sceneCount: plan.sceneTreatments.length,
    distinctTreatments: treatments.length,
    treatmentCounts: plan.treatmentCounts,
    runtimeCounts: plan.runtimeCounts,
    motionScenes,
    fallbackScenes: fallbacks,
    hasCta: plan.sceneTreatments.some((scene) => scene.treatment === "CTA_SCENE"),
    lowConfidenceScenes: plan.sceneTreatments.filter((scene) => scene.confidence < 0.6).length,
  };
}
