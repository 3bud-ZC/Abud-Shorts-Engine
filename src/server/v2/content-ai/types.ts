import type {
  ArabicDialect,
  AspectRatio,
  ContentStyle,
  ProductionSpec,
  QualityProfile,
  Resolution,
  VideoLanguage,
  VisualMode,
  VoiceProvider,
} from "../../../types/productionSpec";

export type GenerateSpecParams = {
  prompt: string;
  language?: VideoLanguage;
  dialect?: ArabicDialect;
  contentStyle?: ContentStyle;
  requestedDurationSeconds?: number;
  durationSeconds?: number;
  duration?: number;
  aspectRatio?: AspectRatio;
  resolution?: Resolution;
  quality?: QualityProfile;
  visualMode?: VisualMode;
  voiceProvider?: VoiceProvider;
  voiceId?: string;
  brandId?: string;
  brandName?: string;
  brandKit?: ProductionSpec["brandKit"];
};

export type PromptRewriteResult = {
  originalPrompt: string;
  enhancedPrompt: string;
  changesSummary: string;
};

export type SpecReviewResult = {
  approved: boolean;
  score: number;
  warnings: string[];
  correctedSpec?: ProductionSpec;
};

export type ProviderValidationResult = {
  provider: string;
  configured: boolean;
  healthy: boolean;
  status: "healthy" | "not_configured" | "invalid_credentials" | "rate_limited" | "timeout" | "provider_unavailable";
  message: string;
  checkedAt: string;
  latencyMs?: number;
};

export interface ContentAIProvider {
  readonly id: string;
  readonly displayName: string;
  readonly category: "content_ai";

  generateProductionSpec(params: GenerateSpecParams): Promise<ProductionSpec>;
  rewritePrompt(
    prompt: string,
    context?: { language?: VideoLanguage; dialect?: ArabicDialect; contentStyle?: ContentStyle },
  ): Promise<PromptRewriteResult>;
  reviewSpec(spec: ProductionSpec): Promise<SpecReviewResult>;
  validate(): Promise<ProviderValidationResult>;
}
