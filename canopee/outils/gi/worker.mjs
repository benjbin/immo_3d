// Fil de calcul : pour chaque coin de triangle « cible », éclairement moyen (ciel uniforme + rebonds) sur la zone du
// triangle proche du coin. Les rayons partent de points répartis sur cette zone (et non du seul sommet) : un sommet
// enfoui dans un mur voisin, sous le sol ou derrière un meuble plaqué ne noircit plus toute la surface.
import { parentPort, workerData } from 'node:worker_threads';
import { tracer } from './bvh.mjs';

const W = workerData;
const P = new Float32Array(W.P), triMesh = new Uint16Array(W.triMesh), rays = new Uint16Array(W.rays);
const E = new Float32Array(W.E), outSum = new Float32Array(W.outSum), outCnt = new Uint16Array(W.outCnt), outSumB = new Float32Array(W.outSumB), outCntB = new Uint16Array(W.outCntB), outSq = new Float32Array(W.outSq), outSqB = new Float32Array(W.outSqB), counter = new Int32Array(W.counter);
const target = W.target, dbl = W.dbl, alb = W.alb, nTri = W.nTri;
const R = tracer({ nb: new Float32Array(W.nb), nl: new Int32Array(W.nl), T: new Float32Array(W.T), id: new Int32Array(W.id) });
const hit = R.hit;
let SKY = 1, GROUND = W.ground;
const NEAR = W.near, NEAR_BACK = W.nearBack, DEPTH = W.depth, ZONE = W.zone, CH = 512;
const G1 = 0.7548776662466927, G2 = 0.5698402909980532, TAU = Math.PI * 2;

let s0 = 1;
const rnd = () => { s0 ^= s0 << 13; s0 ^= s0 >>> 17; s0 ^= s0 << 5; return (s0 >>> 0) / 4294967296; };
let dX = 0, dY = 0, dZ = 0;
// direction tirée selon le cosinus autour de la normale n
function cosDir(nx, ny, nz, r1, r2) {
  const r = Math.sqrt(r1), ph = TAU * r2, a = r * Math.cos(ph), b = r * Math.sin(ph), c = Math.sqrt(Math.max(0, 1 - r1));
  let tx, ty, tz;
  if (Math.abs(nx) > 0.9) { tx = 0; ty = 1; tz = 0; } else { tx = 1; ty = 0; tz = 0; }
  let ux = ty * nz - tz * ny, uy = tz * nx - tx * nz, uz = tx * ny - ty * nx; const ul = 1 / Math.hypot(ux, uy, uz); ux *= ul; uy *= ul; uz *= ul;
  const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
  dX = a * ux + b * vx + c * nx; dY = a * uy + b * vy + c * ny; dZ = a * uz + b * vz + c * nz;
}
// luminance reçue le long d'un rayon (−1 : échantillon à écarter, origine enfouie)
function radiance(ox, oy, oz, dx, dy, dz) {
  let thr = 1;
  for (let depth = 0; ; depth++) {
    const t = hit(ox, oy, oz, dx, dy, dz);
    if (t === Infinity) return thr * (dy > 0 ? SKY : GROUND);
    const tri = R.tri, m = triMesh[tri], back = R.back && !dbl[m];
    if (depth === 0) { if (t < NEAR) return -1; if (back && t < NEAR_BACK) return -1; }
    if (back) return 0;
    if (target[m]) { const u = R.u, v = R.v, c = tri * 3; return thr * alb[m] * (E[c] * (1 - u - v) + E[c + 1] * u + E[c + 2] * v); }
    if (depth >= DEPTH) return 0;
    // surface non cuite (enveloppe du bâtiment, modèles) : le chemin continue
    thr *= alb[m];
    const o = tri * 9;
    const e1x = P[o + 3] - P[o], e1y = P[o + 4] - P[o + 1], e1z = P[o + 5] - P[o + 2], e2x = P[o + 6] - P[o], e2y = P[o + 7] - P[o + 1], e2z = P[o + 8] - P[o + 2];
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x; const l = Math.hypot(nx, ny, nz);
    if (!(l > 0)) return 0;
    const s = (nx * dx + ny * dy + nz * dz > 0 ? -1 : 1) / l; nx *= s; ny *= s; nz *= s;
    ox += dx * t + nx * 1e-3; oy += dy * t + ny * 1e-3; oz += dz * t + nz * 1e-3;
    cosDir(nx, ny, nz, rnd(), rnd()); dx = dX; dy = dY; dz = dZ;
  }
}

function run(seed, mul) {
  let n = 0;
  for (;;) {
    const start = Atomics.add(counter, 0, CH); if (start >= nTri) break;
    const end = Math.min(nTri, start + CH);
    for (let t = start; t < end; t++) {
      const m = triMesh[t]; if (!target[m]) continue;
      const o = t * 9, two = dbl[m];
      const e1x = P[o + 3] - P[o], e1y = P[o + 4] - P[o + 1], e1z = P[o + 5] - P[o + 2], e2x = P[o + 6] - P[o], e2y = P[o + 7] - P[o + 1], e2z = P[o + 8] - P[o + 2];
      let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x; const l = Math.hypot(nx, ny, nz);
      if (!(l > 1e-12)) { outSum[t * 3] = outSum[t * 3 + 1] = outSum[t * 3 + 2] = 0; outCnt[t * 3] = outCnt[t * 3 + 1] = outCnt[t * 3 + 2] = 0; outCntB[t * 3] = outCntB[t * 3 + 1] = outCntB[t * 3 + 2] = 0; continue; }
      nx /= l; ny /= l; nz /= l;
      for (let k = 0; k < 3; k++) {
        const c = t * 3 + k, nr = Math.min(65535, Math.max(4, Math.round(rays[c] * mul))), kx = P[o + k * 3], ky = P[o + k * 3 + 1], kz = P[o + k * 3 + 2];
        s0 = (Math.imul(c + 1, 0x9E3779B1) ^ seed) | 0 || 1; rnd(); rnd();
        const o3 = rnd(), o4 = rnd();
        let sum = 0, cnt = 0, sumB = 0, cntB = 0, sq = 0, sqB = 0;
        for (let i = 0; i < nr; i++) {
          const su = Math.sqrt(rnd()), b1 = rnd() * su, b0 = 1 - su, b2 = su - b1;
          const qx = b0 * P[o] + b1 * P[o + 3] + b2 * P[o + 6], qy = b0 * P[o + 1] + b1 * P[o + 4] + b2 * P[o + 7], qz = b0 * P[o + 2] + b1 * P[o + 5] + b2 * P[o + 8];
          const s = two && (i & 1) ? -1 : 1, ax = nx * s, ay = ny * s, az = nz * s;
          let r3 = o3 + i * G1, r4 = o4 + i * G2; r3 -= Math.floor(r3); r4 -= Math.floor(r4);
          cosDir(ax, ay, az, r3, r4);
          const L = radiance(kx + ZONE * (qx - kx) + ax * 1e-3, ky + ZONE * (qy - ky) + ay * 1e-3, kz + ZONE * (qz - kz) + az * 1e-3, dX, dY, dZ);
          n++;
          if (L < 0) continue;
          if (s < 0) { sumB += L; sqB += L * L; cntB++; } else { sum += L; sq += L * L; cnt++; }
        }
        outSum[c] = sum; outCnt[c] = cnt; outSumB[c] = sumB; outCntB[c] = cntB; outSq[c] = sq; outSqB[c] = sqB;   // B : envers des matériaux double face
      }
    }
  }
  return n;
}
parentPort.on('message', (msg) => { SKY = msg.sky ? 1 : 0; GROUND = msg.sky ? W.ground : 0; parentPort.postMessage({ rays: run(msg.seed, msg.mul) }); });
