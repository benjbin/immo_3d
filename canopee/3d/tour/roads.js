// Canopée — tour/roads.js
// Rues, trottoirs, places, parkings, passages piétons, voies ferrées et tram, ponts.
// Contrat : buildRoads(THREE, M, ctx) → THREE.Group ou null (null : city.js garde sa version simple).
// ctx = { data, T, TP, near, inKeep, keepSeg, radius, rnd, CM, farBuf } (voir createCity dans city.js).
// Le groupe peut porter userData.onLight(dusk, night) (0..1 chacun), appelé à chaque changement d'heure.
//
// Principe : chaussées à 2 cm (rubans à onglets, disques et congés aux carrefours) ; trottoirs surélevés à 15 cm,
// découpés par soustraction de polygones convexes (tout ce qui recouvre une chaussée est retiré), bordures de granit
// en face verticale le long du contour de la chaussée, découpées de la même façon. Les surfaces de même matériau à
// même hauteur se recouvrent sans scintiller (uv monde identiques). Marquages blancs à la française en géométrie
// (axe T1, rives, passages piétons, lignes d'arrêt aux feux, places de parking). Voies ferrées sur ballast avec
// traverses et rails, quais surélevés, ponts en brique sur le canal. Mobilier (lampadaires, feux, potelets) instancié.
import { mulberry32 } from '../materials.js';

// hauteurs (m) : sol 0 < ballast 0,01 < chaussée 0,02 < marquage 0,026 < (pelouse city.js 0,07) < trottoir 0,15 < bordure 0,153 < pavés 0,156 < piste cyclable 0,158
const Y = { gravel: 0.01, road: 0.02, mark: 0.026, walk: 0.15, kerb: 0.153, paver: 0.156, cyc: 0.158, plat: 0.55 };
const TOL = 0.01;   // marge des découpes (m)
// largeur de chaussée et de trottoir par défaut ; mark : marquages ; lamp : lampadaires
const KIND = {
  motorway: { w: 10.5, walk: 0, mark: 1, lamp: 1 }, trunk: { w: 9, walk: 3, mark: 1, lamp: 1 }, primary: { w: 7, walk: 4, mark: 1, lamp: 1 },
  secondary: { w: 7, walk: 3.5, mark: 1, lamp: 1 }, tertiary: { w: 6.5, walk: 3, mark: 1, lamp: 1 }, residential: { w: 5.5, walk: 2.2 },
  unclassified: { w: 5.5, walk: 2 }, living_street: { w: 5, walk: 1.2 }, service: { w: 4, walk: 0.5 }, track: { w: 3, walk: 0 }, road: { w: 5.5, walk: 2 },
};
const FOOT = new Set(['footway', 'path', 'steps', 'cycleway', 'bridleway', 'pedestrian', 'corridor']);
const MAJOR = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);

const area2 = (P) => { let a = 0; for (let i = 0, n = P.length; i < n; i++) { const p = P[i], q = P[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a; };
const inPoly = (x, z, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, zi] = P[i], [xj, zj] = P[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
const bboxOf = (P) => { let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const p of P) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1]; } return [x0, z0, x1, z1]; };
const rn = (dx, dz) => [-dz, dx];   // normale à droite (x est, z sud, vu du dessus)

// ---------- découpe de polygones convexes ----------
// demi-plans « dedans ⇔ a x + b z + c > 0 », boîte englobante, propriétaire (pour les marquages) ;
// la soustraction de surfaces élargit les découpes d'1 cm (pas de lisière entre deux triangles voisins),
// la découpe des faces et les tests de points les rétrécissent d'1 cm (un bord commun n'est pas « dedans »)
function mkClip(P, owner = -1) {
  const n = P.length, s = area2(P) > 0 ? 1 : -1, hp = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const p = P[i], q = P[(i + 1) % n]; let a = -(q[1] - p[1]), b = q[0] - p[0]; const L = Math.hypot(a, b);
    if (L < 1e-7) { hp[i * 3 + 2] = 1; continue; }
    a /= L; b /= L; hp[i * 3] = a * s; hp[i * 3 + 1] = b * s; hp[i * 3 + 2] = -(a * p[0] + b * p[1]) * s;
  }
  const [x0, z0, x1, z1] = bboxOf(P);
  return { P, hp, x0, z0, x1, z1, owner };
}
const convex = (P) => { let sg = 0; for (let i = 0, n = P.length; i < n; i++) { const a = P[i], b = P[(i + 1) % n], c = P[(i + 2) % n]; const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]); if (Math.abs(cr) < 1e-9) continue; const s = cr > 0 ? 1 : -1; if (sg && s !== sg) return false; sg = s; } return true; };
function half(P, a, b, c, sg) {
  const out = [], n = P.length;
  for (let i = 0; i < n; i++) {
    const p = P[i], q = P[(i + 1) % n], gp = sg * (a * p[0] + b * p[1] + c), gq = sg * (a * q[0] + b * q[1] + c);
    if (gp >= 0) out.push(p);
    if ((gp >= 0) !== (gq >= 0)) { const t = gp / (gp - gq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
  }
  return out;
}
// P \ C : jusqu'à n morceaux convexes
function subPoly(P, C) {
  const out = [], hp = C.hp; let rest = P;
  for (let k = 0; k < hp.length; k += 3) {
    const o = half(rest, hp[k], hp[k + 1], hp[k + 2] + TOL, -1);
    if (o.length > 2 && Math.abs(area2(o)) > 2e-3) out.push(o);
    rest = half(rest, hp[k], hp[k + 1], hp[k + 2] + TOL, 1);
    if (rest.length < 3) break;
  }
  return out;
}
const inClip = (x, z, C) => { const h = C.hp; for (let k = 0; k < h.length; k += 3) if (h[k] * x + h[k + 1] * z + h[k + 2] <= TOL) return false; return true; };

// grille de hachage spatiale
class Grid {
  constructor(cs = 16) { this.cs = cs; this.m = new Map(); this.st = 0; this.k = '_g' + (Grid.n = (Grid.n || 0) + 1); }
  add(o) { const cs = this.cs; for (let ix = Math.floor(o.x0 / cs); ix <= Math.floor(o.x1 / cs); ix++) for (let iz = Math.floor(o.z0 / cs); iz <= Math.floor(o.z1 / cs); iz++) { const key = (ix + 4096) * 8192 + iz + 4096; let l = this.m.get(key); if (!l) this.m.set(key, l = []); l.push(o); } return o; }
  each(x0, z0, x1, z1, cb) {
    const cs = this.cs, st = ++this.st, k = this.k;
    for (let ix = Math.floor(x0 / cs); ix <= Math.floor(x1 / cs); ix++) for (let iz = Math.floor(z0 / cs); iz <= Math.floor(z1 / cs); iz++) {
      const l = this.m.get((ix + 4096) * 8192 + iz + 4096); if (!l) continue;
      for (const o of l) { if (o[k] === st) continue; o[k] = st; if (o.x1 < x0 || o.x0 > x1 || o.z1 < z0 || o.z0 > z1) continue; if (cb(o)) return true; }
    }
    return false;
  }
}
// retire de la liste de polygones tout ce qui tombe dans les découpes de la grille
function cutBy(list, grid, skip) {
  if (!list.length) return list;
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
  for (const P of list) { const b = bboxOf(P); x0 = Math.min(x0, b[0]); z0 = Math.min(z0, b[1]); x1 = Math.max(x1, b[2]); z1 = Math.max(z1, b[3]); }
  const cl = []; grid.each(x0, z0, x1, z1, (C) => { if (!skip || !skip(C)) cl.push(C); });
  let out = list;
  for (const C of cl) {
    const nx = [];
    for (const P of out) { const b = bboxOf(P); if (b[2] < C.x0 || b[0] > C.x1 || b[3] < C.z0 || b[1] > C.z1) nx.push(P); else for (const q of subPoly(P, C)) nx.push(q); }
    out = nx; if (!out.length) break;
  }
  return out;
}
// segment a→b moins les découpes : intervalles [t0, t1] restants
function cutSeg(a, b, grid, iv = [[0, 1]]) {
  grid.each(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), (C) => {
    let t0 = 0, t1 = 1; const h = C.hp;
    for (let k = 0; k < h.length; k += 3) {
      const fa = h[k] * a[0] + h[k + 1] * a[1] + h[k + 2] - TOL, fb = h[k] * b[0] + h[k + 1] * b[1] + h[k + 2] - TOL;
      if (fa <= 0 && fb <= 0) { t0 = 1; t1 = 0; break; }
      if (fa > 0 && fb > 0) continue;
      const t = fa / (fa - fb); if (fa <= 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
      if (t0 >= t1) break;
    }
    if (t1 - t0 > 1e-6) { const nx = []; for (const [u0, u1] of iv) { if (t1 <= u0 || t0 >= u1) { nx.push([u0, u1]); continue; } if (t0 > u0) nx.push([u0, t0]); if (t1 < u1) nx.push([t1, u1]); } iv = nx; }
    return !iv.length;
  });
  return iv;
}
const ptIn = (x, z, grid, skip) => grid.each(x, z, x, z, (C) => (!skip || !skip(C)) && inClip(x, z, C));

// polyligne décalée (d > 0 : à droite), onglets bornés
function offsetLine(c, d) {
  const out = [], n = c.length;
  for (let i = 0; i < n; i++) {
    const p = c[i];
    if (i === 0 || i === n - 1) {
      const a = c[i === 0 ? 0 : i - 1], b = c[i === 0 ? 1 : i]; let tx = b[0] - a[0], tz = b[1] - a[1]; const L = Math.hypot(tx, tz) || 1;
      out.push([p[0] - tz / L * d, p[1] + tx / L * d]); continue;
    }
    const a = c[i - 1], b = c[i + 1];
    let ux = p[0] - a[0], uz = p[1] - a[1], ul = Math.hypot(ux, uz) || 1, vx = b[0] - p[0], vz = b[1] - p[1], vl = Math.hypot(vx, vz) || 1;
    const n1 = [-uz / ul, ux / ul], n2 = [-vz / vl, vx / vl]; let mx = n1[0] + n2[0], mz = n1[1] + n2[1]; const ml = Math.hypot(mx, mz);
    if (ml < 1e-3) { out.push([p[0] + n1[0] * d, p[1] + n1[1] * d]); continue; }
    mx /= ml; mz /= ml; const k = 1 / Math.max(0.35, mx * n1[0] + mz * n1[1]);
    out.push([p[0] + mx * d * k, p[1] + mz * d * k]);
  }
  return out;
}
const lenOf = (c) => { let L = 0; for (let i = 1; i < c.length; i++) L += Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]); return L; };
// point et tangente à l'abscisse s le long de c
function along(c, s) {
  for (let i = 1; i < c.length; i++) {
    const a = c[i - 1], b = c[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (s <= L || i === c.length - 1) { const t = L ? Math.min(1, s / L) : 0, dx = (b[0] - a[0]) / (L || 1), dz = (b[1] - a[1]) / (L || 1); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, dx, dz]; }
    s -= L;
  }
  return [c[0][0], c[0][1], 1, 0];
}
const resample = (c, step) => { const out = [c[0]]; for (let i = 1; i < c.length; i++) { const a = c[i - 1], b = c[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / step)); for (let k = 1; k <= n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); } return out; };

// bruit de valeur périodique (période P cellules) pour des textures tuilables
function pnoise(x, y, P, seed) {
  const h = (i, j) => { i = ((i % P) + P) % P; j = ((j % P) + P) % P; let n = (i * 374761393 + j * 668265263 + seed * 1442695041) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const xi = Math.floor(x), yi = Math.floor(y); let tx = x - xi, ty = y - yi; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}
const pfbm = (x, y, P, oct, seed) => { let s = 0, a = 0.5, n = 0; for (let k = 0; k < oct; k++) { s += a * pnoise(x, y, P, seed + k * 31); n += a; x *= 2; y *= 2; P *= 2; a *= 0.5; } return s / n; };

export function buildRoads(THREE, M, ctx) {
  const t0 = performance.now();
  const { data, T, inKeep, radius } = ctx;
  if (!data || !data.roads) return null;
  const rnd = mulberry32(911);
  const R2 = radius + 40;
  const group = new THREE.Group(); group.name = 'rues';

  // ---------- textures procédurales ----------
  const canvasTex = (w, h, draw, tile, srgb = true) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    const [tu, tv] = Array.isArray(tile) ? tile : [tile, tile]; t.repeat.set(1 / tu, 1 / tv); return t;
  };
  const pix = (g, w, h, f) => { const im = g.createImageData(w, h), d = im.data; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4, c = f(x, y); d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255; } g.putImageData(im, 0, 0); };
  const r3 = mulberry32(77);
  // usure de chaussée (linéaire, 0,5 = neutre) sur 64 m : reprises d'enrobé, zones lessivées, fissures
  const WEAR = 64;
  const wearTex = canvasTex(512, 512, (g, w, h) => {
    pix(g, w, h, (x, y) => { const n = pfbm(x / 64, y / 64, 8, 4, 3), m = pfbm(x / 16, y / 16, 32, 2, 9); const v = 128 + (n - 0.5) * 70 + (m - 0.5) * 18; return [v, v, v]; });
    const wrap = (f) => { for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) { g.save(); g.translate(ox, oy); f(); g.restore(); } };
    for (let i = 0; i < 26; i++) {   // reprises rectangulaires (plus sombres, bord net)
      const x = r3() * w, y = r3() * h, a = 6 + r3() * 40, b = 4 + r3() * 14, v = 92 + r3() * 26 | 0, rot = r3() < 0.5 ? 0 : Math.PI / 2;
      wrap(() => { g.translate(x, y); g.rotate(rot); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(-a / 2, -b / 2, a, b); g.strokeStyle = 'rgba(40,40,40,.5)'; g.lineWidth = 1; g.strokeRect(-a / 2, -b / 2, a, b); });
    }
    g.strokeStyle = 'rgba(30,30,30,.55)'; g.lineWidth = 1;
    for (let i = 0; i < 70; i++) {   // fissures
      let x = r3() * w, y = r3() * h, a = r3() * 6.28; const pts = [[x, y]];
      for (let k = 0; k < 6 + r3() * 14; k++) { a += (r3() - 0.5) * 1.2; x += Math.cos(a) * 3; y += Math.sin(a) * 3; pts.push([x, y]); }
      wrap(() => { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts) g.lineTo(p[0], p[1]); g.stroke(); });
    }
  }, WEAR, false);
  // trottoir : béton clair désactivé (granulats apparents), sans joints (uv monde, recouvrements invisibles)
  const walkTex = canvasTex(512, 512, (g, w, h) => {
    pix(g, w, h, (x, y) => { const n = pfbm(x / 128, y / 128, 4, 4, 11), s = pfbm(x / 32, y / 32, 16, 3, 13); let v = 184 + (n - 0.5) * 30 + (s - 0.5) * 14 + (r3() - 0.5) * 22; return [v + 4, v, v - 9]; });
    for (let i = 0; i < 9000; i++) { const v = r3() < 0.5 ? 120 + r3() * 50 : 215 + r3() * 35; g.fillStyle = `rgba(${v + 6},${v},${v - 10},.8)`; g.fillRect(r3() * w, r3() * h, 1 + r3() * 1.6, 1 + r3() * 1.6); }
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(70,60,50,${0.03 + r3() * 0.05})`; g.beginPath(); g.arc(r3() * w, r3() * h, 4 + r3() * 26, 0, 7); g.fill(); }
  }, 3);
  // granit gris moucheté (bordures, chaperons, quais)
  const graniteTex = canvasTex(256, 256, (g, w, h) => {
    pix(g, w, h, (x, y) => { const n = pfbm(x / 64, y / 64, 4, 3, 21); const v = 150 + (n - 0.5) * 22 + (r3() - 0.5) * 30; return [v, v - 1, v - 4]; });
    for (let i = 0; i < 2600; i++) { const r = r3(), v = r < 0.45 ? 50 + r3() * 40 : r < 0.85 ? 205 + r3() * 40 : 0; g.fillStyle = v ? `rgb(${v},${v},${v - 3})` : 'rgb(170,130,120)'; g.fillRect(r3() * w, r3() * h, 1 + r3() * 1.5, 1 + r3() * 1.5); }
  }, 1);
  // gravier de l'emprise ferroviaire et ballast des voies
  const stones = (g, w, h, base, n, sz, spread) => { g.fillStyle = base; g.fillRect(0, 0, w, h); for (let i = 0; i < n; i++) { const v = spread[0] + r3() * spread[1] | 0; g.fillStyle = `rgb(${v + 6},${v + 2},${v - 4})`; const x = r3() * w, y = r3() * h, s = sz * (0.6 + r3() * 0.8); g.beginPath(); g.ellipse(x, y, s, s * (0.6 + r3() * 0.4), r3() * 3, 0, 7); g.fill(); } };
  const gravelTex = canvasTex(256, 256, (g, w, h) => stones(g, w, h, '#6d655c', 7000, 1.6, [70, 70]), 3);
  const ballastTex = canvasTex(256, 256, (g, w, h) => stones(g, w, h, '#4c4843', 5200, 2.6, [95, 85]), 1.6);
  // voie : u = travers (2,6 m), v = le long (1,2 m, deux traverses béton)
  const sleeperTex = canvasTex(128, 128, (g, w, h) => {
    g.drawImage(ballastTex.image, 0, 0, 256, 256, 0, 0, w * 2, h * 2);
    for (const v0 of [0.15, 0.75]) { const y = v0 / 1.2 * h; g.fillStyle = '#9f9b93'; g.fillRect(w * 0.04, y, w * 0.92, 0.26 / 1.2 * h); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(w * 0.04, y + 0.26 / 1.2 * h - 2, w * 0.92, 2); }
    g.fillStyle = '#5a4434'; for (const u of [1.3 - 0.7175, 1.3 + 0.7175]) g.fillRect(u / 2.6 * w - 2.5, 0, 5, h);
  }, [2.6, 1.2]);
  // brique foraine toulousaine (40 × 5,5 cm, joints épais) : u 1,6 m × v 0,8 m
  const brickTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#d4c3ad'; g.fillRect(0, 0, w, h);
    const rows = 11, bh = h / rows;
    for (let r = 0; r < rows; r++) for (let k = -1; k < 4; k++) {
      const x = (k + (r % 2) * 0.5) * w / 4, c = [178 + r3() * 40, 92 + r3() * 30, 70 + r3() * 22];
      g.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`; g.fillRect(x + 1.5, r * bh + 1.5, w / 4 - 3, bh - 3.5);
    }
  }, [1.6, 0.8]);
  // peinture blanche un peu usée
  const markTex = canvasTex(128, 128, (g, w, h) => { pix(g, w, h, () => { const v = 236 - r3() * r3() * 70; return [v, v, v - 2]; }); }, 1.5);

  // usure monde multiplicative ajoutée aux matériaux de sol (même échelle quel que soit le matériau)
  const withWear = (mat, tile, k) => {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.wearMap = { value: wearTex }; sh.uniforms.wearK = { value: k };
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D wearMap; uniform float wearK;')
        .replace('#include <map_fragment>', `#include <map_fragment>\n  diffuseColor.rgb *= mix(1.0, texture2D(wearMap, vMapUv * ${(tile / WEAR).toFixed(5)}).r * 2.0, wearK);`);
    };
    mat.customProgramCacheKey = () => 'roads-wear-' + tile + '-' + k;
    return mat;
  };
  const off = (m, f) => { m.polygonOffset = true; m.polygonOffsetFactor = -f; m.polygonOffsetUnits = -4 * f; return m; };
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const MAT = {
    asph: off(withWear(M.asphalt.clone(), 2.0, 0.9), 2),
    mark: off(std({ name: 'rues:marquage', map: markTex, roughness: 0.62, color: 0xf4f4f0 }), 4),
    walk: off(withWear(std({ name: 'rues:trottoir', map: walkTex, roughness: 0.92 }), 3, 0.45), 1),
    kerb: off(std({ name: 'rues:granit', map: graniteTex, roughness: 0.7 }), 2),
    paver: off(withWear(M.paver.clone(), 2.4, 0.35), 3),
    gravel: off(std({ name: 'rues:emprise', map: gravelTex, roughness: 0.97 }), 1),
    ballast: std({ name: 'rues:ballast', map: ballastTex, roughness: 0.95 }),
    sleeper: off(std({ name: 'rues:voie', map: sleeperTex, roughness: 0.9 }), 1),
    rail: std({ name: 'rues:rail', color: 0x8d8780, metalness: 0.85, roughness: 0.32 }),
    brick: std({ name: 'rues:brique', map: brickTex, roughness: 0.85, side: THREE.DoubleSide }),
  };
  MAT.asph.name = 'rues:enrobe'; MAT.paver.name = 'rues:paves';

  // ---------- accumulateurs ----------
  class Acc {
    constructor() { this.p = []; this.n = []; this.u = []; this.i = []; }
    get nv() { return this.p.length / 3; }
    top(P, y, uvf) {   // polygone convexe horizontal, face vers le haut ; uv monde (x, −z) par défaut
      if (P.length < 3) return; const a = area2(P); if (Math.abs(a) < 1e-4) return;
      const b = this.nv;
      for (const q of P) { this.p.push(q[0], y, q[1]); this.n.push(0, 1, 0); if (uvf) this.u.push(...uvf(q)); else this.u.push(q[0], -q[1]); }
      for (let k = 1; k < P.length - 1; k++) a < 0 ? this.i.push(b, b + k, b + k + 1) : this.i.push(b, b + k + 1, b + k);
    }
    wall(ax, az, bx, bz, y0, y1, u0 = 0) {   // face verticale tournée vers la droite de a→b
      const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz); if (L < 0.01 || y1 - y0 < 1e-3) return;
      const nx = -dz / L, nz = dx / L, b = this.nv;
      this.p.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az); for (let k = 0; k < 4; k++) this.n.push(nx, 0, nz);
      this.u.push(u0, y0, u0 + L, y0, u0 + L, y1, u0, y1); this.i.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    quad(A, B, C, D, uv) {   // quadrilatère 3D quelconque (A B C D dans le sens trigonométrique vu de la face)
      const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = D[0] - A[0], vy = D[1] - A[1], vz = D[2] - A[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      const b = this.nv; for (const P of [A, B, C, D]) { this.p.push(P[0], P[1], P[2]); this.n.push(nx, ny, nz); }
      this.u.push(...uv); this.i.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    mesh(mat, { cast = false, recv = true } = {}) {
      if (!this.i.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2)); g.setIndex(this.i); g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat); m.castShadow = cast; m.receiveShadow = recv; m.matrixAutoUpdate = false; m.updateMatrix(); m.name = mat.name;
      group.add(m); return m;
    }
  }
  const A = { asph: new Acc(), mark: new Acc(), walk: new Acc(), kerb: new Acc(), paver: new Acc(), gravel: new Acc(), ballast: new Acc(), sleeper: new Acc(), rail: new Acc(), brick: new Acc() };
  // face verticale découpée : intervalles conservés d'un segment ; side = +1 face à droite de a→b, −1 à gauche
  const wallCut = (acc, a, b, y0, y1, side, grids) => {
    let iv = [[0, 1]]; for (const g of grids) { iv = cutSeg(a, b, g, iv); if (!iv.length) return; }
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
    for (const [s0, s1] of iv) {
      if ((s1 - s0) * L < 0.04) continue;
      const p = [a[0] + dx * s0, a[1] + dz * s0], q = [a[0] + dx * s1, a[1] + dz * s1];
      if (side > 0) acc.wall(p[0], p[1], q[0], q[1], y0, y1, s0 * L); else acc.wall(q[0], q[1], p[0], p[1], y0, y1, s0 * L);
    }
  };
  const triangulate = (ring) => {   // polygone simple → triangles [[x,z]×3]
    if (ring.length < 3) return [];
    const v = ring.map(([x, z]) => new THREE.Vector2(x, z)), f = THREE.ShapeUtils.triangulateShape(v, []);
    return f.map(([a, b, c]) => [ring[a], ring[b], ring[c]]);
  };
  const cleanRing = (P) => { const out = []; for (const p of P) { const l = out[out.length - 1]; if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) > 0.05) out.push(p); } if (out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 0.05) out.pop(); return out; };
  const nearR = (P) => P.some(([x, z]) => Math.hypot(x, z) < radius);

  // ---------- découpes fixes : parcelle de la tour, eau ----------
  const KEEP = new Grid(32);
  if (data.site && data.site.length > 2) {
    let lot = cleanRing(data.site.map(T)); const s = area2(lot) > 0 ? 1 : -1;
    lot = lot.map((p, i) => {   // marge de 0,7 m autour de la parcelle (le parvis est dessiné par building.js)
      const a = lot[(i + lot.length - 1) % lot.length], b = lot[(i + 1) % lot.length];
      const n1 = rn(p[0] - a[0], p[1] - a[1]), n2 = rn(b[0] - p[0], b[1] - p[1]); const l1 = Math.hypot(...n1) || 1, l2 = Math.hypot(...n2) || 1;
      let mx = n1[0] / l1 + n2[0] / l2, mz = n1[1] / l1 + n2[1] / l2; const ml = Math.hypot(mx, mz) || 1;
      return [p[0] - s * mx / ml * 0.9, p[1] - s * mz / ml * 0.9];
    });
    for (const t of triangulate(lot)) KEEP.add(mkClip(t));
  }
  const WAT = new Grid(24), waterRings = [];
  for (const p of data.water || []) { const q = cleanRing(p.map(T)); if (q.length < 3 || !nearR(q)) continue; waterRings.push(q); for (const t of triangulate(q)) WAT.add(mkClip(t)); }
  const inWater = (x, z) => ptIn(x, z, WAT);

  // ---------- rues : tri, passage en coordonnées maquette, fusion des tronçons ----------
  const splitR = (c) => { const out = []; let cur = []; for (const p of c) { if (Math.hypot(p[0], p[1]) < R2) { const l = cur[cur.length - 1]; if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) > 0.05) cur.push(p); } else { if (cur.length > 1) out.push(cur); cur = []; } } if (cur.length > 1) out.push(cur); return out; };
  const veh = [], foot = [];
  for (const r of data.roads) {
    if (!r || !r.c || r.c.length < 2 || r.tunnel || (r.layer | 0) < 0) continue;
    const k = String(r.kind || 'service').replace('_link', ''), isFoot = FOOT.has(k), K = KIND[k];
    if (!isFoot && !K) continue;
    for (const c of splitR(r.c.map(T))) {
      if (isFoot) { foot.push({ c, k, w: Math.max(1.2, Math.min(r.w || (k === 'pedestrian' ? 6 : 2.5), 12)), bridge: !!r.bridge }); continue; }
      const w = Math.max(2.8, Math.min(r.w || (r.lanes ? r.lanes * 3.2 : K.w), 22));
      let walk = K.walk; if (w >= 9 && walk > 0) walk = Math.max(walk, 4);
      const sw = r.sidewalk, wl = sw === 'no' || sw === 'right' ? Math.min(walk, 0.5) : walk, wr = sw === 'no' || sw === 'left' ? Math.min(walk, 0.5) : walk;
      veh.push({ c, k, w, wl, wr, oneway: !!r.oneway, lanes: r.lanes | 0, bridge: !!r.bridge, junction: r.junction || null, name: r.name || null, src: r });
    }
  }
  const kq = (p) => Math.round(p[0] * 20) + ',' + Math.round(p[1] * 20);
  // fusion des tronçons qui se prolongent (même type, même largeur) aux nœuds de degré 2
  const PL = [];
  {
    const ends = new Map(), inner = new Map();
    veh.forEach((v, i) => { for (const p of [v.c[0], v.c[v.c.length - 1]]) { const key = kq(p); let l = ends.get(key); if (!l) ends.set(key, l = []); l.push(i); } for (let j = 1; j < v.c.length - 1; j++) inner.set(kq(v.c[j]), 1); });
    const same = (a, b) => a.k === b.k && Math.abs(a.w - b.w) < 0.2 && a.wl === b.wl && a.wr === b.wr && a.oneway === b.oneway && a.lanes === b.lanes;
    const used = new Uint8Array(veh.length);
    for (let i = 0; i < veh.length; i++) {
      if (used[i]) continue; used[i] = 1; const v = veh[i]; let c = v.c.slice(), bridges = v.bridge ? [v.c] : [];
      for (const dir of [1, -1]) for (;;) {
        const tip = dir > 0 ? c[c.length - 1] : c[0], key = kq(tip), L = ends.get(key);
        if (!L || L.length !== 2 || inner.get(key)) break;
        const j = L.find((x) => !used[x]); if (j === undefined || !same(v, veh[j])) break;
        const o = veh[j], s0 = kq(o.c[0]) === key, e0 = kq(o.c[o.c.length - 1]) === key; let add;
        if (dir > 0) { if (s0) add = o.c.slice(1); else if (e0 && !v.oneway) add = o.c.slice(0, -1).reverse(); else break; c = c.concat(add); }
        else { if (e0) add = o.c.slice(0, -1); else if (s0 && !v.oneway) add = o.c.slice(1).reverse(); else break; c = add.concat(c); }
        used[j] = 1; if (o.bridge) bridges.push(o.c);
      }
      PL.push({ ...v, c, id: PL.length, len: lenOf(c), hw: v.w / 2 });
    }
  }

  // ---------- chaussées (R : grille des découpes « chaussée ») ----------
  const RD = new Grid(16), BZ = new Grid(16);   // chaussées, emprises des ponts
  const segG = new Grid(16);                    // segments d'axe des rues (recherche du plus proche)
  for (const pl of PL) {
    const { c, hw } = pl; pl.L = offsetLine(c, -hw); pl.R = offsetLine(c, hw);
    for (let i = 0; i < c.length - 1; i++) {
      const q = [pl.L[i], pl.L[i + 1], pl.R[i + 1], pl.R[i]];
      if (convex(q)) RD.add(mkClip(q, pl.id)); else { RD.add(mkClip([q[0], q[1], q[2]], pl.id)); RD.add(mkClip([q[0], q[2], q[3]], pl.id)); }
      const a = c[i], b = c[i + 1]; segG.add({ x0: Math.min(a[0], b[0]) - 1, z0: Math.min(a[1], b[1]) - 1, x1: Math.max(a[0], b[0]) + 1, z1: Math.max(a[1], b[1]) + 1, a, b, pl, i });
    }
  }
  const nearestSeg = (x, z, maxD, filt) => {
    let best = null, bd = maxD;
    segG.each(x - maxD, z - maxD, x + maxD, z + maxD, (s) => {
      if (filt && !filt(s.pl)) return;
      const { a, b } = s, dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2));
      const d = Math.hypot(a[0] + dx * t - x, a[1] + dz * t - z); if (d < bd) { bd = d; best = { s, t, d, x: a[0] + dx * t, z: a[1] + dz * t, dx: dx / Math.sqrt(L2), dz: dz / Math.sqrt(L2) }; }
    });
    return best;
  };

  // nœuds du réseau : branches au départ de chaque sommet partagé
  const nodes = new Map();
  for (const pl of PL) pl.c.forEach((p, i) => {
    const key = kq(p); let nd = nodes.get(key); if (!nd) nodes.set(key, nd = { x: p[0], z: p[1], arms: [], key });
    for (const j of [i - 1, i + 1]) {
      if (j < 0 || j >= pl.c.length) continue;
      const q = pl.c[j], dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz) || 1;
      nd.arms.push({ pl, i, fwd: j > i, dx: dx / L, dz: dz / L, seg: L, a: Math.atan2(dz, dx) });
    }
  });
  const junctions = [];
  const kerbLines = [];   // { a, b, y0, y1, side } contours de chaussée (bordures)
  const kerbTops = [];    // quadrilatères de chaperon de bordure (granit) le long des congés
  for (const nd of nodes.values()) {
    const arms = nd.arms; if (arms.length < 2) continue;
    if (arms.length === 2 && arms[0].pl === arms[1].pl) continue;
    const maxHw = Math.max(...arms.map((a) => a.pl.hw)), minHw = Math.min(...arms.map((a) => a.pl.hw));
    const r = arms.length >= 3 ? maxHw : minHw;
    const disc = []; for (let k = 0; k < 16; k++) { const t = k / 16 * Math.PI * 2; disc.push([nd.x + Math.cos(t) * r, nd.z + Math.sin(t) * r]); }
    RD.add(mkClip(disc, -1)); A.asph.top(disc, Y.road);
    for (let k = 0; k < 16; k++) kerbLines.push({ a: disc[k], b: disc[(k + 1) % 16], y0: Y.road, y1: Y.kerb, side: 1 });   // trigonométrique : chaussée à droite
    if (arms.length < 3) continue;
    junctions.push(nd);
    // congés de bordure entre branches voisines
    arms.sort((p, q) => p.a - q.a);
    for (let k = 0; k < arms.length; k++) {
      const ai = arms[k], aj = arms[(k + 1) % arms.length];
      let th = aj.a - ai.a; if (th <= 0) th += Math.PI * 2;
      if (th < 0.35 || th > 2.95) continue;
      const wi = ai.fwd ? ai.pl.wr : ai.pl.wl, wj = aj.fwd ? aj.pl.wl : aj.pl.wr;   // trottoirs du côté du secteur
      if (wi < 0.8 || wj < 0.8) continue;
      const rf = MAJOR.has(ai.pl.k) || MAJOR.has(aj.pl.k) ? 5 : 3.5;
      const di = [ai.dx, ai.dz], dj = [aj.dx, aj.dz], ni = [-ai.dz, ai.dx], nj = [aj.dz, -aj.dx];
      const solve = (oi, oj) => {   // nœud + ni·oi + t·di = nœud + nj·oj + s·dj
        const bx = nj[0] * oj - ni[0] * oi, bz = nj[1] * oj - ni[1] * oi, det = di[0] * -dj[1] - -dj[0] * di[1];
        if (Math.abs(det) < 1e-6) return null; return [(bx * -dj[1] - -dj[0] * bz) / det, (di[0] * bz - di[1] * bx) / det];
      };
      const hi = ai.pl.hw, hj = aj.pl.hw, ts = solve(hi + rf, hj + rf), tx = solve(hi, hj);
      if (!ts || !tx || ts[0] < 0.2 || ts[1] < 0.2 || ts[0] > Math.min(ai.seg, 20) || ts[1] > Math.min(aj.seg, 20)) continue;
      const C = [nd.x + ni[0] * (hi + rf) + di[0] * ts[0], nd.z + ni[1] * (hi + rf) + di[1] * ts[0]];
      const Ti = [C[0] - ni[0] * rf, C[1] - ni[1] * rf], Tj = [C[0] - nj[0] * rf, C[1] - nj[1] * rf];
      const X = [nd.x + ni[0] * hi + di[0] * tx[0], nd.z + ni[1] * hi + di[1] * tx[0]];
      let a0 = Math.atan2(Ti[1] - C[1], Ti[0] - C[0]), a1 = Math.atan2(Tj[1] - C[1], Tj[0] - C[0]), da = a1 - a0;
      while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
      const n = Math.max(3, Math.ceil(Math.abs(da) / (Math.PI / 14))), arc = [];
      for (let m = 0; m <= n; m++) { const t = a0 + da * m / n; arc.push([C[0] + Math.cos(t) * rf, C[1] + Math.sin(t) * rf]); }
      for (let m = 0; m < n; m++) {
        const tri = [X, arc[m], arc[m + 1]]; if (Math.abs(area2(tri)) < 1e-4) continue;
        RD.add(mkClip(tri, -1)); A.asph.top(tri, Y.road);
        const p = arc[m], q = arc[m + 1], mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2, nr = rn(q[0] - p[0], q[1] - p[1]);
        kerbLines.push({ a: p, b: q, y0: Y.road, y1: Y.kerb, side: nr[0] * (X[0] - mx) + nr[1] * (X[1] - mz) > 0 ? 1 : -1 });
        const k2 = 0.27 / rf; kerbTops.push([p, q, [q[0] + (C[0] - q[0]) * k2, q[1] + (C[1] - q[1]) * k2], [p[0] + (C[0] - p[0]) * k2, p[1] + (C[1] - p[1]) * k2]]);
      }
    }
  }

  // grands carrefours entre chaussées séparées : le pavé central entre les nœuds proches devient chaussée
  // (sinon les terre-pleins et les lignes de rive traverseraient le carrefour)
  {
    const J = junctions.filter((nd) => nd.arms.some((a) => MAJOR.has(a.pl.k))), par = J.map((_, i) => i);
    const find = (i) => (par[i] === i ? i : (par[i] = find(par[i])));
    for (let i = 0; i < J.length; i++) for (let j = i + 1; j < J.length; j++) if (Math.hypot(J[i].x - J[j].x, J[i].z - J[j].z) < 46) par[find(i)] = find(j);
    const cl = new Map(); J.forEach((nd, i) => { const r = find(i); if (!cl.has(r)) cl.set(r, []); cl.get(r).push(nd); });
    for (const g of cl.values()) {
      if (g.length < 2 || g.length > 6) continue;
      const d = 0.9 * Math.min(...g.flatMap((nd) => nd.arms.filter((a) => MAJOR.has(a.pl.k)).map((a) => a.pl.hw))), pts = [];
      for (const nd of g) for (let k = 0; k < 8; k++) pts.push([nd.x + Math.cos(k * Math.PI / 4) * d, nd.z + Math.sin(k * Math.PI / 4) * d]);
      pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
      for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
      for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
      const hull = lo.slice(0, -1).concat(up.slice(0, -1)); if (hull.length < 3 || Math.abs(area2(hull)) > 2 * 6000) continue;
      RD.add(mkClip(hull, -1)); for (const P of cutBy([hull], KEEP)) A.asph.top(P, Y.road);
      const sg = area2(hull) > 0 ? 1 : -1;
      for (let i = 0; i < hull.length; i++) kerbLines.push({ a: hull[i], b: hull[(i + 1) % hull.length], y0: Y.road, y1: Y.kerb, side: sg });
    }
  }

  // ---------- parkings (au niveau de la chaussée, bordés d'une bordure) ----------
  const AR = data.areas || {}, parkRings = [];
  for (const p of AR.parking || []) {
    const q = cleanRing(p.map(T)); if (q.length < 3 || !nearR(q)) continue;
    const tris = triangulate(q); parkRings.push(q);
    for (const t of tris) RD.add(mkClip(t, -2 - parkRings.length));
  }

  // ---------- ponts : emprises (pour ne pas découper les trottoirs par l'eau, et couper les voies ferrées) ----------
  const bridgeLines = [];
  // tronçons d'origine (la fusion des rues ignore l'attribut pont)
  for (const v of veh) if (v.bridge) bridgeLines.push({ c: v.c, hw: v.w / 2 + Math.max(v.wl, v.wr), deckY: Y.walk });
  for (const f of foot) if (f.bridge) bridgeLines.push({ c: f.c, hw: f.w / 2 + 0.35, deckY: f.k === 'cycleway' ? Y.cyc : Y.walk });
  bridgeLines.forEach((b, bi) => { b.Lp = offsetLine(b.c, -b.hw); b.Rp = offsetLine(b.c, b.hw); for (let i = 0; i < b.c.length - 1; i++) { const q = [b.Lp[i], b.Lp[i + 1], b.Rp[i + 1], b.Rp[i]]; BZ.add(mkClip(convex(q) ? q : [q[0], q[1], q[2]], 1000 + bi)); } });
  const onBridge = (P) => { let x = 0, z = 0; for (const p of P) { x += p[0]; z += p[1]; } x /= P.length; z /= P.length; return ptIn(x, z, BZ); };
  // un morceau de trottoir passe au-dessus de l'eau seulement sur un pont
  const finish = (pieces) => { let out = cutBy(pieces, KEEP); if (waterRings.length) { const o2 = []; for (const P of out) { if (onBridge(P)) o2.push(P); else for (const q of cutBy([P], WAT)) o2.push(q); } out = o2; } return out; };

  // ---------- chaussées : surfaces, bordures, trottoirs ----------
  const walkQuads = [];   // trottoirs bruts (pour les potelets et margelles)
  for (const pl of PL) {
    const { c, hw, L, R } = pl;
    for (let i = 0; i < c.length - 1; i++) for (const P of cutBy([[L[i], L[i + 1], R[i + 1], R[i]]], KEEP)) A.asph.top(P, Y.road);
    for (const [side, wv] of [[1, pl.wr], [-1, pl.wl]]) {
      const edge = side > 0 ? R : L;
      // bordure : face verticale le long du bord de chaussée, tournée vers la chaussée
      for (let i = 0; i < c.length - 1; i++) kerbLines.push({ a: edge[i], b: edge[i + 1], y0: wv > 0 ? Y.road : 0, y1: wv > 0 ? Y.kerb : Y.road, side: -side });
      if (wv <= 0) continue;
      const kOut = offsetLine(c, side * (hw + 0.27)), sIn = offsetLine(c, side * (hw + 0.2)), sOut = wv > 0.3 ? offsetLine(c, side * (hw + wv)) : null;
      for (let i = 0; i < c.length - 1; i++) {
        for (const P of finish(cutBy([[edge[i], edge[i + 1], kOut[i + 1], kOut[i]]], RD))) A.kerb.top(P, Y.kerb);
        if (sOut) {
          const q = [sIn[i], sIn[i + 1], sOut[i + 1], sOut[i]]; walkQuads.push(q);
          for (const P of finish(cutBy([q], RD))) A.walk.top(P, Y.walk);
        }
        // face extérieure du trottoir (vers les cours et pelouses)
        const o = sOut || kOut; wallCut(A.walk, o[i], o[i + 1], 0, Y.walk, side, [RD, KEEP]);
      }
      // abouts libres (impasses, bord du rayon)
      for (const end of [0, c.length - 1]) {
        const key = kq(c[end]), nd = nodes.get(key); if (nd && nd.arms.length > 1) continue;
        const o = sOut || kOut, a = edge[end], b = o[end], dir = end === 0 ? -1 : 1;
        wallCut(A.walk, a, b, 0, Y.walk, dir * side, [RD, KEEP]);
      }
    }
  }
  for (const q of kerbTops) for (const P of finish(cutBy([q], RD))) A.kerb.top(P, Y.kerb);
  // bordures de parking : chaperon extérieur de 27 cm et faces
  for (const q of parkRings) {
    for (const t of triangulate(q)) for (const P of cutBy([t], KEEP)) A.asph.top(P, Y.road);
    const s = area2(q) > 0 ? 1 : -1;   // > 0 : intérieur à droite
    for (let i = 0; i < q.length; i++) {
      const a = q[i], b = q[(i + 1) % q.length], nr = rn(b[0] - a[0], b[1] - a[1]), l = Math.hypot(...nr) || 1, ox = -s * nr[0] / l * 0.27, oz = -s * nr[1] / l * 0.27;
      kerbLines.push({ a, b, y0: Y.road, y1: Y.kerb, side: s });
      for (const P of finish(cutBy([[a, b, [b[0] + ox, b[1] + oz], [a[0] + ox, a[1] + oz]]], RD))) A.kerb.top(P, Y.kerb);
      wallCut(A.kerb, [a[0] + ox, a[1] + oz], [b[0] + ox, b[1] + oz], 0, Y.kerb, -s, [RD, KEEP]);
    }
  }
  for (const k of kerbLines) wallCut(A.kerb, k.a, k.b, k.y0, k.y1, k.side, [RD, KEEP]);

  // ---------- cheminements piétons, pistes cyclables, rues piétonnes ----------
  const PED = new Grid(16);
  for (const f of foot) {
    const { c, w, k } = f, hw = w / 2, Lf = offsetLine(c, -hw), Rf = offsetLine(c, hw);
    const isPav = k === 'pedestrian', acc = isPav ? A.paver : k === 'cycleway' ? A.asph : A.walk, y = isPav ? Y.paver : k === 'cycleway' ? Y.cyc : Y.walk;
    for (let i = 0; i < c.length - 1; i++) {
      const q = [Lf[i], Lf[i + 1], Rf[i + 1], Rf[i]]; if (!convex(q)) continue;
      const pieces = cutBy([q], RD);
      for (const P of f.bridge ? cutBy(pieces, KEEP) : finish(pieces)) acc.top(P, y);
      if (isPav) PED.add(mkClip(q));
      wallCut(isPav ? A.kerb : A.walk, Rf[i], Rf[i + 1], 0, y, 1, [RD, KEEP]);
      wallCut(isPav ? A.kerb : A.walk, Lf[i], Lf[i + 1], 0, y, -1, [RD, KEEP]);
    }
  }
  const pedRings = [];
  for (const key of ['pedestrian', 'plaza']) for (const p of AR[key] || []) {
    const q = cleanRing(p.map(T)); if (q.length < 3 || !nearR(q)) continue; pedRings.push(q);
    for (const t of triangulate(q)) { for (const P of finish(cutBy([t], RD))) A.paver.top(P, Y.paver); PED.add(mkClip(t)); }
    const s = area2(q) > 0 ? 1 : -1;
    for (let i = 0; i < q.length; i++) wallCut(A.kerb, q[i], q[(i + 1) % q.length], 0, Y.paver, -s, [RD, KEEP]);
  }

  // ---------- voies ferrées ----------
  for (const key of ['railway']) for (const p of AR[key] || []) {
    const q = cleanRing(p.map(T)); if (q.length < 3 || !nearR(q)) continue;
    for (const t of triangulate(q)) for (const P of cutBy(cutBy([t], RD), KEEP)) A.gravel.top(P, Y.gravel);
  }
  let nTrack = 0;
  for (const r of data.rails || []) {
    if (!r || !r.c || r.tunnel || r.kind === 'subway' || (r.layer | 0) < 0) continue;
    const tram = r.kind === 'tram' || r.kind === 'light_rail';
    for (const c0 of splitR(r.c.map(T))) {
      const c = resample(c0, 6), lift = (nTrack++ % 4) * 0.004;
      const yb = 0.2 + lift, ys = yb + 0.012, yr = ys + 0.15;
      let s = 0;
      for (let i = 0; i < c.length - 1; i++) {
        const a = c[i], b = c[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz); if (L < 0.05) continue;
        const grids = r.bridge ? [KEEP] : [RD, BZ, KEEP];
        let iv = [[0, 1]]; for (const g of grids) { iv = cutSeg(a, b, g, iv); if (!iv.length) break; }
        const ux = dx / L, uz = dz / L, nx = -uz, nz = ux;
        for (const [t0, t1] of iv) {
          const p = [a[0] + dx * t0, a[1] + dz * t0], q = [a[0] + dx * t1, a[1] + dz * t1], v0 = s + t0 * L, v1 = s + t1 * L;
          const P = (pt, o, y) => [pt[0] + nx * o, y, pt[1] + nz * o];
          if (!tram) {   // plate-forme de ballast en trapèze (quadrilatères A B C D, normale = (B−A) × (D−A))
            A.ballast.quad(P(p, -1.55, yb), P(p, 1.55, yb), P(q, 1.55, yb), P(q, -1.55, yb), [-1.55, v0, 1.55, v0, 1.55, v1, -1.55, v1]);
            A.ballast.quad(P(p, 1.55, yb), P(p, 2.4, 0.005), P(q, 2.4, 0.005), P(q, 1.55, yb), [1.55, v0, 2.4, v0, 2.4, v1, 1.55, v1]);
            A.ballast.quad(P(p, -2.4, 0.005), P(p, -1.55, yb), P(q, -1.55, yb), P(q, -2.4, 0.005), [-2.4, v0, -1.55, v0, -1.55, v1, -2.4, v1]);
            A.sleeper.quad(P(p, -1.3, ys), P(p, 1.3, ys), P(q, 1.3, ys), P(q, -1.3, ys), [0, v0, 2.6, v0, 2.6, v1, 0, v1]);
          }
          const y0 = tram ? Y.road : ys, y1 = tram ? Y.road + 0.01 : yr;
          for (const o of [-0.7175, 0.7175]) {   // rails : champignon 7 cm (dessus + deux flancs)
            const e0 = o - 0.036, e1 = o + 0.036;
            A.rail.quad(P(p, e0, y1), P(p, e1, y1), P(q, e1, y1), P(q, e0, y1), [0, v0, 0.07, v0, 0.07, v1, 0, v1]);
            A.rail.quad(P(p, e1, y0), P(q, e1, y0), P(q, e1, y1), P(p, e1, y1), [v0, 0, v1, 0, v1, 0.15, v0, 0.15]);
            A.rail.quad(P(q, e0, y0), P(p, e0, y0), P(p, e0, y1), P(q, e0, y1), [v1, 0, v0, 0, v0, 0.15, v1, 0.15]);
          }
        }
        s += L;
      }
    }
  }
  // quais de gare : dalle à 55 cm, chaperon de granit, ligne blanche de sécurité
  for (const p of AR.platforms || []) {
    let q = cleanRing(p.map(T)); if (q.length < 3 || !nearR(q)) continue;
    const s = area2(q) > 0 ? 1 : -1;
    for (const t of triangulate(q)) for (const P of cutBy([t], KEEP)) A.walk.top(P, Y.plat);
    for (let i = 0; i < q.length; i++) {
      const a = q[i], b = q[(i + 1) % q.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.3) continue;
      const nr = rn(b[0] - a[0], b[1] - a[1]), ix = s * nr[0] / L, iz = s * nr[1] / L;   // vers l'intérieur
      const I = (pt, d) => [pt[0] + ix * d, pt[1] + iz * d];
      wallCut(A.kerb, a, b, 0, Y.plat + 0.004, -s, [KEEP]);
      for (const P of cutBy([[a, b, I(b, 0.35), I(a, 0.35)]], KEEP)) A.kerb.top(P, Y.plat + 0.004);
      if (L > 6) for (const P of cutBy([[I(a, 0.9), I(b, 0.9), I(b, 1.02), I(a, 1.02)]], KEEP)) A.mark.top(P, Y.plat + 0.008);
    }
  }

  // ---------- ponts : tablier, parapets de brique, arc jusqu'à l'eau ----------
  bridgeLines.forEach((br, bi) => {
    const c = resample(br.c, 2); if (c.length < 2 || c.some(([x, z]) => inKeep(x, z))) return;
    const Ltot = lenOf(c), hw = br.hw, Lp = offsetLine(c, -hw), Rp = offsetLine(c, hw), Li = offsetLine(c, -hw + 0.35), Ri = offsetLine(c, hw - 0.35);
    const yTop = br.deckY + 0.95, ycap = yTop + 0.06;
    const ybot = (s) => -1.75 + Math.min(1.05, 0.25 + Ltot * 0.03) * Math.sin(Math.PI * Math.min(1, Math.max(0, s / Ltot)));
    // un bord de tablier noyé dans une autre chaussée ou un autre pont (tabliers juxtaposés) n'a ni parapet ni tympan
    const free = (a, b) => { const x = (a[0] + b[0]) / 2, z = (a[1] + b[1]) / 2; return !ptIn(x, z, RD) && !ptIn(x, z, BZ, (C) => C.owner === 1000 + bi); };
    const fr = { R: [], L: [] };
    let s = 0;
    for (let i = 0; i < c.length - 1; i++) {
      const L = Math.hypot(c[i + 1][0] - c[i][0], c[i + 1][1] - c[i][1]), s1 = s + L, b0 = ybot(s), b1 = ybot(s1);
      const V = (p, y) => [p[0], y, p[1]];
      const fR = fr.R[i] = free(Rp[i], Rp[i + 1]), fL = fr.L[i] = free(Lp[i], Lp[i + 1]);
      // faces extérieures (tympans) : du chaperon jusqu'à l'intrados ; faces intérieures des parapets ; chaperons de pierre
      if (fR) {
        A.brick.quad(V(Rp[i], b0), V(Rp[i + 1], b1), V(Rp[i + 1], yTop), V(Rp[i], yTop), [s, b0, s1, b1, s1, yTop, s, yTop]);
        A.brick.quad(V(Ri[i + 1], br.deckY), V(Ri[i], br.deckY), V(Ri[i], yTop), V(Ri[i + 1], yTop), [s1, 0, s, 0, s, 1, s1, 1]);
        A.kerb.top([Rp[i], Rp[i + 1], Ri[i + 1], Ri[i]], ycap); wallCut(A.kerb, Rp[i], Rp[i + 1], yTop, ycap, 1, []); wallCut(A.kerb, Ri[i], Ri[i + 1], yTop, ycap, -1, []);
      }
      if (fL) {
        A.brick.quad(V(Lp[i + 1], b1), V(Lp[i], b0), V(Lp[i], yTop), V(Lp[i + 1], yTop), [s1, b1, s, b0, s, yTop, s1, yTop]);
        A.brick.quad(V(Li[i], br.deckY), V(Li[i + 1], br.deckY), V(Li[i + 1], yTop), V(Li[i], yTop), [s, 0, s1, 0, s1, 1, s, 1]);
        A.kerb.top([Lp[i], Lp[i + 1], Li[i + 1], Li[i]], ycap); wallCut(A.kerb, Lp[i], Lp[i + 1], yTop, ycap, -1, []); wallCut(A.kerb, Li[i], Li[i + 1], yTop, ycap, 1, []);
      }
      A.brick.quad(V(Lp[i], b0), V(Lp[i + 1], b1), V(Rp[i + 1], b1), V(Rp[i], b0), [-hw, s, -hw, s1, hw, s1, hw, s]);   // intrados
      s = s1;
    }
    // culées (fermeture sous les extrémités, arasées sous la chaussée) et bouts de parapets
    for (const [i, k] of [[0, 0], [c.length - 1, c.length - 2]]) {
      const by = ybot(i ? Ltot : 0);
      A.brick.quad([Lp[i][0], by, Lp[i][1]], [Rp[i][0], by, Rp[i][1]], [Rp[i][0], Y.road - 0.01, Rp[i][1]], [Lp[i][0], Y.road - 0.01, Lp[i][1]], [-hw, by, hw, by, hw, 0, -hw, 0]);
      for (const [o, n, f] of [[Rp, Ri, fr.R[k]], [Lp, Li, fr.L[k]]]) if (f) A.brick.quad([o[i][0], br.deckY, o[i][1]], [n[i][0], br.deckY, n[i][1]], [n[i][0], ycap, n[i][1]], [o[i][0], ycap, o[i][1]], [0, 0, 0.35, 0, 0.35, 1, 0, 1]);
    }
  });

  // ---------- marquages ----------
  const NOMARK = new Grid(16);
  const markQuad = (cx, cz, ux, uz, hl, hwid) => {   // rectangle centré, axe u, demi-longueur hl, demi-largeur hwid
    const nx = -uz, nz = ux;
    A.mark.top([[cx - ux * hl - nx * hwid, cz - uz * hl - nz * hwid], [cx + ux * hl - nx * hwid, cz + uz * hl - nz * hwid], [cx + ux * hl + nx * hwid, cz + uz * hl + nz * hwid], [cx - ux * hl + nx * hwid, cz - uz * hl + nz * hwid]], Y.mark);
  };
  const onRoad = (x, z) => ptIn(x, z, RD) && !ptIn(x, z, KEEP);
  const zebras = [];
  const addZebra = (x, z, dx, dz, pl) => {
    if (zebras.some((q) => Math.hypot(q[0] - x, q[1] - z) < 7)) return false;
    const hw = pl.hw, Lz = hw * 2 >= 6 ? 3 : 2.5, nx = -dz, nz = dx;
    zebras.push([x, z]);
    let n = 0;
    for (let o = -hw + 0.55; o <= hw - 0.45; o += 1.1) { const cx = x + nx * o, cz = z + nz * o; if (!onRoad(cx, cz) || inWater(cx, cz)) continue; markQuad(cx, cz, dx, dz, Lz / 2, 0.25); n++; }
    const e = Lz / 2 + 1, f = hw + 0.5;   // zone sans autre marquage
    NOMARK.add(mkClip([[x - dx * e - nx * f, z - dz * e - nz * f], [x + dx * e - nx * f, z + dz * e - nz * f], [x + dx * e + nx * f, z + dz * e + nz * f], [x - dx * e + nx * f, z - dz * e + nz * f]]));
    return n > 0;
  };
  // passages piétons : données OSM, sinon croisements trottoir/rue
  const crossPl = (pl) => pl.k !== 'track' && pl.w >= 4.5;
  let crossings = (data.crossings || []).filter((q) => q && q.length >= 2).map((q) => {
    const [x, z] = T([q[0], q[1]]); let d = null;
    if (q.length > 2 && q[2] != null) { const o = T([0, 0]), e = T([Math.cos(q[2]), Math.sin(q[2])]); d = [e[0] - o[0], e[1] - o[1]]; }
    return { x, z, d };
  }).filter((q) => Math.hypot(q.x, q.z) < radius);
  for (const q of crossings) { const ns = nearestSeg(q.x, q.z, 4, crossPl); if (ns) addZebra(ns.x, ns.z, ns.dx, ns.dz, ns.s.pl); }
  if (crossings.length < 8) for (const f of foot) {
    if (f.k === 'pedestrian') continue;
    for (let i = 0; i < f.c.length - 1; i++) {
      const a = f.c[i], b = f.c[i + 1];
      segG.each(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), (s) => {
        if (!crossPl(s.pl) || s.pl.k === 'service') return;
        const p = s.a, q = s.b, rx = b[0] - a[0], rz = b[1] - a[1], sx = q[0] - p[0], sz = q[1] - p[1], den = rx * sz - rz * sx;
        if (Math.abs(den) < 1e-6) return;
        const t = ((p[0] - a[0]) * sz - (p[1] - a[1]) * sx) / den, u = ((p[0] - a[0]) * rz - (p[1] - a[1]) * rx) / den;
        if (t < 0 || t > 1 || u < 0 || u > 1) return;
        const sl = Math.hypot(sx, sz), dx = sx / sl, dz = sz / sl, cs = Math.abs((rx * dx + rz * dz) / Math.hypot(rx, rz));
        if (cs > 0.6) return;   // le cheminement doit traverser, pas longer
        addZebra(p[0] + sx * u, p[1] + sz * u, dx, dz, s.pl);
      });
    }
  }
  // feux : données OSM, sinon carrefours d'au moins deux branches principales
  const sigNodes = new Set();
  const sigs = (data.signals || []).map((q) => T([q[0], q[1]])).filter(([x, z]) => Math.hypot(x, z) < radius);
  const midSignals = [];
  if (sigs.length >= 3) {
    for (const [x, z] of sigs) {
      let best = null, bd = 14; for (const nd of junctions) { const d = Math.hypot(nd.x - x, nd.z - z); if (d < bd) { bd = d; best = nd; } }
      if (best) sigNodes.add(best); else { const ns = nearestSeg(x, z, 5, (pl) => MAJOR.has(pl.k) || pl.k === 'residential'); if (ns) midSignals.push(ns); }
    }
  } else for (const nd of junctions) { if (nd.arms.filter((a) => MAJOR.has(a.pl.k)).length >= 2 && !inKeep(nd.x, nd.z)) sigNodes.add(nd); }
  const lights = [];   // [x, z, yaw, rouge?]
  const stopLine = (x, z, dx, dz, pl, inbound) => {   // ligne d'arrêt (50 cm) sur les voies entrantes ; d = sens de la branche (s'éloignant du carrefour)
    const hw = pl.hw, nx = -dz, nz = dx;
    let o0, o1; if (pl.oneway) { if (!inbound) return false; o0 = -hw + 0.3; o1 = hw - 0.3; } else { o0 = -hw + 0.3; o1 = -0.2; }
    const om = (o0 + o1) / 2, cx = x + nx * om, cz = z + nz * om;
    if (!onRoad(cx, cz) || ptIn(cx, cz, RD, (C) => C.owner === pl.id)) return false;   // pas dans le carrefour lui-même
    A.mark.top([[cx - dx * 0.25 + nx * (o0 - om), cz - dz * 0.25 + nz * (o0 - om)], [cx + dx * 0.25 + nx * (o0 - om), cz + dz * 0.25 + nz * (o0 - om)], [cx + dx * 0.25 + nx * (o1 - om), cz + dz * 0.25 + nz * (o1 - om)], [cx - dx * 0.25 + nx * (o1 - om), cz - dz * 0.25 + nz * (o1 - om)]], Y.mark);
    NOMARK.add(mkClip([[x - dx * 1.5 - nx * hw, z - dz * 1.5 - nz * hw], [x + dx * 1.5 - nx * hw, z + dz * 1.5 - nz * hw], [x + dx * 1.5 + nx * hw, z + dz * 1.5 + nz * hw], [x - dx * 1.5 + nx * hw, z - dz * 1.5 + nz * hw]]));
    return true;
  };
  let sigAxis = 0;
  for (const nd of sigNodes) {
    sigAxis++;
    const a0 = nd.arms[0].a;
    for (const arm of nd.arms) {
      const pl = arm.pl; if (pl.k === 'service' || pl.k === 'track') continue;
      // branche vue depuis le carrefour : on recule jusqu'à sortir des autres chaussées
      const c = arm.fwd ? pl.c.slice(arm.i) : pl.c.slice(0, arm.i + 1).reverse();
      const Lz = pl.hw * 2 >= 6 ? 3 : 2.5, clear = (s) => { const [x, z, dx, dz] = along(c, s), nx = -dz, nz = dx; for (const o of [-pl.hw + 0.3, 0, pl.hw - 0.3]) for (const e of [-Lz / 2 - 0.3, Lz / 2 + 0.3]) if (ptIn(x + dx * e + nx * o, z + dz * e + nz * o, RD, (C) => C.owner === pl.id)) return false; return true; };
      const Lc = lenOf(c); let s = 1; while (s < Math.min(25, Lc - 4) && !clear(s)) s += 0.5;
      if (s >= Lc - 4) continue;
      const [zx, zz, zdx, zdz] = along(c, s); addZebra(zx, zz, zdx, zdz, pl);
      const ss = s + Lz / 2 + 1.3, [sx, sz, sdx, sdz] = along(c, ss), inbound = !arm.fwd;
      if (stopLine(sx, sz, sdx, sdz, pl, inbound)) {
        const nx = -sdz, nz = sdx, o = -(pl.hw + 0.55), [px, pz] = [sx + sdx * 0.6 + nx * o, sz + sdz * 0.6 + nz * o];
        if (!ptIn(px, pz, RD) && !inKeep(px, pz)) { const axis = Math.abs(Math.sin(arm.a - a0)) > 0.7; lights.push([px, pz, Math.atan2(sdx, sdz), axis !== (sigAxis % 2 === 0)]); }
      }
    }
  }
  for (const ns of midSignals) {
    const pl = ns.s.pl; for (const sg of [1, -1]) { const dx = ns.dx * sg, dz = ns.dz * sg, x = ns.x + dx * 3, z = ns.z + dz * 3; if (stopLine(x, z, dx, dz, pl, sg < 0)) { const nx = -dz, nz = dx, o = -(pl.hw + 0.55); lights.push([x + nx * o, z + nz * o, Math.atan2(dx, dz), sg > 0]); } }
  }
  // lignes : axe T1 (3 m / 10 m), séparation de voies, axe continu au-delà de 4 voies, rives continues sur les grands axes
  const markOK = (x, z, pl) => onRoad(x, z) && !ptIn(x, z, RD, (C) => C.owner === pl.id) && !ptIn(x, z, NOMARK);
  for (const pl of PL) {
    const K = KIND[pl.k]; if (!K.mark || pl.w < 5) continue;
    const lanes = pl.lanes > 0 ? pl.lanes : Math.max(1, Math.round(pl.w / 3.2));
    const lines = [];
    for (let k = 1; k < lanes; k++) {
      const o = -pl.hw + k * pl.w / lanes, centre = !pl.oneway && k * 2 === lanes;
      lines.push({ o: centre ? 0 : o, solid: centre && lanes >= 4, dash: 3, gap: 10, w: 0.12 });
    }
    if (!pl.oneway && lanes % 2 === 1 && lanes > 1) { lines.length = 0; lines.push({ o: 0, solid: false, dash: 3, gap: 10, w: 0.12 }); }
    if (!pl.oneway && lanes === 1 && pl.w >= 5.5) lines.push({ o: 0, solid: false, dash: 3, gap: 10, w: 0.12 });
    if (/primary|trunk|secondary|motorway/.test(pl.k)) for (const sg of [-1, 1]) lines.push({ o: sg * (pl.hw - 0.3), solid: true, w: 0.12 });
    const c = pl.c; let s = 0; const ph = rnd() * 13;
    for (let i = 0; i < c.length - 1; i++) {
      const a = c[i], b = c[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.2) { s += L; continue; }
      const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L, nx = -uz, nz = ux;
      for (const ln of lines) {
        const pieces = [];
        if (ln.solid) { const n = Math.max(1, Math.ceil(L / 3)); for (let k = 0; k < n; k++) pieces.push([k * L / n, (k + 1) * L / n]); }
        else { const P = ln.dash + ln.gap; for (let d0 = Math.floor((s + ph) / P) * P - ph; d0 < s + L; d0 += P) { const u0 = Math.max(0, d0 - s), u1 = Math.min(L, d0 + ln.dash - s); if (u1 - u0 > 0.3) pieces.push([u0, u1]); } }
        for (const [u0, u1] of pieces) {
          const um = (u0 + u1) / 2, cx = a[0] + ux * um + nx * ln.o, cz = a[1] + uz * um + nz * ln.o;
          if (!markOK(cx, cz, pl) || !markOK(cx - ux * (um - u0), cz - uz * (um - u0), pl) || !markOK(cx + ux * (u1 - um), cz + uz * (u1 - um), pl)) continue;
          markQuad(cx, cz, ux, uz, (u1 - u0) / 2, ln.w / 2);
        }
      }
      s += L;
    }
  }
  // places de parking : rangées de 5 m tous les 2,5 m, allées de 6,5 m, orientées sur le plus long côté
  for (const q of parkRings) {
    let best = 0, ux = 1, uz = 0;
    for (let i = 0; i < q.length; i++) { const a = q[i], b = q[(i + 1) % q.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L > best) { best = L; ux = (b[0] - a[0]) / L; uz = (b[1] - a[1]) / L; } }
    const nx = -uz, nz = ux; let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    for (const [x, z] of q) { const u = x * ux + z * uz, v = x * nx + z * nz; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    if ((u1 - u0) * (v1 - v0) > 40000) continue;
    for (let vb = v0 + 0.4; vb + 5 <= v1; vb += 16.5) for (const vr of [vb, vb + 11.5]) {
      if (vr + 5 > v1) continue;
      for (let u = u0 + 1; u <= u1 - 1; u += 2.5) {
        const p = (uu, vv) => [ux * uu + nx * vv, uz * uu + nz * vv], A0 = p(u, vr + 0.2), A1 = p(u, vr + 4.8), m = p(u, vr + 2.5);
        if (!inPoly(A0[0], A0[1], q) || !inPoly(A1[0], A1[1], q) || inKeep(m[0], m[1])) continue;
        if (ptIn(m[0], m[1], RD, (C) => C.owner >= -2) || ptIn(A0[0], A0[1], RD, (C) => C.owner >= -2) || ptIn(A1[0], A1[1], RD, (C) => C.owner >= -2)) continue;
        markQuad(m[0], m[1], nx, nz, 2.3, 0.06);
      }
    }
  }

  // ---------- mobilier instancié ----------
  const furn = new THREE.Group(); furn.name = 'mobilier'; group.add(furn);
  const merge = (parts) => {   // fusion de géométries (non indexées) déjà placées
    const P = [], N = [], U = [];
    for (const g0 of parts) { const g = g0.index ? g0.toNonIndexed() : g0; P.push(...g.attributes.position.array); N.push(...g.attributes.normal.array); U.push(...(g.attributes.uv ? g.attributes.uv.array : new Float32Array(g.attributes.position.count * 2))); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); return g;
  };
  const at = (g, x, y, z, rx = 0) => { if (rx) g.rotateX(rx); g.translate(x, y, z); return g; };
  const metal = std({ name: 'rues:metal', color: 0x44484c, metalness: 0.55, roughness: 0.45 });
  const black = std({ name: 'rues:fonte', color: 0x1e2022, metalness: 0.4, roughness: 0.5 });
  const lampOn = std({ name: 'rues:lanterne', color: 0xf3efe6, emissive: 0xffd2a0, emissiveIntensity: 0, roughness: 0.3 });
  const inst = (geo, mat, list, cast = true) => {
    if (!list.length) return null;
    const m = new THREE.InstancedMesh(geo, mat, list.length), o = new THREE.Object3D();
    list.forEach(([x, z, yaw, sc = 1], i) => { o.position.set(x, 0, z); o.rotation.set(0, yaw || 0, 0); o.scale.set(sc, sc, sc); o.updateMatrix(); m.setMatrixAt(i, o.matrix); });
    m.instanceMatrix.needsUpdate = true; m.castShadow = cast; m.receiveShadow = false; m.name = mat.name; m.computeBoundingSphere(); furn.add(m); return m;
  };
  // lampadaires : grands mâts le long des axes (crosse vers la chaussée), lanternes de style sur les quais du canal
  const LAMPS = new Grid(16), tall = [], lantern = [];
  const freeAt = (x, z, d) => !LAMPS.each(x - d, z - d, x + d, z + d, (o) => Math.hypot(o.x - x, o.z - z) < d);
  const putLamp = (list, x, z, yaw, d) => {
    if (Math.hypot(x, z) > radius || inKeep(x, z) || inWater(x, z) || ptIn(x, z, RD) || !freeAt(x, z, d)) return false;
    LAMPS.add({ x0: x, z0: z, x1: x, z1: z, x, z }); list.push([x, z, yaw]); return true;
  };
  for (const [x0, z0] of (data.lamps || [])) { const [x, z] = T([x0, z0]); const ns = nearestSeg(x, z, 15); putLamp(tall, x, z, ns ? Math.atan2(ns.x - x, ns.z - z) : 0, 6); }
  for (const pl of PL) {
    if (!KIND[pl.k].lamp || pl.len < 12) continue;
    const both = pl.w >= 9 || (!pl.oneway && pl.w >= 6.4 && MAJOR.has(pl.k)), step = 28, ph = rnd() * step;
    for (const [sg, sh] of both ? [[1, 0], [-1, step / 2]] : [[1, 0]]) {
      const wv = sg > 0 ? pl.wr : pl.wl; if (wv < 1) continue;
      for (let s = ph + sh; s < pl.len; s += step) {
        const [x, z, dx, dz] = along(pl.c, s), nx = -dz * sg, nz = dx * sg, o = pl.hw + 0.65;
        putLamp(tall, x + nx * o, z + nz * o, Math.atan2(-nx, -nz), 10);
      }
    }
  }
  for (const q of waterRings) {   // quais : lanterne à 1,3 m du bord, tous les 24 m
    const s = area2(q) > 0 ? 1 : -1; let acc = 0;
    for (let i = 0; i < q.length; i++) {
      const a = q[i], b = q[(i + 1) % q.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.01) continue;
      const ox = s * (b[1] - a[1]) / L, oz = -s * (b[0] - a[0]) / L;   // vers l'extérieur de l'eau
      for (let t = (24 - acc) % 24; t < L; t += 24) { const x = a[0] + (b[0] - a[0]) * t / L + ox * 1.3, z = a[1] + (b[1] - a[1]) * t / L + oz * 1.3; putLamp(lantern, x, z, Math.atan2(-ox, -oz), 9); }
      acc = (acc + L) % 24;
    }
  }
  const tallBody = merge([at(new THREE.CylinderGeometry(0.065, 0.11, 9, 8), 0, 4.5, 0), at(new THREE.CylinderGeometry(0.16, 0.18, 0.8, 8), 0, 0.4, 0), at(new THREE.BoxGeometry(0.07, 0.07, 1.5), 0, 8.95, 0.72), at(new THREE.BoxGeometry(0.42, 0.12, 0.8), 0, 8.95, 1.7)]);
  const tallHead = at(new THREE.BoxGeometry(0.34, 0.03, 0.66), 0, 8.875, 1.7);
  const lanBody = merge([at(new THREE.CylinderGeometry(0.05, 0.08, 3.6, 8), 0, 1.8, 0), at(new THREE.CylinderGeometry(0.14, 0.17, 0.7, 8), 0, 0.35, 0), at(new THREE.ConeGeometry(0.3, 0.28, 6), 0, 4.3, 0), at(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 6), 0, 4.53, 0)]);
  const lanHead = at(new THREE.CylinderGeometry(0.22, 0.13, 0.55, 6), 0, 3.9, 0);
  inst(tallBody, metal, tall); inst(tallHead, lampOn, tall, false);
  inst(lanBody, black, lantern); inst(lanHead, lampOn, lantern, false);
  // flaques de lumière au sol la nuit (additives, sans écriture de profondeur)
  const poolTex = canvasTex(128, 128, (g, w, h) => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.55)'); gr.addColorStop(0.7, 'rgba(255,255,255,.14)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, 1);
  poolTex.repeat.set(1, 1); poolTex.wrapS = poolTex.wrapT = THREE.ClampToEdgeWrapping;
  const poolMat = new THREE.MeshBasicMaterial({ name: 'rues:halo', map: poolTex, color: 0xffc58a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -10, polygonOffsetUnits: -40, toneMapped: true });
  const pools = [...tall.map(([x, z, yaw]) => [x + Math.sin(yaw) * 1.7, z + Math.cos(yaw) * 1.7, 0, 15]), ...lantern.map(([x, z]) => [x, z, 0, 8])];
  const poolGeo = new THREE.PlaneGeometry(1, 1); poolGeo.rotateX(-Math.PI / 2); poolGeo.translate(0, Y.walk + 0.03, 0);
  const poolMesh = inst(poolGeo, poolMat, pools, false); if (poolMesh) { poolMesh.visible = false; poolMesh.renderOrder = 2; }
  // feux tricolores : mât, caisson, trois optiques (couleur par instance)
  const sigBody = merge([at(new THREE.CylinderGeometry(0.055, 0.06, 3.1, 8), 0, 1.55, 0), at(new THREE.BoxGeometry(0.3, 0.92, 0.2), 0, 2.85, 0.08), at(new THREE.BoxGeometry(0.5, 1.1, 0.02), 0, 2.85, -0.03)]);
  inst(sigBody, black, lights);
  const sigLamp = new THREE.CircleGeometry(0.085, 10); sigLamp.translate(0, 0, 0.185);
  const sigList = [], sigCol = [];
  for (const [x, z, yaw, red] of lights) [3.13, 2.85, 2.57].forEach((y, k) => {
    const lit = red ? k === 0 : k === 2; sigList.push([x, z, yaw, y]);
    sigCol.push(lit ? (k === 0 ? [1, 0.08, 0.04] : [0.15, 1, 0.45]) : [0.07, 0.065, 0.06]);
  });
  const sigMat = new THREE.MeshBasicMaterial({ name: 'rues:feux', color: 0xffffff });
  if (sigList.length) {
    const m = new THREE.InstancedMesh(sigLamp, sigMat, sigList.length), o = new THREE.Object3D(), col = new THREE.Color();
    sigList.forEach(([x, z, yaw, y], i) => { o.position.set(x, y, z); o.rotation.set(0, yaw, 0); o.updateMatrix(); m.setMatrixAt(i, o.matrix); m.setColorAt(i, col.setRGB(...sigCol[i])); });
    m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; m.name = 'rues:feux'; m.computeBoundingSphere(); furn.add(m);
  }
  // potelets au bord des places piétonnes, face aux chaussées
  const bol = [];
  for (const q of pedRings) {
    const s = area2(q) > 0 ? 1 : -1;
    for (let i = 0; i < q.length && bol.length < 2500; i++) {
      const a = q[i], b = q[(i + 1) % q.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1) continue;
      const ix = -s * (b[1] - a[1]) / L, iz = s * (b[0] - a[0]) / L;   // vers l'intérieur
      for (let t = 0.9; t < L - 0.5; t += 1.8) {
        const x = a[0] + (b[0] - a[0]) * t / L, z = a[1] + (b[1] - a[1]) * t / L;
        if (!ptIn(x - ix * 0.9, z - iz * 0.9, RD) || ptIn(x + ix * 0.45, z + iz * 0.45, RD) || inKeep(x, z)) continue;
        bol.push([x + ix * 0.45, z + iz * 0.45, 0]);
      }
    }
  }
  inst(merge([at(new THREE.CylinderGeometry(0.06, 0.07, 0.95, 8), 0, Y.paver + 0.475, 0), at(new THREE.SphereGeometry(0.065, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0, Y.paver + 0.95, 0)]), black, bol, false);

  // ---------- maillages ----------
  const ground = { cast: false, recv: true };
  A.gravel.mesh(MAT.gravel, ground); A.asph.mesh(MAT.asph, ground); A.mark.mesh(MAT.mark, ground); A.walk.mesh(MAT.walk, ground);
  A.kerb.mesh(MAT.kerb, ground); A.paver.mesh(MAT.paver, ground);
  A.ballast.mesh(MAT.ballast, ground); A.sleeper.mesh(MAT.sleeper, ground); A.rail.mesh(MAT.rail, ground); A.brick.mesh(MAT.brick, { cast: true, recv: true });

  let tris = 0, calls = 0;
  group.traverse((o) => { if (o.isMesh) { calls++; const g = o.geometry, n = (g.index ? g.index.count : g.attributes.position.count) / 3; tris += o.isInstancedMesh ? n * o.count : n; } });
  const ms = performance.now() - t0;
  group.userData.stats = { ms: Math.round(ms), calls, tris: Math.round(tris), roads: PL.length, junctions: junctions.length, zebras: zebras.length, signals: lights.length, lamps: tall.length + lantern.length, bollards: bol.length };
  console.log('[t] rues', JSON.stringify(group.userData.stats));
  group.userData.onLight = (dusk, night) => {
    const k = Math.min(1, night + Math.max(0, dusk - 0.35) * 0.9);
    lampOn.emissiveIntensity = k * 5; lampOn.color.setScalar(k > 0.05 ? 1 : 0.9);
    poolMat.opacity = 0.42 * k; if (poolMesh) poolMesh.visible = k > 0.03;
    sigMat.color.setScalar(1 + 2.5 * k);
  };
  return group;
}
