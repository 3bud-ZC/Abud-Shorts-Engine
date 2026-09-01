import { describe, expect, it } from "vitest";
import { normalizeProviderServiceState } from "./canonicalProviderState";
import {
  ProviderCircuitBreaker,
  allocateHeroShots,
  resolveProviderBudgetPolicy,
} from "./providerServicePolicy";
import type { ProductionSceneSpec } from "../../../types/productionSpec";

function scene(input: Partial<ProductionSceneSpec>): ProductionSceneSpec {
  return {
    sceneIndex: input.sceneIndex ?? 0,
    purpose: input.purpose || "hook",
    durationSeconds: input.durationSeconds || 5,
    narration: input.narration || "A cinematic reveal of the product transformation.",
    stockSearchTerms: input.stockSearchTerms || ["product transformation reveal"],
    visualSource: input.visualSource || "stock",
    transition: "cut",
    ...input,
  };
}

describe("Provider service state", () => {
  it("does not classify an optional unconfigured provider as broken", () => {
    const state = normalizeProviderServiceState({
      id: "runway",
      name: "Runway",
      category: "Generated Video",
      configured: false,
      billingClass: "USAGE_BASED",
      optional: true,
    });

    expect(state.customerStatus).toBe("Ready to Connect");
    expect(state.healthy).toBeNull();
  });

  it("separates configured credentials from live verified generation", () => {
    const state = normalizeProviderServiceState({
      id: "elevenlabs",
      name: "ElevenLabs",
      category: "Voice",
      configured: true,
      authenticated: true,
      healthy: true,
      liveVerified: false,
      billingClass: "USAGE_BASED",
      capabilities: ["Voice catalogue", "Text to speech"],
    });

    expect(state.customerStatus).toBe("Configured");
    expect(state.liveVerified).toBe(false);
  });
});

describe("Provider budget and hero-shot policy", () => {
  it("keeps paid generation disabled in Free Only mode", () => {
    const policy = resolveProviderBudgetPolicy({
      budgetMode: "free_only",
      paidCallsAllowed: true,
      maxExternalSpendUsd: 5,
    });

    expect(policy.paidCallsAllowed).toBe(false);
    expect(policy.maxExternalSpendUsd).toBe(0);
  });

  it("allocates only the highest value hero shot under a smart budget ceiling", () => {
    const policy = resolveProviderBudgetPolicy({
      budgetMode: "smart_budget",
      paidCallsAllowed: true,
      maxExternalSpendUsd: 1,
    });
    const allocation = allocateHeroShots({
      scenes: [
        scene({ sceneIndex: 0, purpose: "hook", visualPrompt: "impossible cinematic product transformation reveal" }),
        scene({ sceneIndex: 1, purpose: "benefit", narration: "People working in a modern office.", stockSearchTerms: ["people working office"] }),
        scene({ sceneIndex: 2, purpose: "cta", narration: "Book today.", stockSearchTerms: ["city business"] }),
      ],
    }, policy);

    expect(allocation.filter((item) => item.source === "generated")).toHaveLength(1);
    expect(allocation[0]).toMatchObject({ source: "generated", budgetAccepted: true });
    expect(allocation[1].source).toBe("stock");
  });

  it("opens the circuit breaker after repeated runtime failures", () => {
    const breaker = new ProviderCircuitBreaker(2, 10_000);
    breaker.recordFailure("veo", 1000);
    expect(breaker.isOpen("veo", 1000)).toBe(false);
    breaker.recordFailure("veo", 1001);
    expect(breaker.isOpen("veo", 1002)).toBe(true);
    breaker.recordSuccess("veo");
    expect(breaker.isOpen("veo", 1003)).toBe(false);
  });
});
