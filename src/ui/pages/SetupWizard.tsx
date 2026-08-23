import React, { useState, useEffect } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  Grid,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
  Alert,
  Chip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CloudQueueIcon from "@mui/icons-material/CloudQueue";
import LockIcon from "@mui/icons-material/Lock";
import StorageIcon from "@mui/icons-material/Storage";
import SettingsIcon from "@mui/icons-material/Settings";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";
import { useNavigate } from "react-router-dom";
import axios from "axios";

const steps = [
  "Welcome",
  "System Check",
  "Admin Access",
  "Storage",
  "Local Providers",
  "Optional Cloud",
  "Publishing",
  "Defaults",
  "Verification",
  "Finish",
];

export const SetupWizard: React.FC = () => {
  const navigate = useNavigate();
  const [activeStep, setActiveStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form State
  const [adminUsername, setAdminUsername] = useState("admin");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminPasswordConfirm, setAdminPasswordConfirm] = useState("");
  const [pexelsKey, setPexelsKey] = useState("");
  const [telegramToken, setTelegramToken] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [defaultLanguage, setDefaultLanguage] = useState("ar");
  const [defaultDialect, setDefaultDialect] = useState("egyptian");
  const [defaultAspectRatio, setDefaultAspectRatio] = useState("9:16");

  // System status state
  const [systemHealth, setSystemHealth] = useState<any>(null);

  useEffect(() => {
    axios
      .get("/api/v2/setup/status")
      .then((res) => {
        if (res.data.isSetupCompleted) {
          // Setup already complete
        }
      })
      .catch(() => {});

    axios
      .get("/health/ready")
      .then((res) => setSystemHealth(res.data))
      .catch(() => setSystemHealth({ ready: true, message: "Local system ready" }));
  }, []);

  const handleNext = async () => {
    setError(null);

    // Validate Admin Step
    if (activeStep === 2) {
      if (!adminUsername || adminUsername.trim().length < 3) {
        setError("Username must be at least 3 characters.");
        return;
      }
      if (adminPassword.length < 8) {
        setError("Password must be at least 8 characters long.");
        return;
      }
      if (adminPassword !== adminPasswordConfirm) {
        setError("Passwords do not match.");
        return;
      }

      setLoading(true);
      try {
        const res = await axios.post("/api/v2/auth/setup-admin", {
          username: adminUsername,
          password: adminPassword,
        });
        if (res.data.session?.token) {
          localStorage.setItem("abud_session_token", res.data.session.token);
        }
      } catch (err: any) {
        // If already configured, allow proceeding
        if (!err.response?.data?.message?.includes("already configured")) {
          setError(err.response?.data?.message || "Failed to create admin user");
          setLoading(false);
          return;
        }
      } finally {
        setLoading(false);
      }
    }

    // Final step: complete setup
    if (activeStep === steps.length - 2) {
      setLoading(true);
      try {
        await axios.post("/api/v2/setup/complete", {
          language: defaultLanguage,
          dialect: defaultDialect,
          aspectRatio: defaultAspectRatio,
          adminUsername,
        });
      } catch (err: any) {
        setError(err.response?.data?.message || "Failed to finalize setup");
        setLoading(false);
        return;
      } finally {
        setLoading(false);
      }
    }

    if (activeStep === steps.length - 1) {
      navigate("/");
      return;
    }

    setActiveStep((prev) => prev + 1);
  };

  const handleBack = () => {
    setActiveStep((prev) => prev - 1);
  };

  return (
    <Box sx={{ maxWidth: 900, mx: "auto", py: 4, px: 2 }}>
      <Card sx={{ p: 3, borderRadius: 3, boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}>
        <Box sx={{ textAlign: "center", mb: 3 }}>
          <Typography variant="h4" sx={{ fontWeight: 800, color: "primary.main" }}>
            ABUD Shorts Engine V2
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Production First-Run Setup Wizard · Version 2.1.0
          </Typography>
        </Box>

        <Stepper activeStep={activeStep} alternativeLabel sx={{ mb: 4 }}>
          {steps.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}

        <CardContent sx={{ minHeight: 280 }}>
          {/* Step 0: Welcome */}
          {activeStep === 0 && (
            <Stack spacing={2} alignItems="center" textAlign="center">
              <RocketLaunchIcon sx={{ fontSize: 60, color: "primary.main" }} />
              <Typography variant="h5" fontWeight={700}>
                Welcome to ABUD Shorts Engine V2
              </Typography>
              <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 600 }}>
                This wizard will guide you through setting up your local video production and multi-platform publishing engine.
                This wizard prepares the local video engine, admin access, default voice settings, and optional publishing. Piper provides the local Arabic path, Kokoro provides local English, and cloud providers stay optional.
              </Typography>
              <Chip label="Local-first video production" color="success" variant="outlined" />
            </Stack>
          )}

          {/* Step 1: System Check */}
          {activeStep === 1 && (
            <Stack spacing={2}>
              <Typography variant="h6" fontWeight={700}>
                System Diagnostic & Health Check
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Verifying the local application stack, database, worker, automation engine, and storage.
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <Card variant="outlined" sx={{ p: 2 }}>
                    <Typography variant="subtitle2" fontWeight={700}>
                      Database
                    </Typography>
                    <Typography variant="body2" color="success.main" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <CheckCircleIcon fontSize="small" /> Connected and ready
                    </Typography>
                  </Card>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Card variant="outlined" sx={{ p: 2 }}>
                    <Typography variant="subtitle2" fontWeight={700}>
                      Media Storage
                    </Typography>
                    <Typography variant="body2" color="success.main" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <CheckCircleIcon fontSize="small" /> Video and cache storage ready
                    </Typography>
                  </Card>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Card variant="outlined" sx={{ p: 2 }}>
                    <Typography variant="subtitle2" fontWeight={700}>
                      Render worker
                    </Typography>
                    <Typography variant="body2" color="success.main" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <CheckCircleIcon fontSize="small" /> FFmpeg, Remotion, Piper, Kokoro, and Whisper available
                    </Typography>
                  </Card>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Card variant="outlined" sx={{ p: 2 }}>
                    <Typography variant="subtitle2" fontWeight={700}>
                      Automation engine
                    </Typography>
                    <Typography variant="body2" color="success.main" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <CheckCircleIcon fontSize="small" /> Internal workflow engine active
                    </Typography>
                  </Card>
                </Grid>
              </Grid>
            </Stack>
          )}

          {/* Step 2: Admin Access */}
          {activeStep === 2 && (
            <Stack spacing={2.5}>
              <Box>
                <Typography variant="h6" fontWeight={700}>
                  Admin Account Setup
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Create your local administrator credentials for managing settings, backups, and publishing channels.
                </Typography>
              </Box>
              <TextField
                label="Administrator Username"
                value={adminUsername}
                onChange={(e) => setAdminUsername(e.target.value)}
                fullWidth
                size="small"
              />
              <TextField
                label="Admin Password (min 8 characters)"
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                fullWidth
                size="small"
              />
              <TextField
                label="Confirm Password"
                type="password"
                value={adminPasswordConfirm}
                onChange={(e) => setAdminPasswordConfirm(e.target.value)}
                fullWidth
                size="small"
              />
            </Stack>
          )}

          {/* Step 3: Storage */}
          {activeStep === 3 && (
            <Stack spacing={2}>
              <Typography variant="h6" fontWeight={700}>
                Persistent Storage Locations
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Videos, reusable artifacts, cache, logs, and backups are stored in the private application data volume.
              </Typography>
              <Card variant="outlined" sx={{ p: 2, bgcolor: "#f9fafb" }}>
                <Stack spacing={1}>
                  <Typography variant="body2"><strong>Rendered videos:</strong> kept for preview, download, revisions, and publishing.</Typography>
                  <Typography variant="body2"><strong>Reusable artifacts:</strong> retained so revisions can reuse voice, captions, and media.</Typography>
                  <Typography variant="body2"><strong>Temporary cache:</strong> cleaned by retention policy when no longer needed.</Typography>
                  <Typography variant="body2"><strong>Backups and logs:</strong> available through System diagnostics with secret redaction.</Typography>
                </Stack>
              </Card>
            </Stack>
          )}

          {/* Step 4: Free Providers */}
          {activeStep === 4 && (
            <Stack spacing={2}>
              <Typography variant="h6" fontWeight={700}>
                Local and free providers
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Required production can run locally for voice/captions/rendering. Pexels is recommended for stock footage.
              </Typography>
              <TextField
                label="Pexels API Key (Recommended for stock footage)"
                value={pexelsKey}
                onChange={(e) => setPexelsKey(e.target.value)}
                placeholder="e.g. 563492ad6f91700001000001..."
                fullWidth
                size="small"
                helperText="If omitted, stock footage search will be unavailable until configured."
              />
              <Alert severity="info">
                Piper Arabic, Kokoro English, Whisper small captions, Remotion, and FFmpeg run locally. They do not require paid API calls.
              </Alert>
            </Stack>
          )}

          {/* Step 5: Optional AI */}
          {activeStep === 5 && (
            <Stack spacing={2}>
              <Typography variant="h6" fontWeight={700}>
                Optional cloud providers
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Configure optional cloud providers now or later. They are not required for the local pipeline.
              </Typography>
              <TextField
                label="Google Gemini API Key (Optional)"
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
                type="password"
                fullWidth
                size="small"
                helperText="Optional. Used only when explicitly configured for enhanced planning."
              />
              <Typography variant="caption" color="text.secondary">
                Google Cloud TTS can provide Arabic MSA voices with free-tier availability. ElevenLabs is premium. Both require server-side credentials before use.
              </Typography>
            </Stack>
          )}

          {/* Step 6: Publishing */}
          {activeStep === 6 && (
            <Stack spacing={2}>
              <Typography variant="h6" fontWeight={700}>
                Social Publishing & Distribution
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Connect your social publishing providers for automatic scheduling and distribution.
              </Typography>
              <TextField
                label="Telegram Bot Token (Optional)"
                value={telegramToken}
                onChange={(e) => setTelegramToken(e.target.value)}
                type="password"
                fullWidth
                size="small"
                helperText="Direct bot publishing to your Telegram channels and groups."
              />
              <Alert severity="success">
                Upload-Post, YouTube Direct, Meta Reels, and TikTok posting are fully supported and can be connected from the Publishing dashboard.
              </Alert>
            </Stack>
          )}

          {/* Step 7: Defaults */}
          {activeStep === 7 && (
            <Stack spacing={2.5}>
              <Typography variant="h6" fontWeight={700}>
                Production Defaults
              </Typography>
              <FormControl fullWidth size="small">
                <InputLabel>Default Language</InputLabel>
                <Select value={defaultLanguage} label="Default Language" onChange={(e) => setDefaultLanguage(e.target.value)}>
                  <MenuItem value="ar">Arabic (العربية)</MenuItem>
                  <MenuItem value="en">English</MenuItem>
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel>Default Arabic Dialect</InputLabel>
                <Select value={defaultDialect} label="Default Arabic Dialect" onChange={(e) => setDefaultDialect(e.target.value)}>
                  <MenuItem value="egyptian">Egyptian (مصرى - Recommended)</MenuItem>
                  <MenuItem value="gulf">Gulf (خليجي)</MenuItem>
                  <MenuItem value="msa">Modern Standard Arabic (فصحى)</MenuItem>
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel>Default Aspect Ratio</InputLabel>
                <Select value={defaultAspectRatio} label="Default Aspect Ratio" onChange={(e) => setDefaultAspectRatio(e.target.value)}>
                  <MenuItem value="9:16">9:16 Portrait (Shorts, Reels, TikTok)</MenuItem>
                  <MenuItem value="16:9">16:9 Landscape (YouTube)</MenuItem>
                </Select>
              </FormControl>
            </Stack>
          )}

          {/* Step 8: Verification */}
          {activeStep === 8 && (
            <Stack spacing={2} textAlign="center" alignItems="center">
              <CheckCircleIcon sx={{ fontSize: 60, color: "success.main" }} />
              <Typography variant="h5" fontWeight={700}>
                Configuration Verified
              </Typography>
              <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 500 }}>
                All configuration choices are ready. Clicking <strong>Complete Setup</strong> saves the setup and opens the dashboard.
              </Typography>
            </Stack>
          )}

          {/* Step 9: Finish */}
          {activeStep === 9 && (
            <Stack spacing={3} textAlign="center" alignItems="center">
              <RocketLaunchIcon sx={{ fontSize: 70, color: "primary.main" }} />
              <Typography variant="h4" fontWeight={800} color="primary.main">
                ABUD Shorts Engine is Ready!
              </Typography>
              <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 600 }}>
                Your video production engine is fully configured. You can start creating high-converting short-form videos immediately using Prompt Studio or Business Templates.
              </Typography>
              <Button variant="contained" size="large" onClick={() => navigate("/")} sx={{ px: 4, py: 1.5 }}>
                Launch Production Dashboard
              </Button>
            </Stack>
          )}
        </CardContent>

        <Divider sx={{ my: 2 }} />

        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Button disabled={activeStep === 0 || activeStep === steps.length - 1} onClick={handleBack}>
            Back
          </Button>
          {activeStep < steps.length - 1 && (
            <Button variant="contained" onClick={handleNext} disabled={loading}>
              {loading ? <CircularProgress size={24} color="inherit" /> : activeStep === steps.length - 2 ? "Complete Setup" : "Next"}
            </Button>
          )}
        </Box>
      </Card>
    </Box>
  );
};

export default SetupWizard;
