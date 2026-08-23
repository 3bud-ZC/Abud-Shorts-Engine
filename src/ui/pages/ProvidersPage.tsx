import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RefreshIcon from "@mui/icons-material/Refresh";
import SettingsIcon from "@mui/icons-material/Settings";
import {
  LoadingState,
  PageHeader,
  ProviderStatus,
  SectionCard,
  StatusBadge,
} from "../components/v2";
import type { ProviderItem } from "./v2Types";

const ProvidersPage: React.FC = () => {
  const [providers, setProviders] = useState<ProviderItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [validatingProvider, setValidatingProvider] = useState<string | null>(null);
  const [validationAlert, setValidationAlert] = useState<{ provider: string; message: string; healthy: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const response = await axios.get("/api/v2/providers");
      setProviders(response.data.providers || []);
      setCategories(response.data.categories || []);
      setError(null);
    } catch {
      setError("Failed to load providers.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, ProviderItem[]>();
    for (const category of categories) map.set(category, []);
    for (const provider of providers) {
      const list = map.get(provider.category) || [];
      list.push(provider);
      map.set(provider.category, list);
    }
    return Array.from(map.entries()).filter(([, items]) => items.length > 0);
  }, [providers, categories]);

  const testProviderConnection = async (providerName: string) => {
    setValidatingProvider(providerName);
    setValidationAlert(null);
    try {
      const slug = providerName.toLowerCase().split(" ")[0].replace(/[^a-z]/g, "");
      const response = await axios.post(`/api/v2/providers/${slug}/validate`);
      setValidationAlert({
        provider: providerName,
        message: response.data.message || "Connection test succeeded.",
        healthy: response.data.healthy ?? (response.data.status === "healthy"),
      });
      await load();
    } catch (err: any) {
      setValidationAlert({
        provider: providerName,
        message: err?.response?.data?.message || "Validation call failed.",
        healthy: false,
      });
    } finally {
      setValidatingProvider(null);
    }
  };

  if (loading) return <LoadingState label="Loading provider engine..." />;

  return (
    <>
      <PageHeader
        title="Providers & AI Engine"
        eyebrow="Provider Architecture"
        description="Unified provider abstractions for Content AI, Visuals, Voice, Captions, and Rendering. Secrets are never exposed in the browser."
        actions={
          <Button startIcon={<RefreshIcon />} onClick={load}>
            Refresh Status
          </Button>
        }
      />

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {validationAlert && (
        <Alert
          severity={validationAlert.healthy ? "success" : "warning"}
          sx={{ mb: 2 }}
          onClose={() => setValidationAlert(null)}
        >
          <strong>{validationAlert.provider}:</strong> {validationAlert.message}
        </Alert>
      )}

      <Grid container spacing={2}>
        {grouped.map(([category, items]) => (
          <Grid item xs={12} key={category}>
            <SectionCard
              title={category}
              description={
                category === "Content AI"
                  ? "Creative Director abstractions (Gemini cloud planning and Local deterministic AI)."
                  : category === "Visuals"
                    ? "Stock footage (Pexels) and optional AI Video generation (Google Veo, fal.ai Kling/Wan)."
                    : category === "Voice"
                      ? "Free local Kokoro TTS and premium multilingual ElevenLabs."
                      : category === "Captions"
                        ? "Whisper speech-to-text with word-level synchronization."
                        : "Video rendering and workflow orchestration."
              }
            >
              <Grid container spacing={2}>
                {items.map((provider) => (
                  <Grid item xs={12} md={6} xl={4} key={provider.name}>
                    <SectionCard>
                      <Stack spacing={1.5}>
                        <Stack direction="row" justifyContent="space-between" alignItems="center">
                          <Typography variant="h6" fontWeight={800}>{provider.name}</Typography>
                          <StatusBadge status={provider.status} label={provider.status.replace(/_/g, " ")} />
                        </Stack>
                        <Typography variant="body2" color="text.secondary">
                          {provider.message}
                        </Typography>
                        <Stack direction="row" spacing={1} alignItems="center">
                          {provider.isDefault && (
                            <Chip size="small" color="primary" label="Default" />
                          )}
                          {provider.tier && (
                            <Chip size="small" variant="outlined" label={provider.tier.toUpperCase()} />
                          )}
                        </Stack>
                        <Divider />
                        <Stack direction="row" justifyContent="space-between" alignItems="center">
                          <Button
                            size="small"
                            variant="outlined"
                            disabled={validatingProvider === provider.name}
                            onClick={() => testProviderConnection(provider.name)}
                          >
                            {validatingProvider === provider.name ? "Testing..." : "Test Connection"}
                          </Button>
                        </Stack>
                      </Stack>
                    </SectionCard>
                  </Grid>
                ))}
              </Grid>
            </SectionCard>
          </Grid>
        ))}
      </Grid>
    </>
  );
};

export default ProvidersPage;
