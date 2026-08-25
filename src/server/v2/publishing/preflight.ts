import fs from "fs-extra";
import path from "path";
import { requirementsFor, withAccountOverrides, type PlatformRequirements } from "./platformLimits";
import type { PublishingPlatform } from "./types";

/**
 * PUBLISHING PRE-FLIGHT
 * ---------------------
 * Everything that can be checked locally, checked before a single byte reaches a
 * provider.
 *
 * The previous check read the metadata sidecar written at render time and
 * compared three numbers against a hardcoded table. It never opened the file, so
 * a missing or truncated MP4, a video with no audio track where the platform
 * requires one, or a codec the platform will not decode all sailed through and
 * failed after the upload - spending quota, and on the aggregator, money.
 *
 * The probe is injected rather than imported so this module stays testable
 * without FFmpeg installed.
 */

export type ProbedMedia = {
  exists: boolean;
  sizeBytes: number;
  durationSeconds: number;
  hasVideoStream: boolean;
  hasAudioStream: boolean;
  width: number;
  height: number;
  videoCodec?: string;
  audioCodec?: string;
  container?: string;
};

export type MediaProbe = (filePath: string) => Promise<ProbedMedia>;

export type PreflightIssue = {
  code: string;
  /** Sentence shown to the customer. */
  message: string;
  severity: "error" | "warning";
};

export type PreflightAccountContext = {
  /** True when a usable account is connected for this platform. */
  connected: boolean;
  /** Scopes the platform needs that the account did not grant. */
  missingScopes?: string[];
  /** Values the provider reported for this specific creator. */
  accountLimits?: { maxDurationSeconds?: number; privacyOptions?: string[] };
  /** True when the provider has not approved this app for public posting. */
  externalApprovalRequired?: boolean;
};

export type PreflightResult = {
  ok: boolean;
  platform: PublishingPlatform;
  issues: PreflightIssue[];
  /** The requirements actually applied, after any per-account overrides. */
  requirements: PlatformRequirements;
  media?: ProbedMedia;
  /** Set when the platform decides privacy per creator. */
  allowedPrivacyOptions?: string[];
};

function aspectLabel(width: number, height: number): string {
  if (!width || !height) return "unknown";
  const ratio = width / height;
  if (Math.abs(ratio - 9 / 16) < 0.04) return "9:16";
  if (Math.abs(ratio - 16 / 9) < 0.04) return "16:9";
  if (Math.abs(ratio - 1) < 0.04) return "1:1";
  if (Math.abs(ratio - 4 / 5) < 0.04) return "4:5";
  return `${width}x${height}`;
}

/**
 * Normalises the many spellings a container/codec can arrive under, so an
 * `h264` from one probe and an `avc1` from another are the same thing.
 */
function normalizeCodec(codec?: string): string {
  const value = (codec || "").toLowerCase();
  if (["avc1", "avc", "h264", "libx264"].includes(value)) return "h264";
  if (["hvc1", "hev1", "hevc", "h265"].includes(value)) return "hevc";
  if (["mp4a", "aac", "aac_latm"].includes(value)) return "aac";
  return value;
}

export async function runPreflight(input: {
  platform: PublishingPlatform;
  videoFilePath: string;
  probe: MediaProbe;
  account: PreflightAccountContext;
  title?: string;
  caption?: string;
  hashtags?: string[];
  requestedPrivacy?: string;
}): Promise<PreflightResult> {
  const issues: PreflightIssue[] = [];
  const base = requirementsFor(input.platform);
  const requirements = withAccountOverrides(base, input.account.accountLimits || {});

  // ------------------------------------------------------------- account
  if (!input.account.connected) {
    issues.push({
      code: "account_not_connected",
      message: `No ${requirements.displayName} account is connected. Connect one in Integrations first.`,
      severity: "error",
    });
  }
  if (input.account.missingScopes && input.account.missingScopes.length > 0) {
    issues.push({
      code: "missing_scopes",
      message: `The connected account did not grant: ${input.account.missingScopes.join(", ")}. Reconnect it and accept all permissions.`,
      severity: "error",
    });
  }
  if (input.account.externalApprovalRequired) {
    issues.push({
      code: "external_approval_required",
      message:
        `${requirements.displayName} has not approved this application for public publishing yet. ` +
        "The post will be restricted until it does.",
      severity: "warning",
    });
  }

  // --------------------------------------------------------------- media
  let media: ProbedMedia | undefined;
  try {
    media = await input.probe(input.videoFilePath);
  } catch (error) {
    issues.push({
      code: "media_unreadable",
      message: "The video file could not be inspected. It may be incomplete or corrupt.",
      severity: "error",
    });
  }

  if (media) {
    if (!media.exists || media.sizeBytes <= 0) {
      issues.push({
        code: "media_missing",
        message: "The video file is missing from storage. Re-render it before publishing.",
        severity: "error",
      });
    } else {
      if (!media.hasVideoStream) {
        issues.push({
          code: "no_video_stream",
          message: "The file has no video track, so it cannot be published as a video.",
          severity: "error",
        });
      }
      if (requirements.requiresAudioTrack && !media.hasAudioStream) {
        issues.push({
          code: "no_audio_stream",
          message: `${requirements.displayName} rejects videos with no audio track.`,
          severity: "error",
        });
      } else if (!media.hasAudioStream) {
        issues.push({
          code: "no_audio_stream",
          message: "This video has no audio track.",
          severity: "warning",
        });
      }

      const container = (media.container || path.extname(input.videoFilePath).replace(".", "")).toLowerCase();
      if (container && !requirements.supportedContainers.includes(container)) {
        issues.push({
          code: "unsupported_container",
          message: `${requirements.displayName} accepts ${requirements.supportedContainers.join(", ")} files; this one is ${container}.`,
          severity: "error",
        });
      }

      const videoCodec = normalizeCodec(media.videoCodec);
      if (videoCodec && !requirements.videoCodecs.includes(videoCodec)) {
        issues.push({
          code: "unsupported_video_codec",
          message: `${requirements.displayName} cannot decode ${videoCodec} video. Re-encode to ${requirements.videoCodecs[0]}.`,
          severity: "error",
        });
      }
      const audioCodec = normalizeCodec(media.audioCodec);
      if (media.hasAudioStream && audioCodec && !requirements.audioCodecs.includes(audioCodec)) {
        issues.push({
          code: "unsupported_audio_codec",
          message: `${requirements.displayName} cannot decode ${audioCodec} audio. Re-encode to ${requirements.audioCodecs[0]}.`,
          severity: "error",
        });
      }

      if (media.durationSeconds > requirements.maxDurationSeconds) {
        issues.push({
          code: "duration_too_long",
          message: `This video is ${Math.round(media.durationSeconds)}s. ${requirements.displayName} allows up to ${requirements.maxDurationSeconds}s.`,
          severity: "error",
        });
      }
      if (media.durationSeconds > 0 && media.durationSeconds < requirements.minDurationSeconds) {
        issues.push({
          code: "duration_too_short",
          message: `This video is ${media.durationSeconds.toFixed(1)}s. ${requirements.displayName} needs at least ${requirements.minDurationSeconds}s.`,
          severity: "error",
        });
      }

      const sizeMB = media.sizeBytes / (1024 * 1024);
      if (sizeMB > requirements.maxFileSizeMB) {
        issues.push({
          code: "file_too_large",
          message: `This video is ${sizeMB.toFixed(0)} MB. ${requirements.displayName} accepts up to ${requirements.maxFileSizeMB} MB.`,
          severity: "error",
        });
      }

      const aspect = aspectLabel(media.width, media.height);
      if (aspect !== "unknown" && !requirements.supportedAspectRatios.includes(aspect)) {
        issues.push({
          code: "aspect_ratio",
          message: `${requirements.displayName} expects ${requirements.supportedAspectRatios.join(" or ")}; this video is ${aspect}.`,
          // Instagram genuinely rejects non-vertical Reels; elsewhere it is a
          // presentation problem rather than a refusal.
          severity: input.platform === "instagram" ? "error" : "warning",
        });
      }
    }
  }

  // ------------------------------------------------------------ metadata
  if (requirements.titleMaxChars > 0 && input.title && input.title.length > requirements.titleMaxChars) {
    issues.push({
      code: "title_too_long",
      message: `The title is ${input.title.length} characters; ${requirements.displayName} allows ${requirements.titleMaxChars}.`,
      severity: "error",
    });
  }
  if (input.caption && input.caption.length > requirements.captionMaxChars) {
    issues.push({
      code: "caption_too_long",
      message: `The caption is ${input.caption.length} characters; ${requirements.displayName} allows ${requirements.captionMaxChars}.`,
      severity: "error",
    });
  }
  if (input.hashtags && input.hashtags.length > requirements.hashtagsMaxCount) {
    issues.push({
      code: "too_many_hashtags",
      message: `${requirements.displayName} accepts up to ${requirements.hashtagsMaxCount} hashtags; the extra ones will be dropped.`,
      severity: "warning",
    });
  }

  // ------------------------------------------------------------- privacy
  const allowedPrivacyOptions = requirements.privacyIsAccountSpecific
    ? input.account.accountLimits?.privacyOptions
    : requirements.privacyOptions;

  if (input.requestedPrivacy && allowedPrivacyOptions && allowedPrivacyOptions.length > 0) {
    if (!allowedPrivacyOptions.includes(input.requestedPrivacy)) {
      issues.push({
        code: "privacy_not_allowed",
        message: `${requirements.displayName} does not offer "${input.requestedPrivacy}" for this account. Choose one of: ${allowedPrivacyOptions.join(", ")}.`,
        severity: "error",
      });
    }
  } else if (requirements.privacyIsAccountSpecific && !allowedPrivacyOptions) {
    issues.push({
      code: "privacy_unknown",
      message: `${requirements.displayName} decides the available privacy settings per account. Connect the account so they can be read.`,
      severity: "warning",
    });
  }

  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    platform: input.platform,
    issues,
    requirements,
    media,
    allowedPrivacyOptions,
  };
}

/** A probe backed by fluent-ffmpeg's ffprobe. Used by the real service. */
export function createFfprobeMediaProbe(
  ffprobe: (
    filePath: string,
    callback: (err: unknown, data: { format?: Record<string, unknown>; streams?: Array<Record<string, unknown>> }) => void,
  ) => void,
): MediaProbe {
  return async (filePath: string) => {
    if (!fs.existsSync(filePath)) {
      return {
        exists: false,
        sizeBytes: 0,
        durationSeconds: 0,
        hasVideoStream: false,
        hasAudioStream: false,
        width: 0,
        height: 0,
      };
    }
    const sizeBytes = fs.statSync(filePath).size;
    return new Promise<ProbedMedia>((resolve, reject) => {
      ffprobe(filePath, (err, data) => {
        if (err) return reject(err);
        const streams = data?.streams || [];
        const video = streams.find((s) => s.codec_type === "video");
        const audio = streams.find((s) => s.codec_type === "audio");
        const formatName = String(data?.format?.format_name || "");
        resolve({
          exists: true,
          sizeBytes,
          durationSeconds: parseFloat(String(data?.format?.duration || 0)) || 0,
          hasVideoStream: Boolean(video),
          hasAudioStream: Boolean(audio),
          width: Number(video?.width) || 0,
          height: Number(video?.height) || 0,
          videoCodec: video?.codec_name ? String(video.codec_name) : undefined,
          audioCodec: audio?.codec_name ? String(audio.codec_name) : undefined,
          // ffprobe reports a comma-separated family such as "mov,mp4,m4a".
          container: formatName.includes("mp4") ? "mp4" : formatName.split(",")[0] || undefined,
        });
      });
    });
  };
}
