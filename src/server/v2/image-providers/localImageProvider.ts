import type { AIImageProvider, ImageGenerationRequest, ImageGenerationResult } from "./types";

export class LocalImageProvider implements AIImageProvider {
  readonly name = "Local Image Generator (Offline)";
  readonly category = "Image" as const;

  isConfigured(): boolean {
    return true;
  }

  async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const width = request.width || (request.aspectRatio === "16:9" ? 1920 : 1080);
    const height = request.height || (request.aspectRatio === "16:9" ? 1080 : 1920);

    // Creates an offline high-contrast SVG hero card representation
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <defs>
          <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#0f172a;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#1e293b;stop-opacity:1" />
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#grad)" />
        <circle cx="${width / 2}" cy="${height / 2}" r="${width * 0.3}" fill="#38bdf8" opacity="0.15" />
        <text x="50%" y="45%" dominant-baseline="middle" text-anchor="middle" fill="#f8fafc" font-size="42" font-family="sans-serif" font-weight="bold">
          ABUD Shorts Engine
        </text>
        <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" fill="#94a3b8" font-size="24" font-family="sans-serif">
          ${request.prompt.slice(0, 45)}
        </text>
      </svg>
    `.trim();

    const base64 = Buffer.from(svg).toString("base64");
    const dataUrl = `data:image/svg+xml;base64,${base64}`;

    return {
      url: dataUrl,
      provider: "local",
      model: "svg-card",
      width,
      height,
      revisedPrompt: request.prompt,
    };
  }

  async validateConnection(): Promise<{ healthy: boolean; message: string }> {
    return {
      healthy: true,
      message: "Local offline image generator is ready.",
    };
  }
}
