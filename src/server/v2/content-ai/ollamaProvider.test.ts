import { describe, expect, it, afterEach } from "vitest";
import nock from "nock";

import { OllamaContentAIProvider } from "./ollamaProvider";

/**
 * V2.4 PASS 5 - OLLAMA PROVIDER ROBUSTNESS AND TRUTH SAFETY
 * -------------------------------------------------------------
 * `generateProductionSpec` previously had no try/catch around the live
 * `/api/generate` call: a configured-but-unreachable Ollama endpoint (a
 * transient outage, a wrong port, the model not pulled yet) would throw and
 * fail the whole production job, contradicting the explicit "do not block
 * the product" policy for an optional local LLM. Separately, nothing
 * re-validated the LLM's "improved" narration/CTA against the truth-safety
 * rules the deterministic baseline already enforces, so an LLM that ignored
 * its system prompt could reintroduce an invented WhatsApp CTA that the
 * baseline had already correctly stripped.
 */

const PROMPT = "Create a professional vertical social video for a small web-design service. Do not invent phone numbers or WhatsApp numbers. CTA: Make your business look professional.";

afterEach(() => {
  nock.cleanAll();
});

describe("OllamaContentAIProvider robustness", () => {
  it("falls back to the deterministic baseline (does not throw) when the endpoint is unreachable", async () => {
    const provider = new OllamaContentAIProvider("http://127.0.0.1:1", "test-model");
    const spec = await provider.generateProductionSpec({ prompt: PROMPT, language: "en", requestedDurationSeconds: 20 });
    expect(spec.scenes.length).toBeGreaterThan(0);
    expect((spec.metadata as any)?.planner).toBe("LocalContentAIProvider");
  });

  it("falls back to the deterministic baseline when the endpoint returns malformed JSON", async () => {
    nock("http://ollama.test").post("/api/generate").reply(200, { response: "not json at all" });
    const provider = new OllamaContentAIProvider("http://ollama.test", "test-model");
    const spec = await provider.generateProductionSpec({ prompt: PROMPT, language: "en", requestedDurationSeconds: 20 });
    expect(spec.scenes.length).toBeGreaterThan(0);
    expect((spec.metadata as any)?.planner).toBe("LocalContentAIProvider");
  });

  it("falls back to the deterministic baseline when the endpoint errors (5xx)", async () => {
    nock("http://ollama.test").post("/api/generate").reply(500, "internal error");
    const provider = new OllamaContentAIProvider("http://ollama.test", "test-model");
    const spec = await provider.generateProductionSpec({ prompt: PROMPT, language: "en", requestedDurationSeconds: 20 });
    expect(spec.scenes.length).toBeGreaterThan(0);
    expect((spec.metadata as any)?.planner).toBe("LocalContentAIProvider");
  });

  it("uses the LLM's response when it is well-formed and truth-safe", async () => {
    nock("http://ollama.test")
      .post("/api/generate")
      .reply(200, {
        response: JSON.stringify({
          scenes: [
            { sceneIndex: 0, purpose: "hook", narration: "Is your website driving customers away?", onScreenText: "Outdated Website?" },
            { sceneIndex: 1, purpose: "solution", narration: "We build fast, modern, mobile-friendly sites.", onScreenText: "Fast & Modern" },
            { sceneIndex: 2, purpose: "cta", narration: "Make your business look professional.", onScreenText: "Make your business look professional." },
          ],
          cta: { text: "Make your business look professional." },
        }),
      });
    const provider = new OllamaContentAIProvider("http://ollama.test", "test-model");
    const spec = await provider.generateProductionSpec({ prompt: PROMPT, language: "en", requestedDurationSeconds: 20 });
    expect((spec.metadata as any)?.planner).toBe("OllamaContentAIProvider");
    expect((spec.metadata as any)?.contentProvenance).toBe("MODEL_GENERATED");
    expect(spec.scenes[0].narration).toContain("driving customers away");
  });

  it("reverts an individual scene to the safe baseline when the LLM reintroduces an invented WhatsApp CTA", async () => {
    nock("http://ollama.test")
      .post("/api/generate")
      .reply(200, {
        response: JSON.stringify({
          scenes: [
            { sceneIndex: 0, purpose: "hook", narration: "Is your website driving customers away?", onScreenText: "Outdated Website?" },
            { sceneIndex: 1, purpose: "solution", narration: "We build fast, modern, mobile-friendly sites.", onScreenText: "Fast & Modern" },
            // The prompt explicitly forbade this - the LLM ignored its system prompt.
            { sceneIndex: 2, purpose: "cta", narration: "Message us on WhatsApp today!", onScreenText: "Message Us on WhatsApp" },
          ],
          cta: { text: "Message us on WhatsApp today!" },
        }),
      });
    const provider = new OllamaContentAIProvider("http://ollama.test", "test-model");
    const spec = await provider.generateProductionSpec({ prompt: PROMPT, language: "en", requestedDurationSeconds: 20 });

    const ctaScene = spec.scenes.find((s) => s.purpose === "cta");
    expect(ctaScene?.narration.toLowerCase()).not.toContain("whatsapp");
    expect(ctaScene?.onScreenText?.toLowerCase()).not.toContain("whatsapp");
    expect(spec.cta?.text.toLowerCase()).not.toContain("whatsapp");
    expect(spec.cta?.contact).toBeUndefined();
    // The two scenes the LLM did NOT corrupt still come from its response.
    expect(spec.scenes[0].narration).toContain("driving customers away");
  });
});
