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

// Variante chêne clair huilé (pièces modélisées vues par les baies), même tirage que drawParquet
function drawOak(r) {
  const S = 1024, ppm = S / 2.4, cv = canvas(S, S), g = cv.getContext('2d');
  g.fillStyle = '#8a6c4c'; g.fillRect(0, 0, S, S);
  const pw = 0.18 * ppm;
  for (let i = 0; i * pw < S; i++) {
    let y = -r() * 1.2 * ppm;
    while (y < S) {
      const L = (0.9 + r() * 0.9) * ppm;
      const l = 60 + r() * 10, s = 26 + r() * 10, h = 31 + r() * 5;
      const x0 = i * pw;
      const grd = g.createLinearGradient(x0, 0, x0 + pw, 0);
      grd.addColorStop(0, `hsl(${h},${s}%,${l - 3}%)`); grd.addColorStop(0.5, `hsl(${h},${s}%,${l}%)`); grd.addColorStop(1, `hsl(${h},${s}%,${l - 4}%)`);
      g.fillStyle = grd; g.fillRect(x0 + 1, y + 1, pw - 2, L - 2);
      g.strokeStyle = `hsla(${h - 4},${s + 5}%,${l - 16}%,0.18)`; g.lineWidth = 1;
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

// Atlas des pièces simulées : 4 × 4 cellules de 512 px, chaque cellule = 2 m × 2 m (256 px/m),
// origine en bas au centre. Plantes, luminaires, chaises, objets (alpha), tableaux et bibliothèque.
// Les abat-jour sont peints en magenta (clé) : le shader les remplace par un tissu de lin, éteint
// le jour, lumineux quand la lampe de l'appartement est allumée.
export const CARD = {
  fig: 0, olive: 1, monstera: 2, floorLamp: 3, chair: 4, tableLamp: 5, deskChair: 6, decor: 7,
  art0: 8, books: 14, snake: 15,
};
function drawCards(r) {
  const S = 512, cv = canvas(S * 4, S * 4), g = cv.getContext('2d');
  const KEY = '#ff00ff', KEY2 = '#e400e4';
  const cell = (id, fn, clip = true) => {
    g.save();
    g.translate((id % 4) * S, Math.floor(id / 4) * S);
    if (clip) { g.beginPath(); g.rect(6, 6, S - 12, S - 12); g.clip(); }
    const X = (m) => S / 2 + m * 256, Y = (m) => S - m * 256, L = (m) => m * 256;
    fn(X, Y, L);
    g.restore();
  };
  const lg = (x0, y0, x1, y1, stops) => { const gr = g.createLinearGradient(x0, y0, x1, y1); stops.forEach(([o, c]) => gr.addColorStop(o, c)); return gr; };
  const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;
  // feuille ovale avec nervure : base (x, y), longueur L, largeur W, angle a (0 = vers le haut)
  const leaf = (x, y, Lp, Wp, a, h, s, l) => {
    g.save(); g.translate(x, y); g.rotate(a);
    const gr = g.createLinearGradient(-Wp / 2, 0, Wp / 2, 0);
    gr.addColorStop(0, hsl(h, s, l + 7)); gr.addColorStop(0.5, hsl(h, s, l + 2)); gr.addColorStop(1, hsl(h, s + 4, l - 6));
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(0, 0);
    g.bezierCurveTo(Wp * 0.62, -Lp * 0.18, Wp * 0.55, -Lp * 0.82, 0, -Lp);
    g.bezierCurveTo(-Wp * 0.55, -Lp * 0.82, -Wp * 0.62, -Lp * 0.18, 0, 0);
    g.fill();
    g.strokeStyle = hsl(h, s - 8, l + 14, 0.55); g.lineWidth = Math.max(1, Wp * 0.04);
    g.beginPath(); g.moveTo(0, -Lp * 0.05); g.quadraticCurveTo(Wp * 0.05, -Lp * 0.5, 0, -Lp * 0.95); g.stroke();
    g.restore();
  };
  const pot = (X, Y, L, w, h, kind) => {
    const x0 = X(-w / 2), y0 = Y(h), W = L(w), H = L(h);
    if (kind === 'basket') {
      g.fillStyle = lg(x0, 0, x0 + W, 0, [[0, '#8a7050'], [0.45, '#c2a57a'], [1, '#7a6246']]);
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + W, y0); g.lineTo(x0 + W * 0.92, Y(0)); g.lineTo(x0 + W * 0.08, Y(0)); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(60,45,30,0.35)'; g.lineWidth = 2;
      for (let yy = y0 + 6; yy < Y(0); yy += 9) { g.beginPath(); g.moveTo(x0 + 3, yy); g.lineTo(x0 + W - 3, yy); g.stroke(); }
      g.strokeStyle = 'rgba(255,240,210,0.18)';
      for (let xx = x0 + 6; xx < x0 + W; xx += 12) { g.beginPath(); g.moveTo(xx, y0); g.lineTo(xx - 2, Y(0)); g.stroke(); }
    } else {
      const c = { terra: ['#8f4a2e', '#c8774f', '#7a3d25'], white: ['#b9b4aa', '#ece8e0', '#a9a399'], concrete: ['#77756f', '#a9a69e', '#6a6862'], black: ['#141414', '#3a3a3a', '#111'] }[kind];
      g.fillStyle = lg(x0, 0, x0 + W, 0, [[0, c[0]], [0.4, c[1]], [1, c[2]]]);
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + W, y0); g.lineTo(x0 + W * 0.88, Y(0)); g.lineTo(x0 + W * 0.12, Y(0)); g.closePath(); g.fill();
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x0, y0, W, 5);
    }
  };
  const shadeKey = (cx, yTop, wTop, wBot, h, pleats = false) => {
    g.fillStyle = KEY;
    g.beginPath(); g.moveTo(cx - wTop / 2, yTop); g.lineTo(cx + wTop / 2, yTop); g.lineTo(cx + wBot / 2, yTop + h); g.lineTo(cx - wBot / 2, yTop + h); g.closePath(); g.fill();
    if (pleats) { g.strokeStyle = KEY2; g.lineWidth = 3; for (let k = -6; k <= 6; k++) { g.beginPath(); g.moveTo(cx + k * wTop / 13, yTop + 2); g.lineTo(cx + k * wBot / 13, yTop + h - 2); g.stroke(); } }
  };

  // 0 — figuier lyre dans un panier tressé (1,8 m)
  cell(CARD.fig, (X, Y, L) => {
    g.strokeStyle = '#5a4532'; g.lineWidth = 7; g.beginPath(); g.moveTo(X(0), Y(0.36)); g.bezierCurveTo(X(0.03), Y(0.8), X(-0.04), Y(1.2), X(0.01), Y(1.7)); g.stroke();
    for (let k = 0; k < 46; k++) {
      const t = k / 46, y = 0.62 + t * 1.12, side = k % 2 ? 1 : -1;
      const a = side * (0.5 + r() * 0.9) * (1 - t * 0.35) + (r() - 0.5) * 0.3;
      const Lm = 0.2 + r() * 0.12, Wm = Lm * (0.62 + r() * 0.12);
      leaf(X(0.01 * side), Y(y), L(Lm), L(Wm), a, 95 + r() * 18, 38 + r() * 14, 17 + r() * 13 + t * 6);
    }
    pot(X, Y, L, 0.44, 0.38, 'basket');
  });
  // 1 — olivier en pot de terre cuite (1,6 m)
  cell(CARD.olive, (X, Y, L) => {
    g.strokeStyle = '#6b5d4e'; g.lineCap = 'round';
    for (const [w, dx] of [[9, 0], [5, 0.06], [5, -0.07]]) { g.lineWidth = w; g.beginPath(); g.moveTo(X(0), Y(0.4)); g.bezierCurveTo(X(0.05), Y(0.75), X(-0.06 + dx), Y(0.95), X(dx * 2), Y(1.25)); g.stroke(); }
    for (let k = 0; k < 900; k++) {
      const a = r() * Math.PI * 2, rr = Math.sqrt(r()), cx = 0.01 + Math.cos(a) * rr * 0.42, cy = 1.3 + Math.sin(a) * rr * 0.3;
      g.save(); g.translate(X(cx), Y(cy)); g.rotate(r() * Math.PI);
      const l = 34 + r() * 22 - (cy < 1.25 ? 8 : 0);
      g.fillStyle = r() < 0.35 ? hsl(80, 14, l - 2) : hsl(88, 24, l - 14);
      g.beginPath(); g.ellipse(0, 0, L(0.032), L(0.008), 0, 0, 7); g.fill(); g.restore();
    }
    pot(X, Y, L, 0.4, 0.4, 'terra');
  });
  // 2 — monstera en pot blanc (1 m)
  cell(CARD.monstera, (X, Y, L) => {
    for (let k = 0; k < 11; k++) {
      const a = -1.25 + (k / 10) * 2.5 + (r() - 0.5) * 0.2, len = 0.3 + r() * 0.32;
      const tx = Math.sin(a) * len, ty = 0.3 + Math.cos(a) * len * 0.95;
      g.strokeStyle = '#3d5a2a'; g.lineWidth = 4; g.beginPath(); g.moveTo(X(0), Y(0.3)); g.quadraticCurveTo(X(tx * 0.4), Y(ty), X(tx), Y(ty)); g.stroke();
      const Lm = 0.3 + r() * 0.1;
      g.save(); g.translate(X(tx), Y(ty)); g.rotate(a * 1.2);
      g.fillStyle = lg(-L(Lm) / 2, 0, L(Lm) / 2, 0, [[0, '#2c4a22'], [0.5, '#3f6630'], [1, '#22391b']]);
      g.beginPath(); g.ellipse(0, -L(Lm) * 0.45, L(Lm) * 0.5, L(Lm) * 0.45, 0, 0, 7); g.fill();
      g.globalCompositeOperation = 'destination-out'; g.lineWidth = 5;
      for (let s = -3; s <= 3; s++) { if (!s) continue; g.beginPath(); g.moveTo(Math.sign(s) * L(Lm) * 0.52, -L(Lm) * (0.45 + s * 0.09)); g.lineTo(Math.sign(s) * L(Lm) * 0.16, -L(Lm) * (0.45 + s * 0.06)); g.stroke(); }
      g.globalCompositeOperation = 'source-over';
      g.restore();
    }
    pot(X, Y, L, 0.34, 0.32, 'white');
  });
  // 3 — lampadaire : pied noir, abat-jour tambour en lin (clé)
  cell(CARD.floorLamp, (X, Y, L) => {
    g.fillStyle = '#151515'; g.beginPath(); g.ellipse(X(0), Y(0.012), L(0.15), L(0.018), 0, 0, 7); g.fill();
    g.fillRect(X(-0.009), Y(1.36), L(0.018), L(1.35));
    shadeKey(X(0), Y(1.66), L(0.36), L(0.44), L(0.32));
  });
  // 4 — chaise « wishbone » (chêne clair, dossier en arc, assise en corde de papier), vue de face
  cell(CARD.chair, (X, Y, L) => {
    const oakG = (x0, x1) => lg(X(x0), 0, X(x1), 0, [[0, '#9a7650'], [0.5, '#c9a679'], [1, '#8a6844']]);
    g.lineCap = 'round';
    g.strokeStyle = '#a7835a'; g.lineWidth = L(0.028);                       // pieds arrière, montants
    for (const sx of [-1, 1]) { g.beginPath(); g.moveTo(X(sx * 0.2), Y(0)); g.quadraticCurveTo(X(sx * 0.215), Y(0.4), X(sx * 0.205), Y(0.7)); g.stroke(); }
    g.strokeStyle = oakG(-0.27, 0.27); g.lineWidth = L(0.045);              // traverse en arc
    g.beginPath(); g.moveTo(X(-0.27), Y(0.68)); g.quadraticCurveTo(X(0), Y(0.8), X(0.27), Y(0.68)); g.stroke();
    g.fillStyle = '#b8935f';                                               // dossier en Y
    g.beginPath(); g.moveTo(X(-0.07), Y(0.75)); g.quadraticCurveTo(X(0), Y(0.6), X(-0.012), Y(0.47)); g.lineTo(X(0.012), Y(0.47)); g.quadraticCurveTo(X(0), Y(0.6), X(0.07), Y(0.75)); g.closePath(); g.fill();
    g.fillStyle = lg(0, Y(0.48), 0, Y(0.43), [[0, '#e3d3b2'], [1, '#b9a47e']]); g.fillRect(X(-0.23), Y(0.48), L(0.46), L(0.05));   // assise tressée
    g.strokeStyle = 'rgba(120,95,60,0.35)'; g.lineWidth = 1;
    for (let k = -22; k <= 22; k++) { g.beginPath(); g.moveTo(X(k * 0.01), Y(0.48)); g.lineTo(X(k * 0.01), Y(0.43)); g.stroke(); }
    g.fillStyle = oakG(-0.24, 0.24); g.fillRect(X(-0.235), Y(0.435), L(0.47), L(0.02));
    g.strokeStyle = '#b48f62'; g.lineWidth = L(0.032);                       // pieds avant
    for (const sx of [-1, 1]) { g.beginPath(); g.moveTo(X(sx * 0.215), Y(0.43)); g.lineTo(X(sx * 0.225), Y(0)); g.stroke(); }
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(X(-0.21), Y(0.415), L(0.42), L(0.012));
  });
  // 5 — lampe à poser : pied céramique, abat-jour plissé (clé)
  cell(CARD.tableLamp, (X, Y, L) => {
    g.fillStyle = lg(X(-0.1), 0, X(0.1), 0, [[0, '#7c4a33'], [0.4, '#c7835d'], [1, '#6a3c28']]);
    g.beginPath(); g.ellipse(X(0), Y(0.13), L(0.1), L(0.13), 0, 0, 7); g.fill();
    g.fillStyle = '#c9b48c'; g.fillRect(X(-0.012), Y(0.33), L(0.024), L(0.08));
    shadeKey(X(0), Y(0.52), L(0.2), L(0.32), L(0.22), true);
  });
  // 6 — chaise de bureau (coque tissu gris, piétement noir)
  cell(CARD.deskChair, (X, Y, L) => {
    g.strokeStyle = '#151515'; g.lineWidth = 5;
    for (const [a, b] of [[-0.2, -0.16], [0.2, 0.16], [-0.12, -0.1], [0.12, 0.1]]) { g.beginPath(); g.moveTo(X(a), Y(0)); g.lineTo(X(b), Y(0.44)); g.stroke(); }
    g.fillStyle = lg(X(-0.25), 0, X(0.25), 0, [[0, '#4a4b4d'], [0.5, '#76777a'], [1, '#3e3f41']]);
    g.beginPath(); g.roundRect(X(-0.24), Y(0.88), L(0.48), L(0.42), L(0.1)); g.fill();
    g.fillStyle = '#5b5c5f'; g.beginPath(); g.roundRect(X(-0.25), Y(0.5), L(0.5), L(0.07), L(0.03)); g.fill();
  });
  // 7 — objets : pile de livres, vase et branches séchées, coupe
  cell(CARD.decor, (X, Y, L) => {
    [['#d9cfbd', 0.34], ['#6f7d6a', 0.3], ['#2b2b2b', 0.32]].forEach(([c, w], k) => { g.fillStyle = c; g.fillRect(X(-0.4), Y(0.03 * (k + 1)), L(w), L(0.028)); g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(X(-0.4 + w) - 3, Y(0.03 * (k + 1)) + 3, 2, L(0.02)); });
    g.strokeStyle = '#6d5a43'; g.lineWidth = 2;
    for (let k = 0; k < 9; k++) { const a = (r() - 0.5) * 0.9; g.beginPath(); g.moveTo(X(0.12), Y(0.22)); g.quadraticCurveTo(X(0.12 + a * 0.2), Y(0.45), X(0.12 + a * 0.45), Y(0.55 + r() * 0.22)); g.stroke(); }
    for (let k = 0; k < 40; k++) { g.fillStyle = hsl(32, 30, 55 + r() * 20); g.beginPath(); g.arc(X(0.12 + (r() - 0.5) * 0.5), Y(0.5 + r() * 0.26), 3, 0, 7); g.fill(); }
    g.fillStyle = lg(X(0.04), 0, X(0.2), 0, [[0, '#a59c8c'], [0.4, '#e9e3d6'], [1, '#9a9182']]);
    g.beginPath(); g.moveTo(X(0.09), Y(0.24)); g.bezierCurveTo(X(0.0), Y(0.18), X(0.02), Y(0.02), X(0.12), Y(0.0)); g.bezierCurveTo(X(0.22), Y(0.02), X(0.24), Y(0.18), X(0.15), Y(0.24)); g.closePath(); g.fill();
    g.fillStyle = '#3a3734'; g.beginPath(); g.ellipse(X(0.33), Y(0.03), L(0.08), L(0.03), 0, 0, Math.PI); g.fill();
  });
  // 8..13 — tableaux (cellule entière, recadrée par le shader)
  const art = [
    (W, H) => { g.fillStyle = '#e8dccb'; g.fillRect(0, 0, W, H); g.fillStyle = '#c0714b'; g.beginPath(); g.moveTo(W * 0.18, H); g.lineTo(W * 0.18, H * 0.45); g.arc(W * 0.42, H * 0.45, W * 0.24, Math.PI, 0); g.lineTo(W * 0.66, H); g.fill(); g.fillStyle = '#d9a86c'; g.beginPath(); g.arc(W * 0.72, H * 0.3, W * 0.1, 0, 7); g.fill(); g.fillStyle = '#7b8270'; g.fillRect(W * 0.55, H * 0.7, W * 0.3, H * 0.3); },
    (W, H) => { g.fillStyle = '#1f2a3a'; g.fillRect(0, 0, W, H); g.fillStyle = '#c69a52'; g.fillRect(W * 0.08, H * 0.08, W * 0.84, H * 0.5); g.fillStyle = '#8c3f2a'; g.fillRect(W * 0.08, H * 0.64, W * 0.84, H * 0.28); g.globalAlpha = 0.12; for (let k = 0; k < 600; k++) { g.fillStyle = k % 2 ? '#fff' : '#000'; g.fillRect(r() * W, r() * H, 3, 3); } g.globalAlpha = 1; },
    (W, H) => { g.fillStyle = '#f1ece2'; g.fillRect(0, 0, W, H); g.strokeStyle = '#1c1c1c'; g.lineWidth = 5; g.beginPath(); g.moveTo(W * 0.3, H * 0.15); g.bezierCurveTo(W * 0.75, H * 0.1, W * 0.8, H * 0.6, W * 0.45, H * 0.62); g.bezierCurveTo(W * 0.2, H * 0.64, W * 0.35, H * 0.9, W * 0.7, H * 0.88); g.stroke(); g.beginPath(); g.arc(W * 0.52, H * 0.36, W * 0.05, 0, 7); g.stroke(); },
    (W, H) => { g.fillStyle = lg(0, 0, 0, H, [[0, '#a9bccb'], [0.55, '#e6e0d4'], [0.56, '#7d8d93'], [1, '#c8bca6']]); g.fillRect(0, 0, W, H); g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, H * 0.555, W, 3); },
    (W, H) => { g.fillStyle = '#efe8da'; g.fillRect(0, 0, W, H); g.save(); g.translate(W * 0.5, H * 0.9); for (let k = 0; k < 9; k++) { leaf(0, 0, H * (0.45 + r() * 0.3), W * 0.2, (k - 4) * 0.28, 100, 22, 30); } g.restore(); },
    (W, H) => { g.fillStyle = '#d8d3ca'; g.fillRect(0, 0, W, H); g.fillStyle = '#111'; g.beginPath(); g.arc(W * 0.38, H * 0.42, W * 0.22, 0, 7); g.fill(); g.fillStyle = '#b5552f'; g.fillRect(W * 0.52, H * 0.5, W * 0.3, H * 0.34); },
  ];
  art.forEach((fn, i) => cell(CARD.art0 + i, () => fn(S, S), false));
  // 14 — bibliothèque pleine (2 m × 2 m) : 5 tablettes de livres et objets
  cell(CARD.books, (X, Y, L) => {
    g.fillStyle = '#4a3726'; g.fillRect(0, 0, S, S);
    const cols = ['#d9cfbd', '#b5552f', '#6f7d6a', '#1f2a3a', '#c69a52', '#2b2b2b', '#efe8da', '#8c3f2a', '#9aa5a8'];
    for (let s = 0; s < 5; s++) {
      const y0 = s * 0.4 + 0.035;
      g.fillStyle = '#a57a50'; g.fillRect(0, Y(y0), S, L(0.035));
      let x = -0.98;
      while (x < 0.96) {
        if (r() < 0.1) { const w = 0.12 + r() * 0.1; g.fillStyle = r() < 0.5 ? '#e9e3d6' : '#3a3734'; g.beginPath(); g.ellipse(X(x + w / 2), Y(y0 + 0.08), L(w * 0.4), L(0.08), 0, 0, 7); g.fill(); x += w + 0.04; continue; }
        if (r() < 0.08) { for (let k = 0; k < 4; k++) { g.fillStyle = cols[Math.floor(r() * cols.length)]; g.fillRect(X(x), Y(y0 + 0.03 * (k + 1)), L(0.24), L(0.028)); } x += 0.28; continue; }
        const bw = 0.022 + r() * 0.03, bh = 0.2 + r() * 0.12;
        g.fillStyle = cols[Math.floor(r() * cols.length)]; g.fillRect(X(x), Y(y0 + bh), L(bw), L(bh));
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(X(x + bw) - 2, Y(y0 + bh), 2, L(bh));
        x += bw + 0.002;
      }
      g.fillStyle = lg(0, Y(y0 + 0.4), 0, Y(y0 + 0.25), [[0, 'rgba(0,0,0,0.45)'], [1, 'rgba(0,0,0,0)']]); g.fillRect(0, Y(y0 + 0.4), S, L(0.15));
    }
  }, false);
  // 15 — sansevière en pot béton (0,9 m)
  cell(CARD.snake, (X, Y, L) => {
    for (let k = 0; k < 13; k++) {
      const x = (r() - 0.5) * 0.18, h = 0.45 + r() * 0.45, a = (r() - 0.5) * 0.35, w = 0.035 + r() * 0.02;
      g.save(); g.translate(X(x), Y(0.26)); g.rotate(a);
      g.fillStyle = lg(-L(w), 0, L(w), 0, [[0, '#c9b65a'], [0.15, '#2f4a2a'], [0.5, '#456a3a'], [0.85, '#2a4326'], [1, '#c2b052']]);
      g.beginPath(); g.moveTo(-L(w), 0); g.quadraticCurveTo(-L(w) * 1.1, -L(h) * 0.6, 0, -L(h)); g.quadraticCurveTo(L(w) * 1.1, -L(h) * 0.6, L(w), 0); g.fill();
      g.restore();
    }
    pot(X, Y, L, 0.3, 0.28, 'concrete');
  });
  return cv;
}

// ---------------------------------------------------------------------------
// Pièces simulées : aménagement tiré une fois par fenêtre (CPU) et rangé dans une texture flottante
// (une ligne de 48 texels par fenêtre) ; le fragment shader ne fait que lancer les rayons.
// Repère de la pièce : x le long de la façade, y vers le haut depuis le sol, z vers le fond (0 = vitrage).
// ---------------------------------------------------------------------------
const RT = { W: 48, BOX: 0, BOXE: 8, SPR: 16, SPR2: 20, LP: 24, LC: 27, PEND: 30, PAL: 31, ART: 38, RUG: 39, ROOM: 40, COV: 41, COV2: 42, PEND2: 43 };
const BMAT = { linen: 0, oak: 1, lacquer: 2, black: 3, duvet: 4, accA: 5, stone: 6, shelf: 7, walnut: 8, accB: 9, cab: 10, concrete: 11 };
const lin3 = (r, g, b) => [r, g, b];
function layoutRoom(w) {
  const D = new Float32Array(RT.W * 4);
  const set = (i, a, b, c, d) => { D[i * 4] = a; D[i * 4 + 1] = b; D[i * 4 + 2] = c; D[i * 4 + 3] = d; };
  const seed = w.seed;
  const hs = (k) => { const x = Math.sin(seed * 91.17 + k * 12.9898) * 43758.5453; return x - Math.floor(x); };
  const RW = w.RW, RH = w.RH, RD = w.RD, kind = w.kind;
  for (let i = 0; i < 8; i++) { set(RT.BOX + i, 0, 0, 0, 0); set(RT.BOXE + i, -1, -1, -1, 0); }
  for (let k = 0; k < 4; k++) { set(RT.SPR + k, -1, 0, 0, 0); set(RT.SPR2 + k, -99, 1, 0, 0); }
  for (let i = 0; i < 3; i++) { set(RT.LP + i, 0, -50, 0, 9); set(RT.LC + i, 0, 0, 0, 0); }
  set(RT.PEND, 0, -50, 0, 0); set(RT.PEND2, 0, 9, 0, 0);
  set(RT.ART, -9, 0, 0, 0); set(RT.RUG, 0, 0, 0, 0);
  const put = (i, o, cu, y, cv, eu, ey, ev, m) => {
    if (o === 0) { set(RT.BOX + i, cu, y, RD - cv, m); set(RT.BOXE + i, eu, ey, ev, 0); }
    else if (o === 1) { set(RT.BOX + i, cv, y, cu, m); set(RT.BOXE + i, ev, ey, eu, 0); }
    else { set(RT.BOX + i, RW - cv, y, cu, m); set(RT.BOXE + i, ev, ey, eu, 0); }
  };
  const wallPos = (o, u, y, v) => o === 0 ? [u, y, RD - v] : o === 1 ? [v, y, u] : [RW - v, y, u];
  const spr = (k, id, p, x2 = -99, s = 1) => { set(RT.SPR + k, id, p[0], p[1], p[2]); set(RT.SPR2 + k, x2, s, 0, 0); };
  const warm = (() => { const t = hs(16), k = (0.7 + 0.6 * hs(17)); return [k, k * (0.66 + 0.1 * t), k * (0.36 + 0.16 * t)]; })();
  const light = (i, p, I, off) => { set(RT.LP + i, p[0], p[1], p[2], off); set(RT.LC + i, warm[0] * I, warm[1] * I, warm[2] * I, 0); };
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const pick = (k, list) => list[Math.min(list.length - 1, Math.floor(k * list.length))];

  // palette contemporaine chaude : lin, chêne, blancs cassés, accents terre cuite / sauge / ocre
  const linen = pick(hs(1), [lin3(0.62, 0.57, 0.48), lin3(0.62, 0.57, 0.48), lin3(0.55, 0.53, 0.48), lin3(0.71, 0.68, 0.61), lin3(0.40, 0.37, 0.32), lin3(0.36, 0.40, 0.33)]);
  const accs = [lin3(0.42, 0.15, 0.07), lin3(0.25, 0.29, 0.20), lin3(0.56, 0.34, 0.09), lin3(0.06, 0.09, 0.16), lin3(0.60, 0.40, 0.33), lin3(0.74, 0.70, 0.62), lin3(0.22, 0.21, 0.09)];
  const accA = pick(hs(2), accs), accB = pick((hs(2) + 0.37 + 0.3 * hs(3)) % 1, accs);
  let wall = pick(hs(4), [lin3(0.80, 0.76, 0.68), lin3(0.80, 0.76, 0.68), lin3(0.70, 0.66, 0.59), lin3(0.83, 0.82, 0.78), lin3(0.83, 0.82, 0.78), lin3(0.62, 0.60, 0.53), lin3(0.66, 0.53, 0.45)]);
  let floor = pick(hs(5), [lin3(0.60, 0.44, 0.27), lin3(0.60, 0.44, 0.27), lin3(0.66, 0.52, 0.35), lin3(0.52, 0.38, 0.23), lin3(0.32, 0.21, 0.12), lin3(0.56, 0.54, 0.50)]);
  const rugC = pick(hs(12), [lin3(0.66, 0.62, 0.55), lin3(0.48, 0.45, 0.40), lin3(0.55, 0.42, 0.33), lin3(0.30, 0.31, 0.30)]);
  const cab = pick(hs(13), [lin3(0.80, 0.79, 0.75), lin3(0.80, 0.79, 0.75), lin3(0.33, 0.37, 0.30), lin3(0.48, 0.33, 0.20)]);
  let artId = CARD.art0 + Math.floor(hs(6) * 5.99), artFrame = hs(7);
  let door = hs(9) < 0.6 ? (hs(10) < 0.5 ? 1 : 2) : 0, spots = hs(11) > 0.55 ? 1 : 0, back = 0, rugOn = 0, concrete = floor[2] > 0.45 ? 1 : 0;
  const type = Math.floor(hs(14) * 4);
  // seuil d'obscurité propre au logement : quelques-uns restent éteints, d'autres sont allumés en journée
  const ls = hs(15);
  const thr = ls < 0.1 ? -0.2 : ls > 0.86 ? 9 : 0.04 + 0.72 * (ls - 0.1) / 0.76;
  const mir = hs(18) > 0.5, side = mir ? 2 : 1, oside = mir ? 1 : 2;
  let pend = null; // [x, y, z, R, kind, off, I]

  if (kind > 0) {   // circulations : volée d'escalier, plafonnier sur minuterie
    wall = lin3(0.78, 0.77, 0.74); floor = lin3(0.46, 0.45, 0.43); concrete = 1; door = 0; spots = 0;
    for (let i = 0; i < 8; i++) { set(RT.BOX + i, RW * 0.5 + (i - 3.5) * 0.28 * (mir ? -1 : 1), (i + 1) * 0.085, RD - 0.62, BMAT.concrete); set(RT.BOXE + i, 0.141, (i + 1) * 0.085, 0.6, 0); }
    set(RT.LP, RW * 0.5, RH - 0.08, RD * 0.5, 0.3); set(RT.LC, 0.45, 0.38, 0.29, 0);
    set(RT.ROOM, 0, 1, 0, seed);
  } else if (type === 0) {   // séjour : canapé en lin, table basse, buffet, lampadaire, plantes
    const o = hs(20) < 0.62 ? 0 : side, WL = o === 0 ? RW : RD;
    let SW = clamp(WL * 0.6, 1.7, 2.5);
    let cu = o === 0 ? RW * (0.5 + (hs(21) - 0.5) * 0.2) : RD - 0.55 - SW * 0.5;
    cu = clamp(cu, SW * 0.5 + 0.25, WL - SW * 0.5 - 0.25);
    put(0, o, cu, 0.21, 0.5, SW * 0.5, 0.21, 0.48, BMAT.linen);
    put(1, o, cu, 0.61, 0.14, SW * 0.5, 0.2, 0.12, BMAT.linen);
    put(2, o, cu - SW * 0.5 + 0.09, 0.31, 0.5, 0.09, 0.31, 0.48, BMAT.linen);
    put(3, o, cu + SW * 0.5 - 0.09, 0.31, 0.5, 0.09, 0.31, 0.48, BMAT.linen);
    put(4, o, cu - SW * 0.5 + 0.48, 0.59, 0.33, 0.22, 0.18, 0.07, BMAT.accA);
    put(5, o, cu + SW * 0.5 - 0.5, 0.58, 0.33, 0.2, 0.17, 0.07, BMAT.accB);
    put(6, o, cu + (hs(22) - 0.5) * 0.2, 0.19, 1.5, 0.52, 0.19, 0.3, hs(23) < 0.5 ? BMAT.stone : BMAT.oak);
    const sbm = hs(24) < 0.4 ? BMAT.walnut : hs(24) < 0.7 ? BMAT.oak : BMAT.lacquer;
    let sbx = 0;
    if (o === 0) put(7, oside, RD * 0.42, 0.33, 0.23, Math.min(0.75, RD * 0.25), 0.33, 0.22, sbm);
    else { const eu = Math.min(0.8, RW * 0.25); sbx = o === 2 ? 0.25 + eu : RW - 0.25 - eu; put(7, 0, sbx, 0.33, 0.23, eu, 0.33, 0.22, sbm); }
    rugOn = 1; const rc = wallPos(o, cu, 0, 1.35);
    set(RT.RUG, rc[0], rc[2], o === 0 ? SW * 0.5 + 0.25 : 0.85, o === 0 ? 0.85 : SW * 0.5 + 0.25);
    const tc = wallPos(o, cu, 0, 1.5);
    pend = hs(8) < 0.45 ? [tc[0], RH - 0.55 - 0.2 * hs(25), tc[2], 0.17 + 0.06 * hs(26), 0, 0, 0.9] : [tc[0], RH - 0.6 - 0.2 * hs(25), tc[2], 0.27 + 0.07 * hs(26), 1, 0, 0.9];
    const fl = wallPos(o, cu + (SW * 0.5 + 0.32) * (hs(27) < 0.5 ? -1 : 1), 0, 0.35);
    spr(0, CARD.floorLamp, fl); light(1, [fl[0], 1.5, fl[2]], 0.75, 0.08);
    const pl = o === 0 ? [fl[0] < RW * 0.5 ? RW - 0.42 : 0.42, 0, RD - 0.42] : [o === 2 ? 0.45 : RW - 0.45, 0, RD - 0.45];
    spr(1, hs(28) < 0.55 ? CARD.fig : CARD.olive, pl, -99, 0.95 + 0.15 * hs(29));
    spr(2, CARD.decor, [tc[0] + 0.05, 0.38, tc[2]], -99, 0.55);
    if (hs(30) < 0.45) spr(3, hs(31) < 0.5 ? CARD.monstera : CARD.snake, [hs(32) < 0.5 ? 0.4 : RW - 0.4, 0, 0.55 + 0.2 * hs(33)], -99, 0.85);
    if (o === 0) set(RT.ART, cu, 1.5, Math.min(SW * 0.28, 0.62), 0.4); else set(RT.ART, sbx, 1.45, 0.42, 0.32);
  } else if (type === 1) {   // chambre : lit tête contre le mur, chevets et lampes, plaid
    const o = hs(20) < 0.72 ? 0 : side, WL = o === 0 ? RW : RD;
    const BW = WL > 3.4 ? 1.6 : 1.4;
    let cu = o === 0 ? RW * (0.5 + (hs(21) - 0.5) * 0.25) : RD * 0.58;
    cu = clamp(cu, BW * 0.5 + 0.55, WL - BW * 0.5 - 0.55);
    put(0, o, cu, 0.14, 1.05, BW * 0.5 + 0.04, 0.14, 1.04, hs(22) < 0.5 ? BMAT.oak : BMAT.linen);
    put(1, o, cu, 0.40, 1.03, BW * 0.5, 0.13, 1.0, BMAT.duvet);
    put(2, o, cu, 0.46, 1.78, BW * 0.5 + 0.05, 0.09, 0.3, BMAT.accA);
    put(3, o, cu, 0.6, 0.04, BW * 0.5 + 0.12, 0.6, 0.04, hs(23) < 0.5 ? BMAT.linen : BMAT.accB);
    put(4, o, cu, 0.62, 0.29, BW * 0.5 - 0.08, 0.1, 0.13, BMAT.duvet);
    const nm = hs(24) < 0.5 ? BMAT.oak : BMAT.walnut;
    put(5, o, cu - BW * 0.5 - 0.32, 0.24, 0.22, 0.22, 0.24, 0.2, nm);
    put(6, o, cu + BW * 0.5 + 0.32, 0.24, 0.22, 0.22, 0.24, 0.2, nm);
    if (o === 0 && hs(25) < 0.5) put(7, oside, RD * 0.32, 1.1, 0.3, Math.min(0.55, RD * 0.18), 1.1, 0.3, BMAT.lacquer);
    const nA = wallPos(o, cu - BW * 0.5 - 0.32, 0.48, 0.22), nB = wallPos(o, cu + BW * 0.5 + 0.32, 0.48, 0.22);
    if (o === 0) spr(0, CARD.tableLamp, nA, nB[0]); else { spr(0, CARD.tableLamp, nA); spr(1, CARD.tableLamp, nB); }
    light(1, [nA[0], 0.86, nA[2]], 0.4, 0);
    if (hs(26) > 0.3) light(2, [nB[0], 0.86, nB[2]], 0.4, 0.08);
    rugOn = hs(27) > 0.4 ? 1 : 0; const rc = wallPos(o, cu, 0, 1.7);
    set(RT.RUG, rc[0], rc[2], o === 0 ? BW * 0.5 + 0.5 : 0.75, o === 0 ? 0.75 : BW * 0.5 + 0.5);
    const bc = wallPos(o, cu, 0, 1.1);
    pend = [bc[0], RH - 0.45, bc[2], 0.25, 1, hs(28) > 0.6 ? 0.1 : 9, 0.6];
    if (hs(29) < 0.6) spr(3, hs(30) < 0.5 ? CARD.fig : CARD.snake, [hs(31) < 0.5 ? 0.4 : RW - 0.4, 0, o === 0 ? 0.6 : RD - 0.4], -99, hs(30) < 0.5 ? 0.9 : 1.0);
    if (o === 0) set(RT.ART, cu, 1.62, Math.min(BW * 0.32, 0.55), 0.32); else set(RT.ART, RW * 0.5, 1.5, 0.4, 0.3);
  } else if (type === 2) {   // cuisine ouverte + table à manger
    const o = hs(20) < 0.6 ? 0 : side, WL = o === 0 ? RW : RD;
    put(0, o, WL * 0.5, 0.45, 0.31, WL * 0.5 - 0.01, 0.45, 0.3, BMAT.cab);
    put(1, o, WL * 0.5, 0.915, 0.32, WL * 0.5, 0.02, 0.32, BMAT.stone);
    const uo = (hs(21) - 0.5) * WL * 0.2;
    if (hs(22) < 0.6) put(2, o, WL * 0.5 + uo, 1.92, 0.18, WL * 0.3, 0.36, 0.17, BMAT.cab);
    else put(2, o, WL * 0.5 + uo, 1.55, 0.13, WL * 0.32, 0.02, 0.13, BMAT.oak);
    back = o + 1;
    let tz = o === 0 ? RD * 0.44 : RD * 0.5; tz = Math.min(tz, RD - 1.45);
    const tx = o === 0 ? RW * (0.5 + (hs(23) - 0.5) * 0.2) : (o === 2 ? RW * 0.42 : RW * 0.58);
    put(3, 0, tx, 0.745, RD - tz, 0.8, 0.022, 0.45, hs(24) < 0.7 ? BMAT.oak : BMAT.stone);
    const lm = hs(25) < 0.5 ? BMAT.oak : BMAT.black;
    put(4, 0, tx - 0.68, 0.36, RD - tz, 0.035, 0.36, 0.36, lm);
    put(5, 0, tx + 0.68, 0.36, RD - tz, 0.035, 0.36, 0.36, lm);
    spr(0, CARD.chair, [tx - 0.42, 0, tz - 0.52], tx + 0.42);
    spr(1, CARD.chair, [tx - 0.42, 0, tz + 0.52], tx + 0.42);
    spr(2, CARD.decor, [tx - 0.1, 0.766, tz], -99, 0.5);
    if (hs(26) < 0.6) spr(3, hs(27) < 0.5 ? CARD.olive : CARD.monstera, [o === 2 ? 0.45 : RW - 0.45, 0, o === 0 ? 0.6 : RD - 0.45], -99, 0.9);
    pend = [tx, RH - 0.7, tz, 0.2 + 0.07 * hs(28), hs(29) > 0.4 ? 2 : 0, 0, 1.0];
    light(1, wallPos(o, WL * 0.5 + uo, 1.4, 0.25), 0.35, 0.08);
    door = 0;
    if (o !== 0) set(RT.ART, RW * 0.5, 1.5, 0.45, 0.32);
  } else {                   // bureau / chambre d'amis : bureau, bibliothèque, banquette
    const bx = hs(20) < 0.5 ? RW * 0.32 : RW * 0.68;
    put(0, 0, bx, 0.74, 0.36, 0.62, 0.02, 0.32, BMAT.oak);
    put(1, 0, bx - 0.57, 0.36, 0.36, 0.02, 0.36, 0.3, BMAT.black);
    put(2, 0, bx + 0.57, 0.36, 0.36, 0.02, 0.36, 0.3, BMAT.black);
    put(3, 0, bx > RW * 0.5 ? 0.5 : RW - 0.5, 1.0, 0.19, 0.45, 1.0, 0.18, BMAT.shelf);
    put(4, side, RD * 0.4, 0.22, 0.45, Math.min(0.95, RD * 0.3), 0.22, 0.43, BMAT.linen);
    put(5, side, RD * 0.4, 0.58, 0.09, Math.min(0.9, RD * 0.28), 0.16, 0.08, BMAT.accA);
    put(6, 0, bx + 0.12, 0.98, 0.16, 0.27, 0.17, 0.012, BMAT.black);
    spr(0, CARD.deskChair, [bx - 0.05, 0, RD - 0.8]);
    spr(1, CARD.tableLamp, [bx - 0.42, 0.76, RD - 0.22], -99, 0.85);
    if (hs(21) < 0.6) spr(2, hs(22) < 0.5 ? CARD.snake : CARD.monstera, [side === 2 ? 0.4 : RW - 0.4, 0, 0.6], -99, 0.85);
    light(1, [bx - 0.42, 1.08, RD - 0.22], 0.4, 0);
    pend = [RW * 0.5, RH - 0.5, RD * 0.5, 0.24, 1, hs(23) > 0.5 ? 0.08 : 9, 0.7];
    rugOn = hs(24) > 0.5 ? 1 : 0; set(RT.RUG, RW * 0.5, RD * 0.45, RW * 0.25, RD * 0.2);
  }
  if (pend) {
    set(RT.PEND, pend[0], pend[1], pend[2], pend[3]); set(RT.PEND2, pend[4], pend[5], 0, 0);
    light(0, [pend[0], pend[1] - 0.06, pend[2]], pend[6], pend[5]);
  }
  if (kind === 0) set(RT.ROOM, thr, 0, w.w > 0.8 ? 1 : 0, seed);
  // palette (rgb + drapeaux)
  set(RT.PAL + 0, ...linen, spots); set(RT.PAL + 1, ...accA, back); set(RT.PAL + 2, ...accB, artId);
  set(RT.PAL + 3, ...wall, door); set(RT.PAL + 4, ...floor, concrete); set(RT.PAL + 5, ...cab, artFrame); set(RT.PAL + 6, ...rugC, rugOn);
  // habillage de la fenêtre : rien, voilages latéraux, voilage plein, store enrouleur, store vénitien, rideaux épais
  const c = hs(40);
  let ct = c < 0.4 ? 0 : c < 0.65 ? 1 : c < 0.75 ? 2 : c < 0.87 ? 3 : c < 0.94 ? 4 : 5;
  if (kind > 0) ct = 0;
  const cw = w.w * (0.16 + 0.22 * hs(41));
  const op = ct < 3 ? 0.55 + 0.15 * hs(42) : ct === 3 ? 0.9 : ct === 4 ? 0.8 : 0.96;
  const drop = 0.08 + 0.34 * hs(43), ca = hs(45);
  const calb = ct === 5 ? (ca < 0.5 ? lin3(0.66, 0.61, 0.52) : ca < 0.8 ? lin3(0.52, 0.50, 0.46) : lin3(0.46, 0.22, 0.12))
    : ct === 4 ? (ca < 0.8 ? lin3(0.78, 0.77, 0.74) : lin3(0.52, 0.38, 0.24))
    : ct === 3 ? (ca < 0.6 ? lin3(0.74, 0.70, 0.62) : lin3(0.52, 0.50, 0.46)) : lin3(0.85, 0.84, 0.81);
  set(RT.COV, ct, cw, op, drop); set(RT.COV2, ...calb, (ct === 3 || ct === 4) && hs(44) > 0.5 ? 1 : 0);
  return D;
}

const IM_VERT = /* glsl */`
#include <common>
#include <fog_pars_vertex>
#include <clipping_planes_pars_vertex>
attribute vec2 aUV;
attribute vec3 aT;
attribute vec3 aN;
attribute vec4 aRoom;
attribute vec4 aWin;
uniform float uRows;
varying vec2 vUv;
varying vec3 vPos;
varying vec3 vT;
varying vec3 vN;
varying vec4 vRoom;
varying vec4 vWin;
varying float vRow;
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
  vRow = ( aWin.w + 0.5 ) / uRows;
  #include <fog_vertex>
}`;

// Tout est en radiance linéaire : la lumière du jour entre par la fenêtre (source surfacique ciel/sol,
// tache de soleil découpée par le châssis), les lampes s'allument logement par logement à la tombée
// du jour. Mobilier : boîtes intersectées analytiquement (vraie parallaxe, faces ombrées, arêtes
// adoucies) et plans « sprites » (plantes, luminaires, chaises). Au loin (LOD), l'occlusion de contact
// et l'ombre portée du soleil par le mobilier sont omises.
const IM_FRAG = /* glsl */`
uniform sampler2D tCards;
uniform sampler2D tRoom;
uniform float uGain;
uniform vec2 uBand;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uSkyCol;
uniform vec3 uGndCol;
uniform float uDark;
uniform float uExpo;
uniform float uLampK;
uniform float uRefl;
uniform float uDayK;
#include <common>
#include <fog_pars_fragment>
#include <clipping_planes_pars_fragment>
varying vec2 vUv;
varying vec3 vPos;
varying vec3 vT;
varying vec3 vN;
varying vec4 vRoom;   // largeur, hauteur, profondeur de la pièce, décalage x de la fenêtre
varying vec4 vWin;    // largeur, hauteur de la fenêtre, allège, ligne de la texture d'aménagement
varying float vRow;

vec4 F( float i ) { return texture2D( tRoom, vec2( ( i + 0.5 ) / ${RT.W}.0, vRow ) ); }

float gSeed, gThr, gX0, gX1, gY0, gY1, gMull, gA, gSunIn, gCType, gCW, gCOp, gYB, gDayL, gPK;
vec3 gWinC, gLs;

float hs( float k ) { return fract( sin( gSeed * 91.17 + k * 12.9898 ) * 43758.5453 ); }
float h2( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float vnoise( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( h2( i ), h2( i + vec2( 1, 0 ) ), f.x ), mix( h2( i + vec2( 0, 1 ) ), h2( i + vec2( 1, 1 ) ), f.x ), f.y ); }
float lampOn( float off ) { return smoothstep( gThr + off, gThr + off + 0.1, uDark ); }

vec4 card( float id, vec2 q ) {   // q en mètres, origine en bas au centre de la cellule (2 m × 2 m)
  vec2 u = vec2( q.x * 0.5 + 0.5, q.y * 0.5 );
  if ( u.x < 0.008 || u.x > 0.992 || u.y < 0.008 || u.y > 0.992 ) return vec4( 0.0 );
  float cx = mod( id, 4.0 ), cy = floor( id / 4.0 );
  return texture2D( tCards, vec2( ( cx + u.x ) * 0.25, 1.0 - ( cy + 1.0 - u.y ) * 0.25 ) );
}
vec4 cardUV( float id, vec2 u ) {
  u = clamp( u, 0.01, 0.99 );
  float cx = mod( id, 4.0 ), cy = floor( id / 4.0 );
  return texture2D( tCards, vec2( ( cx + u.x ) * 0.25, 1.0 - ( cy + 1.0 - u.y ) * 0.25 ) );
}
float sdBox( vec3 q, vec3 e ) { vec3 d = abs( q ) - e; return length( max( d, 0.0 ) ) + min( max( d.x, max( d.y, d.z ) ), 0.0 ); }

float boxShadow( vec3 o, vec3 d, float tmax ) {
  vec3 inv = 1.0 / d;
  for ( int i = 0; i < 8; i++ ) {
    vec4 c = F( float( i ) ), e = F( float( i + 8 ) );
    if ( e.x <= 0.0 ) continue;
    vec3 t0 = ( c.xyz - e.xyz - o ) * inv, t1 = ( c.xyz + e.xyz - o ) * inv;
    vec3 a = min( t0, t1 ), b = max( t0, t1 );
    float tn = max( max( a.x, a.y ), a.z ), tf = min( min( b.x, b.y ), b.z );
    if ( tf > max( tn, 0.0 ) && tn < tmax ) return 0.0;
  }
  return 1.0;
}
// opacité de l'habillage de fenêtre au point q du plan de la baie
float coverAt( vec2 q ) {
  if ( gCType < 0.5 ) return 0.0;
  if ( gCType < 1.5 || gCType > 4.5 ) return ( q.x < gX0 + gCW || q.x > gX1 - gCW ) ? gCOp : 0.0;
  if ( gCType < 2.5 ) return gCOp;
  return q.y > gYB ? gCOp : 0.0;
}
// éclairement reçu au point h de normale n
vec3 irradiance( vec3 h, vec3 n, float occ, float roomA, bool lod ) {
  vec3 L = gWinC - h; float r2 = dot( L, L ); vec3 Ln = L * inversesqrt( r2 );
  float cs = max( dot( n, Ln ) * 0.85 + 0.15, 0.0 );
  float cw = max( -Ln.z, 0.0 );
  vec3 sky = mix( uGndCol, uSkyCol, smoothstep( -0.3, 0.3, Ln.y ) );
  vec3 E = sky * gDayL * gA * cs * cw / ( r2 + 0.35 * gA ) * ( 1.0 - 0.35 * gCOp * step( 1.5, gCType ) );
  E *= vec3( 1.0, 0.97, 0.92 );
  vec3 Ei = ( uSkyCol + uGndCol ) * gDayL * gA * 1.1 / roomA * vec3( 1.0, 0.92, 0.8 );
  Ei += uSunCol * gSunIn * max( -gLs.z, 0.0 ) * gA * 0.6 * sqrt( gDayL ) / roomA;
  if ( gSunIn > 0.0 ) {
    float nd = max( dot( n, gLs ), 0.0 );
    if ( nd > 0.0 ) {
      float s = -h.z / gLs.z;
      vec3 q = h + gLs * s;
      float inW = smoothstep( gX0, gX0 + 0.02, q.x ) * smoothstep( gX1, gX1 - 0.02, q.x ) * smoothstep( gY0, gY0 + 0.02, q.y ) * smoothstep( gY1, gY1 - 0.02, q.y );
      if ( gMull > 0.5 ) inW *= smoothstep( 0.028, 0.045, abs( q.x - gWinC.x ) );
      if ( inW > 0.0 ) {
        if ( !lod ) inW *= boxShadow( h + n * 0.004, gLs, s );
        E += uSunCol * nd * inW * ( 1.0 - 0.6 * coverAt( q.xy ) ) * 0.85;
      }
    }
  }
  float dayLamp = 0.55 + 0.45 * uDark;
  for ( int i = 0; i < 3; i++ ) {
    vec4 lp = F( float( 24 + i ) );
    vec3 lc = F( float( 27 + i ) ).rgb * lampOn( lp.w ) * uLampK * dayLamp;
    vec3 v = lp.xyz - h; float d2 = dot( v, v ); vec3 vn = v * inversesqrt( d2 );
    // abat-jour : lumière canalisée vers le haut et le bas (festons sur les murs), suspensions vers le bas
    float shape = i == 0 ? ( gPK > 1.5 ? 0.12 + 0.88 * smoothstep( 0.1, 0.7, vn.y ) : gPK > 0.5 ? 0.45 + 0.55 * smoothstep( -0.2, 0.6, vn.y ) : 1.0 )
                         : 0.3 + 0.7 * smoothstep( 0.3, 0.7, abs( vn.y ) );
    E += lc * shape * ( max( dot( n, vn ), 0.0 ) * 0.85 + 0.15 ) / ( d2 + 0.12 );
    Ei += lc * 3.6 / roomA;
  }
  return E * occ + Ei * ( 0.55 + 0.45 * occ );
}

void main() {
  #include <clipping_planes_fragment>
  if ( vPos.y > uBand.x && vPos.y < uBand.y ) discard;   // étage remplacé par son plan (lots.js)
  vec4 room = F( ${RT.ROOM}.0 );
  gThr = room.x; float kind = room.y; gMull = room.z; gSeed = room.w;
  float RW = vRoom.x, RH = vRoom.y, RD = vRoom.z;
  vec3 T = normalize( vT ), N = normalize( vN );
  vec3 V = normalize( vPos - cameraPosition );
  vec3 d = normalize( vec3( dot( V, T ), V.y, max( -dot( V, N ), 0.03 ) ) );
  if ( abs( d.x ) < 1e-4 ) d.x = 1e-4;
  if ( abs( d.y ) < 1e-4 ) d.y = 1e-4;
  gX0 = vRoom.w; gX1 = vRoom.w + vWin.x; gY0 = vWin.z; gY1 = vWin.z + vWin.y;
  vec3 p = vec3( gX0 + vUv.x * vWin.x, gY0 + vUv.y * vWin.y, 0.0 );
  // taille d'un pixel sur le plan de la baie : au-delà de ~2 cm, rendu simplifié
  bool lod = max( length( dFdx( p.xy ) ), length( dFdy( p.xy ) ) ) > 0.02;
  gWinC = vec3( ( gX0 + gX1 ) * 0.5, ( gY0 + gY1 ) * 0.5, 0.0 ); gA = vWin.x * vWin.y;
  gLs = vec3( dot( uSunDir, T ), uSunDir.y, -dot( uSunDir, N ) );
  gSunIn = gLs.z < -0.02 && uSunDir.y > 0.0 ? 1.0 : 0.0;
  gDayL = uDayK * ( kind > 0.5 ? 0.45 : 1.0 );
  float roomA = 2.0 * RW * RD + 2.0 * ( RW + RD ) * RH;
  vec4 cov = F( ${RT.COV}.0 ), cov2 = F( ${RT.COV2}.0 );
  gCType = cov.x; gCW = cov.y; gCOp = cov.z;
  float drop = cov.w;
  if ( cov2.w > 0.5 ) drop = mix( drop, 0.92, smoothstep( 0.55, 0.75, uDark ) );
  gYB = gY1 - vWin.y * drop;

  // ---- lancer du rayon : coque, mobilier, sprites, suspension ----
  vec3 bnd = vec3( d.x > 0.0 ? RW : 0.0, d.y > 0.0 ? RH : 0.0, RD );
  vec3 tt = ( bnd - p ) / d;
  float t = min( min( tt.x, tt.y ), tt.z );
  int hitT = 0;
  float hb = -1.0; vec3 nB = vec3( 0.0 ); vec4 hc = vec4( 0.0 ), he = vec4( 0.0 );
  vec3 inv = 1.0 / d;
  for ( int i = 0; i < 8; i++ ) {
    vec4 c = F( float( i ) ), e = F( float( i + 8 ) );
    if ( e.x <= 0.0 ) continue;
    vec3 t0 = ( c.xyz - e.xyz - p ) * inv, t1 = ( c.xyz + e.xyz - p ) * inv;
    vec3 a = min( t0, t1 ), b = max( t0, t1 );
    float tn = max( max( a.x, a.y ), a.z ), tf = min( min( b.x, b.y ), b.z );
    if ( tf > max( tn, 0.0 ) && tn < t ) {
      t = tn; hb = float( i ); hitT = 1; hc = c; he = e;
      nB = tn == a.x ? vec3( -sign( d.x ), 0.0, 0.0 ) : tn == a.y ? vec3( 0.0, -sign( d.y ), 0.0 ) : vec3( 0.0, 0.0, -1.0 );
    }
  }
  vec4 sc = vec4( 0.0 ); float sid = -1.0;
  for ( int k = 0; k < 4; k++ ) {
    vec4 s = F( float( 16 + k ) );
    if ( s.x < 0.0 ) continue;
    float tp = s.w / d.z;
    if ( tp < t ) {
      vec4 s2 = F( float( 20 + k ) );
      vec3 hp = p + d * tp;
      vec4 c = card( s.x, vec2( hp.x - s.y, hp.y - s.z ) / s2.y );
      if ( s2.x > -90.0 && c.a < 0.5 ) c = card( s.x, vec2( hp.x - s2.x, hp.y - s.z ) / s2.y );
      if ( c.a > 0.5 ) { t = tp; hitT = 2; sc = c; sid = s.x; }
    }
  }
  vec4 pd = F( ${RT.PEND}.0 ), pd2 = F( ${RT.PEND2}.0 );
  float pendOn = pd.w > 0.0 ? lampOn( pd2.y ) : 0.0;
  gPK = pd2.x;
  if ( pd.w > 0.0 ) {
    // lanterne papier : ellipsoïde aplati (1 : 0,62) ; globe et dôme : sphère
    vec3 sq = vec3( 1.0, pd2.x > 0.5 && pd2.x < 1.5 ? 1.6 : 1.0, 1.0 );
    vec3 oc = ( p - pd.xyz ) * sq, ds = d * sq;
    float aa = dot( ds, ds ), b = dot( oc, ds ), cc = dot( oc, oc ) - pd.w * pd.w, disc = b * b - aa * cc;
    if ( disc > 0.0 ) {
      float ts = ( -b - sqrt( disc ) ) / aa;
      vec3 hp = p + d * ts;
      if ( ts > 0.0 && ts < t && ( pd2.x < 1.5 || hp.y > pd.y - pd.w * 0.15 ) ) { t = ts; hitT = 3; }
    }
  }
  vec3 h = p + d * t;

  // ---- matière au point touché ----
  vec3 n = vec3( 0.0, 1.0, 0.0 ), alb = vec3( 0.5 ), em = vec3( 0.0 );
  float occ = 1.0, spec = 0.0;
  float ex = min( h.x, RW - h.x ), ez = RD - h.z;
  if ( hitT == 0 ) {
    if ( t == tt.y && d.y < 0.0 ) {                 // sol : parquet de chêne (ou béton ciré), tapis
      n = vec3( 0.0, 1.0, 0.0 );
      vec4 fl = F( ${RT.PAL + 4}.0 );
      if ( fl.w > 0.5 ) alb = fl.rgb * ( 0.95 + 0.08 * vnoise( h.xz * 6.0 ) );
      else {
        float pw = 0.18, ix = floor( h.x / pw ), off = h2( vec2( ix, gSeed ) ) * 1.6;
        float iz = floor( ( h.z + off ) / 1.4 );
        float v = h2( vec2( ix, iz ) + gSeed );
        alb = fl.rgb * ( 0.84 + 0.3 * v ) * ( 0.94 + 0.06 * vnoise( vec2( h.x * 30.0, h.z * 3.0 ) + v * 7.0 ) );
        float seam = max( 1.0 - smoothstep( 0.0, 0.006, abs( fract( h.x / pw + 0.5 ) - 0.5 ) * pw ), 1.0 - smoothstep( 0.0, 0.004, abs( fract( ( h.z + off ) / 1.4 + 0.5 ) - 0.5 ) * 1.4 ) );
        alb *= 1.0 - 0.3 * seam;
      }
      spec = 1.0;
      vec4 rg = F( ${RT.RUG}.0 ), rgc = F( ${RT.PAL + 6}.0 );
      if ( rgc.w > 0.5 && abs( h.x - rg.x ) < rg.z && abs( h.z - rg.y ) < rg.w ) {
        vec2 rq = abs( h.xz - rg.xy ) - rg.zw;
        alb = rgc.rgb * ( 0.9 + 0.1 * vnoise( h.xz * 90.0 ) ) * ( max( rq.x, rq.y ) > -0.08 ? 0.82 : 1.0 );
        spec = 0.0;
      }
      occ = ( 1.0 - 0.4 * exp( -ex / 0.25 ) ) * ( 1.0 - 0.4 * exp( -ez / 0.25 ) );
    } else if ( t == tt.y ) {                       // plafond (+ spots encastrés)
      n = vec3( 0.0, -1.0, 0.0 );
      alb = vec3( 0.82, 0.81, 0.78 );
      occ = ( 1.0 - 0.3 * exp( -ex / 0.35 ) ) * ( 1.0 - 0.3 * exp( -ez / 0.35 ) ) * ( 1.0 - 0.25 * exp( -h.z / 0.3 ) );
      if ( F( ${RT.PAL}.0 ).w > 0.5 ) {
        vec2 sq = vec2( h.x - RW * 0.5, h.z - RD * 0.5 ), g = vec2( RW * 0.26, RD * 0.26 );
        vec2 f = abs( sq ) - g;
        if ( length( vec2( min( abs( f.x ), abs( sq.x ) ), min( abs( f.y ), abs( sq.y ) ) ) ) < 0.04 && abs( sq.x ) < g.x + 0.05 && abs( sq.y ) < g.y + 0.05 ) { alb = vec3( 0.6 ); em = vec3( 1.0, 0.82, 0.62 ) * 4.0 * pendOn; }
      }
    } else {                                        // murs
      bool bk = t == tt.z;
      n = bk ? vec3( 0.0, 0.0, -1.0 ) : vec3( d.x > 0.0 ? -1.0 : 1.0, 0.0, 0.0 );
      float wallIdx = bk ? 0.0 : ( d.x > 0.0 ? 2.0 : 1.0 );
      vec4 wl = F( ${RT.PAL + 3}.0 );
      alb = wl.rgb * ( 0.97 + 0.04 * vnoise( h.xy * 9.0 + h.z * 7.0 ) );
      float along = bk ? h.x : h.z, alongL = bk ? RW : RD;
      if ( h.y < 0.08 ) alb = vec3( 0.80, 0.79, 0.76 ) * ( h.y > 0.075 ? 0.8 : 1.0 );   // plinthe
      occ = ( 1.0 - 0.4 * exp( -h.y / 0.25 ) ) * ( 1.0 - 0.28 * exp( -( RH - h.y ) / 0.3 ) ) * ( 1.0 - 0.35 * exp( -min( along, alongL - along ) / 0.28 ) );
      if ( !bk ) occ *= 1.0 - 0.3 * exp( -h.z / 0.25 );
      float kback = F( ${RT.PAL + 1}.0 ).w;
      if ( kback > 0.5 && abs( wallIdx - ( kback - 1.0 ) ) < 0.1 && h.y > 0.935 && h.y < 1.54 ) {   // crédence en zellige
        vec2 tq = vec2( along, h.y ) / vec2( 0.13, 0.065 ); tq.x += 0.5 * mod( floor( tq.y ), 2.0 );
        vec2 tf = fract( tq ), ti = floor( tq );
        alb = mix( vec3( 0.78, 0.76, 0.70 ), vec3( 0.62, 0.66, 0.60 ), step( 0.6, hs( 50.0 ) ) ) * ( 0.85 + 0.25 * h2( ti + gSeed ) );
        if ( min( min( tf.x, 1.0 - tf.x ) * 0.13, min( tf.y, 1.0 - tf.y ) * 0.065 ) < 0.003 ) alb = vec3( 0.7, 0.68, 0.64 );
        spec = 0.6;
      }
      vec4 art = F( ${RT.ART}.0 );
      if ( bk && art.x > -5.0 ) {                    // tableau encadré (passe-partout une fois sur deux)
        vec2 q = vec2( h.x - art.x, h.y - art.y );
        if ( abs( q.x ) < art.z && abs( q.y ) < art.w ) {
          float frame = F( ${RT.PAL + 5}.0 ).w, fr = 0.022, pp = frame < 0.45 ? 0.07 : 0.0;
          vec2 u = ( q + art.zw ) / ( 2.0 * art.zw );
          if ( abs( q.x ) > art.z - fr || abs( q.y ) > art.w - fr ) alb = frame < 0.7 ? vec3( 0.03 ) : vec3( 0.45, 0.31, 0.18 );
          else if ( abs( q.x ) > art.z - fr - pp || abs( q.y ) > art.w - fr - pp ) alb = vec3( 0.82, 0.8, 0.76 );
          else alb = cardUV( F( ${RT.PAL + 2}.0 ).w, ( u - 0.5 ) * vec2( 1.0, art.w / art.z ) * 0.9 + 0.5 ).rgb;
        } else if ( q.y < -art.w && q.y > -art.w - 0.05 && abs( q.x ) < art.z ) occ *= 0.85;
      }
      if ( !bk && wl.w > 0.5 && abs( wallIdx - wl.w ) < 0.1 ) {   // porte intérieure
        float dz = h.z - RD * 0.78;
        if ( abs( dz ) < 0.48 && h.y < 2.12 ) {
          alb = ( abs( dz ) > 0.42 || h.y > 2.06 ) ? vec3( 0.84, 0.83, 0.80 ) : vec3( 0.80, 0.78, 0.74 );
          if ( abs( dz + 0.3 ) < 0.07 && abs( h.y - 1.02 ) < 0.012 ) alb = vec3( 0.06 );
        }
      }
    }
  } else if ( hitT == 1 ) {                         // mobilier
    vec3 c = hc.xyz, e = he.xyz; float m = hc.w;
    n = nB;
    vec3 lq = h - c;
    // arêtes arrondies : la normale s'incline près des bords (rayon selon la matière)
    float rad = ( m < 0.5 || m == 4.0 || m == 5.0 || m == 9.0 ) ? 0.06 : m == 11.0 ? 0.005 : 0.012;
    vec3 ed = e - abs( lq ), bend = vec3( 0.0 );
    if ( abs( n.x ) < 0.5 ) bend.x = sign( lq.x ) * ( 1.0 - smoothstep( 0.0, rad, ed.x ) );
    if ( abs( n.y ) < 0.5 ) bend.y = sign( lq.y ) * ( 1.0 - smoothstep( 0.0, rad, ed.y ) );
    if ( abs( n.z ) < 0.5 ) bend.z = sign( lq.z ) * ( 1.0 - smoothstep( 0.0, rad, ed.z ) );
    n = normalize( n + bend * 0.9 );
    vec2 fu = abs( nB.x ) > 0.5 ? lq.zy : abs( nB.y ) > 0.5 ? lq.xz : lq.xy;
    float lng = abs( nB.y ) > 0.5 ? ( e.x > e.z ? lq.x : lq.z ) : ( abs( nB.x ) > 0.5 ? lq.z : lq.x );
    if ( m < 0.5 ) {                                // lin (coussins d'assise marqués)
      alb = F( ${RT.PAL}.0 ).rgb * ( 0.92 + 0.12 * vnoise( fu * 160.0 ) );
      float L2 = max( e.x, e.z );
      if ( L2 > 0.6 ) { float k = e.x > e.z ? lq.x : lq.z; float nc = max( 1.0, floor( 2.0 * L2 / 0.8 ) ); float f = fract( ( k / ( 2.0 * L2 ) + 0.5 ) * nc ); alb *= 0.75 + 0.25 * smoothstep( 0.0, 0.03, min( f, 1.0 - f ) * 2.0 * L2 / nc ); }
    }
    else if ( m < 1.5 ) { alb = vec3( 0.50, 0.35, 0.21 ) * ( 0.85 + 0.2 * vnoise( vec2( lng * 4.0, ( abs( nB.y ) > 0.5 ? ( e.x > e.z ? lq.z : lq.x ) : lq.y ) * 60.0 ) ) ); spec = 0.4; }
    else if ( m < 2.5 || m == 10.0 ) {             // façades laquées : joints et poignées
      alb = m < 2.5 ? vec3( 0.80, 0.79, 0.75 ) : F( ${RT.PAL + 5}.0 ).rgb; spec = 0.3;
      if ( nB.z < -0.5 ) { float dw = 0.6; float f = fract( ( h.x - c.x + e.x ) / dw ); if ( min( f, 1.0 - f ) * dw < 0.004 || abs( h.y - ( c.y + e.y ) ) < 0.006 ) alb *= 0.45; if ( abs( f - 0.5 ) * dw < 0.12 && abs( h.y - ( c.y + e.y - 0.05 ) ) < 0.006 ) alb = vec3( 0.08 ); }
    }
    else if ( m < 3.5 ) { alb = vec3( 0.035 ); spec = 0.5; if ( e.z < 0.02 && nB.z < -0.5 ) { alb = vec3( 0.01 ); em = vec3( 0.18, 0.24, 0.32 ) * 0.4 * smoothstep( 0.3, 0.6, uDark ) * step( 0.5, hs( 60.0 ) ); } }
    else if ( m < 4.5 ) { alb = vec3( 0.86, 0.85, 0.82 ) * ( 0.93 + 0.1 * vnoise( fu * 9.0 ) ); }
    else if ( m < 5.5 ) { alb = F( ${RT.PAL + 1}.0 ).rgb * ( 0.9 + 0.15 * vnoise( fu * 120.0 ) ); }
    else if ( m < 6.5 ) { alb = vec3( 0.70, 0.64, 0.54 ) * ( 0.9 + 0.12 * vnoise( fu * vec2( 12.0, 40.0 ) ) ); spec = 0.5; }
    else if ( m < 7.5 ) { alb = vec3( 0.42, 0.29, 0.17 ); if ( nB.z < -0.5 ) alb = cardUV( ${CARD.books}.0, ( fu + e.xy ) / ( 2.0 * e.xy ) ).rgb; }
    else if ( m < 8.5 ) { alb = vec3( 0.17, 0.10, 0.06 ) * ( 0.85 + 0.25 * vnoise( vec2( lng * 4.0, lq.y * 60.0 ) ) ); spec = 0.5; }
    else if ( m < 9.5 ) { alb = F( ${RT.PAL + 2}.0 ).rgb * ( 0.9 + 0.15 * vnoise( fu * 120.0 ) ); }
    else { alb = vec3( 0.55, 0.54, 0.51 ) * ( 0.92 + 0.1 * vnoise( fu * 20.0 ) ); if ( nB.y > 0.5 ) alb *= 1.08; }
  } else if ( hitT == 2 ) {                         // sprites (abat-jour : clé magenta)
    n = vec3( 0.0, 0.0, -1.0 );
    alb = sc.rgb;
    float key = clamp( ( min( sc.r, sc.b ) - sc.g ) * 1.6, 0.0, 1.0 );
    if ( key > 0.0 ) {
      float on = 0.0;
      for ( int i = 1; i < 3; i++ ) { vec4 lp = F( float( 24 + i ) ); vec3 v = lp.xyz - h; if ( dot( v, v ) < 0.5 ) on = max( on, lampOn( lp.w ) * length( F( float( 27 + i ) ).rgb ) ); }
      alb = mix( alb, vec3( 0.80, 0.75, 0.64 ) * ( 0.85 + 0.15 * sc.r ), key );
      em = vec3( 1.0, 0.78, 0.52 ) * key * on * uLampK * 3.2 * ( 0.85 + 0.15 * sc.r );
    }
    if ( sid < 2.5 || sid == ${CARD.snake}.0 ) n = normalize( vec3( 0.0, 0.35, -1.0 ) );
  } else {                                          // suspension : globe opalin, lanterne papier ou dôme noir
    n = normalize( ( h - pd.xyz ) * ( pd2.x > 0.5 && pd2.x < 1.5 ? vec3( 1.0, 2.56, 1.0 ) : vec3( 1.0 ) ) );
    if ( pd2.x > 1.5 ) { alb = vec3( 0.03 ); spec = 0.6; if ( n.y < -0.2 ) { alb = vec3( 0.8 ); em = vec3( 1.0, 0.8, 0.55 ) * 6.0 * pendOn; } }
    else { alb = vec3( 0.86, 0.85, 0.82 ); float lim = max( dot( n, -d ), 0.0 ); em = vec3( 1.0, 0.8, 0.56 ) * ( pd2.x > 0.5 ? 1.2 : 1.6 ) * ( 0.35 + 0.65 * lim * lim ) * pendOn * uLampK;
      if ( pd2.x > 0.5 ) { em *= 0.82 + 0.18 * sin( ( h.y - pd.y ) * 120.0 ); alb *= 0.9 + 0.1 * sin( ( h.y - pd.y ) * 120.0 ); } }
  }

  // occlusion de contact du mobilier (ombres douces au sol, sur les murs et entre meubles)
  if ( !lod ) {
    for ( int i = 0; i < 8; i++ ) {
      vec4 c = F( float( i ) ), e = F( float( i + 8 ) );
      if ( e.x <= 0.0 || float( i ) == hb ) continue;
      occ *= 1.0 - 0.55 * exp( -max( sdBox( h - c.xyz, e.xyz ), 0.0 ) / 0.09 );
    }
  } else if ( hitT == 0 && n.y > 0.5 ) occ *= 0.85;
  if ( hitT == 2 && sid > 2.5 && sid != ${CARD.snake}.0 ) occ *= 0.9;

  vec3 col = alb * irradiance( h + n * 0.002, n, occ, roomA, lod ) * RECIPROCAL_PI + em;
  if ( spec > 0.0 && !lod && uDark > 0.05 ) {       // reflets des lampes sur le parquet et les plans vernis
    for ( int i = 0; i < 3; i++ ) {
      vec4 lp = F( float( 24 + i ) );
      vec3 lc = F( float( 27 + i ) ).rgb * lampOn( lp.w ) * uLampK;
      vec3 Lv = lp.xyz - h; float l2 = dot( Lv, Lv ); vec3 Hv = normalize( Lv * inversesqrt( l2 ) - d );
      col += lc * spec * 0.06 * pow( max( dot( n, Hv ), 0.0 ), 60.0 ) / ( l2 + 0.3 );
    }
  }
  if ( pd.w > 0.0 ) {                               // fil de la suspension
    float tc = pd.z / d.z; vec3 hcw = p + d * tc;
    if ( tc < t && abs( hcw.x - pd.x ) < 0.005 && hcw.y > pd.y && hcw.y < RH ) col = vec3( 0.01 );
  }
  col *= 1.0 - 0.06 * smoothstep( 1.0, 5.0, t );

  // ---- habillage de la fenêtre ----
  float fac = max( dot( uSunDir, N ), 0.0 ) * step( 0.0, uSunDir.y );
  vec3 Efac = uSkyCol * 1.7 + uGndCol * 0.9 + uSunCol * fac;          // éclairement de la façade, côté rue
  vec3 glow = vec3( 0.0 );
  for ( int i = 0; i < 3; i++ ) { vec4 lp = F( float( 24 + i ) ); glow += F( float( 27 + i ) ).rgb * lampOn( lp.w ) * uLampK / ( dot( lp.xyz - gWinC, lp.xyz - gWinC ) + 0.5 ); }
  vec3 bkc = col;
  vec3 calb = cov2.rgb;
  if ( gCType > 0.5 ) {
    if ( gCType < 2.5 || gCType > 4.5 ) {          // voilages / rideaux, 10 cm derrière la vitre
      vec3 q = p + d * ( 0.1 / d.z );
      float cv = q.y < RH - 0.02 ? coverAt( q.xy ) : 0.0;
      if ( cv > 0.0 ) {
        float fold = 0.5 + 0.5 * sin( q.x * 38.0 + 2.0 * sin( q.x * 9.0 + gSeed ) );
        float op = clamp( cv * ( 0.85 + 0.3 * fold ), 0.0, 0.98 );
        vec3 sheer = calb * ( Efac * ( gCType > 4.5 ? 0.7 + 0.25 * fold : 0.38 + 0.14 * fold ) * RECIPROCAL_PI ) + calb * glow * ( 0.3 + 0.15 * fold ) + bkc * 0.3;
        if ( abs( q.x - gX0 - gCW ) < 0.012 || abs( q.x - gX1 + gCW ) < 0.012 ) op = min( 1.0, op * 1.3 );
        col = mix( bkc, sheer, op );
      }
    } else {                                         // store enrouleur (3) ou vénitien (4), 4 cm
      vec3 q = p + d * ( 0.04 / d.z );
      if ( q.y > gYB ) {
        if ( gCType < 3.5 ) {
          col = mix( bkc, calb * Efac * 0.8 * RECIPROCAL_PI + calb * glow * 0.55, gCOp );
          if ( q.y - gYB < 0.03 ) col = mix( col, vec3( 0.02 ), 0.8 );
        } else {
          float f = fract( ( q.y - gYB ) / 0.025 );
          col = mix( bkc, calb * Efac * ( 0.45 + 0.4 * f ) * RECIPROCAL_PI + calb * glow * ( 0.15 + 0.3 * f ), step( 0.22, f ) * gCOp );
        }
      }
    }
  }
  // vitrage : reflet du ciel, du sol et d'une ligne d'arbres (s'ajoute au verre de la façade)
  {
    vec3 R = reflect( V, N );
    vec3 env = mix( uGndCol, uSkyCol * mix( 1.2, 0.85, clamp( R.y, 0.0, 1.0 ) ), smoothstep( -0.08, 0.12, R.y ) );
    float cv = clamp( -dot( V, N ), 0.0, 1.0 );
    float Fr = ( 0.03 + 0.97 * pow( 1.0 - cv, 5.0 ) ) * uRefl;
    col = col * ( 1.0 - Fr ) + env * Fr;
  }

  gl_FragColor = vec4( col * uExpo * mix( 1.0, uGain, 0.25 ), 1.0 );
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

  // ---- lumière du jour partagée (lue chaque image sur le soleil et l'hémisphère de la scène) ----
  // uDark : 0 en plein jour → 1 la nuit ; les lampes s'allument logement par logement selon ce taux.
  const DL = {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(0, 0, 0) },
    uSkyCol: { value: new THREE.Color(0.35, 0.38, 0.42) }, uGndCol: { value: new THREE.Color(0.12, 0.12, 0.1) },
    uDark: { value: 0 }, uExpo: { value: 1 }, uLampK: { value: 2.1 }, uRefl: { value: 0.5 }, uDayK: { value: 22 }, uRoomDay: { value: 1 },
  };
  let dlLights = null;
  const dlV = new THREE.Vector3(), dlC = new THREE.Color();
  const smooth = (x, a, b) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  function updateDaylight(scene) {
    if (!dlLights || !dlLights.sun) {
      dlLights = { sun: null, hemi: null };
      scene.traverse((o) => {
        if (o.isDirectionalLight && (!dlLights.sun || (o.castShadow && !dlLights.sun.castShadow))) dlLights.sun = o;
        if (o.isHemisphereLight && !dlLights.hemi) dlLights.hemi = o;
      });
    }
    const s = dlLights.sun, hm = dlLights.hemi;
    if (s) {
      dlV.copy(s.position); if (s.target) dlV.sub(s.target.position);
      if (dlV.lengthSq() > 0) dlV.normalize(); else dlV.set(0, 1, 0);
      DL.uSunDir.value.copy(dlV);
      DL.uSunCol.value.copy(s.color).multiplyScalar(s.visible ? s.intensity : 0);
    }
    const elev = Math.asin(Math.max(-1, Math.min(1, DL.uSunDir.value.y))) * 180 / Math.PI;
    DL.uDark.value = 1 - smooth(elev, -3, 16);
    const sc = DL.uSunCol.value;
    if (hm) {
      DL.uSkyCol.value.copy(hm.color).multiplyScalar(hm.intensity * 0.55).add(dlC.copy(sc).multiplyScalar(0.03));
      DL.uGndCol.value.copy(hm.groundColor).multiplyScalar(hm.intensity * 0.45).add(dlC.copy(sc).multiplyScalar(0.035));
    } else {
      const k = 1 - DL.uDark.value;
      DL.uSkyCol.value.setRGB(0.36 * k, 0.39 * k, 0.43 * k); DL.uGndCol.value.setRGB(0.12 * k, 0.12 * k, 0.1 * k);
    }
    { const c = DL.uSkyCol.value; DL.uRoomDay.value = (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 0.4 * DL.uRoomDayK.value; }
    // halo urbain nocturne minimal (sinon les voilages deviennent noirs)
    DL.uSkyCol.value.r += 0.004; DL.uSkyCol.value.g += 0.005; DL.uSkyCol.value.b += 0.008;
    DL.uGndCol.value.r += 0.004; DL.uGndCol.value.g += 0.0035; DL.uGndCol.value.b += 0.003;
  }
  const withDaylight = (mesh) => { mesh.onBeforeRender = (r, scene) => updateDaylight(scene); return mesh; };
  DL.uRoomDayK = { value: 1.0 };
  group.userData.daylight = DL;

  const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; }; // Color() convertit sRGB → linéaire
  const texParquet = toTex(THREE, drawOak(rnd), 1 / 2.4);
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
    const lamp = (x, y, z, I, rad, col = [1.0, 0.7, 0.42], kind = 'shade') => { const v = P(x, y, z); lamps.push({ p: v, I: I * 1.35, r2: rad * rad, c: col, kind }); };

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
        lamp(x, y - 0.25, z, I, 1.5, undefined, 'down');
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
    for (const s of R.spots || []) { CY('basic', 0.05, 0.05, 0.01, s[0], H - 0.012, s[1], 0xfff3df, 4.0, 14); lamp(s[0], H - 0.2, s[1], 0.32, 1.4, undefined, 'spot'); }

    // ---- cuisson de la lumière dans les couleurs de sommet ----
    const winZ = 0; // les baies sont sur le plan z = 0 (repère pièce)
    // échantillons de la baie (12 points) et surface de la pièce pour les inter-réflexions
    const winS = [];
    for (const w of walls) if (w.win) for (let i = 0; i < 4; i++) for (const y of [0.55, 1.3, 2.05]) {
      const u = w.L * (i + 0.5) / 4;
      winS.push({ x: w.a[0] + w.t[0] * u, y: Math.min(y, H - 0.3), z: w.a[1] + w.t[1] * u, nx: w.n[0], nz: w.n[1], A: w.L * Math.min(2.3, H - 0.2) / 12 });
    }
    let roomA = 2 * H * walls.reduce((s2, w) => s2 + w.L, 0) / 2;
    { let a2 = 0; for (let i = 0; i < poly.length; i++) { const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % poly.length]; a2 += x0 * z1 - x1 * z0; } roomA += Math.abs(a2); }
    const DAYN = 0.4 * 22 / Math.PI * 0.36, LAMPN = 1.35 / Math.PI * 1.5;
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
      // deux cuissons : jour (ciel par la baie, normalisé pour un ciel de référence) et lampes ;
      // le shader les dose selon l'heure (uRoomDay) et l'allumage propre à la pièce (aThr)
      // jour : la baie est une source surfacique (ciel en haut, sol en bas) échantillonnée en 12 points
      let Ed = 0;
      for (const s of winS) {
        const lx = s.x - p.x, ly = s.y - p.y, lz = s.z - p.z, d2 = lx * lx + ly * ly + lz * lz, dl = Math.sqrt(d2) || 1;
        const cs = Math.max(0, (n.x * lx + n.y * ly + n.z * lz) / dl * 0.85 + 0.15), cw = Math.max(0, -(s.nx * lx + s.nz * lz) / dl);
        Ed += s.A * cs * cw / (d2 + 0.35 * s.A) * (ly > 0 ? 1 : 0.3);
      }
      const dayA = (Ed * occ + 0.2 * (0.5 + 0.5 * occ) * (n.y < -0.5 ? 0.7 : 1)) * DAYN;
      const day = [dayA, dayA * 0.96, dayA * 0.89];
      let cr = 0, cg = 0, cb = 0, Ia = 0;
      for (const L of lamps) {
        const lx = L.p.x - p.x, ly = L.p.y - p.y, lz = L.p.z - p.z, d2 = lx * lx + ly * ly + lz * lz, dl = Math.sqrt(d2) || 1;
        const vy = ly / dl;
        // abat-jour : lumière canalisée vers le haut et le bas ; suspensions et spots vers le bas
        const shape = L.kind === 'down' ? 0.15 + 0.85 * smooth(vy, 0.1, 0.7) : L.kind === 'spot' ? 0.05 + 0.95 * smooth(vy, 0.3, 0.9) : 0.3 + 0.7 * smooth(Math.abs(vy), 0.3, 0.7);
        const nd = Math.max(0, (n.x * lx + n.y * ly + n.z * lz) / dl) * 0.85 + 0.15;
        const k = L.I * shape * nd / (d2 + 0.12) * LAMPN;
        cr += k * L.c[0]; cg += k * L.c[1]; cb += k * L.c[2]; Ia += L.I;
      }
      const amb = Ia * 2.4 / roomA * LAMPN * (0.55 + 0.45 * occ);
      return { day, lamp: [cr + amb, cg + amb * 0.72, cb + amb * 0.45] };
    };
    const thr = (() => { const q = mulberry32((R.seed || 1) * 7919 + 13)(); return q < 0.12 ? -0.2 : q > 0.9 ? 9 : 0.05 + 0.6 * (q - 0.12) / 0.78; })();
    const pv = new THREE.Vector3(), nv = new THREE.Vector3();
    for (const it of items) {
      const g = it.g, p = g.attributes.position, n = g.attributes.normal;
      const col = new Float32Array(p.count * 3), lmp = new Float32Array(p.count * 3), th = new Float32Array(p.count).fill(thr);
      for (let i = 0; i < p.count; i++) {
        pv.fromBufferAttribute(p, i); nv.fromBufferAttribute(n, i);
        const l = it.em > 0 ? { day: [0.3, 0.3, 0.29], lamp: [it.em, it.em * 0.9, it.em * 0.78] } : light(pv, nv);
        for (let c = 0; c < 3; c++) { col[i * 3 + c] = it.alb[c] * l.day[c]; lmp[i * 3 + c] = it.alb[c] * l.lamp[c]; }
      }
      g.setAttribute('aLamp', new THREE.BufferAttribute(lmp, 3));
      g.setAttribute('aThr', new THREE.BufferAttribute(th, 1));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.applyMatrix4(R.matrix);
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color', 'aLamp', 'aThr'].includes(k)) g.deleteAttribute(k);
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
      sh.uniforms.uRoomDay = DL.uRoomDay; sh.uniforms.uDark = DL.uDark; sh.uniforms.uLampK = DL.uLampK;
      sh.vertexShader = 'varying float vBandY;\nattribute vec3 aLamp;\nattribute float aThr;\nuniform float uRoomDay;\nuniform float uDark;\nuniform float uLampK;\n' + sh.vertexShader.replace('#include <project_vertex>',
        '#include <project_vertex>\n  vBandY = ( modelMatrix * vec4( transformed, 1.0 ) ).y;').replace('#include <color_vertex>',
        '#include <color_vertex>\n#ifdef USE_COLOR\n  vColor.rgb = color.rgb * uRoomDay + aLamp * smoothstep( aThr, aThr + 0.1, uDark ) * uLampK;\n#endif');
      sh.fragmentShader = 'uniform vec2 uBand;\nvarying float vBandY;\n' + sh.fragmentShader.replace('#include <clipping_planes_fragment>',
        'if ( vBandY > uBand.x && vBandY < uBand.y ) discard;\n#include <clipping_planes_fragment>');
    };
    m.customProgramCacheKey = () => 'room-band-v2';
  }
  group.userData.setHiddenBand = (y0, y1) => { band.value.set(y0 ?? 1e5, y1 ?? -1e5); };
  let tris = 0;
  for (const k of Object.keys(out)) {
    if (!out[k].length) continue;
    const geo = mergeGeometries(out[k], false);
    for (const g of out[k]) g.dispose();
    geo.computeBoundingSphere();
    tris += geo.attributes.position.count / 3;
    const m = withDaylight(new THREE.Mesh(geo, MAT[k]));
    m.name = 'interieurs:' + k;
    m.castShadow = false; m.receiveShadow = false;
    // pièces exclues de l'AO = image fantôme de ce qui est derrière : seuls les voilages le sont
    if (k === 'curtain') m.userData.noAO = true;
    group.add(m);
  }

  // ======================= 2. Pièces simulées =======================
  if (windows.length) {
    const pos = [], uv = [], aT = [], aN = [], aRoom = [], aWin = [];
    const roomData = new Float32Array(RT.W * 4 * windows.length);
    windows.forEach((w, wi) => roomData.set(layoutRoom(w), wi * RT.W * 4));
    const tRoom = new THREE.DataTexture(roomData, RT.W, windows.length, THREE.RGBAFormat, THREE.FloatType);
    tRoom.minFilter = tRoom.magFilter = THREE.NearestFilter; tRoom.generateMipmaps = false; tRoom.needsUpdate = true;
    windows.forEach((w, wi) => {
      const [p0, p1, p2, p3] = w.corners;  // BL, BR, TR, TL (monde)
      for (const [P, U] of [[p0, [0, 0]], [p1, [1, 0]], [p2, [1, 1]], [p0, [0, 0]], [p2, [1, 1]], [p3, [0, 1]]]) {
        pos.push(...P); uv.push(...U); aT.push(...w.T); aN.push(...w.N);
        aRoom.push(w.RW, w.RH, w.RD, w.xOff); aWin.push(w.w, w.h, w.sill, wi);
      }
    });
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
    const imU = { tCards: { value: texCards }, tRoom: { value: tRoom }, uRows: { value: windows.length }, uGain: { value: 1.0 }, uBand: band, ...DL };
    const mat = new THREE.MeshBasicMaterial({ name: 'interiorMapped' });
    mat.onBeforeCompile = (sh) => { Object.assign(sh.uniforms, imU); sh.vertexShader = IM_VERT; sh.fragmentShader = IM_FRAG; };
    mat.customProgramCacheKey = () => 'interior-mapping-v4';
    mat.userData.uniforms = imU;
    // volontairement visible dans le G-buffer de l'AO : masqué, l'AO serait calculée sur ce qui
    // se trouve derrière le quad et dessinerait une image fantôme sur la fenêtre
    const mesh = withDaylight(new THREE.Mesh(g, mat));
    mesh.name = 'interieurs:simulees';
    mesh.castShadow = false; mesh.receiveShadow = false;
    group.add(mesh);
    tris += pos.length / 9;
  }
  group.userData.triangles = tris;
  return group;
}
