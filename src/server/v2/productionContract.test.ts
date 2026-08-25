import { describe, expect, it } from "vitest";
import { canonicalizeProductionSpecContract } from "./routes";

describe("Production contract canonicalization", () => {
  it("overrides stale preview duration, dialect, and voice with current UI selections", () => {
    const staleSpec: any = {
      id: "stale",
      creationMode: "prompt",
      title: "Stale preview",
      userPrompt: "اعمل فيديو 20 ثانية",
      language: "ar",
      dialect: "saudi",
      tone: "حماسي",
      contentStyle: "advertisement",
      durationSeconds: 15,
      aspectRatio: "9:16",
      resolution: "1080p",
      quality: "standard",
      sceneCount: 1,
      productionMode: "auto_hybrid",
      visualMode: "auto",
      voiceProvider: "kokoro",
      voiceId: "af_heart",
      captionStyle: "bold",
      scenes: [
        {
          sceneIndex: 0,
          purpose: "hook",
          durationSeconds: 5,
          narration: "بتخسر عملاء بدون موقع؟",
          stockSearchTerms: ["business website"],
          visualSource: "stock",
          transition: "cut",
        },
      ],
    };

    const canonical = canonicalizeProductionSpecContract(staleSpec, {
      language: "ar",
      dialect: "egyptian",
      durationSeconds: 20,
      aspectRatio: "9:16",
      resolution: "1080p",
      quality: "standard",
      visualMode: "stock",
      voiceProvider: "auto",
      voiceId: "",
      captionStyle: "viral_bold",
    });

    expect(canonical.durationSeconds).toBe(20);
    expect(canonical.dialect).toBe("egyptian");
    // Arabic always canonicalizes to ElevenLabs, even when the stale spec named
    // another provider.
    expect(canonical.voiceProvider).toBe("elevenlabs");
    // No ElevenLabs voice ID is hardcoded; it is resolved from the customer's
    // own account at generation time.
    expect(canonical.voiceId).toBe("");
    expect(canonical.visualMode).toBe("stock");
    expect(canonical.captionStyle).toBe("viral_bold");
    expect(canonical.metadata?.uiContract).toMatchObject({
      durationSeconds: 20,
      dialect: "egyptian",
      requestedVoiceProvider: "auto",
      resolvedVoiceProvider: "elevenlabs",
    });
  });

  it("drops a historical Piper voice ID when canonicalizing an Arabic revision", () => {
    const historicalSpec: any = {
      id: "historical",
      creationMode: "prompt",
      title: "Historical Piper job",
      language: "ar",
      dialect: "egyptian",
      durationSeconds: 20,
      sceneCount: 1,
      voiceProvider: "piper",
      voiceId: "ar_JO-kareem-medium",
      scenes: [
        {
          sceneIndex: 0,
          purpose: "hook",
          durationSeconds: 5,
          narration: "مرحبا",
          stockSearchTerms: ["business"],
          visualSource: "stock",
          transition: "cut",
        },
      ],
    };

    const canonical = canonicalizeProductionSpecContract(historicalSpec, {
      language: "ar",
      dialect: "egyptian",
      voiceProvider: "auto",
    });

    expect(canonical.voiceProvider).toBe("elevenlabs");
    // A Piper model name must never be forwarded to ElevenLabs as a voice ID.
    expect(canonical.voiceId).not.toBe("ar_JO-kareem-medium");
  });

  it("does not force ElevenLabs onto English production", () => {
    const englishSpec: any = {
      id: "english",
      creationMode: "prompt",
      title: "English job",
      language: "en",
      dialect: "none",
      durationSeconds: 20,
      sceneCount: 1,
      voiceProvider: "auto",
      scenes: [
        {
          sceneIndex: 0,
          purpose: "hook",
          durationSeconds: 5,
          narration: "Losing customers without a website?",
          stockSearchTerms: ["business"],
          visualSource: "stock",
          transition: "cut",
        },
      ],
    };

    const canonical = canonicalizeProductionSpecContract(englishSpec, {
      language: "en",
      dialect: "none",
      voiceProvider: "auto",
    });

    expect(canonical.voiceProvider).toBe("kokoro");
    expect(canonical.voiceId).toBe("af_heart");
  });
});
