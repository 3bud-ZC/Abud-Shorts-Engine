import { FFMpeg, type AudioLoudnessMetrics, type SilenceInterval } from "./libraries/FFmpeg";

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

export type MixedSilenceGateResult = {
  silenceRuns: SilenceInterval[];
  longestSilenceRunMs: number;
  totalSilenceMs: number;
  thresholdDb: number;
  /** >= this is a defect: professionalReady must be false (section 59). */
  criticalThresholdMs: number;
  /** >= this (but below critical) is a hard QA fail, not just a warning. */
  warningThresholdMs: number;
  pass: boolean;
  criticalFailure: boolean;
  issues: string[];
};

export class AudioMasteringService {
  constructor(private ffmpeg: FFMpeg) {}

  public analyzeDeadAir(
    speechWindows: Array<{
      sceneIndex: number;
      startMs: number;
      endMs: number;
      /**
       * Milliseconds this scene deliberately holds its own motion/visual past
       * the narration (music and animation keep playing) so the video reaches
       * its requested duration. A gap that is just this intentional hold is
       * editorial pacing, not dead air, and is not flagged.
       */
      intentionalHoldMs?: number;
    }>,
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
      const rawGapMs = Math.max(0, next.startMs - current.endMs);
      // Discount the portion of the gap that is this scene's deliberate visual
      // hold - music and motion are playing there, it is not dead air.
      const gapMs = Math.max(0, rawGapMs - Math.max(0, current.intentionalHoldMs || 0));
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

  /**
   * Measures real silence in the ACTUAL rendered/mixed audio track and gates
   * on it. `analyzeDeadAir` above only ever compares PLANNED speech windows
   * against a PLANNED hold budget - it cannot see that a naturally quiet
   * passage of the selected music bed landed on top of a narration gap in the
   * real render. This is the check that would have caught incident
   * cmtehsptj000108ledzk3f3ji's ~4.5s / ~5.3s / ~4.8s near-silent runs, which
   * `validateFinalMix`'s whole-track LUFS check could not see.
   */
  public async analyzeMixedSilence(
    videoOrAudioPath: string,
    options: { thresholdDb?: number; minDurationSeconds?: number; warningThresholdMs?: number; criticalThresholdMs?: number } = {},
  ): Promise<MixedSilenceGateResult> {
    const warningThresholdMs = options.warningThresholdMs ?? 1500;
    const criticalThresholdMs = options.criticalThresholdMs ?? 3000;
    const detected = await this.ffmpeg.detectSilenceIntervals(videoOrAudioPath, {
      thresholdDb: options.thresholdDb,
      minDurationSeconds: options.minDurationSeconds,
    });

    const issues: string[] = [];
    if (detected.longestSilenceRunMs >= criticalThresholdMs) {
      issues.push(`Unexplained mixed-audio silence of ${detected.longestSilenceRunMs}ms exceeds the ${criticalThresholdMs}ms critical threshold.`);
    } else if (detected.longestSilenceRunMs >= warningThresholdMs) {
      issues.push(`Unexplained mixed-audio silence of ${detected.longestSilenceRunMs}ms exceeds the ${warningThresholdMs}ms professional target.`);
    }

    return {
      silenceRuns: detected.silenceRuns,
      longestSilenceRunMs: detected.longestSilenceRunMs,
      totalSilenceMs: detected.totalSilenceMs,
      thresholdDb: detected.thresholdDb,
      criticalThresholdMs,
      warningThresholdMs,
      pass: detected.longestSilenceRunMs < warningThresholdMs,
      criticalFailure: detected.longestSilenceRunMs >= criticalThresholdMs,
      issues,
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
