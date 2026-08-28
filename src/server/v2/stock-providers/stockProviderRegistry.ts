import { logger } from "../../../logger";
import { PexelsStockProvider } from "./pexelsProvider";
import { PixabayProvider } from "./pixabayProvider";
import type {
  StockAttribution,
  StockCandidate,
  StockProvider,
  StockProviderId,
  StockSearchRequest,
} from "./types";

/**
 * STOCK PROVIDER REGISTRY
 * -----------------------
 * Asks every configured source for candidates and scores them together, so the
 * winning clip is the best available across providers rather than the first
 * acceptable result from one.
 *
 * Pexels stays behind its existing client (which already owns Pexels-specific
 * scoring and smart-window selection); this registry adds the second source and
 * the cross-provider de-duplication and diversity rules.
 */

export type ScoredCandidate = StockCandidate & {
  qualityScore: number;
  semanticScore: number;
  totalScore: number;
};

/** Portrait 9:16 wants height >= width and enough pixels to survive a crop. */
export function scoreCandidateQuality(
  candidate: StockCandidate,
  request: StockSearchRequest,
): number {
  let score = 50;
  const { width, height } = candidate;
  if (!width || !height) return 20;

  const aspect = height / width;
  if (request.orientation === "portrait") {
    if (aspect >= 1.6) score += 25;
    else if (aspect >= 1.2) score += 15;
    else if (aspect >= 1) score += 6;
    else score -= 12;
  } else if (request.orientation === "landscape") {
    if (aspect <= 0.62) score += 22;
    else if (aspect <= 1) score += 10;
    else score -= 12;
  }

  const shortestSide = Math.min(width, height);
  if (shortestSide >= 1080) score += 18;
  else if (shortestSide >= 720) score += 10;
  else if (shortestSide < 480) score -= 20;

  if (candidate.kind === "video" && candidate.durationSeconds) {
    // Very short clips leave no room to pick a clean window; very long ones are
    // usually compilations with unrelated content.
    if (candidate.durationSeconds >= 6 && candidate.durationSeconds <= 40) score += 10;
    else if (candidate.durationSeconds < 3) score -= 15;
    else if (candidate.durationSeconds > 90) score -= 8;
  }

  return Math.max(0, Math.min(100, score));
}

/** Token overlap between the intent phrase and the asset's own tags. */
export function scoreCandidateSemantics(candidate: StockCandidate, query: string): number {
  const queryTokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2);
  if (queryTokens.length === 0) return 50;
  const tags = (candidate.tags || []).map((tag) => tag.toLowerCase());
  if (tags.length === 0) return 45;
  const hits = queryTokens.filter((token) => tags.some((tag) => tag.includes(token)));
  return Math.round(40 + (hits.length / queryTokens.length) * 60);
}

/**
 * Removes assets that would read as repetition:
 *  - the same provider asset twice
 *  - several clips from one contributor, which are usually the same shoot
 *  - near-identical tag sets, which are usually the same scene re-uploaded
 */
export function dedupeCandidates(
  candidates: ScoredCandidate[],
  options: { maxPerContributor?: number; tagOverlapLimit?: number } = {},
): ScoredCandidate[] {
  const maxPerContributor = options.maxPerContributor ?? 1;
  const tagOverlapLimit = options.tagOverlapLimit ?? 0.8;

  const seenAssets = new Set<string>();
  const contributorCounts = new Map<string, number>();
  const keptTagSets: Array<Set<string>> = [];
  const kept: ScoredCandidate[] = [];

  for (const candidate of [...candidates].sort((a, b) => b.totalScore - a.totalScore)) {
    const assetKey = `${candidate.provider}:${candidate.id}`;
    if (seenAssets.has(assetKey)) continue;

    const contributorKey = `${candidate.provider}:${(candidate.contributor || "").toLowerCase()}`;
    if (candidate.contributor) {
      const count = contributorCounts.get(contributorKey) || 0;
      if (count >= maxPerContributor) continue;
    }

    const tagSet = new Set((candidate.tags || []).map((tag) => tag.toLowerCase()));
    if (tagSet.size > 0) {
      const tooSimilar = keptTagSets.some((existing) => {
        if (existing.size === 0) return false;
        let shared = 0;
        tagSet.forEach((tag) => {
          if (existing.has(tag)) shared += 1;
        });
        return shared / Math.min(existing.size, tagSet.size) >= tagOverlapLimit;
      });
      if (tooSimilar) continue;
      keptTagSets.push(tagSet);
    }

    seenAssets.add(assetKey);
    if (candidate.contributor) {
      contributorCounts.set(contributorKey, (contributorCounts.get(contributorKey) || 0) + 1);
    }
    kept.push(candidate);
  }

  return kept;
}

export class StockProviderRegistry {
  private providers = new Map<StockProviderId, StockProvider>();

  constructor(providers: StockProvider[] = [new PexelsStockProvider(), new PixabayProvider()]) {
    providers.forEach((provider) => this.providers.set(provider.id, provider));
  }

  public register(provider: StockProvider): void {
    this.providers.set(provider.id, provider);
  }

  public get(id: StockProviderId): StockProvider | undefined {
    return this.providers.get(id);
  }

  /** Providers that hold a usable credential right now. */
  public configuredProviders(): StockProvider[] {
    return Array.from(this.providers.values()).filter((provider) => provider.isConfigured());
  }

  public isProviderConfigured(id: StockProviderId): boolean {
    return Boolean(this.providers.get(id)?.isConfigured());
  }

  /**
   * Queries every configured provider, scores the union and returns a
   * de-duplicated, ranked list. A provider that fails is logged and skipped -
   * one source being down never fails the render.
   */
  public async searchAll(request: StockSearchRequest): Promise<ScoredCandidate[]> {
    const providers = this.configuredProviders();
    if (providers.length === 0) return [];

    const settled = await Promise.allSettled(
      providers.map((provider) => provider.search(request)),
    );

    const all: ScoredCandidate[] = [];
    settled.forEach((result, index) => {
      if (result.status === "rejected") {
        logger.warn(
          { provider: providers[index].id, reason: String(result.reason) },
          "Stock provider search failed; continuing with the remaining sources",
        );
        return;
      }
      result.value.forEach((candidate) => {
        const qualityScore = scoreCandidateQuality(candidate, request);
        const semanticScore = scoreCandidateSemantics(candidate, request.query);
        all.push({
          ...candidate,
          qualityScore,
          semanticScore,
          // Relevance leads; quality breaks ties between relevant clips.
          totalScore: Math.round(semanticScore * 0.6 + qualityScore * 0.4),
        });
      });
    });

    return dedupeCandidates(all);
  }

  public async searchQueries(requests: StockSearchRequest[]): Promise<ScoredCandidate[]> {
    const settled = await Promise.allSettled(requests.map((request) => this.searchAll(request)));
    const combined: ScoredCandidate[] = [];
    settled.forEach((result, index) => {
      if (result.status === "rejected") {
        logger.warn(
          { query: requests[index]?.query, reason: String(result.reason) },
          "Stock query failed; continuing with remaining query families",
        );
        return;
      }
      combined.push(...result.value);
    });
    return dedupeCandidates(combined);
  }

  public attributionFor(candidate: StockCandidate): StockAttribution | null {
    const provider = this.providers.get(candidate.provider);
    return provider ? provider.attributionFor(candidate) : null;
  }
}
