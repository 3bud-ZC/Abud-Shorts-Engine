import { PexelsAPI } from "../../../short-creator/libraries/Pexels";
import { OrientationEnum } from "../../../types/shorts";
import type { ProductionSceneSpec } from "../../../types/productionSpec";
import { providerSecrets } from "../provider-vault/providerSecrets";
import type {
  SceneCostEstimate,
  VisualAssetResult,
  VisualProvider,
  VisualProviderValidationResult,
  VisualRenderOptions,
} from "./types";

export class PexelsVisualProvider implements VisualProvider {
  public readonly id = "pexels";
  public readonly displayName = "Pexels Stock Footage";
  public readonly category = "stock" as const;

  constructor(private pexelsApi: PexelsAPI, private apiKey?: string) {}

  private getApiKey(): string | undefined {
    return providerSecrets.peek("pexels", "api_key") || this.apiKey || process.env.PEXELS_API_KEY;
  }

  public isConfigured(): boolean {
    const key = this.getApiKey();
    return Boolean(key && key !== "dummy-key" && !key.includes("your_pexels"));
  }

  public getCapabilities() {
    return {
      textToImage: false,
      imageToImage: false,
      textToVideo: false,
      imageToVideo: false,
      referenceImage: false,
      multipleReferenceImages: false,
      seed: false,
      nativeCharacterIdentity: false,
    };
  }

  public async fetchOrGenerateScene(
    scene: ProductionSceneSpec,
    options: VisualRenderOptions,
  ): Promise<VisualAssetResult> {
    const searchTerms =
      scene.stockSearchTerms && scene.stockSearchTerms.length > 0
        ? scene.stockSearchTerms
        : ["modern lifestyle", "city"];
    const duration = options.targetDurationSeconds || scene.durationSeconds || 5;

    const video = await this.pexelsApi.findVideo(searchTerms, duration, {
      excludeIds: (options.excludeIds || []).map((id) => String(id)),
      orientation: options.orientation || OrientationEnum.portrait,
    });

    return {
      provider: "pexels",
      source: "stock",
      url: video.url,
      durationSeconds: duration,
      width: video.width,
      height: video.height,
      estimatedCost: 0,
      metadata: {
        pexelsVideoId: video.id,
        searchTermsUsed: searchTerms,
        ...(video.metadata || {}),
      },
    };
  }

  public estimateCost(): SceneCostEstimate {
    return {
      provider: "pexels",
      source: "stock",
      estimatedCost: 0,
      currency: "USD",
    };
  }

  public async validate(): Promise<VisualProviderValidationResult> {
    const configured = this.isConfigured();
    if (!configured) {
      return {
        provider: "Pexels",
        category: "Visuals",
        configured: false,
        healthy: false,
        status: "not_configured",
        message: "PEXELS_API_KEY is not configured.",
        checkedAt: new Date().toISOString(),
      };
    }
    return {
      provider: "Pexels",
      category: "Visuals",
      configured: true,
      healthy: true,
      status: "healthy",
      message: "Pexels API is configured and operational.",
      checkedAt: new Date().toISOString(),
    };
  }
}
