import axios from "axios";
import cuid from "cuid";
import {
  type ArabicDialect,
  type ProductionSceneSpec,
  type ProductionSpec,
  validateContentQuality,
  validateProductionSpec,
} from "../../../types/productionSpec";
import type {
  ContentAIProvider,
  GenerateSpecParams,
  PromptRewriteResult,
  ProviderValidationResult,
  SpecReviewResult,
} from "./types";
import { LocalContentAIProvider } from "./localProvider";

export class GeminiContentAIProvider implements ContentAIProvider {
  public readonly id = "gemini";
  public readonly displayName = "Google Gemini Creative Director";
  public readonly category = "content_ai" as const;

  private fallbackProvider = new LocalContentAIProvider();

  constructor(private apiKey?: string, private model: string = "gemini-2.0-flash") {}

  public get isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 5);
  }

  public async generateProductionSpec(
    params: GenerateSpecParams,
  ): Promise<ProductionSpec> {
    if (!this.isConfigured) {
      return this.fallbackProvider.generateProductionSpec(params);
    }

    try {
      const systemInstruction = `You are the AI Creative Director for ABUD Shorts Engine V2.
Your role is to convert a user's natural language video prompt into a structured JSON Video Production Spec.
RULES:
1. Strict JSON output adhering to the requested schema.
2. If the user requests Arabic (Egyptian, MSA, Saudi, etc.), preserve the requested dialect naturally in the narration rather than literal machine translation.
3. Every scene MUST have: purpose ('hook'|'problem'|'solution'|'benefit'|'proof'|'cta'), durationSeconds (number), narration (punchy and short), onScreenText (short), stockSearchTerms (array of 2-4 English keywords for Pexels search), visualPrompt (cinematic description for AI video).
4. Scene 0 MUST be a strong hook. The last scene MUST be a clear call to action (CTA).
5. Do NOT include Markdown formatting or backticks, only pure JSON matching the ProductionSpec structure.`;

      const explicitDuration =
        params.requestedDurationSeconds ??
        params.durationSeconds ??
        params.duration;
      const promptDuration = params.prompt ? (params.prompt.match(/(\d+)\s*(?:ثانية|ثواني|ثوان|seconds|second|secs|sec|s\b)/i) ? parseInt(params.prompt.match(/(\d+)\s*(?:ثانية|ثواني|ثوان|seconds|second|secs|sec|s\b)/i)![1], 10) : null) : null;
      const targetDurationSeconds = explicitDuration || promptDuration || 30;

      const promptPayload = {
        prompt: params.prompt,
        requestedLanguage: params.language || "auto",
        requestedDialect: params.dialect || "none",
        durationSeconds: targetDurationSeconds,
        contentStyle: params.contentStyle || "advertisement",
        aspectRatio: params.aspectRatio || "9:16",
        quality: params.quality || "standard",
        brandName: params.brandName || params.brandKit?.brandName,
      };

      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
        {
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `${systemInstruction}\n\nUser Request: ${JSON.stringify(
                    promptPayload,
                  )}`,
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.7,
          },
        },
        { timeout: 15000 },
      );

      const candidateText =
        response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!candidateText) {
        throw new Error("Empty response from Gemini API.");
      }

      const parsedJson = JSON.parse(candidateText);
      const rawSpec: ProductionSpec = {
        id: cuid(),
        creationMode: "prompt",
        title: parsedJson.title || "AI Production",
        userPrompt: params.prompt,
        language: parsedJson.language || (params.language === "ar" ? "ar" : "en"),
        dialect: parsedJson.dialect || params.dialect || "none",
        tone: parsedJson.tone || "energetic and modern",
        contentStyle: params.contentStyle || parsedJson.contentStyle || "advertisement",
        durationSeconds: targetDurationSeconds,
        aspectRatio: params.aspectRatio || parsedJson.aspectRatio || "9:16",
        resolution: params.resolution || "1080p",
        quality: params.quality || "standard",
        sceneCount: parsedJson.scenes?.length || 4,
        productionMode: params.productionMode || parsedJson.productionMode || "auto_hybrid",
        visualMode: params.visualMode || "auto",
        voiceProvider: params.voiceProvider || "kokoro",
        voiceId: params.voiceId || "af_heart",
        captionStyle: params.brandKit?.captionStyle || "bold",
        brandId: params.brandId,
        cta: parsedJson.cta || {
          text: "Message us on WhatsApp",
          action: "WhatsApp",
        },
        contact: "WhatsApp",
        scenes: (parsedJson.scenes || []).map((s: any, idx: number) => ({
          sceneIndex: idx,
          purpose: s.purpose || (idx === 0 ? "hook" : "solution"),
          durationSeconds: Number(s.durationSeconds) || 6,
          narration: String(s.narration || "").trim(),
          onScreenText: s.onScreenText ? String(s.onScreenText).trim() : undefined,
          stockSearchTerms: Array.isArray(s.stockSearchTerms) && s.stockSearchTerms.length > 0
            ? s.stockSearchTerms
            : ["business", "video"],
          visualPrompt: s.visualPrompt ? String(s.visualPrompt) : undefined,
          visualSource: s.visualSource === "ai" ? "ai" : "stock",
          visualProvider: s.visualSource === "ai" ? "veo" : "pexels",
          transition: s.transition || (idx === 0 ? "cut" : "fade"),
        })),
        brandKit: params.brandKit,
        metadata: {
          planner: "GeminiContentAIProvider",
          model: this.model,
        },
      };

      const validated = validateProductionSpec(rawSpec);
      const quality = validateContentQuality(validated);
      return quality.correctedSpec || validated;
    } catch {
      // Fallback cleanly to local deterministic planner
      return this.fallbackProvider.generateProductionSpec(params);
    }
  }

  public async rewritePrompt(
    prompt: string,
    context?: { language?: string; dialect?: ArabicDialect; contentStyle?: string },
  ): Promise<PromptRewriteResult> {
    if (!this.isConfigured) {
      return this.fallbackProvider.rewritePrompt(prompt, context as any);
    }

    try {
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
        {
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `Rewrite the following short user video idea into a detailed, creative video brief. If in Arabic, preserve Egyptian or the requested dialect naturally.
User Idea: "${prompt}"
Output pure JSON with fields: { "enhancedPrompt": string, "changesSummary": string }`,
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.7,
          },
        },
        { timeout: 12000 },
      );

      const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      const parsed = JSON.parse(text);
      return {
        originalPrompt: prompt,
        enhancedPrompt: parsed.enhancedPrompt || prompt,
        changesSummary: parsed.changesSummary || "Enhanced with creative structure.",
      };
    } catch {
      return this.fallbackProvider.rewritePrompt(prompt, context as any);
    }
  }

  public async reviewSpec(spec: ProductionSpec): Promise<SpecReviewResult> {
    return this.fallbackProvider.reviewSpec(spec);
  }

  public async validate(): Promise<ProviderValidationResult> {
    if (!this.isConfigured) {
      return {
        provider: "Google Gemini",
        configured: false,
        healthy: false,
        status: "not_configured",
        message: "GEMINI_API_KEY is not configured. Local AI is used automatically.",
        checkedAt: new Date().toISOString(),
      };
    }

    const start = Date.now();
    try {
      const response = await axios.get(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${this.apiKey}`,
        { timeout: 8000 },
      );
      if (response.status === 200) {
        return {
          provider: "Google Gemini",
          configured: true,
          healthy: true,
          status: "healthy",
          message: "Gemini API connection is verified and healthy.",
          checkedAt: new Date().toISOString(),
          latencyMs: Date.now() - start,
        };
      }
      return {
        provider: "Google Gemini",
        configured: true,
        healthy: false,
        status: "provider_unavailable",
        message: `Gemini returned HTTP ${response.status}`,
        checkedAt: new Date().toISOString(),
      };
    } catch (err: any) {
      if (err.response?.status === 400 || err.response?.status === 403) {
        return {
          provider: "Google Gemini",
          configured: true,
          healthy: false,
          status: "invalid_credentials",
          message: "Invalid Gemini API key.",
          checkedAt: new Date().toISOString(),
        };
      }
      if (err.code === "ECONNABORTED" || err.message?.includes("timeout")) {
        return {
          provider: "Google Gemini",
          configured: true,
          healthy: false,
          status: "timeout",
          message: "Gemini API request timed out.",
          checkedAt: new Date().toISOString(),
        };
      }
      return {
        provider: "Google Gemini",
        configured: true,
        healthy: false,
        status: "provider_unavailable",
        message: err.message || "Gemini connection failed.",
        checkedAt: new Date().toISOString(),
      };
    }
  }
}
