const { KokoroTTS } = require("kokoro-js");

async function test() {
  console.log("Loading Kokoro model...");
  const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
    dtype: "q8",
    device: "cpu",
  });

  const enText = "Looking for a stylish and comfortable t-shirt?";
  const arText = "بتدور على تيشرت شيك ومريح يفضل معاك في كل خروجة؟";

  console.log("Generating EN audio...");
  const streamEn = tts.stream(enText, { voice: "af_heart" });
  let enLen = 0;
  for await (const chunk of streamEn) {
    enLen += chunk.audio.audio.length / chunk.audio.sampling_rate;
  }
  console.log("EN duration:", enLen.toFixed(2), "s");

  console.log("Generating AR audio...");
  const streamAr = tts.stream(arText, { voice: "af_heart" });
  let arLen = 0;
  for await (const chunk of streamAr) {
    arLen += chunk.audio.audio.length / chunk.audio.sampling_rate;
  }
  console.log("AR duration:", arLen.toFixed(2), "s");
}

test().catch(console.error);
