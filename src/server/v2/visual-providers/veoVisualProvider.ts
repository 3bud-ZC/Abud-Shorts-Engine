import axios from "axios";
import type { ProductionSceneSpec } from "../../../types/productionSpec";
import { providerSecrets } from "../provider-vault/providerSecrets";
import {
  extractFirstUrl,
  normalizeAsyncStatus,
  downloadGeneratedAsset,
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

export class VeoVisualProvider implements VisualProvider {
  public readonly id = "veo";
  public readonly displayName = "Google Veo AI Video";
  public readonly category = "ai_video" as const;
  public readonly providerClass = "GENERATED_VIDEO" as const;

  constructor(private apiKey?: string, private model = process.env.VEO_MODEL_ID || "veo-3.1-generate-preview") {}

  private getApiKey(): string | undefined {
    return providerSecrets.peek("veo", "api_key") || providerSecrets.peek("gemini", "api_key") || this.apiKey || process.env.VEO_API_KEY || process.env.GOOGLE_AI_API_KEY;
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
      priority: 80,
      qualityTier: "premium" as const,
      latencyTier: "long" as const,
      textToImage: false,
      imageToImage: false,
      textToVideo: true,
      imageToVideo: true,
      referenceImage: false,
      multipleReferenceImages: false,
      portrait: true,
      landscape: true,
      supportedDurations: [4, 6, 8],
      supportedResolutions: ["720p", "1080p"],
      seed: false,
      audio: true,
      nativeCharacterIdentity: false,
      negativePrompt: true,
      cameraControl: true,
      maxConcurrency: 1,
      rateLimitState: "unknown" as const,
    };
  }

  public async fetchOrGenerateScene(
    scene: ProductionSceneSpec,
    options: VisualRenderOptions,
  ): Promise<VisualAssetResult> {
    if (!this.isConfigured()) {
      throw new Error("Veo Visual Provider is not configured. Missing API credentials.");
    }
    if (process.env.ABUD_ALLOW_PAID_VIDEO_CALLS !== "true") {
      throw new Error("Veo generation is configured but paid video calls are disabled for this milestone.");
    }

    const prompt =
      scene.visualPrompt ||
      `Cinematic shot of ${scene.stockSearchTerms?.join(", ") || "product advertisement"}`;

    const job = await this.submit({
      scene,
      prompt,
      durationSeconds: scene.durationSeconds || 5,
      aspectRatio: options.orientation === "landscape" ? "16:9" : "9:16",
      paidCallAuthorized: true,
    });

    const videoUrl = job.outputUrl;
    if (!videoUrl) {
      throw new Error("Veo API submitted a long-running operation; final polling is required before download.");
    }

    return {
      provider: "veo",
      source: "ai",
      url: videoUrl,
      durationSeconds: scene.durationSeconds || 5,
      estimatedCost: null,
      metadata: {
        promptUsed: prompt,
        operationName: job.providerRequestId,
        model: this.model,
      },
    };
  }

  public estimateCost(): SceneCostEstimate {
    return {
      provider: "veo",
      source: "ai",
      estimatedCost: null,
      currency: "USD",
      costStatus: "usage_based_unknown",
    };
  }

  public async submit(request: ProviderGenerationRequest): Promise<ProviderGenerationJob> {
    if (!this.isConfigured()) throw new Error("Veo Visual Provider is not configured.");
    if (!request.paidCallAuthorized && process.env.ABUD_ALLOW_PAID_VIDEO_CALLS !== "true") {
      throw new Error("Paid Veo video generation is disabled.");
    }
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:predictLongRunning`,
      {
        prompt: { text: request.prompt },
        videoConfig: {
          aspectRatio: request.aspectRatio || "9:16",
          durationSeconds: Math.min(8, Math.max(4, Math.round(request.durationSeconds || 5))),
          ...(request.negativePrompt ? { negativePrompt: request.negativePrompt } : {}),
        },
        ...(request.imageUrl ? { image: { uri: request.imageUrl } } : {}),
      },
      {
        headers: {
          "x-goog-api-key": this.getApiKey() as string,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      },
    );
    return this.normalizeResult(response.data, request);
  }

  public async poll(job: ProviderGenerationJob): Promise<ProviderGenerationJob> {
    const response = await axios.get(
      job.statusUrl || `https://generativelanguage.googleapis.com/v1beta/${job.providerRequestId}`,
      { headers: { "x-goog-api-key": this.getApiKey() as string }, timeout: 30000 },
    );
    return this.normalizeResult(response.data, {
      scene: {} as ProductionSceneSpec,
      prompt: String(job.metadata?.prompt || ""),
      durationSeconds: Number(job.metadata?.durationSeconds) || 0,
      paidCallAuthorized: true,
    });
  }

  public async download(job: ProviderGenerationJob, destinationPath: string): Promise<VisualAssetResult> {
    return downloadGeneratedAsset(job, destinationPath);
  }

  public normalizeResult(payload: unknown, request: ProviderGenerationRequest): ProviderGenerationJob {
    const data = (payload || {}) as Record<string, any>;
    const done = data.done === true;
    const error = data.error?.message || data.error;
    const outputUrl = extractFirstUrl(data.response?.generatedVideos || data.response?.videos || data.video || data.output);
    return {
      provider: "veo",
      providerRequestId: String(data.name || data.operation?.name || data.id || ""),
      status: error ? "FAILED" : done && outputUrl ? "COMPLETE" : done ? "FAILED" : normalizeAsyncStatus(data.status || "QUEUED"),
      submittedAt: new Date().toISOString(),
      pollAfterMs: 10000,
      statusUrl: data.name ? `https://generativelanguage.googleapis.com/v1beta/${data.name}` : undefined,
      outputUrl,
      errorMessage: typeof error === "string" ? error : undefined,
      metadata: {
        model: this.model,
        durationSeconds: request.durationSeconds,
        aspectRatio: request.aspectRatio,
      },
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
