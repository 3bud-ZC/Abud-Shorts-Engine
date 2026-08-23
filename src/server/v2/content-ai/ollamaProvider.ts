import axios from "axios";
import { LocalContentAIProvider } from "./localProvider";
import type {
  ContentAIProvider,
  GenerateSpecParams,
  PromptRewriteResult,
  ProviderValidationResult,
  SpecReviewResult,
} from "./types";
import type { ProductionSpec } from "../../../types/productionSpec";
import { validateProductionSpec } from "../../../types/productionSpec";

function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Local LLM response did not include a JSON object.");
  return JSON.parse(text.slice(start, end + 1));
}

export class OllamaContentAIProvider implements ContentAIProvider {
  public readonly id = "ollama";
  public readonly displayName = "Ollama Local LLM Creative Director";
  public readonly category = "content_ai" as const;
  private fallback = new LocalContentAIProvider();

  constructor(
    private baseUrl = process.env.OLLAMA_BASE_URL || "",
    private model = process.env.OLLAMA_MODEL || "qwen2.5:3b-instruct",
  ) {}

  public get isConfigured(): boolean {
    return Boolean(this.baseUrl);
  }

  public async generateProductionSpec(params: GenerateSpecParams): Promise<ProductionSpec> {
    if (!this.isConfigured) return this.fallback.generateProductionSpec(params);
    const baseline = await this.fallback.generateProductionSpec(params);
    const system = [
      "You are ABUD Shorts Engine Creative Director.",
      "Return only valid JSON matching the provided ProductionSpec object shape.",
      "Preserve durationSeconds, language, dialect, aspectRatio, quality, productionMode, visualMode, voiceProvider, and voiceId exactly.",
      "Improve hook, spoken narration, CTA, scene intent, Pexels search terms, motion intent, and editing rhythm.",
      "For Egyptian Arabic, use conversational spoken Egyptian Arabic, not translated MSA.",
      "Do not include subjective quality scores.",
    ].join(" ");
    const response = await axios.post(
      `${this.baseUrl.replace(/\/$/, "")}/api/generate`,
      {
        model: this.model,
        stream: false,
        system,
        prompt: JSON.stringify({ params, baseline }),
        format: "json",
      },
      { timeout: Number(process.env.OLLAMA_TIMEOUT_MS || 45000) },
    );
    const raw = typeof response.data?.response === "string" ? response.data.response : JSON.stringify(response.data);
    const spec = validateProductionSpec({
      ...(extractJsonObject(raw) as Record<string, unknown>),
      durationSeconds: baseline.durationSeconds,
      language: baseline.language,
      dialect: baseline.dialect,
      aspectRatio: baseline.aspectRatio,
      quality: baseline.quality,
      productionMode: baseline.productionMode,
      visualMode: baseline.visualMode,
      voiceProvider: baseline.voiceProvider,
      voiceId: baseline.voiceId,
      metadata: {
        ...(baseline.metadata || {}),
        planner: "OllamaContentAIProvider",
        plannerModel: this.model,
        fallbackPlanner: "LocalContentAIProvider",
      },
    });
    return spec;
  }

  public async rewritePrompt(
    prompt: string,
    context?: { language?: any; dialect?: any; contentStyle?: any },
  ): Promise<PromptRewriteResult> {
    return this.fallback.rewritePrompt(prompt, context);
  }

  public async reviewSpec(spec: ProductionSpec): Promise<SpecReviewResult> {
    return this.fallback.reviewSpec(spec);
  }

  public async validate(): Promise<ProviderValidationResult> {
    const checkedAt = new Date().toISOString();
    if (!this.isConfigured) {
      return {
        provider: "Ollama Local LLM",
        configured: false,
        healthy: false,
        status: "not_configured",
        message: "OLLAMA_BASE_URL is not configured. Deterministic Local AI remains active.",
        checkedAt,
      };
    }
    const started = Date.now();
    try {
      await axios.get(`${this.baseUrl.replace(/\/$/, "")}/api/tags`, { timeout: 5000 });
      return {
        provider: "Ollama Local LLM",
        configured: true,
        healthy: true,
        status: "healthy",
        message: `Ollama endpoint is reachable. Requested model: ${this.model}.`,
        checkedAt,
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      return {
        provider: "Ollama Local LLM",
        configured: true,
        healthy: false,
        status: "provider_unavailable",
        message: error instanceof Error ? error.message : "Ollama validation failed.",
        checkedAt,
        latencyMs: Date.now() - started,
      };
    }
  }
}
