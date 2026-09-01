export type ProviderBillingClass =
  | "LOCAL_FREE"
  | "FREE_API"
  | "FREE_TIER"
  | "USAGE_BASED"
  | "SUBSCRIPTION"
  | "UNKNOWN";

export type ProviderLatencyClass = "instant" | "interactive" | "short" | "long" | "offline" | "unknown";
export type ProviderQualityClass = "baseline" | "standard" | "professional" | "premium" | "unknown";

export type ProviderCustomerStatus =
  | "Built In"
  | "Ready"
  | "Configured"
  | "Ready to Connect"
  | "Not Configured"
  | "Needs Attention"
  | "Temporarily Unavailable"
  | "Disabled";

export type CanonicalProviderCategory =
  | "Content AI"
  | "Stock Video"
  | "Generated Video"
  | "Local Generated Video"
  | "Voice"
  | "Captions"
  | "Publishing"
  | "Renderer"
  | "Infrastructure";

export type CanonicalProviderStateInput = {
  id: string;
  name: string;
  category: CanonicalProviderCategory | string;
  implemented?: boolean;
  configured?: boolean;
  authenticated?: boolean | null;
  healthy?: boolean | null;
  liveVerified?: boolean | null;
  enabled?: boolean;
  billingClass?: ProviderBillingClass;
  capabilities?: string[];
  latencyClass?: ProviderLatencyClass;
  qualityClass?: ProviderQualityClass;
  lastVerifiedAt?: string;
  blockerReason?: string;
  optional?: boolean;
  builtIn?: boolean;
};

export type CanonicalProviderState = Required<
  Pick<
    CanonicalProviderStateInput,
    "id" | "name" | "implemented" | "configured" | "enabled" | "billingClass" | "latencyClass" | "qualityClass"
  >
> & {
  category: string;
  authenticated: boolean | null;
  healthy: boolean | null;
  liveVerified: boolean | null;
  capabilities: string[];
  lastVerifiedAt?: string;
  customerStatus: ProviderCustomerStatus;
  blockerReason?: string;
};

export function normalizeProviderServiceState(input: CanonicalProviderStateInput): CanonicalProviderState {
  const implemented = input.implemented !== false;
  const configured = input.configured === true;
  const enabled = input.enabled !== false;
  const authenticated = input.authenticated ?? null;
  const healthy = input.healthy ?? null;
  const liveVerified = input.liveVerified ?? null;
  const billingClass = input.billingClass || "UNKNOWN";
  const builtIn = input.builtIn || billingClass === "LOCAL_FREE";
  const blockerReason = input.blockerReason;

  let customerStatus: ProviderCustomerStatus;
  if (!enabled) {
    customerStatus = "Disabled";
  } else if (builtIn && implemented && configured && (healthy !== false)) {
    customerStatus = "Built In";
  } else if (!implemented) {
    customerStatus = "Ready to Connect";
  } else if (!configured) {
    customerStatus = input.optional === false ? "Not Configured" : "Ready to Connect";
  } else if (authenticated === false || blockerReason) {
    customerStatus = "Needs Attention";
  } else if (healthy === false) {
    customerStatus = "Temporarily Unavailable";
  } else if (liveVerified === true) {
    customerStatus = "Ready";
  } else {
    customerStatus = "Configured";
  }

  return {
    id: input.id,
    name: input.name,
    category: input.category,
    implemented,
    configured,
    authenticated,
    healthy,
    liveVerified,
    enabled,
    billingClass,
    capabilities: input.capabilities || [],
    latencyClass: input.latencyClass || "unknown",
    qualityClass: input.qualityClass || "unknown",
    lastVerifiedAt: input.lastVerifiedAt,
    customerStatus,
    blockerReason,
  };
}

export function statusFromCanonicalProvider(state: CanonicalProviderState): string {
  if (state.customerStatus === "Built In" || state.customerStatus === "Ready") return "healthy";
  if (state.customerStatus === "Configured") return "configured";
  if (state.customerStatus === "Temporarily Unavailable") return "provider_unavailable";
  if (state.customerStatus === "Needs Attention") return "needs_attention";
  if (state.customerStatus === "Disabled") return "disabled";
  return "not_configured";
}

export function tierFromBillingClass(billingClass: ProviderBillingClass): string {
  switch (billingClass) {
    case "LOCAL_FREE":
      return "local";
    case "FREE_API":
      return "free_api";
    case "FREE_TIER":
      return "free_tier";
    case "USAGE_BASED":
      return "usage_based";
    case "SUBSCRIPTION":
      return "subscription";
    default:
      return "unknown";
  }
}
