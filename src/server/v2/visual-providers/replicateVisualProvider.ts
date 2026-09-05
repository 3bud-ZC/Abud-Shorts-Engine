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

export class ReplicateVisualProvider implements VisualProvider {
  public readonly id = "replicate";
  public readonly displayName = "Replicate";
  public readonly category = "ai_video" as const;
  public readonly providerClass = "GENERATED_VIDEO" as const;

  constructor(
    private apiKey?: string,
    private model = process.env.REPLICATE_VIDEO_MODEL || "bytedance/seedance-1-pro",
  ) {}

  private getApiKey(): string | undefined {
    return providerSecrets.peek("replicate", "api_key") || this.apiKey || process.env.REPLICATE_API_TOKEN;
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
      priority: 65,
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
      seed: true,
      audio: false,
      nativeCharacterIdentity: false,
      negativePrompt: true,
      cameraControl: false,
      maxConcurrency: 1,
      rateLimitState: "unknown" as const,
    };
  }

  public estimateCost(): SceneCostEstimate {
    return { provider: "replicate", source: "ai", estimatedCost: null, currency: "USD", costStatus: "usage_based_unknown" };
  }

  public async fetchOrGenerateScene(scene: ProductionSceneSpec, options: VisualRenderOptions): Promise<VisualAssetResult> {
    if (!this.isConfigured()) throw new Error("Replicate is not configured.");
    if (process.env.ABUD_ALLOW_PAID_VIDEO_CALLS !== "true") {
      throw new Error("Replicate generation is configured but paid video calls are disabled for this milestone.");
    }
    const prompt = scene.visualPrompt || `Cinematic short-form video shot of ${scene.stockSearchTerms?.join(", ") || "the requested scene"}`;
    const job = await this.submit({
      scene,
      prompt,
      durationSeconds: options.targetDurationSeconds || scene.durationSeconds || 5,
      aspectRatio: options.orientation === "landscape" ? "16:9" : "9:16",
      paidCallAuthorized: true,
    });
    if (!job.outputUrl) throw new Error("Replicate prediction submitted; poll prediction before download.");
    return {
      provider: "replicate",
      source: "ai",
      url: job.outputUrl,
      durationSeconds: options.targetDurationSeconds || scene.durationSeconds || 5,
      estimatedCost: null,
      metadata: { providerRequestId: job.providerRequestId, model: this.model },
    };
  }

  public async submit(request: ProviderGenerationRequest): Promise<ProviderGenerationJob> {
    if (!this.isConfigured()) throw new Error("Replicate is not configured.");
    if (!request.paidCallAuthorized && process.env.ABUD_ALLOW_PAID_VIDEO_CALLS !== "true") {
      throw new Error("Paid Replicate generation is disabled.");
    }
    const [owner, name] = (request.modelId || this.model).split("/");
    const endpoint = owner && name
      ? `https://api.replicate.com/v1/models/${owner}/${name}/predictions`
      : "https://api.replicate.com/v1/predictions";
    const response = await axios.post(
      endpoint,
      {
        input: {
          prompt: request.prompt,
          aspect_ratio: request.aspectRatio || "9:16",
          duration: Math.min(10, Math.max(5, Math.round(request.durationSeconds || 5))),
          ...(request.imageUrl ? { image: request.imageUrl } : {}),
          ...(request.negativePrompt ? { negative_prompt: request.negativePrompt } : {}),
          ...(request.seed != null ? { seed: request.seed } : {}),
        },
      },
      {
        headers: {
          Authorization: `Bearer ${this.getApiKey()}`,
          "Content-Type": "application/json",
          Prefer: "wait=1",
          "Cancel-After": "10m",
        },
        timeout: 30000,
      },
    );
    return this.normalizeResult(response.data, request);
  }

  public async poll(job: ProviderGenerationJob): Promise<ProviderGenerationJob> {
    const response = await axios.get(job.statusUrl || `https://api.replicate.com/v1/predictions/${job.providerRequestId}`, {
      headers: { Authorization: `Bearer ${this.getApiKey()}` },
      timeout: 30000,
    });
    return this.normalizeResult(response.data, {
      scene: {} as ProductionSceneSpec,
      prompt: "",
      durationSeconds: Number(job.metadata?.durationSeconds) || 0,
      paidCallAuthorized: true,
    });
  }

  public async cancel(job: ProviderGenerationJob): Promise<ProviderGenerationJob> {
    const url = job.cancelUrl || `https://api.replicate.com/v1/predictions/${job.providerRequestId}/cancel`;
    await axios.post(url, undefined, {
      headers: { Authorization: `Bearer ${this.getApiKey()}` },
      timeout: 15000,
    }).catch(() => undefined);
    return { ...job, status: "CANCELLED" };
  }

  public async download(job: ProviderGenerationJob, destinationPath: string): Promise<VisualAssetResult> {
    return downloadGeneratedAsset(job, destinationPath, { Authorization: `Bearer ${this.getApiKey()}` });
  }

  public normalizeResult(payload: unknown, request: ProviderGenerationRequest): ProviderGenerationJob {
    const data = (payload || {}) as Record<string, any>;
    const outputUrl = extractFirstUrl(data.output);
    return {
      provider: "replicate",
      providerRequestId: String(data.id || ""),
      status: outputUrl ? "COMPLETE" : normalizeAsyncStatus(data.status),
      submittedAt: new Date().toISOString(),
      pollAfterMs: 5000,
      statusUrl: data.urls?.get,
      cancelUrl: data.urls?.cancel,
      outputUrl,
      errorMessage: data.error ? String(data.error) : undefined,
      metadata: {
        model: data.model || request.modelId || this.model,
        version: data.version,
        durationSeconds: request.durationSeconds,
        metrics: data.metrics,
      },
    };
  }

  public async validate(): Promise<VisualProviderValidationResult> {
    if (!this.isConfigured()) {
      return {
        provider: "Replicate",
        category: "Visuals",
        configured: false,
        healthy: false,
        status: "not_configured",
        message: "REPLICATE_API_TOKEN is not configured.",
        checkedAt: new Date().toISOString(),
      };
    }
    return {
      provider: "Replicate",
      category: "Visuals",
      configured: true,
      healthy: true,
      status: "healthy",
      message: "Replicate API token is configured. Generation calls remain disabled unless paid calls are explicitly enabled.",
      checkedAt: new Date().toISOString(),
    };
  }
}
