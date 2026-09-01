import { describe, expect, it } from "vitest";
import { buildFfmpegFastRenderPlan } from "./ffmpegFastRenderer";

describe("FFmpeg fast render plan", () => {
  it("builds one native graph for video concat, caption burn, audio mix, and final encode", () => {
    const plan = buildFfmpegFastRenderPlan({
      clips: [
        { path: "scene0.mp4", durationSeconds: 8, transition: "cut" },
        { path: "scene1.mp4", durationSeconds: 12, transition: "crossfade" },
      ],
      voices: [
        { path: "voice0.mp3", durationSeconds: 8 },
        { path: "voice1.mp3", durationSeconds: 12 },
      ],
      outputPath: "out.mp4",
      width: 1080,
      height: 1920,
      fps: 25,
      totalDurationSeconds: 20,
      musicPath: "music.mp3",
      captionsAssPath: "captions.ass",
      fontsDir: "fonts",
    });

    expect(plan.videoClipCount).toBe(2);
    expect(plan.voiceClipCount).toBe(2);
    expect(plan.hasMusic).toBe(true);
    expect(plan.hasCaptions).toBe(true);
    expect(plan.filterComplex).toContain("scale=1080:1920:force_original_aspect_ratio=increase");
    expect(plan.filterComplex).toContain("concat=n=2:v=1:a=0");
    expect(plan.filterComplex).toContain("ass='captions.ass'");
    expect(plan.filterComplex).toContain("amix=inputs=2");
    expect(plan.args).toContain("-movflags");
    expect(plan.args).toContain("+faststart");
    expect(plan.args).toContain("-c:v");
    expect(plan.args).toContain("libx264");
    expect(plan.args).toContain("-c:a");
    expect(plan.args).toContain("aac");
  });

  it("supports generated and uploaded provider videos after normalization without source-specific branches", () => {
    const plan = buildFfmpegFastRenderPlan({
      clips: [
        { path: "veo.mp4", durationSeconds: 5 },
        { path: "uploaded.mp4", durationSeconds: 5 },
        { path: "comfyui.mp4", durationSeconds: 5 },
      ],
      voices: [{ path: "voice.mp3", durationSeconds: 15 }],
      outputPath: "out.mp4",
      width: 1080,
      height: 1920,
      fps: 25,
      totalDurationSeconds: 15,
    });

    expect(plan.filterComplex).toContain("concat=n=3:v=1:a=0");
    expect(plan.filterComplex).toContain("fps=25");
    expect(plan.filterComplex).toContain("setsar=1");
    expect(plan.filterComplex).toContain("format=yuv420p");
  });

  it("refuses partial output when required media is absent from the plan", () => {
    expect(() =>
      buildFfmpegFastRenderPlan({
        clips: [],
        voices: [{ path: "voice.mp3", durationSeconds: 10 }],
        outputPath: "out.mp4",
        width: 1080,
        height: 1920,
        fps: 25,
        totalDurationSeconds: 10,
      }),
    ).toThrow(/at least one video clip/);

    expect(() =>
      buildFfmpegFastRenderPlan({
        clips: [{ path: "scene.mp4", durationSeconds: 10 }],
        voices: [],
        outputPath: "out.mp4",
        width: 1080,
        height: 1920,
        fps: 25,
        totalDurationSeconds: 10,
      }),
    ).toThrow(/at least one voice clip/);
  });
});
