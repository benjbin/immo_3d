// node probe.js states.json outdir [W H] : rend chaque état nommé en PNG (repérage des cadrages)
const fs = require('fs');
const { openRig } = require('./rig');
(async () => {
  const [,, file, out, W = 540, H = 960] = process.argv;
  const states = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rig = await openRig({ width: +W, height: +H });
  if (process.env.INFO) console.log(JSON.stringify(await rig.page.evaluate(() => window.__story.info())));
  for (const [name, st] of Object.entries(states)) {
    const t = Date.now();
    const buf = await rig.frame({ dt: 1, ...st });
    fs.writeFileSync(`${out}/${name}.png`, buf);
    console.log(name, Date.now() - t, 'ms');
  }
  console.log(rig.logs.join('\n') || 'console propre');
  await rig.browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
