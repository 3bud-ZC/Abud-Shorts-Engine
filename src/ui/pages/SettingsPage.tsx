import React, { useEffect, useState } from "react";
import axios from "axios";
import {
  Alert,
  Button,
  Divider,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from "@mui/material";
import SaveIcon from "@mui/icons-material/Save";
import {
  LoadingState,
  PageHeader,
  SectionCard,
  StatCard,
  StatusBadge,
} from "../components/v2";
import type { BusinessTemplateOption, V2Brand } from "./v2Types";

const SettingsPage: React.FC = () => {
  const [settings, setSettings] = useState<any>(null);
  const [brands, setBrands] = useState<V2Brand[]>([]);
  const [templates, setTemplates] = useState<BusinessTemplateOption[]>([]);
  const [draft, setDraft] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      axios.get("/api/v2/settings"),
      axios.get("/api/v2/brands"),
      axios.get("/api/v2/templates"),
    ])
      .then(([settingsResponse, brandsResponse, templatesResponse]) => {
        setSettings(settingsResponse.data);
        setDraft(settingsResponse.data.settings || {});
        setBrands(brandsResponse.data.brands || []);
        setTemplates(templatesResponse.data.templates || []);
      })
      .catch(() => setError("Failed to load settings."))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const response = await axios.put("/api/v2/settings", draft);
      setDraft(response.data.settings || {});
      setMessage("Production defaults saved.");
    } catch (err: any) {
      setError(err?.response?.data?.error || "Settings could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState label="Loading settings..." />;

  return (
    <>
      <PageHeader
        title="Settings & Production Defaults"
        eyebrow="Configuration"
        description="Configure default creation modes, language preferences, AI providers, and Brand Kit defaults. Secrets are masked and stored securely."
        actions={
          <Button
            variant="contained"
            startIcon={<SaveIcon />}
            disabled={saving}
            onClick={save}
          >
            {saving ? "Saving..." : "Save Defaults"}
          </Button>
        }
      />

      {message && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setMessage(null)}>
          {message}
        </Alert>
      )}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Grid container spacing={2}>
        {/* Production Defaults */}
        <Grid item xs={12} lg={7}>
          <SectionCard
            title="Production Defaults"
            description="Default initializers when opening the Create Video Studio."
          >
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <InputLabel>Default Creation Mode</InputLabel>
                  <Select
                    label="Default Creation Mode"
                    value={draft.defaultCreationMode || "prompt"}
                    onChange={(e) => setDraft({ ...draft, defaultCreationMode: e.target.value })}
                  >
                    <MenuItem value="prompt">Prompt Mode (AI Studio)</MenuItem>
                    <MenuItem value="template">Template Mode</MenuItem>
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <InputLabel>Default Language</InputLabel>
                  <Select
                    label="Default Language"
                    value={draft.defaultLanguage || "ar"}
                    onChange={(e) => setDraft({ ...draft, defaultLanguage: e.target.value })}
                  >
                    <MenuItem value="auto">Auto Detect</MenuItem>
                    <MenuItem value="ar">Arabic (العربية)</MenuItem>
                    <MenuItem value="en">English</MenuItem>
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <InputLabel>Default Arabic Dialect</InputLabel>
                  <Select
                    label="Default Arabic Dialect"
                    value={draft.defaultArabicDialect || "egyptian"}
                    onChange={(e) => setDraft({ ...draft, defaultArabicDialect: e.target.value })}
                  >
                    <MenuItem value="egyptian">Egyptian Arabic (المصرية)</MenuItem>
                    <MenuItem value="msa">Modern Standard Arabic (الفصحى)</MenuItem>
                    <MenuItem value="saudi">Saudi Arabic (السعودية)</MenuItem>
                    <MenuItem value="gulf">Gulf Arabic (الخليجية)</MenuItem>
                    <MenuItem value="levantine">Levantine Arabic (الشامية)</MenuItem>
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <InputLabel>Default Duration</InputLabel>
                  <Select
                    label="Default Duration"
                    value={draft.defaultDuration || 30}
                    onChange={(e) => setDraft({ ...draft, defaultDuration: Number(e.target.value) })}
                  >
                    <MenuItem value={15}>15 Seconds</MenuItem>
                    <MenuItem value={20}>20 Seconds</MenuItem>
                    <MenuItem value={30}>30 Seconds</MenuItem>
                    <MenuItem value={45}>45 Seconds</MenuItem>
                    <MenuItem value={60}>60 Seconds</MenuItem>
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <InputLabel>Default Aspect Ratio</InputLabel>
                  <Select
                    label="Default Aspect Ratio"
                    value={draft.defaultAspectRatio || "9:16"}
                    onChange={(e) => setDraft({ ...draft, defaultAspectRatio: e.target.value })}
                  >
                    <MenuItem value="9:16">9:16 (Vertical Short)</MenuItem>
                    <MenuItem value="16:9">16:9 (Landscape)</MenuItem>
                    <MenuItem value="1:1">1:1 (Square)</MenuItem>
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <InputLabel>Default Quality Profile</InputLabel>
                  <Select
                    label="Default Quality Profile"
                    value={draft.defaultQuality || "standard"}
                    onChange={(e) => setDraft({ ...draft, defaultQuality: e.target.value })}
                  >
                    <MenuItem value="draft">Draft (Fastest)</MenuItem>
                    <MenuItem value="standard">Standard (1080p Balanced)</MenuItem>
                    <MenuItem value="high">High Quality</MenuItem>
                    <MenuItem value="premium">Premium</MenuItem>
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <InputLabel>Default Visual Mode</InputLabel>
                  <Select
                    label="Default Visual Mode"
                    value={draft.defaultVisualMode || "auto"}
                    onChange={(e) => setDraft({ ...draft, defaultVisualMode: e.target.value })}
                  >
                    <MenuItem value="auto">Auto (Stock / AI)</MenuItem>
                    <MenuItem value="stock">Stock Only (Pexels)</MenuItem>
                    <MenuItem value="ai">AI Video</MenuItem>
                    <MenuItem value="hybrid">Hybrid</MenuItem>
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <InputLabel>Default Brand Profile</InputLabel>
                  <Select
                    label="Default Brand Profile"
                    value={draft.defaultBrandId || ""}
                    onChange={(e) => setDraft({ ...draft, defaultBrandId: e.target.value || null })}
                  >
                    <MenuItem value="">None / Custom</MenuItem>
                    {brands.map((brand) => (
                      <MenuItem key={brand.id} value={brand.id}>
                        {brand.name} {brand.isDefault ? "(Default)" : ""}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            </Grid>
          </SectionCard>
        </Grid>

        {/* Secure Provider Credentials Summary */}
        <Grid item xs={12} lg={5}>
          <SectionCard
            title="Provider Credentials (Masked)"
            description="Credentials are securely injected via environment variables. Plaintext secrets are never transmitted to the browser."
          >
            <Stack spacing={1.5}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography>Pexels API</Typography>
                <StatusBadge
                  status={settings?.pexels?.configured ? "ready" : "missing"}
                  label={settings?.pexels?.configured ? "Configured" : "Missing"}
                />
              </Stack>
              <Typography variant="body2" color="text.secondary">
                Key: {settings?.pexels?.redactedKey || "Not configured"}
              </Typography>

              <Divider />

              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography>Google Gemini AI</Typography>
                <StatusBadge
                  status={settings?.gemini?.configured ? "ready" : "missing"}
                  label={settings?.gemini?.configured ? "Configured" : "Local AI Fallback"}
                />
              </Stack>
              <Typography variant="body2" color="text.secondary">
                Key: {settings?.gemini?.redactedKey || "Not configured (Local AI active)"}
              </Typography>

              <Divider />

              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography>Upload-Post API</Typography>
                <StatusBadge
                  status={settings?.uploadPost?.configured ? "ready" : "missing"}
                  label={settings?.uploadPost?.configured ? "Configured" : "Missing"}
                />
              </Stack>
              <Typography variant="body2" color="text.secondary">
                Key: {settings?.uploadPost?.redactedKey || "Not configured"}
              </Typography>

              <Divider />

              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography>Telegram Bot Token</Typography>
                <StatusBadge
                  status={settings?.telegram?.configured ? "ready" : "missing"}
                  label={settings?.telegram?.configured ? "Configured" : "Missing"}
                />
              </Stack>
              <Typography variant="body2" color="text.secondary">
                Token: {settings?.telegram?.redactedKey || "Not configured"}
              </Typography>
            </Stack>
          </SectionCard>
        </Grid>

        {/* Publishing & Distribution Defaults */}
        <Grid item xs={12}>
          <SectionCard
            title="Publishing & Distribution Defaults"
            description="Control default publication modes, privacy, and scheduling timezone."
          >
            <Grid container spacing={2}>
              <Grid item xs={12} sm={4}>
                <FormControl fullWidth>
                  <InputLabel>Default Publishing Mode</InputLabel>
                  <Select
                    label="Default Publishing Mode"
                    value={draft.defaultPublishingMode || "draft"}
                    onChange={(e) => setDraft({ ...draft, defaultPublishingMode: e.target.value })}
                  >
                    <MenuItem value="draft">Draft (Review before publishing)</MenuItem>
                    <MenuItem value="direct">Direct Auto-Publish</MenuItem>
                    <MenuItem value="scheduled">Scheduled by Default</MenuItem>
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} sm={4}>
                <FormControl fullWidth>
                  <InputLabel>Default YouTube Privacy</InputLabel>
                  <Select
                    label="Default YouTube Privacy"
                    value={draft.defaultYouTubePrivacy || "unlisted"}
                    onChange={(e) => setDraft({ ...draft, defaultYouTubePrivacy: e.target.value })}
                  >
                    <MenuItem value="unlisted">Unlisted (Recommended)</MenuItem>
                    <MenuItem value="private">Private</MenuItem>
                    <MenuItem value="public">Public</MenuItem>
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} sm={4}>
                <FormControl fullWidth>
                  <InputLabel>Default Timezone</InputLabel>
                  <Select
                    label="Default Timezone"
                    value={draft.defaultTimezone || "Africa/Cairo"}
                    onChange={(e) => setDraft({ ...draft, defaultTimezone: e.target.value })}
                  >
                    <MenuItem value="Africa/Cairo">Africa/Cairo (EET)</MenuItem>
                    <MenuItem value="UTC">UTC</MenuItem>
                    <MenuItem value="Asia/Riyadh">Asia/Riyadh (AST)</MenuItem>
                    <MenuItem value="Asia/Dubai">Asia/Dubai (GST)</MenuItem>
                    <MenuItem value="Europe/London">Europe/London (GMT/BST)</MenuItem>
                    <MenuItem value="America/New_York">America/New_York (EST/EDT)</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
            </Grid>
          </SectionCard>
        </Grid>
        {/* Backup & Restore Management */}
        <Grid item xs={12}>
          <SectionCard
            title="Backup & Disaster Recovery"
            description="Create encrypted or secret-free backups of configuration, brands, templates, PostgreSQL database records, and rendered media."
            actions={
              <Button
                variant="outlined"
                size="small"
                onClick={async () => {
                  try {
                    const res = await axios.get("/api/v2/config/export");
                    const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `abud_config_export_${Date.now()}.json`;
                    a.click();
                  } catch {
                    setError("Failed to export configuration.");
                  }
                }}
              >
                Export Config (JSON)
              </Button>
            }
          >
            <BackupManager />
          </SectionCard>
        </Grid>

        {/* System & Storage Stats */}
        <Grid item xs={12} md={4}>
          <StatCard label="V2 Runtime" value={settings?.app?.v2Enabled ? "Active" : "Inactive"} />
        </Grid>
        <Grid item xs={12} md={4}>
          <StatCard label="Docker Environment" value={settings?.app?.docker ? "Containerized" : "Native"} />
        </Grid>
        <Grid item xs={12} md={4}>
          <StatCard
            label="Video Storage"
            value={
              typeof settings?.storage?.bytes === "number"
                ? `${(settings.storage.bytes / (1024 * 1024)).toFixed(1)} MB`
                : "Unknown"
            }
          />
        </Grid>
      </Grid>
    </>
  );
};

const BackupManager: React.FC = () => {
  const [backups, setBackups] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const loadBackups = async () => {
    setLoading(true);
    try {
      const res = await axios.get("/api/v2/backups");
      setBackups(res.data.backups || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBackups();
  }, []);

  const handleCreateBackup = async (type: string) => {
    setCreating(true);
    setStatusMsg(null);
    try {
      const res = await axios.post("/api/v2/backups", { type });
      setStatusMsg(`Backup created successfully: ${res.data.backup.filename}`);
      loadBackups();
    } catch {
      setStatusMsg("Failed to create backup.");
    } finally {
      setCreating(false);
    }
  };

  const handleRestore = async (id: string) => {
    if (!window.confirm("Are you sure you want to restore this backup? A pre-restore safety snapshot will be automatically created.")) {
      return;
    }
    setLoading(true);
    try {
      const res = await axios.post(`/api/v2/backups/${id}/restore`);
      alert(res.data.message || "Backup restored successfully!");
      loadBackups();
    } catch (err: any) {
      alert(err.response?.data?.message || "Restore failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this backup?")) return;
    try {
      await axios.delete(`/api/v2/backups/${id}`);
      loadBackups();
    } catch {
      alert("Failed to delete backup.");
    }
  };

  return (
    <Stack spacing={2}>
      {statusMsg && <Alert severity="info">{statusMsg}</Alert>}
      <Stack direction="row" spacing={1.5}>
        <Button
          variant="contained"
          size="small"
          disabled={creating}
          onClick={() => handleCreateBackup("config_db")}
        >
          {creating ? "Creating..." : "Create Database + Config Backup"}
        </Button>
        <Button
          variant="outlined"
          size="small"
          disabled={creating}
          onClick={() => handleCreateBackup("full")}
        >
          Create Full Media Backup
        </Button>
      </Stack>

      <Typography variant="subtitle2" fontWeight={700} sx={{ mt: 2 }}>
        Backup History ({backups.length})
      </Typography>

      {backups.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No backups created yet. Click above to create your first safety backup.
        </Typography>
      ) : (
        <Stack spacing={1}>
          {backups.map((b) => (
            <Box
              key={b.id}
              sx={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                p: 1.5,
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 2,
                bgcolor: "#fcfdfd",
              }}
            >
              <Box>
                <Typography variant="body2" fontWeight={700}>
                  {b.filename}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Type: {b.type} · Size: {(b.sizeBytes / 1024).toFixed(1)} KB · Version: {b.version} ·{" "}
                  {new Date(b.createdAt).toLocaleString()}
                </Typography>
              </Box>
              <Stack direction="row" spacing={1}>
                <Button size="small" variant="text" href={`/api/v2/backups/${b.id}/download`}>
                  Download
                </Button>
                <Button size="small" variant="outlined" color="warning" onClick={() => handleRestore(b.id)}>
                  Restore
                </Button>
                <Button size="small" variant="text" color="error" onClick={() => handleDelete(b.id)}>
                  Delete
                </Button>
              </Stack>
            </Box>
          ))}
        </Stack>
      )}
    </Stack>
  );
};

export default SettingsPage;
