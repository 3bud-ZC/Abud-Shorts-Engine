import { Config } from "../../../config";
import { PexelsAPI } from "../../../short-creator/libraries/Pexels";
import type { VisualProvider, VisualProviderValidationResult } from "./types";
import { PexelsVisualProvider } from "./pexelsVisualProvider";
import { VeoVisualProvider } from "./veoVisualProvider";
import { FalVisualProvider } from "./falVisualProvider";
import { AutoVisualRouter } from "./router";

export class VisualRegistry {
  private providers: Map<string, VisualProvider> = new Map();
  private router: AutoVisualRouter;

  constructor(pexelsApi: PexelsAPI, config?: Config) {
    const pexels = new PexelsVisualProvider(pexelsApi, config?.pexelsApiKey);
    const veo = new VeoVisualProvider(process.env.VEO_API_KEY || process.env.GOOGLE_AI_API_KEY);
    const fal = new FalVisualProvider(process.env.FAL_KEY);

    this.providers.set(pexels.id, pexels);
    this.providers.set(veo.id, veo);
    this.providers.set(fal.id, fal);

    this.router = new AutoVisualRouter(pexels, [veo, fal]);
  }

  public getRouter(): AutoVisualRouter {
    return this.router;
  }

  public getProvider(id: string): VisualProvider | undefined {
    return this.providers.get(id);
  }

  public listProviders(): VisualProvider[] {
    return Array.from(this.providers.values());
  }

  public async validateAll(): Promise<VisualProviderValidationResult[]> {
    const results: VisualProviderValidationResult[] = [];
    for (const provider of this.providers.values()) {
      results.push(await provider.validate());
    }
    return results;
  }
}
