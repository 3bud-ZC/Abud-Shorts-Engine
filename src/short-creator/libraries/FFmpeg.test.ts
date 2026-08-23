import { describe, it, expect, vi } from "vitest";
import fluentFfmpeg from "fluent-ffmpeg";
import fs from "fs-extra";
import { FFMpeg } from "./FFmpeg";
import { Config } from "../../config";

describe("FFMpeg validateRenderedVideo and Quality Scoring", () => {
  const config = new Config();
  const ffmpeg = new FFMpeg(config);

  it("calculates technical score with deductions and rejects large duration variance (> 5s)", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "statSync").mockReturnValue({ size: 25000000 } as any);

    const mockProbe = vi.spyOn(fluentFfmpeg, "ffprobe").mockImplementation((_path: any, cb: any) => {
      cb(null, {
        format: {
          duration: "30.060000",
          bit_rate: "8000000",
          size: "25000000",
        },
        streams: [
          { codec_type: "video", width: 1080, height: 1920, r_frame_rate: "25/1" },
          { codec_type: "audio" },
        ],
      } as any);
      return {} as any;
    });

    const result = await ffmpeg.validateRenderedVideo("dummy_path.mp4", 20);

    expect(result.durationSeconds).toBe(30.06);
    expect(result.durationVariance).toBe(10.06);
    expect(result.durationVariancePercent).toBe(50.3);
    expect(result.valid).toBe(false);
    expect(result.technicalScore).toBeLessThanOrEqual(30);
    expect(result.technicalScore).not.toBe(100);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Critical duration mismatch: requested 20s, produced 30.06s"),
      ]),
    );

    mockProbe.mockRestore();
    vi.restoreAllMocks();
  });

  it("awards 100/100 score for sub-0.5s variance matching target duration", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "statSync").mockReturnValue({ size: 20000000 } as any);

    const mockProbe = vi.spyOn(fluentFfmpeg, "ffprobe").mockImplementation((_path: any, cb: any) => {
      cb(null, {
        format: {
          duration: "20.054000",
          bit_rate: "8000000",
          size: "20000000",
        },
        streams: [
          { codec_type: "video", width: 1080, height: 1920, r_frame_rate: "25/1" },
          { codec_type: "audio" },
        ],
      } as any);
      return {} as any;
    });

    const result = await ffmpeg.validateRenderedVideo("dummy_path.mp4", 20);

    expect(result.durationSeconds).toBe(20.05);
    expect(result.durationVariance).toBe(0.05);
    expect(result.valid).toBe(true);
    expect(result.technicalScore).toBe(100);
    expect(result.issues.length).toBe(0);

    mockProbe.mockRestore();
    vi.restoreAllMocks();
  });
});
