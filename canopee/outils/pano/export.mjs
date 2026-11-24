// Export de la scène entière (géométrie, couleurs par sommet, matières et textures) en glTF binaire, pour un rendu
// photoréaliste dans Blender (outils/pano/pano.py). La maquette doit être servie en local.
//   node outils/pano/export.mjs <sortie.glb> [lot=201] [url=http://localhost:8080/3d/]
// Écrit aussi <sortie>.json : direction du soleil, hauteur du sol de l'étage.
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http';
const [out, lot = '201', base = 'http://localhost:8080/3d/'] = process.argv.slice(2);
if (!out) { console.error('usage : node export.mjs <sortie.glb> [lot] [url]'); process.exit(1); }
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cnp-pano-'));
const ch = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + dir, '--window-size=900,600', '--enable-gpu', '--use-angle=metal', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
try {
  let port; for (let i = 0; i < 150 && !port; i++) { await sleep(100); try { port = fs.readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch {} }
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
  const send = (method, params = {}) => new Promise((r) => { pend.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval'); return r.result?.value; };
  await send('Page.enable'); await send('Page.navigate', { url: base + '?ui=0&gi=0&lm=0' });
  const t0 = Date.now();
  while (!(await ev('!!window.__viewer'))) { if (Date.now() - t0 > 90000) throw new Error('la maquette ne répond pas'); await sleep(200); }
  await sleep(1000); await ev(`window.__viewer.visitLot('${lot}'); 1`); await sleep(9000);   // modèles scannés chargés
  let got = null;
  const srv = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') { res.end(); return; }
    const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => { got = Buffer.concat(parts); res.end('ok'); });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const meta = await ev(`(async () => {
    const v = window.__viewer, T = v.THREE;
    const { GLTFExporter } = await import('https://cdn.jsdelivr.net/npm/three@0.' + T.REVISION + '.0/examples/jsm/exporters/GLTFExporter.js');
    const skip = /^(lotEdge|lotVolume|lotPick|decoContact|planSpot|interiorMapped|room[A-Z]|carLight)/;
    const hidden = [];
    v.scene.traverse((o) => { if (o.visible && (o.isSprite || o.isLine || o.isPoints || o.isLight || (o.isMesh && (skip.test(o.material.name || '') || o.material.isShaderMaterial)))) { o.visible = false; hidden.push(o); } });
    // maillages incohérents (indices hors bornes, attributs de tailles différentes) : écartés, l'import Blender échouerait
    const bad = [];
    v.scene.traverseVisible((o) => { if (!o.isMesh) return; const g = o.geometry, n = g.attributes.position ? g.attributes.position.count : 0; let ok = n > 0;
      for (const k of ['normal', 'uv', 'color']) if (g.attributes[k] && g.attributes[k].count !== n) ok = false;
      if (g.index) { let mx = 0; const a = g.index.array; for (let i = 0; i < a.length; i++) if (a[i] > mx) mx = a[i]; if (mx >= n) ok = false; }
      if (!ok) { bad.push((o.material.name || '?') + ':' + o.name + ':' + n); o.visible = false; hidden.push(o); } });
    // attributs propres à la maquette (aCrownN, aLamp…) : retirés le temps de l'export (inutiles, et refusés par Blender)
    const stash = [];
    v.scene.traverseVisible((o) => { if (!o.isMesh) return; const g = o.geometry; for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'uv1', 'color'].includes(k)) { stash.push([g, k, g.attributes[k]]); g.deleteAttribute(k); } });
    const buf = await new Promise((ok, ko) => new GLTFExporter().parse(v.scene, ok, ko, { binary: true, onlyVisible: true, maxTextureSize: 2048 }));
    hidden.forEach((o) => { o.visible = true; });
    stash.forEach(([g, k, at]) => g.setAttribute(k, at));
    await fetch('http://127.0.0.1:${srv.address().port}/', { method: 'POST', body: buf });
    let sun = null; v.scene.traverse((o) => { if (o.isDirectionalLight && !sun) sun = o; });
    const K = +'${lot}'[0];
    return JSON.stringify({ lot: '${lot}', floorY: v.lots.floorY(K), sun: sun.position.clone().sub(sun.target.position).normalize().toArray(), bytes: buf.byteLength, bad });
  })()`);
  srv.close();
  if (!got) throw new Error('rien reçu');
  fs.writeFileSync(out, got); fs.writeFileSync(out.replace(/\.glb$/, '') + '.json', meta);
  console.log('écrit', out, (got.length / 1e6).toFixed(1), 'Mo', meta);
} finally { ch.kill(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
process.exit(0);
