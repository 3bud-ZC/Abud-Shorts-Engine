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

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  React.useEffect(() => {
    try {
      if (localStorage.getItem("abud_auth_notice") === "session_expired") {
        setNotice("Your session expired. Sign in again to continue.");
        localStorage.removeItem("abud_auth_notice");
      }
    } catch {
      // Ignore storage availability issues.
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username || !password) {
      setError("Please enter both username and password.");
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
        setError("Invalid credentials.");
      }
    } catch (err: any) {
      setError(err.response?.data?.error || "Login failed. Please check credentials.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
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
              Sign in
            </Typography>
            <Typography variant="body2" color="text.secondary">
              ABUD Shorts
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
                label="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                fullWidth
                size="small"
                autoFocus
                autoComplete="username"
              />
              <TextField
                label="Password"
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
                        aria-label={showPassword ? "Hide password" : "Show password"}
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
                {loading ? <CircularProgress size={24} color="inherit" /> : "Sign In"}
              </Button>
            </Stack>
          </form>
        </CardContent>
      </Card>
    </Box>
  );
};

export default LoginPage;
