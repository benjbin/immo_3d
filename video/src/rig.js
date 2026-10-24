// Ouverture de la maquette dans Chromium (Metal), injection de story-page.js, capture image par image.
const path = require('path');
const fs = require('fs');
const os = require('os');
const PW = process.env.PW || '/opt/homebrew/lib/node_modules/n8n/node_modules/playwright-core';
const { chromium } = require(PW);
const EXE = process.env.CHROMIUM || os.homedir() + '/Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium';
const URL = process.env.VIEWER_URL || 'http://localhost:8760/3d/?ui=0&intro=0&q=high&date=ete&hour=19.5';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openRig({ width = 1080, height = 1920, dsf = 1 } = {}) {
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dsf });
  const logs = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
  page.on('requestfailed', (r) => logs.push('REQFAIL ' + r.url()));
  await page.goto(URL);
  await page.waitForFunction(() => window.__viewer, null, { timeout: 240000 });
  await sleep(2500);   // laisse le viewer finir ses transitions de démarrage
  await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, 'story-page.js'), 'utf8') });
  await page.waitForFunction(() => window.__story);
  // modules d'effets supplémentaires (FX=fx-v4.js) : chargés comme module (imports three/addons via l'importmap)
  if (process.env.FX) {
    await page.addScriptTag({ type: 'module', content: fs.readFileSync(path.join(__dirname, process.env.FX), 'utf8') });
    await page.waitForFunction(() => window.__fxReady, null, { timeout: 120000 });
  }
  const frame = async (st) => {
    const url = await page.evaluate((s) => window.__story.frame(s), st);
    return url ? Buffer.from(url.slice(url.indexOf(',') + 1), 'base64') : null;
  };
  return { browser, page, logs, frame };
}
module.exports = { openRig, sleep };
