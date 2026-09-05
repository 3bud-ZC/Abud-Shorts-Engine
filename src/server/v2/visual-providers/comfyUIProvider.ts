import axios from "axios";
import type { ProductionSceneSpec } from "../../../types/productionSpec";
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

function normalizeBaseUrl(value?: string): string {
  return (value || process.env.COMFYUI_BASE_URL || "").replace(/\/+$/, "");
}

export class ComfyUIProvider implements VisualProvider {
  public readonly id = "comfyui";
  public readonly displayName = "Local ComfyUI";
  public readonly category = "local_ai_video" as const;
  public readonly providerClass = "LOCAL_GENERATIVE_VIDEO" as const;

  constructor(
    private baseUrl = normalizeBaseUrl(),
    private workflowProfile = process.env.COMFYUI_VIDEO_WORKFLOW_PROFILE || "requires_model_installation",
  ) {}

  public isConfigured(): boolean {
    return Boolean(normalizeBaseUrl(this.baseUrl));
  }

  public getCapabilities() {
    return {
      providerClass: this.providerClass,
      freeOrPaid: "local" as const,
      billingModel: "local_compute" as const,
      enabled: true,
      healthy: this.isConfigured(),
      liveVerified: false,
      priority: 55,
      qualityTier: "professional" as const,
      latencyTier: "long" as const,
      textToImage: true,
      imageToImage: false,
      textToVideo: true,
      imageToVideo: true,
      referenceImage: true,
      multipleReferenceImages: false,
      portrait: true,
      landscape: true,
      supportedDurations: [4, 5],
      supportedResolutions: ["540p", "720p"],
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
    return { provider: "comfyui", source: "local_ai", estimatedCost: 0, currency: "USD", costStatus: "free" };
  }

  public async fetchOrGenerateScene(scene: ProductionSceneSpec, options: VisualRenderOptions): Promise<VisualAssetResult> {
    if (!this.isConfigured()) throw new Error("ComfyUI local sidecar is not configured.");
    const workflow = (scene as any).comfyWorkflow || (scene as any).workflow;
    if (!workflow) {
      throw new Error("ComfyUI requires an installed video workflow profile before local generation can run.");
    }
    const job = await this.submit({
      scene,
      prompt: scene.visualPrompt || scene.narration,
      durationSeconds: options.targetDurationSeconds || scene.durationSeconds || 5,
      aspectRatio: options.orientation === "landscape" ? "16:9" : "9:16",
    });
    if (!job.outputUrl) throw new Error("ComfyUI job submitted; poll history before download.");
    return {
      provider: "comfyui",
      source: "local_ai",
      url: job.outputUrl,
      durationSeconds: options.targetDurationSeconds || scene.durationSeconds || 5,
      estimatedCost: 0,
      metadata: { providerRequestId: job.providerRequestId, workflowProfile: this.workflowProfile },
    };
  }

  public async submit(request: ProviderGenerationRequest): Promise<ProviderGenerationJob> {
    const workflow = (request.scene as any).comfyWorkflow || (request.scene as any).workflow;
    if (!workflow) throw new Error("ComfyUI workflow is required.");
    const response = await axios.post(
      `${normalizeBaseUrl(this.baseUrl)}/prompt`,
      { prompt: workflow, client_id: request.idempotencyKey || "abud-shorts-engine" },
      { timeout: 30000 },
    );
    return {
      provider: "comfyui",
      providerRequestId: String(response.data?.prompt_id || ""),
      status: "QUEUED",
      submittedAt: new Date().toISOString(),
      pollAfterMs: 5000,
      statusUrl: `${normalizeBaseUrl(this.baseUrl)}/history/${response.data?.prompt_id}`,
      metadata: { workflowProfile: this.workflowProfile, durationSeconds: request.durationSeconds },
    };
  }

  public async poll(job: ProviderGenerationJob): Promise<ProviderGenerationJob> {
    const response = await axios.get(job.statusUrl || `${normalizeBaseUrl(this.baseUrl)}/history/${job.providerRequestId}`, {
      timeout: 30000,
    });
    const entry = response.data?.[job.providerRequestId] || response.data;
    const outputUrl = this.resolveComfyOutputUrl(entry);
    return {
      ...job,
      status: outputUrl ? "COMPLETE" : normalizeAsyncStatus(entry?.status?.status_str || "PROCESSING"),
      outputUrl,
      errorMessage: entry?.status?.messages?.find?.((item: any[]) => item?.[0] === "execution_error")?.[1]?.exception_message,
    };
  }

  public async cancel(job: ProviderGenerationJob): Promise<ProviderGenerationJob> {
    await axios.post(`${normalizeBaseUrl(this.baseUrl)}/interrupt`, undefined, { timeout: 15000 }).catch(() => undefined);
    return { ...job, status: "CANCELLED" };
  }

  public async download(job: ProviderGenerationJob, destinationPath: string): Promise<VisualAssetResult> {
    return downloadGeneratedAsset(job, destinationPath);
  }

  private resolveComfyOutputUrl(entry: any): string | undefined {
    const url = extractFirstUrl(entry?.outputs);
    if (/^https?:\/\//i.test(String(url || ""))) return url;
    const output = entry?.outputs && Object.values(entry.outputs)[0] as any;
    const item = output?.gifs?.[0] || output?.videos?.[0] || output?.images?.[0];
    if (!item?.filename) return undefined;
    const params = new URLSearchParams({
      filename: item.filename,
      subfolder: item.subfolder || "",
      type: item.type || "output",
    });
    return `${normalizeBaseUrl(this.baseUrl)}/view?${params.toString()}`;
  }

  public async validate(): Promise<VisualProviderValidationResult> {
    if (!this.isConfigured()) {
      return {
        provider: "Local ComfyUI",
        category: "Visuals",
        configured: false,
        healthy: false,
        status: "not_configured",
        message: "COMFYUI_BASE_URL is not configured. Local video generation is available after sidecar and model installation.",
        checkedAt: new Date().toISOString(),
      };
    }
    const startedAt = Date.now();
    try {
      await axios.get(`${normalizeBaseUrl(this.baseUrl)}/system_stats`, { timeout: 5000 });
      return {
        provider: "Local ComfyUI",
        category: "Visuals",
        configured: true,
        healthy: true,
        status: "healthy",
        message: "ComfyUI sidecar responded to system_stats. Video workflow/model installation still requires separate verification.",
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
      };
    } catch (error: any) {
      return {
        provider: "Local ComfyUI",
        category: "Visuals",
        configured: true,
        healthy: false,
        status: error?.code === "ECONNABORTED" ? "timeout" : "provider_unavailable",
        message: "ComfyUI sidecar did not respond.",
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
      };
    }
  }
}
