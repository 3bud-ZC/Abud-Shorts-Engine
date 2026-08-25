import React from "react";

import {
  applyDocumentLocale,
  directionFor,
  localeTag,
  readStoredLocale,
  resolveLocale,
  translate,
  writeStoredLocale,
} from "./catalog";
import {
  formatBytes,
  formatDate,
  formatDateTime,
  formatDuration,
  formatDurationMs,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  formatTime,
  isolateTechnical,
} from "./format";
import type { TextDirection, TranslationVars, UiLocale } from "./types";

export * from "./types";
export {
  applyDocumentLocale,
  CATALOGS,
  directionFor,
  interpolate,
  LOCALE_STORAGE_KEY,
  localeTag,
  readStoredLocale,
  resolveLocale,
  translate,
  writeStoredLocale,
} from "./catalog";
export * from "./format";

export type I18nContextValue = {
  locale: UiLocale;
  direction: TextDirection;
  /** BCP-47 tag for `Intl` and the document `lang` attribute. */
  tag: string;
  setLocale: (next: UiLocale) => void;
  /** Translate a `namespace.key`, interpolating `{placeholders}`. */
  t: (key: string, vars?: TranslationVars) => string;
  /** Locale-aware formatters, already bound to the active language. */
  format: {
    number: (value: number, options?: Intl.NumberFormatOptions) => string;
    percent: (ratio: number, fractionDigits?: number) => string;
    bytes: (bytes?: number | null) => string;
    duration: (seconds?: number | null) => string;
    durationMs: (ms?: number | null) => string;
    date: (value: string | number | Date | null | undefined) => string;
    time: (value: string | number | Date | null | undefined) => string;
    dateTime: (value: string | number | Date | null | undefined) => string;
    relative: (value: string | number | Date | null | undefined, now?: Date) => string;
    /** Keeps an ID, URL, version or e-mail address reading left-to-right. */
    technical: (value: string) => string;
  };
};

/**
 * The default context is a working English translator rather than `undefined`.
 * A component rendered outside the provider - a test, an error boundary that
 * escaped the tree - still renders real English words instead of throwing.
 */
const fallbackValue: I18nContextValue = buildValue("en", () => undefined);

const I18nContext = React.createContext<I18nContextValue>(fallbackValue);

function buildValue(locale: UiLocale, setLocale: (next: UiLocale) => void): I18nContextValue {
  return {
    locale,
    direction: directionFor(locale),
    tag: localeTag(locale),
    setLocale,
    t: (key, vars) => translate(locale, key, vars),
    format: {
      number: (value, options) => formatNumber(locale, value, options),
      percent: (ratio, fractionDigits) => formatPercent(locale, ratio, fractionDigits),
      bytes: (bytes) => formatBytes(locale, bytes),
      duration: (seconds) => formatDuration(locale, seconds),
      durationMs: (ms) => formatDurationMs(locale, ms),
      date: (value) => formatDate(locale, value),
      time: (value) => formatTime(locale, value),
      dateTime: (value) => formatDateTime(locale, value),
      relative: (value, now) => formatRelativeTime(locale, value, now),
      technical: (value) => isolateTechnical(value),
    },
  };
}

/**
 * Initial language, resolved before first paint so the shell never renders
 * left-to-right and then snaps into RTL.
 */
function initialLocale(): UiLocale {
  const browserLanguages =
    typeof navigator !== "undefined"
      ? navigator.languages && navigator.languages.length
        ? navigator.languages
        : navigator.language
          ? [navigator.language]
          : []
      : [];
  return resolveLocale({ saved: readStoredLocale(), browserLanguages });
}

export const I18nProvider: React.FC<{ children: React.ReactNode; initial?: UiLocale }> = ({
  children,
  initial,
}) => {
  const [locale, setLocaleState] = React.useState<UiLocale>(() => initial || initialLocale());

  // `dir`/`lang` live on <html>, outside React's tree, so they are applied as an
  // effect on every change rather than only at mount.
  React.useEffect(() => {
    applyDocumentLocale(locale);
  }, [locale]);

  const setLocale = React.useCallback((next: UiLocale) => {
    writeStoredLocale(next);
    setLocaleState(next);
  }, []);

  const value = React.useMemo(() => buildValue(locale, setLocale), [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export function useI18n(): I18nContextValue {
  return React.useContext(I18nContext);
}

/** Shorthand for the common case of needing only the translator. */
export function useT(): I18nContextValue["t"] {
  return React.useContext(I18nContext).t;
}
