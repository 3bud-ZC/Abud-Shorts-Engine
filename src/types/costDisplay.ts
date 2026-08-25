/**
 * COST PRESENTATION
 * -----------------
 * One place decides how an estimate is shown, so no screen can render
 * `$undefined`, `$NaN` or `$null` as a monetary value.
 *
 * A usage-based provider such as ElevenLabs bills against the customer's own
 * plan credits. There is no dollar figure the engine can compute honestly, so
 * those productions are labelled "Usage Based" rather than given an invented
 * number or a misleading $0.
 */

export type CostBreakdownVoice = {
  provider?: string;
  usageBased?: boolean;
  estimatedCostTier?: string;
  costLabel?: string;
};

export type CostEstimateLike = {
  estimatedCost?: unknown;
  currency?: string;
  isFree?: boolean;
  usageBased?: boolean;
  costLabel?: string;
  breakdown?: { voice?: CostBreakdownVoice };
} | null | undefined;

/** True only for a real, finite number. Rejects undefined/null/NaN/Infinity/"". */
export function isDisplayableAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** True when the production bills against a provider plan rather than a price. */
export function isUsageBasedCost(cost: CostEstimateLike): boolean {
  if (!cost) return false;
  const voice = cost.breakdown?.voice;
  return Boolean(
    cost.usageBased ||
      voice?.usageBased ||
      voice?.estimatedCostTier === "premium" ||
      voice?.estimatedCostTier === "cloud_free_tier",
  );
}

/**
 * A production is only "free" when it is genuinely $0 AND nothing on it bills
 * by usage. An ElevenLabs job is never free just because no dollar amount was
 * computed for it.
 */
export function isFreeCost(cost: CostEstimateLike): boolean {
  if (!cost) return false;
  if (isUsageBasedCost(cost)) return false;
  if (cost.isFree === true) return true;
  return isDisplayableAmount(cost.estimatedCost) && cost.estimatedCost === 0;
}

export function providerDisplayName(provider?: string): string {
  if (!provider) return "Cloud provider";
  if (provider === "elevenlabs") return "ElevenLabs";
  if (provider === "google_cloud_tts") return "Google Cloud TTS";
  if (provider === "edge_tts") return "Edge TTS";
  return provider;
}

/**
 * The label shown on Video Details. Never interpolates an unvalidated value
 * into a currency string.
 */
export function videoCostLabel(cost: CostEstimateLike): string {
  if (!cost) return "Not estimated";
  if (isUsageBasedCost(cost)) {
    return `${providerDisplayName(cost.breakdown?.voice?.provider)} · Usage Based`;
  }
  if (cost.isFree === true) return "Free ($0)";
  if (!isDisplayableAmount(cost.estimatedCost)) return "Not estimated";
  if (cost.estimatedCost === 0) return "Free ($0)";
  const currency = cost.currency || "USD";
  return `$${cost.estimatedCost.toFixed(2)} ${currency}`;
}

/** The longer label used on the Create Video preview panel. */
export function externalCostLabel(cost: CostEstimateLike): string {
  if (!cost) return "External API Cost: Not estimated";
  if (isUsageBasedCost(cost)) {
    return `External API Cost: ${providerDisplayName(cost.breakdown?.voice?.provider)} · Cloud / Usage Based`;
  }
  if (cost.isFree === true || cost.estimatedCost === 0) {
    return "External API Cost: $0 (local pipeline)";
  }
  if (!isDisplayableAmount(cost.estimatedCost)) return "External API Cost: Not estimated";
  return `External API Cost: $${cost.estimatedCost.toFixed(2)} ${cost.currency || "USD"}`;
}
