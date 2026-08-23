import { afterEach, describe, it, expect, vi } from "vitest";
import nock from "nock";
import { KokoroVoiceProvider } from "./voice-providers/kokoroVoiceProvider";
import { ElevenLabsVoiceProvider } from "./voice-providers/elevenlabsVoiceProvider";
import { VoiceRegistry } from "./voice-providers/registry";
import { preprocessArabicSpeech } from "./voice-providers/arabicSpeechPreprocessor";
import {
  buildGoogleSsml,
  GoogleCloudTtsProvider,
  normalizeGoogleVoice,
  parseGoogleVoiceFamily,
} from "./voice-providers/googleCloudTtsProvider";

describe("Voice Providers & Registry", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    nock.cleanAll();
  });

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

  it("VoiceRegistry keeps English on Kokoro if ElevenLabs is not configured", async () => {
    const registry = new VoiceRegistry(dummyKokoro);
    const provider = registry.getProvider("elevenlabs");
    expect(provider.id).toBe("kokoro");

    const voices = await registry.listAllVoices();
    expect(voices.some((v) => v.provider === "kokoro")).toBe(true);
    expect(voices.some((v) => v.provider === "elevenlabs")).toBe(true);
  });

  it("routes Arabic production narration to Piper instead of Kokoro", () => {
    delete process.env.PIPER_BIN;
    delete process.env.PIPER_AR_MODEL_PATH;
    delete process.env.ELEVENLABS_API_KEY;
    const registry = new VoiceRegistry(dummyKokoro, "");

    const decision = registry.route({
      text: "اعمل اعلان 20 ثانية عن تصميم مواقع",
      language: "ar",
      dialect: "egyptian",
      qualityProfile: "balanced",
      requestedProvider: "auto",
    });

    expect(decision.providerId).toBe("piper");
  });

  it("reports Google Cloud TTS as not configured without server credentials", async () => {
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "");
    vi.stubEnv("GOOGLE_CLOUD_TTS_CREDENTIALS_JSON", "");
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "");
    vi.stubEnv("GCLOUD_PROJECT", "");
    vi.stubEnv("GOOGLE_CLOUD_PROJECT_ID", "");
    const provider = new GoogleCloudTtsProvider();

    expect(provider.isConfigured()).toBe(false);
    expect(await provider.listVoices("ar-XA")).toEqual([]);
    const validation = await provider.validate();
    expect(validation.status).toBe("not_configured");
  });

  it("normalizes Google ar-XA voices without inventing voice IDs", () => {
    const voice = normalizeGoogleVoice({
      name: "ar-XA-Chirp3-HD-Achernar",
      languageCodes: ["ar-XA"],
      ssmlGender: "FEMALE",
      naturalSampleRateHertz: 24000,
    });

    expect(voice?.id).toBe("ar-XA-Chirp3-HD-Achernar");
    expect(voice?.language).toBe("ar-XA");
    expect(voice?.voiceFamily).toBe("Chirp 3 HD");
    expect(voice?.gender).toBe("female");
    expect(parseGoogleVoiceFamily("ar-XA-Wavenet-A")).toBe("WaveNet");
    expect(parseGoogleVoiceFamily("ar-XA-Standard-A")).toBe("Standard");
  });

  it("escapes Google SSML safely", () => {
    const ssml = buildGoogleSsml(`5 < 7 & "ABUD"\nline two`, 1.4);
    expect(ssml).toContain("&lt;");
    expect(ssml).toContain("&amp;");
    expect(ssml).toContain("&quot;ABUD&quot;");
    expect(ssml).toContain('<break time="250ms"/>');
    expect(ssml).toContain('rate="125%"');
  });

  it("generates Google preview audio from the configured cloud voice", async () => {
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "test-project");
    const provider = new GoogleCloudTtsProvider(
      () =>
        ({
          getClient: async () => ({
            getAccessToken: async () => ({ token: "test-token" }),
          }),
        }) as any,
    );
    nock("https://texttospeech.googleapis.com", {
      reqheaders: { authorization: "Bearer test-token" },
    })
      .post("/v1/text:synthesize", (body) => body.voice?.name === "ar-XA-Standard-A" && body.input?.ssml)
      .reply(200, { audioContent: Buffer.from("mp3-bytes").toString("base64") });

    const result = await provider.generateVoice("مرحبا بالعالم", "ar-XA-Standard-A");

    expect(Buffer.isBuffer(result.audio)).toBe(true);
    expect(result.provider).toBe("google_cloud_tts");
    expect(result.voiceId).toBe("ar-XA-Standard-A");
    expect(result.estimatedCostTier).toBe("cloud_free_tier");
    expect(result.wordTimings).toBeUndefined();
  });

  it("routes MSA balanced Arabic to Google only when configured", () => {
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "test-project");
    vi.stubEnv("GOOGLE_CLOUD_TTS_DEFAULT_VOICE", "ar-XA-Standard-A");
    delete process.env.ELEVENLABS_API_KEY;
    const registry = new VoiceRegistry(dummyKokoro, "");

    const msa = registry.route({
      text: "مرحبا بكم في خدمة تصميم المواقع",
      language: "ar",
      dialect: "msa",
      qualityProfile: "balanced",
      requestedProvider: "auto",
    });
    expect(msa.providerId).toBe("google_cloud_tts");

    const egyptian = registry.route({
      text: "اعمل اعلان 20 ثانية عن تصميم مواقع",
      language: "ar",
      dialect: "egyptian",
      qualityProfile: "balanced",
      requestedProvider: "auto",
    });
    expect(egyptian.providerId).toBe("piper");
  });

  it("does not silently fallback when explicit paid or cloud providers are unavailable", () => {
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "");
    vi.stubEnv("GOOGLE_CLOUD_TTS_CREDENTIALS_JSON", "");
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "");
    vi.stubEnv("GCLOUD_PROJECT", "");
    vi.stubEnv("GOOGLE_CLOUD_PROJECT_ID", "");
    delete process.env.ELEVENLABS_API_KEY;
    const registry = new VoiceRegistry(dummyKokoro, "");

    expect(() =>
      registry.route({
        text: "مرحبا",
        language: "ar",
        dialect: "msa",
        requestedProvider: "google_cloud_tts",
        fallbackPolicy: "local",
      }),
    ).toThrow(/google_cloud_tts/);

    expect(() =>
      registry.route({
        text: "Hello",
        language: "en",
        requestedProvider: "elevenlabs",
        fallbackPolicy: "local",
      }),
    ).toThrow(/elevenlabs/);
  });

  it("normalizes Arabic speech numbers and pronunciation overrides", () => {
    const result = preprocessArabicSpeech("ABUD يعمل API خلال 20 ثانية وبخصم 15%", {
      dialect: "egyptian",
      pronunciationOverrides: { ABUD: "عبود" },
    });

    expect(result.spokenText).toContain("عبود");
    expect(result.spokenText).toContain("ايه بي آي");
    expect(result.spokenText).toContain("عشرين");
    expect(result.spokenText).toContain("خمستاشر في المية");
  });

  it("hardens Arabic speech preprocessing for mixed business terms", () => {
    const result = preprocessArabicSpeech("ChatGPT و n8n مع API و SEO في 2026 الساعة 10:30، السعر 1500 جنيه وخصم 50% على abud.fun", {
      dialect: "egyptian",
      pronunciationOverrides: { ABUD: "عبود الرسمي" },
    });

    expect(result.spokenText).toContain("شات جي بي تي");
    expect(result.spokenText).toContain("إن إيت إن");
    expect(result.spokenText).toContain("ايه بي آي");
    expect(result.spokenText).toContain("إس إي أو");
    expect(result.spokenText).toContain("سنة الفين ستة وعشرين");
    expect(result.spokenText).toContain("عشرة ونص");
    expect(result.spokenText).toContain("الف وخمسمية جنيه");
    expect(result.spokenText).toContain("خمسين في المية");
    expect(result.spokenText).toContain("abud دوت fun");
  });
});
