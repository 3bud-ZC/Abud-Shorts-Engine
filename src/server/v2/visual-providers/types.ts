import type { OrientationEnum } from "../../../types/shorts";
import type { ProductionSceneSpec } from "../../../types/productionSpec";

export type VisualAssetResult = {
  provider: string;
  source: "stock" | "ai";
  url: string;
  localPath?: string;
  durationSeconds: number;
  width?: number;
  height?: number;
  estimatedCost: number;
  fallbackUsed?: boolean;
  metadata?: Record<string, unknown>;
};

export type VisualRenderOptions = {
  orientation?: OrientationEnum;
  excludeIds?: (string | number)[];
  tempDirPath: string;
  targetDurationSeconds?: number;
  previousCandidates?: Record<string, unknown>[];
};

export type SceneCostEstimate = {
  provider: string;
  source: "stock" | "ai";
  estimatedCost: number;
  currency: "USD";
};

export type VisualProviderValidationResult = {
  provider: string;
  category: "Visuals";
  configured: boolean;
  healthy: boolean;
  status: "healthy" | "not_configured" | "invalid_credentials" | "rate_limited" | "timeout" | "provider_unavailable";
  message: string;
  checkedAt: string;
  latencyMs?: number;
};

export type VisualProviderCapabilities = {
  textToImage: boolean;
  imageToImage: boolean;
  textToVideo: boolean;
  imageToVideo: boolean;
  referenceImage: boolean;
  multipleReferenceImages: boolean;
  seed: boolean;
  nativeCharacterIdentity: boolean;
};

export interface VisualProvider {
  readonly id: string;
  readonly displayName: string;
  readonly category: "stock" | "ai_video";

  isConfigured(): boolean;
  fetchOrGenerateScene(
    scene: ProductionSceneSpec,
    options: VisualRenderOptions,
  ): Promise<VisualAssetResult>;
  estimateCost(scene: ProductionSceneSpec): SceneCostEstimate;
  validate(): Promise<VisualProviderValidationResult>;
  getCapabilities?(): VisualProviderCapabilities;
}
