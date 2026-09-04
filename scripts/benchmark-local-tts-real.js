/**
 * REAL Local TTS inference benchmark (Pass 9.8).
 *
 * Calls the actual running Local Egyptian TTS service over HTTP and measures
 * real wall-clock timing, real hardware counters from /health, and real
 * output audio bytes. No timing value in this script is simulated or
 * hardcoded — every number below comes from an HTTP round trip against a
 * live model.
 *
 * Usage: node scripts/benchmark-local-tts-real.js [baseUrl]
 */
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const baseUrl = process.argv[2] || process.env.LOCAL_TTS_BASE_URL || "http://127.0.0.1:8765";
const outDir = path.join(__dirname, "..", "data-dev", "qa-samples", "voicetut-benchmark");

const SENTENCES = [
  "إزيك يا صاحبي، عامل إيه النهارده؟",
  "النهارده عندنا عرض جديد، الحق العرض قبل ما يخلص.",
  "مع ABUD Demo الجديد، التجربة بقت أسرع وأسهل.",
  "الخصم خمسين في المية لمدة تلات أيام.",
  "تابعنا وشوف التفاصيل.",
];

const SPEAKERS = ["Mohamed", "Sarah", "Omar"];

function wavDurationSeconds(buffer) {
  // Minimal RIFF/WAVE parser: reads sample rate + data length from the header
  // we control (16-bit PCM mono), used only as an independent cross-check.
  const sampleRate = buffer.readUInt32LE(24);
  const bitsPerSample = buffer.readUInt16LE(34);
  const channels = buffer.readUInt16LE(22);
  const dataSize = buffer.readUInt32LE(40);
  const bytesPerSample = bitsPerSample / 8;
  return dataSize / (sampleRate * channels * bytesPerSample);
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`[benchmark] Target service: ${baseUrl}`);

  const health = await axios.get(`${baseUrl}/health`, { timeout: 5000 });
  console.log("[benchmark] /health:", JSON.stringify(health.data.hardware));

  const results = [];
  let firstCall = true;

  for (const speaker of SPEAKERS) {
    for (let i = 0; i < SENTENCES.length; i++) {
      const text = SENTENCES[i];
      const t0 = Date.now();
      let response;
      try {
        response = await axios.post(
          `${baseUrl}/synthesize`,
          { model: "voicetut", text, speakerId: speaker, speed: 1.0 },
          { timeout: Number(process.env.LOCAL_TTS_SYNTHESIS_TIMEOUT_MS || 180000) },
        );
      } catch (error) {
        console.error(`[benchmark] FAILED speaker=${speaker} sentence=${i + 1}:`, error.message);
        results.push({ speaker, sentenceIndex: i + 1, error: error.message });
        continue;
      }
      const wallMs = Date.now() - t0;

      const audioBase64 = String(response.data.audioBase64 || "").replace(/^data:audio\/wav;base64,/, "");
      const buffer = Buffer.from(audioBase64, "base64");
      const outFile = path.join(outDir, `${speaker}_${i + 1}.wav`);
      fs.writeFileSync(outFile, buffer);

      const durationSeconds = response.data.durationSeconds;
      const rtf = wallMs / 1000 / durationSeconds;

      const postHealth = await axios.get(`${baseUrl}/health`, { timeout: 5000 });

      const record = {
        speaker,
        sentenceIndex: i + 1,
        text,
        coldCall: firstCall,
        wallClockMs: wallMs,
        serverGenerationMs: response.data.generationMs,
        durationSeconds,
        wavDurationSecondsCrossCheck: Number(wavDurationSeconds(buffer).toFixed(3)),
        rtf: Number(rtf.toFixed(3)),
        outputBytes: buffer.length,
        sampleRate: response.data.sampleRate,
        ramFreeMbAfter: postHealth.data.hardware.ram_free_mb,
        vramFreeMbAfter: postHealth.data.hardware.vram_free_mb ?? null,
        cudaAvailable: postHealth.data.hardware.cuda_available,
        outFile,
      };
      results.push(record);
      console.log(
        `[benchmark] ${firstCall ? "COLD" : "warm"} speaker=${speaker} sentence=${i + 1} ` +
          `wall=${wallMs}ms duration=${durationSeconds}s rtf=${record.rtf} bytes=${buffer.length}`,
      );
      firstCall = false;
    }
  }

  const finalModels = await axios.get(`${baseUrl}/models`, { timeout: 5000 });
  const voicetutModel = (finalModels.data.models || []).find((m) => m.id === "voicetut");

  const summary = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    voicetutModel,
    results,
  };
  const summaryPath = path.join(outDir, "benchmark-summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`[benchmark] Summary written to ${summaryPath}`);
}

main().catch((error) => {
  console.error("[benchmark] Fatal error:", error);
  process.exit(1);
});
