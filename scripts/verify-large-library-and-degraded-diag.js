const axios = require('axios');
const { chromium } = require('playwright');
const { execSync } = require('child_process');

const BASE_URL = 'http://localhost:3130';

function runCmd(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    return (err.stdout ? err.stdout.toString() : '') + (err.stderr ? err.stderr.toString() : '');
  }
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function verifyLargeLibraryAndDegradedDiag() {
  console.log('>>> Testing Large Video Library UI with ~100 records...');
  const browser = await chromium.launch({ headless: true });
  
  // Desktop
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(`${BASE_URL}/videos`, { waitUntil: 'networkidle', timeout: 15000 });
  const videoCards = await page.$$('.card, tr, [data-video-id]');
  console.log('Videos page loaded with elements count:', videoCards.length);

  // Search/Filter interaction
  const searchInput = await page.$('input[type="text"], input[placeholder*="Search"], input[placeholder*="بحث"]');
  if (searchInput) {
    await searchInput.fill('فيديو');
    await sleep(500);
    console.log('Search input applied successfully.');
  }

  // Mobile viewport
  const mobilePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobilePage.goto(`${BASE_URL}/videos`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  console.log('Mobile viewport 390x844 loaded successfully.');

  await browser.close();

  // Test Diagnostics while degraded
  console.log('\n>>> Testing Diagnostics Bundle while degraded...');
  runCmd('docker stop abud-shorts-n8n');
  await sleep(3000);

  const degradedDiag = (await axios.get(`${BASE_URL}/api/v2/system/diagnostics`, { timeout: 10000 })).data;
  console.log('Diagnostics while n8n down:', degradedDiag.health?.components?.find(c => c.name === 'n8n'));

  // Secret scan on degraded bundle
  const bundleStr = JSON.stringify(degradedDiag);
  const secretPatterns = [
    /change-me-v2-internal-token/gi,
    /sk-[a-zA-Z0-9_-]{20,}/g,
    /xoxb-[a-zA-Z0-9_-]{20,}/g,
    /bot[0-9]{8,10}:[a-zA-Z0-9_-]{35}/g
  ];
  let leakCount = 0;
  for (const pat of secretPatterns) {
    const matches = bundleStr.match(pat);
    if (matches) leakCount += matches.length;
  }
  console.log('Degraded Diagnostics Secret Leaks:', leakCount);

  runCmd('docker start abud-shorts-n8n');
  for (let i = 0; i < 15; i++) {
    await sleep(2000);
    try {
      const h = (await axios.get(`${BASE_URL}/api/v2/system/health`, { timeout: 3000 })).data;
      if (h.components?.some(c => c.name === 'n8n' && c.status === 'healthy')) {
        console.log('n8n restored healthy.');
        break;
      }
    } catch {}
  }

  console.log('\nVerification complete.');
}

verifyLargeLibraryAndDegradedDiag().catch(e => {
  console.error('Failed:', e);
  process.exit(1);
});
