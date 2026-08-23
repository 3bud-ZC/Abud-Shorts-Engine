import { describe, it, expect } from "vitest";
import {
  productionSpecSchema,
  validateProductionSpec,
  validateContentQuality,
  normalizeSceneDurations,
  resolveProductionTimeline,
  calculateNarrationBudget,
  compactNarrationToBudget,
  type ProductionSpec,
} from "./productionSpec";

describe("ProductionSpec Schema & Validation", () => {
  it("validates a complete valid ProductionSpec", () => {
    const valid: ProductionSpec = {
      id: "spec-123",
      creationMode: "prompt",
      title: "Egyptian Streetwear Ad",
      userPrompt: "اعمل اعلان 30 ثانية لبراند ملابس شبابي",
      language: "ar",
      dialect: "egyptian",
      tone: "energetic",
      contentStyle: "advertisement",
      durationSeconds: 30,
      aspectRatio: "9:16",
      resolution: "1080p",
      quality: "standard",
      sceneCount: 4,
      visualMode: "auto",
      voiceProvider: "kokoro",
      voiceId: "af_heart",
      captionStyle: "bold",
      cta: {
        text: "اطلب دلوقتي على واتساب",
        action: "Order on WhatsApp",
        contact: "+201000000000",
      },
      scenes: [
        {
          sceneIndex: 0,
          purpose: "hook",
          durationSeconds: 5,
          narration: "عايز تيشرت مريح وخامته تعيش معاك؟",
          stockSearchTerms: ["streetwear", "fashion"],
          visualSource: "stock",
          transition: "cut",
        },
        {
          sceneIndex: 1,
          purpose: "problem",
          durationSeconds: 7,
          narration: "معظم التيشرتات بتكش من اول غسلة ومش مظبوطة في المقاس.",
          stockSearchTerms: ["clothing", "young people"],
          visualSource: "stock",
          transition: "cut",
        },
        {
          sceneIndex: 2,
          purpose: "solution",
          durationSeconds: 10,
          narration: "كولكشن الصيف الجديد من قطن مصري مية في المية وقصة اوفر سايز مميزة.",
          stockSearchTerms: ["tshirt", "style"],
          visualSource: "stock",
          transition: "fade",
        },
        {
          sceneIndex: 3,
          purpose: "cta",
          durationSeconds: 8,
          narration: "العرض ساري لفترة محدودة، ابعتلنا رسالة على واتساب واحصل على خصم عشرين في المية.",
          stockSearchTerms: ["shopping", "smartphone"],
          visualSource: "stock",
          transition: "cut",
        },
      ],
    };

    const parsed = validateProductionSpec(valid);
    expect(parsed.id).toBe("spec-123");
    expect(parsed.dialect).toBe("egyptian");
    expect(parsed.scenes.length).toBe(4);

    const quality = validateContentQuality(parsed);
    expect(quality.valid).toBe(true);
    expect(quality.warnings.length).toBe(0);
  });

  it("fails when scenes array is empty or narration is missing", () => {
    expect(() =>
      validateProductionSpec({
        id: "bad-spec",
        scenes: [],
      }),
    ).toThrow();

    const specWithEmptyNarration = {
      id: "spec-empty-narr",
      creationMode: "prompt" as const,
      title: "Test",
      language: "en" as const,
      dialect: "none" as const,
      tone: "neutral",
      contentStyle: "educational" as const,
      durationSeconds: 10,
      aspectRatio: "9:16" as const,
      resolution: "1080p" as const,
      quality: "standard" as const,
      sceneCount: 1,
      visualMode: "stock" as const,
      voiceProvider: "kokoro" as const,
      voiceId: "af_heart",
      captionStyle: "bold" as const,
      scenes: [
        {
          sceneIndex: 0,
          purpose: "hook" as const,
          durationSeconds: 5,
          narration: "",
          stockSearchTerms: ["tech"],
          visualSource: "stock" as const,
          transition: "cut" as const,
        },
      ],
    };

    expect(() => validateProductionSpec(specWithEmptyNarration)).toThrow();
  });

  it("normalizes scene durations to match target total duration", () => {
    const scenes = [
      {
        sceneIndex: 0,
        purpose: "hook" as const,
        durationSeconds: 4,
        narration: "Hook text",
        stockSearchTerms: ["hook"],
        visualSource: "stock" as const,
        transition: "cut" as const,
      },
      {
        sceneIndex: 1,
        purpose: "solution" as const,
        durationSeconds: 6,
        narration: "Solution text",
        stockSearchTerms: ["solution"],
        visualSource: "stock" as const,
        transition: "cut" as const,
      },
    ];

    const normalized = normalizeSceneDurations(scenes, 20);
    const sum = normalized.reduce((acc, s) => acc + s.durationSeconds, 0);
    expect(Math.abs(sum - 20)).toBeLessThanOrEqual(0.5);
    expect(normalized[0].durationSeconds).toBe(8);
    expect(normalized[1].durationSeconds).toBe(12);
  });

  it("normalizes 15s and 30s durations correctly with and without outro", () => {
    const scenes = [
      {
        sceneIndex: 0,
        purpose: "hook" as const,
        durationSeconds: 5,
        narration: "Hook",
        stockSearchTerms: ["hook"],
        visualSource: "stock" as const,
        transition: "cut" as const,
      },
      {
        sceneIndex: 1,
        purpose: "solution" as const,
        durationSeconds: 5,
        narration: "Solution",
        stockSearchTerms: ["solution"],
        visualSource: "stock" as const,
        transition: "cut" as const,
      },
    ];

    const norm15 = normalizeSceneDurations(scenes, 15, false);
    const sum15 = norm15.reduce((sum, s) => sum + s.durationSeconds, 0);
    expect(sum15).toBe(15);

    const norm30Outro = normalizeSceneDurations(scenes, 30, true);
    const sum30 = norm30Outro.reduce((sum, s) => sum + s.durationSeconds, 0);
    // 30s with 2.5s outro budget = 27.5s content
    expect(sum30).toBeCloseTo(27.5, 0.5);
  });

  it("resolves canonical ResolvedProductionTimeline correctly", () => {
    const spec: ProductionSpec = {
      id: "timeline-test",
      creationMode: "prompt",
      title: "20s Short Test",
      durationSeconds: 20,
      language: "ar",
      dialect: "egyptian",
      tone: "energetic",
      contentStyle: "advertisement",
      aspectRatio: "9:16",
      resolution: "1080p",
      quality: "standard",
      sceneCount: 3,
      visualMode: "auto",
      voiceProvider: "kokoro",
      voiceId: "af_heart",
      captionStyle: "bold",
      brandKit: {
        brandName: "ABUD Brand",
        includeOutro: true,
      },
      scenes: [
        {
          sceneIndex: 0,
          purpose: "hook",
          durationSeconds: 6,
          narration: "عايز تيشرت شيك ومريح؟",
          stockSearchTerms: ["streetwear"],
          visualSource: "stock",
          transition: "cut",
        },
        {
          sceneIndex: 1,
          purpose: "solution",
          durationSeconds: 6,
          narration: "قطن مية في المية وقصة رايقة.",
          stockSearchTerms: ["cotton"],
          visualSource: "stock",
          transition: "cut",
        },
        {
          sceneIndex: 2,
          purpose: "cta",
          durationSeconds: 6,
          narration: "اطلب دلوقتي على واتساب بخصم خاص.",
          stockSearchTerms: ["whatsapp"],
          visualSource: "stock",
          transition: "cut",
        },
      ],
    };

    const timeline = resolveProductionTimeline(spec, 25);
    expect(timeline.requestedDurationSeconds).toBe(20);
    expect(timeline.targetDurationSeconds).toBe(20);
    expect(timeline.outroDurationSeconds).toBe(2.0);
    expect(timeline.contentDurationSeconds).toBe(18.0);
    expect(timeline.finalExpectedDurationSeconds).toBe(20.0);
    expect(timeline.finalExpectedFrames).toBe(500); // 20 * 25 fps
    expect(timeline.scenes.length).toBe(3);

    // Each scene start and duration
    expect(timeline.scenes[0].startSeconds).toBe(0);
    expect(timeline.scenes[0].durationSeconds).toBe(6);
    expect(timeline.scenes[1].startSeconds).toBe(6);
    expect(timeline.scenes[1].durationSeconds).toBe(6);
    expect(timeline.scenes[2].startSeconds).toBe(12);
    expect(timeline.scenes[2].durationSeconds).toBe(6);
  });

  it("budgets and compacts narration based on speech rate heuristics", () => {
    const budget20Ar = calculateNarrationBudget(5, true);
    expect(budget20Ar.maxWords).toBe(11);
    expect(budget20Ar.maxChars).toBe(55);

    const longArabicText =
      "هذا نص طويل جداً يحتوي على الكثير من الكلمات والجمل الإضافية التي لا تناسب مدة مشهد قصير مدته خمس ثوان فقط في الفيديو";
    const compacted = compactNarrationToBudget(longArabicText, 5, true);
    const wordCount = compacted.split(/\s+/).length;
    expect(wordCount).toBeLessThanOrEqual(11);
  });
});
