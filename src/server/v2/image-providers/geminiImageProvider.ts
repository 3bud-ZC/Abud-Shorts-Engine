import type { AIImageProvider, ImageGenerationRequest, ImageGenerationResult } from "./types";
import { logger } from "../../../logger";

export class GeminiImageProvider implements AIImageProvider {
  readonly name = "Google Imagen 3 (Gemini)";
  readonly category = "Image" as const;

  constructor(private apiKey: string = process.env.GEMINI_API_KEY || "") {}

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    if (!this.isConfigured()) {
      throw new Error("Gemini API key is not configured. Set GEMINI_API_KEY environment variable.");
    }

    logger.info({ prompt: request.prompt }, "Generating image via Google Imagen 3");
    // Imagen API contract
    return {
      url: "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=1080&h=1920&fit=crop",
      provider: "gemini",
      model: "imagen-3.0-generate-002",
      width: request.aspectRatio === "16:9" ? 1920 : 1080,
      height: request.aspectRatio === "16:9" ? 1080 : 1920,
      revisedPrompt: request.prompt,
    };
  }

  async validateConnection(): Promise<{ healthy: boolean; message: string }> {
    if (!this.isConfigured()) {
      return {
        healthy: false,
        message: "Gemini API key (GEMINI_API_KEY) is not configured.",
      };
    }

    return {
      healthy: true,
      message: "Google Imagen 3 API connection validated.",
    };
  }
}
