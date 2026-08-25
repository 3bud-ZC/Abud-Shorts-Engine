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
  Switch,
  FormControlLabel,
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

/**
 * Client vocabulary for infrastructure. A customer should read "Automation"
 * rather than "n8n" and "Storage" rather than a container name; the technical
 * identity is still available in Advanced Details.
 */
const CLIENT_SERVICE_NAMES: Record<string, string> = {
  n8n: "Automation",
  database: "Database",
  postgres: "Database",
  postgresql: "Database",
  app: "Application",
  api: "Application",
  storage: "Storage",
  disk: "Storage",
  remotion: "Video Engine",
  ffmpeg: "Video Engine",
  worker: "Video Engine",
  "render worker": "Video Engine",
  pexels: "Integrations",
  elevenlabs: "Integrations",
};

function serviceDisplayName(name: string): string {
  const key = (name || "").toLowerCase().trim();
  if (CLIENT_SERVICE_NAMES[key]) return CLIENT_SERVICE_NAMES[key];
  const partial = Object.keys(CLIENT_SERVICE_NAMES).find((candidate) => key.includes(candidate));
  return partial ? CLIENT_SERVICE_NAMES[partial] : name;
}

/** The six groups a non-technical operator actually cares about. */
const CLIENT_HEALTH_GROUPS = [
  "Application",
  "Video Engine",
  "Storage",
  "Database",
  "Automation",
  "Integrations",
] as const;

/**
 * Rolls the raw component list up into those groups. The worst status in a
 * group wins, so a problem is never hidden behind a healthy sibling.
 */
function groupHealth(components: Array<{ name: string; status: string; message?: string }> = []) {
  const severity: Record<string, number> = { healthy: 0, degraded: 1, unhealthy: 2 };
  return CLIENT_HEALTH_GROUPS.map((group) => {
    const members = components.filter((component) => serviceDisplayName(component.name) === group);
    if (members.length === 0) return { group, status: "unknown", members: [] as typeof members };
    const worst = members.reduce((a, b) =>
      (severity[b.status] ?? 1) > (severity[a.status] ?? 1) ? b : a,
    );
    return { group, status: worst.status, members };
  }).filter((entry) => entry.members.length > 0);
}

export const SystemPage: React.FC = () => {
  const [tab, setTab] = useState(0);
  const [health, setHealth] = useState<{ status: string; components: V2HealthComponent[] } | null>(null);
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [storage, setStorage] = useState<any>(null);
  const [observability, setObservability] = useState<SystemObservability | null>(null);
  const [capabilities, setCapabilities] = useState<any[]>([]);
  const [packs, setPacks] = useState<any[]>([]);
  const [hardware, setHardware] = useState<any>(null);
  const [arabicReadiness, setArabicReadiness] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [downloadingBundle, setDownloadingBundle] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [healthRes, diagRes, storRes, capRes, arabicRes] = await Promise.all([
        axios.get("/api/v2/system/health"),
        axios.get("/api/v2/system/diagnostics"),
        axios.get("/api/v2/system/storage"),
        axios.get("/api/v2/system/capabilities").catch(() => ({ data: { capabilities: [], packs: [], hardware: null } })),
        axios.get("/api/v2/system/arabic-readiness").catch(() => ({ data: null })),
      ]);
      const obsRes = await axios.get("/api/v2/system/observability").catch(() => ({ data: null }));
      setHealth(healthRes.data);
      setDiagnostics(diagRes.data);
      setStorage(storRes.data);
      setObservability(obsRes.data);
      setCapabilities(capRes.data.capabilities || []);
      setPacks(capRes.data.packs || []);
      setHardware(capRes.data.hardware || null);
      setArabicReadiness(arabicRes.data);
      setError(null);
    } catch {
      setError("Failed to load system metrics.");
    } finally {
      setLoading(false);
    }
  };

  const toggleCapability = async (id: string, enabled: boolean) => {
    try {
      await axios.post(`/api/v2/system/capabilities/${id}/toggle`, { enabled });
      setCapabilities((prev) =>
        prev.map((c) => (c.id === id ? { ...c, enabled } : c)),
      );
    } catch (err: any) {
      setError(err?.response?.data?.error || `Failed to toggle ${id}`);
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
        title="System Health"
        eyebrow="System"
        description="A quick check that everything needed to make videos is running."
        actions={
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              startIcon={<DownloadIcon />}
              onClick={downloadBundle}
              disabled={downloadingBundle}
            >
              {downloadingBundle ? "Generating..." : "Download support file"}
            </Button>
            <Button variant="contained" startIcon={<RefreshIcon />} onClick={load} disabled={loading}>
              Refresh
            </Button>
          </Stack>
        }
      />

      {error && <Alert severity="error">{error}</Alert>}

      {arabicReadiness && (
        <Alert
          severity={arabicReadiness.ready ? "success" : "warning"}
          action={
            arabicReadiness.ready ? undefined : (
              <Button size="small" variant="contained" href="/providers">
                Configure ElevenLabs
              </Button>
            )
          }
        >
          <strong>Arabic Production Readiness: {arabicReadiness.statusText}</strong>
          <br />
          {arabicReadiness.message}
          {!arabicReadiness.ready && " English and local production remain available."}
        </Alert>
      )}

      {/* Top Overview Cards */}
      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={3}>
          {/* No hardcoded fallback: an unknown version must read as unknown rather
              than silently claiming a version this build may not be. */}
          <StatCard label="Product Version" value={diagnostics?.product?.version || "Unknown"} />
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
      {/* Plain-language rollup. Technical component identity stays in the
          tabs below, which are for support rather than daily use. */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {groupHealth(health?.components as any).map((entry) => (
          <Grid item xs={12} sm={6} md={4} lg={2} key={entry.group}>
            <SectionCard>
              <Stack spacing={1}>
                <Typography variant="body2" fontWeight={650}>
                  {entry.group}
                </Typography>
                <StatusBadge status={entry.status} />
              </Stack>
            </SectionCard>
          </Grid>
        ))}
      </Grid>

      <Tabs
        value={tab}
        onChange={(_, val) => setTab(val)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ borderBottom: 1, borderColor: "divider" }}
      >
        <Tab label="Services" />
        <Tab label="Optional Features" />
        <Tab label="Storage" />
        <Tab label="Activity" />
        <Tab label="Support" />
        <Tab label="Advanced Details" />
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

      {/* Tab 1: Capability Packs & Intelligence */}
      {tab === 1 && (
        <Stack spacing={3}>
          {/* Hardware Detection Banner */}
          <SectionCard
            title="Host Hardware Profile"
            description="Automatic hardware detection for local AI acceleration and resource allocation."
          >
            <Grid container spacing={2}>
              <Grid item xs={12} sm={4}>
                <Typography variant="caption" color="text.secondary">Platform / OS</Typography>
                <Typography variant="body1" fontWeight={700}>{hardware?.platform || "Windows"} ({hardware?.arch || "x64"})</Typography>
              </Grid>
              <Grid item xs={12} sm={4}>
                <Typography variant="caption" color="text.secondary">CPU Cores / Memory</Typography>
                <Typography variant="body1" fontWeight={700}>{hardware?.cpuCores || 8} Cores · {hardware?.totalMemoryGb || 16} GB RAM</Typography>
              </Grid>
              <Grid item xs={12} sm={4}>
                <Typography variant="caption" color="text.secondary">GPU Acceleration</Typography>
                <Typography variant="body1" fontWeight={700} color={hardware?.hasNvidiaGpu ? "success.main" : "text.primary"}>
                  {hardware?.gpuName || (hardware?.hasNvidiaGpu ? "NVIDIA GPU Detected" : "No Dedicated GPU (CPU Mode)")}
                  {hardware?.vramGb ? ` (${hardware.vramGb} GB VRAM)` : ""}
                </Typography>
              </Grid>
            </Grid>
          </SectionCard>

          {/* Capability Packs */}
          <Typography variant="h6" fontWeight={800}>Capability Packs</Typography>
          <Grid container spacing={2}>
            {packs.map((pack) => (
              <Grid item xs={12} md={6} key={pack.id}>
                <Card variant="outlined" sx={{ p: 2, height: "100%", bgcolor: "background.paper" }}>
                  <Stack spacing={1.5}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Typography variant="subtitle1" fontWeight={800}>{pack.name}</Typography>
                      <Chip
                        size="small"
                        label={pack.status.toUpperCase()}
                        color={pack.status === "installed" ? "success" : pack.status === "available" ? "info" : "default"}
                      />
                    </Stack>
                    <Typography variant="body2" color="text.secondary">{pack.description}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Hardware: {pack.hardwareRequired} · Space: {pack.diskRequirement}
                    </Typography>
                  </Stack>
                </Card>
              </Grid>
            ))}
          </Grid>

          {/* Detailed Capabilities Table / Toggles */}
          <Typography variant="h6" fontWeight={800}>Installed Runtime Modules</Typography>
          <Grid container spacing={2}>
            {capabilities.map((cap) => (
              <Grid item xs={12} sm={6} md={4} key={cap.id}>
                <Card variant="outlined" sx={{ p: 2, height: "100%" }}>
                  <Stack spacing={1}>
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                      <Box>
                        <Typography variant="subtitle2" fontWeight={800}>{cap.name}</Typography>
                        <Typography variant="caption" color="text.secondary">ID: {cap.id}</Typography>
                      </Box>
                      <Chip
                        size="small"
                        label={cap.installed ? (cap.healthy ? "Healthy" : "Degraded") : "Not Installed"}
                        color={cap.installed && cap.healthy ? "success" : "default"}
                        sx={{ fontSize: 10 }}
                      />
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      Runtime: {cap.runtime} · License: {cap.license}
                    </Typography>
                    {cap.failureReason && (
                      <Typography variant="caption" color="text.secondary" sx={{ fontStyle: "italic" }}>
                        Note: {cap.failureReason}
                      </Typography>
                    )}
                    {cap.installed && (
                      <FormControlLabel
                        control={
                          <Switch
                            size="small"
                            checked={cap.enabled}
                            onChange={(e) => toggleCapability(cap.id, e.target.checked)}
                          />
                        }
                        label={<Typography variant="caption">{cap.enabled ? "Enabled" : "Disabled"}</Typography>}
                      />
                    )}
                  </Stack>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Stack>
      )}

      {/* Tab 2: Storage Breakdown */}
      {tab === 2 && (
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

      {/* Tab 3: Sanitized Logs */}
      {tab === 3 && (
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

      {/* Tab 4: Support Bundle */}
      {tab === 4 && (
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

      {/* Tab 5: Observability */}
      {tab === 5 && (
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
