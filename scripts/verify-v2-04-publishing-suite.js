const fs = require('fs');
const path = require('path');
const http = require('http');

const BASE_URL = 'http://localhost:3130';

async function request(endpoint, options = {}) {
  const url = new URL(endpoint, BASE_URL);
  const response = await fetch(url.toString(), {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });
  const text = await response.text();
  try {
    return { status: response.status, data: JSON.parse(text) };
  } catch {
    return { status: response.status, text };
  }
}

async function main() {
  console.log('=== RUNNING FINAL V2-04 PUBLISHING RUNTIME SUITE ===\n');

  const videoId = 'cmt4fjtnf000407qkgba301m4';

  // 1. Idempotency Verification
  console.log('--- 1. Testing Idempotency Deduplication ---');
  const idemKey = 'idem_key_live_' + Date.now();
  const res1 = await request('/api/v2/publishing/publications', {
    method: 'POST',
    body: JSON.stringify({
      videoId,
      platform: 'youtube',
      title: 'Idempotency Live Test Video',
      idempotencyKey: idemKey
    })
  });
  const res2 = await request('/api/v2/publishing/publications', {
    method: 'POST',
    body: JSON.stringify({
      videoId,
      platform: 'youtube',
      title: 'Idempotency Duplicate Attempt',
      idempotencyKey: idemKey
    })
  });

  const id1 = res1.data?.publication?.id;
  const id2 = res2.data?.publication?.id;
  console.log('Call 1 Publication ID:', id1);
  console.log('Call 2 Publication ID:', id2);
  console.log('Idempotency Deduplication Match:', id1 && id1 === id2 ? 'VERIFIED (Identical Record)' : 'FAILED');

  // 2. Batch Publication & Partial Failure Distribution Status
  console.log('\n--- 2. Testing Batch Publication & Video Status ---');
  const batchRes = await request('/api/v2/publishing/batch', {
    method: 'POST',
    body: JSON.stringify({
      videoIds: [videoId],
      platforms: ['youtube', 'tiktok', 'instagram']
    })
  });
  console.log('Batch Creation Status:', batchRes.status, 'Count:', batchRes.data?.count);

  const videoStatusRes = await request('/api/v2/videos/' + videoId + '/publishing');
  console.log('Overall Video Distribution Status:', {
    status: videoStatusRes.data?.status,
    platforms: Object.keys(videoStatusRes.data?.platforms || {})
  });

  // 3. Test Connection on Accounts
  console.log('\n--- 3. Testing Account Connection Status ---');
  const accountsRes = await request('/api/v2/publishing/accounts');
  console.log('Configured Accounts Count:', accountsRes.data?.accounts?.length || 0);

  // 4. SSE Stream Test
  console.log('\n--- 4. Testing SSE Live Events Endpoint ---');
  const sseUrl = new URL('/api/v2/publishing/events/stream', BASE_URL);
  const sseTest = await new Promise((resolve) => {
    const req = http.get(sseUrl, (res) => {
      console.log('SSE Stream Connection HTTP Status:', res.statusCode);
      console.log('SSE Content-Type Header:', res.headers['content-type']);
      let receivedData = false;
      res.on('data', (chunk) => {
        const str = chunk.toString();
        if (str.includes('event:') || str.includes('connected') || str.includes('data:')) {
          receivedData = true;
        }
      });
      setTimeout(() => {
        req.destroy();
        resolve({ status: res.statusCode, ok: res.statusCode === 200, receivedData });
      }, 1500);
    });
    req.on('error', (err) => {
      resolve({ status: 500, error: err.message });
    });
  });
  console.log('SSE Stream Verification Result:', sseTest);

  console.log('\n=== PUBLISHING SUITE FINISHED ===');
}

main().catch(console.error);
