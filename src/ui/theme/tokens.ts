/**
 * ABUD DESIGN TOKENS
 * ------------------
 * The single source of colour, radius, spacing and elevation for the whole
 * dashboard. Components read from here (or from the MUI theme built on top of
 * it) and never hardcode a hex value, so the product reads as one system.
 *
 * Visual direction: premium near-black surfaces, a violet primary identity, a
 * restrained cyan accent and a green success state, with glow used sparingly.
 * This is an operational control panel, not a marketing page - contrast and
 * legibility win over spectacle, and glow is never placed behind body text.
 */

export type AbudPalette = {
  background: string;
  backgroundAlt: string;
  surface: string;
  surfaceElevated: string;
  surfaceHover: string;
  border: string;
  borderStrong: string;
  primary: string;
  primaryHover: string;
  primaryMuted: string;
  secondary: string;
  secondaryMuted: string;
  success: string;
  successMuted: string;
  warning: string;
  warningMuted: string;
  danger: string;
  dangerMuted: string;
  info: string;
  textPrimary: string;
  textSecondary: string;
  muted: string;
  focus: string;
  shadow: string;
  glow: string;
};

/** Canonical ABUD dark theme. */
export const abudDark: AbudPalette = {
  background: "#07070C",
  backgroundAlt: "#0B0B14",
  surface: "#101020",
  surfaceElevated: "#16162A",
  surfaceHover: "#1C1C33",
  border: "rgba(255, 255, 255, 0.08)",
  borderStrong: "rgba(255, 255, 255, 0.16)",
  primary: "#8B5CF6",
  primaryHover: "#A78BFA",
  primaryMuted: "rgba(139, 92, 246, 0.16)",
  secondary: "#22D3EE",
  secondaryMuted: "rgba(34, 211, 238, 0.14)",
  success: "#34D399",
  successMuted: "rgba(52, 211, 153, 0.14)",
  warning: "#FBBF24",
  warningMuted: "rgba(251, 191, 36, 0.14)",
  danger: "#F87171",
  dangerMuted: "rgba(248, 113, 113, 0.14)",
  info: "#60A5FA",
  textPrimary: "#F4F4FB",
  // Deliberately high for a dark UI: secondary text still has to be read.
  textSecondary: "#A9A9C4",
  muted: "#6E6E8C",
  focus: "#A78BFA",
  shadow: "0 18px 40px rgba(0, 0, 0, 0.55)",
  glow: "0 0 0 1px rgba(139, 92, 246, 0.35), 0 0 24px rgba(139, 92, 246, 0.18)",
};

/**
 * Optional light theme. Kept so the existing architecture still supports it,
 * but dark is canonical and is what the product ships with.
 */
export const abudLight: AbudPalette = {
  background: "#F6F6FA",
  backgroundAlt: "#FFFFFF",
  surface: "#FFFFFF",
  surfaceElevated: "#FFFFFF",
  surfaceHover: "#F1F0FA",
  border: "rgba(16, 16, 32, 0.10)",
  borderStrong: "rgba(16, 16, 32, 0.18)",
  primary: "#6D28D9",
  primaryHover: "#5B21B6",
  primaryMuted: "rgba(109, 40, 217, 0.10)",
  secondary: "#0891B2",
  secondaryMuted: "rgba(8, 145, 178, 0.10)",
  success: "#047857",
  successMuted: "rgba(4, 120, 87, 0.10)",
  warning: "#B45309",
  warningMuted: "rgba(180, 83, 9, 0.10)",
  danger: "#B91C1C",
  dangerMuted: "rgba(185, 28, 28, 0.10)",
  info: "#1D4ED8",
  textPrimary: "#14142B",
  textSecondary: "#4A4A66",
  muted: "#6E6E8C",
  focus: "#6D28D9",
  shadow: "0 10px 24px rgba(16, 16, 32, 0.10)",
  glow: "0 0 0 1px rgba(109, 40, 217, 0.20)",
};

export const abudRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
};

/**
 * One family for the whole product. IBM Plex Sans Arabic ships both Arabic and
 * Latin glyphs, so mixed Arabic/English UI stays visually consistent, and it is
 * bundled locally - the dashboard never requests a font over the network.
 */
export const ABUD_FONT_STACK =
  '"IBM Plex Sans Arabic", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';

/** Monospace is reserved for IDs and technical detail panels. */
export const ABUD_MONO_STACK =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
