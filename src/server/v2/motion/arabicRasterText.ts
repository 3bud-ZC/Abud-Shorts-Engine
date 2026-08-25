/**
 * ARABIC TEXT FOR RASTER (PILLOW) RENDERING
 * -----------------------------------------
 * The Motion Engine draws its frames with Pillow. Pillow only shapes Arabic when
 * it was built against libraqm/HarfBuzz, and the QUALITY_CPU wheel is not: with
 * that build `draw.text("ابدأ دلوقتي")` produces disconnected letters in
 * left-to-right order, which is unreadable Arabic even though every glyph is
 * present and no tofu box appears.
 *
 * This module applies the Arabic joining algorithm itself, mapping each letter
 * to the Arabic Presentation Forms-B codepoint for its contextual form and then
 * reversing the run for display, so an unshaping renderer draws correct Arabic.
 *
 * IMPORTANT: this is exclusively for the Pillow raster path. The caption
 * pipeline hands logical-order text to libass, which shapes with HarfBuzz, and
 * `captionQa.detectBrokenArabicShaping` deliberately rejects presentation forms
 * there. Never route caption text through this module.
 */

/** [isolated, final, initial, medial]; null where the form does not exist. */
type FormSet = [string, string | null, string | null, string | null];

function forms(
  isolated: number,
  final?: number,
  initial?: number,
  medial?: number,
): FormSet {
  return [
    String.fromCharCode(isolated),
    final ? String.fromCharCode(final) : null,
    initial ? String.fromCharCode(initial) : null,
    medial ? String.fromCharCode(medial) : null,
  ];
}

/**
 * Contextual forms for the letters Arabic and Egyptian Arabic scripts use, plus
 * the Persian/Urdu letters that appear in borrowed brand names.
 */
const LETTER_FORMS: Record<string, FormSet> = {
  "ء": forms(0xfe80),
  "آ": forms(0xfe81, 0xfe82),
  "أ": forms(0xfe83, 0xfe84),
  "ؤ": forms(0xfe85, 0xfe86),
  "إ": forms(0xfe87, 0xfe88),
  "ئ": forms(0xfe89, 0xfe8a, 0xfe8b, 0xfe8c),
  "ا": forms(0xfe8d, 0xfe8e),
  "ب": forms(0xfe8f, 0xfe90, 0xfe91, 0xfe92),
  "ة": forms(0xfe93, 0xfe94),
  "ت": forms(0xfe95, 0xfe96, 0xfe97, 0xfe98),
  "ث": forms(0xfe99, 0xfe9a, 0xfe9b, 0xfe9c),
  "ج": forms(0xfe9d, 0xfe9e, 0xfe9f, 0xfea0),
  "ح": forms(0xfea1, 0xfea2, 0xfea3, 0xfea4),
  "خ": forms(0xfea5, 0xfea6, 0xfea7, 0xfea8),
  "د": forms(0xfea9, 0xfeaa),
  "ذ": forms(0xfeab, 0xfeac),
  "ر": forms(0xfead, 0xfeae),
  "ز": forms(0xfeaf, 0xfeb0),
  "س": forms(0xfeb1, 0xfeb2, 0xfeb3, 0xfeb4),
  "ش": forms(0xfeb5, 0xfeb6, 0xfeb7, 0xfeb8),
  "ص": forms(0xfeb9, 0xfeba, 0xfebb, 0xfebc),
  "ض": forms(0xfebd, 0xfebe, 0xfebf, 0xfec0),
  "ط": forms(0xfec1, 0xfec2, 0xfec3, 0xfec4),
  "ظ": forms(0xfec5, 0xfec6, 0xfec7, 0xfec8),
  "ع": forms(0xfec9, 0xfeca, 0xfecb, 0xfecc),
  "غ": forms(0xfecd, 0xfece, 0xfecf, 0xfed0),
  "ف": forms(0xfed1, 0xfed2, 0xfed3, 0xfed4),
  "ق": forms(0xfed5, 0xfed6, 0xfed7, 0xfed8),
  "ك": forms(0xfed9, 0xfeda, 0xfedb, 0xfedc),
  "ل": forms(0xfedd, 0xfede, 0xfedf, 0xfee0),
  "م": forms(0xfee1, 0xfee2, 0xfee3, 0xfee4),
  "ن": forms(0xfee5, 0xfee6, 0xfee7, 0xfee8),
  "ه": forms(0xfee9, 0xfeea, 0xfeeb, 0xfeec),
  "و": forms(0xfeed, 0xfeee),
  "ى": forms(0xfeef, 0xfef0),
  "ي": forms(0xfef1, 0xfef2, 0xfef3, 0xfef4),
  // Extended letters seen in transliterated brand names.
  "ٱ": forms(0xfb50, 0xfb51),
  "پ": forms(0xfb56, 0xfb57, 0xfb58, 0xfb59),
  "چ": forms(0xfb7a, 0xfb7b, 0xfb7c, 0xfb7d),
  "ژ": forms(0xfb8a, 0xfb8b),
  "ڤ": forms(0xfb6a, 0xfb6b, 0xfb6c, 0xfb6d),
  "گ": forms(0xfb92, 0xfb93, 0xfb94, 0xfb95),
  "ی": forms(0xfbfc, 0xfbfd, 0xfbfe, 0xfbff),
};

/** Lam followed by one of these becomes a single mandatory ligature. */
const LAM_ALEF_LIGATURES: Record<string, [string, string]> = {
  "آ": ["ﻵ", "ﻶ"],
  "أ": ["ﻷ", "ﻸ"],
  "إ": ["ﻹ", "ﻺ"],
  "ا": ["ﻻ", "ﻼ"],
};

/** Harakat and other combining marks: transparent for joining. */
const TRANSPARENT = /[ً-ٰٟۖ-ۜ۟-۪ۤۧۨ-ۭ]/;

/** Letters that join to the letter before them but not to the one after. */
function joinsToNext(char: string): boolean {
  const set = LETTER_FORMS[char];
  return Boolean(set && set[2]);
}

function joinsToPrevious(char: string): boolean {
  const set = LETTER_FORMS[char];
  return Boolean(set && set[1]);
}

export function isArabicChar(char: string): boolean {
  const code = char.codePointAt(0) || 0;
  return (
    (code >= 0x0600 && code <= 0x06ff) ||
    (code >= 0x0750 && code <= 0x077f) ||
    (code >= 0xfb50 && code <= 0xfdff) ||
    (code >= 0xfe70 && code <= 0xfeff)
  );
}

export function containsArabic(value: string): boolean {
  return Array.from(value || "").some(isArabicChar);
}

/**
 * Applies contextual forms and mandatory lam-alef ligatures.
 * Order is unchanged: this is shaping only, not reordering.
 */
export function shapeArabicForms(value: string): string {
  const chars = Array.from(value || "");
  const out: string[] = [];

  const previousJoining = (index: number): boolean => {
    for (let i = index - 1; i >= 0; i--) {
      if (TRANSPARENT.test(chars[i])) continue;
      return joinsToNext(chars[i]);
    }
    return false;
  };
  const nextJoining = (index: number): boolean => {
    for (let i = index + 1; i < chars.length; i++) {
      if (TRANSPARENT.test(chars[i])) continue;
      return joinsToPrevious(chars[i]);
    }
    return false;
  };

  for (let index = 0; index < chars.length; index++) {
    const char = chars[index];

    // Lam + alef is a single glyph in Arabic; drawing them separately is one of
    // the clearest signs a renderer never shaped the text.
    if (char === "ل") {
      let lookahead = index + 1;
      while (lookahead < chars.length && TRANSPARENT.test(chars[lookahead])) lookahead++;
      const ligature = LAM_ALEF_LIGATURES[chars[lookahead]];
      if (ligature) {
        out.push(previousJoining(index) ? ligature[1] : ligature[0]);
        index = lookahead;
        continue;
      }
    }

    const set = LETTER_FORMS[char];
    if (!set) {
      out.push(char);
      continue;
    }

    const before = previousJoining(index);
    const after = nextJoining(index);
    if (before && after && set[3]) out.push(set[3]);
    else if (before && set[1]) out.push(set[1]);
    else if (after && set[2]) out.push(set[2]);
    else out.push(set[0]);
  }

  return out.join("");
}

const NEUTRAL = /[\s.,:;!?()[\]{}"'\-–—/\\|@#&*+=_~^`%$]/;
const LATIN_OR_DIGIT = /[A-Za-z0-9٠-٩]/;

/** Mirrored characters must flip when a run is reversed for display. */
const MIRRORED: Record<string, string> = {
  "(": ")",
  ")": "(",
  "[": "]",
  "]": "[",
  "{": "}",
  "}": "{",
  "<": ">",
  ">": "<",
};

/**
 * Reorders a shaped line into visual right-to-left order for a renderer that
 * only draws left to right.
 *
 * Latin words, numbers and prices keep their own left-to-right order - "599 EGP"
 * must not become "PGE 995" - so the line is split into directional runs and only
 * the Arabic runs are reversed.
 */
export function reorderForDisplay(value: string): string {
  const chars = Array.from(value || "");
  if (chars.length === 0) return "";

  type Run = { text: string[]; ltr: boolean };
  const runs: Run[] = [];
  let current: Run | null = null;

  for (const char of chars) {
    const ltr = LATIN_OR_DIGIT.test(char);
    const neutral = NEUTRAL.test(char);
    if (current && (neutral || current.ltr === ltr)) {
      current.text.push(char);
      continue;
    }
    current = { text: [char], ltr };
    runs.push(current);
  }

  // Trailing neutrals belong to the run that follows them in visual order, but
  // keeping them attached is close enough for display text and avoids splitting
  // a price away from its currency.
  const visual: string[] = [];
  for (let index = runs.length - 1; index >= 0; index--) {
    const run = runs[index];
    if (run.ltr) {
      visual.push(run.text.join(""));
    } else {
      visual.push(
        run.text
          .slice()
          .reverse()
          .map((char) => MIRRORED[char] || char)
          .join(""),
      );
    }
  }
  return visual.join("");
}

/**
 * Full preparation for the Pillow path: shape, then reorder.
 *
 * Text with no Arabic in it is returned untouched, so English productions are
 * completely unaffected.
 */
export function prepareArabicForRaster(value: string): string {
  const text = String(value ?? "");
  if (!containsArabic(text)) return text;
  return text
    .split("\n")
    .map((line) => reorderForDisplay(shapeArabicForms(line)))
    .join("\n");
}

/** True when the string already contains Presentation Forms-B glyphs. */
export function containsPresentationForms(value: string): boolean {
  return /[ﭐ-﷿ﹰ-﻿]/.test(value || "");
}
