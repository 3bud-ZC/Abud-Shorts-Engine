import { describe, it, expect } from "vitest";
import { capabilityManager } from "../server/v2/capabilities/capabilityManager";

describe("CapabilityManager", () => {
  it("lists all canonical capability packs and components", () => {
    const packs = capabilityManager.listPacks();
    expect(packs.length).toBeGreaterThanOrEqual(4);
    expect(packs.map((p) => p.id)).toContain("CORE");
    expect(packs.map((p) => p.id)).toContain("QUALITY_CPU");
    expect(packs.map((p) => p.id)).toContain("MOTION");
    expect(packs.map((p) => p.id)).toContain("AI_GPU");

    const capabilities = capabilityManager.listCapabilities();
    expect(capabilities.length).toBeGreaterThanOrEqual(10);
    const ids = capabilities.map((c) => c.id);
    expect(ids).toContain("scene_detection");
    expect(ids).toContain("background_removal");
    expect(ids).toContain("beat_analysis");
    expect(ids).toContain("motion_canvas");
    expect(ids).toContain("mediapipe");
  });

  it("truthfully reports mediapipe status and fallback heuristic", () => {
    const mediapipe = capabilityManager.getCapability("mediapipe");
    expect(mediapipe).toBeDefined();
    expect(mediapipe?.implemented).toBe(false);
    expect(mediapipe?.installed).toBe(false);
    expect(mediapipe?.failureReason).toContain("deterministic smart crop");
  });

  it("checks hardware detection correctly", () => {
    const hardware = capabilityManager.getHardwareInfo();
    expect(hardware).toBeDefined();
    expect(typeof hardware.cpuCores).toBe("number");
    expect(typeof hardware.totalMemoryGb).toBe("number");
    expect(typeof hardware.hasNvidiaGpu).toBe("boolean");
  });

  it("toggles capability enabled flag dynamically", () => {
    const original = capabilityManager.getCapability("scene_detection")?.enabled;
    const updated = capabilityManager.toggleCapability("scene_detection", !original);
    expect(updated?.enabled).toBe(!original);

    // Reset back
    capabilityManager.toggleCapability("scene_detection", Boolean(original));
  });

  it("evaluates mode readiness accurately", () => {
    const productReadiness = capabilityManager.checkModeReadiness("product_ad");
    expect(productReadiness).toBeDefined();
    expect(typeof productReadiness.ready).toBe("boolean");

    const motionReadiness = capabilityManager.checkModeReadiness("motion_graphics");
    expect(motionReadiness).toBeDefined();
    expect(typeof motionReadiness.ready).toBe("boolean");

    const aiReadiness = capabilityManager.checkModeReadiness("ai_generated");
    expect(aiReadiness).toBeDefined();
    expect(aiReadiness.mode).toBe("ai_generated");
  });
});
