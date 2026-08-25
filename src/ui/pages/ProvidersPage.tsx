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

type DiscoveredVoice = {
  id: string;
  name: string;
  language?: string;
  dialect?: string;
  gender?: string;
  category?: string;
  accent?: string;
  previewUrl?: string;
};

type VoiceLabConfig = {
  configured: boolean;
  model: string;
  referenceScript: string;
  maxCharacters: number;
  presets: Array<{ id: string; settings: Record<string, unknown> }>;
  note: string;
  defaultArabicVoice?: { voiceId: string; voiceName?: string; preset?: string; selectedAt?: string } | null;
};

const ProvidersPage: React.FC = () => {
  const [providers, setProviders] = useState<ProviderItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [validatingProvider, setValidatingProvider] = useState<string | null>(null);
  const [validationAlert, setValidationAlert] = useState<{ provider: string; message: string; healthy: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [credentialProvider, setCredentialProvider] = useState<ProviderItem | null>(null);
  const [credentialType, setCredentialType] = useState("api_key");
  const [credentialValue, setCredentialValue] = useState("");
  const [savingCredential, setSavingCredential] = useState(false);

  // Voice Lab / voice discovery state (ElevenLabs only).
  const [voiceLabOpen, setVoiceLabOpen] = useState(false);
  const [voiceLabConfig, setVoiceLabConfig] = useState<VoiceLabConfig | null>(null);
  const [voiceLabVoices, setVoiceLabVoices] = useState<DiscoveredVoice[]>([]);
  const [voiceLabLoading, setVoiceLabLoading] = useState(false);
  const [voiceLabError, setVoiceLabError] = useState<string | null>(null);
  const [voiceLabText, setVoiceLabText] = useState("");
  const [voiceLabVoiceId, setVoiceLabVoiceId] = useState("");
  const [voiceLabPreset, setVoiceLabPreset] = useState("natural");
  const [voiceLabLanguage, setVoiceLabLanguage] = useState("ar");
  const [voiceLabDialect, setVoiceLabDialect] = useState("egyptian");
  const [voiceLabAudio, setVoiceLabAudio] = useState<string | null>(null);
  const [voiceLabGenerating, setVoiceLabGenerating] = useState(false);
  const [defaultArabicVoiceId, setDefaultArabicVoiceId] = useState("");
  const [browseOnly, setBrowseOnly] = useState(false);

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

  /**
   * Voice Lab lets the human audition ElevenLabs voices before any video is
   * rendered. The engine never picks a "best" or "Egyptian" voice for them.
   */
  const openVoiceLab = async (options: { browseOnly?: boolean } = {}) => {
    setBrowseOnly(Boolean(options.browseOnly));
    setVoiceLabOpen(true);
    setVoiceLabError(null);
    setVoiceLabAudio(null);
    setVoiceLabLoading(true);
    try {
      const [configResponse, voicesResponse] = await Promise.all([
        axios.get("/api/v2/voice-lab/config"),
        axios.get("/api/v2/providers/elevenlabs/voices", { params: { language: "ar" } }),
      ]);
      const config: VoiceLabConfig = configResponse.data;
      setVoiceLabConfig(config);
      if (config.defaultArabicVoice?.voiceId) {
        setDefaultArabicVoiceId(config.defaultArabicVoice.voiceId);
        setVoiceLabVoiceId((current) => current || config.defaultArabicVoice!.voiceId);
      }
      if (!voiceLabText) setVoiceLabText(config.referenceScript || "");
      const voices: DiscoveredVoice[] = voicesResponse.data.voices || [];
      setVoiceLabVoices(voices);
      const warnings: string[] = voicesResponse.data.warnings || [];
      if (warnings.length) setVoiceLabError(warnings.join(" "));
      if (!voiceLabVoiceId && voices.length) setVoiceLabVoiceId(voices[0].id);
    } catch (err: any) {
      setVoiceLabError(err?.response?.data?.message || "Could not reach ElevenLabs voice discovery.");
    } finally {
      setVoiceLabLoading(false);
    }
  };

  /**
   * Persist the voice the human picked. Selection is explicit and manual - the
   * engine never promotes a voice on its own.
   */
  const saveDefaultArabicVoice = async () => {
    if (!voiceLabVoiceId) return;
    try {
      await axios.put("/api/v2/voice-lab/default-voice", {
        voiceId: voiceLabVoiceId,
        voiceName: voiceLabVoices.find((voice) => voice.id === voiceLabVoiceId)?.name,
        preset: voiceLabPreset,
      });
      setDefaultArabicVoiceId(voiceLabVoiceId);
      setVoiceLabError(null);
    } catch (err) {
      setVoiceLabError(
        (err as any)?.response?.data?.message || "Could not save the default Arabic voice.",
      );
    }
  };

  const generateVoiceLabPreview = async () => {
    setVoiceLabGenerating(true);
    setVoiceLabError(null);
    setVoiceLabAudio(null);
    try {
      const response = await axios.post("/api/v2/voice-lab/preview", {
        text: voiceLabText,
        voiceId: voiceLabVoiceId,
        preset: voiceLabPreset,
        language: voiceLabLanguage,
        dialect: voiceLabDialect,
      });
      setVoiceLabAudio(response.data.audioBase64 || null);
    } catch (err: any) {
      setVoiceLabError(err?.response?.data?.message || "Voice preview failed.");
    } finally {
      setVoiceLabGenerating(false);
    }
  };

  const openCredentialDialog = (provider: ProviderItem) => {
    setCredentialProvider(provider);
    setCredentialType(provider.credentialTypes?.[0] || "api_key");
    setCredentialValue("");
  };

  const saveCredential = async () => {
    if (!credentialProvider?.id) return;
    setSavingCredential(true);
    try {
      await axios.put(`/api/v2/providers/${credentialProvider.id}/credentials`, {
        credentialType,
        value: credentialValue,
      });
      setCredentialProvider(null);
      setCredentialValue("");
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message || "Credential save failed.");
    } finally {
      setSavingCredential(false);
    }
  };

  const disconnectProvider = async (provider: ProviderItem) => {
    if (!provider.id) return;
    try {
      await axios.delete(`/api/v2/providers/${provider.id}/credentials`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message || "Disconnect failed.");
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
                          {provider.vaultConfigured && (
                            <Chip size="small" color="success" variant="outlined" label="Vault Configured" />
                          )}
                          {provider.details?.liveVerified === true && (
                            <Chip size="small" color="success" label="Live Verified" />
                          )}
                          {provider.configured && provider.details?.liveVerified === false && (
                            <Chip size="small" color="warning" variant="outlined" label="Not Live Verified" />
                          )}
                          {typeof provider.details?.accountTier === "string" && (
                            <Chip size="small" variant="outlined" label={`Tier: ${provider.details.accountTier}`} />
                          )}
                          {typeof provider.details?.lastTestedAt === "string" && (
                            <Chip
                              size="small"
                              variant="outlined"
                              label={`Last Tested: ${new Date(provider.details.lastTestedAt as string).toLocaleString()}`}
                            />
                          )}
                        </Stack>
                        {provider.vault?.length ? (
                          <Stack spacing={0.5}>
                            {provider.vault.map((credential) => (
                              <Typography key={credential.credentialType} variant="caption" color="text.secondary">
                                {credential.credentialType}: {credential.maskedHint || "masked"} · {credential.health}
                              </Typography>
                            ))}
                          </Stack>
                        ) : null}
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
                            {provider.id === "elevenlabs" && (
                              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                                <Chip
                                  size="small"
                                  variant="outlined"
                                  label={`Credential: ${provider.details.credentialStored ? "Stored" : "Not stored"}`}
                                  color={provider.details.credentialStored ? "success" : "default"}
                                />
                                <Chip
                                  size="small"
                                  variant="outlined"
                                  label={`Connection: ${provider.details.authenticated === undefined ? "Not tested" : provider.details.authenticated ? "Authenticated" : "Failed"}`}
                                  color={provider.details.authenticated ? "success" : provider.details.authenticated === false ? "error" : "default"}
                                />
                                <Chip
                                  size="small"
                                  variant="outlined"
                                  label={`Voices: ${provider.details.voiceDiscoveryAvailable === undefined ? "Not tested" : provider.details.voiceDiscoveryAvailable ? `${provider.details.voicesDiscovered ?? 0} found` : "Restricted"}`}
                                  color={provider.details.voiceDiscoveryAvailable ? "success" : provider.details.voiceDiscoveryAvailable === false ? "error" : "default"}
                                />
                                <Chip
                                  size="small"
                                  variant="outlined"
                                  label={`TTS: ${provider.details.ttsReady === undefined ? "Not tested" : provider.details.ttsReady ? "Ready" : "Not ready"}`}
                                  color={provider.details.ttsReady ? "success" : provider.details.ttsReady === false ? "warning" : "default"}
                                />
                                <Chip
                                  size="small"
                                  variant={provider.details.liveVerified ? "filled" : "outlined"}
                                  label={provider.details.liveVerified ? "Live Verified" : "Not live-verified"}
                                  color={provider.details.liveVerified ? "success" : "default"}
                                />
                              </Stack>
                            )}
                            {provider.id === "elevenlabs" && provider.details.errorDetail && (() => {
                              const errorDetail = provider.details.errorDetail as {
                                category?: string;
                                upstreamMessage?: string;
                                requestId?: string;
                              };
                              return (
                                <Typography variant="caption" color="error.main">
                                  {String(errorDetail.upstreamMessage || errorDetail.category)}
                                  {errorDetail.requestId ? ` (request ${errorDetail.requestId})` : ""}
                                </Typography>
                              );
                            })()}
                          </Stack>
                        )}
                        <Divider />
                        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} flexWrap="wrap">
                          {provider.credentialTypes && provider.credentialTypes.length > 0 && !["local_ai", "kokoro", "piper", "whisper_cpp", "remotion", "ffmpeg", "n8n", "postgres"].includes(provider.id || "") && (
                            <Button
                              size="small"
                              startIcon={<SettingsIcon />}
                              onClick={() => openCredentialDialog(provider)}
                            >
                              {provider.vaultConfigured ? "Replace Credentials" : "Configure"}
                            </Button>
                          )}
                          <Button
                            size="small"
                            variant="outlined"
                            disabled={validatingProvider === provider.name}
                            onClick={() => testProviderConnection(provider)}
                          >
                            {provider.configured === false ? "Not configured" : validatingProvider === provider.name ? "Testing..." : "Test Connection"}
                          </Button>
                          {provider.id === "elevenlabs" && (
                            <>
                              <Button size="small" onClick={() => openVoiceLab({ browseOnly: true })}>
                                Browse Voices
                              </Button>
                              <Button size="small" variant="contained" onClick={() => openVoiceLab()}>
                                Voice Lab
                              </Button>
                            </>
                          )}
                          {provider.vaultConfigured && (
                            <Button size="small" color="error" onClick={() => disconnectProvider(provider)}>
                              Disconnect
                            </Button>
                          )}
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

      <Dialog open={voiceLabOpen} onClose={() => setVoiceLabOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{browseOnly ? "ElevenLabs Voices" : "ElevenLabs Voice Lab"}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {voiceLabConfig && !voiceLabConfig.configured && (
              <Alert severity="error">
                ElevenLabs is required for Arabic narration. Configure an API key before auditioning voices.
              </Alert>
            )}
            {voiceLabError && <Alert severity="warning">{voiceLabError}</Alert>}
            <Alert severity="info">
              Short auditions only - no video is rendered. Pick the voice you prefer by listening; the engine
              does not rank voices or claim any of them is Egyptian.
            </Alert>

            {voiceLabLoading ? (
              <Typography variant="body2">Loading voices...</Typography>
            ) : (
              <>
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  <Chip size="small" variant="outlined" label={`Model: ${voiceLabConfig?.model || "-"}`} />
                  <Chip size="small" variant="outlined" label={`Voices discovered: ${voiceLabVoices.length}`} />
                  <Chip size="small" variant="outlined" label="Cloud / Usage Based" />
                </Stack>

                <TextField
                  select
                  label="Voice"
                  value={voiceLabVoiceId}
                  onChange={(e) => setVoiceLabVoiceId(e.target.value)}
                  fullWidth
                  SelectProps={{ native: true }}
                  InputLabelProps={{ shrink: true }}
                >
                  <option value="">Select a voice</option>
                  {voiceLabVoices.map((voice) => (
                    <option key={voice.id} value={voice.id}>
                      {[voice.name, voice.accent, voice.gender, voice.category].filter(Boolean).join(" · ")}
                    </option>
                  ))}
                </TextField>

                {!browseOnly && (
                  <>
                    <Stack direction="row" spacing={2}>
                      <TextField
                        select
                        label="Language"
                        value={voiceLabLanguage}
                        onChange={(e) => setVoiceLabLanguage(e.target.value)}
                        fullWidth
                        SelectProps={{ native: true }}
                        InputLabelProps={{ shrink: true }}
                      >
                        <option value="ar">Arabic</option>
                        <option value="en">English</option>
                      </TextField>
                      <TextField
                        select
                        label="Target dialect"
                        value={voiceLabDialect}
                        onChange={(e) => setVoiceLabDialect(e.target.value)}
                        fullWidth
                        SelectProps={{ native: true }}
                        InputLabelProps={{ shrink: true }}
                      >
                        <option value="egyptian">Egyptian</option>
                        <option value="msa">MSA</option>
                      </TextField>
                      <TextField
                        select
                        label="Preset"
                        value={voiceLabPreset}
                        onChange={(e) => setVoiceLabPreset(e.target.value)}
                        fullWidth
                        SelectProps={{ native: true }}
                        InputLabelProps={{ shrink: true }}
                      >
                        {(voiceLabConfig?.presets || []).map((preset) => (
                          <option key={preset.id} value={preset.id}>{preset.id}</option>
                        ))}
                      </TextField>
                    </Stack>

                    <TextField
                      label="Audition text"
                      value={voiceLabText}
                      onChange={(e) => setVoiceLabText(e.target.value)}
                      fullWidth
                      multiline
                      minRows={4}
                      helperText="Keep the same text across voices so the comparison stays fair."
                      inputProps={{ maxLength: voiceLabConfig?.maxCharacters || 600, dir: "auto" }}
                    />

                    <Stack direction="row" spacing={1}>
                      <Button
                        variant="contained"
                        disabled={voiceLabGenerating || !voiceLabVoiceId || !voiceLabText.trim()}
                        onClick={generateVoiceLabPreview}
                      >
                        {voiceLabGenerating ? "Generating..." : voiceLabAudio ? "Regenerate" : "Generate Preview"}
                      </Button>
                      <Button
                        disabled={!voiceLabVoiceId}
                        onClick={saveDefaultArabicVoice}
                      >
                        Set as default Arabic voice
                      </Button>
                    </Stack>

                    {voiceLabAudio && (
                      <audio controls src={voiceLabAudio} style={{ width: "100%" }} />
                    )}

                    {defaultArabicVoiceId && (
                      <Alert severity="success">
                        Default Arabic voice selected: {voiceLabVoices.find((v) => v.id === defaultArabicVoiceId)?.name || defaultArabicVoiceId}
                      </Alert>
                    )}
                  </>
                )}
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVoiceLabOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(credentialProvider)} onClose={() => setCredentialProvider(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{credentialProvider?.vaultConfigured ? "Replace Credentials" : "Configure Provider"}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity="info">
              Credentials are encrypted server-side and the plaintext value is never returned after save.
            </Alert>
            <Typography variant="subtitle2" fontWeight={800}>
              {credentialProvider?.name}
            </Typography>
            <TextField
              select
              label="Credential Type"
              value={credentialType}
              onChange={(e) => setCredentialType(e.target.value)}
              fullWidth
              SelectProps={{ native: true }}
            >
              {(credentialProvider?.credentialTypes || ["api_key"]).map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </TextField>
            <TextField
              label={credentialType === "service_account_json" ? "Service Account JSON" : "Credential"}
              type={credentialType.includes("json") ? "text" : "password"}
              value={credentialValue}
              onChange={(e) => setCredentialValue(e.target.value)}
              fullWidth
              multiline={credentialType.includes("json")}
              minRows={credentialType.includes("json") ? 5 : undefined}
              autoComplete="off"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCredentialProvider(null)}>Cancel</Button>
          <Button variant="contained" disabled={savingCredential || !credentialValue.trim()} onClick={saveCredential}>
            {savingCredential ? "Saving..." : "Save Encrypted"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default ProvidersPage;
