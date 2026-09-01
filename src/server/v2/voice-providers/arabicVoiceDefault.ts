import type { V2Database } from "../db";
import type { VoicePreset } from "../../../types/productionSpec";
import { voicePresetEnum } from "../../../types/productionSpec";
import { isLegacyPiperVoiceId } from "./types";

/**
 * ARABIC DEFAULT VOICE STORE
 * --------------------------
 * The Arabic production default is a *human* decision made in the Voice Lab and
 * persisted in `app_settings`. Before V2.2 the Voice Lab wrote this row but
 * nothing on the video-creation path ever read it: spec canonicalization went
 * straight to `ELEVENLABS_DEFAULT_VOICE_ID`, so real jobs ignored the approved
 * selection. This module is the single place that owns reading, writing and
 * applying that persisted default.
 */
export const ARABIC_VOICE_SETTINGS_KEY = "arabic_voice_default";

export type PersistedArabicVoiceDefault = {
  provider: "elevenlabs";
  voiceId: string;
  voiceName?: string;
  preset?: VoicePreset;
  settings?: Record<string, unknown>;
  modelId?: string;
  selectedAt?: string;
  selectedBy: "human";
};

type SettingRow = { key: string; value: Record<string, unknown> };

function coercePreset(value: unknown): VoicePreset | undefined {
  const parsed = voicePresetEnum.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Parses a raw `app_settings` payload. A row without a voice ID is treated as
 * "no human selection exists" rather than as a partial default, so the caller
 * falls through to the legacy environment value instead of half-applying a
 * broken record.
 */
export function parseArabicVoiceDefault(
  value: Record<string, unknown> | undefined | null,
): PersistedArabicVoiceDefault | null {
  if (!value) return null;
  const voiceId = typeof value.voiceId === "string" ? value.voiceId.trim() : "";
  if (!voiceId) return null;
  return {
    provider: "elevenlabs",
    voiceId,
    voiceName: typeof value.voiceName === "string" && value.voiceName.trim() ? value.voiceName.trim() : undefined,
    preset: coercePreset(value.preset),
    settings:
      value.settings && typeof value.settings === "object" && !Array.isArray(value.settings)
        ? value.settings as Record<string, unknown>
        : undefined,
    modelId: typeof value.modelId === "string" && value.modelId.trim() ? value.modelId.trim() : undefined,
    selectedAt: typeof value.selectedAt === "string" ? value.selectedAt : undefined,
    selectedBy: "human",
  };
}

/**
 * The default Arabic voice is only ever set by an explicit human selection in
 * the Voice Lab. The engine never auto-promotes a voice or labels one as the
 * best or most Egyptian sounding.
 */
export async function readArabicVoiceDefault(
  db: V2Database,
): Promise<PersistedArabicVoiceDefault | null> {
  const rows = await db.query<SettingRow>(
    "SELECT key, value, updated_at FROM app_settings WHERE key = $1",
    [ARABIC_VOICE_SETTINGS_KEY],
  );
  return parseArabicVoiceDefault(rows[0]?.value);
}

export async function writeArabicVoiceDefault(
  db: V2Database,
  value: {
    voiceId: string;
    voiceName?: string;
    preset?: VoicePreset;
    settings?: Record<string, unknown>;
    modelId?: string;
  },
  now: () => Date = () => new Date(),
): Promise<PersistedArabicVoiceDefault> {
  const payload: PersistedArabicVoiceDefault = {
    provider: "elevenlabs",
    voiceId: value.voiceId.trim(),
    voiceName: value.voiceName,
    preset: value.preset,
    settings: value.settings,
    modelId: value.modelId,
    selectedAt: now().toISOString(),
    selectedBy: "human",
  };
  await db.query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [ARABIC_VOICE_SETTINGS_KEY, payload],
  );
  return payload;
}

export type ArabicVoiceResolutionSource =
  | "explicit_request"
  | "brand_profile_default"
  | "persisted_human_default"
  | "unresolved";

export type ResolvedArabicVoice = {
  voiceId: string;
  voiceName?: string;
  preset?: VoicePreset;
  settings?: Record<string, unknown>;
  modelId?: string;
  source: ArabicVoiceResolutionSource;
};

/**
 * Canonical Arabic voice precedence:
 *
 *   1. an explicit voice ID (and explicit preset) on the request
 *   2. a valid Brand Profile voice
 *   3. the human-selected default persisted in app_settings
 *   4. unresolved - the caller turns this into a controlled configuration error
 *
 * A legacy Piper model name is never treated as an explicit ElevenLabs voice.
 *
 * The persisted preset only applies while the persisted *voice* is the one in
 * effect: choosing a different speaker without naming a preset must not silently
 * inherit delivery settings that were auditioned on another voice.
 */
export function resolveArabicVoiceSelection(input: {
  requestedVoiceId?: string;
  requestedPreset?: VoicePreset;
  brandVoice?: {
    voiceId?: string;
    voiceName?: string;
    preset?: VoicePreset;
    settings?: Record<string, unknown>;
    modelId?: string;
  } | null;
  persisted?: PersistedArabicVoiceDefault | null;
  defaultModelId: string;
}): ResolvedArabicVoice {
  const requestedVoiceId = (input.requestedVoiceId || "").trim();
  const explicitVoiceId = requestedVoiceId && !isLegacyPiperVoiceId(requestedVoiceId) ? requestedVoiceId : "";
  const brandVoiceId = input.brandVoice?.voiceId && !isLegacyPiperVoiceId(input.brandVoice.voiceId)
    ? input.brandVoice.voiceId.trim()
    : "";
  const persisted = input.persisted?.voiceId ? input.persisted : null;

  const voiceId = explicitVoiceId || brandVoiceId || persisted?.voiceId || "";
  const source: ArabicVoiceResolutionSource = explicitVoiceId
    ? "explicit_request"
    : brandVoiceId
      ? "brand_profile_default"
      : persisted?.voiceId
        ? "persisted_human_default"
        : "unresolved";

  const brandSelectionIsInEffect = Boolean(brandVoiceId && voiceId === brandVoiceId);
  const persistedSelectionIsInEffect = Boolean(persisted && voiceId === persisted.voiceId);
  const preset =
    input.requestedPreset ||
    (brandSelectionIsInEffect ? input.brandVoice?.preset : undefined) ||
    (persistedSelectionIsInEffect ? persisted?.preset : undefined);

  return {
    voiceId,
    voiceName: brandSelectionIsInEffect
      ? input.brandVoice?.voiceName
      : persistedSelectionIsInEffect
        ? persisted?.voiceName
        : undefined,
    preset,
    settings: brandSelectionIsInEffect
      ? input.brandVoice?.settings
      : persistedSelectionIsInEffect
        ? persisted?.settings
        : undefined,
    modelId:
      (brandSelectionIsInEffect ? input.brandVoice?.modelId : undefined) ||
      (persistedSelectionIsInEffect ? persisted?.modelId : undefined) ||
      input.defaultModelId,
    source,
  };
}
