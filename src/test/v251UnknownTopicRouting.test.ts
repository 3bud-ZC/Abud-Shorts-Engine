import { describe, expect, it } from "vitest";

import { matchFactPack } from "../server/v2/content-ai/factPacks";
import { LocalContentAIProvider } from "../server/v2/content-ai/localProvider";
import { OllamaContentAIProvider } from "../server/v2/content-ai/ollamaProvider";
import { GeminiContentAIProvider } from "../server/v2/content-ai/geminiProvider";
import { ContentAIRegistry } from "../server/v2/content-ai/registry";
import { Config } from "../config";

/**
 * V2.4 PASS 5.1 - UNKNOWN FACTUAL TOPIC ROUTING
 * ----------------------------------------------
 * These three topics are deliberately NOT covered by any of the six curated
 * fact packs (airplane_windows_rounded, phone_battery_slow_after_80,
 * sky_is_blue, ice_floats, brain_freeze, microwave_uneven_heating). The
 * point of this suite is NOT to make these three specific questions
 * "work" by hardcoding three more fact packs - it is to verify the engine
 * is HONEST about not knowing them: it must never fabricate a confident
 * explanation, and it must route the customer to either a real Content AI
 * provider (when one is configured and healthy) or a clearly-labeled
 * low-confidence state (when none is available), rather than silently
 * rendering generic filler as if it were real content. The customer-safe
 * job-creation block itself is covered end-to-end in v2.test.ts, which
 * already has the FakeDb/router harness this suite would otherwise have to
 * duplicate.
 */
const UNKNOWN_TOPICS = [
  "Why does metal feel colder than wood at the same room temperature?",
  "Why does bread become stale?",
  "Why do cats' eyes glow in the dark?",
];

describe("V2.4 Pass 5.1: unknown topics are genuinely uncovered by the fact-pack library", () => {
  for (const topic of UNKNOWN_TOPICS) {
    it(`matchFactPack returns null for: "${topic}"`, () => {
      expect(matchFactPack(topic, false)).toBeNull();
    });
  }
});

describe("V2.4 Pass 5.1: LocalContentAIProvider is honest, not confidently fabricated, for unknown topics", () => {
  for (const topic of UNKNOWN_TOPICS) {
    it(`marks low confidence / SAFE_GENERIC instead of inventing an explanation for: "${topic}"`, async () => {
      const provider = new LocalContentAIProvider();
      const spec = await provider.generateProductionSpec({
        prompt: topic,
        language: "en",
        requestedDurationSeconds: 20,
      });

      expect((spec.metadata as any)?.contentProvenance).toBe("SAFE_GENERIC");
      expect((spec.metadata as any)?.contentConfidence).toBe("low");
      expect((spec.metadata as any)?.factPackId).toBeUndefined();

      // The generic fallback must never splice the raw topic text in as if
      // it were a real explanation - that would look like a fabricated fact.
      const allNarration = spec.scenes.map((s) => s.narration).join(" ").toLowerCase();
      expect(allNarration).not.toContain(topic.toLowerCase().replace(/[?.]/g, ""));
    });
  }
});

describe("V2.4 Pass 5.1: registry precedence for unknown topics - Ollama/Gemini first when healthy, honest fallback otherwise", () => {
  it("an unconfigured Ollama degrades to the deterministic Local provider without throwing", async () => {
    const ollama = new OllamaContentAIProvider("", "test-model");
    const gemini = new GeminiContentAIProvider(undefined);
    expect(ollama.isConfigured).toBe(false);
    expect(gemini.isConfigured).toBe(false);

    const spec = await ollama.generateProductionSpec({
      prompt: UNKNOWN_TOPICS[0],
      language: "en",
      requestedDurationSeconds: 20,
    });
    expect((spec.metadata as any)?.contentProvenance).toBe("SAFE_GENERIC");
  });

  it("registry order is Ollama (if configured) -> Gemini (if configured) -> deterministic Local AI", () => {
    const registry = new ContentAIRegistry(new Config(), undefined);
    const provider = registry.getProvider();
    // Neither Ollama nor Gemini is configured in the test environment
    // (no OLLAMA_BASE_URL / GEMINI_API_KEY), so the registry must resolve
    // to the deterministic Local provider rather than a provider that
    // would fail or hang against an unreachable endpoint.
    expect(provider.id).toBe("local_ai");
  });
});
