import { describe, it, expect } from "vitest";
import { LocalContentAIProvider } from "./content-ai/localProvider";
import { ContentAIRegistry } from "./content-ai/registry";

describe("Content AI Providers & Creative Director", () => {
  it("Local AI creates valid Egyptian Arabic production spec from prompt", async () => {
    const provider = new LocalContentAIProvider();
    const spec = await provider.generateProductionSpec({
      prompt: "اعمل اعلان 20 ثانية لبراند ملابس شبابي، البداية Hook قوي والختام واتساب",
      language: "ar",
      dialect: "egyptian",
    });

    expect(spec.creationMode).toBe("prompt");
    expect(spec.language).toBe("ar");
    expect(spec.dialect).toBe("egyptian");
    expect(spec.scenes.length).toBeGreaterThanOrEqual(3);
    expect(spec.scenes[0].purpose).toBe("hook");
    expect(spec.scenes[spec.scenes.length - 1].purpose).toBe("cta");
    expect(spec.scenes[0].stockSearchTerms.length).toBeGreaterThan(0);
    expect(spec.cta?.contact).toBe("WhatsApp");
  });

  it("Local AI preserves English technical educational prompts", async () => {
    const provider = new LocalContentAIProvider();
    const spec = await provider.generateProductionSpec({
      prompt: "Create a 30-second educational short explaining why backups matter for small businesses",
      language: "en",
    });

    expect(spec.language).toBe("en");
    expect(spec.scenes.length).toBe(4);
    expect(spec.scenes[0].narration).toContain("data");
    expect(spec.scenes[0].stockSearchTerms).toContain("server room blinking");
  });

  it("Local AI creates topic-specific English coffee subscription scenes", async () => {
    const provider = new LocalContentAIProvider();
    const spec = await provider.generateProductionSpec({
      prompt: "Create a 20-second vertical Short for a modern coffee subscription with real cafe preparation footage",
      language: "en",
      durationSeconds: 20,
    });

    expect(spec.language).toBe("en");
    expect(spec.scenes).toHaveLength(3);
    expect(spec.scenes[0].stockSearchTerms.join(" ")).toContain("coffee");
    expect(spec.scenes[1].stockSearchTerms.join(" ")).toContain("coffee");
    expect(spec.scenes[0].onScreenText).toBe("Cafe Quality At Home");
  });

  it("Local AI creates topic-specific English boutique fitness scenes", async () => {
    const provider = new LocalContentAIProvider();
    const spec = await provider.generateProductionSpec({
      prompt: "Create a 20-second vertical Short for a boutique fitness studio with real people training",
      language: "en",
      durationSeconds: 20,
    });

    expect(spec.language).toBe("en");
    expect(spec.scenes).toHaveLength(3);
    expect(spec.scenes[0].stockSearchTerms.join(" ")).toContain("fitness");
    expect(spec.scenes[1].stockSearchTerms.join(" ")).toContain("trainer");
    expect(spec.scenes[0].onScreenText).toBe("Train With Purpose");
  });

  it("Local AI enhances prompts with structured guidance without replacing original", async () => {
    const provider = new LocalContentAIProvider();
    const result = await provider.rewritePrompt("اعمل اعلان لكافيه");

    expect(result.originalPrompt).toBe("اعمل اعلان لكافيه");
    expect(result.enhancedPrompt.length).toBeGreaterThan(result.originalPrompt.length);
    expect(result.enhancedPrompt).toContain("Hook");
    expect(result.changesSummary.length).toBeGreaterThan(0);
  });

  it("ContentAIRegistry falls back gracefully to Local AI when Gemini is unconfigured", () => {
    const registry = new ContentAIRegistry();
    const provider = registry.getProvider();
    expect(provider.id).toBe("local_ai");
  });
});
