/**
 * Canopée — intérieurs des logements (Three.js 0.160)
 *
 *   export function createInteriors(THREE, M, { rooms, windows }) → THREE.Group « interieurs »
 *
 * 1. Pièces modélisées (rooms) : coque (sol parquet, murs, plafond, plinthes, porte) et mobilier,
 *    éclairage « baké » dans les couleurs de sommet (occlusion des angles et sous les meubles,
 *    halos chauds des lampes, lumière du jour près de la baie). Matériaux non éclairés
 *    (MeshBasicMaterial) : aucune lumière temps réel ajoutée, rendu stable de jour comme au zoom.
 * 2. Pièces simulées (windows) : « interior mapping » sur un quad posé juste derrière le vitrage.
 *    Le shader lance un rayon dans une boîte virtuelle (murs, sol parquet, plafond, suspension),
 *    traverse deux plans de mobilier (atlas canvas), un voilage et un store : vraie parallaxe.
 *
 * Toutes les pièces partagent 7 draw calls au maximum.
 */
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Textures canvas
// ---------------------------------------------------------------------------
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function toTex(THREE, cv, repeat = 1, srgb = true) {
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Parquet chêne : lames de 18 cm, longueurs variables (2.4 m par répétition)
export function drawParquet(r) {
  const S = 1024, ppm = S / 2.4, cv = canvas(S, S), g = cv.getContext('2d');
  g.fillStyle = '#6b4a30'; g.fillRect(0, 0, S, S);
  const pw = 0.18 * ppm;
  for (let i = 0; i * pw < S; i++) {
    let y = -r() * 1.2 * ppm;
    while (y < S) {
      const L = (0.9 + r() * 0.9) * ppm;
      const l = 52 + r() * 12, s = 32 + r() * 12, h = 28 + r() * 6;
      const x0 = i * pw;
      const grd = g.createLinearGradient(x0, 0, x0 + pw, 0);
      grd.addColorStop(0, `hsl(${h},${s}%,${l - 3}%)`);
      grd.addColorStop(0.5, `hsl(${h},${s}%,${l}%)`);
      grd.addColorStop(1, `hsl(${h},${s}%,${l - 4}%)`);
      g.fillStyle = grd;
      g.fillRect(x0 + 1, y + 1, pw - 2, L - 2);
      // veinage
      g.strokeStyle = `hsla(${h - 4},${s + 5}%,${l - 14}%,0.22)`;
      g.lineWidth = 1;
      for (let k = 0; k < 7; k++) {
        const xx = x0 + 4 + r() * (pw - 8);
        g.beginPath(); g.moveTo(xx, y + 2);
        for (let yy = y; yy < y + L; yy += 20) g.lineTo(xx + Math.sin(yy * 0.02 + k) * 2.5, yy);
        g.stroke();
      }
      y += L;
    }
  }
  return cv;
}

// Atlas des pièces modélisées : tableaux, rangées de livres, tapis, écran
const ATLAS = { W: 2048, H: 1024 };
const REG = {
  art: (i) => [i * 256, 0, 256, 256],
  books: (i) => [i * 1024, 256, 1024, 256],
  rug: (i) => [i * 512, 512, 512, 512],
  screen: [1536, 512, 512, 288],
  door: [1536, 800, 256, 224],
};
function drawAtlas(r) {
  const cv = canvas(ATLAS.W, ATLAS.H), g = cv.getContext('2d');
  const pal = ['#c96f4a', '#d9a55b', '#8a9a7b', '#3f4f63', '#e8dcc6', '#a65d57', '#6f8796', '#2f3a34', '#d8c3a5'];
  // tableaux abstraits
  for (let i = 0; i < 6; i++) {
    const [x, y, w, h] = REG.art(i);
    g.fillStyle = ['#efe9df', '#e9e4da', '#f2ede4', '#dfe3df', '#efe6da', '#e7e2d8'][i]; g.fillRect(x, y, w, h);
    g.save(); g.beginPath(); g.rect(x + 14, y + 14, w - 28, h - 28); g.clip();
    if (i % 3 === 0) {
      for (let k = 0; k < 3; k++) { g.fillStyle = pal[(i + k * 2) % pal.length]; g.beginPath(); g.arc(x + 60 + r() * 140, y + 70 + r() * 120, 30 + r() * 60, 0, 7); g.fill(); }
    } else if (i % 3 === 1) {
      const grd = g.createLinearGradient(x, y, x, y + h); grd.addColorStop(0, '#d9c7a8'); grd.addColorStop(0.55, '#c98d5c'); grd.addColorStop(0.56, '#6e7d6a'); grd.addColorStop(1, '#4e5a4c');
      g.fillStyle = grd; g.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(250,236,210,0.8)'; g.beginPath(); g.arc(x + 170, y + 90, 26, 0, 7); g.fill();
    } else {
      for (let k = 0; k < 4; k++) { g.fillStyle = pal[(i * 3 + k) % pal.length]; g.fillRect(x + 20 + k * 52, y + 30 + r() * 40, 44, 120 + r() * 60); }
      g.strokeStyle = '#2a2a2a'; g.lineWidth = 3; g.beginPath(); g.moveTo(x + 20, y + 200); g.bezierCurveTo(x + 90, y + 120, x + 160, y + 240, x + 236, y + 150); g.stroke();
    }
    g.restore();
    g.strokeStyle = '#1e1e1e'; g.lineWidth = 12; g.strokeRect(x + 6, y + 6, w - 12, h - 12);
  }
  // livres
  for (let i = 0; i < 2; i++) {
    const [x0, y0, w, h] = REG.books(i);
    g.fillStyle = '#9b7552'; g.fillRect(x0, y0, w, h);
    let x = x0;
    while (x < x0 + w - 10) {
      if (r() < 0.12) { // objet décoratif
        const ow = 50 + r() * 50; g.fillStyle = pal[Math.floor(r() * pal.length)];
        g.beginPath(); g.ellipse(x + ow / 2, y0 + h - 50, ow / 2.4, 50, 0, 0, 7); g.fill(); x += ow + 10; continue;
      }
      const bw = 14 + r() * 26, bh = h * (0.55 + r() * 0.4);
      const c = pal[Math.floor(r() * pal.length)];
      g.fillStyle = c; g.fillRect(x, y0 + h - bh, bw, bh);
      g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x + 2, y0 + h - bh + 6, 2, bh - 12);
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + bw - 2, y0 + h - bh, 2, bh);
      g.fillStyle = 'rgba(240,220,180,0.5)'; g.fillRect(x + 3, y0 + h - bh * 0.7, bw - 6, 4);
      x += bw + 1;
    }
    const sh = g.createLinearGradient(0, y0, 0, y0 + h); sh.addColorStop(0, 'rgba(0,0,0,0.35)'); sh.addColorStop(0.3, 'rgba(0,0,0,0)');
    g.fillStyle = sh; g.fillRect(x0, y0, w, h);
  }
  // tapis
  const rugs = [['#e6ddcd', '#b9ab95'], ['#d9d2c5', '#7d7468'], ['#c9cdc9', '#6c7a82']];
  rugs.forEach(([a, b], i) => {
    const [x, y, w, h] = REG.rug(i);
    g.fillStyle = a; g.fillRect(x, y, w, h);
    for (let k = 0; k < 4000; k++) { g.fillStyle = `rgba(${k % 2 ? 255 : 0},${k % 2 ? 255 : 0},${k % 2 ? 255 : 0},0.05)`; g.fillRect(x + r() * w, y + r() * h, 2, 2); }
    g.strokeStyle = b; g.lineWidth = 6;
    if (i === 0) { g.strokeRect(x + 30, y + 30, w - 60, h - 60); g.lineWidth = 2; g.strokeRect(x + 46, y + 46, w - 92, h - 92); }
    if (i === 1) { g.lineWidth = 3; for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++) { const cx = x + 32 + u * 64, cy = y + 32 + v * 64; g.beginPath(); g.moveTo(cx, cy - 26); g.lineTo(cx + 22, cy); g.lineTo(cx, cy + 26); g.lineTo(cx - 22, cy); g.closePath(); g.stroke(); } }
    if (i === 2) { for (let u = 0; u < 6; u++) { g.fillStyle = u % 2 ? b : '#a9b2b4'; g.fillRect(x, y + 60 + u * 70, w, 14); } }
  });
  // écran de télévision éteint (reflet doux)
  { const [x, y, w, h] = REG.screen; const grd = g.createLinearGradient(x, y, x + w, y + h); grd.addColorStop(0, '#2b2f33'); grd.addColorStop(0.45, '#15181b'); grd.addColorStop(1, '#0c0d0f'); g.fillStyle = grd; g.fillRect(x, y, w, h); g.fillStyle = '#050505'; g.fillRect(x, y, w, 8); }
  // porte intérieure (panneau)
  { const [x, y, w, h] = REG.door; g.fillStyle = '#ece8e1'; g.fillRect(x, y, w, h); g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 3; g.strokeRect(x + 30, y + 20, w - 60, h - 40); g.fillStyle = '#9a9a9a'; g.fillRect(x + w - 50, y + h * 0.5, 30, 6); }
  return cv;
}

// Atlas des silhouettes pour les pièces simulées : 2 rangées × 4 cartes de 4 m × 2 m (128 px/m)
// Couleur « lampe » repérée dans le shader : #fff3cf
function drawCards(r) {
  const W = 2048, H = 512, cv = canvas(W, H), g = cv.getContext('2d');
  const LAMP = '#fff3cf';
  const card = (c, row, fn) => {
    g.save();
    g.translate(c * 512, row * 256);
    g.beginPath(); g.rect(0, 0, 512, 256); g.clip();
    const X = (m) => m * 128, Y = (m) => (2 - m) * 128;
    fn(X, Y);
    g.restore();
  };
  const vgrad = (x0, y0, y1, a, b) => { const gr = g.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, a); gr.addColorStop(1, b); return gr; };
  const rr = (x, y, w, h, rad, fill) => { g.fillStyle = fill; g.beginPath(); g.roundRect(x, y, w, h, rad); g.fill(); };
  const plant = (X, Y, x, h, s = 1) => {
    rr(X(x - 0.16 * s), Y(0.38 * s), X(0.32 * s), X(0.38 * s), 6, vgrad(0, Y(0.38 * s), Y(0), '#d8d2c6', '#9c958a'));
    for (let k = 0; k < 22; k++) {
      const a = -Math.PI / 2 + (r() - 0.5) * 2.4, L = (0.25 + r() * 0.45) * h;
      g.save(); g.translate(X(x) + Math.cos(a) * X(L) * 0.5, Y(0.38 * s) + Math.sin(a) * X(L) * 0.55); g.rotate(a);
      g.fillStyle = `hsl(${100 + r() * 30},${30 + r() * 15}%,${16 + r() * 16}%)`;
      g.beginPath(); g.ellipse(0, 0, X(L) * 0.32, X(L) * 0.11, 0, 0, 7); g.fill(); g.restore();
    }
  };
  const lampShade = (cx, cy, w, h) => { g.fillStyle = LAMP; g.beginPath(); g.moveTo(cx - w * 0.35, cy - h / 2); g.lineTo(cx + w * 0.35, cy - h / 2); g.lineTo(cx + w / 2, cy + h / 2); g.lineTo(cx - w / 2, cy + h / 2); g.closePath(); g.fill(); };

  // --- rangée 0 : contre le mur du fond ---
  card(0, 0, (X, Y) => { // canapé + tableau + lampe d'appoint
    rr(X(0.95), Y(0.86), X(2.3), X(0.5), 18, vgrad(0, Y(0.86), Y(0.4), '#cfc6b8', '#a99f91'));
    rr(X(0.85), Y(0.62), X(0.28), X(0.5), 12, '#b8ae9f'); rr(X(3.12), Y(0.62), X(0.28), X(0.5), 12, '#b8ae9f');
    rr(X(1.1), Y(0.47), X(2.0), X(0.24), 14, vgrad(0, Y(0.47), Y(0.23), '#ddd5c8', '#b5ab9c'));
    rr(X(1.25), Y(0.8), X(0.4), X(0.34), 10, '#7b8b72'); rr(X(2.55), Y(0.8), X(0.4), X(0.34), 10, '#c49a6c');
    g.fillStyle = '#2b2622'; g.fillRect(X(1.0), Y(0.12), X(0.05), X(0.12)); g.fillRect(X(3.2), Y(0.12), X(0.05), X(0.12));
    g.fillStyle = '#1f1f1f'; g.fillRect(X(1.6), Y(1.95), X(1.1), X(0.72));
    const gr = g.createLinearGradient(X(1.65), 0, X(2.65), 0); gr.addColorStop(0, '#d8c09a'); gr.addColorStop(0.5, '#c9805a'); gr.addColorStop(1, '#5f6f62'); g.fillStyle = gr; g.fillRect(X(1.65), Y(1.9), X(1.0), X(0.62));
    rr(X(0.25), Y(0.55), X(0.45), X(0.55), 4, '#8a6a4a'); g.fillStyle = '#3a3a3a'; g.fillRect(X(0.46), Y(0.9), X(0.03), X(0.35));
    lampShade(X(0.475), Y(1.0), X(0.32), X(0.22));
  });
  card(1, 0, (X, Y) => { // bibliothèque + buffet + plante
    g.fillStyle = '#a77b52'; g.fillRect(X(0.4), Y(2.0), X(1.8), X(2.0));
    g.fillStyle = '#5a4330'; g.fillRect(X(0.45), Y(1.95), X(1.7), X(1.9));
    const cols = ['#c96f4a', '#d9a55b', '#8a9a7b', '#3f4f63', '#e8dcc6', '#a65d57', '#6f8796'];
    for (let s = 0; s < 5; s++) {
      const y0 = 0.08 + s * 0.38; g.fillStyle = '#a77b52'; g.fillRect(X(0.45), Y(y0), X(1.7), X(0.035));
      let x = 0.5;
      while (x < 2.05) { const bw = 0.03 + r() * 0.05, bh = 0.18 + r() * 0.14; if (r() < 0.15) { x += 0.12; continue; } g.fillStyle = cols[Math.floor(r() * cols.length)]; g.fillRect(X(x), Y(y0 + 0.035 + bh), X(bw), X(bh)); x += bw + 0.004; }
    }
    rr(X(2.5), Y(0.78), X(1.35), X(0.7), 3, vgrad(0, Y(0.78), Y(0.08), '#efebe4', '#c9c3b9'));
    g.strokeStyle = 'rgba(0,0,0,0.15)'; g.lineWidth = 2; g.beginPath(); g.moveTo(X(3.17), Y(0.75)); g.lineTo(X(3.17), Y(0.1)); g.stroke();
    plant(X, Y, 3.55, 0.9, 0.7);
    g.fillStyle = '#2a2a2a'; g.fillRect(X(2.7), Y(1.55), X(0.6), X(0.6)); g.fillStyle = '#d8cdb6'; g.fillRect(X(2.74), Y(1.51), X(0.52), X(0.52));
  });
  card(2, 0, (X, Y) => { // lit + chevets + lampes
    rr(X(1.1), Y(1.15), X(1.8), X(0.65), 14, vgrad(0, Y(1.15), Y(0.5), '#c8bfb2', '#a39887'));
    rr(X(1.0), Y(0.62), X(2.0), X(0.42), 16, vgrad(0, Y(0.62), Y(0.2), '#f2efe9', '#cfc9bf'));
    rr(X(1.2), Y(0.78), X(0.7), X(0.26), 12, '#f6f3ee'); rr(X(2.1), Y(0.78), X(0.7), X(0.26), 12, '#f6f3ee');
    rr(X(1.0), Y(0.45), X(2.0), X(0.22), 10, '#b9a27f');
    for (const x of [0.35, 3.15]) { rr(X(x), Y(0.5), X(0.5), X(0.48), 3, '#9a7351'); g.fillStyle = '#3a3a3a'; g.fillRect(X(x + 0.235), Y(0.85), X(0.03), X(0.33)); lampShade(X(x + 0.25), Y(0.92), X(0.3), X(0.2)); }
    g.fillStyle = '#222'; g.fillRect(X(1.55), Y(1.85), X(0.9), X(0.55)); g.fillStyle = '#b7c3c0'; g.fillRect(X(1.59), Y(1.81), X(0.82), X(0.47));
  });
  card(3, 0, (X, Y) => { // cuisine
    g.fillStyle = '#e9e5de'; g.fillRect(X(0.3), Y(1.48), X(3.4), X(0.52));
    g.fillStyle = '#d7d0c4'; g.fillRect(X(0.3), Y(0.92), X(3.4), X(0.56));
    for (let k = 0; k < 6; k++) { g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 2; g.strokeRect(X(0.3 + k * 0.567), Y(2.0), X(0.567), X(0.52)); }
    g.fillStyle = '#f4f2ee'; g.fillRect(X(0.3), Y(0.94), X(3.4), X(0.04));
    g.fillStyle = vgrad(0, Y(0.9), Y(0.05), '#c49a6c', '#9a7351'); g.fillRect(X(0.3), Y(0.9), X(3.4), X(0.85));
    for (let k = 0; k < 6; k++) { g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(X(0.3 + k * 0.567), Y(0.9), 2, X(0.85)); g.fillStyle = '#3a3a3a'; g.fillRect(X(0.36 + k * 0.567), Y(0.84), X(0.3), 3); }
    g.fillStyle = '#2b2b2b'; g.fillRect(X(1.6), Y(1.25), X(0.6), X(0.25));
    plant(X, Y, 3.3, 0.5, 0.45);
  });
  // --- rangée 1 : mobilier à mi-profondeur ---
  card(0, 1, (X, Y) => { // table à manger + chaises
    g.fillStyle = '#7a5638'; g.fillRect(X(1.1), Y(0.78), X(1.8), X(0.05));
    g.fillStyle = '#5a3f29'; g.fillRect(X(1.2), Y(0.74), X(0.05), X(0.74)); g.fillRect(X(2.75), Y(0.74), X(0.05), X(0.74));
    for (const x of [1.25, 1.85, 2.45]) { rr(X(x), Y(0.92), X(0.42), X(0.45), 8, vgrad(0, Y(0.92), Y(0.47), '#d8cfc0', '#b1a795')); g.fillStyle = '#2f2f2f'; g.fillRect(X(x + 0.04), Y(0.47), X(0.03), X(0.47)); g.fillRect(X(x + 0.35), Y(0.47), X(0.03), X(0.47)); }
    g.fillStyle = '#e9e4da'; g.beginPath(); g.ellipse(X(2.0), Y(0.92), X(0.07), X(0.12), 0, 0, 7); g.fill();
    g.fillStyle = '#4c6a3c'; g.beginPath(); g.arc(X(2.0), Y(1.08), X(0.12), 0, 7); g.fill();
  });
  card(1, 1, (X, Y) => { // fauteuil + lampadaire
    rr(X(0.8), Y(0.85), X(0.95), X(0.55), 20, vgrad(0, Y(0.85), Y(0.3), '#c08b5c', '#8f6440'));
    rr(X(0.72), Y(0.6), X(0.2), X(0.4), 10, '#a87a50'); rr(X(1.63), Y(0.6), X(0.2), X(0.4), 10, '#a87a50');
    rr(X(0.9), Y(0.45), X(0.75), X(0.2), 10, '#c9986a');
    g.fillStyle = '#222'; g.fillRect(X(0.85), Y(0.25), X(0.04), X(0.25)); g.fillRect(X(1.65), Y(0.25), X(0.04), X(0.25));
    g.fillStyle = '#2a2a2a'; g.fillRect(X(2.28), Y(1.45), X(0.03), X(1.45)); g.fillRect(X(2.15), Y(0.03), X(0.3), X(0.03));
    lampShade(X(2.3), Y(1.55), X(0.42), X(0.3));
    rr(X(2.8), Y(0.5), X(0.45), X(0.5), 20, '#d9d2c5');
  });
  card(2, 1, (X, Y) => { plant(X, Y, 0.9, 1.6, 1.25); rr(X(2.3), Y(0.42), X(0.6), X(0.42), 18, '#cfc3ae'); plant(X, Y, 3.4, 0.8, 0.6); });
  card(3, 1, (X, Y) => { // bureau
    g.fillStyle = '#f0ede7'; g.fillRect(X(1.2), Y(0.76), X(1.5), X(0.04));
    g.fillStyle = '#3a3a3a'; g.fillRect(X(1.25), Y(0.72), X(0.03), X(0.72)); g.fillRect(X(2.62), Y(0.72), X(0.03), X(0.72));
    g.fillStyle = '#222'; g.fillRect(X(1.7), Y(1.1), X(0.5), X(0.33)); g.fillStyle = '#3d4a55'; g.fillRect(X(1.72), Y(1.08), X(0.46), X(0.29));
    rr(X(1.65), Y(1.0), X(0.55), X(0.55), 12, '#30343a'); g.fillStyle = '#30343a'; g.fillRect(X(1.9), Y(0.45), X(0.05), X(0.4));
    g.fillStyle = '#2a2a2a'; g.fillRect(X(2.4), Y(1.15), X(0.02), X(0.35)); lampShade(X(2.41), Y(1.2), X(0.2), X(0.14));
  });
  return cv;
}

// ---------------------------------------------------------------------------
// Shader des pièces simulées
// ---------------------------------------------------------------------------
const IM_VERT = /* glsl */`
#include <common>
#include <fog_pars_vertex>
#include <clipping_planes_pars_vertex>
attribute vec2 aUV;
attribute vec3 aT;
attribute vec3 aN;
attribute vec4 aRoom;
attribute vec4 aWin;
varying vec2 vUv;
varying vec3 vPos;
varying vec3 vT;
varying vec3 vN;
varying vec4 vRoom;
varying vec4 vWin;
void main() {
  #include <begin_vertex>
  #include <project_vertex>
  #include <clipping_planes_vertex>
  vUv = aUV;
  vec4 wp = modelMatrix * vec4( transformed, 1.0 );
  vPos = wp.xyz;
  vT = normalize( mat3( modelMatrix ) * aT );
  vN = normalize( mat3( modelMatrix ) * aN );
  vRoom = aRoom;
  vWin = aWin;
  #include <fog_vertex>
}`;

const IM_FRAG = /* glsl */`
uniform sampler2D tCards;
uniform float uGain;
uniform vec2 uBand;
#include <common>
#include <fog_pars_fragment>
#include <clipping_planes_pars_fragment>
varying vec2 vUv;
varying vec3 vPos;
varying vec3 vT;
varying vec3 vN;
varying vec4 vRoom;   // largeur, hauteur, profondeur de la pièce, décalage x de la fenêtre
varying vec4 vWin;    // largeur, hauteur de la fenêtre, allège (bas de fenêtre / sol), type*10 + graine

float h1( float n ) { return fract( sin( n * 12.9898 + 4.1414 ) * 43758.5453 ); }
float h2( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
vec3 toLin( vec3 c ) { return pow( c, vec3( 2.2 ) ); }

// carte de mobilier : rangée, index (0..3), origine x (m), point (x, y) dans la pièce
vec4 card( float row, float idx, float x0, vec2 q ) {
  vec2 u = vec2( ( q.x - x0 ) / 4.0, q.y / 2.0 );
  if ( idx > 3.5 || u.x < 0.0 || u.x > 1.0 || u.y < 0.0 || u.y > 1.0 ) return vec4( 0.0 );
  return texture2D( tCards, vec2( ( idx + u.x ) / 4.0, 1.0 - ( row + 1.0 - u.y ) * 0.5 ) );
}

void main() {
  #include <clipping_planes_fragment>
  if ( vPos.y > uBand.x && vPos.y < uBand.y ) discard;   // étage remplacé par son plan (lots.js)
  float kind = floor( vWin.w / 10.0 );
  float seed = vWin.w - kind * 10.0;
  float RW = vRoom.x, RH = vRoom.y, RD = vRoom.z;
  vec3 B = normalize( cross( vN, vT ) );
  vec3 V = normalize( vPos - cameraPosition );
  vec3 d = vec3( dot( V, vT ), dot( V, B ), max( -dot( V, vN ), 0.03 ) );
  if ( abs( d.x ) < 1e-4 ) d.x = 1e-4;
  if ( abs( d.y ) < 1e-4 ) d.y = 1e-4;
  vec3 p = vec3( vRoom.w + vUv.x * vWin.x, vWin.z + vUv.y * vWin.y, 0.0 );

  // --- intersection avec la boîte de la pièce ---
  vec3 bnd = vec3( d.x > 0.0 ? RW : 0.0, d.y > 0.0 ? RH : 0.0, RD );
  vec3 tt = ( bnd - p ) / d;
  float t = min( min( tt.x, tt.y ), tt.z );
  vec3 h = p + d * t;

  // tirages de la pièce
  float lampOn = step( 0.22, h1( seed * 7.0 + 1.0 ) );
  float wallSel = h1( seed * 3.0 + 2.0 );
  vec3 wallC = wallSel < 0.4 ? vec3( 0.93, 0.90, 0.84 ) : wallSel < 0.7 ? vec3( 0.88, 0.86, 0.81 ) : wallSel < 0.88 ? vec3( 0.84, 0.86, 0.82 ) : vec3( 0.92, 0.86, 0.80 );
  float floorSel = h1( seed * 5.0 + 3.0 );
  vec3 floorC = floorSel < 0.5 ? vec3( 0.62, 0.44, 0.29 ) : floorSel < 0.8 ? vec3( 0.72, 0.56, 0.40 ) : vec3( 0.45, 0.32, 0.22 );
  vec3 lampP = vec3( RW * ( 0.3 + 0.4 * h1( seed + 4.0 ) ), RH - 0.62, RD * ( 0.4 + 0.3 * h1( seed + 5.0 ) ) );
  if ( kind > 0.5 ) { lampOn = 1.0; wallC = vec3( 0.9, 0.9, 0.88 ); floorC = vec3( 0.7, 0.69, 0.66 ); }

  // --- surface touchée : albédo + normale + occlusion des angles ---
  vec3 n; vec3 alb; float occ = 1.0;
  float ex = min( h.x, RW - h.x ), ey = min( h.y, RH - h.y ), ez = min( h.z, RD - h.z );
  if ( t == tt.y ) {
    if ( d.y < 0.0 ) { // sol parquet
      n = vec3( 0.0, 1.0, 0.0 );
      float pw = 0.16, ix = floor( h.x / pw ), off = h1( ix + seed * 13.0 ) * 1.4;
      float iz = floor( ( h.z + off ) / 1.25 );
      float v = h2( vec2( ix, iz ) + seed );
      alb = floorC * ( 0.82 + 0.32 * v ) * ( 0.96 + 0.04 * sin( h.z * 37.0 + v * 9.0 ) );
      float seam = step( fract( h.x / pw ), 0.035 ) + step( fract( ( h.z + off ) / 1.25 ), 0.01 );
      alb *= 1.0 - 0.35 * min( seam, 1.0 );
      // tapis
      if ( kind < 0.5 && h1( seed + 9.0 ) > 0.35 && abs( h.x - RW * 0.5 ) < RW * 0.3 && abs( h.z - RD * 0.58 ) < RD * 0.22 ) {
        alb = mix( vec3( 0.83, 0.79, 0.71 ), vec3( 0.66, 0.68, 0.68 ), step( 0.6, h1( seed + 10.0 ) ) ) * ( 0.92 + 0.08 * h2( floor( h.xz * 60.0 ) ) );
        if ( abs( h.x - RW * 0.5 ) > RW * 0.3 - 0.07 || abs( h.z - RD * 0.58 ) > RD * 0.22 - 0.07 ) alb *= 0.8;
      }
      occ = ( 1.0 - 0.35 * exp( -ex / 0.3 ) ) * ( 1.0 - 0.35 * exp( -( RD - h.z ) / 0.3 ) );
    } else { // plafond
      n = vec3( 0.0, -1.0, 0.0 );
      alb = vec3( 0.92, 0.91, 0.89 );
      occ = ( 1.0 - 0.3 * exp( -ex / 0.35 ) ) * ( 1.0 - 0.3 * exp( -( RD - h.z ) / 0.35 ) );
    }
  } else {
    n = t == tt.z ? vec3( 0.0, 0.0, -1.0 ) : vec3( d.x > 0.0 ? -1.0 : 1.0, 0.0, 0.0 );
    alb = wallC * ( 0.97 + 0.03 * h2( floor( h.xy * 40.0 ) + floor( h.z * 40.0 ) ) );
    if ( h.y < 0.09 ) alb = vec3( 0.9, 0.89, 0.86 );                         // plinthe
    if ( h.y < 0.012 ) alb *= 0.5;
    float along = t == tt.z ? h.x : h.z;
    float alongL = t == tt.z ? RW : RD;
    occ = ( 1.0 - 0.38 * exp( -h.y / 0.3 ) ) * ( 1.0 - 0.28 * exp( -( RH - h.y ) / 0.3 ) ) * ( 1.0 - 0.32 * exp( -min( along, alongL - along ) / 0.3 ) );
    // tableau sur le mur du fond, porte sur un mur latéral
    if ( kind < 0.5 && t == tt.z ) {
      float px = RW * ( 0.3 + 0.4 * h1( seed + 11.0 ) );
      vec2 q = vec2( h.x - px, h.y - 1.55 );
      if ( abs( q.x ) < 0.42 && abs( q.y ) < 0.32 ) {
        alb = abs( q.x ) > 0.38 || abs( q.y ) > 0.28 ? vec3( 0.08 ) : mix( vec3( 0.8, 0.5, 0.33 ), vec3( 0.35, 0.45, 0.42 ), smoothstep( -0.2, 0.2, q.y + 0.1 * sin( q.x * 9.0 + seed ) ) );
      }
    }
    if ( t != tt.z && h1( seed + 12.0 ) > 0.4 && abs( h.z - RD * 0.75 ) < 0.45 && h.y < 2.05 ) {
      alb = abs( h.z - RD * 0.75 ) > 0.4 || h.y > 2.0 ? vec3( 0.95, 0.94, 0.92 ) : vec3( 0.9, 0.88, 0.84 );
    }
  }

  // --- éclairage : ambiance chaude, lampe, jour près de la fenêtre ---
  vec3 amb = vec3( 1.0, 0.88, 0.74 ) * 0.3;
  vec3 Lc = vec3( 1.0, 0.76, 0.5 );
  vec3 toL = lampP - h;
  float dl2 = dot( toL, toL );
  vec3 lamp = Lc * lampOn * 1.55 * max( 0.25, dot( n, toL * inversesqrt( dl2 ) ) ) / ( 1.0 + dl2 / 2.2 );
  vec3 day = vec3( 0.86, 0.9, 1.0 ) * 0.14 * exp( -h.z / 1.3 );
  vec3 col = alb * ( amb * occ + lamp + day );

  // ombre de contact du mobilier sur le sol
  float idxB = kind > 0.5 ? 9.0 : floor( h1( seed + 20.0 ) * 4.0 );
  float idxM = kind > 0.5 ? 9.0 : floor( h1( seed + 21.0 ) * 5.6 );
  float x0B = RW * 0.5 - 2.0 + ( h1( seed + 22.0 ) - 0.5 ) * 1.2;
  float x0M = RW * 0.5 - 2.0 + ( h1( seed + 23.0 ) - 0.5 ) * 1.6;
  float zB = RD - 0.42, zM = RD * ( 0.38 + 0.18 * h1( seed + 24.0 ) );
  if ( t == tt.y && d.y < 0.0 ) {
    float sB = card( 0.0, idxB, x0B, vec2( h.x, 0.2 ) ).a * smoothstep( 0.7, 0.0, abs( h.z - zB + 0.15 ) );
    float sM = card( 1.0, idxM, x0M, vec2( h.x, 0.2 ) ).a * smoothstep( 0.5, 0.0, abs( h.z - zM - 0.05 ) );
    col *= 1.0 - 0.5 * max( sB, sM );
  }

  // --- plans de mobilier (le plus proche d'abord) ---
  vec3 lit = amb + day * 0.5;
  for ( int k = 0; k < 2; k++ ) {
    float row = k == 0 ? 1.0 : 0.0;
    float zp = k == 0 ? zM : zB;
    float tp = ( zp - p.z ) / d.z;
    if ( tp < t ) {
      vec3 hp = p + d * tp;
      vec4 c = card( row, k == 0 ? idxM : idxB, k == 0 ? x0M : x0B, hp.xy );
      if ( c.a > 0.5 ) {
        vec3 tl = lampP - hp;
        float l2 = dot( tl, tl );
        bool glow = c.r > 0.95 && c.g > 0.88 && c.b > 0.7 && c.b < 0.86;
        vec3 fc = toLin( c.rgb );
        col = glow ? vec3( 3.2, 2.4, 1.4 ) * ( 0.25 + 0.75 * lampOn ) : fc * ( lit + Lc * lampOn * 1.3 / ( 1.0 + l2 / 2.2 ) );
        t = tp;
        break;
      }
    }
  }

  // --- suspension (abat-jour sphérique) ---
  {
    vec3 c0 = lampP + vec3( 0.0, 0.12, 0.0 );
    vec3 oc = p - c0;
    float b = dot( oc, d ), cc = dot( oc, oc ) - 0.16 * 0.16, disc = b * b - cc * dot( d, d );
    if ( disc > 0.0 ) {
      float ts = ( -b - sqrt( disc ) ) / dot( d, d );
      if ( ts > 0.0 && ts < t ) col = lampOn > 0.5 ? vec3( 3.0, 2.3, 1.45 ) : vec3( 0.55, 0.52, 0.48 );
    }
    // fil
    vec3 hc = p + d * ( ( c0.z - p.z ) / d.z );
    if ( abs( hc.x - c0.x ) < 0.006 && hc.y > c0.y && ( c0.z - p.z ) / d.z < t ) col = vec3( 0.05 );
  }

  // --- voilage et store au plus près de la vitre ---
  if ( kind < 0.5 ) {
    float hasC = step( 0.55, h1( seed + 30.0 ) );
    float side = step( 0.5, h1( seed + 31.0 ) );
    float cw = vWin.x * ( 0.18 + 0.3 * h1( seed + 32.0 ) );
    vec3 hc = p + d * ( 0.12 / d.z );
    float inC = side > 0.5 ? step( hc.x, vRoom.w + cw ) : step( vRoom.w + vWin.x - cw, hc.x );
    if ( hasC > 0.5 && inC > 0.5 && hc.y < RH ) {
      float fold = 0.5 + 0.5 * sin( hc.x * 46.0 + seed * 3.0 );
      vec3 cc = vec3( 0.9, 0.86, 0.8 ) * ( 0.3 + 0.12 * fold + 0.25 * lampOn );
      col = mix( col, cc, 0.45 + 0.15 * fold );
    }
    float blind = step( 0.82, h1( seed + 33.0 ) );
    float yb = vWin.z + vWin.y * ( 1.0 - ( 0.15 + 0.45 * h1( seed + 34.0 ) ) );
    vec3 hb = p + d * ( 0.04 / d.z );
    if ( blind > 0.5 && hb.y > yb ) col = vec3( 0.86, 0.78, 0.66 ) * ( 0.3 + 0.3 * lampOn ) * ( hb.y - yb < 0.04 ? 0.6 : 1.0 );
  }

  gl_FragColor = vec4( col * uGain, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
  #include <dithering_fragment>
}`;

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------
export function createInteriors(THREE, M, { rooms = [], windows = [] } = {}) {
  const rnd = mulberry32(4242);
  const group = new THREE.Group();
  group.name = 'interieurs';

  const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; }; // Color() convertit sRGB → linéaire
  const texParquet = toTex(THREE, drawParquet(rnd), 1 / 2.4);
  const texAtlas = toTex(THREE, drawAtlas(rnd), 1);
  const texCards = toTex(THREE, drawCards(rnd), 1);
  texCards.wrapS = texCards.wrapT = THREE.ClampToEdgeWrapping;

  // ======================= 1. Pièces modélisées =======================
  const out = { basic: [], floor: [], atlas: [], fabric: [], leaf: [], curtain: [] };

  for (const room of rooms) buildRoom(room);

  function buildRoom(R) {
    const H = R.H, poly = R.poly, items = [], lamps = [], feet = [];
    const r = mulberry32(R.seed || 1);
    let xf = null;
    const walls = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
      // polygone dans le sens trigonométrique vu de dessus (x droite, z vers le bas) : normale intérieure
      walls.push({ a, b, L, t: [dx / L, dz / L], n: [dz / L, -dx / L], win: (R.windowEdges || []).includes(i) });
    }
    // contrôle de l'orientation : la normale doit pointer vers le centre
    { const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length, cz = poly.reduce((s, p) => s + p[1], 0) / poly.length;
      const w = walls[0], mx = (w.a[0] + w.b[0]) / 2, mz = (w.a[1] + w.b[1]) / 2;
      if ((cx - mx) * w.n[0] + (cz - mz) * w.n[1] < 0) for (const w2 of walls) { w2.n = [-w2.n[0], -w2.n[1]]; } }

    // ---- ajout de géométrie (repère pièce, éventuellement repère meuble) ----
    const add = (bucket, g, alb, em = 0, uv = 'box') => {
      if (g.index) g = g.toNonIndexed();
      if (xf) g.applyMatrix4(xf);
      if (uv === 'box') boxUV(g);
      items.push({ bucket, g, alb: typeof alb === 'number' || typeof alb === 'string' ? lin(alb) : alb, em });
    };
    const B = (bucket, x0, x1, y0, y1, z0, z1, alb, em) => {
      const g = new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
      g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      add(bucket, g, alb, em);
    };
    const RB = (bucket, w, h, d, rad, x, y, z, alb, rx = 0, seg = 2) => {
      const g = new RoundedBoxGeometry(w, h, d, seg, rad);
      if (rx) g.rotateX(rx);
      g.translate(x, y, z);
      add(bucket, g, alb);
    };
    const CY = (bucket, rt, rb, h, x, y, z, alb, em, seg = 16, open = false) => {
      const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
      g.translate(x, y + h / 2, z);
      add(bucket, g, alb, em);
    };
    const SPH = (bucket, rad, x, y, z, alb, em) => {
      const g = new THREE.SphereGeometry(rad, 16, 10);
      g.translate(x, y, z);
      add(bucket, g, alb, em);
    };
    // quad texturé (atlas) : coins p0..p3 (sens trigo vu de face), région atlas [x, y, w, h] en px
    const QA = (p, reg, alb = 0xffffff, em = 0) => {
      const [rx, ry, rw, rh] = reg;
      const u0 = rx / ATLAS.W, u1 = (rx + rw) / ATLAS.W, v1 = 1 - ry / ATLAS.H, v0 = 1 - (ry + rh) / ATLAS.H;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([...p[0], ...p[1], ...p[2], ...p[0], ...p[2], ...p[3]], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1], 2));
      g.computeVertexNormals();
      add('atlas', g, alb, em, 'keep');
    };
    const at = (x, z, ry, fn) => {
      const prev = xf;
      const m = new THREE.Matrix4().makeRotationY(ry).setPosition(x, 0, z);
      xf = prev ? prev.clone().multiply(m) : m;
      fn();
      xf = prev;
    };
    const P = (x, y, z) => { const v = new THREE.Vector3(x, y, z); if (xf) v.applyMatrix4(xf); return v; };
    const foot = (x0, x1, z0, z1, h) => {
      const c = [P(x0, 0, z0), P(x1, 0, z0), P(x1, 0, z1), P(x0, 0, z1)];
      feet.push({ x0: Math.min(...c.map(v => v.x)), x1: Math.max(...c.map(v => v.x)), z0: Math.min(...c.map(v => v.z)), z1: Math.max(...c.map(v => v.z)), h });
    };
    const lamp = (x, y, z, I, rad, col = [1.0, 0.7, 0.42]) => { const v = P(x, y, z); lamps.push({ p: v, I: I * 1.35, r2: rad * rad, c: col }); };

    // ---- coque : sol, plafond, murs, plinthes ----
    // La coque est légèrement rentrée par rapport aux faces intérieures des façades et des dalles :
    // posées exactement dans le même plan, les deux surfaces « se battaient » (z-fighting) et
    // dessinaient des rayures sombres qui scintillaient à travers les vitres dès qu'on se déplaçait.
    const INSET = 0.015, F0 = 0.006;
    const xs = [...new Set(poly.map(p => p[0]))].sort((a, b) => a - b);
    const zs = [...new Set(poly.map(p => p[1]))].sort((a, b) => a - b);
    const grid = (lo, hi, step) => { const v = [lo]; for (let x = lo + step; x < hi - 1e-3; x += step) v.push(x); v.push(hi); return v; };
    const refine = (arr, step) => { const o = []; for (let i = 0; i < arr.length - 1; i++) o.push(...grid(arr[i], arr[i + 1], step).slice(0, -1)); o.push(arr[arr.length - 1]); return o; };
    const gx = refine(xs, 0.3), gz = refine(zs, 0.3);
    const inside = (x, z) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
    {
      const pf = [], pc = [];
      for (let i = 0; i < gx.length - 1; i++) for (let j = 0; j < gz.length - 1; j++) {
        const x0 = gx[i], x1 = gx[i + 1], z0 = gz[j], z1 = gz[j + 1];
        if (!inside((x0 + x1) / 2, (z0 + z1) / 2)) continue;
        pf.push(x0, F0, z1, x1, F0, z1, x1, F0, z0, x0, F0, z1, x1, F0, z0, x0, F0, z0);
        pc.push(x0, H - F0, z0, x1, H - F0, z0, x1, H - F0, z1, x0, H - F0, z0, x1, H - F0, z1, x0, H - F0, z1);
      }
      const gf = new THREE.BufferGeometry(); gf.setAttribute('position', new THREE.Float32BufferAttribute(pf, 3)); gf.computeVertexNormals();
      const gc = new THREE.BufferGeometry(); gc.setAttribute('position', new THREE.Float32BufferAttribute(pc, 3)); gc.computeVertexNormals();
      add('floor', gf, [1, 1, 1]);
      add('basic', gc, 0xeceae6);
    }
    for (const w of walls) {
      if (w.win) continue;
      const us = grid(0, w.L, 0.3), vs = grid(0, H, 0.3), pos = [];
      const pt = (u, v) => [w.a[0] + w.t[0] * u + w.n[0] * INSET, v, w.a[1] + w.t[1] * u + w.n[1] * INSET];
      for (let i = 0; i < us.length - 1; i++) for (let j = 0; j < vs.length - 1; j++) {
        const a = pt(us[i], vs[j]), b = pt(us[i + 1], vs[j]), c = pt(us[i + 1], vs[j + 1]), d = pt(us[i], vs[j + 1]);
        pos.push(...a, ...b, ...c, ...a, ...c, ...d);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
      // orientation : la normale calculée doit être la normale intérieure
      const nn = g.attributes.normal;
      if (nn.getX(0) * w.n[0] + nn.getZ(0) * w.n[1] < 0) { const p = g.attributes.position; for (let k = 0; k < p.count; k += 3) { for (const ax of ['X', 'Y', 'Z']) { const t = p['get' + ax](k + 1); p['set' + ax](k + 1, p['get' + ax](k + 2)); p['set' + ax](k + 2, t); } } g.computeVertexNormals(); }
      add('basic', g, R.wall || 0xe9e4da);
      // plinthe
      const th = 0.015, a = pt(0, 0), b = pt(w.L, 0);
      B('basic', a[0], b[0] + w.n[0] * th, 0, 0.08, a[1], b[1] + w.n[1] * th, 0xf2f1ee);
    }

    // ---- primitives de mobilier (repère meuble : sol y = 0, face avant vers +z) ----
    const F = {
      sofa(W, col, pil = [0x7b8b72, 0xc49a6c]) {
        const D = 0.92;
        foot(-W / 2, W / 2, -D / 2, D / 2, 0.5);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) B('basic', sx * (W / 2 - 0.08) - 0.02, sx * (W / 2 - 0.08) + 0.02, 0, 0.1, sz * (D / 2 - 0.08) - 0.02, sz * (D / 2 - 0.08) + 0.02, 0x2a2622);
        RB('fabric', W, 0.24, D, 0.04, 0, 0.22, 0, col);
        RB('fabric', 0.18, 0.36, D, 0.06, -W / 2 + 0.09, 0.5, 0, col);
        RB('fabric', 0.18, 0.36, D, 0.06, W / 2 - 0.09, 0.5, 0, col);
        const n = Math.max(1, Math.round((W - 0.36) / 0.75)), cw = (W - 0.36) / n;
        for (let i = 0; i < n; i++) {
          const x = -W / 2 + 0.18 + cw * (i + 0.5);
          RB('fabric', cw - 0.02, 0.16, D - 0.2, 0.06, x, 0.42, 0.08, col);
          RB('fabric', cw - 0.03, 0.46, 0.2, 0.08, x, 0.7, -D / 2 + 0.16, col, -0.14);
        }
        RB('fabric', 0.42, 0.4, 0.13, 0.07, -W / 2 + 0.45, 0.66, -0.16, pil[0], -0.3);
        if (W > 1.2) RB('fabric', 0.42, 0.4, 0.13, 0.07, W / 2 - 0.45, 0.66, -0.16, pil[1], -0.3);
      },
      armchair(col) { F.sofa(0.86, col, [0xd9cfc0, 0xd9cfc0]); },
      coffeeTable(w, d, wood = 0x8a6444) {
        foot(-w / 2, w / 2, -d / 2, d / 2, 0.4);
        RB('basic', w, 0.04, d, 0.015, 0, 0.38, 0, wood, 0, 1);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) B('basic', sx * (w / 2 - 0.07) - 0.02, sx * (w / 2 - 0.07) + 0.02, 0, 0.36, sz * (d / 2 - 0.07) - 0.02, sz * (d / 2 - 0.07) + 0.02, 0x2a2a2a);
        RB('basic', 0.32, 0.03, 0.22, 0.01, -0.15, 0.415, 0.02, 0xd8cfc0, 0, 1);  // livres
        CY('basic', 0.06, 0.05, 0.14, 0.25, 0.4, -0.05, 0xd8d2c8, 0, 12);       // vase
      },
      diningTable(w, d, n, wood = 0x7a5638, chair = 0xd8cfc0) {
        foot(-w / 2 - 0.3, w / 2 + 0.3, -d / 2 - 0.45, d / 2 + 0.45, 0.75);
        RB('basic', w, 0.045, d, 0.012, 0, 0.75, 0, wood, 0, 1);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) B('basic', sx * (w / 2 - 0.1) - 0.025, sx * (w / 2 - 0.1) + 0.025, 0, 0.73, sz * (d / 2 - 0.1) - 0.025, sz * (d / 2 - 0.1) + 0.025, wood);
        const per = Math.ceil(n / 2);
        for (let s = 0; s < 2; s++) for (let i = 0; i < per; i++) {
          const x = -w / 2 + w * (i + 0.5) / per, z = (s ? 1 : -1) * (d / 2 + 0.22);
          at(x, z, s ? Math.PI : 0, () => F.chair(chair));
        }
        CY('basic', 0.07, 0.05, 0.22, 0.1, 0.77, 0, 0xe9e4da, 0, 12);
        F.leaves(0.1, 0.97, 0, 0.35, 5);
      },
      chair(col) {
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) B('basic', sx * 0.19 - 0.012, sx * 0.19 + 0.012, 0, 0.45, sz * 0.19 - 0.012, sz * 0.19 + 0.012, 0x2b2b2b);
        RB('fabric', 0.44, 0.06, 0.44, 0.025, 0, 0.47, 0, col, 0, 1);
        RB('fabric', 0.44, 0.4, 0.05, 0.02, 0, 0.72, -0.2, col, -0.08, 1);
      },
      pendant(x, z, y, I = 0.9) {
        B('basic', x - 0.004, x + 0.004, y + 0.15, H, z - 0.004, z + 0.004, 0x222222);
        CY('basic', 0.06, 0.2, 0.2, x, y - 0.05, z, 0x2f2a25, 0, 20, true);
        CY('basic', 0.17, 0.17, 0.005, x, y - 0.05, z, 0xfff1d8, 3.5, 20);
        lamp(x, y - 0.25, z, I, 1.5);
      },
      floorLamp(x, z) {
        CY('basic', 0.15, 0.15, 0.02, x, 0, z, 0x2a2a2a, 0, 16);
        B('basic', x - 0.012, x + 0.012, 0, 1.45, z - 0.012, z + 0.012, 0x2a2a2a);
        CY('basic', 0.14, 0.2, 0.28, x, 1.4, z, 0xf5ead6, 1.6, 20, true);
        lamp(x, 1.5, z, 0.75, 1.3);
      },
      tableLamp(x, y, z) {
        CY('basic', 0.06, 0.08, 0.22, x, y, z, 0xc9c1b4, 0, 12);
        CY('basic', 0.09, 0.13, 0.18, x, y + 0.22, z, 0xf5ead6, 1.6, 16, true);
        lamp(x, y + 0.32, z, 0.45, 1.0);
      },
      leaves(x, y, z, h, n) {
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2 + r(), lean = 0.35 + r() * 0.4, L = h * (0.7 + r() * 0.5), wd = L * 0.32;
          const dx = Math.cos(a), dz = Math.sin(a);
          const tip = [x + dx * Math.sin(lean) * L, y + Math.cos(lean) * L, z + dz * Math.sin(lean) * L];
          const px = -dz * wd / 2, pz = dx * wd / 2;
          const g = new THREE.BufferGeometry();
          const p0 = [x + px, y, z + pz], p1 = [x - px, y, z - pz], p2 = [tip[0] - px, tip[1], tip[2] - pz], p3 = [tip[0] + px, tip[1], tip[2] + pz];
          g.setAttribute('position', new THREE.Float32BufferAttribute([...p0, ...p1, ...p2, ...p0, ...p2, ...p3], 3));
          g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
          g.computeVertexNormals();
          add('leaf', g, [0.9, 0.95, 0.85], 0, 'keep');
        }
      },
      plant(x, z, h, pot = 0xd8d2c6) {
        foot(x - 0.2, x + 0.2, z - 0.2, z + 0.2, 0.4);
        CY('basic', 0.17, 0.13, 0.38, x, 0, z, pot, 0, 16);
        CY('basic', 0.155, 0.155, 0.01, x, 0.36, z, 0x3b2d22, 0, 16);
        F.leaves(x, 0.36, z, h, 9);
      },
      bookshelf(w, h, d = 0.36, wood = 0xa77b52) {
        foot(-w / 2, w / 2, -d / 2, d / 2, h);
        B('basic', -w / 2, -w / 2 + 0.03, 0, h, -d / 2, d / 2, wood);
        B('basic', w / 2 - 0.03, w / 2, 0, h, -d / 2, d / 2, wood);
        B('basic', -w / 2, w / 2, 0, h, -d / 2, -d / 2 + 0.015, 0x8c6a4a);
        const n = Math.round(h / 0.38);
        for (let s = 0; s <= n; s++) {
          const y = s * (h - 0.03) / n;
          B('basic', -w / 2 + 0.03, w / 2 - 0.03, y, y + 0.03, -d / 2, d / 2, wood);
          if (s < n) {
            const bh = 0.3, reg = REG.books(s % 2), u = (r() * 0.5) * reg[2];
            QA([[-w / 2 + 0.04, y + 0.03, d / 2 - 0.05], [w / 2 - 0.04, y + 0.03, d / 2 - 0.05], [w / 2 - 0.04, y + 0.03 + bh, d / 2 - 0.05], [-w / 2 + 0.04, y + 0.03 + bh, d / 2 - 0.05]],
              [reg[0] + u, reg[1], reg[2] * 0.5 * (w / 1.8), reg[3]]);
          }
        }
      },
      sideboard(w, h = 0.75, col = 0xece8e1) {
        foot(-w / 2, w / 2, -0.22, 0.22, h);
        RB('basic', w, h - 0.12, 0.44, 0.01, 0, (h + 0.12) / 2, 0, col, 0, 1);
        for (const sx of [-1, 1]) B('basic', sx * (w / 2 - 0.08) - 0.015, sx * (w / 2 - 0.08) + 0.015, 0, 0.12, -0.015, 0.015, 0x2a2a2a);
        for (let i = 1; i < 3; i++) B('basic', -w / 2 + w * i / 3 - 0.002, -w / 2 + w * i / 3 + 0.002, 0.16, h - 0.04, 0.22, 0.225, 0xbdb7ad);
      },
      tv(w) {
        const h = w * 0.56;
        B('basic', -w / 2, w / 2, 1.0, 1.0 + h, -0.03, 0, 0x111111);
        QA([[-w / 2 + 0.01, 1.01, 0.002], [w / 2 - 0.01, 1.01, 0.002], [w / 2 - 0.01, 1.0 + h - 0.01, 0.002], [-w / 2 + 0.01, 1.0 + h - 0.01, 0.002]], REG.screen);
      },
      painting(w, h, y, i) {
        B('basic', -w / 2, w / 2, y, y + h, 0, 0.025, 0x1c1c1c);
        QA([[-w / 2 + 0.02, y + 0.02, 0.027], [w / 2 - 0.02, y + 0.02, 0.027], [w / 2 - 0.02, y + h - 0.02, 0.027], [-w / 2 + 0.02, y + h - 0.02, 0.027]], REG.art(i % 6));
      },
      rug(w, d, i) {
        QA([[-w / 2, 0.008, d / 2], [w / 2, 0.008, d / 2], [w / 2, 0.008, -d / 2], [-w / 2, 0.008, -d / 2]], REG.rug(i % 3));
      },
      door() { // porte sur le mur (face avant vers +z)
        B('basic', -0.5, 0.5, 0, 2.1, 0, 0.03, 0xf4f2ee);
        QA([[-0.44, 0.0, 0.035], [0.44, 0.0, 0.035], [0.44, 2.04, 0.035], [-0.44, 2.04, 0.035]], REG.door);
        B('basic', 0.3, 0.42, 1.02, 1.04, 0.035, 0.07, 0x8f8f8f);
      },
      bed(w, col = 0xf2efe9, head = 0xc8bfb2) {
        const L = 2.1;
        foot(-w / 2, w / 2, 0, L, 0.55);
        RB('fabric', w + 0.1, 1.1, 0.1, 0.03, 0, 0.55, 0.05, head);
        RB('basic', w, 0.25, L, 0.02, 0, 0.15, L / 2 + 0.1, 0x8c6a4a, 0, 1);
        RB('fabric', w - 0.04, 0.24, L - 0.06, 0.08, 0, 0.38, L / 2 + 0.1, col);
        RB('fabric', w + 0.02, 0.06, L * 0.55, 0.03, 0, 0.52, L * 0.68, 0xb9a27f, 0, 1);
        for (const sx of [-1, 1]) RB('fabric', w / 2 - 0.12, 0.16, 0.42, 0.07, sx * w / 4, 0.58, 0.38, 0xf7f4ef);
        for (const sx of [-1, 1]) { at(sx * (w / 2 + 0.33), 0.3, 0, () => { RB('basic', 0.48, 0.48, 0.4, 0.015, 0, 0.24, 0, 0x9a7351, 0, 1); F.tableLamp(0, 0.48, 0); }); }
      },
      desk(w = 1.4) {
        foot(-w / 2, w / 2, -0.35, 0.35, 0.75);
        RB('basic', w, 0.03, 0.7, 0.01, 0, 0.745, 0, 0xf0ede7, 0, 1);
        for (const sx of [-1, 1]) B('basic', sx * (w / 2 - 0.05) - 0.015, sx * (w / 2 - 0.05) + 0.015, 0, 0.73, -0.3, 0.3, 0x2a2a2a);
        B('basic', -0.25, 0.25, 0.76, 1.1, -0.25, -0.23, 0x1a1a1a);
        B('basic', -0.24, 0.24, 0.77, 1.09, -0.229, -0.226, 0x33414d, 0.4);
        at(0, 0.6, Math.PI, () => F.chair(0x30343a));
        F.tableLamp(w / 2 - 0.15, 0.76, -0.15);
      },
      island(w) {
        foot(-w / 2, w / 2, -0.45, 0.45, 0.9);
        RB('basic', w, 0.86, 0.9, 0.01, 0, 0.43, 0, 0xb08a64, 0, 1);
        RB('basic', w + 0.06, 0.04, 0.96, 0.008, 0, 0.88, 0, 0xf4f2ee, 0, 1);
        for (let i = 0; i < 3; i++) at(-w / 2 + w * (i + 0.5) / 3, 0.75, 0, () => { CY('basic', 0.17, 0.17, 0.05, 0, 0.62, 0, 0xc9b9a0, 0, 16); B('basic', -0.012, 0.012, 0, 0.62, -0.012, 0.012, 0x2a2a2a); CY('basic', 0.14, 0.14, 0.015, 0, 0, 0, 0x2a2a2a, 0, 12); });
      },
      kitchen(w) { // linéaire contre le mur (face +z)
        foot(-w / 2, w / 2, -0.3, 0.3, 0.9);
        RB('basic', w, 0.86, 0.6, 0.01, 0, 0.43, 0, 0xe6e1d8, 0, 1);
        RB('basic', w + 0.02, 0.04, 0.62, 0.008, 0, 0.88, 0, 0x3a3836, 0, 1);
        B('basic', -w / 2, w / 2, 0.9, 1.5, -0.3, -0.28, 0xd9d4ca);
        RB('basic', w, 0.7, 0.35, 0.01, 0, 1.85, -0.12, 0xb08a64, 0, 1);
        for (let i = 1; i < Math.round(w / 0.6); i++) { const x = -w / 2 + i * 0.6; B('basic', x - 0.002, x + 0.002, 0.06, 0.84, 0.3, 0.305, 0xb9b3a9); B('basic', x - 0.002, x + 0.002, 1.52, 2.18, 0.055, 0.06, 0x8c6a4a); }
        B('basic', -0.3, 0.3, 0.9, 0.92, -0.25, 0.1, 0x222222);
      },
      curtain(x0, x1, z, h) { // voilage plissé
        const n = Math.max(6, Math.round((x1 - x0) / 0.05)), pos = [];
        for (let i = 0; i < n; i++) {
          const xa = x0 + (x1 - x0) * i / n, xb = x0 + (x1 - x0) * (i + 1) / n;
          const za = z + 0.035 * Math.sin(i * 1.3), zb = z + 0.035 * Math.sin((i + 1) * 1.3);
          pos.push(xa, 0.02, za, xb, 0.02, zb, xb, h, zb, xa, 0.02, za, xb, h, zb, xa, h, za);
        }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
        add('curtain', g, [0.82, 0.8, 0.76]);
        B('basic', x0 - 0.05, x1 + 0.05, h, h + 0.02, z - 0.01, z + 0.01, 0x2a2a2a);
      },
    };

    // ---- mobilier selon la variante ----
    R.furnish(F, at, { H, r });

    // spots encastrés
    for (const s of R.spots || []) { CY('basic', 0.05, 0.05, 0.01, s[0], H - 0.012, s[1], 0xfff3df, 4.0, 14); lamp(s[0], H - 0.2, s[1], 0.32, 1.4); }

    // ---- cuisson de la lumière dans les couleurs de sommet ----
    const winZ = 0; // les baies sont sur le plan z = 0 (repère pièce)
    const light = (p, n) => {
      let occ = 1;
      if (n.y < 0.5) occ *= 1 - 0.35 * Math.exp(-p.y / 0.22);
      if (n.y > -0.5) occ *= 1 - 0.22 * Math.exp(-(H - p.y) / 0.3);
      for (const w of walls) {
        if (n.x * w.n[0] + n.z * w.n[1] > 0.7) continue;
        const ax = p.x - w.a[0], az = p.z - w.a[1];
        const u = Math.max(0, Math.min(w.L, ax * w.t[0] + az * w.t[1]));
        const dx = ax - w.t[0] * u, dz = az - w.t[1] * u;
        occ *= 1 - 0.3 * Math.exp(-Math.hypot(dx, dz) / 0.3);
      }
      if (n.y > 0.5) for (const f of feet) {
        if (p.y > f.h) continue;
        const dx = Math.max(f.x0 - p.x, 0, p.x - f.x1), dz = Math.max(f.z0 - p.z, 0, p.z - f.z1);
        occ *= 1 - 0.45 * Math.exp(-Math.hypot(dx, dz) / 0.16);
      }
      const a = 0.3 * occ * (0.82 + 0.18 * n.y);
      let cr = a * 1.0, cg = a * 0.9, cb = a * 0.78;
      for (const L of lamps) {
        const lx = L.p.x - p.x, ly = L.p.y - p.y, lz = L.p.z - p.z, d2 = lx * lx + ly * ly + lz * lz, dl = Math.sqrt(d2) || 1;
        const nd = Math.max(0.2, (n.x * lx + n.y * ly + n.z * lz) / dl);
        const k = L.I * nd / (1 + d2 / L.r2);
        cr += k * L.c[0]; cg += k * L.c[1]; cb += k * L.c[2];
      }
      const dz = Math.max(0, winZ - p.z), day = 0.16 * Math.exp(-dz / 1.4) * Math.max(0.35, 0.6 + 0.4 * n.z);
      cr += day * 0.9; cg += day * 0.94; cb += day * 1.0;
      return [cr, cg, cb];
    };
    const pv = new THREE.Vector3(), nv = new THREE.Vector3();
    for (const it of items) {
      const g = it.g, p = g.attributes.position, n = g.attributes.normal;
      const col = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        pv.fromBufferAttribute(p, i); nv.fromBufferAttribute(n, i);
        const l = it.em > 0 ? [it.em, it.em * 0.97, it.em * 0.92] : light(pv, nv);
        col[i * 3] = it.alb[0] * l[0]; col[i * 3 + 1] = it.alb[1] * l[1]; col[i * 3 + 2] = it.alb[2] * l[2];
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.applyMatrix4(R.matrix);
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
      if (it.bucket === 'basic' || it.bucket === 'curtain') g.deleteAttribute('uv');
      else if (!g.attributes.uv) boxUV(g);
      g.clearGroups();
      out[it.bucket].push(g);
    }
  }

  // UV projetées (mètres, repère local)
  function boxUV(g) {
    const p = g.attributes.position.array, n = p.length / 3, uv = new Float32Array(n * 2);
    for (let i = 0; i + 2 < n; i += 3) {
      const o = i * 3;
      const ax = p[o + 3] - p[o], ay = p[o + 4] - p[o + 1], az = p[o + 5] - p[o + 2];
      const bx = p[o + 6] - p[o], by = p[o + 7] - p[o + 1], bz = p[o + 8] - p[o + 2];
      const nx = Math.abs(ay * bz - az * by), ny = Math.abs(az * bx - ax * bz), nz = Math.abs(ax * by - ay * bx);
      for (let k = 0; k < 3; k++) {
        const j = i + k, x = p[j * 3], y = p[j * 3 + 1], z = p[j * 3 + 2];
        let u, v;
        if (nx >= ny && nx >= nz) { u = z; v = y; } else if (ny >= nz) { u = x; v = -z; } else { u = x; v = y; }
        uv[j * 2] = u; uv[j * 2 + 1] = v;
      }
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }

  const leafMap = M.leafTropical && M.leafTropical.map;
  const MAT = {
    basic: new THREE.MeshBasicMaterial({ name: 'roomBasic', vertexColors: true }),
    floor: new THREE.MeshBasicMaterial({ name: 'roomFloor', vertexColors: true, map: texParquet }),
    atlas: new THREE.MeshBasicMaterial({ name: 'roomAtlas', vertexColors: true, map: texAtlas }),
    fabric: new THREE.MeshBasicMaterial({ name: 'roomFabric', vertexColors: true, map: (M.fabric && M.fabric.map) || null }),
    leaf: new THREE.MeshBasicMaterial({ name: 'roomLeaf', vertexColors: true, map: leafMap || null, alphaTest: 0.5, side: THREE.DoubleSide, color: leafMap ? 0xffffff : 0x3d5a2a }),
    curtain: new THREE.MeshBasicMaterial({ name: 'roomCurtain', vertexColors: true, color: 0xf4f0e8, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false }),
  };
  MAT.curtain.userData.noAO = true;
  // lumière d'intérieur chaude et un peu tamisée : sinon les pièces paraissent cliniques à côté de la façade
  const WARM = new THREE.Color(0xf3e4cc);
  for (const k of ['basic', 'floor', 'atlas', 'fabric']) MAT[k].color.copy(WARM);
  // tranche de hauteur masquée (étage affiché en plan par lots.js) : discard dans les shaders
  const band = { value: new THREE.Vector2(1e5, -1e5) };
  for (const m of Object.values(MAT)) {
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uBand = band;
      sh.vertexShader = 'varying float vBandY;\n' + sh.vertexShader.replace('#include <project_vertex>',
        '#include <project_vertex>\n  vBandY = ( modelMatrix * vec4( transformed, 1.0 ) ).y;');
      sh.fragmentShader = 'uniform vec2 uBand;\nvarying float vBandY;\n' + sh.fragmentShader.replace('#include <clipping_planes_fragment>',
        'if ( vBandY > uBand.x && vBandY < uBand.y ) discard;\n#include <clipping_planes_fragment>');
    };
    m.customProgramCacheKey = () => 'room-band-v1';
  }
  group.userData.setHiddenBand = (y0, y1) => { band.value.set(y0 ?? 1e5, y1 ?? -1e5); };
  let tris = 0;
  for (const k of Object.keys(out)) {
    if (!out[k].length) continue;
    const geo = mergeGeometries(out[k], false);
    for (const g of out[k]) g.dispose();
    geo.computeBoundingSphere();
    tris += geo.attributes.position.count / 3;
    const m = new THREE.Mesh(geo, MAT[k]);
    m.name = 'interieurs:' + k;
    m.castShadow = false; m.receiveShadow = false;
    // pièces exclues de l'AO = image fantôme de ce qui est derrière : seuls les voilages le sont
    if (k === 'curtain') m.userData.noAO = true;
    group.add(m);
  }

  // ======================= 2. Pièces simulées =======================
  if (windows.length) {
    const pos = [], uv = [], aT = [], aN = [], aRoom = [], aWin = [];
    for (const w of windows) {
      const [p0, p1, p2, p3] = w.corners;  // BL, BR, TR, TL (monde)
      for (const [P, U] of [[p0, [0, 0]], [p1, [1, 0]], [p2, [1, 1]], [p0, [0, 0]], [p2, [1, 1]], [p3, [0, 1]]]) {
        pos.push(...P); uv.push(...U); aT.push(...w.T); aN.push(...w.N);
        aRoom.push(w.RW, w.RH, w.RD, w.xOff); aWin.push(w.w, w.h, w.sill, w.kind * 10 + w.seed);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aUV', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aT', new THREE.Float32BufferAttribute(aT, 3));
    g.setAttribute('aN', new THREE.Float32BufferAttribute(aN, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(aN, 3));   // requis par la passe de normales de l'AO
    g.setAttribute('aRoom', new THREE.Float32BufferAttribute(aRoom, 4));
    g.setAttribute('aWin', new THREE.Float32BufferAttribute(aWin, 4));
    g.computeBoundingSphere();
    // MeshBasicMaterial dont le programme est remplacé : reste compatible avec les patchs
    // génériques du viewer (atténuation d'étage), le brouillard et le tone mapping
    const imU = { tCards: { value: texCards }, uGain: { value: 1.0 }, uBand: band };
    const mat = new THREE.MeshBasicMaterial({ name: 'interiorMapped' });
    mat.onBeforeCompile = (sh) => { Object.assign(sh.uniforms, imU); sh.vertexShader = IM_VERT; sh.fragmentShader = IM_FRAG; };
    mat.customProgramCacheKey = () => 'interior-mapping-v2';
    mat.userData.uniforms = imU;
    // volontairement visible dans le G-buffer de l'AO : masqué, l'AO serait calculée sur ce qui
    // se trouve derrière le quad et dessinerait une image fantôme sur la fenêtre
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = 'interieurs:simulees';
    mesh.castShadow = false; mesh.receiveShadow = false;
    group.add(mesh);
    tris += pos.length / 9;
  }
  group.userData.triangles = tris;
  return group;
}
