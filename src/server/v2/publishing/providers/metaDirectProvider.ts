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
  normalizeMetaError,
  normalizeTransportError,
  type NormalizedProviderError,
} from "../../integrations/providerErrors";
import type { PublishingPlatform, PublishingProviderId } from "../types";

/**
 * META DIRECT PROVIDER
 * --------------------
 * Instagram Reels and Facebook Page Reels over the Graph API, checked against
 * Meta's current documentation on 2026-08-25.
 *
 * Instagram Reels (professional accounts only):
 *   POST /{ig-user-id}/media          media_type=REELS, video_url, caption
 *   GET  /{container-id}?fields=status_code   IN_PROGRESS | FINISHED | ERROR | EXPIRED
 *   POST /{ig-user-id}/media_publish  creation_id
 *
 * Facebook Page Reels (three phases, two hosts):
 *   POST graph.facebook.com/{page-id}/video_reels     upload_phase=start
 *   POST rupload.facebook.com/video-upload/{video-id} the bytes
 *   POST graph.facebook.com/{page-id}/video_reels     upload_phase=finish
 *
 * The previous implementation had `/me?fields=id,name,accounts` and nothing
 * else - no Page discovery, no Instagram account resolution, and a
 * `publishVideo` that returned a fixed failure. It also shared one "meta"
 * identity across both platforms, so a Facebook Page id and an Instagram user id
 * were interchangeable, which they are not.
 */

const GRAPH_VERSION = "v21.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
const RUPLOAD = "https://rupload.facebook.com";

export type MetaPage = {
  pageId: string;
  name: string;
  /** Page-scoped token; publishing to a Page uses this, not the user token. */
  pageAccessToken: string;
  /** Present only when a professional Instagram account is linked to the Page. */
  instagramUserId?: string;
  instagramUsername?: string;
};

export class MetaDirectProvider implements PublishingProvider {
  public readonly id: PublishingProviderId = "meta_direct";
  public readonly displayName = "Instagram & Facebook";
  public readonly category = "publishing" as const;

  private http: AxiosInstance;

  constructor(options: { http?: AxiosInstance } = {}) {
    this.http = options.http || axios.create({ timeout: 30000, validateStatus: () => true });
  }

  public getSupportedPlatforms(): PublishingPlatform[] {
    return ["instagram", "facebook"];
  }

  public getCapabilities(platform: PublishingPlatform): PlatformCapabilities {
    return capabilitiesFromRequirements(platform === "facebook" ? "facebook" : "instagram");
  }

  private tokenFrom(credentials?: Record<string, unknown>): string | undefined {
    const token = credentials?.accessToken || credentials?.token;
    return typeof token === "string" && token.trim() ? token.trim() : undefined;
  }

  /**
   * Lists the real destinations this authorization can publish to.
   *
   * Both the Page and its linked Instagram professional account come from the
   * same edge, which is the only way to learn an IG user id through Facebook
   * Login. A Page with no linked professional account is still returned - the
   * customer may want Facebook Reels only - but it carries no Instagram id, and
   * the publish path refuses rather than guessing one.
   */
  public async discoverAccounts(
    userAccessToken: string,
  ): Promise<{ ok: true; pages: MetaPage[] } | { ok: false; error: NormalizedProviderError }> {
    try {
      const response = await this.http.get(`${GRAPH}/me/accounts`, {
        params: {
          access_token: userAccessToken,
          fields: "id,name,access_token,instagram_business_account{id,username}",
          limit: 100,
        },
      });

      if (response.status < 200 || response.status >= 300) {
        return { ok: false, error: normalizeMetaError(response.status, response.data) };
      }

      const pages: MetaPage[] = (response.data?.data || []).map((page: Record<string, unknown>) => {
        const ig = page.instagram_business_account as { id?: string; username?: string } | undefined;
        return {
          pageId: String(page.id),
          name: String(page.name || "Facebook Page"),
          pageAccessToken: String(page.access_token || ""),
          instagramUserId: ig?.id ? String(ig.id) : undefined,
          instagramUsername: ig?.username ? String(ig.username) : undefined,
        };
      });

      return { ok: true, pages };
    } catch (error) {
      return { ok: false, error: normalizeTransportError("meta", error) };
    }
  }

  /** Permissions the user actually granted, which the token response omits. */
  public async grantedPermissions(userAccessToken: string): Promise<string[]> {
    const response = await this.http.get(`${GRAPH}/me/permissions`, {
      params: { access_token: userAccessToken },
    });
    if (response.status < 200 || response.status >= 300) return [];
    return (response.data?.data || [])
      .filter((row: { status?: string }) => row.status === "granted")
      .map((row: { permission?: string }) => String(row.permission || ""))
      .filter(Boolean);
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
        configured: false,
        healthy: false,
        status: "not_configured",
        message: "No Facebook Page or Instagram account is connected.",
        checkedAt,
        latencyMs: Date.now() - started,
      };
    }

    const discovered = await this.discoverAccounts(token);
    const latencyMs = Date.now() - started;

    if (!discovered.ok) {
      return {
        provider: this.displayName,
        configured: true,
        healthy: false,
        status:
          discovered.error.category === "expired_token" ? "invalid_credentials" : "provider_unavailable",
        message: discovered.error.userMessage,
        checkedAt,
        latencyMs,
      };
    }

    if (discovered.pages.length === 0) {
      return {
        provider: this.displayName,
        configured: true,
        healthy: false,
        status: "invalid_credentials",
        message: "This Facebook account manages no Pages. Reels are published to a Page, not a profile.",
        checkedAt,
        latencyMs,
      };
    }

    const withInstagram = discovered.pages.filter((page) => page.instagramUserId).length;
    return {
      provider: this.displayName,
      configured: true,
      healthy: true,
      status: "healthy",
      message:
        withInstagram > 0
          ? `${discovered.pages.length} Page(s) available, ${withInstagram} with an Instagram professional account.`
          : `${discovered.pages.length} Page(s) available. No Instagram professional account is linked, so Instagram publishing is unavailable.`,
      accountDetails: { accountName: discovered.pages[0].name, accountId: discovered.pages[0].pageId },
      checkedAt,
      latencyMs,
    };
  }

  // ------------------------------------------------------------- Instagram

  /**
   * Creates the Reel container.
   *
   * Instagram pulls the file from a URL it can reach, so the caller must supply
   * a publicly reachable `videoUrl`; this is a genuine deployment requirement,
   * not something the adapter can work around.
   */
  public async createInstagramReelContainer(input: {
    instagramUserId: string;
    accessToken: string;
    videoUrl: string;
    caption?: string;
    shareToFeed?: boolean;
    isAiGenerated?: boolean;
  }): Promise<{ ok: true; containerId: string } | { ok: false; error: NormalizedProviderError }> {
    try {
      const params: Record<string, unknown> = {
        media_type: "REELS",
        video_url: input.videoUrl,
        access_token: input.accessToken,
      };
      if (input.caption) params.caption = input.caption.slice(0, 2200);
      if (typeof input.shareToFeed === "boolean") params.share_to_feed = input.shareToFeed;
      // Declares AI involvement where the production really used it.
      if (input.isAiGenerated) params.is_ai_generated = true;

      const response = await this.http.post(`${GRAPH}/${input.instagramUserId}/media`, null, { params });
      if (response.status < 200 || response.status >= 300 || !response.data?.id) {
        return { ok: false, error: normalizeMetaError(response.status, response.data) };
      }
      return { ok: true, containerId: String(response.data.id) };
    } catch (error) {
      return { ok: false, error: normalizeTransportError("meta", error) };
    }
  }

  /** Polls container readiness. FINISHED is the only state that may be published. */
  public async getInstagramContainerStatus(input: {
    containerId: string;
    accessToken: string;
  }): Promise<{ statusCode: string; error?: NormalizedProviderError }> {
    const response = await this.http.get(`${GRAPH}/${input.containerId}`, {
      params: { fields: "status_code,status", access_token: input.accessToken },
    });
    if (response.status < 200 || response.status >= 300) {
      return { statusCode: "ERROR", error: normalizeMetaError(response.status, response.data) };
    }
    return { statusCode: String(response.data?.status_code || "IN_PROGRESS") };
  }

  /** Publishes a FINISHED container and returns the real media id. */
  public async publishInstagramContainer(input: {
    instagramUserId: string;
    containerId: string;
    accessToken: string;
  }): Promise<{ ok: true; mediaId: string } | { ok: false; error: NormalizedProviderError }> {
    const response = await this.http.post(`${GRAPH}/${input.instagramUserId}/media_publish`, null, {
      params: { creation_id: input.containerId, access_token: input.accessToken },
    });
    if (response.status < 200 || response.status >= 300 || !response.data?.id) {
      return { ok: false, error: normalizeMetaError(response.status, response.data) };
    }
    return { ok: true, mediaId: String(response.data.id) };
  }

  /** The canonical link, which only Instagram can give us. */
  public async getInstagramPermalink(input: {
    mediaId: string;
    accessToken: string;
  }): Promise<string | undefined> {
    const response = await this.http.get(`${GRAPH}/${input.mediaId}`, {
      params: { fields: "permalink", access_token: input.accessToken },
    });
    if (response.status < 200 || response.status >= 300) return undefined;
    const permalink = response.data?.permalink;
    return typeof permalink === "string" ? permalink : undefined;
  }

  // -------------------------------------------------------------- Facebook

  /** Phase 1: reserve a video id on the Page. */
  public async startFacebookReel(input: {
    pageId: string;
    pageAccessToken: string;
  }): Promise<{ ok: true; videoId: string; uploadUrl?: string } | { ok: false; error: NormalizedProviderError }> {
    const response = await this.http.post(`${GRAPH}/${input.pageId}/video_reels`, null, {
      params: { upload_phase: "start", access_token: input.pageAccessToken },
    });
    if (response.status < 200 || response.status >= 300 || !response.data?.video_id) {
      return { ok: false, error: normalizeMetaError(response.status, response.data) };
    }
    return {
      ok: true,
      videoId: String(response.data.video_id),
      uploadUrl: response.data.upload_url ? String(response.data.upload_url) : undefined,
    };
  }

  /**
   * Phase 2: transfer the bytes to the upload host.
   *
   * This goes to `rupload.facebook.com`, not the Graph host, and authenticates
   * with a bare `OAuth {token}` header rather than a bearer token.
   */
  public async uploadFacebookReel(input: {
    videoId: string;
    pageAccessToken: string;
    filePath: string;
    uploadUrl?: string;
  }): Promise<{ ok: true } | { ok: false; error: NormalizedProviderError }> {
    try {
      const fileSize = fs.statSync(input.filePath).size;
      const body = await fs.readFile(input.filePath);
      const url = input.uploadUrl || `${RUPLOAD}/video-upload/${GRAPH_VERSION}/${input.videoId}`;
      const response = await this.http.post(url, body, {
        headers: {
          Authorization: `OAuth ${input.pageAccessToken}`,
          offset: "0",
          file_size: String(fileSize),
          "Content-Type": "application/octet-stream",
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });
      if (response.status < 200 || response.status >= 300) {
        return { ok: false, error: normalizeMetaError(response.status, response.data) };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: normalizeTransportError("meta", error) };
    }
  }

  /** Phase 3: publish the reserved video. */
  public async finishFacebookReel(input: {
    pageId: string;
    pageAccessToken: string;
    videoId: string;
    description?: string;
    scheduledPublishTime?: Date;
  }): Promise<{ ok: true; postId: string } | { ok: false; error: NormalizedProviderError }> {
    const params: Record<string, unknown> = {
      upload_phase: "finish",
      video_id: input.videoId,
      video_state: input.scheduledPublishTime ? "SCHEDULED" : "PUBLISHED",
      access_token: input.pageAccessToken,
    };
    if (input.description) params.description = input.description.slice(0, 5000);
    if (input.scheduledPublishTime) {
      params.scheduled_publish_time = Math.floor(input.scheduledPublishTime.getTime() / 1000);
    }

    const response = await this.http.post(`${GRAPH}/${input.pageId}/video_reels`, null, { params });
    if (response.status < 200 || response.status >= 300 || response.data?.success === false) {
      return { ok: false, error: normalizeMetaError(response.status, response.data) };
    }
    return { ok: true, postId: input.videoId };
  }

  // --------------------------------------------------------------- publish

  public async publishVideo(params: PublishVideoParams): Promise<PublishResult> {
    const metadata = (params.metadata || {}) as Record<string, unknown>;
    const accessToken = metadata.accessToken as string | undefined;
    const meta = params.metadata?.meta || {};

    if (!accessToken) {
      return {
        success: false,
        status: "failed",
        error: "No Meta account is connected.",
        technicalError: "meta:no_access_token",
        retryable: false,
      };
    }

    if (params.platform === "instagram") {
      if (!meta.instagramUserId) {
        return {
          success: false,
          status: "failed",
          error: "Professional Account Required. Link an Instagram Business or Creator account to the selected Page.",
          technicalError: "meta:no_instagram_user",
          retryable: false,
        };
      }
      if (!params.videoUrl || !/^https:\/\//i.test(params.videoUrl)) {
        return {
          success: false,
          status: "failed",
          error:
            "Instagram downloads the video from a public HTTPS address. This installation has no public video URL configured.",
          technicalError: "meta:no_public_video_url",
          retryable: false,
        };
      }

      const container = await this.createInstagramReelContainer({
        instagramUserId: meta.instagramUserId,
        accessToken,
        videoUrl: params.videoUrl,
        caption: params.caption || params.description,
        shareToFeed: params.metadata?.reelSettings?.shareToFeed,
        isAiGenerated: Boolean(params.metadata?.containsSyntheticMedia),
      });
      if (!container.ok) {
        return {
          success: false,
          status: "failed",
          error: container.error.userMessage,
          technicalError: container.error.technicalCode,
          retryable: container.error.retryable,
        };
      }

      // The container is not publishable until Instagram finishes ingesting it,
      // so the publication stays in `processing` and the status poller finishes
      // the job. Blocking here would tie up the request for minutes.
      return {
        success: true,
        status: "processing",
        providerPostId: container.containerId,
        message: "Instagram is preparing the Reel.",
        rawResponse: { stage: "container_created" },
      };
    }

    if (params.platform === "facebook") {
      if (!meta.pageId) {
        return {
          success: false,
          status: "failed",
          error: "Choose which Facebook Page to publish to.",
          technicalError: "meta:no_page_selected",
          retryable: false,
        };
      }
      if (!fs.existsSync(params.videoFilePath)) {
        return {
          success: false,
          status: "failed",
          error: "The video file is missing from storage.",
          technicalError: "meta:file_missing",
          retryable: false,
        };
      }

      const started = await this.startFacebookReel({ pageId: meta.pageId, pageAccessToken: accessToken });
      if (!started.ok) {
        return {
          success: false,
          status: "failed",
          error: started.error.userMessage,
          technicalError: started.error.technicalCode,
          retryable: started.error.retryable,
        };
      }

      const uploaded = await this.uploadFacebookReel({
        videoId: started.videoId,
        pageAccessToken: accessToken,
        filePath: params.videoFilePath,
        uploadUrl: started.uploadUrl,
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

      const finished = await this.finishFacebookReel({
        pageId: meta.pageId,
        pageAccessToken: accessToken,
        videoId: started.videoId,
        description: params.description || params.caption,
      });
      if (!finished.ok) {
        return {
          success: false,
          status: "failed",
          error: finished.error.userMessage,
          technicalError: finished.error.technicalCode,
          retryable: finished.error.retryable,
        };
      }

      return {
        success: true,
        status: "processing",
        providerPostId: finished.postId,
        message: "Facebook is processing the Reel.",
      };
    }

    return {
      success: false,
      status: "failed",
      error: `${params.platform} is not published through the Meta adapter.`,
      technicalError: "meta:unsupported_platform",
      retryable: false,
    };
  }

  public async scheduleVideo(params: ScheduleVideoParams): Promise<PublishResult> {
    return this.publishVideo(params);
  }

  /**
   * Finishes what `publishVideo` started.
   *
   * Instagram genuinely needs a second call after ingestion, so the status poll
   * is where the container becomes a published Reel. That is why a Meta
   * publication is never reported as published on the first pass.
   */
  public async getStatus(
    providerPostId: string,
    context?: Record<string, unknown>,
  ): Promise<PublishStatusResult> {
    const accessToken = context?.accessToken as string | undefined;
    const platform = context?.platform as PublishingPlatform | undefined;
    const instagramUserId = context?.instagramUserId as string | undefined;

    if (!accessToken) {
      return { status: "processing", providerPostId, message: "Cannot check Meta without a connected account." };
    }

    if (platform === "instagram" && instagramUserId) {
      const container = await this.getInstagramContainerStatus({ containerId: providerPostId, accessToken });
      if (container.statusCode === "FINISHED") {
        const published = await this.publishInstagramContainer({
          instagramUserId,
          containerId: providerPostId,
          accessToken,
        });
        if (!published.ok) {
          return { status: "failed", providerPostId, error: published.error.userMessage };
        }
        const permalink = await this.getInstagramPermalink({ mediaId: published.mediaId, accessToken });
        return {
          status: "published",
          providerPostId: published.mediaId,
          providerUrl: permalink,
        };
      }
      if (container.statusCode === "ERROR" || container.statusCode === "EXPIRED") {
        return {
          status: "failed",
          providerPostId,
          error:
            container.error?.userMessage ||
            "Instagram could not process this video. Reels need vertical MP4 with H.264 video and AAC audio.",
        };
      }
      if (container.statusCode === "PUBLISHED") {
        return { status: "published", providerPostId };
      }
      return { status: "processing", providerPostId, message: "Instagram is still preparing the Reel." };
    }

    // Facebook: the Page video reports its own phases.
    const response = await this.http.get(`${GRAPH}/${providerPostId}`, {
      params: { fields: "status,permalink_url", access_token: accessToken },
    });
    if (response.status < 200 || response.status >= 300) {
      const error = normalizeMetaError(response.status, response.data);
      return { status: "processing", providerPostId, message: error.userMessage };
    }
    const publishingPhase = response.data?.status?.publishing_phase?.status;
    const processingPhase = response.data?.status?.processing_phase?.status;
    if (publishingPhase === "complete") {
      const permalink = response.data?.permalink_url;
      return {
        status: "published",
        providerPostId,
        providerUrl: typeof permalink === "string" ? `https://www.facebook.com${permalink}` : undefined,
      };
    }
    if (publishingPhase === "error" || processingPhase === "error") {
      return { status: "failed", providerPostId, error: "Facebook could not publish this Reel." };
    }
    return { status: "processing", providerPostId, message: "Facebook is still processing the Reel." };
  }

  public async cancel(): Promise<boolean> {
    return false;
  }

  /**
   * Meta permalinks are only known from the API. Building one from an id would
   * be a guess, and Instagram shortcodes are not derivable from a media id.
   */
  public getPublishedUrl(_providerPostId: string, data?: Record<string, unknown>): string | undefined {
    const permalink = data?.permalink;
    return typeof permalink === "string" ? permalink : undefined;
  }
}
