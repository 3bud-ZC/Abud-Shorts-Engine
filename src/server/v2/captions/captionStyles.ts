/**
 * CAPTION STYLE SYSTEM (V3)
 * -------------------------
 * The V2.2 "viral_bold" treatment - very large white text, a very thick black
 * stroke and a separately positioned yellow active word - was rejected: the
 * duplicated active word broke Arabic shaping and the meme-weight outline did
 * not read as professional social video.
 *
 * V3 replaces it with a small set of designed styles. Every style declares its
 * own typography, safe area and emphasis treatment, and the active word is
 * never a second text object drawn over the phrase.
 */

export type CaptionStyleId =
  | "clean_professional"
  | "social_ad"
  | "minimal"
  | "kinetic_phrase"
  | "karaoke"
  | "legacy_cairo";

/** Logical font roles. The UI never shows raw font filenames. */
export type CaptionFontId =
  | "ibm_plex_sans_arabic"
  | "noto_kufi_arabic"
  | "noto_sans_arabic"
  | "cairo";

export type CaptionHighlightMode =
  /** libass karaoke timing inside one shaped run - shaping is preserved. */
  | "karaoke_fill"
  /** A rounded plate behind the active logical token. */
  | "token_chip"
  /** Whole-phrase emphasis; no per-word treatment at all. */
  | "phrase_pop"
  | "none";

export type CaptionFontSpec = {
  id: CaptionFontId;
  /** Family name as fontconfig reports it, used directly in the ASS style. */
  family: string;
  /** Files bundled under assets/fonts, for the loader's existence check. */
  files: string[];
  license: "OFL-1.1";
  weights: Record<string, number>;
};

export const CAPTION_FONTS: Record<CaptionFontId, CaptionFontSpec> = {
  ibm_plex_sans_arabic: {
    id: "ibm_plex_sans_arabic",
    family: "IBM Plex Sans Arabic",
    files: [
      "IBMPlexSansArabic-Regular.ttf",
      "IBMPlexSansArabic-Medium.ttf",
      "IBMPlexSansArabic-SemiBold.ttf",
      "IBMPlexSansArabic-Bold.ttf",
    ],
    license: "OFL-1.1",
    weights: { regular: 400, medium: 500, semibold: 600, bold: 700 },
  },
  noto_kufi_arabic: {
    id: "noto_kufi_arabic",
    family: "Noto Kufi Arabic",
    files: ["NotoKufiArabic-Variable.ttf", "NotoKufiArabic-Bold.ttf", "NotoKufiArabic-ExtraBold.ttf"],
    license: "OFL-1.1",
    weights: { regular: 400, bold: 700, extrabold: 800 },
  },
  noto_sans_arabic: {
    id: "noto_sans_arabic",
    family: "Noto Sans Arabic",
    files: ["NotoSansArabic-Variable.ttf", "NotoSansArabic-Medium.ttf", "NotoSansArabic-SemiBold.ttf"],
    license: "OFL-1.1",
    weights: { regular: 400, medium: 500, semibold: 600 },
  },
  cairo: {
    id: "cairo",
    family: "Cairo",
    files: ["Cairo-Variable.ttf", "Cairo-Bold.ttf"],
    license: "OFL-1.1",
    weights: { regular: 400, bold: 700 },
  },
};

export type CaptionStyleSpec = {
  id: CaptionStyleId;
  label: string;
  font: CaptionFontId;
  weight: "regular" | "medium" | "semibold" | "bold" | "extrabold";
  /** Font size bounds as a fraction of frame height; the renderer measures. */
  minSizeRatio: number;
  maxSizeRatio: number;
  lineHeight: number;
  /** Maximum text width as a fraction of frame width. */
  maxWidthRatio: number;
  /** Distance from the bottom of the frame as a fraction of frame height. */
  bottomSafeRatio: number;
  maxLines: number;
  primaryColour: string;
  highlightColour: string;
  outlinePx: number;
  shadowPx: number;
  /** Opacity 0..1 of the plate drawn behind the caption block. */
  backgroundOpacity: number;
  highlight: CaptionHighlightMode;
  animation: "none" | "fade" | "pop";
  fadeInMs: number;
  fadeOutMs: number;
};

export const CAPTION_STYLES: Record<CaptionStyleId, CaptionStyleSpec> = {
  clean_professional: {
    id: "clean_professional",
    label: "Clean Professional",
    font: "ibm_plex_sans_arabic",
    weight: "semibold",
    minSizeRatio: 0.032,
    maxSizeRatio: 0.044,
    lineHeight: 1.32,
    maxWidthRatio: 0.82,
    bottomSafeRatio: 0.18,
    maxLines: 2,
    primaryColour: "#FFFFFF",
    highlightColour: "#7FD1FF",
    outlinePx: 2,
    shadowPx: 2,
    backgroundOpacity: 0,
    highlight: "karaoke_fill",
    animation: "fade",
    fadeInMs: 120,
    fadeOutMs: 120,
  },
  social_ad: {
    id: "social_ad",
    label: "Social Ad",
    font: "noto_kufi_arabic",
    weight: "bold",
    minSizeRatio: 0.036,
    maxSizeRatio: 0.05,
    lineHeight: 1.28,
    maxWidthRatio: 0.8,
    bottomSafeRatio: 0.2,
    maxLines: 2,
    primaryColour: "#FFFFFF",
    highlightColour: "#FFC53D",
    // A small outline plus a soft plate, not a meme-weight stroke.
    outlinePx: 3,
    shadowPx: 3,
    backgroundOpacity: 0.32,
    highlight: "karaoke_fill",
    animation: "pop",
    fadeInMs: 90,
    fadeOutMs: 110,
  },
  minimal: {
    id: "minimal",
    label: "Minimal",
    font: "noto_sans_arabic",
    weight: "medium",
    minSizeRatio: 0.028,
    maxSizeRatio: 0.038,
    lineHeight: 1.36,
    maxWidthRatio: 0.76,
    bottomSafeRatio: 0.16,
    maxLines: 2,
    primaryColour: "#FFFFFF",
    highlightColour: "#FFFFFF",
    outlinePx: 1,
    shadowPx: 2,
    backgroundOpacity: 0,
    highlight: "none",
    animation: "fade",
    fadeInMs: 140,
    fadeOutMs: 140,
  },
  kinetic_phrase: {
    id: "kinetic_phrase",
    label: "Kinetic Phrase",
    font: "noto_kufi_arabic",
    weight: "extrabold",
    minSizeRatio: 0.042,
    maxSizeRatio: 0.058,
    lineHeight: 1.22,
    maxWidthRatio: 0.78,
    bottomSafeRatio: 0.22,
    maxLines: 2,
    primaryColour: "#FFFFFF",
    highlightColour: "#FFC53D",
    outlinePx: 3,
    shadowPx: 4,
    backgroundOpacity: 0,
    // Whole-phrase emphasis: nothing is drawn per word, so shaping is safe.
    highlight: "phrase_pop",
    animation: "pop",
    fadeInMs: 80,
    fadeOutMs: 90,
  },
  karaoke: {
    id: "karaoke",
    label: "Karaoke",
    font: "ibm_plex_sans_arabic",
    weight: "bold",
    minSizeRatio: 0.034,
    maxSizeRatio: 0.046,
    lineHeight: 1.3,
    maxWidthRatio: 0.8,
    bottomSafeRatio: 0.18,
    maxLines: 2,
    primaryColour: "#FFFFFF",
    highlightColour: "#4ADE80",
    outlinePx: 2,
    shadowPx: 2,
    backgroundOpacity: 0.24,
    highlight: "karaoke_fill",
    animation: "fade",
    fadeInMs: 100,
    fadeOutMs: 100,
  },
  legacy_cairo: {
    id: "legacy_cairo",
    label: "Legacy (Cairo)",
    font: "cairo",
    weight: "bold",
    minSizeRatio: 0.034,
    maxSizeRatio: 0.048,
    lineHeight: 1.3,
    maxWidthRatio: 0.82,
    bottomSafeRatio: 0.18,
    maxLines: 2,
    primaryColour: "#FFFFFF",
    highlightColour: "#FFC53D",
    outlinePx: 3,
    shadowPx: 3,
    backgroundOpacity: 0,
    highlight: "token_chip",
    animation: "fade",
    fadeInMs: 120,
    fadeOutMs: 120,
  },
};

export const CAPTION_STYLE_IDS = Object.keys(CAPTION_STYLES) as CaptionStyleId[];

/**
 * Maps the historical captionStyle vocabulary onto V3 styles so existing specs,
 * templates and saved brand profiles keep working.
 */
const LEGACY_STYLE_ALIASES: Record<string, CaptionStyleId> = {
  viral_bold: "social_ad",
  viral: "social_ad",
  bold: "social_ad",
  cinematic: "clean_professional",
  clean: "clean_professional",
  educational: "clean_professional",
  product_ad: "social_ad",
  brand: "clean_professional",
  minimal: "minimal",
};

export function resolveCaptionStyle(styleId?: string): CaptionStyleSpec {
  if (!styleId) return CAPTION_STYLES.social_ad;
  if (styleId in CAPTION_STYLES) return CAPTION_STYLES[styleId as CaptionStyleId];
  const alias = LEGACY_STYLE_ALIASES[styleId];
  if (alias) return CAPTION_STYLES[alias];
  return CAPTION_STYLES.social_ad;
}

export function captionFontFor(style: CaptionStyleSpec): CaptionFontSpec {
  return CAPTION_FONTS[style.font];
}
