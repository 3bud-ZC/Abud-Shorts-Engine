import React from "react";
import { Box, Card, Chip, Grid, Stack, Typography, useTheme } from "@mui/material";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesomeOutlined";

import {
  CAPTION_FONT_LABELS,
  CAPTION_STYLE_LABELS,
  QUALITY_LABELS,
  VISUAL_MODE_LABELS,
} from "../pages/videoTypes";
import { videoCostLabel, type CostEstimateLike } from "../../types/costDisplay";

/**
 * RESOLVED PRODUCTION SUMMARY
 * ---------------------------
 * Shows, in plain language, what the engine actually decided before the
 * customer commits to a production: which voice, which captions, which visual
 * router, what quality and what it will cost.
 *
 * Every value is read from the server's own canonical contract. A field the
 * server did not resolve is omitted rather than rendered as undefined.
 */

export type ProductionSummaryProps = {
  spec: any;
  costEstimate?: CostEstimateLike;
  readiness?: any;
};

type SummaryRow = { label: string; value: string; hint?: string };

/** Describes the resolved voice using only what the server reported. */
function voiceRow(spec: any): SummaryRow | null {
  const contract = spec?.metadata?.uiContract || {};
  const provider = contract.resolvedVoiceProvider || spec?.voiceProvider;
  if (!provider || provider === "auto") return null;

  const parts: string[] = [provider === "elevenlabs" ? "ElevenLabs" : String(provider)];
  if (contract.voiceName) parts.push(String(contract.voiceName));
  const preset = contract.voicePreset || spec?.voicePreset;
  if (preset) {
    parts.push(
      String(preset)
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" "),
    );
  }

  const hint =
    contract.voiceSource === "persisted_human_default"
      ? "Your saved default voice"
      : contract.voiceSource === "explicit_request"
        ? "Chosen for this video"
        : undefined;

  return { label: spec?.language === "ar" ? "Arabic Voice" : "Voice", value: parts.join(" · "), hint };
}

function captionRow(spec: any): SummaryRow | null {
  const style = spec?.captionStyle;
  if (!style || style === "none") return null;
  const styleLabel = CAPTION_STYLE_LABELS[style] || String(style);
  const font = CAPTION_FONT_LABELS[style];
  return { label: "Captions", value: font ? `${styleLabel} · ${font}` : styleLabel };
}

export const ProductionSummary: React.FC<ProductionSummaryProps> = ({ spec, costEstimate, readiness }) => {
  const theme = useTheme();
  const t = theme.abud;
  if (!spec) return null;

  const rows: SummaryRow[] = [];
  const voice = voiceRow(spec);
  if (voice) rows.push(voice);
  const captions = captionRow(spec);
  if (captions) rows.push(captions);

  const visualMode = spec.visualMode;
  const contract = spec?.metadata?.uiContract || {};
  if (contract.sourceStrategy || visualMode) {
    rows.push({
      label: "Visuals",
      value: contract.sourceStrategy || VISUAL_MODE_LABELS[visualMode] || String(visualMode),
      hint:
        contract.stockProvider && contract.stockProvider !== "auto_stock"
          ? String(contract.stockProvider)
          : contract.aiVisualProvider && contract.aiVisualProvider !== "auto"
            ? String(contract.aiVisualProvider)
            : undefined,
    });
  }

  const resolution = spec.resolution;
  const quality = spec.quality;
  if (resolution || quality) {
    const qualityLabel = quality ? (QUALITY_LABELS[quality] || String(quality)).split(" — ")[0] : "";
    rows.push({
      label: "Quality",
      value: [resolution, qualityLabel].filter(Boolean).join(" · "),
    });
  }

  if (spec.durationSeconds) {
    rows.push({ label: "Length", value: `${spec.durationSeconds}s · ${spec.aspectRatio || "9:16"}` });
  }

  // Always shown, and never as a raw number that might be undefined.
  rows.push({
    label: "External Usage",
    value: readiness?.externalUsage?.length ? readiness.externalUsage.join(" · ") : videoCostLabel(costEstimate),
  });
  rows.push({
    label: "Readiness",
    value: readiness ? (readiness.ready ? "Ready" : "Blocked") : "Preview not required",
    hint: readiness && !readiness.ready ? readiness.missingRequirements?.[0] : undefined,
  });

  return (
    <Card sx={{ p: 2.5, borderColor: t.primaryMuted }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
        <AutoAwesomeIcon sx={{ color: t.primary, fontSize: 20 }} />
        <Typography variant="subtitle1" fontWeight={650}>
          What will be produced
        </Typography>
      </Stack>
      <Grid container spacing={2}>
        {rows.map((row) => (
          <Grid item xs={12} sm={6} md={4} key={row.label}>
            <Typography variant="caption" sx={{ color: t.muted, display: "block" }}>
              {row.label}
            </Typography>
            <Typography variant="body2" fontWeight={600} sx={{ mt: 0.25 }}>
              {row.value}
            </Typography>
            {row.hint && (
              <Chip
                size="small"
                variant="outlined"
                label={row.hint}
                sx={{ mt: 0.75, height: 22, fontSize: "0.7rem" }}
              />
            )}
          </Grid>
        ))}
      </Grid>
      <Box sx={{ mt: 2 }}>
        <Typography variant="caption" sx={{ color: t.muted }}>
          You can change any of this under Advanced before creating the video.
        </Typography>
      </Box>
    </Card>
  );
};

export default ProductionSummary;
