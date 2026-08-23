import { describe, it, expect } from "vitest";
import path from "path";
import fs from "fs-extra";
import { qualityEngine } from "../server/v2/quality/qualityEngine";

describe("QualityEngine", () => {
  it("rejects path traversal attacks on analyzeScenes", async () => {
    await expect(qualityEngine.analyzeScenes("../../etc/passwd", 5.0)).rejects.toThrow("Path security violation");
  });

  it("analyzes beats using librosa if test audio exists", async () => {
    const testAudioPath = path.resolve(process.cwd(), "public/music/Name The Time And Place - Telecasted.mp3");
    if (fs.existsSync(testAudioPath)) {
      const beatMap = await qualityEngine.analyzeBeats(testAudioPath);
      expect(beatMap).toBeDefined();
      expect(beatMap.bpm).toBeGreaterThan(60);
      expect(beatMap.beats.length).toBeGreaterThan(0);
      expect(beatMap.beatGridMs.length).toBeGreaterThan(0);
      expect(beatMap.confidence).toBeGreaterThan(0.5);
    }
  });

  it("upscales images with Lanczos resampling", async () => {
    const testImgPath = path.resolve(process.cwd(), "data-dev/uploads/products/test-product.png");
    if (fs.existsSync(testImgPath)) {
      const res = await qualityEngine.upscaleImage(testImgPath, 1080);
      expect(res).toBeDefined();
      expect(res.width).toBeGreaterThanOrEqual(1080);
      expect(fs.existsSync(res.absolutePath)).toBe(true);
    }
  });
});
