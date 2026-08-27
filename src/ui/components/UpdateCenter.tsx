import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  Grid,
  Link,
  Stack,
  Typography,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";

import { useI18n } from "../i18n";

/**
 * SETTINGS -> UPDATES
 *
 * Reports; it does not apply. Installing an update means controlling Docker on
 * the host, and the application container is deliberately never given that
 * privilege - a Docker socket in the web application is effectively host root.
 * So this panel tells the operator the one command, or the one shortcut, that
 * does the work, and shows what the host updater last recorded.
 *
 * The ordinary customer view carries no Docker command, no image reference and
 * no digest. Those live behind "Advanced technical details".
 */

type UpdateStatus = "UP_TO_DATE" | "UPDATE_AVAILABLE" | "CHECK_FAILED" | "UNSUPPORTED_UPDATE";

interface UpdateTransaction {
  transactionId: string;
  state: string;
  kind?: "update" | "rollback";
  fromVersion: string;
  toVersion: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  backupId?: string;
  error?: string;
  rollback?: {
    attempted: boolean;
    result: string;
    restoredVersion?: string;
    databaseRestored?: boolean;
    message?: string;
  };
}

interface UpdateCenterState {
  status: UpdateStatus;
  currentVersion: string;
  currentSchemaVersion: string;
  latestVersion: string | null;
  channel: string;
  publishedAt: string | null;
  releaseNotesUrl: string | null;
  requiresRestart: boolean;
  message: string;
  /** Translation key for `message`; see the update service contract. */
  messageKey?: string;
  messageVars?: Record<string, string>;
  checkedAt: string;
  lastCheckedAt: string | null;
  installationType: string;
  updateCommand: string;
  automaticCheckEnabled: boolean;
  automaticInstallEnabled: boolean;
  updateInProgress: boolean;
  lastAttempt: UpdateTransaction | null;
  lastSuccessful: UpdateTransaction | null;
  lastRollback: UpdateTransaction | null;
  advanced?: {
    image: string;
    imageDigest: string;
    packageSha256: string;
    schemaVersion: string;
    schemaBackwardsCompatible: boolean;
    minimumUpdaterVersion: string;
    signed: boolean;
  };
}

const STATUS_PRESENTATION: Record<
  UpdateStatus,
  { labelKey: string; color: "success" | "info" | "warning" | "default"; severity: "success" | "info" | "warning" }
> = {
  UP_TO_DATE: { labelKey: "updates.statusUpToDate", color: "success", severity: "success" },
  UPDATE_AVAILABLE: { labelKey: "updates.statusAvailable", color: "info", severity: "info" },
  CHECK_FAILED: { labelKey: "updates.statusCheckFailed", color: "warning", severity: "warning" },
  UNSUPPORTED_UPDATE: { labelKey: "updates.statusNeedsSupport", color: "warning", severity: "warning" },
};

/**
 * A labelled value.
 *
 * `technical` marks a value that must keep reading left-to-right whatever the
 * interface direction is: a version, an image digest, a checksum or an
 * installation identifier reorders visually inside an RTL paragraph otherwise.
 */
const Field: React.FC<{ label: string; value: React.ReactNode; technical?: boolean }> = ({
  label,
  value,
  technical,
}) => (
  <Box>
    <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
      {label}
    </Typography>
    <Typography
      variant="body2"
      fontWeight={650}
      dir={technical ? "ltr" : undefined}
      sx={{ wordBreak: "break-word", textAlign: technical ? "start" : undefined }}
    >
      {value}
    </Typography>
  </Box>
);

const UpdateCenter: React.FC = () => {
  const { t, format } = useI18n();
  // Timestamps here follow the interface language like every other date in the
  // product, rather than the browser's own default locale.
  const formatMoment = (value: string | null | undefined): string =>
    value ? format.dateTime(value) : t("updates.never");
  const [state, setState] = useState<UpdateCenterState | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advanced, setAdvanced] = useState<UpdateCenterState["advanced"] | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await axios.get("/api/v2/system/updates");
      setState(response.data);
      setError(null);
    } catch {
      setError(t("updates.unavailable"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const check = async () => {
    setChecking(true);
    setError(null);
    try {
      const response = await axios.post("/api/v2/system/updates/check");
      setState(response.data);
    } catch {
      setError(t("updates.unreachable"));
    } finally {
      setChecking(false);
    }
  };

  const toggleAdvanced = async () => {
    const next = !showAdvanced;
    setShowAdvanced(next);
    if (next && !advanced) {
      try {
        const response = await axios.get("/api/v2/system/updates?advanced=true");
        setAdvanced(response.data.advanced || null);
      } catch {
        setAdvanced(null);
      }
    }
  };

  if (loading) {
    return (
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ py: 2 }}>
        <CircularProgress size={18} />
        <Typography variant="body2" color="text.secondary">
          {t("updates.reading")}
        </Typography>
      </Stack>
    );
  }

  if (!state) {
    return <Alert severity="warning">{error || t("updates.unavailable")}</Alert>;
  }

  const presentation = STATUS_PRESENTATION[state.status] || STATUS_PRESENTATION.CHECK_FAILED;
  const updateAvailable = state.status === "UPDATE_AVAILABLE";

  return (
    <Stack spacing={2}>
      {error && <Alert severity="warning" onClose={() => setError(null)}>{error}</Alert>}

      {state.updateInProgress && (
        <Alert severity="warning">
          {t("updates.inProgress", {
            version: state.lastAttempt?.fromVersion || t("updates.previousVersion"),
          })}
        </Alert>
      )}

      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={3}>
          <Field label={t("updates.currentVersion")} value={state.currentVersion} technical />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Field
            label={t("updates.channel")}
            value={t(state.channel === "stable" ? "updates.channelStable" : "updates.channelDevelopment")}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Field label={t("updates.lastChecked")} value={formatMoment(state.lastCheckedAt)} />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Field
            label={t("updates.latestVersion")}
            value={state.latestVersion || t("updates.notKnownYet")}
            technical={Boolean(state.latestVersion)}
          />
        </Grid>
      </Grid>

      <Divider />

      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        alignItems={{ xs: "stretch", sm: "center" }}
        justifyContent="space-between"
      >
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
            {t("updates.status")}
          </Typography>
          <Stack direction="row" spacing={1.25} alignItems="center" flexWrap="wrap" useFlexGap>
            <Chip size="small" color={presentation.color} label={t(presentation.labelKey)} />
            {/* The service sends a key alongside its English wording, so the
                status sentence follows the interface language. */}
            <Typography variant="body2" color="text.secondary">
              {state.messageKey ? t(state.messageKey, state.messageVars) : state.message}
            </Typography>
          </Stack>
        </Box>
        <Button
          variant="outlined"
          size="small"
          startIcon={checking ? <CircularProgress size={14} /> : <RefreshIcon />}
          disabled={checking}
          onClick={check}
        >
          {checking ? t("updates.checking") : t("updates.check")}
        </Button>
      </Stack>

      {updateAvailable && (
        <Alert severity="info">
          <Typography variant="body2" fontWeight={650} gutterBottom>
            {t("updates.availableHeading", { version: state.latestVersion || "" })}
            {state.publishedAt
              ? ` — ${t("updates.publishedOn", { date: formatMoment(state.publishedAt) })}`
              : ""}
          </Typography>
          <Typography variant="body2" sx={{ mb: 1 }}>
            {t(
              state.installationType === "docker_windows"
                ? "updates.installWindows"
                : "updates.installServer",
            )}
          </Typography>
          {state.installationType !== "docker_windows" && (
            <Box
              component="code"
              sx={{
                display: "block",
                px: 1.25,
                py: 1,
                mb: 1,
                borderRadius: 1,
                bgcolor: "action.hover",
                fontSize: 13,
                overflowX: "auto",
              }}
              // A shell command is technical text: it stays left-to-right so an
              // Arabic interface cannot reorder its flags and paths.
              dir="ltr"
            >
              {state.updateCommand}
            </Box>
          )}
          <Typography variant="body2" color="text.secondary">
            {t("updates.safetyNote")}
            {state.requiresRestart ? ` ${t("updates.restartNote")}` : ""}
          </Typography>
          {state.releaseNotesUrl && (
            <Typography variant="body2" sx={{ mt: 1 }}>
              <Link href={state.releaseNotesUrl} target="_blank" rel="noopener noreferrer">
                {t("updates.releaseNotes")}
              </Link>
            </Typography>
          )}
        </Alert>
      )}

      {state.status === "UNSUPPORTED_UPDATE" && (
        <Alert severity="warning">
          {state.messageKey ? t(state.messageKey, state.messageVars) : state.message}
        </Alert>
      )}

      <Grid container spacing={2}>
        <Grid item xs={12} md={4}>
          <Field
            label={t("updates.automaticChecking")}
            value={t(state.automaticCheckEnabled ? "updates.on" : "updates.off")}
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <Field
            label={t("updates.automaticInstalling")}
            value={t("updates.automaticInstallingValue")}
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <Field
            label={t("updates.lastSuccessful")}
            value={
              state.lastSuccessful
                ? t("updates.lastSuccessfulValue", {
                    version: state.lastSuccessful.toVersion,
                    date: formatMoment(
                      state.lastSuccessful.finishedAt || state.lastSuccessful.updatedAt,
                    ),
                  })
                : t("updates.noneYet")
            }
          />
        </Grid>
      </Grid>

      {state.lastAttempt && state.lastAttempt.state !== "SUCCESS" && (
        // A deliberate rollback and a failed update both end in ROLLED_BACK,
        // but only one of them is a failure. Describing an administrator's own
        // rollback as an update that "did not complete" would send them looking
        // for a problem that does not exist.
        <Alert
          severity={
            state.lastAttempt.kind === "rollback" ||
            state.lastAttempt.rollback?.result === "succeeded"
              ? "info"
              : "warning"
          }
        >
          <Typography variant="body2" fontWeight={650}>
            {t(
              state.lastAttempt.kind === "rollback"
                ? "updates.rolledBackHeading"
                : "updates.attemptFailedHeading",
            )}
          </Typography>
          <Typography variant="body2">
            {/* Two version numbers and an arrow between them: a version pair is
                technical, and reversing it in RTL would state the migration
                backwards. */}
            <Box component="span" dir="ltr" sx={{ display: "inline-block" }}>
              {state.lastAttempt.fromVersion} → {state.lastAttempt.toVersion}
            </Box>{" "}
            · {formatMoment(state.lastAttempt.updatedAt)}
            {state.lastAttempt.kind !== "rollback" && state.lastAttempt.error
              ? ` ${state.lastAttempt.error}`
              : ""}
          </Typography>
          {state.lastAttempt.kind !== "rollback" && state.lastAttempt.rollback?.attempted && (
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              {state.lastAttempt.rollback.result === "succeeded"
                ? t("updates.restoredToVersion", {
                    version: state.lastAttempt.rollback.restoredVersion || "",
                  })
                : t("updates.rollbackIncomplete")}
              {state.lastAttempt.rollback.databaseRestored ? ` ${t("updates.databaseRestored")}` : ""}
            </Typography>
          )}
          {state.lastAttempt.backupId && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
              {t(
                state.lastAttempt.kind === "rollback"
                  ? "updates.backupKeptChange"
                  : "updates.backupKeptAttempt",
              )}
            </Typography>
          )}
        </Alert>
      )}

      <Box>
        <Button
          size="small"
          variant="text"
          endIcon={showAdvanced ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          onClick={toggleAdvanced}
        >
          {t("updates.advancedDetails")}
        </Button>
        <Collapse in={showAdvanced} unmountOnExit>
          <Box sx={{ mt: 1.5, p: 1.5, border: "1px solid", borderColor: "divider", borderRadius: 2 }}>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <Field label={t("updates.databaseSchema")} value={state.currentSchemaVersion} technical />
              </Grid>
              <Grid item xs={12} md={6}>
                <Field label={t("updates.installationType")} value={state.installationType} technical />
              </Grid>
              {advanced && (
                <>
                  <Grid item xs={12}>
                    <Field label={t("updates.candidateImage")} value={advanced.image} technical />
                  </Grid>
                  <Grid item xs={12}>
                    <Field label={t("updates.imageDigest")} value={advanced.imageDigest} technical />
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Field label={t("updates.packageChecksum")} value={advanced.packageSha256} technical />
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Field label={t("updates.candidateSchema")} value={advanced.schemaVersion} technical />
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Field
                      label={t("updates.rollbackWithoutRestore")}
                      value={t(advanced.schemaBackwardsCompatible ? "updates.possible" : "updates.notPossible")}
                    />
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Field
                      label={t("updates.releaseSignature")}
                      value={t(advanced.signed ? "updates.signed" : "updates.notSigned")}
                    />
                  </Grid>
                </>
              )}
              {!advanced && showAdvanced && (
                <Grid item xs={12}>
                  <Typography variant="body2" color="text.secondary">
                    {t("updates.noCandidate")}
                  </Typography>
                </Grid>
              )}
            </Grid>
          </Box>
        </Collapse>
      </Box>
    </Stack>
  );
};

export default UpdateCenter;
