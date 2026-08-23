const axios = require("axios");
const fs = require("fs");
const path = require("path");

const API_BASE = "http://localhost:3130/api/v2";

async function pollJob(jobId, testName) {
  console.log(`\n[${testName}] Starting polling for job: ${jobId}`);
  const startTime = Date.now();
  while (true) {
    const res = await axios.get(`${API_BASE}/jobs/${jobId}`);
    const job = res.data.job;
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(
      `[${testName}] [${elapsed}s] Status: ${job.status} | Progress: ${job.progress}% | Stage: ${job.currentStage}`,
    );

    if (job.status === "ready") {
      console.log(`[${testName}] SUCCESS! Video ready in ${elapsed}s`);
      return job;
    }
    if (job.status === "failed") {
      console.error(`[${testName}] FAILED! Error: ${job.error}`);
      console.error(job.technicalError);
      throw new Error(`Job ${jobId} failed: ${job.error}`);
    }

    await new Promise((r) => setTimeout(r, 4000));
  }
}

async function runTests() {
  console.log("===============================================================");
  console.log("ABUD Shorts Engine V2-03 Live Runtime Verification Suite");
  console.log("===============================================================\n");

  // TEST A: High Quality 9:16 Prompt Mode (Egyptian Arabic 25s)
  console.log("--- Launching TEST A: Free High-Quality Prompt Mode (9:16, 25s, Egyptian Arabic) ---");
  const testAPayload = {
    type: "video",
    creationMode: "prompt",
    title: "Egyptian Summer Streetwear Ad",
    prompt:
      "اعمل اعلان 25 ثانية باللهجة المصرية لبراند ملابس كاجوال شبابي، البداية هوك قوي عن الشياكة والراحة في الصيف، وفي النص وضح خامة القطن المصري الفاخر والتصميم العصري، والختام كول تو اكشن للطلب على واتساب مع شحن مجاني.",
    language: "ar",
    dialect: "egyptian",
    duration: 25,
    aspectRatio: "9:16",
    quality: "high",
    captionStyle: "viral",
  };

  const resA = await axios.post(`${API_BASE}/jobs`, testAPayload);
  const jobA = await pollJob(resA.data.job.id, "TEST A");

  // TEST B: Landscape 16:9 Video (20s, YouTube / Desktop format)
  console.log("\n--- Launching TEST B: Landscape Video (16:9, 20s, Educational Tech) ---");
  const testBPayload = {
    type: "video",
    creationMode: "prompt",
    title: "Modern Tech Automated Backup Guide",
    prompt:
      "Create a 20-second English educational video explaining why automated cloud backups protect modern businesses from data loss. Use modern technology visuals and a clear call to action.",
    language: "en",
    duration: 20,
    aspectRatio: "16:9",
    quality: "standard",
    captionStyle: "bold",
  };

  const resB = await axios.post(`${API_BASE}/jobs`, testBPayload);
  const jobB = await pollJob(resB.data.job.id, "TEST B");

  // TEST C: Template Mode Regression Video (Egyptian Business Template)
  console.log("\n--- Launching TEST C: Template Mode Regression (Product Ad, 20s) ---");
  const testCPayload = {
    type: "video",
    creationMode: "template",
    title: "Golden Path Premium Tee Template",
    businessTemplateId: "product_ad",
    businessTemplateData: {
      productName: "Classic Oversized Egyptian Cotton Tee",
      productCategory: "Streetwear",
      targetCustomer: "شباب وبنات بيحبوا الاستايل المودرن",
      mainBenefit: "قطن مصري 100% مريح جدا في الصيف وقصة رايقة",
      priceOrOffer: "خصم 25% والشحن مجاني لفترة محدودة",
      contactMethod: "اطلب دلوقتي على واتساب",
    },
    config: {
      voice: "af_heart",
      music: "chill",
      musicVolume: "high",
      orientation: "portrait",
      paddingBack: 0,
      captionPosition: "bottom",
      brandKit: {
        brandName: "ABUD Streetwear",
        watermarkText: "ABUD",
        captionStyle: "bold",
        includeOutro: true,
        outroText: "اطلب الآن عبر واتساب",
        contactText: "+20 100 000 0000",
      },
    },
  };

  const resC = await axios.post(`${API_BASE}/jobs`, testCPayload);
  const jobC = await pollJob(resC.data.job.id, "TEST C");

  console.log("\n===============================================================");
  console.log("VERIFICATION SUMMARY REPORT");
  console.log("===============================================================");
  console.log("Test A (9:16 Prompt Mode High Quality):", {
    jobId: jobA.id,
    videoId: jobA.output?.videoId,
    duration: jobA.output?.metadata?.durationSeconds,
    qualityScore: jobA.output?.metadata?.qualityScore,
    thumbnailUrl: jobA.output?.metadata?.thumbnailUrl,
    sizeBytes: jobA.output?.metadata?.sizeBytes,
  });

  console.log("Test B (16:9 Landscape Video):", {
    jobId: jobB.id,
    videoId: jobB.output?.videoId,
    duration: jobB.output?.metadata?.durationSeconds,
    qualityScore: jobB.output?.metadata?.qualityScore,
    thumbnailUrl: jobB.output?.metadata?.thumbnailUrl,
    sizeBytes: jobB.output?.metadata?.sizeBytes,
  });

  console.log("Test C (Template Mode Regression):", {
    jobId: jobC.id,
    videoId: jobC.output?.videoId,
    duration: jobC.output?.metadata?.durationSeconds,
    qualityScore: jobC.output?.metadata?.qualityScore,
    thumbnailUrl: jobC.output?.metadata?.thumbnailUrl,
    sizeBytes: jobC.output?.metadata?.sizeBytes,
  });
}

runTests().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
