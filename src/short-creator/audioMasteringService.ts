import { FFMpeg, type AudioLoudnessMetrics } from "./libraries/FFmpeg";

export type VoiceMasteringResult = {
  inputPath: string;
  outputPath: string;
  inputMetrics: AudioLoudnessMetrics;
  masteredMetrics: AudioLoudnessMetrics;
  criticalFailure: boolean;
  issues: string[];
};

export type FinalAudioQaResult = {
  stream: {
    codec?: string;
    sampleRate?: number;
    channels?: number;
    durationSeconds: number;
    hasAudioStream: boolean;
  };
  finalMixMetrics: AudioLoudnessMetrics;
  pass: boolean;
  issues: string[];
};

export type DeadAirInterval = {
  sceneIndexBefore: number;
  sceneIndexAfter: number;
  gapMs: number;
  startMs: number;
  endMs: number;
  suspicious: boolean;
  severity: "none" | "warning" | "defect";
  reason: string;
};

export type DeadAirReport = {
  hasDeadAir: boolean;
  hasSuspiciousPauses: boolean;
  maxNarrationSilenceMs: number;
  totalNarrationSilenceMs: number;
  gaps: DeadAirInterval[];
  issues: string[];
  warnings: string[];
};

export class AudioMasteringService {
  constructor(private ffmpeg: FFMpeg) {}

  public analyzeDeadAir(
    speechWindows: Array<{ sceneIndex: number; startMs: number; endMs: number }>,
    options: {
      warningThresholdMs?: number;
      defectThresholdMs?: number;
    } = {},
  ): DeadAirReport {
    const warningThresholdMs = options.warningThresholdMs ?? 600;
    const defectThresholdMs = options.defectThresholdMs ?? 1500;

    const gaps: DeadAirInterval[] = [];
    const issues: string[] = [];
    const warnings: string[] = [];
    let maxNarrationSilenceMs = 0;
    let totalNarrationSilenceMs = 0;

    for (let i = 0; i < speechWindows.length - 1; i++) {
      const current = speechWindows[i];
      const next = speechWindows[i + 1];
      const gapMs = Math.max(0, next.startMs - current.endMs);
      totalNarrationSilenceMs += gapMs;
      if (gapMs > maxNarrationSilenceMs) {
        maxNarrationSilenceMs = gapMs;
      }

      let severity: "none" | "warning" | "defect" = "none";
      let reason = "Normal conversational pause";

      if (gapMs >= defectThresholdMs) {
        severity = "defect";
        reason = `Excessive dead-air gap (${gapMs}ms) between scene ${current.sceneIndex + 1} and ${next.sceneIndex + 1}`;
        issues.push(reason);
      } else if (gapMs >= warningThresholdMs) {
        severity = "warning";
        reason = `Suspiciously long silence gap (${gapMs}ms) between scene ${current.sceneIndex + 1} and ${next.sceneIndex + 1}`;
        warnings.push(reason);
      }

      gaps.push({
        sceneIndexBefore: current.sceneIndex,
        sceneIndexAfter: next.sceneIndex,
        gapMs,
        startMs: current.endMs,
        endMs: next.startMs,
        suspicious: severity !== "none",
        severity,
        reason,
      });
    }

    return {
      hasDeadAir: issues.length > 0,
      hasSuspiciousPauses: warnings.length > 0,
      maxNarrationSilenceMs,
      totalNarrationSilenceMs,
      gaps,
      issues,
      warnings,
    };
  }

  public async masterVoice(inputPath: string, outputPath: string): Promise<VoiceMasteringResult> {
    const inputMetrics = await this.ffmpeg.measureAudioLoudness(inputPath);
    await this.ffmpeg.masterVoiceAudioFile(inputPath, outputPath);
    const masteredMetrics = await this.ffmpeg.measureAudioLoudness(outputPath);
    const issues = this.evaluateMetrics(masteredMetrics);

    return {
      inputPath,
      outputPath,
      inputMetrics,
      masteredMetrics,
      criticalFailure: issues.length > 0,
      issues,
    };
  }

  public async validateFinalMix(videoPath: string): Promise<FinalAudioQaResult> {
    const stream = await this.ffmpeg.getAudioStreamInfo(videoPath);
    const finalMixMetrics = stream.hasAudioStream
      ? await this.ffmpeg.measureAudioLoudness(videoPath)
      : {
          integratedLufs: null,
          truePeakDbtp: null,
          loudnessRange: null,
          clippingDetected: false,
          effectivelySilent: true,
        };

    const issues: string[] = [];
    if (!stream.hasAudioStream) issues.push("Audio stream missing.");
    if (finalMixMetrics.effectivelySilent) issues.push("Final mix is effectively silent.");
    if (finalMixMetrics.clippingDetected) issues.push("Severe clipping detected in final mix.");
    if (finalMixMetrics.integratedLufs === null) issues.push("Final mix loudness could not be measured.");

    return {
      stream,
      finalMixMetrics,
      pass: issues.length === 0,
      issues,
    };
  }

  private evaluateMetrics(metrics: AudioLoudnessMetrics): string[] {
    const issues: string[] = [];
    if (metrics.integratedLufs === null) issues.push("Voice loudness could not be measured.");
    if (metrics.effectivelySilent) issues.push("Voice audio is effectively silent.");
    if (metrics.clippingDetected) issues.push("Voice audio clipping detected.");
    return issues;
  }
}
