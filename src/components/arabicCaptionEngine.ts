import type { Caption, CaptionLine, CaptionPage } from "../types/shorts";

export type ArabicCaptionStyle =
  | "cinematic"
  | "viral_bold"
  | "clean"
  | "minimal"
  | "product_ad"
  | "educational"
  | "bold"
  | "viral"
  | "brand"
  | "none";

export type ArabicCaptionLayout = {
  maxLines: number;
  minDisplayMs: number;
  maxCharsPerLine: number;
  bottomSafeZonePx: number;
  sideMarginPx: number;
  fontSizePx: number;
  direction: "rtl";
  unicodeBidi: "isolate";
  collisionPolicy: {
    avoidCta: boolean;
    avoidFacesWhenAvailable: boolean;
  };
};

const ARABIC_RE = /[\u0600-\u06FF]/;
const HARD_BREAK_RE = /[.!?؟؛;،,]\s+/;
const SOFT_BREAK_WORDS = new Set([
  "و",
  "ثم",
  "لكن",
  "علشان",
  "عشان",
  "مع",
  "في",
  "من",
  "إلى",
  "على",
]);

export function containsArabic(text: string): boolean {
  return ARABIC_RE.test(text);
}

export function isolateBidi(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  return `\u2068${trimmed}\u2069`;
}

export function captionLayoutForStyle(style: ArabicCaptionStyle = "viral_bold", isPortrait = true): ArabicCaptionLayout {
  const base = {
    maxLines: 2,
    minDisplayMs: 850,
    bottomSafeZonePx: isPortrait ? 270 : 120,
    sideMarginPx: isPortrait ? 92 : 140,
    direction: "rtl" as const,
    unicodeBidi: "isolate" as const,
    collisionPolicy: {
      avoidCta: true,
      avoidFacesWhenAvailable: true,
    },
  };
  switch (style) {
    case "cinematic":
      return { ...base, maxCharsPerLine: isPortrait ? 21 : 34, fontSizePx: isPortrait ? 64 : 48 };
    case "clean":
      return { ...base, maxCharsPerLine: isPortrait ? 24 : 38, fontSizePx: isPortrait ? 56 : 42 };
    case "minimal":
      return { ...base, maxCharsPerLine: isPortrait ? 26 : 42, fontSizePx: isPortrait ? 48 : 36 };
    case "product_ad":
      return { ...base, maxCharsPerLine: isPortrait ? 20 : 32, fontSizePx: isPortrait ? 62 : 46 };
    case "educational":
      return { ...base, maxCharsPerLine: isPortrait ? 28 : 44, fontSizePx: isPortrait ? 50 : 38 };
    case "viral":
    case "bold":
    case "brand":
    case "viral_bold":
    default:
      return { ...base, maxCharsPerLine: isPortrait ? 18 : 30, fontSizePx: isPortrait ? 68 : 50 };
  }
}

function captionText(caption: Caption): string {
  return caption.text.trim();
}

function shouldBreakBefore(currentText: string, next: Caption, layout: ArabicCaptionLayout): boolean {
  const nextText = captionText(next);
  if (!currentText) return false;
  if (HARD_BREAK_RE.test(currentText)) return true;
  if ((currentText.length + 1 + nextText.length) > layout.maxCharsPerLine) return true;
  const first = nextText.split(/\s+/)[0];
  return currentText.length > layout.maxCharsPerLine * 0.7 && SOFT_BREAK_WORDS.has(first);
}

function toLine(captions: Caption[]): CaptionLine {
  return {
    texts: captions.map((caption) => ({
      ...caption,
      text: isolateBidi(caption.text),
    })),
  };
}

export class ArabicCaptionEngine {
  public group(captions: Caption[], options: {
    style?: ArabicCaptionStyle;
    isPortrait?: boolean;
    maxDistanceMs?: number;
  } = {}): CaptionPage[] {
    const layout = captionLayoutForStyle(options.style, options.isPortrait ?? true);
    const maxDistanceMs = options.maxDistanceMs ?? 900;
    const pages: CaptionPage[] = [];
    let pageLines: Caption[][] = [[]];
    let currentPageStart = 0;
    let currentPageEnd = 0;

    const flushPage = () => {
      const nonEmpty = pageLines.filter((line) => line.length > 0);
      if (nonEmpty.length === 0) return;
      const startMs = currentPageStart || nonEmpty[0][0].startMs;
      const endMs = Math.max(currentPageEnd, startMs + layout.minDisplayMs);
      pages.push({
        startMs,
        endMs,
        lines: nonEmpty.map(toLine),
      });
      pageLines = [[]];
      currentPageStart = 0;
      currentPageEnd = 0;
    };

    for (const caption of captions) {
      if (!captionText(caption)) continue;
      const currentLine = pageLines[pageLines.length - 1];
      const currentText = currentLine.map(captionText).join(" ");
      const hasTimingGap = currentPageEnd > 0 && caption.startMs - currentPageEnd > maxDistanceMs;

      if (hasTimingGap) {
        flushPage();
      } else if (shouldBreakBefore(currentText, caption, layout)) {
        if (pageLines.length >= layout.maxLines) {
          flushPage();
        } else {
          pageLines.push([]);
        }
      }

      if (!currentPageStart) currentPageStart = caption.startMs;
      pageLines[pageLines.length - 1].push(caption);
      currentPageEnd = Math.max(currentPageEnd, caption.endMs);
    }

    flushPage();
    return pages;
  }
}

export const arabicCaptionEngine = new ArabicCaptionEngine();
