import { describe, expect, it } from "vitest";

import { matchFactPack } from "../server/v2/content-ai/factPacks";
import { detectContentStyle } from "../server/v2/content-ai/contentStyleDetector";
import { LocalContentAIProvider } from "../server/v2/content-ai/localProvider";

/**
 * V2.4 PASS 5 - CONTENT INTELLIGENCE
 * -------------------------------------
 * Real Pass 4 benchmark 2 ("why airplane windows are rounded") produced
 * visually valid but topic-neutral narration
 * ("Here's something interesting...") because (a) `/api/v2/production/jobs`
 * has no `contentStyle` field a prompt-only customer can set, so every
 * prompt defaulted to "advertisement", and (b) even a curiosity-style
 * request had no source of actual topic knowledge to draw on. This suite
 * covers both fixes plus the deliberately-not-hardcoded generalization
 * requirement (section 41): a second, different topic must resolve through
 * the SAME matching mechanism, not a bespoke branch.
 */

describe("V2.4 Pass 5: content style auto-detection", () => {
  it("detects a curiosity prompt with no explicit contentStyle field available", () => {
    expect(
      detectContentStyle(
        "Create a 25-second vertical curiosity video explaining why airplane windows are rounded instead of square.",
      ),
    ).toBe("viral_curiosity");
  });

  it("does not override an unambiguous business/ad prompt", () => {
    expect(
      detectContentStyle(
        "Create a professional vertical social video for a small web-design service. CTA: Make your business look professional.",
      ),
    ).toBeNull();
  });
});

describe("V2.4 Pass 5: fact pack matching generalizes beyond the airplane example", () => {
  it("matches the airplane-windows pack from the exact Pass 4 benchmark prompt", () => {
    const match = matchFactPack(
      "Create a 25-second vertical curiosity video explaining why airplane windows are rounded instead of square.",
      false,
    );
    expect(match?.pack.id).toBe("airplane_windows_rounded");
  });

  it("matches a genuinely different, unrelated topic through the same mechanism (not a second hardcoded branch)", () => {
    const match = matchFactPack(
      "Why do phone batteries charge much slower after about 80%?",
      false,
    );
    expect(match?.pack.id).toBe("phone_battery_slow_after_80");
  });

  it("matches on a reasonable paraphrase, not just the exact benchmark wording", () => {
    const match = matchFactPack("why do plane windows have rounded corners instead of square ones", false);
    expect(match?.pack.id).toBe("airplane_windows_rounded");
  });

  it("returns null for a topic with no curated pack, rather than guessing", () => {
    expect(matchFactPack("why do cats purr when they are happy", false)).toBeNull();
  });

  it("does not match when the topic is mentioned only to be excluded", () => {
    expect(matchFactPack("this video is not about why airplane windows are round", false)).toBeNull();
  });
});

describe("V2.4 Pass 5: LocalContentAIProvider produces real explanatory narration for curiosity prompts", () => {
  it("actually explains the airplane-window physics instead of generic filler (hard content gate)", async () => {
    const provider = new LocalContentAIProvider();
    const spec = await provider.generateProductionSpec({
      prompt: "Create a 25-second vertical curiosity video explaining why airplane windows are rounded instead of square. Use highly relevant real footage, fast clean editing, natural narration and clean captions.",
      language: "en",
      requestedDurationSeconds: 25,
    });

    const allNarration = spec.scenes.map((s) => s.narration).join(" ").toLowerCase();
    // The hard content gate: it must actually explain the concept, not just
    // sound topical. "stress" + "round"/"corner" together is the real
    // physics claim, not a synonym for "here's something interesting".
    expect(allNarration).toMatch(/stress/);
    expect(allNarration).toMatch(/round|curv/);
    expect(allNarration).toMatch(/corner/);
    expect(allNarration).not.toContain("here's something worth seeing");
    expect(allNarration).not.toContain("here is what makes it worth your attention");

    expect((spec.metadata as any)?.contentProvenance).toBe("DETERMINISTIC");
    expect((spec.metadata as any)?.factPackId).toBe("airplane_windows_rounded");
    expect((spec.metadata as any)?.contentConfidence).toBe("high");
  });

  it("actually explains the second, unrelated topic too, proving this generalizes", async () => {
    const provider = new LocalContentAIProvider();
    const spec = await provider.generateProductionSpec({
      prompt: "Why do phone batteries charge much slower after about 80%? Make it a 20-second explainer with real footage.",
      language: "en",
      requestedDurationSeconds: 20,
    });

    const allNarration = spec.scenes.map((s) => s.narration).join(" ").toLowerCase();
    expect(allNarration).toMatch(/lithium/);
    expect(allNarration).toMatch(/trickle|slow/);
    expect((spec.metadata as any)?.contentProvenance).toBe("DETERMINISTIC");
    expect((spec.metadata as any)?.factPackId).toBe("phone_battery_slow_after_80");
  });

  it("honestly marks low confidence instead of pretending generic filler is professional for an uncovered topic", async () => {
    const provider = new LocalContentAIProvider();
    const spec = await provider.generateProductionSpec({
      prompt: "Create a 20-second curiosity video explaining why cats purr when they are happy.",
      language: "en",
      requestedDurationSeconds: 20,
    });

    expect((spec.metadata as any)?.contentProvenance).toBe("SAFE_GENERIC");
    expect((spec.metadata as any)?.contentConfidence).toBe("low");
    // The generic fallback must still never splice raw prompt text in.
    const allNarration = spec.scenes.map((s) => s.narration).join(" ").toLowerCase();
    expect(allNarration).not.toContain("curiosity video");
    expect(allNarration).not.toContain("cats purr");
  });

  it("still routes a genuine business prompt to its business template even with curiosity-shaped phrasing", async () => {
    const provider = new LocalContentAIProvider();
    const spec = await provider.generateProductionSpec({
      prompt: "Create a video explaining why our web design service is the best choice for small businesses.",
      language: "en",
      requestedDurationSeconds: 20,
    });
    // Business-vertical dispatch (web design) must win over any accidental
    // fact-pack match for this content-style-detected-as-curiosity prompt.
    expect((spec.metadata as any)?.contentProvenance).toBe("DETERMINISTIC");
    expect((spec.metadata as any)?.factPackId).toBeUndefined();
  });
});
