import axios from "axios";
import type { ProductionSceneSpec } from "../../../types/productionSpec";
import type {
  SceneCostEstimate,
  VisualAssetResult,
  VisualProvider,
  VisualProviderValidationResult,
  VisualRenderOptions,
} from "./types";

export class VeoVisualProvider implements VisualProvider {
  public readonly id = "veo";
  public readonly displayName = "Google Veo AI Video";
  public readonly category = "ai_video" as const;

  constructor(private apiKey?: string) {}

  public isConfigured(): boolean {
    const key = this.apiKey || process.env.VEO_API_KEY || process.env.GOOGLE_AI_API_KEY;
    return Boolean(key && key.trim().length > 10 && !key.includes("your_"));
  }

  public async fetchOrGenerateScene(
    scene: ProductionSceneSpec,
    options: VisualRenderOptions,
  ): Promise<VisualAssetResult> {
    if (!this.isConfigured()) {
      throw new Error("Veo Visual Provider is not configured. Missing API credentials.");
    }

    const prompt =
      scene.visualPrompt ||
      `Cinematic shot of ${scene.stockSearchTerms?.join(", ") || "product advertisement"}`;

    const key = this.apiKey || process.env.VEO_API_KEY || process.env.GOOGLE_AI_API_KEY;
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/veo-2.0-generate-video:predictLongRunning?key=${key}`,
      {
        prompt: {
          text: prompt,
        },
        videoConfig: {
          aspectRatio: options.orientation === "landscape" ? "16:9" : "9:16",
          durationSeconds: scene.durationSeconds || 5,
        },
      },
      { timeout: 30000 },
    );

    const videoUrl = response.data?.videoUrl || response.data?.name;
    if (!videoUrl) {
      throw new Error("Veo API did not return a valid video asset.");
    }

    return {
      provider: "veo",
      source: "ai",
      url: videoUrl,
      durationSeconds: scene.durationSeconds || 5,
      estimatedCost: 0.2,
      metadata: {
        promptUsed: prompt,
        operationName: response.data?.name,
      },
    };
  }

  public estimateCost(): SceneCostEstimate {
    return {
      provider: "veo",
      source: "ai",
      estimatedCost: 0.2,
      currency: "USD",
    };
  }

  public async validate(): Promise<VisualProviderValidationResult> {
    if (!this.isConfigured()) {
      return {
        provider: "Google Veo",
        category: "Visuals",
        configured: false,
        healthy: false,
        status: "not_configured",
        message: "VEO_API_KEY or GOOGLE_AI_API_KEY is not configured.",
        checkedAt: new Date().toISOString(),
      };
    }
    return {
      provider: "Google Veo",
      category: "Visuals",
      configured: true,
      healthy: true,
      status: "healthy",
      message: "Google Veo AI video generation is configured.",
      checkedAt: new Date().toISOString(),
    };
  }
}
