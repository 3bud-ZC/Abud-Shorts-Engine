import { LOCALE_TAG, type UiLocale } from "./types";

/**
 * LOCALE-AWARE FORMATTERS
 * -----------------------
 * One place that turns raw values into display strings, so a date reads the
 * same on the dashboard, the library and a production detail page.
 *
 * Two rules run through everything here:
 *
 * 1. Numbers use Western Arabic digits (0-9) in both languages. Every ID,
 *    version, error code and file size in this product is written that way, and
 *    an interface that mixes ٠١٢ into a technical dashboard becomes harder to
 *    read, not easier. `Intl` is asked for `latn` explicitly rather than left to
 *    the runtime default, which differs between browsers for `ar`.
 * 2. Technical strings - IDs, URLs, versions, email addresses, file names - are
 *    never reformatted or reordered. `isolateTechnical` wraps them in Unicode
 *    isolates so an RTL paragraph cannot reorder their characters on screen.
 */

const NUMBER_LOCALE: Record<UiLocale, string> = {
  en: LOCALE_TAG.en,
  // `-u-nu-latn` pins Western Arabic digits for the Arabic interface.
  ar: `${LOCALE_TAG.ar}-u-nu-latn`,
};

function tag(locale: UiLocale): string {
  return NUMBER_LOCALE[locale] || LOCALE_TAG.en;
}

/**
 * Wraps a technical token in a first-strong isolate so bidirectional layout
 * cannot reorder it inside surrounding Arabic text. `https://host/a/b` must read
 * left to right even in an RTL sentence.
 */
export function isolateTechnical(value: string): string {
  if (!value) return value;
  return `⁨${value}⁩`;
}

export function formatNumber(locale: UiLocale, value: number, options?: Intl.NumberFormatOptions): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(tag(locale), options).format(value);
}

/** Percentages are shown whole; a production success rate of 87.4% reads as 87%. */
export function formatPercent(locale: UiLocale, ratio: number, fractionDigits = 0): string {
  if (!Number.isFinite(ratio)) return "—";
  return new Intl.NumberFormat(tag(locale), {
    style: "percent",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(ratio);
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/**
 * File sizes keep their unit in Latin script in both languages: "1.4 GB" is how
 * the operating system, the provider dashboards and every support conversation
 * write it.
 */
export function formatBytes(locale: UiLocale, bytes?: number | null): string {
  const value = typeof bytes === "number" && Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  if (value === 0) return `0 ${BYTE_UNITS[0]}`;

  let unitIndex = 0;
  let scaled = value;
  while (scaled >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    scaled /= 1024;
    unitIndex += 1;
  }
  const digits = unitIndex === 0 ? 0 : scaled < 10 ? 2 : 1;
  return `${formatNumber(locale, scaled, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} ${BYTE_UNITS[unitIndex]}`;
}

/**
 * Durations render as `m:ss` under an hour and `h:mm:ss` above it - the same
 * shape a video player shows, in both languages.
 */
export function formatDuration(locale: UiLocale, seconds?: number | null): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n: number) => formatNumber(locale, n, { minimumIntegerDigits: 2, useGrouping: false });
  if (hours > 0) {
    return `${formatNumber(locale, hours, { useGrouping: false })}:${pad(minutes)}:${pad(secs)}`;
  }
  return `${formatNumber(locale, minutes, { useGrouping: false })}:${pad(secs)}`;
}

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(locale: UiLocale, value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat(tag(locale), {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function formatTime(locale: UiLocale, value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat(tag(locale), {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatDateTime(locale: UiLocale, value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat(tag(locale), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/**
 * Relative time ("3 min ago") via `Intl.RelativeTimeFormat`, which already has
 * correct Arabic plural forms - hand-written plural rules for Arabic get this
 * wrong far more often than not.
 */
export function formatRelativeTime(
  locale: UiLocale,
  value: string | number | Date | null | undefined,
  now: Date = new Date(),
): string {
  const date = toDate(value);
  if (!date) return "—";

  const deltaSeconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const absolute = Math.abs(deltaSeconds);
  const formatter = new Intl.RelativeTimeFormat(tag(locale), { numeric: "auto" });

  if (absolute < 60) return formatter.format(Math.round(deltaSeconds), "second");
  if (absolute < 3600) return formatter.format(Math.round(deltaSeconds / 60), "minute");
  if (absolute < 86_400) return formatter.format(Math.round(deltaSeconds / 3600), "hour");
  if (absolute < 2_592_000) return formatter.format(Math.round(deltaSeconds / 86_400), "day");
  return formatDate(locale, date);
}

/** Milliseconds rendered as a human production time ("2 min 15 s" style). */
export function formatDurationMs(locale: UiLocale, ms?: number | null): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "—";
  return formatDuration(locale, ms / 1000);
}
