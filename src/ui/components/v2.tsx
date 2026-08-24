import React, { Component, ErrorInfo, ReactNode } from "react";
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  IconButton,
  InputAdornment,
  LinearProgress,
  Menu,
  MenuItem,
  Skeleton,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import SearchIcon from "@mui/icons-material/Search";
import RefreshIcon from "@mui/icons-material/Refresh";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";

// ============================================================================
// CONTENT-AWARE BIDIRECTIONAL (RTL/LTR) HELPERS
// ============================================================================

export function isArabicText(text?: string): boolean {
  if (!text) return false;
  const arabicPattern = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  return arabicPattern.test(text);
}

export function bidiProps(text?: string) {
  const isAr = isArabicText(text);
  return {
    dir: isAr ? ("rtl" as const) : ("ltr" as const),
    style: isAr
      ? {
          textAlign: "right" as const,
          fontFamily: '"Cairo", "Segoe UI", Tahoma, Arial, sans-serif',
          lineHeight: 1.4,
        }
      : {},
  };
}

// ============================================================================
// CENTRALIZED JOB STATUS & STAGE LABELS
// ============================================================================

export const JOB_STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  all: "All",
  active: "Active",
  planning: "Planning Creative",
  preparing: "Preparing",
  generating_content: "Planning Creative",
  searching_assets: "Finding Visuals",
  collecting_media: "Collecting Media",
  generating_voice: "Synthesizing Voice",
  generating_captions: "Generating Captions",
  rendering: "Rendering Video",
  finalizing: "Finalizing",
  validating: "Validating Output",
  ready: "Completed",
  failed: "Failed",
  canceled: "Canceled",
  invalid_credentials: "Invalid Credentials",
  missing_permissions: "Missing Permissions",
  voice_discovery_restricted: "Voice Discovery Restricted",
  provider_unavailable: "Provider Unavailable",
  not_configured: "Not Configured",
  live_verified: "Live Verified",
};

export const STAGE_LABELS: Record<string, string> = {
  Queued: "Queued in Pipeline",
  "Planning Creative": "Creative Script Planning",
  "Collecting Media": "Fetching Visual Assets",
  "Generating Voice": "Neural Voice Synthesis",
  "Generating Captions": "Caption Timing",
  "Rendering Video": "Remotion Composition",
  Validating: "FFmpeg Quality Validation",
  Ready: "Production Complete",
  Failed: "Job Interrupted / Failed",
  Canceled: "Job Canceled",
};

export function getJobStatusLabel(status: string): string {
  if (!status) return "Unknown";
  return JOB_STATUS_LABELS[status] || status.replaceAll("_", " ");
}

export function getStageLabel(stage: string): string {
  if (!stage) return "Processing";
  return STAGE_LABELS[stage] || stage;
}

// ============================================================================
// REACT ERROR BOUNDARY
// ============================================================================

interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    console.error("UI ErrorBoundary caught error:", error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 800, mx: "auto", my: 4 }}>
          <Card variant="outlined" sx={{ borderRadius: 3, border: "1px solid", borderColor: "error.light", bgcolor: "#fff5f5" }}>
            <CardContent sx={{ p: 3 }}>
              <Stack spacing={2} alignItems="flex-start">
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <ErrorOutlineIcon color="error" sx={{ fontSize: 32 }} />
                  <Typography variant="h5" fontWeight={800} color="error.main">
                    {this.props.fallbackTitle || "Something went wrong rendering this page"}
                  </Typography>
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  An unexpected UI error occurred while displaying content. Your video data and server operations are unaffected.
                </Typography>
                {this.state.error && (
                  <Alert severity="error" sx={{ width: "100%", wordBreak: "break-word" }}>
                    <AlertTitle fontWeight={700}>Error Detail</AlertTitle>
                    {this.state.error.message || String(this.state.error)}
                  </Alert>
                )}
                <Stack direction="row" spacing={1.5}>
                  <Button variant="contained" color="primary" startIcon={<RefreshIcon />} onClick={this.handleReset}>
                    Reload Page
                  </Button>
                  <Button variant="outlined" onClick={() => (window.location.href = "/")}>
                    Go to Dashboard
                  </Button>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        </Box>
      );
    }
    return this.props.children;
  }
}

// ============================================================================
// PAGE HEADER
// ============================================================================

export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
}: {
  title: string;
  eyebrow?: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      justifyContent="space-between"
      alignItems={{ xs: "stretch", sm: "flex-start" }}
      spacing={2}
      sx={{ mb: 3 }}
    >
      <Box minWidth={0}>
        {eyebrow && (
          <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: "0.08em", fontWeight: 700 }}>
            {eyebrow}
          </Typography>
        )}
        <Typography variant="h4" component="h1" sx={{ lineHeight: 1.15, fontWeight: 850 }}>
          {title}
        </Typography>
        {description && (
          <Typography color="text.secondary" sx={{ mt: 0.75, maxWidth: 760, fontSize: "0.95rem" }}>
            {description}
          </Typography>
        )}
      </Box>
      {actions && (
        <Stack direction="row" spacing={1} justifyContent="flex-end" flexWrap="wrap">
          {actions}
        </Stack>
      )}
    </Stack>
  );
}

// ============================================================================
// SECTION CARD
// ============================================================================

export function SectionCard({
  title,
  description,
  actions,
  children,
}: {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card variant="outlined" sx={{ borderRadius: 2, bgcolor: "#ffffff" }}>
      {(title || description || actions) && (
        <>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            justifyContent="space-between"
            alignItems={{ xs: "flex-start", sm: "center" }}
            spacing={1.5}
            sx={{ px: 2.5, py: 1.75 }}
          >
            <Box>
              {title && <Typography variant="h6" fontWeight={800}>{title}</Typography>}
              {description && (
                <Typography variant="body2" color="text.secondary">
                  {description}
                </Typography>
              )}
            </Box>
            {actions}
          </Stack>
          <Divider />
        </>
      )}
      <CardContent sx={{ p: 2.5, "&:last-child": { pb: 2.5 } }}>
        {children}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// STANDARDIZED STAT CARD
// ============================================================================

export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <Card
      variant="outlined"
      sx={{
        height: "100%",
        minHeight: 110,
        borderRadius: 2,
        bgcolor: "#ffffff",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        transition: "box-shadow 0.15s ease",
        "&:hover": {
          boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
        },
      }}
    >
      <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
        <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {label}
        </Typography>
        <Typography variant="h4" fontWeight={850} color="primary.main" sx={{ my: 0.5, wordBreak: "break-word" }}>
          {value}
        </Typography>
        {hint ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            {hint}
          </Typography>
        ) : (
          <Box sx={{ height: 16 }} />
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// STATUS COLORS & BADGE
// ============================================================================

export function statusColor(status: string): "success" | "warning" | "error" | "info" | "default" {
  if (!status) return "default";
  const s = status.toLowerCase();
  if (["ready", "healthy", "valid", "configured", "completed", "live_verified"].includes(s)) return "success";
  if (
    [
      "degraded",
      "rate_limited",
      "timeout",
      "planning",
      "rendering",
      "generating_voice",
      "generating_captions",
      "collecting_media",
      "missing_permissions",
      "voice_discovery_restricted",
    ].includes(s)
  ) return "warning";
  if (
    [
      "failed",
      "unhealthy",
      "invalid",
      "invalid_credentials",
      "missing",
      "not_configured",
      "unavailable",
      "provider_unavailable",
    ].includes(s)
  ) return "error";
  if (["canceled", "cancelled", "default"].includes(s)) return "default";
  return "info";
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const displayLabel = label || getJobStatusLabel(status);
  return (
    <Chip
      size="small"
      label={displayLabel}
      color={statusColor(status)}
      sx={{ fontWeight: 700, textTransform: "capitalize", px: 0.5 }}
    />
  );
}

export function ProviderStatus({
  name,
  category,
  status,
  message,
}: {
  name: string;
  category: string;
  status: string;
  message: string;
}) {
  return (
    <SectionCard>
      <Stack spacing={1.25}>
        <Stack direction="row" justifyContent="space-between" spacing={1}>
          <Box>
            <Typography variant="subtitle1" fontWeight={800}>
              {name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {category}
            </Typography>
          </Box>
          <StatusBadge status={status} />
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {message}
        </Typography>
      </Stack>
    </SectionCard>
  );
}

// ============================================================================
// PROGRESS DISPLAY
// ============================================================================

export function ProgressDisplay({
  stage,
  progress,
  timestamp,
  message,
}: {
  stage: string;
  progress: number;
  timestamp?: string;
  message?: string;
}) {
  const isArabicMsg = isArabicText(message);
  return (
    <Stack spacing={0.75}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
        <Typography variant="body2" fontWeight={800}>
          {getStageLabel(stage)}
        </Typography>
        <Typography variant="body2" fontWeight={800} color="primary.main">
          {progress}%
        </Typography>
      </Stack>
      <LinearProgress
        variant="determinate"
        value={Math.min(100, Math.max(0, progress))}
        sx={{ height: 6, borderRadius: 3 }}
      />
      <Typography
        variant="caption"
        color="text.secondary"
        dir={isArabicMsg ? "rtl" : "ltr"}
        sx={{ textAlign: isArabicMsg ? "right" : "left" }}
      >
        {message || "Waiting for orchestration event."}
        {timestamp ? ` · ${new Date(timestamp).toLocaleTimeString()}` : ""}
      </Typography>
    </Stack>
  );
}

// ============================================================================
// REDESIGNED RECENT JOB CARD
// ============================================================================

export function RecentJobCard({
  job,
  onClick,
}: {
  job: {
    id: string;
    title?: string;
    templateId?: string;
    brandName?: string;
    status: string;
    progress: number;
    currentStage: string;
    creationMode?: string;
    createdAt: string;
    updatedAt: string;
    error?: string | null;
  };
  onClick?: () => void;
}) {
  const isArabicTitle = isArabicText(job.title);
  const displayTitle = job.title || job.templateId || "Video Job";

  return (
    <Card
      variant="outlined"
      onClick={onClick}
      sx={{
        borderRadius: 2,
        cursor: onClick ? "pointer" : "default",
        transition: "all 0.15s ease",
        borderColor: "rgba(31, 41, 51, 0.12)",
        "&:hover": onClick
          ? {
              boxShadow: "0 3px 12px rgba(0,0,0,0.06)",
              borderColor: "primary.main",
              bgcolor: "rgba(36, 84, 90, 0.02)",
            }
          : {},
      }}
    >
      <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
        <Stack spacing={1.5}>
          {/* Header Row: Title on Left/RTL, Status Badge on Right */}
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1.5}>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography
                variant="subtitle1"
                fontWeight={800}
                dir={isArabicTitle ? "rtl" : "ltr"}
                sx={{
                  textAlign: isArabicTitle ? "right" : "left",
                  wordBreak: "break-word",
                  lineHeight: 1.3,
                  fontFamily: isArabicTitle ? '"Cairo", "Segoe UI", Tahoma, Arial, sans-serif' : 'inherit',
                }}
              >
                {displayTitle}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25 }}>
                {job.creationMode === "prompt" ? "Prompt Studio" : (job.templateId || "Template")}
                {job.brandName ? ` · ${job.brandName}` : ""}
                {` · ${new Date(job.createdAt).toLocaleDateString()} ${new Date(job.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
              </Typography>
            </Box>
            <StatusBadge status={job.status} />
          </Stack>

          {/* Progress Section: Stage & Percentage */}
          <Stack spacing={0.5}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography variant="caption" fontWeight={700} color="text.secondary">
                {getStageLabel(job.currentStage)}
              </Typography>
              <Typography variant="caption" fontWeight={800} color="primary.main">
                {job.progress}%
              </Typography>
            </Stack>
            <LinearProgress
              variant="determinate"
              value={Math.min(100, Math.max(0, job.progress))}
              color={job.status === "failed" ? "error" : "primary"}
              sx={{ height: 5, borderRadius: 3 }}
            />
          </Stack>

          {/* Footer: Latest update/error */}
          {job.error && (
            <Typography variant="caption" color="error.main" sx={{ display: "block", wordBreak: "break-word" }}>
              Issue: {job.error}
            </Typography>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// SKELETONS & LOADING STATES
// ============================================================================

export function LoadingState({ label = "Loading..." }: { label?: string }) {
  return (
    <Stack alignItems="center" justifyContent="center" spacing={2} sx={{ minHeight: 260 }}>
      <CircularProgress size={28} />
      <Typography color="text.secondary" fontWeight={500}>{label}</Typography>
    </Stack>
  );
}

export function DashboardSkeleton() {
  return (
    <Stack spacing={3}>
      <Stack spacing={1}>
        <Skeleton variant="text" width={220} height={36} />
        <Skeleton variant="text" width={380} height={20} />
      </Stack>
      <Grid container spacing={2}>
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Grid item xs={12} sm={6} md={4} lg={2} key={i}>
            <Skeleton variant="rectangular" height={100} sx={{ borderRadius: 2 }} />
          </Grid>
        ))}
      </Grid>
      <Grid container spacing={2}>
        <Grid item xs={12} lg={8}>
          <Skeleton variant="rectangular" height={400} sx={{ borderRadius: 2 }} />
        </Grid>
        <Grid item xs={12} lg={4}>
          <Skeleton variant="rectangular" height={400} sx={{ borderRadius: 2 }} />
        </Grid>
      </Grid>
    </Stack>
  );
}

export function JobDetailsSkeleton() {
  return (
    <Stack spacing={3}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Box>
          <Skeleton variant="text" width={300} height={40} />
          <Skeleton variant="text" width={200} height={20} />
        </Box>
        <Skeleton variant="rectangular" width={120} height={36} sx={{ borderRadius: 1 }} />
      </Stack>
      <Grid container spacing={2}>
        <Grid item xs={12} lg={7}>
          <Stack spacing={2}>
            <Skeleton variant="rectangular" height={160} sx={{ borderRadius: 2 }} />
            <Skeleton variant="rectangular" height={220} sx={{ borderRadius: 2 }} />
          </Stack>
        </Grid>
        <Grid item xs={12} lg={5}>
          <Stack spacing={2}>
            <Skeleton variant="rectangular" height={280} sx={{ borderRadius: 2 }} />
            <Skeleton variant="rectangular" height={100} sx={{ borderRadius: 2 }} />
          </Stack>
        </Grid>
      </Grid>
    </Stack>
  );
}

export function JobsListSkeleton() {
  return (
    <Stack spacing={2}>
      <Skeleton variant="text" width={200} height={36} />
      <Skeleton variant="rectangular" height={60} sx={{ borderRadius: 2 }} />
      {[1, 2, 3, 4].map((i) => (
        <Skeleton key={i} variant="rectangular" height={120} sx={{ borderRadius: 2 }} />
      ))}
    </Stack>
  );
}

// ============================================================================
// EMPTY & ERROR STATES
// ============================================================================

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <SectionCard>
      <Stack alignItems="center" textAlign="center" spacing={1.5} sx={{ py: 4 }}>
        <Typography variant="h6" fontWeight={800}>{title}</Typography>
        {description && (
          <Typography color="text.secondary" sx={{ maxWidth: 520, fontSize: "0.9rem" }}>
            {description}
          </Typography>
        )}
        {action && <Box sx={{ mt: 1 }}>{action}</Box>}
      </Stack>
    </SectionCard>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Alert
      severity="error"
      action={
        onRetry && (
          <Button color="inherit" size="small" onClick={onRetry}>
            Retry
          </Button>
        )
      }
    >
      {message}
    </Alert>
  );
}

// ============================================================================
// DIALOGS & INPUTS
// ============================================================================

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle fontWeight={800}>{title}</DialogTitle>
      <DialogContent>
        <Typography color="text.secondary">{description}</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" color="error" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <TextField
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      size="small"
      fullWidth
      InputProps={{
        startAdornment: (
          <InputAdornment position="start">
            <SearchIcon fontSize="small" />
          </InputAdornment>
        ),
      }}
    />
  );
}

export function FilterTabs({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <Tabs value={value} onChange={(_, next) => onChange(next)} variant="scrollable" allowScrollButtonsMobile>
      {options.map((option) => (
        <Tab key={option} value={option} label={getJobStatusLabel(option)} sx={{ textTransform: "capitalize", fontWeight: 700 }} />
      ))}
    </Tabs>
  );
}

export function ActionMenu({
  items,
}: {
  items: Array<{ label: string; onClick: () => void; disabled?: boolean }>;
}) {
  const [anchor, setAnchor] = React.useState<null | HTMLElement>(null);
  return (
    <>
      <IconButton aria-label="More actions" onClick={(event) => setAnchor(event.currentTarget)}>
        <MoreVertIcon />
      </IconButton>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {items.map((item) => (
          <MenuItem
            key={item.label}
            disabled={item.disabled}
            onClick={() => {
              setAnchor(null);
              item.onClick();
            }}
          >
            {item.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <SectionCard title={title} description={description}>
      {children}
    </SectionCard>
  );
}
