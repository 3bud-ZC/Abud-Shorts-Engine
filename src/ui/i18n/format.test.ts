import { describe, expect, it } from "vitest";

import {
  formatBytes,
  formatDate,
  formatDuration,
  formatDurationMs,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  formatTime,
  isolateTechnical,
} from "./format";

const ARABIC_INDIC_DIGITS = /[٠-٩۰-۹]/;

describe("numbers", () => {
  it("groups thousands in both languages", () => {
    expect(formatNumber("en", 1234567)).toBe("1,234,567");
    expect(formatNumber("ar", 1234567)).toContain("1");
  });

  it("keeps Western Arabic digits in the Arabic interface", () => {
    // Every ID, version, size and error code in this product is written 0-9.
    // Mixing Arabic-Indic digits into a technical dashboard makes it harder to
    // read, not easier.
    expect(formatNumber("ar", 2026)).not.toMatch(ARABIC_INDIC_DIGITS);
    expect(formatBytes("ar", 1536)).not.toMatch(ARABIC_INDIC_DIGITS);
    expect(formatPercent("ar", 0.5)).not.toMatch(ARABIC_INDIC_DIGITS);
    expect(formatDuration("ar", 95)).not.toMatch(ARABIC_INDIC_DIGITS);
  });

  it("renders a non-finite value as a dash rather than NaN", () => {
    expect(formatNumber("en", Number.NaN)).toBe("—");
    expect(formatPercent("en", Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("percentages", () => {
  it("rounds to whole percent by default", () => {
    expect(formatPercent("en", 0.874)).toBe("87%");
    expect(formatPercent("en", 1)).toBe("100%");
    expect(formatPercent("en", 0)).toBe("0%");
  });

  it("honours an explicit precision", () => {
    expect(formatPercent("en", 0.8745, 1)).toBe("87.5%");
  });
});

describe("file sizes", () => {
  it("scales to a readable unit", () => {
    expect(formatBytes("en", 0)).toBe("0 B");
    expect(formatBytes("en", 512)).toBe("512 B");
    expect(formatBytes("en", 1024)).toBe("1.00 KB");
    expect(formatBytes("en", 5 * 1024 * 1024)).toBe("5.00 MB");
    expect(formatBytes("en", 2.5 * 1024 * 1024 * 1024)).toBe("2.50 GB");
  });

  it("keeps the unit in Latin script in both languages", () => {
    // "1.4 GB" is how the operating system, the provider dashboards and every
    // support conversation write it.
    expect(formatBytes("ar", 1024 * 1024)).toContain("MB");
  });

  it("treats a missing or negative size as zero rather than throwing", () => {
    expect(formatBytes("en", undefined)).toBe("0 B");
    expect(formatBytes("en", null)).toBe("0 B");
    expect(formatBytes("en", -5)).toBe("0 B");
  });
});

describe("durations", () => {
  it("uses the shape a video player uses", () => {
    expect(formatDuration("en", 45)).toBe("0:45");
    expect(formatDuration("en", 95)).toBe("1:35");
    expect(formatDuration("en", 3725)).toBe("1:02:05");
  });

  it("converts milliseconds", () => {
    expect(formatDurationMs("en", 120_000)).toBe("2:00");
  });

  it("returns a dash for an unknown duration rather than 0:00", () => {
    // "0:00" is a claim that the video is empty; a dash is a claim that we do
    // not know, which is the true statement.
    expect(formatDuration("en", undefined)).toBe("—");
    expect(formatDuration("en", null)).toBe("—");
    expect(formatDuration("en", -1)).toBe("—");
    expect(formatDurationMs("en", undefined)).toBe("—");
  });
});

describe("dates and times", () => {
  const stamp = "2026-08-25T14:30:00.000Z";

  it("formats a date in each language", () => {
    expect(formatDate("en", stamp)).toMatch(/2026/);
    expect(formatDate("ar", stamp)).toMatch(/2026/);
  });

  it("formats a time in each language", () => {
    expect(formatTime("en", stamp)).toMatch(/\d/);
    expect(formatTime("ar", stamp)).toMatch(/\d/);
  });

  it("returns a dash for a missing or unparseable value", () => {
    expect(formatDate("en", undefined)).toBe("—");
    expect(formatDate("en", "not a date")).toBe("—");
    expect(formatTime("en", null)).toBe("—");
  });

  it("describes recent moments relatively", () => {
    const now = new Date("2026-08-25T12:00:00.000Z");
    expect(formatRelativeTime("en", "2026-08-25T11:55:00.000Z", now)).toMatch(/minute/);
    expect(formatRelativeTime("en", "2026-08-25T09:00:00.000Z", now)).toMatch(/hour/);
    expect(formatRelativeTime("ar", "2026-08-25T11:55:00.000Z", now)).toMatch(/[؀-ۿ]/);
  });

  it("falls back to an absolute date once a value is old", () => {
    const now = new Date("2026-08-25T12:00:00.000Z");
    expect(formatRelativeTime("en", "2026-01-01T00:00:00.000Z", now)).toMatch(/2026/);
  });
});

describe("technical text", () => {
  it("isolates an identifier so RTL layout cannot reorder it", () => {
    const url = "https://example.com/videos/abc-123";
    const isolated = isolateTechnical(url);
    // The characters themselves are untouched; only bidi isolate marks wrap it.
    expect(isolated).toContain(url);
    expect(isolated.charCodeAt(0)).toBe(0x2068);
    expect(isolated.charCodeAt(isolated.length - 1)).toBe(0x2069);
  });

  it("leaves an empty value alone", () => {
    expect(isolateTechnical("")).toBe("");
  });

  it("does not alter version numbers, IDs or e-mail addresses", () => {
    for (const value of ["2.3.0", "job_01HX9", "ops@example.com"]) {
      expect(isolateTechnical(value)).toContain(value);
    }
  });
});
