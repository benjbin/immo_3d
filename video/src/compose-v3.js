// Composition story v3 : node compose-v3.js <story_dir> <outdir> [from=0] [to=600]
// story_dir contient raw2/ (images v2 réduites), raw3/ (plan 4 v3 + labels), phone/ (écran du téléphone + taps.json).
const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require(process.env.PW || '/opt/homebrew/lib/node_modules/n8n/node_modules/playwright-core');
const TL3 = require('./timeline-v3');
const EXE = process.env.CHROMIUM || os.homedir() + '/Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium';
const pad = (i) => String(i).padStart(4, '0');
// image de fond de chaque image du film (les plans 1, 3 et le fond flouté du téléphone viennent du tournage v2)
function bgFor(i) {
  if (i < 120) return `raw2/f${pad(Math.max(36, i))}.png`;
  if (i < 285) return `raw2/f${pad(120 + Math.floor((i - 120) * 89 / 164))}.png`;
  if (i < 375) return `raw2/f${pad(225 + (i - 285))}.png`;
  if (i < 450) return `raw3/f${pad(i)}.png`;
  return 'raw3/f0449.png';
}
(async () => {
  const [,, dir, out, FROM = 0, TO = 600] = process.argv;
  fs.mkdirSync(out, { recursive: true });
  const labels = JSON.parse(fs.readFileSync(path.join(dir, 'raw3x', 'labels.json'), 'utf8'));
  const taps = JSON.parse(fs.readFileSync(path.join(dir, 'phone', 'taps.json'), 'utf8')).taps;
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--use-angle=metal', '--enable-gpu'] });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
  await page.route('**/__img/**', (route) => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^.*__img\//, ''));
    const f = path.join(dir, rel);
    if (fs.existsSync(f)) route.fulfill({ path: f, contentType: 'image/png' }); else route.fulfill({ status: 404, body: '' });
  });
  await page.goto('http://localhost:8760/video/titles-v3.html');
  await page.evaluate(() => window.ready);
  await page.evaluate((taps) => window.setT(0, { taps }), taps);
  const t0 = Date.now();
  for (let i = +FROM; i < +TO; i++) {
    const t = i / 30;
    const x = { bg: '/__img/' + bgFor(i) };
    if (i >= 120 && i < 285) x.phone = `/__img/phone/ph${pad(i - 120)}.png`;
    if (labels[i]) x.labels = labels[i];
    await page.evaluate(([t, x]) => window.setT(t, x), [t, x]);
    await page.screenshot({ path: path.join(out, `f${pad(i)}.png`) });
    if (i % 60 === 0) console.log(`composé ${i}  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  console.log(logs.length ? 'CONSOLE:\n' + logs.join('\n') : 'console : 0 erreur');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
