import { z } from "zod";
import type { ProductionSpec, ProductionSceneSpec } from "../../../types/productionSpec";

export const visualIntentEnum = z.enum([
  "product_hero",
  "lifestyle",
  "problem",
  "solution",
  "demonstration",
  "social_proof",
  "environment",
  "detail",
  "abstract",
  "technology",
  "people",
  "cta",
]);
export type VisualIntent = z.infer<typeof visualIntentEnum>;

export const pacingProfileEnum = z.enum(["fast", "balanced", "cinematic"]);
export type PacingProfile = z.infer<typeof pacingProfileEnum>;
export const editingRhythmProfileEnum = z.enum([
  "viral",
  "ad",
  "educational",
  "story",
  "product",
  "professional",
]);
export type EditingRhythmProfile = z.infer<typeof editingRhythmProfileEnum>;

export const motionPresetEnum = z.enum([
  "none",
  "slow_zoom",
  "zoom_in",
  "zoom_out",
  "pan_left",
  "pan_right",
  "slide",
  "parallax",
  "punch_in",
  "handheld_subtle",
]);
export type MotionPreset = z.infer<typeof motionPresetEnum>;

export const transitionStyleEnum = z.enum([
  "cut",
  "fade",
  "crossfade",
  "slide",
  "zoom",
  "whip",
  "blur",
]);
export type TransitionStyle = z.infer<typeof transitionStyleEnum>;

export const transitionProfileEnum = z.enum([
  "automatic",
  "minimal",
  "dynamic",
  "cinematic",
]);
export type TransitionProfile = z.infer<typeof transitionProfileEnum>;

export const advancedCaptionPresetEnum = z.enum([
  "clean",
  "bold",
  "viral",
  "minimal",
  "karaoke",
  "subtitle",
  "brand",
]);
export type AdvancedCaptionPreset = z.infer<typeof advancedCaptionPresetEnum>;

export const ctaLayoutEnum = z.enum([
  "minimal",
  "centered",
  "product",
  "social",
  "contact",
]);
export type CtaLayout = z.infer<typeof ctaLayoutEnum>;

export const hookStyleEnum = z.enum([
  "text_hook",
  "visual_hook",
  "text_and_visual",
  "question",
  "statistic",
  "fast_cut",
]);
export type HookStyle = z.infer<typeof hookStyleEnum>;

export const mediaPriorityEnum = z.enum([
  "auto",
  "stock",
  "ai",
  "hybrid",
  "uploaded_first",
]);
export type MediaPriority = z.infer<typeof mediaPriorityEnum>;

export const sfxPresetEnum = z.enum(["off", "subtle", "dynamic"]);
export type SfxPreset = z.infer<typeof sfxPresetEnum>;

export type SceneSegmentPlan = {
  segmentIndex: number;
  startRatio: number; // 0 to 1
  durationSeconds: number;
  visualIntent: VisualIntent;
  searchTerms: string[];
  visualPrompt?: string;
  motion: MotionPreset;
};

export type SceneMediaPlan = {
  sceneIndex: number;
  purpose: string;
  visualIntent: VisualIntent;
  targetDurationSeconds: number;
  segments: SceneSegmentPlan[];
  preferredVisualSource: "stock" | "ai" | "uploaded";
  motion: MotionPreset;
  transitionToNext: TransitionStyle;
  needsTextOverlay: boolean;
  onScreenText?: string;
  searchTerms: string[];
  visualPrompt?: string;
  stockCandidatesCount?: number;
  selectedAssetScore?: number;
  selectionReason?: string;
  searchCandidates?: string[];
  qualityChecks?: Record<string, unknown>;
};

export type QualityReviewScore = {
  overallScore: number; // 0-100
  isAiReviewed: boolean;
  subscores: {
    structure: number; // 0-100
    visualMatch: number; // 0-100
    pacing: number; // 0-100
    audio: number; // 0-100
    captions: number; // 0-100
    branding: number; // 0-100
    technical: number; // 0-100
  };
  warnings: string[];
  recommendations: string[];
};

export type FullMediaPlan = {
  id: string;
  pacingProfile: PacingProfile;
  transitionProfile: TransitionProfile;
  captionPreset: AdvancedCaptionPreset;
  hookStyle: HookStyle;
  ctaLayout: CtaLayout;
  sfxPreset: SfxPreset;
  mediaPriority: MediaPriority;
  editingRhythmProfile: EditingRhythmProfile;
  scenes: SceneMediaPlan[];
  recommendedMusicMood: string;
  qualityReview: QualityReviewScore;
  totalDurationSeconds: number;
  createdAt: string;
};

export type StockAssetCandidate = {
  id: string | number;
  url: string;
  downloadUrl?: string;
  width: number;
  height: number;
  duration: number;
  tags?: string[];
  creator?: string;
  qualityScore?: number;
  sourceUrl?: string;
  providerMetadata?: Record<string, unknown>;
};
