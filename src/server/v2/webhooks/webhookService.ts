import crypto from "crypto";
import axios from "axios";
import cuid from "cuid";
import { logger } from "../../../logger";
import { V2Database } from "../db";

export type WebhookEvent =
  | "job.created"
  | "job.started"
  | "job.stage.completed"
  | "job.stage.failed"
  | "job.stage.retry"
  | "job.ready"
  | "job.failed"
  | "video.ready"
  | "video.failed"
  | "video.revision.created"
  | "video.revision.ready"
  | "video.revision.finalized"
  | "publication.published"
  | "publication.failed";

export interface WebhookSubscription {
  id: string;
  url: string;
  secret: string;
  events: WebhookEvent[];
  isActive: boolean;
  createdAt: Date;
}

export interface WebhookDelivery {
  id: number;
  webhookId: string;
  event: WebhookEvent;
  payload: any;
  status: "success" | "failed";
  responseCode?: number;
  responseBody?: string;
  error?: string;
  attemptCount: number;
  createdAt: Date;
}

export class WebhookService {
  constructor(
    private db: V2Database,
    private options: { timeoutMs?: number } = {},
  ) {}

  public generateSigningSecret(): string {
    return "whsec_" + crypto.randomBytes(24).toString("hex");
  }

  private validateWebhookUrl(rawUrl: string): string {
    const parsed = new URL(rawUrl);
    if (!["https:", "http:"].includes(parsed.protocol)) {
      throw new Error("Webhook URL must use http or https.");
    }
    const host = parsed.hostname.toLowerCase();
    const blocked = [
      "localhost",
      "127.0.0.1",
      "0.0.0.0",
      "::1",
    ];
    if (
      blocked.includes(host) ||
      host.endsWith(".local") ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      throw new Error("Webhook URL cannot target localhost or private network addresses.");
    }
    return parsed.toString();
  }

  public signPayload(payload: string, secret: string, timestamp: string): string {
    return crypto
      .createHmac("sha256", secret)
      .update(`${timestamp}.${payload}`)
      .digest("hex");
  }

  public async listWebhooks(): Promise<WebhookSubscription[]> {
    if (!this.db.enabled) return [];
    try {
      const rows = await this.db.query<{
        id: string;
        url: string;
        secret: string;
        events: any;
        is_active: boolean;
        created_at: string;
      }>(`SELECT * FROM webhooks ORDER BY created_at DESC`);

      return rows.map((r) => ({
        id: r.id,
        url: r.url,
        secret: r.secret ? `${r.secret.slice(0, 10)}****` : "",
        events: typeof r.events === "string" ? JSON.parse(r.events) : r.events || [],
        isActive: r.is_active,
        createdAt: new Date(r.created_at),
      }));
    } catch {
      return [];
    }
  }

  public async createWebhook(url: string, events: WebhookEvent[] = []): Promise<WebhookSubscription> {
    const id = cuid();
    const secret = this.generateSigningSecret();
    const safeUrl = this.validateWebhookUrl(url);

    if (this.db.enabled) {
      await this.db.query(
        `INSERT INTO webhooks (id, url, secret, events, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, true, now(), now())`,
        [id, safeUrl, secret, JSON.stringify(events)],
      );
    }

    return {
      id,
      url: safeUrl,
      secret,
      events,
      isActive: true,
      createdAt: new Date(),
    };
  }

  public async deleteWebhook(id: string): Promise<boolean> {
    if (this.db.enabled) {
      await this.db.query(`DELETE FROM webhooks WHERE id = $1`, [id]);
    }
    return true;
  }

  public async dispatchEvent(event: WebhookEvent, data: Record<string, any>): Promise<void> {
    if (!this.db.enabled) return;

    try {
      const hooks = await this.db.query<{
        id: string;
        url: string;
        secret: string;
        events: any;
        is_active: boolean;
      }>(`SELECT * FROM webhooks WHERE is_active = true`);

      for (const hook of hooks) {
        const eventsList: WebhookEvent[] =
          typeof hook.events === "string" ? JSON.parse(hook.events) : hook.events || [];
        if (eventsList.length > 0 && !eventsList.includes(event)) {
          continue;
        }

        this.sendWebhook(hook, event, data).catch((err) => {
          logger.error({ err, webhookId: hook.id, event }, "Webhook dispatch background failed");
        });
      }
    } catch (error) {
      logger.error({ error, event }, "Error querying webhooks for event");
    }
  }

  private async sendWebhook(hook: { id: string; url: string; secret: string }, event: WebhookEvent, data: any): Promise<void> {
    const payload = {
      event,
      data,
      timestamp: new Date().toISOString(),
    };
    const payloadStr = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = this.signPayload(payloadStr, hook.secret, timestamp);

    let status: "success" | "failed" = "failed";
    let responseCode: number | undefined;
    let responseBody: string | undefined;
    let error: string | undefined;

    let attemptCount = 0;
    for (let attempt = 1; attempt <= 3; attempt++) {
      attemptCount = attempt;
      try {
        const res = await axios.post(hook.url, payload, {
          headers: {
            "Content-Type": "application/json",
            "x-abud-signature": `sha256=${signature}`,
            "x-abud-timestamp": timestamp,
            "x-abud-signature-version": "hmac-sha256-v1",
            "User-Agent": "ABUD-Shorts-Engine-Webhooks/2.1",
          },
          timeout: this.options.timeoutMs || 10000,
        });
        status = res.status >= 200 && res.status < 300 ? "success" : "failed";
        responseCode = res.status;
        responseBody = typeof res.data === "string" ? res.data.slice(0, 500) : JSON.stringify(res.data).slice(0, 500);
        if (status === "success") break;
      } catch (err: any) {
        status = "failed";
        responseCode = err.response?.status;
        error = err.message;
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }

    if (this.db.enabled) {
      await this.db.query(
        `INSERT INTO webhook_deliveries (
          webhook_id, event, payload, status, response_code, response_body, error,
          attempt_count, next_attempt_at, signature_version, created_at
        )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'hmac-sha256-v1', now())`,
        [
          hook.id,
          event,
          JSON.stringify(payload),
          status,
          responseCode || null,
          responseBody || null,
          error || null,
          attemptCount,
          status === "success" ? null : new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        ],
      );
    }
  }

  public async getDeliveryHistory(limit = 20): Promise<WebhookDelivery[]> {
    if (!this.db.enabled) return [];
    try {
      const rows = await this.db.query<{
        id: string;
        webhook_id: string;
        event: WebhookEvent;
        payload: any;
        status: "success" | "failed";
        response_code: number;
        response_body: string;
        error: string;
        attempt_count: number;
        created_at: string;
      }>(`SELECT * FROM webhook_deliveries ORDER BY id DESC LIMIT $1`, [limit]);

      return rows.map((r) => ({
        id: parseInt(r.id, 10),
        webhookId: r.webhook_id,
        event: r.event,
        payload: typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload,
        status: r.status,
        responseCode: r.response_code,
        responseBody: r.response_body,
        error: r.error,
        attemptCount: r.attempt_count,
        createdAt: new Date(r.created_at),
      }));
    } catch {
      return [];
    }
  }
}
