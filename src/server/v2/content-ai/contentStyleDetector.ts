import type { ContentStyle } from "../../../types/productionSpec";

/**
 * Auto-detects whether a prompt-only production reads as an advertisement or
 * a curiosity/explainer piece, when the caller supplied no explicit
 * `contentStyle`.
 *
 * `/api/v2/production/jobs` (productionJobSchema in types.ts) has no
 * `contentStyle` field at all - a customer typing a prompt into the simple
 * "Automatic" flow has no UI control for this (V2.4 Pass 5, section 3: "The
 * customer should not need to know model implementation details"), so
 * `generateProductionSpec` defaulted every prompt-only job to
 * "advertisement" regardless of what it actually asked for. That is why a
 * genuine curiosity prompt ("why are airplane windows rounded?") still
 * routed to ad-flavored generic scenes even before the deeper fact-pack gap.
 */
const CURIOSITY_MARKERS = [
  /\bwhy (do|does|are|is)\b/i,
  /\bhow (do|does)\b/i,
  /\bdid you know\b/i,
  /\bcuriosity\b/i,
  /\bexplain(ing|er)?\b/i,
  /\bfact(s)? about\b/i,
  /\bthe science (of|behind)\b/i,
  /\bever wonder(ed)?\b/i,
  /ازاي|ليه|هل تعرف|تعرف ان/,
];

const ADVERTISEMENT_MARKERS = [
  /\bcta\b/i,
  /\bcall to action\b/i,
  /\bbusiness\b/i,
  /\badvertisement\b|\bad for\b/i,
  /\bpromote|\bpromo\b/i,
  /\bshop\b|\bstore\b/i,
  /\bservice(s)?\b/i,
  /\bbook (your|a)\b/i,
  /\bsign\s*up\b/i,
  /\border now\b/i,
  /إعلان|متجر|خدمة/,
];

/**
 * Returns null when the signal isn't clear enough to override the caller's
 * own default - callers keep whatever `contentStyle` they already resolved
 * (usually "advertisement") rather than being forced one way on a coin flip.
 */
export function detectContentStyle(prompt: string): ContentStyle | null {
  const curiosityScore = CURIOSITY_MARKERS.reduce((sum, re) => sum + (re.test(prompt) ? 1 : 0), 0);
  const adScore = ADVERTISEMENT_MARKERS.reduce((sum, re) => sum + (re.test(prompt) ? 1 : 0), 0);
  if (curiosityScore > 0 && curiosityScore > adScore) return "viral_curiosity";
  return null;
}
