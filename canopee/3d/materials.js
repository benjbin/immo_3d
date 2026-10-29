// Canopée — materials.js
// Matériaux PBR 100 % procéduraux : chaque texture est calculée dans un canvas 2D
// (couleur + roughnessMap + normalMap déduite d'une carte de hauteur par différences finies).
//
// ---------------------------------------------------------------------------
// MATÉRIAUX D'INTÉRIEUR (passe « intérieurs photoréalistes ») — tous sur M, tous éclairés
// (MeshStandardMaterial), UV en mètres (les UV « boîte » de lots.js conviennent telles quelles).
// Chacun porte userData.interior = 'floor' | 'wall' | 'fabric' | … ; ne pas les cloner sans raison
// (un matériau partagé = un seul programme, et viewer.js règle leur environnement en intérieur).
//   Sols      oakParquet (chêne naturel, lames 19 cm, fil selon v = −z), oakParquetLight, oakParquetSmoked,
//             tileFloor (grès 60×60 greige), microcement
//   Murs      wallPaint (blanc chaud mat), ceilingPaint, wallPaintGreige, wallPaintSage, wallPaintClay,
//             skirting (plinthes, laque satinée), tileWall (60×120 vertical), tileZellige, tileZelligeSage
//   Bois      oakWood, walnutWood (fil selon v)
//   Textiles  linenNatural, linenWhite, linenSand, linenSage, linenTerracotta, linenCharcoal, linenBlue
//             (armure toile, répétition 20 cm), boucle, boucleOat, rugWool, rugWoolGrey,
//             curtainSheer (voilage translucide, castShadow = false conseillé)
//   Cuir      leatherCognac, leatherBlack, leatherCream
//   Métal     brassBrushed, steelBrushed (brossé selon u), blackMetal (thermolaqué), chrome, mirror
//   Céram.    ceramicWhite (émail brillant), stoneware, stonewareDark, terracotta
//   Pierre    marbleWhite (Calacatta poli, 1,2 m), terrazzo
//   Laques    lacquerWhite, lacquerGreige, lacquerSage, lacquerNavy, lacquerBlack (façades, placards)
//   Verre     glassClear (vases, vitrines : transparent simple, sans transmission)
//   Végétal   plantLeaf, plantLeafLight (double face), plantStem, pottingSoil (= soil)
//   Lumière   lampShade (lin, s'illumine le soir), bulb (ampoule/diffuseur) : viewer.js pilote
//             leur emissiveIntensity selon l'heure et place de vraies lumières (PointLight) au centre
//             des abat-jour et ampoules trouvés dans les maillages « walk » qui utilisent ces deux matériaux.
// Variantes de couleur d'un même matériau : préférer l'attribut de sommet 'tint' de lots.js
// ou ces variantes plutôt qu'un clone par objet.
// ---------------------------------------------------------------------------
//
// Convention d'échelle : 1 unité UV = 1 m. Une répétition de texture couvre la surface
// réelle donnée par TILE (en mètres) et repeat = 1 / TILE. Des UV exprimées en mètres
// (ce que produisent building.js et landscape.js) donnent donc directement la bonne échelle.

export const TILE = {
  render: 2.0,          // enduit : 2 × 2 m
  cladding: 2.4,        // bardage : 2 panneaux de 1,2 m (joints verticaux tous les 1,2 m)
  slab: 2.0,            // rives de dalles
  soffit: 1.2,          // sous-face bois : 12 lames de 10 cm
  deck: 2.8,            // terrasse : 20 lames de 14 cm
  garage: 1.0,          // porte sectionnelle : rainure tous les 0,5 m
  door: 1.0,
  paver: 2.4,           // pavés 60 × 30 cm à joints décalés
  sidewalk: 3.0,        // 2 × 2 dalles de 1,5 m
  asphalt: 4.0,
  curb: 2.0,            // joint tous les 1 m
  grass: 4.0,
  soil: 2.0,
  bark: [0.8, 1.6],     // écorce : 0,8 m autour × 1,6 m en hauteur
  planter: 1.0,
  greenRoof: 3.0,
  fabric: 0.25,         // lin : 64 fils par 25 cm
  interior: [4.0, 3.0], // une pièce : 4 m de large × 1 étage (3 m) ; v = 0 au sol de l'étage
};

// ---------------------------------------------------------------------------
// Aléatoire reproductible et bruit
// ---------------------------------------------------------------------------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Réseau 256 × 256 de valeurs aléatoires, partagé par tous les bruits.
const LAT = (() => {
  const r = mulberry32(0xC0FFEE);
  const t = new Float32Array(65536);
  for (let i = 0; i < 65536; i++) t[i] = r();
  return t;
})();

// Bruit de valeur 2D (non périodique), pour le placement de la végétation.
export function valueNoise2(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let tx = x - xi, ty = y - yi;
  tx = tx * tx * tx * (tx * (tx * 6 - 15) + 10);
  ty = ty * ty * ty * (ty * (ty * 6 - 15) + 10);
  const o = seed * 97;
  const x0 = (xi + o) & 255, x1 = (xi + 1 + o) & 255, y0 = ((yi + o * 3) & 255) << 8, y1 = ((yi + 1 + o * 3) & 255) << 8;
  const a = LAT[y0 | x0], b = LAT[y0 | x1], c = LAT[y1 | x0], d = LAT[y1 | x1];
  const top = a + (b - a) * tx, bot = c + (d - c) * tx;
  return top + (bot - top) * ty;
}
export function fbm2(x, y, oct = 4, seed = 0) {
  let s = 0, a = 0.5, n = 0;
  for (let k = 0; k < oct; k++) { s += a * valueNoise2(x, y, seed + k * 7); n += a; x *= 2.03; y *= 2.03; a *= 0.5; }
  return s / n;
}

// fbm périodique sur une grille w × h (donc texture tuilable). px/py : nombre de
// cellules de la première octave (puissances de 2). Résultat normalisé sur [0, 1].
function fbm(w, h, o = {}) {
  const px = o.px ?? 4, py = o.py ?? px, oct = o.oct ?? 4, gain = o.gain ?? 0.5, seed = o.seed ?? 0;
  const out = new Float32Array(w * h);
  const X0 = new Int32Array(w), X1 = new Int32Array(w), TX = new Float32Array(w);
  let amp = 1;
  for (let k = 0; k < oct; k++) {
    const Px = Math.min(px << k, 256), Py = Math.min(py << k, 256);
    const ox = (seed * 131 + k * 61) & 255, oy = (seed * 197 + k * 113 + 7) & 255;
    for (let x = 0; x < w; x++) {
      const f = (x + 0.5) / w * Px, i = Math.floor(f); const t = f - i;
      TX[x] = t * t * t * (t * (t * 6 - 15) + 10);
      X0[x] = ((i % Px) + ox) & 255; X1[x] = (((i + 1) % Px) + ox) & 255;
    }
    for (let y = 0; y < h; y++) {
      const f = (y + 0.5) / h * Py, i = Math.floor(f); let t = f - i;
      t = t * t * t * (t * (t * 6 - 15) + 10);
      const r0 = (((i % Py) + oy) & 255) << 8, r1 = ((((i + 1) % Py) + oy) & 255) << 8;
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const x0 = X0[x], x1 = X1[x], tx = TX[x];
        const a = LAT[r0 | x0], b = LAT[r0 | x1], c = LAT[r1 | x0], d = LAT[r1 | x1];
        const top = a + (b - a) * tx, bot = c + (d - c) * tx;
        out[row + x] += amp * (top + (bot - top) * t);
      }
    }
    amp *= gain;
  }
  return norm01(out);
}

function norm01(a) {
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < a.length; i++) { const v = a[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
  const k = 1 / Math.max(1e-6, mx - mn);
  for (let i = 0; i < a.length; i++) a[i] = (a[i] - mn) * k;
  return a;
}

function white(n, seed) { const r = mulberry32(seed); const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = r(); return a; }

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
function hex(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function mixc(a, b, t) { return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)]; }

// Carte de normales (espace tangent, convention OpenGL) depuis une hauteur périodique.
function normalData(hgt, w, h, s) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const yu = ((y - 1 + h) % h) * w, yd = ((y + 1) % h) * w, row = y * w;
    for (let x = 0; x < w; x++) {
      const xl = (x - 1 + w) % w, xr = (x + 1) % w;
      const dx = (hgt[row + xr] - hgt[row + xl]) * s, dy = (hgt[yd + x] - hgt[yu + x]) * s;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1), i = (row + x) * 4;
      out[i] = (-dx * inv * 0.5 + 0.5) * 255; out[i + 1] = (dy * inv * 0.5 + 0.5) * 255;
      out[i + 2] = (inv * 0.5 + 0.5) * 255; out[i + 3] = 255;
    }
  }
  return out;
}
function grayData(v) {
  const out = new Uint8ClampedArray(v.length * 4);
  for (let i = 0; i < v.length; i++) { const g = clamp01(v[i]) * 255; out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = g; out[i * 4 + 3] = 255; }
  return out;
}
function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function canvasRGBA(w, h, data) { const c = makeCanvas(w, h); c.getContext('2d').putImageData(new ImageData(data, w, h), 0, 0); return c; }

// Petit tampon couleur RGBA.
class Buf {
  constructor(w, h) { this.w = w; this.h = h; this.d = new Uint8ClampedArray(w * h * 4); }
  set(i, c, k = 1) { const j = i * 4; this.d[j] = c[0] * k; this.d[j + 1] = c[1] * k; this.d[j + 2] = c[2] * k; this.d[j + 3] = 255; }
}

// ---------------------------------------------------------------------------
// Textures de cartes alpha (feuillages) : DataTexture avec mipmaps calculées à la main
// - couleur « poussée » sous les zones transparentes (pas de liseré sombre) ;
// - alpha des mips ajusté pour conserver la couverture (les feuilles ne fondent pas au loin).
// ---------------------------------------------------------------------------
function cardTexture(THREE, w, h, draw, aniso) {
  const cv = makeCanvas(w, h), g = cv.getContext('2d');
  draw(g, w, h);
  const src = g.getImageData(0, 0, w, h).data;
  // Niveau 0, retourné verticalement (ligne 0 = v = 0 = bas de la carte).
  let lw = w, lh = h;
  const C0 = new Float32Array(w * h * 3), A0 = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = h - 1 - y;
    for (let x = 0; x < w; x++) {
      const si = (sy * w + x) * 4, di = y * w + x, a = src[si + 3] / 255;
      A0[di] = a; C0[di * 3] = src[si] * a; C0[di * 3 + 1] = src[si + 1] * a; C0[di * 3 + 2] = src[si + 2] * a; // prémultiplié
    }
  }
  const levels = [{ w, h, C: C0, A: A0 }];
  while (lw > 1 || lh > 1) {
    const nw = Math.max(1, lw >> 1), nh = Math.max(1, lh >> 1), P = levels[levels.length - 1];
    const C = new Float32Array(nw * nh * 3), A = new Float32Array(nw * nh);
    const sx = lw / nw, sy = lh / nh;
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      let a = 0, r = 0, gg = 0, b = 0, n = 0;
      for (let yy = 0; yy < sy; yy++) for (let xx = 0; xx < sx; xx++) {
        const i = (y * sy + yy) * lw + (x * sx + xx);
        a += P.A[i]; r += P.C[i * 3]; gg += P.C[i * 3 + 1]; b += P.C[i * 3 + 2]; n++;
      }
      const o = y * nw + x; A[o] = a / n; C[o * 3] = r / n; C[o * 3 + 1] = gg / n; C[o * 3 + 2] = b / n;
    }
    levels.push({ w: nw, h: nh, C, A }); lw = nw; lh = nh;
  }
  // Couleurs dé-prémultipliées, complétées par la couleur du niveau parent (pull-push).
  const cols = new Array(levels.length);
  for (let l = levels.length - 1; l >= 0; l--) {
    const L = levels[l], out = new Float32Array(L.w * L.h * 3);
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
      const i = y * L.w + x, a = L.A[i];
      let pr = 128, pg = 128, pb = 128;
      if (l < levels.length - 1) {
        const PL = levels[l + 1], pc = cols[l + 1];
        const px = Math.min(PL.w - 1, (x * PL.w / L.w) | 0), py = Math.min(PL.h - 1, (y * PL.h / L.h) | 0), pi = (py * PL.w + px) * 3;
        pr = pc[pi]; pg = pc[pi + 1]; pb = pc[pi + 2];
      }
      if (a > 0.002) {
        const t = Math.min(1, a * 4);
        out[i * 3] = mix(pr, L.C[i * 3] / a, t); out[i * 3 + 1] = mix(pg, L.C[i * 3 + 1] / a, t); out[i * 3 + 2] = mix(pb, L.C[i * 3 + 2] / a, t);
      } else { out[i * 3] = pr; out[i * 3 + 1] = pg; out[i * 3 + 2] = pb; }
    }
    cols[l] = out;
  }
  // Conservation de la couverture alpha (seuil 0,5).
  let cov0 = 0; for (let i = 0; i < A0.length; i++) if (A0[i] >= 0.5) cov0++;
  cov0 /= A0.length;
  const mipmaps = levels.map((L, l) => {
    const n = L.w * L.h, data = new Uint8Array(n * 4);
    let s = 1;
    if (l > 0 && n >= 4) {
      let lo = 1, hi = 6;
      for (let it = 0; it < 10; it++) {
        const m = (lo + hi) / 2; let c = 0;
        for (let i = 0; i < n; i++) if (L.A[i] * m >= 0.5) c++;
        if (c / n < cov0) lo = m; else hi = m;
      }
      s = (lo + hi) / 2;
    }
    const c = cols[l];
    for (let i = 0; i < n; i++) {
      data[i * 4] = c[i * 3]; data[i * 4 + 1] = c[i * 3 + 1]; data[i * 4 + 2] = c[i * 3 + 2];
      data[i * 4 + 3] = Math.min(255, L.A[i] * s * 255);
    }
    return { data, width: L.w, height: L.h };
  });
  const tex = new THREE.DataTexture(mipmaps[0].data, w, h, THREE.RGBAFormat);
  tex.mipmaps = mipmaps;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = aniso;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Dessins vectoriels (feuilles, brins, fleurs)
// ---------------------------------------------------------------------------
const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;

// Feuille ovale pointue : base à l'origine, pointe en (L, 0).
function leafPath(g, L, W, round = 0.55) {
  g.beginPath();
  g.moveTo(0, 0);
  g.bezierCurveTo(L * 0.12, -W * round, L * 0.58, -W * 0.62, L, 0);
  g.bezierCurveTo(L * 0.58, W * 0.62, L * 0.12, W * round, 0, 0);
  g.closePath();
}
function drawLeaf(g, x, y, ang, L, W, col, r, opt = {}) {
  const [h, s, l] = col;
  g.save(); g.translate(x, y); g.rotate(ang);
  const pet = opt.petiole ?? 0.1;
  if (pet > 0) { g.strokeStyle = hsl(h - 15, s * 0.6, l * 0.8); g.lineWidth = Math.max(1.2, L * 0.025); g.beginPath(); g.moveTo(0, 0); g.lineTo(L * pet + 1, 0); g.stroke(); g.translate(L * pet, 0); }
  // Léger affaissement de la feuille : un côté plus étroit
  const Wl = W * (0.9 + r() * 0.2);
  leafPath(g, L, Wl, opt.round ?? 0.55);
  const gr = g.createLinearGradient(0, 0, L, 0);
  gr.addColorStop(0, hsl(h - 4, s, l * 0.8)); gr.addColorStop(0.55, hsl(h, s, l)); gr.addColorStop(1, hsl(h + 6, s * 1.05, l * 1.12));
  g.fillStyle = gr; g.fill();
  // Demi-limbe plus sombre (pli de la nervure)
  g.save(); g.clip();
  g.fillStyle = `rgba(0,0,0,${0.1 + r() * 0.1})`; g.fillRect(0, 0, L, W);
  // reflet doux
  const rg = g.createRadialGradient(L * 0.45, -W * 0.15, 0, L * 0.45, -W * 0.15, L * 0.45);
  rg.addColorStop(0, 'rgba(255,255,230,0.10)'); rg.addColorStop(1, 'rgba(255,255,230,0)');
  g.fillStyle = rg; g.fillRect(0, -W, L, W * 2);
  // nervures secondaires
  const nv = opt.veins ?? 7;
  g.strokeStyle = hsl(h + 10, s * 0.7, Math.min(85, l * 1.6), 0.28); g.lineWidth = Math.max(0.6, L * 0.007);
  for (let k = 1; k <= nv; k++) {
    const t = k / (nv + 1), x0 = L * t * 0.88;
    for (const sg of [-1, 1]) { g.beginPath(); g.moveTo(x0, 0); g.quadraticCurveTo(x0 + L * 0.08, sg * W * 0.25, x0 + L * 0.17, sg * W * 0.5 * Math.sin(Math.PI * Math.min(1, t + 0.1))); g.stroke(); }
  }
  g.restore();
  // nervure centrale
  g.strokeStyle = hsl(h + 12, s * 0.7, Math.min(88, l * 1.75), 0.55); g.lineWidth = Math.max(0.8, L * 0.016);
  g.beginPath(); g.moveTo(0, 0); g.lineTo(L * 0.93, 0); g.stroke();
  // liseré
  leafPath(g, L, Wl, opt.round ?? 0.55); g.strokeStyle = hsl(h, s, l * 0.6, 0.35); g.lineWidth = 0.8; g.stroke();
  g.restore();
}

// Rameau de feuilles caduques. type : 'A' (ovales larges), 'B' (petites rondes), 'C' (composées).
function drawTwig(g, w, h, type, seed) {
  const r = mulberry32(seed);
  const base = { A: [80, 56, 37], B: [88, 50, 31], C: [70, 62, 41] }[type];
  const col = () => [base[0] + (r() - 0.5) * 18, base[1] + (r() - 0.5) * 16, base[2] * (0.7 + r() * 0.6)];
  const stem = (p, wd) => { g.strokeStyle = 'rgb(84,68,50)'; g.lineWidth = wd; g.lineCap = 'round'; g.beginPath(); g.moveTo(p[0], p[1]); g.quadraticCurveTo(p[2], p[3], p[4], p[5]); g.stroke(); };
  const along = (p, t) => { const u = 1 - t; return [u * u * p[0] + 2 * u * t * p[2] + t * t * p[4], u * u * p[1] + 2 * u * t * p[3] + t * t * p[5]]; };
  const tang = (p, t) => { const u = 1 - t; return Math.atan2(2 * u * (p[3] - p[1]) + 2 * t * (p[5] - p[3]), 2 * u * (p[2] - p[0]) + 2 * t * (p[4] - p[2])); };
  // rameau principal + rameaux latéraux alternés
  const main = [w * 0.5, h * 0.995, w * (0.44 + r() * 0.12), h * 0.5, w * (0.47 + r() * 0.06), h * 0.08];
  const twigs = [main];
  const nSide = type === 'B' ? 5 : 4;
  for (let k = 0; k < nSide; k++) {
    const side = k % 2 ? 1 : -1, t = 0.22 + k * (0.6 / nSide) + r() * 0.05;
    const [sx, sy] = along(main, t), a = tang(main, t) + side * (0.6 + r() * 0.35), L = h * (0.42 - k * 0.04) * (0.85 + r() * 0.3);
    const ex = sx + Math.cos(a) * L, ey = sy + Math.sin(a) * L;
    twigs.push([sx, sy, (sx + ex) / 2 - side * w * 0.03, (sy + ey) / 2 - h * 0.04, ex, ey]);
  }
  twigs.forEach((tw, k) => stem(tw, k ? 2 : 3.2));
  if (type === 'C') {
    // folioles lancéolées par paires (feuilles composées)
    for (const tw of twigs) {
      for (let t = 0.2; t < 0.98; t += 0.13 + r() * 0.03) {
        const [x, y] = along(tw, t), a = tang(tw, t), L = w * (0.1 + r() * 0.03);
        drawLeaf(g, x, y, a - 0.95 - r() * 0.25, L, L * 0.36, col(), r, { petiole: 0.03, veins: 4, round: 0.5 });
        drawLeaf(g, x, y, a + 0.95 + r() * 0.25, L, L * 0.36, col(), r, { petiole: 0.03, veins: 4, round: 0.5 });
      }
      const [x, y] = along(tw, 1); drawLeaf(g, x, y, tang(tw, 1), w * 0.11, w * 0.04, col(), r, { petiole: 0.03, veins: 4, round: 0.5 });
    }
    return;
  }
  const Lb = type === 'A' ? w * 0.13 : w * 0.095, Wk = type === 'A' ? 0.58 : 0.7, round = type === 'A' ? 0.6 : 0.72;
  for (const tw of twigs) {
    let k = 0;
    for (let t = 0.14; t < 0.97; t += (type === 'A' ? 0.12 : 0.1) + r() * 0.04, k++) {
      const [x, y] = along(tw, t), a = tang(tw, t), side = k % 2 ? 1 : -1;
      const L = Lb * (0.75 + 0.4 * Math.sin(Math.PI * Math.min(1, 0.2 + t))) * (0.8 + r() * 0.4);
      drawLeaf(g, x, y, a + side * (0.6 + r() * 0.6), L, L * Wk, col(), r, { veins: type === 'A' ? 5 : 4, round, petiole: 0.14 });
    }
    const [x, y] = along(tw, 1);
    drawLeaf(g, x, y, tang(tw, 1) + (r() - 0.5) * 0.4, Lb, Lb * Wk, col(), r, { veins: 5, round, petiole: 0.1 });
  }
}

// Gerbe de rameaux feuillés (masse de houppier) : silhouette étoilée irrégulière, trous, cœur ombré
function drawClump(g, w, h, seed) {
  const r = mulberry32(seed), cx = w * 0.5, cy = h * 0.55;
  const nT = 9;
  const twigs = [];
  let a = r() * Math.PI * 2;
  for (let k = 0; k < nT; k++) {
    a += Math.PI * 2 / nT * (0.55 + r() * 0.9);           // espacement inégal : trous entre rameaux
    const L = w * (0.22 + r() * 0.24);
    const sx = cx + (r() - 0.5) * w * 0.12, sy = cy + (r() - 0.5) * h * 0.12;
    const ex = sx + Math.cos(a) * L, ey = sy + Math.sin(a) * L * 0.9;
    const mx = (sx + ex) / 2 + (r() - 0.5) * L * 0.4, my = (sy + ey) / 2 + (r() - 0.5) * L * 0.4;
    twigs.push([sx, sy, mx, my, ex, ey, L]);
  }
  g.strokeStyle = 'rgb(74,60,44)'; g.lineCap = 'round';
  for (const t of twigs) { g.lineWidth = 2.5; g.beginPath(); g.moveTo(t[0], t[1]); g.quadraticCurveTo(t[2], t[3], t[4], t[5]); g.stroke(); }
  const along = (p, t) => { const u = 1 - t; return [u * u * p[0] + 2 * u * t * p[2] + t * t * p[4], u * u * p[1] + 2 * u * t * p[3] + t * t * p[5]]; };
  // feuilles du cœur d'abord (sombres), puis vers l'extrémité des rameaux (claires)
  const leaves = [];
  for (const t of twigs) {
    const n = Math.round(t[6] / w * 70);
    for (let i = 0; i < n; i++) {
      const tt = Math.pow(r(), 0.6), [x, y] = along(t, tt);
      leaves.push([x + (r() - 0.5) * w * 0.05, y + (r() - 0.5) * w * 0.05, tt]);
    }
  }
  leaves.sort((p, q) => p[2] - q[2]);
  for (const [x, y, tt] of leaves) {
    const L = w * (0.055 + r() * 0.04), shade = 0.5 + 0.6 * tt;
    drawLeaf(g, x, y, r() * Math.PI * 2, L, L * 0.6, [76 + (r() - 0.5) * 22, 50 + r() * 14, (24 + r() * 16) * shade], r, { petiole: 0.1, veins: 3, round: 0.6 });
  }
}

// Sol herbacé de prairie vu de dessus : brins couchés par plaques, graminées sèches, fleurs
function drawMeadowGround(g, S, seed) {
  const r = mulberry32(seed);
  g.fillStyle = '#3a3a1c'; g.fillRect(0, 0, S, S);
  const flows = Array.from({ length: 6 }, () => [r() * S, r() * S, r() * Math.PI * 2]);
  const dirAt = (x, y) => { let best = 0, bd = 1e9; for (const f of flows) { const d = (f[0] - x) ** 2 + (f[1] - y) ** 2; if (d < bd) { bd = d; best = f[2]; } } return best; };
  const pal = ['#2f3a17', '#45501f', '#5b6526', '#6f7530', '#8a8540', '#a39a55', '#4d5a24', '#7a7f38', '#b5a868'];
  const buckets = pal.map(c => ({ c, p: new Path2D() }));
  for (let n = 0; n < 60000; n++) {
    const x = r() * S, y = r() * S, k = Math.min(pal.length - 1, Math.floor(Math.pow(r(), 1.3) * pal.length));
    const a = dirAt(x, y) + (r() - 0.5) * 1.2, L = 8 + r() * 22;
    const b = buckets[k].p; b.moveTo(x, y); b.quadraticCurveTo(x + Math.cos(a) * L * 0.5 + (r() - 0.5) * 4, y + Math.sin(a) * L * 0.5, x + Math.cos(a) * L, y + Math.sin(a) * L);
  }
  g.lineCap = 'round'; g.lineWidth = 1.6;
  for (const b of buckets) { g.strokeStyle = b.c; for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) { g.setTransform(1, 0, 0, 1, ox, oy); g.stroke(b.p); } }
  g.setTransform(1, 0, 0, 1, 0, 0);
  // taches de fleurs (vivaces)
  const fl = ['#8f7bc0', '#e8e3d0', '#d9c25a', '#b98ac2'];
  for (let k = 0; k < 140; k++) {
    const cx = r() * S, cy = r() * S, col = fl[Math.floor(r() * fl.length)], n = 8 + Math.floor(r() * 25), R = 10 + r() * 30;
    g.fillStyle = col;
    for (let i = 0; i < n; i++) { const a = r() * 6.28, d = Math.sqrt(r()) * R; g.beginPath(); g.arc((cx + Math.cos(a) * d + S) % S, (cy + Math.sin(a) * d + S) % S, 1.4 + r() * 1.6, 0, 7); g.fill(); }
  }
}

// Lisière de forêt lointaine (bande tuilable horizontalement) : houppiers superposés
function drawTreeLine(g, w, h, seed) {
  const r = mulberry32(seed);
  // sous-bois continu en bas
  g.fillStyle = 'hsl(80,30%,13%)'; g.fillRect(0, h * 0.78, w, h * 0.22);
  const crowns = [];
  for (let k = 0; k < 46; k++) crowns.push({ x: r() * w, top: h * (0.05 + r() * 0.4), R: w * (0.035 + r() * 0.04), hue: 72 + r() * 24, l: 0.8 + r() * 0.4 });
  crowns.sort((a, b) => a.top - b.top);
  for (const c of crowns) {
    const cy = c.top + c.R * 1.2;
    for (const ox of [-w, 0, w]) {
      if (c.x + ox < -c.R * 2 || c.x + ox > w + c.R * 2) continue;
      g.fillStyle = 'hsl(30,20%,14%)'; g.fillRect(c.x + ox - 2, cy, 4, h - cy);
      for (let i = 0; i < 70; i++) {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * c.R * 1.1;
        const x = c.x + ox + Math.cos(a) * d * 1.1, y = cy + Math.sin(a) * d * 1.25 + c.R * 0.25;
        const lit = 0.5 - 0.5 * Math.sin(a) * (d / c.R);    // haut plus clair
        g.fillStyle = hsl(c.hue + (r() - 0.5) * 10, 34 + r() * 14, (12 + 16 * lit + r() * 6) * c.l);
        g.beginPath(); g.ellipse(x, y, c.R * (0.18 + r() * 0.16), c.R * (0.14 + r() * 0.12), r() * 3, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = 'hsl(80,30%,13%)'; g.fillRect(c.x + ox - c.R * 0.9, cy + c.R * 1.1, c.R * 1.8, h);
    }
  }
}

// Feuille de strelitzia (pétiole long + grand limbe, nervures parallèles, déchirures)
function drawStrelitzia(g, w, h, seed) {
  const r = mulberry32(seed);
  const cx = w / 2;
  g.lineCap = 'round';
  const pg = g.createLinearGradient(0, h, 0, h * 0.5);
  pg.addColorStop(0, '#5d7f45'); pg.addColorStop(1, '#4b7440');
  g.strokeStyle = pg; g.lineWidth = w * 0.045;
  g.beginPath(); g.moveTo(cx, h); g.lineTo(cx, h * 0.58); g.stroke();
  const top = h * 0.03, bot = h * 0.62, R = w * 0.44;
  const blade = () => {
    g.beginPath(); g.moveTo(cx, bot);
    g.bezierCurveTo(cx - R * 1.05, bot - (bot - top) * 0.08, cx - R * 1.0, top + (bot - top) * 0.35, cx, top);
    g.bezierCurveTo(cx + R * 1.0, top + (bot - top) * 0.35, cx + R * 1.05, bot - (bot - top) * 0.08, cx, bot);
    g.closePath();
  };
  blade();
  const gr = g.createLinearGradient(cx - R, 0, cx + R, 0);
  gr.addColorStop(0, '#3f6a26'); gr.addColorStop(0.45, '#5b8c34'); gr.addColorStop(0.5, '#679a3c'); gr.addColorStop(0.55, '#52822f'); gr.addColorStop(1, '#365c20');
  g.fillStyle = gr; g.fill();
  g.save(); blade(); g.clip();
  // nervures parallèles obliques
  for (let y = bot; y > top - h * 0.2; y -= 5 + r() * 3) {
    g.strokeStyle = r() < 0.5 ? 'rgba(160,200,140,0.10)' : 'rgba(0,20,0,0.12)'; g.lineWidth = 1.2;
    for (const sg of [-1, 1]) { g.beginPath(); g.moveTo(cx, y); g.quadraticCurveTo(cx + sg * R * 0.5, y - R * 0.45, cx + sg * R * 1.1, y - R * 0.75); g.stroke(); }
  }
  // reflet brillant
  const rg = g.createRadialGradient(cx - R * 0.3, (top + bot) * 0.45, 0, cx - R * 0.3, (top + bot) * 0.45, R * 1.2);
  rg.addColorStop(0, 'rgba(220,255,210,0.16)'); rg.addColorStop(1, 'rgba(220,255,210,0)');
  g.fillStyle = rg; g.fillRect(0, 0, w, h);
  g.restore();
  // marge légèrement sèche
  blade(); g.strokeStyle = 'rgba(150,140,70,0.45)'; g.lineWidth = 2.2; g.stroke();
  // nervure centrale
  const mg = g.createLinearGradient(0, bot, 0, top);
  mg.addColorStop(0, '#b9cc8c'); mg.addColorStop(1, '#8fb070');
  g.strokeStyle = mg; g.lineWidth = w * 0.03; g.beginPath(); g.moveTo(cx, bot + 4); g.lineTo(cx, top + 10); g.stroke();
  // déchirures le long des nervures
  g.globalCompositeOperation = 'destination-out';
  const nt = 2 + (r() * 3 | 0);
  for (let k = 0; k < nt; k++) {
    const sg = r() < 0.5 ? -1 : 1, y = top + (bot - top) * (0.15 + r() * 0.65), d = 0.45 + r() * 0.5;
    g.lineWidth = 2 + r() * 2; g.beginPath();
    g.moveTo(cx + sg * R * 1.15, y - R * 0.8); g.lineTo(cx + sg * R * (1.15 - d), y - R * 0.8 + R * d * 0.6); g.stroke();
  }
  g.globalCompositeOperation = 'source-over';
}

// Palme (rachis + folioles étroites)
function drawPalm(g, w, h, seed) {
  const r = mulberry32(seed), cx = w / 2;
  g.lineCap = 'round';
  g.strokeStyle = '#6f7d45'; g.lineWidth = 6;
  g.beginPath(); g.moveTo(cx, h); g.quadraticCurveTo(cx + 6, h * 0.5, cx, h * 0.02); g.stroke();
  for (let y = h * 0.74; y > h * 0.04; y -= 17 + r() * 4) {
    const t = 1 - (y - h * 0.04) / (h * 0.7);  // 0 en bas, 1 au sommet
    const L = w * (0.48 * Math.sin(Math.PI * (0.18 + 0.75 * t)) + 0.06);
    for (const sg of [-1, 1]) {
      const a = -Math.PI / 2 + sg * (0.75 + r() * 0.25 - t * 0.25);
      drawLeaf(g, cx, y, a, L, L * 0.1, [78 + (r() - 0.5) * 12, 52, 34 + r() * 8], r, { petiole: 0, veins: 0, round: 0.4 });
    }
  }
}

// Tige retombante (pothos / lierre) : point d'attache en haut
function drawTrail(g, w, h, seed) {
  const r = mulberry32(seed);
  let x = w / 2, y = 0;
  const pts = [[x, y]];
  while (y < h * 0.97) { y += 18; x += (r() - 0.5) * 10 + (w / 2 - x) * 0.08; pts.push([x, y]); }
  g.strokeStyle = '#5f6e3a'; g.lineWidth = 3; g.lineCap = 'round';
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts) g.lineTo(p[0], p[1]); g.stroke();
  for (let k = 1; k < pts.length - 1; k += 2) {
    const [px, py] = pts[k], t = py / h, side = (k >> 1) % 2 ? 1 : -1;
    const L = w * (0.5 - 0.26 * t) * (0.85 + r() * 0.3);
    const ang = Math.PI / 2 + side * (0.9 + r() * 0.5);
    const c = r() < 0.3 ? [66, 50, 42] : [84 + (r() - 0.5) * 12, 50, 28 + r() * 8];
    drawLeaf(g, px, py, ang, L, L * 0.75, c, r, { petiole: 0.18, veins: 4, round: 0.85 });
  }
}

// Brins d'herbe en touffe (couleurs neutres, teinte donnée par instanceColor)
function drawBlades(g, w, h, seed, opt = {}) {
  const r = mulberry32(seed);
  const n = opt.n ?? 70;
  for (let k = 0; k < n; k++) {
    const bx = w * (0.5 + (r() - 0.5) * (opt.spread ?? 0.3)), by = h;
    const ang = (r() - 0.5) * (opt.fan ?? 1.2);
    const L = h * (opt.minL ?? 0.5) + r() * h * (opt.varL ?? 0.45);
    const tx = bx + Math.sin(ang) * L, ty = by - Math.cos(ang) * L * (0.85 + r() * 0.15);
    const bend = (r() - 0.5) * w * 0.25 + Math.sin(ang) * L * 0.25;
    const cx = (bx + tx) / 2 + bend * 0.3, cy = (by + ty) / 2;
    const wd = (opt.width ?? 7) * (0.6 + r() * 0.7);
    const lum = 45 + r() * 28, hue = 58 + r() * 26;
    const gr = g.createLinearGradient(bx, by, tx, ty);
    gr.addColorStop(0, hsl(hue, 30, lum * 0.55)); gr.addColorStop(0.6, hsl(hue, 38, lum)); gr.addColorStop(1, hsl(hue - 18, 42, Math.min(85, lum * 1.2)));
    g.fillStyle = gr;
    // brin effilé : bord gauche puis bord droit
    g.beginPath();
    g.moveTo(bx - wd / 2, by);
    g.quadraticCurveTo(cx - wd * 0.3, cy, tx, ty);
    g.quadraticCurveTo(cx + wd * 0.3, cy, bx + wd / 2, by);
    g.closePath(); g.fill();
  }
}

function drawPlumes(g, w, h, seed) {
  const r = mulberry32(seed);
  drawBlades(g, w, h, seed + 1, { n: 55, minL: 0.35, varL: 0.35, width: 6, fan: 1.0 });
  for (let k = 0; k < 11; k++) {
    const bx = w * (0.45 + r() * 0.1), ang = (r() - 0.5) * 0.6, L = h * (0.72 + r() * 0.26);
    const tx = bx + Math.sin(ang) * L, ty = h - Math.cos(ang) * L;
    g.strokeStyle = hsl(50, 30, 55); g.lineWidth = 2;
    g.beginPath(); g.moveTo(bx, h); g.lineTo(tx, ty); g.stroke();
    // panicule plumeuse
    for (let j = 0; j < 90; j++) {
      const t = 0.72 + r() * 0.28, px = bx + (tx - bx) * t + (r() - 0.5) * 14 * (1.2 - t), py = h + (ty - h) * t;
      g.fillStyle = hsl(42 + r() * 10, 35 + r() * 15, 70 + r() * 15, 0.8);
      g.beginPath(); g.ellipse(px, py, 2.2, 6 + r() * 4, ang + (r() - 0.5) * 0.6, 0, Math.PI * 2); g.fill();
    }
  }
}

function drawLavender(g, w, h, seed) {
  const r = mulberry32(seed);
  // feuillage gris-vert
  for (let k = 0; k < 40; k++) {
    const bx = w * (0.5 + (r() - 0.5) * 0.4), a = -Math.PI / 2 + (r() - 0.5) * 2.2;
    drawLeaf(g, bx, h, a, h * (0.18 + r() * 0.12), 7, [95, 18, 45 + r() * 12], r, { petiole: 0, veins: 0, round: 0.4 });
  }
  for (let k = 0; k < 28; k++) {
    const bx = w * (0.5 + (r() - 0.5) * 0.3), ang = (r() - 0.5) * 1.3, L = h * (0.7 + r() * 0.27);
    const tx = bx + Math.sin(ang) * L, ty = h - Math.cos(ang) * L;
    g.strokeStyle = hsl(90, 15, 48); g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(bx, h); g.lineTo(tx, ty); g.stroke();
    for (let j = 0; j < 16; j++) {
      const t = 0.74 + j / 16 * 0.26, px = bx + (tx - bx) * t, py = h + (ty - h) * t;
      g.fillStyle = hsl(262 + r() * 14, 38 + r() * 14, 52 + r() * 14);
      g.beginPath(); g.ellipse(px + (r() - 0.5) * 4, py, 4.5, 5.5, ang, 0, Math.PI * 2); g.fill();
    }
  }
}

function drawWhiteFlowers(g, w, h, seed) {
  const r = mulberry32(seed);
  for (let k = 0; k < 16; k++) {
    const bx = w * (0.5 + (r() - 0.5) * 0.5), a = -Math.PI / 2 + (r() - 0.5) * 2.4;
    drawLeaf(g, bx, h, a, h * (0.25 + r() * 0.15), h * 0.11, [105, 35, 26 + r() * 8], r, { petiole: 0.1, veins: 5, round: 0.6 });
  }
  for (let k = 0; k < 14; k++) {
    const bx = w * (0.5 + (r() - 0.5) * 0.3), ang = (r() - 0.5) * 1.4, L = h * (0.55 + r() * 0.38);
    const tx = bx + Math.sin(ang) * L, ty = h - Math.cos(ang) * L;
    g.strokeStyle = hsl(100, 30, 35); g.lineWidth = 2;
    g.beginPath(); g.moveTo(bx, h); g.lineTo(tx, ty); g.stroke();
    const R = 13 + r() * 9, np = 7 + (r() * 3 | 0), rot = r() * 6;
    for (let p = 0; p < np; p++) {
      const a = rot + p / np * Math.PI * 2;
      g.fillStyle = hsl(45, 30 + r() * 20, 90 + r() * 7);
      g.beginPath(); g.ellipse(tx + Math.cos(a) * R * 0.55, ty + Math.sin(a) * R * 0.55, R * 0.55, R * 0.24, a, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = hsl(46, 85, 55); g.beginPath(); g.arc(tx, ty, R * 0.22, 0, Math.PI * 2); g.fill();
  }
}

// Tapis de sedums vu du dessus (rosettes neutres, teinte par instance)
function drawSedum(g, w, h, seed) {
  const r = mulberry32(seed);
  for (let k = 0; k < 420; k++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * w * 0.46 * (0.75 + 0.25 * Math.sin(a * 3 + seed));
    const x = w / 2 + Math.cos(a) * d, y = h / 2 + Math.sin(a) * d;
    const R = 7 + r() * 11, np = 6 + (r() * 4 | 0), rot = r() * 6;
    const lum = 48 + r() * 30, hue = 70 + r() * 30;
    for (let p = 0; p < np; p++) {
      const b = rot + p / np * Math.PI * 2;
      g.fillStyle = hsl(hue, 28, lum * (0.8 + r() * 0.3));
      g.beginPath(); g.ellipse(x + Math.cos(b) * R * 0.5, y + Math.sin(b) * R * 0.5, R * 0.5, R * 0.28, b, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = hsl(hue, 30, Math.min(90, lum * 1.25)); g.beginPath(); g.arc(x, y, R * 0.25, 0, Math.PI * 2); g.fill();
  }
}

// ---------------------------------------------------------------------------
// Shader de feuillage : normales « de houppier » (attribut d'instance aCrownN),
// pas d'inversion de normale sur la face arrière, éclairage enveloppant + translucidité.
// ---------------------------------------------------------------------------
export function patchFoliage(THREE, mat, { crown = 0.7, wrap = 0.35, trans = 0.55 } = {}) {
  const uni = { uCrown: { value: crown }, uWrap: { value: wrap }, uTrans: { value: trans } };
  mat.userData.foliage = uni;
  const nfb = THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', '');
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aCrownN;\nuniform float uCrown;')
      .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
        {
          vec3 cn = normalMatrix * aCrownN;
          float cl = length( cn );
          vec3 qn = normalize( transformedNormal );
          if ( cl > 0.001 && uCrown > 0.001 ) {
            cn /= cl;
            if ( dot( qn, cn ) < 0.0 ) qn = -qn;
            transformedNormal = normalize( mix( qn, cn, uCrown ) );
          }
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uWrap;\nuniform float uTrans;')
      .replace('#include <normal_fragment_begin>', nfb)
      .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>
        void RE_Direct_Foliage( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
          RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
          float ndl = dot( geometryNormal, directLight.direction );
          float w = saturate( ( ndl + uWrap ) / ( 1.0 + uWrap ) ) - saturate( ndl );
          float back = saturate( 0.3 - ndl ) * pow( saturate( dot( -geometryViewDir, directLight.direction ) ), 2.0 );
          vec3 tcol = material.diffuseColor * vec3( 1.0, 1.15, 0.45 );
          reflectedLight.directDiffuse += directLight.color * ( w * BRDF_Lambert( material.diffuseColor ) + back * uTrans * BRDF_Lambert( tcol ) );
        }
        #undef RE_Direct
        #define RE_Direct RE_Direct_Foliage`);
  };
  mat.customProgramCacheKey = () => 'canopee-foliage-1';
  return mat;
}

// Atténue la répétition d'une texture de sol en mélangeant deux échelles tournées.
export function patchAntiTile(mat, k = 0.45) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev && prev(sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `
      #ifdef USE_MAP
        vec4 sampledDiffuseColor = texture2D( map, vMapUv );
        vec2 uvB = mat2( 0.788, -0.616, 0.616, 0.788 ) * vMapUv * 0.437 + vec2( 0.31, 0.71 );
        vec4 sB = texture2D( map, uvB );
        sampledDiffuseColor = mix( sampledDiffuseColor, sB, ${k.toFixed(3)} );
        diffuseColor *= sampledDiffuseColor;
      #endif`);
  };
  mat.customProgramCacheKey = () => 'canopee-antitile-' + k;
  return mat;
}

// ---------------------------------------------------------------------------
// Fabrique principale
// ---------------------------------------------------------------------------
export function createMaterials(THREE, renderer) {
  const t0 = performance.now();
  const aniso = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() || 8);
  const timings = {}; let tl = performance.now();
  const lap = k => { const n = performance.now(); timings[k] = Math.round(n - tl); tl = n; };

  const tex = (canvas, tile, srgb) => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    const [tx, ty] = Array.isArray(tile) ? tile : [tile, tile];
    t.repeat.set(1 / tx, 1 / ty);
    t.anisotropy = aniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  // Jeu complet : couleur (Buf), rugosité (Float32Array), hauteur (Float32Array)
  const pbrSet = (w, h, tile, col, rough, hgt, ns) => ({
    map: tex(canvasRGBA(w, h, col.d), tile, true),
    roughnessMap: rough ? tex(canvasRGBA(w, h, grayData(rough)), tile) : null,
    normalMap: hgt ? tex(canvasRGBA(w, h, normalData(hgt, w, h, ns)), tile) : null,
  });
  const std = (set, p) => new THREE.MeshStandardMaterial({ ...set, roughness: 1, metalness: 0, ...p });

  const M = {};

  // --- Enduit blanc cassé ---------------------------------------------------
  {
    const S = 512, lo = fbm(S, S, { px: 2, oct: 4, seed: 1 }), mid = fbm(S, S, { px: 16, oct: 3, seed: 2 }), hi = fbm(S, S, { px: 128, oct: 2, seed: 3 });
    const base = hex('#efeee9'), col = new Buf(S, S), rough = new Float32Array(S * S), hgt = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) {
      col.set(i, base, 1 + 0.035 * (lo[i] - 0.5) + 0.03 * (hi[i] - 0.5) + 0.015 * (mid[i] - 0.5));
      rough[i] = 0.88 + 0.1 * (hi[i] - 0.5);
      hgt[i] = 0.35 * mid[i] + 0.65 * hi[i];
    }
    M.renderWhite = std(pbrSet(S, S, TILE.render, col, rough, hgt, 1.6), { name: 'renderWhite', normalScale: new THREE.Vector2(0.6, 0.6) });
  }

  lap('Enduit');
  // --- Bardage anthracite (joints verticaux tous les 1,2 m) ------------------
  {
    const S = 512, lo = fbm(S, S, { px: 2, oct: 4, seed: 4 }), hi = fbm(S, S, { px: 128, oct: 2, seed: 5 }), streak = fbm(S, S, { px: 32, py: 1, oct: 3, seed: 6 });
    // teinte légèrement chaude : le reflet du ciel bleu suffit à la refroidir
    const base = hex('#4a4947'), col = new Buf(S, S), rough = new Float32Array(S * S), hgt = new Float32Array(S * S);
    const tint = [0.03, -0.035];
    for (let y = 0, i = 0; y < S; y++) for (let x = 0; x < S; x++, i++) {
      const u = (x + 0.5) / S * TILE.cladding, panel = u < 1.2 ? 0 : 1, lu = u - panel * 1.2;
      const d = Math.min(lu, 1.2 - lu), groove = 1 - sstep(0.002, 0.007, d);
      const k = (1 + tint[panel] + 0.05 * (lo[i] - 0.5) + 0.025 * (hi[i] - 0.5) + 0.03 * (streak[i] - 0.5)) * (1 - 0.55 * groove);
      col.set(i, base, k);
      rough[i] = 0.6 + 0.08 * (lo[i] - 0.5) + 0.25 * groove;
      hgt[i] = (1 - groove) + 0.015 * hi[i];
    }
    M.cladding = std(pbrSet(S, S, TILE.cladding, col, rough, hgt, 3.5), { name: 'cladding' });
    M.cladding.envMapIntensity = 0.7; // plus haut, le bardage vire au bleu marine sous le ciel
    M.cladding.userData.fixedEnv = true;
  }

  lap('Bardage');
  // --- Rives de dalles : béton lissé peint ------------------------------------
  {
    const S = 256, lo = fbm(S, S, { px: 2, oct: 4, seed: 7 }), hi = fbm(S, S, { px: 64, oct: 2, seed: 8 });
    const base = hex('#f4f3ef'), col = new Buf(S, S), rough = new Float32Array(S * S), hgt = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) {
      col.set(i, base, 1 + 0.025 * (lo[i] - 0.5) + 0.012 * (hi[i] - 0.5));
      rough[i] = 0.5 + 0.1 * (lo[i] - 0.5); hgt[i] = hi[i];
    }
    M.slabWhite = std(pbrSet(S, S, TILE.slab, col, rough, hgt, 0.8), { name: 'slabWhite' });
  }

  lap('Rives');
  // --- Bois : lames (sous-face et terrasse) ----------------------------------
  const woodSet = (S, tile, boardW, gapW, cuts, baseHex, darkHex, lightHex, seed) => {
    const grain = fbm(S, S, { px: 1, py: 64, oct: 4, seed }), fine = fbm(S, S, { px: 4, py: 256, oct: 2, seed: seed + 1 }), lo = fbm(S, S, { px: 2, oct: 3, seed: seed + 2 });
    const r = mulberry32(seed), nb = Math.round(tile / boardW);
    const boards = Array.from({ length: nb }, () => ({ shift: [r() * S | 0, r() * S | 0], tint: [0.88 + r() * 0.24, 0.88 + r() * 0.24], cut: r() * tile }));
    const base = hex(baseHex), dark = hex(darkHex), light = hex(lightHex), gapC = hex('#24190f');
    const col = new Buf(S, S), rough = new Float32Array(S * S), hgt = new Float32Array(S * S);
    for (let y = 0, i = 0; y < S; y++) {
      const v = (y + 0.5) / S * tile, b = Math.min(nb - 1, Math.floor(v / boardW)), lv = v - b * boardW;
      const dv = Math.min(lv, boardW - lv), B = boards[b];
      for (let x = 0; x < S; x++, i++) {
        const u = (x + 0.5) / S * tile;
        let piece = 0, du = 1;
        if (cuts) {
          const c1 = B.cut, c2 = (B.cut + tile / 2) % tile;
          const inA = c1 < c2 ? (u >= c1 && u < c2) : (u >= c1 || u < c2);
          piece = inA ? 0 : 1;
          du = Math.min(Math.abs(u - c1), Math.abs(u - c2), tile - Math.abs(u - c1), tile - Math.abs(u - c2));
        }
        const gap = Math.max(1 - sstep(gapW * 0.35, gapW * 0.7, dv), 1 - sstep(0.001, 0.003, du));
        const gx = (x + B.shift[piece]) % S, gr = grain[y * S + gx], fn = fine[y * S + gx];
        const t = Math.pow(gr, 1.4);
        let c = mixc(dark, light, t); c = mixc(c, base, 0.45);
        const k = B.tint[piece] * (0.92 + 0.16 * fn) * (1 + 0.08 * (lo[i] - 0.5)) * (0.8 + 0.2 * sstep(0, gapW * 1.6, dv));
        col.set(i, mixc(c.map(q => q * k), gapC, gap));
        rough[i] = 0.6 + 0.12 * gr + 0.3 * gap;
        hgt[i] = (1 - gap) * (0.85 + 0.15 * sstep(0, gapW * 1.5, dv)) + 0.04 * fn + 0.03 * gr;
      }
    }
    return pbrSet(S, S, tile, col, rough, hgt, 3);
  };
  M.woodSoffit = std(woodSet(512, TILE.soffit, 0.1, 0.008, false, '#9a6a42', '#6e4728', '#b98654', 51), { name: 'woodSoffit' });
  M.deck = std(woodSet(512, TILE.deck, 0.14, 0.007, true, '#8a5a3b', '#5c3a24', '#a87452', 61), { name: 'deck' });

  lap('Bois');
  // --- Porte sectionnelle (rainures tous les 0,5 m) ---------------------------
  {
    const S = 256, lo = fbm(S, S, { px: 2, oct: 3, seed: 71 }), hi = fbm(S, S, { px: 64, oct: 2, seed: 72 }), brush = fbm(S, S, { px: 1, py: 128, oct: 2, seed: 73 });
    const base = hex('#2b2e31'), col = new Buf(S, S), rough = new Float32Array(S * S), hgt = new Float32Array(S * S);
    for (let y = 0, i = 0; y < S; y++) {
      const v = (y + 0.5) / S * TILE.garage, lv = v % 0.5, d = Math.min(lv, 0.5 - lv);
      const groove = 1 - sstep(0.002, 0.012, d), lip = sstep(0.012, 0.018, d) * (1 - sstep(0.018, 0.03, d));
      for (let x = 0; x < S; x++, i++) {
        col.set(i, base, (1 + 0.04 * (lo[i] - 0.5) + 0.02 * (brush[i] - 0.5)) * (1 - 0.5 * groove) * (1 + 0.08 * lip));
        rough[i] = 0.48 + 0.08 * (hi[i] - 0.5) + 0.15 * groove;
        hgt[i] = 1 - groove * 0.9 + 0.1 * lip + 0.01 * hi[i];
      }
    }
    M.garageDoor = std(pbrSet(S, S, TILE.garage, col, rough, hgt, 6), { name: 'garageDoor', metalness: 0.35 });
  }

  lap('Porte');
  // --- Porte d'entrée ------------------------------------------------------------
  {
    const S = 256, lo = fbm(S, S, { px: 2, oct: 3, seed: 81 }), brush = fbm(S, S, { px: 1, py: 128, oct: 2, seed: 82 });
    const base = hex('#2a2d30'), col = new Buf(S, S), rough = new Float32Array(S * S), hgt = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) {
      col.set(i, base, 1 + 0.03 * (lo[i] - 0.5) + 0.02 * (brush[i] - 0.5));
      rough[i] = 0.42 + 0.1 * (brush[i] - 0.5); hgt[i] = brush[i] * 0.3;
    }
    M.doorDark = std(pbrSet(S, S, TILE.door, col, rough, hgt, 0.6), { name: 'doorDark', metalness: 0.3 });
  }

  lap('Porte');
  // --- Menuiseries, métal -----------------------------------------------------------
  M.frameDark = new THREE.MeshStandardMaterial({ name: 'frameDark', color: 0x202326, metalness: 0.6, roughness: 0.35 });
  // les cadres affleurent parfois le mur qui les porte : on les fait gagner pour éviter le scintillement
  Object.assign(M.frameDark, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  M.metal = new THREE.MeshStandardMaterial({ name: 'metal', color: 0x7d8084, metalness: 0.9, roughness: 0.32 });

  lap('Menuiseries,');
  // --- Vitrages ---------------------------------------------------------------------------
  // Le reflet n'est pas atténué par l'opacité : rgb ajouté en entier, la scène derrière
  // transmise à hauteur de (1 - opacity) (mélange ONE / ONE_MINUS_SRC_ALPHA).
  // Vitrage de fenêtre (passe 4) : reflet de l'environnement pondéré par Fresnel (Schlick, F0 = 4 %),
  // l'opacité suit Fresnel : ~10 % de face (l'intérieur reste lisible, à peine teinté),
  // quasi miroir en incidence rasante. Le verre est exclu de l'AO (userData.noAO).
  M.glass = new THREE.MeshPhysicalMaterial({
    name: 'glass', color: 0x0a0e10, metalness: 0, roughness: 0.03, envMapIntensity: 1.0, ior: 1.52,
    transparent: true, opacity: 0.5, blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation,
  });
  M.glass.userData.noAO = true;
  M.glass.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `#include <opaque_fragment>
      {
        float gNoV = clamp( dot( normalize( normal ), normalize( vViewPosition ) ), 0.0, 1.0 );
        float gF = 0.04 + 0.96 * pow( 1.0 - gNoV, 5.0 );
        gl_FragColor.a = clamp( 0.1 + 0.9 * gF, 0.0, 0.96 );
      }`);
  };
  M.glass.customProgramCacheKey = () => 'glass-fresnel-v1';
  M.glassRail = new THREE.MeshPhysicalMaterial({
    name: 'glassRail', color: 0x0e1714, metalness: 0, roughness: 0.05, envMapIntensity: 1.0, ior: 1.5,
    transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation,
  });

  lap('Vitrages');
  // --- Intérieur chaud (pièce suggérée) -----------------------------------------------
  {
    const W = 1024, H = 768, ppm = W / TILE.interior[0];
    const cv = makeCanvas(W, H), g = cv.getContext('2d'), r = mulberry32(91);
    const Y = m => H - m * ppm;  // hauteur en m depuis le sol de l'étage
    const wall = g.createLinearGradient(0, 0, 0, H);
    wall.addColorStop(0, '#fff3dc'); wall.addColorStop(0.45, '#f6e2bf'); wall.addColorStop(0.85, '#e9cfa4'); wall.addColorStop(1, '#d9b98a');
    g.fillStyle = wall; g.fillRect(0, 0, W, H);
    // plafond et gorge lumineuse
    g.fillStyle = '#fff6e6'; g.fillRect(0, 0, W, Y(2.72));
    for (const sx of [0.9, 2.9]) {
      const rg = g.createRadialGradient(sx * ppm, Y(2.6), 0, sx * ppm, Y(2.6), ppm * 1.3);
      rg.addColorStop(0, 'rgba(255,248,225,0.95)'); rg.addColorStop(1, 'rgba(255,248,225,0)');
      g.fillStyle = rg; g.fillRect(0, 0, W, H);
    }
    // sol bois
    const fl = g.createLinearGradient(0, Y(0.32), 0, H);
    fl.addColorStop(0, '#9a6d45'); fl.addColorStop(1, '#6e4a2c');
    g.fillStyle = fl; g.fillRect(0, Y(0.32), W, H);
    g.fillStyle = '#efe2c8'; g.fillRect(0, Y(0.4), W, 0.08 * ppm);   // plinthe
    // tableau
    g.fillStyle = '#3a3129'; g.fillRect(0.55 * ppm, Y(2.15), 1.0 * ppm, 0.7 * ppm);
    const art = g.createLinearGradient(0.6 * ppm, 0, 1.5 * ppm, 0);
    art.addColorStop(0, '#c9b089'); art.addColorStop(0.5, '#8e7b62'); art.addColorStop(1, '#b59a72');
    g.fillStyle = art; g.fillRect(0.6 * ppm, Y(2.1), 0.9 * ppm, 0.6 * ppm);
    g.fillStyle = 'rgba(70,90,80,0.55)'; g.beginPath(); g.ellipse(0.95 * ppm, Y(1.75), 0.2 * ppm, 0.12 * ppm, 0.3, 0, 7); g.fill();
    // canapé avec ombre douce
    g.save(); g.shadowColor = 'rgba(60,35,15,0.55)'; g.shadowBlur = 40; g.shadowOffsetY = 8;
    g.fillStyle = '#7b6a58'; g.beginPath(); g.roundRect(0.25 * ppm, Y(0.95), 1.9 * ppm, 0.6 * ppm, 14); g.fill();
    g.restore();
    g.fillStyle = '#8e7c68'; for (let k = 0; k < 3; k++) { g.beginPath(); g.roundRect((0.35 + k * 0.6) * ppm, Y(0.92), 0.55 * ppm, 0.3 * ppm, 10); g.fill(); }
    g.fillStyle = '#5d4f42'; g.fillRect(0.25 * ppm, Y(0.4), 1.9 * ppm, 0.05 * ppm);
    // lampadaire et halo
    g.strokeStyle = '#3b332b'; g.lineWidth = 4; g.beginPath(); g.moveTo(2.6 * ppm, Y(0.32)); g.lineTo(2.6 * ppm, Y(1.55)); g.stroke();
    g.globalCompositeOperation = 'lighter';
    const lg = g.createRadialGradient(2.6 * ppm, Y(1.6), 0, 2.6 * ppm, Y(1.6), 0.9 * ppm);
    lg.addColorStop(0, 'rgba(255,230,170,0.8)'); lg.addColorStop(0.4, 'rgba(255,200,120,0.25)'); lg.addColorStop(1, 'rgba(255,200,120,0)');
    g.fillStyle = lg; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#fff1cf'; g.beginPath(); g.moveTo(2.47 * ppm, Y(1.55)); g.lineTo(2.73 * ppm, Y(1.55)); g.lineTo(2.67 * ppm, Y(1.8)); g.lineTo(2.53 * ppm, Y(1.8)); g.closePath(); g.fill();
    // plante en pot
    g.fillStyle = '#4a4440'; g.beginPath(); g.roundRect(3.3 * ppm, Y(0.75), 0.42 * ppm, 0.43 * ppm, 6); g.fill();
    for (let k = 0; k < 26; k++) {
      const a = -Math.PI / 2 + (r() - 0.5) * 2.2, L = (0.35 + r() * 0.55) * ppm;
      const x0 = 3.51 * ppm, y0 = Y(0.75);
      g.fillStyle = hsl(110 + r() * 20, 35, 18 + r() * 12);
      g.save(); g.translate(x0 + Math.cos(a) * L * 0.6, y0 + Math.sin(a) * L * 0.6); g.rotate(a);
      g.beginPath(); g.ellipse(0, 0, L * 0.45, L * 0.13, 0, 0, 7); g.fill(); g.restore();
    }
    // étagère basse à droite
    g.fillStyle = '#c9ad85'; g.fillRect(3.85 * ppm, Y(1.1), 0.6 * ppm, 0.78 * ppm);
    g.fillStyle = 'rgba(80,60,40,0.4)'; for (let k = 0; k < 3; k++) g.fillRect(3.85 * ppm, Y(0.45 + k * 0.25), 0.6 * ppm, 3);
    // vignettage
    const vg = g.createRadialGradient(W / 2, H * 0.45, H * 0.3, W / 2, H * 0.45, W * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(60,30,0,0.25)');
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
    const t = tex(cv, TILE.interior, true);
    t.dispose();
    // passe 4 : n'habille plus que les spots et appliques (les pièces sont dans interiors.js)
    M.interiorWarm = new THREE.MeshStandardMaterial({ name: 'interiorWarm', color: 0xfff3e0, emissive: 0xffdcae, emissiveIntensity: 2.2, roughness: 0.6, metalness: 0 });
  }

  lap('Intérieur');
  // --- Pavés de l'allée ---------------------------------------------------------------
  {
    const S = 512, tile = TILE.paver, lo = fbm(S, S, { px: 2, oct: 4, seed: 101 }), hi = fbm(S, S, { px: 64, oct: 3, seed: 102 }), wn = white(S * S, 103);
    const r = mulberry32(104), tints = Array.from({ length: 64 }, () => [(r() - 0.5) * 2, (r() - 0.5) * 2]);
    const base = hex('#b9b8b3'), jointC = hex('#7b766c'), col = new Buf(S, S), rough = new Float32Array(S * S), hgt = new Float32Array(S * S);
    for (let y = 0, i = 0; y < S; y++) {
      const v = (y + 0.5) / S * tile, row = Math.floor(v / 0.3), lv = v - row * 0.3;
      for (let x = 0; x < S; x++, i++) {
        const u = ((x + 0.5) / S * tile + (row & 1) * 0.3) % tile, c = Math.floor(u / 0.6), lu = u - c * 0.6;
        const d = Math.min(lu, 0.6 - lu, lv, 0.3 - lv), joint = 1 - sstep(0.003, 0.005, d), bevel = sstep(0.004, 0.012, d);
        const [t1, t2] = tints[(row * 4 + c) & 63];
        const spk = wn[i] > 0.97 ? -0.12 : wn[i] < 0.03 ? 0.08 : 0;
        const k = 1 + 0.06 * t1 + 0.05 * (lo[i] - 0.5) + 0.06 * (hi[i] - 0.5) + spk;
        const sc = [base[0] * k * (1 + 0.015 * t2), base[1] * k, base[2] * k * (1 - 0.015 * t2)];
        col.set(i, mixc(sc.map(q => q * (0.88 + 0.12 * bevel)), jointC, joint));
        rough[i] = 0.78 + 0.08 * (hi[i] - 0.5) + 0.15 * joint;
        hgt[i] = bevel * (0.88 + 0.12 * hi[i]);
      }
    }
    M.paver = std(pbrSet(S, S, tile, col, rough, hgt, 4), { name: 'paver' });
  }

  lap('Pavés');
  // --- Trottoir : dalles béton 1,5 m ------------------------------------------------
  {
    const S = 512, tile = TILE.sidewalk, lo = fbm(S, S, { px: 2, oct: 4, seed: 111 }), stain = fbm(S, S, { px: 4, oct: 4, seed: 112 }), broom = fbm(S, S, { px: 2, py: 128, oct: 2, seed: 113 }), agg = fbm(S, S, { px: 128, oct: 2, seed: 114 });
    const r = mulberry32(115), tints = [r() - 0.5, r() - 0.5, r() - 0.5, r() - 0.5];
    const base = hex('#cfcdc6'), col = new Buf(S, S), rough = new Float32Array(S * S), hgt = new Float32Array(S * S);
    for (let y = 0, i = 0; y < S; y++) {
      const v = (y + 0.5) / S * tile, sv = v < 1.5 ? 0 : 1, lv = v - sv * 1.5;
      for (let x = 0; x < S; x++, i++) {
        const u = (x + 0.5) / S * tile, su = u < 1.5 ? 0 : 1, lu = u - su * 1.5;
        const d = Math.min(lu, 1.5 - lu, lv, 1.5 - lv), joint = 1 - sstep(0.003, 0.007, d);
        const st = sstep(0.3, 0.12, stain[i]);
        const k = (1 + 0.05 * tints[sv * 2 + su] + 0.05 * (lo[i] - 0.5) + 0.03 * (broom[i] - 0.5) + 0.06 * (agg[i] - 0.5) - 0.1 * st) * (1 - 0.4 * joint);
        col.set(i, base, k);
        rough[i] = 0.84 + 0.06 * (agg[i] - 0.5) - 0.1 * st + 0.1 * joint;
        hgt[i] = (1 - joint) * 0.8 + 0.1 * broom[i] + 0.1 * agg[i];
      }
    }
    M.sidewalk = std(pbrSet(S, S, tile, col, rough, hgt, 2.5), { name: 'sidewalk' });
  }

  lap('Trottoir');
  // --- Enrobé --------------------------------------------------------------------------------
  {
    const S = 1024, tile = TILE.asphalt, g1 = fbm(S, S, { px: 256, oct: 1, seed: 121 }), g2 = fbm(S, S, { px: 64, oct: 3, seed: 122 }), lo = fbm(S, S, { px: 2, oct: 4, seed: 123 });
    const base = hex('#5d6064'), light = hex('#8d8f90'), dark = hex('#36383b'), col = new Buf(S, S), rough = new Float32Array(S * S), hgt = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) {
      const stone = sstep(0.62, 0.78, g1[i]) * sstep(0.35, 0.6, g2[i]), pit = 1 - sstep(0.06, 0.2, g1[i]);
      let c = mixc(base, light, stone * 0.7); c = mixc(c, dark, pit * 0.7);
      col.set(i, c, 1 + 0.1 * (lo[i] - 0.5) + 0.05 * (g2[i] - 0.5));
      rough[i] = 0.9 - 0.12 * stone + 0.05 * pit;
      hgt[i] = 0.65 * g1[i] + 0.35 * g2[i];
    }
    M.asphalt = std(pbrSet(S, S, tile, col, rough, hgt, 2.2), { name: 'asphalt' });
  }

  lap('Enrobé');
  // --- Bordure béton ------------------------------------------------------------------------
  {
    const S = 256, tile = TILE.curb, lo = fbm(S, S, { px: 2, oct: 4, seed: 131 }), agg = fbm(S, S, { px: 64, oct: 2, seed: 132 });
    const base = hex('#bdbbb5'), col = new Buf(S, S), rough = new Float32Array(S * S), hgt = new Float32Array(S * S);
    for (let y = 0, i = 0; y < S; y++) for (let x = 0; x < S; x++, i++) {
      const u = (x + 0.5) / S * tile, lu = u % 1, d = Math.min(lu, 1 - lu), joint = 1 - sstep(0.003, 0.008, d);
      col.set(i, base, (1 + 0.06 * (lo[i] - 0.5) + 0.06 * (agg[i] - 0.5)) * (1 - 0.45 * joint));
      rough[i] = 0.85 + 0.06 * (agg[i] - 0.5); hgt[i] = (1 - joint) * 0.8 + 0.2 * agg[i];
    }
    M.curb = std(pbrSet(S, S, tile, col, rough, hgt, 2), { name: 'curb' });
  }

  lap('Bordure');
  // --- Pelouse (fond bruité + milliers de brins dessinés) ------------------------------
  {
    const S = 1024, lo = fbm(S, S, { px: 2, oct: 4, seed: 141 }), mid = fbm(S, S, { px: 8, oct: 3, seed: 142 });
    const dark = hex('#2f3c14'), midc = hex('#55651f'), dry = hex('#7d7b34'), col = new Buf(S, S);
    for (let i = 0; i < S * S; i++) {
      let c = mixc(dark, midc, mid[i]); c = mixc(c, dry, sstep(0.62, 0.9, lo[i]) * 0.5);
      col.set(i, c, 0.9 + 0.2 * lo[i]);
    }
    const cv = canvasRGBA(S, S, col.d), g = cv.getContext('2d'), r = mulberry32(143);
    const buckets = Array.from({ length: 14 }, (_, k) => ({ p: new Path2D(), c: hsl(66 + r() * 24, 45 + r() * 25, 14 + k * 2.5), w: 1 + r() * 0.9 }));
    for (let n = 0; n < 70000; n++) {
      const b = buckets[(r() * 14) | 0];
      const x = r() * S, y = r() * S, a = r() * Math.PI * 2, L = 5 + r() * 12;
      b.p.moveTo(x, y); b.p.quadraticCurveTo(x + Math.cos(a) * L * 0.5 + (r() - 0.5) * 3, y + Math.sin(a) * L * 0.5, x + Math.cos(a) * L, y + Math.sin(a) * L);
    }
    g.lineCap = 'round';
    for (const b of buckets) {
      g.strokeStyle = b.c; g.lineWidth = b.w; g.globalAlpha = 0.85;
      for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) { g.setTransform(1, 0, 0, 1, ox, oy); g.stroke(b.p); }
    }
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1;
    const d = g.getImageData(0, 0, S, S).data, rough = new Float32Array(S * S), hgt = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) { const l = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) / 255; hgt[i] = l; rough[i] = 0.92 - 0.25 * l; }
    M.grass = new THREE.MeshStandardMaterial({
      name: 'grass', map: tex(cv, TILE.grass, true), roughnessMap: tex(canvasRGBA(S, S, grayData(rough)), TILE.grass),
      normalMap: tex(canvasRGBA(S, S, normalData(hgt, S, S, 3)), TILE.grass), roughness: 1, metalness: 0,
    });
  }

  lap('Pelouse');
  // --- Sol de prairie (tapis herbacé détaillé, 3 m par répétition) ----------------------
  {
    const S = 1024, cv = makeCanvas(S, S), g = cv.getContext('2d');
    drawMeadowGround(g, S, 231);
    const d = g.getImageData(0, 0, S, S).data, hgt = new Float32Array(S * S), rough = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) { const l = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) / 255; hgt[i] = l; rough[i] = 0.95 - 0.2 * l; }
    M.meadowGround = new THREE.MeshStandardMaterial({
      name: 'meadowGround', map: tex(cv, 3.0, true), roughnessMap: tex(canvasRGBA(S, S, grayData(rough)), 3.0),
      normalMap: tex(canvasRGBA(S, S, normalData(hgt, S, S, 4)), 3.0), roughness: 1, metalness: 0,
    });
  }
  lap('meadowGround');
  // --- Terre de massif (mottes + paillis) -------------------------------------------------
  {
    const S = 512, lo = fbm(S, S, { px: 4, oct: 4, seed: 151 }), mid = fbm(S, S, { px: 16, oct: 3, seed: 152 });
    const a = hex('#33271b'), b = hex('#57432e'), col = new Buf(S, S);
    for (let i = 0; i < S * S; i++) col.set(i, mixc(a, b, mid[i] * 0.7 + lo[i] * 0.3));
    const cv = canvasRGBA(S, S, col.d), g = cv.getContext('2d'), r = mulberry32(153);
    const buckets = ['#6b5038', '#3a2b1d', '#7a5d40', '#2b2017', '#8a8070'].map((c, k) => ({ p: new Path2D(), c, w: k === 4 ? 2.5 : 2 + r() * 2 }));
    for (let n = 0; n < 5000; n++) {
      const b = buckets[n % 37 === 0 ? 4 : (r() * 4) | 0], x = r() * S, y = r() * S, a2 = r() * 6.3, L = buckets.indexOf(b) === 4 ? 1 : 4 + r() * 10;
      b.p.moveTo(x, y); b.p.lineTo(x + Math.cos(a2) * L, y + Math.sin(a2) * L);
    }
    g.lineCap = 'round';
    for (const b of buckets) { g.strokeStyle = b.c; g.lineWidth = b.w; for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) { g.setTransform(1, 0, 0, 1, ox, oy); g.stroke(b.p); } }
    g.setTransform(1, 0, 0, 1, 0, 0);
    const d = g.getImageData(0, 0, S, S).data, hgt = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) hgt[i] = 0.5 * lo[i] + 0.5 * d[i * 4 + 1] / 255;
    M.soil = new THREE.MeshStandardMaterial({ name: 'soil', map: tex(cv, TILE.soil, true), normalMap: tex(canvasRGBA(S, S, normalData(hgt, S, S, 4)), TILE.soil), roughness: 0.96, metalness: 0 });
  }

  lap('Terre');
  // --- Écorce (sillons verticaux, plaques, lichens) -----------------------------------------
  {
    const S = 512, f = fbm(S, S, { px: 16, py: 2, oct: 4, seed: 161 }), cr = fbm(S, S, { px: 4, py: 32, oct: 3, seed: 162 }), hi = fbm(S, S, { px: 64, oct: 2, seed: 163 }), lo = fbm(S, S, { px: 2, oct: 3, seed: 164 });
    const dk = hex('#2b241e'), md = hex('#5d554c'), lt = hex('#8f877c'), li = hex('#8b9473');
    const col = new Buf(S, S), rough = new Float32Array(S * S), hgt = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) {
      const ridge = Math.pow(1 - Math.abs(2 * f[i] - 1), 0.7), crack = 1 - sstep(0.04, 0.12, Math.abs(cr[i] - 0.5));
      const h = clamp01(ridge * (0.75 + 0.25 * hi[i]) - 0.35 * crack * ridge);
      let c = h < 0.5 ? mixc(dk, md, h * 2) : mixc(md, lt, (h - 0.5) * 2);
      c = mixc(c, li, sstep(0.62, 0.8, lo[i]) * 0.45 * h);
      col.set(i, c);
      rough[i] = 0.93 - 0.06 * h; hgt[i] = h;
    }
    M.bark = std(pbrSet(S, S, TILE.bark, col, rough, hgt, 7), { name: 'bark' });
  }

  lap('Écorce');
  // --- Bac de jardinière -------------------------------------------------------------------
  {
    const S = 256, lo = fbm(S, S, { px: 2, oct: 4, seed: 171 }), hi = fbm(S, S, { px: 128, oct: 1, seed: 172 });
    const base = hex('#2f3236'), col = new Buf(S, S), rough = new Float32Array(S * S), hgt = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) { col.set(i, base, 1 + 0.06 * (lo[i] - 0.5) + 0.04 * (hi[i] - 0.5)); rough[i] = 0.6 + 0.1 * (lo[i] - 0.5); hgt[i] = hi[i]; }
    M.planter = std(pbrSet(S, S, TILE.planter, col, rough, hgt, 0.35), { name: 'planter' });
  }

  lap('Bac');
  // --- Toiture végétalisée : mosaïque vert / olive / ocre / rouille ---------------------------
  {
    const S = 512, a = fbm(S, S, { px: 4, oct: 5, seed: 181 }), b = fbm(S, S, { px: 4, oct: 4, seed: 182 }), hi = fbm(S, S, { px: 64, oct: 3, seed: 183 }), dots = fbm(S, S, { px: 128, oct: 1, seed: 184 });
    const green = hex('#56732f'), olive = hex('#7b8236'), ocre = hex('#b08b45'), rust = hex('#93512f'), dark = hex('#2f3c1c');
    const col = new Buf(S, S), rough = new Float32Array(S * S), hgt = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) {
      let c = mixc(green, olive, sstep(0.4, 0.52, a[i]));
      c = mixc(c, mixc(ocre, rust, sstep(0.4, 0.62, b[i])), sstep(0.58, 0.7, a[i]));
      c = mixc(c, dark, sstep(0.3, 0.12, dots[i]) * 0.7);
      col.set(i, c, 0.72 + 0.5 * hi[i]);
      rough[i] = 0.9; hgt[i] = 0.55 * hi[i] + 0.25 * a[i] + 0.2 * dots[i];
    }
    M.greenRoof = std(pbrSet(S, S, TILE.greenRoof, col, rough, hgt, 5), { name: 'greenRoof' });
  }

  lap('Toiture');
  // --- Lin écru des coussins ---------------------------------------------------------------
  {
    const S = 256, slubU = fbm(S, S, { px: 1, py: 32, oct: 3, seed: 191 }), slubV = fbm(S, S, { px: 32, py: 1, oct: 3, seed: 192 }), lo = fbm(S, S, { px: 2, oct: 3, seed: 193 });
    const base = hex('#d9d0bf'), col = new Buf(S, S), rough = new Float32Array(S * S), hgt = new Float32Array(S * S), th = S / 64;
    for (let y = 0, i = 0; y < S; y++) for (let x = 0; x < S; x++, i++) {
      const tx = x / th, ty = y / th, over = ((Math.floor(tx) + Math.floor(ty)) & 1) === 0;
      const hw = Math.sin(Math.PI * (tx % 1)) * (0.8 + 0.4 * slubU[i]), hf = Math.sin(Math.PI * (ty % 1)) * (0.8 + 0.4 * slubV[i]);
      const h = over ? 0.55 + 0.45 * hw : 0.55 + 0.45 * hf;
      col.set(i, base, 0.86 + 0.14 * h + 0.05 * (lo[i] - 0.5) + 0.04 * ((over ? slubU[i] : slubV[i]) - 0.5));
      rough[i] = 0.95; hgt[i] = h;
    }
    M.fabric = std(pbrSet(S, S, TILE.fabric, col, rough, hgt, 1.6), { name: 'fabric' });
  }

  lap('Lin');
  // --- Feuillages ---------------------------------------------------------------------------
  const foliage = (name, tex, p = {}, f = {}) => patchFoliage(THREE, new THREE.MeshStandardMaterial({
    name, map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: p.roughness ?? 0.75, metalness: 0, envMapIntensity: p.env ?? 0.7, color: p.color ?? 0xffffff,
  }), f);
  M.leafA = foliage('leafA', cardTexture(THREE, 512, 512, (g, w, h) => drawTwig(g, w, h, 'A', 201), aniso));
  lap('leafA');
  M.leafB = foliage('leafB', cardTexture(THREE, 512, 512, (g, w, h) => drawTwig(g, w, h, 'B', 202), aniso));
  lap('leafB');
  M.leafC = foliage('leafC', cardTexture(THREE, 512, 512, (g, w, h) => drawTwig(g, w, h, 'C', 203), aniso));
  lap('leafC');
  M.leafClump = foliage('leafClump', cardTexture(THREE, 512, 512, (g, w, h) => drawClump(g, w, h, 204), aniso));
  lap('leafClump');
  // Feuillages complémentaires utilisés par landscape.js
  M.leafTropical = foliage('leafTropical', cardTexture(THREE, 256, 1024, (g, w, h) => drawStrelitzia(g, w, h, 211), aniso), { roughness: 0.6, env: 0.8 }, { crown: 0, wrap: 0.6, trans: 0.6 });
  lap('leafTropical');
  M.leafPalm = foliage('leafPalm', cardTexture(THREE, 512, 1024, (g, w, h) => drawPalm(g, w, h, 212), aniso), { roughness: 0.65, env: 0.8 }, { crown: 0, wrap: 0.6, trans: 0.7 });
  lap('leafPalm');
  M.leafTrail = foliage('leafTrail', cardTexture(THREE, 256, 1024, (g, w, h) => drawTrail(g, w, h, 213), aniso), { roughness: 0.55 }, { crown: 0, wrap: 0.5, trans: 0.5 });
  lap('leafTrail');
  M.grassBlade = foliage('grassBlade', cardTexture(THREE, 512, 512, (g, w, h) => drawBlades(g, w, h, 214), aniso), { roughness: 0.8 }, { crown: 0, wrap: 0.6, trans: 0.8 });
  lap('grassBlade');
  M.grassPlume = foliage('grassPlume', cardTexture(THREE, 512, 1024, (g, w, h) => drawPlumes(g, w, h, 215), aniso), { roughness: 0.85 }, { crown: 0, wrap: 0.6, trans: 0.9 });
  lap('grassPlume');
  M.flowerLav = foliage('flowerLav', cardTexture(THREE, 512, 512, (g, w, h) => drawLavender(g, w, h, 216), aniso), { roughness: 0.8 }, { crown: 0, wrap: 0.5, trans: 0.4 });
  lap('flowerLav');
  M.flowerWhite = foliage('flowerWhite', cardTexture(THREE, 512, 512, (g, w, h) => drawWhiteFlowers(g, w, h, 217), aniso), { roughness: 0.75 }, { crown: 0, wrap: 0.5, trans: 0.5 });
  lap('flowerWhite');
  M.sedum = foliage('sedum', cardTexture(THREE, 512, 512, (g, w, h) => drawSedum(g, w, h, 218), aniso), { roughness: 0.8 }, { crown: 0, wrap: 0.3, trans: 0.3 });
  lap('sedum');

  lap('Feuillages');
  {
    const t = cardTexture(THREE, 1024, 384, (g, w, h) => drawTreeLine(g, w, h, 219), aniso);
    t.wrapS = THREE.RepeatWrapping;
    M.forestEdge = foliage('forestEdge', t, { roughness: 0.9, env: 0.6 }, { crown: 0, wrap: 0.5, trans: 0.2 });
  }
  lap('forestEdge');
  // Petites plantes en cartes à normales « dôme » : exclues du G-buffer de la GTAO du viewer
  // (sinon l'occlusion les rend noires) ; les houppiers et arbustes gardent l'AO.
  for (const k of ['leafTropical', 'leafPalm', 'leafTrail', 'grassBlade', 'grassPlume', 'flowerLav', 'flowerWhite', 'sedum']) M[k].userData.noAO = true;
  // --- Divers ---------------------------------------------------------------------------
  M.marking = new THREE.MeshStandardMaterial({ name: 'marking', color: 0xe9e8e2, roughness: 0.7, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });

  // --- Intérieurs : sols, murs, plafonds, carrelages, palette de décoration --------------
  interiorMaterials(THREE, M, { tex, pbrSet, std, aniso, lap });
  lap('Intérieurs');

  // Métadonnées non énumérables (Object.values(M) ne contient que des matériaux)
  Object.defineProperty(M, 'userData', { value: { buildTime: performance.now() - t0, timings, tile: TILE }, enumerable: false });
  return M;
}

// ===========================================================================
// Intérieurs (passe « intérieurs photoréalistes ») — voir le bloc de documentation
// en tête de fichier pour la liste des matériaux exportés.
// ===========================================================================
function interiorMaterials(THREE, M, { tex, pbrSet, std, aniso, lap = () => {} }) {
  const V2 = (x, y = x) => new THREE.Vector2(x, y);
  const mark = (m, kind) => { m.userData.interior = kind || true; return m; };
  // matériaux coûteux et facultatifs : construits au premier accès (M.marbleWhite…), pas au chargement
  const lazy = (keys, build) => {
    let done = false;
    const run = () => { if (done) return; done = true; for (const k of keys) delete M[k]; build(); };
    for (const k of keys) Object.defineProperty(M, k, { configurable: true, enumerable: true, get() { run(); return M[k]; }, set(v) { run(); Object.defineProperty(M, k, { value: v, writable: true, configurable: true, enumerable: true }); } });
  };

  // ---- Parquet chêne naturel, lames 19 cm × 0,9–2,4 m, micro-chanfreins, vernis mat satiné ----
  // Lames orientées selon v (direction -z du monde avec les UV « boîte » de lots.js).
  {
    const W = 1024, H = 2048, TU = 2.28, TV = 2.4, PW = 0.19, NC = Math.round(TU / PW);
    const fib = fbm(W, H, { px: 256, py: 8, oct: 3, seed: 401 });      // fibres fines
    const ray = fbm(W, H, { px: 64, py: 4, oct: 3, seed: 402 });       // veinage (lignes ondulées)
    // bruits basse fréquence calculés au quart de la résolution (chargement plus rapide)
    const WL = W >> 2, HL = H >> 2;
    const lo = fbm(WL, HL, { px: 2, py: 4, oct: 4, seed: 403 });       // nuances larges
    const knot = fbm(WL, HL, { px: 16, py: 32, oct: 2, seed: 404 });   // petites taches / nœuds
    const smudge = fbm(WL, HL, { px: 4, py: 8, oct: 4, seed: 405 });   // usure du vernis (rugosité)
    const r = mulberry32(406);
    const cols = Array.from({ length: NC }, () => {
      const two = r() < 0.75, L1 = two ? 0.85 + r() * 0.7 : TV, o = r() * TV;
      const cuts = two ? [o, (o + L1) % TV] : [o];
      const planks = cuts.map(() => ({ tint: 0.9 + r() * 0.2, warm: (r() - 0.5) * 0.06, sx: r() * W | 0, sy: r() * H | 0, freq: 5 + r() * 9, ph: r(), rough: (r() - 0.5) * 0.08, rift: r() }));
      return { cuts, planks };
    });
    const early = hex('#c6ab8a'), late = hex('#977b5e'), gap = hex('#4d3c2e');
    const col = new Buf(W, H), rough = new Float32Array(W * H), hgt = new Float32Array(W * H);
    for (let y = 0, i = 0; y < H; y++) {
      const v = (y + 0.5) / H * TV;
      for (let x = 0; x < W; x++, i++) {
        const u = (x + 0.5) / W * TU, c = Math.min(NC - 1, Math.floor(u / PW)), lu = u - c * PW, C = cols[c];
        // lame courante (entre deux coupes, périodique)
        let pk = 0, dv = 9;
        if (C.cuts.length === 2) {
          const [a, b] = C.cuts, inA = a < b ? (v >= a && v < b) : (v >= a || v < b);
          pk = inA ? 0 : 1;
        }
        for (const cu of C.cuts) { const d = Math.abs(v - cu); dv = Math.min(dv, d, TV - d); }
        const P = C.planks[pk];
        const du = Math.min(lu, PW - lu);
        const jy = (y + P.sy) % H, jx = (x + P.sx) % W, j = jy * W + jx, jl = (jy >> 2) * WL + (jx >> 2), il = (y >> 2) * WL + (x >> 2);
        const t = lu / PW;
        // veinage : lignes de croissance ondulées (débit sur dosse / faux quartier)
        const phase = t * P.freq + 2.2 * ray[j] + P.ph + (P.rift > 0.6 ? 0.35 * Math.sin(v * 2.1 + P.ph * 6) : 0);
        const ln = 0.5 + 0.5 * Math.sin(phase * 6.2832);
        const l2 = ln * ln, lw = l2 * l2 * l2 * ln * (0.55 + 0.45 * fib[j]);
        const f = fib[j] - 0.5;
        const kn = sstep(0.8, 0.95, knot[jl]) * 0.5;
        const tt = clamp01(0.62 * lw + 0.35 * f + 0.25 * kn + 0.15 * (lo[jl] - 0.5));
        const k = P.tint * (1 + 0.07 * (lo[il] - 0.5));
        // micro-chanfrein (1,5 mm) sur les rives longues, joint fin en bout
        const bev = 1 - sstep(0.0002, 0.0019, du), endj = 1 - sstep(0.0002, 0.0011, dv);
        const e = (bev > endj ? bev : endj) * 0.75, ke = 1 - e, o4 = i * 4, d = col.d;
        d[o4] = (early[0] + (late[0] - early[0]) * tt) * k * (1 + P.warm) * ke + gap[0] * e;
        d[o4 + 1] = (early[1] + (late[1] - early[1]) * tt) * k * ke + gap[1] * e;
        d[o4 + 2] = (early[2] + (late[2] - early[2]) * tt) * k * (1 - P.warm * 1.5) * ke + gap[2] * e;
        d[o4 + 3] = 255;
        const edge = e / 0.75;
        rough[i] = clamp01(0.47 + P.rough + 0.12 * lw + 0.06 * (smudge[il] - 0.5) + 0.3 * edge);
        hgt[i] = (1 - 0.8 * Math.max(Math.sqrt(bev), endj)) + 0.035 * lw - 0.02 * f;
      }
    }
    const set = pbrSet(W, H, [TU, TV], col, rough, hgt, 2.2);
    M.oakParquet = mark(std(set, { name: 'oakParquet', normalScale: V2(0.8), envMapIntensity: 0.9 }), 'floor');
    // variante plus claire (chêne blanchi) et plus foncée (chêne fumé), mêmes textures
    M.oakParquetLight = mark(std(set, { name: 'oakParquetLight', color: new THREE.Color('#fff6ea'), normalScale: V2(0.8), envMapIntensity: 0.9 }), 'floor');
    M.oakParquetSmoked = mark(std(set, { name: 'oakParquetSmoked', color: new THREE.Color('#9b8c7c'), normalScale: V2(0.8), envMapIntensity: 0.9 }), 'floor');
  }

  lap('int:parquet');
  // ---- Peinture murale mate (texture neutre partagée : la couleur vient de .color) ----
  {
    const S = 512, peel = fbm(S, S, { px: 64, oct: 3, seed: 411 }), roll = fbm(S, S, { px: 4, py: 16, oct: 3, seed: 412 }), lo = fbm(S, S, { px: 2, oct: 4, seed: 413 });
    const col = new Buf(S, S), rough = new Float32Array(S * S), hgt = new Float32Array(S * S), w = [255, 255, 255];
    for (let i = 0; i < S * S; i++) {
      col.set(i, w, 0.985 + 0.012 * (lo[i] - 0.5) + 0.006 * (roll[i] - 0.5));
      rough[i] = 0.9 + 0.05 * (peel[i] - 0.5) - 0.03 * (roll[i] - 0.5);
      hgt[i] = 0.7 * peel[i] + 0.3 * roll[i];
    }
    const set = pbrSet(S, S, 1.5, col, rough, hgt, 0.9);
    const paint = (name, c, kind = 'wall', p = {}) => mark(std(set, { name, color: new THREE.Color(c), normalScale: V2(0.35), envMapIntensity: 0.6, ...p }), kind);
    M.wallPaint = paint('wallPaint', '#ece9e3');           // blanc chaud (murs)
    M.ceilingPaint = paint('ceilingPaint', '#f3f2ee', 'ceiling', { normalScale: V2(0.2) });
    M.wallPaintGreige = paint('wallPaintGreige', '#d6cec2');
    M.wallPaintSage = paint('wallPaintSage', '#b3b8a3');
    M.wallPaintClay = paint('wallPaintClay', '#c9a58c');
    M.skirting = mark(std({}, { name: 'skirting', color: new THREE.Color('#f0eee9'), roughness: 0.42, envMapIntensity: 0.7 }), 'wall');
  }

  lap('int:peinture');
  // ---- Carrelages ----
  const tiles = (name, { S = 512, tile = 1.2, nx = 2, ny = 2, base, jointC, joint = 0.002, rough = 0.45, glossVar = 0.06, stone = 0.05, wavy = 0, tintVar = 0.03, seed, ns = 3, hueVar = 0 }) => {
    const st = fbm(S, S, { px: 8, oct: 5, seed }), hi = fbm(S, S, { px: 64, oct: 2, seed: seed + 1 }), wv = fbm(S, S, { px: nx * 2, py: ny * 2, oct: 3, seed: seed + 2 });
    const r = mulberry32(seed + 3), n = nx * ny;
    const T = Array.from({ length: n }, () => ({ k: 1 + (r() - 0.5) * 2 * tintVar, h: (r() - 0.5) * hueVar, sx: r() * S | 0, sy: r() * S | 0, g: (r() - 0.5) * glossVar }));
    const B = hex(base), J = hex(jointC), col = new Buf(S, S), rg = new Float32Array(S * S), hgt = new Float32Array(S * S);
    const tw = tile / nx, th = tile / ny;
    for (let y = 0, i = 0; y < S; y++) {
      const v = (y + 0.5) / S * tile, ty = Math.floor(v / th), lv = v - ty * th;
      for (let x = 0; x < S; x++, i++) {
        const u = (x + 0.5) / S * tile, tx = Math.floor(u / tw), lu = u - tx * tw, P = T[(ty * nx + tx) % n];
        const d = Math.min(lu, tw - lu, lv, th - lv), jt = 1 - sstep(joint * 0.35, joint * 0.75, d), bev = sstep(joint * 0.5, joint * 2.5, d);
        const j = ((y + P.sy) % S) * S + ((x + P.sx) % S);
        const kk = P.k * (1 + stone * (st[j] - 0.5) + 0.02 * (hi[j] - 0.5));
        const c = [B[0] * kk * (1 + P.h), B[1] * kk, B[2] * kk * (1 - P.h)];
        col.set(i, mixc(c, J, jt));
        rg[i] = clamp01(rough + P.g + 0.04 * (hi[j] - 0.5) + 0.35 * jt);
        hgt[i] = bev * (1 - 0.4 * jt) + wavy * (wv[i] - 0.5) * bev + 0.01 * hi[j];
      }
    }
    return pbrSet(S, S, tile, col, rg, hgt, ns);
  };
  // grès cérame effet pierre 60 × 60, gris chaud, finition adoucie
  M.tileFloor = mark(std(tiles('tileFloor', { S: 1024, tile: 1.2, nx: 2, ny: 2, base: '#d2ccc2', jointC: '#a8a196', rough: 0.5, stone: 0.07, seed: 421 }), { name: 'tileFloor', normalScale: V2(0.6), envMapIntensity: 0.8 }), 'floor');
  // grand format mural 60 × 120 (pose verticale), blanc cassé satiné
  lazy(['tileWall'], () => { M.tileWall = mark(std(tiles('tileWall', { S: 512, tile: 1.2, nx: 2, ny: 1, base: '#e6e2db', jointC: '#c2bcb2', rough: 0.32, stone: 0.04, seed: 431 }), { name: 'tileWall', normalScale: V2(0.5), envMapIntensity: 0.8 }), 'wall'); });
  // zellige 10 × 10 émaillé (crédence de cuisine, douche) : nuances et surface ondulée
  lazy(['tileZellige', 'tileZelligeSage'], () => {
  M.tileZellige = mark(std(tiles('tileZellige', { S: 512, tile: 0.8, nx: 8, ny: 8, base: '#e9e3d4', jointC: '#d2cab9', joint: 0.0025, rough: 0.12, glossVar: 0.1, stone: 0.05, wavy: 0.5, tintVar: 0.07, hueVar: 0.03, seed: 441, ns: 5 }), { name: 'tileZellige', normalScale: V2(0.9), envMapIntensity: 1.0 }), 'wall');
  M.tileZelligeSage = mark(new THREE.MeshStandardMaterial({ name: 'tileZelligeSage', map: M.tileZellige.map, roughnessMap: M.tileZellige.roughnessMap, normalMap: M.tileZellige.normalMap, normalScale: V2(0.9), color: new THREE.Color('#a9b49c'), roughness: 1, metalness: 0 }), 'wall');
  });
  lap('int:carrelages');
  // béton ciré / microciment (salle d'eau)
  lazy(['microcement'], () => {
    const S = 512, a = fbm(S, S, { px: 2, oct: 5, seed: 451 }), b = fbm(S, S, { px: 8, oct: 4, seed: 452 }), hi = fbm(S, S, { px: 128, oct: 2, seed: 453 });
    const base = hex('#c9c2b7'), col = new Buf(S, S), rough = new Float32Array(S * S), hgt = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) {
      const trowel = sstep(0.45, 0.7, b[i]);
      col.set(i, base, 1 + 0.09 * (a[i] - 0.5) - 0.04 * trowel + 0.02 * (hi[i] - 0.5));
      rough[i] = 0.55 - 0.12 * trowel + 0.05 * (hi[i] - 0.5); hgt[i] = 0.3 * b[i] + 0.1 * hi[i];
    }
    M.microcement = mark(std(pbrSet(S, S, 2.0, col, rough, hgt, 0.8), { name: 'microcement', normalScale: V2(0.4) }), 'floor');
  });

  lap('int:microciment');
  // ---- Bois de mobilier (fil selon v) ----
  const woodGrain = (S, tile, early, late, seed, r0 = 0.5) => {
    const f = fbm(S, S, { px: 128, py: 4, oct: 3, seed }), wv = fbm(S, S, { px: 16, py: 2, oct: 3, seed: seed + 1 }), lo = fbm(S, S, { px: 2, oct: 3, seed: seed + 2 });
    const E = hex(early), L = hex(late), col = new Buf(S, S), rough = new Float32Array(S * S), hgt = new Float32Array(S * S);
    for (let y = 0, i = 0; y < S; y++) for (let x = 0; x < S; x++, i++) {
      const ph = (x / S) * 14 + 2.6 * wv[i];
      const ln = Math.pow(0.5 + 0.5 * Math.sin(ph * 6.2832), 6) * (0.5 + 0.5 * f[i]);
      col.set(i, mixc(E, L, clamp01(0.6 * ln + 0.35 * (f[i] - 0.5) + 0.2 * (lo[i] - 0.5))));
      rough[i] = r0 + 0.1 * ln + 0.04 * (lo[i] - 0.5); hgt[i] = 0.04 * ln - 0.02 * f[i];
    }
    return pbrSet(S, S, tile, col, rough, hgt, 2);
  };
  lazy(['oakWood', 'walnutWood'], () => {
  M.oakWood = mark(std(woodGrain(512, 1.0, '#c7a47c', '#97734f', 461, 0.5), { name: 'oakWood', normalScale: V2(0.5) }), 'wood');
  M.walnutWood = mark(std(woodGrain(512, 1.0, '#7a573d', '#46301f', 471, 0.45), { name: 'walnutWood', normalScale: V2(0.5) }), 'wood');
  });

  lap('int:bois');
  // ---- Textiles ----
  {
    // lin : armure toile neutre (teinte par .color)
    const S = 256, slubU = fbm(S, S, { px: 1, py: 32, oct: 3, seed: 481 }), slubV = fbm(S, S, { px: 32, py: 1, oct: 3, seed: 482 }), lo = fbm(S, S, { px: 2, oct: 3, seed: 483 });
    const col = new Buf(S, S), rough = new Float32Array(S * S), hgt = new Float32Array(S * S), th = S / 48, w = [255, 255, 255];
    for (let y = 0, i = 0; y < S; y++) for (let x = 0; x < S; x++, i++) {
      const tx = x / th, ty = y / th, over = ((Math.floor(tx) + Math.floor(ty)) & 1) === 0;
      const hw = Math.sin(Math.PI * (tx % 1)) * (0.8 + 0.4 * slubU[i]), hf = Math.sin(Math.PI * (ty % 1)) * (0.8 + 0.4 * slubV[i]);
      const h = over ? 0.55 + 0.45 * hw : 0.55 + 0.45 * hf;
      col.set(i, w, 0.8 + 0.17 * h + 0.04 * (lo[i] - 0.5) + 0.05 * ((over ? slubU[i] : slubV[i]) - 0.5));
      rough[i] = 0.92 + 0.06 * (1 - h); hgt[i] = h;
    }
    const set = pbrSet(S, S, 0.2, col, rough, hgt, 1.4);
    const linen = (name, c) => mark(std(set, { name, color: new THREE.Color(c), normalScale: V2(0.6), envMapIntensity: 0.5 }), 'fabric');
    M.linenNatural = linen('linenNatural', '#d6ccbb');
    M.linenWhite = linen('linenWhite', '#f1eee8');
    M.linenSand = linen('linenSand', '#c2ae91');
    M.linenSage = linen('linenSage', '#959f88');
    M.linenTerracotta = linen('linenTerracotta', '#b36d4f');
    M.linenCharcoal = linen('linenCharcoal', '#4d4c4a');
    M.linenBlue = linen('linenBlue', '#6f7f8f');
    // voilage translucide (rideaux) : ne pas lui faire porter d'ombre (castShadow = false)
    M.curtainSheer = mark(new THREE.MeshStandardMaterial({ name: 'curtainSheer', map: set.map, normalMap: set.normalMap, color: new THREE.Color('#f4f1ea'), roughness: 1, metalness: 0, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 0.5 }), 'fabric');
    M.curtainSheer.userData.noAO = true;
    // abat-jour : lin clair, s'illumine le soir (viewer.js pilote emissiveIntensity selon l'heure)
    M.lampShade = mark(new THREE.MeshStandardMaterial({ name: 'lampShade', map: set.map, color: new THREE.Color('#f2ebdf'), emissive: new THREE.Color('#ffc98a'), emissiveMap: set.map, emissiveIntensity: 0, roughness: 0.95, metalness: 0, side: THREE.DoubleSide }), 'lamp');
    M.lampShade.userData.lampShade = true;
  }
  {
  lap('int:lin');
    // bouclé : boucles serrées (hauteur = petites bosses aléatoires)
    const S = 512, r = mulberry32(491), hgt = new Float32Array(S * S), n = fbm(S, S, { px: 8, oct: 3, seed: 492 });
    for (let k = 0; k < 9000; k++) {
      const cx = r() * S, cy = r() * S, R = 2.5 + r() * 3.5, R2 = R * R, a = 0.6 + r() * 0.4;
      for (let y = Math.floor(cy - R); y <= cy + R; y++) for (let x = Math.floor(cx - R); x <= cx + R; x++) {
        const d2 = (x - cx) ** 2 + (y - cy) ** 2; if (d2 > R2) continue;
        const i = ((y + S) % S) * S + ((x + S) % S), ring = Math.sqrt(d2) / R;
        hgt[i] = Math.max(hgt[i], a * (1 - Math.pow(Math.abs(ring - 0.6) / 0.4, 2)));
      }
    }
    const col = new Buf(S, S), rough = new Float32Array(S * S), w = [255, 255, 255];
    for (let i = 0; i < S * S; i++) { col.set(i, w, 0.74 + 0.24 * hgt[i] + 0.04 * (n[i] - 0.5)); rough[i] = 1; }
    const set = pbrSet(S, S, 0.25, col, rough, hgt, 3);
    M.boucle = mark(std(set, { name: 'boucle', color: new THREE.Color('#efe9de'), normalScale: V2(1), envMapIntensity: 0.4 }), 'fabric');
    M.boucleOat = mark(std(set, { name: 'boucleOat', color: new THREE.Color('#d9ccb7'), normalScale: V2(1), envMapIntensity: 0.4 }), 'fabric');
  }
  {
  lap('int:boucle');
    // laine tissée (tapis) : boucles en rangs + chiné
    const S = 512, a = fbm(S, S, { px: 2, oct: 4, seed: 501 }), hi = fbm(S, S, { px: 128, py: 64, oct: 2, seed: 502 });
    const col = new Buf(S, S), rough = new Float32Array(S * S), hgt = new Float32Array(S * S), w = [255, 255, 255], p = S / 96;
    for (let y = 0, i = 0; y < S; y++) for (let x = 0; x < S; x++, i++) {
      const loop = Math.abs(Math.sin(Math.PI * x / p + ((y / p | 0) & 1) * 1.57)) * Math.abs(Math.sin(Math.PI * y / p));
      const h = 0.5 * loop + 0.5 * hi[i];
      col.set(i, w, 0.78 + 0.18 * h + 0.06 * (a[i] - 0.5)); rough[i] = 1; hgt[i] = h;
    }
    const set = pbrSet(S, S, 0.5, col, rough, hgt, 2.5);
    M.rugWool = mark(std(set, { name: 'rugWool', color: new THREE.Color('#d8d0c3'), normalScale: V2(1), envMapIntensity: 0.3 }), 'fabric');
    M.rugWoolGrey = mark(std(set, { name: 'rugWoolGrey', color: new THREE.Color('#a7a49e'), normalScale: V2(1), envMapIntensity: 0.3 }), 'fabric');
  }
  {
  lap('int:laine');
    // cuir pleine fleur (grain « pebble »)
    const S = 512, c1 = fbm(S, S, { px: 32, oct: 2, seed: 511 }), c2 = fbm(S, S, { px: 96, oct: 2, seed: 512 }), lo = fbm(S, S, { px: 2, oct: 4, seed: 513 });
    const col = new Buf(S, S), rough = new Float32Array(S * S), hgt = new Float32Array(S * S), w = [255, 255, 255];
    for (let i = 0; i < S * S; i++) {
      const cell = 1 - Math.abs(2 * c1[i] - 1), fine = 1 - Math.abs(2 * c2[i] - 1), h = 0.6 * Math.pow(cell, 0.5) + 0.4 * fine;
      col.set(i, w, 0.82 + 0.12 * h + 0.1 * (lo[i] - 0.5)); rough[i] = 0.42 + 0.18 * (1 - h) + 0.06 * (lo[i] - 0.5); hgt[i] = h;
    }
    const set = pbrSet(S, S, 0.3, col, rough, hgt, 1.6);
    M.leatherCognac = mark(std(set, { name: 'leatherCognac', color: new THREE.Color('#9a5e3a'), normalScale: V2(0.6) }), 'leather');
    M.leatherBlack = mark(std(set, { name: 'leatherBlack', color: new THREE.Color('#2a2624'), normalScale: V2(0.6) }), 'leather');
    M.leatherCream = mark(std(set, { name: 'leatherCream', color: new THREE.Color('#e3d8c6'), normalScale: V2(0.6) }), 'leather');
  }

  lap('int:cuir');
  // ---- Métaux ----
  {
    const S = 256, br = fbm(S, S, { px: 2, py: 256, oct: 2, seed: 521 }), lo = fbm(S, S, { px: 2, oct: 3, seed: 522 });
    const col = new Buf(S, S), rough = new Float32Array(S * S), hgt = new Float32Array(S * S), w = [255, 255, 255];
    for (let i = 0; i < S * S; i++) { col.set(i, w, 0.97 + 0.03 * br[i]); rough[i] = 0.3 + 0.06 * br[i] + 0.03 * (lo[i] - 0.5); hgt[i] = br[i]; }
    const set = pbrSet(S, S, 0.25, col, rough, hgt, 0.6);
    M.brassBrushed = mark(std(set, { name: 'brassBrushed', color: new THREE.Color('#d4b27a'), metalness: 1, normalScale: V2(0.3) }), 'metal');
    M.steelBrushed = mark(std(set, { name: 'steelBrushed', color: new THREE.Color('#c9cacb'), metalness: 1, normalScale: V2(0.3) }), 'metal');
  }
  M.blackMetal = mark(new THREE.MeshStandardMaterial({ name: 'blackMetal', color: 0x1c1c1d, roughness: 0.5, metalness: 0.35 }), 'metal');
  M.chrome = mark(new THREE.MeshStandardMaterial({ name: 'chrome', color: 0xe6e7e8, roughness: 0.07, metalness: 1 }), 'metal');
  M.mirror = mark(new THREE.MeshStandardMaterial({ name: 'mirror', color: 0xd9dcdc, roughness: 0.02, metalness: 1 }), 'metal');

  lap('int:metaux');
  // ---- Céramique, verre, pierre ----
  M.ceramicWhite = mark(new THREE.MeshStandardMaterial({ name: 'ceramicWhite', color: 0xf3f1ec, roughness: 0.1, metalness: 0 }), 'ceramic');
  {
    const S = 256, wn = white(S * S, 531), lo = fbm(S, S, { px: 4, oct: 3, seed: 532 });
    const col = new Buf(S, S), rough = new Float32Array(S * S), hgt = new Float32Array(S * S), w = [255, 255, 255];
    for (let i = 0; i < S * S; i++) { const sp = wn[i] > 0.985 ? 0.55 : 1; col.set(i, w, (0.92 + 0.06 * lo[i]) * sp); rough[i] = 0.7 + 0.08 * lo[i]; hgt[i] = lo[i] * 0.5 + (sp < 1 ? -0.2 : 0); }
    const set = pbrSet(S, S, 0.25, col, rough, hgt, 1);
    M.stoneware = mark(std(set, { name: 'stoneware', color: new THREE.Color('#dcd4c6'), normalScale: V2(0.4) }), 'ceramic');
    M.stonewareDark = mark(std(set, { name: 'stonewareDark', color: new THREE.Color('#57514b'), normalScale: V2(0.4) }), 'ceramic');
    M.terracotta = mark(std(set, { name: 'terracotta', color: new THREE.Color('#b8704d'), normalScale: V2(0.4) }), 'ceramic');
  }
  M.glassClear = mark(new THREE.MeshStandardMaterial({ name: 'glassClear', color: 0xe9f0ee, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.16, depthWrite: false, envMapIntensity: 1.2 }), 'glass');
  M.glassClear.userData.noAO = true;
  lap('int:ceramique');
  lazy(['marbleWhite'], () => {
  {
    // marbre blanc veiné (type Calacatta), poli
    const S = 1024, a = fbm(S, S, { px: 2, oct: 6, seed: 541 }), b = fbm(S, S, { px: 4, oct: 5, seed: 542 }), c = fbm(S, S, { px: 16, oct: 3, seed: 543 });
    const base = hex('#efece7'), vein = hex('#8c8a86'), gold = hex('#b9a58a'), col = new Buf(S, S), rough = new Float32Array(S * S), hgt = new Float32Array(S * S);
    for (let y = 0, i = 0; y < S; y++) for (let x = 0; x < S; x++, i++) {
      const w1 = Math.abs(Math.sin((x / S * 2 + y / S * 1 + 2.4 * a[i]) * 3.1416 * 2));
      const w2 = Math.abs(Math.sin((x / S * -1 + y / S * 2 + 3.0 * b[i]) * 3.1416 * 3));
      const v1 = Math.pow(1 - w1, 18), v2 = Math.pow(1 - w2, 40) * 0.6;
      const cloud = 0.04 * (c[i] - 0.5);
      let cc = mixc(base, gold, sstep(0.0, 0.5, v1) * 0.35);
      cc = mixc(cc, vein, clamp01(v1 * 0.8 + v2));
      col.set(i, cc, 1 + cloud); rough[i] = 0.12 + 0.05 * c[i]; hgt[i] = 0.02 * c[i];
    }
    M.marbleWhite = mark(std(pbrSet(S, S, 1.2, col, rough, hgt, 0.5), { name: 'marbleWhite', normalScale: V2(0.2) }), 'stone');
  }
  });
  lap('int:marbre');
  lazy(['terrazzo'], () => {
  {
    // terrazzo clair à éclats
    const S = 512, r = mulberry32(551), cv = makeCanvas(S, S), g = cv.getContext('2d');
    g.fillStyle = '#e4ded4'; g.fillRect(0, 0, S, S);
    const chips = ['#b7ab9b', '#8e8a84', '#c9a78f', '#f3f0ea', '#6f6a64', '#d2c3a8', '#9aa293'];
    for (let k = 0; k < 2600; k++) {
      const x = r() * S, y = r() * S, R = 1.5 + Math.pow(r(), 3) * 9, n = 5 + (r() * 4 | 0), a0 = r() * 6.28;
      g.fillStyle = chips[(r() * chips.length) | 0];
      for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
        g.beginPath();
        for (let j = 0; j < n; j++) { const a = a0 + j / n * 6.28, rr = R * (0.6 + r() * 0.5); g.lineTo(x + ox + Math.cos(a) * rr, y + oy + Math.sin(a) * rr); }
        g.closePath(); g.fill();
      }
    }
    const d = g.getImageData(0, 0, S, S).data, lo = fbm(S, S, { px: 4, oct: 3, seed: 552 }), rough = new Float32Array(S * S), hgt = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) { const l = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 765; rough[i] = 0.3 + 0.08 * lo[i]; hgt[i] = 0.1 * l + 0.05 * lo[i]; }
    M.terrazzo = mark(new THREE.MeshStandardMaterial({ name: 'terrazzo', map: tex(cv, 0.6, true), roughnessMap: tex(canvasRGBA(S, S, grayData(rough)), 0.6), normalMap: tex(canvasRGBA(S, S, normalData(hgt, S, S, 1)), 0.6), normalScale: V2(0.3), roughness: 1, metalness: 0 }), 'stone');
  }
  });

  lap('int:terrazzo');
  // ---- Laques (façades de cuisine, placards) : unies, satinées ----
  const lacquer = (name, c, r0 = 0.38) => mark(new THREE.MeshStandardMaterial({ name, color: new THREE.Color(c), roughness: r0, metalness: 0, envMapIntensity: 0.8 }), 'lacquer');
  M.lacquerWhite = lacquer('lacquerWhite', '#ebe8e2');
  M.lacquerGreige = lacquer('lacquerGreige', '#bfb5a7');
  M.lacquerSage = lacquer('lacquerSage', '#86907e');
  M.lacquerNavy = lacquer('lacquerNavy', '#2f3947');
  M.lacquerBlack = lacquer('lacquerBlack', '#1f1f1f', 0.45);

  // ---- Végétal d'intérieur (géométrie pleine : feuilles en plans/coques, double face) ----
  M.plantLeaf = mark(new THREE.MeshStandardMaterial({ name: 'plantLeaf', color: 0x3e5a2e, roughness: 0.42, metalness: 0, side: THREE.DoubleSide }), 'plant');
  M.plantLeafLight = mark(new THREE.MeshStandardMaterial({ name: 'plantLeafLight', color: 0x6b8a45, roughness: 0.5, metalness: 0, side: THREE.DoubleSide }), 'plant');
  M.plantStem = mark(new THREE.MeshStandardMaterial({ name: 'plantStem', color: 0x5b5a3c, roughness: 0.7, metalness: 0 }), 'plant');
  M.pottingSoil = M.soil;

  // ---- Lumière ----
  // ampoule / diffuseur : blanc le jour, incandescent le soir (piloté par viewer.js)
  M.bulb = mark(new THREE.MeshStandardMaterial({ name: 'bulb', color: 0xf7f3ea, emissive: new THREE.Color('#ffd7a1'), emissiveIntensity: 0.15, roughness: 0.3, metalness: 0 }), 'lamp');
  M.bulb.userData.bulb = true;
  M.bulb.userData.noAO = true;

}
