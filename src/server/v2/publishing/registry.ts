import {
  DEFAULT_PLATFORM_CAPABILITIES,
  type PlatformCapabilities,
  type PublishingProvider,
  type PublishingValidationResult,
} from "./publishingProvider";
import { MetaDirectProvider } from "./providers/metaDirectProvider";
import { TelegramPublishingProvider } from "./providers/telegramProvider";
import { TestPublishingProvider } from "./providers/testPublishingProvider";
import { TikTokDirectProvider } from "./providers/tiktokDirectProvider";
import { UploadPostProvider } from "./providers/uploadPostProvider";
import { YouTubeDirectProvider } from "./providers/youtubeDirectProvider";
import type { PublishingPlatform, PublishingProviderId } from "./types";

export class PublishingProviderRegistry {
  private providers = new Map<PublishingProviderId, PublishingProvider>();

  constructor() {
    this.register(new UploadPostProvider());
    this.register(new TelegramPublishingProvider());
    this.register(new YouTubeDirectProvider());
    this.register(new MetaDirectProvider());
    this.register(new TikTokDirectProvider());
    this.register(new TestPublishingProvider());
  }

  public register(provider: PublishingProvider): void {
    this.providers.set(provider.id, provider);
  }

  public getProvider(id: PublishingProviderId): PublishingProvider | undefined {
    return this.providers.get(id);
  }

  public listProviders(): PublishingProvider[] {
    return Array.from(this.providers.values());
  }

  public getProviderForPlatform(
    platform: PublishingPlatform,
    preferredProvider?: PublishingProviderId,
  ): PublishingProvider {
    if (preferredProvider && this.providers.has(preferredProvider)) {
      const p = this.providers.get(preferredProvider)!;
      if (p.getSupportedPlatforms().includes(platform)) {
        return p;
      }
    }

    if (platform === "telegram") {
      return this.providers.get("telegram_bot") || this.providers.get("upload_post")!;
    }

    // Default to UploadPost for multi-platform
    const uploadPost = this.providers.get("upload_post");
    if (uploadPost && uploadPost.getSupportedPlatforms().includes(platform)) {
      return uploadPost;
    }

    // Fallback search
    for (const provider of this.providers.values()) {
      if (provider.getSupportedPlatforms().includes(platform)) {
        return provider;
      }
    }

    return uploadPost || Array.from(this.providers.values())[0];
  }

  public getPlatformCapabilities(
    platform: PublishingPlatform,
    providerId?: PublishingProviderId,
  ): PlatformCapabilities {
    if (providerId && this.providers.has(providerId)) {
      return this.providers.get(providerId)!.getCapabilities(platform);
    }
    return DEFAULT_PLATFORM_CAPABILITIES[platform] || DEFAULT_PLATFORM_CAPABILITIES.youtube;
  }

  public async validateAll(): Promise<PublishingValidationResult[]> {
    const results = await Promise.all(
      Array.from(this.providers.values()).map((p) => p.validateConnection()),
    );
    return results;
  }
}

export const publishingRegistry = new PublishingProviderRegistry();
