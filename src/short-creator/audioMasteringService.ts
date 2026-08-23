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

export class AudioMasteringService {
  constructor(private ffmpeg: FFMpeg) {}

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
