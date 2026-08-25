import cuid from "cuid";
import {
  type BusinessTemplateId,
  getBusinessTemplateById,
} from "../../short-creator/business-templates";
import { applyBusinessTemplateToScenes } from "../../short-creator/templateEnrichment";
import {
  creativeProfileForTemplate,
  scenePlanAt,
} from "../../short-creator/templateCreativeProfiles";
import { buildStockQueryFamilies, queryFamilyTerms } from "./creative/stockQueryFamilies";
import {
  OrientationEnum,
  type RenderConfig,
} from "../../types/shorts";
import {
  type ProductionSceneSpec,
  type ProductionSpec,
  type ScenePurpose,
  validateProductionSpec,
} from "../../types/productionSpec";

export type ConvertTemplateParams = {
  templateId: BusinessTemplateId;
  templateData?: Record<string, string>;
  config?: RenderConfig;
  title?: string;
  brandId?: string;
  id?: string;
  requestedDurationSeconds?: number;
  durationSeconds?: number;
  duration?: number;
};

/**
 * Fallback purpose sequence, used only when a template has no creative profile.
 * Every shipped template has one, so this exists for forward compatibility with
 * a template added without a profile rather than as the normal path.
 */
const SCENE_PURPOSES: ScenePurpose[] = ["hook", "problem", "solution", "cta"];

function isArabicText(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

export function convertTemplateToProductionSpec(
  params: ConvertTemplateParams,
): ProductionSpec {
  const template = getBusinessTemplateById(params.templateId);
  const enrichedScenes = applyBusinessTemplateToScenes(
    [],
    template,
    params.templateData,
  );

  const explicitDuration =
    params.requestedDurationSeconds ||
    params.durationSeconds ||
    params.duration;
  const targetDuration = explicitDuration || template.targetDurationSeconds || 28;
  const sceneDuration = Math.round((targetDuration / Math.max(enrichedScenes.length, 1)) * 10) / 10;

  // The creative profile is what makes one template differ from another: it
  // supplies the scene roles, the treatment each scene should use and the
  // editorial pace. Without it every template collapsed to the same
  // hook/problem/solution/cta stock sequence.
  const profile = creativeProfileForTemplate(params.templateId);

  const scenes: ProductionSceneSpec[] = enrichedScenes.map((scene, idx) => {
    const plan = profile
      ? scenePlanAt(profile, idx, enrichedScenes.length)
      : { purpose: SCENE_PURPOSES[idx] || "custom", treatment: undefined, intent: "" };

    // Query families give the stock router several angles on the scene instead
    // of one literal phrase; the template's own hints stay in the list.
    const families = buildStockQueryFamilies({
      narration: scene.text,
      purpose: plan.purpose,
      industryHint: profile?.industryHint,
      providedTerms: scene.searchTerms,
      maxQueries: 8,
    });

    return {
      sceneIndex: idx,
      purpose: (plan.purpose || "custom") as ScenePurpose,
      durationSeconds: sceneDuration,
      narration: scene.text,
      onScreenText: scene.text.length > 50 ? scene.text.slice(0, 47) + "..." : scene.text,
      stockSearchTerms:
        queryFamilyTerms(families).length > 0
          ? queryFamilyTerms(families)
          : scene.searchTerms && scene.searchTerms.length > 0
            ? scene.searchTerms
            : template.pexelsSearchHints,
      treatmentHint: plan.treatment,
      visualSource: "stock",
      visualProvider: "pexels",
      transition: idx === 0 ? "cut" : "fade",
      notes: plan.intent || undefined,
    };
  });

  const sampleNarration = scenes.map((s) => s.narration).join(" ");
  const isArabic = isArabicText(sampleNarration);

  const brandKit = params.config?.brandKit;
  const brandName = brandKit?.brandName;
  const title =
    params.title ||
    (brandName ? `${brandName} · ${template.displayName}` : template.displayName);

  const styleMapping: Record<string, ProductionSpec["contentStyle"]> = {
    product_ad: "advertisement",
    restaurant_offer: "advertisement",
    real_estate_listing: "product_showcase",
    educational_tip: "educational",
    viral_curiosity: "viral_curiosity",
    event_promo: "advertisement",
  };

  const contactValue =
    params.templateData?.contactMethod ||
    brandKit?.contactText ||
    "WhatsApp";

  const rawSpec: ProductionSpec = {
    id: params.id || cuid(),
    creationMode: "template",
    title,
    userPrompt: template.examplePrompt,
    language: isArabic ? "ar" : "en",
    dialect: isArabic ? "egyptian" : "none",
    tone: template.defaultTone || "energetic and professional",
    contentStyle: styleMapping[params.templateId] || "advertisement",
    durationSeconds: targetDuration,
    aspectRatio:
      params.config?.orientation === OrientationEnum.landscape ? "16:9" : "9:16",
    resolution: "1080p",
    quality: "standard",
    sceneCount: scenes.length,
    productionMode: profile?.productionMode || "auto_hybrid",
    creativeStyle: profile?.stylePreset,
    animationIntensity: profile?.motionIntensity,
    visualMode: "stock",
    // Arabic templates route to ElevenLabs; the voice ID is resolved from the
    // customer's own ElevenLabs account, never hardcoded.
    voiceProvider: isArabic ? "elevenlabs" : "kokoro",
    voiceId: isArabic ? "" : params.config?.voice || "af_heart",
    captionStyle: brandKit?.captionStyle || "bold",
    brandId: params.brandId,
    templateId: params.templateId,
    cta: {
      text: params.templateData?.callToAction || brandKit?.outroText || "Order now",
      action: "Contact",
      contact: contactValue,
    },
    contact: contactValue,
    scenes,
    brandKit,
    costEstimate: {
      estimatedCost: 0,
      currency: "USD",
      isFree: true,
      breakdown: {
        contentAI: 0,
        visualAssets: {
          stockCount: scenes.length,
          aiCount: 0,
          cost: 0,
          provider: "pexels",
        },
        voice: {
          provider: isArabic ? "elevenlabs" : "kokoro",
          charCount: scenes.reduce((acc, s) => acc + s.narration.length, 0),
          cost: 0,
          estimatedCostTier: isArabic ? "premium" : "local_free",
          usageBased: isArabic,
          costLabel: isArabic ? "ElevenLabs · Cloud / Usage Based" : "Local / Free",
        },
        rendering: 0,
      },
    },
    metadata: {
      sourceTemplateId: params.templateId,
      templateData: params.templateData,
      creativeProfile: profile
        ? {
            stylePreset: profile.stylePreset,
            pacingProfile: profile.pacingProfile,
            motionIntensity: profile.motionIntensity,
            industryHint: profile.industryHint,
            requiresProductMedia: profile.requiresProductMedia,
            editorialSummary: profile.editorialSummary,
          }
        : undefined,
    },
  };

  return validateProductionSpec(rawSpec);
}
