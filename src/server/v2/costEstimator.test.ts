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

  it("computes estimated cost for AI scenes and premium voice", () => {
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
    expect(cost.estimatedCost).toBeGreaterThan(0.3);
    expect(cost.breakdown.visualAssets.aiCount).toBe(2);
    expect(cost.breakdown.voice.provider).toBe("elevenlabs");
  });
});
