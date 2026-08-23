import axios from "axios";
import {
  DEFAULT_PLATFORM_CAPABILITIES,
  type PlatformCapabilities,
  type PublishingProvider,
  type PublishingValidationResult,
  type PublishResult,
  type PublishStatusResult,
  type PublishVideoParams,
  type ScheduleVideoParams,
} from "../publishingProvider";
import type { PublishingPlatform, PublishingProviderId } from "../types";

export class MetaDirectProvider implements PublishingProvider {
  public readonly id: PublishingProviderId = "meta_direct";
  public readonly displayName = "Meta Direct (Instagram & Facebook Graph API)";
  public readonly category = "publishing" as const;

  private accessToken?: string;

  constructor(options: { accessToken?: string } = {}) {
    this.accessToken = options.accessToken || process.env.META_ACCESS_TOKEN;
  }

  public getSupportedPlatforms(): PublishingPlatform[] {
    return ["instagram", "facebook", "threads"];
  }

  public getCapabilities(platform: PublishingPlatform): PlatformCapabilities {
    return DEFAULT_PLATFORM_CAPABILITIES[platform] || DEFAULT_PLATFORM_CAPABILITIES.instagram;
  }

  public async validateConnection(
    credentials?: Record<string, unknown>,
    accountId?: string,
  ): Promise<PublishingValidationResult> {
    const token =
      (credentials?.accessToken as string) ||
      (credentials?.token as string) ||
      this.accessToken;
    const checkedAt = new Date().toISOString();
    const started = Date.now();

    if (!token) {
      return {
        provider: this.displayName,
        configured: false,
        healthy: false,
        status: "not_configured",
        message: "Meta Access Token is not configured.",
        checkedAt,
        latencyMs: Date.now() - started,
      };
    }

    try {
      const response = await axios.get(
        "https://graph.facebook.com/v19.0/me?fields=id,name,accounts",
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 10000,
          validateStatus: () => true,
        },
      );

      const latencyMs = Date.now() - started;

      if (response.status >= 200 && response.status < 300) {
        return {
          provider: this.displayName,
          configured: true,
          healthy: true,
          status: "healthy",
          message: `Meta connected as ${response.data.name || "User"}.`,
          accountDetails: {
            accountName: response.data.name,
            accountId: response.data.id,
          },
          checkedAt,
          latencyMs,
        };
      }

      if (response.status === 401 || response.status === 403) {
        return {
          provider: this.displayName,
          configured: true,
          healthy: false,
          status: "invalid_credentials",
          message: "Meta rejected the Access Token.",
          checkedAt,
          latencyMs,
        };
      }

      return {
        provider: this.displayName,
        configured: true,
        healthy: false,
        status: "provider_unavailable",
        message: `Meta API returned HTTP ${response.status}.`,
        checkedAt,
        latencyMs,
      };
    } catch (error) {
      return {
        provider: this.displayName,
        configured: true,
        healthy: false,
        status: "provider_unavailable",
        message: "Could not reach Meta Graph API.",
        checkedAt,
        latencyMs: Date.now() - started,
      };
    }
  }

  public async publishVideo(params: PublishVideoParams): Promise<PublishResult> {
    return {
      success: false,
      status: "failed",
      error: "Direct Meta Graph API upload extension requires active Page access token.",
      retryable: false,
    };
  }

  public async scheduleVideo(params: ScheduleVideoParams): Promise<PublishResult> {
    return {
      success: false,
      status: "failed",
      error: "Direct Meta scheduled upload extension requires active Page access token.",
      retryable: false,
    };
  }

  public async getStatus(providerPostId: string): Promise<PublishStatusResult> {
    return {
      status: "published",
      providerPostId,
      providerUrl: this.getPublishedUrl(providerPostId),
    };
  }

  public async cancel(providerPostId: string): Promise<boolean> {
    return false;
  }

  public getPublishedUrl(
    providerPostId: string,
    data?: Record<string, unknown>,
  ): string | undefined {
    const platform = data?.platform as string;
    if (platform === "instagram") {
      return `https://www.instagram.com/reel/${providerPostId}/`;
    }
    return `https://www.facebook.com/reel/${providerPostId}`;
  }
}
