import { Config } from "../../../config";
import type { ContentAIProvider, ProviderValidationResult } from "./types";
import { LocalContentAIProvider } from "./localProvider";
import { GeminiContentAIProvider } from "./geminiProvider";

export class ContentAIRegistry {
  private providers: Map<string, ContentAIProvider> = new Map();

  constructor(config?: Config, geminiKeyOverride?: string) {
    const localProvider = new LocalContentAIProvider();
    this.providers.set(localProvider.id, localProvider);

    const geminiKey =
      geminiKeyOverride ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_AI_API_KEY;
    const geminiProvider = new GeminiContentAIProvider(geminiKey);
    this.providers.set(geminiProvider.id, geminiProvider);
  }

  public getProvider(id?: string): ContentAIProvider {
    if (id && this.providers.has(id)) {
      const p = this.providers.get(id)!;
      // If user specifically requested Gemini but Gemini is not configured, we still return it so it can validate/fallback
      return p;
    }
    const gemini = this.providers.get("gemini") as GeminiContentAIProvider;
    if (gemini && gemini.isConfigured) {
      return gemini;
    }
    return this.providers.get("local_ai")!;
  }

  public listProviders(): ContentAIProvider[] {
    return Array.from(this.providers.values());
  }

  public async validateAll(): Promise<ProviderValidationResult[]> {
    const results: ProviderValidationResult[] = [];
    for (const provider of this.providers.values()) {
      results.push(await provider.validate());
    }
    return results;
  }
}
