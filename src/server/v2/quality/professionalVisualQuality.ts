import type { ProductionSpec } from "../../../types/productionSpec";
import type { VisualShot } from "../editing/editDecisionList";

export type ProfessionalVisualQualityReport = {
  realVisualCoveragePercent: number;
  providerMix: Record<string, number>;
  uniqueShotCount: number;
  uniqueAssetCount: number;
  repeatedAssetCount: number;
  averageSemanticScore?: number;
  minimumSemanticScore?: number;
  blackFramePercent?: number;
  textOnlyTimelinePercent: number;
  generatedTimelinePercent: number;
  stockTimelinePercent: number;
  uploadedTimelinePercent: number;
  motionOverlayPercent: number;
  rawPromptLeakCount: number;
  inventedClaimRiskCount: number;
  readyForProfessionalAuto: boolean;
  issues: string[];
};

function norm(text: unknown): string {
  return String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function containsRawPromptLeak(prompt: string | undefined, text: string | undefined): boolean {
  const p = norm(prompt);
  const t = norm(text);
  if (!p || !t) return false;
  return p.startsWith(t) || t.startsWith(p.slice(0, Math.min(80, p.length))) || /^create a |^make a video|^اعمل فيديو/.test(t);
}

export function detectInventedClaimRisk(spec: ProductionSpec): number {
  const prompt = norm(spec.userPrompt);
  const allowsWhatsapp = /whats\s*app|واتساب|واتس|wa\.me/.test(prompt);
  const allowsOffer = /discount|offer|sale|coupon|promo|خصم|عرض|تخفيض|كوبون/.test(prompt);
  const allowsStats = /\d+\s*%|\d+\s*(percent|في المية|بالمية|٪)/.test(prompt);
  let risk = 0;
  const text = norm([
    spec.cta?.text,
    spec.cta?.action,
    spec.cta?.contact,
    spec.contact,
    ...spec.scenes.flatMap((scene) => [scene.narration, scene.onScreenText, scene.displayText]),
  ].filter(Boolean).join(" "));
  if (!allowsWhatsapp && /whats\s*app|واتساب|واتس/.test(text)) risk += 1;
  if (!allowsOffer && /discount|offer|sale|coupon|promo|خصم|عرض|تخفيض|كوبون/.test(text)) risk += 1;
  if (!allowsStats && /\d+\s*%|\d+\s*(percent|في المية|بالمية|٪)/.test(text)) risk += 1;
  return risk;
}

export function calculateProfessionalVisualQualityReport(input: {
  spec: ProductionSpec;
  shots: VisualShot[];
  selectedVisuals: Array<Record<string, any>>;
  totalDurationSeconds: number;
  blackFramePercent?: number;
}): ProfessionalVisualQualityReport {
  const total = Math.max(0.001, input.totalDurationSeconds);
  const shots = input.shots || [];
  const selected = input.selectedVisuals || [];
  const secondsByType: Record<string, number> = {};
  shots.forEach((shot) => {
    secondsByType[shot.sourceType] = (secondsByType[shot.sourceType] || 0) + Math.max(0, shot.duration || 0);
  });

  const stockSeconds = secondsByType.stock || 0;
  const generatedSeconds = (secondsByType.image || 0);
  const uploadedSeconds = secondsByType.upload || 0;
  const motionSeconds = secondsByType.motion || 0;
  const realSeconds = stockSeconds + generatedSeconds + uploadedSeconds;

  const providerMix: Record<string, number> = {};
  selected.forEach((asset) => {
    const provider = String(asset.provider || "unknown");
    providerMix[provider] = (providerMix[provider] || 0) + 1;
  });

  const assetKeys = selected.map((asset) =>
    String(asset.metadata?.providerAssetId || asset.metadata?.pexelsVideoId || asset.metadata?.pixabayVideoId || asset.metadata?.stockAssetId || asset.url || asset.artifactId || ""),
  ).filter(Boolean);
  const uniqueAssetCount = new Set(assetKeys).size;
  const semanticScores = selected
    .map((asset) => Number(asset.metadata?.semanticScore ?? asset.metadata?.selectedScore))
    .filter((value) => Number.isFinite(value));
  const rawPromptLeakCount = input.spec.scenes.filter((scene) =>
    containsRawPromptLeak(input.spec.userPrompt, scene.onScreenText || scene.displayText),
  ).length;
  const inventedClaimRiskCount = detectInventedClaimRisk(input.spec);

  const report: ProfessionalVisualQualityReport = {
    realVisualCoveragePercent: Math.round((realSeconds / total) * 1000) / 10,
    providerMix,
    uniqueShotCount: new Set(shots.map((shot) => shot.shotId)).size,
    uniqueAssetCount,
    repeatedAssetCount: Math.max(0, assetKeys.length - uniqueAssetCount),
    averageSemanticScore: semanticScores.length
      ? Math.round((semanticScores.reduce((a, b) => a + b, 0) / semanticScores.length) * 10) / 10
      : undefined,
    minimumSemanticScore: semanticScores.length ? Math.min(...semanticScores) : undefined,
    blackFramePercent: input.blackFramePercent,
    textOnlyTimelinePercent: Math.round((motionSeconds / total) * 1000) / 10,
    generatedTimelinePercent: Math.round((generatedSeconds / total) * 1000) / 10,
    stockTimelinePercent: Math.round((stockSeconds / total) * 1000) / 10,
    uploadedTimelinePercent: Math.round((uploadedSeconds / total) * 1000) / 10,
    motionOverlayPercent: Math.round((motionSeconds / total) * 1000) / 10,
    rawPromptLeakCount,
    inventedClaimRiskCount,
    readyForProfessionalAuto: false,
    issues: [],
  };

  if (report.realVisualCoveragePercent < 90 && input.spec.visualMode !== "motion_graphics" && input.spec.visualMode !== "animated_explainer") {
    report.issues.push("real_visual_coverage_below_90_percent");
  }
  if (report.textOnlyTimelinePercent > 10 && input.spec.visualMode !== "motion_graphics" && input.spec.visualMode !== "animated_explainer") {
    report.issues.push("text_only_timeline_above_10_percent");
  }
  if (report.repeatedAssetCount > 0) report.issues.push("repeated_visual_assets_detected");
  if (report.rawPromptLeakCount > 0) report.issues.push("raw_prompt_leak_detected");
  if (report.inventedClaimRiskCount > 0) report.issues.push("invented_claim_risk_detected");
  if ((report.blackFramePercent || 0) > 1) report.issues.push("black_frame_percentage_high");
  report.readyForProfessionalAuto = report.issues.length === 0;
  return report;
}
