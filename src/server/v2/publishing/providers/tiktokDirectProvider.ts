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

export class TikTokDirectProvider implements PublishingProvider {
  public readonly id: PublishingProviderId = "tiktok_direct";
  public readonly displayName = "TikTok Direct (OpenAPI)";
  public readonly category = "publishing" as const;

  private accessToken?: string;

  constructor(options: { accessToken?: string } = {}) {
    this.accessToken = options.accessToken || process.env.TIKTOK_ACCESS_TOKEN;
  }

  public getSupportedPlatforms(): PublishingPlatform[] {
    return ["tiktok"];
  }

  public getCapabilities(platform: PublishingPlatform): PlatformCapabilities {
    return DEFAULT_PLATFORM_CAPABILITIES.tiktok;
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
        platform: "tiktok",
        configured: false,
        healthy: false,
        status: "not_configured",
        message: "TikTok Access Token is not configured.",
        checkedAt,
        latencyMs: Date.now() - started,
      };
    }

    try {
      const response = await axios.get(
        "https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name",
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 10000,
          validateStatus: () => true,
        },
      );

      const latencyMs = Date.now() - started;

      if (response.status >= 200 && response.status < 300 && response.data?.data?.user) {
        const user = response.data.data.user;
        return {
          provider: this.displayName,
          platform: "tiktok",
          configured: true,
          healthy: true,
          status: "healthy",
          message: `TikTok connected as ${user.display_name || "Creator"}.`,
          accountDetails: {
            accountName: user.display_name,
            accountId: user.open_id,
            avatarUrl: user.avatar_url,
          },
          checkedAt,
          latencyMs,
        };
      }

      if (response.status === 401 || response.status === 403) {
        return {
          provider: this.displayName,
          platform: "tiktok",
          configured: true,
          healthy: false,
          status: "invalid_credentials",
          message: "TikTok rejected the Access Token.",
          checkedAt,
          latencyMs,
        };
      }

      return {
        provider: this.displayName,
        platform: "tiktok",
        configured: true,
        healthy: false,
        status: "provider_unavailable",
        message: `TikTok API returned HTTP ${response.status}.`,
        checkedAt,
        latencyMs,
      };
    } catch (error) {
      return {
        provider: this.displayName,
        platform: "tiktok",
        configured: true,
        healthy: false,
        status: "provider_unavailable",
        message: "Could not reach TikTok OpenAPI.",
        checkedAt,
        latencyMs: Date.now() - started,
      };
    }
  }

  public async publishVideo(params: PublishVideoParams): Promise<PublishResult> {
    return {
      success: false,
      status: "failed",
      error: "Direct TikTok upload extension requires active creator access token.",
      retryable: false,
    };
  }

  public async scheduleVideo(params: ScheduleVideoParams): Promise<PublishResult> {
    return {
      success: false,
      status: "failed",
      error: "Direct TikTok scheduled upload extension requires active creator access token.",
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

  public getPublishedUrl(providerPostId: string): string | undefined {
    return `https://www.tiktok.com/@user/video/${providerPostId}`;
  }
}
