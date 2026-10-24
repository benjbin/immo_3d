// Tournage image par image de la maquette.
// node shoot.js <outdir> [W=1080] [H=1920] [fps=30] [from=0] [to=fps*20)   (images f0000.png …)
const fs = require('fs');
const path = require('path');
const { openRig } = require('./rig');
const TL = require(process.env.TL || './timeline');
(async () => {
  const [,, out, W = 1080, H = 1920, FPS = TL.FPS, FROM = 0, TO] = process.argv;
  const fps = +FPS, n = TO != null ? +TO : Math.round(TL.DURATION * fps);
  fs.mkdirSync(out, { recursive: true });
  const rig = await openRig({ width: +W, height: +H });
  const t0 = Date.now();
  const labels = {};
  // préchauffage : un rendu de chaque plan (compilation des programmes, environnement)
  for (const s of TL.SHOTS) if (!s.none) await rig.frame({ ...TL.stateAt(s.t0 + 0.01), capture: false });
  for (let i = +FROM; i < n; i++) {
    const t = i / fps;
    const st = TL.stateAt(t);
    if (st.none) continue;
    const buf = await rig.frame(st);
    fs.writeFileSync(path.join(out, `f${String(i).padStart(4, '0')}.png`), buf);
    const lab = await rig.page.evaluate(() => window.__story.labels || window.__story.proj);
    if (lab) { labels[i] = lab; fs.writeFileSync(path.join(out, 'labels.json'), JSON.stringify(labels)); }
    if (i % 30 === 0) console.log(`image ${i}/${n}  t=${t.toFixed(2)}s  plan ${st.shot}  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  const logs = rig.logs;
  console.log(logs.length ? 'CONSOLE:\n' + logs.join('\n') : 'console : 0 erreur, 0 avertissement');
  await rig.browser.close();
  process.exit(logs.some((l) => /error|PAGEERROR|REQFAIL/i.test(l)) ? 2 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
