/**
 * VISUAL TREATMENT VOCABULARY
 * ---------------------------
 * The set of ways a narration segment can be shown. Before F2 the router chose
 * between stock footage and (occasionally) a website mockup, so a twenty-second
 * advertisement was six stock clips and two mockups regardless of what the
 * script actually said. A line containing "70%" and a line containing "call us
 * today" were rendered the same way.
 *
 * These treatments all map onto runtimes that really exist in this engine:
 * stock providers, the website mockup renderer, the Motion Canvas templates and
 * uploaded/product media. Nothing here is aspirational.
 */

export type VisualTreatment =
  | "STOCK_FOOTAGE"
  | "UPLOADED_MEDIA"
  | "WEBSITE_MOCKUP"
  | "DEVICE_MOCKUP"
  | "PRODUCT_HERO"
  | "PRODUCT_COMPOSITION"
  | "KINETIC_TYPOGRAPHY"
  | "MOTION_GRAPHICS"
  | "ANIMATED_EXPLAINER"
  | "STATS_CARD"
  | "FEATURE_LIST"
  | "COMPARISON"
  | "PROCESS_STEPS"
  | "TIMELINE"
  | "QUOTE_CALLOUT"
  | "BEFORE_AFTER"
  | "CTA_SCENE";

export const ALL_TREATMENTS: VisualTreatment[] = [
  "STOCK_FOOTAGE",
  "UPLOADED_MEDIA",
  "WEBSITE_MOCKUP",
  "DEVICE_MOCKUP",
  "PRODUCT_HERO",
  "PRODUCT_COMPOSITION",
  "KINETIC_TYPOGRAPHY",
  "MOTION_GRAPHICS",
  "ANIMATED_EXPLAINER",
  "STATS_CARD",
  "FEATURE_LIST",
  "COMPARISON",
  "PROCESS_STEPS",
  "TIMELINE",
  "QUOTE_CALLOUT",
  "BEFORE_AFTER",
  "CTA_SCENE",
];

/** Which runtime actually produces each treatment. */
export type TreatmentRuntime = "stock" | "mockup" | "motion" | "upload" | "product";

export const TREATMENT_RUNTIME: Record<VisualTreatment, TreatmentRuntime> = {
  STOCK_FOOTAGE: "stock",
  UPLOADED_MEDIA: "upload",
  WEBSITE_MOCKUP: "mockup",
  DEVICE_MOCKUP: "mockup",
  PRODUCT_HERO: "product",
  PRODUCT_COMPOSITION: "product",
  KINETIC_TYPOGRAPHY: "motion",
  MOTION_GRAPHICS: "motion",
  ANIMATED_EXPLAINER: "motion",
  STATS_CARD: "motion",
  FEATURE_LIST: "motion",
  COMPARISON: "motion",
  PROCESS_STEPS: "motion",
  TIMELINE: "motion",
  QUOTE_CALLOUT: "motion",
  BEFORE_AFTER: "motion",
  CTA_SCENE: "motion",
};

/**
 * The Motion Canvas template each motion-backed treatment renders through.
 * Only templates the MotionEngine really implements appear here.
 */
export const TREATMENT_MOTION_TEMPLATE: Partial<
  Record<VisualTreatment, "kinetic_typography" | "stat_animation" | "feature_list" | "cta_card" | "logo_reveal" | "explainer_diagram">
> = {
  KINETIC_TYPOGRAPHY: "kinetic_typography",
  STATS_CARD: "stat_animation",
  FEATURE_LIST: "feature_list",
  COMPARISON: "feature_list",
  PROCESS_STEPS: "explainer_diagram",
  TIMELINE: "explainer_diagram",
  ANIMATED_EXPLAINER: "explainer_diagram",
  MOTION_GRAPHICS: "kinetic_typography",
  QUOTE_CALLOUT: "kinetic_typography",
  BEFORE_AFTER: "feature_list",
  CTA_SCENE: "cta_card",
};

/**
 * Deterministic fallback chain. Every treatment must degrade to something that
 * still fills the frame, so a missing capability never leaves a blank scene.
 */
export const TREATMENT_FALLBACK: Record<VisualTreatment, VisualTreatment | null> = {
  STOCK_FOOTAGE: "MOTION_GRAPHICS",
  UPLOADED_MEDIA: "STOCK_FOOTAGE",
  WEBSITE_MOCKUP: "DEVICE_MOCKUP",
  DEVICE_MOCKUP: "MOTION_GRAPHICS",
  PRODUCT_HERO: "PRODUCT_COMPOSITION",
  PRODUCT_COMPOSITION: "STOCK_FOOTAGE",
  KINETIC_TYPOGRAPHY: "MOTION_GRAPHICS",
  MOTION_GRAPHICS: "STOCK_FOOTAGE",
  ANIMATED_EXPLAINER: "MOTION_GRAPHICS",
  STATS_CARD: "KINETIC_TYPOGRAPHY",
  FEATURE_LIST: "KINETIC_TYPOGRAPHY",
  COMPARISON: "FEATURE_LIST",
  PROCESS_STEPS: "FEATURE_LIST",
  TIMELINE: "PROCESS_STEPS",
  QUOTE_CALLOUT: "KINETIC_TYPOGRAPHY",
  BEFORE_AFTER: "COMPARISON",
  CTA_SCENE: "KINETIC_TYPOGRAPHY",
  // MOTION_GRAPHICS -> STOCK_FOOTAGE -> MOTION_GRAPHICS would loop; the
  // resolver caps chain depth so this terminates.
};

/** Treatments that need no external provider and always work offline. */
export const OFFLINE_SAFE: VisualTreatment[] = ALL_TREATMENTS.filter(
  (treatment) => TREATMENT_RUNTIME[treatment] === "motion",
);

export function isMotionTreatment(treatment: VisualTreatment): boolean {
  return TREATMENT_RUNTIME[treatment] === "motion";
}

/**
 * Whether a scene must be rendered through the motion runtime instead of a
 * stock clip.
 *
 * True when the production is an explicitly graphic mode, when the scene itself
 * asked for motion graphics, or - the case that shipped broken in v2.3.0 - when
 * the creative plan resolved the scene to a motion treatment. The plan does that
 * whenever the preferred stock treatment is unavailable (no Pexels/Pixabay key),
 * falling every scene down to offline motion graphics. The renderer used to
 * check only the first two conditions, so an Auto production on a host with no
 * stock provider still walked the stock path and failed the whole job at
 * "Pexels search exhausted all terms" even though the plan had already chosen a
 * motion treatment that needs no network.
 */
export function sceneRendersAsMotion(input: {
  productionMode?: string | null;
  visualMode?: string | null;
  sceneVisualSource?: string | null;
  plannedTreatmentRuntime?: TreatmentRuntime | null;
}): boolean {
  return (
    input.productionMode === "motion_graphics" ||
    input.productionMode === "animated_explainer" ||
    input.visualMode === "motion_graphics" ||
    input.sceneVisualSource === "motion_graphics" ||
    input.plannedTreatmentRuntime === "motion"
  );
}

/**
 * Walks the fallback chain until it finds a treatment the runtime can serve.
 * Depth-capped so a cycle in the table cannot hang the planner.
 */
export function resolveAvailableTreatment(
  preferred: VisualTreatment,
  isAvailable: (treatment: VisualTreatment) => boolean,
  maxDepth = 5,
): { treatment: VisualTreatment; fellBackFrom?: VisualTreatment; reason?: string } {
  let current: VisualTreatment | null = preferred;
  const seen = new Set<VisualTreatment>();

  for (let depth = 0; depth < maxDepth && current; depth++) {
    if (seen.has(current)) break;
    seen.add(current);
    if (isAvailable(current)) {
      return current === preferred
        ? { treatment: current }
        : {
            treatment: current,
            fellBackFrom: preferred,
            reason: `${preferred} unavailable; used ${current}`,
          };
    }
    current = TREATMENT_FALLBACK[current];
  }

  // Motion templates need no provider, so this is the guaranteed floor.
  return {
    treatment: "MOTION_GRAPHICS",
    fellBackFrom: preferred,
    reason: `${preferred} and its fallbacks unavailable; used offline motion graphics`,
  };
}
