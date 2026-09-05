import { Config } from "../../../config";
import type { ContentAIProvider, ProviderValidationResult } from "./types";
import { LocalContentAIProvider } from "./localProvider";
import { GeminiContentAIProvider } from "./geminiProvider";
import { OllamaContentAIProvider } from "./ollamaProvider";
import { providerSecrets } from "../provider-vault/providerSecrets";

export class ContentAIRegistry {
  private providers: Map<string, ContentAIProvider> = new Map();

  constructor(config?: Config, geminiKeyOverride?: string) {
    const localProvider = new LocalContentAIProvider();
    this.providers.set(localProvider.id, localProvider);

    const ollamaProvider = new OllamaContentAIProvider();
    this.providers.set(ollamaProvider.id, ollamaProvider);

    const geminiKey =
      geminiKeyOverride ||
      providerSecrets.peek("gemini", "api_key") ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_AI_API_KEY;
    const geminiProvider = new GeminiContentAIProvider(geminiKey);
    this.providers.set(geminiProvider.id, geminiProvider);
  }

  private refreshVaultBackedProviders(): void {
    const geminiKey = providerSecrets.peek("gemini", "api_key");
    const gemini = this.providers.get("gemini") as GeminiContentAIProvider | undefined;
    if (geminiKey && (!gemini || !gemini.isConfigured)) {
      this.providers.set("gemini", new GeminiContentAIProvider(geminiKey));
    }
  }

  public getProvider(id?: string): ContentAIProvider {
    this.refreshVaultBackedProviders();
    if (id && this.providers.has(id)) {
      const p = this.providers.get(id)!;
      // If user specifically requested Gemini but Gemini is not configured, we still return it so it can validate/fallback
      return p;
    }
    const ollama = this.providers.get("ollama") as OllamaContentAIProvider;
    if (ollama?.isConfigured) {
      return ollama;
    }
    const gemini = this.providers.get("gemini") as GeminiContentAIProvider;
    if (gemini && gemini.isConfigured) {
      return gemini;
    }
    return this.providers.get("local_ai")!;
  }

  public listProviders(): ContentAIProvider[] {
    this.refreshVaultBackedProviders();
    return Array.from(this.providers.values());
  }

  public async validateAll(): Promise<ProviderValidationResult[]> {
    this.refreshVaultBackedProviders();
    const results: ProviderValidationResult[] = [];
    for (const provider of this.providers.values()) {
      results.push(await provider.validate());
    }
    return results;
  }
}
