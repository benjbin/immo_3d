// Illumination globale du ciel par sommet, sans Blender : lanceur de rayons maison (BVH + worker_threads).
// bakeFloor(dossier, K, options) lit floorK.json + floorK.pos.bin (export.mjs) et renvoie { index, bytes, stats }.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { Worker } from 'node:worker_threads';
import { build } from './bvh.mjs';

// albédos approximatifs (luminance) par clé de matériau des intérieurs (lots:K:tag:<clé>) puis de l'enveloppe
const ALBEDO = {
  wall: 0.78, ceil: 0.82, skirt: 0.8, parquet: 0.36, tile: 0.5, oak: 0.4, wood: 0.3, stone: 0.55, black: 0.04, ceramic: 0.75, lacquer: 0.6,
  steel: 0.45, brass: 0.4, bark: 0.2, leafM: 0.15, leafG: 0.15, shade: 0.7, bulb: 0.8, paper: 0.7, art: 0.4, stoneware: 0.5, cloth: 0.6, soil: 0.05,
  zellige: 0.4, mirror: 0.1, textile: 0.5, rug: 0.45, jute: 0.45, wool: 0.6, boucle: 0.65, travertine: 0.6, concrete: 0.4, furn: 0.7,
  renderWhite: 0.7, slabWhite: 0.7, cladding: 0.3, frameDark: 0.08, woodSoffit: 0.3, deck: 0.3, paver: 0.4, planter: 0.3, greenRoof: 0.12,
  metal: 0.4, fabric: 0.4, asphalt: 0.1, garageDoor: 0.3, doorDark: 0.1,
};
const SHELL = /:(wall|ceil|parquet|tile|skirt)$/;     // coque de la visite : murs, plafonds, sols (plus de rayons)
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
function albedo(e) {
  const k = e.name.split(':').pop().split('#')[0];
  if (ALBEDO[k] != null) return ALBEDO[k];
  if (ALBEDO[e.mat] != null) return ALBEDO[e.mat];
  return e.tex || lum(e.col) > 0.98 ? 0.45 : Math.min(0.8, Math.max(0.04, lum(e.col) * 0.9));
}
const shared = (Type, n) => new Type(new SharedArrayBuffer(n * Type.BYTES_PER_ELEMENT));

export async function bakeFloor(dir, K, opt = {}) {
  const O = { rays: 192, shellRays: 1024, minRays: 8, bounces: 3, directMul: 3, bounceMul: 0.5, threads: Math.max(1, Math.min(os.availableParallelism() - 1, 32)), ground: 0.45, near: 0.02, nearBack: 0.15, depth: 3, zone: 0.5, log: () => {}, ...opt };
  const t00 = Date.now(), log = O.log;
  const meta = JSON.parse(fs.readFileSync(path.join(dir, `floor${K}.json`)));
  const list = meta.list.filter((e) => !/interiorWarm/.test(e.name));     // plans lumineux derrière les vitres : ils boucheraient les baies
  const raw = fs.readFileSync(path.join(dir, `floor${K}.pos.bin`));
  const all = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
  let nV = 0; for (const e of list) nV += e.n;
  const nTri = nV / 3, P = shared(Float32Array, nV * 3), triMesh = shared(Uint16Array, nTri);
  const target = [], dbl = [], alb = [], shell = [], first = [];
  { let src = 0, dst = 0, mi = 0;
    for (const e of meta.list) {
      if (!/interiorWarm/.test(e.name)) {
        P.set(all.subarray(src * 3, (src + e.n) * 3), dst * 3); triMesh.fill(mi, dst / 3, (dst + e.n) / 3);
        target.push(e.bake ? 1 : 0); dbl.push(e.side === 2 ? 1 : 0); alb.push(albedo(e)); shell.push(SHELL.test(e.name) ? 1 : 0); first.push(dst);
        dst += e.n; mi++;
      }
      src += e.n;
    } }
  // --- sommets confondus de même orientation : un seul éclairement (lissage, et budget de rayons partagé)
  const tn = new Float32Array(nTri * 3), key = new Int32Array(nV * 4), group = new Int32Array(nV).fill(-1);
  for (let t = 0; t < nTri; t++) {
    const o = t * 9, e1x = P[o + 3] - P[o], e1y = P[o + 4] - P[o + 1], e1z = P[o + 5] - P[o + 2], e2x = P[o + 6] - P[o], e2y = P[o + 7] - P[o + 1], e2z = P[o + 8] - P[o + 2];
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x; const l = Math.hypot(nx, ny, nz) || 1;
    tn[t * 3] = nx / l; tn[t * 3 + 1] = ny / l; tn[t * 3 + 2] = nz / l;
  }
  let hb = 1; while (hb < nV * 2) hb <<= 1;
  const table = new Int32Array(hb).fill(-1), mask = hb - 1; let nG = 0;
  for (let c = 0; c < nV; c++) {
    const t = (c / 3) | 0; if (!target[triMesh[t]]) continue;
    const k = c * 4, qx = Math.round(P[c * 3] / 0.004), qy = Math.round(P[c * 3 + 1] / 0.004), qz = Math.round(P[c * 3 + 2] / 0.004);
    const qn = (Math.round(tn[t * 3] * 1.6) + 2) * 25 + (Math.round(tn[t * 3 + 1] * 1.6) + 2) * 5 + Math.round(tn[t * 3 + 2] * 1.6) + 2;
    key[k] = qx; key[k + 1] = qy; key[k + 2] = qz; key[k + 3] = qn;
    let h = (Math.imul(qx, 73856093) ^ Math.imul(qy, 19349663) ^ Math.imul(qz, 83492791) ^ Math.imul(qn, 2654435761)) & mask;
    for (;;) {
      const r = table[h];
      if (r < 0) { table[h] = c; group[c] = nG++; break; }
      const j = r * 4;
      if (key[j] === qx && key[j + 1] === qy && key[j + 2] === qz && key[j + 3] === qn) { group[c] = group[r]; break; }
      h = (h + 1) & mask;
    }
  }
  const gSize = new Int32Array(nG), gShell = new Uint8Array(nG);
  for (let c = 0; c < nV; c++) { const g = group[c]; if (g >= 0) { gSize[g]++; if (shell[triMesh[(c / 3) | 0]]) gShell[g] = 1; } }
  const rays = shared(Uint16Array, nV); let total = 0;
  for (let c = 0; c < nV; c++) { const g = group[c]; if (g < 0) continue; const R = gShell[g] ? O.shellRays : O.rays; rays[c] = Math.max(O.minRays, Math.min(R, Math.ceil(R / gSize[g]))); total += rays[c]; }
  // --- BVH
  const t0 = Date.now(), bvh = build(P, nTri);
  log(`  étage ${K} : ${nTri} triangles, ${nG} points d'éclairement, ${(total / 1e6).toFixed(1)} M rayons par passe ; BVH ${Date.now() - t0} ms (${bvh.nNodes} nœuds)`);
  // --- passes : E(k) = direct + rebond de E(k−1)
  const E = shared(Float32Array, nV), outSum = shared(Float32Array, nV), outCnt = shared(Uint16Array, nV), outSumB = shared(Float32Array, nV), outCntB = shared(Uint16Array, nV), outSq = shared(Float32Array, nV), outSqB = shared(Float32Array, nV), counter = shared(Int32Array, 1);
  const wd = { P: P.buffer, triMesh: triMesh.buffer, rays: rays.buffer, E: E.buffer, outSum: outSum.buffer, outCnt: outCnt.buffer, outSumB: outSumB.buffer, outCntB: outCntB.buffer, outSq: outSq.buffer, outSqB: outSqB.buffer, counter: counter.buffer,
    nb: bvh.nb.buffer, nl: bvh.nl.buffer, T: bvh.T.buffer, id: bvh.id.buffer, target, dbl, alb, nTri, ground: O.ground, near: O.near, nearBack: O.nearBack, depth: O.depth, zone: O.zone };
  const workers = Array.from({ length: O.threads }, () => new Worker(new URL('./worker.mjs', import.meta.url), { workerData: wd }));
  const pass = (seed, mul, sky) => { counter[0] = 0; return Promise.all(workers.map((w) => new Promise((res, rej) => { w.once('message', (m) => res(m.rays)); w.once('error', rej); w.postMessage({ seed, mul, sky }); }))).then((a) => a.reduce((x, y) => x + y, 0)); };
  const gSum = new Float64Array(nG), gCnt = new Float64Array(nG), gRay = new Float64Array(nG), gSumB = new Float64Array(nG), gCntB = new Float64Array(nG), gSq = new Float64Array(nG), gSqB = new Float64Array(nG);
  const gTwo = new Uint8Array(nG), gE = new Float32Array(nG), gVar = new Float32Array(nG), gOk = new Uint8Array(nG);
  for (let c = 0; c < nV; c++) { const g = group[c]; if (g >= 0 && dbl[triMesh[(c / 3) | 0]]) gTwo[g] = 1; }
  let nRays = 0, nBad = 0;
  // moyenne par point (gE) et variance de cette moyenne (gVar) ; `lmax` : plus forte luminance possible d'un rayon
  const gather = (mul, lmax) => {
    gSum.fill(0); gCnt.fill(0); gRay.fill(0); gSumB.fill(0); gCntB.fill(0); gSq.fill(0); gSqB.fill(0);
    for (let c = 0; c < nV; c++) { const g = group[c]; if (g < 0) continue; gSum[g] += outSum[c]; gCnt[g] += outCnt[c]; gSq[g] += outSq[c]; gSumB[g] += outSumB[c]; gCntB[g] += outCntB[c]; gSqB[g] += outSqB[c]; gRay[g] += Math.max(4, Math.round(rays[c] * mul)); }
    nBad = 0;
    for (let g = 0; g < nG; g++) {
      // double face (rideaux, linge, feuillages, abat-jour) : chaque face a la moitié des rayons, on garde la plus éclairée
      const need = (gTwo[g] ? 0.15 : 0.3) * gRay[g], okA = gCnt[g] >= need && gCnt[g] >= 4, okB = gTwo[g] && gCntB[g] >= need && gCntB[g] >= 4;
      const a = okA ? gSum[g] / gCnt[g] : -1, b = okB ? gSumB[g] / gCntB[g] : -1;
      gOk[g] = okA || okB ? 1 : 0; if (!gOk[g]) { nBad++; gE[g] = 0; gVar[g] = 0; continue; }
      const useB = b > a, n = useB ? gCntB[g] : gCnt[g], m = useB ? b : a, v = Math.max(0, (useB ? gSqB[g] : gSq[g]) / n - m * m) / n;
      gE[g] = m; gVar[g] = Math.max(v, (lmax / n) * (lmax / n));     // aucun rayon chanceux sur n : l'incertitude n'est pas nulle
    }
    fill();
  };
  // débruitage adapté au bruit mesuré : un point ne se rapproche de ses voisins (arêtes de triangles) que si l'écart
  // qui les sépare tient dans l'incertitude du tirage ; les vraies variations (pénombres, contacts) sont conservées
  const denoise = (iters = 3) => {
    const acc = new Float64Array(nG), num = new Int32Array(nG);
    for (let it = 0; it < iters; it++) {
      acc.fill(0); num.fill(0);
      for (let t = 0; t < nTri; t++) {
        const a = group[t * 3]; if (a < 0) continue; const b = group[t * 3 + 1], c = group[t * 3 + 2], s = gE[a] + gE[b] + gE[c];
        acc[a] += s - gE[a]; acc[b] += s - gE[b]; acc[c] += s - gE[c]; num[a] += 2; num[b] += 2; num[c] += 2;
      }
      for (let g = 0; g < nG; g++) {
        if (!num[g]) continue;
        const m = (acc[g] + gE[g]) / (num[g] + 1), d = gE[g] - m, v = gVar[g] * 1.5, w = v / (v + Math.max(0, d * d - v) + 1e-20);
        gE[g] -= w * d; gVar[g] *= 1 - 0.5 * w;
      }
    }
  };
  // points enfouis (dans un mur, sous un tapis, derrière un meuble plaqué) : valeur des voisins visibles, de proche en proche
  const fill = () => {
    const ok = Uint8Array.from(gOk), acc = new Float64Array(nG), num = new Int32Array(nG);
    for (let it = 0; it < 64; it++) {
      let ch = 0; acc.fill(0); num.fill(0);
      for (let t = 0; t < nTri; t++) {
        const a = group[t * 3]; if (a < 0) continue; const b = group[t * 3 + 1], c = group[t * 3 + 2];
        const oa = ok[a], ob = ok[b], oc = ok[c]; if (oa + ob + oc === 3 || oa + ob + oc === 0) continue;
        const s = (oa ? gE[a] : 0) + (ob ? gE[b] : 0) + (oc ? gE[c] : 0), n = oa + ob + oc;
        if (!oa) { acc[a] += s; num[a] += n; } if (!ob) { acc[b] += s; num[b] += n; } if (!oc) { acc[c] += s; num[c] += n; }
      }
      for (let g = 0; g < nG; g++) if (!ok[g] && num[g]) { gE[g] = acc[g] / num[g]; ok[g] = 2; ch++; }
      for (let g = 0; g < nG; g++) if (ok[g] === 2) ok[g] = 1;
      if (!ch) break;
    }
    // restes isolés : moyenne du maillage
    const mS = new Float64Array(list.length), mN = new Float64Array(list.length);
    for (let c = 0; c < nV; c++) { const g = group[c]; if (g >= 0 && ok[g]) { const m = triMesh[(c / 3) | 0]; mS[m] += gE[g]; mN[m]++; } }
    for (let c = 0; c < nV; c++) { const g = group[c]; if (g >= 0 && !ok[g]) { const m = triMesh[(c / 3) | 0]; gE[g] = mN[m] ? mS[m] / mN[m] : 0; } }
  };
  // passe 0 : ciel direct (rare en fond de pièce : beaucoup de rayons) ; passes suivantes : rebonds seuls (surfaces
  // éclairées larges, peu de bruit : moins de rayons)
  const D = new Float32Array(nG), hist = [];
  for (let b = 0; b <= O.bounces; b++) {
    const t1 = Date.now(), mul = b ? O.bounceMul : O.directMul; nRays += await pass(b ? 0x2545f491 : 0x5bd1e995, mul, b === 0);
    gather(mul, b ? 0.15 : 1); const bad = nBad;
    denoise();
    if (b === 0) D.set(gE); else for (let g = 0; g < nG; g++) gE[g] += D[g];
    hist.push(Float32Array.from(gE));
    for (let c = 0; c < nV; c++) { const g = group[c]; if (g >= 0) E[c] = gE[g]; }
    let s = 0; for (let g = 0; g < nG; g++) s += gE[g];
    log(`  étage ${K} : passe ${b} (${b ? b + ' rebond' + (b > 1 ? 's' : '') : 'ciel direct'}) ${((Date.now() - t1) / 1000).toFixed(1)} s, éclairement moyen ${(s / nG).toFixed(4)}`);
    nBad = bad;
  }
  for (const w of workers) await w.terminate();
  // rebonds suivants : série géométrique, rapport mesuré sur les deux derniers incréments
  if (hist.length >= 3) {
    const A = hist[hist.length - 1], B = hist[hist.length - 2], C = hist[hist.length - 3];
    let d1 = 0, d0 = 0; for (let g = 0; g < nG; g++) { d1 += A[g] - B[g]; d0 += B[g] - C[g]; }
    const r = Math.min(0.85, Math.max(0, d0 > 0 ? d1 / d0 : 0));
    for (let g = 0; g < nG; g++) gE[g] = A[g] + Math.max(0, A[g] - B[g]) * r / (1 - r);
    log(`  étage ${K} : rebonds suivants estimés (rapport ${r.toFixed(2)})`);
  }
  // --- sortie : facteur 0–1 par sommet cuit
  const idx = [], vals = [];
  list.forEach((e, m) => { if (!e.bake) return; idx.push({ name: e.name, n: e.n }); const a = new Float32Array(e.n); for (let i = 0; i < e.n; i++) a[i] = gE[group[first[m] + i]]; vals.push({ a, shell: shell[m], name: e.name }); });
  let n = 0; for (const e of idx) n += e.n;
  const rawE = new Float32Array(n); let off = 0;
  for (const v of vals) { rawE.set(v.a, off); off += v.a.length; }
  const stats = { tri: nTri, verts: n, points: nG, rays: nRays, buried: nBad, seconds: (Date.now() - t00) / 1000 };
  return { index: idx, rawE, stats };
}

// Niveaux : éclairement → facteur 0–1 sur l'albédo (1 octet par sommet).
// f = clamp((E / réf)^gamma, plancher, 1), réf = centile `refPct` de l'éclairement des murs, plafonds et parquets.
export function levels(index, rawE, opt = {}) {
  const O = { gamma: 0.4, floor: 0.4, refPct: 85, ...opt };
  const ref = []; let off = 0;
  for (const e of index) { if (/:(wall|ceil|parquet)$/.test(e.name)) for (let i = 0; i < e.n; i += 3) ref.push(rawE[off + i]); off += e.n; }
  ref.sort((a, b) => a - b);
  const refE = O.ref || ref[Math.min(ref.length - 1, Math.floor(ref.length * O.refPct / 100))] || 1;
  const bytes = new Uint8Array(rawE.length); let mean = 0;
  for (let i = 0; i < rawE.length; i++) { const f = Math.min(1, Math.max(O.floor, Math.pow(Math.max(0, rawE[i]) / refE, O.gamma))) || O.floor; bytes[i] = Math.round(f * 255); mean += f; }
  return { bytes, ref: refE, mean: mean / rawE.length };
}
