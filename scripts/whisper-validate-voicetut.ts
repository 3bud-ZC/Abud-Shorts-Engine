/**
 * REAL Whisper validation of real VoiceTut output (Pass 9.8).
 * Runs the product's existing local Whisper timing system against the real
 * VoiceTut synthesis samples produced by first_proof.py. No fabricated
 * transcript or timing - every value below comes from whisper.cpp.
 */
import path from "path";
import { Config } from "../src/config";
import { Whisper } from "../src/short-creator/libraries/Whisper";

async function main() {
  const config = new Config();
  const whisper = await Whisper.init(config);

  const samples = [
    { name: "egyptian", file: path.join(__dirname, "..", "data-dev", "qa-samples", "voicetut-first-proof", "egyptian.wav") },
    { name: "code_switch", file: path.join(__dirname, "..", "data-dev", "qa-samples", "voicetut-first-proof", "code_switch.wav") },
  ];

  for (const sample of samples) {
    console.log(`\n=== ${sample.name} (${sample.file}) ===`);
    const captions = await whisper.CreateCaption(sample.file, "ar");
    console.log(`Caption count: ${captions.length}`);
    for (const c of captions) {
      console.log(`  [${c.startMs}ms - ${c.endMs}ms] "${c.text}"`);
    }
    const orderedOk = captions.every((c, i) => i === 0 || c.startMs >= captions[i - 1].startMs);
    const lastEnd = captions.length > 0 ? captions[captions.length - 1].endMs : 0;
    console.log(`Timestamps ordered: ${orderedOk}`);
    console.log(`Last caption end: ${lastEnd}ms`);
  }
}

main().catch((error) => {
  console.error("Whisper validation failed:", error);
  process.exit(1);
});
