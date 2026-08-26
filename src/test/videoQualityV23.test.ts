import { describe, it, expect } from "vitest";
import { AudioMasteringService } from "../short-creator/audioMasteringService";
import { resolveCaptionStyle } from "../server/v2/captions/captionStyles";
import { captionLayoutForStyle } from "../components/arabicCaptionEngine";
import { buildStockQueryFamilies } from "../server/v2/creative/stockQueryFamilies";
import { qualityEngine } from "../server/v2/quality/qualityEngine";

describe("Milestone V2.3-03: Professional Quality, Audio Continuity & Caption Rendering", () => {
  describe("Dead-Air Detection & Audio Validation", () => {
    const audioMastering = new AudioMasteringService({} as any);

    it("passes for bounded natural breathing pauses (~160ms)", () => {
      const speechWindows = [
        { sceneIndex: 0, startMs: 0, endMs: 2500 },
        { sceneIndex: 1, startMs: 2660, endMs: 5160 },
        { sceneIndex: 2, startMs: 5320, endMs: 8000 },
      ];

      const report = audioMastering.analyzeDeadAir(speechWindows);
      expect(report.hasDeadAir).toBe(false);
      expect(report.hasSuspiciousPauses).toBe(false);
      expect(report.maxNarrationSilenceMs).toBe(160);
      expect(report.totalNarrationSilenceMs).toBe(320);
      expect(report.issues.length).toBe(0);
    });

    it("flags warnings for suspicious pauses (> 600ms)", () => {
      const speechWindows = [
        { sceneIndex: 0, startMs: 0, endMs: 2500 },
        { sceneIndex: 1, startMs: 3300, endMs: 5500 }, // 800ms gap
      ];

      const report = audioMastering.analyzeDeadAir(speechWindows);
      expect(report.hasDeadAir).toBe(false);
      expect(report.hasSuspiciousPauses).toBe(true);
      expect(report.maxNarrationSilenceMs).toBe(800);
      expect(report.warnings.length).toBe(1);
      expect(report.warnings[0]).toContain("800ms");
    });

    it("flags defects for dead-air gaps (> 1500ms)", () => {
      const speechWindows = [
        { sceneIndex: 0, startMs: 0, endMs: 2000 },
        { sceneIndex: 1, startMs: 4200, endMs: 6500 }, // 2200ms dead air
      ];

      const report = audioMastering.analyzeDeadAir(speechWindows);
      expect(report.hasDeadAir).toBe(true);
      expect(report.maxNarrationSilenceMs).toBe(2200);
      expect(report.issues.length).toBe(1);
      expect(report.issues[0]).toContain("2200ms");
    });
  });

  describe("Captions Styles & Safe Zone Margin Enforcement", () => {
    it("supports all 5 customer caption styles plus none", () => {
      const styles = ["clean", "karaoke", "bold_social", "minimal", "cinematic", "none"] as const;
      for (const style of styles) {
        const resolved = resolveCaptionStyle(style);
        expect(resolved).toBeDefined();
        expect(resolved.id).toBe(style);
      }
    });

    it("enforces max 2 lines and TikTok/Reels safe bottom zones across all 5 styles", () => {
      const styles = ["clean", "karaoke", "bold_social", "minimal", "cinematic"] as const;
      for (const style of styles) {
        const layout = captionLayoutForStyle(style, true);
        expect(layout.maxLines).toBeLessThanOrEqual(2);
        expect(layout.bottomSafeZonePx).toBeGreaterThanOrEqual(250);
        expect(layout.sideMarginPx).toBeGreaterThanOrEqual(80);
      }
    });
  });

  describe("Stock Query Diversification", () => {
    it("rotates query terms by sceneIndex to prevent repetitive queries", () => {
      const queryFamily0 = buildStockQueryFamilies({
        narration: "Discover our premium modern coffee beans",
        onScreenText: "Premium Coffee",
        purpose: "hook",
        visualIntent: "lifestyle",
        providedTerms: ["coffee", "beans", "cafe"],
        sceneIndex: 0,
      });

      const queryFamily1 = buildStockQueryFamilies({
        narration: "Discover our premium modern coffee beans",
        onScreenText: "Premium Coffee",
        purpose: "hook",
        visualIntent: "lifestyle",
        providedTerms: ["coffee", "beans", "cafe"],
        sceneIndex: 1,
      });

      expect(queryFamily0.queries.length).toBeGreaterThan(0);
      expect(queryFamily1.queries.length).toBeGreaterThan(0);
      expect(queryFamily0.queries[0].query).not.toBe(queryFamily1.queries[0].query);
    });
  });

  describe("Creative Quality Scoring", () => {
    it("awards high score (90+) for continuous narration and distinct visuals", () => {
      const scoreResult = qualityEngine.calculateCreativeQualityScore({
        deadAirDurationMs: 320,
        maxNarrationSilenceMs: 160,
        totalDurationSeconds: 15,
        sceneCount: 3,
        distinctAssetCount: 3,
        fallbackCount: 0,
        hasCta: true,
        captionStyle: "karaoke",
        hasCaptions: true,
        mediaRelevanceScores: [95, 92, 98],
      });

      expect(scoreResult.creativeScore).toBeGreaterThanOrEqual(90);
      expect(["A", "A+"].includes(scoreResult.creativeGrade)).toBe(true);
      expect(scoreResult.diagnostics.audioContinuityScore).toBe(100);
      expect(scoreResult.diagnostics.visualDiversityRatio).toBe(1.0);
    });

    it("penalizes score when excessive dead air or repeated assets occur", () => {
      const scoreResult = qualityEngine.calculateCreativeQualityScore({
        deadAirDurationMs: 4000,
        maxNarrationSilenceMs: 2500,
        totalDurationSeconds: 15,
        sceneCount: 4,
        distinctAssetCount: 1, // High duplicate risk
        fallbackCount: 2,
        hasCta: false,
        captionStyle: "clean",
        hasCaptions: true,
        mediaRelevanceScores: [60, 65, 70, 60],
      });

      expect(scoreResult.creativeScore).toBeLessThan(70);
      expect(["C", "D", "F"].includes(scoreResult.creativeGrade)).toBe(true);
      expect(scoreResult.diagnostics.audioContinuityScore).toBeLessThan(60);
      expect(scoreResult.warnings.length).toBeGreaterThan(0);
    });
  });
});
