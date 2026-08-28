import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import { buildCreativePlan } from "../server/v2/creative/creativePlan";
import {
  TREATMENT_RUNTIME,
  sceneRendersAsMotion,
} from "../server/v2/creative/visualTreatment";
import { classifyRenderFailure } from "../server/v2/customerView";
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
});

describe("V2.3.1: customer-safe render failure classification", () => {
  it("maps the Pexels-exhausted failure to a visuals category without leaking the raw message", () => {
    const raw =
      "Pexels search exhausted 8 terms (timeouts=0, noResults=0, rejected=0); attempted: cinematic hero shot, modern lifestyle";
    const result = classifyRenderFailure(raw);
    expect(result.category).toBe("visuals_unavailable");
    expect(result.message).not.toContain("Pexels search exhausted");
    expect(result.message).not.toMatch(/timeouts=|attempted:/);
  });

  it("classifies resource, asset and composition failures into their own recoverable categories", () => {
    expect(classifyRenderFailure("spawn ffmpeg ENOMEM").category).toBe("resources");
    expect(classifyRenderFailure("Chromium process was killed (SIGKILL)").category).toBe("resources");
    expect(classifyRenderFailure("ENOENT: no such file /app/data/temp/scene_0.mp4").category).toBe(
      "asset_unreadable",
    );
    expect(classifyRenderFailure("moov atom not found").category).toBe("asset_unreadable");
    expect(classifyRenderFailure("ffmpeg exited with code 1 during concat").category).toBe(
      "composition",
    );
    expect(classifyRenderFailure("something entirely unexpected").category).toBe("unknown");
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
