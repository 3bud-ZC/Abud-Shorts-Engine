import axios from "axios";
import type { ProductionSceneSpec } from "../../../types/productionSpec";
import { providerSecrets } from "../provider-vault/providerSecrets";
import {
  downloadGeneratedAsset,
  extractFirstUrl,
  normalizeAsyncStatus,
} from "./asyncProviderRuntime";
import type {
  ProviderGenerationJob,
  ProviderGenerationRequest,
  SceneCostEstimate,
  VisualAssetResult,
  VisualProvider,
  VisualProviderValidationResult,
  VisualRenderOptions,
} from "./types";

export type FalModel = "kling" | "wan" | "seedance" | "fast-svd";

export const FAL_VIDEO_MODELS: Record<FalModel, string> = {
  kling: "fal-ai/kling-video/v1/standard/text-to-video",
  wan: "fal-ai/wan-t2v",
  seedance: "fal-ai/bytedance/seedance/v1/pro/text-to-video",
  "fast-svd": "fal-ai/fast-svd/text-to-video",
};

export class FalVisualProvider implements VisualProvider {
  public readonly id = "fal";
  public readonly displayName = "fal.ai AI Video";
  public readonly category = "ai_video" as const;
  public readonly providerClass = "GENERATED_VIDEO" as const;

  constructor(private apiKey?: string, private defaultModel: FalModel = "kling") {}

  private getApiKey(): string | undefined {
    return this.apiKey || process.env.FAL_KEY || providerSecrets.peek("fal", "api_key");
  }

  public isConfigured(): boolean {
    const key = this.getApiKey();
    return Boolean(key && key.trim().length > 10 && !key.includes("your_"));
  }

  public getCapabilities() {
    return {
      providerClass: this.providerClass,
      freeOrPaid: "paid" as const,
      billingModel: "usage_based" as const,
      enabled: true,
      healthy: this.isConfigured(),
      liveVerified: false,
      priority: 70,
      qualityTier: "professional" as const,
      latencyTier: "long" as const,
      textToImage: false,
      imageToImage: false,
      textToVideo: true,
      imageToVideo: true,
      referenceImage: true,
      multipleReferenceImages: false,
      portrait: true,
      landscape: true,
      supportedDurations: [5, 10],
      supportedResolutions: ["720p", "1080p"],
      seed: false,
      audio: false,
      nativeCharacterIdentity: false,
      negativePrompt: true,
      cameraControl: false,
      maxConcurrency: 1,
      rateLimitState: "unknown" as const,
    };
  }

  public async fetchOrGenerateScene(
    scene: ProductionSceneSpec,
    options: VisualRenderOptions,
  ): Promise<VisualAssetResult> {
    if (!this.isConfigured()) {
      throw new Error("fal.ai Visual Provider is not configured. Missing FAL_KEY.");
    }
    if (process.env.ABUD_ALLOW_PAID_VIDEO_CALLS !== "true") {
      throw new Error("fal.ai generation is configured but paid video calls are disabled for this milestone.");
    }

    const prompt =
      scene.visualPrompt ||
      `Cinematic shot of ${scene.stockSearchTerms?.join(", ") || "product scene"}`;

    const job = await this.submit({
      scene,
      prompt,
      aspectRatio: options.orientation === "landscape" ? "16:9" : "9:16",
      durationSeconds: Math.min(scene.durationSeconds || 5, 10),
      paidCallAuthorized: true,
    });
    const videoUrl = job.outputUrl;

    if (!videoUrl) {
      throw new Error("fal.ai queued the request; poll response_url before download.");
    }

    return {
      provider: `fal:${this.defaultModel}`,
      source: "ai",
      url: videoUrl,
      durationSeconds: scene.durationSeconds || 5,
      estimatedCost: null,
      metadata: {
        model: this.defaultModel,
        promptUsed: prompt,
        requestId: job.providerRequestId,
      },
    };
  }

  public estimateCost(): SceneCostEstimate {
    return {
      provider: "fal",
      source: "ai",
      estimatedCost: null,
      currency: "USD",
      costStatus: "usage_based_unknown",
    };
  }

  public async submit(request: ProviderGenerationRequest): Promise<ProviderGenerationJob> {
    if (!this.isConfigured()) throw new Error("fal.ai Visual Provider is not configured.");
    if (!request.paidCallAuthorized && process.env.ABUD_ALLOW_PAID_VIDEO_CALLS !== "true") {
      throw new Error("Paid fal.ai video generation is disabled.");
    }
    const modelId = request.modelId || FAL_VIDEO_MODELS[this.defaultModel];
    const response = await axios.post(
      `https://queue.fal.run/${modelId}`,
      {
        prompt: request.prompt,
        aspect_ratio: request.aspectRatio || "9:16",
        duration: Math.min(request.durationSeconds || 5, 10),
        ...(request.imageUrl ? { image_url: request.imageUrl } : {}),
        ...(request.negativePrompt ? { negative_prompt: request.negativePrompt } : {}),
      },
      {
        headers: {
          Authorization: `Key ${this.getApiKey()}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      },
    );
    return this.normalizeResult(response.data, { ...request, modelId });
  }

  public async poll(job: ProviderGenerationJob): Promise<ProviderGenerationJob> {
    const statusResponse = job.statusUrl
      ? await axios.get(job.statusUrl, {
          headers: { Authorization: `Key ${this.getApiKey()}` },
          timeout: 30000,
        })
      : null;
    const status = normalizeAsyncStatus(statusResponse?.data?.status || statusResponse?.data?.state);
    if (status !== "COMPLETE" || !job.responseUrl) {
      return { ...job, status, pollAfterMs: 5000 };
    }
    const resultResponse = await axios.get(job.responseUrl, {
      headers: { Authorization: `Key ${this.getApiKey()}` },
      timeout: 30000,
    });
    return this.normalizeResult(resultResponse.data, {
      scene: {} as ProductionSceneSpec,
      prompt: String(job.metadata?.prompt || ""),
      durationSeconds: Number(job.metadata?.durationSeconds) || 0,
      modelId: String(job.metadata?.modelId || ""),
      paidCallAuthorized: true,
    });
  }

  public async cancel(job: ProviderGenerationJob): Promise<ProviderGenerationJob> {
    if (!job.cancelUrl) return { ...job, status: "CANCELLED" };
    await axios.put(job.cancelUrl, undefined, {
      headers: { Authorization: `Key ${this.getApiKey()}` },
      timeout: 15000,
    });
    return { ...job, status: "CANCELLED" };
  }

  public async download(job: ProviderGenerationJob, destinationPath: string): Promise<VisualAssetResult> {
    return downloadGeneratedAsset(job, destinationPath);
  }

  public normalizeResult(payload: unknown, request: ProviderGenerationRequest): ProviderGenerationJob {
    const data = (payload || {}) as Record<string, any>;
    const outputUrl = extractFirstUrl(data.video || data.output || data);
    return {
      provider: `fal:${this.defaultModel}`,
      providerRequestId: String(data.request_id || data.id || ""),
      status: outputUrl ? "COMPLETE" : normalizeAsyncStatus(data.status || "QUEUED"),
      submittedAt: new Date().toISOString(),
      pollAfterMs: 5000,
      statusUrl: data.status_url,
      responseUrl: data.response_url,
      cancelUrl: data.cancel_url,
      outputUrl,
      errorMessage: data.error ? String(data.error) : undefined,
      metadata: {
        modelId: request.modelId,
        durationSeconds: request.durationSeconds,
        aspectRatio: request.aspectRatio,
      },
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
