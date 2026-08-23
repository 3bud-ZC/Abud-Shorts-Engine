import { logger } from "../../../logger";
import type {
  ProductionSceneSpec,
  ProductionSpec,
  VisualMode,
} from "../../../types/productionSpec";
import type {
  VisualAssetResult,
  VisualProvider,
  VisualRenderOptions,
} from "./types";
import { PexelsVisualProvider } from "./pexelsVisualProvider";

export type ResolvedSceneAsset = {
  sceneIndex: number;
  provider: string;
  source: "stock" | "ai";
  url: string;
  durationSeconds: number;
  fallbackUsed: boolean;
  estimatedCost: number;
  metadata?: Record<string, unknown>;
};

export class AutoVisualRouter {
  constructor(
    private pexelsProvider: PexelsVisualProvider,
    private aiProviders: VisualProvider[] = [],
  ) {}

  public async resolveSceneVisual(
    scene: ProductionSceneSpec,
    spec: ProductionSpec,
    options: VisualRenderOptions,
  ): Promise<ResolvedSceneAsset> {
    const visualMode: VisualMode = spec.visualMode || "auto";
    const quality = spec.quality || "standard";

    const targetSource = this.determineSceneSource(scene, visualMode, quality);
    const preferredAiProvider = this.getAvailableAiProvider();

    if (targetSource === "ai" && preferredAiProvider) {
      try {
        logger.info(
          { sceneIndex: scene.sceneIndex, provider: preferredAiProvider.id },
          "Generating visual scene with AI video provider",
        );
        const result = await preferredAiProvider.fetchOrGenerateScene(scene, options);
        return {
          sceneIndex: scene.sceneIndex,
          provider: result.provider,
          source: "ai",
          url: result.url,
          durationSeconds: result.durationSeconds,
          fallbackUsed: false,
          estimatedCost: result.estimatedCost,
          metadata: result.metadata,
        };
      } catch (aiErr) {
        logger.warn(
          {
            sceneIndex: scene.sceneIndex,
            error: aiErr instanceof Error ? aiErr.message : String(aiErr),
          },
          "AI video generation failed; falling back to Pexels stock footage",
        );
        // Fallback gracefully to Pexels
        const stockResult = await this.pexelsProvider.fetchOrGenerateScene(scene, options);
        return {
          sceneIndex: scene.sceneIndex,
          provider: "pexels",
          source: "stock",
          url: stockResult.url,
          durationSeconds: stockResult.durationSeconds,
          fallbackUsed: true,
          estimatedCost: 0,
          metadata: {
            ...stockResult.metadata,
            fallbackReason: aiErr instanceof Error ? aiErr.message : "AI provider failed",
          },
        };
      }
    }

    // Standard stock footage path
    const stockResult = await this.pexelsProvider.fetchOrGenerateScene(scene, options);
    return {
      sceneIndex: scene.sceneIndex,
      provider: "pexels",
      source: "stock",
      url: stockResult.url,
      durationSeconds: stockResult.durationSeconds,
      fallbackUsed: false,
      estimatedCost: 0,
      metadata: stockResult.metadata,
    };
  }

  private determineSceneSource(
    scene: ProductionSceneSpec,
    visualMode: VisualMode,
    quality: string,
  ): "stock" | "ai" {
    if (visualMode === "stock") return "stock";
    if (visualMode === "ai") return "ai";
    if (visualMode === "hybrid") {
      return scene.visualSource === "ai" ? "ai" : "stock";
    }

    // In "auto" mode:
    // Only use AI video if High/Premium quality AND scene is a hook/hero shot, and AI provider is available
    if (
      (quality === "high" || quality === "premium") &&
      (scene.purpose === "hook" || scene.purpose === "solution") &&
      this.getAvailableAiProvider() !== null
    ) {
      return "ai";
    }

    return "stock";
  }

  private getAvailableAiProvider(): VisualProvider | null {
    for (const provider of this.aiProviders) {
      if (provider.isConfigured()) {
        return provider;
      }
    }
    return null;
  }
}
