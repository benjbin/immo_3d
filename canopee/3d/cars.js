/**
 * Canopée — voitures procédurales réalistes (Three.js 0.160)
 *
 *   export function createCar(THREE, { model = 'berline'|'suv'|'citadine', color = 0x3a3e43, seed = 1 }) → THREE.Group
 *   export function disposeCars()
 *
 * Repère : origine au sol au centre de la voiture, avant vers +Z, Y vers le haut, mètres.
 * La conduite est à gauche (France) : le côté gauche du véhicule est vers +X.
 *
 * Carrosserie : une seule surface « lissée » (loft) construite à partir de profils —
 *  - silhouette latérale (spline monotone : bouclier, capot, pare-brise, pavillon, lunette, coffre),
 *  - section transversale par station (bas de caisse, flanc galbé, épaule, ceinture de caisse,
 *    vitrage avec rentrée « tumblehome », pavillon bombé), interpolée en Catmull-Rom centripète,
 *  - vue en plan aux angles arrondis, faces avant/arrière en congé + déformations (balayage, galbe),
 *  - passages de roue découpés dans le flanc (bord suivant l'arc), ourlés, avec pare-boue noirs.
 * Les détails (optiques, calandre, plaques, joints d'ouvrants, poignées) sont des décalques
 * projetés sur la carrosserie par lancer de rayons, décalés de quelques millimètres.
 * Géométries mises en cache par modèle/style, matériaux partagés entre toutes les voitures.
 */
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

let T = null;                      // module THREE fourni par l'appelant
const GEO = new Map();             // clé modèle|style → { parts: [[matKey, geometry]], tris, dims }
const MATS = new Map();            // matériaux partagés
const TEXS = [];

// ------------------------------------------------------------------ modèles (cotes réelles, m)
const MODELS = {
  // berline familiale (proportions type Série 3 G20) : 4,70 × 1,85 × 1,45
  berline: {
    L: 4.71, W: 1.85, H: 1.45, fo: 0.80, wb: 2.85, track: 1.59,
    tire: { R: 0.333, w: 0.225, rim: 0.2286 },
    top: [[-2.36, 0.96], [-2.27, 1.045], [-2.10, 1.056], [-1.85, 1.076], [-1.60, 1.118], [-1.35, 1.238], [-1.00, 1.376], [-0.65, 1.432], [-0.30, 1.448], [0.00, 1.408],
      [0.25, 1.292], [0.55, 1.122], [0.80, 0.988], [1.10, 0.958], [1.60, 0.908], [2.00, 0.845], [2.25, 0.78], [2.36, 0.72]],
    under: [[-2.36, 0.34], [-2.15, 0.25], [-1.7, 0.16], [1.7, 0.15], [2.05, 0.2], [2.36, 0.27]],
    belt: [[-2.2, 1.07], [-1.5, 1.056], [-0.3, 1.012], [0.75, 0.976], [1.3, 0.962]],
    sill: 0.31, flare: 0.012, tumble: 0.52, crown: 0.04, hoodCrown: 0.035, shoulder: 0.1,
    capF: { x: 0.09, t: 0.10, b: 0.05, z: 0.12 }, capR: { x: 0.07, t: 0.05, b: 0.05, z: 0.07 },
    cF: 0.45, cR: 0.32, sweepF: 0.07, sweepR: 0.05, noseY: 0.36, kFt: 0.065, kFb: 0.02, tailY: 0.8, kRt: 0.012, kRb: 0.03,
    cowl: 0.80, wsTop: 0.0, rwTop: -1.0, rwBot: -1.62, dlo: [-1.48, 0.74], B: [-0.36, -0.28],
    head: { oz: 0.95, tA: 0.13, tB: 0.92, yA: [0.57, 0.695], yB: [0.655, 0.71] },
    tail: { oz: 0.9, tMax: 1.08, tC: 0.6, yC: [0.925, 0.952], yE: [0.885, 0.975] },
    grilleU: { x: 0.32, y: [0.56, 0.665] }, grilleL: { xT: 0.46, xB: 0.40, y: [0.28, 0.46] },
    plateF: 0.40, plateR: 0.72, handleY: 0.86, exhaust: true, chromeBelt: true, trunk: true,
    seams: [
      [[1.10, 0.34], [1.08, 0.74], [0.96, 0.90], [0.74, 0.972]],
      [[-0.32, 0.34], [-0.32, 1.0]],
      [[-1.50, 1.052], [-1.30, 0.93], [-1.0, 0.66]],
      [[1.10, 0.345], [-0.93, 0.345]],
    ],
  },
  // SUV compact (proportions type 3008 / Tiguan) : 4,50 × 1,85 × 1,65
  suv: {
    L: 4.50, W: 1.85, H: 1.65, fo: 0.90, wb: 2.68, track: 1.60,
    tire: { R: 0.368, w: 0.235, rim: 0.2413 },
    top: [[-2.26, 1.10], [-2.20, 1.20], [-2.14, 1.36], [-2.05, 1.52], [-1.90, 1.592], [-1.70, 1.618], [-0.80, 1.65], [-0.20, 1.645], [0.10, 1.60], [0.40, 1.43],
      [0.70, 1.25], [0.88, 1.178], [1.20, 1.152], [1.70, 1.118], [2.05, 1.062], [2.26, 0.99]],
    under: [[-2.26, 0.42], [-1.95, 0.28], [-1.5, 0.20], [1.5, 0.20], [1.95, 0.28], [2.26, 0.38]],
    belt: [[-2.15, 1.18], [-1.8, 1.17], [0.7, 1.106], [1.3, 1.09]],
    sill: 0.42, flare: 0.022, tumble: 0.44, crown: 0.03, hoodCrown: 0.035, shoulder: 0.1,
    capF: { x: 0.09, t: 0.10, b: 0.06, z: 0.12 }, capR: { x: 0.07, t: 0.05, b: 0.06, z: 0.07 },
    cF: 0.45, cR: 0.30, sweepF: 0.07, sweepR: 0.04, noseY: 0.48, kFt: 0.07, kFb: 0.02, tailY: 0.95, kRt: 0.01, kRb: 0.03,
    cowl: 0.88, wsTop: 0.10, rwTop: -1.90, rwBot: -2.16, dlo: [-1.88, 0.82], B: [-0.47, -0.38], C: [-1.38, -1.46],
    head: { oz: 0.95, tA: 0.17, tB: 0.92, yA: [0.78, 0.905], yB: [0.865, 0.925] },
    tail: { oz: 0.9, tMax: 1.05, tC: 0.6, yC: [1.065, 1.095], yE: [1.03, 1.13] },
    grilleU: { x: 0.42, y: [0.62, 0.84] }, grilleL: { xT: 0.38, xB: 0.30, y: [0.40, 0.53] },
    plateF: 0.53, plateR: 0.80, handleY: 1.0, cladding: true, roofRails: true,
    seams: [
      [[0.88, 0.45], [0.87, 0.88], [0.84, 1.04], [0.80, 1.10]],
      [[-0.425, 0.45], [-0.425, 1.14]],
      [[-1.42, 1.165], [-1.30, 0.95], [-0.96, 0.68]],
      [[0.88, 0.455], [-0.92, 0.455]],
    ],
  },
  // citadine 5 portes (proportions type 208 / Clio) : 4,05 × 1,78 × 1,45
  citadine: {
    L: 4.05, W: 1.78, H: 1.45, fo: 0.83, wb: 2.54, track: 1.53,
    tire: { R: 0.310, w: 0.205, rim: 0.2159 },
    top: [[-2.035, 0.86], [-1.95, 0.93], [-1.80, 1.0], [-1.62, 1.062], [-1.48, 1.222], [-1.32, 1.386], [-1.00, 1.424], [-0.37, 1.45], [-0.02, 1.408], [0.25, 1.275],
      [0.50, 1.122], [0.73, 1.0], [1.00, 0.962], [1.40, 0.912], [1.75, 0.848], [1.92, 0.792], [2.035, 0.74]],
    under: [[-2.035, 0.33], [-1.80, 0.22], [-1.4, 0.14], [1.3, 0.14], [1.7, 0.19], [2.035, 0.25]],
    belt: [[-1.7, 1.05], [-1.2, 1.035], [0.6, 0.955], [1.1, 0.94]],
    sill: 0.30, flare: 0.014, tumble: 0.52, crown: 0.035, hoodCrown: 0.035, shoulder: 0.1,
    capF: { x: 0.09, t: 0.10, b: 0.05, z: 0.12 }, capR: { x: 0.07, t: 0.06, b: 0.05, z: 0.07 },
    cF: 0.42, cR: 0.30, sweepF: 0.065, sweepR: 0.04, noseY: 0.34, kFt: 0.065, kFb: 0.02, tailY: 0.75, kRt: 0.015, kRb: 0.03,
    cowl: 0.73, wsTop: -0.02, rwTop: -1.30, rwBot: -1.62, dlo: [-1.22, 0.68], B: [-0.30, -0.23],
    head: { oz: 0.9, tA: 0.15, tB: 0.92, yA: [0.565, 0.685], yB: [0.65, 0.70] },
    tail: { oz: 0.8, tMax: 1.0, tC: 0.62, yC: [0.90, 0.93], yE: [0.86, 0.965] },
    grilleU: { x: 0.30, y: [0.54, 0.60] }, grilleL: { xT: 0.44, xB: 0.36, y: [0.27, 0.46] },
    plateF: 0.40, plateR: 0.60, handleY: 0.84,
    seams: [
      [[0.78, 0.33], [0.77, 0.72], [0.72, 0.88], [0.68, 0.955]],
      [[-0.265, 0.33], [-0.265, 0.99]],
      [[-1.25, 1.035], [-1.12, 0.92], [-1.02, 0.66]],
      [[0.78, 0.335], [-0.95, 0.335]],
    ],
  },
};
export const CAR_MODELS = Object.keys(MODELS);

// ------------------------------------------------------------------ outils
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// interpolation cubique monotone (Fritsch–Carlson) : pas de dépassement entre les points du profil
function mono(pts) {
  const n = pts.length, xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}
// Catmull-Rom centripète entre p1 et p2
function crc(p0, p1, p2, p3, t) {
  const D = (a, b) => Math.max(1e-4, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
  const d01 = D(p0, p1), d12 = D(p1, p2), d23 = D(p2, p3);
  const out = [0, 0];
  for (let k = 0; k < 2; k++) {
    const m1 = ((p1[k] - p0[k]) / d01 - (p2[k] - p0[k]) / (d01 + d12) + (p2[k] - p1[k]) / d12) * d12;
    const m2 = ((p2[k] - p1[k]) / d12 - (p3[k] - p1[k]) / (d12 + d23) + (p3[k] - p2[k]) / d23) * d12;
    const t2 = t * t, t3 = t2 * t;
    out[k] = (2 * t3 - 3 * t2 + 1) * p1[k] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[k] + (t3 - t2) * m2;
  }
  return out;
}

// géométrie non indexée {position, normal, uv} à partir de tableaux
function geoFrom(pos, nor, uv) {
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv || new Array(pos.length / 3 * 2).fill(0), 2));
  return g;
}
// normalise une géométrie three.js : non indexée, position/normal/uv seulement
function norm(g) {
  if (g.index) g = g.toNonIndexed();
  for (const n of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(n)) g.deleteAttribute(n);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new T.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  g.clearGroups();
  return g;
}
// symétrie x → -x (inverse l'ordre des sommets pour garder les faces vers l'extérieur)
function mirrorX(g) {
  g = g.clone();
  const p = g.attributes.position.array, n = g.attributes.normal.array, uv = g.attributes.uv.array;
  for (let i = 0; i < p.length; i += 3) { p[i] = -p[i]; n[i] = -n[i]; }
  for (let t = 0; t < p.length / 9; t++) {
    for (let k = 0; k < 3; k++) { const a = t * 9 + 3 + k, b = t * 9 + 6 + k; [p[a], p[b]] = [p[b], p[a]]; [n[a], n[b]] = [n[b], n[a]]; }
    const a = t * 6 + 2, b = t * 6 + 4; [uv[a], uv[b]] = [uv[b], uv[a]]; [uv[a + 1], uv[b + 1]] = [uv[b + 1], uv[a + 1]];
  }
  return g;
}

// ------------------------------------------------------------------ textures
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function texFrom(cv, srgb = true, rep = false) {
  const t = new T.CanvasTexture(cv);
  if (srgb) t.colorSpace = T.SRGBColorSpace;
  if (rep) t.wrapS = t.wrapT = T.RepeatWrapping;
  t.anisotropy = 8; TEXS.push(t); return t;
}
// grille alvéolée (calandre) : cellule de 2,5 cm
function grilleTexture() {
  const S = 128, cv = canvas(S, S), g = cv.getContext('2d');
  g.fillStyle = '#2a2c30'; g.fillRect(0, 0, S, S);
  g.fillStyle = '#030304';
  const hex = (cx, cy, r) => { g.beginPath(); for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3; g.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a)); } g.closePath(); g.fill(); };
  const r = S / 4.3;
  for (let j = -1; j < 4; j++) for (let i = -1; i < 4; i++) hex(i * S / 2 + (j & 1 ? S / 4 : 0), j * S / 2 * 0.866 * 1.155, r);
  const t = texFrom(cv, true, true); t.repeat.set(1 / 0.03, 1 / 0.03); return t;
}
// grain du plastique noir
function grainTexture() {
  const S = 128, cv = canvas(S, S), g = cv.getContext('2d'), r = mulberry(9);
  const im = g.createImageData(S, S);
  for (let i = 0; i < S * S; i++) { const v = 200 + r() * 55; im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255; }
  g.putImageData(im, 0, 0);
  const t = texFrom(cv, false, true); return t;
}
// plaque d'immatriculation française (fictive)
function plateTexture(text) {
  const W = 512, H = 110, cv = canvas(W, H), g = cv.getContext('2d');
  g.fillStyle = '#f4f4f1'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#123a9c'; g.fillRect(0, 0, 44, H); g.fillRect(W - 44, 0, 44, H);
  g.strokeStyle = '#ffd800'; g.lineWidth = 2;
  for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6; g.beginPath(); g.arc(22 + 12 * Math.cos(a), 30 + 12 * Math.sin(a), 1.6, 0, 7); g.stroke(); }
  g.fillStyle = '#ffffff'; g.font = 'bold 30px Arial, sans-serif'; g.textAlign = 'center'; g.fillText('F', 22, 92);
  g.fillStyle = '#f4f4f1'; g.beginPath(); g.arc(W - 22, 40, 13, 0, 7); g.fill();
  g.font = '20px Arial'; g.fillText('75', W - 22, 92);
  g.fillStyle = '#111'; g.font = 'bold 74px "Arial Narrow", Arial, sans-serif'; g.textBaseline = 'middle';
  g.fillText(text, W / 2, H / 2 + 3, W - 110);
  g.strokeStyle = '#222'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, W - 3, H - 3);
  return texFrom(cv);
}
// ombre de contact (quad flou, assombri sous les roues)
function shadowTexture(C) {
  const w = 96, h = Math.round(96 * (C.L + 0.7) / (C.W + 0.6)), cv = canvas(w, h), g = cv.getContext('2d');
  const sx = w / (C.W + 0.6), sz = h / (C.L + 0.7), cx = w / 2, cz = h / 2;
  g.filter = `blur(${Math.round(0.16 * sx)}px)`;
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.beginPath(); g.roundRect(cx - (C.W / 2 - 0.04) * sx, cz - (C.L / 2 - 0.12) * sz, (C.W - 0.08) * sx, (C.L - 0.24) * sz, 0.3 * sx); g.fill();
  g.filter = `blur(${Math.round(0.06 * sx)}px)`;
  g.fillStyle = 'rgba(0,0,0,0.9)';
  const zA = C.L / 2 - C.fo;
  for (const z of [zA, zA - C.wb]) for (const s of [-1, 1]) { g.beginPath(); g.ellipse(cx + s * C.track / 2 * sx, cz - z * sz, C.tire.w * 0.5 * sx, C.tire.R * 0.55 * sz, 0, 0, 7); g.fill(); }
  const t = texFrom(cv); return t;
}

// ------------------------------------------------------------------ matériaux partagés
function mats() {
  if (MATS.size) return MATS;
  const S = (k, p) => { const m = new T.MeshStandardMaterial(p); m.name = 'car:' + k; MATS.set(k, m); return m; };
  const P = (k, p) => { const m = new T.MeshPhysicalMaterial(p); m.name = 'car:' + k; MATS.set(k, m); return m; };
  const grain = grainTexture();
  P('glass', { color: 0x070a0c, metalness: 0, roughness: 0.03, transparent: true, opacity: 0.93, envMapIntensity: 1.0, ior: 1.52 });
  S('trim', { color: 0x08090a, metalness: 0.1, roughness: 0.18 });
  S('plastic', { color: 0x1b1c1e, roughness: 0.78, metalness: 0, map: grain });
  S('chrome', { color: 0xe6e9ec, metalness: 1, roughness: 0.07 });
  S('rubber', { color: 0x1c1d1f, roughness: 0.9, metalness: 0 });
  S('disc', { color: 0x77797b, metalness: 0.85, roughness: 0.42 });
  P('lampF', { color: 0x2b2f34, metalness: 1, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.03 });
  S('drl', { color: 0xffffff, emissive: 0xeef3ff, emissiveIntensity: 1.1, roughness: 0.3 });
  P('tail', { color: 0x3a0306, emissive: 0x7a0a12, emissiveIntensity: 0.35, metalness: 0.3, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.03 });
  S('tailLed', { color: 0xff3a3a, emissive: 0xff1822, emissiveIntensity: 0.9, roughness: 0.3 });
  S('grille', { color: 0xffffff, map: grilleTexture(), roughness: 0.32, metalness: 0.1 });
  S('gap', { color: 0x050506, roughness: 0.7, metalness: 0 });
  // jantes : alu brossé, graphite ; étriers
  S('rim_alu', { color: 0xc9cdd1, metalness: 1, roughness: 0.26 });
  S('rim_graphite', { color: 0x3d4045, metalness: 0.9, roughness: 0.3 });
  S('caliper_red', { color: 0xa3161c, roughness: 0.38, metalness: 0.1 });
  S('caliper_grey', { color: 0x4d5054, roughness: 0.45, metalness: 0.5 });
  S('caliper_blue', { color: 0x1f4f9a, roughness: 0.38, metalness: 0.1 });
  S('int_dark', { color: 0x262729, roughness: 0.85 });
  S('int_tan', { color: 0x5a3c29, roughness: 0.7 });
  S('int_grey', { color: 0x4f4c48, roughness: 0.85 });
  for (const k of ['lampF', 'drl', 'tail', 'tailLed', 'grille', 'gap', 'chrome', 'plastic', 'glass', 'trim']) { const m = MATS.get(k); m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -4; }
  for (const m of MATS.values()) m.userData.car = true;
  return MATS;
}
function paintMat(color, o = {}) {
  const c = new T.Color(color), key = 'paint:' + c.getHexString() + ':' + (o.metalness ?? '') + ':' + (o.roughness ?? '');
  if (MATS.has(key)) return MATS.get(key);
  const hsl = {}; c.getHSL(hsl);
  const light = hsl.l > 0.6;           // blanc nacré : peu métallisé
  const m = new T.MeshPhysicalMaterial({
    name: 'car:' + key, color: c,
    metalness: o.metalness ?? (light ? 0.12 : 0.6), roughness: o.roughness ?? (light ? 0.3 : 0.35),
    clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.15,
  });
  if (light) { m.sheen = 0.25; m.sheenColor = new T.Color(0xfff6e8); m.sheenRoughness = 0.4; }
  m.userData.car = true;
  MATS.set(key, m); return m;
}
function plateMat(text) {
  const key = 'plate:' + text;
  if (MATS.has(key)) return MATS.get(key);
  const m = new T.MeshStandardMaterial({ name: 'car:' + key, map: plateTexture(text), roughness: 0.35, metalness: 0 });
  MATS.set(key, m); return m;
}
function shadowMat(model, C) {
  const key = 'shadow:' + model;
  if (MATS.has(key)) return MATS.get(key);
  const m = new T.MeshBasicMaterial({ name: 'car:' + key, color: 0x000000, alphaMap: null, map: shadowTexture(C), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false, fog: false });
  // la texture porte l'opacité dans son alpha : couleur noire × alpha
  m.color.set(0xffffff); m.onBeforeCompile = (s) => { s.fragmentShader = s.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb = vec3(0.0);'); };
  MATS.set(key, m); return m;
}

// ------------------------------------------------------------------ construction d'un modèle
function buildCar(C, style) {
  const parts = {};                                  // matKey → [geometries]
  const ALIAS = { gap: 'trim', disc: 'caliper_grey' };   // moins d'appels de dessin
  const add = (k, g) => { k = ALIAS[k] || k; (parts[k] || (parts[k] = [])).push(g); };
  const L2 = C.L / 2, W0 = C.W / 2 - C.flare;
  const zAF = L2 - C.fo, zAR = zAF - C.wb, axles = [zAF, zAR];
  const R = C.tire.R, yc = R - 0.006, Ra = R + 0.062;
  const top = mono(C.top), under = mono(C.under), belt = mono(C.belt);
  const zfM = L2 - C.capF.z, zrM = -L2 + C.capR.z;           // fin du loft principal (avant les congés)
  const dzMeet = Math.sqrt(Math.max(0, Ra * Ra - (C.sill - yc) ** 2));
  const archAt = (z) => { let best = null; for (const za of axles) { const d = z - za; if (Math.abs(d) < Ra) { const y = yc + Math.sqrt(Ra * Ra - d * d); if (!best || y > best) best = y; } } return best; };
  const inArch = (z) => axles.some(za => Math.abs(z - za) < dzMeet - 1e-4);
  const flareAt = (z) => { let f = 0; for (const za of axles) { const d = Math.abs(z - za); f = Math.max(f, d < Ra ? 1 : 1 - sstep(Ra, Ra + 0.32, d)); } return f * C.flare; };
  const halfW = (z) => {
    let w = W0;
    const f0 = zfM - C.cF, r0 = zrM + C.cR;
    if (z > f0) { const d = Math.min(z - f0, C.cF); w = W0 - C.cF + Math.sqrt(C.cF * C.cF - d * d); }
    if (z < r0) { const d = Math.min(r0 - z, C.cR); w = W0 - C.cR + Math.sqrt(C.cR * C.cR - d * d); }
    return w;
  };
  // ----- section transversale (demi-section droite x ≥ 0, du dessous au sommet)
  const SEG_ROWS = [2, 2, 2, 3, 3, 3, 4, 3, 3, 3];
  const SEG_CAT = ['under', 'corner', 'rocker', 'low', 'side', 'shoulder', 'dlo', 'rail', 'top', 'top'];
  const rowCat = []; SEG_ROWS.forEach((n, i) => { for (let k = 0; k < n; k++) rowCat.push(SEG_CAT[i]); });
  const NR = rowCat.length;                           // segments par demi-section
  const RING = 2 * NR;
  function sectionKeys(z) {
    const yT = top(z), yu = under(z), bRaw = belt(z), W = halfW(z), fl = flareAt(z) * (W / W0);
    const ghk = sstep(0.0, 0.16, yT - bRaw);
    const crown = lerp(C.hoodCrown, C.crown, ghk);
    const yBe = Math.min(bRaw, yT - crown);
    let y3 = Math.max(C.sill, archAt(z) ?? -1);
    y3 = Math.min(y3, yBe - 0.06);
    const y5 = clamp(yBe - C.shoulder, y3 + 0.04, yBe - 0.02);
    const y4 = (y3 + y5) / 2;
    const y7 = Math.max(yBe, yT - crown - 0.045 * ghk);
    const x6 = W - 0.035, x7 = Math.max(0.3, x6 - C.tumble * (y7 - yBe));
    const x8 = Math.max(0.2, x7 - lerp(0.10, 0.075, ghk)), y8 = Math.max(y7, yT - crown * 0.45);
    const tuck = 0.045 * (1 - clamp((y3 - C.sill) / 0.08, 0, 1));
    return [
      [0, yu], [W - 0.2, yu], [W - 0.085 - tuck * 0.5, yu + 0.05], [W - 0.012 - tuck + fl, y3], [W - 0.003 + fl * 0.9, y4], [W + fl * 0.4, y5],
      [x6, yBe], [x7, y7], [x8, y8], [x8 * 0.5, yT - crown * 0.12], [0, yT],
    ];
  }
  function sectionPts(z) {
    const K = sectionKeys(z), out = [];
    const ext = [[-K[1][0], K[1][1]], ...K, [-K[9][0], K[9][1]]];
    for (let s = 0; s < K.length - 1; s++) {
      const n = SEG_ROWS[s];
      for (let k = 0; k < n; k++) out.push(crc(ext[s], ext[s + 1], ext[s + 2], ext[s + 3], k / n));
    }
    out.push(K[K.length - 1]);
    return out;                                       // NR + 1 points
  }
  // ----- déformations des extrémités (balayage en plan, galbe du bouclier)
  const wFs = zAF + Ra + 0.05, wRs = zAR - Ra - 0.05;
  const deform = (x, y, z) => {
    const ax = Math.min(1, Math.abs(x) / W0);
    if (z > wFs) { const w = sstep(wFs, zfM + 0.02, z), k = y > C.noseY ? C.kFt : C.kFb; z -= w * (C.sweepF * ax * ax + k * Math.min(1.6, ((y - C.noseY) / 0.3) ** 2)); }
    if (z < wRs) { const w = sstep(wRs, zrM - 0.02, z), k = y > C.tailY ? C.kRt : C.kRb; z += w * (C.sweepR * ax * ax + k * Math.min(1.6, ((y - C.tailY) / 0.3) ** 2)); }
    return z;
  };
  // ----- stations le long de la voiture
  const bounds = [C.cowl, C.cowl + 0.06, C.wsTop, C.rwTop, C.rwBot, C.dlo[0], C.dlo[1], C.B[0], C.B[1], ...(C.C || [])];
  const zs = [...bounds];
  for (const za of axles) {
    for (let k = 0; k <= 12; k++) { const th = Math.PI * k / 12; zs.push(za + Ra * Math.cos(th)); }
    zs.push(za + dzMeet, za - dzMeet, za + Ra + 0.12, za - Ra - 0.12);
  }
  for (let k = 0; k <= 7; k++) { const th = Math.PI / 2 * k / 7; zs.push(zfM - C.cF + C.cF * Math.sin(th)); zs.push(zrM + C.cR - C.cR * Math.sin(th)); }
  for (let z = zrM; z < zfM; z += 0.1) zs.push(z);
  zs.push(zfM, zrM);
  const sorted = zs.filter(z => z >= zrM - 1e-6 && z <= zfM + 1e-6).sort((a, b) => a - b);
  const isB = (z) => bounds.some(b => Math.abs(b - z) < 1e-6);
  const st = [];
  for (const z of sorted) {
    const last = st[st.length - 1];
    if (last && z - last.z < 0.018) { if (isB(z) && !isB(last.z)) last.z = z; continue; }
    st.push({ z, region: 'main' });
  }
  // ----- anneaux (positions déformées)
  const rings = [];
  const ringFrom = (pts, map) => { const r = new Float32Array(RING * 3); for (let j = 0; j < RING; j++) { const q = j <= NR ? pts[j] : pts[RING - j]; const sx = j <= NR ? 1 : -1; const [x, y, z] = map(q[0] * sx, q[1]); r[j * 3] = x; r[j * 3 + 1] = y; r[j * 3 + 2] = deform(x, y, z); } return r; };
  // congés et faces d'extrémité
  const cap = (zEnd, R, dir) => {
    const pts = sectionPts(zEnd), yT = top(zEnd), yu = under(zEnd), cy = lerp(yu, yT, 0.45), hT = yT - cy, hB = cy - yu, hx = halfW(zEnd);
    const out = [], region = dir > 0 ? 'capF' : 'capR';
    const sc = (x, y, f, g) => [x * (1 - f * R.x / hx) * g, cy + (y - cy) * (1 - f * (y > cy ? R.t / hT : R.b / hB)) * g];
    const NF = 4, NT = 4;
    for (let k = 1; k <= NF; k++) { const ph = Math.PI / 2 * k / NF, f = 1 - Math.cos(ph); out.push({ z: zEnd, region, ring: ringFrom(pts, (x, y) => [...sc(x, y, f, 1), zEnd + dir * R.z * Math.sin(ph)]) }); }
    for (let k = 1; k <= NT; k++) { const g = 1 - k / NT; out.push({ z: zEnd, region, ring: ringFrom(pts, (x, y) => [...sc(x, y, 1, g), zEnd + dir * R.z]) }); }
    return out;
  };
  const capR = cap(zrM, C.capR, -1).reverse(), capF = cap(zfM, C.capF, 1);
  for (const s of st) s.ring = ringFrom(sectionPts(s.z), (x, y) => [x, y, s.z]);
  const stations = [...capR, ...st, ...capF];
  const NS = stations.length;
  const P = new Float32Array(NS * RING * 3);
  stations.forEach((s, i) => P.set(s.ring, i * RING * 3));
  // ----- matériau d'un quadrilatère
  const inZ = (z, a, b) => z >= Math.min(a, b) && z <= Math.max(a, b);
  const catOf = (j) => rowCat[j < NR ? j : RING - 1 - j];
  function matOf(cat, z, region) {
    if (region !== 'main') return null;               // décidé plus bas d'après la hauteur
    const arch = inArch(z);
    switch (cat) {
      case 'under': case 'corner': return arch ? null : 'plastic';
      case 'rocker': return arch ? null : C.cladding ? 'plastic' : 'paint';
      case 'low': return C.cladding && axles.some(za => Math.abs(z - za) < Ra + 0.02) ? 'plastic' : 'paint';
      case 'dlo':
        if (inZ(z, C.B[0], C.B[1]) || (C.C && inZ(z, C.C[0], C.C[1]))) return 'trim';
        if (inZ(z, C.dlo[0], C.dlo[1])) return 'glass';
        return inZ(z, C.rwBot - 0.1, C.cowl + 0.05) ? 'trim' : 'paint';
      case 'rail':
        if (inZ(z, C.wsTop, C.cowl) || inZ(z, C.rwBot, C.rwTop)) return 'trim';
        return 'paint';
      case 'top':
        if (inZ(z, C.cowl, C.cowl + 0.06)) return 'plastic';
        if (inZ(z, C.wsTop, C.cowl) || inZ(z, C.rwBot, C.rwTop)) return 'glass';
        if (style.panoroof && inZ(z, C.rwTop + 0.12, C.wsTop - 0.1)) return 'glass';
        if (style.blackRoof && inZ(z, C.rwTop, C.wsTop)) return 'trim';
        return 'paint';
      default: return 'paint';
    }
  }
  const tris = [];                                    // [a, b, c, matKey]
  for (let i = 0; i < NS - 1; i++) {
    const zm = (stations[i].z + stations[i + 1].z) / 2;
    const region = stations[i].region === 'main' && stations[i + 1].region === 'main' ? 'main' : stations[i].region !== 'main' ? stations[i].region : stations[i + 1].region;
    for (let j = 0; j < RING; j++) {
      let mk = matOf(catOf(j), zm, region);
      if (region !== 'main') {
        const ids = [i * RING + j, i * RING + (j + 1) % RING, (i + 1) * RING + j, (i + 1) * RING + (j + 1) % RING];
        const ym = ids.reduce((a, id) => a + P[id * 3 + 1], 0) / 4, yuE = under(region === 'capF' ? zfM : zrM);
        mk = ym < yuE + 0.015 ? 'plastic' : 'paint';
      }
      if (!mk) continue;
      const j1 = (j + 1) % RING;
      const a = i * RING + j, b = i * RING + j1, c = (i + 1) * RING + j, d = (i + 1) * RING + j1;
      tris.push(a, b, c, mk, b, d, c, mk);
    }
  }
  // normales lissées (pondérées par l'aire) sur toute la caisse, toutes matières confondues
  const N = new Float32Array(P.length);
  const v = (i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
  for (let t = 0; t < tris.length; t += 4) {
    const [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]], A = v(a), B = v(b), Cc = v(c);
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], wx = Cc[0] - A[0], wy = Cc[1] - A[1], wz = Cc[2] - A[2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    for (const k of [a, b, c]) { N[k * 3] += nx; N[k * 3 + 1] += ny; N[k * 3 + 2] += nz; }
  }
  for (let i = 0; i < N.length; i += 3) { const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1; N[i] /= l; N[i + 1] /= l; N[i + 2] /= l; }
  // géométries de caisse par matériau
  const byMat = {};
  for (let t = 0; t < tris.length; t += 4) {
    const mk = tris[t + 3], o = byMat[mk] || (byMat[mk] = { p: [], n: [] });
    for (let k = 0; k < 3; k++) { const id = tris[t + k]; o.p.push(P[id * 3], P[id * 3 + 1], P[id * 3 + 2]); o.n.push(N[id * 3], N[id * 3 + 1], N[id * 3 + 2]); }
  }
  for (const [mk, o] of Object.entries(byMat)) add(mk, geoFrom(o.p, o.n));
  let bodyTris = tris.length / 4;

  // ----- lancer de rayons sur la caisse (décalques)
  const TRI = [];
  for (let t = 0; t < tris.length; t += 4) TRI.push(tris[t], tris[t + 1], tris[t + 2]);
  const subset = (pred) => { const out = []; for (let t = 0; t < TRI.length; t += 3) { const a = TRI[t] * 3, b = TRI[t + 1] * 3, c = TRI[t + 2] * 3; const cx = (P[a] + P[b] + P[c]) / 3, cyy = (P[a + 1] + P[b + 1] + P[c + 1]) / 3, cz = (P[a + 2] + P[b + 2] + P[c + 2]) / 3; if (pred(cx, cyy, cz)) out.push(TRI[t], TRI[t + 1], TRI[t + 2]); } return out; };
  function hit(o, d, S) {
    let best = Infinity, res = null;
    for (let t = 0; t < S.length; t += 3) {
      const a = S[t] * 3, b = S[t + 1] * 3, c = S[t + 2] * 3;
      const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2], e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
      const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
      const det = e1x * px + e1y * py + e1z * pz; if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det, tx = o[0] - P[a], ty = o[1] - P[a + 1], tz = o[2] - P[a + 2];
      const u = (tx * px + ty * py + tz * pz) * inv; if (u < -1e-6 || u > 1 + 1e-6) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const w = (d[0] * qx + d[1] * qy + d[2] * qz) * inv; if (w < -1e-6 || u + w > 1 + 1e-6) continue;
      const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (tt > 1e-5 && tt < best) {
        best = tt; const s = 1 - u - w;
        const n = [0, 0, 0]; for (let k = 0; k < 3; k++) n[k] = N[a + k] * s + N[b + k] * u + N[c + k] * w;
        const l = Math.hypot(n[0], n[1], n[2]) || 1;
        res = { p: [o[0] + d[0] * tt, o[1] + d[1] * tt, o[2] + d[2] * tt], n: [n[0] / l, n[1] / l, n[2] / l] };
      }
    }
    return res;
  }
  // grille de décalque : ray(u, v) → {o, d} ; uvm : échelle des UV (m)
  function decal(mk, nu, nv, ray, off, S, { uvm = null, both = false, maxEdge = 0.25 } = {}) {
    const H = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const r = ray(i / nu, j / nv); H.push(r ? hit(r.o, r.d, S) : null); }
    const pos = [], nor = [], uv = [];
    const put = (i, j) => { const h = H[j * (nu + 1) + i]; pos.push(h.p[0] + h.n[0] * off, h.p[1] + h.n[1] * off, h.p[2] + h.n[2] * off); nor.push(...h.n); uv.push(uvm ? i / nu * uvm[0] : i / nu, uvm ? j / nv * uvm[1] : j / nv); };
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const q = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
      if (q.some(([a, b]) => !H[b * (nu + 1) + a])) continue;
      { // rayon passé par une ouverture (passage de roue…) : on ignore les cellules étirées
        const hp = q.map(([a, b]) => H[b * (nu + 1) + a].p);
        let far = false; for (let k = 0; k < 4; k++) { const A = hp[k], B = hp[(k + 1) % 4]; if (Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]) > maxEdge) far = true; }
        if (far) continue;
      }
      const h0 = H[j * (nu + 1) + i], h1 = H[j * (nu + 1) + i + 1], h3 = H[(j + 1) * (nu + 1) + i];
      const e1 = [h1.p[0] - h0.p[0], h1.p[1] - h0.p[1], h1.p[2] - h0.p[2]], e2 = [h3.p[0] - h0.p[0], h3.p[1] - h0.p[1], h3.p[2] - h0.p[2]];
      const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const flip = cr[0] * h0.n[0] + cr[1] * h0.n[1] + cr[2] * h0.n[2] < 0;
      const order = flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
      for (const k of order) put(...q[k]);
    }
    if (!pos.length) return null;
    const g = geoFrom(pos, nor, uv);
    add(mk, g); if (both) add(mk, mirrorX(g));
    return g;
  }
  const front = subset((x, y, z) => z > L2 - 1.3), rear = subset((x, y, z) => z < -L2 + 1.3);
  const sideR = subset((x) => x > 0.35), topS = subset((x, y) => y > 0.6);
  // optiques avant effilées (boîtier chromé sombre + signature lumineuse)
  const H = C.head;
  const headRay = (yr) => (u, v) => { const th = lerp(H.tA, H.tB, u), y = yr(u, v); return { o: [0, y, L2 - H.oz], d: [Math.sin(th), 0, Math.cos(th)] }; };
  const yLo = (u) => lerp(H.yA[0], H.yB[0], Math.pow(u, 0.8)), yHi = (u) => lerp(H.yA[1], H.yB[1], u * u);
  decal('lampF', 22, 5, headRay((u, v) => lerp(yLo(u), yHi(u), v)), 0.004, front, { both: true });
  decal('drl', 22, 1, headRay((u, v) => lerp(yHi(u) - 0.016 + 0.006 * u, yHi(u) - 0.006, v)), 0.006, front, { both: true });
  decal('drl', 3, 2, (u, v) => { const th = lerp(H.tA + 0.08, H.tA + 0.2, u), y = lerp(yLo(0.1) + 0.012, yLo(0.1) + 0.034, v); return { o: [0, y, L2 - H.oz], d: [Math.sin(th), 0, Math.cos(th)] }; }, 0.006, front, { both: true });
  // feux arrière en bandeau traversant
  const TL = C.tail;
  const tailY = (u, v) => { const th = lerp(-TL.tMax, TL.tMax, u), k = sstep(TL.tC - 0.12, TL.tC + 0.05, Math.abs(th)); return lerp(lerp(TL.yC[0], TL.yE[0], k), lerp(TL.yC[1], TL.yE[1], k), v); };
  const tailRay = (yf) => (u, v) => { const th = lerp(-TL.tMax, TL.tMax, u); return { o: [0, yf(u, v), -L2 + TL.oz], d: [Math.sin(th), 0, -Math.cos(th)] }; };
  decal('tail', 48, 3, tailRay(tailY), 0.004, rear);
  decal('tailLed', 48, 1, tailRay((u, v) => { const a = tailY(u, 0), b = tailY(u, 1); return lerp(lerp(a, b, 0.55), lerp(a, b, 0.72), v); }), 0.0058, rear);
  {
    const yb = C.plateR + 0.11;
    decal('gap', 40, 1, (u, v) => { const th = lerp(-TL.tMax * 0.92, TL.tMax * 0.92, u); return { o: [0, yb + (v - 0.5) * 0.005, -L2 + TL.oz], d: [Math.sin(th), 0, -Math.cos(th)] }; }, 0.0012, rear);
  }
  // jupes de bouclier noires (diffuseur arrière, lame avant), enveloppant les angles
  {
    const yuF = under(zfM), yuR = under(zrM);
    decal('plastic', 36, 2, (u, v) => { const th = lerp(-1.15, 1.15, u); return { o: [0, lerp(yuR - 0.02, yuR + 0.11, v), -L2 + 0.9], d: [Math.sin(th), 0, -Math.cos(th)] }; }, 0.0015, rear);
    decal('plastic', 36, 2, (u, v) => { const th = lerp(-1.1, 1.1, u); return { o: [0, lerp(yuF - 0.02, yuF + 0.07, v), L2 - 0.9], d: [Math.sin(th), 0, Math.cos(th)] }; }, 0.0015, front);
  }
  // calandre (supérieure fine + entrée d'air inférieure), cadre noir brillant
  const fz = L2 - 0.7;
  const GU = C.grilleU, GL = C.grilleL;
  decal('grille', 18, 4, (u, v) => ({ o: [lerp(-GU.x, GU.x, u) * (1 - 0.08 * v), lerp(GU.y[0], GU.y[1], v), fz], d: [0, 0, 1] }), 0.004, front, { uvm: [GU.x * 2, GU.y[1] - GU.y[0]] });
  decal('grille', 18, 5, (u, v) => ({ o: [lerp(-1, 1, u) * lerp(GL.xB, GL.xT, v), lerp(GL.y[0], GL.y[1], v), fz], d: [0, 0, 1] }), 0.004, front, { uvm: [GL.xT * 2, GL.y[1] - GL.y[0]] });
  decal('trim', 14, 1, (u, v) => ({ o: [lerp(-1, 1, u) * (GL.xT + 0.018), lerp(GL.y[1], GL.y[1] + 0.018, v), fz], d: [0, 0, 1] }), 0.005, front);
  // plaques
  const plate = (zSign, y) => {
    const ray = (dx, dy) => (u, v) => ({ o: [lerp(-0.26 - dx, 0.26 + dx, zSign > 0 ? u : 1 - u), lerp(y - 0.055 - dy, y + 0.055 + dy, v), zSign * (L2 - 0.7)], d: [0, 0, zSign] });
    decal('plastic', 4, 1, ray(0.012, 0.012), 0.008, zSign > 0 ? front : rear);
    decal('plate', 4, 1, ray(0, 0), 0.0125, zSign > 0 ? front : rear);
  };
  plate(1, C.plateF); plate(-1, C.plateR);
  // hayon : partie basse de la lunette sur la face arrière (modèles à hayon)
  if (C.rearGlass) {
    const RG = C.rearGlass;
    decal('glass', 16, 4, (u, v) => ({ o: [lerp(-1, 1, u) * lerp(RG.x[0], RG.x[1], v), lerp(RG.y[0], RG.y[1], v), -L2 + 0.7], d: [0, 0, -1] }), 0.0015, rear);
  }
  // joints d'ouvrants (flanc) : polylignes (z, y) projetées horizontalement
  const seamSide = (pl, w = 0.0045) => {
    const segL = []; let tot = 0; for (let i = 0; i < pl.length - 1; i++) { const l = Math.hypot(pl[i + 1][0] - pl[i][0], pl[i + 1][1] - pl[i][1]); segL.push(l); tot += l; }
    const at = (u) => { let d = u * tot, i = 0; while (i < segL.length - 1 && d > segL[i]) { d -= segL[i]; i++; } const t = segL[i] ? d / segL[i] : 0, a = pl[i], b = pl[i + 1]; const tz = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tz, ty) || 1; return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), -ty / l, tz / l]; };
    const n = Math.max(2, Math.round(tot / 0.06));
    decal('gap', n, 1, (u, v) => { const [z, y, nz, ny] = at(u), o = (v - 0.5) * w; return { o: [0.0, y + ny * o, z + nz * o], d: [1, 0, 0] }; }, 0.0008, sideR, { both: true });
  };
  for (const s of C.seams) seamSide(s);
  // capot et coffre : joints vus de dessus
  const seamTop = (x, z0, z1) => decal('gap', Math.max(2, Math.round(Math.abs(z1 - z0) / 0.08)), 1, (u, v) => ({ o: [x + (v - 0.5) * 0.0045, 3, lerp(z0, z1, u)], d: [0, -1, 0] }), 0.0008, topS, { both: true });
  seamTop(W0 - 0.115, C.cowl + 0.07, L2 - 0.16);
  if (C.trunk) seamTop(W0 - 0.16, C.rwBot - 0.02, -L2 + 0.14);
  // poignées affleurantes
  for (const [z0, z1] of [[C.B[1] + 0.06, C.B[1] + 0.22], [C.B[0] - 0.42, C.B[0] - 0.26]]) {
    decal('gap', 4, 1, (u, v) => ({ o: [0, lerp(C.handleY - 0.022, C.handleY + 0.006, v), lerp(z0 - 0.008, z1 + 0.008, u)], d: [1, 0, 0] }), 0.0008, sideR, { both: true });
    decal('chrome', 4, 1, (u, v) => ({ o: [0, lerp(C.handleY - 0.016, C.handleY, v), lerp(z0, z1, u)], d: [1, 0, 0] }), 0.003, sideR, { both: true });
  }
  // jonc chromé de ceinture de caisse
  if (C.chromeBelt) {
    const zA = C.dlo[0] + 0.03, zB = C.dlo[1] - 0.02;
    decal('chrome', 30, 1, (u, v) => { const z = lerp(zA, zB, u), b = Math.min(belt(z), top(z)); return { o: [0, b - 0.014 + 0.012 * v, z], d: [1, 0, 0] }; }, 0.0015, sideR, { both: true });
  }
  // ----- rétroviseurs
  {
    const zM = C.dlo[1] - 0.1, yM = belt(zM) + 0.075, xM = W0 + 0.035;
    const shell = new RoundedBoxGeometry(0.17, 0.1, 0.09, 2, 0.035);
    const p = shell.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), t = (x + 0.085) / 0.17;      // 0 côté portière → 1 extrémité
      p.setY(i, y * (1 - 0.18 * t) - 0.008 * t); p.setZ(i, (z > 0 ? z * (1.25 - 0.35 * t) : z * 0.55));
    }
    shell.computeVertexNormals(); shell.translate(xM, yM, zM);
    const gm = new T.PlaneGeometry(0.145, 0.072); gm.rotateY(Math.PI); gm.translate(xM + 0.006, yM - 0.006, zM - 0.0255);
    const base = new T.BoxGeometry(0.07, 0.035, 0.09); base.translate(W0 - 0.03, yM - 0.035, zM + 0.02);
    for (const [k, g] of [['paint', shell], ['chrome', gm], ['trim', base]]) { const n = norm(g); add(k, n); add(k, mirrorX(n)); }
  }
  // ----- essuie-glaces, antenne, échappements, barres de toit
  {
    const yAt = (x, z) => { const h = hit([x, 3, z], [0, -1, 0], topS); return h ? h.p[1] : top(z); };
    for (const [x0, x1, z] of [[-0.62, -0.06, C.cowl - 0.05], [0.0, 0.56, C.cowl - 0.07]]) {
      const ya = yAt(x0, z), yb = yAt(x1, z), g = new T.BoxGeometry(Math.hypot(x1 - x0, yb - ya), 0.012, 0.018);
      g.rotateZ(Math.atan2(yb - ya, x1 - x0)); g.translate((x0 + x1) / 2, (ya + yb) / 2 + 0.008, z); add('trim', norm(g));
    }
    const zf = C.rwTop + 0.1, fin = new T.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    fin.scale(0.035, 0.055, 0.12); fin.translate(0, yAt(0, zf) - 0.004, zf); add('trim', norm(fin));
    if (C.exhaust) for (const s of [-1, 1]) {
      const h = hit([s * 0.48, 0.27, -L2 + 0.8], [0, 0, -1], rear);
      if (h) { const g = new T.CylinderGeometry(0.038, 0.038, 0.07, 16, 1, true); g.rotateX(Math.PI / 2); g.translate(s * 0.48, 0.27, h.p[2] + 0.012); add('chrome', norm(g)); const e = new T.CircleGeometry(0.032, 14); e.rotateY(Math.PI); e.translate(s * 0.48, 0.27, h.p[2] - 0.02); add('gap', norm(e)); }
    }
    if (C.roofRails) for (const s of [1]) {
      const pts = [];
      for (let k = 0; k <= 8; k++) { const z = lerp(C.rwTop + 0.08, C.wsTop - 0.12, k / 8), xr = s * (halfRoof(z) - 0.1), h = hit([xr, 3, z], [0, -1, 0], topS); if (h) pts.push(new T.Vector3(xr, h.p[1] + 0.035, z)); }
      if (pts.length > 3) {
        const tube = new T.TubeGeometry(new T.CatmullRomCurve3(pts), 18, 0.013, 6, false); const n = norm(tube); add('rim_alu', n); add('rim_alu', mirrorX(n));
        for (const q of [pts[0], pts[pts.length - 1]]) { const f = new T.BoxGeometry(0.03, 0.05, 0.09); f.translate(q.x, q.y - 0.02, q.z); const nf = norm(f); add('trim', nf); add('trim', mirrorX(nf)); }
      }
    }
  }
  function halfRoof(z) { const K = sectionKeys(z); return K[8][0]; }
  // ----- passages de roue : ourlet et pare-boue (côté droit puis symétrie)
  for (const za of axles) {
    const pos = [], nor = [], lp = [], ln = [];
    const sts = stations.filter(s => s.region === 'main' && Math.abs(s.z - za) <= dzMeet + 1e-6);
    let prev = null;
    for (const s of sts) {
      const j = rowCat.indexOf('low');             // premier sommet du flanc au-dessus de l'arc (rang 3)
      const p = [s.ring[j * 3], s.ring[j * 3 + 1], s.ring[j * 3 + 2]];
      const ry = p[1] - yc, rz = p[2] - za, rl = Math.hypot(ry, rz) || 1;
      const curl = [[p[0], p[1], p[2]], [p[0] - 0.008, p[1] + ry / rl * 0.006 - 0.004, p[2] + rz / rl * 0.006], [p[0] - 0.04, p[1] + ry / rl * 0.003, p[2] + rz / rl * 0.003]];
      if (prev) {
        for (let k = 0; k < 2; k++) {
          const a = prev[k], b = prev[k + 1], c = curl[k], d = curl[k + 1];
          // orientation : face tournée vers la roue (−radial) et vers l'extérieur
          const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
          const nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
          const ok = -ny * ry / rl - nz * rz / rl + 0.3 * nx > 0;
          if (ok) pos.push(...a, ...b, ...c, ...b, ...d, ...c); else pos.push(...a, ...c, ...b, ...b, ...c, ...d);
        }
      }
      prev = curl;
    }
    const g = geoFrom(pos, new Array(pos.length).fill(0)); g.deleteAttribute('normal'); g.computeVertexNormals();
    const ng = norm(g), cm = C.cladding ? 'plastic' : 'paint'; add(cm, ng); add(cm, mirrorX(ng));
    // pare-boue : demi-cylindre noir + paroi intérieure
    const Rl = Ra + 0.012, x0 = W0 - 0.03, x1 = W0 - 0.33, th1 = Math.atan2(C.sill - yc, dzMeet) - 0.1, th0 = Math.PI - th1;
    const nA = 20;
    for (let k = 0; k < nA; k++) {
      const a0 = th1 + (th0 - th1) * k / nA, a1 = th1 + (th0 - th1) * (k + 1) / nA;
      const P0 = (x, a) => [x, yc + Rl * Math.sin(a), za + Rl * Math.cos(a)], N0 = (a) => [0, -Math.sin(a), -Math.cos(a)];
      lp.push(...P0(x0, a0), ...P0(x1, a0), ...P0(x0, a1), ...P0(x0, a1), ...P0(x1, a0), ...P0(x1, a1));
      ln.push(...N0(a0), ...N0(a0), ...N0(a1), ...N0(a1), ...N0(a0), ...N0(a1));
      lp.push(x1, yc, za, ...P0(x1, a1), ...P0(x1, a0)); ln.push(1, 0, 0, 1, 0, 0, 1, 0, 0);
    }
    const lg = geoFrom(lp, ln); add('plastic', lg); add('plastic', mirrorX(lg));
  }
  // ----- roues (pneu, jante alliage, disque, étrier) — construites pour le côté +X
  const wheel = buildWheel(C.tire, style);
  const rnd = mulberry(style.seed * 7 + 3);
  for (const [i, za] of axles.entries()) for (const s of [1, -1]) {
    const rot = rnd() * Math.PI * 2, steer = i === 0 ? style.steer : 0;
    for (const [mk, g0, spin] of wheel) {
      let g = g0.clone();
      if (spin) g.rotateX(rot);
      if (s < 0) g = mirrorX(g);
      g.rotateY(steer);
      g.translate(s * C.track / 2, yc, za);
      add(mk, g);
    }
  }
  // ----- habitacle (entrevu par les vitres)
  {
    const im = 'int_' + style.interior;
    const fl = C.sill + 0.0, zB = (C.B[0] + C.B[1]) / 2, zF = zB + 0.26, zRr = zB - 0.68;
    const zc0 = Math.max(zAR + 0.05, C.rwBot + 0.1, zrM + C.cR), zc1 = C.cowl - 0.04, wIn = (z) => halfW(z) - 0.11;
    const box = (k, w, h, d, x, y, z, rx = 0, seg = 0, r = 0.03) => { const g = seg ? new RoundedBoxGeometry(w, h, d, seg, r) : new T.BoxGeometry(w, h, d); if (rx) g.rotateX(rx); g.translate(x, y, z); add(k, norm(g)); };
    box(im, wIn(zc0) * 2, 0.16, zc1 - zc0, 0, fl + 0.06, (zc0 + zc1) / 2);
    for (const sx of [-1, 1]) {
      box(im, 0.5, 0.14, 0.52, sx * 0.37, fl + 0.22, zF);
      box(im, 0.5, 0.6, 0.13, sx * 0.37, fl + 0.55, zF - 0.33, -0.22, 1, 0.04);
      box(im, 0.26, 0.17, 0.09, sx * 0.37, fl + 0.92, zF - 0.42, -0.15);
    }
    box(im, (W0 - 0.2) * 2, 0.14, 0.5, 0, fl + 0.2, zRr);
    box(im, (W0 - 0.2) * 2, 0.55, 0.13, 0, fl + 0.5, zRr - 0.32, -0.25);
    const by = belt(C.cowl - 0.25);
    box(im, (W0 - 0.1) * 2, 0.2, 0.42, 0, by - 0.1, C.cowl - 0.22, 0, 1, 0.05);
    const sw = new T.TorusGeometry(0.18, 0.017, 6, 22); sw.rotateX(-0.35); sw.translate(0.37, by + 0.05, C.cowl - 0.52); add(im, norm(sw));
    // contre-portes (masquent l'intérieur de la caisse vu à travers les vitres)
    const dp = [], dn = [], NZ = 8;
    for (const sx of [-1, 1]) for (let k = 0; k < NZ; k++) {
      const za = lerp(zc0, zc1, k / NZ), zb = lerp(zc0, zc1, (k + 1) / NZ), yt = (z) => Math.min(belt(z), top(z)) + 0.01;
      const q = (z, y) => [sx * wIn(z), y, z];
      const pts = sx > 0 ? [q(za, fl), q(zb, fl), q(zb, yt(zb)), q(za, fl), q(zb, yt(zb)), q(za, yt(za))] : [q(za, fl), q(zb, yt(zb)), q(zb, fl), q(za, fl), q(za, yt(za)), q(zb, yt(zb))];
      for (const p of pts) { dp.push(...p); dn.push(-sx, 0, 0); }
    }
    add(im, geoFrom(dp, dn));
    if (C.trunk) box(im, (W0 - 0.15) * 2, 0.03, 0.3, 0, belt(C.rwBot + 0.2) - 0.02, C.rwBot + 0.2, 0, 0);
  }
  // ----- ombre de contact
  { const g = new T.PlaneGeometry(C.W + 0.6, C.L + 0.7); g.rotateX(-Math.PI / 2); g.translate(0, 0.012, 0); add('shadow', norm(g)); }

  // ----- fusion par matériau
  const out = [], perMat = {};
  let triCount = 0;
  for (const [mk, list] of Object.entries(parts)) {
    const g = mergeGeometries(list.map(norm), false);
    for (const x of list) x.dispose();
    g.computeBoundingSphere(); g.computeBoundingBox();
    out.push([mk, g]);
    if (mk !== 'shadow') triCount += g.attributes.position.count / 3;
    perMat[mk] = g.attributes.position.count / 3;
  }
  // encombrement (caisse hors rétroviseurs)
  const bb = new T.Box3();
  for (const [mk, g] of out) if (['paint', 'glass', 'plastic', 'trim'].includes(mk)) bb.union(g.boundingBox);
  const dims = { L: +(bb.max.z - bb.min.z).toFixed(3), W: +(bb.max.x - bb.min.x).toFixed(3), H: +bb.max.y.toFixed(3), y0: +bb.min.y.toFixed(3) };
  return { parts: out, tris: Math.round(triCount), bodyTris, perMat, stations: NS, dims };
}

// ------------------------------------------------------------------ roue (pneu + jante) côté +X
function buildWheel(tire, style) {
  const { R, w, rim: Rr } = tire, hw = w / 2, sh = R - Rr;
  const list = [];                                    // [matKey, geometry, tourne avec la roue]
  const lathe = (pts, seg) => { const g = new T.LatheGeometry(pts.map(([r, a]) => new T.Vector2(r, a)), seg); g.rotateZ(-Math.PI / 2); return norm(g); };
  // pneu : flancs bombés, épaulements, bande de roulement à rainures
  const tp = [
    [Rr + 0.004, -hw + 0.02], [Rr + 0.016, -hw + 0.005], [Rr + sh * 0.5, -hw - 0.006], [R - 0.028, -hw + 0.001], [R - 0.008, -hw + 0.014], [R, -hw + 0.034],
    [R, -0.05], [R - 0.009, -0.045], [R - 0.009, -0.033], [R, -0.028], [R, 0.028], [R - 0.009, 0.033], [R - 0.009, 0.045], [R, 0.05],
    [R, hw - 0.034], [R - 0.008, hw - 0.014], [R - 0.028, hw - 0.001], [Rr + sh * 0.5, hw + 0.006], [Rr + 0.016, hw - 0.005], [Rr + 0.004, hw - 0.02],
  ];
  list.push(['rubber', lathe(tp, 30), false]);
  // jante : voile à branches (moyeu, rayons à arête, jante extérieure), creusé en cuvette, rebord poli, fût
  const xl = hw - 0.014, Rf = Rr - 0.006, dish = 0.042, dep = 0.022;
  const r1 = 0.082, r2 = Rf - 0.024, NA = 40;
  const X = (r) => xl - dish * Math.pow(Math.max(0, 1 - r / Rf), 1.1);   // cuvette
  const pos = [], nor = [];
  const P3 = (r, a, dx = 0) => [X(r) + dx, r * Math.sin(a), r * Math.cos(a)];
  const quad = (A, B, Cq, D) => pos.push(...A, ...B, ...Cq, ...A, ...Cq, ...D);
  // moyeu (disque) et couronne extérieure, faces vers +x
  for (let i = 0; i < NA; i++) {
    const a0 = i / NA * Math.PI * 2, a1 = (i + 1) / NA * Math.PI * 2;
    pos.push(...P3(0, 0), ...P3(r1 * 0.5, a1), ...P3(r1 * 0.5, a0));
    quad(P3(r1 * 0.5, a0), P3(r1 * 0.5, a1), P3(r1, a1), P3(r1, a0));
    quad(P3(r2, a0), P3(r2, a1), P3(Rf, a1), P3(Rf, a0));
    quad(P3(r2, a0, -dep), P3(r2, a1, -dep), P3(r2, a1), P3(r2, a0));                 // paroi intérieure de la couronne
  }
  // rayons : n branches (5 doubles ou 10 simples), section à arête centrale
  const twin = style.rim !== 10, nb = twin ? 5 : 10;
  const bars = [];
  for (let i = 0; i < nb; i++) { const c = i / nb * Math.PI * 2; if (twin) bars.push([c, -1], [c, 1]); else bars.push([c, 0]); }
  const NSR = 5;
  for (const [c, side] of bars) {
    const hwid = (r) => (twin ? lerp(0.011, 0.0085, (r - r1) / (r2 - r1)) : lerp(0.0135, 0.0105, (r - r1) / (r2 - r1)));
    const off = (r) => (twin ? side * Math.asin(lerp(0.004, 0.02, (r - r1) / (r2 - r1)) / r) : 0);
    for (let k = 0; k < NSR; k++) {
      const ra = lerp(r1 - 0.004, r2 + 0.004, k / NSR), rb = lerp(r1 - 0.004, r2 + 0.004, (k + 1) / NSR);
      const e = (r, s) => c + off(r) + s * Math.asin(hwid(r) / r);
      const L0 = P3(ra, e(ra, -1)), L1 = P3(rb, e(rb, -1)), R0 = P3(ra, e(ra, 1)), R1 = P3(rb, e(rb, 1));
      const M0 = P3(ra, e(ra, 0), 0.004), M1 = P3(rb, e(rb, 0), 0.004);
      quad(L0, L1, M1, M0); quad(M0, M1, R1, R0);
      const back = (q) => [q[0] - dep, q[1], q[2]];
      quad(L0, L1, back(L1), back(L0)); quad(back(R0), back(R1), R1, R0);
    }
  }
  // orientation des triangles : faces vers +x ou vers l'extérieur du rayon
  for (let t = 0; t < pos.length; t += 9) {
    const A = pos.slice(t, t + 3), B = pos.slice(t + 3, t + 6), Cq = pos.slice(t + 6, t + 9);
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [Cq[0] - A[0], Cq[1] - A[1], Cq[2] - A[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(...n) || 1; n = n.map(x => x / l);
    // référence : +x pour les faces avant ; pour les parois, s'éloigner du centre de la paroi
    const mid = [(A[0] + B[0] + Cq[0]) / 3, (A[1] + B[1] + Cq[1]) / 3, (A[2] + B[2] + Cq[2]) / 3];
    let ref;
    if (Math.abs(n[0]) > 0.5) ref = [1, 0, 0];
    else { const r = Math.hypot(mid[1], mid[2]); ref = r < r2 - 0.002 ? [0, 0, 0] : [0, -mid[1], -mid[2]]; }
    if (ref[0] === 0 && ref[1] === 0 && ref[2] === 0) ref = null;
    if (ref && n[0] * ref[0] + n[1] * ref[1] + n[2] * ref[2] < 0) { for (let k = 0; k < 3; k++) { const q = pos[t + 3 + k]; pos[t + 3 + k] = pos[t + 6 + k]; pos[t + 6 + k] = q; } n = n.map(x => -x); }
    nor.push(...n, ...n, ...n);
  }
  const face = toCreasedNormals(geoFrom(pos, nor), 0.6);
  const rimK = 'rim_' + style.rimFinish;
  list.push([rimK, face, true]);
  list.push([rimK, lathe([[Rr + 0.01, xl - 0.018], [Rr + 0.016, xl - 0.007], [Rr + 0.007, xl + 0.001], [Rf - 0.003, xl - 0.002]], 32), false]);
  list.push([rimK, lathe([[Rr - 0.003, xl - 0.02], [Rr - 0.003, -hw + 0.02]], 24), false]);
  // moyeu, cache-moyeu, écrous
  const hubX = X(0);
  { const c = new T.CylinderGeometry(0.03, 0.033, 0.012, 18); c.rotateZ(-Math.PI / 2); c.translate(hubX + 0.006, 0, 0); list.push(['chrome', norm(c), true]); }
  for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2 + Math.PI / nb, c = new T.CylinderGeometry(0.009, 0.009, 0.014, 6); c.rotateZ(-Math.PI / 2); c.translate(hubX + 0.005, 0.054 * Math.sin(a), 0.054 * Math.cos(a)); list.push(['chrome', norm(c), true]); }
  // disque ventilé et étrier
  list.push(['disc', lathe([[0.17, 0.004], [0.17, 0.03], [0.07, 0.03], [0.07, 0.045]], 24), false]);
  {
    const th = 2.05, g = new RoundedBoxGeometry(0.036, 0.055, 0.12, 1, 0.012);
    g.translate(0.04, 0.148, 0); g.rotateX(Math.PI / 2 - th);
    list.push(['caliper_' + style.caliper, norm(g), false]);
  }
  return list;
}

// ------------------------------------------------------------------ API
const PLATE_L = 'ABCDEFGHJKLMNPQRSTVWXYZ';
export function createCar(THREE, opts = {}) {
  T = THREE;
  mats();
  const model = MODELS[opts.model] ? opts.model : 'berline';
  const C = MODELS[model];
  const seed = Number.isFinite(+opts.seed) ? +opts.seed : 1;
  const r = mulberry(seed * 977 + 13);
  const pick = (a) => a[Math.floor(r() * a.length) % a.length];
  const style = {
    seed,
    rim: opts.rim ?? (r() < 0.5 ? 5 : 10),
    rimFinish: opts.rimFinish ?? (r() < 0.7 ? 'alu' : 'graphite'),
    caliper: opts.caliper ?? pick(['grey', 'grey', 'red', 'blue']),
    interior: opts.interior ?? pick(['dark', 'dark', 'tan', 'grey']),
    steer: opts.steer ?? (r() < 0.4 ? (r() - 0.5) * 0.3 : 0),
    panoroof: opts.panoroof ?? (model === 'suv' && r() < 0.6),
    blackRoof: opts.blackRoof ?? (model === 'citadine' && r() < 0.5),
  };
  const key = [model, style.rim, style.rimFinish, style.caliper, style.interior, style.steer.toFixed(3), style.panoroof, style.blackRoof, seed].join('|');
  let entry = GEO.get(key);
  if (!entry) { entry = buildCar(C, style); GEO.set(key, entry); }
  const plate = `${pick([...PLATE_L])}${pick([...PLATE_L])}-${String(100 + Math.floor(r() * 899))}-${pick([...PLATE_L])}${pick([...PLATE_L])}`;
  const group = new THREE.Group();
  group.name = 'voiture:' + model;
  for (const [mk, g] of entry.parts) {
    const mat = mk === 'paint' ? paintMat(opts.color ?? 0x3a3e43, opts) : mk === 'plate' ? plateMat(plate) : mk === 'shadow' ? shadowMat(model, C) : MATS.get(mk);
    const m = new THREE.Mesh(g, mat);
    m.name = `voiture:${model}:${mk}`;
    m.castShadow = false; m.receiveShadow = false;
    // hors G-buffer de l'occlusion ambiante du viewer : celui-ci est découpé au plan de coupe (1,2 m),
    // ce qui imprimerait l'habitacle sur le pavillon ; la voiture porte sa propre ombre de contact
    m.userData.noAO = true;
    if (mk === 'shadow') { m.renderOrder = -1; m.raycast = () => {}; }
    if (mk === 'glass') m.renderOrder = 1;
    group.add(m);
  }
  group.userData = { car: true, model, style, plate, triangles: entry.tris, dims: entry.dims, perMat: entry.perMat, bodyTris: entry.bodyTris, stations: entry.stations };
  return group;
}
export function disposeCars() {
  for (const e of GEO.values()) for (const [, g] of e.parts) g.dispose();
  GEO.clear();
  for (const m of MATS.values()) m.dispose();
  MATS.clear();
  for (const t of TEXS) t.dispose();
  TEXS.length = 0;
}
