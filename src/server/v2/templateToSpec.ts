import cuid from "cuid";
import {
  type BusinessTemplateId,
  getBusinessTemplateById,
} from "../../short-creator/business-templates";
import { applyBusinessTemplateToScenes } from "../../short-creator/templateEnrichment";
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

  const scenes: ProductionSceneSpec[] = enrichedScenes.map((scene, idx) => ({
    sceneIndex: idx,
    purpose: SCENE_PURPOSES[idx] || "custom",
    durationSeconds: sceneDuration,
    narration: scene.text,
    onScreenText: scene.text.length > 50 ? scene.text.slice(0, 47) + "..." : scene.text,
    stockSearchTerms: scene.searchTerms && scene.searchTerms.length > 0 ? scene.searchTerms : template.pexelsSearchHints,
    visualSource: "stock",
    visualProvider: "pexels",
    transition: idx === 0 ? "cut" : "fade",
  }));

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
    visualMode: "stock",
    voiceProvider: "kokoro",
    voiceId: params.config?.voice || "af_heart",
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
          provider: "kokoro",
          charCount: scenes.reduce((acc, s) => acc + s.narration.length, 0),
          cost: 0,
        },
        rendering: 0,
      },
    },
    metadata: {
      sourceTemplateId: params.templateId,
      templateData: params.templateData,
    },
  };

  return validateProductionSpec(rawSpec);
}
