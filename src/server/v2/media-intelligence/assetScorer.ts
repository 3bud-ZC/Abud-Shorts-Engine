import type { VisualIntent, StockAssetCandidate } from "./types";

export type AssetScoringOptions = {
  queryTerms: string[];
  visualIntent?: VisualIntent;
  orientation?: "portrait" | "landscape";
  targetDurationSeconds?: number;
  previouslyUsedIds?: (string | number)[];
  previouslyUsedCreators?: string[];
  previousCandidates?: StockAssetCandidate[];
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
    motionScore: number;
    cropSafetyScore: number;
    qualityScore: number;
    nearDuplicateRisk: number;
  };
};

function tokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\u0600-\u06ff]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2),
  );
}

export function estimateNearDuplicateRisk(
  candidate: StockAssetCandidate,
  previousCandidates: StockAssetCandidate[] = [],
): number {
  const currentText = [
    candidate.id,
    candidate.creator,
    ...(candidate.tags || []),
    candidate.sourceUrl,
  ].filter(Boolean).join(" ");
  const currentTokens = tokens(currentText);
  if (currentTokens.size === 0) return 0;

  let highest = 0;
  for (const previous of previousCandidates) {
    if (String(previous.id) === String(candidate.id)) return 100;
    const previousText = [
      previous.id,
      previous.creator,
      ...(previous.tags || []),
      previous.sourceUrl,
    ].filter(Boolean).join(" ");
    const previousTokens = tokens(previousText);
    const intersection = [...currentTokens].filter((token) => previousTokens.has(token)).length;
    const union = new Set([...currentTokens, ...previousTokens]).size || 1;
    const metadataSimilarity = Math.round((intersection / union) * 100);
    const sameCreator = candidate.creator && previous.creator && candidate.creator === previous.creator ? 20 : 0;
    const closeDimensions =
      Math.abs((candidate.width || 0) - (previous.width || 0)) < 64 &&
      Math.abs((candidate.height || 0) - (previous.height || 0)) < 64
        ? 10
        : 0;
    highest = Math.max(highest, Math.min(100, metadataSimilarity + sameCreator + closeDimensions));
  }
  return highest;
}

export function selectSmartClipWindow(
  candidate: StockAssetCandidate,
  targetDurationSeconds = 5,
): { sourceDuration: number; selectedStart: number; selectedEnd: number; reason: string } {
  const sourceDuration = Math.max(candidate.duration || targetDurationSeconds, targetDurationSeconds);
  const usableDuration = Math.min(targetDurationSeconds, sourceDuration);
  const avoidHead = sourceDuration > usableDuration + 2 ? Math.min(1.2, sourceDuration * 0.08) : 0;
  const avoidTail = sourceDuration > usableDuration + 2 ? Math.min(1.0, sourceDuration * 0.06) : 0;
  const available = Math.max(0, sourceDuration - avoidHead - avoidTail - usableDuration);
  const selectedStart = Math.round((avoidHead + available * 0.38) * 100) / 100;
  const selectedEnd = Math.round(Math.min(sourceDuration, selectedStart + usableDuration) * 100) / 100;
  return {
    sourceDuration: Math.round(sourceDuration * 100) / 100,
    selectedStart,
    selectedEnd,
    reason: selectedStart > 0 ? "Skipped likely intro/setup frames" : "Full clip used from start",
  };
}

export function estimatePortraitCrop(
  candidate: StockAssetCandidate,
): { mode: "native_portrait" | "center_crop" | "letterbox_safe"; xCenter: number; safetyScore: number; reason: string } {
  if (candidate.height >= candidate.width) {
    return { mode: "native_portrait", xCenter: 0.5, safetyScore: 96, reason: "Native portrait or square-ish clip" };
  }
  const tags = (candidate.tags || []).join(" ").toLowerCase();
  const peopleLikely = /\b(person|people|owner|team|customer|face|hands|office|business)\b/.test(tags);
  return {
    mode: "center_crop",
    xCenter: peopleLikely ? 0.48 : 0.5,
    safetyScore: peopleLikely ? 78 : 70,
    reason: peopleLikely
      ? "Center crop with slight subject-prior bias from tags"
      : "Deterministic center crop fallback",
  };
}

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
    visualIntent,
    orientation = "portrait",
    targetDurationSeconds = 5,
    previouslyUsedIds = [],
    previouslyUsedCreators = [],
    previousCandidates = [],
  } = options;

  let duplicatePenalty = 0;
  if (previouslyUsedIds.some((id) => String(id) === String(candidate.id))) {
    duplicatePenalty = -1000;
    reasons.push("Duplicate asset already used in video");
  }
  const nearDuplicateRisk = estimateNearDuplicateRisk(candidate, previousCandidates);
  if (nearDuplicateRisk >= 70) {
    duplicatePenalty = Math.min(duplicatePenalty, -35);
    reasons.push(`High near-duplicate risk (${nearDuplicateRisk}/100)`);
  } else if (nearDuplicateRisk >= 45) {
    duplicatePenalty -= 12;
    reasons.push(`Moderate near-duplicate risk (${nearDuplicateRisk}/100)`);
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

  // 4. Query, intent & tag relevance score (max 20)
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
  if (visualIntent && candidate.tags?.length) {
    const intentTerms: Record<string, string[]> = {
      product_hero: ["product", "brand", "fashion", "item", "display"],
      lifestyle: ["people", "lifestyle", "home", "street", "customer"],
      problem: ["problem", "stress", "frustrated", "empty", "slow"],
      solution: ["solution", "service", "team", "success", "workflow"],
      demonstration: ["demo", "hands", "process", "using", "screen"],
      social_proof: ["review", "customer", "testimonial", "people"],
      environment: ["office", "store", "city", "workspace", "interior"],
      detail: ["close", "detail", "texture", "macro", "hands"],
      technology: ["technology", "computer", "software", "dashboard", "phone"],
      people: ["person", "people", "team", "customer", "owner"],
      cta: ["phone", "message", "contact", "call", "mobile"],
      abstract: ["abstract", "motion", "background", "pattern"],
    };
    const tags = candidate.tags.map((tag) => tag.toLowerCase()).join(" ");
    const intentMatch = (intentTerms[visualIntent] || []).some((term) => tags.includes(term));
    if (intentMatch) {
      relevanceScore = Math.min(20, relevanceScore + 4);
      reasons.push(`Matched visual intent (${visualIntent})`);
    }
  }
  if (typeof candidate.qualityScore === "number") {
    const qualityAdjustment = Math.round(Math.max(-5, Math.min(5, (candidate.qualityScore - 70) / 6)));
    relevanceScore = Math.max(0, Math.min(20, relevanceScore + qualityAdjustment));
    if (qualityAdjustment > 0) reasons.push("Provider quality score improved ranking");
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

  const motionScore = candidate.duration >= targetDurationSeconds + 2 ? 8 : 5;
  if (motionScore >= 8) reasons.push("Clip has enough duration for smart sub-window selection");

  const crop = estimatePortraitCrop(candidate);
  const cropSafetyScore = Math.round(crop.safetyScore / 10);
  if (crop.safetyScore < 75) reasons.push("Crop safety is fallback-level; subject detection not available");

  const providerQualityScore = typeof candidate.qualityScore === "number"
    ? Math.max(0, Math.min(10, Math.round(candidate.qualityScore / 10)))
    : 7;

  const rawScore =
    orientationScore +
    resolutionScore +
    durationScore +
    relevanceScore +
    diversityScore +
    motionScore +
    cropSafetyScore +
    providerQualityScore +
    duplicatePenalty;

  const score = Math.max(0, Math.min(100, Math.round(rawScore)));
  const passed =
    score >= 40 &&
    duplicatePenalty === 0 &&
    candidate.duration >= targetDurationSeconds * 0.5 &&
    resolutionScore >= 12 &&
    nearDuplicateRisk < 80;

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
      motionScore,
      cropSafetyScore,
      qualityScore: providerQualityScore,
      nearDuplicateRisk,
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

  const preferred = ranked.find((item) => item.result.passed) || ranked[0];
  const best = preferred?.candidate || null;
  const scoreResult = preferred?.result || null;

  return {
    best,
    scoreResult,
    ranked,
  };
}
