const http = require('http');
const { execSync } = require('child_process');

const BASE_URL = 'http://localhost:3130';
const INTERNAL_TOKEN = process.env.INTERNAL_SERVICE_TOKEN || 'abud_v2_sec_789f8c049b4e72a1df620573e86c071d49e15a9c7b2e3f8104d5a6c7e8b9f012';

async function request(endpoint, options = {}) {
  const url = new URL(endpoint, BASE_URL);
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  const response = await fetch(url.toString(), {
    ...options,
    headers,
  });
  const text = await response.text();
  try {
    return { status: response.status, data: JSON.parse(text) };
  } catch {
    return { status: response.status, text };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log('============================================================');
  console.log('STARTING V2-04 FINAL RELEASE-GATE RUNTIME VERIFICATION SUITE');
  console.log('============================================================\n');

  const videoId = 'cmt4fjtnf000407qkgba301m4';

  // ------------------------------------------------------------
  // 1. Insecure Internal Token Security & Protected Routes
  // ------------------------------------------------------------
  console.log('--- 1. Testing Internal Token Security & Route Protection ---');
  const dummyPubId = 'pub_sec_test_' + Date.now();
  
  // A. Missing token
  const noTokenRes = await request(`/internal/v1/publishing/publications/${dummyPubId}/execute`, {
    method: 'POST',
    body: JSON.stringify({ publicationId: dummyPubId })
  });
  console.log('Missing token HTTP Status:', noTokenRes.status, '(Expected 401)');

  // B. Invalid token
  const badTokenRes = await request(`/internal/v1/publishing/publications/${dummyPubId}/execute`, {
    method: 'POST',
    headers: { 'x-internal-token': 'wrong-bad-secret-token' },
    body: JSON.stringify({ publicationId: dummyPubId })
  });
  console.log('Invalid token HTTP Status:', badTokenRes.status, '(Expected 401)');

  // C. Fallback default token test (must fail)
  const fallbackTokenRes = await request(`/internal/v1/publishing/publications/${dummyPubId}/execute`, {
    method: 'POST',
    headers: { 'x-internal-token': 'change-me-v2-internal-token' },
    body: JSON.stringify({ publicationId: dummyPubId })
  });
  console.log('Deprecated fallback token HTTP Status:', fallbackTokenRes.status, '(Expected 401)');

  // D. Valid configured token test
  const validTokenRes = await request(`/internal/v1/publishing/publications/${dummyPubId}/execute`, {
    method: 'POST',
    headers: { 'x-internal-token': INTERNAL_TOKEN },
    body: JSON.stringify({ publicationId: dummyPubId })
  });
  console.log('Valid token HTTP Status:', validTokenRes.status, '(Expected 404 or 200/202, but NOT 401)');

  // ------------------------------------------------------------
  // 2. SSE Live Event Stream Verification
  // ------------------------------------------------------------
  console.log('\n--- 2. Setting Up SSE Live Stream Listener ---');
  const receivedEvents = [];
  const sseUrl = new URL('/api/v2/publishing/events/stream', BASE_URL);
  let sseReq;
  const sseConnected = new Promise((resolve) => {
    sseReq = http.get(sseUrl, (res) => {
      console.log('SSE Stream Connected (HTTP ' + res.statusCode + ')');
      res.on('data', (chunk) => {
        const text = chunk.toString();
        const lines = text.split('\n');
        for (const line of lines) {
          if (line.startsWith('data:')) {
            try {
              const parsed = JSON.parse(line.replace('data:', '').trim());
              receivedEvents.push(parsed);
              console.log('  [SSE Event Received]:', parsed.stage || parsed.status, parsed.message);
            } catch {}
          }
        }
      });
      resolve(true);
    });
  });
  await sseConnected;

  // ------------------------------------------------------------
  // 3. Scheduler Terminal State Test (60s in future)
  // ------------------------------------------------------------
  console.log('\n--- 3. Testing Scheduler Terminal State Lifecycle ---');
  const schedTime = new Date(Date.now() + 60000); // 60s ahead
  const schedRes = await request('/api/v2/publishing/publications', {
    method: 'POST',
    body: JSON.stringify({
      videoId,
      platform: 'youtube',
      title: 'Scheduled Terminal State Test Video',
      scheduledAt: schedTime.toISOString(),
      sourceTimezone: 'Africa/Cairo',
      provider: 'test_provider',
    })
  });

  const schedPub = schedRes.data?.publication;
  console.log('Created Scheduled Publication:', {
    id: schedPub?.id,
    status: schedPub?.status,
    scheduledAt: schedPub?.scheduledAt,
    timezone: schedPub?.sourceTimezone,
    provider: schedPub?.provider
  });

  console.log(`Waiting for scheduler to pick up publication naturally (until ${schedTime.toISOString()})...`);
  let terminalPub;
  const startTime = Date.now();
  while (Date.now() - startTime < 90000) {
    await sleep(4000);
    const check = await request(`/api/v2/publishing/publications/${schedPub.id}`);
    const pub = check.data?.publication;
    process.stdout.write(`Status at +${Math.round((Date.now() - startTime)/1000)}s: ${pub?.status}\r`);
    if (pub && ['published', 'failed'].includes(pub.status)) {
      terminalPub = pub;
      console.log(`\nTerminal State Reached: ${pub.status} (Provider Post ID: ${pub.providerPostId})`);
      break;
    }
  }

  // ------------------------------------------------------------
  // 4. Restart Recovery to Terminal State
  // ------------------------------------------------------------
  console.log('\n--- 4. Testing Container Restart Recovery to Terminal State ---');
  const restartSchedTime = new Date(Date.now() + 60000); // 60s ahead
  const restartPubRes = await request('/api/v2/publishing/publications', {
    method: 'POST',
    body: JSON.stringify({
      videoId,
      platform: 'tiktok',
      title: 'Restart Recovery Test Video',
      scheduledAt: restartSchedTime.toISOString(),
      sourceTimezone: 'Africa/Cairo',
      provider: 'test_provider',
    })
  });
  const restartPub = restartPubRes.data?.publication;
  console.log('Created Pre-Restart Publication:', {
    id: restartPub?.id,
    status: restartPub?.status,
    scheduledAt: restartPub?.scheduledAt
  });

  console.log('Restarting containers: abud-shorts-app and abud-shorts-n8n...');
  execSync('docker restart abud-shorts-app abud-shorts-n8n', { stdio: 'inherit' });
  console.log('Containers restarted. Waiting for service health...');
  await sleep(6000);

  console.log(`Waiting for resumed scheduler to claim and execute restart publication...`);
  let terminalRestartPub;
  const restartStartTime = Date.now();
  while (Date.now() - restartStartTime < 90000) {
    await sleep(4000);
    try {
      const check = await request(`/api/v2/publishing/publications/${restartPub.id}`);
      const pub = check.data?.publication;
      process.stdout.write(`Status at +${Math.round((Date.now() - restartStartTime)/1000)}s: ${pub?.status}\r`);
      if (pub && ['published', 'failed'].includes(pub.status)) {
        terminalRestartPub = pub;
        console.log(`\nRestart Publication Terminal State Reached: ${pub.status} (Provider Post ID: ${pub.providerPostId})`);
        break;
      }
    } catch {}
  }

  // ------------------------------------------------------------
  // 5. Full Pipeline Idempotency
  // ------------------------------------------------------------
  console.log('\n--- 5. Testing Full Pipeline Idempotency Deduplication ---');
  const idemKey = 'idem_full_pipeline_' + Date.now();
  const idemRes1 = await request('/api/v2/publishing/publications', {
    method: 'POST',
    body: JSON.stringify({
      videoId,
      platform: 'youtube',
      title: 'Idempotency Full Pipeline Test',
      idempotencyKey: idemKey,
      publishNow: true,
      provider: 'test_provider',
    })
  });
  const idemRes2 = await request('/api/v2/publishing/publications', {
    method: 'POST',
    body: JSON.stringify({
      videoId,
      platform: 'youtube',
      title: 'Idempotency Duplicate Call',
      idempotencyKey: idemKey,
      publishNow: true,
      provider: 'test_provider',
    })
  });
  const pub1Id = idemRes1.data?.publication?.id;
  const pub2Id = idemRes2.data?.publication?.id;
  console.log('Idempotency Request 1 ID:', pub1Id);
  console.log('Idempotency Request 2 ID:', pub2Id);
  console.log('Idempotent Deduplication Match:', pub1Id === pub2Id ? 'VERIFIED' : 'FAILED');

  // Close SSE stream
  if (sseReq) sseReq.destroy();

  // ------------------------------------------------------------
  // 6. Regression Check on Video
  // ------------------------------------------------------------
  console.log('\n--- 6. Video Generation Regression Check ---');
  const thumbRes = await request(`/api/videos/${videoId}/thumbnail`);
  const previewRes = await request(`/api/short-video/${videoId}`);
  const downloadRes = await request(`/api/videos/${videoId}/download`);
  const jobRes = await request(`/api/v2/jobs/${videoId}`);
  console.log('Video Regression Status:', {
    videoId,
    jobStatus: jobRes.data?.job?.status,
    durationSeconds: jobRes.data?.job?.productionSpec?.durationSeconds,
    actualDuration: jobRes.data?.job?.metadata?.finalDurationSeconds,
    thumbnailHttp: thumbRes.status,
    previewHttp: previewRes.status,
    downloadHttp: downloadRes.status
  });

  console.log('\n============================================================');
  console.log('V2-04 RELEASE-GATE VERIFICATION SUITE FINISHED');
  console.log('============================================================');
}

main().catch(console.error);
