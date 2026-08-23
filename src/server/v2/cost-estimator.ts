import type { CostEstimate, ProductionSpec } from "../../types/productionSpec";

export function estimateProductionCost(spec: Partial<ProductionSpec>): CostEstimate {
  const scenes = spec.scenes || [];
  let aiScenesCount = 0;
  let stockScenesCount = 0;
  let visualCost = 0;
  let visualProvider = "pexels";

  scenes.forEach((scene) => {
    if (scene.visualSource === "ai" || spec.visualMode === "ai") {
      aiScenesCount++;
      const p = scene.visualProvider || "veo";
      visualProvider = p;
      const costPerScene = p === "fal" ? 0.15 : 0.2;
      visualCost += costPerScene;
    } else {
      stockScenesCount++;
    }
  });

  const totalChars = scenes.reduce(
    (acc, s) => acc + (s.narration ? s.narration.length : 0),
    0,
  );

  let voiceCost = 0;
  const voiceProvider = spec.voiceProvider || "kokoro";
  let estimatedCostTier: "local_free" | "cloud_free_tier" | "premium" = "local_free";
  if (voiceProvider === "elevenlabs") {
    estimatedCostTier = "premium";
    voiceCost = Math.round(totalChars * 0.0003 * 100) / 100;
  } else if (voiceProvider === "google_cloud_tts") {
    estimatedCostTier = "cloud_free_tier";
  }

  const contentAICost = spec.metadata?.planner === "GeminiContentAIProvider" ? 0.001 : 0;
  const totalCost = Math.round((contentAICost + visualCost + voiceCost) * 100) / 100;
  const isFree = totalCost === 0;

  return {
    estimatedCost: totalCost,
    currency: "USD",
    isFree,
    breakdown: {
      contentAI: contentAICost,
      visualAssets: {
        stockCount: stockScenesCount,
        aiCount: aiScenesCount,
        cost: Math.round(visualCost * 100) / 100,
        provider: visualProvider,
      },
      voice: {
        provider: voiceProvider,
        charCount: totalChars,
        cost: Math.round(voiceCost * 100) / 100,
        estimatedCostTier,
      },
      rendering: 0,
    },
  };
}
