import { z } from "zod";
import { brandKitSchema, type BrandKit } from "./shorts";

export const creationModeEnum = z.enum(["prompt", "template"]);
export type CreationMode = z.infer<typeof creationModeEnum>;

export const videoLanguageEnum = z.enum(["auto", "ar", "en", "es", "fr", "de"]);
export type VideoLanguage = z.infer<typeof videoLanguageEnum>;

export const arabicDialectEnum = z.enum([
  "egyptian",
  "msa",
  "saudi",
  "gulf",
  "levantine",
  "none",
]);
export type ArabicDialect = z.infer<typeof arabicDialectEnum>;

export const contentStyleEnum = z.enum([
  "advertisement",
  "ugc",
  "cinematic",
  "educational",
  "explainer",
  "viral_curiosity",
  "product_showcase",
  "social_short",
  "custom",
]);
export type ContentStyle = z.infer<typeof contentStyleEnum>;

export const qualityProfileEnum = z.enum([
  "draft",
  "standard",
  "high",
  "premium",
  "max_quality_local",
]);
export type QualityProfile = z.infer<typeof qualityProfileEnum>;

export const resolutionEnum = z.enum(["720p", "1080p"]);
export type Resolution = z.infer<typeof resolutionEnum>;

export const aspectRatioEnum = z.enum(["9:16", "16:9", "1:1"]);
export type AspectRatio = z.infer<typeof aspectRatioEnum>;

export const productionModeEnum = z.enum([
  "auto_hybrid",
  "stock_cinematic",
  "product_ad",
  "motion_graphics",
  "animated_explainer",
  "ai_generated",
  "social_viral",
  "educational",
  "custom_media",
]);
export type ProductionMode = z.infer<typeof productionModeEnum>;

export const visualModeEnum = z.enum([
  "auto",
  "stock",
  "ai",
  "hybrid",
  "motion_graphics",
  "animated_explainer",
  "product_ad",
  "uploaded_media",
  "image_animation",
]);
export type VisualMode = z.infer<typeof visualModeEnum>;

export const voiceProviderEnum = z.enum(["auto", "kokoro", "piper", "edge_tts", "google_cloud_tts", "elevenlabs"]);
export type VoiceProvider = z.infer<typeof voiceProviderEnum>;

/**
 * Narration delivery presets. These are the ElevenLabs voice-setting bundles a
 * human can pick in the Voice Lab; the spec carries the chosen preset so the
 * render worker synthesizes with the settings the human actually approved
 * instead of silently falling back to "natural".
 */
export const voicePresetEnum = z.enum([
  "natural",
  "energetic_ad",
  "professional",
  "storytelling",
  "calm",
]);
export type VoicePreset = z.infer<typeof voicePresetEnum>;

// V3 caption styles come first; the trailing values are the historical
// vocabulary, kept so existing specs, brands and templates still validate.
export const captionStyleEnum = z.enum([
  "clean_professional",
  "social_ad",
  "minimal",
  "kinetic_phrase",
  "karaoke",
  "legacy_cairo",
  "none",
  "cinematic",
  "viral_bold",
  "clean",
  "product_ad",
  "educational",
  "bold",
  "viral",
  "brand",
]);
export type CaptionStyle = z.infer<typeof captionStyleEnum>;

export const scenePurposeEnum = z.enum([
  "hook",
  "problem",
  "solution",
  "benefit",
  "proof",
  "cta",
  "filler",
  "custom",
]);
export type ScenePurpose = z.infer<typeof scenePurposeEnum>;

export const visualSourceEnum = z.enum(["stock", "uploaded_media", "motion_graphics", "product_composition", "ai_generated_video", "image_animation", "ai"]);
export type VisualSource = z.infer<typeof visualSourceEnum>;

export const transitionEnum = z.enum(["cut", "fade", "slide", "zoom"]);
export type Transition = z.infer<typeof transitionEnum>;

export const productionSceneSpecSchema = z.object({
  sceneIndex: z.number().int().min(0),
  purpose: scenePurposeEnum.default("custom"),
  durationSeconds: z.number().min(0.5).max(30).default(5),
  narration: z.string().trim().min(1).max(500),
  spokenNarration: z.string().trim().min(1).max(500).optional(),
  displayText: z.string().trim().max(140).optional(),
  captionText: z.string().trim().max(500).optional(),
  visualIntent: z.string().trim().max(80).optional(),
  onScreenText: z.string().trim().max(140).optional(),
  stockSearchTerms: z.array(z.string().trim().min(1)).min(1).default(["video"]),
  visualPrompt: z.string().trim().max(500).optional(),
  negativePrompt: z.string().trim().max(300).optional(),
  visualSource: visualSourceEnum.default("stock"),
  visualProvider: z.string().trim().max(50).optional(),
  transition: transitionEnum.default("cut"),
  notes: z.string().trim().max(300).optional(),
});
export type ProductionSceneSpec = z.infer<typeof productionSceneSpecSchema>;

export const ctaSpecSchema = z.object({
  text: z.string().trim().max(140).optional(),
  action: z.string().trim().max(80).optional(),
  contact: z.string().trim().max(140).optional(),
});
export type CtaSpec = z.infer<typeof ctaSpecSchema>;

export const publishingSpecSchema = z.object({
  platform: z.string().trim().max(60).optional(),
  schedule: z.string().trim().max(60).optional(),
  tags: z.array(z.string().trim()).optional(),
});
export type PublishingSpec = z.infer<typeof publishingSpecSchema>;

export const costEstimateBreakdownSchema = z.object({
  contentAI: z.number().min(0).default(0),
  visualAssets: z.object({
    stockCount: z.number().int().min(0).default(0),
    aiCount: z.number().int().min(0).default(0),
    cost: z.number().min(0).default(0),
    provider: z.string().default("pexels"),
  }),
  voice: z.object({
    provider: z.string().default("kokoro"),
    charCount: z.number().int().min(0).default(0),
    cost: z.number().min(0).default(0),
    estimatedCostTier: z.enum(["local_free", "experimental_free_online", "cloud_free_tier", "premium"]).optional(),
    // Provider bills by usage; the engine does not invent a dollar amount.
    usageBased: z.boolean().optional(),
    costLabel: z.string().optional(),
  }),
  rendering: z.number().min(0).default(0),
});
export type CostEstimateBreakdown = z.infer<typeof costEstimateBreakdownSchema>;

export const costEstimateSchema = z.object({
  estimatedCost: z.number().min(0).default(0),
  currency: z.literal("USD").default("USD"),
  isFree: z.boolean().default(true),
  usageBased: z.boolean().optional(),
  costLabel: z.string().optional(),
  breakdown: costEstimateBreakdownSchema,
});
export type CostEstimate = z.infer<typeof costEstimateSchema>;

export const productionSpecSchema = z.object({
  id: z.string().trim().min(1),
  creationMode: creationModeEnum.default("prompt"),
  title: z.string().trim().min(1).max(180).default("Untitled Video Production"),
  userPrompt: z.string().trim().max(4000).optional(),
  language: videoLanguageEnum.default("auto"),
  dialect: arabicDialectEnum.default("none"),
  tone: z.string().trim().max(80).default("energetic and engaging"),
  contentStyle: contentStyleEnum.default("advertisement"),
  durationSeconds: z.number().min(5).max(120).default(30),
  aspectRatio: aspectRatioEnum.default("9:16"),
  resolution: resolutionEnum.default("1080p"),
  quality: qualityProfileEnum.default("standard"),
  sceneCount: z.number().int().min(1).max(12).default(4),
  productionMode: productionModeEnum.default("auto_hybrid"),
  visualMode: visualModeEnum.default("auto"),
  voiceProvider: voiceProviderEnum.default("auto"),
  voiceId: z.string().trim().max(120).default(""),
  voicePreset: voicePresetEnum.optional(),
  voiceModelId: z.string().trim().max(80).optional(),
  captionStyle: captionStyleEnum.default("bold"),
  brandId: z.string().trim().max(140).optional(),
  templateId: z.string().trim().max(80).optional(),
  cta: ctaSpecSchema.optional(),
  contact: z.string().trim().max(140).optional(),
  scenes: z.array(productionSceneSpecSchema).min(1).max(12),
  brandKit: brandKitSchema.optional(),
  publishing: publishingSpecSchema.optional(),
  costEstimate: costEstimateSchema.optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type ProductionSpec = z.infer<typeof productionSpecSchema>;

export type QualityValidationIssue = {
  field: string;
  message: string;
  severity: "error" | "warning";
};

export type QualityValidationResult = {
  valid: boolean;
  issues: QualityValidationIssue[];
  warnings: string[];
  correctedSpec?: ProductionSpec;
};

export type ResolvedSceneTimeline = {
  sceneIndex: number;
  purpose: string;
  startSeconds: number;
  durationSeconds: number;
  endSeconds: number;
  startFrame: number;
  durationFrames: number;
  endFrame: number;
  narration: string;
  targetSpeechDurationSeconds: number;
  actualSpeechDurationSeconds?: number;
  audioSpeedFactor?: number;
  visualDurationSeconds: number;
  captionTimeRangeMs: {
    startMs: number;
    endMs: number;
  };
};

export type ResolvedProductionTimeline = {
  requestedDurationSeconds: number;
  targetDurationSeconds: number;
  contentDurationSeconds: number;
  outroDurationSeconds: number;
  finalExpectedDurationSeconds: number;
  finalExpectedFrames: number;
  fps: number;
  scenes: ResolvedSceneTimeline[];
};

export function calculateNarrationBudget(
  targetDurationSeconds: number,
  isArabic = false,
): { maxWords: number; maxChars: number; recommendedWords: number } {
  const wordRate = isArabic ? 2.2 : 2.4;
  const charRate = isArabic ? 11 : 13.5;
  const safeDuration = Math.max(2, targetDurationSeconds);
  return {
    maxWords: Math.max(4, Math.floor(safeDuration * wordRate)),
    maxChars: Math.max(20, Math.floor(safeDuration * charRate)),
    recommendedWords: Math.max(3, Math.round(safeDuration * (wordRate * 0.85))),
  };
}

export function compactNarrationToBudget(
  narration: string,
  maxDurationSeconds: number,
  isArabic = false,
): string {
  const trimmed = narration.trim();
  if (!trimmed) return trimmed;

  const budget = calculateNarrationBudget(maxDurationSeconds, isArabic);
  const words = trimmed.split(/\s+/);
  if (words.length <= budget.maxWords && trimmed.length <= budget.maxChars) {
    return trimmed;
  }

  const compactedWords = words.slice(0, budget.maxWords);
  let result = compactedWords.join(" ").trim();
  result = result.replace(/[,،؛-]\s*$/, "");
  if (!/[.!?؟]$/.test(result)) {
    result += isArabic ? "..." : ".";
  }
  return result;
}

export function resolveProductionTimeline(
  spec: ProductionSpec,
  fps = 25,
): ResolvedProductionTimeline {
  const requestedDurationSeconds = spec.durationSeconds || 30;

  const includeOutro = !!spec.brandKit?.includeOutro;
  const outroDurationSeconds = includeOutro
    ? Math.min(2.5, Math.max(1.5, Math.round(requestedDurationSeconds * 0.1 * 10) / 10))
    : 0;

  const contentDurationSeconds = Math.max(
    (spec.scenes?.length || 1) * 1.5,
    requestedDurationSeconds - outroDurationSeconds,
  );

  const sceneCount = Math.max(1, spec.scenes?.length || 1);
  const currentSceneDurations = (spec.scenes || []).map((s) => s.durationSeconds || 5);
  const currentTotal = currentSceneDurations.reduce((sum, d) => sum + d, 0) || 1;

  const ratio = contentDurationSeconds / currentTotal;
  const resolvedDurations = currentSceneDurations.map((d) => {
    return Math.max(1.5, Math.round(d * ratio * 10) / 10);
  });

  const allocatedTotal = resolvedDurations.reduce((sum, d) => sum + d, 0);
  const drift = Math.round((contentDurationSeconds - allocatedTotal) * 10) / 10;
  if (resolvedDurations.length > 0 && Math.abs(drift) > 0) {
    resolvedDurations[resolvedDurations.length - 1] = Math.max(
      1.5,
      Math.round((resolvedDurations[resolvedDurations.length - 1] + drift) * 10) / 10,
    );
  }

  const isAr = spec.language === "ar" || (spec.userPrompt && /[\u0600-\u06FF]/.test(spec.userPrompt));

  let currentStartSeconds = 0;
  const scenes: ResolvedSceneTimeline[] = (spec.scenes || []).map((scene, idx) => {
    const durSec = resolvedDurations[idx] || (contentDurationSeconds / sceneCount);
    const startSec = Math.round(currentStartSeconds * 100) / 100;
    const endSec = Math.round((startSec + durSec) * 100) / 100;
    const startFrame = Math.round(startSec * fps);
    const durationFrames = Math.round(durSec * fps);
    const endFrame = startFrame + durationFrames;

    currentStartSeconds = endSec;

    return {
      sceneIndex: idx,
      purpose: scene.purpose,
      startSeconds: startSec,
      durationSeconds: durSec,
      endSeconds: endSec,
      startFrame,
      durationFrames,
      endFrame,
      narration: compactNarrationToBudget(scene.narration, durSec, !!isAr),
      targetSpeechDurationSeconds: durSec,
      visualDurationSeconds: durSec,
      captionTimeRangeMs: {
        startMs: Math.round(startSec * 1000),
        endMs: Math.round(endSec * 1000),
      },
    };
  });

  const finalContentTotal = scenes.reduce((sum, s) => sum + s.durationSeconds, 0);
  const finalExpectedDurationSeconds = Math.round((finalContentTotal + outroDurationSeconds) * 100) / 100;
  const finalExpectedFrames = Math.round(finalExpectedDurationSeconds * fps);

  return {
    requestedDurationSeconds,
    targetDurationSeconds: requestedDurationSeconds,
    contentDurationSeconds: finalContentTotal,
    outroDurationSeconds,
    finalExpectedDurationSeconds,
    finalExpectedFrames,
    fps,
    scenes,
  };
}

/**
 * Normalizes scene durations proportionally so their sum matches targetDurationSeconds within reasonable bounds.
 */
export function normalizeSceneDurations(
  scenes: ProductionSceneSpec[],
  targetDurationSeconds: number,
  includeOutro = false,
): ProductionSceneSpec[] {
  if (!scenes.length || targetDurationSeconds <= 0) {
    return scenes;
  }
  const outroDuration = includeOutro
    ? Math.min(2.5, Math.max(1.5, Math.round(targetDurationSeconds * 0.1 * 10) / 10))
    : 0;
  const contentTarget = Math.max(scenes.length * 1.5, targetDurationSeconds - outroDuration);

  const currentTotal = scenes.reduce((sum, s) => sum + (s.durationSeconds || 5), 0);
  const ratio = contentTarget / currentTotal;
  return scenes.map((scene, idx) => {
    let scaled = Math.round((scene.durationSeconds || 5) * ratio * 10) / 10;
    if (scaled < 1.5) scaled = 1.5;
    return {
      ...scene,
      sceneIndex: idx,
      durationSeconds: scaled,
    };
  });
}

/**
 * Deterministic quality and schema validation for Production Specs.
 */
export function validateProductionSpec(raw: unknown): ProductionSpec {
  return productionSpecSchema.parse(raw);
}

/**
 * Content Quality Validator checking business rules, RTL dialect safety, empty narration, etc.
 */
export function validateContentQuality(spec: ProductionSpec): QualityValidationResult {
  const issues: QualityValidationIssue[] = [];

  if (!spec.scenes || spec.scenes.length === 0) {
    issues.push({
      field: "scenes",
      message: "Production spec must contain at least 1 scene.",
      severity: "error",
    });
  }

  const totalDuration = spec.scenes.reduce((sum, s) => sum + (s.durationSeconds || 0), 0);
  if (Math.abs(totalDuration - spec.durationSeconds) > spec.durationSeconds * 0.4) {
    issues.push({
      field: "durationSeconds",
      message: `Scene durations (${totalDuration}s) deviate significantly from requested target duration (${spec.durationSeconds}s).`,
      severity: "warning",
    });
  }

  const narrationSet = new Set<string>();
  spec.scenes.forEach((scene, index) => {
    if (!scene.narration || !scene.narration.trim()) {
      issues.push({
        field: `scenes[${index}].narration`,
        message: `Scene ${index + 1} has empty narration.`,
        severity: "error",
      });
    } else {
      const normalized = scene.narration.trim().toLowerCase();
      if (narrationSet.has(normalized)) {
        issues.push({
          field: `scenes[${index}].narration`,
          message: `Scene ${index + 1} repeats identical narration text from another scene.`,
          severity: "warning",
        });
      }
      narrationSet.add(normalized);
    }

    if (!scene.stockSearchTerms || scene.stockSearchTerms.length === 0) {
      issues.push({
        field: `scenes[${index}].stockSearchTerms`,
        message: `Scene ${index + 1} has no stock visual search terms.`,
        severity: "warning",
      });
    }

    if (scene.visualSource === "ai" && !scene.visualPrompt) {
      issues.push({
        field: `scenes[${index}].visualPrompt`,
        message: `Scene ${index + 1} is set to AI visual source but lacks visualPrompt.`,
        severity: "warning",
      });
    }
  });

  const hasHook = spec.scenes.some((s) => s.purpose === "hook" || s.sceneIndex === 0);
  if (!hasHook) {
    issues.push({
      field: "scenes",
      message: "No hook scene found in production plan.",
      severity: "warning",
    });
  }

  const hasCta = spec.scenes.some(
    (s) => s.purpose === "cta" || (spec.cta && spec.cta.text),
  );
  if (spec.contentStyle === "advertisement" && !hasCta) {
    issues.push({
      field: "cta",
      message: "Advertisement style video should include a clear Call To Action.",
      severity: "warning",
    });
  }

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning").map((w) => w.message);

  let correctedSpec: ProductionSpec | undefined;
  if (errors.length === 0 && warnings.length > 0) {
    correctedSpec = {
      ...spec,
      scenes: normalizeSceneDurations(spec.scenes, spec.durationSeconds),
    };
  }

  return {
    valid: errors.length === 0,
    issues,
    warnings,
    correctedSpec,
  };
}
