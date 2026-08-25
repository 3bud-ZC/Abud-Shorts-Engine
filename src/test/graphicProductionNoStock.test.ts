import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "fs-extra";
import os from "os";
import path from "path";

import { buildCreativePlan } from "../server/v2/creative/creativePlan";
import {
  TREATMENT_MOTION_TEMPLATE,
  TREATMENT_RUNTIME,
} from "../server/v2/creative/visualTreatment";
import { buildEditDecisionList } from "../server/v2/editing/editDecisionList";
import { composeVisualBed } from "../server/v2/editing/visualBedComposer";
import { motionEngine, type MotionTemplateType } from "../server/v2/motion/motionEngine";
import { StockProviderRegistry } from "../server/v2/stock-providers/stockProviderRegistry";

/**
 * GRAPHIC PRODUCTIONS WITHOUT A STOCK NETWORK
 * -------------------------------------------
 * MOTION_GRAPHICS and ANIMATED_EXPLAINER are the two modes a customer chooses
 * precisely because they do not want stock footage. The F2 report left this
 * ambiguous - it claimed "stock required: no" while still reporting a base-media
 * shot - so this renders a real picture track with every stock credential
 * removed and asserts an MP4 comes out.
 *
 * Nothing here reaches the network: the only runtimes involved are Pillow and
 * FFmpeg, both local.
 */

const SCENES = [
  { sceneIndex: 0, narration: "ليه شغلك محتاج نظام أفضل؟", purpose: "hook", durationSeconds: 2 },
  { sceneIndex: 1, narration: "تلات خطوات بس وهتفرق معاك", purpose: "problem", durationSeconds: 2 },
  { sceneIndex: 2, narration: "وفرنا 40% من وقت الفريق", purpose: "solution", durationSeconds: 2 },
  { sceneIndex: 3, narration: "كلمنا على واتساب دلوقتي", purpose: "cta", durationSeconds: 2 },
];

const savedEnv: Record<string, string | undefined> = {};
let workDir = "";

beforeAll(async () => {
  for (const key of ["PEXELS_API_KEY", "PIXABAY_API_KEY"]) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), "abud-graphic-nostock-"));
});

afterAll(async () => {
  Object.entries(savedEnv).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
  await fs.remove(workDir);
});

describe("Graphic productions with stock providers disabled", () => {
  it("reports no configured stock provider in this environment", () => {
    const registry = new StockProviderRegistry();
    expect(registry.configuredProviders()).toHaveLength(0);
    expect(process.env.PEXELS_API_KEY).toBeUndefined();
  });

  it.each(["motion_graphics", "animated_explainer"] as const)(
    "renders a complete %s picture track with no stock asset at all",
    async (productionMode) => {
      const plan = buildCreativePlan({
        productionMode,
        scenes: SCENES,
        // The runtime a customer with no stock credential actually has.
        isTreatmentAvailable: (treatment) => TREATMENT_RUNTIME[treatment] === "motion",
      });

      expect(plan.runtimeCounts.stock).toBeUndefined();

      const edl = buildEditDecisionList({
        scenes: SCENES.map((scene, index) => ({
          sceneId: `scene${index}`,
          sceneIndex: index,
          purpose: scene.purpose,
          durationSeconds: scene.durationSeconds,
          startSeconds: index * scene.durationSeconds,
        })),
        totalDurationSeconds: SCENES.length * 2,
        assignSource: () => ({
          sourceType: "motion",
          provider: "abud_motion",
          routingReason: "graphic_only_mode",
        }),
      });
      expect(edl.shots.every((shot) => shot.sourceType === "motion")).toBe(true);

      // One graphic clip per narration scene, rendered locally.
      const shotInputs = [];
      for (const scene of plan.sceneTreatments) {
        const template = (TREATMENT_MOTION_TEMPLATE[scene.treatment] ||
          "kinetic_typography") as MotionTemplateType;
        const rendered = await motionEngine.renderMotionScene({
          template,
          title: scene.narration,
          features: ["واحد", "اتنين", "تلاتة"],
          steps: ["واحد", "اتنين", "تلاتة"],
          numberStat: scene.extracted?.statValue
            ? { value: scene.extracted.statValue, label: "", suffix: scene.extracted.statSuffix }
            : undefined,
          ctaText: "اطلب دلوقتي",
          durationSeconds: 1,
          width: 540,
          height: 960,
          fps: 12,
          language: "ar",
        });
        expect(fs.existsSync(rendered.absolutePath)).toBe(true);
        expect(fs.statSync(rendered.absolutePath).size).toBeGreaterThan(1000);
        // Arabic rendered with a real bundled face and no missing glyphs.
        expect(rendered.missingGlyphs).toEqual([]);
        expect(rendered.fontPath).toMatch(/\.(ttf|otf|ttc)$/i);

        shotInputs.push({
          shot: {
            ...edl.shots[scene.sceneIndex],
            duration: 1,
          },
          sourcePath: rendered.absolutePath,
          sourceStartSeconds: 0,
        });
      }

      const outputPath = path.join(workDir, `${productionMode}.mp4`);
      const composed = await composeVisualBed({
        shots: shotInputs as never,
        outputPath,
        width: 540,
        height: 960,
        fps: 12,
        workDir: path.join(workDir, `${productionMode}-work`),
      });

      expect(composed.composed).toBe(true);
      expect(composed.shotCount).toBe(SCENES.length);
      expect(fs.existsSync(outputPath)).toBe(true);
      expect(fs.statSync(outputPath).size).toBeGreaterThan(5000);

      // Nothing in the finished track came from a stock provider.
      const providers = new Set(shotInputs.map((input) => input.shot.provider));
      expect([...providers]).toEqual(["abud_motion"]);
    },
    120_000,
  );
});
