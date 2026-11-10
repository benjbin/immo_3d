// Export d'un étage en configuration « balade » depuis Chrome sans interface :
// positions monde (soupe de triangles, float32) de tous les maillages opaques de l'étage + enveloppe du bâtiment.
// → <dossier>/floorK.json ({ floorY, list: [{ name, mat, n, bake, col, side }] }) + <dossier>/floorK.pos.bin
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function exportFloor(url, K, out, lot = `${K}01`) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cnp-gi-'));
  const ch = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + dir, '--window-size=900,600', '--enable-gpu', '--use-angle=metal', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  try {
    let port; for (let i = 0; i < 150 && !port; i++) { await sleep(100); try { port = fs.readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch {} }
    if (!port) throw new Error('Chrome ne démarre pas (' + CHROME + ')');
    const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
    let id = 0; const pend = new Map();
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
    const send = (method, params = {}) => new Promise((r) => { pend.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
    const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval'); return r.result?.value; };
    await send('Page.enable'); await send('Page.navigate', { url });
    const t0 = Date.now();
    while (!(await ev('!!window.__viewer'))) { if (Date.now() - t0 > 90000) throw new Error('la maquette ne répond pas : ' + url); await sleep(200); }
    await sleep(1000); await ev(`window.__viewer.visitLot('${lot}'); 1`);
    // attend que la scène de l'étage soit stable (modèles chargés) : même nombre de sommets pendant 2 s
    const count = `(() => { const v = window.__viewer; let n = 0, root = null; v.lots.group.children.forEach((c) => { if (c.name === 'plan:${K}') root = c; }); if (!root) return -1; root.traverseVisible((o) => { if (o.isMesh && o.geometry.attributes.position) n += o.geometry.attributes.position.count; }); return n; })()`;
    await sleep(3000);
    for (let last = -2, same = 0, i = 0; i < 60 && same < 4; i++) { const n = await ev(count); same = n === last && n > 0 ? same + 1 : 0; last = n; await sleep(500); }
    const meta = JSON.parse(await ev(`(() => {
      const v = window.__viewer, T = v.THREE, list = [], bufs = [], P = new T.Vector3();
      const add = (o, bake) => {
        const g = o.geometry, pa = g.attributes.position; if (!pa) return;
        const idx = g.index ? g.index.array : null, n = idx ? idx.length : pa.count; if (n < 3 || n % 3) return;
        const a = new Float32Array(n * 3);
        o.updateWorldMatrix(true, false);
        for (let i = 0; i < n; i++) { P.fromBufferAttribute(pa, idx ? idx[i] : i).applyMatrix4(o.matrixWorld); a[i * 3] = P.x; a[i * 3 + 1] = P.y; a[i * 3 + 2] = P.z; }
        const m = o.material, c = m.color ? [m.color.r, m.color.g, m.color.b] : [0.8, 0.8, 0.8];
        list.push({ name: o.name, mat: m.name, n, bake: bake && !idx, col: c, side: m.side, tex: !!m.map }); bufs.push(a);
      };
      const opaque = (m) => m && !Array.isArray(m) && !m.transparent && !(m.transmission > 0) && !(m.alphaTest > 0) && m.visible !== false && !/glass|vitr|sheer|contact|arc|label/i.test(m.name || '');
      let root = null; v.lots.group.children.forEach((c) => { if (c.name === 'plan:${K}') root = c; });
      if (!root) return JSON.stringify({ error: 'étage ${K} introuvable' });
      root.traverseVisible((o) => { if (o.isMesh && !o.isInstancedMesh && opaque(o.material)) add(o, /Walk$/.test(o.material.name) && !o.material.isMeshBasicMaterial && !!o.geometry.attributes.color && !!o.geometry.userData.occ); });
      const fy = v.lots.floorY(${K});
      v.building.traverse((o) => { if (!o.isMesh || o.isInstancedMesh || !opaque(o.material) || /interieur/i.test(o.name || '')) return; let p = o, int = false; while (p) { if (/interieur/i.test(p.name || '')) int = true; p = p.parent; } if (int) return; add(o, false); });
      window.__bufs = bufs; return JSON.stringify({ floorY: fy, list });
    })()`));
    if (meta.error) throw new Error(meta.error);
    fs.mkdirSync(out, { recursive: true });
    const fd = fs.openSync(path.join(out, `floor${K}.pos.bin`), 'w');
    // transfert binaire : la page envoie chaque tampon à un petit serveur local (bien plus rapide que le base64 par CDP)
    let got = null;
    const srv = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', '*');
      if (req.method === 'OPTIONS') { res.end(); return; }
      const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => { got = Buffer.concat(parts); res.end('ok'); });
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const sp = srv.address().port;
    for (let i = 0; i < meta.list.length; i++) {
      got = null;
      await ev(`fetch('http://127.0.0.1:${sp}/', { method: 'POST', body: window.__bufs[${i}] }).then((r) => r.text())`);
      if (!got || got.length !== meta.list[i].n * 12) throw new Error('transfert ' + meta.list[i].name + ' ' + (got && got.length));
      fs.writeSync(fd, got);
    }
    srv.close(); fs.closeSync(fd);
    fs.writeFileSync(path.join(out, `floor${K}.json`), JSON.stringify(meta));
    return meta;
  } finally { ch.kill(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
}
