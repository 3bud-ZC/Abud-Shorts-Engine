import type { ArabicDialect } from "../../../types/productionSpec";

/**
 * CANONICAL CTA TRUTH & PROVENANCE POLICY
 * ----------------------------------------
 * One inspectable place that decides what call-to-action text a production is
 * allowed to show and why. Before this existed, `LocalContentAIProvider` ran a
 * bare `/whatsapp/i.test(prompt)` to decide whether the customer had asked for
 * a WhatsApp CTA. That check fires on the *word* "WhatsApp" appearing anywhere
 * in the prompt - including inside a prohibition such as "do not invent...
 * WhatsApp numbers" - so a customer who explicitly forbade WhatsApp still
 * received "Message Us on WhatsApp Today" as their final CTA, labeled
 * `ctaProvenance: "USER_EXPLICIT"` (incident video cmtehsptj000108ledzk3f3ji).
 * The same bare-substring pattern was duplicated across `enforcePromptTruthSafety`,
 * `professionalVisualQuality.ts` and `AdvancedCtaOverlay`'s hardcoded fallback,
 * so patching one call site would not have closed the other three.
 *
 * Every caller that needs to know whether a contact channel or offer was
 * really authorized should go through this module instead of writing its own
 * regex.
 */

export type CtaProvenance =
  | "USER_EXPLICIT"
  | "BRAND_PROFILE"
  | "PRODUCT_DATA"
  | "TEMPLATE_EXPLICIT"
  | "SAFE_INFERRED"
  | "NONE";

export type ResolvedCta = {
  text: string;
  provenance: CtaProvenance;
  contact?: string;
  action: string;
};

const WHATSAPP_PATTERN = /whats\s*app|واتساب|واتس|wa\.me/i;
const OFFER_PATTERN = /discount|offer|sale|coupon|promo|limited\s+(?:time|deal)|خصم|عرض|تخفيض|كوبون/i;
const STATISTIC_PATTERN = /\d+\s*%|\d+\s*(?:percent|per cent)|\d+\s*(?:في المية|بالمية|٪)/i;
const CONTACT_PATTERN = /call|phone|email|dm\b|message us|message our|contact|تواصل|اتصل|راسل|رسالة/i;

/**
 * Words that flip an otherwise-affirmative mention into a prohibition. "do not
 * invent ... WhatsApp numbers" must not be read the same as "message us on
 * WhatsApp".
 */
const NEGATION_PATTERN =
  /\b(do not|don't|dont|never|avoid|without|not to|must not|should not|shouldn't|cannot|can't|no|not)\b|لا تذكر|لا تخترع|بدون|ممنوع|من غير|مايكونش/i;

function splitSentences(text: string): string[] {
  return (text || "")
    .split(/[.\n!?؟]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * True only when `pattern` matches inside a sentence that contains no
 * prohibition wording. A prompt that lists a term purely to forbid it (any
 * order - "no WhatsApp" and "WhatsApp is not allowed" both count) never
 * counts as the customer asking for it.
 */
function mentionsAffirmatively(prompt: string, pattern: RegExp): boolean {
  return splitSentences(prompt).some(
    (sentence) => pattern.test(sentence) && !NEGATION_PATTERN.test(sentence),
  );
}

export function hasExplicitWhatsApp(prompt: string): boolean {
  return mentionsAffirmatively(prompt, WHATSAPP_PATTERN);
}

export function hasExplicitOffer(prompt: string): boolean {
  return mentionsAffirmatively(prompt, OFFER_PATTERN);
}

export function hasExplicitStatistic(prompt: string): boolean {
  return mentionsAffirmatively(prompt, STATISTIC_PATTERN);
}

export function hasExplicitContact(prompt: string): boolean {
  return hasExplicitWhatsApp(prompt) || mentionsAffirmatively(prompt, CONTACT_PATTERN);
}

/**
 * Whether raw `text` (a scene's canned narration/onScreenText, not the
 * customer's prompt) leans on a claim the prompt never affirmatively
 * authorized. Used to decide whether a whole CTA line needs replacing rather
 * than word-patched, because a mid-sentence substitution like
 * "WhatsApp" -> "message" produces broken grammar ("message us on message
 * today").
 */
export function inventsUngroundedClaim(text: string, prompt: string): boolean {
  const t = text || "";
  if (WHATSAPP_PATTERN.test(t) && !hasExplicitWhatsApp(prompt)) return true;
  if (OFFER_PATTERN.test(t) && !hasExplicitOffer(prompt)) return true;
  if (STATISTIC_PATTERN.test(t) && !hasExplicitStatistic(prompt)) return true;
  return false;
}

/**
 * Reads an explicit "CTA:" section out of the customer's prompt, e.g.
 *
 *   CTA:
 *   "Make your business look professional."
 *
 * or the inline form `CTA: Make your business look professional.`. Quote
 * characters (straight or curly) are stripped. Returns null when no such
 * section exists or the captured line is implausibly long to be a CTA (in
 * which case the heading regex likely matched free text, not a real
 * section).
 */
export function extractExplicitCtaFromPrompt(prompt: string): string | null {
  if (!prompt) return null;
  const lines = prompt.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => /^[ \t]*cta[ \t]*:/i.test(line));
  if (headingIndex === -1) return null;

  const sameLine = lines[headingIndex].replace(/^[ \t]*cta[ \t]*:/i, "").trim();
  let candidate = sameLine;
  if (!candidate) {
    for (let i = headingIndex + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line) {
        candidate = line;
        break;
      }
    }
  }
  if (!candidate) return null;

  const unquoted = candidate.replace(/^[“"'‘]+|[”"'’]+$/g, "").trim();
  if (!unquoted || unquoted.length > 140) return null;
  return unquoted;
}

/**
 * The single decision point for what a production's CTA is allowed to say.
 * Order of precedence matches the product policy: what the customer typed
 * verbatim beats what they merely implied, which beats a verified brand
 * contact, which beats a channel-free generic close. Nothing here invents a
 * phone number, handle or contact channel that was not actually supplied.
 */
export function resolveCtaProvenance(params: {
  prompt: string;
  isArabic: boolean;
  dialect: ArabicDialect;
  brandContactText?: string;
}): ResolvedCta {
  const { prompt, isArabic, dialect, brandContactText } = params;

  const explicit = extractExplicitCtaFromPrompt(prompt);
  if (explicit) {
    return {
      text: explicit,
      provenance: "USER_EXPLICIT",
      contact: hasExplicitWhatsApp(prompt) ? "WhatsApp" : undefined,
      action: "Contact CTA",
    };
  }

  if (hasExplicitWhatsApp(prompt)) {
    return {
      text: isArabic ? "تواصل معنا عبر واتساب" : "Message us on WhatsApp",
      provenance: "USER_EXPLICIT",
      contact: "WhatsApp",
      action: "Contact CTA",
    };
  }

  if (hasExplicitContact(prompt)) {
    return {
      text: isArabic ? "تواصل معنا لمعرفة التفاصيل" : "Contact us to learn more",
      provenance: "USER_EXPLICIT",
      action: "Contact CTA",
    };
  }

  if (brandContactText) {
    return {
      text: isArabic ? `تواصل معنا عبر ${brandContactText}` : `Contact us via ${brandContactText}`,
      provenance: "BRAND_PROFILE",
      contact: brandContactText,
      action: "Contact CTA",
    };
  }

  return {
    text: isArabic
      ? dialect === "egyptian"
        ? "تابعنا وشوف التفاصيل"
        : "تابعنا لمعرفة التفاصيل"
      : "Follow for more details",
    provenance: "SAFE_INFERRED",
    action: "Follow CTA",
  };
}

/**
 * Word-level sanitizer for narration/on-screen text that is NOT the CTA line
 * itself (offers/stats can appear mid-sentence in any scene, not only the
 * CTA). Kept separate from the CTA line replacement above because a
 * substitution here is a smaller, safer edit than swapping an entire
 * sentence.
 */
export function stripInventedClaims(text: string, prompt: string, isAr: boolean): string {
  let result = text;
  if (!hasExplicitWhatsApp(prompt)) {
    result = result
      .replace(/\s*(?:on|via|through)\s+WhatsApp/gi, "")
      .replace(/WhatsApp/gi, isAr ? "التواصل" : "message")
      .replace(/واتساب|واتس/gi, isAr ? "التواصل" : "message");
  }
  if (!hasExplicitOffer(prompt)) {
    result = result
      .replace(/(?:limited|special|exclusive)\s+(?:discount|offer|deal)/gi, isAr ? "التفاصيل" : "details")
      .replace(/\b(?:discount|offer|sale|coupon|promo)\b/gi, isAr ? "التفاصيل" : "details")
      .replace(/خصم|عرض|تخفيض|كوبون/gi, isAr ? "التفاصيل" : "details");
  }
  if (!hasExplicitStatistic(prompt)) {
    result = result
      .replace(/\b\d+\s*%\s*(?:of\s+)?/gi, "")
      .replace(/\d+\s*(?:في المية|بالمية|٪)/gi, "");
  }
  return result.replace(/\s{2,}/g, " ").trim();
}
