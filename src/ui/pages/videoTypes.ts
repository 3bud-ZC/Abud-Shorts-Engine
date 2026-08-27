/**
 * CLIENT VIDEO TYPES
 * ------------------
 * Friendly labels over the engine's canonical production modes. The underlying
 * modes are unchanged - this only decides what the customer reads and picks.
 *
 * Every `mode` here is a real value of the engine's productionMode enum.
 */

export type VideoTypeId =
  | "auto"
  | "social_ad"
  | "product_ad"
  | "animated_explainer"
  | "motion_graphics"
  | "educational"
  | "cinematic_stock"
  | "website_promo"
  | "custom_media";

export type VideoTypeEntry = {
  id: VideoTypeId;
  label: string;
  /** Canonical productionMode understood by the engine. */
  mode: string;
  description: string;
  /** Sensible companion defaults applied when the type is chosen. */
  suggestedVisualMode?: string;
  suggestedCaptionStyle?: string;
};

export const VIDEO_TYPES: VideoTypeEntry[] = [
  {
    id: "auto",
    label: "Auto",
    mode: "auto_hybrid",
    description: "Let the Creative Director choose the best treatment from the prompt and available providers.",
    suggestedVisualMode: "auto",
    suggestedCaptionStyle: "social_ad",
  },
  {
    id: "social_ad",
    label: "Social / Reel",
    mode: "social_viral",
    description: "Fast hook, quick cuts, strong call to action. Best for Reels, Shorts and TikTok.",
    suggestedVisualMode: "auto",
    suggestedCaptionStyle: "social_ad",
  },
  {
    id: "product_ad",
    label: "Product Ad",
    mode: "product_ad",
    description: "Built around a product photo you upload.",
    suggestedVisualMode: "product_ad",
    suggestedCaptionStyle: "social_ad",
  },
  {
    id: "website_promo",
    label: "Website / App Promo",
    mode: "auto_hybrid",
    description: "Mixes real footage with clean website and app mockups.",
    suggestedVisualMode: "auto",
    suggestedCaptionStyle: "social_ad",
  },
  {
    id: "animated_explainer",
    label: "Animated Explainer",
    mode: "animated_explainer",
    description: "Explains an idea with animation rather than footage.",
    suggestedVisualMode: "animated_explainer",
    suggestedCaptionStyle: "clean_professional",
  },
  {
    id: "motion_graphics",
    label: "Motion Graphics",
    mode: "motion_graphics",
    description: "Text and graphics led, no stock footage.",
    suggestedVisualMode: "motion_graphics",
    suggestedCaptionStyle: "kinetic_phrase",
  },
  {
    id: "educational",
    label: "Educational",
    mode: "educational",
    description: "Clear teaching flow with a calmer pace.",
    suggestedVisualMode: "auto",
    suggestedCaptionStyle: "clean_professional",
  },
  {
    id: "cinematic_stock",
    label: "Cinematic",
    mode: "stock_cinematic",
    description: "Polished stock edit with a filmic feel.",
    suggestedVisualMode: "stock",
    suggestedCaptionStyle: "minimal",
  },
  {
    id: "custom_media",
    label: "Custom Media",
    mode: "custom_media",
    description: "Uses media you upload rather than stock footage.",
    suggestedVisualMode: "uploaded_media",
    suggestedCaptionStyle: "clean_professional",
  },
];

export function videoTypeByMode(mode: string): VideoTypeEntry | undefined {
  return VIDEO_TYPES.find((entry) => entry.mode === mode);
}

export function videoTypeById(id: string): VideoTypeEntry | undefined {
  return VIDEO_TYPES.find((entry) => entry.id === id);
}

/** Friendly caption-style names, so raw style ids never reach normal UX. */
export const CAPTION_STYLE_LABELS: Record<string, string> = {
  social_ad: "Bold Social",
  clean_professional: "Clean",
  minimal: "Minimal",
  kinetic_phrase: "Bold Social",
  karaoke: "Karaoke",
  legacy_cairo: "Legacy",
  none: "No captions",
  cinematic: "Cinematic",
  viral_bold: "Bold Social",
  clean: "Clean",
  bold: "Bold Social",
};

/** Friendly font names, matched to the caption style's own font. */
export const CAPTION_FONT_LABELS: Record<string, string> = {
  social_ad: "Noto Kufi Arabic",
  clean_professional: "IBM Plex Sans Arabic",
  minimal: "Noto Sans Arabic",
  kinetic_phrase: "Noto Kufi Arabic",
  karaoke: "IBM Plex Sans Arabic",
  legacy_cairo: "Cairo",
};

export const VISUAL_MODE_LABELS: Record<string, string> = {
  auto: "Auto Best",
  stock: "Stock",
  ai: "AI Generated",
  hybrid: "Mixed",
  motion_graphics: "Motion graphics",
  animated_explainer: "Animated explainer",
  product_ad: "Product composition",
  uploaded_media: "Your uploaded media",
  image_animation: "Animated images",
};

export const QUALITY_LABELS: Record<string, string> = {
  draft: "Fast — 720p render, quickest local production",
  standard: "Balanced — 1080p render, normal media intelligence",
  high: "High — richer pacing and multi-asset scene search",
  premium: "Premium — configured premium services",
  max_quality_local: "Maximum — 1080p render plus strongest local quality processors available",
};

/**
 * The durations the studio offers, shortest first. Settings and the Create page
 * share this list so a saved default is always selectable on both screens - an
 * option offered in one place but missing from the other renders an empty
 * Select and hides the value the user actually chose.
 */
export const DURATION_OPTIONS = [10, 15, 20, 30, 60];
