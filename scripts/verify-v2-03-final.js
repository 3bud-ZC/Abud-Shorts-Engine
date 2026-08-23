const axios = require("axios");

const BASE_URL = "http://localhost:3130";

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForJob(jobId, maxWaitSec = 480) {
  console.log(`[Job ${jobId}] Polling status...`);
  const start = Date.now();
  while (Date.now() - start < maxWaitSec * 1000) {
    try {
      const res = await axios.get(`${BASE_URL}/api/v2/jobs/${jobId}`);
      const job = res.data.job;
      console.log(`  [${job.status}] ${job.progress}% - ${job.currentStage} (${job.message || ""})`);
      if (job.status === "ready") {
        return job;
      }
      if (job.status === "failed") {
        throw new Error(`Job failed: ${job.error || job.technicalError || "Unknown error"}`);
      }
    } catch (err) {
      if (err.response?.status !== 404) {
        console.warn(`  Warning fetching job status: ${err.message}`);
      }
    }
    await sleep(3000);
  }
  throw new Error(`Job ${jobId} timed out after ${maxWaitSec}s`);
}

async function runVerification() {
  console.log("=================================================================");
  console.log("ABUD Shorts Engine V2-03 FINAL LIVE RUNTIME VERIFICATION SUITE");
  console.log("=================================================================");

  // ---------------------------------------------------------------------------
  // TEST A: 25-Second Egyptian Arabic Streetwear Ad (9:16, Prompt Mode)
  // ---------------------------------------------------------------------------
  console.log("\n>>> Tracking/Launching TEST A: 25s High-Quality Egyptian Arabic Streetwear Ad (9:16 Portrait)");
  let jobIdA = "cmt4agi1r000107qt67qzcgl5";
  try {
    const existingA = await axios.get(`${BASE_URL}/api/v2/jobs/${jobIdA}`);
    console.log(`Attached to existing Job A: ${jobIdA} (${existingA.data.job.status})`);
  } catch {
    const promptA = "اعمل إعلان 25 ثانية باللهجة المصرية لبراند ملابس كاجوال شبابي، البداية هوك قوي عن الشياكة والراحة في الصيف، وفي النص وضح خامة القطن المصري، والختام CTA للطلب على واتساب.";
    const resA = await axios.post(`${BASE_URL}/api/v2/jobs`, {
      creationMode: "prompt",
      prompt: promptA,
      duration: 25,
      language: "ar",
      dialect: "egyptian",
      aspectRatio: "9:16",
      quality: "high",
      contentStyle: "advertisement",
      captionStyle: "viral",
      visualMode: "auto",
      voiceProvider: "kokoro",
    });
    jobIdA = resA.data.job.id;
    console.log(`Job A Created: ${jobIdA}`);
  }
  const completedA = await waitForJob(jobIdA, 480);

  // ---------------------------------------------------------------------------
  // TEST B: 20-Second Landscape Tech Explainer Video (16:9, Prompt Mode)
  // ---------------------------------------------------------------------------
  console.log("\n>>> Launching TEST B: 20s Landscape Tech Explainer (16:9 Landscape)");
  const promptB = "Create a 20-second landscape technology video explaining cloud backup for small businesses, with a concise hook, simple explanation, and clear CTA.";
  const resB = await axios.post(`${BASE_URL}/api/v2/jobs`, {
    creationMode: "prompt",
    prompt: promptB,
    duration: 20,
    language: "en",
    aspectRatio: "16:9",
    quality: "standard",
    contentStyle: "educational",
    captionStyle: "bold",
    visualMode: "auto",
    voiceProvider: "kokoro",
  });
  const jobB = resB.data.job;
  console.log(`Job B Created: ${jobB.id}`);
  const completedB = await waitForJob(jobB.id, 480);

  // ---------------------------------------------------------------------------
  // TEST C: 20-Second Template Mode Video (9:16, Product Ad Template)
  // ---------------------------------------------------------------------------
  console.log("\n>>> Launching TEST C: 20s Template Mode Video (Product Ad)");
  const resC = await axios.post(`${BASE_URL}/api/v2/jobs`, {
    creationMode: "template",
    businessTemplateId: "product_ad",
    duration: 20,
    businessTemplateData: {
      productName: "Classic Oversized Egyptian Cotton Tee",
      productCategory: "Streetwear",
      targetAudience: "شباب وبنات بيحبوا الاستايل المودرن",
      keyBenefit1: "قطن مصري 100% مريح جدا في الصيف وقصة رايقة",
      offerHook: "خصم 25% والشحن مجاني لفترة محدودة",
      contactMethod: "اطلب دلوقتي على واتساب",
    },
    config: {
      orientation: "portrait",
      brandKit: {
        brandName: "ABUD Streetwear",
        watermarkText: "ABUD",
        captionStyle: "clean",
      },
    },
  });
  const jobC = resC.data.job;
  console.log(`Job C Created: ${jobC.id}`);
  const completedC = await waitForJob(jobC.id, 480);

  // ---------------------------------------------------------------------------
  // Verification Results Inspection
  // ---------------------------------------------------------------------------
  console.log("\n=================================================================");
  console.log("FETCHING FINAL VIDEO METADATA & ARTIFACTS");
  console.log("=================================================================");

  for (const [label, jobId] of [["TEST A (25s Portrait)", jobIdA], ["TEST B (20s Landscape)", jobB.id], ["TEST C (20s Template)", jobC.id]]) {
    const videoRes = await axios.get(`${BASE_URL}/api/videos/${jobId}`);
    const meta = videoRes.data;
    const thumbRes = await axios.get(`${BASE_URL}/api/videos/${jobId}/thumbnail`, { responseType: "arraybuffer" });
    const downloadRes = await axios.head(`${BASE_URL}/api/videos/${jobId}/download`);

    console.log(`\n--- ${label} ---`);
    console.log(`Video ID:               ${meta.videoId}`);
    console.log(`Requested Duration:     ${meta.requestedDurationSeconds}s`);
    console.log(`Resolved Target:        ${meta.resolvedDurationSeconds}s`);
    console.log(`Final FFprobe Duration: ${meta.finalDurationSeconds}s`);
    console.log(`Duration Variance:      ${meta.durationVarianceSeconds}s (${meta.durationVariancePercent ?? 0}%)`);
    console.log(`Technical Score:        ${meta.technicalScore} / 100`);
    console.log(`Media Plan Score:       ${meta.mediaPlanScore} / 100`);
    console.log(`Overall Production:     ${meta.overallProductionScore} / 100`);
    console.log(`Resolution / Aspect:    ${meta.resolution} (${meta.aspectRatio})`);
    console.log(`File Size:              ${meta.sizeBytes} bytes (${(meta.sizeBytes / 1024 / 1024).toFixed(2)} MB)`);
    console.log(`Caption Preset Used:    ${meta.captionProfileUsed}`);
    console.log(`Music Track:            ${meta.musicTrack} (${meta.musicMood})`);
    console.log(`Motion Presets:         ${meta.motionPresetsUsed?.join(", ")}`);
    console.log(`Transitions:            ${meta.transitionPresetsUsed?.join(", ")}`);
    console.log(`Media Segments Count:   ${meta.mediaSegmentCount} sub-clips`);
    console.log(`Thumbnail Status:       HTTP ${thumbRes.status} (${thumbRes.data.length} bytes, MIME: ${thumbRes.headers["content-type"]})`);
    console.log(`Download Endpoint:      HTTP ${downloadRes.status} (Content-Length: ${downloadRes.headers["content-length"]})`);
  }
}

runVerification().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
