import axios, { AxiosError } from "axios";
import fs from "fs";
import path from "path";
import { logger } from "../../../../logger";
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

export class UploadPostProvider implements PublishingProvider {
  public readonly id: PublishingProviderId = "upload_post";
  public readonly displayName = "Upload-Post (Multi-Platform)";
  public readonly category = "publishing" as const;

  private apiKey?: string;
  private baseUrl: string;

  constructor(options: { apiKey?: string; baseUrl?: string } = {}) {
    this.apiKey = options.apiKey || process.env.UPLOAD_POST_API_KEY;
    this.baseUrl = options.baseUrl || process.env.UPLOAD_POST_BASE_URL || "https://api.upload-post.com";
  }

  public getSupportedPlatforms(): PublishingPlatform[] {
    return ["youtube", "tiktok", "instagram", "facebook", "linkedin", "twitter", "threads"];
  }

  public getCapabilities(platform: PublishingPlatform): PlatformCapabilities {
    return (
      DEFAULT_PLATFORM_CAPABILITIES[platform] || {
        ...DEFAULT_PLATFORM_CAPABILITIES.youtube,
        platform,
      }
    );
  }

  public async validateConnection(
    credentials?: Record<string, unknown>,
    accountId?: string,
  ): Promise<PublishingValidationResult> {
    const key = (credentials?.apiKey as string) || (credentials?.token as string) || this.apiKey;
    const checkedAt = new Date().toISOString();
    const started = Date.now();

    if (!key || key.trim().length === 0) {
      return {
        provider: this.displayName,
        configured: false,
        healthy: false,
        status: "not_configured",
        message: "Upload-Post API key is not configured.",
        checkedAt,
        latencyMs: Date.now() - started,
      };
    }

    try {
      const response = await axios.get(`${this.baseUrl}/v1/user/profile`, {
        headers: {
          Authorization: `Bearer ${key}`,
          "x-api-key": key,
        },
        timeout: 10000,
        validateStatus: () => true,
      });

      const latencyMs = Date.now() - started;

      if (response.status >= 200 && response.status < 300) {
        return {
          provider: this.displayName,
          configured: true,
          healthy: true,
          status: "healthy",
          message: "Upload-Post connected and verified.",
          accountDetails: {
            accountName: response.data?.name || response.data?.email || "Upload-Post User",
            accountId: response.data?.id || accountId || "upload-post-user",
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
          message: "Upload-Post rejected the API key (unauthorized).",
          checkedAt,
          latencyMs,
        };
      }

      if (response.status === 429) {
        return {
          provider: this.displayName,
          configured: true,
          healthy: false,
          status: "rate_limited",
          message: "Upload-Post rate limit exceeded.",
          checkedAt,
          latencyMs,
        };
      }

      return {
        provider: this.displayName,
        configured: true,
        healthy: false,
        status: "provider_unavailable",
        message: `Upload-Post responded with HTTP ${response.status}.`,
        checkedAt,
        latencyMs,
      };
    } catch (error) {
      const isTimeout =
        axios.isAxiosError(error) &&
        (error.code === "ECONNABORTED" || error.message.toLowerCase().includes("timeout"));

      return {
        provider: this.displayName,
        configured: true,
        healthy: false,
        status: isTimeout ? "timeout" : "provider_unavailable",
        message: isTimeout
          ? "Upload-Post connection timed out."
          : "Could not reach Upload-Post API.",
        checkedAt,
        latencyMs: Date.now() - started,
      };
    }
  }

  public async publishVideo(params: PublishVideoParams): Promise<PublishResult> {
    const key =
      (params.account?.encryptedCredentials as string) ||
      (params.account?.maskedToken as string) ||
      this.apiKey;

    if (!key) {
      return {
        success: false,
        status: "failed",
        error: "Upload-Post API key is missing.",
        technicalError: "NO_API_KEY",
        retryable: false,
      };
    }

    try {
      // Build form data or payload
      const form = new FormData();
      form.append("platform", params.platform);
      form.append("publicationId", params.publicationId);
      form.append("title", params.title || "");
      form.append("caption", params.caption || params.description || "");
      form.append("description", params.description || "");

      if (params.hashtags && params.hashtags.length > 0) {
        form.append("hashtags", JSON.stringify(params.hashtags));
      }

      if (params.metadata) {
        form.append("metadata", JSON.stringify(params.metadata));
      }

      if (params.account?.accountId) {
        form.append("accountId", params.account.accountId);
      }

      if (params.idempotencyKey) {
        form.append("idempotencyKey", params.idempotencyKey);
      }

      if (fs.existsSync(params.videoFilePath)) {
        const fileBuf = fs.readFileSync(params.videoFilePath);
        const blob = new Blob([fileBuf], { type: "video/mp4" });
        form.append("video", blob, path.basename(params.videoFilePath));
      } else if (params.videoUrl) {
        form.append("videoUrl", params.videoUrl);
      } else {
        return {
          success: false,
          status: "failed",
          error: "Video file or URL not found.",
          retryable: false,
        };
      }

      if (params.thumbnailFilePath && fs.existsSync(params.thumbnailFilePath)) {
        const thumbBuf = fs.readFileSync(params.thumbnailFilePath);
        const thumbBlob = new Blob([thumbBuf], { type: "image/jpeg" });
        form.append("thumbnail", thumbBlob, path.basename(params.thumbnailFilePath));
      }

      const headers = {
        Authorization: `Bearer ${key}`,
        "x-api-key": key,
        ...(params.idempotencyKey ? { "Idempotency-Key": params.idempotencyKey } : {}),
      };

      const response = await axios.post(`${this.baseUrl}/v1/publish`, form, {
        headers,
        timeout: 60000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: () => true,
      });

      if (response.status >= 200 && response.status < 300) {
        const data = response.data;
        const providerPostId = data.postId || data.id || `up_${Date.now()}`;
        const providerUrl =
          data.publishedUrl ||
          data.url ||
          this.getPublishedUrl(providerPostId, { platform: params.platform });

        return {
          success: true,
          status: data.status === "processing" ? "processing" : "published",
          providerPostId,
          providerUrl,
          message: data.message || "Video published via Upload-Post.",
          rawResponse: data,
        };
      }

      const isRetryable = response.status === 429 || response.status >= 500;
      return {
        success: false,
        status: "failed",
        error: response.data?.error || `Upload-Post error (HTTP ${response.status})`,
        technicalError: JSON.stringify(response.data || {}),
        rawResponse: response.data,
        retryable: isRetryable,
      };
    } catch (error: any) {
      logger.error({ error, publicationId: params.publicationId }, "Upload-Post publish failed");
      const isRetryable =
        axios.isAxiosError(error) &&
        (error.code === "ECONNABORTED" ||
          error.code === "ETIMEDOUT" ||
          error.code === "ECONNRESET" ||
          (error.response && (error.response.status === 429 || error.response.status >= 500)));

      return {
        success: false,
        status: "failed",
        error: error.message || "Upload-Post publish request failed.",
        technicalError: error.stack || String(error),
        retryable: isRetryable,
      };
    }
  }

  public async scheduleVideo(params: ScheduleVideoParams): Promise<PublishResult> {
    const key =
      (params.account?.encryptedCredentials as string) ||
      (params.account?.maskedToken as string) ||
      this.apiKey;

    if (!key) {
      return {
        success: false,
        status: "failed",
        error: "Upload-Post API key is missing.",
        technicalError: "NO_API_KEY",
        retryable: false,
      };
    }

    try {
      const response = await axios.post(
        `${this.baseUrl}/v1/schedule`,
        {
          platform: params.platform,
          publicationId: params.publicationId,
          title: params.title,
          caption: params.caption || params.description,
          description: params.description,
          hashtags: params.hashtags,
          metadata: params.metadata,
          accountId: params.account?.accountId,
          scheduledAt: params.scheduledAt.toISOString(),
          timezone: params.sourceTimezone,
          videoUrl: params.videoUrl,
          thumbnailUrl: params.thumbnailUrl,
          idempotencyKey: params.idempotencyKey,
        },
        {
          headers: {
            Authorization: `Bearer ${key}`,
            "x-api-key": key,
            ...(params.idempotencyKey ? { "Idempotency-Key": params.idempotencyKey } : {}),
          },
          timeout: 15000,
          validateStatus: () => true,
        },
      );

      if (response.status >= 200 && response.status < 300) {
        const data = response.data;
        return {
          success: true,
          status: "scheduled",
          providerPostId: data.scheduleId || data.id || `sch_${Date.now()}`,
          message: "Publication scheduled successfully with Upload-Post.",
          rawResponse: data,
        };
      }

      const isRetryable = response.status === 429 || response.status >= 500;
      return {
        success: false,
        status: "failed",
        error: response.data?.error || `Upload-Post scheduling error (${response.status})`,
        technicalError: JSON.stringify(response.data || {}),
        retryable: isRetryable,
      };
    } catch (error: any) {
      return {
        success: false,
        status: "failed",
        error: error.message || "Failed to schedule with Upload-Post.",
        technicalError: String(error),
        retryable: true,
      };
    }
  }

  public async getStatus(
    providerPostId: string,
    context?: Record<string, unknown>,
  ): Promise<PublishStatusResult> {
    const key = (context?.apiKey as string) || this.apiKey;
    if (!key) {
      return {
        status: "failed",
        providerPostId,
        error: "API key is required to check status.",
      };
    }

    try {
      const response = await axios.get(`${this.baseUrl}/v1/posts/${providerPostId}/status`, {
        headers: { Authorization: `Bearer ${key}`, "x-api-key": key },
        timeout: 10000,
        validateStatus: () => true,
      });

      if (response.status >= 200 && response.status < 300) {
        const data = response.data;
        let status: "processing" | "published" | "failed" = "processing";
        if (data.status === "published" || data.status === "success") status = "published";
        if (data.status === "failed" || data.status === "error") status = "failed";

        return {
          status,
          providerPostId,
          providerUrl: data.publishedUrl || data.url,
          progressPercent: data.progress,
          message: data.message,
          rawResponse: data,
        };
      }

      return {
        status: "failed",
        providerPostId,
        error: response.data?.error || `Status check failed with HTTP ${response.status}`,
      };
    } catch (error: any) {
      return {
        status: "failed",
        providerPostId,
        error: error.message || "Status check error",
      };
    }
  }

  public async cancel(
    providerPostId: string,
    context?: Record<string, unknown>,
  ): Promise<boolean> {
    const key = (context?.apiKey as string) || this.apiKey;
    if (!key) return false;

    try {
      const response = await axios.post(
        `${this.baseUrl}/v1/posts/${providerPostId}/cancel`,
        {},
        {
          headers: { Authorization: `Bearer ${key}`, "x-api-key": key },
          timeout: 10000,
          validateStatus: () => true,
        },
      );
      return response.status >= 200 && response.status < 300;
    } catch {
      return false;
    }
  }

  public getPublishedUrl(
    providerPostId: string,
    data?: Record<string, unknown>,
  ): string | undefined {
    if (data?.url) return String(data.url);
    if (data?.publishedUrl) return String(data.publishedUrl);

    const platform = data?.platform as string;
    if (platform === "youtube") {
      return `https://youtube.com/shorts/${providerPostId}`;
    }
    if (platform === "tiktok") {
      return `https://www.tiktok.com/@user/video/${providerPostId}`;
    }
    if (platform === "instagram") {
      return `https://www.instagram.com/reel/${providerPostId}/`;
    }
    if (platform === "facebook") {
      return `https://www.facebook.com/reel/${providerPostId}`;
    }
    return undefined;
  }
}
