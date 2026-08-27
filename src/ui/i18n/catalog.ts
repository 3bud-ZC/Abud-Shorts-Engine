import { en } from "./locales/en";
import { ar } from "./locales/ar";
import {
  isUiLocale,
  LOCALE_DIRECTION,
  LOCALE_TAG,
  type TranslationCatalog,
  type TranslationVars,
  type UiLocale,
} from "./types";

/**
 * LOCALISATION CORE
 * -----------------
 * Pure functions only: no React, no DOM. The provider in `index.tsx` is a thin
 * shell over this module, which keeps the whole resolution/lookup/interpolation
 * path directly testable in Node.
 */

export const CATALOGS: Record<UiLocale, TranslationCatalog> = { en, ar };

/** Where the chosen interface language is persisted. */
export const LOCALE_STORAGE_KEY = "abud_ui_locale";

/**
 * Resolves the interface language.
 *
 * Precedence is saved preference → browser language → English. English is the
 * final fallback rather than the first choice so an Arabic-speaking operator
 * lands in Arabic on a fresh installation without touching a setting.
 */
export function resolveLocale(input: {
  saved?: string | null;
  browserLanguages?: readonly string[];
}): UiLocale {
  if (isUiLocale(input.saved)) return input.saved;

  for (const candidate of input.browserLanguages || []) {
    const primary = String(candidate || "")
      .toLowerCase()
      .split("-")[0];
    if (isUiLocale(primary)) return primary;
  }

  return "en";
}

/**
 * Substitutes `{name}` placeholders.
 *
 * A placeholder with no matching variable is left verbatim rather than blanked:
 * seeing `{count}` in the interface is an obvious bug report, while an empty
 * gap reads as a deliberately empty value.
 */
export function interpolate(template: string, vars?: TranslationVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

/**
 * Looks a key up in `locale`, falling back to English and finally to the key
 * itself. Returning the key means an untranslated string is visibly a key
 * rather than silently blank, which is what the browser-QA check greps for.
 */
export function translate(locale: UiLocale, key: string, vars?: TranslationVars): string {
  const template = CATALOGS[locale]?.[key] ?? CATALOGS.en[key] ?? key;
  return interpolate(template, vars);
}

export function directionFor(locale: UiLocale) {
  return LOCALE_DIRECTION[locale];
}

export function localeTag(locale: UiLocale): string {
  return LOCALE_TAG[locale];
}

/**
 * Applies the language to the document.
 *
 * `dir` on `<html>` is what actually flips the layout; `lang` is what screen
 * readers and font fallback use. Both must move together, or an Arabic page is
 * announced as English.
 */
export function applyDocumentLocale(locale: UiLocale, doc?: Document): void {
  const target = doc || (typeof document !== "undefined" ? document : undefined);
  if (!target?.documentElement) return;
  target.documentElement.setAttribute("lang", locale);
  target.documentElement.setAttribute("dir", LOCALE_DIRECTION[locale]);
}

export function readStoredLocale(storage?: Storage): string | null {
  try {
    const store = storage || (typeof localStorage !== "undefined" ? localStorage : undefined);
    return store ? store.getItem(LOCALE_STORAGE_KEY) : null;
  } catch {
    return null;
  }
}

export function writeStoredLocale(locale: UiLocale, storage?: Storage): void {
  try {
    const store = storage || (typeof localStorage !== "undefined" ? localStorage : undefined);
    store?.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // A locked-down or full storage must not break the language switch; the
    // choice simply does not survive a reload.
  }
}
