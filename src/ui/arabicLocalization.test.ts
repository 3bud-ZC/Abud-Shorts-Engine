import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

import { CATALOGS } from "./i18n/catalog";
import { INTEGRATION_CATALOG, catalogKey } from "./pages/integrationsCatalog";

/**
 * V2.3-AR — ARABIC BODY-COPY CLOSURE FOR THE OPERATOR CONFIGURATION SURFACES
 * ------------------------------------------------------------------------
 * Integrations, Publishing, Settings and Providers were the last screens with
 * hardcoded English body copy. This suite is the regression guard: every
 * customer string on those surfaces resolves through the shared i18n
 * catalogue, in both languages, with matching placeholders, and no developer
 * vocabulary leaks into normal (non-Advanced) copy.
 */

const UI_ROOT = path.resolve(__dirname);

/** The four target surfaces and every child component they render copy through. */
const SURFACE_FILES = [
  "pages/IntegrationsPage.tsx",
  "pages/integrationsCatalog.ts",
  "pages/PublishingPage.tsx",
  "pages/SettingsPage.tsx",
  "pages/ProvidersPage.tsx",
  "components/PublicAddressPanel.tsx",
  "components/UpdateCenter.tsx",
  "components/publishing/AccountConnectModal.tsx",
];

const NAMESPACES = ["integrations", "publishing", "providers", "settings"] as const;

function read(relative: string): string {
  return fs.readFileSync(path.join(UI_ROOT, relative), "utf8");
}

function codeWithoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("catalogue coverage for the operator configuration surfaces", () => {
  it("has an Arabic string for every key in the four target namespaces", () => {
    const missing = Object.keys(CATALOGS.en)
      .filter((key) => (NAMESPACES as readonly string[]).includes(key.split(".")[0]))
      .filter((key) => !CATALOGS.ar[key] || !CATALOGS.ar[key].trim());
    expect(missing).toEqual([]);
  });

  it("keeps interpolation placeholders identical between EN and AR on those surfaces", () => {
    const slots = (value: string) => (value.match(/\{(\w+)\}/g) || []).sort().join(",");
    const mismatched = Object.keys(CATALOGS.en)
      .filter((key) => (NAMESPACES as readonly string[]).includes(key.split(".")[0]))
      .filter((key) => slots(CATALOGS.en[key]) !== slots(CATALOGS.ar[key] || ""));
    expect(mismatched).toEqual([]);
  });

  it("writes real Arabic script for every non-identifier key on those surfaces", () => {
    const arabicScript = /[؀-ۿ]/;
    // Provider / product proper nouns: kept verbatim so the label matches the
    // provider's own console (mirrors the allow-set in i18n.test.ts).
    const properNouns = new Set([
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
    const untranslated = Object.keys(CATALOGS.ar)
      .filter((key) => (NAMESPACES as readonly string[]).includes(key.split(".")[0]))
      .filter((key) => !properNouns.has(key) && !arabicScript.test(CATALOGS.ar[key] || ""));
    expect(untranslated).toEqual([]);
  });

  it("has a bilingual label, purpose and cost for every catalogue provider", () => {
    for (const entry of Object.values(INTEGRATION_CATALOG)) {
      for (const field of ["label", "purpose", "cost"] as const) {
        expect(CATALOGS.en[catalogKey(entry.id, field)], `en ${entry.id}.${field}`).toBeTruthy();
        expect(CATALOGS.ar[catalogKey(entry.id, field)], `ar ${entry.id}.${field}`).toBeTruthy();
      }
    }
  });
});

describe("no hardcoded copy on the operator configuration surfaces", () => {
  /**
   * A JSX prop that renders customer text. A literal string here is a
   * localisation hole; the value must be a `tr(...)` call, an expression, or a
   * short technical token (a URL placeholder, a brand name).
   */
  const COPY_PROPS = ["label", "title", "description", "placeholder", "helperText", "confirmLabel", "eyebrow"];
  const ALLOWED_LITERALS = new Set([
    "https://shorts.example.com",
    "YouTube",
    "TikTok",
    "Instagram",
    "Facebook",
    "Telegram",
    "X / Twitter",
    "@MyChannel",
    "Africa/Cairo (EET)",
    "UTC",
    "Asia/Riyadh (AST)",
    "Asia/Dubai (GST)",
    "Europe/London (GMT/BST)",
    "America/New_York (EST/EDT)",
  ]);

  for (const file of SURFACE_FILES) {
    it(`routes every customer prop through the catalogue in ${file}`, () => {
      const code = codeWithoutComments(read(file));
      const offenders: string[] = [];
      for (const prop of COPY_PROPS) {
        const re = new RegExp(`\\b${prop}=\\{?"([^"]{2,})"`, "g");
        for (const match of code.matchAll(re)) {
          const value = match[1];
          if (ALLOWED_LITERALS.has(value)) continue;
          // A single lower-case token with no space is a technical value.
          if (!/\s/.test(value) && !/[A-Z]/.test(value)) continue;
          offenders.push(`${prop}="${value}"`);
        }
      }
      expect(offenders).toEqual([]);
    });

    it(`renders no bare English sentence as JSX text in ${file}`, () => {
      const code = codeWithoutComments(read(file));
      // `>Word another<` — a JSX text node of two+ ASCII words.
      const offenders = Array.from(code.matchAll(/>\s*([A-Za-z][A-Za-z]+(?:\s+[A-Za-z][A-Za-z']+){1,})\s*</g))
        .map((m) => m[1].trim())
        // JSX prop fragments and type text sneak into this crude scan; keep only
        // things that look like a real sentence fragment.
        .filter((s) => !/^(const|let|var|return|import|export|type|interface|function)\b/.test(s));
      expect(offenders).toEqual([]);
    });

    it(`imports the i18n hook in ${file}`, () => {
      const code = read(file);
      expect(/\bfrom "(\.\.?\/)+i18n"/.test(code) || file.endsWith("integrationsCatalog.ts")).toBe(true);
    });
  }
});

describe("no developer vocabulary in normal configuration copy", () => {
  it("keeps infrastructure terms out of the four target namespaces", () => {
    const forbidden = /\b(n8n|postgres|postgresql|remotion|ffmpeg|whisper|docker|kubernetes|redis|\.env|service token|worker lease|checkpoint)\b/i;
    for (const locale of ["en", "ar"] as const) {
      const offenders = Object.entries(CATALOGS[locale])
        .filter(([key]) => (NAMESPACES as readonly string[]).includes(key.split(".")[0]))
        .filter(([, value]) => forbidden.test(value))
        .map(([key]) => `${locale}:${key}`);
      expect(offenders).toEqual([]);
    }
  });

  it("exposes no environment-variable identifiers on the Providers surface", () => {
    const code = codeWithoutComments(read("pages/ProvidersPage.tsx"));
    expect(code).not.toMatch(/[A-Z][A-Z0-9]*_API_KEY|process\.env\./);
  });
});

describe("shared status vocabulary stays centralised", () => {
  it("resolves integration and provider status through the one localised model", () => {
    // The Integrations page uses `statusDescriptor` (which now carries i18n
    // keys); Providers and Publishing use `<StatusBadge>` (which resolves
    // through `localizedStatus`). Neither builds its own status words.
    const integrations = read("pages/IntegrationsPage.tsx");
    expect(integrations).toContain("statusDescriptor");
    expect(integrations).toMatch(/tr\(descriptor\.labelKey\)/);

    const providers = read("pages/ProvidersPage.tsx");
    expect(providers).toContain("<StatusBadge");
    expect(providers).not.toMatch(/status\.replace\(/);
    // The endpoint's raw `message` leaks env-var names; the page derives a
    // localised line from the status instead.
    expect(providers).not.toMatch(/\{provider\.message\}/);
    expect(providers).toContain("providerDescription(provider)");
  });

  it("has the shared Configured / Ready to Connect states bilingual", () => {
    for (const key of ["statuses.configured", "statuses.readyToConnect", "statuses.notConfigured", "statuses.expired"]) {
      expect(CATALOGS.en[key], `en ${key}`).toBeTruthy();
      expect(CATALOGS.ar[key], `ar ${key}`).toBeTruthy();
    }
  });
});
