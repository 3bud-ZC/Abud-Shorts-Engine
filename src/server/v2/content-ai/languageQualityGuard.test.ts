import { describe, expect, it } from "vitest";
import { analyzeNarrationLanguage, buildLanguageQualityReport } from "./languageQualityGuard";

describe("analyzeNarrationLanguage", () => {
  it("accepts natural Egyptian Arabic with established English tech terms", () => {
    const result = analyzeNarrationLanguage(
      "الـ API بيعمل cache للبيانات عشان الـ response يرجع أسرع.",
      "ar",
    );
    expect(result.unusable).toBe(false);
    expect(result.issues).not.toContain("broken_code_switching");
    expect(result.issues).not.toContain("accidental_language_switch");
  });

  it("detects an English clause embedded inside Arabic narration", () => {
    const result = analyzeNarrationLanguage(
      "الموضوع ده مهم and it helps بشكل كبير.",
      "ar",
    );
    expect(result.issues).toContain("broken_code_switching");
    expect(result.unusable).toBe(false);
  });

  it("marks a majority-English clause inside Arabic narration as unusable", () => {
    const result = analyzeNarrationLanguage(
      "الموضوع ده مهم and it really helps your business grow بشكل كبير.",
      "ar",
    );
    expect(result.issues).toContain("broken_code_switching");
    expect(result.unusable).toBe(true);
  });

  it("flags a scene accidentally written mostly in English for an Arabic spec", () => {
    const result = analyzeNarrationLanguage(
      "This step makes your whole application respond faster to every request.",
      "ar",
    );
    expect(result.issues).toContain("accidental_language_switch");
    expect(result.unusable).toBe(true);
  });

  it("flags Arabic narration leaking into an English spec", () => {
    const result = analyzeNarrationLanguage(
      "هذا هو الدرس الأول عن الكاش والسيرفر",
      "en",
    );
    expect(result.issues).toContain("accidental_language_switch");
    expect(result.unusable).toBe(true);
  });

  it("strips model meta-commentary prefixes", () => {
    const result = analyzeNarrationLanguage(
      "التعليق الصوتي: القهوة الطازجة بتبدأ يومك صح.",
      "ar",
    );
    expect(result.issues).toContain("meta_commentary");
    expect(result.text).not.toMatch(/التعليق الصوتي[:：]/);
    expect(result.text).toContain("القهوة الطازجة");
  });

  it("collapses a duplicated translated term keeping the established form", () => {
    const result = analyzeNarrationLanguage(
      "الـ cache كاش بيخلي البيانات جاهزة.",
      "ar",
    );
    expect(result.issues).toContain("duplicated_term");
    expect(result.text).toBe("الـ cache بيخلي البيانات جاهزة.");
  });

  it("collapses identical adjacent words in either script", () => {
    const ar = analyzeNarrationLanguage("الموضوع ده مهم مهم جداً.", "ar");
    expect(ar.text).toBe("الموضوع ده مهم جداً.");
    const en = analyzeNarrationLanguage("This is really really fast.", "en");
    expect(en.text).toBe("This is really fast.");
  });

  it("normalizes doubled punctuation and spacing", () => {
    const result = analyzeNarrationLanguage("جربها دلوقتي !!  عجبتك ؟", "ar");
    expect(result.issues).toContain("malformed_punctuation");
    expect(result.text).toBe("جربها دلوقتي! عجبتك؟");
  });

  it("treats a pure tech-term cluster as natural, not broken", () => {
    const result = analyzeNarrationLanguage(
      "لما الـ API gateway load balancer بيوزع الترافيك.",
      "ar",
    );
    expect(result.issues).not.toContain("broken_code_switching");
  });
});

describe("buildLanguageQualityReport", () => {
  it("summarizes per-scene results", () => {
    const report = buildLanguageQualityReport([
      { sceneIndex: 0, result: analyzeNarrationLanguage("الـ API بيعمل cache.", "ar") },
      { sceneIndex: 1, result: analyzeNarrationLanguage("This is fully english narration here.", "ar") },
    ]);
    expect(report.scenesChecked).toBe(2);
    expect(report.replacedCount).toBe(1);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0].sceneIndex).toBe(1);
  });
});
