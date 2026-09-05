import { describe, expect, it } from "vitest";

import { buildCreativePlan } from "../server/v2/creative/creativePlan";
import {
  buildTreatmentAvailabilityPredicate,
  sceneRendersAsMotion,
} from "../server/v2/creative/visualTreatment";

/**
 * V2.4 PASS 4 - TRUE VISUAL BED
 * -----------------------------
 * Real customer incident cmtehsptj000108ledzk3f3ji: a 20s Auto Professional
 * advertisement (productionMode "auto_hybrid", visualMode "auto", both
 * Pexels and Pixabay configured) rendered its final ~5 seconds as a
 * full-screen Motion Canvas CTA card instead of real footage.
 *
 * Root cause: `isTreatmentAvailable` considered the motion runtime
 * "available" purely because the local Motion Canvas venv was installed, with
 * no regard for whether real stock footage was actually configured. Every
 * scene with `purpose: "cta"` classifies as `CTA_SCENE`, which maps
 * unconditionally onto the motion runtime, so the CTA scene always won a
 * full-screen graphic even though Pexels/Pixabay were healthy and the scene's
 * own ProductionSpec said `visualSource: "stock"`.
 */

// The exact three-scene shape from the incident's stored ProductionSpec.
const INCIDENT_SCENES = [
  {
    sceneIndex: 0,
    narration: "Are you losing valuable potential clients every day because your small business website looks outdated?",
    purpose: "hook",
    durationSeconds: 6.7,
  },
  {
    sceneIndex: 1,
    narration: "ABUD Demo builds clean, lightning fast, mobile friendly websites that showcase your services and earn instant trust.",
    purpose: "solution",
    durationSeconds: 6.7,
  },
  {
    sceneIndex: 2,
    narration: "Make your business look professional.",
    purpose: "cta",
    durationSeconds: 6.6,
  },
];

describe("V2.4 Pass 4: professional Auto never gives the CTA scene a full-screen motion bed", () => {
  it("reproduces the incident's availability shape: motion available, stock ALSO available", () => {
    // Both providers configured, exactly like the incident job.
    const isTreatmentAvailable = buildTreatmentAvailabilityPredicate({
      graphicOnlyMode: false,
      forceStockFootage: false,
      motionRuntimeAvailable: true,
      stockRuntimeAvailable: true,
      hasUploadedMedia: false,
      hasProductMedia: false,
    });

    const plan = buildCreativePlan({
      productionMode: "auto_hybrid",
      scenes: INCIDENT_SCENES,
      isTreatmentAvailable,
    });

    const ctaScene = plan.sceneTreatments.find((scene) => scene.purpose === "cta");
    expect(ctaScene).toBeDefined();
    expect(ctaScene!.runtime, "CTA scene must use a real visual bed, not motion").not.toBe("motion");
    expect(ctaScene!.treatment).not.toBe("CTA_SCENE");

    // Every scene in this production gets a real bed - not just the CTA.
    for (const scene of plan.sceneTreatments) {
      expect(scene.runtime, `scene ${scene.sceneIndex} (${scene.purpose})`).not.toBe("motion");
    }

    // And the renderer must not send this scene down the motion path either.
    expect(
      sceneRendersAsMotion({
        productionMode: "auto_hybrid",
        visualMode: "auto",
        sceneVisualSource: "stock",
        plannedTreatmentRuntime: ctaScene!.runtime,
      }),
    ).toBe(false);
  });

  it("still degrades to motion when no real visual source exists at all (V2.3.1 offline behavior preserved)", () => {
    const isTreatmentAvailable = buildTreatmentAvailabilityPredicate({
      graphicOnlyMode: false,
      forceStockFootage: false,
      motionRuntimeAvailable: true,
      stockRuntimeAvailable: false,
      hasUploadedMedia: false,
      hasProductMedia: false,
    });

    const plan = buildCreativePlan({
      productionMode: "auto_hybrid",
      scenes: INCIDENT_SCENES,
      isTreatmentAvailable,
    });

    // No scene may fall onto the (unavailable) stock runtime...
    for (const scene of plan.sceneTreatments) {
      expect(scene.runtime, `scene ${scene.sceneIndex}`).not.toBe("stock");
    }
    // ...and the CTA scene in particular has nothing left but motion.
    const ctaScene = plan.sceneTreatments.find((scene) => scene.purpose === "cta");
    expect(ctaScene!.runtime).toBe("motion");
  });

  it("keeps the CTA as a full-screen motion card only for an explicit graphics-led mode", () => {
    const isTreatmentAvailable = buildTreatmentAvailabilityPredicate({
      graphicOnlyMode: true,
      forceStockFootage: false,
      motionRuntimeAvailable: true,
      stockRuntimeAvailable: true,
      hasUploadedMedia: false,
      hasProductMedia: false,
    });

    const plan = buildCreativePlan({
      productionMode: "motion_graphics",
      scenes: INCIDENT_SCENES,
      isTreatmentAvailable,
    });

    const ctaScene = plan.sceneTreatments.find((scene) => scene.purpose === "cta");
    expect(ctaScene!.runtime).toBe("motion");
  });

  it("also keeps a plain stat/feature scene off the motion bed in professional Auto when stock is configured", () => {
    const isTreatmentAvailable = buildTreatmentAvailabilityPredicate({
      graphicOnlyMode: false,
      forceStockFootage: false,
      motionRuntimeAvailable: true,
      stockRuntimeAvailable: true,
      hasUploadedMedia: false,
      hasProductMedia: false,
    });

    const plan = buildCreativePlan({
      productionMode: "auto_hybrid",
      scenes: [
        { sceneIndex: 0, narration: "3 reasons your business needs a modern website", purpose: "hook", durationSeconds: 6 },
        { sceneIndex: 1, narration: "First we design, then we build, finally we launch", purpose: "process", durationSeconds: 7 },
      ],
      isTreatmentAvailable,
    });

    for (const scene of plan.sceneTreatments) {
      expect(scene.runtime, `scene ${scene.sceneIndex}`).not.toBe("motion");
    }
  });
});
