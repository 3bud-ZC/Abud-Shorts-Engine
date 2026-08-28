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

export class LumaVisualProvider implements VisualProvider {
  public readonly id = "luma";
  public readonly displayName = "Luma Agents API";
  public readonly category = "ai_video" as const;
  public readonly providerClass = "GENERATED_VIDEO" as const;

  constructor(private apiKey?: string, private model = process.env.LUMA_VIDEO_MODEL || "ray-3.2") {}

  private getApiKey(): string | undefined {
    return (
      providerSecrets.peek("luma", "api_key") ||
      this.apiKey ||
      process.env.LUMA_AGENTS_API_KEY ||
      process.env.LUMA_API_KEY
    );
  }

  public isConfigured(): boolean {
    const key = this.getApiKey();
    return Boolean(key && key.trim().length > 10 && !key.includes("your_"));
  }

  public getCapabilities() {
    return {
      providerClass: this.providerClass,
      freeOrPaid: "paid" as const,
      billingModel: "credits" as const,
      enabled: true,
      healthy: this.isConfigured(),
      liveVerified: false,
      priority: 60,
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
      supportedDurations: [5, 9],
      supportedResolutions: ["720p", "1080p"],
      seed: false,
      audio: false,
      nativeCharacterIdentity: false,
      negativePrompt: true,
      cameraControl: true,
      maxConcurrency: 1,
      rateLimitState: "unknown" as const,
    };
  }

  public estimateCost(): SceneCostEstimate {
    return { provider: "luma", source: "ai", estimatedCost: null, currency: "USD", costStatus: "usage_based_unknown" };
  }

  public async fetchOrGenerateScene(scene: ProductionSceneSpec, options: VisualRenderOptions): Promise<VisualAssetResult> {
    if (!this.isConfigured()) throw new Error("Luma is not configured.");
    if (process.env.ABUD_ALLOW_PAID_VIDEO_CALLS !== "true") {
      throw new Error("Luma generation is configured but paid video calls are disabled for this milestone.");
    }
    const job = await this.submit({
      scene,
      prompt: scene.visualPrompt || scene.narration,
      durationSeconds: options.targetDurationSeconds || scene.durationSeconds || 5,
      aspectRatio: options.orientation === "landscape" ? "16:9" : "9:16",
      paidCallAuthorized: true,
    });
    if (!job.outputUrl) throw new Error("Luma generation submitted; poll generation before download.");
    return {
      provider: "luma",
      source: "ai",
      url: job.outputUrl,
      durationSeconds: options.targetDurationSeconds || scene.durationSeconds || 5,
      estimatedCost: null,
      metadata: { providerRequestId: job.providerRequestId, model: this.model },
    };
  }

  public async submit(request: ProviderGenerationRequest): Promise<ProviderGenerationJob> {
    if (!this.isConfigured()) throw new Error("Luma is not configured.");
    if (!request.paidCallAuthorized && process.env.ABUD_ALLOW_PAID_VIDEO_CALLS !== "true") {
      throw new Error("Paid Luma generation is disabled.");
    }
    const response = await axios.post(
      "https://agents.lumalabs.ai/v1/generations",
      {
        prompt: request.prompt,
        model: request.modelId || this.model,
        aspect_ratio: request.aspectRatio || "9:16",
        ...(request.imageUrl ? { source: { type: "image", url: request.imageUrl } } : {}),
      },
      {
        headers: { Authorization: `Bearer ${this.getApiKey()}`, "Content-Type": "application/json" },
        timeout: 30000,
      },
    );
    return this.normalizeResult(response.data, request);
  }

  public async poll(job: ProviderGenerationJob): Promise<ProviderGenerationJob> {
    const response = await axios.get(`https://agents.lumalabs.ai/v1/generations/${job.providerRequestId}`, {
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
    await axios.delete(`https://agents.lumalabs.ai/v1/generations/${job.providerRequestId}`, {
      headers: { Authorization: `Bearer ${this.getApiKey()}` },
      timeout: 15000,
    }).catch(() => undefined);
    return { ...job, status: "CANCELLED" };
  }

  public async download(job: ProviderGenerationJob, destinationPath: string): Promise<VisualAssetResult> {
    return downloadGeneratedAsset(job, destinationPath);
  }

  public normalizeResult(payload: unknown, request: ProviderGenerationRequest): ProviderGenerationJob {
    const data = (payload || {}) as Record<string, any>;
    const outputUrl = extractFirstUrl(data.assets?.video || data.video || data.output || data.result);
    return {
      provider: "luma",
      providerRequestId: String(data.id || ""),
      status: outputUrl ? "COMPLETE" : normalizeAsyncStatus(data.state || data.status),
      submittedAt: new Date().toISOString(),
      pollAfterMs: 5000,
      outputUrl,
      errorMessage: data.failure_reason || data.error,
      metadata: { model: data.model || request.modelId || this.model, durationSeconds: request.durationSeconds },
    };
  }

  public async validate(): Promise<VisualProviderValidationResult> {
    if (!this.isConfigured()) {
      return {
        provider: "Luma Dream Machine",
        category: "Visuals",
        configured: false,
        healthy: false,
        status: "not_configured",
        message: "LUMA_AGENTS_API_KEY or LUMA_API_KEY is not configured.",
        checkedAt: new Date().toISOString(),
      };
    }
    return {
      provider: "Luma Agents API",
      category: "Visuals",
      configured: true,
      healthy: true,
      status: "healthy",
      message: "Luma API key is configured. Generation calls remain disabled unless paid calls are explicitly enabled.",
      checkedAt: new Date().toISOString(),
    };
  }
}
