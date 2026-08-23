const axios = require("axios");

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function monitorJob(jobId, name) {
  console.log(`\nMonitoring ${name} (ID: ${jobId})...`);
  let attempts = 0;
  while (attempts < 300) {
    await sleep(3000);
    attempts++;
    const res = await axios.get(`http://localhost:3130/api/v2/jobs/${jobId}`);
    const job = res.data.job;
    console.log(
      `[${name} ${attempts * 3}s] Status: ${job.status} | Stage: ${job.currentStage} | Progress: ${job.progress}%`
    );

    if (job.status === "ready") {
      console.log(`>>> ${name} COMPLETED! Video ID: ${job.output?.videoId}`);
      console.log(`Preview: ${job.output?.previewUrl}`);
      console.log(`Download: ${job.output?.downloadUrl}`);
      return job;
    }
    if (job.status === "failed") {
      console.error(`>>> ${name} FAILED!`, job.error, job.technicalError);
      throw new Error(`${name} failed`);
    }
  }
  throw new Error(`${name} timed out`);
}

async function runPromptTestA() {
  console.log("=================================================================");
  console.log("TEST A: 20-Second Prompt Mode Video (Egyptian Arabic Streetwear Ad)");
  console.log("=================================================================");

  const payload = {
    creationMode: "prompt",
    prompt:
      "اعمل اعلان 20 ثانية باللهجة المصرية لبراند ملابس شبابي، البداية تكون Hook قوي، ركز على الراحة والشكل، وفي النهاية CTA للطلب على واتساب.",
    language: "ar",
    dialect: "egyptian",
    durationSeconds: 20,
    aspectRatio: "9:16",
    quality: "standard",
    resolution: "1080p",
    contentStyle: "advertisement",
    visualMode: "auto",
    voiceProvider: "kokoro",
    voiceId: "af_heart",
    config: {
      brandKit: {
        brandName: "ABUD Streetwear",
        watermarkText: "ABUD",
        captionStyle: "bold",
        includeOutro: true,
      },
    },
  };

  const createRes = await axios.post("http://localhost:3130/api/v2/jobs", payload);
  const jobId = createRes.data.job.id;
  return monitorJob(jobId, "Prompt Test A (20s)");
}

async function runPromptTestB() {
  console.log("\n=================================================================");
  console.log("TEST B: 30-Second Prompt Mode Video (Egyptian Arabic Web Design)");
  console.log("=================================================================");

  const payload = {
    creationMode: "prompt",
    prompt:
      "اعمل فيديو 30 ثانية باللهجة المصرية لخدمة تصميم مواقع للشركات الصغيرة، البداية مشكلة قوية، بعدها الحل والمميزات، وفي الآخر CTA للتواصل.",
    language: "ar",
    dialect: "egyptian",
    durationSeconds: 30,
    aspectRatio: "9:16",
    quality: "standard",
    resolution: "1080p",
    contentStyle: "advertisement",
    visualMode: "auto",
    voiceProvider: "kokoro",
    voiceId: "af_heart",
    config: {
      brandKit: {
        brandName: "ABUD Web Studio",
        watermarkText: "ABUD",
        captionStyle: "bold",
        includeOutro: true,
      },
    },
  };

  const createRes = await axios.post("http://localhost:3130/api/v2/jobs", payload);
  const jobId = createRes.data.job.id;
  return monitorJob(jobId, "Prompt Test B (30s)");
}

async function runTemplateRegression() {
  console.log("\n=================================================================");
  console.log("TEST C: Template Mode Regression (Product Ad)");
  console.log("=================================================================");

  const payload = {
    creationMode: "template",
    businessTemplateId: "product_ad",
    businessTemplateData: {
      productName: "Classic Oversized Tee",
      mainBenefit: "100% Egyptian cotton softness",
      priceOrOffer: "25% discount this week",
      targetCustomer: "young creators",
      contactMethod: "WhatsApp",
    },
    config: {
      brandKit: {
        brandName: "ABUD Streetwear",
        watermarkText: "ABUD",
        captionStyle: "bold",
        includeOutro: true,
      },
    },
  };

  const createRes = await axios.post("http://localhost:3130/api/v2/jobs", payload);
  const jobId = createRes.data.job.id;
  return monitorJob(jobId, "Template Regression");
}

async function main() {
  const jobA = await runPromptTestA();
  const jobB = await runPromptTestB();
  const jobC = await runTemplateRegression();

  console.log("\n=================================================================");
  console.log("ALL VERIFICATION RENDERS COMPLETED SUCCESSFULLY!");
  console.log(`Test A Video: ${jobA.output.videoId}`);
  console.log(`Test B Video: ${jobB.output.videoId}`);
  console.log(`Test C Video: ${jobC.output.videoId}`);
  console.log("=================================================================");
}

main().catch((err) => {
  console.error("Verification failed:", err.response ? err.response.data : err.message);
  process.exit(1);
});
