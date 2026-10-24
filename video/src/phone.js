// Écran du téléphone (story v3) : la vraie interface mobile du configurateur, pilotée par de vrais taps.
// node phone.js <outdir> [fps=30] [dur=5.5]   — variante : DEVICE=tablet|laptop (voir PLANS)  → ph0000.png… (390×844 CSS, DSF 2,5) + taps.json
// Temps déterministe : horloge Playwright figée (JS, rAF, performance.now) avancée de 1/30 s par image ;
// les transitions CSS suivent via le taux de lecture CDP (Animation.setPlaybackRate) réglé sur la durée réelle de chaque image.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require(process.env.PW || '/opt/homebrew/lib/node_modules/n8n/node_modules/playwright-core');
const EXE = process.env.CHROMIUM || os.homedir() + '/Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const [,, out, FPS = 30, DUR = 5.5] = process.argv;
  const fps = +FPS, n = Math.round(+DUR * fps), step = 1000 / fps;
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const DEV = { phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2.5, hasTouch: true, isMobile: true },
    tablet: { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
    laptop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, hasTouch: false, isMobile: false } }[process.env.DEVICE || 'phone'];
  const ctx = await browser.newContext(DEV);
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
  await page.clock.install();
  // horodatage rAF = performance.now() (même base de temps que les animations du viewer)
  // rAF en file d'attente : pendant le chargement elle est vidée par un vrai rAF ; ensuite c'est nous qui la vidons à chaque pas
  await page.addInitScript(() => {
    const realRaf = window.requestAnimationFrame.bind(window);
    let q = [], id = 0, manual = false;
    const flush = () => { const cur = q; q = []; const now = performance.now(); for (const [, cb] of cur) { try { cb(now); } catch (e) { console.error(e); } } };
    const pump = () => { if (!manual) { flush(); realRaf(pump); } };
    realRaf(pump);
    window.requestAnimationFrame = (cb) => { q.push([++id, cb]); return id; };
    window.cancelAnimationFrame = (k) => { q = q.filter(([i]) => i !== k); };
    window.__rafManual = () => { manual = true; };
    window.__rafFlush = flush;
  });
  await page.goto('http://localhost:8760/3d/?intro=0&q=high&hour=20&date=ete');
  await page.waitForFunction(() => window.__viewer, null, { timeout: 240000 });
  await sleep(2500);
  // éléments disgracieux pour un film : bulle d'aide, mention légale de la fiche, compteur i/s
  await page.addStyleTag({ content: '.hint,.sh-note,#fps,.fps{display:none!important}' });
  await page.clock.pauseAt(Date.now() + 1000);
  await page.evaluate(() => window.__rafManual());
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Animation.enable');
  const center = async (sel) => { const b = await (await page.$(sel)).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const taps = [];
  const PLANS = {
    tablet: [{ t: 0.45, label: 'R+3', where: () => center('.lvl[data-key="3"]') },
      { t: 1.9, label: 'Lot 302', where: async () => { const p = await page.evaluate(() => window.__viewer.projectLot('302')); return { x: p.x, y: p.y }; } }],
    laptop: [{ t: 0.4, label: 'Disponibilités', where: () => center('#tAvail') }, { t: 1.5, label: 'Logements', where: () => center('#tLots') }],
  };
  const plan = PLANS[process.env.DEVICE] || [
    { t: 0.55, label: 'Étages', where: () => center('.tab[data-pane="floors"]') },
    { t: 1.3, label: 'R+2', where: () => center('.lvl[data-key="2"]') },
    { t: 3.05, label: 'Lot 201', where: async () => { const p = await page.evaluate(() => window.__viewer.projectLot('201')); return { x: p.x, y: p.y }; } },
  ];
  let last = Date.now();
  for (let i = 0; i < n; i++) {
    const t = i / fps;
    for (const g of plan) if (!g.done && t >= g.t) {
      const p = await g.where();
      taps.push({ t, x: p.x, y: p.y, label: g.label });
      if (DEV.hasTouch) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y);
      g.done = true;
    }
    // transitions CSS au rythme du temps virtuel
    const real = Math.max(40, Date.now() - last); last = Date.now();
    await cdp.send('Animation.setPlaybackRate', { playbackRate: Math.min(1, step / real) });
    const ms = Math.round((i + 1) * step) - Math.round(i * step);
    await page.clock.runFor(Math.floor(ms / 2)); await page.evaluate(() => window.__rafFlush());
    await page.clock.runFor(ms - Math.floor(ms / 2)); await page.evaluate(() => window.__rafFlush());
    await page.screenshot({ path: path.join(out, `ph${String(i).padStart(4, '0')}.png`) });
  }
  fs.writeFileSync(path.join(out, 'taps.json'), JSON.stringify({ fps, w: DEV.viewport.width, h: DEV.viewport.height, taps }, null, 1));
  console.log(logs.length ? 'CONSOLE:\n' + logs.join('\n') : 'console : 0 erreur');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
