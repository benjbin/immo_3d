// Composition des titres : node compose.js <rawdir> <outdir> [fps=30] [from=0] [to]
// Chaque frame brute (f0000.png…) est affichée dans video/titles.html au temps t, puis capturée en 1080×1920.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require(process.env.PW || '/opt/homebrew/lib/node_modules/n8n/node_modules/playwright-core');
const TL = require(process.env.TL || './timeline');
const EXE = process.env.CHROMIUM || os.homedir() + '/Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium';
const BASE = 'http://localhost:8760/video/' + (process.env.TITLES || 'titles.html');
const BGMIN = +(process.env.BGMIN || 0), BGMAX = +(process.env.BGMAX || 1e9);
(async () => {
  const [,, raw, out, FPS = 30, FROM = 0, TO] = process.argv;
  const fps = +FPS, n = TO != null ? +TO : Math.round(TL.DURATION * fps);
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--use-angle=metal', '--enable-gpu'] });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
  await page.route('**/__frames/**', (route) => {
    const f = path.join(raw, path.basename(new URL(route.request().url()).pathname));
    if (fs.existsSync(f)) route.fulfill({ path: f, contentType: 'image/png' }); else route.fulfill({ status: 404, body: '' });
  });
  await page.goto(BASE);
  await page.evaluate(() => window.ready);
  const t0 = Date.now();
  for (let i = +FROM; i < n; i++) {
    const t = i / fps;
    const name = `f${String(i).padStart(4, '0')}.png`;
    const src = `/__frames/f${String(Math.min(BGMAX, Math.max(BGMIN, i))).padStart(4, '0')}.png`;
    const hour = TL.stateAt(t).hour;
    await page.evaluate(([t, src, hour]) => window.setT(t, src, { hour }), [t, src, hour]);
    await page.screenshot({ path: path.join(out, name), type: 'png' });
    if (i % 60 === 0) console.log(`composé ${i}/${n}  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  console.log(logs.length ? 'CONSOLE:\n' + logs.join('\n') : 'console : 0 erreur');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
