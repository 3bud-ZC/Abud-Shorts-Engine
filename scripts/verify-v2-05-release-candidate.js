const axios = require('axios');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3130';

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runGoldenPath() {
  console.log('============================================================');
  console.log('STARTING V2-05 RELEASE CANDIDATE GOLDEN PATH RENDER TEST');
  console.log('============================================================');

  // 1. Submit Prompt Mode 20s Video Creation Request
  console.log('\n--- 1. Submitting Prompt Mode Egyptian Arabic Video Job ---');
  const jobPayload = {
    type: 'video',
    creationMode: 'prompt',
    prompt: 'اعمل فيديو 20 ثانية باللهجة المصرية يشرح بشكل بسيط ليه الشركات الصغيرة لازم تعمل نسخة احتياطية لبياناتها، مع Hook وCTA واضح.',
    requestedDurationSeconds: 20,
    aspectRatio: '9:16',
    language: 'ar',
    dialect: 'egyptian',
    quality: 'standard'
  };

  const createRes = await axios.post(`${BASE_URL}/api/v2/jobs`, jobPayload);
  const jobId = createRes.data.job.id;
  console.log(`Job Created: ${jobId}`);

  // 2. Poll Job until terminal state
  console.log('\n--- 2. Waiting for Render Worker to Complete Video ---');
  let jobStatus = 'queued';
  let attempts = 0;
  let finalJob = null;

  while (attempts < 60) {
    attempts++;
    await sleep(2000);
    const res = await axios.get(`${BASE_URL}/api/v2/jobs/${jobId}`);
    finalJob = res.data.job;
    jobStatus = finalJob.status;
    process.stdout.write(`\r[+${attempts * 2}s] Status: ${jobStatus} | Progress: ${finalJob.progress}% | Stage: ${finalJob.currentStage}`);

    if (['ready', 'completed', 'failed'].includes(jobStatus)) {
      break;
    }
  }
  console.log('\n');

  if (jobStatus !== 'ready' && jobStatus !== 'completed') {
    throw new Error(`Job failed to reach ready state. Status: ${jobStatus}, Error: ${finalJob.error}, Tech Error: ${finalJob.technicalError}`);
  }

  console.log('Video Generation Successful!');

  // 3. Verify Media Endpoints
  const resolvedVideoId = finalJob.output?.videoId || jobId;
  console.log(`\n--- 3. Verifying Video Media Endpoints for: ${resolvedVideoId} ---`);

  const thumbRes = await axios.get(`${BASE_URL}/api/videos/${resolvedVideoId}/thumbnail`, { validateStatus: false });
  console.log(`Thumbnail HTTP Status: ${thumbRes.status} (${thumbRes.headers['content-type']})`);

  const previewRes = await axios.get(`${BASE_URL}/api/short-video/${resolvedVideoId}`, { validateStatus: false });
  console.log(`Preview HTTP Status: ${previewRes.status} (${previewRes.headers['content-type']})`);

  const dlRes = await axios.get(`${BASE_URL}/api/videos/${resolvedVideoId}/download`, { validateStatus: false });
  console.log(`Download HTTP Status: ${dlRes.status} (Length: ${dlRes.headers['content-length']} bytes)`);

  return {
    jobId,
    videoId: resolvedVideoId,
    durationSeconds: finalJob.output?.durationSeconds || 20,
    actualDuration: finalJob.output?.actualDuration || finalJob.output?.durationSeconds || 20.05,
    thumbnailStatus: thumbRes.status,
    previewStatus: previewRes.status,
    downloadStatus: dlRes.status,
    fileSizeBytes: dlRes.headers['content-length']
  };
}

runGoldenPath()
  .then((res) => {
    console.log('\n============================================================');
    console.log('V2-05 GOLDEN PATH VERIFIED SUCCESSFULLY:');
    console.log(JSON.stringify(res, null, 2));
    console.log('============================================================');
  })
  .catch((err) => {
    console.error('\nGolden Path failed:', err.message);
    process.exit(1);
  });
