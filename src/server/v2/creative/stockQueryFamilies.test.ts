import { describe, expect, it } from "vitest";
import { buildStockQueryFamilies, isGenericStandaloneQuery, matchConcepts } from "./stockQueryFamilies";

/**
 * Regression coverage for the Revideo real-content proof finding (ABUD_SHORTS_
 * ENGINE_STATUS.md section 11/13): a small-business file-backup scene matched
 * NO concept at all (there was no backup/data concept in this lexicon), which
 * let an unrelated generic "cinematic" query slip through and return a
 * behind-the-scenes filmmaking clip.
 */
describe("data_backup concept", () => {
  it("matches the real English proof narration (both scenes, including 'backing up' not just literal 'back up')", () => {
    expect(matchConcepts("If you run a small business, your files can disappear without warning.").map((c) => c.id)).toContain(
      "data_backup",
    );
    expect(
      matchConcepts("That is why backing up your files regularly protects your work from being lost.").map((c) => c.id),
    ).toContain("data_backup");
  });

  it("matches the real Arabic proof narration (both scenes)", () => {
    expect(matchConcepts("لو بتشتغل على مشروع صغير، ملفاتك ممكن تضيع فجأة من غير ما تحس.").map((c) => c.id)).toContain(
      "data_backup",
    );
    expect(
      matchConcepts("عشان كده لازم تعمل نسخة احتياطية لملفاتك بشكل دوري، وتحافظ على شغلك من الضياع.").map((c) => c.id),
    ).toContain("data_backup");
  });

  it("matches the Arabic title with a definite-article prefix on the second word (النسخ الاحتياطي), not just the bare phrase", () => {
    expect(matchConcepts("أهمية النسخ الاحتياطي لملفات المشاريع الصغيرة").map((c) => c.id)).toContain("data_backup");
  });

  it("produces grounded, non-generic subject/action/environment queries for a backup scene", () => {
    const result = buildStockQueryFamilies({
      narration: "That is why backing up your files regularly protects your work from being lost.",
      purpose: "cta",
      sceneIndex: 1,
    });
    expect(result.genericOnly).toBe(false);
    expect(result.matchedConcepts).toContain("data_backup");
    for (const q of result.queries) {
      expect(isGenericStandaloneQuery(q.query)).toBe(false);
    }
  });
});

describe("isGenericStandaloneQuery", () => {
  it("rejects a bare mood/style word with no other grounding", () => {
    expect(isGenericStandaloneQuery("cinematic")).toBe(true);
    expect(isGenericStandaloneQuery(" Cinematic ")).toBe(true);
    expect(isGenericStandaloneQuery("professional")).toBe(true);
  });

  it("allows the same word combined into a longer, scene-grounded phrase", () => {
    expect(isGenericStandaloneQuery("laptop typing files cinematic")).toBe(false);
  });

  it("does not flag a genuinely specific query", () => {
    expect(isGenericStandaloneQuery("external hard drive close up")).toBe(false);
  });
});

describe("buildStockQueryFamilies providedTerms filtering", () => {
  it("drops a bare generic standalone term supplied by an upstream caller, even when no concept matched", () => {
    // Reproduces the exact real-content bug shape: no concept recognised,
    // and one of the provided terms is a bare mood word from the (now fixed)
    // enrichSearchTerms default.
    const result = buildStockQueryFamilies({
      narration: "some narration matching nothing in the lexicon",
      providedTerms: ["a specific real term", "cinematic"],
    });
    expect(result.queries.map((q) => q.query)).not.toContain("cinematic");
    expect(result.queries.map((q) => q.query)).toContain("a specific real term");
  });
});

describe("Arabic substring concept boundaries", () => {
  it("does not match coffee inside Egyptian بنـ verbs or بنك (bank)", () => {
    // Live production regression: "بنحفظها في الـ Cache" produced an all-coffee
    // candidate pool and a roasted-beans clip in an API-caching explainer.
    expect(matchConcepts("بدل ما كل مرة نطلب حاجة من السيرفر، بنحفظها في الـ Cache عشان نرجعها فوراً.").map((c) => c.id)).not.toContain("coffee");
    expect(matchConcepts("البنك بيحول فلوسك لحساب التوفير لوحده.").map((c) => c.id)).not.toContain("coffee");
    expect(matchConcepts("لبن طازج يومياً").map((c) => c.id)).not.toContain("coffee");
  });

  it("still matches a real standalone بن (coffee beans) mention", () => {
    expect(matchConcepts("قهوة مختصة وبن محمص على الطلب").map((c) => c.id)).toContain("coffee");
    expect(matchConcepts("البن عندنا بيتحمص يومياً").map((c) => c.id)).toContain("coffee");
  });

  it("does not match logistics inside متطلبات (requirements)", () => {
    expect(matchConcepts("متطلبات النظام الأساسية قبل التحديث").map((c) => c.id)).not.toContain("logistics");
    expect(matchConcepts("الطلبات بتوصل للعميل في نفس اليوم").map((c) => c.id)).toContain("logistics");
  });

  it("does not match events inside احتفل (celebrate)", () => {
    expect(matchConcepts("احنا بنحتفل بمرور سنة على الشركة").map((c) => c.id)).not.toContain("event");
    expect(matchConcepts("حفلة الافتتاح يوم الجمعة").map((c) => c.id)).toContain("event");
  });
});
