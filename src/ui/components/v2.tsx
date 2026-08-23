import React from "react";
import {
  Alert,
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
  IconButton,
  InputAdornment,
  LinearProgress,
  Menu,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import SearchIcon from "@mui/icons-material/Search";

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
          <Typography variant="overline" color="text.secondary">
            {eyebrow}
          </Typography>
        )}
        <Typography variant="h4" component="h1" sx={{ lineHeight: 1.15 }}>
          {title}
        </Typography>
        {description && (
          <Typography color="text.secondary" sx={{ mt: 0.75, maxWidth: 760 }}>
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
    <Card variant="outlined" sx={{ borderRadius: 2 }}>
      {(title || description || actions) && (
        <>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            justifyContent="space-between"
            spacing={1.5}
            sx={{ px: 2.25, py: 1.75 }}
          >
            <Box>
              {title && <Typography variant="h6">{title}</Typography>}
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
      <CardContent sx={{ p: 2.25, "&:last-child": { pb: 2.25 } }}>
        {children}
      </CardContent>
    </Card>
  );
}

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
    <Card variant="outlined" sx={{ height: "100%", borderRadius: 2 }}>
      <CardContent>
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="h5" sx={{ mt: 1, wordBreak: "break-word" }}>
          {value}
        </Typography>
        {hint && (
          <Typography variant="caption" color="text.secondary">
            {hint}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

export function statusColor(status: string): "success" | "warning" | "error" | "info" | "default" {
  if (["ready", "healthy", "valid", "configured"].includes(status)) return "success";
  if (["degraded", "rate_limited", "timeout"].includes(status)) return "warning";
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
    ].includes(status)
  ) return "error";
  if (status === "canceled") return "default";
  return "info";
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <Chip
      size="small"
      label={label || status.replaceAll("_", " ")}
      color={statusColor(status)}
      sx={{ textTransform: "capitalize" }}
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

export function LoadingState({ label = "Loading..." }: { label?: string }) {
  return (
    <Stack alignItems="center" justifyContent="center" spacing={2} sx={{ minHeight: 260 }}>
      <CircularProgress size={28} />
      <Typography color="text.secondary">{label}</Typography>
    </Stack>
  );
}

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
        <Typography variant="h6">{title}</Typography>
        {description && (
          <Typography color="text.secondary" sx={{ maxWidth: 520 }}>
            {description}
          </Typography>
        )}
        {action}
      </Stack>
    </SectionCard>
  );
}

export function ErrorState({ message }: { message: string }) {
  return <Alert severity="error">{message}</Alert>;
}

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
      <DialogTitle>{title}</DialogTitle>
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
        <Tab key={option} value={option} label={option} sx={{ textTransform: "capitalize" }} />
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
  return (
    <Stack spacing={0.75}>
      <Stack direction="row" justifyContent="space-between" spacing={1}>
        <Typography variant="body2" fontWeight={700}>
          {stage}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {progress}%
        </Typography>
      </Stack>
      <LinearProgress variant="determinate" value={progress} />
      <Typography variant="caption" color="text.secondary">
        {message || "Waiting for the next job event."}
        {timestamp ? ` · ${new Date(timestamp).toLocaleString()}` : ""}
      </Typography>
    </Stack>
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
