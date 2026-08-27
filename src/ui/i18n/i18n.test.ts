import { describe, expect, it } from "vitest";

import {
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
import { TRANSLATION_NAMESPACES, UI_LOCALES, isUiLocale } from "./types";
import { localizedStatus, TONE_TO_MUI_COLOR } from "./status";

/** Minimal in-memory `Storage`, so the tests never touch a real browser API. */
function fakeStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    removeItem: (key: string) => void data.delete(key),
    setItem: (key: string, value: string) => void data.set(key, value),
  } as Storage;
}

describe("catalogue integrity", () => {
  it("ships exactly the two first-class interface languages", () => {
    expect(UI_LOCALES).toEqual(["en", "ar"]);
    expect(Object.keys(CATALOGS).sort()).toEqual(["ar", "en"]);
  });

  it("has an Arabic string for every English string", () => {
    const missing = Object.keys(CATALOGS.en).filter((key) => !(key in CATALOGS.ar));
    expect(missing).toEqual([]);
  });

  it("has no Arabic string without an English counterpart", () => {
    const orphans = Object.keys(CATALOGS.ar).filter((key) => !(key in CATALOGS.en));
    expect(orphans).toEqual([]);
  });

  it("puts every key in a declared namespace", () => {
    const namespaces = new Set<string>(TRANSLATION_NAMESPACES);
    const stray = Object.keys(CATALOGS.en).filter((key) => !namespaces.has(key.split(".")[0]));
    expect(stray).toEqual([]);
  });

  it("ships no empty translations in either language", () => {
    for (const locale of UI_LOCALES) {
      const blank = Object.entries(CATALOGS[locale])
        .filter(([, value]) => !value || !value.trim())
        .map(([key]) => key);
      expect(blank, `blank ${locale} strings`).toEqual([]);
    }
  });

  it("keeps the same placeholders in both languages", () => {
    const placeholders = (value: string) =>
      (value.match(/\{(\w+)\}/g) || []).sort().join(",");
    const mismatched = Object.keys(CATALOGS.en).filter(
      (key) => placeholders(CATALOGS.en[key]) !== placeholders(CATALOGS.ar[key]),
    );
    expect(mismatched).toEqual([]);
  });

  it("writes real Arabic script, not a copy of the English string", () => {
    const arabicScript = /[؀-ۿ]/;
    // Keys whose value is legitimately identical in both languages: product and
    // provider names are identifiers, not prose, and translating them would make
    // the interface disagree with the provider's own screens.
    const identifierKeys = new Set([
      "common.appName",
      "setup.wizardTitle",
      // Provider / product proper nouns shown as an integration catalogue label
      // or a Settings integration-row heading. Kept verbatim so the label
      // matches the provider's own console.
      "integrations.catalog.gemini.label",
      "integrations.catalog.elevenlabs.label",
      "integrations.catalog.edge_tts.label",
      "integrations.catalog.pexels.label",
      "integrations.catalog.pixabay.label",
      "integrations.catalog.veo.label",
      "integrations.catalog.fal.label",
      "integrations.catalog.youtube.label",
      "integrations.catalog.tiktok.label",
      "integrations.catalog.telegram.label",
      "integrations.catalog.upload_post.label",
      "settings.integrations.pexels",
      "settings.integrations.gemini",
      "settings.integrations.uploadPost",
      "publishing.connect.dest.uploadPost.label",
      "settings.publicAddress.metaLabel",
    ]);
    const untranslated = Object.keys(CATALOGS.en).filter(
      (key) => !identifierKeys.has(key) && !arabicScript.test(CATALOGS.ar[key]),
    );
    expect(untranslated).toEqual([]);
  });
});

describe("language resolution", () => {
  it("prefers the operator's saved choice above everything else", () => {
    expect(resolveLocale({ saved: "ar", browserLanguages: ["en-GB", "en"] })).toBe("ar");
    expect(resolveLocale({ saved: "en", browserLanguages: ["ar-EG"] })).toBe("en");
  });

  it("falls back to the browser language when nothing was saved", () => {
    expect(resolveLocale({ saved: null, browserLanguages: ["ar-EG", "en"] })).toBe("ar");
    expect(resolveLocale({ browserLanguages: ["en-US"] })).toBe("en");
  });

  it("skips browser languages the product does not ship", () => {
    expect(resolveLocale({ browserLanguages: ["fr-FR", "de", "ar"] })).toBe("ar");
  });

  it("falls back to English when nothing matches", () => {
    expect(resolveLocale({ saved: null, browserLanguages: ["fr-FR"] })).toBe("en");
    expect(resolveLocale({})).toBe("en");
  });

  it("ignores a stored value that is not a supported language", () => {
    expect(resolveLocale({ saved: "klingon", browserLanguages: [] })).toBe("en");
    expect(isUiLocale("klingon")).toBe(false);
  });
});

describe("language persistence", () => {
  it("round-trips the chosen language", () => {
    const storage = fakeStorage();
    writeStoredLocale("ar", storage);
    expect(storage.getItem(LOCALE_STORAGE_KEY)).toBe("ar");
    expect(readStoredLocale(storage)).toBe("ar");
    expect(resolveLocale({ saved: readStoredLocale(storage), browserLanguages: ["en"] })).toBe("ar");
  });

  it("survives storage that refuses to write", () => {
    const hostile = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    // A locked-down browser must not break the switcher; the choice simply does
    // not survive a reload.
    expect(() => writeStoredLocale("ar", hostile)).not.toThrow();
    expect(readStoredLocale(hostile)).toBeNull();
  });
});

describe("direction", () => {
  it("maps each language to its reading direction", () => {
    expect(directionFor("en")).toBe("ltr");
    expect(directionFor("ar")).toBe("rtl");
  });

  it("uses Intl tags that keep Western Arabic digits available", () => {
    expect(localeTag("en")).toBe("en-US");
    expect(localeTag("ar")).toBe("ar");
  });

  it("moves lang and dir together on the document", () => {
    const attributes: Record<string, string> = {};
    const doc = {
      documentElement: {
        setAttribute: (name: string, value: string) => {
          attributes[name] = value;
        },
      },
    } as unknown as Document;

    applyDocumentLocale("ar", doc);
    expect(attributes).toEqual({ lang: "ar", dir: "rtl" });

    applyDocumentLocale("en", doc);
    expect(attributes).toEqual({ lang: "en", dir: "ltr" });
  });

  it("does nothing when there is no document to apply to", () => {
    expect(() => applyDocumentLocale("ar", {} as Document)).not.toThrow();
  });
});

describe("translation", () => {
  it("returns the string for the active language", () => {
    expect(translate("en", "navigation.dashboard")).toBe("Dashboard");
    expect(translate("ar", "navigation.dashboard")).toBe("لوحة التحكم");
  });

  it("interpolates named placeholders", () => {
    expect(translate("en", "health.needAttention", { count: 3 })).toBe("3 items need attention");
    expect(translate("ar", "health.needAttention", { count: 3 })).toContain("3");
  });

  it("leaves an unfilled placeholder visible rather than blanking it", () => {
    // A visible `{count}` is an obvious bug report; an empty gap reads as a
    // deliberately empty value.
    expect(interpolate("{count} items", {})).toBe("{count} items");
    expect(interpolate("{a} and {b}", { a: "one" })).toBe("one and {b}");
  });

  it("returns the key itself for an unknown string", () => {
    expect(translate("en", "nope.missing")).toBe("nope.missing");
    expect(translate("ar", "nope.missing")).toBe("nope.missing");
  });
});

describe("localised statuses", () => {
  it("maps the production lifecycle onto customer vocabulary", () => {
    expect(translate("en", localizedStatus("ready").key)).toBe("Completed");
    expect(translate("ar", localizedStatus("ready").key)).toBe("مكتمل");
    expect(translate("en", localizedStatus("failed").key)).toBe("Failed");
    expect(translate("ar", localizedStatus("failed").key)).toBe("فشل");
    expect(translate("en", localizedStatus("canceled").key)).toBe("Cancelled");
  });

  it("collapses many raw provider states onto the same five words", () => {
    expect(localizedStatus("live_verified").key).toBe("statuses.connected");
    expect(localizedStatus("invalid_credentials").key).toBe("statuses.needsAttention");
    expect(localizedStatus("provider_unavailable").key).toBe("statuses.unavailable");
    expect(localizedStatus("not_configured").key).toBe("statuses.notConfigured");
  });

  it("treats a never-configured optional provider as neutral, not as a fault", () => {
    expect(localizedStatus("not_configured").tone).toBe("neutral");
    expect(localizedStatus(null).tone).toBe("neutral");
    expect(localizedStatus(undefined).tone).toBe("neutral");
  });

  it("never presents an unrecognised state as success", () => {
    const unknown = localizedStatus("some_state_we_have_never_seen");
    expect(unknown.key).toBe("statuses.needsAttention");
    expect(unknown.tone).toBe("warning");
  });

  it("has a translated label and a colour for every mapped status", () => {
    for (const raw of ["ready", "failed", "rendering", "not_configured", "unavailable"]) {
      const descriptor = localizedStatus(raw);
      expect(CATALOGS.en[descriptor.key], `en ${raw}`).toBeTruthy();
      expect(CATALOGS.ar[descriptor.key], `ar ${raw}`).toBeTruthy();
      expect(TONE_TO_MUI_COLOR[descriptor.tone]).toBeTruthy();
    }
  });
});
