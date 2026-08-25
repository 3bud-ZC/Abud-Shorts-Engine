import type { VisualTreatment } from "./visualTreatment";

/**
 * VISUAL INTENT CLASSIFICATION
 * ----------------------------
 * Reads what a narration segment is *doing* and picks the treatment that shows
 * it best. Entirely local and deterministic: no paid LLM is required, and the
 * same narration always classifies the same way, which is what makes the result
 * testable.
 *
 * A configured Content AI provider may refine the result later, but this route
 * must stay capable on its own.
 *
 * Both Arabic (including Egyptian colloquial) and English are handled, because
 * the product's primary market writes scripts in Arabic.
 */

export type IntentSignal =
  | "statistic"
  | "enumeration"
  | "process"
  | "comparison"
  | "before_after"
  | "website_or_app"
  | "product"
  | "hook"
  | "quote"
  | "cta"
  | "timeline"
  | "general";

export type IntentClassification = {
  signal: IntentSignal;
  treatment: VisualTreatment;
  confidence: number;
  /** Human-readable justification, persisted so routing is auditable. */
  reason: string;
  /** Values pulled out of the text for the motion template to render. */
  extracted?: {
    statValue?: string;
    statSuffix?: string;
    items?: string[];
    stepCount?: number;
  };
};

// --------------------------------------------------------------- lexicons

const CTA_TERMS = [
  "تواصل", "اتصل", "احجز", "اطلب", "سجل", "ابدأ", "كلمنا", "واتساب", "whatsapp",
  "الاول", "دلوقتي", "النهاردة", "لينك", "الرابط", "اشترك",
  "contact", "call us", "book", "order", "sign up", "get started", "subscribe",
  "click", "link in bio", "dm us", "message us",
];

const PROCESS_TERMS = [
  "خطوات", "خطوة", "مراحل", "مرحلة", "الأول", "بعدين", "وبعد كده", "أخيرا",
  "step", "steps", "stage", "phase", "first", "then", "finally", "process", "how it works",
];

const COMPARISON_TERMS = [
  "الفرق", "مقارنة", "بدل", "بدلا", "افضل من", "أحسن من", "مقابل",
  "versus", " vs ", "compared", "instead of", "better than", "difference between",
];

const BEFORE_AFTER_TERMS = [
  "قبل", "بعد", "كان", "بقى", "قديم", "جديد",
  "before", "after", "used to", "now",
];

const WEBSITE_TERMS = [
  "موقع", "موقعك", "المواقع", "متجر", "متجرك", "لاندينج", "صفحة",
  "تطبيق", "ابليكيشن", "منصة", "داشبورد",
  "website", "web site", "webpage", "landing page", "online store", "ecommerce",
  "app", "application", "platform", "dashboard", "saas",
];

const DEVICE_TERMS = [
  "موبايل", "تليفون", "الهاتف", "لابتوب", "تابلت", "شاشة",
  "mobile", "phone", "smartphone", "laptop", "tablet", "desktop", "screen", "responsive",
];

const PRODUCT_TERMS = [
  "منتج", "المنتج", "منتجنا", "قطعة", "الساعة", "الجهاز",
  "product", "item", "device", "gadget",
];

const QUOTE_TERMS = [
  "قال", "بيقول", "رأي", "شهادة", "عميل قال",
  "said", "testimonial", "review", "quote",
];

const HOOK_TERMS = [
  "بتخسر", "بتضيع", "تعرف", "متخيل", "ليه", "إيه رأيك", "توقف", "استنى",
  "هل", "مش", "لسه",
  "did you know", "stop scrolling", "imagine", "why", "are you", "still",
];

const TIMELINE_TERMS = [
  "من سنة", "على مدار", "تاريخ", "رحلة", "بدأنا",
  "since", "over the years", "timeline", "journey", "history",
];

/** Enumeration cue: "3 أسباب", "5 reasons", "أربع مميزات". */
const ARABIC_NUMBER_WORDS: Record<string, number> = {
  "اتنين": 2, "اثنين": 2, "تلات": 3, "ثلاث": 3, "تلاتة": 3, "ثلاثة": 3,
  "اربع": 4, "أربع": 4, "اربعة": 4, "أربعة": 4, "خمس": 5, "خمسة": 5,
  "ست": 6, "ستة": 6, "سبع": 7, "سبعة": 7,
};

const ENUMERATION_NOUNS = [
  "أسباب", "اسباب", "مميزات", "ميزة", "خطوات", "نصائح", "حاجات", "طرق", "فوائد",
  "reasons", "benefits", "features", "tips", "ways", "things", "steps",
];

// --------------------------------------------------------------- helpers

function normalize(text: string): string {
  return (text || "")
    .replace(/[ً-ٰٟ]/g, "")
    .replace(/ـ/g, "")
    .toLowerCase();
}

function containsAny(haystack: string, needles: string[]): string | null {
  for (const needle of needles) {
    if (haystack.includes(needle.toLowerCase())) return needle;
  }
  return null;
}

/** Percentages, multipliers and standalone figures worth featuring. */
function extractStatistic(text: string): { value: string; suffix?: string } | null {
  const normalized = (text || "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));

  const percent = normalized.match(/(\d{1,3}(?:[.,]\d+)?)\s*(%|بالمية|بالمئة|في المية|percent)/i);
  if (percent) return { value: percent[1], suffix: "%" };

  const multiplier = normalized.match(/(\d{1,3})\s*(x|ضعف|أضعاف|اضعاف|times)/i);
  if (multiplier) return { value: multiplier[1], suffix: "x" };

  // A bare number is only a statistic when it is large enough to be a claim;
  // "3 reasons" is an enumeration and is handled separately.
  const bare = normalized.match(/\b(\d{2,4})\b/);
  if (bare && Number(bare[1]) >= 10) return { value: bare[1] };

  return null;
}

/** "3 reasons" / "تلات مميزات" - a count paired with a listable noun. */
function extractEnumeration(text: string): number | null {
  const normalized = normalize(text).replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  const noun = containsAny(normalized, ENUMERATION_NOUNS);
  if (!noun) return null;

  const digit = normalized.match(/\b([2-7])\b/);
  if (digit) return Number(digit[1]);

  for (const [word, count] of Object.entries(ARABIC_NUMBER_WORDS)) {
    if (normalized.includes(word)) return count;
  }
  // The noun alone still implies a list; default to three cards.
  return 3;
}

// ------------------------------------------------------------ classifier

export type ClassifyContext = {
  /** Scene role from the production spec, when the planner supplied one. */
  purpose?: string;
  /** 0 at the start of the video, 1 at the end. */
  positionRatio?: number;
  /** True when the customer supplied product media. */
  hasProductMedia?: boolean;
  /** True when the customer supplied their own footage or images. */
  hasUploadedMedia?: boolean;
  /** The subject of the advertisement, e.g. website design. */
  topicHint?: string;
};

/**
 * Classifies one narration segment.
 *
 * Ordered by how specific the evidence is: a concrete statistic beats a generic
 * "website" mention, and an explicit CTA at the end of the video beats
 * everything, because that is the shot the viewer must act on.
 */
export function classifyVisualIntent(
  narration: string,
  context: ClassifyContext = {},
): IntentClassification {
  const text = normalize(narration);
  const position = context.positionRatio ?? 0;

  // 1. Explicit CTA, either by scene role or by wording near the end.
  const ctaTerm = containsAny(text, CTA_TERMS);
  if (context.purpose === "cta" || (ctaTerm && position > 0.6)) {
    return {
      signal: "cta",
      treatment: "CTA_SCENE",
      confidence: context.purpose === "cta" ? 0.95 : 0.8,
      reason: context.purpose === "cta" ? "scene role is cta" : `call-to-action wording "${ctaTerm}"`,
    };
  }

  // 2. A concrete figure is the strongest visual hook there is.
  const statistic = extractStatistic(narration);
  if (statistic) {
    return {
      signal: "statistic",
      treatment: "STATS_CARD",
      confidence: 0.9,
      reason: `numeric claim ${statistic.value}${statistic.suffix || ""}`,
      extracted: { statValue: statistic.value, statSuffix: statistic.suffix },
    };
  }

  // 3. Counted list. A count of *steps* is a process, not a feature list -
  //    "3 steps" and "3 benefits" want different visuals even though both are
  //    enumerations.
  const enumeration = extractEnumeration(narration);
  if (enumeration) {
    const stepNoun = containsAny(text, ["خطوات", "خطوة", "مراحل", "مرحلة", "steps", "step", "stages"]);
    return {
      signal: stepNoun ? "process" : "enumeration",
      treatment: stepNoun ? "PROCESS_STEPS" : "FEATURE_LIST",
      confidence: 0.85,
      reason: stepNoun
        ? `counted process of ${enumeration} steps`
        : `enumeration of ${enumeration} items`,
      extracted: { stepCount: enumeration },
    };
  }

  // 4. Before/after needs both halves present to avoid firing on a bare "بعد".
  const beforeTerm = containsAny(text, ["قبل", "كان", "قديم", "before", "used to"]);
  const afterTerm = containsAny(text, ["بعد", "بقى", "جديد", "after", "now"]);
  if (beforeTerm && afterTerm) {
    return {
      signal: "before_after",
      treatment: "BEFORE_AFTER",
      confidence: 0.8,
      reason: `contrast between "${beforeTerm}" and "${afterTerm}"`,
    };
  }

  const comparison = containsAny(text, COMPARISON_TERMS);
  if (comparison) {
    return {
      signal: "comparison",
      treatment: "COMPARISON",
      confidence: 0.75,
      reason: `comparison wording "${comparison}"`,
    };
  }

  const process = containsAny(text, PROCESS_TERMS);
  if (process) {
    return {
      signal: "process",
      treatment: "PROCESS_STEPS",
      confidence: 0.7,
      reason: `process wording "${process}"`,
    };
  }

  const timeline = containsAny(text, TIMELINE_TERMS);
  if (timeline) {
    return {
      signal: "timeline",
      treatment: "TIMELINE",
      confidence: 0.7,
      reason: `timeline wording "${timeline}"`,
    };
  }

  const quote = containsAny(text, QUOTE_TERMS);
  if (quote) {
    return {
      signal: "quote",
      treatment: "QUOTE_CALLOUT",
      confidence: 0.7,
      reason: `quotation wording "${quote}"`,
    };
  }

  // 5. Customer-supplied media outranks stock for the subject it depicts.
  if (context.hasProductMedia && containsAny(text, PRODUCT_TERMS)) {
    return {
      signal: "product",
      treatment: "PRODUCT_HERO",
      confidence: 0.85,
      reason: "product mentioned and product media supplied",
    };
  }

  // 6. Website / app subject matter: show the artefact, not people at desks.
  const websiteTerm = containsAny(text, WEBSITE_TERMS);
  if (websiteTerm) {
    const deviceTerm = containsAny(text, DEVICE_TERMS);
    return {
      signal: "website_or_app",
      treatment: deviceTerm ? "DEVICE_MOCKUP" : "WEBSITE_MOCKUP",
      confidence: 0.8,
      reason: deviceTerm
        ? `website wording "${websiteTerm}" with device "${deviceTerm}"`
        : `website wording "${websiteTerm}"`,
    };
  }

  // 7. An opening line that asks or provokes carries better as type than as a
  //    stock clip of someone looking at a laptop.
  const hookTerm = containsAny(text, HOOK_TERMS);
  if ((context.purpose === "hook" || position < 0.2) && hookTerm) {
    return {
      signal: "hook",
      treatment: "KINETIC_TYPOGRAPHY",
      confidence: 0.7,
      reason: `hook phrasing "${hookTerm}" at the opening`,
    };
  }

  if (context.hasUploadedMedia) {
    return {
      signal: "general",
      treatment: "UPLOADED_MEDIA",
      confidence: 0.6,
      reason: "customer supplied media for this production",
    };
  }

  return {
    signal: "general",
    treatment: "STOCK_FOOTAGE",
    confidence: 0.5,
    reason: "general real-world context",
  };
}

/**
 * Splits a narration scene into the clauses a viewer perceives as separate
 * beats, so one scene can carry more than one treatment.
 */
export function splitNarrationBeats(narration: string): string[] {
  return (narration || "")
    .split(/(?<=[.!?؟،,;:])\s+|\s+(?=و?لكن\b|\s*but\b)/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
