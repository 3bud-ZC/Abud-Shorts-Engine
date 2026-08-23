import { describe, it, expect } from "vitest";
import fs from "fs-extra";
import { motionEngine } from "../server/v2/motion/motionEngine";

describe("MotionEngine", () => {
  it("renders a 1080x1920 Motion Canvas stat animation clip", async () => {
    const res = await motionEngine.renderMotionScene({
      template: "stat_animation",
      title: "أداء استثنائي",
      numberStat: { value: "95%", label: "رضا العملاء" },
      durationSeconds: 1.0,
      brandColors: { primary: "#24545a", accent: "#d97706" },
      language: "ar",
    });

    expect(res).toBeDefined();
    expect(res.artifactId).toMatch(/^motion_/);
    expect(res.width).toBe(1080);
    expect(res.height).toBe(1920);
    expect(res.durationSeconds).toBe(1.0);
    expect(fs.existsSync(res.absolutePath)).toBe(true);

    const stat = fs.statSync(res.absolutePath);
    expect(stat.size).toBeGreaterThan(1000);
  });
});
