import { createTheme, type Theme } from "@mui/material";
import { ABUD_FONT_STACK, abudDark, abudLight, abudRadius, type AbudPalette } from "./tokens";

/**
 * Builds the MUI theme from ABUD tokens.
 *
 * Everything visual is derived here so a component never needs a literal
 * colour. Where a component does need a token directly it reads
 * `theme.abud`, which carries the full palette.
 */
declare module "@mui/material/styles" {
  interface Theme {
    abud: AbudPalette;
  }
  interface ThemeOptions {
    abud?: AbudPalette;
  }
}

export function buildAbudTheme(mode: "dark" | "light" = "dark"): Theme {
  const t = mode === "dark" ? abudDark : abudLight;
  const isDark = mode === "dark";

  return createTheme({
    abud: t,
    palette: {
      mode,
      primary: { main: t.primary, dark: t.primaryHover, contrastText: "#FFFFFF" },
      secondary: { main: t.secondary, contrastText: isDark ? "#04121A" : "#FFFFFF" },
      success: { main: t.success },
      warning: { main: t.warning },
      error: { main: t.danger },
      info: { main: t.info },
      background: { default: t.background, paper: t.surface },
      text: { primary: t.textPrimary, secondary: t.textSecondary, disabled: t.muted },
      divider: t.border,
    },
    shape: { borderRadius: abudRadius.md },
    typography: {
      fontFamily: ABUD_FONT_STACK,
      button: { textTransform: "none", fontWeight: 600, letterSpacing: 0 },
      h4: { fontWeight: 700, letterSpacing: "-0.02em" },
      h5: { fontWeight: 700, letterSpacing: "-0.01em" },
      h6: { fontWeight: 650, letterSpacing: 0 },
      subtitle1: { fontWeight: 600 },
      subtitle2: { fontWeight: 600 },
      caption: { letterSpacing: 0 },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundColor: t.background,
            color: t.textPrimary,
          },
          "::selection": {
            background: t.primaryMuted,
            color: t.textPrimary,
          },
          "*::-webkit-scrollbar": { width: 10, height: 10 },
          "*::-webkit-scrollbar-track": { background: "transparent" },
          "*::-webkit-scrollbar-thumb": {
            background: isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.20)",
            borderRadius: 8,
            border: "2px solid transparent",
            backgroundClip: "content-box",
          },
          "*::-webkit-scrollbar-thumb:hover": {
            background: isDark ? "rgba(255,255,255,0.24)" : "rgba(0,0,0,0.32)",
            backgroundClip: "content-box",
          },
          // A single visible focus treatment across the whole product.
          ":focus-visible": {
            outline: `2px solid ${t.focus}`,
            outlineOffset: 2,
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: "none",
            backgroundColor: t.surface,
            border: `1px solid ${t.border}`,
          },
        },
      },
      MuiCard: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            backgroundColor: t.surface,
            border: `1px solid ${t.border}`,
            borderRadius: abudRadius.lg,
            backgroundImage: "none",
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { borderRadius: abudRadius.sm, minHeight: 40 },
          containedPrimary: {
            backgroundColor: t.primary,
            "&:hover": { backgroundColor: t.primaryHover },
          },
          outlined: {
            borderColor: t.borderStrong,
            "&:hover": { borderColor: t.primary, backgroundColor: t.primaryMuted },
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: abudRadius.pill, fontWeight: 600 },
          outlined: { borderColor: t.borderStrong },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            backgroundColor: isDark ? t.backgroundAlt : "#FFFFFF",
            borderRadius: abudRadius.sm,
            "& .MuiOutlinedInput-notchedOutline": { borderColor: t.border },
            "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: t.borderStrong },
            "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
              borderColor: t.primary,
              borderWidth: 2,
            },
          },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: { borderColor: t.border },
          head: { color: t.textSecondary, fontWeight: 650 },
        },
      },
      MuiDivider: { styleOverrides: { root: { borderColor: t.border } } },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            backgroundColor: t.surfaceElevated,
            border: `1px solid ${t.border}`,
            color: t.textPrimary,
            fontSize: "0.78rem",
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: { backgroundColor: t.surfaceElevated, borderRadius: abudRadius.lg },
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: { borderRadius: abudRadius.md, border: `1px solid ${t.border}` },
        },
      },
      MuiLinearProgress: {
        styleOverrides: {
          root: { borderRadius: abudRadius.pill, height: 8, backgroundColor: t.surfaceHover },
          bar: { borderRadius: abudRadius.pill },
        },
      },
      MuiAccordion: {
        defaultProps: { elevation: 0, disableGutters: true },
        styleOverrides: {
          root: {
            backgroundColor: t.surface,
            border: `1px solid ${t.border}`,
            borderRadius: abudRadius.md,
            "&::before": { display: "none" },
          },
        },
      },
    },
  });
}

export const abudTheme = buildAbudTheme("dark");
