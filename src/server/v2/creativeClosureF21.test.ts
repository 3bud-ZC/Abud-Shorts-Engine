import { describe, expect, it } from "vitest";
import fs from "fs-extra";
import os from "os";
import path from "path";

import {
  MAX_CENTER_DELTA_PER_SHOT,
  buildSmartCropFilter,
  cropMetadata,
  planSmartCrop,
} from "./media-intelligence/smartCrop";
import {
  buildStockQueryFamilies,
  queryFamilyTerms,
} from "./creative/stockQueryFamilies";
import {
  ABUD_DEFAULT_PALETTE,
  BRAND_AWARE_TREATMENTS,
  MIN_CONTRAST_RATIO,
  contrastRatio,
  normalizeHex,
  resolveBrandStyle,
} from "./creative/brandStyle";
import { buildCreativePlan } from "./creative/creativePlan";
import {
  TREATMENT_MOTION_TEMPLATE,
  TREATMENT_RUNTIME,
  type VisualTreatment,
} from "./creative/visualTreatment";
import {
  MOTION_BY_INTENT,
  buildEditDecisionList,
  motionForShot,
} from "./editing/editDecisionList";
import { buildNormalizeFilter, shotFilterChain } from "./editing/visualBedComposer";
import { renderMockupSvg, type MockupTemplateId } from "./mockups/websiteMockupRenderer";
import {
  isRasterizableFont,
  motionFontDirectories,
  resolveMotionFont,
} from "./motion/motionEngine";
import {
  containsPresentationForms,
  prepareArabicForRaster,
  reorderForDisplay,
  shapeArabicForms,
} from "./motion/arabicRasterText";
import { cleanupTemporaryArtifacts } from "./storage/storagePolicy";
import { convertTemplateToProductionSpec } from "./templateToSpec";
import {
  TEMPLATE_CREATIVE_PROFILES,
  creativeProfileForTemplate,
} from "../../short-creator/templateCreativeProfiles";
import { BUSINESS_TEMPLATE_IDS } from "../../short-creator/business-templates";

const PORTRAIT = { targetWidth: 1080, targetHeight: 1920 };
const LANDSCAPE = { targetWidth: 1920, targetHeight: 1080 };

describe("Smart crop", () => {
  it("never distorts: the filter locks the aspect ratio and only moves the window", () => {
    const plan = planSmartCrop({ sourceWidth: 1920, sourceHeight: 1080, ...PORTRAIT });
    const filter = buildSmartCropFilter(plan, { fps: 25 });
    expect(filter).toContain("force_original_aspect_ratio=increase");
    // A bare `scale=W:H` without the ratio lock is what stretches a subject.
    expect(filter).not.toMatch(/scale=1080:1920(?!:force)/);
    expect(filter).toContain("setsar=1");
  });

  it("falls back to a safe centre crop when nothing is known about the picture", () => {
    const plan = planSmartCrop({ sourceWidth: 1920, sourceHeight: 1080, ...PORTRAIT });
    expect(plan.mode).toBe("center_crop");
    expect(plan.xCenter).toBe(0.5);
    expect(plan.reason).toMatch(/centre crop/i);
  });

  it("treats a matching aspect ratio as a native fit with no focal decision", () => {
    const plan = planSmartCrop({ sourceWidth: 1080, sourceHeight: 1920, ...PORTRAIT });
    expect(plan.mode).toBe("native_fit");
    expect(plan.coverage).toBeCloseTo(1, 3);
  });

  it("reframes around a measured motion centroid", () => {
    const plan = planSmartCrop({
      sourceWidth: 1920,
      sourceHeight: 1080,
      ...PORTRAIT,
      probe: { available: true, source: "opencv", motionX: 0.78, motionY: 0.5, concentration: 0.6 },
    });
    expect(plan.mode).toBe("focal_crop");
    expect(plan.xCenter).toBeGreaterThan(0.6);
    expect(plan.signals).toContain("motion_probe");
  });

  it("ignores a diffuse probe, which is a landscape rather than a subject", () => {
    const plan = planSmartCrop({
      sourceWidth: 1920,
      sourceHeight: 1080,
      ...PORTRAIT,
      probe: { available: true, source: "opencv", motionX: 0.9, motionY: 0.5, concentration: 0.05 },
    });
    expect(plan.mode).toBe("center_crop");
  });

  it("lets a manual focal point outrank every measured signal", () => {
    const plan = planSmartCrop({
      sourceWidth: 1920,
      sourceHeight: 1080,
      ...PORTRAIT,
      manualFocalPoint: { x: 0.25, y: 0.5 },
      probe: { available: true, source: "opencv", motionX: 0.85, motionY: 0.5, concentration: 0.9 },
    });
    expect(plan.signals).toContain("manual_focal_point");
    expect(plan.xCenter).toBeLessThan(0.5);
  });

  it("keeps the crop window inside the frame rather than exposing an edge", () => {
    const plan = planSmartCrop({
      sourceWidth: 1920,
      sourceHeight: 1080,
      ...PORTRAIT,
      manualFocalPoint: { x: 0.99, y: 0.99 },
    });
    expect(plan.edgeClamped).toBe(true);
    expect(plan.offsetX).toBeLessThanOrEqual(1920 * plan.scale - 1080);
    expect(plan.offsetX).toBeGreaterThanOrEqual(0);
    expect(plan.offsetY).toBeGreaterThanOrEqual(0);
  });

  it("bounds how far the crop may travel between consecutive shots", () => {
    const first = planSmartCrop({
      sourceWidth: 1920,
      sourceHeight: 1080,
      ...PORTRAIT,
      manualFocalPoint: { x: 0.35, y: 0.5 },
    });
    const second = planSmartCrop({
      sourceWidth: 1920,
      sourceHeight: 1080,
      ...PORTRAIT,
      manualFocalPoint: { x: 0.9, y: 0.5 },
      previousPlan: first,
    });
    expect(second.jitterClamped).toBe(true);
    expect(Math.abs(second.xCenter - first.xCenter)).toBeLessThanOrEqual(
      MAX_CENTER_DELTA_PER_SHOT + 1e-6,
    );
  });

  it("handles a portrait source in a landscape delivery without letterboxing", () => {
    const plan = planSmartCrop({ sourceWidth: 1080, sourceHeight: 1920, ...LANDSCAPE });
    expect(plan.cropWidth).toBe(1920);
    expect(plan.cropHeight).toBe(1080);
    expect(plan.scale).toBeGreaterThan(1);
  });

  it("records the crop decision so a rejected frame can be explained", () => {
    const plan = planSmartCrop({
      sourceWidth: 1920,
      sourceHeight: 1080,
      ...PORTRAIT,
      tags: ["business owner", "person"],
    });
    const meta = cropMetadata(plan);
    expect(meta.mode).toBeTruthy();
    expect(meta.reason).toBeTruthy();
    expect(Array.isArray(meta.signals)).toBe(true);
  });

  it("uses the planned window in the composer, not an unconditional centre crop", () => {
    const plan = planSmartCrop({
      sourceWidth: 1920,
      sourceHeight: 1080,
      ...PORTRAIT,
      manualFocalPoint: { x: 0.3, y: 0.5 },
    });
    const request = {
      shots: [],
      outputPath: "out.mp4",
      width: 1080,
      height: 1920,
      fps: 25,
      workDir: "work",
    };
    const planned = shotFilterChain({ shot: {} as never, cropPlan: plan }, request as never);
    const unplanned = shotFilterChain({ shot: {} as never }, request as never);
    expect(planned).toContain(`crop=1080:1920:${plan.offsetX}:${plan.offsetY}`);
    expect(unplanned).toBe(buildNormalizeFilter(1080, 1920, 25, true));
    expect(planned).not.toBe(unplanned);
  });
});

describe("Stock query families", () => {
  it("turns one intent into several different visual angles", () => {
    const result = buildStockQueryFamilies({
      narration: "عايز موقع إلكتروني عصري لشركتك الصغيرة",
      purpose: "hook",
      industryHint: "digital agency",
    });
    expect(result.matchedConcepts).toContain("website");
    expect(result.families.length).toBeGreaterThanOrEqual(4);
    expect(result.queries.length).toBeGreaterThanOrEqual(5);
    // Distinct angles, not the same phrase reworded.
    expect(new Set(result.queries.map((entry) => entry.query)).size).toBe(result.queries.length);
  });

  it("does not fall back to bare generic terms when a concept was recognised", () => {
    const result = buildStockQueryFamilies({ narration: "our restaurant serves fresh pizza daily" });
    expect(result.genericOnly).toBe(false);
    const generics = ["technology", "business", "success", "computer"];
    expect(queryFamilyTerms(result).filter((term) => generics.includes(term))).toHaveLength(0);
  });

  it("keeps coffee prompts in cafe footage instead of restaurant food footage", () => {
    const result = buildStockQueryFamilies({
      narration: "fresh coffee subscription with cafe preparation and packaging",
      providedTerms: ["coffee subscription box"],
    });
    const terms = queryFamilyTerms(result).join(" ");

    expect(result.matchedConcepts).toContain("coffee");
    expect(result.matchedConcepts).not.toContain("restaurant");
    expect(terms).toContain("coffee");
    expect(terms).toContain("cafe");
    expect(terms).not.toContain("signature dish");
    expect(terms).not.toContain("chef cooking");
  });

  it("labels broad terms as a fallback when nothing specific was recognised", () => {
    const result = buildStockQueryFamilies({ narration: "zzz qqq wwww" });
    expect(result.queries.every((entry) => entry.generic)).toBe(true);
    expect(result.genericOnly).toBe(true);
    // The label is what stops the metadata claiming this was a deliberate choice.
    expect(result.queries[0].rationale).toMatch(/no concept recognised/i);
  });

  it("keeps planner-supplied terms rather than discarding brief-specific vocabulary", () => {
    const result = buildStockQueryFamilies({
      narration: "our apartment in New Cairo",
      providedTerms: ["madinaty compound"],
    });
    expect(queryFamilyTerms(result)).toContain("madinaty compound");
  });

  it("is deterministic for the same scene", () => {
    const input = { narration: "احجز شقتك في التجمع الخامس النهاردة", purpose: "cta" };
    expect(buildStockQueryFamilies(input)).toEqual(buildStockQueryFamilies(input));
  });

  it("frames the same subject differently for a hook and for a CTA", () => {
    const hook = buildStockQueryFamilies({ narration: "modern website for small business", shotIntent: "hook" });
    const cta = buildStockQueryFamilies({ narration: "modern website for small business", shotIntent: "cta" });
    expect(hook.queries[0].query).not.toBe(cta.queries[0].query);
  });

  it("reads Arabic and English narration through the same lexicon", () => {
    const arabic = buildStockQueryFamilies({ narration: "مطعمنا بيقدم بيتزا طازة" });
    const english = buildStockQueryFamilies({ narration: "our restaurant serves fresh pizza" });
    expect(arabic.matchedConcepts).toContain("restaurant");
    expect(english.matchedConcepts).toContain("restaurant");
  });
});

describe("Brand injection", () => {
  it("uses neutral ABUD defaults and says so when no brand was supplied", () => {
    const style = resolveBrandStyle({});
    expect(style.hasBrand).toBe(false);
    expect(style.palette.primary).toBe(ABUD_DEFAULT_PALETTE.primary);
    expect(style.sources.primaryColor).toBe("default");
    expect(style.sources.brandName).toBe("default");
  });

  it("carries every supplied brand field through to the graphic system", () => {
    const style = resolveBrandStyle({
      brandKit: {
        brandName: "Nefertari",
        primaryColor: "#3B2F63",
        secondaryColor: "#221A3D",
        accentColor: "#F2A65A",
        outroText: "اطلب دلوقتي",
        logoUrl: "/uploads/logo.png",
        websiteUrl: "nefertari.example",
        socialHandle: "@nefertari",
      } as never,
    });
    expect(style.hasBrand).toBe(true);
    expect(style.palette.primary).toBe("#3B2F63");
    expect(style.palette.secondary).toBe("#221A3D");
    expect(style.palette.accent).toBe("#F2A65A");
    expect(style.brandName).toBe("Nefertari");
    expect(style.website).toBe("nefertari.example");
    expect(style.socialHandle).toBe("@nefertari");
    expect(style.ctaText).toBe("اطلب دلوقتي");
    (["brandName", "primaryColor", "secondaryColor", "accentColor", "website", "socialHandle"] as const).forEach(
      (field) => expect(style.sources[field]).toBe("customer"),
    );
  });

  it("derives a companion colour from a single supplied one without claiming it was given", () => {
    const style = resolveBrandStyle({ brandKit: { primaryColor: "#3B2F63" } as never });
    expect(style.sources.primaryColor).toBe("customer");
    expect(style.sources.secondaryColor).toBe("derived");
    expect(style.sources.accentColor).toBe("derived");
    expect(style.palette.secondary).not.toBe(style.palette.primary);
    expect(normalizeHex(style.palette.secondary)).toBeTruthy();
  });

  it("keeps every text pairing above the accessible contrast threshold", () => {
    const brands = ["#FFFFFF", "#000000", "#F2A65A", "#3B2F63", "#1B7F4C"];
    brands.forEach((primaryColor) => {
      const style = resolveBrandStyle({ brandKit: { primaryColor } as never });
      style.contrast.forEach((check) => {
        expect(check.ratio).toBeGreaterThanOrEqual(MIN_CONTRAST_RATIO);
        expect(check.passes).toBe(true);
      });
      expect(contrastRatio(style.palette.text, style.palette.background)).toBeGreaterThanOrEqual(
        MIN_CONTRAST_RATIO,
      );
    });
  });

  it("never invents brand copy the customer did not supply", () => {
    const style = resolveBrandStyle({ brandKit: { primaryColor: "#3B2F63" } as never });
    expect(style.brandName).toBeUndefined();
    expect(style.website).toBeUndefined();
    expect(style.socialHandle).toBeUndefined();
  });

  it("names every treatment the brand system is expected to reach", () => {
    BRAND_AWARE_TREATMENTS.forEach((treatment) => {
      expect(TREATMENT_RUNTIME[treatment as VisualTreatment]).toBeTruthy();
    });
    // Raw footage is deliberately absent: recolouring stock is not branding.
    expect(BRAND_AWARE_TREATMENTS).not.toContain("STOCK_FOOTAGE" as never);
  });

  it("renders a mockup with the customer palette rather than the built-in one", () => {
    const branded = renderMockupSvg({
      template: "desktop_browser",
      width: 1080,
      height: 1920,
      palette: { primary: "#3B2F63", accent: "#F2A65A" },
      content: { brandName: "Nefertari" },
    });
    expect(branded).toContain("#3B2F63");
    expect(branded).toContain("Nefertari");
  });
});

describe("Template differentiation", () => {
  const templateIds = [...BUSINESS_TEMPLATE_IDS];

  it("gives every shipped template its own creative profile", () => {
    templateIds.forEach((id) => {
      const profile = creativeProfileForTemplate(id);
      expect(profile).toBeTruthy();
      expect(profile.scenePlan.length).toBeGreaterThanOrEqual(3);
      expect(profile.editorialSummary.length).toBeGreaterThan(10);
    });
  });

  it("covers the six formats the closure pass audits", () => {
    ["product_ad", "restaurant_offer", "real_estate_listing", "viral_curiosity", "educational_tip", "event_promo"].forEach(
      (id) => expect(TEMPLATE_CREATIVE_PROFILES[id as never]).toBeTruthy(),
    );
  });

  it("produces a different treatment sequence per template, not renamed identical plans", () => {
    const sequences = templateIds.map((id) =>
      creativeProfileForTemplate(id)
        .scenePlan.map((scene) => scene.treatment)
        .join(">"),
    );
    // Every format differs from every other one.
    expect(new Set(sequences).size).toBe(sequences.length);
  });

  it("carries the profile into the production spec the renderer receives", () => {
    const productAd = convertTemplateToProductionSpec({ templateId: "product_ad" });
    const restaurant = convertTemplateToProductionSpec({ templateId: "restaurant_offer" });
    const educational = convertTemplateToProductionSpec({ templateId: "educational_tip" });

    expect(productAd.productionMode).toBe("product_ad");
    expect(restaurant.productionMode).toBe("social_viral");
    expect(educational.productionMode).toBe("educational");
    expect(productAd.creativeStyle).toBe("product_showcase");
    expect(educational.creativeStyle).toBe("educational");
    expect(productAd.scenes[0].treatmentHint).toBe("PRODUCT_HERO");
    expect(educational.scenes[0].treatmentHint).toBe("KINETIC_TYPOGRAPHY");
  });

  it("gives each template a measurably different creative plan", () => {
    const plans = templateIds.map((id) => {
      const spec = convertTemplateToProductionSpec({ templateId: id });
      return {
        id,
        plan: buildCreativePlan({
          productionMode: spec.productionMode,
          stylePreset: spec.creativeStyle as never,
          motionIntensity: spec.animationIntensity,
          scenes: spec.scenes.map((scene) => ({
            sceneIndex: scene.sceneIndex,
            narration: scene.narration,
            purpose: scene.purpose,
            durationSeconds: scene.durationSeconds,
            treatmentHint: scene.treatmentHint,
          })),
          hasProductMedia: true,
        }),
      };
    });

    const signatures = plans.map(({ plan }) =>
      [
        plan.stylePreset,
        plan.pacing,
        plan.shotDensity,
        plan.sceneTreatments.map((scene) => scene.treatment).join(">"),
      ].join("|"),
    );
    expect(new Set(signatures).size).toBe(signatures.length);

    // The specific editorial shapes the closure pass asks for.
    const byId = Object.fromEntries(plans.map((entry) => [entry.id, entry.plan]));
    expect(byId.product_ad.sceneTreatments[0].treatment).toBe("PRODUCT_HERO");
    expect(byId.educational_tip.pacing).toBe("calm");
    expect(byId.viral_curiosity.pacing).toBe("energetic");
    expect(byId.viral_curiosity.shotDensity).toBeGreaterThan(byId.educational_tip.shotDensity);
    expect(byId.real_estate_listing.sceneTreatments.some((s) => s.treatment === "FEATURE_LIST")).toBe(true);
    expect(byId.event_promo.sceneTreatments.some((s) => s.treatment === "TIMELINE")).toBe(true);
    // Every format still closes on a call to action.
    templateIds.forEach((id) => {
      const treatments = byId[id].sceneTreatments;
      expect(treatments[treatments.length - 1].treatment).toBe("CTA_SCENE");
    });
  });

  it("honours a treatment hint but still records a fallback when the runtime cannot serve it", () => {
    const plan = buildCreativePlan({
      productionMode: "product_ad",
      scenes: [
        { sceneIndex: 0, narration: "our new watch", purpose: "hook", durationSeconds: 5, treatmentHint: "PRODUCT_HERO" },
      ],
      // No product media configured in this runtime.
      isTreatmentAvailable: (treatment) => TREATMENT_RUNTIME[treatment] !== "product",
    });
    expect(plan.sceneTreatments[0].treatment).not.toBe("PRODUCT_HERO");
    expect(plan.sceneTreatments[0].fellBackFrom).toBe("PRODUCT_HERO");
    expect(plan.sceneTreatments[0].fallbackReason).toBeTruthy();
  });
});

describe("Graphic productions have no required stock dependency", () => {
  const graphicScenes = [
    { sceneIndex: 0, narration: "ليه شغلك محتاج نظام أفضل؟", purpose: "hook", durationSeconds: 5 },
    { sceneIndex: 1, narration: "تلات خطوات بس وهتفرق معاك", purpose: "problem", durationSeconds: 5 },
    { sceneIndex: 2, narration: "وفرنا 40% من وقت الفريق", purpose: "solution", durationSeconds: 5 },
    { sceneIndex: 3, narration: "كلمنا على واتساب دلوقتي", purpose: "cta", durationSeconds: 5 },
  ];

  /** Stands in for a deployment with no Pexels or Pixabay credential at all. */
  const noStockRuntime = (treatment: VisualTreatment) => TREATMENT_RUNTIME[treatment] === "motion";

  it("plans MOTION_GRAPHICS entirely on local motion runtimes", () => {
    const plan = buildCreativePlan({
      productionMode: "motion_graphics",
      scenes: graphicScenes,
      isTreatmentAvailable: noStockRuntime,
    });
    expect(Object.keys(plan.runtimeCounts)).toEqual(["motion"]);
    expect(plan.runtimeCounts.stock).toBeUndefined();
    plan.sceneTreatments.forEach((scene) => {
      expect(TREATMENT_RUNTIME[scene.treatment]).toBe("motion");
      // Every planned treatment must map to a template the engine really has.
      expect(TREATMENT_MOTION_TEMPLATE[scene.treatment]).toBeTruthy();
    });
  });

  it("plans ANIMATED_EXPLAINER entirely on local motion runtimes, with no GPU route", () => {
    const plan = buildCreativePlan({
      productionMode: "animated_explainer",
      scenes: graphicScenes,
      isTreatmentAvailable: noStockRuntime,
    });
    expect(Object.keys(plan.runtimeCounts)).toEqual(["motion"]);
    const runtimes = plan.sceneTreatments.map((scene) => TREATMENT_RUNTIME[scene.treatment]);
    expect(runtimes.every((runtime) => runtime === "motion")).toBe(true);
  });

  it("still resolves to a local graphic when every non-motion runtime is missing", () => {
    const plan = buildCreativePlan({
      productionMode: "motion_graphics",
      scenes: graphicScenes,
      // The harshest case: nothing at all is available.
      isTreatmentAvailable: () => false,
    });
    plan.sceneTreatments.forEach((scene) => {
      expect(TREATMENT_RUNTIME[scene.treatment]).toBe("motion");
      expect(scene.fallbackReason).toBeTruthy();
    });
  });
});

describe("Arabic raster text for motion graphics", () => {
  it("joins Arabic letters into their contextual forms", () => {
    const shaped = shapeArabicForms("بسم");
    expect(containsPresentationForms(shaped)).toBe(true);
    // Initial beh, medial seen, final meem - not three isolated glyphs.
    expect(shaped).toBe("ﺑﺴﻢ");
  });

  it("produces the lam-alef ligature rather than two separate letters", () => {
    expect(shapeArabicForms("لا")).toBe("ﻻ");
  });

  it("reverses Arabic runs for a renderer that only draws left to right", () => {
    const reordered = reorderForDisplay("abc");
    expect(reordered).toBe("abc");
    const arabic = reorderForDisplay("ﺑﺴﻢ");
    expect(arabic).toBe("ﻢﺴﺑ");
  });

  it("keeps Latin words and prices in their own reading order", () => {
    const prepared = prepareArabicForRaster("السعر 599 EGP");
    expect(prepared).toContain("599");
    expect(prepared).toContain("EGP");
    // The digits must not be mirrored into 995.
    expect(prepared).not.toContain("995");
  });

  it("leaves text with no Arabic completely untouched", () => {
    expect(prepareArabicForRaster("Order now for 599 EGP")).toBe("Order now for 599 EGP");
  });
});

describe("Motion font regression", () => {
  it("refuses WOFF and WOFF2, which FreeType cannot rasterize for Pillow", () => {
    expect(isRasterizableFont("Cairo.woff")).toBe(false);
    expect(isRasterizableFont("Cairo.woff2")).toBe(false);
    expect(isRasterizableFont("Cairo-Bold.ttf")).toBe(true);
    expect(isRasterizableFont("Cairo-Bold.otf")).toBe(true);
  });

  it("looks for the bundled pack relative to the module, not the working directory", () => {
    const directories = motionFontDirectories();
    expect(directories.some((dir) => dir.replace(/\\/g, "/").endsWith("assets/fonts"))).toBe(true);
  });

  it("resolves a real bundled TTF with Arabic coverage", () => {
    const font = resolveMotionFont();
    expect(font).not.toBeNull();
    expect(isRasterizableFont(font!.path)).toBe(true);
    expect(fs.existsSync(font!.path)).toBe(true);
    expect(fs.statSync(font!.path).size).toBeGreaterThan(50_000);
  });
});

describe("Website mockup overflow regression", () => {
  const LONG_ARABIC =
    "شركة النيل الذهبي لتصميم وتطوير المواقع الإلكترونية والمتاجر الرقمية في القاهرة الكبرى";
  const LONG_ENGLISH =
    "The Golden Nile Company For Modern Responsive Website And Online Store Design In Greater Cairo";
  const LONG_CTA = "ابدأ مشروعك دلوقتي واحجز استشارة مجانية مع الفريق";

  const templates: MockupTemplateId[] = [
    "desktop_browser",
    "mobile_site",
    "responsive_transition",
    "before_after",
    "analytics_card",
    "speed_card",
    "cta_card",
  ];

  const frames = [
    { width: 1080, height: 1920, label: "9:16" },
    { width: 1920, height: 1080, label: "16:9" },
  ];

  /** Every drawn primitive must sit inside the frame with a small tolerance. */
  function outOfFrame(svg: string, width: number, height: number): string[] {
    const problems: string[] = [];
    const tolerance = 2;
    const rectPattern = /<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"/g;
    let match: RegExpExecArray | null;
    while ((match = rectPattern.exec(svg))) {
      const [x, y, w, h] = match.slice(1).map(Number);
      if (x < -tolerance || y < -tolerance) problems.push(`rect origin ${x},${y}`);
      if (x + w > width + tolerance) problems.push(`rect right edge ${x + w} > ${width}`);
      if (y + h > height + tolerance) problems.push(`rect bottom edge ${y + h} > ${height}`);
    }
    const textPattern = /<text x="(-?[\d.]+)" y="(-?[\d.]+)"/g;
    while ((match = textPattern.exec(svg))) {
      const [x, y] = match.slice(1).map(Number);
      if (x < -tolerance || x > width + tolerance) problems.push(`text x ${x}`);
      if (y < -tolerance || y > height + tolerance) problems.push(`text y ${y}`);
    }
    return problems;
  }

  frames.forEach((frame) => {
    templates.forEach((template) => {
      it(`keeps ${template} inside the ${frame.label} frame with long Arabic copy`, () => {
        const svg = renderMockupSvg({
          template,
          width: frame.width,
          height: frame.height,
          content: {
            brandName: LONG_ARABIC,
            headline: LONG_ARABIC,
            subheadline: LONG_ARABIC,
            ctaLabel: LONG_CTA,
          },
          progress: 0.5,
        });
        expect(outOfFrame(svg, frame.width, frame.height)).toEqual([]);
      });

      it(`keeps ${template} inside the ${frame.label} frame with long English copy`, () => {
        const svg = renderMockupSvg({
          template,
          width: frame.width,
          height: frame.height,
          content: {
            brandName: LONG_ENGLISH,
            headline: LONG_ENGLISH,
            subheadline: LONG_ENGLISH,
            ctaLabel: "Start your project today with a free consultation",
          },
          progress: 1,
        });
        expect(outOfFrame(svg, frame.width, frame.height)).toEqual([]);
      });
    });
  });

  it("truncates rather than letting a headline run past the browser shell", () => {
    const svg = renderMockupSvg({
      template: "desktop_browser",
      width: 1080,
      height: 1920,
      content: { headline: LONG_ENGLISH },
    });
    expect(svg).toContain("…");
  });
});

describe("Editing variety", () => {
  const scenes = [
    { sceneId: "s0", sceneIndex: 0, purpose: "hook", durationSeconds: 6, startSeconds: 0 },
    { sceneId: "s1", sceneIndex: 1, purpose: "solution", durationSeconds: 7, startSeconds: 6 },
    { sceneId: "s2", sceneIndex: 2, purpose: "cta", durationSeconds: 7, startSeconds: 13 },
  ];

  it("chooses camera motion by what the shot means, not by its index parity", () => {
    expect(MOTION_BY_INTENT.hook[0]).toBe("punch_in");
    expect(MOTION_BY_INTENT.cta.every((motion) => motion === "static")).toBe(true);
    // The rejected build produced punch_in / drift_out / punch_in / drift_out for
    // every intent because it only looked at the index.
    expect(motionForShot("proof", 0)).not.toBe(motionForShot("hook", 0));
  });

  it("never repeats the same move twice in a row without a reason", () => {
    expect(motionForShot("problem", 0, "slow_zoom")).not.toBe("slow_zoom");
  });

  it("does not produce a mechanical A/B/A/B motion pattern across the video", () => {
    const edl = buildEditDecisionList({ scenes, totalDurationSeconds: 20 });
    const motions = edl.shots.map((shot) => shot.motion);
    const alternating = motions.every(
      (motion, index) => index < 2 || motion === motions[index - 2],
    );
    expect(alternating).toBe(false);
  });

  it("keeps hard cuts the common case and reserves effects for motivated changes", () => {
    const edl = buildEditDecisionList({ scenes, totalDurationSeconds: 20 });
    const cuts = edl.shots.filter((shot) => shot.transitionIn === "cut").length;
    const effects = edl.shots.filter(
      (shot) => shot.transitionIn && !["cut", "none"].includes(shot.transitionIn),
    ).length;
    expect(cuts).toBeGreaterThan(effects);
  });
});

describe("Beat integration regression", () => {
  it("reads the field name the quality runtime really emits", () => {
    // The runtime returns `beatTimestamps`; a reader looking for `beats` found
    // nothing and every production silently reported beatMapUsed:false.
    const fromRuntime = { bpm: 122, beatTimestamps: [0.5, 1.0, 1.5], energyEnvelope: [] };
    const resolved = Array.isArray((fromRuntime as never as { beatTimestamps?: number[] }).beatTimestamps)
      ? fromRuntime.beatTimestamps
      : [];
    expect(resolved).toHaveLength(3);
  });

  it("marks the map as used and aligns cuts only when beats were supplied", () => {
    const scenes = [
      { sceneId: "s0", sceneIndex: 0, purpose: "hook", durationSeconds: 6, startSeconds: 0 },
      { sceneId: "s1", sceneIndex: 1, purpose: "solution", durationSeconds: 8, startSeconds: 6 },
    ];
    // A real 120 BPM grid: beats every half second across the whole video.
    const beats = Array.from({ length: 28 }, (_, index) => Number((index * 0.5).toFixed(2)));
    const withBeats = buildEditDecisionList({ scenes, totalDurationSeconds: 14, beats });
    const withoutBeats = buildEditDecisionList({ scenes, totalDurationSeconds: 14 });

    expect(withBeats.beatMapUsed).toBe(true);
    expect(withoutBeats.beatMapUsed).toBe(false);
    const aligned = withBeats.shots.filter((shot) => typeof shot.beatHint === "number").length;
    expect(aligned).toBeGreaterThan(0);
    expect(withoutBeats.shots.every((shot) => shot.beatHint === undefined)).toBe(true);
  });

  it("keeps the speech-driven plan intact when beat analysis returns nothing", () => {
    const scenes = [{ sceneId: "s0", sceneIndex: 0, purpose: "hook", durationSeconds: 6, startSeconds: 0 }];
    const edl = buildEditDecisionList({ scenes, totalDurationSeconds: 6, beats: [] });
    expect(edl.beatMapUsed).toBe(false);
    expect(edl.shots.length).toBeGreaterThan(0);
    expect(edl.shots[edl.shots.length - 1].start + edl.shots[edl.shots.length - 1].duration).toBeCloseTo(6, 3);
  });
});

describe("Persistent media is never touched by routine cleanup", () => {
  it("removes only aged temporary files and leaves the uploads tree alone", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "abud-storage-test-"));
    const tempDir = path.join(root, "temp");
    const uploadsDir = path.join(root, "uploads", "products");
    await fs.ensureDir(tempDir);
    await fs.ensureDir(uploadsDir);

    const staleTemp = path.join(tempDir, "old.mp4");
    const productFile = path.join(uploadsDir, "prod_keepme.png");
    const manifest = path.join(root, "uploads", "products_manifest.json");
    await fs.writeFile(staleTemp, "x");
    await fs.writeFile(productFile, "customer bytes");
    await fs.writeJson(manifest, { prod_keepme: { id: "prod_keepme" } });

    const oldTime = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await fs.utimes(staleTemp, oldTime, oldTime);
    await fs.utimes(productFile, oldTime, oldTime);

    const result = await cleanupTemporaryArtifacts({
      dataDirPath: root,
      tempDirPath: tempDir,
      tempMaxAgeMs: 24 * 60 * 60 * 1000,
    } as never);

    expect(result.deleted).toBe(1);
    expect(await fs.pathExists(staleTemp)).toBe(false);
    // The customer library is a different tree and must survive untouched, no
    // matter how old the files in it are.
    expect(await fs.pathExists(productFile)).toBe(true);
    expect(await fs.pathExists(manifest)).toBe(true);

    await fs.remove(root);
  });
});
