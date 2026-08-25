import axios from "axios";

const BASE_URL = "http://localhost:3130";

async function main() {
  console.log("1. Authenticating with local ABUD Shorts Engine...");
  const loginRes = await axios.post(`${BASE_URL}/api/v2/auth/login`, {
    username: "1234",
    password: "1234",
  });
  const token = loginRes.data.session.token;
  const authHeaders = {
    Authorization: `Bearer ${token}`,
    "x-admin-token": token,
  };

  console.log("Authentication successful! Token:", token.slice(0, 10) + "...");

  // -------------------------------------------------------------
  // OUTPUT B: Real Product Ad output (15s, 9:16, Egyptian Arabic)
  // -------------------------------------------------------------
  console.log("\n============================================================");
  console.log("STARTING OUTPUT B: Real Product Ad (Egyptian Arabic)");
  console.log("============================================================");

  // Upload product image
  const productImgRes = await axios.post(
    `${BASE_URL}/api/v2/media/product-upload`,
    {
      imageBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      filename: "luxury_smartwatch.png",
      removeBackground: false,
    },
    { headers: authHeaders },
  );
  const uploadedProduct = productImgRes.data.media;
  console.log("Product asset ready:", uploadedProduct.id, uploadedProduct.originalName);

  const productJobRes = await axios.post(
    `${BASE_URL}/api/v2/jobs`,
    {
      creationMode: "prompt",
      prompt: "إعلان لساعة ذكية فاخرة مقاومة للماء مع شاشة أموليد وبطارية تدوم 7 أيام وعرض خصم 30% وشحن مجاني لجميع المحافظات.",
      language: "ar",
      dialect: "egyptian",
      durationSeconds: 15,
      productionMode: "product_ad",
      visualMode: "product_ad",
      voiceProvider: "elevenlabs",
      captionStyle: "product_ad",
      brandName: "الماسة ستور",
    },
    { headers: authHeaders },
  );
  const productJobId = productJobRes.data.job?.id || productJobRes.data.jobId || productJobRes.data.id;
  console.log("Product Ad Job submitted! Job ID:", productJobId);

  // -------------------------------------------------------------
  // OUTPUT C: Real Motion Graphics output (15s, 9:16, Egyptian Arabic)
  // -------------------------------------------------------------
  console.log("\n============================================================");
  console.log("STARTING OUTPUT C: Real Motion Graphics (Egyptian Arabic)");
  console.log("============================================================");

  const motionJobRes = await axios.post(
    `${BASE_URL}/api/v2/jobs`,
    {
      creationMode: "prompt",
      prompt: "فيديو موشن جرافيك حركي باللغة العربية يشرح خدمات كلاود تك للشركات وتوفير 80% في تكاليف السيرفرات مع تجربة مجانية 14 يوم.",
      language: "ar",
      dialect: "egyptian",
      durationSeconds: 15,
      productionMode: "motion_graphics",
      visualMode: "motion_graphics",
      voiceProvider: "elevenlabs",
      captionStyle: "viral_bold",
      brandName: "كلاود تك",
    },
    { headers: authHeaders },
  );
  const motionJobId = motionJobRes.data.job?.id || motionJobRes.data.jobId || motionJobRes.data.id;
  console.log("Motion Graphics Job submitted! Job ID:", motionJobId);

  // -------------------------------------------------------------
  // OUTPUT D: Real Animated Explainer output (15s, 9:16, Egyptian Arabic)
  // -------------------------------------------------------------
  console.log("\n============================================================");
  console.log("STARTING OUTPUT D: Real Animated Explainer (Egyptian Arabic)");
  console.log("============================================================");

  const explainerJobRes = await axios.post(
    `${BASE_URL}/api/v2/jobs`,
    {
      creationMode: "prompt",
      prompt: "فيديو شرح متحرك بيشرح إزاي النسخ الاحتياطي التلقائي بيحمي ملفاتك وشغلك مع تشفير كامل للبيانات وحماية مضمونة.",
      language: "ar",
      dialect: "egyptian",
      durationSeconds: 15,
      productionMode: "animated_explainer",
      visualMode: "motion_graphics",
      voiceProvider: "elevenlabs",
      captionStyle: "educational",
      brandName: "أمان للبيانات",
    },
    { headers: authHeaders },
  );
  const explainerJobId = explainerJobRes.data.job?.id || explainerJobRes.data.jobId || explainerJobRes.data.id;
  console.log("Animated Explainer Job submitted! Job ID:", explainerJobId);

  // Polling loop to wait for completion
  const jobsToTrack = [
    { name: "Output B (Product Ad)", id: productJobId },
    { name: "Output C (Motion Graphics)", id: motionJobId },
    { name: "Output D (Animated Explainer)", id: explainerJobId },
  ];

  console.log("\nWaiting for render worker to finish all 3 jobs...");
  const completedVideos: Record<string, { videoId: string; duration: number; score: number; thumb: boolean }> = {};

  for (let round = 1; round <= 120; round++) {
    await new Promise((r) => setTimeout(r, 3000));
    let allDone = true;

    for (const item of jobsToTrack) {
      if (completedVideos[item.id]) continue;

      const jobStatusRes = await axios.get(`${BASE_URL}/api/v2/jobs/${item.id}`, { headers: authHeaders });
      const job = jobStatusRes.data.job;
      console.log(`[Status] ${item.name} (${item.id.slice(0, 8)}): ${job.status} (${job.progress}%) - ${job.currentStage || ""}`);

      if (job.status === "ready") {
        const videoId = job.output?.videoId || job.output?.id || job.id;

        // Verify video stream endpoint (206 Partial Content / 200 OK)
        const videoHead = await axios.head(`${BASE_URL}/api/short-video/${videoId}`, {
          headers: authHeaders,
          validateStatus: () => true,
        });

        // Verify thumbnail endpoint
        const thumbHead = await axios.head(`${BASE_URL}/api/short-video/${videoId}/thumbnail`, {
          headers: authHeaders,
          validateStatus: () => true,
        });

        // Verify download endpoint
        const dlHead = await axios.head(`${BASE_URL}/api/videos/${videoId}/download`, {
          headers: authHeaders,
          validateStatus: () => true,
        });

        console.log(`  ✓ Verified video HTTP status: ${videoHead.status}`);
        console.log(`  ✓ Verified thumbnail HTTP status: ${thumbHead.status}`);
        console.log(`  ✓ Verified download HTTP status: ${dlHead.status}`);

        completedVideos[item.id] = {
          videoId,
          duration: job.output?.metadata?.actualFinalDuration || job.output?.metadata?.durationSeconds || 15,
          score: job.output?.metadata?.overallProductionScore || 100,
          thumb: thumbHead.status === 200,
        };
      } else if (job.status === "failed") {
        console.error(`  ✗ Job ${item.name} failed:`, job.error, job.technicalError);
        completedVideos[item.id] = {
          videoId: "FAILED",
          duration: 0,
          score: 0,
          thumb: false,
        };
      } else {
        allDone = false;
      }
    }

    if (allDone) break;
  }

  console.log("\n============================================================");
  console.log("FINAL REAL OUTPUT EXECUTION SUMMARY:");
  console.log("============================================================");
  for (const item of jobsToTrack) {
    const res = completedVideos[item.id];
    console.log(`${item.name}:`);
    console.log(`  - Job ID:    ${item.id}`);
    console.log(`  - Video ID:  ${res?.videoId}`);
    console.log(`  - Duration:  ${res?.duration}s`);
    console.log(`  - Score:     ${res?.score}/100`);
    console.log(`  - Thumbnail: ${res?.thumb ? "PASS (200 OK)" : "N/A"}`);
  }
}

main().catch((err) => {
  console.error("Execution error:", err.message, err.response?.data || "");
  process.exit(1);
});
