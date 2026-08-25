/**
 * CANONICAL INTEGRATION CONNECTION STATE
 * --------------------------------------
 * One model for "how connected is this integration", shared by the Integrations
 * page, System Health, the publishing pre-flight and the scheduler.
 *
 * Before F3 the engine collapsed several genuinely different facts into a single
 * health badge, so a provider whose code was finished and whose app credentials
 * were saved could read as "Ready" while no customer account was connected to it
 * at all. Publishing then failed at the last step with a generic error.
 *
 * Four facts are tracked independently and never merged:
 *
 *   implemented   - this engine really has the code path
 *   configured    - the application-level credential exists (API key, OAuth app)
 *   authenticated - a customer account is actually connected
 *   liveVerified  - a real call to the provider succeeded recently
 *
 * The seven states below are derived from those four plus any external blocker.
 * Deriving rather than storing means the badge can never drift from the facts.
 */

export type IntegrationConnectionState =
  /** Nothing configured. Nothing to test. */
  | "NOT_CONFIGURED"
  /** Application credential present; nothing account-level is needed. */
  | "CONFIGURED"
  /** App credential present, but the customer still has to connect an account. */
  | "AUTHORIZATION_REQUIRED"
  /** An account is connected and usable. */
  | "CONNECTED"
  /** Connected but something is wrong the customer can fix. */
  | "NEEDS_ATTENTION"
  /** Token expired and could not be refreshed; reconnect required. */
  | "EXPIRED"
  /** Blocked by something outside the customer's control (provider down, app review). */
  | "UNAVAILABLE";

/** How the customer is expected to connect this integration. */
export type IntegrationKind =
  /** A single API key or token. Configured means usable. */
  | "api_key"
  /** An OAuth app plus a per-customer account authorization. */
  | "oauth_account"
  /** A bot token plus a destination chat. */
  | "bot_account"
  /** Runs locally; nothing to configure. */
  | "builtin";

export type IntegrationFacts = {
  /** The engine has a real code path for this provider. */
  implemented: boolean;
  /** Application-level credential is present (vault or installation env). */
  configured: boolean;
  /** A customer account is connected. Only meaningful for account-based kinds. */
  authenticated: boolean;
  /** A real provider call succeeded. Never inferred from configuration alone. */
  liveVerified: boolean;
  /** Set when the account exists but its token could not be refreshed. */
  tokenExpired?: boolean;
  /** Set when the provider itself is failing or unreachable. */
  providerUnavailable?: boolean;
  /**
   * Set when the blocker is external approval - Meta App Review, an unaudited
   * TikTok client. This is not a defect in the engine and must not read as one.
   */
  externalApprovalRequired?: boolean;
  /** Set when a connected account is missing a scope the feature needs. */
  missingScopes?: string[];
};

export type IntegrationStatusView = {
  state: IntegrationConnectionState;
  /** Short label for the badge. Customer-facing wording. */
  label: string;
  /** One sentence explaining the state and, where relevant, the next step. */
  detail: string;
  /** The four facts, always reported separately. */
  facts: Required<Pick<IntegrationFacts, "implemented" | "configured" | "authenticated" | "liveVerified">>;
  /** The single action the customer should take next, if any. */
  nextAction?: IntegrationAction;
  /** True when the state should count against overall system health. */
  blocksHealth: boolean;
};

export type IntegrationAction =
  | "configure"
  | "replace"
  | "test_connection"
  | "connect_account"
  | "reconnect"
  | "disconnect"
  | "await_external_approval";

/**
 * Derives the state.
 *
 * Order matters: an unimplemented provider can never be "Ready to Connect", and
 * an external approval blocker outranks a local one because no amount of
 * customer configuration will clear it.
 */
export function deriveConnectionState(
  kind: IntegrationKind,
  facts: IntegrationFacts,
): IntegrationStatusView {
  const base = {
    facts: {
      implemented: facts.implemented,
      configured: facts.configured,
      authenticated: facts.authenticated,
      liveVerified: facts.liveVerified,
    },
  };

  if (!facts.implemented) {
    return {
      ...base,
      state: "UNAVAILABLE",
      label: "Not Available",
      detail: "This integration is not implemented in this build.",
      blocksHealth: false,
    };
  }

  if (kind === "builtin") {
    return {
      ...base,
      state: "CONNECTED",
      label: "Built In",
      detail: "Runs on this machine. Nothing to configure.",
      blocksHealth: false,
    };
  }

  if (facts.providerUnavailable) {
    return {
      ...base,
      state: "UNAVAILABLE",
      label: "Provider Unavailable",
      detail: "The provider could not be reached. This is outside ABUD Shorts.",
      nextAction: "test_connection",
      blocksHealth: false,
    };
  }

  if (!facts.configured) {
    return {
      ...base,
      state: "NOT_CONFIGURED",
      label: "Not Configured",
      detail:
        kind === "oauth_account"
          ? "Add the application credentials for this provider to start connecting accounts."
          : "Add this provider's credentials to enable it.",
      nextAction: "configure",
      blocksHealth: false,
    };
  }

  // An API key provider needs nothing else; the key IS the connection.
  if (kind === "api_key") {
    if (facts.tokenExpired) {
      return {
        ...base,
        state: "EXPIRED",
        label: "Key Rejected",
        detail: "The provider rejected the stored key. Replace it to continue.",
        nextAction: "replace",
        blocksHealth: true,
      };
    }
    return {
      ...base,
      state: "CONFIGURED",
      label: facts.liveVerified ? "Connected" : "Configured",
      detail: facts.liveVerified
        ? "Verified against the provider."
        : "Saved. Run Test Connection to verify it against the provider.",
      nextAction: "test_connection",
      blocksHealth: false,
    };
  }

  // Account-based providers: configuration is only half the story.
  if (!facts.authenticated) {
    if (facts.externalApprovalRequired) {
      return {
        ...base,
        state: "UNAVAILABLE",
        label: "External Approval Required",
        detail:
          "The provider must approve this application before accounts can be connected. " +
          "The integration itself is complete.",
        nextAction: "await_external_approval",
        blocksHealth: false,
      };
    }
    return {
      ...base,
      state: "AUTHORIZATION_REQUIRED",
      label: "Ready to Connect",
      detail: "Application credentials are set. Connect an account to publish.",
      nextAction: "connect_account",
      blocksHealth: false,
    };
  }

  if (facts.tokenExpired) {
    return {
      ...base,
      state: "EXPIRED",
      label: "Reconnect Required",
      detail: "The connection expired and could not be renewed automatically.",
      nextAction: "reconnect",
      blocksHealth: true,
    };
  }

  if (facts.missingScopes && facts.missingScopes.length > 0) {
    return {
      ...base,
      state: "NEEDS_ATTENTION",
      label: "Permission Missing",
      detail: `Reconnect and allow: ${facts.missingScopes.join(", ")}.`,
      nextAction: "reconnect",
      blocksHealth: true,
    };
  }

  if (facts.externalApprovalRequired) {
    return {
      ...base,
      state: "NEEDS_ATTENTION",
      label: "External Approval Required",
      detail:
        "The account is connected, but the provider has not approved this application for " +
        "public publishing yet.",
      nextAction: "await_external_approval",
      blocksHealth: false,
    };
  }

  return {
    ...base,
    state: "CONNECTED",
    label: "Connected",
    detail: facts.liveVerified
      ? "Account connected and verified."
      : "Account connected. Run Test Connection to verify it against the provider.",
    nextAction: "test_connection",
    blocksHealth: false,
  };
}

/**
 * Publishing readiness for one platform.
 *
 * Separate from the integration badge on purpose: an OAuth app being configured
 * says nothing about whether a channel is connected, and reporting YouTube
 * publishing as healthy on the strength of app credentials alone is exactly the
 * misleading green badge this model exists to prevent.
 */
export function canPublish(view: IntegrationStatusView, kind: IntegrationKind): boolean {
  if (kind === "api_key") return view.state === "CONFIGURED" || view.state === "CONNECTED";
  return view.state === "CONNECTED";
}
