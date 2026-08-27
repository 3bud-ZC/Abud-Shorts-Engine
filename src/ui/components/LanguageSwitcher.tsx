import React from "react";
import { Box, Button, Menu, MenuItem, Stack, Tooltip, Typography, useTheme } from "@mui/material";
import TranslateIcon from "@mui/icons-material/TranslateOutlined";
import CheckIcon from "@mui/icons-material/Check";

import { useI18n } from "../i18n";
import { LOCALE_NATIVE_NAME, UI_LOCALES, type UiLocale } from "../i18n/types";

/**
 * LANGUAGE SWITCHER
 * -----------------
 * Visible on every screen of the shell, but deliberately quiet: a text button
 * showing the current language, not a coloured call to action. Changing the
 * interface language is something an operator does once, not something the
 * product should keep advertising.
 *
 * Each option is written in its own language ("English", "العربية") rather than
 * translated, because someone who cannot read the current interface still has
 * to be able to find their way out of it.
 *
 * This control never touches narration language. That is a per-production
 * setting, and the tooltip says so.
 */
export const LanguageSwitcher: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { locale, setLocale, t } = useI18n();
  const theme = useTheme();
  const [anchor, setAnchor] = React.useState<null | HTMLElement>(null);

  const choose = (next: UiLocale) => {
    setAnchor(null);
    if (next !== locale) setLocale(next);
  };

  return (
    <>
      <Tooltip title={t("common.languageHint")}>
        <Button
          onClick={(event) => setAnchor(event.currentTarget)}
          startIcon={<TranslateIcon />}
          size="small"
          aria-label={t("common.changeLanguage")}
          aria-haspopup="menu"
          aria-expanded={anchor ? "true" : undefined}
          sx={{
            color: theme.abud.textSecondary,
            minHeight: 34,
            px: 1.25,
            fontWeight: 600,
            "& .MuiButton-startIcon": { marginInlineEnd: 0.75, marginInlineStart: -0.25 },
            "&:hover": { color: theme.abud.textPrimary, bgcolor: theme.abud.surfaceHover },
          }}
        >
          {compact ? locale.toUpperCase() : LOCALE_NATIVE_NAME[locale]}
        </Button>
      </Tooltip>

      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        MenuListProps={{ "aria-label": t("common.interfaceLanguage") }}
      >
        {UI_LOCALES.map((option) => (
          <MenuItem
            key={option}
            selected={option === locale}
            onClick={() => choose(option)}
            sx={{ minWidth: 190, gap: 1.5 }}
          >
            <Box sx={{ width: 18, display: "flex", alignItems: "center" }}>
              {option === locale && <CheckIcon fontSize="small" color="primary" />}
            </Box>
            <Stack sx={{ minWidth: 0 }}>
              {/* Each name is rendered in its own direction so "العربية" reads
                  correctly while the English interface is still left-to-right. */}
              <Typography
                variant="body2"
                dir={option === "ar" ? "rtl" : "ltr"}
                sx={{ fontWeight: option === locale ? 650 : 500 }}
              >
                {LOCALE_NATIVE_NAME[option]}
              </Typography>
            </Stack>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
};

export default LanguageSwitcher;
