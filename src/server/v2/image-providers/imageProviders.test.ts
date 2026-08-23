import { describe, it, expect } from "vitest";
import { ImageRegistry, imageRegistry } from "./registry";
import { LocalImageProvider } from "./localImageProvider";
import { GeminiImageProvider } from "./geminiImageProvider";
import { FalImageProvider } from "./falImageProvider";

describe("AI Image Providers & Registry", () => {
  it("generates an offline SVG hero image with LocalImageProvider", async () => {
    const provider = new LocalImageProvider();
    expect(provider.isConfigured()).toBe(true);

    const result = await provider.generateImage({
      prompt: "Modern tech office mockup",
      aspectRatio: "9:16",
    });

    expect(result.provider).toBe("local");
    expect(result.url).toContain("data:image/svg+xml");
    expect(result.width).toBe(1080);
    expect(result.height).toBe(1920);
  });

  it("reports not configured when cloud keys are missing", async () => {
    const gemini = new GeminiImageProvider("");
    expect(gemini.isConfigured()).toBe(false);

    const check = await gemini.validateConnection();
    expect(check.healthy).toBe(false);
    expect(check.message).toContain("not configured");
  });

  it("gracefully falls back to local provider in ImageRegistry when cloud API is missing", async () => {
    const registry = new ImageRegistry();
    const result = await registry.generateImage(
      { prompt: "Fashion streetwear t-shirt", aspectRatio: "9:16" },
      "fal",
    );

    expect(result).toBeDefined();
    expect(result.width).toBe(1080);
    expect(result.height).toBe(1920);
  });
});
