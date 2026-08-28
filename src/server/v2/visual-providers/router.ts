import { logger } from "../../../logger";
import type {
  ProductionSceneSpec,
  ProductionSpec,
  VisualMode,
} from "../../../types/productionSpec";
import { OrientationEnum } from "../../../types/shorts";
import {
  StockProviderRegistry,
  type ScoredCandidate,
} from "../stock-providers/stockProviderRegistry";
import type {
  VisualAssetResult,
  VisualProvider,
  VisualRenderOptions,
} from "./types";
import { PexelsVisualProvider } from "./pexelsVisualProvider";

export type ResolvedSceneAsset = {
  sceneIndex: number;
  provider: string;
  source: "stock" | "ai" | "uploaded" | "local_ai" | "motion";
  url: string;
  durationSeconds: number;
  fallbackUsed: boolean;
  estimatedCost: number | null;
  metadata?: Record<string, unknown>;
};

export class AutoVisualRouter {
  constructor(
    private pexelsProvider: PexelsVisualProvider,
    private aiProviders: VisualProvider[] = [],
    private stockRegistry: StockProviderRegistry = new StockProviderRegistry(),
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
        const stockResult = await this.resolveStockSceneVisual(scene, options);
        return {
          ...stockResult,
          fallbackUsed: true,
          metadata: {
            ...stockResult.metadata,
            fallbackReason: aiErr instanceof Error ? aiErr.message : "AI provider failed",
          },
        };
      }
    }

    return this.resolveStockSceneVisual(scene, options);
  }

  private async resolveStockSceneVisual(
    scene: ProductionSceneSpec,
    options: VisualRenderOptions,
  ): Promise<ResolvedSceneAsset> {
    const searchTerms =
      scene.stockSearchTerms && scene.stockSearchTerms.length > 0
        ? scene.stockSearchTerms
        : ["modern lifestyle", "city"];
    const duration = options.targetDurationSeconds || scene.durationSeconds || 5;
    const orientation =
      options.orientation === OrientationEnum.landscape ? "landscape" : "portrait";

    const candidates = await this.stockRegistry.searchQueries(
      searchTerms.slice(0, 6).map((query) => ({
        query,
        orientation,
        kind: "video",
        minDurationSeconds: Math.max(1, duration * 0.5),
        perPage: 30,
        excludeIds: (options.excludeIds || []).map((id) => String(id)),
      })),
    );

    const winner = this.pickBestCandidate(candidates);
    if (winner) {
      const attribution = this.stockRegistry.attributionFor(winner);
      return {
        sceneIndex: scene.sceneIndex,
        provider: winner.provider,
        source: "stock",
        url: winner.downloadUrl,
        durationSeconds: duration,
        fallbackUsed: false,
        estimatedCost: 0,
        metadata: {
          stockProvider: winner.provider,
          stockAssetId: winner.id,
          pexelsVideoId: winner.provider === "pexels" ? winner.id : undefined,
          pixabayVideoId: winner.provider === "pixabay" ? winner.id : undefined,
          providerAssetId: winner.id,
          contributor: winner.contributor,
          contributorUrl: winner.contributorUrl,
          attributionUrl: winner.sourcePageUrl,
          originalSourceUrl: winner.sourcePageUrl,
          searchTerm: (winner.tags || [])[0] || searchTerms[0],
          searchTermsUsed: searchTerms,
          candidateCount: candidates.length,
          selectedScore: winner.totalScore,
          semanticScore: winner.semanticScore,
          qualityScore: winner.qualityScore,
          attribution,
          width: winner.width,
          height: winner.height,
          sourceDurationSeconds: winner.durationSeconds,
          technicalValidation: {
            readable: true,
            minResolutionPassed: Math.min(winner.width, winner.height) >= 480,
            durationFit: (winner.durationSeconds || duration) >= duration * 0.5,
          },
        },
      };
    }

    if (this.pexelsProvider.isConfigured()) {
      const legacy = await this.pexelsProvider.fetchOrGenerateScene(scene, options);
      return {
        sceneIndex: scene.sceneIndex,
        provider: legacy.provider,
        source: "stock",
        url: legacy.url,
        durationSeconds: legacy.durationSeconds,
        fallbackUsed: false,
        estimatedCost: legacy.estimatedCost,
        metadata: {
          ...legacy.metadata,
          registryFallbackReason: "unified_stock_registry_returned_no_candidate",
        },
      };
    }

    throw new Error(
      "Professional automatic video needs at least one visual source. Configure a free stock provider, connect an AI video provider, or upload media.",
    );
  }

  private pickBestCandidate(candidates: ScoredCandidate[]): ScoredCandidate | null {
    const usable = candidates.filter((candidate) => {
      if (candidate.kind !== "video") return false;
      if (!candidate.downloadUrl || !candidate.width || !candidate.height) return false;
      if (Math.min(candidate.width, candidate.height) < 480) return false;
      return candidate.semanticScore >= 45 && candidate.qualityScore >= 45;
    });
    return usable[0] || candidates[0] || null;
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
