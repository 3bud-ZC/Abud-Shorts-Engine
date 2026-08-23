import type { AIImageProvider, ImageGenerationRequest, ImageGenerationResult } from "./types";
import { LocalImageProvider } from "./localImageProvider";
import { GeminiImageProvider } from "./geminiImageProvider";
import { FalImageProvider } from "./falImageProvider";
import { logger } from "../../../logger";

export class ImageRegistry {
  private providers: Map<string, AIImageProvider> = new Map();
  private defaultProvider: AIImageProvider;

  constructor() {
    const local = new LocalImageProvider();
    const gemini = new GeminiImageProvider();
    const fal = new FalImageProvider();

    this.providers.set("local", local);
    this.providers.set("gemini", gemini);
    this.providers.set("fal", fal);

    this.defaultProvider = local;
  }

  getProvider(name?: string): AIImageProvider {
    if (!name || name === "auto" || name === "local") {
      // If gemini is configured and requested, use it, otherwise local
      const gemini = this.providers.get("gemini");
      if (gemini && gemini.isConfigured()) return gemini;
      return this.defaultProvider;
    }
    const found = this.providers.get(name.toLowerCase());
    return found || this.defaultProvider;
  }

  async generateImage(
    request: ImageGenerationRequest,
    preferredProvider = "auto",
  ): Promise<ImageGenerationResult> {
    const provider = this.getProvider(preferredProvider);
    try {
      return await provider.generateImage(request);
    } catch (err: any) {
      logger.warn(
        { provider: provider.name, error: err.message },
        "Image generation failed; falling back to local offline generator",
      );
      return await this.defaultProvider.generateImage(request);
    }
  }

  listProviders() {
    return Array.from(this.providers.values()).map((p) => ({
      name: p.name,
      category: p.category,
      isConfigured: p.isConfigured(),
      isDefault: p.name === this.defaultProvider.name,
    }));
  }
}

export const imageRegistry = new ImageRegistry();
