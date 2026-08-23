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

export class YouTubeDirectProvider implements PublishingProvider {
  public readonly id: PublishingProviderId = "youtube_direct";
  public readonly displayName = "YouTube Direct (Data API v3)";
  public readonly category = "publishing" as const;

  private apiKey?: string;
  private accessToken?: string;

  constructor(options: { apiKey?: string; accessToken?: string } = {}) {
    this.apiKey = options.apiKey || process.env.YOUTUBE_API_KEY;
    this.accessToken = options.accessToken || process.env.YOUTUBE_ACCESS_TOKEN;
  }

  public getSupportedPlatforms(): PublishingPlatform[] {
    return ["youtube"];
  }

  public getCapabilities(platform: PublishingPlatform): PlatformCapabilities {
    return DEFAULT_PLATFORM_CAPABILITIES.youtube;
  }

  public async validateConnection(
    credentials?: Record<string, unknown>,
    accountId?: string,
  ): Promise<PublishingValidationResult> {
    const token =
      (credentials?.accessToken as string) ||
      (credentials?.token as string) ||
      this.accessToken;
    const apiKey = (credentials?.apiKey as string) || this.apiKey;
    const checkedAt = new Date().toISOString();
    const started = Date.now();

    if (!token && !apiKey) {
      return {
        provider: this.displayName,
        platform: "youtube",
        configured: false,
        healthy: false,
        status: "not_configured",
        message: "YouTube API Key or OAuth Access Token is not configured.",
        checkedAt,
        latencyMs: Date.now() - started,
      };
    }

    try {
      const headers: Record<string, string> = {};
      const params: Record<string, string> = { part: "snippet" };

      if (token) {
        headers.Authorization = `Bearer ${token}`;
        params.mine = "true";
      } else if (apiKey) {
        params.key = apiKey;
        if (accountId) params.id = accountId;
        else params.mine = "true";
      }

      const response = await axios.get(
        "https://www.googleapis.com/youtube/v3/channels",
        {
          headers,
          params,
          timeout: 10000,
          validateStatus: () => true,
        },
      );

      const latencyMs = Date.now() - started;

      if (response.status >= 200 && response.status < 300) {
        const item = response.data?.items?.[0];
        return {
          provider: this.displayName,
          platform: "youtube",
          configured: true,
          healthy: true,
          status: "healthy",
          message: item
            ? `YouTube Channel "${item.snippet?.title}" verified.`
            : "YouTube API connection verified.",
          accountDetails: item
            ? {
                accountName: item.snippet?.title,
                accountId: item.id,
                channelTitle: item.snippet?.title,
              }
            : undefined,
          checkedAt,
          latencyMs,
        };
      }

      if (response.status === 401 || response.status === 403) {
        return {
          provider: this.displayName,
          platform: "youtube",
          configured: true,
          healthy: false,
          status: "invalid_credentials",
          message: "YouTube API rejected credentials (unauthorized).",
          checkedAt,
          latencyMs,
        };
      }

      if (response.status === 429) {
        return {
          provider: this.displayName,
          platform: "youtube",
          configured: true,
          healthy: false,
          status: "rate_limited",
          message: "YouTube API quota exceeded.",
          checkedAt,
          latencyMs,
        };
      }

      return {
        provider: this.displayName,
        platform: "youtube",
        configured: true,
        healthy: false,
        status: "provider_unavailable",
        message: `YouTube API returned HTTP ${response.status}.`,
        checkedAt,
        latencyMs,
      };
    } catch (error) {
      return {
        provider: this.displayName,
        platform: "youtube",
        configured: true,
        healthy: false,
        status: "provider_unavailable",
        message: "Could not reach YouTube Data API.",
        checkedAt,
        latencyMs: Date.now() - started,
      };
    }
  }

  public async publishVideo(params: PublishVideoParams): Promise<PublishResult> {
    return {
      success: false,
      status: "failed",
      error: "Direct YouTube OAuth upload extension requires active client token.",
      retryable: false,
    };
  }

  public async scheduleVideo(params: ScheduleVideoParams): Promise<PublishResult> {
    return {
      success: false,
      status: "failed",
      error: "Direct YouTube scheduled upload extension requires active client token.",
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
    return `https://youtube.com/shorts/${providerPostId}`;
  }
}
