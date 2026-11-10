#!/usr/bin/env node
// Lumière du ciel précalculée des intérieurs (visite à pied) : export depuis la maquette + lancer de rayons maison.
//   node outils/gi/gi.mjs                     → exporte et recalcule les étages 1, 2, 3 → 3d/assets/gi/gi-K.{json,bin}
// Options : --etages 2,1   --url http://localhost:8080/3d/   --sans-export (réutilise le dernier export)
//           --niveaux (ne refait que la mise à niveau, depuis le dernier calcul)   --rayons 192   --rayons-coque 1024
//           --rebonds 3   --fils N   --gamma 0.4   --plancher 0.4   --centile 85   --cache <dossier>
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import zlib from 'node:zlib'; import { fileURLToPath } from 'node:url';
import { exportFloor } from './export.mjs'; import { bakeFloor, levels } from './trace.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const A = process.argv.slice(2), has = (k) => A.includes('--' + k), val = (k, d) => { const i = A.indexOf('--' + k); return i >= 0 && A[i + 1] != null ? A[i + 1] : d; };
const floors = String(val('etages', '1,2,3')).split(',').map(Number).filter((k) => k > 0);
const url = val('url', 'http://localhost:8080/3d/'), out = path.resolve(val('sortie', path.join(here, '../../3d/assets/gi')));
const cache = path.resolve(val('cache', path.join(os.tmpdir(), 'canopee-gi')));
const lv = { gamma: +val('gamma', 0.4), floor: +val('plancher', 0.4), refPct: +val('centile', 85) };
fs.mkdirSync(cache, { recursive: true }); fs.mkdirSync(out, { recursive: true });
const T0 = Date.now(), sec = (t) => ((Date.now() - t) / 1000).toFixed(1) + ' s';

for (const K of floors) {
  const t0 = Date.now(); let index, rawE;
  const fE = path.join(cache, `floor${K}.E.bin`), fI = path.join(cache, `floor${K}.E.json`);
  if (has('niveaux')) { index = JSON.parse(fs.readFileSync(fI)); const b = fs.readFileSync(fE); rawE = new Float32Array(b.buffer, b.byteOffset, b.length / 4); }
  else {
    if (!has('sans-export')) {
      const sep = url.includes('?') ? '&' : '?';
      const meta = await exportFloor(`${url}${sep}ui=0&gi=0`, K, cache, val('lot', `${K}01`));
      const bk = meta.list.filter((m) => m.bake);
      console.log(`étage ${K} : export ${sec(t0)} — ${meta.list.length} maillages, ${bk.length} cuits (${bk.reduce((a, m) => a + m.n, 0)} sommets)`);
    }
    const r = await bakeFloor(cache, K, { rays: +val('rayons', 192), shellRays: +val('rayons-coque', 1024), bounces: +val('rebonds', 3), ...(has('fils') ? { threads: +val('fils') } : {}), log: console.log });
    index = r.index; rawE = r.rawE;
    fs.writeFileSync(fE, Buffer.from(rawE.buffer, rawE.byteOffset, rawE.byteLength)); fs.writeFileSync(fI, JSON.stringify(index));
    console.log(`  étage ${K} : ${(r.stats.rays / 1e6).toFixed(0)} M rayons, ${r.stats.points} points dont ${r.stats.buried} enfouis (repris des voisins), calcul ${r.stats.seconds.toFixed(1)} s`);
  }
  const L = levels(index, rawE, lv);
  fs.writeFileSync(path.join(out, `gi-${K}.bin`), L.bytes); fs.writeFileSync(path.join(out, `gi-${K}.json`), JSON.stringify(index));
  console.log(`étage ${K} : gi-${K}.bin ${(L.bytes.length / 1e6).toFixed(2)} Mo (gzip ${(zlib.gzipSync(L.bytes).length / 1e6).toFixed(2)} Mo), référence ${L.ref.toFixed(4)}, facteur moyen ${L.mean.toFixed(3)} — ${sec(t0)}`);
}
console.log(`terminé en ${sec(T0)} → ${out}`);
process.exit(0);
