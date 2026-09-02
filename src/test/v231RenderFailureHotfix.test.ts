import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import { buildCreativePlan } from "../server/v2/creative/creativePlan";
import {
  TREATMENT_RUNTIME,
  sceneRendersAsMotion,
} from "../server/v2/creative/visualTreatment";
import { classifyRenderFailure } from "../server/v2/customerView";
import {
  planSceneVisualDurationSeconds,
  resolveProductionTimeline,
  type ProductionSpec,
} from "../types/productionSpec";
import { AudioMasteringService } from "../short-creator/audioMasteringService";
import { CATALOGS } from "../ui/i18n/catalog";

/**
 * V2.3.1 HOTFIX - production render failure ASE-TLZ09P
 * ---------------------------------------------------
 * A "Prompt Studio" production (productionMode "auto_hybrid", visualMode "auto")
 * on a host with no Pexels/Pixabay key reached 100% and then failed with
 * "Pexels search exhausted 8 terms". The creative plan had already fallen every
 * scene back to an offline motion treatment, but ShortCreator only routed a
 * scene to the motion runtime when the whole production was an explicitly
 * graphic mode - so the Auto production still walked the stock path and failed.
 *
 * These are deterministic and reach no network: buildCreativePlan and the
 * routing predicate are pure.
 */

// The three scenes the local planner produced for the failed job, all asking
// for stock footage.
const AD_SCENES = [
  {
    sceneIndex: 0,
    narration: "Looking for the absolute best way to answer customer messages faster?",
    purpose: "hook",
    durationSeconds: 6.9,
  },
  {
    sceneIndex: 1,
    narration: "Built with premium quality and tailored to deliver exactly what small teams need.",
    purpose: "solution",
    durationSeconds: 6.9,
  },
  {
    sceneIndex: 2,
    narration: "Get in touch today to grab this limited offer before it's gone.",
    purpose: "cta",
    durationSeconds: 6.9,
  },
];

describe("V2.3.1: an Auto production with no stock provider renders through motion", () => {
  it("falls every scene back to a motion runtime when no stock provider is available", () => {
    const plan = buildCreativePlan({
      productionMode: "auto_hybrid",
      scenes: AD_SCENES,
      isTreatmentAvailable: (treatment) => TREATMENT_RUNTIME[treatment] === "motion",
    });

    expect(plan.runtimeCounts.stock).toBeUndefined();
    expect(plan.sceneTreatments).toHaveLength(3);
    for (const scene of plan.sceneTreatments) {
      expect(scene.runtime, `scene ${scene.sceneIndex} runtime`).toBe("motion");
    }
  });

  it("routes every planned-motion scene of an Auto production to the motion renderer", () => {
    const plan = buildCreativePlan({
      productionMode: "auto_hybrid",
      scenes: AD_SCENES,
      isTreatmentAvailable: (treatment) => TREATMENT_RUNTIME[treatment] === "motion",
    });

    for (const scene of plan.sceneTreatments) {
      const renders = sceneRendersAsMotion({
        productionMode: "auto_hybrid",
        visualMode: "auto",
        sceneVisualSource: "stock", // exactly what the planner wrote
        plannedTreatmentRuntime: scene.runtime,
      });
      expect(renders, `scene ${scene.sceneIndex}`).toBe(true);
    }
  });

  it("still uses the stock path for an Auto production when a stock provider IS available", () => {
    const plan = buildCreativePlan({
      productionMode: "auto_hybrid",
      scenes: AD_SCENES,
      isTreatmentAvailable: () => true,
    });

    // At least the hook/solution scenes keep their stock treatment...
    const stockScene = plan.sceneTreatments.find((scene) => scene.runtime === "stock");
    expect(stockScene, "a scene still resolves to stock when stock is available").toBeDefined();

    // ...and the renderer does not force those onto the motion path.
    expect(
      sceneRendersAsMotion({
        productionMode: "auto_hybrid",
        visualMode: "auto",
        sceneVisualSource: "stock",
        plannedTreatmentRuntime: stockScene!.runtime,
      }),
    ).toBe(false);
  });

  it("keeps honouring an explicit graphic production and an explicit graphic scene", () => {
    expect(
      sceneRendersAsMotion({ productionMode: "motion_graphics", visualMode: "auto" }),
    ).toBe(true);
    expect(
      sceneRendersAsMotion({ productionMode: "animated_explainer" }),
    ).toBe(true);
    expect(
      sceneRendersAsMotion({ visualMode: "motion_graphics" }),
    ).toBe(true);
    expect(
      sceneRendersAsMotion({ productionMode: "auto_hybrid", sceneVisualSource: "motion_graphics" }),
    ).toBe(true);
  });

  it("does not route a plain stock production to motion", () => {
    expect(
      sceneRendersAsMotion({
        productionMode: "auto_hybrid",
        visualMode: "stock",
        sceneVisualSource: "stock",
        plannedTreatmentRuntime: "stock",
      }),
    ).toBe(false);
  });

  it("does not let a motion creative treatment override explicit stock mode", () => {
    expect(
      sceneRendersAsMotion({
        productionMode: "auto_hybrid",
        visualMode: "stock",
        sceneVisualSource: "stock",
        plannedTreatmentRuntime: "motion",
      }),
    ).toBe(false);
  });
});

/**
 * Mirrors what ShortCreator.renderProductionSpec does with duration: resolve the
 * timeline, then size each scene's visual to
 * planSceneVisualDurationSeconds({ speech, budget: sceneTimeline.durationSeconds }).
 * The sum is the value handed to Remotion as `durationMs`, i.e. the final MP4
 * length. This runs for every scene BEFORE the stock/motion branch, so the
 * result is identical whether a scene renders as motion or stock.
 */
function renderedVideoSeconds(spec: ProductionSpec, speechPerScene: number[]): number {
  const timeline = resolveProductionTimeline(spec as ProductionSpec, 25);
  return (
    Math.round(
      timeline.scenes.reduce((sum, scene, i) => {
        const speech = speechPerScene[i] ?? speechPerScene[speechPerScene.length - 1] ?? 2;
        return (
          sum +
          planSceneVisualDurationSeconds({
            speechSeconds: speech,
            resolvedSceneBudgetSeconds: scene.durationSeconds,
            isLastScene: i === timeline.scenes.length - 1,
          })
        );
      }, 0) * 100,
    ) / 100
  );
}

const adSpec = (durationSeconds: number, productionMode: string, visualMode: string): ProductionSpec =>
  ({
    id: "spec_test",
    creationMode: "prompt",
    title: "AI Production",
    language: "en",
    dialect: "none",
    tone: "energetic",
    contentStyle: "advertisement",
    durationSeconds,
    aspectRatio: "9:16",
    resolution: "1080p",
    quality: "standard",
    sceneCount: 3,
    visualMode,
    productionMode,
    voiceProvider: "kokoro",
    scenes: [
      { sceneIndex: 0, purpose: "hook", durationSeconds: durationSeconds / 3, narration: "Hook line.", visualSource: "stock" },
      { sceneIndex: 1, purpose: "solution", durationSeconds: durationSeconds / 3, narration: "Solution line.", visualSource: "stock" },
      { sceneIndex: 2, purpose: "cta", durationSeconds: durationSeconds / 3, narration: "Call to action.", visualSource: "stock" },
    ],
  }) as unknown as ProductionSpec;

describe("V2.3.1: a plan-resolved motion scene keeps the requested duration (duration contract)", () => {
  it("keeps the 30s incident contract at ~30s with the incident's terse narration", () => {
    // The exact failure: 30s Auto production, ~1.2-3.2s of Kokoro speech per scene.
    const seconds = renderedVideoSeconds(adSpec(30, "auto_hybrid", "auto"), [3.24, 1.6, 1.24]);
    expect(Math.abs(seconds - 30)).toBeLessThanOrEqual(0.5);
  });

  it("keeps the V2.3-07 explicit-motion 12s contract at ~12s", () => {
    const seconds = renderedVideoSeconds(adSpec(12, "motion_graphics", "motion_graphics"), [1.4, 1.4, 1.4]);
    expect(Math.abs(seconds - 12)).toBeLessThanOrEqual(0.5);
  });

  it("gives the SAME video duration whether the scene renders as motion or stock", () => {
    // planSceneVisualDurationSeconds runs before the treatment branch, so the
    // Auto->motion path and a stock path must produce the same length.
    const motion = renderedVideoSeconds(adSpec(30, "auto_hybrid", "auto"), [2, 2, 2]);
    const stock = renderedVideoSeconds(adSpec(30, "auto_hybrid", "stock"), [2, 2, 2]);
    expect(motion).toBe(stock);
    expect(Math.abs(motion - 30)).toBeLessThanOrEqual(0.5);
  });

  it("does not clip speech: a scene with long narration still fits all of it", () => {
    // 30s / 3 scenes = 10s budget, but scene 0 has 14s of speech.
    const timeline = resolveProductionTimeline(adSpec(30, "auto_hybrid", "auto"), 25);
    const d = planSceneVisualDurationSeconds({
      speechSeconds: 14,
      resolvedSceneBudgetSeconds: timeline.scenes[0].durationSeconds,
      isLastScene: false,
    });
    expect(d).toBeGreaterThanOrEqual(14 + 0.16);
  });

  it("the intentional hold of a full-budget motion scene is not counted as dead air", () => {
    const audio = new AudioMasteringService({} as never);
    // 10s scene, 3s speech -> ~6.84s of held motion + music between scenes.
    const holdMs = Math.round((10 - 3 - 0.16) * 1000);
    const report = audio.analyzeDeadAir([
      { sceneIndex: 0, startMs: 0, endMs: 3000, intentionalHoldMs: holdMs },
      { sceneIndex: 1, startMs: 10000, endMs: 13000, intentionalHoldMs: holdMs },
      { sceneIndex: 2, startMs: 20000, endMs: 23000 },
    ]);
    expect(report.hasDeadAir).toBe(false);
    expect(report.hasSuspiciousPauses).toBe(false);
    expect(report.maxNarrationSilenceMs).toBeLessThanOrEqual(200);
  });
});

describe("V2.3.1: customer-safe render failure classification", () => {
  it("maps the Pexels-exhausted failure to a visuals category without leaking the raw message", () => {
    const raw =
      "Pexels search exhausted 8 terms (timeouts=0, noResults=0, rejected=0); attempted: cinematic hero shot, modern lifestyle";
    const result = classifyRenderFailure(raw);
    expect(result.category).toBe("STOCK_COVERAGE_FAILURE");
    expect(result.message).not.toContain("Pexels search exhausted");
    expect(result.message).not.toMatch(/timeouts=|attempted:/);
  });

  it("classifies resource, asset and composition failures into their own recoverable categories", () => {
    expect(classifyRenderFailure("spawn ffmpeg ENOMEM").category).toBe("RESOURCE_EXHAUSTION");
    expect(classifyRenderFailure("Chromium process was killed (SIGKILL)").category).toBe("RESOURCE_EXHAUSTION");
    expect(classifyRenderFailure("ENOENT: no such file /app/data/temp/scene_0.mp4").category).toBe(
      "FINAL_MEDIA_VALIDATION",
    );
    expect(classifyRenderFailure("moov atom not found").category).toBe("FINAL_MEDIA_VALIDATION");
    expect(classifyRenderFailure("ffmpeg exited with code 1 during concat").category).toBe(
      "FFMPEG_FAILURE",
    );
    expect(classifyRenderFailure("something entirely unexpected").category).toBe("UNKNOWN");
  });

  it("never returns a message containing a path, an env var name or a command line", () => {
    const messages = [
      "ENOENT: /app/data/videos/abc.mp4 missing",
      "PEXELS_API_KEY is not configured",
      "ffmpeg -i /tmp/x.mp4 -vf scale=1080:1920 out.mp4 failed",
    ].map((raw) => classifyRenderFailure(raw).message);
    for (const message of messages) {
      expect(message).not.toMatch(/\/app\/|\.mp4|_API_KEY|ffmpeg -/);
    }
  });
});

describe("V2.3.1: the Job Details surface from the incident is localised", () => {
  const DETAIL_KEYS = [
    "productions.detail.executionProgress",
    "productions.detail.started",
    "productions.detail.completed",
    "productions.detail.durationLabel",
    "productions.detail.lastUpdate",
    "productions.detail.executionError",
    "productions.detail.specs",
    "productions.detail.creationMode",
    "productions.detail.languageDialect",
    "productions.detail.aspectRatio",
    "productions.detail.targetDuration",
    "productions.detail.qualityProfile",
    "productions.detail.visualProvider",
    "productions.detail.voiceSynth",
    "productions.detail.estimatedCost",
    "productions.detail.costFree",
    "productions.detail.pending",
    "productions.detail.inProgress",
    "productions.detail.orchestrationActive",
  ];

  it("has an English and a real-Arabic string for every Job Details key", () => {
    const arabicScript = /[؀-ۿ]/;
    for (const key of DETAIL_KEYS) {
      expect(CATALOGS.en[key], `en ${key}`).toBeTruthy();
      expect(CATALOGS.ar[key], `ar ${key}`).toBeTruthy();
      expect(arabicScript.test(CATALOGS.ar[key]), `ar script ${key}`).toBe(true);
    }
  });

  it("no longer hard-codes the incident's labels in JobDetails.tsx", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "..", "ui", "pages", "JobDetails.tsx"),
      "utf8",
    );
    for (const literal of [
      'title="Execution Progress"',
      'title="Production Specs"',
      ">Creation Mode<",
      ">Language / Dialect<",
      ">Aspect Ratio<",
      ">Target Duration<",
      ">Quality Profile<",
      ">Visual Provider<",
      ">Voice Synthesizer<",
      ">Estimated Cost<",
      "STARTED",
      "COMPLETED",
      "LAST UPDATE",
      "Job Execution Error:",
      '"Free ($0.00)"',
    ]) {
      expect(source.includes(literal), `still hard-codes ${literal}`).toBe(false);
    }
  });
});
