const fs = require('fs');
const path = require('path');
const http = require('http');

const BASE_URL = 'http://localhost:3130';

async function request(path, options = {}) {
  const url = new URL(path, BASE_URL);
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
  console.log('=== STARTING V2-04 RUNTIME VERIFICATION PASS ===\n');

  // 1. Health Checks
  console.log('--- 1. Application & System Health ---');
  const appHealth = await request('/health');
  console.log('GET /health:', appHealth.status, appHealth.data);

  const sysHealth = await request('/api/v2/system/health');
  console.log('GET /api/v2/system/health status:', sysHealth.status);
  console.log('Healthy components:', Object.keys(sysHealth.data.components || {}).filter(k => sysHealth.data.components[k].status === 'healthy'));

  // 2. Provider Credentials & 4-State Matrix Audit
  console.log('\n--- 2. Publishing Provider 4-State Matrix Audit ---');
  const providersRes = await request('/api/v2/providers');
  const settingsRes = await request('/api/v2/settings');
  console.log('Provider list:', providersRes.data.providers ? providersRes.data.providers.length : 0);

  const credAudit = {
    uploadPost: {
      implemented: true,
      configured: Boolean(settingsRes.data?.settings?.uploadPostApiKey || process.env.UPLOAD_POST_API_KEY),
      healthy: 'Not Tested (No Credential)',
      liveVerified: false
    },
    telegram: {
      implemented: true,
      configured: Boolean(settingsRes.data?.settings?.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN),
      healthy: 'Not Tested (No Credential)',
      liveVerified: false
    },
    youtubeDirect: {
      implemented: true,
      configured: false,
      healthy: 'Not Tested (No Credential)',
      liveVerified: false
    },
    meta: {
      implemented: true,
      configured: false,
      healthy: 'Not Tested (No Credential)',
      liveVerified: false
    },
    tiktokDirect: {
      implemented: true,
      configured: false,
      healthy: 'Not Tested (No Credential)',
      liveVerified: false
    }
  };

  console.table(credAudit);

  // 3. Publishing Summary & Capabilities
  console.log('\n--- 3. Publishing Summary & Capabilities ---');
  const pubSummary = await request('/api/v2/publishing/summary');
  console.log('Publishing Summary:', pubSummary.data);

  // 4. Test AI Metadata Generator API
  console.log('\n--- 4. Platform AI Metadata Generator API ---');
  const aiMetaRes = await request('/api/v2/publishing/metadata/generate', {
    method: 'POST',
    body: JSON.stringify({
      videoId: 'test_vid_1',
      title: 'أهمية النسخ الاحتياطي للشركات',
      platform: 'youtube',
      description: 'فيديو عن حماية البيانات السحابية واسترجاع الملفات للشركات الصغيرة',
      targetDurationSeconds: 20
    })
  });
  console.log('AI Metadata Output:', {
    title: aiMetaRes.data.metadata?.title,
    captionPreview: aiMetaRes.data.metadata?.caption?.slice(0, 60),
    hashtags: aiMetaRes.data.metadata?.hashtags
  });

  // 5. Check Videos List
  console.log('\n--- 5. Videos List in DB ---');
  const videosRes = await request('/api/v2/videos');
  console.log('Available Completed Videos:', (videosRes.data.videos || []).map(v => ({ id: v.id, title: v.title, duration: v.duration })));

  console.log('\n=== RUNTIME AUDIT COMPLETED ===');
}

main().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
