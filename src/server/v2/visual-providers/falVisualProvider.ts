import axios from "axios";
import type { ProductionSceneSpec } from "../../../types/productionSpec";
import type {
  SceneCostEstimate,
  VisualAssetResult,
  VisualProvider,
  VisualProviderValidationResult,
  VisualRenderOptions,
} from "./types";

export type FalModel = "kling" | "wan" | "seedance" | "fast-svd";

export class FalVisualProvider implements VisualProvider {
  public readonly id = "fal";
  public readonly displayName = "fal.ai AI Video";
  public readonly category = "ai_video" as const;

  constructor(private apiKey?: string, private defaultModel: FalModel = "kling") {}

  public isConfigured(): boolean {
    const key = this.apiKey || process.env.FAL_KEY;
    return Boolean(key && key.trim().length > 10 && !key.includes("your_"));
  }

  public getCapabilities() {
    return {
      textToImage: false,
      imageToImage: false,
      textToVideo: true,
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
    if (!this.isConfigured()) {
      throw new Error("fal.ai Visual Provider is not configured. Missing FAL_KEY.");
    }

    const key = this.apiKey || process.env.FAL_KEY;
    const prompt =
      scene.visualPrompt ||
      `Cinematic shot of ${scene.stockSearchTerms?.join(", ") || "product scene"}`;

    const endpoint =
      this.defaultModel === "kling"
        ? "https://queue.fal.run/fal-ai/kling-video/v1/standard/text-to-video"
        : this.defaultModel === "wan"
          ? "https://queue.fal.run/fal-ai/wan-t2v"
          : "https://queue.fal.run/fal-ai/fast-svd/text-to-video";

    const response = await axios.post(
      endpoint,
      {
        prompt,
        aspect_ratio: options.orientation === "landscape" ? "16:9" : "9:16",
        duration: Math.min(scene.durationSeconds || 5, 10),
      },
      {
        headers: {
          Authorization: `Key ${key}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      },
    );

    const videoUrl =
      response.data?.video?.url ||
      response.data?.output?.video?.url ||
      response.data?.video_url;

    if (!videoUrl) {
      throw new Error("fal.ai did not return a valid video output URL.");
    }

    return {
      provider: `fal:${this.defaultModel}`,
      source: "ai",
      url: videoUrl,
      durationSeconds: scene.durationSeconds || 5,
      estimatedCost: 0.15,
      metadata: {
        model: this.defaultModel,
        promptUsed: prompt,
        requestId: response.data?.request_id,
      },
    };
  }

  public estimateCost(): SceneCostEstimate {
    return {
      provider: "fal",
      source: "ai",
      estimatedCost: 0.15,
      currency: "USD",
    };
  }

  public async validate(): Promise<VisualProviderValidationResult> {
    if (!this.isConfigured()) {
      return {
        provider: "fal.ai",
        category: "Visuals",
        configured: false,
        healthy: false,
        status: "not_configured",
        message: "FAL_KEY is not configured.",
        checkedAt: new Date().toISOString(),
      };
    }
    return {
      provider: "fal.ai",
      category: "Visuals",
      configured: true,
      healthy: true,
      status: "healthy",
      message: "fal.ai AI Video models (Kling, Wan, Seedance) are configured.",
      checkedAt: new Date().toISOString(),
    };
  }
}
