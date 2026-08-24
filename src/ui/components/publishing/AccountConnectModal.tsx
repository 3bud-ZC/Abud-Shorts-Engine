import React, { useMemo, useState } from "react";
import axios from "axios";
import {
  Alert,
  Box,
  Button,
  Card,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  Stack,
  TextField,
  Typography,
  useTheme,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBackOutlined";
import YouTubeIcon from "@mui/icons-material/YouTube";
import InstagramIcon from "@mui/icons-material/Instagram";
import TelegramIcon from "@mui/icons-material/Telegram";
import CloudUploadIcon from "@mui/icons-material/CloudUploadOutlined";
import MusicNoteIcon from "@mui/icons-material/MusicNoteOutlined";
import type { PublishingPlatform, SocialAccount } from "../../pages/v2Types";

/**
 * PUBLISHING CONNECTION
 * ---------------------
 * Each destination gets the form it actually needs.
 *
 * The previous single generic form asked every customer for
 * "Account ID / Handle / Chat ID" and an "API Key / Access Token / Bot Token
 * (Optional if set in environment)" - developer vocabulary that also told the
 * customer to go and edit a file they are never meant to touch. Where the
 * engine has OAuth, we send them to it; where a service genuinely needs a
 * token (Telegram bots, Upload-Post), we ask for that and nothing else.
 */

interface AccountConnectModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (account: SocialAccount) => void;
}

type FieldKey = "accountName" | "accountId" | "token";

type DestinationField = {
  key: FieldKey;
  label: string;
  placeholder?: string;
  helper?: string;
  secret?: boolean;
  required: boolean;
};

type Destination = {
  id: string;
  label: string;
  blurb: string;
  icon: React.ReactNode;
  platform: PublishingPlatform;
  provider: string;
  /** OAuth destinations never ask for a pasted credential. */
  connection: "oauth" | "token";
  oauthProvider?: string;
  oauthLabel?: string;
  fields: DestinationField[];
};

const DESTINATIONS: Destination[] = [
  {
    id: "youtube",
    label: "YouTube",
    blurb: "Publish Shorts straight to your channel.",
    icon: <YouTubeIcon />,
    platform: "youtube",
    provider: "youtube_direct",
    connection: "oauth",
    oauthProvider: "youtube",
    oauthLabel: "Connect with Google",
    fields: [],
  },
  {
    id: "meta",
    label: "Instagram & Facebook",
    blurb: "Publish Reels to your connected pages.",
    icon: <InstagramIcon />,
    platform: "instagram",
    provider: "meta_direct",
    connection: "oauth",
    oauthProvider: "meta",
    oauthLabel: "Connect Meta Account",
    fields: [],
  },
  {
    id: "tiktok",
    label: "TikTok",
    blurb: "Publish videos to your TikTok account.",
    icon: <MusicNoteIcon />,
    platform: "tiktok",
    provider: "tiktok_direct",
    connection: "oauth",
    oauthProvider: "tiktok",
    oauthLabel: "Connect TikTok",
    fields: [],
  },
  {
    id: "telegram",
    label: "Telegram",
    blurb: "Send finished videos to a channel or chat.",
    icon: <TelegramIcon />,
    platform: "telegram",
    provider: "telegram_bot",
    connection: "token",
    fields: [
      {
        key: "accountName",
        label: "Display name",
        placeholder: "My Brand Channel",
        required: true,
        helper: "Only used to label this connection in ABUD Shorts.",
      },
      {
        key: "accountId",
        label: "Channel or chat",
        placeholder: "@MyChannel",
        required: true,
        helper: "The channel username, or the numeric chat id for a private group.",
      },
      {
        key: "token",
        label: "Bot token",
        placeholder: "Paste the token from @BotFather",
        secret: true,
        required: true,
        helper: "Stored encrypted and never shown again.",
      },
    ],
  },
  {
    id: "upload_post",
    label: "Upload-Post",
    blurb: "Publish to several platforms through one service.",
    icon: <CloudUploadIcon />,
    platform: "youtube",
    provider: "upload_post",
    connection: "token",
    fields: [
      {
        key: "accountName",
        label: "Display name",
        placeholder: "My Upload-Post account",
        required: true,
        helper: "Only used to label this connection in ABUD Shorts.",
      },
      {
        key: "token",
        label: "Upload-Post API key",
        placeholder: "Paste your API key",
        secret: true,
        required: true,
        helper: "Stored encrypted and never shown again.",
      },
    ],
  },
];

export const AccountConnectModal: React.FC<AccountConnectModalProps> = ({
  open,
  onClose,
  onSuccess,
}) => {
  const theme = useTheme();
  const t = theme.abud;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<FieldKey, string>>({
    accountName: "",
    accountId: "",
    token: "",
  });
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const destination = useMemo(
    () => DESTINATIONS.find((entry) => entry.id === selectedId) || null,
    [selectedId],
  );

  const reset = () => {
    setSelectedId(null);
    setValues({ accountName: "", accountId: "", token: "" });
    setError(null);
    setTestResult(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  /** Validation depends on the destination, not on one shared rule. */
  const missingField = destination?.fields.find(
    (field) => field.required && !values[field.key].trim(),
  );

  const startOauth = () => {
    if (!destination?.oauthProvider) return;
    window.location.href = `/api/v2/providers/${destination.oauthProvider}/oauth/start`;
  };

  const testConnection = async () => {
    if (!destination) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await axios.post(`/api/v2/providers/${destination.id}/validate`);
      const healthy = res.data?.healthy ?? res.data?.ok ?? false;
      setTestResult(
        healthy
          ? "Connection succeeded."
          : res.data?.message || "The service did not accept these details.",
      );
    } catch (err: unknown) {
      const message =
        axios.isAxiosError(err) && err.response?.data?.message
          ? String(err.response.data.message)
          : "Could not reach the service.";
      setTestResult(message);
    } finally {
      setTesting(false);
    }
  };

  const submit = async () => {
    if (!destination || missingField) {
      setError(missingField ? `${missingField.label} is required.` : null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await axios.post("/api/v2/publishing/accounts", {
        platform: destination.platform,
        provider: destination.provider,
        accountName: values.accountName.trim(),
        // Upload-Post has no per-account handle; fall back to the display name.
        accountId: (values.accountId.trim() || values.accountName.trim()),
        token: values.token.trim() || undefined,
      });
      onSuccess(res.data.account);
      close();
    } catch (err: unknown) {
      const message =
        axios.isAxiosError(err) && err.response?.data?.message
          ? String(err.response.data.message)
          : "Could not connect this account.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={close} maxWidth="sm" fullWidth>
      <DialogTitle>
        {destination ? `Connect ${destination.label}` : "Connect a publishing account"}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          {!destination && (
            <>
              <Typography variant="body2" sx={{ color: t.textSecondary }}>
                Choose where you want your finished videos to go.
              </Typography>
              <Grid container spacing={1.5}>
                {DESTINATIONS.map((entry) => (
                  <Grid item xs={12} sm={6} key={entry.id}>
                    <Card
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedId(entry.id)}
                      onKeyDown={(event: React.KeyboardEvent) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedId(entry.id);
                        }
                      }}
                      sx={{
                        p: 1.75,
                        height: "100%",
                        cursor: "pointer",
                        "&:hover": { borderColor: "primary.main" },
                      }}
                    >
                      <Stack direction="row" spacing={1.25} alignItems="center">
                        <Box sx={{ color: t.primary, display: "flex" }}>{entry.icon}</Box>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2" fontWeight={650}>
                            {entry.label}
                          </Typography>
                          <Typography variant="caption" sx={{ color: t.textSecondary }}>
                            {entry.blurb}
                          </Typography>
                        </Box>
                      </Stack>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            </>
          )}

          {destination?.connection === "oauth" && (
            <Stack spacing={2} alignItems="flex-start">
              <Typography variant="body2" sx={{ color: t.textSecondary }}>
                {destination.blurb} You will be taken to {destination.label} to approve access, and
                sent straight back here.
              </Typography>
              <Button variant="contained" size="large" onClick={startOauth}>
                {destination.oauthLabel}
              </Button>
              <Typography variant="caption" sx={{ color: t.muted }}>
                ABUD Shorts never sees your password.
              </Typography>
            </Stack>
          )}

          {destination?.connection === "token" && (
            <Stack spacing={2}>
              <Typography variant="body2" sx={{ color: t.textSecondary }}>
                {destination.blurb}
              </Typography>
              {destination.fields.map((field) => (
                <TextField
                  key={field.key}
                  label={field.label}
                  size="small"
                  fullWidth
                  required={field.required}
                  type={field.secret ? "password" : "text"}
                  placeholder={field.placeholder}
                  helperText={field.helper}
                  value={values[field.key]}
                  onChange={(event) =>
                    setValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                  }
                />
              ))}
              {testResult && <Alert severity="info">{testResult}</Alert>}
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        {destination && (
          <Button startIcon={<ArrowBackIcon />} onClick={reset} disabled={loading}>
            Back
          </Button>
        )}
        <Box sx={{ flexGrow: 1 }} />
        <Button onClick={close} disabled={loading}>
          Cancel
        </Button>
        {destination?.connection === "token" && (
          <>
            <Button
              variant="outlined"
              onClick={testConnection}
              disabled={testing || Boolean(missingField)}
              startIcon={testing ? <CircularProgress size={16} /> : undefined}
            >
              {destination.id === "telegram" ? "Test bot" : "Test connection"}
            </Button>
            <Button
              variant="contained"
              startIcon={loading ? <CircularProgress size={18} color="inherit" /> : <AddIcon />}
              onClick={submit}
              disabled={loading || Boolean(missingField)}
            >
              {loading ? "Connecting..." : "Connect"}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
};
