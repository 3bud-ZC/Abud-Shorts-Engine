import type { ArabicDialect } from "../../../types/productionSpec";

export type PronunciationEntry = {
  written: string;
  spoken: string;
  languages?: string[];
  dialects?: ArabicDialect[];
};

const SYSTEM_PRONUNCIATIONS: PronunciationEntry[] = [
  { written: "API", spoken: "ايه بي آي" },
  { written: "AI", spoken: "إيه آي" },
  { written: "SEO", spoken: "إس إي أو" },
  { written: "SaaS", spoken: "ساس" },
  { written: "n8n", spoken: "إن إيت إن" },
  { written: "ChatGPT", spoken: "شات جي بي تي" },
  { written: "ABUD", spoken: "عبود" },
  { written: "HTML", spoken: "إتش تي إم إل" },
  { written: "CSS", spoken: "سي إس إس" },
  { written: "JavaScript", spoken: "جافا سكريبت" },
  { written: "React", spoken: "رياكت" },
  { written: "WhatsApp", spoken: "واتساب" },
  { written: "product", spoken: "برودكت" },
  { written: "customer", spoken: "كاستمر" },
];

const EASTERN_DIGITS: Record<string, string> = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
};

const ONES = [
  "صفر",
  "واحد",
  "اتنين",
  "تلاتة",
  "اربعة",
  "خمسة",
  "ستة",
  "سبعة",
  "تمانية",
  "تسعة",
  "عشرة",
  "حداشر",
  "اتناشر",
  "تلتاشر",
  "اربعتاشر",
  "خمستاشر",
  "ستاشر",
  "سبعتاشر",
  "تمنتاشر",
  "تسعتاشر",
];

const TENS: Record<number, string> = {
  20: "عشرين",
  30: "تلاتين",
  40: "اربعين",
  50: "خمسين",
  60: "ستين",
  70: "سبعين",
  80: "تمانين",
  90: "تسعين",
};

const HUNDREDS: Record<number, string> = {
  1: "مية",
  2: "ميتين",
  3: "تلتمية",
  4: "ربعمية",
  5: "خمسمية",
  6: "ستمية",
  7: "سبعمية",
  8: "تمانمية",
  9: "تسعمية",
};

function normalizeDigits(input: string): string {
  return input.replace(/[٠-٩]/g, (digit) => EASTERN_DIGITS[digit] || digit);
}

function speakUnderThousand(value: number): string {
  const rounded = Math.round(value);
  if (rounded < ONES.length) return ONES[rounded];
  if (rounded < 100) {
    const tens = Math.floor(rounded / 10) * 10;
    const ones = rounded % 10;
    return ones === 0 ? TENS[tens] : `${ONES[ones]} و${TENS[tens]}`;
  }
  const hundreds = Math.floor(rounded / 100);
  const rest = rounded % 100;
  const hundredText = HUNDREDS[hundreds] || `${ONES[hundreds]} مية`;
  return rest ? `${hundredText} و${speakUnderThousand(rest)}` : hundredText;
}

function speakNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const rounded = Math.round(value);
  if (rounded < 0) return `سالب ${speakNumber(Math.abs(rounded))}`;
  if (rounded < 1000) return speakUnderThousand(rounded);
  if (rounded < 1000000) {
    const thousands = Math.floor(rounded / 1000);
    const rest = rounded % 1000;
    const thousandsText =
      thousands === 1 ? "الف" : thousands === 2 ? "الفين" : `${speakUnderThousand(thousands)} الف`;
    return rest ? `${thousandsText} و${speakUnderThousand(rest)}` : thousandsText;
  }
  return String(rounded);
}

function speakYear(year: number): string {
  if (year >= 2000 && year < 2100) {
    const rest = year - 2000;
    return rest === 0 ? "سنة الفين" : `سنة الفين ${speakNumber(rest)}`;
  }
  return `سنة ${speakNumber(year)}`;
}

function speakDigits(value: string): string {
  return value.replace(/\D/g, "").split("").map((d) => ONES[Number(d)] || d).join(" ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function entryApplies(entry: PronunciationEntry, dialect?: ArabicDialect): boolean {
  if (entry.languages?.length && !entry.languages.some((lang) => lang === "ar" || lang.startsWith("ar"))) {
    return false;
  }
  if (entry.dialects?.length && dialect && !entry.dialects.includes(dialect)) {
    return false;
  }
  return true;
}

function toEntries(input?: Record<string, string> | PronunciationEntry[]): PronunciationEntry[] {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  return Object.entries(input).map(([written, spoken]) => ({ written, spoken }));
}

function sanitizeEntries(entries: PronunciationEntry[], dialect?: ArabicDialect): PronunciationEntry[] {
  return entries
    .filter((entry) => entryApplies(entry, dialect))
    .map((entry) => ({
      ...entry,
      written: String(entry.written || "").trim(),
      spoken: String(entry.spoken || "").trim(),
    }))
    .filter((entry) => {
      if (!entry.written || !entry.spoken) return false;
      if (entry.written.length > 120 || entry.spoken.length > 160) return false;
      if (entry.written.toLowerCase() === entry.spoken.toLowerCase()) return false;
      return /^[\p{Script=Arabic}A-Za-z0-9 ._\-+/#&]+$/u.test(entry.written);
    });
}

function replaceWithPlaceholders(
  input: string,
  entries: PronunciationEntry[],
  replacements: ArabicSpeechPreprocessResult["replacements"],
): { text: string; placeholders: string[] } {
  const placeholders: string[] = [];
  let text = input;

  for (const entry of entries.sort((a, b) => b.written.length - a.written.length)) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(entry.written)}(?![\\p{L}\\p{N}])`, "giu");
    text = text.replace(pattern, (match, offset, fullText) => {
      if (String(fullText).slice(offset + match.length).startsWith(" دوت")) {
        return match;
      }
      const marker = `__PRON_${placeholders.length}__`;
      placeholders.push(entry.spoken);
      replacements.push({ from: match, to: entry.spoken, kind: "pronunciation" });
      return marker;
    });
  }

  return { text, placeholders };
}

function restorePlaceholders(input: string, placeholders: string[]): string {
  return placeholders.reduce(
    (text, spoken, index) => text.replaceAll(`__PRON_${index}__`, spoken),
    input,
  );
}

function normalizeUrls(input: string): string {
  return input.replace(/\b(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s،]*)?)/gi, (_match, hostPath) => {
    const spoken = String(hostPath)
      .replace(/\./g, " دوت ")
      .replace(/\//g, " سلاش ")
      .replace(/-/g, " داش ");
    return spoken;
  });
}

function normalizePhoneLike(input: string): string {
  return input.replace(/(?<!\d)(?:\+?\d[\d\s-]{7,}\d)(?!\d)/g, (match) => speakDigits(match));
}

function normalizeTimes(input: string): string {
  return input.replace(/\b(\d{1,2}):(\d{2})\b/g, (_match, hour, minute) => {
    const h = Number(hour);
    const m = Number(minute);
    if (m === 0) return `${speakNumber(h)} بالظبط`;
    if (m === 30) return `${speakNumber(h)} ونص`;
    if (m === 15) return `${speakNumber(h)} وربع`;
    if (m === 45) return `${speakNumber(h + 1)} إلا ربع`;
    return `${speakNumber(h)} و${speakNumber(m)} دقيقة`;
  });
}

function normalizeDates(input: string): string {
  return input.replace(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/g, (_match, d, m, y) => {
    const fullYear = String(y).length === 2 ? Number(`20${y}`) : Number(y);
    return `${speakNumber(Number(d))} على ${speakNumber(Number(m))} ${speakYear(fullYear)}`;
  });
}

function normalizeCurrency(input: string): string {
  return input
    .replace(/\$ ?(\d+(?:\.\d+)?)/g, (_match, amount) => `${speakNumber(Number(amount))} دولار`)
    .replace(/(\d+(?:\.\d+)?) ?(?:EGP|ج\.م|جنيه|جنيها)/gi, (_match, amount) => {
      return `${speakNumber(Number(amount))} جنيه`;
    });
}

function normalizePercentages(input: string): string {
  return input.replace(/(\d+(?:\.\d+)?) ?%/g, (_match, amount) => {
    return `${speakNumber(Number(amount))} في المية`;
  });
}

function normalizeNumbers(input: string): string {
  return input.replace(/\b\d{1,6}\b/g, (match) => {
    const value = Number(match);
    if (match.length === 4 && value >= 1900 && value <= 2100) {
      return speakYear(value);
    }
    return speakNumber(value);
  });
}

export type ArabicSpeechPreprocessResult = {
  sourceText: string;
  spokenNarration: string;
  ttsNormalizedText: string;
  captionText: string;
  spokenText: string;
  replacements: Array<{ from: string; to: string; kind: string }>;
};

/**
 * Words that identify conversational Egyptian Arabic. They are deliberately
 * never rewritten into Modern Standard Arabic: the product owner wants the
 * narration to sound Egyptian, not formal.
 */
export const PRESERVED_EGYPTIAN_TOKENS = [
  "\u0625\u0646\u062A",
  "\u0645\u0634",
  "\u0644\u0633\u0647",
  "\u062F\u0644\u0648\u0642\u062A\u064A",
  "\u0639\u0646\u062F\u0643",
  "\u0645\u0639\u0627\u0643",
  "\u0639\u0644\u0634\u0627\u0646",
  "\u0628\u062A\u0633\u064A\u0628",
  "\u064A\u0631\u0648\u062D\u0648\u0627",
  "\u062E\u0644\u064A",
  "\u064A\u0638\u0647\u0631",
];

/**
 * Shared clean-up applied to every derived text form: strips markup, collapses
 * whitespace and normalizes typographic quotes. It never rewrites Arabic
 * letters, so conversational Egyptian spelling survives intact.
 */
function baseClean(input: string): string {
  return input
    .replace(/<[^>]+>/g, " ")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function tidyPunctuation(input: string): string {
  return input
    .replace(/\s*([\u060C,.!?\u061F])\s*/g, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
}

export function preprocessArabicSpeech(
  rawText: string,
  options: {
    dialect?: ArabicDialect;
    pronunciationOverrides?: Record<string, string> | PronunciationEntry[];
    brandPronunciations?: Record<string, string> | PronunciationEntry[];
    systemPronunciations?: Record<string, string> | PronunciationEntry[];
  } = {},
): ArabicSpeechPreprocessResult {
  const sourceText = rawText || "";
  const replacements: ArabicSpeechPreprocessResult["replacements"] = [];

  // 1. captionText - what the viewer reads. Original wording, original spelling.
  const captionText = baseClean(sourceText);

  // 2. spokenNarration - what the narrator is asked to say. Same Egyptian
  //    wording as the source; only tashkeel (which ElevenLabs does not need)
  //    and Eastern Arabic digits are normalized. Punctuation spacing is left
  //    alone here so URLs such as abud.fun stay intact for the next step.
  const spokenNarration = normalizeDigits(captionText)
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // 3. ttsNormalizedText - spokenNarration with pronunciation dictionary and
  //    number/date/currency expansion applied. This is the string sent to TTS.
  let text = normalizeUrls(spokenNarration);

  const dictionary = sanitizeEntries(
    [
      ...SYSTEM_PRONUNCIATIONS,
      ...toEntries(options.systemPronunciations),
      ...toEntries(options.brandPronunciations),
      ...toEntries(options.pronunciationOverrides),
    ],
    options.dialect,
  );

  const protectedResult = replaceWithPlaceholders(text, dictionary, replacements);
  text = protectedResult.text;

  text = normalizePhoneLike(text);
  text = normalizeTimes(text);
  text = normalizeDates(text);
  text = normalizeCurrency(text);
  text = normalizePercentages(text);
  text = normalizeNumbers(text);
  text = restorePlaceholders(text, protectedResult.placeholders);

  const ttsNormalizedText = tidyPunctuation(text);

  return {
    sourceText,
    spokenNarration,
    ttsNormalizedText,
    captionText,
    // Backwards-compatible alias used by older call sites and historical jobs.
    spokenText: ttsNormalizedText,
    replacements,
  };
}
