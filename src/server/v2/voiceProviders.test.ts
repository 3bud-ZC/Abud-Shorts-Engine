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
import { EdgeTtsProvider } from "./voice-providers/edgeTtsProvider";
import { normalizeElevenLabsVoice, ELEVENLABS_PRESETS, ELEVENLABS_DEFAULT_MODEL_ID } from "./voice-providers/elevenlabsVoiceProvider";
import { ARABIC_ELEVENLABS_REQUIRED_MESSAGE, isLegacyPiperVoiceId } from "./voice-providers/types";

const TEST_ELEVENLABS_KEY = "sk_test_key_that_is_long_enough";

const EGYPTIAN_TEST_SCRIPT =
  "لو عندك بيزنس ولسه موقعك شكله قديم أو مش موجود أصلاً، " +
  "فإنت غالباً بتسيب عملاء يروحوا لمنافسك من غير ما تحس. " +
  "موقع سريع وشكله احترافي ممكن يفرق معاك جداً. " +
  "ابدأ دلوقتي وخلي شغلك يظهر بالشكل اللي يستحقه.";

function stubPiperConfigured() {
  vi.stubEnv("PIPER_BIN", process.execPath);
  vi.stubEnv("PIPER_AR_MODEL_PATH", __filename);
  vi.stubEnv("PIPER_AR_MODEL_CONFIG_PATH", __filename);
  vi.stubEnv("PIPER_AR_VOICE_ID", "ar_JO-kareem-medium");
}

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
    delete process.env.ELEVENLABS_API_KEY;
    const registry = new VoiceRegistry(dummyKokoro, "");
    const provider = registry.getProvider("elevenlabs");
    expect(provider.id).toBe("kokoro");

    const voices = await registry.listAllVoices();
    expect(voices.some((v) => v.provider === "kokoro")).toBe(true);
    // Voice discovery is live-only: an unconfigured ElevenLabs contributes no
    // placeholder voices rather than a hardcoded catalogue.
    expect(voices.some((v) => v.provider === "elevenlabs")).toBe(false);
  });

  it("routes Arabic, Egyptian and MSA narration to ElevenLabs", () => {
    // Piper is fully installed here to prove it is never chosen for production.
    stubPiperConfigured();
    const registry = new VoiceRegistry(dummyKokoro, TEST_ELEVENLABS_KEY);

    for (const dialect of ["egyptian", "msa", "none"] as const) {
      const decision = registry.route({
        text: EGYPTIAN_TEST_SCRIPT,
        language: "ar",
        dialect,
        qualityProfile: "balanced",
        requestedProvider: "auto",
      });
      expect(decision.providerId).toBe("elevenlabs");
      expect(decision.reason).toBe("arabic_production_elevenlabs");
    }
  });

  it("blocks Arabic production with an actionable error when ElevenLabs is not configured", () => {
    stubPiperConfigured();
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "test-project");
    vi.stubEnv("EDGE_TTS_ENABLED", "true");
    delete process.env.ELEVENLABS_API_KEY;
    const registry = new VoiceRegistry(dummyKokoro, "");

    expect(registry.isArabicProductionConfigured()).toBe(false);
    expect(() =>
      registry.route({
        text: EGYPTIAN_TEST_SCRIPT,
        language: "ar",
        dialect: "egyptian",
        requestedProvider: "auto",
        fallbackPolicy: "local",
      }),
    ).toThrow(ARABIC_ELEVENLABS_REQUIRED_MESSAGE);
  });

  it("never falls back to a local or cloud provider for Arabic", () => {
    stubPiperConfigured();
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "test-project");
    vi.stubEnv("GOOGLE_CLOUD_TTS_DEFAULT_VOICE", "ar-XA-Standard-A");
    const registry = new VoiceRegistry(dummyKokoro, TEST_ELEVENLABS_KEY);

    for (const provider of ["piper", "kokoro", "edge_tts", "google_cloud_tts"] as const) {
      expect(() =>
        registry.route({
          text: EGYPTIAN_TEST_SCRIPT,
          language: "ar",
          dialect: "egyptian",
          requestedProvider: provider,
          fallbackPolicy: "local",
        }),
      ).toThrow(ARABIC_ELEVENLABS_REQUIRED_MESSAGE);
    }
  });

  it("keeps a historical Piper voice ID readable without sending it to ElevenLabs", () => {
    // Old jobs persisted ar_JO-kareem-medium. Metadata must stay parseable, but
    // a Piper model name must never be forwarded as an ElevenLabs voice.
    expect(isLegacyPiperVoiceId("ar_JO-kareem-medium")).toBe(true);
    vi.stubEnv("ELEVENLABS_DEFAULT_VOICE_ID", "acct_voice_1");
    const registry = new VoiceRegistry(dummyKokoro, TEST_ELEVENLABS_KEY);

    const decision = registry.route({
      text: EGYPTIAN_TEST_SCRIPT,
      language: "ar",
      dialect: "egyptian",
      requestedProvider: "auto",
      voiceId: "ar_JO-kareem-medium",
    });
    expect(decision.providerId).toBe("elevenlabs");
    expect(decision.voiceId).toBe("acct_voice_1");
  });

  it("sends language_code ar and the multilingual model for Arabic narration", async () => {
    let capturedBody: any = null;
    nock("https://api.elevenlabs.io")
      .post(/\/v1\/text-to-speech\/.*/, (body) => {
        capturedBody = body;
        return true;
      })
      .query(true)
      .reply(200, Buffer.from("mp3-bytes"));

    const provider = new ElevenLabsVoiceProvider(TEST_ELEVENLABS_KEY);
    const result = await provider.generateVoice(EGYPTIAN_TEST_SCRIPT, "voice_abc");

    expect(capturedBody.language_code).toBe("ar");
    expect(capturedBody.model_id).toBe(ELEVENLABS_DEFAULT_MODEL_ID);
    expect(result.voiceId).toBe("voice_abc");
    expect(result.estimatedCostTier).toBe("premium");
    // Cost is usage based; the engine must not invent a dollar amount.
    expect(result.usageBasedCost).toBe(true);
    expect(result.estimatedCost).toBeUndefined();
  });

  it("keeps the same voice and model across every scene of one video", async () => {
    const bodies: any[] = [];
    nock("https://api.elevenlabs.io")
      .post(/\/v1\/text-to-speech\/.*/, (body) => {
        bodies.push(body);
        return true;
      })
      .query(true)
      .times(3)
      .reply(200, Buffer.from("mp3-bytes"));

    const registry = new VoiceRegistry(dummyKokoro, TEST_ELEVENLABS_KEY);
    const results = [];
    for (const sceneText of ["المشهد الاول", "المشهد التاني", "المشهد التالت"]) {
      results.push(
        await registry.synthesize({
          text: sceneText,
          language: "ar",
          dialect: "egyptian",
          requestedProvider: "auto",
          voiceId: "voice_abc",
        }),
      );
    }

    expect(new Set(results.map((result) => result.voiceId)).size).toBe(1);
    expect(new Set(bodies.map((body) => body.model_id)).size).toBe(1);
    expect(new Set(bodies.map((body) => JSON.stringify(body.voice_settings))).size).toBe(1);
  });

  it("normalizes discovered ElevenLabs voices without inventing metadata", () => {
    const arabicVoice = normalizeElevenLabsVoice({
      voice_id: "abc123",
      name: "Nour",
      category: "premade",
      labels: { accent: "egyptian", gender: "female" },
      preview_url: "https://example.com/preview.mp3",
    });
    expect(arabicVoice?.id).toBe("abc123");
    expect(arabicVoice?.provider).toBe("elevenlabs");
    expect(arabicVoice?.language).toBe("ar");
    expect(arabicVoice?.dialect).toBe("egyptian");
    expect(arabicVoice?.gender).toBe("female");
    expect(arabicVoice?.previewUrl).toBe("https://example.com/preview.mp3");

    // Without Arabic metadata the voice stays "multilingual" and no dialect or
    // gender is asserted.
    const genericVoice = normalizeElevenLabsVoice({ voice_id: "xyz789", name: "Sam" });
    expect(genericVoice?.language).toBe("multilingual");
    expect(genericVoice?.dialect).toBeUndefined();
    expect(genericVoice?.gender).toBeUndefined();

    expect(normalizeElevenLabsVoice({ name: "no id" })).toBeNull();
  });

  it("returns no voices and never a hardcoded catalogue when ElevenLabs is unconfigured", async () => {
    const provider = new ElevenLabsVoiceProvider("");
    expect(await provider.listVoices("ar")).toEqual([]);
  });

  it("maps voice presets only onto documented ElevenLabs settings", () => {
    const provider = new ElevenLabsVoiceProvider(TEST_ELEVENLABS_KEY);
    const allowedKeys = ["stability", "similarity_boost", "style", "use_speaker_boost"];

    for (const preset of ["natural", "energetic_ad", "professional", "storytelling", "calm"] as const) {
      const settings = provider.resolveVoiceSettings(preset);
      expect(Object.keys(settings).sort()).toEqual([...allowedKeys].sort());
      expect(settings.stability).toBeGreaterThanOrEqual(0);
      expect(settings.stability).toBeLessThanOrEqual(1);
      expect(settings).toEqual(expect.objectContaining(ELEVENLABS_PRESETS[preset]));
    }

    // Custom overrides are clamped rather than passed through blindly.
    expect(provider.resolveVoiceSettings("natural", { stability: 5 }).stability).toBe(1);
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

  it("resolves Arabic voice listing to ElevenLabs and English Auto to Kokoro", async () => {
    stubPiperConfigured();
    nock("https://api.elevenlabs.io")
      .get("/v1/voices")
      .reply(200, {
        voices: [
          { voice_id: "v1", name: "Nour", category: "premade", labels: { accent: "egyptian" } },
          { voice_id: "v2", name: "Sam", category: "premade", labels: {} },
        ],
      });
    const registry = new VoiceRegistry(dummyKokoro, TEST_ELEVENLABS_KEY);

    const arabic = await registry.listCompatibleVoices({
      provider: "auto",
      language: "ar",
      dialect: "egyptian",
    });
    expect(arabic.resolvedProvider).toBe("elevenlabs");
    expect(arabic.blocked).toBeFalsy();
    expect(arabic.voices.length).toBe(2);
    expect(arabic.voices.every((voice) => voice.provider === "elevenlabs")).toBe(true);
    // Arabic-verified voices are listed first, but multilingual ones remain usable.
    expect(arabic.voices[0].id).toBe("v1");

    const english = await registry.listCompatibleVoices({
      provider: "auto",
      language: "en",
      dialect: "none",
    });
    expect(english.resolvedProvider).toBe("kokoro");
    expect(english.voices.every((voice) => voice.provider === "kokoro")).toBe(true);
  });

  it("reports Arabic voice listing as blocked when ElevenLabs is missing", async () => {
    stubPiperConfigured();
    delete process.env.ELEVENLABS_API_KEY;
    const registry = new VoiceRegistry(dummyKokoro, "");

    const arabic = await registry.listCompatibleVoices({
      provider: "auto",
      language: "ar",
      dialect: "egyptian",
    });
    expect(arabic.resolvedProvider).toBe("elevenlabs");
    expect(arabic.blocked).toBe(true);
    expect(arabic.voices).toEqual([]);
    expect(arabic.warnings.join(" ")).toContain("ElevenLabs");
  });

  it("reports Edge TTS as optional when disabled", async () => {
    vi.stubEnv("EDGE_TTS_ENABLED", "false");
    const provider = new EdgeTtsProvider();
    const validation = await provider.validate();
    expect(validation.status).toBe("not_configured");
    expect(provider.getCapabilities().costTier).toBe("experimental_free_online");
  });

  it("does not silently fallback when explicit paid or cloud providers are unavailable", () => {
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "");
    vi.stubEnv("GOOGLE_CLOUD_TTS_CREDENTIALS_JSON", "");
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "");
    vi.stubEnv("GCLOUD_PROJECT", "");
    vi.stubEnv("GOOGLE_CLOUD_PROJECT_ID", "");
    delete process.env.ELEVENLABS_API_KEY;
    const registry = new VoiceRegistry(dummyKokoro, "");

    // Arabic is refused with the ElevenLabs policy message, not a provider message.
    expect(() =>
      registry.route({
        text: "مرحبا",
        language: "ar",
        dialect: "msa",
        requestedProvider: "google_cloud_tts",
        fallbackPolicy: "local",
      }),
    ).toThrow(ARABIC_ELEVENLABS_REQUIRED_MESSAGE);

    expect(() =>
      registry.route({
        text: "Hello",
        language: "en",
        requestedProvider: "elevenlabs",
        fallbackPolicy: "local",
      }),
    ).toThrow(/elevenlabs/);
  });

  it("preserves conversational Egyptian wording instead of formalizing it", () => {
    const result = preprocessArabicSpeech(EGYPTIAN_TEST_SCRIPT, { dialect: "egyptian" });

    // The product owner wants Egyptian narration, so these words must survive
    // verbatim in every derived text form.
    for (const token of ["إنت", "مش", "لسه", "دلوقتي", "عندك", "معاك"]) {
      expect(result.captionText).toContain(token);
      expect(result.spokenNarration).toContain(token);
      expect(result.ttsNormalizedText).toContain(token);
    }
    // No MSA rewrite of the Egyptian negation / present-tense markers.
    expect(result.spokenNarration).not.toContain("ليس");
    expect(result.spokenNarration).not.toContain("الآن");
  });

  it("separates source, spoken, TTS and caption text", () => {
    const result = preprocessArabicSpeech("السعر 1500 جنيه بخصم 30%", { dialect: "egyptian" });

    expect(result.sourceText).toBe("السعر 1500 جنيه بخصم 30%");
    // Captions keep the digits a viewer expects to read.
    expect(result.captionText).toContain("1500");
    expect(result.captionText).toContain("30%");
    // Only the TTS form expands numbers into spoken words.
    expect(result.ttsNormalizedText).not.toContain("1500");
    expect(result.ttsNormalizedText).toContain("الف وخمسمية جنيه");
    expect(result.ttsNormalizedText).toContain("تلاتين في المية");
  });

  it("normalizes numbers without changing their meaning", () => {
    const year = preprocessArabicSpeech("في 2026", { dialect: "egyptian" });
    expect(year.ttsNormalizedText).toContain("سنة الفين ستة وعشرين");

    const time = preprocessArabicSpeech("الساعة 10:30", { dialect: "egyptian" });
    expect(time.ttsNormalizedText).toContain("عشرة ونص");

    const price = preprocessArabicSpeech("1500 جنيه", { dialect: "egyptian" });
    expect(price.ttsNormalizedText).toContain("الف وخمسمية جنيه");

    const percent = preprocessArabicSpeech("خصم 30%", { dialect: "egyptian" });
    expect(percent.ttsNormalizedText).toContain("تلاتين في المية");
  });

  it("keeps recognizable English business terms readable in mixed Arabic text", () => {
    const result = preprocessArabicSpeech(
      "الـ AI والـ API والـ SaaS مع ChatGPT و WhatsApp للـ product والـ customer",
      { dialect: "egyptian" },
    );

    // Acronyms are spelled out so they are pronounced, not read as one word.
    expect(result.ttsNormalizedText).toContain("إيه آي");
    expect(result.ttsNormalizedText).toContain("ايه بي آي");
    expect(result.ttsNormalizedText).toContain("شات جي بي تي");
    expect(result.ttsNormalizedText).toContain("واتساب");
    // The caption keeps the original Latin spelling for the reader.
    expect(result.captionText).toContain("ChatGPT");
    expect(result.captionText).toContain("WhatsApp");
    expect(result.captionText).toContain("SaaS");
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
