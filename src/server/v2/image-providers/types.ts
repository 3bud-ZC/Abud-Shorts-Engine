export type ImageGenerationRequest = {
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: "9:16" | "16:9" | "1:1";
  width?: number;
  height?: number;
  style?: string;
};

export type ImageGenerationResult = {
  url: string;
  localPath?: string;
  provider: string;
  model: string;
  width: number;
  height: number;
  revisedPrompt?: string;
};

export type ImageToVideoRequest = {
  imageUrl: string;
  imagePath?: string;
  prompt?: string;
  durationSeconds?: number;
  aspectRatio?: "9:16" | "16:9" | "1:1";
};

export type ImageToVideoResult = {
  url: string;
  localPath?: string;
  provider: string;
  duration: number;
};

export interface AIImageProvider {
  readonly name: string;
  readonly category: "Image";
  isConfigured(): boolean;
  generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
  validateConnection(): Promise<{ healthy: boolean; message: string }>;
}
