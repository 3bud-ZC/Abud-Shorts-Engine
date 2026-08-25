import type { BusinessTemplateId } from "./business-templates";
import type { CreativeStylePresetId, MotionIntensity } from "../server/v2/creative/creativePlan";
import type { VisualTreatment } from "../server/v2/creative/visualTreatment";
import type { PacingProfileId } from "../server/v2/editing/editDecisionList";
import type { ProductionMode, ScenePurpose } from "../types/productionSpec";

/**
 * TEMPLATE CREATIVE PROFILES
 * --------------------------
 * What actually makes one business template different from another.
 *
 * Before F2.1 every template converted to the same production spec: production
 * mode `auto_hybrid`, the fixed purpose sequence hook / problem / solution / cta,
 * `visualSource: "stock"` on every scene and no style preset. The narration text
 * differed and nothing else did, so a Restaurant Promo and a Real Estate Listing
 * produced structurally identical CreativePlans - the same treatments in the same
 * order at the same pace. Choosing a template changed the words and not the film.
 *
 * A profile states the editorial shape of the format: which style preset it
 * leans on, how fast it cuts, and - most importantly - what each scene should
 * actually *show*. The creative planner honours the per-scene treatment when the
 * runtime can serve it and records a fallback reason when it cannot.
 */

export type TemplateScenePlan = {
  purpose: ScenePurpose;
  /** What this scene shows. Fed to the planner as `treatmentHint`. */
  treatment: VisualTreatment;
  /** Plain description, shown in the Templates page and used in tests. */
  intent: string;
};

export type TemplateCreativeProfile = {
  stylePreset: CreativeStylePresetId;
  productionMode: ProductionMode;
  pacingProfile: PacingProfileId;
  motionIntensity: MotionIntensity;
  scenePlan: TemplateScenePlan[];
  /** Sector word handed to the stock query-family engine. */
  industryHint: string;
  /** True when the format is meaningless without customer product media. */
  requiresProductMedia: boolean;
  /** One line the UI can show to explain what this template will produce. */
  editorialSummary: string;
};

export const TEMPLATE_CREATIVE_PROFILES: Record<BusinessTemplateId, TemplateCreativeProfile> = {
  product_ad: {
    stylePreset: "product_showcase",
    productionMode: "product_ad",
    pacingProfile: "editorial_ad",
    motionIntensity: "balanced",
    industryHint: "retail product",
    requiresProductMedia: true,
    editorialSummary: "Product hero, benefits, the offer, then a direct CTA.",
    scenePlan: [
      { purpose: "hook", treatment: "PRODUCT_HERO", intent: "the product itself, filling the frame" },
      { purpose: "benefit", treatment: "FEATURE_LIST", intent: "why it is worth buying" },
      { purpose: "solution", treatment: "PRODUCT_COMPOSITION", intent: "the offer against the product" },
      { purpose: "cta", treatment: "CTA_SCENE", intent: "how to order, with the brand" },
    ],
  },
  restaurant_offer: {
    stylePreset: "viral_social",
    productionMode: "social_viral",
    pacingProfile: "editorial_ad",
    motionIntensity: "high",
    industryHint: "restaurant hospitality",
    requiresProductMedia: false,
    editorialSummary: "Appetite-led food and venue footage, then the deal and where to find it.",
    scenePlan: [
      { purpose: "hook", treatment: "STOCK_FOOTAGE", intent: "the dish, close and hot" },
      { purpose: "benefit", treatment: "STOCK_FOOTAGE", intent: "the venue and the atmosphere" },
      { purpose: "solution", treatment: "STATS_CARD", intent: "the offer or price as a card" },
      { purpose: "cta", treatment: "CTA_SCENE", intent: "location and how to order" },
    ],
  },
  real_estate_listing: {
    stylePreset: "clean_professional",
    productionMode: "stock_cinematic",
    pacingProfile: "steady",
    motionIntensity: "low",
    industryHint: "real estate",
    requiresProductMedia: false,
    editorialSummary: "Exterior, interior, a specification card, the location, then a viewing CTA.",
    scenePlan: [
      { purpose: "hook", treatment: "STOCK_FOOTAGE", intent: "the property exterior" },
      { purpose: "benefit", treatment: "STOCK_FOOTAGE", intent: "the interior and the space" },
      { purpose: "proof", treatment: "FEATURE_LIST", intent: "area, rooms and price as a card" },
      { purpose: "cta", treatment: "CTA_SCENE", intent: "book a viewing" },
    ],
  },
  educational_tip: {
    stylePreset: "educational",
    productionMode: "educational",
    pacingProfile: "explainer",
    motionIntensity: "low",
    industryHint: "education",
    requiresProductMedia: false,
    editorialSummary: "Explainer cards and a process diagram at a calmer pace.",
    scenePlan: [
      { purpose: "hook", treatment: "KINETIC_TYPOGRAPHY", intent: "the question the lesson answers" },
      { purpose: "problem", treatment: "ANIMATED_EXPLAINER", intent: "the concept, drawn" },
      { purpose: "solution", treatment: "PROCESS_STEPS", intent: "the steps to apply it" },
      { purpose: "cta", treatment: "CTA_SCENE", intent: "where to learn more" },
    ],
  },
  viral_curiosity: {
    stylePreset: "viral_social",
    productionMode: "social_viral",
    pacingProfile: "editorial_ad",
    motionIntensity: "high",
    industryHint: "curiosity",
    requiresProductMedia: false,
    editorialSummary: "Kinetic hook, fast visual rhythm, a stat beat, then a social CTA.",
    scenePlan: [
      { purpose: "hook", treatment: "KINETIC_TYPOGRAPHY", intent: "the hook, as type" },
      { purpose: "problem", treatment: "STOCK_FOOTAGE", intent: "the subject in the world" },
      { purpose: "proof", treatment: "STATS_CARD", intent: "the surprising number" },
      { purpose: "cta", treatment: "CTA_SCENE", intent: "follow for more" },
    ],
  },
  event_promo: {
    stylePreset: "viral_social",
    productionMode: "auto_hybrid",
    pacingProfile: "editorial_ad",
    motionIntensity: "balanced",
    industryHint: "events",
    requiresProductMedia: false,
    editorialSummary: "Atmosphere footage, the date and venue as a card, then an urgent booking CTA.",
    scenePlan: [
      { purpose: "hook", treatment: "STOCK_FOOTAGE", intent: "the atmosphere of the event" },
      { purpose: "benefit", treatment: "TIMELINE", intent: "date, time and venue on screen" },
      { purpose: "proof", treatment: "STOCK_FOOTAGE", intent: "the crowd and the main attraction" },
      { purpose: "cta", treatment: "CTA_SCENE", intent: "book before it sells out" },
    ],
  },
};

export function creativeProfileForTemplate(id: BusinessTemplateId): TemplateCreativeProfile {
  return TEMPLATE_CREATIVE_PROFILES[id];
}

/**
 * The purpose / treatment pair for a scene index, repeating the last entry when
 * a template produced more scenes than the profile describes.
 */
export function scenePlanAt(
  profile: TemplateCreativeProfile,
  index: number,
  totalScenes: number,
): TemplateScenePlan {
  if (profile.scenePlan.length === 0) {
    return { purpose: "custom", treatment: "STOCK_FOOTAGE", intent: "general context" };
  }
  // The final scene is always the CTA, whatever the scene count came out as.
  if (index === totalScenes - 1) {
    return profile.scenePlan[profile.scenePlan.length - 1];
  }
  return profile.scenePlan[Math.min(index, profile.scenePlan.length - 2 >= 0 ? profile.scenePlan.length - 2 : 0)];
}
