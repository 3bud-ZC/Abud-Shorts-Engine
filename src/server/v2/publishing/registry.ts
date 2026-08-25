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

/**
 * Providers that exist only for the engine's own deterministic tests.
 *
 * These must never be listed to a customer, and must never be selectable
 * through a production API token: a publication routed here silently does
 * nothing and reports success, which would look exactly like a real post.
 */
export const INTERNAL_PROVIDER_IDS: PublishingProviderId[] = ["test_provider"];

export function isInternalProvider(id: PublishingProviderId): boolean {
  return INTERNAL_PROVIDER_IDS.includes(id);
}

/**
 * True when the internal test provider may be used at all. Enabled only by an
 * explicit installation flag or by the test runner itself - never by default,
 * and never by anything a customer can set from the browser.
 */
export function internalProvidersEnabled(): boolean {
  return process.env.NODE_ENV === "test" || process.env.ENABLE_TEST_PROVIDERS === "true";
}

export class PublishingProviderRegistry {
  private providers = new Map<PublishingProviderId, PublishingProvider>();

  constructor() {
    this.register(new UploadPostProvider());
    this.register(new TelegramPublishingProvider());
    this.register(new YouTubeDirectProvider());
    this.register(new MetaDirectProvider());
    this.register(new TikTokDirectProvider());
    // Registered so tests can reach it explicitly; hidden from every listing
    // and refused by `getSelectableProvider` outside a test environment.
    this.register(new TestPublishingProvider());
  }

  /**
   * Resolves a provider a caller asked for by name, enforcing internal-only
   * isolation. Returns undefined rather than the test provider when it is not
   * permitted, so the caller falls back to a real route or fails loudly.
   */
  public getSelectableProvider(id: PublishingProviderId): PublishingProvider | undefined {
    if (isInternalProvider(id) && !internalProvidersEnabled()) return undefined;
    return this.providers.get(id);
  }

  public register(provider: PublishingProvider): void {
    this.providers.set(provider.id, provider);
  }

  public getProvider(id: PublishingProviderId): PublishingProvider | undefined {
    return this.providers.get(id);
  }

  public listProviders(includeInternal = false): PublishingProvider[] {
    const list = Array.from(this.providers.values());
    if (includeInternal && internalProvidersEnabled()) return list;
    return list.filter((provider) => !isInternalProvider(provider.id));
  }

  public getProviderForPlatform(
    platform: PublishingPlatform,
    preferredProvider?: PublishingProviderId,
  ): PublishingProvider {
    if (preferredProvider) {
      const preferred = this.getSelectableProvider(preferredProvider);
      if (preferred && preferred.getSupportedPlatforms().includes(platform)) {
        return preferred;
      }
    }

    // A direct adapter is preferred over the aggregator whenever one exists for
    // the platform: a customer who connected their own YouTube channel expects
    // the video on that channel, not routed through a third-party service.
    const direct: Partial<Record<PublishingPlatform, PublishingProviderId>> = {
      youtube: "youtube_direct",
      tiktok: "tiktok_direct",
      instagram: "meta_direct",
      facebook: "meta_direct",
      telegram: "telegram_bot",
    };
    const directId = direct[platform];
    if (directId) {
      const directProvider = this.providers.get(directId);
      if (directProvider) return directProvider;
    }

    // Default to UploadPost for multi-platform
    const uploadPost = this.providers.get("upload_post");
    if (uploadPost && uploadPost.getSupportedPlatforms().includes(platform)) {
      return uploadPost;
    }

    // Fallback search, internal providers excluded.
    for (const provider of this.providers.values()) {
      if (isInternalProvider(provider.id)) continue;
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

  public async validateAll(includeInternal = false): Promise<PublishingValidationResult[]> {
    const providers = this.listProviders(includeInternal);
    const results = await Promise.all(
      providers.map((p) => p.validateConnection()),
    );
    return results;
  }
}

export const publishingRegistry = new PublishingProviderRegistry();
