import type { VisualIntent, StockAssetCandidate } from "./types";

export type AssetScoringOptions = {
  queryTerms: string[];
  visualIntent?: VisualIntent;
  orientation?: "portrait" | "landscape";
  targetDurationSeconds?: number;
  previouslyUsedIds?: (string | number)[];
  previouslyUsedCreators?: string[];
};

export type AssetScoreResult = {
  score: number; // 0 - 100
  passed: boolean;
  reasons: string[];
  breakdown: {
    orientationScore: number;
    resolutionScore: number;
    durationScore: number;
    relevanceScore: number;
    diversityScore: number;
    duplicatePenalty: number;
  };
};

/**
 * Deterministically ranks and scores stock media assets for intelligent selection.
 */
export function scoreStockAsset(
  candidate: StockAssetCandidate,
  options: AssetScoringOptions,
): AssetScoreResult {
  const reasons: string[] = [];
  const {
    queryTerms = [],
    orientation = "portrait",
    targetDurationSeconds = 5,
    previouslyUsedIds = [],
    previouslyUsedCreators = [],
  } = options;

  let duplicatePenalty = 0;
  if (previouslyUsedIds.some((id) => String(id) === String(candidate.id))) {
    duplicatePenalty = -1000;
    reasons.push("Duplicate asset already used in video");
  }

  // 1. Orientation score (max 25)
  let orientationScore = 10;
  const isCandidateVertical = candidate.height > candidate.width;
  const isCandidateHorizontal = candidate.width > candidate.height;

  if (orientation === "portrait") {
    if (isCandidateVertical) {
      orientationScore = 25;
      reasons.push("Ideal 9:16 vertical orientation match");
    } else if (candidate.width === candidate.height) {
      orientationScore = 15;
    } else {
      orientationScore = 5;
      reasons.push("Landscape clip in vertical video (will be center-cropped)");
    }
  } else {
    // landscape
    if (isCandidateHorizontal) {
      orientationScore = 25;
      reasons.push("Ideal 16:9 landscape orientation match");
    } else {
      orientationScore = 5;
      reasons.push("Vertical clip in landscape video (letterbox/crop)");
    }
  }

  // 2. Resolution & Dimensions score (max 25)
  let resolutionScore = 15;
  const minDimension = Math.min(candidate.width || 0, candidate.height || 0);
  const maxDimension = Math.max(candidate.width || 0, candidate.height || 0);

  if (maxDimension >= 1920 && minDimension >= 1080) {
    resolutionScore = 25;
    reasons.push("Full HD+ (1080p+) resolution");
  } else if (maxDimension >= 1280 && minDimension >= 720) {
    resolutionScore = 20;
    reasons.push("HD (720p) resolution");
  } else if (minDimension >= 480) {
    resolutionScore = 12;
  } else {
    resolutionScore = 5;
    reasons.push("Low resolution asset");
  }

  // 3. Duration fit (max 20)
  let durationScore = 10;
  if (candidate.duration >= targetDurationSeconds) {
    durationScore = 20;
    reasons.push(`Duration (${candidate.duration}s) satisfies scene need (${targetDurationSeconds}s)`);
  } else if (candidate.duration >= targetDurationSeconds * 0.75) {
    durationScore = 15;
    reasons.push(`Duration (${candidate.duration}s) close to target (${targetDurationSeconds}s)`);
  } else if (candidate.duration >= targetDurationSeconds * 0.5) {
    durationScore = 8;
  } else {
    durationScore = 3;
    reasons.push(`Clip too short (${candidate.duration}s vs ${targetDurationSeconds}s target)`);
  }

  // 4. Query & Tag Relevance score (max 20)
  let relevanceScore = 10;
  if (candidate.tags && candidate.tags.length > 0 && queryTerms.length > 0) {
    const candidateTagsLower = candidate.tags.map((t) => t.toLowerCase());
    let matchCount = 0;
    for (const term of queryTerms) {
      const tLower = term.toLowerCase();
      if (candidateTagsLower.some((tag) => tag.includes(tLower) || tLower.includes(tag))) {
        matchCount++;
      }
    }
    relevanceScore = Math.min(20, 10 + matchCount * 4);
    if (matchCount > 0) {
      reasons.push(`Matched ${matchCount} search keyword(s)`);
    }
  }

  // 5. Creator & Visual Diversity bonus (max 10)
  let diversityScore = 5;
  if (candidate.creator) {
    if (!previouslyUsedCreators.includes(candidate.creator)) {
      diversityScore = 10;
    } else {
      diversityScore = 2;
      reasons.push("Creator already featured in preceding scenes");
    }
  }

  const rawScore =
    orientationScore +
    resolutionScore +
    durationScore +
    relevanceScore +
    diversityScore +
    duplicatePenalty;

  const score = Math.max(0, Math.min(100, Math.round(rawScore)));
  const passed = score >= 40 && duplicatePenalty === 0;

  return {
    score,
    passed,
    reasons,
    breakdown: {
      orientationScore,
      resolutionScore,
      durationScore,
      relevanceScore,
      diversityScore,
      duplicatePenalty,
    },
  };
}

/**
 * Sorts candidates by score descending and returns the best candidate.
 */
export function selectBestCandidate(
  candidates: StockAssetCandidate[],
  options: AssetScoringOptions,
): { best: StockAssetCandidate | null; scoreResult: AssetScoreResult | null; ranked: { candidate: StockAssetCandidate; result: AssetScoreResult }[] } {
  if (!candidates.length) {
    return { best: null, scoreResult: null, ranked: [] };
  }

  const ranked = candidates
    .map((c) => ({
      candidate: c,
      result: scoreStockAsset(c, options),
    }))
    .sort((a, b) => b.result.score - a.result.score);

  const best = ranked[0]?.candidate || null;
  const scoreResult = ranked[0]?.result || null;

  return {
    best,
    scoreResult,
    ranked,
  };
}
