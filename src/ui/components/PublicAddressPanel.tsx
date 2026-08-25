import React, { useEffect, useState } from "react";
import axios from "axios";
import {
  Alert,
  Box,
  Button,
  Grid,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopyOutlined";

/**
 * SETTINGS -> PUBLIC ADDRESS
 *
 * The one place an installation's address is configured. A workstation install
 * serves http://localhost:3130; a server install serves the customer's own
 * domain. Every OAuth callback URL is derived from this value, so moving an
 * installation onto a domain is a form field rather than a source edit.
 */

interface PublicUrlState {
  url: string;
  source: "configured" | "environment" | "default";
  isLocal: boolean;
  isSecure: boolean;
  warnings: string[];
  callbackUrls: Record<string, string>;
  trustedProxy: { enabled: boolean; description: string };
}

const PROVIDER_LABELS: Record<string, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  meta: "Instagram / Facebook",
};

const SOURCE_LABELS: Record<PublicUrlState["source"], string> = {
  configured: "Set here in Settings",
  environment: "Set by the installer",
  default: "Default for a local installation",
};

const PublicAddressPanel: React.FC = () => {
  const [state, setState] = useState<PublicUrlState | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const response = await axios.get("/api/v2/system/public-url");
      setState(response.data);
      setDraft(response.data.url || "");
    } catch {
      setError("The public address could not be read.");
    }
  };

  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      // Saved through the ordinary settings endpoint, so it is validated with
      // every other setting rather than through a second, looser path.
      await axios.put("/api/v2/settings", { canonicalPublicUrl: draft.trim() });
      await load();
      setMessage(
        "Address saved. Re-register the callback URLs below in each provider's console.",
      );
    } catch (err: any) {
      setError(
        err?.response?.data?.error ||
          "That address could not be saved. Enter a full address, for example https://shorts.example.com",
      );
    } finally {
      setSaving(false);
    }
  };

  const copy = (value: string) => {
    navigator.clipboard?.writeText(value).catch(() => undefined);
  };

  if (!state) {
    return error ? <Alert severity="warning">{error}</Alert> : null;
  }

  return (
    <Stack spacing={2}>
      {message && <Alert severity="success" onClose={() => setMessage(null)}>{message}</Alert>}
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      <Grid container spacing={1.5} alignItems="flex-start">
        <Grid item xs={12} md={8}>
          <TextField
            fullWidth
            label="Public address"
            placeholder="https://shorts.example.com"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            helperText={`Currently: ${SOURCE_LABELS[state.source]}`}
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <Button
            fullWidth
            variant="contained"
            disabled={saving || !draft.trim() || draft.trim() === state.url}
            onClick={save}
            sx={{ height: 56 }}
          >
            {saving ? "Saving..." : "Save Address"}
          </Button>
        </Grid>
      </Grid>

      {state.warnings.map((warning) => (
        <Alert key={warning} severity="info">
          {warning}
        </Alert>
      ))}

      <Box>
        <Typography variant="subtitle2" fontWeight={800} gutterBottom>
          Callback URLs for connected accounts
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Paste the matching URL into each provider&apos;s developer console. They follow the
          address above, so changing it here changes them everywhere.
        </Typography>
        <Stack spacing={1}>
          {Object.entries(state.callbackUrls).map(([provider, url]) => (
            <Box
              key={provider}
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 1,
                p: 1.25,
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 2,
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" fontWeight={700}>
                  {PROVIDER_LABELS[provider] || provider}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: "block", wordBreak: "break-all" }}
                >
                  {url}
                </Typography>
              </Box>
              <Tooltip title="Copy">
                <IconButton size="small" onClick={() => copy(url)} aria-label={`Copy the ${provider} callback URL`}>
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          ))}
        </Stack>
      </Box>

      <Typography variant="caption" color="text.secondary">
        Reverse proxy: {state.trustedProxy.description}
      </Typography>
    </Stack>
  );
};

export default PublicAddressPanel;
