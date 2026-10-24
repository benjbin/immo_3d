// Composition story v4 : node compose-v4.js <story_dir> <outdir> [from=0] [to=900]
// story_dir : raw4/ (3D ×2 réduite), raw4w/ (passe fil de fer du plan 1), raw4x/labels.json (projections),
//             phone/, tablet/, laptop/ (vraies captures de l'interface).
const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require(process.env.PW || '/opt/homebrew/lib/node_modules/n8n/node_modules/playwright-core');
const TL = require('./timeline-v4');
const EXE = process.env.CHROMIUM || os.homedir() + '/Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium';
const PHOTO = path.resolve(__dirname, '../../img/p01.jpg');
const pad = (i) => String(i).padStart(4, '0');
const RECAP = [[30, 6], [170, 6], [290, 6], [360, 6], [540, 6], [600, 5], [700, 5], [250, 5]];   // [image de départ, durée] des 8 plans éclair
function recapFrame(k) { let a = 0; for (const [s, d] of RECAP) { if (k < a + d) return s + (k - a); a += d; } return 250; }
(async () => {
  const [,, dir, out, FROM = 0, TO = 900] = process.argv;
  fs.mkdirSync(out, { recursive: true });
  const proj = JSON.parse(fs.readFileSync(path.join(dir, 'raw4x', 'labels.json'), 'utf8'));
  const P = proj[60];
  const photoT = (() => {
    const sx = (P[1][0] - P[0][0]) * 1080 / (1238 - 380), sy = (P[0][1] - P[2][1]) * 1920 / (1030 - 160);
    return { left: P[0][0] * 1080 - 380 * sx, top: P[0][1] * 1920 - 1030 * sy, w: 1600 * sx, h: 1200 * sy };
  })();
  const thumbs = [20, 150, 200, 230, 280, 310, 330, 380, 500, 560, 600, 640, 120, 680, 100, 270].map((i) => `/__img/raw4/f${pad(i)}.png`);
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--use-angle=metal', '--enable-gpu'] });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
  await page.route('**/__img/**', (route) => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^.*__img\//, ''));
    const f = rel === 'photo' ? PHOTO : path.join(dir, rel);
    if (fs.existsSync(f)) route.fulfill({ path: f, contentType: f.endsWith('.jpg') ? 'image/jpeg' : 'image/png' }); else route.fulfill({ status: 404, body: '' });
  });
  await page.goto('http://localhost:8760/video/titles-v4.html');
  await page.evaluate(() => window.ready);
  await page.evaluate((thumbs) => window.setT(0, { thumbs }), thumbs);
  const t0 = Date.now();
  for (let i = +FROM; i < +TO; i++) {
    const t = i / 30, st = TL.stateAt(t);
    const x = {};
    if (i < 765 && !(i >= 405 && i < 495)) x.bg = `/__img/raw4/f${pad(i)}.png`;
    if (i >= 60 && i < 135) { x.wire = `/__img/raw4w2/f${pad(i)}.png`; x.photo = '/__img/photo'; x.photoT = photoT; }
    if (i >= 405 && i < 495) { x.bg = '/__img/raw4/f0404.png'; const k = i - 405; x.laptop = `/__img/laptop/ph${pad(k)}.png`; x.tablet = `/__img/tablet/ph${pad(k)}.png`; x.phone = `/__img/phone/ph${pad(k + 40)}.png`; }
    if (i >= 765 && i < 810) x.bg = `/__img/raw4/f${pad(recapFrame(i - 765))}.png`;
    if (proj[i]) x.proj = proj[i];
    if (!st.none) { x.hour = st.hour; x.cutY = st.cut; x.camY = st.pos[1]; }
    await page.evaluate(([t, x]) => window.setT(t, x), [t, x]);
    await page.screenshot({ path: path.join(out, `f${pad(i)}.png`) });
    if (i % 60 === 0) console.log(`composé ${i}  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  console.log(logs.length ? 'CONSOLE:\n' + logs.join('\n') : 'console : 0 erreur');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
