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

export type TestProviderMode =
  | "success"
  | "failure"
  | "429"
  | "500"
  | "timeout"
  | "401";

export class TestPublishingProvider implements PublishingProvider {
  public readonly id: PublishingProviderId = "test_provider";
  public readonly displayName = "Internal Test Publishing Provider";
  public readonly category = "publishing" as const;

  public invocationCount = 0;
  public invocations: PublishVideoParams[] = [];
  private currentMode: TestProviderMode = "success";
  private platformModes: Map<PublishingPlatform, TestProviderMode> = new Map();

  constructor(initialMode: TestProviderMode = "success") {
    this.currentMode = initialMode;
  }

  public setMode(mode: TestProviderMode): void {
    this.currentMode = mode;
  }

  public setPlatformMode(platform: PublishingPlatform, mode: TestProviderMode): void {
    this.platformModes.set(platform, mode);
  }

  public reset(): void {
    this.invocationCount = 0;
    this.invocations = [];
    this.currentMode = "success";
    this.platformModes.clear();
  }

  public getSupportedPlatforms(): PublishingPlatform[] {
    return [
      "youtube",
      "tiktok",
      "instagram",
      "facebook",
      "linkedin",
      "twitter",
      "threads",
      "telegram",
    ];
  }

  public getCapabilities(platform: PublishingPlatform): PlatformCapabilities {
    return {
      ...(DEFAULT_PLATFORM_CAPABILITIES[platform] || DEFAULT_PLATFORM_CAPABILITIES.youtube),
      displayName: `Test Platform (${platform})`,
      requiresAccount: false,
    };
  }

  public async validateConnection(): Promise<PublishingValidationResult> {
    return {
      provider: this.displayName,
      configured: true,
      healthy: true,
      status: "healthy",
      message: "Internal Test Provider is active in dev/test mode.",
      checkedAt: new Date().toISOString(),
    };
  }

  public async publishVideo(params: PublishVideoParams): Promise<PublishResult> {
    this.invocationCount++;
    this.invocations.push(params);

    const mode = this.platformModes.get(params.platform) || this.currentMode;

    switch (mode) {
      case "success":
        return {
          success: true,
          status: "published",
          providerPostId: `test_post_${params.publicationId}`,
          providerUrl: `https://test.abud-shorts.internal/posts/${params.publicationId}`,
          rawResponse: {
            test: true,
            mode: "success",
            invocationCount: this.invocationCount,
            publicationId: params.publicationId,
            videoId: params.videoId,
            platform: params.platform,
            timestamp: new Date().toISOString(),
          },
        };

      case "429":
        return {
          success: false,
          status: "failed",
          error: "Rate limit exceeded (HTTP 429)",
          retryable: true,
          rawResponse: {
            test: true,
            mode: "429",
            status: 429,
            error: "Too Many Requests",
            retryAfterSeconds: 60,
          },
        };

      case "500":
        return {
          success: false,
          status: "failed",
          error: "Internal server error (HTTP 500)",
          retryable: true,
          rawResponse: {
            test: true,
            mode: "500",
            status: 500,
            error: "Internal Server Error",
          },
        };

      case "timeout":
        return {
          success: false,
          status: "failed",
          error: "Request timed out (HTTP 504)",
          retryable: true,
          rawResponse: {
            test: true,
            mode: "timeout",
            status: 504,
            error: "Gateway Timeout",
          },
        };

      case "401":
        return {
          success: false,
          status: "failed",
          error: "Unauthorized invalid token (HTTP 401)",
          retryable: false,
          rawResponse: {
            test: true,
            mode: "401",
            status: 401,
            error: "Invalid OAuth token or revoked access.",
          },
        };

      case "failure":
      default:
        return {
          success: false,
          status: "failed",
          error: "Controlled test provider failure",
          retryable: false,
          rawResponse: {
            test: true,
            mode: "failure",
            error: "Operation failed intentionally.",
          },
        };
    }
  }

  public async scheduleVideo(params: ScheduleVideoParams): Promise<PublishResult> {
    return this.publishVideo(params);
  }

  public async getStatus(providerPostId: string): Promise<PublishStatusResult> {
    return {
      status: "published",
      providerPostId,
      providerUrl: `https://test.abud-shorts.internal/posts/${providerPostId}`,
    };
  }

  public async cancel(): Promise<boolean> {
    return true;
  }

  public getPublishedUrl(providerPostId: string): string | undefined {
    return `https://test.abud-shorts.internal/posts/${providerPostId}`;
  }
}
