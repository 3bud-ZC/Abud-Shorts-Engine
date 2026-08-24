/**
 * CANONICAL STATUS VOCABULARY
 * ---------------------------
 * One set of words for the whole product. Before this, the same provider could
 * read "healthy" on System, "configured" on Providers and "OK" on the
 * dashboard; a customer cannot tell whether those mean the same thing.
 *
 * Status is never communicated by colour alone: every state carries a label,
 * and callers render the label next to the colour.
 */

export type AbudStatus =
  | "connected"
  | "ready"
  | "not_configured"
  | "needs_attention"
  | "unavailable";

export type StatusTone = "success" | "info" | "neutral" | "warning" | "danger";

export type StatusDescriptor = {
  id: AbudStatus;
  label: string;
  tone: StatusTone;
  /** Plain-language explanation for a non-technical operator. */
  description: string;
};

export const ABUD_STATUS: Record<AbudStatus, StatusDescriptor> = {
  connected: {
    id: "connected",
    label: "Connected",
    tone: "success",
    description: "Set up and verified against the live service.",
  },
  ready: {
    id: "ready",
    label: "Ready",
    tone: "info",
    description: "Available and ready to use.",
  },
  not_configured: {
    id: "not_configured",
    label: "Not Configured",
    tone: "neutral",
    description: "Optional. Add it when you want this capability.",
  },
  needs_attention: {
    id: "needs_attention",
    label: "Needs Attention",
    tone: "warning",
    description: "Set up, but the last check did not succeed.",
  },
  unavailable: {
    id: "unavailable",
    label: "Unavailable",
    tone: "danger",
    description: "Not reachable right now.",
  },
};

/**
 * Maps the many raw states the backend reports onto the five the customer
 * sees. Anything unrecognised becomes "Needs Attention" rather than being shown
 * as healthy - an unknown state is never presented as success.
 */
export function toAbudStatus(raw?: string | boolean | null): AbudStatus {
  if (raw === true) return "connected";
  if (raw === false || raw === null || raw === undefined) return "not_configured";

  const value = String(raw).toLowerCase().trim();
  if (!value) return "not_configured";

  if (
    ["connected", "live_verified", "verified", "authorized", "authorised", "linked"].includes(value)
  ) {
    return "connected";
  }
  if (["healthy", "ready", "ok", "configured", "available", "active", "pass", "operational"].includes(value)) {
    return "ready";
  }
  if (
    [
      "not_configured",
      "unconfigured",
      "missing",
      "disabled",
      "optional",
      "none",
      "not_connected",
      "skipped",
    ].includes(value)
  ) {
    return "not_configured";
  }
  if (
    [
      "degraded",
      "warning",
      "invalid_credentials",
      "missing_permissions",
      "rate_limited",
      "quota_exceeded",
      "expired",
      "voice_discovery_restricted",
      "plan_upgrade_required",
      "needs_attention",
      "error",
      "failed",
    ].includes(value)
  ) {
    return "needs_attention";
  }
  if (["unhealthy", "unavailable", "provider_unavailable", "offline", "timeout", "down"].includes(value)) {
    return "unavailable";
  }
  return "needs_attention";
}

export function statusDescriptor(raw?: string | boolean | null): StatusDescriptor {
  return ABUD_STATUS[toAbudStatus(raw)];
}

/** Cost/tier vocabulary shown on integration cards. */
export type CostTier = "free" | "local" | "cloud" | "usage_based";

export const COST_TIER_LABEL: Record<CostTier, string> = {
  free: "Free",
  local: "Local",
  cloud: "Cloud",
  usage_based: "Usage Based",
};
