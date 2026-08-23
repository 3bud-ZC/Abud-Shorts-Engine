import React, { useState } from "react";
import axios from "axios";
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import type { PublishingPlatform, SocialAccount } from "../../pages/v2Types";

interface AccountConnectModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (account: SocialAccount) => void;
}

export const AccountConnectModal: React.FC<AccountConnectModalProps> = ({
  open,
  onClose,
  onSuccess,
}) => {
  const [platform, setPlatform] = useState<PublishingPlatform>("youtube");
  const [provider, setProvider] = useState("upload_post");
  const [accountName, setAccountName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!accountName.trim() || !accountId.trim()) {
      setError("Account Name and Account ID / Username are required.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await axios.post("/api/v2/publishing/accounts", {
        platform,
        provider,
        accountName: accountName.trim(),
        accountId: accountId.trim(),
        token: token.trim() || undefined,
      });

      onSuccess(res.data.account);
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || "Failed to connect account.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Connect Social Publishing Account</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <FormControl fullWidth size="small">
            <InputLabel>Target Platform</InputLabel>
            <Select
              label="Target Platform"
              value={platform}
              onChange={(e) => {
                const p = e.target.value as PublishingPlatform;
                setPlatform(p);
                if (p === "telegram") setProvider("telegram_bot");
                else setProvider("upload_post");
              }}
            >
              <MenuItem value="youtube">YouTube Shorts</MenuItem>
              <MenuItem value="tiktok">TikTok</MenuItem>
              <MenuItem value="instagram">Instagram Reels</MenuItem>
              <MenuItem value="facebook">Facebook Reels</MenuItem>
              <MenuItem value="telegram">Telegram Channel</MenuItem>
              <MenuItem value="twitter">X / Twitter</MenuItem>
              <MenuItem value="linkedin">LinkedIn</MenuItem>
              <MenuItem value="threads">Threads</MenuItem>
            </Select>
          </FormControl>

          <FormControl fullWidth size="small">
            <InputLabel>Publishing Provider</InputLabel>
            <Select
              label="Publishing Provider"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
            >
              <MenuItem value="upload_post">Upload-Post (Multi-Platform Cloud)</MenuItem>
              {platform === "telegram" && (
                <MenuItem value="telegram_bot">Telegram Direct Bot</MenuItem>
              )}
              {platform === "youtube" && (
                <MenuItem value="youtube_direct">YouTube Direct (Data API v3)</MenuItem>
              )}
              {(platform === "instagram" || platform === "facebook") && (
                <MenuItem value="meta_direct">Meta Direct (Graph API)</MenuItem>
              )}
              {platform === "tiktok" && (
                <MenuItem value="tiktok_direct">TikTok Direct (OpenAPI)</MenuItem>
              )}
            </Select>
          </FormControl>

          <TextField
            label="Display / Channel Name"
            size="small"
            fullWidth
            placeholder="e.g. My Brand Official Shorts"
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
          />

          <TextField
            label="Account ID / Handle / Chat ID"
            size="small"
            fullWidth
            placeholder={
              platform === "telegram"
                ? "@MyChannel or -100123456789"
                : platform === "youtube"
                  ? "UC_x5XG1OV2P6uZZ5FSM9Ttw"
                  : "@username or account_id"
            }
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          />

          <TextField
            label="API Key / Access Token / Bot Token (Optional if set in environment)"
            size="small"
            fullWidth
            type="password"
            placeholder="Secret key (stored securely and masked)"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            helperText="Tokens are securely encrypted and masked. Never exposed to browser or logs."
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          variant="contained"
          startIcon={loading ? <CircularProgress size={18} color="inherit" /> : <AddIcon />}
          onClick={handleSubmit}
          disabled={loading}
        >
          {loading ? "Connecting..." : "Connect Account"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
