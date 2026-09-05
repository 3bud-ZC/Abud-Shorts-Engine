import type { ProductionSceneSpec, ProductionSpec } from "../../../types/productionSpec";

export type BudgetMode = "free_only" | "smart_budget" | "best_available";

export type ProviderBudgetPolicy = {
  mode: BudgetMode;
  maxExternalSpendUsd: number | null;
  paidCallsAllowed: boolean;
};

export type HeroShotAllocation = {
  sceneIndex: number;
  source: "stock" | "generated";
  eligible: boolean;
  creativeValue: number;
  estimatedCostUsd: number | null;
  budgetAccepted: boolean;
  reason: string;
};

const DEFAULT_GENERATED_SHOT_ESTIMATE_USD = 1;

export function resolveProviderBudgetPolicy(input: {
  visualSource?: string;
  budgetMode?: string;
  maxExternalSpendUsd?: number | string | null;
  paidCallsAllowed?: boolean;
}): ProviderBudgetPolicy {
  const mode: BudgetMode =
    input.budgetMode === "smart_budget" || input.visualSource === "auto_budget"
      ? "smart_budget"
      : input.budgetMode === "best_available" || input.visualSource === "ai_generated" || input.visualSource === "mixed"
        ? "best_available"
        : "free_only";
  const parsedCeiling = Number(input.maxExternalSpendUsd);
  const maxExternalSpendUsd =
    mode === "free_only"
      ? 0
      : Number.isFinite(parsedCeiling) && parsedCeiling >= 0
        ? Math.round(parsedCeiling * 100) / 100
        : mode === "smart_budget"
          ? DEFAULT_GENERATED_SHOT_ESTIMATE_USD
          : null;

  return {
    mode,
    maxExternalSpendUsd,
    paidCallsAllowed: input.paidCallsAllowed === true && mode !== "free_only",
  };
}

function heroShotValue(scene: ProductionSceneSpec): number {
  const text = [
    scene.purpose,
    scene.visualIntent,
    scene.visualPrompt,
    scene.narration,
    ...(scene.stockSearchTerms || []),
  ].join(" ").toLowerCase();
  let score = 0;
  if (scene.sceneIndex === 0 || scene.purpose === "hook") score += 45;
  if (/hero|reveal|transform|impossible|cinematic|concept|dream|future|product/.test(text)) score += 35;
  if (/restaurant|airplane|office|city|business|people working|cafe|street|generic/.test(text)) score -= 35;
  if (scene.visualSource === "uploaded_media" || scene.visualSource === "product_composition") score -= 25;
  return Math.max(0, Math.min(100, score));
}

export function allocateHeroShots(
  spec: Pick<ProductionSpec, "scenes">,
  policy: ProviderBudgetPolicy,
  options: { estimatedShotCostUsd?: number; maxGeneratedShots?: number } = {},
): HeroShotAllocation[] {
  const estimatedShotCostUsd = Math.max(0, options.estimatedShotCostUsd ?? DEFAULT_GENERATED_SHOT_ESTIMATE_USD);
  const maxGeneratedShots = Math.max(0, options.maxGeneratedShots ?? 1);
  let remainingBudget = policy.maxExternalSpendUsd;
  let generatedCount = 0;

  return [...(spec.scenes || [])]
    .map((scene) => ({ scene, creativeValue: heroShotValue(scene) }))
    .sort((a, b) => b.creativeValue - a.creativeValue || a.scene.sceneIndex - b.scene.sceneIndex)
    .map(({ scene, creativeValue }) => {
      const eligible = creativeValue >= 55;
      const canSpend =
        policy.paidCallsAllowed &&
        policy.mode !== "free_only" &&
        eligible &&
        generatedCount < maxGeneratedShots &&
        (remainingBudget == null || remainingBudget >= estimatedShotCostUsd);

      if (canSpend) {
        generatedCount += 1;
        if (remainingBudget != null) remainingBudget = Math.round((remainingBudget - estimatedShotCostUsd) * 100) / 100;
      }

      const source: HeroShotAllocation["source"] = canSpend ? "generated" : "stock";
      return {
        sceneIndex: scene.sceneIndex,
        source,
        eligible,
        creativeValue,
        estimatedCostUsd: eligible ? estimatedShotCostUsd : 0,
        budgetAccepted: canSpend,
        reason: canSpend
          ? "AI hero shot selected because it has high creative value and fits the configured budget."
          : eligible
            ? "Stock selected because paid generation is disabled, the provider is unavailable, or the budget ceiling was reached."
            : "Stock selected because the scene is ordinary B-roll or authentic uploaded media is preferred.",
      };
    })
    .sort((a, b) => a.sceneIndex - b.sceneIndex);
}

export class ProviderCircuitBreaker {
  private failures = new Map<string, { count: number; openedUntil: number }>();

  constructor(private threshold = 3, private cooldownMs = 5 * 60 * 1000) {}

  public recordSuccess(providerId: string): void {
    this.failures.delete(providerId);
  }

  public recordFailure(providerId: string, now = Date.now()): void {
    const current = this.failures.get(providerId) || { count: 0, openedUntil: 0 };
    const count = current.count + 1;
    this.failures.set(providerId, {
      count,
      openedUntil: count >= this.threshold ? now + this.cooldownMs : 0,
    });
  }

  public isOpen(providerId: string, now = Date.now()): boolean {
    const current = this.failures.get(providerId);
    return Boolean(current && current.openedUntil > now);
  }

  public priorityPenalty(providerId: string, now = Date.now()): number {
    return this.isOpen(providerId, now) ? 1000 : 0;
  }
}
