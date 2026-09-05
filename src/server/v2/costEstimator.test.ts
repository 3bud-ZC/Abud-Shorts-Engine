import { describe, it, expect } from "vitest";
import { estimateProductionCost } from "./cost-estimator";

describe("Cost Estimator Foundation", () => {
  it("computes $0 / free for local Kokoro + Pexels video", () => {
    const cost = estimateProductionCost({
      visualMode: "stock",
      voiceProvider: "kokoro",
      scenes: [
        {
          sceneIndex: 0,
          purpose: "hook",
          durationSeconds: 5,
          narration: "Hello from local engine",
          stockSearchTerms: ["nature"],
          visualSource: "stock",
          transition: "cut",
        },
        {
          sceneIndex: 1,
          purpose: "cta",
          durationSeconds: 5,
          narration: "Contact us today",
          stockSearchTerms: ["business"],
          visualSource: "stock",
          transition: "cut",
        },
      ],
    });

    expect(cost.isFree).toBe(true);
    expect(cost.estimatedCost).toBe(0);
    expect(cost.breakdown.visualAssets.aiCount).toBe(0);
    expect(cost.breakdown.visualAssets.stockCount).toBe(2);
  });

  it("reports AI scenes and premium voice as usage based without invented pricing", () => {
    const cost = estimateProductionCost({
      visualMode: "ai",
      voiceProvider: "elevenlabs",
      scenes: [
        {
          sceneIndex: 0,
          purpose: "hook",
          durationSeconds: 5,
          narration: "A cinematic luxury scene narration with enough characters",
          stockSearchTerms: ["luxury"],
          visualSource: "ai",
          visualProvider: "veo",
          transition: "cut",
        },
        {
          sceneIndex: 1,
          purpose: "solution",
          durationSeconds: 5,
          narration: "Another high fidelity AI generated visual showcase scene",
          stockSearchTerms: ["future"],
          visualSource: "ai",
          visualProvider: "fal",
          transition: "cut",
        },
      ],
    });

    expect(cost.isFree).toBe(false);
    expect(cost.estimatedCost).toBe(0);
    expect(cost.usageBased).toBe(true);
    expect(cost.costLabel).toContain("Usage Based");
    expect(cost.breakdown.visualAssets.aiCount).toBe(2);
    expect(cost.breakdown.visualAssets.usageBased).toBe(true);
    expect(cost.breakdown.voice.provider).toBe("elevenlabs");
  });

  it("reports ElevenLabs voice cost as usage based instead of $0 or an invented figure", () => {
    const cost = estimateProductionCost(
      {
        scenes: [
          {
            sceneIndex: 0,
            purpose: "hook",
            durationSeconds: 5,
            narration: "Arabic narration billed by ElevenLabs character usage",
            stockSearchTerms: ["office"],
            visualSource: "stock",
            transition: "cut",
          },
        ],
      },
      { voiceProvider: "elevenlabs" },
    );

    // An ElevenLabs job must never present itself as a free external pipeline.
    expect(cost.isFree).toBe(false);
    expect(cost.usageBased).toBe(true);
    expect(cost.costLabel).toContain("Usage Based");
    expect(cost.breakdown.voice.estimatedCostTier).toBe("premium");
    // No fabricated dollar amount for a provider we cannot price reliably.
    expect(cost.breakdown.voice.cost).toBe(0);
    expect(cost.estimatedCost).toBe(0);
  });

  it("keeps the local pipeline reported as genuinely free", () => {
    const cost = estimateProductionCost(
      {
        scenes: [
          {
            sceneIndex: 0,
            purpose: "hook",
            durationSeconds: 5,
            narration: "English narration produced locally by Kokoro",
            stockSearchTerms: ["office"],
            visualSource: "stock",
            transition: "cut",
          },
        ],
      },
      { voiceProvider: "kokoro" },
    );

    expect(cost.isFree).toBe(true);
    expect(cost.usageBased).toBe(false);
    expect(cost.breakdown.voice.estimatedCostTier).toBe("local_free");
  });
});
