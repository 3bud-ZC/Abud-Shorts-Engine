import { Config } from "../../../config";
import { PexelsAPI } from "../../../short-creator/libraries/Pexels";
import { PexelsStockProvider } from "../stock-providers/pexelsProvider";
import { PixabayProvider } from "../stock-providers/pixabayProvider";
import { StockProviderRegistry } from "../stock-providers/stockProviderRegistry";
import type { VisualProvider, VisualProviderValidationResult } from "./types";
import { PexelsVisualProvider } from "./pexelsVisualProvider";
import { VeoVisualProvider } from "./veoVisualProvider";
import { FalVisualProvider } from "./falVisualProvider";
import { RunwayVisualProvider } from "./runwayVisualProvider";
import { ReplicateVisualProvider } from "./replicateVisualProvider";
import { ComfyUIProvider } from "./comfyUIProvider";
import { LumaVisualProvider } from "./lumaVisualProvider";
import { AutoVisualRouter } from "./router";

export class VisualRegistry {
  private providers: Map<string, VisualProvider> = new Map();
  private router: AutoVisualRouter;

  constructor(pexelsApi: PexelsAPI, config?: Config) {
    const pexels = new PexelsVisualProvider(pexelsApi, config?.pexelsApiKey);
    const veo = new VeoVisualProvider(process.env.VEO_API_KEY || process.env.GOOGLE_AI_API_KEY);
    const fal = new FalVisualProvider(process.env.FAL_KEY);
    const runway = new RunwayVisualProvider(process.env.RUNWAY_API_KEY);
    const replicate = new ReplicateVisualProvider(process.env.REPLICATE_API_TOKEN);
    const comfyui = new ComfyUIProvider(process.env.COMFYUI_BASE_URL);
    const luma = new LumaVisualProvider(process.env.LUMA_API_KEY);
    const stockRegistry = new StockProviderRegistry([
      new PexelsStockProvider(config?.pexelsApiKey),
      new PixabayProvider(),
    ]);

    this.providers.set(pexels.id, pexels);
    this.providers.set(veo.id, veo);
    this.providers.set(fal.id, fal);
    this.providers.set(runway.id, runway);
    this.providers.set(replicate.id, replicate);
    this.providers.set(comfyui.id, comfyui);
    this.providers.set(luma.id, luma);

    this.router = new AutoVisualRouter(pexels, [veo, runway, fal, replicate, luma, comfyui], stockRegistry);
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
