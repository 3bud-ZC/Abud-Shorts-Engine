import { describe, it, expect } from "vitest";
import { LocalContentAIProvider, extractDurationFromPrompt } from "./content-ai/localProvider";
import { promptJobInputSchema, productionSpecPreviewSchema } from "./types";
import { resolveProductionTimeline } from "../../types/productionSpec";

describe("Duration Precedence & API Compatibility Invariants", () => {
  const provider = new LocalContentAIProvider();

  it("extracts duration reliably from Arabic and English prompt strings", () => {
    expect(extractDurationFromPrompt("اعمل اعلان 25 ثانية لبراند ملابس")).toBe(25);
    expect(extractDurationFromPrompt("فيديو 20 ثواني لمطعم")).toBe(20);
    expect(extractDurationFromPrompt("شورت 15 ثوان لكافيه")).toBe(15);
    expect(extractDurationFromPrompt("Create a 20-second tech video")).toBe(20);
    expect(extractDurationFromPrompt("30s explainer about cloud")).toBe(30);
    expect(extractDurationFromPrompt("Simple promo without explicit time")).toBeNull();
  });

  it("prioritizes explicit UI/API duration over prompt-mentioned duration", async () => {
    // Prompt says 30 seconds, but API explicit says 20
    const spec = await provider.generateProductionSpec({
      prompt: "اعمل فيديو 30 ثانية لخدمة تصميم مواقع",
      requestedDurationSeconds: 20,
    });
    expect(spec.durationSeconds).toBe(20);

    const timeline = resolveProductionTimeline(spec);
    expect(timeline.requestedDurationSeconds).toBe(20);
    expect(timeline.finalExpectedDurationSeconds).toBe(20);
  });

  it("prioritizes prompt-extracted duration when API duration is omitted", async () => {
    const spec = await provider.generateProductionSpec({
      prompt: "اعمل اعلان 25 ثانية باللهجة المصرية لبراند ملابس",
    });
    expect(spec.durationSeconds).toBe(25);

    const timeline = resolveProductionTimeline(spec);
    expect(timeline.requestedDurationSeconds).toBe(25);
    expect(timeline.finalExpectedDurationSeconds).toBe(25);
  });

  it("falls back to configured default (30s) when no duration is specified anywhere", async () => {
    const spec = await provider.generateProductionSpec({
      prompt: "اعمل اعلان لبراند ملابس شبابي",
    });
    expect(spec.durationSeconds).toBe(30);
  });

  it("normalizes { duration: 25 } alias in promptJobInputSchema without stripping", () => {
    const parsed = promptJobInputSchema.safeParse({
      prompt: "اعمل اعلان لبراند ملابس",
      duration: 25,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.requestedDurationSeconds).toBe(25);
      expect(parsed.data.durationSeconds).toBe(25);
    }
  });

  it("normalizes { durationSeconds: 20 } in productionSpecPreviewSchema", () => {
    const parsed = productionSpecPreviewSchema.safeParse({
      prompt: "Create tech explainer",
      durationSeconds: 20,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.requestedDurationSeconds).toBe(20);
      expect(parsed.data.durationSeconds).toBe(20);
    }
  });
});
