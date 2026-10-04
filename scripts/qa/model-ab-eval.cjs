/**
 * Model A/B qualification harness — calls Ollama /api/generate DIRECTLY with
 * the same planner request shape the production OllamaContentAIProvider uses,
 * and preserves the RAW model response (before extractJsonObject / schema
 * repair / deterministic assembly) so a weak model cannot be hidden by
 * downstream guards.
 *
 * Usage: node scripts/qa/model-ab-eval.cjs <model> <outfile.json> [--think]
 */
const fs = require("fs");
const path = require("path");
const axios = require("axios");
// Use the REAL contract builder so the A/B payload matches production exactly.
const {
  buildPromptIntentContract,
} = require(path.resolve(__dirname, "../../dist/server/v2/content-ai/promptIntentContract.js"));

const OLLAMA = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const model = process.argv[2];
const outfile = process.argv[3];
const think = process.argv.includes("--think") ? true : process.argv.includes("--no-think") ? false : undefined;

// --- prompts: >=12, mixed Egyptian Arabic / MSA / English / code-switch ---
const PROMPTS = [
  // 4 Egyptian Arabic business/consumer
  { id: "AR-B1", lang: "ar", text: "عايز فيديو 15 ثانية عن محل عصير قصب اسمه «سكر حامض» في شبرا، العصير طازة وبيستخدم قصب بلدي، قول للناس تيجي تجرب" },
  { id: "AR-B2", lang: "ar", text: "محتاج إعلان لجيم ستيلتو في مدينة نصر، عندهم اشتراك شهري ومدربين محترفين، 12 ثانية بالمصري" },
  { id: "AR-B3", lang: "ar", text: "اعملي فيديو عن خدمة غسيل سيارات متنقلة اسمها «لمعة»، بيوصلوا لحد البيت، 15 ثانية" },
  { id: "AR-B4", lang: "ar", text: "فيديو قصير عن مخبز بلدي في الإسكندرية بيعمل عيش شمسي وفطير كل يوم الصبح" },
  // 3 Egyptian Arabic abstract technical
  { id: "AR-T1", lang: "ar", text: "اشرح للناس إيه هو الـ API caching وليه بيخلي المواقع أسرع، فيديو 15 ثانية بالعامية المصرية" },
  { id: "AR-T2", lang: "ar", text: "فيديو يشرح فكرة الـ load balancing في السيرفرات بطريقة بسيطة للمبرمجين الجداد" },
  { id: "AR-T3", lang: "ar", text: "عايز فيديو يوضح إزاي الـ database indexing بيسرّع البحث في الداتابيز، 15 ثانية" },
  // 2 Arabic + English code-switch technical
  { id: "MIX-1", lang: "ar", text: "فيديو تقني يشرح الفرق بين encryption at rest و encryption in transit للمطورين، خلي المصطلحات الإنجليزية زي ما هي" },
  { id: "MIX-2", lang: "ar", text: "اشرح إزاي cloud backup بيحمي ملفاتك لما الجهاز يبوظ، وإيه الفرق بين sync و backup الحقيقي" },
  // 1 MSA informational
  { id: "MSA-1", lang: "ar", text: "فيديو توعوي عن أهمية التوفير التلقائي في البنوك وكيف يساعد الأفراد على بناء مدخراتهم دون جهد" },
  // 1 English explainer
  { id: "EN-E1", lang: "en", text: "Explain how database indexing works and why queries get faster, 15 seconds" },
  // 1 English commercial
  { id: "EN-C1", lang: "en", text: "15-second ad for a budgeting app called PennyWise that helps families track spending automatically" },
];

function buildRequest(p) {
  const isAr = p.lang === "ar" || /[\u0600-\u06FF]/.test(p.text);
  const languageLabel =
    p.id === "MSA-1"
      ? "Modern Standard Arabic"
      : isAr
        ? "spoken Egyptian Arabic (عامية مصرية), never formal MSA"
        : "English";
  const durationSeconds = 15;
  const contract = buildPromptIntentContract(p.text, {
    language: isAr ? "ar" : "en",
    dialect: p.id === "MSA-1" ? "standard" : isAr ? "egyptian" : "none",
    durationSeconds,
  });
  const targetScenes = contract.estimatedSceneCount || 4;
  const system = [
    "You are a short-form vertical video creative director and scriptwriter.",
    "The customer brief below describes the video they want. Turn it into a complete creative plan and return ONLY JSON:",
    '{"title": "...", "tone": "...", "scenes": [{"purpose": "hook|problem|solution|benefit|proof|cta", "narration": "...", "onScreenText": "...", "visualIntent": "...", "searchQueries": ["...", "..."]}], "cta": "optional", "expansionLines": ["optional extra supporting sentences"]}',
    `Write all narration in ${languageLabel}, as fresh natural spoken lines - never copy sentences from the brief itself.`,
    "When writing Arabic narration: keep established English technical terms in English exactly as people say them (API, cache, backend, frontend, server, database, HTTP, app, code, deploy) - never invent Arabic transliterations of English words and never write fake Arabic-sounding tech words. Plain everyday spoken Arabic is better than ornate phrasing.",
    `Total spoken narration must fit about ${durationSeconds}s of video across roughly ${targetScenes} scenes.`,
    "Rules: 1) The brief is INPUT, not narration - never read its sentences back; 2) Never invent prices, discounts, discounts codes, phone numbers, WhatsApp, websites, testimonials, statistics or guarantees not present in the brief; 3) Honour every negative constraint; 4) onScreenText is a short punchy overlay line, not a duplicate of narration; 5) visualIntent describes the concrete shot this scene needs; 6) searchQueries MUST be written in English words only, even for Arabic briefs - they query an English stock-footage API. 3-5 SHORT concrete visual search phrases, each a different angle (subject / action / environment / detail / result) - never mood words like 'cinematic' or 'professional' and never Arabic; 7) each scene gets a DIFFERENT purpose (only the first may be 'hook', only the last may be 'cta'); 8) the final scene should deliver the takeaway or call-to-action.",
  ].join("\n");
  const requestPayload = {
    brief: p.text,
    intent: {
      requestedTopic: contract.requestedTopic,
      coreEntity: contract.coreEntity,
      intentType: contract.intentType,
      factualRequirements: contract.factualRequirements,
      subjectEntities: contract.subjectEntities,
      quotedPhrases: contract.quotedPhrases,
      negativeConstraints: contract.negativeConstraints,
      requestedExclusions: contract.requestedExclusions,
      explicitHook: contract.explicitHook,
      explicitMiddleMessage: contract.explicitMiddleMessage,
      explicitCta: contract.explicitCta || contract.requestedCta?.explicitText,
      audience: contract.audience,
      tone: contract.tone,
      location: contract.location,
      productOrBusiness: contract.productOrBusiness,
      durationSeconds,
      targetSceneCount: contract.estimatedSceneCount || targetScenes,
      language: contract.language,
      dialect: contract.dialect,
    },
  };
  return { system, payload: JSON.stringify(requestPayload) };
}

async function callModel(p) {
  const { system, payload } = buildRequest(p);
  const body = {
    model,
    stream: false,
    system,
    prompt: payload,
    format: "json",
    options: { temperature: 0.3 },
  };
  if (think !== undefined) body.think = think;
  const started = Date.now();
  const res = await axios.post(`${OLLAMA}/api/generate`, body, { timeout: 300000 });
  const latencyMs = Date.now() - started;
  const raw = typeof res.data?.response === "string" ? res.data.response : JSON.stringify(res.data);
  let parsed = null;
  let parseError = null;
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("no JSON object in output");
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch (e) {
    parseError = e.message;
  }
  return {
    promptId: p.id,
    latencyMs,
    evalDuration: res.data?.eval_duration,
    thinking: typeof res.data?.thinking === "string" ? res.data.thinking : undefined,
    raw,
    rawChars: raw.length,
    parsed,
    parseError,
    done: res.data?.done,
  };
}

async function main() {
  if (!model || !outfile) {
    console.error("usage: node model-ab-eval.cjs <model> <outfile>");
    process.exit(1);
  }
  const results = { model, think, startedAt: new Date().toISOString(), prompts: [] };
  for (const p of PROMPTS) {
    process.stderr.write(`[${model}] ${p.id}... `);
    try {
      const r = await callModel(p);
      results.prompts.push(r);
      process.stderr.write(`${r.latencyMs}ms ${r.parsed ? "json-ok" : "PARSE-FAIL"}\n`);
    } catch (e) {
      results.prompts.push({ promptId: p.id, error: e.message, axios: e.response?.status });
      process.stderr.write(`ERROR ${e.message}\n`);
    }
  }
  results.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(path.resolve(outfile)), { recursive: true });
  fs.writeFileSync(outfile, JSON.stringify(results, null, 1));
  console.log(`wrote ${outfile}`);
}

main();
