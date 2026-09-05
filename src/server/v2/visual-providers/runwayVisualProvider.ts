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

export class RunwayVisualProvider implements VisualProvider {
  public readonly id = "runway";
  public readonly displayName = "Runway";
  public readonly category = "ai_video" as const;
  public readonly providerClass = "GENERATED_VIDEO" as const;

  constructor(private apiKey?: string, private model = process.env.RUNWAY_MODEL_ID || "gen4_turbo") {}

  private getApiKey(): string | undefined {
    return providerSecrets.peek("runway", "api_key") || this.apiKey || process.env.RUNWAY_API_KEY;
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
      priority: 75,
      qualityTier: "premium" as const,
      latencyTier: "long" as const,
      textToImage: true,
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
      negativePrompt: false,
      cameraControl: true,
      maxConcurrency: 1,
      rateLimitState: "unknown" as const,
    };
  }

  public estimateCost(): SceneCostEstimate {
    return { provider: "runway", source: "ai", estimatedCost: null, currency: "USD", costStatus: "usage_based_unknown" };
  }

  public async fetchOrGenerateScene(scene: ProductionSceneSpec, options: VisualRenderOptions): Promise<VisualAssetResult> {
    if (!this.isConfigured()) throw new Error("Runway is not configured.");
    if (process.env.ABUD_ALLOW_PAID_VIDEO_CALLS !== "true") {
      throw new Error("Runway generation is configured but paid video calls are disabled for this milestone.");
    }
    const prompt = scene.visualPrompt || `Cinematic short-form video shot of ${scene.stockSearchTerms?.join(", ") || "the requested scene"}`;
    const job = await this.submit({
      scene,
      prompt,
      durationSeconds: options.targetDurationSeconds || scene.durationSeconds || 5,
      aspectRatio: options.orientation === "landscape" ? "16:9" : "9:16",
      paidCallAuthorized: true,
    });
    if (!job.outputUrl) throw new Error("Runway task submitted; poll task status before download.");
    return {
      provider: "runway",
      source: "ai",
      url: job.outputUrl,
      durationSeconds: options.targetDurationSeconds || scene.durationSeconds || 5,
      estimatedCost: null,
      metadata: { providerRequestId: job.providerRequestId, model: this.model },
    };
  }

  public async submit(request: ProviderGenerationRequest): Promise<ProviderGenerationJob> {
    if (!this.isConfigured()) throw new Error("Runway is not configured.");
    if (!request.paidCallAuthorized && process.env.ABUD_ALLOW_PAID_VIDEO_CALLS !== "true") {
      throw new Error("Paid Runway generation is disabled.");
    }
    const response = await axios.post(
      "https://api.dev.runwayml.com/v1/text_to_video",
      {
        model: request.modelId || this.model,
        promptText: request.prompt,
        ratio: request.aspectRatio || "9:16",
        duration: Math.min(10, Math.max(5, Math.round(request.durationSeconds || 5))),
        ...(request.seed != null ? { seed: request.seed } : {}),
      },
      {
        headers: {
          Authorization: `Bearer ${this.getApiKey()}`,
          "Content-Type": "application/json",
          "X-Runway-Version": "2024-11-06",
        },
        timeout: 30000,
      },
    );
    return this.normalizeResult(response.data, request);
  }

  public async poll(job: ProviderGenerationJob): Promise<ProviderGenerationJob> {
    const response = await axios.get(`https://api.dev.runwayml.com/v1/tasks/${job.providerRequestId}`, {
      headers: { Authorization: `Bearer ${this.getApiKey()}`, "X-Runway-Version": "2024-11-06" },
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
    await axios.delete(`https://api.dev.runwayml.com/v1/tasks/${job.providerRequestId}`, {
      headers: { Authorization: `Bearer ${this.getApiKey()}`, "X-Runway-Version": "2024-11-06" },
      timeout: 15000,
    }).catch(() => undefined);
    return { ...job, status: "CANCELLED" };
  }

  public async download(job: ProviderGenerationJob, destinationPath: string): Promise<VisualAssetResult> {
    return downloadGeneratedAsset(job, destinationPath);
  }

  public normalizeResult(payload: unknown, request: ProviderGenerationRequest): ProviderGenerationJob {
    const data = (payload || {}) as Record<string, any>;
    const outputUrl = extractFirstUrl(data.output || data.outputs || data.video || data);
    return {
      provider: "runway",
      providerRequestId: String(data.id || ""),
      status: outputUrl ? "COMPLETE" : normalizeAsyncStatus(data.status),
      submittedAt: new Date().toISOString(),
      pollAfterMs: 5000,
      outputUrl,
      errorMessage: data.failure || data.error,
      metadata: { model: request.modelId || this.model, durationSeconds: request.durationSeconds },
    };
  }

  public async validate(): Promise<VisualProviderValidationResult> {
    if (!this.isConfigured()) {
      return {
        provider: "Runway",
        category: "Visuals",
        configured: false,
        healthy: false,
        status: "not_configured",
        message: "RUNWAY_API_KEY is not configured.",
        checkedAt: new Date().toISOString(),
      };
    }
    return {
      provider: "Runway",
      category: "Visuals",
      configured: true,
      healthy: true,
      status: "healthy",
      message: "Runway API key is configured. Generation calls remain disabled unless paid calls are explicitly enabled.",
      checkedAt: new Date().toISOString(),
    };
  }
}
