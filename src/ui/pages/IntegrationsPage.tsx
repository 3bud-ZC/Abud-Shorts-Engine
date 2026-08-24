import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  Stack,
  TextField,
  Typography,
  useTheme,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import BoltIcon from "@mui/icons-material/Bolt";

import { ConfirmDialog, ErrorBoundary, LoadingState, PageHeader, SectionCard } from "../components/v2";
import { statusDescriptor, type StatusTone } from "../theme/statusModel";
import {
  CLIENT_CATEGORY_ORDER,
  INTEGRATION_CATALOG,
  clientCategoryFor,
  type ClientCategory,
} from "./integrationsCatalog";

type ProviderRecord = {
  id?: string;
  name: string;
  category?: string;
  tier?: string;
  status?: string;
  configured?: boolean;
  isDefault?: boolean;
  message?: string;
  checkedAt?: string;
  credentialTypes?: string[];
  vaultConfigured?: boolean;
  vault?: Array<{ credentialType: string; maskedHint?: string; health?: string; lastTestedAt?: string }>;
};

function toneIcon(tone: StatusTone) {
  if (tone === "success") return <CheckCircleIcon fontSize="small" />;
  if (tone === "warning") return <WarningAmberIcon fontSize="small" />;
  if (tone === "danger") return <ErrorOutlineIcon fontSize="small" />;
  if (tone === "info") return <BoltIcon fontSize="small" />;
  return <RadioButtonUncheckedIcon fontSize="small" />;
}

function toneColor(tone: StatusTone): "success" | "warning" | "error" | "info" | "default" {
  if (tone === "success") return "success";
  if (tone === "warning") return "warning";
  if (tone === "danger") return "error";
  if (tone === "info") return "info";
  return "default";
}

function formatWhen(value?: string): string {
  if (!value) return "Never tested";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never tested";
  return `Tested ${date.toLocaleString()}`;
}

const IntegrationsContent: React.FC = () => {
  const theme = useTheme();
  const t = theme.abud;
  const [providers, setProviders] = useState<ProviderRecord[]>([]);
  const [vaultAvailable, setVaultAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; message: string }>>({});

  const [configureTarget, setConfigureTarget] = useState<ProviderRecord | null>(null);
  const [secretValue, setSecretValue] = useState("");
  const [credentialType, setCredentialType] = useState("api_key");
  const [saving, setSaving] = useState(false);
  const [disconnectTarget, setDisconnectTarget] = useState<ProviderRecord | null>(null);

  const load = () => {
    axios
      .get("/api/v2/providers")
      .then((res) => {
        setProviders(res.data.providers || []);
        setVaultAvailable(res.data.vault?.available !== false);
        setError(null);
      })
      .catch(() => setError("Integrations could not be loaded."))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  /** Only providers the catalog knows about are shown to a customer. */
  const grouped = useMemo(() => {
    const map = new Map<ClientCategory, ProviderRecord[]>();
    CLIENT_CATEGORY_ORDER.forEach((category) => map.set(category, []));
    providers.forEach((provider) => {
      if (!provider.id) return;
      const category = clientCategoryFor(provider.id);
      if (!category) return;
      map.get(category)!.push(provider);
    });
    return map;
  }, [providers]);

  const runTest = async (provider: ProviderRecord) => {
    if (!provider.id) return;
    setTesting(provider.id);
    try {
      const res = await axios.post(`/api/v2/providers/${provider.id}/validate`);
      const data = res.data || {};
      const healthy = data.healthy ?? data.ok ?? data.configured ?? false;
      setTestResult((prev) => ({
        ...prev,
        [provider.id as string]: {
          ok: Boolean(healthy),
          message: data.message || (healthy ? "Connection succeeded." : "Connection did not succeed."),
        },
      }));
      load();
    } catch (err: any) {
      setTestResult((prev) => ({
        ...prev,
        [provider.id as string]: {
          ok: false,
          message: err?.response?.data?.message || "Connection test failed.",
        },
      }));
    } finally {
      setTesting(null);
    }
  };

  const openConfigure = (provider: ProviderRecord) => {
    const catalog = INTEGRATION_CATALOG[provider.id as string];
    setConfigureTarget(provider);
    setCredentialType(catalog?.credentialType || provider.credentialTypes?.[0] || "api_key");
    setSecretValue("");
  };

  const saveCredential = async () => {
    if (!configureTarget?.id || !secretValue.trim()) return;
    setSaving(true);
    try {
      await axios.put(`/api/v2/providers/${configureTarget.id}/credentials`, {
        credentialType,
        value: secretValue.trim(),
      });
      setFeedback(`${configureTarget.name} saved securely.`);
      setConfigureTarget(null);
      setSecretValue("");
      load();
    } catch (err: any) {
      setError(err?.response?.data?.message || "Could not save this integration.");
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    if (!disconnectTarget?.id) return;
    try {
      await axios.delete(`/api/v2/providers/${disconnectTarget.id}/credentials`);
      setFeedback(`${disconnectTarget.name} disconnected.`);
      load();
    } catch {
      setError("Could not disconnect this integration.");
    } finally {
      setDisconnectTarget(null);
    }
  };

  const startOauth = (provider: ProviderRecord) => {
    window.location.href = `/api/v2/providers/${provider.id}/oauth/start`;
  };

  if (loading) return <LoadingState label="Loading integrations..." />;

  const renderCard = (provider: ProviderRecord) => {
    const catalog = INTEGRATION_CATALOG[provider.id as string];
    if (!catalog) return null;
    const descriptor = statusDescriptor(
      provider.configured ? provider.status || "ready" : "not_configured",
    );
    const vaultEntry = provider.vault?.[0];
    const result = testResult[provider.id as string];

    return (
      <Grid item xs={12} md={6} xl={4} key={provider.id}>
        <Card sx={{ height: "100%", display: "flex", flexDirection: "column", p: 2.5 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1.5}>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle1" fontWeight={650} noWrap>
                {catalog.label}
              </Typography>
              <Typography variant="body2" sx={{ color: t.textSecondary, mt: 0.25 }}>
                {catalog.purpose}
              </Typography>
            </Box>
            <Chip
              size="small"
              icon={toneIcon(descriptor.tone)}
              label={descriptor.label}
              color={toneColor(descriptor.tone)}
              variant={descriptor.tone === "neutral" ? "outlined" : "filled"}
            />
          </Stack>

          <Stack direction="row" spacing={0.75} sx={{ mt: 1.5, flexWrap: "wrap", gap: 0.75 }}>
            <Chip size="small" variant="outlined" label={catalog.costLabel} />
            {provider.isDefault && <Chip size="small" variant="outlined" label="Default" />}
            {catalog.optional && <Chip size="small" variant="outlined" label="Optional" />}
          </Stack>

          <Typography variant="caption" sx={{ color: t.muted, mt: 1.5, display: "block" }}>
            {vaultEntry?.maskedHint ? `Key ${vaultEntry.maskedHint} · ` : ""}
            {/* Only a real credential test counts. The health-check timestamp
                is not a connection test and must not be presented as one. */}
            {provider.configured ? formatWhen(vaultEntry?.lastTestedAt) : "Not set up"}
          </Typography>

          {result && (
            <Alert severity={result.ok ? "success" : "warning"} sx={{ mt: 1.5, py: 0.5 }}>
              <Typography variant="caption">{result.message}</Typography>
            </Alert>
          )}

          <Box sx={{ flexGrow: 1 }} />
          <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: "wrap", gap: 1 }}>
            {catalog.connectionType === "oauth" ? (
              <Button size="small" variant="contained" onClick={() => startOauth(provider)}>
                {provider.configured ? "Reconnect" : `Connect ${catalog.shortName}`}
              </Button>
            ) : catalog.connectionType === "key" ? (
              <Button size="small" variant="contained" onClick={() => openConfigure(provider)}>
                {provider.configured ? "Replace key" : "Configure"}
              </Button>
            ) : (
              <Chip size="small" variant="outlined" label="Built in — nothing to configure" />
            )}

            {catalog.connectionType !== "builtin" && (
              <Button
                size="small"
                variant="outlined"
                disabled={!provider.configured || testing === provider.id}
                onClick={() => runTest(provider)}
                startIcon={testing === provider.id ? <CircularProgress size={14} /> : undefined}
              >
                Test connection
              </Button>
            )}

            {catalog.connectionType !== "builtin" && provider.vaultConfigured && (
              <Button size="small" color="error" variant="text" onClick={() => setDisconnectTarget(provider)}>
                Disconnect
              </Button>
            )}
          </Stack>
        </Card>
      </Grid>
    );
  };

  return (
    <>
      <PageHeader
        title="Integrations"
        eyebrow="Configure"
        description="Connect the services ABUD Shorts uses. Everything marked Optional can be skipped — the engine works without it."
      />

      {!vaultAvailable && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          Secure storage is unavailable, so integrations cannot be saved right now. Contact your
          installer.
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {feedback && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setFeedback(null)}>
          {feedback}
        </Alert>
      )}

      <Stack spacing={3}>
        {CLIENT_CATEGORY_ORDER.map((category) => {
          const items = grouped.get(category) || [];
          if (items.length === 0) return null;
          const isAdvanced = category === "Optional & Advanced";

          const body = (
            <Grid container spacing={2}>
              {items.map(renderCard)}
            </Grid>
          );

          // Advanced capabilities are collapsed by default: a normal customer
          // never has to look at them.
          return isAdvanced ? (
            <Accordion key={category} variant="outlined">
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Box>
                  <Typography fontWeight={650}>{category}</Typography>
                  <Typography variant="body2" sx={{ color: t.textSecondary }}>
                    Extra capabilities for advanced setups. Safe to ignore.
                  </Typography>
                </Box>
              </AccordionSummary>
              <AccordionDetails>{body}</AccordionDetails>
            </Accordion>
          ) : (
            <SectionCard key={category} title={category}>
              {body}
            </SectionCard>
          );
        })}
      </Stack>

      <Dialog open={Boolean(configureTarget)} onClose={() => setConfigureTarget(null)} fullWidth maxWidth="sm">
        <DialogTitle>Configure {configureTarget ? INTEGRATION_CATALOG[configureTarget.id as string]?.label : ""}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: t.textSecondary, mb: 2 }}>
            {configureTarget ? INTEGRATION_CATALOG[configureTarget.id as string]?.keyHelp : ""}
          </Typography>
          <TextField
            fullWidth
            autoFocus
            type="password"
            label={credentialType === "service_account_json" ? "Service account JSON" : "API key"}
            value={secretValue}
            onChange={(event) => setSecretValue(event.target.value)}
            multiline={credentialType === "service_account_json"}
            minRows={credentialType === "service_account_json" ? 4 : undefined}
            placeholder="Paste the value here"
            helperText="Stored encrypted. It is never displayed again after saving."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfigureTarget(null)}>Cancel</Button>
          <Button variant="contained" onClick={saveCredential} disabled={saving || !secretValue.trim()}>
            {saving ? "Saving..." : "Save securely"}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={Boolean(disconnectTarget)}
        title={`Disconnect ${disconnectTarget?.name || ""}?`}
        description="The stored key will be removed. You can reconnect at any time."
        confirmLabel="Disconnect"
        onClose={() => setDisconnectTarget(null)}
        onConfirm={disconnect}
      />
    </>
  );
};

const IntegrationsPage: React.FC = () => (
  <ErrorBoundary>
    <IntegrationsContent />
  </ErrorBoundary>
);

export default IntegrationsPage;
