import { describe, it, expect, vi } from "vitest";
import { KokoroVoiceProvider } from "./voice-providers/kokoroVoiceProvider";
import { ElevenLabsVoiceProvider } from "./voice-providers/elevenlabsVoiceProvider";
import { VoiceRegistry } from "./voice-providers/registry";

describe("Voice Providers & Registry", () => {
  const dummyKokoro: any = {
    generate: vi.fn().mockResolvedValue({
      audio: "dummy-stream",
      audioLength: 5.2,
    }),
    listAvailableVoices: vi.fn().mockReturnValue(["af_heart", "am_adam", "bf_emma"]),
  };

  it("Kokoro provider is always free and configured", async () => {
    const provider = new KokoroVoiceProvider(dummyKokoro);
    expect(provider.isConfigured()).toBe(true);
    expect(provider.tier).toBe("free");

    const res = await provider.generateVoice("Hello world", "af_heart");
    expect(res.audioLength).toBe(5.2);

    const val = await provider.validate();
    expect(val.status).toBe("healthy");
    expect(val.healthy).toBe(true);
  });

  it("ElevenLabs reports not_configured when no key is provided", async () => {
    const provider = new ElevenLabsVoiceProvider("");
    expect(provider.isConfigured()).toBe(false);
    expect(provider.tier).toBe("premium");

    const val = await provider.validate();
    expect(val.status).toBe("not_configured");
  });

  it("VoiceRegistry falls back to Kokoro if ElevenLabs is not configured", async () => {
    const registry = new VoiceRegistry(dummyKokoro);
    const provider = registry.getProvider("elevenlabs");
    expect(provider.id).toBe("kokoro");

    const voices = await registry.listAllVoices();
    expect(voices.some((v) => v.provider === "kokoro")).toBe(true);
    expect(voices.some((v) => v.provider === "elevenlabs")).toBe(true);
  });
});
