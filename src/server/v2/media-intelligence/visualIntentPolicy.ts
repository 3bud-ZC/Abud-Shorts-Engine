/**
 * VISUAL INTENT POLICY
 * --------------------
 * "Modern website" does not mean a screen full of PHP.
 *
 * The rejected V2.2 acceptance video illustrated a website-design advertisement
 * with generic programming footage, because the planner emitted search terms
 * like "web developer coding". Code footage is legitimate only when the
 * narration is actually about development work; for an ad about *having* a good
 * website it reads as dated and off-message.
 *
 * This rewrites the search terms before they reach any stock provider.
 */

/** Terms that reliably return code editors, terminals and IDE screens. */
const CODE_FOOTAGE_TERMS = [
  "coding",
  "code",
  "programming",
  "programmer",
  "developer coding",
  "web developer",
  "software developer",
  "source code",
  "html",
  "css",
  "javascript",
  "keyboard typing code",
  "hacker",
  "terminal",
  "ide",
];

/** Narration that genuinely is about engineering work. */
const ENGINEERING_INTENT = [
  "برمجة",
  "مبرمج",
  "كود",
  "باك اند",
  "backend",
  "back-end",
  "api",
  "database",
  "قاعدة بيانات",
  "development team",
  "engineering",
  "developer",
];

/**
 * Replacements that keep the semantic slot but show the *product* rather than
 * the act of building it.
 */
const WEBSITE_AD_REPLACEMENTS = [
  "modern website on laptop screen",
  "responsive website mobile and desktop",
  "ecommerce website browsing",
  "small business owner smartphone",
  "online store checkout phone",
  "business team reviewing website",
  "customer shopping online phone",
  "digital marketing analytics screen",
];

export function looksLikeCodeFootageTerm(term: string): boolean {
  const lower = term.toLowerCase();
  return CODE_FOOTAGE_TERMS.some((banned) => lower.includes(banned));
}

/** True when the narration is genuinely about building software. */
export function narrationIsEngineering(narration?: string): boolean {
  if (!narration) return false;
  const lower = narration.toLowerCase();
  return ENGINEERING_INTENT.some((token) => lower.includes(token));
}

export type IntentPolicyResult = {
  terms: string[];
  removed: string[];
  substituted: string[];
  applied: boolean;
};

/**
 * Filters code-shop footage out of a website/design advertisement.
 *
 * Only applies when the production is a website ad AND this particular scene's
 * narration is not about engineering. Everything else passes through untouched,
 * so a genuine "we build backends" scene can still show code.
 */
export function applyVisualIntentPolicy(input: {
  terms: string[];
  narration?: string;
  isWebsiteAd: boolean;
  sceneIndex?: number;
}): IntentPolicyResult {
  const terms = (input.terms || []).filter(Boolean);
  if (!input.isWebsiteAd || narrationIsEngineering(input.narration)) {
    return { terms, removed: [], substituted: [], applied: false };
  }

  const removed: string[] = [];
  const kept = terms.filter((term) => {
    if (looksLikeCodeFootageTerm(term)) {
      removed.push(term);
      return false;
    }
    return true;
  });

  if (removed.length === 0) {
    return { terms, removed: [], substituted: [], applied: false };
  }

  // Replace what was dropped so the scene keeps the same number of options,
  // rotating by scene so consecutive scenes do not request identical footage.
  const offset = (input.sceneIndex ?? 0) * 2;
  const substituted: string[] = [];
  for (let i = 0; i < removed.length; i++) {
    const replacement = WEBSITE_AD_REPLACEMENTS[(offset + i) % WEBSITE_AD_REPLACEMENTS.length];
    if (!kept.includes(replacement)) {
      kept.push(replacement);
      substituted.push(replacement);
    }
  }

  return { terms: kept, removed, substituted, applied: true };
}
