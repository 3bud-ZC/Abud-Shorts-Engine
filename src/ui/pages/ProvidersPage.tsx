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

  const testProviderConnection = async (provider: ProviderItem) => {
    const providerName = provider.name;
    setValidatingProvider(providerName);
    setValidationAlert(null);
    try {
      const slug = provider.id || providerName.toLowerCase().split(" ")[0].replace(/[^a-z]/g, "");
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
        title="Providers"
        eyebrow="Configuration"
        description="Review which local, cloud, and premium services are available. Credentials stay server-side and are never shown in the browser."
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
                  ? "Script and production planning providers."
                  : category === "Visuals"
                    ? "Stock footage and optional AI video providers."
                    : category === "Voice"
                      ? "Piper for local Arabic, Kokoro for local English, optional Google Cloud TTS, and premium ElevenLabs."
                      : category === "Captions"
                        ? "Caption timing and transcript generation."
                        : "Rendering, automation, and supporting services."
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
                            <Chip
                              size="small"
                              variant="outlined"
                              label={provider.tier === "cloud_free_tier" ? "CLOUD / FREE TIER AVAILABLE" : provider.tier.toUpperCase()}
                            />
                          )}
                          {provider.details?.local !== undefined && (
                            <Chip size="small" variant="outlined" label={provider.details.local ? "LOCAL" : "CLOUD"} />
                          )}
                        </Stack>
                        {provider.category === "Voice" && provider.details && (
                          <Stack spacing={0.5}>
                            <Typography variant="caption" color="text.secondary">
                              Languages: {Array.isArray(provider.details.languages) ? provider.details.languages.join(", ") : "unknown"}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              Arabic: {String(provider.details.arabicSupport || "unknown")} · Egyptian: {String(provider.details.egyptianSupport || "unknown")}
                            </Typography>
                            {provider.details.license && (
                              <Typography variant="caption" color="text.secondary">
                                License: {String(provider.details.license)}
                              </Typography>
                            )}
                            {provider.details.authentication && (
                              <Typography variant="caption" color="text.secondary">
                                Authentication: {String(provider.details.authentication)}
                              </Typography>
                            )}
                            {provider.details.freeTierLabel && (
                              <Typography variant="caption" color="text.secondary">
                                Tier: {String(provider.details.freeTierLabel)}
                              </Typography>
                            )}
                            {provider.details.billingNotice && (
                              <Typography variant="caption" color="text.secondary">
                                {String(provider.details.billingNotice)}
                              </Typography>
                            )}
                            {Array.isArray(provider.details.voiceFamilies) && provider.details.voiceFamilies.length > 0 && (
                              <Typography variant="caption" color="text.secondary">
                                Families: {provider.details.voiceFamilies.join(", ")}
                              </Typography>
                            )}
                          </Stack>
                        )}
                        <Divider />
                        <Stack direction="row" justifyContent="space-between" alignItems="center">
                          <Button
                            size="small"
                            variant="outlined"
                            disabled={validatingProvider === provider.name}
                            onClick={() => testProviderConnection(provider)}
                          >
                            {provider.configured === false ? "Not configured" : validatingProvider === provider.name ? "Testing..." : "Test Connection"}
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
