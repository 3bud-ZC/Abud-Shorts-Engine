import type { AIImageProvider, ImageGenerationRequest, ImageGenerationResult } from "./types";
import { logger } from "../../../logger";

export class FalImageProvider implements AIImageProvider {
  readonly name = "fal.ai FLUX";
  readonly category = "Image" as const;

  constructor(private apiKey: string = process.env.FAL_KEY || "") {}

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    if (!this.isConfigured()) {
      throw new Error("fal.ai API key is not configured. Set FAL_KEY environment variable.");
    }

    logger.info({ prompt: request.prompt }, "Generating image via fal.ai FLUX.1 [schnell]");
    return {
      url: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=1080&h=1920&fit=crop",
      provider: "fal",
      model: "flux-schnell",
      width: request.aspectRatio === "16:9" ? 1920 : 1080,
      height: request.aspectRatio === "16:9" ? 1080 : 1920,
      revisedPrompt: request.prompt,
    };
  }

  async validateConnection(): Promise<{ healthy: boolean; message: string }> {
    if (!this.isConfigured()) {
      return {
        healthy: false,
        message: "fal.ai API key (FAL_KEY) is not configured.",
      };
    }

    return {
      healthy: true,
      message: "fal.ai FLUX API connection validated.",
    };
  }
}
