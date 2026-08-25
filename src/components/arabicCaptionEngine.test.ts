import { describe, expect, it } from "vitest";
import { arabicCaptionEngine, captionLayoutForStyle, isolateBidi } from "./arabicCaptionEngine";
import type { Caption } from "../types/shorts";

describe("ArabicCaptionEngine", () => {
  it("groups Arabic semantic phrases without reversing logical token order", () => {
    const captions: Caption[] = [
      { text: "موقع", startMs: 0, endMs: 250 },
      { text: "احترافي", startMs: 250, endMs: 550 },
      { text: "لشركتك", startMs: 550, endMs: 850 },
      { text: "مع", startMs: 850, endMs: 1050 },
      { text: "ABUD", startMs: 1050, endMs: 1350 },
      { text: "في", startMs: 1350, endMs: 1550 },
      { text: "2026", startMs: 1550, endMs: 1800 },
    ];

    const pages = arabicCaptionEngine.group(captions, {
      style: "viral_bold",
      isPortrait: true,
    });
    const logicalText = pages
      .flatMap((page) => page.lines.flatMap((line) => line.texts.map((caption) => caption.text.replace(/[\u2068\u2069]/g, ""))))
      .join(" ");

    expect(logicalText).toBe("موقع احترافي لشركتك مع ABUD في 2026");
    expect(pages.every((page) => page.lines.length <= 2)).toBe(true);
    expect(pages[0].endMs - pages[0].startMs).toBeGreaterThanOrEqual(850);
  });

  it("uses Unicode bidi isolation for mixed Arabic, English, digits, and URLs", () => {
    expect(isolateBidi("خصم 20% على abud.fun")).toBe("\u2068خصم 20% على abud.fun\u2069");
  });

  it("defines safe Arabic caption layouts for each V2 style", () => {
    for (const style of ["cinematic", "viral_bold", "clean", "minimal", "product_ad", "educational"] as const) {
      const layout = captionLayoutForStyle(style, true);
      expect(layout.maxLines).toBe(2);
      expect(layout.sideMarginPx).toBeGreaterThanOrEqual(80);
      expect(layout.bottomSafeZonePx).toBeGreaterThanOrEqual(250);
      expect(layout.collisionPolicy.avoidCta).toBe(true);
      expect(layout.collisionPolicy.avoidFacesWhenAvailable).toBe(true);
    }
  });
});
