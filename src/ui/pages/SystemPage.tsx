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

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb > 1024) {
    return `${(mb / 1024).toFixed(2)} GB`;
  }
  return `${mb.toFixed(1)} MB`;
}

export const SystemPage: React.FC = () => {
  const [tab, setTab] = useState(0);
  const [health, setHealth] = useState<{ status: string; components: V2HealthComponent[] } | null>(null);
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [storage, setStorage] = useState<any>(null);
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
      setHealth(healthRes.data);
      setDiagnostics(diagRes.data);
      setStorage(storRes.data);
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
        title="System Diagnostics & Runtime"
        eyebrow="Operations"
        description="Comprehensive diagnostic monitoring across Docker containers, PostgreSQL persistence, storage usage, sanitized logs, and health readiness."
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
          <StatCard label="Product Version" value={diagnostics?.product?.version || "2.0.0"} />
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
      </Grid>

      {/* Navigation Tabs */}
      <Tabs value={tab} onChange={(_, val) => setTab(val)} sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Tab label="Services & Health" />
        <Tab label="Storage Breakdown" />
        <Tab label="Sanitized Logs" />
        <Tab label="Support Bundle" />
      </Tabs>

      {/* Tab 0: Services & Health */}
      {tab === 0 && (
        <Grid container spacing={2}>
          {health?.components.map((component) => (
            <Grid item xs={12} md={6} lg={4} key={component.name}>
              <SectionCard>
                <Stack spacing={1}>
                  <Stack direction="row" justifyContent="space-between" spacing={1}>
                    <Typography variant="h6">{component.name}</Typography>
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
            <SectionCard title="Storage Allocations">
              <Stack spacing={2}>
                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography variant="body2">🎬 Videos Directory (<code>data/videos</code>):</Typography>
                  <Typography variant="body2" fontWeight={700}>{formatBytes(storage?.videosStorageBytes || 0)}</Typography>
                </Box>
                <Divider />
                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography variant="body2">⚡ Media Cache (<code>data/cache</code>):</Typography>
                  <Typography variant="body2" fontWeight={700}>{formatBytes(storage?.cacheStorageBytes || 0)}</Typography>
                </Box>
                <Divider />
                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography variant="body2">📦 Backups Directory (<code>data/backups</code>):</Typography>
                  <Typography variant="body2" fontWeight={700}>{formatBytes(storage?.backupsStorageBytes || 0)}</Typography>
                </Box>
                <Divider />
                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography variant="body2">📝 System Logs (<code>data/logs</code>):</Typography>
                  <Typography variant="body2" fontWeight={700}>{formatBytes(storage?.logsStorageBytes || 0)}</Typography>
                </Box>
                <Divider />
                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography variant="subtitle2" fontWeight={800}>Total Project Storage:</Typography>
                  <Typography variant="subtitle2" fontWeight={800} color="primary.main">
                    {formatBytes(storage?.usedProjectStorageBytes || 0)}
                  </Typography>
                </Box>
              </Stack>
            </SectionCard>
          </Grid>
          <Grid item xs={12} md={6}>
            <SectionCard title="Lifecycle & Retention">
              <Stack spacing={1.5}>
                <Typography variant="body2" color="text.secondary">
                  - <strong>Temporary Render Frames:</strong> Automatically purged upon video completion.
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  - <strong>Pexels Cache:</strong> Media cache items expire after 7 days if unreferenced.
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  - <strong>Application Logs:</strong> Rotated within container volume.
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  - <strong>Preservation Guarantee:</strong> Final rendered videos and database records are never purged automatically.
                </Typography>
              </Stack>
            </SectionCard>
          </Grid>
        </Grid>
      )}

      {/* Tab 2: Sanitized Logs */}
      {tab === 2 && (
        <SectionCard title="Recent Application Logs (Secrets Automatically Redacted)">
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
        <SectionCard title="Generate Diagnostic Support Bundle">
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              If you require assistance, you can generate an automated diagnostic bundle containing sanitized system telemetry, service states, disk breakdown, and error summaries.
            </Typography>
            <Alert severity="info">
              Security Guarantee: All API tokens, passwords, private keys, and internal secrets are automatically redacted prior to export.
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
    </Stack>
  );
};

export default SystemPage;
