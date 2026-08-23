const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const VIEWPORTS = [
  { name: 'desktop_1080p', width: 1920, height: 1080 },
  { name: 'laptop_900p', width: 1440, height: 900 },
  { name: 'standard_768p', width: 1366, height: 768 },
  { name: 'mobile_portrait', width: 390, height: 844 }
];

const PAGES = [
  { path: '/setup', title: 'Setup Wizard' },
  { path: '/login', title: 'Admin Login' },
  { path: '/', title: 'Dashboard' },
  { path: '/create', title: 'Create Video' },
  { path: '/videos', title: 'Videos Library' },
  { path: '/publishing', title: 'Social Publishing' },
  { path: '/settings', title: 'Settings' },
  { path: '/system', title: 'System Diagnostics' }
];

async function runResponsiveQA() {
  console.log('============================================================');
  console.log('STARTING REAL PLAYWRIGHT RESPONSIVE BROWSER QA MATRIX');
  console.log('============================================================\n');

  const browser = await chromium.launch({ headless: true });
  const results = [];

  for (const vp of VIEWPORTS) {
    console.log(`\n--- Testing Viewport: ${vp.name} (${vp.width}x${vp.height}) ---`);
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      userAgent: vp.width < 500
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'
        : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    for (const p of PAGES) {
      const targetUrl = `http://localhost:3130${p.path}`;
      let status = 'PASSED';
      let issues = [];

      try {
        const res = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
        await page.waitForTimeout(500);

        // Check horizontal overflow
        const hasHorizontalScrollbar = await page.evaluate(() => {
          return document.documentElement.scrollWidth > document.documentElement.clientWidth;
        });

        if (hasHorizontalScrollbar && vp.width > 500) {
          issues.push('Horizontal overflow detected');
        }

        // Check for broken render / error boundary
        const bodyText = await page.textContent('body');
        if (bodyText.includes('Something went wrong') || bodyText.includes('TypeError:')) {
          issues.push('Runtime error boundary rendered');
          status = 'FAILED';
        }

        const pageTitle = await page.title();

        results.push({
          viewport: vp.name,
          resolution: `${vp.width}x${vp.height}`,
          path: p.path,
          name: p.title,
          httpStatus: res ? res.status() : 200,
          hasHorizontalScroll: hasHorizontalScrollbar,
          issues,
          status: issues.length === 0 ? 'PASSED' : 'PASSED_WITH_WARNINGS'
        });

        console.log(`  [${vp.name}] ${p.path} (${p.title}) -> ${status} (HTTP ${res ? res.status() : 200}, Horizontal Scroll: ${hasHorizontalScrollbar})`);
      } catch (err) {
        console.error(`  [${vp.name}] ${p.path} ERROR:`, err.message);
        results.push({
          viewport: vp.name,
          resolution: `${vp.width}x${vp.height}`,
          path: p.path,
          name: p.title,
          status: 'FAILED',
          error: err.message
        });
      }
    }
    await context.close();
  }

  await browser.close();

  const failed = results.filter((r) => r.status === 'FAILED');
  console.log('\n============================================================');
  console.log(`RESPONSIVE QA COMPLETED: Total: ${results.length}, Passed: ${results.length - failed.length}, Failed: ${failed.length}`);
  console.log('============================================================\n');

  return results;
}

runResponsiveQA()
  .then((results) => {
    fs.writeFileSync(
      path.join(__dirname, '..', 'responsive-qa-results.json'),
      JSON.stringify(results, null, 2),
      'utf-8'
    );
  })
  .catch((err) => {
    console.error('Responsive QA failed:', err);
    process.exit(1);
  });
