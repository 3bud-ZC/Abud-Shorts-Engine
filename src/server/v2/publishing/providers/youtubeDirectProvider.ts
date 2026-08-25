import axios, { type AxiosInstance } from "axios";
import fs from "fs-extra";
import {
  type PlatformCapabilities,
  type PublishingProvider,
  type PublishingValidationResult,
  type PublishResult,
  type PublishStatusResult,
  type PublishVideoParams,
  type ScheduleVideoParams,
} from "../publishingProvider";
import { capabilitiesFromRequirements } from "../platformCapabilities";
import {
  normalizeGoogleError,
  normalizeTransportError,
  type NormalizedProviderError,
} from "../../integrations/providerErrors";
import type { PublishingPlatform, PublishingProviderId } from "../types";

/**
 * YOUTUBE DIRECT PROVIDER
 * -----------------------
 * Real uploads to a connected YouTube channel over the Data API v3 resumable
 * protocol.
 *
 * The previous implementation could only call `channels.list`; `publishVideo`
 * returned a hardcoded failure, and `getPublishedUrl` built a
 * `youtube.com/shorts/{id}` link from whatever string it was handed - including
 * ids that were never real videos. Nothing here invents a URL: a link is only
 * produced once the API has returned an actual video id.
 *
 * Contract checked against Google's current documentation on 2026-08-25:
 *   POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=...
 *   with X-Upload-Content-Length / X-Upload-Content-Type; the session URI comes
 *   back in the Location header. Interrupted uploads are resumed by PUTting
 *   `Content-Range: bytes * /TOTAL` to learn the confirmed byte count, which the
 *   API answers with 308 plus a Range header.
 */

const UPLOAD_ENDPOINT = "https://www.googleapis.com/upload/youtube/v3/videos";
const API_ENDPOINT = "https://www.googleapis.com/youtube/v3";

/** Bytes per chunk. 8 MiB is a multiple of Google's required 256 KiB block. */
const CHUNK_SIZE = 8 * 1024 * 1024;

export type YouTubeUploadSession = {
  sessionUrl: string;
  totalBytes: number;
  bytesUploaded: number;
};

export type YouTubeCredentials = {
  accessToken?: string;
  channelId?: string;
};

export class YouTubeDirectProvider implements PublishingProvider {
  public readonly id: PublishingProviderId = "youtube_direct";
  public readonly displayName = "YouTube";
  public readonly category = "publishing" as const;

  private http: AxiosInstance;

  constructor(private options: { http?: AxiosInstance } = {}) {
    this.http = options.http || axios.create({ timeout: 30000, validateStatus: () => true });
  }

  public getSupportedPlatforms(): PublishingPlatform[] {
    return ["youtube"];
  }

  public getCapabilities(): PlatformCapabilities {
    return capabilitiesFromRequirements("youtube");
  }

  private tokenFrom(credentials?: Record<string, unknown>): string | undefined {
    const token = credentials?.accessToken || credentials?.token;
    return typeof token === "string" && token.trim() ? token.trim() : undefined;
  }

  /**
   * Reads the connected channel.
   *
   * `mine=true` with an OAuth token is the only form that proves a *customer
   * account* is connected; an API key would prove the app is configured and
   * nothing more, which is exactly the conflation the connection-state model
   * exists to prevent.
   */
  public async validateConnection(
    credentials?: Record<string, unknown>,
  ): Promise<PublishingValidationResult> {
    const checkedAt = new Date().toISOString();
    const started = Date.now();
    const token = this.tokenFrom(credentials);

    if (!token) {
      return {
        provider: this.displayName,
        platform: "youtube",
        configured: false,
        healthy: false,
        status: "not_configured",
        message: "No YouTube channel is connected.",
        checkedAt,
        latencyMs: Date.now() - started,
      };
    }

    try {
      const response = await this.http.get(`${API_ENDPOINT}/channels`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { part: "snippet", mine: "true" },
      });
      const latencyMs = Date.now() - started;

      if (response.status >= 200 && response.status < 300) {
        const item = response.data?.items?.[0];
        if (!item) {
          return {
            provider: this.displayName,
            platform: "youtube",
            configured: true,
            healthy: false,
            status: "invalid_credentials",
            message: "This Google account has no YouTube channel. Create one, then reconnect.",
            checkedAt,
            latencyMs,
          };
        }
        return {
          provider: this.displayName,
          platform: "youtube",
          configured: true,
          healthy: true,
          status: "healthy",
          message: `Connected to "${item.snippet?.title}".`,
          accountDetails: {
            accountName: item.snippet?.title,
            accountId: item.id,
            channelTitle: item.snippet?.title,
            avatarUrl: item.snippet?.thumbnails?.default?.url,
          },
          checkedAt,
          latencyMs,
        };
      }

      const normalized = normalizeGoogleError(response.status, response.data, response.headers as never);
      return {
        provider: this.displayName,
        platform: "youtube",
        configured: true,
        healthy: false,
        status: normalized.category === "expired_token" ? "invalid_credentials" : "provider_unavailable",
        message: normalized.userMessage,
        checkedAt,
        latencyMs,
      };
    } catch (error) {
      const normalized = normalizeTransportError("youtube", error);
      return {
        provider: this.displayName,
        platform: "youtube",
        configured: true,
        healthy: false,
        status: "provider_unavailable",
        message: normalized.userMessage,
        checkedAt,
        latencyMs: Date.now() - started,
      };
    }
  }

  /**
   * Opens a resumable session and returns its URI.
   *
   * Separated from the byte transfer so an interrupted publish can resume
   * against a persisted session rather than re-uploading from zero.
   */
  public async createUploadSession(input: {
    accessToken: string;
    fileSizeBytes: number;
    title: string;
    description?: string;
    tags?: string[];
    privacy: "private" | "unlisted" | "public";
    publishAt?: Date;
    selfDeclaredMadeForKids?: boolean;
    containsSyntheticMedia?: boolean;
  }): Promise<{ ok: true; session: YouTubeUploadSession } | { ok: false; error: NormalizedProviderError }> {
    const snippet: Record<string, unknown> = {
      title: input.title.slice(0, 100),
      description: (input.description || "").slice(0, 5000),
      tags: (input.tags || []).slice(0, 15),
    };
    const status: Record<string, unknown> = {
      privacyStatus: input.privacy,
      selfDeclaredMadeForKids: input.selfDeclaredMadeForKids ?? false,
    };
    // A scheduled public release requires the video to start private.
    if (input.publishAt) {
      status.privacyStatus = "private";
      status.publishAt = input.publishAt.toISOString();
    }
    if (input.containsSyntheticMedia) {
      // Declares altered or synthetic content, as required when the video was
      // produced with generative tooling.
      status.containsSyntheticMedia = true;
    }

    try {
      const response = await this.http.post(
        UPLOAD_ENDPOINT,
        { snippet, status },
        {
          params: { uploadType: "resumable", part: "snippet,status" },
          headers: {
            Authorization: `Bearer ${input.accessToken}`,
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Length": String(input.fileSizeBytes),
            "X-Upload-Content-Type": "video/mp4",
          },
        },
      );

      if (response.status >= 200 && response.status < 300) {
        const sessionUrl = (response.headers as Record<string, string>)?.location;
        if (!sessionUrl) {
          return {
            ok: false,
            error: normalizeGoogleError(500, {}, undefined),
          };
        }
        return { ok: true, session: { sessionUrl, totalBytes: input.fileSizeBytes, bytesUploaded: 0 } };
      }
      return { ok: false, error: normalizeGoogleError(response.status, response.data, response.headers as never) };
    } catch (error) {
      return { ok: false, error: normalizeTransportError("youtube", error) };
    }
  }

  /**
   * Asks the session how many bytes it already holds.
   *
   * Google answers a zero-length PUT with `Content-Range: bytes * /TOTAL` using
   * 308 and a `Range: bytes=0-N` header. A session that already finished answers
   * 200/201 instead, which means the video exists and must not be re-sent.
   */
  public async queryUploadOffset(input: {
    accessToken: string;
    sessionUrl: string;
    totalBytes: number;
  }): Promise<{ completed: boolean; bytesUploaded: number; videoId?: string }> {
    const response = await this.http.put(input.sessionUrl, null, {
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Range": `bytes */${input.totalBytes}`,
        "Content-Length": "0",
      },
    });

    if (response.status === 200 || response.status === 201) {
      return { completed: true, bytesUploaded: input.totalBytes, videoId: response.data?.id };
    }
    if (response.status === 308) {
      const range = (response.headers as Record<string, string>)?.range;
      // No Range header means the server holds nothing yet.
      const lastByte = range ? Number(range.split("-")[1]) : -1;
      return { completed: false, bytesUploaded: Number.isFinite(lastByte) ? lastByte + 1 : 0 };
    }
    return { completed: false, bytesUploaded: 0 };
  }

  /**
   * Transfers the file, chunk by chunk, resuming from `bytesUploaded`.
   *
   * Reporting real byte progress is possible here, which is why the publishing
   * progress model does not have to invent a percentage for YouTube.
   */
  public async uploadBytes(input: {
    accessToken: string;
    session: YouTubeUploadSession;
    filePath: string;
    onProgress?: (uploadedBytes: number, totalBytes: number) => void;
  }): Promise<{ ok: true; videoId: string } | { ok: false; error: NormalizedProviderError; resumable: boolean }> {
    let offset = input.session.bytesUploaded;
    const total = input.session.totalBytes;

    try {
      while (offset < total) {
        const end = Math.min(offset + CHUNK_SIZE, total) - 1;
        const chunk = await readChunk(input.filePath, offset, end);

        const response = await this.http.put(input.session.sessionUrl, chunk, {
          headers: {
            Authorization: `Bearer ${input.accessToken}`,
            "Content-Length": String(chunk.length),
            "Content-Range": `bytes ${offset}-${end}/${total}`,
            "Content-Type": "video/mp4",
          },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        });

        if (response.status === 200 || response.status === 201) {
          const videoId = response.data?.id;
          if (!videoId) {
            return {
              ok: false,
              resumable: false,
              error: normalizeGoogleError(500, { error: { message: "no video id" } }),
            };
          }
          input.onProgress?.(total, total);
          return { ok: true, videoId };
        }

        if (response.status === 308) {
          const range = (response.headers as Record<string, string>)?.range;
          const lastByte = range ? Number(range.split("-")[1]) : end;
          offset = Number.isFinite(lastByte) ? lastByte + 1 : end + 1;
          input.onProgress?.(offset, total);
          continue;
        }

        const error = normalizeGoogleError(response.status, response.data, response.headers as never);
        // 5xx and 429 leave the session alive, so the caller may resume later.
        return { ok: false, error, resumable: response.status >= 500 || response.status === 429 };
      }

      return {
        ok: false,
        resumable: true,
        error: normalizeGoogleError(500, { error: { message: "upload ended without a video id" } }),
      };
    } catch (error) {
      return { ok: false, error: normalizeTransportError("youtube", error), resumable: true };
    }
  }

  /**
   * Publishes a video end to end.
   *
   * Returns `processing` rather than `published` when the bytes are accepted:
   * YouTube can still reject a video during processing, and reporting it as
   * published at upload time is exactly the false success this milestone forbids.
   */
  public async publishVideo(params: PublishVideoParams): Promise<PublishResult> {
    const token = this.tokenFrom(params.account?.encryptedCredentials ? undefined : (params as never));
    const accessToken = (params.metadata as Record<string, unknown> | undefined)?.accessToken as string | undefined || token;

    if (!accessToken) {
      return {
        success: false,
        status: "failed",
        error: "No YouTube channel is connected.",
        technicalError: "youtube:no_access_token",
        retryable: false,
      };
    }

    if (!fs.existsSync(params.videoFilePath)) {
      return {
        success: false,
        status: "failed",
        error: "The video file is missing from storage.",
        technicalError: "youtube:file_missing",
        retryable: false,
      };
    }

    const fileSizeBytes = fs.statSync(params.videoFilePath).size;
    const privacy = ((params.metadata?.privacy as string) || "unlisted") as "private" | "unlisted" | "public";

    const created = await this.createUploadSession({
      accessToken,
      fileSizeBytes,
      title: params.title || "Untitled",
      description: params.description || params.caption,
      tags: params.hashtags,
      privacy,
      containsSyntheticMedia: Boolean((params.metadata as Record<string, unknown> | undefined)?.containsSyntheticMedia),
    });

    if (!created.ok) {
      return {
        success: false,
        status: "failed",
        error: created.error.userMessage,
        technicalError: created.error.technicalCode,
        retryable: created.error.retryable,
      };
    }

    const uploaded = await this.uploadBytes({
      accessToken,
      session: created.session,
      filePath: params.videoFilePath,
    });

    if (!uploaded.ok) {
      return {
        success: false,
        status: "failed",
        error: uploaded.error.userMessage,
        technicalError: uploaded.error.technicalCode,
        retryable: uploaded.error.retryable || uploaded.resumable,
      };
    }

    return {
      success: true,
      status: "processing",
      providerPostId: uploaded.videoId,
      providerUrl: this.getPublishedUrl(uploaded.videoId),
      message: "Uploaded to YouTube. Waiting for processing to finish.",
    };
  }

  /**
   * YouTube schedules by uploading privately with a `publishAt` timestamp, so a
   * scheduled publish is a normal upload with different status fields.
   */
  public async scheduleVideo(params: ScheduleVideoParams): Promise<PublishResult> {
    return this.publishVideo({
      ...params,
      metadata: { ...(params.metadata || {}), privacy: "private", publishAt: params.scheduledAt.toISOString() },
    });
  }

  /**
   * Reads processing state.
   *
   * `uploadStatus` is what decides the outcome: `processed` is a real success,
   * `rejected` or `failed` mean the video will never appear however cleanly the
   * bytes transferred.
   */
  public async getStatus(
    providerPostId: string,
    context?: Record<string, unknown>,
  ): Promise<PublishStatusResult> {
    const accessToken = context?.accessToken as string | undefined;
    if (!accessToken) {
      return {
        status: "processing",
        providerPostId,
        message: "Cannot check YouTube processing without a connected channel.",
      };
    }

    const response = await this.http.get(`${API_ENDPOINT}/videos`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { part: "status,processingDetails", id: providerPostId },
    });

    if (response.status < 200 || response.status >= 300) {
      const error = normalizeGoogleError(response.status, response.data, response.headers as never);
      return { status: "processing", providerPostId, message: error.userMessage };
    }

    const item = response.data?.items?.[0];
    if (!item) {
      return { status: "failed", providerPostId, error: "YouTube no longer has this video." };
    }

    const uploadStatus = String(item.status?.uploadStatus || "");
    if (uploadStatus === "processed") {
      return {
        status: "published",
        providerPostId,
        providerUrl: this.getPublishedUrl(providerPostId),
      };
    }
    if (uploadStatus === "rejected" || uploadStatus === "failed") {
      const reason = item.status?.rejectionReason || item.status?.failureReason || "unknown";
      return {
        status: "failed",
        providerPostId,
        error: `YouTube rejected this video (${reason}).`,
      };
    }
    return {
      status: "processing",
      providerPostId,
      message: "YouTube is still processing this video.",
    };
  }

  public async cancel(): Promise<boolean> {
    // A video already accepted by YouTube can only be deleted, which is a
    // destructive action the customer must take themselves.
    return false;
  }

  /**
   * Only ever called with an id YouTube returned. Producing a link from an
   * arbitrary string is how the previous build advertised videos that did not
   * exist.
   */
  public getPublishedUrl(providerPostId: string): string | undefined {
    if (!providerPostId || !/^[A-Za-z0-9_-]{6,}$/.test(providerPostId)) return undefined;
    return `https://www.youtube.com/watch?v=${providerPostId}`;
  }
}

async function readChunk(filePath: string, start: number, end: number): Promise<Buffer> {
  const length = end - start + 1;
  const buffer = Buffer.alloc(length);
  const handle = await fs.open(filePath, "r");
  try {
    await fs.read(handle, buffer, 0, length, start);
    return buffer;
  } finally {
    await fs.close(handle);
  }
}
