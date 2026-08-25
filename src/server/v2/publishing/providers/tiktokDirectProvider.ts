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
  normalizeTikTokError,
  normalizeTransportError,
  type NormalizedProviderError,
} from "../../integrations/providerErrors";
import type { PublishingPlatform, PublishingProviderId } from "../types";

/**
 * TIKTOK DIRECT PROVIDER
 * ----------------------
 * Content Posting API, checked against TikTok's current documentation on
 * 2026-08-25:
 *
 *   POST /v2/post/publish/creator_info/query/   creator capabilities
 *   POST /v2/post/publish/video/init/           Direct Post   (scope video.publish)
 *   POST /v2/post/publish/inbox/video/init/     Draft upload  (scope video.upload)
 *   PUT  {upload_url}                           chunked file transfer
 *   POST /v2/post/publish/status/fetch/         real post status
 *
 * The previous implementation only called `user/info` and returned a hardcoded
 * failure from `publishVideo`, while `getPublishedUrl` fabricated
 * `tiktok.com/@user/video/{publish_id}` - a URL built from an upload ticket, for
 * a post that may not exist. This one returns a link only when TikTok reports a
 * real post id.
 *
 * Two behaviours the API forces on us and the UI must not hide:
 *  - the allowed privacy values come from the creator, never from a constant
 *  - an unaudited client can only create private posts
 */

const API = "https://open.tiktokapis.com/v2";

/** TikTok requires chunks of at least 5 MB except for the final one. */
const CHUNK_SIZE = 10 * 1024 * 1024;

export type TikTokCreatorInfo = {
  nickname?: string;
  avatarUrl?: string;
  privacyLevelOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSeconds: number;
};

export class TikTokDirectProvider implements PublishingProvider {
  public readonly id: PublishingProviderId = "tiktok_direct";
  public readonly displayName = "TikTok";
  public readonly category = "publishing" as const;

  private http: AxiosInstance;

  constructor(options: { http?: AxiosInstance } = {}) {
    this.http = options.http || axios.create({ timeout: 30000, validateStatus: () => true });
  }

  public getSupportedPlatforms(): PublishingPlatform[] {
    return ["tiktok"];
  }

  public getCapabilities(): PlatformCapabilities {
    return capabilitiesFromRequirements("tiktok");
  }

  private tokenFrom(credentials?: Record<string, unknown>): string | undefined {
    const token = credentials?.accessToken || credentials?.token;
    return typeof token === "string" && token.trim() ? token.trim() : undefined;
  }

  /**
   * Reads the creator's own capabilities.
   *
   * This is the only legitimate source for the privacy options, the comment /
   * duet / stitch switches and the maximum duration, all of which vary by
   * account. Hardcoding them is how a publish fails at the last step with an
   * error the customer cannot act on.
   */
  public async getCreatorInfo(
    accessToken: string,
  ): Promise<{ ok: true; info: TikTokCreatorInfo } | { ok: false; error: NormalizedProviderError }> {
    try {
      const response = await this.http.post(
        `${API}/post/publish/creator_info/query/`,
        {},
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json; charset=UTF-8",
          },
        },
      );

      const code = String(response.data?.error?.code || "").toLowerCase();
      if (response.status < 200 || response.status >= 300 || (code && code !== "ok")) {
        return { ok: false, error: normalizeTikTokError(response.status, response.data) };
      }

      const data = response.data?.data || {};
      return {
        ok: true,
        info: {
          nickname: data.creator_nickname,
          avatarUrl: data.creator_avatar_url,
          privacyLevelOptions: Array.isArray(data.privacy_level_options) ? data.privacy_level_options : [],
          commentDisabled: Boolean(data.comment_disabled),
          duetDisabled: Boolean(data.duet_disabled),
          stitchDisabled: Boolean(data.stitch_disabled),
          maxVideoPostDurationSeconds: Number(data.max_video_post_duration_sec) || 0,
        },
      };
    } catch (error) {
      return { ok: false, error: normalizeTransportError("tiktok", error) };
    }
  }

  public async validateConnection(
    credentials?: Record<string, unknown>,
  ): Promise<PublishingValidationResult> {
    const checkedAt = new Date().toISOString();
    const started = Date.now();
    const token = this.tokenFrom(credentials);

    if (!token) {
      return {
        provider: this.displayName,
        platform: "tiktok",
        configured: false,
        healthy: false,
        status: "not_configured",
        message: "No TikTok account is connected.",
        checkedAt,
        latencyMs: Date.now() - started,
      };
    }

    // Creator info doubles as the connection test: it proves the token works AND
    // returns the capabilities the publish screen needs.
    const info = await this.getCreatorInfo(token);
    const latencyMs = Date.now() - started;

    if (!info.ok) {
      return {
        provider: this.displayName,
        platform: "tiktok",
        configured: true,
        healthy: false,
        status:
          info.error.category === "expired_token" || info.error.category === "invalid_credentials"
            ? "invalid_credentials"
            : "provider_unavailable",
        message: info.error.userMessage,
        checkedAt,
        latencyMs,
      };
    }

    return {
      provider: this.displayName,
      platform: "tiktok",
      configured: true,
      healthy: true,
      status: "healthy",
      message: info.info.nickname
        ? `Connected as ${info.info.nickname}.`
        : "TikTok account connected.",
      accountDetails: {
        accountName: info.info.nickname,
        avatarUrl: info.info.avatarUrl,
      },
      checkedAt,
      latencyMs,
    };
  }

  /**
   * Opens a posting session.
   *
   * `mode` decides the endpoint, and the two are genuinely different products:
   * Direct Post publishes to the account, Draft puts the video in the creator's
   * inbox for them to finish by hand. Silently substituting one for the other
   * would publish something the customer expected to review.
   */
  public async initUpload(input: {
    accessToken: string;
    mode: "direct_post" | "draft";
    fileSizeBytes: number;
    postInfo?: {
      title?: string;
      privacyLevel?: string;
      disableComment?: boolean;
      disableDuet?: boolean;
      disableStitch?: boolean;
      brandContentToggle?: boolean;
      brandOrganicToggle?: boolean;
      isAigc?: boolean;
    };
  }): Promise<
    | { ok: true; publishId: string; uploadUrl: string; chunkSize: number; totalChunks: number }
    | { ok: false; error: NormalizedProviderError }
  > {
    const totalChunks = Math.max(1, Math.ceil(input.fileSizeBytes / CHUNK_SIZE));
    // TikTok requires a single chunk to cover the whole file when it fits.
    const chunkSize = totalChunks === 1 ? input.fileSizeBytes : CHUNK_SIZE;

    const body: Record<string, unknown> = {
      source_info: {
        source: "FILE_UPLOAD",
        video_size: input.fileSizeBytes,
        chunk_size: chunkSize,
        total_chunk_count: totalChunks,
      },
    };

    if (input.mode === "direct_post") {
      const post = input.postInfo || {};
      if (!post.privacyLevel) {
        return {
          ok: false,
          error: normalizeTikTokError(400, { error: { code: "privacy_level_required" } }),
        };
      }
      body.post_info = {
        title: (post.title || "").slice(0, 2200),
        privacy_level: post.privacyLevel,
        disable_comment: post.disableComment ?? false,
        disable_duet: post.disableDuet ?? false,
        disable_stitch: post.disableStitch ?? false,
        brand_content_toggle: post.brandContentToggle ?? false,
        brand_organic_toggle: post.brandOrganicToggle ?? false,
        // Declares the video as AI-generated when the production really was.
        is_aigc: post.isAigc ?? false,
      };
    }

    const endpoint =
      input.mode === "direct_post"
        ? `${API}/post/publish/video/init/`
        : `${API}/post/publish/inbox/video/init/`;

    try {
      const response = await this.http.post(endpoint, body, {
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
      });

      const code = String(response.data?.error?.code || "").toLowerCase();
      if (response.status < 200 || response.status >= 300 || (code && code !== "ok")) {
        return { ok: false, error: normalizeTikTokError(response.status, response.data) };
      }

      const data = response.data?.data || {};
      if (!data.publish_id || !data.upload_url) {
        return { ok: false, error: normalizeTikTokError(502, { error: { code: "missing_upload_session" } }) };
      }

      return {
        ok: true,
        publishId: String(data.publish_id),
        uploadUrl: String(data.upload_url),
        chunkSize,
        totalChunks,
      };
    } catch (error) {
      return { ok: false, error: normalizeTransportError("tiktok", error) };
    }
  }

  /** Transfers the file to the signed upload URL TikTok issued. */
  public async uploadFile(input: {
    uploadUrl: string;
    filePath: string;
    fileSizeBytes: number;
    chunkSize: number;
    onProgress?: (uploaded: number, total: number) => void;
  }): Promise<{ ok: true } | { ok: false; error: NormalizedProviderError }> {
    try {
      let offset = 0;
      while (offset < input.fileSizeBytes) {
        const end = Math.min(offset + input.chunkSize, input.fileSizeBytes) - 1;
        const chunk = await readChunk(input.filePath, offset, end);
        const response = await this.http.put(input.uploadUrl, chunk, {
          headers: {
            "Content-Type": "video/mp4",
            "Content-Length": String(chunk.length),
            "Content-Range": `bytes ${offset}-${end}/${input.fileSizeBytes}`,
          },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        });
        if (response.status < 200 || response.status >= 300) {
          return { ok: false, error: normalizeTikTokError(response.status, response.data) };
        }
        offset = end + 1;
        input.onProgress?.(offset, input.fileSizeBytes);
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: normalizeTransportError("tiktok", error) };
    }
  }

  /**
   * Publishes.
   *
   * Never returns `published`: TikTok accepts the bytes and then processes and
   * moderates asynchronously, so the only honest state at this point is
   * `processing`. The real outcome comes from `getStatus`.
   */
  public async publishVideo(params: PublishVideoParams): Promise<PublishResult> {
    const accessToken = (params.metadata as Record<string, unknown> | undefined)?.accessToken as string | undefined;
    if (!accessToken) {
      return {
        success: false,
        status: "failed",
        error: "No TikTok account is connected.",
        technicalError: "tiktok:no_access_token",
        retryable: false,
      };
    }
    if (!fs.existsSync(params.videoFilePath)) {
      return {
        success: false,
        status: "failed",
        error: "The video file is missing from storage.",
        technicalError: "tiktok:file_missing",
        retryable: false,
      };
    }

    const options = params.metadata?.tiktok || {};
    const mode = options.mode === "draft" ? "draft" : "direct_post";
    const fileSizeBytes = fs.statSync(params.videoFilePath).size;

    const init = await this.initUpload({
      accessToken,
      mode,
      fileSizeBytes,
      postInfo:
        mode === "direct_post"
          ? {
              title: params.title || params.caption,
              privacyLevel: options.privacyLevel,
              disableComment: options.disableComment,
              disableDuet: options.disableDuet,
              disableStitch: options.disableStitch,
              brandContentToggle: options.brandContentToggle,
              brandOrganicToggle: options.brandOrganicToggle,
              isAigc: Boolean(params.metadata?.containsSyntheticMedia),
            }
          : undefined,
    });

    if (!init.ok) {
      return {
        success: false,
        status: "failed",
        error: init.error.userMessage,
        technicalError: init.error.technicalCode,
        retryable: init.error.retryable,
      };
    }

    const uploaded = await this.uploadFile({
      uploadUrl: init.uploadUrl,
      filePath: params.videoFilePath,
      fileSizeBytes,
      chunkSize: init.chunkSize,
    });

    if (!uploaded.ok) {
      return {
        success: false,
        status: "failed",
        error: uploaded.error.userMessage,
        technicalError: uploaded.error.technicalCode,
        retryable: uploaded.error.retryable,
      };
    }

    return {
      success: true,
      status: "processing",
      providerPostId: init.publishId,
      // No URL yet on purpose: publish_id is an upload ticket, not a post id.
      message:
        mode === "draft"
          ? "Sent to your TikTok drafts. Open TikTok to finish and post it."
          : "Uploaded to TikTok. Waiting for TikTok to finish processing.",
    };
  }

  /** TikTok has no native scheduling field; the engine's scheduler holds it. */
  public async scheduleVideo(params: ScheduleVideoParams): Promise<PublishResult> {
    return this.publishVideo(params);
  }

  /**
   * Reads the real posting status.
   *
   * `PUBLISH_COMPLETE` is the only state that means the video is live, and it is
   * also the only point at which a shareable post id exists.
   */
  public async getStatus(
    providerPostId: string,
    context?: Record<string, unknown>,
  ): Promise<PublishStatusResult> {
    const accessToken = context?.accessToken as string | undefined;
    if (!accessToken) {
      return { status: "processing", providerPostId, message: "Cannot check TikTok without a connected account." };
    }

    const response = await this.http.post(
      `${API}/post/publish/status/fetch/`,
      { publish_id: providerPostId },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
      },
    );

    const code = String(response.data?.error?.code || "").toLowerCase();
    if (response.status < 200 || response.status >= 300 || (code && code !== "ok")) {
      const error = normalizeTikTokError(response.status, response.data);
      return { status: "processing", providerPostId, message: error.userMessage };
    }

    const data = response.data?.data || {};
    const status = String(data.status || "").toUpperCase();
    const publiclyAvailablePostId = Array.isArray(data.publicaly_available_post_id)
      ? data.publicaly_available_post_id[0]
      : Array.isArray(data.publicly_available_post_id)
        ? data.publicly_available_post_id[0]
        : undefined;

    if (status === "PUBLISH_COMPLETE") {
      return {
        status: "published",
        providerPostId,
        providerUrl: publiclyAvailablePostId
          ? this.getPublishedUrl(String(publiclyAvailablePostId), { username: context?.username as string })
          : undefined,
      };
    }
    if (status === "FAILED") {
      const reason = String(data.fail_reason || "unknown");
      const error = normalizeTikTokError(200, { error: { code: reason } });
      return { status: "failed", providerPostId, error: error.userMessage };
    }
    return {
      status: "processing",
      providerPostId,
      message: status === "SEND_TO_USER_INBOX" ? "Waiting in your TikTok drafts." : "TikTok is still processing.",
    };
  }

  public async cancel(): Promise<boolean> {
    return false;
  }

  /**
   * A TikTok URL needs the creator handle as well as the post id, and TikTok
   * only returns a post id once the video is actually public. Without both, no
   * link is produced rather than a plausible-looking wrong one.
   */
  public getPublishedUrl(providerPostId: string, data?: Record<string, unknown>): string | undefined {
    const username = typeof data?.username === "string" ? data.username.replace(/^@/, "") : "";
    if (!username || !providerPostId) return undefined;
    return `https://www.tiktok.com/@${username}/video/${providerPostId}`;
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
