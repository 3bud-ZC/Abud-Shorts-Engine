import type { BrandKit } from "../../../types/shorts";

/**
 * BRAND STYLE RESOLUTION
 * ----------------------
 * Turns whatever the customer actually supplied in their Brand Profile into a
 * complete, contrast-checked visual system that the graphic treatments can use.
 *
 * Before F2.1 only `primaryColor` and `accentColor` ever reached a renderer, and
 * only the Motion Engine read them: mockups always drew the built-in teal, and
 * the brand name, website, social handle and CTA never appeared in a generated
 * graphic at all. A customer who filled in their Brand Profile could not see any
 * difference in the finished video.
 *
 * Two rules govern everything here:
 *
 *  - Nothing is invented. A field the customer did not supply is reported as
 *    `provided: false` and filled from neutral ABUD production defaults; the
 *    result never claims the customer chose it.
 *  - Nothing is unreadable. Every text-on-surface pairing the treatments use is
 *    measured against WCAG contrast and corrected before it is handed out.
 */

export type ResolvedPalette = {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  textMuted: string;
  /** Legible text colour to place on top of `primary`. */
  onPrimary: string;
  /** Legible text colour to place on top of `accent`. */
  onAccent: string;
};

export type BrandFieldSource = "customer" | "derived" | "default";

export type BrandFieldReport = {
  brandName: BrandFieldSource;
  primaryColor: BrandFieldSource;
  secondaryColor: BrandFieldSource;
  accentColor: BrandFieldSource;
  logo: BrandFieldSource;
  website: BrandFieldSource;
  socialHandle: BrandFieldSource;
  cta: BrandFieldSource;
};

export type ContrastCheck = {
  pair: string;
  ratio: number;
  /** WCAG AA for large display text. Motion graphics text is always large. */
  passes: boolean;
};

export type ResolvedBrandStyle = {
  /** True when the customer supplied at least one brand field. */
  hasBrand: boolean;
  brandName?: string;
  website?: string;
  socialHandle?: string;
  ctaText?: string;
  watermarkText?: string;
  logoUrl?: string;
  palette: ResolvedPalette;
  sources: BrandFieldReport;
  contrast: ContrastCheck[];
  contrastCorrections: string[];
  presence: "none" | "subtle" | "prominent";
};

/**
 * Neutral ABUD production defaults. These are the engine's own house colours,
 * used when the customer supplied nothing; they are always reported as
 * `default`, never as the customer's choice.
 */
export const ABUD_DEFAULT_PALETTE: ResolvedPalette = {
  primary: "#24545A",
  secondary: "#1B3B47",
  accent: "#D28B4C",
  background: "#090D16",
  surface: "#132029",
  text: "#FFFFFF",
  textMuted: "#B9C6D2",
  onPrimary: "#FFFFFF",
  onAccent: "#12202A",
};

/** WCAG AA threshold for large text, which is all the graphic templates draw. */
export const MIN_CONTRAST_RATIO = 3;

const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function normalizeHex(value?: string | null): string | null {
  if (!value) return null;
  const match = HEX_PATTERN.exec(String(value).trim());
  if (!match) return null;
  const digits = match[1];
  const full =
    digits.length === 3
      ? digits
          .split("")
          .map((char) => char + char)
          .join("")
      : digits;
  return `#${full.toUpperCase()}`;
}

function toRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = normalizeHex(hex) || "#000000";
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  };
}

function toHex(r: number, g: number, b: number): string {
  const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
  return `#${[clamp(r), clamp(g), clamp(b)]
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

/** WCAG relative luminance. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = toRgb(hex);
  const channel = (value: number) => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two colours, 1..21. */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
}

/** Black or white, whichever is legible on the supplied surface. */
export function readableTextOn(background: string): string {
  return contrastRatio("#FFFFFF", background) >= contrastRatio("#12202A", background)
    ? "#FFFFFF"
    : "#12202A";
}

function mix(hex: string, target: string, amount: number): string {
  const a = toRgb(hex);
  const b = toRgb(target);
  return toHex(
    a.r + (b.r - a.r) * amount,
    a.g + (b.g - a.g) * amount,
    a.b + (b.b - a.b) * amount,
  );
}

export function darken(hex: string, amount: number): string {
  return mix(hex, "#000000", amount);
}

export function lighten(hex: string, amount: number): string {
  return mix(hex, "#FFFFFF", amount);
}

/**
 * Derives a companion colour from a single supplied one.
 *
 * A customer who gave only a primary colour has not chosen a secondary, so the
 * engine produces a related neutral rather than inventing a second brand colour
 * and presenting it as theirs. Rotating the hue by a small amount and dropping
 * the luminance keeps the result recognisably part of the same family.
 */
export function deriveSecondary(primary: string): string {
  const { r, g, b } = toRgb(primary);
  const luminance = relativeLuminance(primary);
  // Dark primaries need a lighter companion to stay distinguishable, and the
  // reverse for light ones.
  const shifted = luminance < 0.2 ? lighten(primary, 0.18) : darken(primary, 0.28);
  // A gentle channel rotation keeps it from reading as the same swatch twice.
  const rotated = toHex(
    toRgb(shifted).r * 0.92 + b * 0.08,
    toRgb(shifted).g * 0.94 + r * 0.06,
    toRgb(shifted).b * 0.94 + g * 0.06,
  );
  return rotated;
}

/** An accent derived from the primary when the customer supplied only one colour. */
export function deriveAccent(primary: string): string {
  const luminance = relativeLuminance(primary);
  return luminance < 0.35 ? lighten(primary, 0.55) : darken(primary, 0.4);
}

function firstNonEmpty(...values: Array<string | undefined | null>): string | undefined {
  for (const value of values) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (trimmed) return trimmed;
  }
  return undefined;
}

export type BrandStyleInput = {
  brandKit?: BrandKit | null;
  /** CTA copy from the production spec, used when the brand has no outro text. */
  ctaText?: string;
  /** Contact line from the production spec. */
  contactText?: string;
  presence?: "none" | "subtle" | "prominent";
};

/**
 * Resolves the full brand system.
 *
 * The returned `sources` report is the honest part: it says, field by field,
 * whether the value came from the customer, was derived from something they did
 * supply, or is an ABUD default. The UI shows this so nobody believes the engine
 * knows a brand colour it was never given.
 */
export function resolveBrandStyle(input: BrandStyleInput = {}): ResolvedBrandStyle {
  const kit = input.brandKit || undefined;
  const extras = (kit || {}) as BrandKit & {
    secondaryColor?: string;
    logoUrl?: string;
    websiteUrl?: string;
    socialHandle?: string;
  };

  const providedPrimary = normalizeHex(kit?.primaryColor);
  const providedSecondary = normalizeHex(extras.secondaryColor);
  const providedAccent = normalizeHex(kit?.accentColor);
  const brandName = firstNonEmpty(kit?.brandName);
  const website = firstNonEmpty(extras.websiteUrl);
  const socialHandle = firstNonEmpty(extras.socialHandle);
  const logoUrl = firstNonEmpty(extras.logoUrl);
  const ctaText = firstNonEmpty(kit?.outroText, input.ctaText);
  const watermarkText = firstNonEmpty(kit?.watermarkText, brandName);

  const sources: BrandFieldReport = {
    brandName: brandName ? "customer" : "default",
    primaryColor: providedPrimary ? "customer" : "default",
    secondaryColor: providedSecondary ? "customer" : providedPrimary ? "derived" : "default",
    accentColor: providedAccent ? "customer" : providedPrimary ? "derived" : "default",
    logo: logoUrl ? "customer" : "default",
    website: website ? "customer" : "default",
    socialHandle: socialHandle ? "customer" : "default",
    cta: ctaText ? "customer" : "default",
  };

  const primary = providedPrimary || ABUD_DEFAULT_PALETTE.primary;
  const secondary =
    providedSecondary || (providedPrimary ? deriveSecondary(primary) : ABUD_DEFAULT_PALETTE.secondary);
  const accent =
    providedAccent || (providedPrimary ? deriveAccent(primary) : ABUD_DEFAULT_PALETTE.accent);

  // The background stays a deep neutral pulled toward the primary rather than
  // the primary itself, so brand colour reads as accent rather than wash.
  let background = mix(ABUD_DEFAULT_PALETTE.background, primary, providedPrimary ? 0.22 : 0);
  const contrastCorrections: string[] = [];

  // The accent has to stand off the background or the CTA button disappears
  // into the card. Which side gives depends on who chose what: a colour the
  // customer supplied is theirs, so the engine moves its own background instead.
  let workingAccent = accent;
  for (let step = 0; step < 12 && contrastRatio(workingAccent, background) < MIN_CONTRAST_RATIO; step++) {
    const backgroundIsDark = relativeLuminance(background) < 0.5;
    if (providedAccent) {
      background = backgroundIsDark ? darken(background, 0.12) : lighten(background, 0.12);
      if (step === 0) {
        contrastCorrections.push("background deepened so the supplied accent stays visible");
      }
    } else {
      workingAccent = backgroundIsDark ? lighten(workingAccent, 0.12) : darken(workingAccent, 0.12);
      if (step === 0) {
        contrastCorrections.push("derived accent adjusted for contrast against the background");
      }
    }
  }

  const surface = mix(background, "#FFFFFF", 0.08);
  let text = readableTextOn(background);
  let textMuted = mix(text, background, 0.32);
  if (contrastRatio(textMuted, background) < MIN_CONTRAST_RATIO) {
    textMuted = mix(text, background, 0.18);
    contrastCorrections.push("muted text lightened to keep it legible on the background");
  }

  const onPrimary = readableTextOn(primary);
  let onAccent = readableTextOn(workingAccent);
  if (contrastRatio(onAccent, workingAccent) < MIN_CONTRAST_RATIO) {
    onAccent = relativeLuminance(workingAccent) > 0.4 ? "#000000" : "#FFFFFF";
    contrastCorrections.push("accent label forced to pure black or white for contrast");
  }
  if (contrastRatio(text, background) < MIN_CONTRAST_RATIO) {
    text = relativeLuminance(background) > 0.4 ? "#000000" : "#FFFFFF";
    contrastCorrections.push("body text forced to pure black or white for contrast");
  }

  const palette: ResolvedPalette = {
    primary,
    secondary,
    accent: workingAccent,
    background,
    surface,
    text,
    textMuted,
    onPrimary,
    onAccent,
  };

  const contrast: ContrastCheck[] = [
    { pair: "text on background", ratio: contrastRatio(text, background), passes: true },
    { pair: "muted text on background", ratio: contrastRatio(textMuted, background), passes: true },
    { pair: "label on primary", ratio: contrastRatio(onPrimary, primary), passes: true },
    { pair: "label on accent", ratio: contrastRatio(onAccent, workingAccent), passes: true },
    { pair: "accent on background", ratio: contrastRatio(workingAccent, background), passes: true },
  ].map((check) => ({ ...check, passes: check.ratio >= MIN_CONTRAST_RATIO }));

  const hasBrand = Boolean(
    brandName || providedPrimary || providedAccent || providedSecondary || logoUrl || website || socialHandle,
  );

  return {
    hasBrand,
    brandName,
    website,
    socialHandle,
    ctaText,
    watermarkText,
    logoUrl,
    palette,
    sources,
    contrast,
    contrastCorrections,
    presence: input.presence || (hasBrand ? "subtle" : "none"),
  };
}

/** The fields a graphic treatment is allowed to draw, with nothing invented. */
export function brandOverlayFields(style: ResolvedBrandStyle): {
  brandName?: string;
  website?: string;
  socialHandle?: string;
  ctaText?: string;
} {
  return {
    brandName: style.sources.brandName === "customer" ? style.brandName : undefined,
    website: style.sources.website === "customer" ? style.website : undefined,
    socialHandle: style.sources.socialHandle === "customer" ? style.socialHandle : undefined,
    ctaText: style.sources.cta === "customer" ? style.ctaText : undefined,
  };
}

/** Treatments that consume the brand system. Asserted by the brand tests. */
export const BRAND_AWARE_TREATMENTS = [
  "WEBSITE_MOCKUP",
  "DEVICE_MOCKUP",
  "KINETIC_TYPOGRAPHY",
  "STATS_CARD",
  "FEATURE_LIST",
  "COMPARISON",
  "PROCESS_STEPS",
  "PRODUCT_COMPOSITION",
  "CTA_SCENE",
] as const;
