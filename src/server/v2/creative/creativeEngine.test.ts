import { describe, expect, it } from "vitest";

import {
  buildCreativePlan,
  CREATIVE_PRESETS,
  creativePlanFacts,
  presetForProductionMode,
} from "./creativePlan";
import { classifyVisualIntent, splitNarrationBeats } from "./visualIntentClassifier";
import {
  ALL_TREATMENTS,
  isMotionTreatment,
  resolveAvailableTreatment,
  TREATMENT_MOTION_TEMPLATE,
  TREATMENT_RUNTIME,
  type VisualTreatment,
} from "./visualTreatment";

/**
 * F2 CREATIVE ENGINE
 *
 * The rejected output cut six stock clips and two mockups across twenty
 * seconds, with every hook shot the same 1.68s length. These cover the layer
 * that decides what each line should look like.
 */

describe("Visual intent classification", () => {
  it("routes a percentage claim to a stats card and extracts the figure", () => {
    const result = classifyVisualIntent("سبعين بالمية من الزوار بيسيبوا الموقع البطيء، 70% منهم مش بيرجعوا");
    expect(result.signal).toBe("statistic");
    expect(result.treatment).toBe("STATS_CARD");
    expect(result.extracted?.statValue).toBe("70");
    expect(result.extracted?.statSuffix).toBe("%");
  });

  it("recognises an English percentage too", () => {
    const result = classifyVisualIntent("53% of visitors leave a slow website");
    expect(result.treatment).toBe("STATS_CARD");
    expect(result.extracted?.statValue).toBe("53");
  });

  it("routes a counted list to a feature list", () => {
    const arabic = classifyVisualIntent("تلات أسباب تخليك تغير موقعك");
    expect(arabic.signal).toBe("enumeration");
    expect(arabic.treatment).toBe("FEATURE_LIST");
    expect(arabic.extracted?.stepCount).toBe(3);

    const english = classifyVisualIntent("3 reasons your website is losing customers");
    expect(english.treatment).toBe("FEATURE_LIST");
    expect(english.extracted?.stepCount).toBe(3);
  });

  it("routes process wording to process steps", () => {
    expect(classifyVisualIntent("خطوات بسيطة نبدأ بيها الشغل").treatment).toBe("PROCESS_STEPS");
    expect(classifyVisualIntent("Here is how it works, step by step").treatment).toBe("PROCESS_STEPS");
  });

  it("needs both halves before calling something a before/after", () => {
    const both = classifyVisualIntent("موقعك كان قديم، بقى جديد وسريع");
    expect(both.treatment).toBe("BEFORE_AFTER");
    // "بعد" alone must not trigger a contrast treatment.
    const onlyAfter = classifyVisualIntent("بعد كده تقدر تتواصل معانا");
    expect(onlyAfter.treatment).not.toBe("BEFORE_AFTER");
  });

  it("shows the website itself rather than generic footage", () => {
    const site = classifyVisualIntent("موقع سريع وشكله احترافي");
    expect(site.treatment).toBe("WEBSITE_MOCKUP");
    // A device mention should put the site on a device.
    const device = classifyVisualIntent("موقعك على الموبايل والابتوب");
    expect(device.treatment).toBe("DEVICE_MOCKUP");
  });

  it("routes the closing call to action to a CTA scene", () => {
    const byRole = classifyVisualIntent("اي كلام", { purpose: "cta" });
    expect(byRole.treatment).toBe("CTA_SCENE");
    const byWording = classifyVisualIntent("تواصل معانا دلوقتي على واتساب", { positionRatio: 0.9 });
    expect(byWording.treatment).toBe("CTA_SCENE");
  });

  it("does not treat an early 'ابدأ' as the closing CTA", () => {
    const opening = classifyVisualIntent("ابدأ تفكر في موقعك", { positionRatio: 0.05 });
    expect(opening.treatment).not.toBe("CTA_SCENE");
  });

  it("carries a provocative opening as typography rather than stock", () => {
    const hook = classifyVisualIntent("بتخسر عملاء كل يوم؟", { purpose: "hook", positionRatio: 0 });
    expect(hook.treatment).toBe("KINETIC_TYPOGRAPHY");
  });

  it("falls back to stock footage for ordinary real-world narration", () => {
    const general = classifyVisualIntent("فريقنا بيشتغل من القاهرة");
    expect(general.treatment).toBe("STOCK_FOOTAGE");
    expect(general.confidence).toBeLessThan(0.7);
  });

  it("prefers customer media over stock when it exists", () => {
    const uploaded = classifyVisualIntent("شوف شغلنا", { hasUploadedMedia: true });
    expect(uploaded.treatment).toBe("UPLOADED_MEDIA");
  });

  it("is deterministic - the same narration always classifies the same way", () => {
    const text = "70% من العملاء بيدوروا على الموقع الأول";
    const runs = Array.from({ length: 5 }, () => classifyVisualIntent(text));
    expect(new Set(runs.map((r) => r.treatment)).size).toBe(1);
    expect(new Set(runs.map((r) => r.signal)).size).toBe(1);
  });

  it("needs no network or paid provider", () => {
    // Classification is pure: it takes a string and returns a decision.
    const result = classifyVisualIntent("اي حاجة");
    expect(result).toHaveProperty("treatment");
    expect(result).toHaveProperty("reason");
  });

  it("splits a scene into the beats a viewer perceives", () => {
    const beats = splitNarrationBeats("موقعك القديم بيضيّع عملاء. ابدأ دلوقتي، وخلي شغلك يظهر.");
    expect(beats.length).toBeGreaterThanOrEqual(2);
    expect(beats.every((beat) => beat.length > 0)).toBe(true);
  });
});

describe("Treatment vocabulary", () => {
  it("gives every treatment a runtime that exists in this engine", () => {
    ALL_TREATMENTS.forEach((treatment) => {
      expect(TREATMENT_RUNTIME[treatment], treatment).toBeTruthy();
    });
  });

  it("maps every motion-backed treatment to a real Motion Canvas template", () => {
    const realTemplates = [
      "kinetic_typography", "stat_animation", "feature_list",
      "cta_card", "logo_reveal", "explainer_diagram",
    ];
    ALL_TREATMENTS.filter(isMotionTreatment).forEach((treatment) => {
      const template = TREATMENT_MOTION_TEMPLATE[treatment];
      expect(template, `${treatment} has no template`).toBeTruthy();
      expect(realTemplates).toContain(template);
    });
  });

  it("falls back to an available treatment rather than leaving a blank scene", () => {
    // Nothing but offline motion is available.
    const resolved = resolveAvailableTreatment("WEBSITE_MOCKUP", (t) => isMotionTreatment(t));
    expect(isMotionTreatment(resolved.treatment)).toBe(true);
    expect(resolved.fellBackFrom).toBe("WEBSITE_MOCKUP");
    expect(resolved.reason).toBeTruthy();
  });

  it("terminates even when nothing at all is available", () => {
    const resolved = resolveAvailableTreatment("STOCK_FOOTAGE", () => false);
    // The guaranteed floor is offline motion graphics.
    expect(resolved.treatment).toBe("MOTION_GRAPHICS");
    expect(resolved.reason).toContain("unavailable");
  });

  it("keeps the preferred treatment when it is available", () => {
    const resolved = resolveAvailableTreatment("STOCK_FOOTAGE", () => true);
    expect(resolved.treatment).toBe("STOCK_FOOTAGE");
    expect(resolved.fellBackFrom).toBeUndefined();
  });
});

describe("Creative plan", () => {
  const websiteAdScenes = [
    { sceneIndex: 0, narration: "بتخسر عملاء كل يوم عشان معندكش موقع احترافي؟", purpose: "hook", durationSeconds: 6.7 },
    { sceneIndex: 1, narration: "موقع سريع ومتوافق مع الموبايل يعرض خدماتك بأعلى جودة.", purpose: "solution", durationSeconds: 6.7 },
    { sceneIndex: 2, narration: "تواصل معانا دلوقتي على واتساب وابدأ موقعك الجديد.", purpose: "cta", durationSeconds: 6.7 },
  ];

  it("resolves one plan per production with a treatment for every scene", () => {
    const plan = buildCreativePlan({ productionMode: "auto_hybrid", scenes: websiteAdScenes });
    expect(plan.version).toBe("creative.v1");
    expect(plan.sceneTreatments).toHaveLength(3);
    plan.sceneTreatments.forEach((scene) => {
      expect(ALL_TREATMENTS).toContain(scene.treatment);
      expect(scene.reason.length).toBeGreaterThan(3);
    });
  });

  it("mixes treatments instead of using one for the whole video", () => {
    const plan = buildCreativePlan({ productionMode: "auto_hybrid", scenes: websiteAdScenes });
    const facts = creativePlanFacts(plan);
    // The rejected edit was effectively one treatment; a hybrid must vary.
    expect(facts.distinctTreatments).toBeGreaterThanOrEqual(2);
    expect(facts.hasCta).toBe(true);
  });

  it("avoids using the same treatment twice in a row when unsure", () => {
    const repetitive = Array.from({ length: 4 }, (_, index) => ({
      sceneIndex: index,
      narration: "فريقنا بيشتغل من القاهرة",
      durationSeconds: 3,
    }));
    const plan = buildCreativePlan({ productionMode: "auto_hybrid", scenes: repetitive });
    let backToBack = 0;
    for (let i = 1; i < plan.sceneTreatments.length; i++) {
      if (plan.sceneTreatments[i].treatment === plan.sceneTreatments[i - 1].treatment) backToBack++;
    }
    expect(backToBack).toBeLessThan(plan.sceneTreatments.length - 1);
  });

  it("still allows a confident classification to repeat", () => {
    // Two explicit CTAs must both stay CTA scenes; consistency is the point.
    const plan = buildCreativePlan({
      productionMode: "auto_hybrid",
      scenes: [
        { sceneIndex: 0, narration: "تواصل معانا", purpose: "cta", durationSeconds: 3 },
        { sceneIndex: 1, narration: "اطلب دلوقتي", purpose: "cta", durationSeconds: 3 },
      ],
    });
    expect(plan.sceneTreatments.every((s) => s.treatment === "CTA_SCENE")).toBe(true);
  });

  it("gives each production mode a genuinely different creative posture", () => {
    const modes = ["social_viral", "stock_cinematic", "motion_graphics", "educational", "product_ad"];
    const plans = modes.map((mode) => buildCreativePlan({ productionMode: mode, scenes: websiteAdScenes }));
    // Presets must not collapse into one shared configuration.
    expect(new Set(plans.map((p) => p.stylePreset)).size).toBe(modes.length);
    expect(new Set(plans.map((p) => p.shotDensity)).size).toBeGreaterThan(1);
    expect(new Set(plans.map((p) => p.visualLanguage)).size).toBeGreaterThan(1);
  });

  it("maps every production mode to a real preset", () => {
    ["auto_hybrid", "social_viral", "stock_cinematic", "motion_graphics",
     "animated_explainer", "product_ad", "educational", "custom_media"].forEach((mode) => {
      const preset = presetForProductionMode(mode);
      expect(CREATIVE_PRESETS[preset], mode).toBeTruthy();
    });
  });

  it("increases shot density with motion intensity", () => {
    const base = buildCreativePlan({ productionMode: "auto_hybrid", scenes: websiteAdScenes, motionIntensity: "low" });
    const high = buildCreativePlan({ productionMode: "auto_hybrid", scenes: websiteAdScenes, motionIntensity: "high" });
    expect(high.shotDensity).toBeGreaterThan(base.shotDensity);
  });

  it("only claims brand presence when a brand profile exists", () => {
    const without = buildCreativePlan({ productionMode: "product_ad", scenes: websiteAdScenes });
    expect(without.brandPresence).toBe("none");
    const withBrand = buildCreativePlan({ productionMode: "product_ad", scenes: websiteAdScenes, hasBrandProfile: true });
    expect(withBrand.brandPresence).not.toBe("none");
  });

  it("records a fallback reason rather than silently substituting", () => {
    // Only motion runtimes available: stock-led scenes must say so.
    const plan = buildCreativePlan({
      productionMode: "auto_hybrid",
      scenes: websiteAdScenes,
      isTreatmentAvailable: (treatment) => isMotionTreatment(treatment),
    });
    const substituted = plan.sceneTreatments.filter((scene) => scene.fellBackFrom);
    substituted.forEach((scene) => expect(scene.fallbackReason).toBeTruthy());
    // And nothing is left without a treatment.
    expect(plan.sceneTreatments.every((s) => Boolean(s.treatment))).toBe(true);
  });

  it("reports facts, never a self-awarded quality score", () => {
    const plan = buildCreativePlan({ productionMode: "auto_hybrid", scenes: websiteAdScenes });
    const facts = creativePlanFacts(plan);
    expect(facts).toHaveProperty("distinctTreatments");
    expect(facts).toHaveProperty("fallbackScenes");
    // No grading language anywhere in the fact sheet.
    expect(JSON.stringify(facts)).not.toMatch(/excellent|perfect|professional|score.*100/i);
  });

  it("produces an offline-only plan when no provider is configured", () => {
    const plan = buildCreativePlan({
      productionMode: "motion_graphics",
      scenes: websiteAdScenes,
      isTreatmentAvailable: (t) => isMotionTreatment(t),
    });
    // Every scene resolves to something that renders with no network at all.
    expect(plan.sceneTreatments.every((s) => isMotionTreatment(s.treatment))).toBe(true);
  });
});
