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
    console.log(`[${name} ${attempts * 3}s] Status: ${job.status} | Stage: ${job.currentStage} | Progress: ${job.progress}%`);

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

async function runTestB() {
  console.log("=================================================================");
  console.log("TEST B: Template Mode Regression Video (Product Ad)");
  console.log("=================================================================");

  const payload = {
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
  return monitorJob(jobId, "Test B (Template Mode)");
}

async function main() {
  const jobB = await runTestB();
  console.log("\n=================================================================");
  console.log("TEST B PASSED SUCCESSFULLY!");
  console.log(`Test B Video: ${jobB.output.videoId}`);
  console.log("=================================================================");
}

main().catch((err) => {
  console.error("Verification failed:", err.response ? err.response.data : err.message);
  process.exit(1);
});
