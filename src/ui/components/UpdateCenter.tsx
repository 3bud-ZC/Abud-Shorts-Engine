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
  { label: string; color: "success" | "info" | "warning" | "default"; severity: "success" | "info" | "warning" }
> = {
  UP_TO_DATE: { label: "Up to date", color: "success", severity: "success" },
  UPDATE_AVAILABLE: { label: "Update available", color: "info", severity: "info" },
  CHECK_FAILED: { label: "Could not check", color: "warning", severity: "warning" },
  UNSUPPORTED_UPDATE: { label: "Needs support", color: "warning", severity: "warning" },
};

function formatMoment(value: string | null | undefined): string {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

const Field: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <Box>
    <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
      {label}
    </Typography>
    <Typography variant="body2" fontWeight={700} sx={{ wordBreak: "break-word" }}>
      {value}
    </Typography>
  </Box>
);

const UpdateCenter: React.FC = () => {
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
      setError("Update status is unavailable right now.");
    } finally {
      setLoading(false);
    }
  }, []);

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
      setError("Could not reach the update service. Try again in a moment.");
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
          Reading update status...
        </Typography>
      </Stack>
    );
  }

  if (!state) {
    return <Alert severity="warning">{error || "Update status is unavailable right now."}</Alert>;
  }

  const presentation = STATUS_PRESENTATION[state.status] || STATUS_PRESENTATION.CHECK_FAILED;
  const updateAvailable = state.status === "UPDATE_AVAILABLE";

  return (
    <Stack spacing={2}>
      {error && <Alert severity="warning" onClose={() => setError(null)}>{error}</Alert>}

      {state.updateInProgress && (
        <Alert severity="warning">
          An update is in progress, or a previous one was interrupted before it finished.
          Run the updater again to complete it safely — it takes a fresh backup, verifies
          the result, and returns to version {state.lastAttempt?.fromVersion || "the previous version"} if
          anything is wrong.
        </Alert>
      )}

      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={3}>
          <Field label="Current Version" value={state.currentVersion} />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Field
            label="Channel"
            value={state.channel === "stable" ? "Stable" : "Development"}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Field label="Last Checked" value={formatMoment(state.lastCheckedAt)} />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Field
            label="Latest Version"
            value={state.latestVersion || "Not known yet"}
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
            Update Status
          </Typography>
          <Stack direction="row" spacing={1.25} alignItems="center" flexWrap="wrap" useFlexGap>
            <Chip size="small" color={presentation.color} label={presentation.label} />
            <Typography variant="body2" color="text.secondary">
              {state.message}
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
          {checking ? "Checking..." : "Check for Updates"}
        </Button>
      </Stack>

      {updateAvailable && (
        <Alert severity="info">
          <Typography variant="body2" fontWeight={800} gutterBottom>
            Version {state.latestVersion} is available
            {state.publishedAt ? ` — published ${formatMoment(state.publishedAt)}` : ""}
          </Typography>
          <Typography variant="body2" sx={{ mb: 1 }}>
            {state.installationType === "docker_windows"
              ? 'To install it, open the Start Menu and choose "ABUD Shorts → ABUD Shorts - Update".'
              : "To install it, sign in to this server and run:"}
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
            >
              {state.updateCommand}
            </Box>
          )}
          <Typography variant="body2" color="text.secondary">
            A backup is created first. If anything is wrong after the update, the previous
            version is restored automatically.
            {state.requiresRestart ? " The system restarts during the update." : ""}
          </Typography>
          {state.releaseNotesUrl && (
            <Typography variant="body2" sx={{ mt: 1 }}>
              <Link href={state.releaseNotesUrl} target="_blank" rel="noopener noreferrer">
                Release Notes
              </Link>
            </Typography>
          )}
        </Alert>
      )}

      {state.status === "UNSUPPORTED_UPDATE" && (
        <Alert severity="warning">{state.message}</Alert>
      )}

      <Grid container spacing={2}>
        <Grid item xs={12} md={4}>
          <Field
            label="Automatic checking"
            value={state.automaticCheckEnabled ? "On" : "Off"}
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <Field
            label="Automatic installing"
            value="Off — an administrator approves every update"
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <Field
            label="Last successful update"
            value={
              state.lastSuccessful
                ? `${state.lastSuccessful.toVersion} on ${formatMoment(state.lastSuccessful.finishedAt || state.lastSuccessful.updatedAt)}`
                : "None yet"
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
          <Typography variant="body2" fontWeight={700}>
            {state.lastAttempt.kind === "rollback"
              ? "This system was returned to an earlier version"
              : "The last update attempt did not complete"}
          </Typography>
          <Typography variant="body2">
            {state.lastAttempt.fromVersion} → {state.lastAttempt.toVersion} on{" "}
            {formatMoment(state.lastAttempt.updatedAt)}.
            {state.lastAttempt.kind !== "rollback" && state.lastAttempt.error
              ? ` ${state.lastAttempt.error}`
              : ""}
          </Typography>
          {state.lastAttempt.kind !== "rollback" && state.lastAttempt.rollback?.attempted && (
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              {state.lastAttempt.rollback.result === "succeeded"
                ? `The system was returned to version ${state.lastAttempt.rollback.restoredVersion}.`
                : "The automatic return to the previous version did not finish. Contact support."}
              {state.lastAttempt.rollback.databaseRestored
                ? " The database was restored from the pre-update backup."
                : ""}
            </Typography>
          )}
          {state.lastAttempt.backupId && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
              A backup from before that {state.lastAttempt.kind === "rollback" ? "change" : "attempt"} is kept.
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
          Advanced technical details
        </Button>
        <Collapse in={showAdvanced} unmountOnExit>
          <Box sx={{ mt: 1.5, p: 1.5, border: "1px solid", borderColor: "divider", borderRadius: 2 }}>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <Field label="Database schema" value={state.currentSchemaVersion} />
              </Grid>
              <Grid item xs={12} md={6}>
                <Field label="Installation type" value={state.installationType} />
              </Grid>
              {advanced && (
                <>
                  <Grid item xs={12}>
                    <Field label="Candidate image" value={advanced.image} />
                  </Grid>
                  <Grid item xs={12}>
                    <Field label="Image digest" value={advanced.imageDigest} />
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Field label="Package SHA-256" value={advanced.packageSha256} />
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Field label="Candidate schema" value={advanced.schemaVersion} />
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Field
                      label="Rollback without database restore"
                      value={advanced.schemaBackwardsCompatible ? "Possible" : "Not possible"}
                    />
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Field
                      label="Release signature"
                      value={advanced.signed ? "Signed" : "Not signed — SHA-256 and image digest only"}
                    />
                  </Grid>
                </>
              )}
              {!advanced && showAdvanced && (
                <Grid item xs={12}>
                  <Typography variant="body2" color="text.secondary">
                    No candidate release has been retrieved yet, so there is nothing further to show.
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
