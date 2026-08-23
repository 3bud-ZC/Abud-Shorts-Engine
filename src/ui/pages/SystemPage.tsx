import React, { useEffect, useState } from "react";
import axios from "axios";
import {
  Alert,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
  Box,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import DownloadIcon from "@mui/icons-material/Download";
import BugReportIcon from "@mui/icons-material/BugReport";
import StorageIcon from "@mui/icons-material/Storage";
import TerminalIcon from "@mui/icons-material/Terminal";
import {
  LoadingState,
  PageHeader,
  SectionCard,
  StatCard,
  StatusBadge,
} from "../components/v2";
import type { V2HealthComponent } from "./v2Types";
import type { SystemObservability } from "./v2Types";

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb > 1024) {
    return `${(mb / 1024).toFixed(2)} GB`;
  }
  return `${mb.toFixed(1)} MB`;
}

function serviceDisplayName(name: string): string {
  if (name.toLowerCase() === "n8n") return "Automation engine";
  if (name.toLowerCase() === "database") return "Database";
  if (name.toLowerCase().includes("render worker")) return "Render worker";
  return name;
}

export const SystemPage: React.FC = () => {
  const [tab, setTab] = useState(0);
  const [health, setHealth] = useState<{ status: string; components: V2HealthComponent[] } | null>(null);
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [storage, setStorage] = useState<any>(null);
  const [observability, setObservability] = useState<SystemObservability | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloadingBundle, setDownloadingBundle] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [healthRes, diagRes, storRes] = await Promise.all([
        axios.get("/api/v2/system/health"),
        axios.get("/api/v2/system/diagnostics"),
        axios.get("/api/v2/system/storage"),
      ]);
      const obsRes = await axios.get("/api/v2/system/observability").catch(() => ({ data: null }));
      setHealth(healthRes.data);
      setDiagnostics(diagRes.data);
      setStorage(storRes.data);
      setObservability(obsRes.data);
      setError(null);
    } catch {
      setError("Failed to load system metrics.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const downloadBundle = async () => {
    setDownloadingBundle(true);
    try {
      const res = await axios.get("/api/v2/system/diagnostics/bundle", {
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `abud_diagnostics_${Date.now()}.json`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      setError("Failed to download diagnostic bundle.");
    } finally {
      setDownloadingBundle(false);
    }
  };

  if (loading && !health) return <LoadingState label="Checking V2 system diagnostics..." />;

  return (
    <Stack spacing={3}>
      <PageHeader
        title="System"
        eyebrow="Operations"
        description="Check production readiness, storage usage, workers, and sanitized diagnostics without exposing credentials."
        actions={
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              startIcon={<DownloadIcon />}
              onClick={downloadBundle}
              disabled={downloadingBundle}
            >
              {downloadingBundle ? "Generating..." : "Download Diagnostic Bundle"}
            </Button>
            <Button variant="contained" startIcon={<RefreshIcon />} onClick={load} disabled={loading}>
              Refresh
            </Button>
          </Stack>
        }
      />

      {error && <Alert severity="error">{error}</Alert>}

      {/* Top Overview Cards */}
      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard label="Product Version" value={diagnostics?.product?.version || "2.1.0"} />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard label="System Status" value={<StatusBadge status={health?.status || "healthy"} />} />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard label="Project Storage" value={formatBytes(storage?.usedProjectStorageBytes || 0)} />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard label="Uptime" value={`${Math.round((diagnostics?.product?.uptimeSeconds || 0) / 60)} min`} />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard label="Queue Depth" value={String(observability?.queueDepth ?? 0)} />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard label="Active Workers" value={String(observability?.activeWorkers ?? 0)} />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard label="Active Renders" value={`${observability?.activeRenders ?? 0} / ${observability?.maxConcurrentRenders ?? 1}`} />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            label="Average Generation"
            value={observability?.averageGenerationTimeMs ? `${Math.round(observability.averageGenerationTimeMs / 1000)}s` : "N/A"}
          />
        </Grid>
      </Grid>

      {/* Navigation Tabs */}
      <Tabs value={tab} onChange={(_, val) => setTab(val)} sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Tab label="Health" />
        <Tab label="Storage Breakdown" />
        <Tab label="Logs" />
        <Tab label="Support Bundle" />
        <Tab label="Observability" />
      </Tabs>

      {/* Tab 0: Services & Health */}
      {tab === 0 && (
        <Grid container spacing={2}>
          {health?.components.map((component) => (
            <Grid item xs={12} md={6} lg={4} key={component.name}>
              <SectionCard>
                <Stack spacing={1}>
                  <Stack direction="row" justifyContent="space-between" spacing={1}>
                    <Typography variant="h6">{serviceDisplayName(component.name)}</Typography>
                    <StatusBadge status={component.status} />
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    {component.message}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {new Date(component.checkedAt).toLocaleTimeString()}
                    {typeof component.latencyMs === "number" ? ` · ${component.latencyMs}ms` : ""}
                  </Typography>
                </Stack>
              </SectionCard>
            </Grid>
          ))}
        </Grid>
      )}

      {/* Tab 1: Storage Breakdown */}
      {tab === 1 && (
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <SectionCard title="Storage usage">
              <Stack spacing={2}>
                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography variant="body2">Rendered videos</Typography>
                  <Typography variant="body2" fontWeight={700}>{formatBytes(storage?.videosStorageBytes || 0)}</Typography>
                </Box>
                <Divider />
                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography variant="body2">Temporary cache</Typography>
                  <Typography variant="body2" fontWeight={700}>{formatBytes(storage?.cacheStorageBytes || 0)}</Typography>
                </Box>
                <Divider />
                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography variant="body2">Backups</Typography>
                  <Typography variant="body2" fontWeight={700}>{formatBytes(storage?.backupsStorageBytes || 0)}</Typography>
                </Box>
                <Divider />
                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography variant="body2">System logs</Typography>
                  <Typography variant="body2" fontWeight={700}>{formatBytes(storage?.logsStorageBytes || 0)}</Typography>
                </Box>
                <Divider />
                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography variant="subtitle2" fontWeight={800}>Total project storage</Typography>
                  <Typography variant="subtitle2" fontWeight={800} color="primary.main">
                    {formatBytes(storage?.usedProjectStorageBytes || 0)}
                  </Typography>
                </Box>
              </Stack>
            </SectionCard>
          </Grid>
          <Grid item xs={12} md={6}>
            <SectionCard title="Lifecycle and retention">
              <Stack spacing={1.5}>
                <Typography variant="body2" color="text.secondary">
                  Temporary render files are removed after completion.
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Cached stock media can expire when it is no longer referenced.
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Logs are rotated and included in diagnostics only after redaction.
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Final videos and production records are not purged automatically.
                </Typography>
              </Stack>
            </SectionCard>
          </Grid>
        </Grid>
      )}

      {/* Tab 2: Sanitized Logs */}
      {tab === 2 && (
        <SectionCard title="Recent logs">
          <Paper
            sx={{
              p: 2,
              bgcolor: "#0f172a",
              color: "#38bdf8",
              fontFamily: "monospace",
              fontSize: "0.85rem",
              maxHeight: 400,
              overflowY: "auto",
              borderRadius: 2,
            }}
          >
            {diagnostics?.sanitizedLogs?.map((line: string, idx: number) => (
              <Box key={idx} sx={{ py: 0.25 }}>
                {line}
              </Box>
            )) || <Typography>No recent log records available.</Typography>}
          </Paper>
        </SectionCard>
      )}

      {/* Tab 3: Support Bundle */}
      {tab === 3 && (
        <SectionCard title="Download diagnostics">
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              Download a support bundle with service status, storage breakdown, and recent error summaries.
            </Typography>
            <Alert severity="info">
              Secrets are redacted before export. Review the file before sharing it outside your team.
            </Alert>
            <Box>
              <Button
                variant="contained"
                startIcon={<DownloadIcon />}
                onClick={downloadBundle}
                disabled={downloadingBundle}
              >
                {downloadingBundle ? "Exporting Bundle..." : "Download Diagnostic Bundle (JSON)"}
              </Button>
            </Box>
          </Stack>
        </SectionCard>
      )}

      {tab === 4 && (
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <SectionCard title="Queue & Workers">
              <Stack spacing={1.25}>
                <Typography variant="body2">Queue depth: <strong>{observability?.queueDepth ?? 0}</strong></Typography>
                <Typography variant="body2">Active renders: <strong>{observability?.activeRenders ?? 0}</strong></Typography>
                <Typography variant="body2">Recent bottleneck: <strong>{observability?.recentStageBottleneck || "N/A"}</strong></Typography>
                <Divider />
                {observability?.workers?.length ? observability.workers.map((worker) => (
                  <Box key={worker.workerId} sx={{ p: 1.25, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography variant="body2" fontWeight={800}>Render worker</Typography>
                      <Chip size="small" label={worker.status} />
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      Heartbeat {new Date(worker.lastHeartbeat).toLocaleTimeString()}
                    </Typography>
                  </Box>
                )) : (
                  <Typography variant="body2" color="text.secondary">No worker activity recorded yet.</Typography>
                )}
              </Stack>
            </SectionCard>
          </Grid>
          <Grid item xs={12} md={6}>
            <SectionCard title="Cache, Jobs & Webhooks">
              <Stack spacing={1.25}>
                <Typography variant="body2">Cache: <strong>{formatBytes(Number(observability?.cache?.cacheStorageBytes || 0))}</strong></Typography>
                <Typography variant="body2">Project disk: <strong>{formatBytes(Number(observability?.cache?.usedProjectStorageBytes || 0))}</strong></Typography>
                <Typography variant="body2">Job counts: <strong>{JSON.stringify(observability?.jobCounts || {})}</strong></Typography>
                <Divider />
                {(observability?.recentWebhookDeliveries || []).slice(0, 5).map((delivery: any) => (
                  <Typography key={delivery.id} variant="caption" color="text.secondary">
                    {delivery.event} · {delivery.status} · attempts {delivery.attemptCount}
                  </Typography>
                ))}
              </Stack>
            </SectionCard>
          </Grid>
        </Grid>
      )}
    </Stack>
  );
};

export default SystemPage;
