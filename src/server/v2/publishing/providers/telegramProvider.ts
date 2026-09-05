import axios from "axios";
import fs from "fs";
import path from "path";
import { logger } from "../../../../logger";
import {
  normalizeTelegramError,
  normalizeTransportError,
  type NormalizedProviderError,
} from "../../integrations/providerErrors";
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

export class TelegramPublishingProvider implements PublishingProvider {
  public readonly id: PublishingProviderId = "telegram_bot";
  public readonly displayName = "Telegram Direct Bot";
  public readonly category = "publishing" as const;

  private botToken?: string;
  private defaultChatId?: string;

  constructor(options: { botToken?: string; defaultChatId?: string } = {}) {
    this.botToken = options.botToken || process.env.TELEGRAM_BOT_TOKEN;
    this.defaultChatId = options.defaultChatId || process.env.TELEGRAM_CHAT_ID;
  }

  public getSupportedPlatforms(): PublishingPlatform[] {
    return ["telegram"];
  }

  public getCapabilities(platform: PublishingPlatform): PlatformCapabilities {
    return DEFAULT_PLATFORM_CAPABILITIES.telegram;
  }

  public async validateConnection(
    credentials?: Record<string, unknown>,
    accountId?: string,
  ): Promise<PublishingValidationResult> {
    const token =
      (credentials?.botToken as string) ||
      (credentials?.token as string) ||
      (credentials?.apiKey as string) ||
      this.botToken;

    const checkedAt = new Date().toISOString();
    const started = Date.now();

    if (!token || token.trim().length === 0) {
      return {
        provider: this.displayName,
        platform: "telegram",
        configured: false,
        healthy: false,
        status: "not_configured",
        message: "Telegram bot token is not configured.",
        checkedAt,
        latencyMs: Date.now() - started,
      };
    }

    try {
      const response = await axios.get(`https://api.telegram.org/bot${token}/getMe`, {
        timeout: 10000,
        validateStatus: () => true,
      });

      const latencyMs = Date.now() - started;

      if (response.status === 200 && response.data?.ok) {
        const bot = response.data.result;
        return {
          provider: this.displayName,
          platform: "telegram",
          configured: true,
          healthy: true,
          status: "healthy",
          message: `Telegram Bot @${bot.username} connected successfully.`,
          accountDetails: {
            accountName: `@${bot.username}`,
            accountId: String(bot.id),
          },
          checkedAt,
          latencyMs,
        };
      }

      if (response.status === 401 || response.status === 404) {
        return {
          provider: this.displayName,
          platform: "telegram",
          configured: true,
          healthy: false,
          status: "invalid_credentials",
          message: "Telegram rejected the Bot Token (unauthorized).",
          checkedAt,
          latencyMs,
        };
      }

      if (response.status === 429) {
        return {
          provider: this.displayName,
          platform: "telegram",
          configured: true,
          healthy: false,
          status: "rate_limited",
          message: "Telegram rate limit exceeded.",
          checkedAt,
          latencyMs,
        };
      }

      return {
        provider: this.displayName,
        platform: "telegram",
        configured: true,
        healthy: false,
        status: "provider_unavailable",
        message: `Telegram returned HTTP ${response.status}.`,
        checkedAt,
        latencyMs,
      };
    } catch (error) {
      const isTimeout =
        axios.isAxiosError(error) &&
        (error.code === "ECONNABORTED" || error.message.toLowerCase().includes("timeout"));

      return {
        provider: this.displayName,
        platform: "telegram",
        configured: true,
        healthy: false,
        status: isTimeout ? "timeout" : "provider_unavailable",
        message: isTimeout
          ? "Telegram validation timed out."
          : "Could not reach Telegram API.",
        checkedAt,
        latencyMs: Date.now() - started,
      };
    }
  }

  public async publishVideo(params: PublishVideoParams): Promise<PublishResult> {
    const token =
      (params.account?.encryptedCredentials as string) ||
      this.botToken;

    if (!token) {
      return {
        success: false,
        status: "failed",
        error: "Telegram bot token is missing.",
        technicalError: "NO_TELEGRAM_TOKEN",
        retryable: false,
      };
    }

    const chatId =
      params.metadata?.telegramChatId ||
      params.account?.accountId ||
      this.defaultChatId;

    if (!chatId) {
      return {
        success: false,
        status: "failed",
        error: "Telegram target chat_id / channel username is required.",
        technicalError: "MISSING_CHAT_ID",
        retryable: false,
      };
    }

    try {
      const form = new FormData();
      form.append("chat_id", chatId);
      form.append("supports_streaming", "true");

      const caption = this.formatCaption(params);
      if (caption) {
        form.append("caption", caption);
        form.append("parse_mode", "HTML");
      }

      if (fs.existsSync(params.videoFilePath)) {
        const fileBuffer = fs.readFileSync(params.videoFilePath);
        const blob = new Blob([fileBuffer], { type: "video/mp4" });
        form.append("video", blob, path.basename(params.videoFilePath));
      } else if (params.videoUrl) {
        form.append("video", params.videoUrl);
      } else {
        return {
          success: false,
          status: "failed",
          error: "Video file or URL not found.",
          retryable: false,
        };
      }

      if (params.thumbnailFilePath && fs.existsSync(params.thumbnailFilePath)) {
        const thumbBuffer = fs.readFileSync(params.thumbnailFilePath);
        const thumbBlob = new Blob([thumbBuffer], { type: "image/jpeg" });
        form.append("thumbnail", thumbBlob, path.basename(params.thumbnailFilePath));
      }

      const response = await axios.post(
        `https://api.telegram.org/bot${token}/sendVideo`,
        form,
        {
          timeout: 60000,
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          validateStatus: () => true,
        },
      );

      if (response.status === 200 && response.data?.ok) {
        const message = response.data.result;
        const messageId = String(message.message_id);
        const chat = message.chat;
        const providerUrl = chat.username
          ? `https://t.me/${chat.username}/${messageId}`
          : undefined;

        return {
          success: true,
          status: "published",
          providerPostId: messageId,
          providerUrl,
          message: "Video posted to Telegram channel/chat successfully.",
          rawResponse: response.data,
        };
      }

      const isRetryable = response.status === 429 || response.status >= 500;
      return {
        success: false,
        status: "failed",
        error: response.data?.description || `Telegram error (${response.status})`,
        technicalError: JSON.stringify(response.data || {}),
        rawResponse: response.data,
        retryable: isRetryable,
      };
    } catch (error: any) {
      logger.error({ error, publicationId: params.publicationId }, "Telegram sendVideo failed");
      const isRetryable =
        axios.isAxiosError(error) &&
        (error.code === "ECONNABORTED" ||
          error.code === "ETIMEDOUT" ||
          error.code === "ECONNRESET" ||
          (error.response && (error.response.status === 429 || error.response.status >= 500)));

      return {
        success: false,
        status: "failed",
        error: error.message || "Failed to post to Telegram.",
        technicalError: error.stack || String(error),
        retryable: isRetryable,
      };
    }
  }

  public async scheduleVideo(params: ScheduleVideoParams): Promise<PublishResult> {
    // Telegram Bot API does not natively support future scheduling without user-client MTProto.
    // Application scheduler manages scheduling in PostgreSQL and triggers publishVideo when due.
    return {
      success: true,
      status: "scheduled",
      providerPostId: `tg_sched_${Date.now()}`,
      message: "Telegram post scheduled via Application Scheduler Engine.",
    };
  }

  public async getStatus(
    providerPostId: string,
    context?: Record<string, unknown>,
  ): Promise<PublishStatusResult> {
    // Once published via sendVideo, message is already delivered.
    return {
      status: "published",
      providerPostId,
      message: "Telegram message is published.",
    };
  }

  public async cancel(
    providerPostId: string,
    context?: Record<string, unknown>,
  ): Promise<boolean> {
    return true;
  }

  /**
   * Checks the destination without posting anything.
   *
   * `getChat` is read-only, so connection validation never leaves a stray test
   * message in a customer channel. It also returns `permissions` for a group and
   * the `username` for a public channel, which is the only legitimate way to
   * build a t.me link later - deriving one from a numeric chat id would produce
   * a URL that does not resolve.
   */
  public async validateChat(input: {
    botToken: string;
    chatId: string;
  }): Promise<{
    ok: boolean;
    chatTitle?: string;
    chatUsername?: string;
    chatType?: string;
    error?: NormalizedProviderError;
  }> {
    try {
      const response = await axios.get(`https://api.telegram.org/bot${input.botToken}/getChat`, {
        params: { chat_id: input.chatId },
        timeout: 10000,
        validateStatus: () => true,
      });

      if (response.status === 200 && response.data?.ok) {
        const chat = response.data.result || {};
        return {
          ok: true,
          chatTitle: chat.title || chat.username || String(chat.id),
          chatUsername: chat.username,
          chatType: chat.type,
        };
      }
      return { ok: false, error: normalizeTelegramError(response.status, response.data) };
    } catch (error) {
      return { ok: false, error: normalizeTransportError("telegram", error) };
    }
  }

  /**
   * Confirms the bot may actually post media in the destination.
   *
   * Reads the bot's own membership rather than sending anything: a bot that is
   * present but muted is the most common Telegram failure, and discovering it at
   * publish time wastes the render.
   */
  public async canPostToChat(input: {
    botToken: string;
    chatId: string;
    botUserId: number;
  }): Promise<{ allowed: boolean; reason?: string }> {
    const response = await axios.get(`https://api.telegram.org/bot${input.botToken}/getChatMember`, {
      params: { chat_id: input.chatId, user_id: input.botUserId },
      timeout: 10000,
      validateStatus: () => true,
    });
    if (response.status !== 200 || !response.data?.ok) {
      return { allowed: false, reason: "The bot is not a member of that chat." };
    }
    const member = response.data.result || {};
    const status = String(member.status || "");
    if (status === "left" || status === "kicked") {
      return { allowed: false, reason: "The bot is not a member of that chat." };
    }
    if (status === "administrator") {
      // An administrator without can_post_messages cannot post in a channel.
      if (member.can_post_messages === false) {
        return { allowed: false, reason: "The bot is an admin but is not allowed to post messages." };
      }
      return { allowed: true };
    }
    if (status === "restricted" && member.can_send_other_messages === false) {
      return { allowed: false, reason: "The bot is restricted from sending media in that chat." };
    }
    return { allowed: true };
  }

  public getPublishedUrl(
    providerPostId: string,
    data?: Record<string, unknown>,
  ): string | undefined {
    if (data?.url) return String(data.url);
    if (data?.channelUsername) {
      return `https://t.me/${data.channelUsername}/${providerPostId}`;
    }
    return undefined;
  }

  private formatCaption(params: PublishVideoParams): string {
    const parts: string[] = [];
    if (params.title) {
      parts.push(`<b>${this.escapeHtml(params.title)}</b>`);
    }
    if (params.caption) {
      parts.push(this.escapeHtml(params.caption));
    } else if (params.description) {
      parts.push(this.escapeHtml(params.description));
    }
    if (params.hashtags && params.hashtags.length > 0) {
      const tags = params.hashtags
        .map((t) => (t.startsWith("#") ? t : `#${t}`))
        .join(" ");
      parts.push(`<i>${this.escapeHtml(tags)}</i>`);
    }
    return parts.join("\n\n");
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
}
