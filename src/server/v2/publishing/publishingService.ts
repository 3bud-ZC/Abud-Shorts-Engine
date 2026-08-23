import { EventEmitter } from "events";
import axios from "axios";
import cuid from "cuid";
import fs from "fs";
import path from "path";
import type { Response as ExpressResponse } from "express";
import { Config } from "../../../config";
import { logger } from "../../../logger";
import { V2Database } from "../db";
import { readMetadata } from "../../videoMetadata";
import { PublishingProviderRegistry, publishingRegistry } from "./registry";
import {
  DEFAULT_PLATFORM_CAPABILITIES,
  type PlatformCapabilities,
  type PublishingProvider,
  type PublishResult,
} from "./publishingProvider";
import {
  type BatchPublicationInput,
  type CreatePublicationInput,
  type CreateSocialAccountInput,
  type OverallDistributionStatus,
  type PlatformMetadata,
  type PublicationRecord,
  type PublishingAttemptRecord,
  type PublishingEventRecord,
  type PublishingPlatform,
  type PublishingProviderId,
  type PublishingStatus,
  type PublishingSummary,
  type ScheduledPublicationRecord,
  type SocialAccountRecord,
} from "./types";

export function maskSecret(secret?: string): string {
  if (!secret) return "";
  if (secret.length <= 8) return "****";
  return `${secret.slice(0, 4)}****${secret.slice(-4)}`;
}

export function isRetryablePublishError(error: unknown, result?: PublishResult): boolean {
  if (result?.retryable !== undefined) return result.retryable;
  if (!error) return false;

  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (
    msg.includes("rate limit") ||
    msg.includes("429") ||
    msg.includes("timeout") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("econnaborted") ||
    msg.includes("500") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504") ||
    msg.includes("temporarily unavailable")
  ) {
    return true;
  }
  return false;
}

export function calculateBackoffMs(attempt: number): number {
  const base = 1000;
  const backoff = base * Math.pow(2, Math.min(attempt, 6));
  return Math.min(backoff, 60000);
}

export class PublishingService {
  private events = new EventEmitter();
  private maxRetries = 3;
  private maxConcurrency = 3;
  private activePublishCount = 0;

  constructor(
    private db: V2Database,
    private config: Config,
    private registry: PublishingProviderRegistry = publishingRegistry,
  ) {
    this.events.setMaxListeners(300);
  }

  // =========================================================================
  // SOCIAL ACCOUNTS
  // =========================================================================

  public async listAccounts(): Promise<SocialAccountRecord[]> {
    const rows = await this.db.query(
      `SELECT * FROM social_accounts ORDER BY created_at DESC`,
    );
    return rows.map((r) => this.mapAccountRow(r));
  }

  public async getAccount(id: string): Promise<SocialAccountRecord | null> {
    const rows = await this.db.query(
      `SELECT * FROM social_accounts WHERE id = $1`,
      [id],
    );
    if (!rows.length) return null;
    return this.mapAccountRow(rows[0]);
  }

  public async createAccount(input: CreateSocialAccountInput & { token?: string }): Promise<SocialAccountRecord> {
    const id = cuid();
    const token = input.token || (input.credentials?.token as string) || (input.credentials?.apiKey as string);
    const masked = maskSecret(token);
    const capabilities = this.registry.getPlatformCapabilities(input.platform as PublishingPlatform, input.provider as PublishingProviderId);

    const rows = await this.db.query(
      `INSERT INTO social_accounts (
        id, platform, account_name, account_id, provider, connection_status,
        capabilities, encrypted_credentials, last_checked_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now(), now())
      RETURNING *`,
      [
        id,
        input.platform,
        input.accountName,
        input.accountId,
        input.provider,
        "connected",
        JSON.stringify(capabilities),
        token || "",
      ],
    );

    const account = this.mapAccountRow(rows[0]);
    logger.info({ accountId: id, platform: input.platform, provider: input.provider }, "Social account connected");
    return account;
  }

  public async updateAccount(
    id: string,
    input: { accountName?: string; connectionStatus?: string; token?: string },
  ): Promise<SocialAccountRecord | null> {
    const existing = await this.getAccount(id);
    if (!existing) return null;

    const token = input.token;
    const rows = await this.db.query(
      `UPDATE social_accounts SET
        account_name = COALESCE($2, account_name),
        connection_status = COALESCE($3, connection_status),
        encrypted_credentials = CASE WHEN $4::text IS NOT NULL THEN $4 ELSE encrypted_credentials END,
        updated_at = now()
      WHERE id = $1
      RETURNING *`,
      [id, input.accountName || null, input.connectionStatus || null, token || null],
    );
    if (!rows.length) return null;
    return this.mapAccountRow(rows[0]);
  }

  public async deleteAccount(id: string): Promise<boolean> {
    const rows = await this.db.query(
      `DELETE FROM social_accounts WHERE id = $1 RETURNING id`,
      [id],
    );
    return rows.length > 0;
  }

  public async testAccountConnection(id: string): Promise<{
    account: SocialAccountRecord;
    healthy: boolean;
    status: string;
    message: string;
  }> {
    const account = await this.getAccount(id);
    if (!account) throw new Error("Account not found.");

    const rawRows = await this.db.query<{ encrypted_credentials?: string }>(
      `SELECT encrypted_credentials FROM social_accounts WHERE id = $1`,
      [id],
    );
    const token = rawRows[0]?.encrypted_credentials;

    const provider = this.registry.getProvider(account.provider);
    if (!provider) {
      return {
        account,
        healthy: false,
        status: "provider_unavailable",
        message: `Provider ${account.provider} not found.`,
      };
    }

    const valResult = await provider.validateConnection(
      { token, apiKey: token, botToken: token, accessToken: token },
      account.accountId,
    );

    const newStatus = valResult.healthy ? "connected" : "error";
    await this.db.query(
      `UPDATE social_accounts SET connection_status = $2, last_checked_at = now(), updated_at = now() WHERE id = $1`,
      [id, newStatus],
    );

    const updated = (await this.getAccount(id)) || account;
    return {
      account: updated,
      healthy: valResult.healthy,
      status: valResult.status,
      message: valResult.message,
    };
  }

  // =========================================================================
  // PUBLICATIONS
  // =========================================================================

  public async getPublication(id: string): Promise<PublicationRecord | null> {
    const rows = await this.db.query(
      `SELECT p.*, a.account_name
       FROM publications p
       LEFT JOIN social_accounts a ON p.account_id = a.id
       WHERE p.id = $1`,
      [id],
    );
    if (!rows.length) return null;
    return this.mapPublicationRow(rows[0]);
  }

  public async listPublications(filters: {
    platform?: PublishingPlatform;
    status?: PublishingStatus;
    accountId?: string;
    videoId?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ publications: PublicationRecord[]; total: number }> {
    let whereClauses: string[] = [];
    let values: any[] = [];

    if (filters.platform) {
      values.push(filters.platform);
      whereClauses.push(`p.platform = $${values.length}`);
    }
    if (filters.status) {
      values.push(filters.status);
      whereClauses.push(`p.status = $${values.length}`);
    }
    if (filters.accountId) {
      values.push(filters.accountId);
      whereClauses.push(`p.account_id = $${values.length}`);
    }
    if (filters.videoId) {
      values.push(filters.videoId);
      whereClauses.push(`p.video_id = $${values.length}`);
    }

    const whereStr = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const countRows = await this.db.query(
      `SELECT COUNT(*)::int as count FROM publications p ${whereStr}`,
      values,
    );
    const total = countRows[0]?.count || 0;

    const limit = Math.min(filters.limit || 50, 100);
    const offset = filters.offset || 0;

    values.push(limit);
    const limitParam = values.length;
    values.push(offset);
    const offsetParam = values.length;

    const rows = await this.db.query(
      `SELECT p.*, a.account_name
       FROM publications p
       LEFT JOIN social_accounts a ON p.account_id = a.id
       ${whereStr}
       ORDER BY p.created_at DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      values,
    );

    return {
      publications: rows.map((r) => this.mapPublicationRow(r)),
      total,
    };
  }

  public async getPublicationsForVideo(videoId: string): Promise<PublicationRecord[]> {
    const rows = await this.db.query(
      `SELECT p.*, a.account_name
       FROM publications p
       LEFT JOIN social_accounts a ON p.account_id = a.id
       WHERE p.video_id = $1
       ORDER BY p.created_at DESC`,
      [videoId],
    );
    return rows.map((r) => this.mapPublicationRow(r));
  }

  public async getOverallVideoStatus(videoId: string): Promise<{
    status: OverallDistributionStatus;
    platforms: Record<PublishingPlatform, { status: PublishingStatus; url?: string; error?: string }>;
    publications: PublicationRecord[];
  }> {
    const publications = await this.getPublicationsForVideo(videoId);
    const platformMap: Record<string, { status: PublishingStatus; url?: string; error?: string }> = {};

    for (const pub of publications) {
      platformMap[pub.platform] = {
        status: pub.status,
        url: pub.providerUrl,
        error: pub.lastError,
      };
    }

    let overall: OverallDistributionStatus = "not_published";
    if (publications.length === 0) {
      overall = "not_published";
    } else {
      const statuses = publications.map((p) => p.status);
      const allPublished = statuses.every((s) => s === "published");
      const anyPublished = statuses.some((s) => s === "published");
      const anyPublishing = statuses.some((s) => ["uploading", "processing", "queued"].includes(s));
      const anyScheduled = statuses.some((s) => s === "scheduled");
      const allFailed = statuses.every((s) => s === "failed" || s === "canceled");

      if (allPublished) {
        overall = "published";
      } else if (anyPublished) {
        overall = "partially_published";
      } else if (anyPublishing) {
        overall = "publishing";
      } else if (anyScheduled) {
        overall = "scheduled";
      } else if (allFailed) {
        overall = "failed";
      }
    }

    return {
      status: overall,
      platforms: platformMap as any,
      publications,
    };
  }

  public async createPublication(
    input: Partial<CreatePublicationInput> & {
      videoId: string;
      platform: PublishingPlatform;
    },
  ): Promise<PublicationRecord> {
    // Check Idempotency Key
    if (input.idempotencyKey) {
      const existingRows = await this.db.query(
        `SELECT p.*, a.account_name FROM publications p LEFT JOIN social_accounts a ON p.account_id = a.id WHERE p.idempotency_key = $1`,
        [input.idempotencyKey],
      );
      if (existingRows.length > 0) {
        logger.info({ idempotencyKey: input.idempotencyKey }, "Returning idempotent publication");
        return this.mapPublicationRow(existingRows[0]);
      }
    }

    const id = cuid();
    const providerId: PublishingProviderId =
      (input.provider as PublishingProviderId) ||
      (input.platform === "telegram" ? "telegram_bot" : "upload_post");

    // Resolve Account
    let accountId = input.accountId;
    if (!accountId) {
      const accRows = await this.db.query(
        `SELECT id FROM social_accounts WHERE platform = $1 AND connection_status = 'connected' LIMIT 1`,
        [input.platform],
      );
      if (accRows.length) accountId = accRows[0].id;
    }

    // Determine initial status & schedule
    let scheduledDate: Date | undefined;
    let initialStatus: PublishingStatus = "draft";

    if (input.scheduledAt) {
      const parsed = new Date(input.scheduledAt);
      if (!isNaN(parsed.getTime())) {
        scheduledDate = parsed;
        initialStatus = "scheduled";
      }
    }

    if (input.publishNow) {
      initialStatus = "queued";
      scheduledDate = undefined;
    }

    const hashtags = input.hashtags || [];
    const metadata = input.metadata || {};

    const rows = await this.db.query(
      `INSERT INTO publications (
        id, video_id, platform, account_id, status, title, caption, description,
        hashtags, metadata, scheduled_at, source_timezone, provider, attempt_count,
        idempotency_key, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 0, $14, now(), now()
      ) RETURNING *`,
      [
        id,
        input.videoId,
        input.platform,
        accountId || null,
        initialStatus,
        input.title || null,
        input.caption || null,
        input.description || null,
        JSON.stringify(hashtags),
        JSON.stringify(metadata),
        scheduledDate || null,
        input.sourceTimezone || "UTC",
        providerId,
        input.idempotencyKey || null,
      ],
    );

    const publication = this.mapPublicationRow(rows[0]);

    // Record created event
    await this.recordEvent(
      id,
      initialStatus,
      "created",
      `Publication created for ${input.platform} (${initialStatus}).`,
    );

    // If scheduled, insert into scheduled_publications
    if (initialStatus === "scheduled" && scheduledDate) {
      await this.db.query(
        `INSERT INTO scheduled_publications (
          id, publication_id, video_id, scheduled_at, timezone, status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, 'pending', now(), now())`,
        [cuid(), id, input.videoId, scheduledDate, input.sourceTimezone || "UTC"],
      );
      await this.recordEvent(
        id,
        "scheduled",
        "scheduled",
        `Scheduled for ${scheduledDate.toISOString()} (${input.sourceTimezone || "UTC"}).`,
      );
    }

    this.broadcastEvent({
      id: String(Date.now()),
      publicationId: id,
      status: initialStatus,
      stage: "created",
      message: `Publication ${id} created.`,
      createdAt: new Date(),
    });

    // If publishNow, dispatch execution asynchronously
    if (initialStatus === "queued") {
      setImmediate(() => {
        this.publishPublication(id).catch((err) => {
          logger.error({ err, publicationId: id }, "Immediate publish failed");
        });
      });
    }

    return publication;
  }

  public async batchPublish(input: BatchPublicationInput): Promise<PublicationRecord[]> {
    const created: PublicationRecord[] = [];

    for (const videoId of input.videoIds) {
      for (const platform of input.platforms) {
        const idempotencyKey = `batch_${videoId}_${platform}_${Date.now()}`;
        const pub = await this.createPublication({
          videoId,
          platform,
          scheduledAt: input.scheduledAt,
          sourceTimezone: input.sourceTimezone,
          metadata: {
            privacy: input.privacy,
          },
          publishNow: input.publishNow,
          idempotencyKey,
        });
        created.push(pub);
      }
    }

    return created;
  }

  public isN8nAvailable(): boolean {
    return Boolean(this.config.n8nBaseUrl);
  }

  public async dispatchViaN8n(publicationId: string): Promise<PublicationRecord> {
    const pub = await this.getPublication(publicationId);
    if (!pub) throw new Error(`Publication ${publicationId} not found.`);

    if (["published", "uploading"].includes(pub.status)) {
      return pub;
    }

    try {
      const response = await axios.post(
        `${this.config.n8nBaseUrl}/webhook/abud-v2/publishing/publish`,
        {
          publicationId,
          videoId: pub.videoId,
          platform: pub.platform,
          appBaseUrl: this.config.appInternalBaseUrl,
        },
        {
          timeout: 65000,
          headers: {
            "x-internal-token": this.config.internalServiceToken,
            "Content-Type": "application/json",
          },
        },
      );

      logger.info({ publicationId, n8nStatus: response.status }, "n8n publishing orchestration completed");
      return (await this.getPublication(publicationId)) || pub;
    } catch (n8nError) {
      logger.warn({ n8nError, publicationId }, "n8n publishing webhook unavailable; falling back to direct domain execution");
      return await this.publishPublication(publicationId);
    }
  }

  public async publishPublication(publicationId: string): Promise<PublicationRecord> {
    const pub = await this.getPublication(publicationId);
    if (!pub) throw new Error(`Publication ${publicationId} not found.`);

    if (["published", "uploading"].includes(pub.status)) {
      return pub;
    }

    // Resolve Provider
    const provider = this.registry.getProviderForPlatform(pub.platform, pub.provider);
    if (!provider) {
      const errorMsg = `No publishing provider registered for platform ${pub.platform}.`;
      await this.failPublication(pub.id, errorMsg, "PROVIDER_NOT_FOUND", false);
      return (await this.getPublication(publicationId)) || pub;
    }

    // Resolve Account & Credentials
    let account = pub.accountId ? await this.getAccount(pub.accountId) : null;
    let token: string | undefined;

    if (account) {
      const credRows = await this.db.query<{ encrypted_credentials?: string }>(
        `SELECT encrypted_credentials FROM social_accounts WHERE id = $1`,
        [account.id],
      );
      token = credRows[0]?.encrypted_credentials;
    }

    // Resolve Video Files & URLs
    const videoFilePath = path.join(this.config.videosDirPath, `${pub.videoId}.mp4`);
    const thumbnailFilePath = path.join(this.config.videosDirPath, `${pub.videoId}.jpg`);
    const videoUrl = `${this.config.v2PublicUrl}/api/short-video/${pub.videoId}`;
    const thumbnailUrl = `${this.config.v2PublicUrl}/api/videos/${pub.videoId}/thumbnail`;

    const attemptNumber = pub.attemptCount + 1;
    await this.updateStatus(pub.id, "uploading", {
      attemptCount: attemptNumber,
    });
    await this.recordEvent(pub.id, "uploading", "upload_started", "Starting video upload to platform.");

    const attemptId = await this.recordAttemptStart(pub.id, attemptNumber);

    try {
      const publishResult = await provider.publishVideo({
        publicationId: pub.id,
        videoId: pub.videoId,
        videoFilePath,
        videoUrl,
        thumbnailFilePath: fs.existsSync(thumbnailFilePath) ? thumbnailFilePath : undefined,
        thumbnailUrl,
        platform: pub.platform,
        account: account
          ? {
              ...account,
              encryptedCredentials: token,
            }
          : undefined,
        title: pub.title,
        caption: pub.caption,
        description: pub.description,
        hashtags: pub.hashtags,
        metadata: pub.metadata,
        idempotencyKey: pub.idempotencyKey,
      });

      if (publishResult.success) {
        await this.db.query(
          `UPDATE publications SET
            status = $2,
            provider_post_id = $3,
            provider_url = $4,
            published_at = now(),
            last_error = null,
            technical_error = null,
            updated_at = now()
          WHERE id = $1`,
          [
            pub.id,
            publishResult.status === "processing" ? "processing" : "published",
            publishResult.providerPostId || null,
            publishResult.providerUrl || null,
          ],
        );

        await this.recordAttemptComplete(attemptId, "succeeded", publishResult.rawResponse);
        await this.recordEvent(
          pub.id,
          publishResult.status === "processing" ? "processing" : "published",
          "provider_accepted",
          publishResult.message || `Published successfully on ${pub.platform}.`,
          undefined,
          publishResult.rawResponse,
        );

        // Update schedule table if exists
        await this.db.query(
          `UPDATE scheduled_publications SET status = 'executed', updated_at = now() WHERE publication_id = $1`,
          [pub.id],
        );

        const finalPub = await this.getPublication(pub.id);
        this.broadcastEvent({
          id: String(Date.now()),
          publicationId: pub.id,
          status: publishResult.status === "processing" ? "processing" : "published",
          stage: "published",
          message: `Published to ${pub.platform}`,
          createdAt: new Date(),
        });
        return finalPub || pub;
      }

      // Handled Provider Failure
      const retryable = isRetryablePublishError(null, publishResult);
      await this.recordAttemptComplete(
        attemptId,
        "failed",
        publishResult.rawResponse,
        publishResult.error,
        publishResult.technicalError,
      );

      if (retryable && attemptNumber < this.maxRetries) {
        const backoffMs = calculateBackoffMs(attemptNumber);
        await this.recordEvent(
          pub.id,
          "queued",
          "retrying",
          `Publish failed: ${publishResult.error}. Retrying in ${Math.round(backoffMs / 1000)}s (Attempt ${attemptNumber + 1}/${this.maxRetries}).`,
        );

        setTimeout(() => {
          this.publishPublication(pub.id).catch((err) => {
            logger.error({ err, publicationId: pub.id }, "Retry execution error");
          });
        }, backoffMs);

        await this.updateStatus(pub.id, "queued");
        return (await this.getPublication(pub.id)) || pub;
      }

      await this.failPublication(
        pub.id,
        publishResult.error || "Publish failed on provider.",
        publishResult.technicalError,
        retryable,
      );
      return (await this.getPublication(pub.id)) || pub;
    } catch (error: any) {
      const retryable = isRetryablePublishError(error);
      const errMsg = error instanceof Error ? error.message : String(error);
      const techMsg = error.stack || String(error);

      await this.recordAttemptComplete(attemptId, "failed", undefined, errMsg, techMsg);

      if (retryable && attemptNumber < this.maxRetries) {
        const backoffMs = calculateBackoffMs(attemptNumber);
        await this.recordEvent(
          pub.id,
          "queued",
          "retrying",
          `Publish threw error: ${errMsg}. Retrying in ${Math.round(backoffMs / 1000)}s (Attempt ${attemptNumber + 1}/${this.maxRetries}).`,
        );

        setTimeout(() => {
          this.publishPublication(pub.id).catch((err) => {
            logger.error({ err, publicationId: pub.id }, "Retry execution error");
          });
        }, backoffMs);

        await this.updateStatus(pub.id, "queued");
        return (await this.getPublication(pub.id)) || pub;
      }

      await this.failPublication(pub.id, errMsg, techMsg, retryable);
      return (await this.getPublication(pub.id)) || pub;
    }
  }

  public async retryPublication(publicationId: string): Promise<PublicationRecord> {
    const pub = await this.getPublication(publicationId);
    if (!pub) throw new Error("Publication not found.");

    await this.updateStatus(pub.id, "queued", {
      lastError: undefined,
      technicalError: undefined,
    });
    await this.recordEvent(pub.id, "queued", "retry_initiated", "Manual retry initiated by user.");

    return await this.publishPublication(pub.id);
  }

  public async cancelPublication(publicationId: string): Promise<PublicationRecord> {
    const pub = await this.getPublication(publicationId);
    if (!pub) throw new Error("Publication not found.");

    if (pub.providerPostId) {
      const provider = this.registry.getProvider(pub.provider);
      if (provider) {
        await provider.cancel(pub.providerPostId).catch(() => false);
      }
    }

    await this.db.query(
      `UPDATE scheduled_publications SET status = 'canceled', updated_at = now() WHERE publication_id = $1`,
      [pub.id],
    );

    await this.updateStatus(pub.id, "canceled");
    await this.recordEvent(pub.id, "canceled", "canceled", "Publication canceled by user.");

    return (await this.getPublication(pub.id)) || pub;
  }

  public async validateVideoForPlatform(
    videoId: string,
    platform: PublishingPlatform,
  ): Promise<{
    valid: boolean;
    warnings: string[];
    errors: string[];
    capabilities: PlatformCapabilities;
    videoStats: {
      durationSeconds?: number;
      aspectRatio?: string;
      sizeBytes?: number;
      resolution?: string;
    };
  }> {
    const capabilities = this.registry.getPlatformCapabilities(platform);
    const meta = readMetadata(this.config.videosDirPath, videoId);
    const warnings: string[] = [];
    const errors: string[] = [];

    const duration = meta?.durationSeconds ?? meta?.requestedDurationSeconds ?? 30;
    const aspect = meta?.aspectRatio || "9:16";
    const size = meta?.sizeBytes || 0;
    const resolution = meta?.resolution || "1080p";

    if (duration > capabilities.maxDurationSeconds) {
      errors.push(
        `Video duration (${duration}s) exceeds ${capabilities.displayName} max limit (${capabilities.maxDurationSeconds}s).`,
      );
    }
    if (duration < capabilities.minDurationSeconds) {
      errors.push(
        `Video duration (${duration}s) is shorter than ${capabilities.displayName} minimum (${capabilities.minDurationSeconds}s).`,
      );
    }

    if (!capabilities.supportedAspectRatios.includes(aspect)) {
      warnings.push(
        `Aspect ratio ${aspect} is not optimal for ${capabilities.displayName} (recommended: ${capabilities.supportedAspectRatios.join(", ")}).`,
      );
    }

    const sizeMB = size / (1024 * 1024);
    if (sizeMB > capabilities.maxFileSizeMB) {
      errors.push(
        `File size (${sizeMB.toFixed(1)}MB) exceeds ${capabilities.displayName} limit of ${capabilities.maxFileSizeMB}MB.`,
      );
    }

    return {
      valid: errors.length === 0,
      warnings,
      errors,
      capabilities,
      videoStats: {
        durationSeconds: duration,
        aspectRatio: aspect,
        sizeBytes: size,
        resolution,
      },
    };
  }

  public async getSummary(): Promise<PublishingSummary> {
    const countRows = await this.db.query<{
      status: string;
      count: string;
    }>(
      `SELECT status, COUNT(*)::text as count FROM publications GROUP BY status`,
    );

    const todayRows = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM publications WHERE status = 'published' AND published_at >= date_trunc('day', now())`,
    );

    const counts: Record<string, number> = {};
    for (const r of countRows) {
      counts[r.status] = parseInt(r.count, 10) || 0;
    }

    const scheduledCount = counts["scheduled"] || 0;
    const publishingCount = (counts["uploading"] || 0) + (counts["processing"] || 0) + (counts["queued"] || 0);
    const publishedTodayCount = parseInt(todayRows[0]?.count || "0", 10);
    const failedCount = counts["failed"] || 0;
    const totalPublications = Object.values(counts).reduce((a, b) => a + b, 0);

    return {
      scheduledCount,
      publishingCount,
      publishedTodayCount,
      failedCount,
      totalPublications,
    };
  }

  public async getEvents(publicationId: string): Promise<PublishingEventRecord[]> {
    const rows = await this.db.query(
      `SELECT * FROM publishing_events WHERE publication_id = $1 ORDER BY id ASC`,
      [publicationId],
    );
    return rows.map((r) => ({
      id: String(r.id),
      publicationId: r.publication_id,
      status: r.status as PublishingStatus,
      stage: r.stage,
      message: r.message,
      technicalMessage: r.technical_message,
      payload: r.payload,
      createdAt: new Date(r.created_at),
    }));
  }

  public subscribe(res: ExpressResponse): () => void {
    const handler = (event: PublishingEventRecord) => {
      res.write(`event: publishing-event\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    this.events.on("publishing-event", handler);
    return () => {
      this.events.off("publishing-event", handler);
    };
  }

  // =========================================================================
  // INTERNAL HELPERS
  // =========================================================================

  private async updateStatus(
    id: string,
    status: PublishingStatus,
    extra: {
      attemptCount?: number;
      lastError?: string;
      technicalError?: string;
      providerPostId?: string;
      providerUrl?: string;
    } = {},
  ): Promise<void> {
    await this.db.query(
      `UPDATE publications SET
        status = $2,
        attempt_count = COALESCE($3, attempt_count),
        last_error = CASE WHEN $4::text IS NOT NULL THEN $4 ELSE last_error END,
        technical_error = CASE WHEN $5::text IS NOT NULL THEN $5 ELSE technical_error END,
        provider_post_id = COALESCE($6, provider_post_id),
        provider_url = COALESCE($7, provider_url),
        updated_at = now()
      WHERE id = $1`,
      [
        id,
        status,
        extra.attemptCount ?? null,
        extra.lastError ?? null,
        extra.technicalError ?? null,
        extra.providerPostId ?? null,
        extra.providerUrl ?? null,
      ],
    );
  }

  private async failPublication(
    id: string,
    error: string,
    technicalError?: string,
    retryable: boolean = false,
  ): Promise<void> {
    await this.db.query(
      `UPDATE publications SET
        status = 'failed',
        last_error = $2,
        technical_error = $3,
        updated_at = now()
      WHERE id = $1`,
      [id, error, technicalError || null],
    );

    await this.db.query(
      `UPDATE scheduled_publications SET status = 'failed', updated_at = now() WHERE publication_id = $1`,
      [id],
    );

    await this.recordEvent(
      id,
      "failed",
      "failed",
      `Publishing failed: ${error}`,
      technicalError,
    );

    this.broadcastEvent({
      id: String(Date.now()),
      publicationId: id,
      status: "failed",
      stage: "failed",
      message: error,
      technicalMessage: technicalError,
      createdAt: new Date(),
    });
  }

  private async recordEvent(
    publicationId: string,
    status: PublishingStatus,
    stage: string,
    message: string,
    technicalMessage?: string,
    payload?: Record<string, unknown>,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO publishing_events (
        publication_id, status, stage, message, technical_message, payload, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, now())`,
      [
        publicationId,
        status,
        stage,
        message,
        technicalMessage || null,
        payload ? JSON.stringify(payload) : null,
      ],
    );
  }

  private async recordAttemptStart(
    publicationId: string,
    attemptNumber: number,
  ): Promise<string> {
    const rows = await this.db.query<{ id: string }>(
      `INSERT INTO publishing_attempts (
        publication_id, attempt_number, status, started_at
      ) VALUES ($1, $2, 'started', now()) RETURNING id`,
      [publicationId, attemptNumber],
    );
    return String(rows[0].id);
  }

  private async recordAttemptComplete(
    attemptId: string,
    status: "succeeded" | "failed",
    providerResponse?: Record<string, unknown>,
    error?: string,
    technicalError?: string,
  ): Promise<void> {
    await this.db.query(
      `UPDATE publishing_attempts SET
        status = $2,
        provider_response = $3,
        error = $4,
        technical_error = $5,
        completed_at = now()
      WHERE id = $1`,
      [
        attemptId,
        status,
        providerResponse ? JSON.stringify(providerResponse) : null,
        error || null,
        technicalError || null,
      ],
    );
  }

  private broadcastEvent(event: PublishingEventRecord): void {
    this.events.emit("publishing-event", event);
  }

  private mapAccountRow(r: any): SocialAccountRecord {
    return {
      id: r.id,
      platform: r.platform,
      accountName: r.account_name,
      accountId: r.account_id,
      provider: r.provider,
      connectionStatus: r.connection_status,
      capabilities: typeof r.capabilities === "string" ? JSON.parse(r.capabilities) : r.capabilities || {},
      maskedToken: maskSecret(r.encrypted_credentials),
      lastCheckedAt: new Date(r.last_checked_at || r.created_at),
      createdAt: new Date(r.created_at),
      updatedAt: new Date(r.updated_at),
    };
  }

  private mapPublicationRow(r: any): PublicationRecord {
    return {
      id: r.id,
      videoId: r.video_id,
      platform: r.platform,
      accountId: r.account_id,
      accountName: r.account_name,
      status: r.status,
      title: r.title,
      caption: r.caption,
      description: r.description,
      hashtags: typeof r.hashtags === "string" ? JSON.parse(r.hashtags) : r.hashtags || [],
      metadata: typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata || {},
      scheduledAt: r.scheduled_at ? new Date(r.scheduled_at) : undefined,
      publishedAt: r.published_at ? new Date(r.published_at) : undefined,
      sourceTimezone: r.source_timezone || "UTC",
      provider: r.provider,
      providerPostId: r.provider_post_id,
      providerUrl: r.provider_url,
      attemptCount: r.attempt_count || 0,
      lastError: r.last_error,
      technicalError: r.technical_error,
      idempotencyKey: r.idempotency_key,
      createdAt: new Date(r.created_at),
      updatedAt: new Date(r.updated_at),
    };
  }
}
