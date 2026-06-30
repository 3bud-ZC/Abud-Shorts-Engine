import { logger } from "../logger";
import type { SceneInput, SceneInputWithFallback } from "../types/shorts";
import type {
  BusinessTemplate,
  BusinessTemplateId,
} from "./business-templates";
import { MAX_NARRATION_CHAR_LENGTH } from "./constants";
import type { TemplateData } from "./templateSceneFactory";
import { generateScenesForTemplate } from "./templateSceneFactory";

export class TemplateNarrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateNarrationError";
  }
}

function mergeSearchTerms(
  sceneTerms: string[],
  templateHints: string[],
): string[] {
  const cleanedSceneTerms = (sceneTerms || []).map((term) => term.trim());
  const merged = [...cleanedSceneTerms, ...templateHints];
  const deduped = merged
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
  return Array.from(new Set(deduped));
}

function deriveTemplateDataSearchTerms(templateData?: TemplateData): string[] {
  if (!templateData) {
    return [];
  }

  return Object.values(templateData)
    .flatMap((value) =>
      value
        .split(/[,،]/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    )
    .slice(0, 8);
}

const TRUNCATION_SUFFIX = "…";
const INSTRUCTIONAL_MARKERS = ["HOOK", "CTA"];

export type GeneratedScene = {
  text: string;
  searchTerms?: string[];
};

function normalizeForComparison(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function sanitizeNarrationText(
  text: string,
  templateId: BusinessTemplateId,
  sceneIndex: number,
): string {
  const condensed = text.replace(/\s+/g, " ").trim();
  if (!condensed) {
    return "";
  }

  if (condensed.length <= MAX_NARRATION_CHAR_LENGTH) {
    return condensed;
  }

  logger.warn(
    { templateId, sceneIndex, length: condensed.length },
    "Narration text exceeded character limit; truncating.",
  );
  return (
    condensed.slice(0, MAX_NARRATION_CHAR_LENGTH - TRUNCATION_SUFFIX.length).trimEnd() +
    TRUNCATION_SUFFIX
  );
}

function assertNarrationIsSpoken(
  narration: string,
  template: BusinessTemplate,
  sceneIndex: number,
): void {
  const normalizedNarration = normalizeForComparison(narration);
  const normalizedExample = normalizeForComparison(template.examplePrompt);

  if (normalizedNarration === normalizedExample) {
    throw new TemplateNarrationError(
      `Template ${template.id} scene ${sceneIndex + 1} resolved to instructional example text.`,
    );
  }

  const upperNarration = narration.toUpperCase();
  const offendingMarker = INSTRUCTIONAL_MARKERS.find((marker) =>
    upperNarration.includes(marker),
  );

  if (offendingMarker) {
    throw new TemplateNarrationError(
      `Template ${template.id} scene ${sceneIndex + 1} still contains internal guidance (${offendingMarker}).`,
    );
  }
}

function shouldAutoGenerateScenes(
  scenes: SceneInput[],
  template: BusinessTemplate,
): boolean {
  if (!scenes.length) {
    return true;
  }
  const templatePrompt = template.examplePrompt?.trim().toLowerCase();
  return scenes.every((scene) => {
    const text = scene.text?.trim();
    if (!text) {
      return true;
    }
    if (templatePrompt && text.toLowerCase() === templatePrompt) {
      return true;
    }
    return false;
  });
}

export function clampSceneCount(sceneInputs: GeneratedScene[]): GeneratedScene[] {
  return sceneInputs.slice(0, 4);
}

export function ensureScenes(
  scenes: SceneInput[],
  template: BusinessTemplate,
  templateData?: TemplateData,
): GeneratedScene[] {
  if (shouldAutoGenerateScenes(scenes, template)) {
    const generated = generateScenesForTemplate(template.id, templateData);
    if (generated?.length) {
      return clampSceneCount(generated);
    }
  }

  return scenes.map((scene) => ({
    text: scene.text || template.examplePrompt,
    searchTerms: scene.searchTerms,
  }));
}

export function applyBusinessTemplateToScenes(
  scenes: SceneInput[],
  template: BusinessTemplate,
  templateData?: TemplateData,
): SceneInputWithFallback[] {
  const sceneBlueprints = ensureScenes(scenes, template, templateData);
  const searchHints = mergeSearchTerms(
    template.pexelsSearchHints,
    deriveTemplateDataSearchTerms(templateData),
  );
  const fallbackHints = mergeSearchTerms(
    template.fallbackPexelsSearchHints,
    [],
  );

  return sceneBlueprints.map((scene, index) => {
    const narration = sanitizeNarrationText(
      scene.text || template.examplePrompt,
      template.id,
      index,
    );

    if (!narration) {
      throw new TemplateNarrationError(
        `Template ${template.id} scene ${index + 1} produced empty narration after sanitization.`,
      );
    }

    assertNarrationIsSpoken(narration, template, index);

    return {
      text: narration,
      searchTerms: mergeSearchTerms(scene.searchTerms || [], searchHints),
      fallbackSearchTerms: fallbackHints,
    };
  });
}
