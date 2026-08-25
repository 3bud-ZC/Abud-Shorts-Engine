import type { CostEstimate, ProductionSpec } from "../../types/productionSpec";
import type { VoiceProviderId } from "./voice-providers/types";

export type ResolvedRouteCostContext = {
  voiceProvider?: VoiceProviderId | "auto";
  visualMode?: string;
  contentAIProvider?: string;
};

export function estimateProductionCost(spec: Partial<ProductionSpec>, routeContext: ResolvedRouteCostContext = {}): CostEstimate {
  const scenes = spec.scenes || [];
  let aiScenesCount = 0;
  let stockScenesCount = 0;
  let visualCost = 0;
  let visualProvider = "pexels";

  scenes.forEach((scene) => {
    if (scene.visualSource === "ai" || scene.visualSource === "ai_generated_video" || routeContext.visualMode === "ai" || spec.visualMode === "ai") {
      aiScenesCount++;
      const p = scene.visualProvider || "veo";
      visualProvider = p;
      const costPerScene = p === "motion_canvas" || p === "local" ? 0 : p === "fal" ? 0.15 : 0.2;
      visualCost += costPerScene;
    } else {
      stockScenesCount++;
    }
  });

  const totalChars = scenes.reduce(
    (acc, s) => acc + (s.narration ? s.narration.length : 0),
    0,
  );

  const voiceCost = 0;
  const voiceProvider = routeContext.voiceProvider && routeContext.voiceProvider !== "auto"
    ? routeContext.voiceProvider
    : spec.voiceProvider || "auto";
  let estimatedCostTier: "local_free" | "experimental_free_online" | "cloud_free_tier" | "premium" = "local_free";
  // ElevenLabs bills against a subscription character allowance, so no reliable
  // per-job dollar figure exists. We report usage-based instead of inventing one,
  // and never present an ElevenLabs job as a $0 external cost.
  let voiceUsageBased = false;
  let voiceCostLabel = "Local / Free";
  if (voiceProvider === "elevenlabs") {
    estimatedCostTier = "premium";
    voiceUsageBased = true;
    voiceCostLabel = "ElevenLabs · Cloud / Usage Based";
  } else if (voiceProvider === "google_cloud_tts") {
    estimatedCostTier = "cloud_free_tier";
    voiceUsageBased = true;
    voiceCostLabel = "Google Cloud TTS · Cloud / Usage Based";
  } else if (voiceProvider === "edge_tts") {
    estimatedCostTier = "experimental_free_online";
    voiceCostLabel = "Edge TTS · Experimental Free Online";
  }

  const contentAICost = routeContext.contentAIProvider === "gemini" || spec.metadata?.planner === "GeminiContentAIProvider" ? 0.001 : 0;
  const totalCost = Math.round((contentAICost + visualCost + voiceCost) * 100) / 100;
  // A usage-based provider is never free, even though its exact cost is unknown.
  const isFree = totalCost === 0 && !voiceUsageBased;

  return {
    estimatedCost: totalCost,
    currency: "USD",
    isFree,
    usageBased: voiceUsageBased,
    costLabel: voiceUsageBased
      ? voiceCostLabel
      : totalCost === 0
        ? "Free local pipeline"
        : `$${totalCost} USD`,
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
        cost: voiceCost,
        estimatedCostTier,
        usageBased: voiceUsageBased,
        costLabel: voiceCostLabel,
      },
      rendering: 0,
    },
  };
}
