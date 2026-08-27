import React, { useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Stack,
  TextField,
  Typography,
  Alert,
  IconButton,
  InputAdornment,
} from "@mui/material";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { useI18n } from "../i18n";

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { t, direction } = useI18n();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  React.useEffect(() => {
    try {
      if (localStorage.getItem("abud_auth_notice") === "session_expired") {
        setNotice(t("login.sessionExpired"));
        localStorage.removeItem("abud_auth_notice");
      }
    } catch {
      // Ignore storage availability issues.
    }
  }, [t]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username || !password) {
      setError(t("login.enterBoth"));
      return;
    }

    setLoading(true);
    try {
      const res = await axios.post("/api/v2/auth/login", {
        username,
        password,
      });
      if (res.data.session?.token) {
        localStorage.setItem("abud_session_token", res.data.session.token);
        const returnTo = localStorage.getItem("abud_auth_return_to") || "/";
        localStorage.removeItem("abud_auth_return_to");
        navigate(returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/");
      } else {
        setError(t("login.invalidCredentials"));
      }
    } catch (err: any) {
      setError(err.response?.data?.error || t("login.failed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      dir={direction}
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "75vh",
      }}
    >
      <Card sx={{ maxWidth: 420, width: "100%", p: 2, borderRadius: 3, boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}>
        <CardContent>
          <Box sx={{ textAlign: "center", mb: 3 }}>
            <Box
              sx={{
                width: 48,
                height: 48,
                borderRadius: "50%",
                bgcolor: "action.selected",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                mb: 1.5,
              }}
            >
              <LockOutlinedIcon sx={{ color: "primary.main" }} />
            </Box>
            <Typography variant="h5" fontWeight={800} color="primary.main">
              {t("login.title")}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t("common.appName")}
            </Typography>
          </Box>

          {notice && (
            <Alert severity="info" sx={{ mb: 2.5 }}>
              {notice}
            </Alert>
          )}

          {error && (
            <Alert severity="error" sx={{ mb: 2.5 }}>
              {error}
            </Alert>
          )}

          <form onSubmit={handleLogin}>
            <Stack spacing={2.5}>
              <TextField
                label={t("login.username")}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                fullWidth
                size="small"
                autoFocus
                autoComplete="username"
              />
              <TextField
                label={t("login.password")}
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                fullWidth
                size="small"
                autoComplete="current-password"
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        aria-label={showPassword ? t("login.hidePassword") : t("login.showPassword")}
                        onClick={() => setShowPassword((value) => !value)}
                        edge="end"
                      >
                        {showPassword ? <VisibilityOffIcon /> : <VisibilityIcon />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
              <Button
                type="submit"
                variant="contained"
                size="large"
                fullWidth
                disabled={loading}
                sx={{ py: 1.2, fontWeight: 700 }}
              >
                {loading ? <CircularProgress size={24} color="inherit" /> : t("login.submit")}
              </Button>
            </Stack>
          </form>
        </CardContent>
      </Card>
    </Box>
  );
};

export default LoginPage;
