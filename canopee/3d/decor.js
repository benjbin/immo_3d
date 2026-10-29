/**
 * Canopée — décoration des appartements visitables (mobilier, objets, textiles, luminaires, plantes).
 *
 *   export function decorMaterials(THREE, M, std, opts) → matériaux propres à la déco (ajoutés à MAT de lots.js)
 *   export function createDecor(THREE, P, ctx)          → { lotA(), lotB(), finishings() } — appelé par lots.js
 *
 * Parti pris (architecte d'intérieur) : « japandi » chaleureux à la française —
 *   chêne clair huilé, lin lavé, bouclé écru, travertin, céramique mate, métal noir, touches de laiton ;
 *   palette sable / greige / blanc cassé, accents terracotta, ocre, sauge et un bleu encre très discret.
 *
 * Conventions : repère « meuble » de lots.js (sol y = 0, face avant vers +z, mètres).
 * Toute la géométrie passe par P.push(mk, geo, {tint, keepUV}) : fusion par matériau dans lots.js,
 * teinte par objet en couleurs de sommet (variantes d'un même matériau dans un seul appel de dessin),
 * occlusion bakée multipliée par lots.js. Tout ce qui dépasse le plan de coupe (1,2 m) est « visite » seulement.
 */
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// ------------------------------------------------------------------ aléatoire & bruit périodique
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hash2 = (i, j, s) => { let h = (i * 374761393 + j * 668265263 + s * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
// bruit de valeur périodique (px × py cellules)
function pn(x, y, px, py, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y); let tx = x - xi, ty = y - yi;
  tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
  const m = (v, p) => ((v % p) + p) % p;
  const x0 = m(xi, px), x1 = m(xi + 1, px), y0 = m(yi, py), y1 = m(yi + 1, py);
  const a = hash2(x0, y0, s), b = hash2(x1, y0, s), c = hash2(x0, y1, s), d = hash2(x1, y1, s);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}
// fbm périodique : u, v ∈ [0, 1) sur la tuile
function fbmP(u, v, px, py, oct = 4, s = 0) {
  let t = 0, a = 0.5, n = 0;
  for (let k = 0; k < oct; k++) { t += a * pn(u * px, v * py, px, py, s + k * 17); n += a; px *= 2; py *= 2; a *= 0.5; }
  return t / n;
}
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);

// ------------------------------------------------------------------ textures procédurales
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
// carte de hauteur → normal map (convention OpenGL)
function normalCanvas(hgt, w, h, k) {
  const cv = canvas(w, h), g = cv.getContext('2d'), im = g.createImageData(w, h), d = im.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const l = hgt[y * w + ((x - 1 + w) % w)], r = hgt[y * w + ((x + 1) % w)], u = hgt[((y - 1 + h) % h) * w + x], b = hgt[((y + 1) % h) * w + x];
    let nx = (l - r) * k, ny = (b - u) * k, nz = 1; const L = Math.hypot(nx, ny, nz); nx /= L; ny /= L; nz /= L;
    const o = (y * w + x) * 4; d[o] = (nx * 0.5 + 0.5) * 255; d[o + 1] = (ny * 0.5 + 0.5) * 255; d[o + 2] = nz * 255; d[o + 3] = 255;
  }
  g.putImageData(im, 0, 0); return cv;
}
// remplit un canvas pixel par pixel : f(u, v) → [r, g, b] (0–255) ; renvoie aussi la hauteur si f la fournit
function paint(w, h, f) {
  const cv = canvas(w, h), g = cv.getContext('2d'), im = g.createImageData(w, h), d = im.data, hgt = new Float32Array(w * h), rough = new Uint8ClampedArray(w * h);
  const out = [0, 0, 0, 0, 0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    out[3] = 0; out[4] = -1;
    f((x + 0.5) / w, (y + 0.5) / h, out);
    const o = (y * w + x) * 4; d[o] = out[0]; d[o + 1] = out[1]; d[o + 2] = out[2]; d[o + 3] = 255;
    hgt[y * w + x] = out[3]; rough[y * w + x] = out[4] < 0 ? 200 : out[4] * 255;
  }
  g.putImageData(im, 0, 0);
  const rc = canvas(w, h), rg = rc.getContext('2d'), ri = rg.createImageData(w, h);
  for (let i = 0; i < w * h; i++) { ri.data[i * 4] = ri.data[i * 4 + 1] = ri.data[i * 4 + 2] = rough[i]; ri.data[i * 4 + 3] = 255; }
  rg.putImageData(ri, 0, 0);
  return { color: cv, hgt, rough: rc, w, h };
}

/** Matériaux de la déco. std(name, color, params) : constructeur de lots.js (MeshStandardMaterial enregistré). */
export function decorMaterials(THREE, M, std, opt = {}) {
  const aniso = opt.anisotropy || 8, list = opt.disposables || [];
  const T = (cv, rx, ry = rx, srgb = true) => {
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / rx, 1 / ry);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = aniso; list.push(t); return t;
  };
  const set = (p, rx, ry, nk, extra = {}) => ({ map: T(p.color, rx, ry), normalMap: nk ? T(normalCanvas(p.hgt, p.w, p.h, nk), rx, ry, false) : null, roughnessMap: T(p.rough, rx, ry, false), ...extra });
  const D = {};

  // --- chêne clair huilé (mobilier) : 1 m × 0,25 m, fil horizontal
  const oak = paint(1024, 256, (u, v, o) => {
    const w = fbmP(u, v, 3, 1, 3, 11), ring = v * 34 + w * 6 + fbmP(u, v, 24, 2, 2, 5) * 0.6;
    const g = 0.5 + 0.5 * Math.sin(ring * Math.PI * 2), fine = fbmP(u, v, 160, 6, 2, 9);
    const pore = fbmP(u, v, 220, 40, 1, 3) > 0.78 ? 1 : 0, ray = fbmP(u, v, 40, 90, 1, 21) > 0.86 ? 1 : 0;
    const l = 0.86 + 0.09 * g + 0.05 * fine - 0.08 * pore + 0.04 * ray + 0.05 * (w - 0.5);
    o[0] = 208 * l; o[1] = 172 * l; o[2] = 128 * l; o[3] = g * 0.4 + fine * 0.2 - pore * 0.6; o[4] = 0.6 + 0.12 * pore - 0.08 * g;
  });
  D.oak = std('decoOak', 0xffffff, set(oak, 1.0, 0.25, 1.2, { roughness: 1, normalScale: new THREE.Vector2(0.25, 0.25) }));
  // --- textiles : lin lavé neutre (teinté par objet), 0,2 m
  const linen = paint(512, 512, (u, v, o) => {
    const wx = Math.sin(u * 512 * Math.PI * 0.5), wy = Math.sin(v * 512 * Math.PI * 0.5);
    const slubX = fbmP(u, v, 2, 64, 2, 3), slubY = fbmP(u, v, 64, 2, 2, 7);
    const h = (wx > 0 ? 0.5 + 0.5 * slubX : 0.5 + 0.5 * slubY) * (0.6 + 0.4 * Math.abs(wx * wy));
    const l = 0.86 + 0.08 * (slubX - 0.5) + 0.08 * (slubY - 0.5) + 0.06 * h + 0.03 * fbmP(u, v, 6, 6, 3, 1);
    o[0] = o[1] = o[2] = 236 * l; o[1] *= 0.995; o[2] *= 0.985; o[3] = h; o[4] = 0.95;
  });
  const linenSet = set(linen, 0.2, 0.2, 2.5, { roughness: 1, normalScale: new THREE.Vector2(0.55, 0.55) });
  D.textile = std('decoTextile', 0xffffff, { ...linenSet });
  D.cloth = std('decoCloth', 0xffffff, { ...linenSet, side: THREE.DoubleSide });
  // --- bouclé écru : boucles serrées, 0,12 m
  const R = rng(41), loops = new Float32Array(256 * 256);
  for (let k = 0; k < 2600; k++) {
    const cx = R() * 256, cy = R() * 256, r = 2.2 + R() * 2.6;
    for (let y = -6; y <= 6; y++) for (let x = -6; x <= 6; x++) { const d = Math.hypot(x, y); if (d > r + 1.2) continue; const v = Math.max(0, 1 - Math.abs(d - r * 0.7) / 1.3); const i = (((cy + y) | 0) & 255) * 256 + (((cx + x) | 0) & 255); loops[i] = Math.max(loops[i], v * (0.6 + 0.4 * R())); }
  }
  const boucle = paint(256, 256, (u, v, o) => { const h = loops[((v * 256) | 0) * 256 + ((u * 256) | 0)]; const l = 0.9 + 0.08 * h + 0.03 * fbmP(u, v, 8, 8, 2, 3); o[0] = 240 * l; o[1] = 234 * l; o[2] = 222 * l; o[3] = h; o[4] = 1; });
  D.boucle = std('decoBoucle', 0xffffff, set(boucle, 0.12, 0.12, 6, { roughness: 1, normalScale: new THREE.Vector2(1.3, 1.3) }));
  // --- tapis berbère (laine écrue, losanges brun-noir), motif répété tous les 0,8 m
  const rug = paint(512, 512, (u, v, o) => {
    const tuft = fbmP(u, v, 96, 96, 2, 13), big = fbmP(u, v, 4, 4, 3, 2);
    const x = (u - 0.5) * 2, y = (v - 0.5) * 2, dia = Math.abs(Math.abs(x) + Math.abs(y) - 0.9), dia2 = Math.abs(Math.abs(x) + Math.abs(y) - 0.15);
    const wob = 0.025 * (fbmP(u, v, 12, 12, 2, 4) - 0.5);
    const line = (dia + wob < 0.035 || dia2 + wob < 0.03) ? 1 : 0;
    const l = 0.82 + 0.1 * tuft + 0.06 * (big - 0.5);
    if (line) { o[0] = 70 * l; o[1] = 60 * l; o[2] = 52 * l; } else { o[0] = 238 * l; o[1] = 230 * l; o[2] = 214 * l; }
    o[3] = tuft; o[4] = 1;
  });
  D.rug = std('decoRug', 0xffffff, set(rug, 0.8, 0.8, 4, { roughness: 1, normalScale: new THREE.Vector2(0.8, 0.8) }));
  // laine unie (tapis de chambre, plaids épais)
  const wool = paint(256, 256, (u, v, o) => { const t = fbmP(u, v, 48, 48, 3, 77); const l = 0.85 + 0.15 * t; o[0] = o[1] = o[2] = 235 * l; o[3] = t; o[4] = 1; });
  D.wool = std('decoWool', 0xffffff, set(wool, 0.3, 0.3, 5, { roughness: 1 }));
  // --- travertin (plateaux, vasque, sol de salle de bains) : 1,2 m
  const trav = paint(1024, 1024, (u, v, o) => {
    const band = fbmP(u, v, 2, 14, 4, 31), w = fbmP(u, v, 6, 30, 3, 8);
    const pore = fbmP(u, v, 60, 260, 2, 19), pit = pore > 0.74 ? (pore - 0.74) / 0.26 : 0;
    const vein = Math.abs(Math.sin((v * 9 + band * 1.6) * Math.PI)) < 0.05 ? 0.05 : 0;
    const l = 0.84 + 0.1 * band + 0.05 * w - 0.35 * pit - vein;
    o[0] = 226 * l; o[1] = 208 * l; o[2] = 182 * l; o[3] = -pit * 1.5 + band * 0.2; o[4] = 0.45 + 0.4 * pit;
  });
  D.travertine = std('decoTravertine', 0xffffff, set(trav, 1.2, 1.2, 2.5, { roughness: 1, normalScale: new THREE.Vector2(0.5, 0.5) }));
  // --- pierre claire du plan de travail (quartzite blanc chaud, veines grises douces) : 1,6 m
  const qz = paint(1024, 1024, (u, v, o) => {
    const n = fbmP(u, v, 3, 3, 5, 61), m = fbmP(u, v, 5, 5, 4, 62);
    const vein = Math.exp(-Math.abs(Math.sin((u * 2 + v * 1.2 + n * 1.8) * Math.PI * 2)) * 18) * 0.5 + Math.exp(-Math.abs(Math.sin((u * 3.1 - v * 2 + m * 2.2) * Math.PI * 2)) * 30) * 0.25;
    const l = 0.94 + 0.03 * n - 0.22 * vein;
    o[0] = 240 * l; o[1] = 236 * l; o[2] = 228 * l; o[3] = 0; o[4] = 0.22 + 0.08 * n;
  });
  D.stone = std('decoStone', 0xffffff, set(qz, 1.6, 1.6, 0, { roughness: 1 }));
  // --- zellige blanc crème (crédence, douche) : carreaux 10 × 10 cm, émail ondulé, tons variés, 0,4 m
  const zel = paint(512, 512, (u, v, o) => {
    const N = 4, i = Math.floor(u * N), j = Math.floor(v * N), fu = u * N - i, fv = v * N - j;
    const e = Math.min(fu, fv, 1 - fu, 1 - fv), grout = e < 0.035;
    const tone = hash2(i, j, 5), wav = fbmP(u, v, 16, 16, 2, i * 7 + j);
    const edge = clamp(e / 0.12);
    const l = grout ? 0.72 : 0.88 + 0.1 * tone + 0.04 * wav - 0.06 * (1 - edge);
    o[0] = (grout ? 210 : 246) * l; o[1] = (grout ? 204 : 238) * l; o[2] = (grout ? 194 : 224) * l;
    o[3] = grout ? -0.6 : 0.4 * edge + 0.25 * wav; o[4] = grout ? 0.9 : 0.08 + 0.12 * wav;
  });
  D.zellige = std('decoZellige', 0xffffff, set(zel, 0.4, 0.4, 3, { roughness: 1, normalScale: new THREE.Vector2(0.7, 0.7) }));
  // --- céramiques
  D.ceramic = std('decoCeramic', 0xffffff, { roughness: 0.12, metalness: 0 });            // sanitaires émaillés, vaisselle
  const grain = paint(256, 256, (u, v, o) => { const t = fbmP(u, v, 32, 32, 3, 91), s = hash2((u * 256) | 0, (v * 256) | 0, 3); const l = 0.9 + 0.06 * t + (s > 0.97 ? -0.15 : 0); o[0] = o[1] = o[2] = 240 * l; o[3] = t; o[4] = 0.75 + 0.15 * t; });
  D.stoneware = std('decoStoneware', 0xffffff, set(grain, 0.15, 0.15, 2, { roughness: 1 }));  // grès mat (vases, pieds de lampe, pots)
  D.lacquer = std('decoLacquer', 0xffffff, { roughness: 0.42, metalness: 0 });            // façades laquées mates
  D.skirt = std('decoSkirt', 0xf3f1ec, { roughness: 0.5 });                               // plinthes, chambranles
  // --- métaux
  D.black = std('decoBlack', 0x1d1d1e, { roughness: 0.48, metalness: 0.55 });
  D.brass = std('decoBrass', 0xc9a46a, { roughness: 0.32, metalness: 1 });
  D.steel = std('decoSteel', 0xbfc1c3, { roughness: 0.28, metalness: 1 });
  D.glassBlack = std('decoGlassBlack', 0x0d0e10, { roughness: 0.08, metalness: 0.1 });    // vitrocéramique, porte de four
  D.mirror = std('decoMirror', 0xe2e5e6, { roughness: 0.02, metalness: 1, envMapIntensity: 0.9 });
  D.glassClear = std('decoGlass', 0xeef4f2, { roughness: 0.05, metalness: 0, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
  D.sheer = std('decoSheer', 0xfbf8f2, { ...set(linen, 0.12, 0.12, 0), roughness: 1, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
  // --- abat-jour et papier washi : lumière chaude diffusée (allumés)
  const washi = paint(256, 256, (u, v, o) => {
    const rib = Math.abs(Math.sin(v * Math.PI * 8)) < 0.06 ? 1 : 0, fib = fbmP(u, v, 40, 8, 3, 17);
    const l = 0.9 + 0.08 * fib - 0.25 * rib; o[0] = 250 * l; o[1] = 244 * l; o[2] = 230 * l; o[3] = rib; o[4] = 1;
  });
  D.shade = std('decoShade', 0xffffff, { map: T(washi.color, 0.25, 0.25), emissive: 0xffc98a, emissiveIntensity: 0.9, emissiveMap: T(washi.color, 0.25, 0.25), roughness: 1, side: THREE.DoubleSide });
  D.bulb = std('decoBulb', 0xffffff, { emissive: 0xffd9a8, emissiveIntensity: 3, roughness: 1 });
  // --- terre, écorce
  D.soil = std('decoSoil', 0x3a2c22, { roughness: 1 });
  D.bark = (M && M.bark) ? M.bark.clone() : std('decoBark', 0x6b5a48, { roughness: 0.9 });
  if (M && M.bark) { D.bark.name = 'decoBark'; list.push(D.bark); }
  // --- feuillage d'intérieur : atlas (figuier lyre | rameau d'olivier | sansevieria)
  D.leaf = std('decoLeaf', 0xffffff, { map: leafAtlas(THREE, T), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.55 });
  D.leaf.map.repeat.set(1, 1);
  // --- œuvres : atlas 2048 × 1024 (UV propres)
  D.art = std('decoArt', 0xffffff, { map: artAtlas(THREE, T), roughness: 0.85 });
  D.art.map.repeat.set(1, 1);
  // --- tranches de livres (papier)
  D.paper = std('decoPaper', 0xf2ede2, { roughness: 0.9 });
  // ombres de contact (décalques multiplicatifs sous les meubles)
  const sh = canvas(128, 128), sg = sh.getContext('2d'), gr = sg.createRadialGradient(64, 64, 8, 64, 64, 64);
  gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  sg.fillStyle = gr; sg.fillRect(0, 0, 128, 128);
  const shT = new THREE.CanvasTexture(sh); list.push(shT);
  D.contact = new THREE.MeshBasicMaterial({ name: 'decoContact', color: 0x000000, alphaMap: shT, transparent: true, opacity: 0.32, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  list.push(D.contact);
  // matériaux partagés de materials.js quand ils existent (réglés pour l'éclairage intérieur)
  const share = { black: 'blackMetal', brass: 'brassBrushed', steel: 'steelBrushed', mirror: 'mirror', sheer: 'curtainSheer', glassClear: 'glassClear', ceramic: 'ceramicWhite', skirt: 'skirting' };
  for (const [k, mk] of Object.entries(share)) if (M && M[mk]) D[k] = M[mk];
  for (const k of Object.keys(D)) D[k].userData.decor = true;
  D.shade.userData.lamp = true; D.bulb.userData.lamp = true;
  return D;
}

// parquet chêne clair en point de Hongrie (lames 9 × 60 cm à 45°) : tuile 0,84 × 1,0 m, axe du chevron selon z
export function chevronParquet(THREE, opt = {}) {
  const C = 0.42, P = 0.125, TW = 2 * C, TH = 8 * P, W = 1024, Hh = 1024;
  const p = paint(W, Hh, (u, v, o) => {
    const x = u * TW, y = v * TH, k = Math.floor(x / C), lx = x - k * C, even = (k & 1) === 0;
    const s = even ? (y + lx) / P : (y - lx + C) / P, si = Math.floor(s), fs = s - si;
    const id = ((si % 8) + 8) % 8 + k * 8;
    const along = even ? (lx - y) : (lx + y);
    const tone = hash2(id, 3, 7), tone2 = hash2(id, 9, 2);
    const ring = fs * 9 + 1.5 * fbmP(((along / 1.2) % 1 + 1) % 1, tone, 3, 1, 2, id) + tone * 5;
    const g = 0.5 + 0.5 * Math.sin(ring * Math.PI * 2), fine = fbmP(u, v, 300, 300, 1, 4);
    const seam = Math.min(fs, 1 - fs) * P < 0.0012 || Math.min(lx, C - lx) < 0.0011;
    const l = (0.84 + 0.1 * tone + 0.06 * g + 0.04 * fine) * (seam ? 0.62 : 1);
    o[0] = (206 + 10 * tone2) * l; o[1] = (176 + 6 * tone2) * l; o[2] = (136 - 6 * tone2) * l;
    o[3] = seam ? -1 : 0.15 * g + 0.1 * fine; o[4] = 0.58 + 0.12 * (1 - g) + (seam ? 0.3 : 0);
  });
  const mk = (cv, srgb) => { const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / TW, 1 / TH); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = opt.anisotropy || 8; (opt.disposables || []).push(t); return t; };
  return { map: mk(p.color, true), roughnessMap: mk(p.rough, false), normalMap: mk(normalCanvas(p.hgt, W, Hh, 3), false) };
}
// peinture murale mate : très légères irrégularités (rouleau), tuile 2 m
export function wallPaint(THREE, opt = {}) {
  const p = paint(512, 512, (u, v, o) => { const t = fbmP(u, v, 4, 4, 4, 123), s = fbmP(u, v, 128, 128, 2, 9); const l = 0.975 + 0.025 * t; o[0] = o[1] = o[2] = 255 * l; o[3] = s; o[4] = 0.9; });
  const mk = (cv, srgb, r) => { const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / r, 1 / r); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = opt.anisotropy || 8; (opt.disposables || []).push(t); return t; };
  return { map: mk(p.color, true, 2), normalMap: mk(normalCanvas(p.hgt, 512, 512, 0.8), false, 0.5) };
}
// grand carreau effet pierre (60 × 60, joint fin), tuile 1,2 m
export function stoneTile(THREE, opt = {}) {
  const p = paint(1024, 1024, (u, v, o) => {
    const i = Math.floor(u * 2), j = Math.floor(v * 2), fu = u * 2 - i, fv = v * 2 - j, e = Math.min(fu, fv, 1 - fu, 1 - fv);
    const grout = e < 0.004, t = hash2(i, j, 31);
    const band = fbmP(u, v, 2, 10, 4, 33 + i * 3 + j), pore = fbmP(u, v, 50, 200, 2, 40), pit = pore > 0.78 ? (pore - 0.78) / 0.22 : 0;
    const l = grout ? 0.7 : 0.86 + 0.06 * band + 0.04 * t - 0.2 * pit;
    o[0] = (grout ? 200 : 222) * l; o[1] = (grout ? 196 : 212) * l; o[2] = (grout ? 190 : 196) * l; o[3] = grout ? -1 : -pit; o[4] = grout ? 0.9 : 0.5 + 0.3 * pit;
  });
  const mk = (cv, srgb) => { const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / 1.2, 1 / 1.2); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = opt.anisotropy || 8; (opt.disposables || []).push(t); return t; };
  return { map: mk(p.color, true), roughnessMap: mk(p.rough, false), normalMap: mk(normalCanvas(p.hgt, 1024, 1024, 2), false) };
}

// atlas de feuillage 1024² : [0, .5]×[0, 1] feuille de figuier lyre ; [.5, 1]×[.5, 1] rameau d'olivier ; [.5, 1]×[0, .5] sansevieria
function leafAtlas(THREE, T) {
  const S = 1024, cv = canvas(S, S), g = cv.getContext('2d'), R = rng(7);
  g.clearRect(0, 0, S, S);
  // figuier lyre : feuille en violon, nervures claires, bord légèrement ondulé (pointe vers le haut de la case)
  {
    const cx = S * 0.25, top = S * 0.04, bot = S * 0.96, Hh = bot - top;
    const prof = (t) => 0.17 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), 0.7) * (1 - 0.18 * Math.exp(-Math.pow((t - 0.45) / 0.12, 2))) + 0.01;
    g.beginPath();
    for (let i = 0; i <= 60; i++) { const t = i / 60; g.lineTo(cx + prof(t) * S * (1 + 0.03 * Math.sin(t * 40)), top + t * Hh); }
    for (let i = 60; i >= 0; i--) { const t = i / 60; g.lineTo(cx - prof(t) * S * (1 + 0.03 * Math.cos(t * 37)), top + t * Hh); }
    g.closePath();
    const lg = g.createLinearGradient(cx - S * 0.18, 0, cx + S * 0.18, 0);
    lg.addColorStop(0, '#2f4a22'); lg.addColorStop(0.5, '#47672f'); lg.addColorStop(1, '#2c4520');
    g.fillStyle = lg; g.fill();
    g.save(); g.clip();
    for (let k = 0; k < 900; k++) { g.fillStyle = `rgba(${R() < 0.5 ? '20,40,15' : '120,150,80'},${0.05 * R()})`; g.beginPath(); g.arc(cx + (R() - 0.5) * S * 0.4, top + R() * Hh, 4 + R() * 14, 0, 7); g.fill(); }
    g.strokeStyle = 'rgba(190,205,140,0.75)'; g.lineWidth = 7; g.beginPath(); g.moveTo(cx, bot); g.lineTo(cx, top + 10); g.stroke();
    g.lineWidth = 3; g.strokeStyle = 'rgba(175,195,125,0.55)';
    for (let i = 1; i < 11; i++) { const t = i / 11.5, y = top + (1 - t) * Hh; for (const s of [-1, 1]) { g.beginPath(); g.moveTo(cx, y); g.quadraticCurveTo(cx + s * S * 0.07, y - Hh * 0.04, cx + s * S * 0.16, y - Hh * 0.09); g.stroke(); } }
    g.restore();
  }
  // rameau d'olivier : tige fine, feuilles lancéolées vert-gris (dessus) / argentées (dessous)
  {
    const ox = S * 0.5, oy = 0, w = S * 0.5, h = S * 0.5;
    g.strokeStyle = '#6b5f48'; g.lineWidth = 5; g.beginPath(); g.moveTo(ox + w * 0.5, oy + h * 0.98); g.quadraticCurveTo(ox + w * 0.45, oy + h * 0.5, ox + w * 0.52, oy + h * 0.04); g.stroke();
    for (let i = 0; i < 34; i++) {
      const t = 0.06 + 0.9 * (i / 34), y = oy + h * (0.98 - t * 0.94), x = ox + w * (0.5 - 0.05 * Math.sin(t * 3));
      const side = i % 2 ? 1 : -1, ang = side * (0.5 + 0.5 * R()) - Math.PI / 2, L = h * (0.16 + 0.08 * R()), Wd = L * 0.16;
      g.save(); g.translate(x, y); g.rotate(ang + Math.PI / 2 * 0);
      g.rotate(Math.PI / 2 + side * 0.15);
      g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(Wd, -L * 0.5, 0, -L); g.quadraticCurveTo(-Wd, -L * 0.5, 0, 0);
      g.fillStyle = R() < 0.35 ? '#a7ad97' : (R() < 0.5 ? '#5f6d4a' : '#6f7c57'); g.fill();
      g.strokeStyle = 'rgba(210,215,190,0.5)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -L * 0.95); g.stroke();
      g.restore();
    }
  }
  // sansevieria : bande opaque vert sombre à zébrures, liseré jaune
  {
    const ox = S * 0.5, oy = S * 0.5, w = S * 0.5, h = S * 0.5;
    for (let y = 0; y < h; y++) {
      const t = y / h, zig = Math.sin(t * 60 + Math.sin(t * 13) * 2);
      const gr = g.createLinearGradient(ox, 0, ox + w, 0);
      gr.addColorStop(0, '#b9a64a'); gr.addColorStop(0.06, '#3c5a2a'); gr.addColorStop(0.5, zig > 0.4 ? '#5f7f45' : '#2f4a22'); gr.addColorStop(0.94, '#3c5a2a'); gr.addColorStop(1, '#b9a64a');
      g.fillStyle = gr; g.fillRect(ox, oy + y, w, 1);
    }
  }
  const t = T(cv, 1, 1); t.repeat.set(1, 1); return t;
}

// atlas d'œuvres 2048 × 1024 : 4 × 2 cases de 512 × 512 (proportions recadrées par les UV)
export const ART = { arcs: 0, line: 1, dune: 2, enso: 3, leaf: 4, blocks: 5, sea: 6, sketch: 7 };
function artAtlas(THREE, T) {
  const W = 2048, Hh = 1024, cv = canvas(W, Hh), g = cv.getContext('2d'), R = rng(99);
  const cell = (i, fn) => { const x = (i % 4) * 512, y = Math.floor(i / 4) * 512; g.save(); g.translate(x, y); g.beginPath(); g.rect(0, 0, 512, 512); g.clip(); fn(); g.restore(); };
  const paper = (c) => { g.fillStyle = c; g.fillRect(0, 0, 512, 512); for (let k = 0; k < 4000; k++) { g.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '255,255,255'},${0.03 * R()})`; g.fillRect(R() * 512, R() * 512, 1 + R() * 2, 1 + R() * 2); } };
  const brush = (fn, col, w, a = 1) => { g.strokeStyle = col; g.lineWidth = w; g.globalAlpha = a; g.lineCap = 'round'; g.beginPath(); fn(); g.stroke(); g.globalAlpha = 1; };
  // 0 : arcs superposés terracotta / ocre / sable (grand format au-dessus du canapé)
  cell(0, () => {
    paper('#ece4d6');
    const arc = (cx, cy, r, c) => { g.fillStyle = c; g.beginPath(); g.arc(cx, cy, r, Math.PI, 0); g.lineTo(cx + r, cy); g.closePath(); g.fill(); };
    arc(200, 360, 150, '#c0704a'); arc(330, 380, 120, '#d9a55c'); g.fillStyle = '#7d8a6c'; g.beginPath(); g.arc(150, 170, 46, 0, 7); g.fill();
    g.fillStyle = '#3d3a36'; g.fillRect(60, 380, 392, 6);
    for (let k = 0; k < 9000; k++) { g.fillStyle = `rgba(255,250,240,${0.05 * R()})`; g.fillRect(R() * 512, R() * 512, 2, 2); }
  });
  // 1 : dessin au trait (visage, une ligne)
  cell(1, () => {
    paper('#f3efe7');
    brush(() => { g.moveTo(160, 430); g.bezierCurveTo(120, 300, 170, 120, 270, 110); g.bezierCurveTo(380, 100, 400, 260, 330, 300); g.bezierCurveTo(300, 320, 270, 300, 280, 260); g.bezierCurveTo(290, 220, 250, 230, 240, 250); g.moveTo(220, 200); g.quadraticCurveTo(240, 190, 255, 205); g.moveTo(300, 190); g.quadraticCurveTo(320, 180, 335, 195); g.moveTo(330, 300); g.bezierCurveTo(360, 380, 300, 420, 360, 470); }, '#2a2826', 5);
    g.fillStyle = '#c97f5a'; g.globalAlpha = 0.85; g.beginPath(); g.ellipse(330, 380, 60, 90, 0.3, 0, 7); g.fill(); g.globalAlpha = 1;
  });
  // 2 : dune / paysage minéral, aplats doux
  cell(2, () => {
    const gr = g.createLinearGradient(0, 0, 0, 512); gr.addColorStop(0, '#e9e1d2'); gr.addColorStop(1, '#dccbb0'); g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
    const layer = (y0, amp, c, s) => { g.fillStyle = c; g.beginPath(); g.moveTo(0, 512); for (let x = 0; x <= 512; x += 8) g.lineTo(x, y0 + amp * Math.sin(x / 512 * Math.PI * s + y0)); g.lineTo(512, 512); g.fill(); };
    layer(300, 30, '#cdb08a', 1.3); layer(350, 25, '#b98c63', 1.8); layer(410, 20, '#8f6a4c', 2.2); layer(460, 12, '#5f4a3a', 2.8);
    g.fillStyle = '#f6efe2'; g.beginPath(); g.arc(360, 150, 40, 0, 7); g.fill();
  });
  // 3 : ensō à l'encre sur papier de riz
  cell(3, () => {
    paper('#f1ece1');
    for (let k = 0; k < 60; k++) brush(() => { const a0 = -1.2 + k * 0.001, a1 = 4.6; g.arc(256 + R() * 3, 256 + R() * 3, 150 + R() * 18 - k * 0.2, a0 + R() * 0.2, a1 - R() * 0.4); }, '#1f1e1c', 2 + R() * 3, 0.25);
    g.fillStyle = '#a8432f'; g.fillRect(400, 420, 26, 26);
  });
  // 4 : planche botanique (feuille de ginkgo)
  cell(4, () => {
    paper('#f0ebdf');
    g.fillStyle = '#7c8a5a'; g.beginPath(); g.moveTo(256, 380); g.bezierCurveTo(120, 300, 110, 170, 150, 140); g.quadraticCurveTo(256, 190, 362, 140); g.bezierCurveTo(400, 170, 390, 300, 256, 380); g.fill();
    g.strokeStyle = 'rgba(240,235,215,0.6)'; g.lineWidth = 1.5; for (let i = 0; i < 26; i++) { const a = -2.4 + i * 0.065; g.beginPath(); g.moveTo(256, 378); g.lineTo(256 + Math.cos(a) * 230, 378 + Math.sin(a) * 230); g.stroke(); }
    g.strokeStyle = '#6b5a3c'; g.lineWidth = 4; g.beginPath(); g.moveTo(256, 380); g.quadraticCurveTo(262, 430, 250, 470); g.stroke();
    g.fillStyle = '#3d3a36'; g.font = '16px Georgia, serif'; g.fillText('Ginkgo biloba', 200, 495);
  });
  // 5 : blocs de couleur (sauge, sable, ocre, encre)
  cell(5, () => {
    paper('#efe9de');
    g.fillStyle = '#8e9b7c'; g.fillRect(70, 80, 220, 260); g.fillStyle = '#d6b98c'; g.fillRect(240, 200, 200, 230); g.fillStyle = '#c4754e'; g.beginPath(); g.arc(330, 150, 55, 0, 7); g.fill();
    g.fillStyle = '#2f3540'; g.fillRect(70, 360, 120, 70);
  });
  // 6 : photographie de mer (horizon, grain)
  cell(6, () => {
    const gr = g.createLinearGradient(0, 0, 0, 512); gr.addColorStop(0, '#c9d2d4'); gr.addColorStop(0.55, '#e6e2da'); gr.addColorStop(0.56, '#7f9196'); gr.addColorStop(1, '#5b6b70'); g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
    for (let k = 0; k < 20000; k++) { g.fillStyle = `rgba(255,255,255,${0.06 * R()})`; g.fillRect(R() * 512, 286 + R() * 226, 3 * R(), 1); }
  });
  // 7 : esquisse d'architecture (fusain)
  cell(7, () => {
    paper('#f2eee6');
    for (let k = 0; k < 14; k++) brush(() => { g.moveTo(80 + R() * 4, 420 - k * 2); g.lineTo(440, 420 - k * 2 + R() * 3); }, '#3a3835', 1, 0.15);
    brush(() => { g.moveTo(120, 420); g.lineTo(120, 200); g.lineTo(256, 110); g.lineTo(392, 200); g.lineTo(392, 420); g.moveTo(200, 420); g.lineTo(200, 300); g.lineTo(312, 300); g.lineTo(312, 420); }, '#2e2c2a', 3, 0.85);
  });
  const t = T(cv, 1, 1); t.repeat.set(1, 1); return t;
}

// ================================================================== mobilier
/**
 * P : constructeur d'étage de lots.js ({ fy, H, key, at, push, walkOnly, planOnly, flat, cy, ... }).
 * ctx : { CUT, cutMat: 'cut' } — renvoie la bibliothèque d'objets (coordonnées « meuble »).
 */
export function createDecor(THREE, P, ctx = {}) {
  const fy = P.fy, H = P.H || 2.5, CUT = ctx.CUT || 1.2, R = rng(1000 + P.key * 31);
  const V3 = THREE.Vector3, V2 = THREE.Vector2;
  // couleur sRGB → linéaire, avec légère variation (imperfections)
  const C = (hex, j = 0) => { const c = new THREE.Color(hex); if (j) { const k = 1 + (R() - 0.5) * j; c.r *= k * (1 + (R() - 0.5) * j * 0.3); c.g *= k; c.b *= k * (1 + (R() - 0.5) * j * 0.3); } return [c.r, c.g, c.b]; };
  const WHITE = [1, 1, 1];
  const put = (mk, g, c = WHITE, keepUV = false) => { g.translate(0, fy, 0); P.push(mk, g, { tint: c, keepUV }); };
  const rot = (g, o) => { if (o.rz) g.rotateZ(o.rz); if (o.rx) g.rotateX(o.rx); if (o.ry) g.rotateY(o.ry); return g; };
  // --- primitives (y depuis le sol fini)
  const box = (mk, x0, x1, y0, y1, z0, z1, c, o = {}) => {
    const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0), d = Math.abs(z1 - z0); if (w < 1e-4 || h < 1e-4 || d < 1e-4) return;
    const g = new THREE.BoxGeometry(w, h, d); rot(g, o); g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); put(mk, g, c);
  };
  // boîte arrondie centrée en (x, y, z)
  const rb = (mk, w, h, d, r, x, y, z, c, o = {}) => {
    const g = new RoundedBoxGeometry(w, h, d, o.seg || 2, Math.max(0.001, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)));
    rot(g, o); g.translate(x, y, z); put(mk, g, c);
  };
  // boîte arrondie posée : x0..x1, y0..y1, z0..z1
  const rbb = (mk, x0, x1, y0, y1, z0, z1, r, c, o = {}) => rb(mk, x1 - x0, y1 - y0, z1 - z0, r, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, c, o);
  const cyl = (mk, r0, r1, h, x, y, z, c, o = {}) => {
    const g = new THREE.CylinderGeometry(r1, r0, h, o.seg || 18, 1, !!o.open); g.translate(0, h / 2, 0); rot(g, o); g.translate(x, y, z); put(mk, g, c);
  };
  const lathe = (mk, pts, x, y, z, c, o = {}) => {
    const g = new THREE.LatheGeometry(pts.map(([r, yy]) => new V2(Math.max(0, r), yy)), o.seg || 28); rot(g, o); g.translate(x, y, z); put(mk, g, c);
  };
  const tube = (mk, pts, r, c, o = {}) => {
    const cv = new THREE.CatmullRomCurve3(pts.map(p => new V3(...p)), !!o.closed, 'centripetal');
    const g = new THREE.TubeGeometry(cv, o.seg || Math.max(8, pts.length * 6), r, o.rad || 6, !!o.closed); put(mk, g, c);
  };
  const torus = (mk, R0, r, x, y, z, c, o = {}) => { const g = new THREE.TorusGeometry(R0, r, o.rad || 6, o.seg || 32); g.rotateX(Math.PI / 2); rot(g, o); g.translate(x, y, z); put(mk, g, c); };
  // superquadrique (coussins, matelas, assises) : demi-axes a, b, c ; e1 vertical, e2 horizontal
  const sq = (mk, a, b, cz, x, y, z, col, o = {}) => {
    const e1 = o.e1 ?? 0.3, e2 = o.e2 ?? 0.25, nu = o.nu || 24, nv = o.nv || 14, pos = [], idx = [];
    const Cf = (w, m) => Math.sign(Math.cos(w)) * Math.pow(Math.abs(Math.cos(w)), m), Sf = (w, m) => Math.sign(Math.sin(w)) * Math.pow(Math.abs(Math.sin(w)), m);
    const pinch = o.pinch ?? 0, sag = o.sag ?? 0, puff = o.puff ?? 0, wob = o.wob ?? 0, seed = R() * 10;
    for (let j = 0; j <= nv; j++) {
      const ph = -Math.PI / 2 + Math.PI * j / nv;
      for (let i = 0; i <= nu; i++) {
        const th = -Math.PI + 2 * Math.PI * i / nu;
        let px = a * Cf(ph, e1) * Cf(th, e2), py = b * Sf(ph, e1), pz = cz * Cf(ph, e1) * Sf(th, e2);
        const nx = px / a, nz = pz / cz, m = Math.min(1, Math.max(Math.abs(nx), Math.abs(nz)));
        py *= 1 - pinch * Math.pow(m, 5) + puff * (1 - m * m);
        if (py > 0) py -= sag * b * (1 - nx * nx) * (1 - nz * nz);
        if (wob) { const w = wob * (Math.sin(px * 23 + seed) * Math.cos(pz * 19 + seed) + 0.5 * Math.sin(py * 31 + seed)); px += w * nx; pz += w * nz; py += w * 0.5; }
        pos.push(px, py, pz);
      }
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a0 = j * (nu + 1) + i, b0 = a0 + nu + 1; idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    g.computeVertexNormals(); rot(g, o); g.translate(x, y, z); put(mk, g, col);
  };
  // nappe paramétrique (drapés) : f(u, v) → [x, y, z], u, v ∈ [0, 1]
  const sheet = (mk, nu, nv, f, col, keepUV = false) => {
    const pos = [], uv = [], idx = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const p = f(i / nu, j / nv); pos.push(p[0], p[1], p[2]); uv.push(i / nu, j / nv); }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a0 = j * (nu + 1) + i, b0 = a0 + nu + 1; idx.push(a0, a0 + 1, b0, a0 + 1, b0 + 1, b0); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    g.computeVertexNormals(); put(mk, g, col, keepUV);
  };
  // plaque extrudée à coins arrondis (plateaux), posée en y0, épaisseur t
  const slab = (mk, w, d, t, r, x, y0, z, col, o = {}) => {
    const s = new THREE.Shape(), hw = w / 2, hd = d / 2, rr = Math.min(r, hw, hd);
    s.moveTo(-hw + rr, -hd); s.lineTo(hw - rr, -hd); s.quadraticCurveTo(hw, -hd, hw, -hd + rr); s.lineTo(hw, hd - rr); s.quadraticCurveTo(hw, hd, hw - rr, hd);
    s.lineTo(-hw + rr, hd); s.quadraticCurveTo(-hw, hd, -hw, hd - rr); s.lineTo(-hw, -hd + rr); s.quadraticCurveTo(-hw, -hd, -hw + rr, -hd);
    const bv = Math.min(o.bevel ?? 0.006, t / 2.5);
    const g = new THREE.ExtrudeGeometry(s, { depth: t - 2 * bv, bevelEnabled: true, bevelThickness: bv, bevelSize: bv, bevelSegments: 2, curveSegments: o.curve || 8 });
    g.rotateX(-Math.PI / 2); g.translate(0, bv, 0); if (o.ry) g.rotateY(o.ry); g.translate(x, y0, z); put(mk, g, col);
  };
  const disc = (mk, r, x, y, z, col, seg = 32) => { const g = new THREE.CircleGeometry(r, seg); g.rotateX(-Math.PI / 2); g.translate(x, y, z); put(mk, g, col); };
  // ombre de contact sous un objet (décalque) : centre, demi-largeurs
  const contact = (x, z, w, d, y = 0.007, ry = 0) => { const g = new THREE.PlaneGeometry(w, d); g.rotateX(-Math.PI / 2); if (ry) g.rotateY(ry); g.translate(x, y, z); put('contact', g, WHITE, true); };
  // version « plan » d'un volume haut : boîte coupée à 1,2 m + tranche sombre
  const tallPlan = (mk, x0, x1, z0, z1, c) => P.planOnly(() => { box(mk, x0, x1, 0, CUT - 0.01, z0, z1, c); const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0); g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, CUT + 0.003, (z0 + z1) / 2); put('cut', g); });
  const walk = (fn) => P.walkOnly(fn);
  const at = (x, z, ry, fn) => P.at(x, z, ry, fn);
  const pick = (a) => a[Math.floor(R() * a.length) % a.length];
  const jit = (s) => (R() - 0.5) * s;

  // ------------------------------------------------------------ palettes
  const PAL = {
    linenSand: 0xd8ccb8, linenGreige: 0xc9c0b3, linenWhite: 0xf3efe8, linenOat: 0xe4dac8, linenStone: 0xb9b2a6,
    terracotta: 0xb8684a, rust: 0x9c5236, ochre: 0xc89a4b, sage: 0x99a68a, olive: 0x7d7f5a, ink: 0x2f3a48, clay: 0xc79a80, charcoal: 0x4a4744, mustard: 0xb98f3e,
    straw: 0xcdb487, cognac: 0x9a6038, boucle: 0xf2ede4, walnut: 0x6c4a32,
  };

  // ------------------------------------------------------------ livres et petits objets
  const BOOKC = [0xa8432f, 0x2f3a48, 0xd9cdb5, 0x7d8a6c, 0xc89a4b, 0x3d3a36, 0xe8e2d6, 0x9c5236, 0x5f6b72, 0xb8a58a];
  // livre posé à plat (x, y0, z), dimensions w × d × t, rotation ry
  function book(x, y0, z, w, d, t, ry = 0, c = pick(BOOKC)) {
    const cc = C(c, 0.1), ct = 0.0025, g = (mk, x0, x1, y0b, y1, z0, z1, col) => box(mk, x0, x1, y0b, y1, z0, z1, col, { ry });
    const S = Math.sin(ry), Co = Math.cos(ry), tr = (lx, lz) => [x + lx * Co + lz * S, z - lx * S + lz * Co];
    // couvertures et dos, puis bloc de pages en retrait
    const part = (mk, lx0, lx1, ly0, ly1, lz0, lz1, col) => { const [cx, cz] = tr((lx0 + lx1) / 2, (lz0 + lz1) / 2); const gg = new THREE.BoxGeometry(lx1 - lx0, ly1 - ly0, lz1 - lz0); gg.rotateY(ry); gg.translate(cx, y0 + (ly0 + ly1) / 2, cz); put(mk, gg, col); };
    part('lacquer', -w / 2, w / 2, 0, ct, -d / 2, d / 2, cc); part('lacquer', -w / 2, w / 2, t - ct, t, -d / 2, d / 2, cc); part('lacquer', -w / 2, -w / 2 + ct, ct, t - ct, -d / 2, d / 2, cc);
    part('paper', -w / 2 + ct, w / 2 - 0.003, ct, t - ct, -d / 2 + 0.003, d / 2 - 0.003, C(0xf1ebde, 0.06));
    return t;
  }
  function bookStack(x, y0, z, n, ry = 0, big = false) { let y = y0; for (let i = 0; i < n; i++) { const w = big ? 0.26 + R() * 0.08 : 0.15 + R() * 0.05, d = big ? 0.2 + R() * 0.06 : 0.21 + R() * 0.03, t = big ? 0.025 + R() * 0.02 : 0.018 + R() * 0.02; y += book(x + jit(0.02), y, z + jit(0.02), w, d, t, ry + jit(0.25)); } return y; }
  // rangée de livres debout (le long de x local), hauteur ~ 0.2–0.3
  function bookRow(x0, x1, y0, z, ry = 0, lean = true) {
    let x = x0; const S = Math.sin(ry), Co = Math.cos(ry);
    while (x < x1 - 0.03) {
      const t = 0.018 + R() * 0.03, h = 0.18 + R() * 0.11, d = 0.14 + R() * 0.06, cc = C(pick(BOOKC), 0.12);
      if (x + t > x1) break;
      const lx = x + t / 2, wx = z + 0;
      const gg = new THREE.BoxGeometry(t, h, d); gg.translate(0, h / 2, 0); gg.rotateY(ry); gg.translate(lx * Co + wx * S, y0, -lx * S + wx * Co); put('lacquer', gg, cc);
      x += t + 0.001;
      if (lean && R() < 0.04) x += 0.04;
    }
  }
  function vase(x, y0, z, kind = 0, c = 0xe9e2d6, mk = 'stoneware') {
    const prof = [
      [[0, 0], [0.06, 0], [0.085, 0.05], [0.09, 0.12], [0.07, 0.2], [0.035, 0.26], [0.03, 0.3], [0.04, 0.31], [0.0, 0.31]],          // amphore
      [[0, 0], [0.07, 0], [0.11, 0.06], [0.11, 0.1], [0.06, 0.16], [0.05, 0.17], [0, 0.17]],                                          // boule basse
      [[0, 0], [0.04, 0], [0.05, 0.1], [0.045, 0.26], [0.05, 0.38], [0.0, 0.38]],                                                  // soliflore haut
      [[0, 0], [0.1, 0], [0.16, 0.05], [0.17, 0.07], [0, 0.07]],                                                                   // coupe
    ][kind];
    lathe(mk, prof, x, y0, z, C(c, 0.05), { seg: 26 });
    return prof[prof.length - 1][1];
  }
  // branchages secs dans un vase (tiges fines + petits rameaux)
  function branches(x, y0, z, h = 0.6, n = 5) {
    for (let i = 0; i < n; i++) {
      const a = R() * 6.28, s = 0.12 + R() * 0.18, top = [x + Math.cos(a) * s, y0 + h * (0.75 + R() * 0.3), z + Math.sin(a) * s];
      tube('bark', [[x, y0 - 0.02, z], [x + Math.cos(a) * s * 0.3, y0 + h * 0.4, z + Math.sin(a) * s * 0.3], top], 0.004, C(0x7a6a55), { seg: 8, rad: 3 });
      for (let k = 0; k < 3; k++) leafCard(lerp3([x, y0, z], top, 0.55 + 0.15 * k), 0.12, R() * 6.28, 0.4 + R() * 0.6, 'olive', C(0x8a9070, 0.2));
    }
  }
  const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  function bowl(x, y0, z, r = 0.12, c = 0xe8e0d2, mk = 'stoneware') { lathe(mk, [[0, 0], [r * 0.45, 0], [r * 0.85, r * 0.25], [r, r * 0.5], [r * 0.96, r * 0.52], [r * 0.8, r * 0.28], [0, r * 0.1]], x, y0, z, C(c, 0.06), { seg: 30 }); }
  function candle(x, y0, z, h = 0.12) { cyl('lacquer', 0.035, 0.035, h, x, y0, z, C(0xf2ece0)); cyl('black', 0.002, 0.002, 0.01, x, y0 + h, z, WHITE, { seg: 4 }); }
  function tray(x, y0, z, w, d, ry = 0, mk = 'oak', c = WHITE) { slab(mk, w, d, 0.012, 0.05, x, y0, z, c, { ry, bevel: 0.003 }); const t = 0.012; slab(mk, w, d, 0.006, 0.05, x, y0 + 0.012, z, c, { ry }); return y0 + t; }
  function fruitBowl(x, y0, z) { bowl(x, y0, z, 0.16, 0xd8cfc0, 'stoneware'); for (let i = 0; i < 5; i++) { const a = i * 1.3 + R(), r = 0.06 * (i ? 1 : 0); sq('ceramic', 0.035, 0.034, 0.035, x + Math.cos(a) * r, y0 + 0.07 + (i ? 0 : 0.02), z + Math.sin(a) * r, C(pick([0xd8a03a, 0xb3402a, 0xc7c25a]), 0.15), { e1: 1, e2: 1, nu: 10, nv: 6 }); } }

  // ------------------------------------------------------------ feuillage
  // carte de feuille : centre p, taille s, azimut a, inclinaison (0 = verticale), région d'atlas
  const ATL = { fig: [0, 0, 0.5, 1], olive: [0.5, 0.5, 1, 1], snake: [0.5, 0, 1, 0.5] };
  function leafCard(p, s, az, tilt, reg, col, bend = 0.25, aspect = 1) {
    const [u0, v0, u1, v1] = ATL[reg], w = s * aspect, h = s, pos = [], uv = [], idx = [], nu = 2, nv = 3;
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const u = i / nu, v = j / nv, lx = (u - 0.5) * w, ly = v * h, lz = bend * h * v * v - Math.abs(u - 0.5) * w * 0.25;
      pos.push(lx, ly, lz); uv.push(u0 + (u1 - u0) * u, v0 + (v1 - v0) * v);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a0 = j * (nu + 1) + i, b0 = a0 + nu + 1; idx.push(a0, a0 + 1, b0, a0 + 1, b0 + 1, b0); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    g.computeVertexNormals(); g.rotateX(-tilt); g.rotateY(az); g.translate(p[0], p[1], p[2]); put('leaf', g, col, true);
  }
  function pot(x, z, r, h, c, kind = 0) {
    const pr = kind === 0 ? [[0, 0], [r * 0.78, 0], [r * 0.95, h * 0.5], [r, h * 0.97], [r * 0.93, h], [r * 0.88, h * 0.92], [0, h * 0.9]]
      : [[0, 0], [r * 0.7, 0], [r * 0.98, h * 0.35], [r * 0.92, h * 0.85], [r * 0.85, h], [r * 0.8, h * 0.93], [0, h * 0.9]];
    lathe('stoneware', pr, x, 0, z, C(c, 0.05), { seg: 32 });
    disc('soil', r * 0.86, x, h * 0.9, z, C(0x6a5544, 0.1), 24);
    contact(x, z, r * 3, r * 3, 0.008);
  }
  // figuier lyre (Ficus lyrata) : tronc fin, grandes feuilles coriaces étagées
  function figTree(x, z, h = 1.7, potC = 0xe7dfd1) {
    pot(x, z, 0.2, 0.42, potC, 1);
    const trunk = [[x, 0.38, z], [x + 0.03, 0.9, z - 0.02], [x - 0.02, h * 0.75, z + 0.03], [x + 0.02, h * 0.95, z]];
    walk(() => {
      tube('bark', trunk, 0.018, C(0x7c6a55), { seg: 14, rad: 5 });
      const n = 34;
      for (let i = 0; i < n; i++) {
        const t = 0.35 + 0.65 * (i / n), y = h * (0.42 + 0.56 * t), az = i * 2.4 + jit(0.6), out = 0.08 + 0.18 * (1 - t) + R() * 0.06;
        const p = [x + Math.sin(az) * out * 0.5, y, z + Math.cos(az) * out * 0.5], s = 0.26 + R() * 0.12;
        leafCard(p, s, az, 0.45 + R() * 0.6 - t * 0.2, 'fig', C(pick([0x9fb07c, 0xb6c48e, 0x8ea26c]), 0.2), 0.12, 0.62);
      }
    });
  }
  // olivier en pot : tronc noueux, ramure en boule irrégulière de rameaux gris-vert
  function oliveTree(x, z, h = 1.8, potC = 0xcfc6b8) {
    pot(x, z, 0.27, 0.48, potC, 0);
    walk(() => {
      const base = [x, 0.44, z], top = [x + 0.05, h * 0.62, z - 0.04];
      tube('bark', [base, [x - 0.05, 0.8, z + 0.03], [x + 0.04, 1.05, z - 0.02], top], 0.035, C(0x8a7d6a), { seg: 18, rad: 6 });
      const arms = [];
      for (let b = 0; b < 4; b++) { const a = b * 1.6 + jit(0.5), e = [top[0] + Math.cos(a) * 0.3, h * (0.75 + R() * 0.15), top[2] + Math.sin(a) * 0.3]; tube('bark', [lerp3(base, top, 0.85), lerp3(top, e, 0.5), e], 0.014, C(0x8a7d6a), { seg: 8, rad: 4 }); arms.push(e); }
      for (let i = 0; i < 90; i++) {
        const e = arms[i % 4], a = R() * 6.28, rr = 0.1 + R() * 0.3, p = [e[0] + Math.cos(a) * rr, e[1] + (R() - 0.35) * 0.4, e[2] + Math.sin(a) * rr];
        leafCard(p, 0.2 + R() * 0.1, R() * 6.28, 0.2 + R() * 1.1, 'olive', C(pick([0xd9ddc8, 0xc8cdb4, 0xbfc8a8]), 0.2), 0.2);
      }
    });
  }
  // sansevieria : lames dressées
  function snakePlant(x, z, h = 0.75, potC = 0xb8684a) {
    pot(x, z, 0.14, 0.3, potC, 1);
    walk(() => { for (let i = 0; i < 11; i++) { const a = i * 2.3, rr = 0.03 + R() * 0.06; leafCard([x + Math.cos(a) * rr, 0.27, z + Math.sin(a) * rr], h * (0.6 + R() * 0.5), a + 1.4, 0.05 + R() * 0.2, 'snake', C(0xffffff, 0.2), 0.08, 0.12); } });
  }

  // ------------------------------------------------------------ luminaires
  function tableLamp(x, y0, z, kind = 0, baseC = 0xd9cfbf) {
    if (kind === 0) lathe('stoneware', [[0, 0], [0.07, 0], [0.11, 0.08], [0.1, 0.17], [0.05, 0.24], [0.02, 0.27], [0, 0.27]], x, y0, z, C(baseC, 0.05), { seg: 28 });
    else { cyl('brass', 0.07, 0.07, 0.012, x, y0, z, WHITE, { seg: 24 }); cyl('brass', 0.006, 0.006, 0.26, x, y0, z, WHITE, { seg: 8 }); }
    const yb = y0 + 0.25;
    lathe('shade', [[0.17, 0], [0.13, 0.22]], x, yb, z, C(0xf4ecdf), { seg: 32 });
    sq('bulb', 0.025, 0.03, 0.025, x, yb + 0.06, z, WHITE, { e1: 1, e2: 1, nu: 8, nv: 6 });
  }
  function floorLamp(x, z, H0 = 1.55) {
    walk(() => {
      for (let i = 0; i < 3; i++) { const a = i * 2.094 + 0.3; tube('black', [[x + Math.cos(a) * 0.26, 0, z + Math.sin(a) * 0.26], [x + Math.cos(a) * 0.02, H0 - 0.3, z + Math.sin(a) * 0.02]], 0.008, WHITE, { seg: 4, rad: 5 }); }
      cyl('black', 0.008, 0.008, 0.3, x, H0 - 0.32, z, WHITE, { seg: 6 });
      lathe('shade', [[0.23, 0], [0.22, 0.3]], x, H0 - 0.12, z, C(0xf0e6d6), { seg: 36 });
      sq('bulb', 0.03, 0.035, 0.03, x, H0, z, WHITE, { e1: 1, e2: 1, nu: 8, nv: 6 });
      contact(x, z, 0.7, 0.7);
    });
    P.planOnly(() => disc('black', 0.24, x, 0.02, z));
  }
  // suspension papier type « Akari » (au-dessus de la table) : bas de l'abat-jour à yb
  function akari(x, z, yb = 1.55, r = 0.3, h = 0.42) {
    walk(() => {
      const pts = []; for (let i = 0; i <= 14; i++) { const t = i / 14; pts.push([r * Math.sin(Math.PI * (0.08 + 0.84 * t)), h * t]); }
      lathe('shade', pts, x, yb, z, C(0xf6efe2), { seg: 40 });
      cyl('black', 0.002, 0.002, H - yb - h, x, yb + h, z, WHITE, { seg: 4 });
      cyl('lacquer', 0.04, 0.04, 0.012, x, H - 0.012, z, C(0xf2f0ea), { seg: 20 });
      sq('bulb', 0.04, 0.05, 0.04, x, yb + h * 0.45, z, WHITE, { e1: 1, e2: 1, nu: 10, nv: 6 });
    });
  }
  // petite suspension dôme (îlot) en métal noir, intérieur laiton
  function dome(x, z, yb = 1.7, r = 0.13) {
    walk(() => {
      lathe('black', [[r, 0], [r * 0.98, 0.04], [r * 0.85, 0.11], [r * 0.5, 0.16], [0.02, 0.18], [0, 0.18]], x, yb, z, WHITE, { seg: 32 });
      lathe('brass', [[r * 0.97, 0.002], [r * 0.82, 0.1], [r * 0.4, 0.15], [0, 0.16]], x, yb, z, WHITE, { seg: 32 });
      sq('bulb', 0.035, 0.03, 0.035, x, yb + 0.06, z, WHITE, { e1: 1, e2: 1, nu: 8, nv: 6 });
      cyl('black', 0.002, 0.002, H - yb - 0.18, x, yb + 0.18, z, WHITE, { seg: 4 });
      cyl('black', 0.035, 0.035, 0.012, x, H - 0.012, z, WHITE, { seg: 16 });
    });
  }

  // ------------------------------------------------------------ textiles
  function pillow(x, y, z, s, t, col, o = {}) { sq('textile', s / 2, t / 2, s / 2, x, y, z, col, { e1: 0.35, e2: 0.22, pinch: 0.75, puff: 0.15, nu: 20, nv: 12, rx: o.rx || 0, ry: o.ry || 0, rz: o.rz || 0, wob: 0.004 }); }
  // tapis : plateau souple + franges aux extrémités (selon x local)
  function fringe(w, d, mk = 'rug') {
    for (const s of [-1, 1]) for (let z = -d / 2 + 0.015; z < d / 2 - 0.01; z += 0.024) {
      const L = 0.05 + R() * 0.025, a = jit(0.35), g = new THREE.BoxGeometry(L, 0.003, 0.006);
      g.translate(L / 2, 0.0035, 0); g.rotateY(a); if (s < 0) g.rotateY(Math.PI); g.translate(s * w / 2, 0, z); put(mk, g, C(0xf2ebdd, 0.08));
    }
  }
  function rugF(w, d, mk = 'rug', col = WHITE, withFringe = true) { rbb(mk, -w / 2, w / 2, 0.004, 0.016, -d / 2, d / 2, 0.006, col); if (withFringe) fringe(w, d, mk); contact(0, 0, w + 0.1, d + 0.1, 0.006); }
  // plaid drapé sur un accoudoir : profil (x, y) local, largeur selon z
  function plaidOverArm(xa, armTop, armW, z0, z1, col) {
    const prof = [[xa - armW / 2 - 0.22, 0.47], [xa - armW / 2 - 0.05, armTop - 0.02], [xa - armW * 0.2, armTop + 0.012], [xa + armW * 0.25, armTop + 0.012], [xa + armW / 2 + 0.01, armTop - 0.04], [xa + armW / 2 + 0.02, armTop - 0.32]];
    const curve = new THREE.CatmullRomCurve3(prof.map(([px, py]) => new V3(px, py, 0)));
    sheet('cloth', 10, 24, (u, v) => { const p = curve.getPoint(v); const z = z0 + (z1 - z0) * u; const fold = Math.sin(u * 7.0 + v * 2.0); return [p.x + 0.006 * fold * v, p.y + 0.006 * Math.sin(u * 5.5 + 1) * Math.sin(v * 3.1), z + 0.012 * Math.sin(v * 4.5) * (1 - u * 0.5)]; }, col);
  }
  // plaid plié posé (x, y0, z), w × d
  function foldedThrow(x, y0, z, w, d, col, ry = 0) { sq('cloth', w / 2, 0.02, d / 2, x, y0 + 0.02, z, col, { e1: 0.3, e2: 0.15, pinch: 0.2, ry, nu: 18, nv: 8, wob: 0.003 }); }

  // ------------------------------------------------------------ assises
  // canapé 3 places à coussins séparés (lin), passepoils, pieds en chêne, coussins déco et plaid
  function sofa(w, o = {}) {
    const d = o.d || 0.96, col = C(o.col || PAL.linenSand, 0.02), colD = col.map(v => v * 0.82), seatY = 0.29, armW = 0.17, armH = 0.6;
    const nLeg = w > 2.1 ? 3 : 2;
    for (const sz of [-1, 1]) for (let i = 0; i < nLeg; i++) { const x = -w / 2 + 0.1 + (w - 0.2) * i / (nLeg - 1); rbb('oak', x - 0.03, x + 0.03, 0, 0.1, sz * (d / 2 - 0.09) - 0.03, sz * (d / 2 - 0.09) + 0.03, 0.006, C(0xf0e6da)); }
    rb('textile', w - 0.02, 0.19, d - 0.04, 0.035, 0, 0.1 + 0.095, 0, col, { seg: 3 });                                  // caisse
    for (const s of [-1, 1]) sq('textile', armW / 2, (armH - 0.1) / 2, d / 2, s * (w / 2 - armW / 2), 0.1 + (armH - 0.1) / 2, 0, col, { e1: 0.18, e2: 0.22, pinch: 0.08, nu: 24, nv: 14 });
    rb('textile', w - 2 * armW + 0.02, 0.42, 0.16, 0.05, 0, 0.29 + 0.21, -d / 2 + 0.09, col, { seg: 3 });                 // dossier
    const n = w > 2.1 ? 3 : 2, inner = w - 2 * armW, cw = inner / n;
    for (let i = 0; i < n; i++) {
      const x = -inner / 2 + cw * (i + 0.5), cd = d - 0.2, cz = 0.085;
      sq('textile', cw / 2 - 0.006, 0.08, cd / 2, x, seatY + 0.08, cz, C(o.col || PAL.linenSand, 0.03), { e1: 0.22, e2: 0.14, pinch: 0.28, sag: 0.12, nu: 26, nv: 12, wob: 0.002 });
      // passepoil sur l'arête supérieure du coussin
      const pts = []; for (let k = 0; k < 28; k++) { const th = -Math.PI + 2 * Math.PI * k / 28, cc = Math.cos(th), ss = Math.sin(th); pts.push([x + (cw / 2 - 0.006) * Math.sign(cc) * Math.pow(Math.abs(cc), 0.14), seatY + 0.08 + 0.055, cz + cd / 2 * Math.sign(ss) * Math.pow(Math.abs(ss), 0.14)]); }
      tube('textile', pts, 0.0045, colD, { closed: true, seg: 80, rad: 4 });
      sq('textile', cw / 2 - 0.008, 0.21, 0.1, x, seatY + 0.16 + 0.2, -d / 2 + 0.24, C(o.col || PAL.linenSand, 0.03), { e1: 0.25, e2: 0.2, pinch: 0.45, puff: 0.2, rx: -0.16, nu: 22, nv: 14, wob: 0.003 });
    }
    // coussins décoratifs
    const pc = o.pillows || [PAL.terracotta, PAL.linenOat, PAL.ochre, PAL.sage];
    const spots = [[-inner / 2 + 0.24, 0.12], [-inner / 2 + 0.5, -0.15], [inner / 2 - 0.26, -0.1], [inner / 2 - 0.5, 0.2]];
    pc.forEach((c, i) => { const [x, rz] = spots[i % spots.length]; const s = i === 1 ? 0.42 : 0.5; pillow(x, seatY + 0.16 + s / 2 - 0.04, -d / 2 + 0.36 + (i === 1 ? 0.06 : 0), s, 0.15, C(c, 0.03), { rx: -Math.PI / 2 + 0.32, rz: rz * 0.6 }); });
    if (o.plaid !== false) plaidOverArm(w / 2 - armW / 2, armH, armW, -0.1, 0.4, C(o.plaid || PAL.rust, 0.03));
    contact(0, 0, w + 0.15, d + 0.15);
  }
  // fauteuil enveloppant en bouclé, pieds chêne
  function armchair(o = {}) {
    const col = C(o.col || PAL.boucle, 0.02), mk = o.mk || 'boucle';
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl('oak', 0.022, 0.018, 0.14, sx * 0.29, 0, sz * 0.28, C(0xf0e6da), { seg: 10 });
    sq(mk, 0.39, 0.1, 0.39, 0, 0.14 + 0.1, 0, col, { e1: 0.35, e2: 0.4, pinch: 0.1, nu: 28, nv: 12 });
    sq(mk, 0.39, 0.25, 0.13, 0, 0.5, -0.27, col, { e1: 0.45, e2: 0.5, rx: -0.12, nu: 28, nv: 14 });
    for (const s of [-1, 1]) sq(mk, 0.1, 0.13, 0.34, s * 0.3, 0.42, -0.02, col, { e1: 0.4, e2: 0.4, nu: 20, nv: 12 });
    sq(mk, 0.24, 0.065, 0.3, 0, 0.39, 0.06, col, { e1: 0.3, e2: 0.25, pinch: 0.3, sag: 0.1, nu: 22, nv: 10 });
    if (o.pillow) pillow(0, 0.6, -0.12, 0.4, 0.13, C(o.pillow), { rx: -Math.PI / 2 + 0.35 });
    contact(0, 0, 0.95, 0.95);
  }
  // chaise en chêne, assise en corde de papier tressée (inspiration « wishbone »)
  function chair(o = {}) {
    const oak = C(o.wood || 0xc6a37c, 0.04), sh = 0.44;
    for (const sx of [-1, 1]) {
      tube('oak', [[sx * 0.21, 0, 0.2], [sx * 0.205, sh, 0.19]], 0.016, oak, { seg: 3, rad: 7 });
      tube('oak', [[sx * 0.2, 0, -0.21], [sx * 0.2, sh, -0.17], [sx * 0.2, 0.74, -0.2]], 0.017, oak, { seg: 8, rad: 7 });
    }
    tube('oak', [[-0.25, 0.66, 0.02], [-0.23, 0.72, -0.19], [0, 0.745, -0.27], [0.23, 0.72, -0.19], [0.25, 0.66, 0.02]], 0.014, oak, { seg: 30, rad: 7 });
    rbb('oak', -0.02, 0.02, sh + 0.02, 0.72, -0.25, -0.23, 0.008, oak, { rx: 0.1 });
    for (const s of [-1, 1]) box('oak', -0.21, 0.21, sh - 0.05, sh - 0.01, s * 0.18 - 0.012, s * 0.18 + 0.012, oak);
    sq('textile', 0.225, 0.022, 0.215, 0, sh + 0.012, 0.0, C(o.seat || PAL.straw, 0.05), { e1: 0.2, e2: 0.12, sag: 0.25, nu: 18, nv: 8 });
    if (o.cushion) pillow(0, sh + 0.05, 0.01, 0.38, 0.05, C(o.cushion));
    contact(0, 0, 0.6, 0.6, 0.007);
  }
  function barStool(o = {}) {
    const oak = C(0xfaf3ea, 0.04), sh = 0.65;
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; tube('oak', [[Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2], [Math.cos(a) * 0.13, sh - 0.03, Math.sin(a) * 0.13]], 0.015, oak, { seg: 3, rad: 7 }); }
    torus('black', 0.17, 0.008, 0, 0.25, 0, WHITE, { seg: 28 });
    sq('textile', 0.175, 0.03, 0.175, 0, sh, 0, C(o.seat || PAL.cognac, 0.05), { e1: 0.3, e2: 1, sag: 0.15, nu: 24, nv: 8 });
    contact(0, 0, 0.5, 0.5);
  }

  // ------------------------------------------------------------ tables et rangements
  function coffeeTable(o = {}) {
    const w = o.w || 1.1, d = o.d || 0.6, h = o.h || 0.34;
    slab('travertine', w, d, 0.04, d / 2, 0, h - 0.04, 0, C(0xffffff, 0.02), { curve: 14 });
    for (const s of [-1, 1]) cyl('travertine', 0.12, 0.12, h - 0.04, s * w * 0.26, 0, 0, C(0xf4efe8), { seg: 28 });
    contact(0, 0, w + 0.25, d + 0.25, 0.018);
    // composition : livres, coupe, soliflore, bougie
    const y = h;
    bookStack(-w * 0.22, y, 0.02, 3, 0.1, true);
    bowl(w * 0.18, y, -0.06, 0.12, 0x3d3a36, 'stoneware');
    const vh = vase(w * 0.32, y, 0.12, 2, 0xe8dfd0); branches(w * 0.32, y + vh, 0.12, 0.42, 4);
    candle(-w * 0.05, y, -0.14, 0.09);
  }
  function sideTable(x, z, o = {}) { cyl('oak', 0.2, 0.2, 0.025, x, 0.5, z, C(0xfaf3ea), { seg: 32 }); cyl('oak', 0.03, 0.04, 0.5, x, 0, z, C(0xfaf3ea), { seg: 12 }); cyl('oak', 0.15, 0.15, 0.02, x, 0, z, C(0xfaf3ea), { seg: 24 }); if (o.lamp) tableLamp(x, 0.525, z, 1); else bookStack(x, 0.525, z, 2); contact(x, z, 0.5, 0.5); }
  // table ronde (Ø, piétement central)
  function roundTable(r = 0.6) {
    const oak = C(0xfaf3ea, 0.03);
    lathe('oak', [[0, 0.72], [r - 0.01, 0.72], [r, 0.728], [r, 0.748], [r - 0.012, 0.755], [0, 0.755]], 0, 0, 0, oak, { seg: 64 });
    lathe('oak', [[0, 0], [0.3, 0], [0.3, 0.025], [0.12, 0.05], [0.09, 0.3], [0.1, 0.6], [0.16, 0.72], [0, 0.72]], 0, 0, 0, oak, { seg: 40 });
    contact(0, 0, 2 * r + 0.6, 2 * r + 0.6);
  }
  function rectTable(w = 1.6, d = 0.9) {
    const oak = C(0xfaf3ea, 0.03);
    slab('oak', w, d, 0.035, 0.04, 0, 0.72, 0, oak, { bevel: 0.006 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) tube('oak', [[sx * (w / 2 - 0.12), 0, sz * (d / 2 - 0.1)], [sx * (w / 2 - 0.1), 0.72, sz * (d / 2 - 0.08)]], 0.028, oak, { seg: 3, rad: 10 });
    box('oak', -w / 2 + 0.12, w / 2 - 0.12, 0.64, 0.72, -d / 2 + 0.08, -d / 2 + 0.1, oak); box('oak', -w / 2 + 0.12, w / 2 - 0.12, 0.64, 0.72, d / 2 - 0.1, d / 2 - 0.08, oak);
    contact(0, 0, w + 0.6, d + 0.9);
  }
  // table dressée : vase et coupe
  function tableDecor(x, z, y = 0.755) { const vh = vase(x - 0.05, y, z, 0, 0xc9b9a2); branches(x - 0.05, y + vh, z, 0.5, 5); bowl(x + 0.22, y, z + 0.08, 0.13, 0xe9e2d6); }
  // buffet bas en chêne (façades à cannelures), sur plinthe en retrait
  function sideboard(w = 1.6, d = 0.44, h = 0.7, o = {}) {
    const oak = C(0xf6eee4, 0.03), n = Math.max(2, Math.round(w / 0.42));
    box('oak', -w / 2 + 0.06, w / 2 - 0.06, 0, 0.1, -d / 2 + 0.03, d / 2 - 0.06, C(0x8a6a4c));
    rbb('oak', -w / 2, w / 2, 0.1, h, -d / 2, d / 2 - 0.02, 0.006, oak);
    for (let i = 0; i < n; i++) {
      const x0 = -w / 2 + 0.004 + i * w / n, x1 = x0 + w / n - 0.006;
      for (let x = x0 + 0.012; x < x1 - 0.008; x += 0.024) { box('oak', x - 0.0095, x + 0.0095, 0.11, h - 0.01, d / 2 - 0.02, d / 2 - 0.006, C(0xf6eee4, 0.04)); box('oak', x - 0.006, x + 0.006, 0.11, h - 0.01, d / 2 - 0.006, d / 2 - 0.003, C(0xf6eee4, 0.04)); }
    }
    contact(0, 0, w + 0.2, d + 0.25);
    if (o.decor !== false) {
      tableLamp(-w / 2 + 0.28, h, -0.02, 0, 0xc9b9a2);
      bookStack(0.05, h, 0.02, 2, 0.15, true);
      const vh = vase(w / 2 - 0.25, h, 0, 0, 0xe8dfd0); branches(w / 2 - 0.25, h + vh, 0, 0.55, 5);
      bowl(0.32, h, 0.04, 0.09, 0x6b4a36);
    }
  }
  // armoire / placard toute hauteur, façades laquées, prises de main verticales en chêne
  function wardrobe(w, d = 0.6, o = {}) {
    const hT = H - 0.005, col = C(o.col || 0xece7de, 0.01), n = Math.max(2, Math.round(w / 0.5));
    walk(() => {
      box('lacquer', -w / 2, w / 2, 0, hT, -d / 2, d / 2 - 0.02, col);
      box('lacquer', -w / 2 + 0.01, w / 2 - 0.01, 0, 0.08, d / 2 - 0.05, d / 2 - 0.02, col.map(v => v * 0.7));
      for (let i = 0; i < n; i++) {
        const x0 = -w / 2 + i * w / n + 0.0015, x1 = x0 + w / n - 0.003;
        rbb('lacquer', x0, x1, 0.085, hT - 0.003, d / 2 - 0.02, d / 2, 0.002, col, { seg: 1 });
        const hx = i % 2 ? x0 + 0.04 : x1 - 0.04; rbb('oak', hx - 0.012, hx + 0.012, 0.9, 1.3, d / 2, d / 2 + 0.02, 0.008, C(0xf6eee4));
      }
    });
    tallPlan('lacquer', -w / 2, w / 2, -d / 2, d / 2, col);
  }
  // étagère murale en chêne avec objets (x local de -w/2 à w/2, profondeur d, fixée au mur z = 0 → z = d)
  function wallShelf(w, y, d = 0.24, o = {}) {
    rbb('oak', -w / 2, w / 2, y, y + 0.03, 0, d, 0.004, C(0xf6eee4, 0.03));
    if (o.objects !== false) {
      bookRow(-w / 2 + 0.05, -w / 2 + 0.05 + w * 0.35, y + 0.03, d / 2, 0);
      vase(w * 0.1, y + 0.03, d / 2, 1, 0xd9cfbf); bowl(w * 0.3, y + 0.03, d / 2, 0.08, 0x9c5236);
    }
  }
  function bench(w, d = 0.38, o = {}) {
    const oak = C(0xf6eee4, 0.03);
    slab('oak', w, d, 0.04, 0.02, 0, 0.4, 0, oak);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) rbb('oak', sx * (w / 2 - 0.06) - 0.022, sx * (w / 2 - 0.06) + 0.022, 0, 0.4, sz * (d / 2 - 0.06) - 0.022, sz * (d / 2 - 0.06) + 0.022, 0.006, oak);
    if (o.cushion) sq('textile', w / 2 - 0.04, 0.03, d / 2 - 0.03, 0, 0.47, 0, C(o.cushion), { e1: 0.2, e2: 0.12, pinch: 0.3, nu: 20, nv: 8 });
    if (o.throw) foldedThrow(w * 0.25, 0.44 + (o.cushion ? 0.06 : 0), 0, 0.45, d - 0.06, C(o.throw));
    contact(0, 0, w + 0.2, d + 0.2);
  }
  function desk(w = 1.2, d = 0.55) {
    const oak = C(0xf6eee4, 0.03);
    slab('oak', w, d, 0.03, 0.01, 0, 0.72, 0, oak);
    for (const s of [-1, 1]) { box('black', s * (w / 2 - 0.05) - 0.01, s * (w / 2 - 0.05) + 0.01, 0, 0.72, -d / 2 + 0.05, d / 2 - 0.05); box('black', s * (w / 2 - 0.05) - 0.01, s * (w / 2 - 0.05) + 0.01, 0, 0.02, -d / 2 + 0.03, d / 2 - 0.03); }
    box('black', -w / 2 + 0.05, w / 2 - 0.05, 0.6, 0.62, -d / 2 + 0.06, -d / 2 + 0.08);
    // lampe d'architecte, carnet, ordinateur fermé, pot à crayons
    const y = 0.75;
    cyl('black', 0.07, 0.07, 0.015, w / 2 - 0.15, y, -0.12, WHITE);
    tube('black', [[w / 2 - 0.15, y, -0.12], [w / 2 - 0.18, y + 0.32, -0.16], [w / 2 - 0.32, y + 0.42, -0.04]], 0.006, WHITE, { seg: 10, rad: 4 });
    lathe('black', [[0.06, 0], [0.04, 0.08], [0.015, 0.1], [0, 0.1]], w / 2 - 0.33, y + 0.3, -0.03, WHITE, { seg: 20 });
    rbb('steel', -0.17, 0.17, y, y + 0.016, -0.12, 0.12, 0.006, C(0x9a9ea3), { ry: 0.1 });
    book(0.25, y, 0.05, 0.15, 0.21, 0.015, -0.3, 0x2f3a48);
    cyl('stoneware', 0.035, 0.035, 0.1, -w / 2 + 0.12, y, -0.15, C(0x9c5236));
    for (let i = 0; i < 4; i++) cyl('lacquer', 0.004, 0.004, 0.16, -w / 2 + 0.12 + jit(0.03), y + 0.02, -0.15 + jit(0.03), C(pick([0x2f3a48, 0xc89a4b, 0x3d3a36])), { rz: jit(0.3), seg: 5 });
    contact(0, 0, w + 0.2, d + 0.2);
  }
  function nightstand(o = {}) {
    const oak = C(0xf6eee4, 0.04), w = o.w || 0.45, d = 0.38, h = 0.5;
    rbb('oak', -w / 2, w / 2, 0.08, h, -d / 2, d / 2, 0.006, oak);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) rbb('oak', sx * (w / 2 - 0.04) - 0.015, sx * (w / 2 - 0.04) + 0.015, 0, 0.09, sz * (d / 2 - 0.04) - 0.015, sz * (d / 2 - 0.04) + 0.015, 0.004, oak);
    box('oak', -w / 2 + 0.02, w / 2 - 0.02, h - 0.16, h - 0.157, d / 2, d / 2 + 0.002, C(0x7a5a3c));
    rbb('brass', -0.04, 0.04, h - 0.1, h - 0.088, d / 2, d / 2 + 0.018, 0.005);
    if (o.lamp !== false) tableLamp(-0.03, h, -0.03, o.lampKind || 0, o.lampC || 0xd9cfbf);
    if (o.books !== false) bookStack(0.1, h, 0.08, 2, 0.4);
    if (o.cup) cyl('ceramic', 0.04, 0.035, 0.08, 0.13, h, -0.1, C(0xe9e2d6));
    contact(0, 0, w + 0.15, d + 0.15);
  }
  // lit : sommier tapissier, tête de lit capitonnée en lin (côtes verticales), couette, oreillers, plaid au pied
  function bed(w, L = 2.0, o = {}) {
    const hb = C(o.head || PAL.linenGreige, 0.02), sheetC = C(o.sheet || PAL.linenWhite, 0.02), duvetC = C(o.duvet || PAL.linenWhite, 0.02);
    const hbW = w + 0.2, hbH = 1.12, z0 = 0.09, top = 0.56;
    // tête de lit : panneau + côtes
    rbb('textile', -hbW / 2, hbW / 2, 0.08, hbH, 0, 0.06, 0.02, hb.map(v => v * 0.92));
    const nr = Math.round(hbW / 0.2), rw = hbW / nr;
    for (let i = 0; i < nr; i++) sq('textile', rw / 2 - 0.004, (hbH - 0.14) / 2, 0.035, -hbW / 2 + rw * (i + 0.5), 0.12 + (hbH - 0.14) / 2, 0.07, hb, { e1: 0.18, e2: 0.6, pinch: 0.05, nu: 12, nv: 10 });
    // base (sommier gainé) sur socle en retrait
    box('oak', -w / 2 + 0.08, w / 2 - 0.08, 0, 0.08, z0 + 0.1, z0 + L - 0.1, C(0x5a4636));
    rbb('textile', -w / 2 - 0.02, w / 2 + 0.02, 0.07, 0.33, z0, z0 + L + 0.02, 0.03, hb);
    sq('textile', w / 2, 0.11, L / 2, 0, 0.33 + 0.105, z0 + L / 2, sheetC, { e1: 0.18, e2: 0.1, pinch: 0.1, nu: 24, nv: 10 });
    // couette : nappe qui retombe sur les côtés et au pied
    const hang = 0.24, zA = z0 + 0.55, zB = z0 + L + 0.02, rr = 0.05;
    const fall = (dd) => (dd <= 0 ? [0, 0] : dd < rr * Math.PI / 2 ? [rr * Math.sin(dd / rr), -rr + rr * Math.cos(dd / rr)] : [rr, -rr - (dd - rr * Math.PI / 2)]);
    sheet('cloth', 40, 46, (u, v) => {
      const s = (u - 0.5) * (w + 2 * hang), t = v * (zB - zA + hang);
      const dx = Math.abs(s) - w / 2 - 0.01, dz = t - (zB - zA);
      const [ox, oy1] = fall(dx), [oz, oy2] = fall(dz);
      const x = Math.sign(s) * (Math.min(Math.abs(s), w / 2 + 0.01) + ox) + 0.008 * Math.sin(t * 17 + s * 3);
      const z = zA + Math.min(t, zB - zA) + oz;
      let y = top + 0.02 + oy1 + oy2 + 0.014 * Math.sin(s * 9 + t * 4) * Math.cos(t * 6) + 0.008 * Math.sin(s * 23 - t * 17) + 0.012 * Math.exp(-Math.pow((t - 0.1) / 0.12, 2)) + 0.02 * Math.exp(-Math.pow((s + t * 0.6 - 0.5) / 0.08, 2)) * (Math.abs(s) < w / 2 ? 1 : 0);
      y = Math.max(y, 0.12 + 0.02 * Math.sin(s * 30 + t * 30));
      return [x, y, z];
    }, duvetC);
    // revers de couette en tête
    sq('cloth', w / 2 + 0.015, 0.035, 0.12, 0, top + 0.03, zA + 0.05, duvetC, { e1: 0.4, e2: 0.12, nu: 24, nv: 8, wob: 0.004 });
    // oreillers : deux grands carrés contre la tête de lit, deux standard, un coussin
    const np = w >= 1.5 ? 2 : 2;
    for (let i = 0; i < np; i++) { const x = (i - (np - 1) / 2) * (w / np); pillow(x, top + 0.3, z0 + 0.17, Math.min(0.62, w / np - 0.04), 0.17, sheetC, { rx: -Math.PI / 2 + 0.3, rz: jit(0.05) }); pillow(x + jit(0.03), top + 0.17, z0 + 0.4, Math.min(0.6, w / np - 0.06) * 0.92, 0.14, C(o.pillow2 || PAL.linenOat, 0.03), { rx: -Math.PI / 2 + 0.75, rz: jit(0.05) }); }
    pillow(0, top + 0.14, z0 + 0.58, 0.44, 0.13, C(o.accent || PAL.terracotta), { rx: -Math.PI / 2 + 0.6, rz: 0.04 });
    // plaid plié en travers au pied
    sheet('cloth', 30, 8, (u, v) => { const s = (u - 0.5) * (w + 0.44), dx = Math.abs(s) - w / 2 - 0.015, [ox, oy] = fall(dx); return [Math.sign(s) * (Math.min(Math.abs(s), w / 2 + 0.015) + ox * 1.2), top + 0.05 + oy, z0 + L - 0.5 + v * 0.42 + 0.01 * Math.sin(u * 20)]; }, C(o.throw || PAL.ochre, 0.02));
    contact(0, z0 + L / 2, w + 0.3, L + 0.3);
  }

  // ------------------------------------------------------------ murs : œuvres, miroirs, patères, interrupteurs
  // tableau encadré sur un mur : face vers +z local, dos à z = 0 ; (cx, cy) centre, w × h
  function art(cx, cy, w, h, idx, o = {}) {
    walk(() => {
      const fw = o.fw ?? 0.025, fd = 0.03, mat = o.mat ?? 0.06, frame = o.frame || 'oak', fc = C(o.fc || (frame === 'oak' ? 0xc39d73 : 0xffffff));
      box(frame, cx - w / 2, cx + w / 2, cy - h / 2, cy - h / 2 + fw, 0, fd, fc); box(frame, cx - w / 2, cx + w / 2, cy + h / 2 - fw, cy + h / 2, 0, fd, fc);
      box(frame, cx - w / 2, cx - w / 2 + fw, cy - h / 2 + fw, cy + h / 2 - fw, 0, fd, fc); box(frame, cx + w / 2 - fw, cx + w / 2, cy - h / 2 + fw, cy + h / 2 - fw, 0, fd, fc);
      box('paper', cx - w / 2 + fw, cx + w / 2 - fw, cy - h / 2 + fw, cy + h / 2 - fw, 0.004, fd - 0.008, C(0xf7f4ee));
      // image recadrée selon les proportions
      const iw = w - 2 * fw - 2 * mat, ih = h - 2 * fw - 2 * mat, cell = 0.25, cu = (idx % 4) * cell, cvv = 1 - (Math.floor(idx / 4) + 1) * 0.5;
      const ar = iw / ih; let su = cell, sv = 0.5; if (ar > 1) sv = 0.5 / ar; else su = cell * ar;
      const g = new THREE.PlaneGeometry(iw, ih); const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, cu + (cell - su) / 2 + uv.getX(i) * su, cvv + (0.5 - sv) / 2 + uv.getY(i) * sv);
      g.translate(cx, cy, fd - 0.0075); put('art', g, WHITE, true);
    });
  }
  function roundMirror(cx, cy, r, frame = 'brass') { walk(() => { const g = new THREE.CircleGeometry(r, 48); g.translate(cx, cy, 0.012); put('mirror', g); torus(frame, r, 0.012, cx, cy, 0.012, WHITE, { rx: Math.PI / 2, seg: 48, rad: 8 }); }); }
  function rectMirror(cx, cy, w, h, frame = 'oak') { walk(() => { const g = new THREE.PlaneGeometry(w - 0.04, h - 0.04); g.translate(cx, cy, 0.016); put('mirror', g); rbb(frame, cx - w / 2, cx + w / 2, cy - h / 2, cy + h / 2, 0, 0.014, 0.01, C(0xf6eee4)); }); }
  function pegRail(w, y, n = 4, o = {}) {
    walk(() => {
      rbb('oak', -w / 2, w / 2, y - 0.04, y + 0.04, 0, 0.02, 0.006, C(0xf6eee4));
      for (let i = 0; i < n; i++) { const x = -w / 2 + w * (i + 0.5) / n; cyl('oak', 0.014, 0.012, 0.09, x, y, 0.02, C(0xf6eee4), { rx: Math.PI / 2 - 0.15, seg: 10 }); }
      // un manteau et un sac de toile suspendus
      if (o.coat) { const x = -w / 2 + w * 0.5 / n; sq('textile', 0.22, 0.45, 0.08, x, y - 0.42, 0.11, C(o.coat, 0.03), { e1: 0.5, e2: 0.4, pinch: -0.1, nu: 16, nv: 14 }); }
      if (o.bag) { const x = -w / 2 + w * 2.5 / n; sq('cloth', 0.17, 0.2, 0.03, x, y - 0.28, 0.06, C(o.bag, 0.03), { e1: 0.15, e2: 0.2, nu: 12, nv: 10, rx: 0.08 }); tube('cloth', [[x - 0.07, y - 0.1, 0.06], [x, y + 0.02, 0.07], [x + 0.07, y - 0.1, 0.06]], 0.008, C(o.bag)); }
    });
  }
  // rideaux voilage : plis ondulés, x de x0 à x1, plan z (local), rail au plafond
  function sheers(x0, x1, z, o = {}) {
    walk(() => {
      const top = H - 0.04, n = Math.max(8, Math.round((x1 - x0) / 0.01)), lam = o.lam || 0.11, A = o.amp || 0.035, ph = R() * 6;
      sheet('sheer', n, 10, (u, v) => { const x = x0 + (x1 - x0) * u, y = 0.012 + (top - 0.012) * v; return [x, y, z + A * Math.sin((x - x0) / lam * Math.PI * 2 + ph) * (0.8 + 0.2 * v)]; }, C(0xffffff));
      box('black', o.r0 ?? x0 - 0.05, o.r1 ?? x1 + 0.05, H - 0.03, H - 0.002, z - 0.012, z + 0.012, C(0xffffff));
    });
  }
  // rideaux en lin épais (chambres) : même principe, opaque
  function drapes(x0, x1, z, col) {
    walk(() => {
      const top = H - 0.04, n = Math.max(8, Math.round((x1 - x0) / 0.01)), lam = 0.13, A = 0.045, ph = R() * 6;
      sheet('cloth', n, 12, (u, v) => { const x = x0 + (x1 - x0) * u, y = 0.006 + (top - 0.006) * v; return [x, y, z + A * Math.sin((x - x0) / lam * Math.PI * 2 + ph) * (1 - 0.15 * v) + 0.015 * (1 - v)]; }, col);
    });
  }

  // ------------------------------------------------------------ cuisine
  // linéaire bas : x local -L/2..L/2, dos z = -0.3, façade z = +0.3 ; modules [{w, t:'door'|'drawers'|'dw', sink, hob}]
  function baseRun(L, mods, o = {}) {
    const fr = o.front || 'oak', fc = C(o.frontC || 0xffffff, 0.01), top = o.top || 'stone', topC = C(o.topC || 0xffffff), hY = 0.87, tT = 0.03;
    box('lacquer', -L / 2, L / 2, 0.1, hY, -0.3, 0.28, C(0xe9e5dd));
    box('lacquer', -L / 2, L / 2, 0, 0.1, -0.3, 0.22, C(0x4a4744));                      // plinthe en retrait
    let x = -L / 2; const sinks = [], hobs = [];
    for (const m of mods) {
      const x0 = x + 0.0015, x1 = x + m.w - 0.0015;
      const fronts = m.t === 'drawers' ? [[0.1, 0.36], [0.36, 0.62], [0.62, hY - 0.003]] : m.t === 'drawers2' ? [[0.1, 0.5], [0.5, hY - 0.003]] : [[0.1, hY - 0.003]];
      for (const [y0, y1] of fronts) {
        rbb(fr, x0, x1, y0 + 0.0015, y1 - 0.0015, 0.28, 0.299, 0.0015, fc, { seg: 1 });
        if (o.handle !== 'none') { const hy = y1 - 0.035; rbb(o.handleMk || 'brass', (x0 + x1) / 2 - Math.min(0.12, (x1 - x0) * 0.3), (x0 + x1) / 2 + Math.min(0.12, (x1 - x0) * 0.3), hy - 0.006, hy + 0.006, 0.299, 0.318, 0.004, WHITE); }
      }
      if (m.sink) sinks.push([(x0 + x1) / 2, m.sinkW || 0.5]);
      if (m.hob) hobs.push((x0 + x1) / 2);
      x += m.w;
    }
    // plan de travail (découpe d'évier)
    const ty0 = hY, ty1 = hY + tT, zb = -0.3, zf = 0.32;
    let cx = -L / 2;
    for (const [sx, sw] of sinks) {
      box(top, cx, sx - sw / 2, ty0, ty1, zb, zf, topC); box(top, sx - sw / 2, sx + sw / 2, ty0, ty1, zb, -0.2, topC); box(top, sx - sw / 2, sx + sw / 2, ty0, ty1, 0.22, zf, topC);
      // cuve sous plan en inox + bonde, robinet col de cygne noir mat
      box('steel', sx - sw / 2 + 0.01, sx + sw / 2 - 0.01, ty0 - 0.2, ty0 - 0.19, -0.19, 0.21, C(0x9da1a4)); for (const s of [-1, 1]) { box('steel', s > 0 ? sx + sw / 2 - 0.012 : sx - sw / 2 + 0.002, s > 0 ? sx + sw / 2 - 0.002 : sx - sw / 2 + 0.012, ty0 - 0.2, ty0, -0.19, 0.21, C(0x9da1a4)); box('steel', sx - sw / 2 + 0.01, sx + sw / 2 - 0.01, ty0 - 0.2, ty0, s > 0 ? 0.2 : -0.2, s > 0 ? 0.21 : -0.19, C(0x9da1a4)); }
      cyl('steel', 0.03, 0.03, 0.003, sx, ty0 - 0.19, 0.01, C(0x55585a));
      const tm = o.tap || 'black';
      cyl(tm, 0.022, 0.022, 0.06, sx, ty1, -0.25, WHITE, { seg: 14 });
      tube(tm, [[sx, ty1 + 0.05, -0.25], [sx, ty1 + 0.3, -0.25], [sx, ty1 + 0.36, -0.17], [sx, ty1 + 0.3, -0.1], [sx, ty1 + 0.25, -0.1]], 0.011, WHITE, { seg: 24, rad: 8 });
      tube(tm, [[sx + 0.05, ty1 + 0.02, -0.25], [sx + 0.09, ty1 + 0.03, -0.25]], 0.006, WHITE, { seg: 3 });
      cx = sx + sw / 2;
    }
    box(top, cx, L / 2, ty0, ty1, zb, zf, topC);
    for (const hx of hobs) {
      box('glassBlack', hx - 0.29, hx + 0.29, ty1, ty1 + 0.005, -0.25, 0.25);
      for (const [dx, dz, r] of [[-0.14, -0.1, 0.1], [0.14, -0.1, 0.08], [-0.14, 0.12, 0.08], [0.14, 0.12, 0.1]]) { const g = new THREE.RingGeometry(r - 0.003, r, 40); g.rotateX(-Math.PI / 2); g.translate(hx + dx, ty1 + 0.0055, dz); put('steel', g, C(0x6a6e72)); }
      box('steel', hx - 0.1, hx + 0.1, ty1 + 0.0052, ty1 + 0.0058, 0.2, 0.235, C(0x7a7e82));
    }
    return { top: ty1, sinks, hobs };
  }
  // colonne toute hauteur : 'oven' (four + four combiné) ou 'fridge' ; x local -w/2..w/2
  function tallUnit(w, kind, o = {}) {
    const fc = C(o.frontC || 0xe8e3da, 0.01), fr = o.front || 'lacquer', hT = H - 0.005;
    walk(() => {
      box('lacquer', -w / 2, w / 2, 0, hT, -0.3, 0.28, C(0xe9e5dd));
      box('lacquer', -w / 2 + 0.005, w / 2 - 0.005, 0, 0.1, 0.18, 0.28, C(0x4a4744));
      const F = (y0, y1, handle = true) => { rbb(fr, -w / 2 + 0.0015, w / 2 - 0.0015, y0 + 0.0015, y1 - 0.0015, 0.28, 0.299, 0.0015, fc, { seg: 1 }); if (handle) rbb(o.handleMk || 'brass', w / 2 - 0.05, w / 2 - 0.038, y0 + 0.05, Math.min(y1 - 0.05, y0 + 0.5), 0.299, 0.318, 0.004, WHITE); };
      if (kind === 'oven') {
        F(0.1, 0.5); F(0.5, 0.8);
        box('glassBlack', -w / 2 + 0.003, w / 2 - 0.003, 0.8, 1.38, 0.27, 0.3); box('steel', -w / 2 + 0.02, w / 2 - 0.02, 1.31, 1.37, 0.3, 0.302, C(0x2a2b2d));
        tube('steel', [[-w / 2 + 0.06, 1.28, 0.31], [w / 2 - 0.06, 1.28, 0.31]], 0.007, WHITE, { seg: 2 }); for (const s of [-1, 1]) box('steel', s * (w / 2 - 0.06) - 0.005, s * (w / 2 - 0.06) + 0.005, 1.275, 1.285, 0.3, 0.31);
        box('glassBlack', -w / 2 + 0.003, w / 2 - 0.003, 1.38, 1.83, 0.27, 0.3); tube('steel', [[-w / 2 + 0.06, 1.75, 0.31], [w / 2 - 0.06, 1.75, 0.31]], 0.006, WHITE, { seg: 2 });
        F(1.83, hT);
      } else { F(0.1, 1.55); F(1.55, hT); }
    });
    tallPlan('lacquer', -w / 2, w / 2, -0.3, 0.3, fc);
  }
  // meubles hauts / hotte : x local, sous-face à y0
  function wallUnits(L, y0, o = {}) {
    const fc = C(o.frontC || 0xe8e3da, 0.01), d = 0.35, y1 = H - 0.005, n = Math.max(1, Math.round(L / 0.6));
    walk(() => {
      box('lacquer', -L / 2, L / 2, y0, y1, -0.3, -0.3 + d - 0.02, C(0xe9e5dd));
      for (let i = 0; i < n; i++) { const x0 = -L / 2 + i * L / n + 0.0015, x1 = x0 + L / n - 0.003; rbb(o.front || 'lacquer', x0, x1, y0 + 0.0015, y1 - 0.0015, -0.3 + d - 0.02, -0.3 + d, 0.0015, fc, { seg: 1 }); }
      if (o.hood != null) { const hx = o.hood; box('steel', hx - 0.28, hx + 0.28, y0 - 0.002, y0, -0.28, -0.3 + d - 0.03, C(0x8e9295)); box('bulb', hx - 0.2, hx - 0.15, y0 - 0.003, y0 - 0.002, -0.05, 0.0); box('bulb', hx + 0.15, hx + 0.2, y0 - 0.003, y0 - 0.002, -0.05, 0.0); }
    });
  }
  function splash(L, y0, y1, mk = 'zellige') { box(mk, -L / 2, L / 2, y0, y1, -0.3, -0.292, C(0xffffff)); }
  // îlot : corps, façades côté cuisine, plan débordant côté séjour (+z) ; w selon x, d profondeur
  function island(w, d, o = {}) {
    const fc = C(o.frontC || 0xffffff, 0.01), fr = o.front || 'oak', over = o.over ?? 0.25, body = d - over;
    box('lacquer', -w / 2 + 0.02, w / 2 - 0.02, 0, 0.1, -d / 2 + 0.06, -d / 2 + body - 0.02, C(0x4a4744));
    rbb(fr, -w / 2, w / 2, 0.1, 0.87, -d / 2, -d / 2 + body, 0.003, fc);
    const n = Math.max(2, Math.round(w / 0.6)); for (let i = 1; i < n; i++) { const x = -w / 2 + i * w / n; box('lacquer', x - 0.0015, x + 0.0015, 0.1, 0.87, -d / 2 - 0.001, -d / 2 + 0.002, C(0x3a3836)); }
    for (let i = 0; i < n; i++) { const x = -w / 2 + (i + 0.5) * w / n; rbb('brass', x - 0.08, x + 0.08, 0.81, 0.822, -d / 2 - 0.018, -d / 2, 0.004); }
    slab(o.top || 'stone', w + 0.04, d, 0.04, 0.01, 0, 0.87, 0, C(o.topC || 0xffffff));
    contact(0, 0, w + 0.3, d + 0.3);
  }
  // vaisselle et objets de plan de travail
  function counterDecor(x, z, y, o = {}) {
    // planche à découper, bocaux, bouteille d'huile, plante aromatique
    rbb('oak', x - 0.2, x + 0.2, y, y + 0.022, z - 0.12, z + 0.08, 0.01, C(0xe6d6c4), { ry: 0.1 });
    for (let i = 0; i < 3; i++) { cyl('glassClear', 0.05, 0.05, 0.14 + i * 0.04, x + 0.32 + i * 0.11, y, z - 0.1, WHITE, { seg: 16 }); cyl('oak', 0.05, 0.05, 0.02, x + 0.32 + i * 0.11, y + 0.14 + i * 0.04, z - 0.1, C(0xf6eee4), { seg: 16 }); cyl('paper', 0.044, 0.044, 0.1 + i * 0.03, x + 0.32 + i * 0.11, y + 0.003, z - 0.1, C(pick([0xe8dcc0, 0x9c6a3a, 0xf3efe6])), { seg: 14 }); }
    lathe('glassBlack', [[0, 0], [0.03, 0], [0.03, 0.18], [0.012, 0.22], [0.012, 0.26], [0, 0.26]], x - 0.32, y, z - 0.15, C(0x4a3a1a), { seg: 14 });
    pot(x - 0.45, z - 0.1, 0.06, 0.1, 0xe9e2d6, 1);
    walk(() => { for (let i = 0; i < 9; i++) leafCard([x - 0.45 + jit(0.05), y + 0.09, z - 0.1 + jit(0.05)], 0.1 + R() * 0.05, R() * 6.3, 0.3 + R() * 0.6, 'olive', C(0x7f9a5a, 0.2)); });
  }
  function dishes(x, z, y) { for (let i = 0; i < 4; i++) cyl('ceramic', 0.12, 0.13, 0.014, x, y + i * 0.016, z, C(0xf2eee6), { seg: 30 }); for (let i = 0; i < 3; i++) lathe('stoneware', [[0, 0], [0.035, 0], [0.045, 0.09], [0.04, 0.09], [0, 0.01]], x + 0.24 + i * 0.1, y, z + jit(0.02), C(pick([0xc4754e, 0xe8e0d2, 0x6b7a8a]), 0.05), { seg: 16 }); }

  // ------------------------------------------------------------ salle de bains
  function vanity(w, o = {}) {
    const oak = C(0xf6eee4, 0.03), d = 0.48, y0 = 0.42, y1 = 0.82;
    rbb('oak', -w / 2, w / 2, y0, y1, 0, d - 0.02, 0.004, oak);
    rbb('oak', -w / 2 + 0.003, w / 2 - 0.003, y0 + 0.003, y1 - 0.003, d - 0.02, d, 0.002, oak);
    box('oak', -w / 2 + 0.01, w / 2 - 0.01, (y0 + y1) / 2 - 0.0015, (y0 + y1) / 2 + 0.0015, d - 0.001, d + 0.0005, C(0x6a4a30));
    slab('travertine', w + 0.01, d + 0.01, 0.025, 0.006, 0, y1, d / 2, C(0xffffff));
    const bx = o.basinX || 0;
    const br = Math.min(0.19, w * 0.3); lathe('ceramic', [[0, 0.004], [br * 0.6, 0.006], [br * 0.92, 0.045], [br, 0.13], [br - 0.006, 0.138], [br * 0.88, 0.06], [br * 0.5, 0.03], [0, 0.026]], bx, y1 + 0.025, d / 2 - 0.02, C(0xf6f4ef), { seg: 40 }); cyl('steel', 0.02, 0.02, 0.003, bx, y1 + 0.052, d / 2 - 0.02, C(0x8a8d90), { seg: 16 });
    // robinet mural noir mat
    walk(() => { tube('black', [[bx, y1 + 0.32, 0], [bx, y1 + 0.32, 0.14]], 0.011, WHITE, { seg: 3, rad: 8 }); cyl('black', 0.03, 0.03, 0.012, bx, y1 + 0.32, 0.0, WHITE, { rx: Math.PI / 2, seg: 16 }); cyl('black', 0.008, 0.008, 0.06, bx + 0.12, y1 + 0.32, 0.0, WHITE, { rx: Math.PI / 2, seg: 8 }); });
    // flacons, porte-savon, serviette roulée
    cyl('stoneware', 0.028, 0.028, 0.13, w / 2 - 0.1, y1 + 0.025, 0.12, C(0x8e6a4a)); cyl('black', 0.008, 0.008, 0.03, w / 2 - 0.1, y1 + 0.155, 0.12);
    cyl('ceramic', 0.03, 0.03, 0.1, w / 2 - 0.17, y1 + 0.025, 0.09, C(0xe9e2d6));
    if (w > 0.7) { const ty = y1 + 0.025; for (let i = 0; i < 2; i++) cyl('textile', 0.05, 0.05, 0.2, -w / 2 + 0.15, ty + 0.05, 0.2 - i * 0.1, C(PAL.linenOat), { rz: Math.PI / 2, seg: 16 }); }
    contact(0, d / 2, w + 0.1, d + 0.1);
  }
  function wc() {
    sq('ceramic', 0.18, 0.16, 0.27, 0, 0.4 - 0.02, 0.29, C(0xf6f4ef), { e1: 0.45, e2: 0.55, nu: 24, nv: 12 });
    sq('ceramic', 0.185, 0.015, 0.27, 0, 0.555, 0.29, C(0xf6f4ef), { e1: 0.3, e2: 0.55, nu: 24, nv: 6 });
    rbb('ceramic', -0.15, 0.15, 0.3, 0.5, 0, 0.06, 0.02, C(0xf6f4ef));
    walk(() => { rbb('ceramic', -0.11, 0.11, 0.97, 1.12, 0, 0.007, 0.004, C(0xf4f2ee)); cyl('brass', 0.03, 0.03, 0.006, -0.045, 1.045, 0.007, WHITE, { rx: Math.PI / 2, seg: 20 }); cyl('brass', 0.03, 0.03, 0.006, 0.045, 1.045, 0.007, WHITE, { rx: Math.PI / 2, seg: 20 }); });
    contact(0, 0.28, 0.5, 0.65);
  }
  // sèche-serviettes échelle noir mat (sur mur z = 0 local), avec serviettes
  function towelRail(w = 0.5, h = 1.2, y0 = 0.25, col = PAL.linenOat) {
    walk(() => {
      for (const s of [-1, 1]) cyl('black', 0.014, 0.014, h, s * w / 2, y0, 0.05, WHITE, { seg: 10 });
      for (let y = y0 + 0.08; y < y0 + h - 0.02; y += 0.11) cyl('black', 0.009, 0.009, w, -w / 2, y, 0.05, WHITE, { rz: -Math.PI / 2, seg: 8 });
      const ty = y0 + h - 0.12; sheet('cloth', 12, 16, (u, v) => { const x = (u - 0.5) * (w - 0.06); const t = v * 1.0; const y = t < 0.5 ? ty - (0.5 - t) * 0.9 : ty - (t - 0.5) * 0.9; const z = 0.05 + (t < 0.5 ? 0.025 : -0.025) + 0.006 * Math.sin(u * 15); return [x, y, z]; }, C(col));
    });
  }
  // paroi de douche fixe : verre clair + profilés noirs, de (x0, z) à (x1, z) local, hauteur h
  function glassPanel(x0, x1, z, y0 = 0.02, h = 2.0) {
    walk(() => {
      box('glassClear', x0, x1, y0, y0 + h, z - 0.004, z + 0.004);
      box('black', x0, x1, y0 + h - 0.02, y0 + h, z - 0.012, z + 0.012); box('black', x0, x0 + 0.02, y0, y0 + h, z - 0.012, z + 0.012);
    });
    P.planOnly(() => box('black', x0, x1, 0, CUT - 0.02, z - 0.006, z + 0.006));
  }
  function showerHead(x, z, y = 2.15) { walk(() => { tube('black', [[x, y + 0.2, z - 0.35], [x, y + 0.2, z]], 0.01, WHITE, { seg: 2, rad: 8 }); cyl('black', 0.12, 0.12, 0.012, x, y + 0.19, z, WHITE, { seg: 32 }); cyl('black', 0.03, 0.03, 0.012, x, 1.05, z - 0.35, WHITE, { rx: Math.PI / 2, seg: 16 }); rbb('black', x - 0.05, x + 0.05, 0.95, 1.15, z - 0.35, z - 0.33, 0.01); }); }
  // carrelage zellige sur un mur : rectangle (x0..x1, y0..y1) au plan z (local), épaisseur 8 mm
  function tileWall(x0, x1, y0, y1, z) { walk(() => box('zellige', x0, x1, y0, y1, z, z + 0.008, C(0xffffff))); }


  // baignoire encastrée : tablier en zellige, rebord en travertin, cuve émaillée (ouverte)
  function bathTub(L = 1.7, W = 0.75) {
    const h = 0.55, rim = 0.07;
    box('zellige', -L / 2, L / 2, 0.06, h - 0.03, W / 2 - 0.01, W / 2, C(0xffffff));
    box('lacquer', -L / 2, L / 2, 0, 0.06, -W / 2, W / 2 - 0.04, C(0x4a4744));
    for (const [x0, x1, z0, z1] of [[-L / 2, L / 2, -W / 2, -W / 2 + rim], [-L / 2, L / 2, W / 2 - rim, W / 2 + 0.01], [-L / 2, -L / 2 + rim, -W / 2 + rim, W / 2 - rim], [L / 2 - rim, L / 2, -W / 2 + rim, W / 2 - rim]]) box('travertine', x0, x1, h - 0.03, h, z0, z1, WHITE);
    const ix0 = -L / 2 + rim, ix1 = L / 2 - rim, iz0 = -W / 2 + rim, iz1 = W / 2 - rim, yb = 0.12, ce = C(0xf6f4ef);
    box('ceramic', ix0, ix1, yb, yb + 0.01, iz0, iz1, ce);
    box('ceramic', ix0, ix0 + 0.01, yb, h - 0.03, iz0, iz1, ce); box('ceramic', ix1 - 0.01, ix1, yb, h - 0.03, iz0, iz1, ce);
    box('ceramic', ix0, ix1, yb, h - 0.03, iz0, iz0 + 0.01, ce); box('ceramic', ix0, ix1, yb, h - 0.03, iz1 - 0.01, iz1, ce);
    cyl('steel', 0.025, 0.025, 0.004, L / 2 - 0.2, yb + 0.01, 0, C(0x55585a));
    // mitigeur de bain sur le rebord, côté mur
    cyl('black', 0.02, 0.02, 0.06, -L / 2 + 0.25, h, -W / 2 + 0.035, WHITE, { seg: 12 });
    tube('black', [[-L / 2 + 0.25, h + 0.05, -W / 2 + 0.035], [-L / 2 + 0.25, h + 0.1, -W / 2 + 0.09], [-L / 2 + 0.25, h + 0.07, -W / 2 + 0.14]], 0.01, WHITE, { seg: 10 });
    // serviette pliée et savon sur le rebord, bouquet d'eucalyptus
    foldedThrow(L / 2 - 0.2, h, -W / 2 + 0.035, 0.28, 0.06, C(PAL.linenOat));
    const vh = vase(L / 2 - 0.035, h, W / 2 - 0.035, 2, 0x3d3a36); branches(L / 2 - 0.035, h + vh, W / 2 - 0.035, 0.35, 4);
  }
  // console d'entrée : plateau chêne sur cadre en métal noir, lampe, vide-poche, livres
  function consoleTable(w = 1.1, d = 0.32) {
    const h = 0.8; slab('oak', w, d, 0.03, 0.01, 0, h - 0.03, 0, C(0xf6eee4));
    for (const s of [-1, 1]) { box('black', s * (w / 2 - 0.04) - 0.008, s * (w / 2 - 0.04) + 0.008, 0, h - 0.03, -d / 2 + 0.03, -d / 2 + 0.046); box('black', s * (w / 2 - 0.04) - 0.008, s * (w / 2 - 0.04) + 0.008, 0, h - 0.03, d / 2 - 0.046, d / 2 - 0.03); box('black', s * (w / 2 - 0.04) - 0.008, s * (w / 2 - 0.04) + 0.008, 0.12, 0.136, -d / 2 + 0.03, d / 2 - 0.03); }
    slab('oak', w - 0.1, d - 0.06, 0.02, 0.005, 0, 0.136, 0, C(0xf6eee4));
    for (let i = 0; i < 2; i++) sq('cloth', 0.14, 0.09, 0.1, -w / 2 + 0.22 + i * 0.32, 0.156 + 0.09, 0, C(pick([0xcdb487, 0xb9b2a6])), { e1: 0.4, e2: 0.25, nu: 16, nv: 10 });
    tableLamp(w / 2 - 0.2, h, -0.03, 1);
    bowl(-0.05, h, 0.02, 0.1, 0x3d3a36);
    bookStack(-w / 2 + 0.22, h, 0.0, 2, 0.2, true);
    contact(0, 0, w + 0.2, d + 0.2);
  }
  // dressing ouvert : montants chêne, penderie, étagères, piles de linge, boîtes
  function dressing(L, d = 0.55) {
    const oak = C(0xf6eee4, 0.03), n = Math.max(2, Math.round(L / 0.8));
    walk(() => {
      for (let i = 0; i <= n; i++) { const x = -L / 2 + i * L / n; box('oak', x - 0.012, x + 0.012, 0, H - 0.01, 0, d, oak); }
      for (let i = 0; i < n; i++) {
        const x0 = -L / 2 + i * L / n + 0.012, x1 = x0 + L / n - 0.024;
        box('oak', x0, x1, H - 0.32, H - 0.3, 0, d, oak); box('oak', x0, x1, 0.05, 0.07, 0, d, oak);
        if (i % 2 === 0) {
          tube('steel', [[x0, H - 0.4, d / 2], [x1, H - 0.4, d / 2]], 0.01, C(0x2a2a2a), { seg: 2 });
          for (let x = x0 + 0.06; x < x1 - 0.04; x += 0.05 + R() * 0.03) sq('cloth', 0.012, 0.42 + R() * 0.3, 0.2, x, H - 0.45 - 0.35, d / 2, C(pick([0xe8e2d6, 0x3d3a36, 0xc8bba5, 0x5f6b72, 0xb8684a, 0xf3efe8, 0x7d8a6c]), 0.05), { e1: 0.4, e2: 0.3, nu: 8, nv: 10 });
        } else for (let y = 0.07; y < H - 0.5; y += 0.36) { box('oak', x0, x1, y + 0.34, y + 0.36, 0, d, oak); for (let x = x0 + 0.02; x < x1 - 0.2; x += 0.24) { let yy = y + 0.36; for (let k = 0; k < 4; k++) { const t = 0.04 + R() * 0.02; rbb('cloth', x, x + 0.22, yy, yy + t, 0.08, d - 0.05, 0.015, C(pick([0xe8e2d6, 0xc8bba5, 0x9aa3a8, 0xf3efe8, 0xd9b99a]), 0.05)); yy += t; } } }
      }
    });
    tallPlan('oak', -L / 2, L / 2, 0, d, oak);
  }

  return {
    bathTub, consoleTable, dressing,
    R, C, PAL, WHITE, box, rb, rbb, cyl, lathe, tube, torus, sq, sheet, slab, disc, contact, walk, at,
    book, bookStack, bookRow, vase, branches, bowl, candle, tray, fruitBowl, leafCard, pot, figTree, oliveTree, snakePlant,
    tableLamp, floorLamp, akari, dome, pillow, rugF, plaidOverArm, foldedThrow,
    sofa, armchair, chair, barStool, coffeeTable, sideTable, roundTable, rectTable, tableDecor, sideboard, wardrobe, wallShelf, bench, desk, nightstand, bed,
    art, roundMirror, rectMirror, pegRail, sheers, drapes,
    baseRun, tallUnit, wallUnits, splash, island, counterDecor, dishes,
    vanity, wc, towelRail, glassPanel, showerHead, tileWall, tallPlan,
  };
}

// ================================================================== aménagement des deux lots d'un étage courant
// Coordonnées absolues (m) issues du plan de lots.js (planUpper). yaw des meubles : 0 = façade vers +z.
const PI = Math.PI;
export function furnishUpper(THREE, P, D, o = {}) {
  const { PAL, C, at, walk } = D, ART = { arcs: 0, line: 1, dune: 2, enso: 3, leaf: 4, blocks: 5, sea: 6, sketch: 7 };
  const suite = !!o.suite;
  const face = (x, z, ry, fn) => at(x, z, ry, fn);          // objets muraux : dos au plan du mur

  // ======================= LOT A (côté rue) — « Japandi sable » : chêne, lin sable, sauge, terracotta
  // --- séjour : salon face à la baie, coin repas rond, îlot
  at(3.35, -4.45, 0, () => D.rugF(2.0, 1.8, 'rug'));
  at(3.35, -5.37, 0, () => D.sofa(2.4, { col: PAL.linenSand, pillows: [PAL.terracotta, PAL.linenOat, PAL.ochre, PAL.sage], plaid: PAL.rust }));
  at(3.35, -4.22, 0, () => D.coffeeTable({ w: 1.1, d: 0.6 }));
  at(2.25, -3.15, 2.2, () => D.armchair({ pillow: PAL.ochre }));
  D.floorLamp(4.88, -5.55);
  D.oliveTree(5.15, -2.42, 1.85);
  D.figTree(-0.52, -1.97, 1.7, 0xd9cfbf);
  face(3.35, -5.86, 0, () => D.art(0, 1.55, 1.1, 0.8, ART.arcs));
  D.sheers(0.82, 1.45, -1.74, { r0: 0.8, r1: 5.2 });
  D.sheers(4.55, 5.18, -1.74, { r0: 0, r1: 0 });
  // coin repas
  at(0.75, -2.85, 0, () => {
    D.roundTable(0.6);
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { const px = sx * 0.53, pz = sz * 0.53; at(px, pz, Math.atan2(-px, -pz), () => D.chair({ seat: PAL.straw })); }
    D.tableDecor(0, 0);
  });
  D.akari(0.75, -2.85, 1.52, 0.3, 0.42);
  at(-0.715, -3.05, PI / 2, () => D.sideboard(1.4, 0.42, 0.7));
  face(-0.93, -3.05, PI / 2, () => { D.art(-0.3, 1.55, 0.5, 0.7, ART.leaf, { frame: 'oak' }); D.art(0.32, 1.55, 0.5, 0.7, ART.blocks, { frame: 'black' }); });
  // cuisine en L (façades laquées sauge, plan quartzite, crédence zellige, colonnes blanc chaud)
  at(-0.63, -6.13, PI / 2, () => {
    D.baseRun(1.66, [{ w: 0.6, t: 'drawers', hob: true }, { w: 0.46, t: 'door' }, { w: 0.6, t: 'door', sink: true, sinkW: 0.5 }], { front: 'lacquer', frontC: 0xa3ab95, top: 'stone' });
    D.splash(1.66, 0.9, 1.52);
    walk(() => {
      // hotte casquette laquée au-dessus de la plaque, étagères en chêne ailleurs
      D.box('lacquer', -0.83, -0.23, 1.62, P.H - 0.005, -0.3, 0.12, C(0xe8e3da)); D.box('steel', -0.81, -0.25, 1.618, 1.62, -0.28, 0.1, C(0x8e9295));
      D.box('bulb', -0.6, -0.5, 1.616, 1.618, -0.05, 0.02);
      D.at(0.3, -0.3, 0, () => { D.wallShelf(1.06, 1.62, 0.24, { objects: false }); D.wallShelf(1.06, 1.98, 0.24, { objects: false }); });
      D.dishes(0.05, -0.18, 1.65); D.vase(0.55, 1.65, -0.18, 1, 0xc4754e); D.bowl(0.3, 2.01, -0.18, 0.09, 0xe8e0d2); D.vase(0.6, 2.01, -0.18, 0, 0xd9cfbf); D.bookRow(-0.2, 0.15, 2.01, -0.18, 0);
    });
    D.rbb('oak', -0.1, 0.25, 0.9, 0.922, -0.25, -0.02, 0.01, C(0xe6d6c4), { ry: 0.08 });
    for (let i = 0; i < 3; i++) { D.cyl('glassClear', 0.045, 0.045, 0.13 + i * 0.04, 0.28 + 0 * i, 0.9, -0.24 + i * 0.0, D.WHITE, { seg: 14 }); }
  });
  at(-0.33, -7.26, 0, () => { at(-0.3, 0, 0, () => D.tallUnit(0.6, 'oven')); at(0.3, 0, 0, () => D.tallUnit(0.6, 'fridge')); });
  at(1.15, -4.9, 0, () => {
    D.island(1.4, 0.95, { front: 'oak', over: 0.25, top: 'stone' });
    for (const x of [-0.33, 0.33]) at(x, 0.62, PI, () => D.barStool({ seat: PAL.cognac }));
    D.fruitBowl(-0.25, 0.91, -0.1); const vh = D.vase(0.35, 0.91, -0.1, 0, 0xe8dfd0); D.branches(0.35, 0.91 + vh, -0.1, 0.5, 5);
  });
  D.dome(0.85, -4.9, 1.68); D.dome(1.45, -4.9, 1.68);
  // --- chambre 1 / suite : lit face à la baie, banc, armoire, rideaux de lin
  {
    const w = suite ? 1.8 : 1.6, bx = suite ? -4.1 : -4.05, off = w / 2 + 0.1 + 0.24;
    at(bx, -2.55, 0, () => D.rugF(2.3, 1.7, 'wool', C(0xe7dfd0), false));
    at(bx, -3.96, 0, () => D.bed(w, 2.0, { head: PAL.linenGreige, duvet: PAL.linenWhite, accent: PAL.terracotta, throw: PAL.ochre }));
    at(bx - off, -3.75, 0, () => D.nightstand({ lampC: 0xc4754e }));
    at(bx + off, -3.75, 0, () => D.nightstand({ lampC: 0xc4754e, cup: true }));
    face(bx, -3.96, 0, () => D.art(0, 1.62, 0.9, 0.6, ART.line));
    at(bx, -1.62, 0, () => D.bench(1.2, 0.38, { throw: PAL.sage }));
    at(-1.31, -2.5, -PI / 2, () => D.wardrobe(1.6, 0.6, { col: 0xe9e4da }));
    D.drapes(-4.75, -4.18, -0.53, C(PAL.linenOat)); D.drapes(-1.6, -1.06, -0.53, C(PAL.linenOat));
    walk(() => D.box('black', -4.8, -1.03, P.H - 0.03, P.H - 0.002, -0.545, -0.515));
    D.snakePlant(-5.2, -0.85, 0.8, 0xe7dfd1);
  }
  // --- chambre 2 : lit contre le mur du fond, bureau sous étagère
  at(-4.3, -6.2, 0, () => D.rugF(1.7, 1.2, 'wool', C(0xd9d2c6), false));
  at(-4.3, -7.475, 0, () => D.bed(1.4, 2.0, { head: PAL.sage, duvet: PAL.linenWhite, pillow2: PAL.linenSand, accent: PAL.ochre, throw: PAL.linenStone }));
  at(-5.34, -7.265, 0, () => D.nightstand({ lamp: false }));
  at(-3.26, -7.265, 0, () => D.nightstand({ lampKind: 1 }));
  face(-4.3, -7.475, 0, () => D.art(0, 1.6, 0.6, 0.8, ART.sketch, { frame: 'black' }));
  at(-4.95, -4.32, PI, () => D.desk(1.1, 0.55));
  at(-4.95, -4.98, 0, () => D.chair({ seat: PAL.linenGreige }));
  face(-4.95, -4.04, PI, () => { walk(() => D.wallShelf(1.0, 1.28, 0.22)); D.art(0.2, 1.78, 0.4, 0.5, ART.enso); });
  // --- chambre 3 : lit tête au mur du séjour, armoire au fond
  at(3.45, -7.0, 0, () => D.rugF(1.8, 1.3, 'wool', C(0xe2d9c9), false));
  at(3.45, -5.94, PI, () => D.bed(1.4, 2.0, { head: PAL.linenOat, duvet: PAL.linenWhite, pillow2: PAL.linenGreige, accent: PAL.sage, throw: PAL.terracotta }));
  at(2.41, -6.15, PI, () => D.nightstand({}));
  at(4.49, -6.15, PI, () => D.nightstand({ lampKind: 1, books: false, cup: true }));
  face(3.45, -5.94, PI, () => D.art(0, 1.6, 0.8, 0.55, ART.dune));
  at(3.7, -8.985, 0, () => D.wardrobe(1.2, 0.58, { col: 0xe9e4da }));
  D.snakePlant(4.95, -6.75, 0.7, 0xb8684a);
  // --- salle de bains : baignoire encastrée, vasque sur meuble chêne, sèche-serviettes
  at(-1.96, -7.1, 0, () => D.bathTub(1.7, 0.75));
  at(-1.96, -7.475, 0, () => { D.tileWall(-0.85, 0.85, 0.55, 2.1, 0); D.showerHead(-0.55, 0.35, 1.95); });
  at(-2.81, -7.1, PI / 2, () => D.tileWall(-0.375, 0.375, 0.55, 2.1, 0));
  at(-2.4, -6.725, 0, () => D.glassPanel(-0.41, 0.35, 0.0, 0.55, 1.5));
  at(-1.01, -6.25, -PI / 2, () => { D.vanity(0.8); D.rectMirror(0, 1.62, 0.7, 0.8); });
  at(-2.81, -5.75, PI / 2, () => D.towelRail(0.5, 1.1, 0.3, PAL.linenOat));
  at(-1.95, -6.3, 0, () => D.rugF(0.8, 0.5, 'wool', C(0xe9e2d6), false));
  // --- salle d'eau · WC
  D.box('travertine', -1.275, -0.375, 0, 0.03, -9.275, -8.375, D.WHITE);
  at(-0.825, -9.275, 0, () => { D.tileWall(-0.45, 0.45, 0.03, 2.1, 0); D.showerHead(0, 0.35); });
  at(-1.275, -8.825, PI / 2, () => D.tileWall(-0.45, 0.45, 0.03, 2.1, 0));
  at(-0.375, -8.94, PI / 2, () => D.glassPanel(-0.335, 0.3, 0, 0.03, 1.95));
  at(0.12, -9.275, 0, () => D.wc());
  at(-0.9, -7.64, PI, () => { D.vanity(0.6); D.roundMirror(0, 1.62, 0.28); });
  // --- entrée
  at(1.93, -7.95, -PI / 2, () => D.bench(0.6, 0.34, { cushion: PAL.linenGreige }));
  face(2.11, -7.95, -PI / 2, () => D.pegRail(0.6, 1.72, 3, { coat: PAL.charcoal, bag: PAL.linenOat }));
  face(0.55, -9.0, PI / 2, () => D.roundMirror(0, 1.55, 0.2));
  D.akari(1.33, -8.45, 1.95, 0.2, 0.3);

  // ======================= LOT B (côté jardin) — « Travertin & terracotta » : chêne, greige, terracotta, encre
  // --- cuisine linéaire + îlot, coin repas, salon tourné vers la loggia
  at(3.355, -9.825, PI, () => {
    D.baseRun(2.05, [{ w: 0.8, t: 'drawers', hob: true }, { w: 0.45, t: 'door' }, { w: 0.8, t: 'drawers2', sink: true, sinkW: 0.55 }], { front: 'oak', top: 'travertine', handleMk: 'black', tap: 'brass' });
    D.splash(2.05, 0.9, 1.45);
    D.wallUnits(2.05, 1.45, { hood: -0.625, frontC: 0xd8d0c4 });
    D.dishes(-0.1, -0.15, 0.9); D.fruitBowl(0.55, 0.9, -0.05);
  });
  at(4.98, -9.825, PI, () => { at(-0.3, 0, 0, () => D.tallUnit(0.6, 'fridge', { frontC: 0xd8d0c4, handleMk: 'black' })); at(0.3, 0, 0, () => D.tallUnit(0.6, 'oven', { frontC: 0xd8d0c4, handleMk: 'black' })); });
  at(3.8, -11.4, PI, () => { D.island(1.8, 0.9, { front: 'oak', over: 0.2, top: 'travertine' }); const vh = D.vase(-0.4, 0.91, 0.1, 0, 0xb8684a); D.branches(-0.4, 0.91 + vh, 0.1, 0.5, 5); D.bookStack(0.3, 0.91, 0.12, 2, 0.2, true); });
  D.dome(3.35, -11.4, 1.7); D.dome(4.25, -11.4, 1.7);
  at(3.5, -13.75, 0, () => {
    D.rectTable(1.6, 0.9);
    for (const x of [-0.4, 0.4]) { at(x, 0.68, PI, () => D.chair({ seat: PAL.linenGreige })); at(x, -0.68, 0, () => D.chair({ seat: PAL.linenGreige })); }
    D.tableDecor(0, 0);
  });
  D.akari(3.5, -13.75, 1.5, 0.34, 0.36);
  at(3.1, -16.4, PI / 2, () => D.rugF(2.4, 1.9, 'rug'));
  at(1.86, -16.4, PI / 2, () => D.sofa(2.4, { col: PAL.linenGreige, pillows: [PAL.rust, PAL.linenWhite, PAL.ink, PAL.clay], plaid: PAL.linenOat }));
  at(3.15, -16.4, PI / 2, () => D.coffeeTable({ w: 1.1, d: 0.6 }));
  at(3.95, -17.95, -0.55, () => D.armchair({ mk: 'textile', col: PAL.terracotta }));
  D.floorLamp(1.75, -17.98);
  D.sideTable(1.66, -14.95, { lamp: true });
  D.oliveTree(5.15, -18.15, 1.85, 0xb9b2a6);
  D.figTree(5.18, -14.95, 1.65, 0xb8684a);
  at(5.355, -13.2, -PI / 2, () => D.sideboard(1.6, 0.44, 0.7));
  face(5.58, -13.2, -PI / 2, () => D.art(0, 1.55, 1.0, 0.72, ART.sea, { frame: 'black', mat: 0.08 }));
  face(1.38, -16.4, PI / 2, () => D.art(0, 1.55, 1.2, 0.8, ART.dune));
  // --- chambre 1 : lit tête au mur du dégagement, fauteuil de lecture
  at(-3.95, -17.1, 0, () => D.rugF(2.2, 1.5, 'wool', C(0xd9d2c6), false));
  at(-3.95, -15.95, PI, () => D.bed(1.6, 2.0, { head: PAL.ink, duvet: PAL.linenWhite, pillow2: PAL.linenStone, accent: PAL.rust, throw: PAL.linenSand }));
  at(-5.09, -16.16, PI, () => D.nightstand({ lampC: 0x3d3a36 }));
  at(-2.81, -16.16, PI, () => D.nightstand({ lampC: 0x3d3a36, cup: true }));
  face(-3.95, -15.95, PI, () => D.art(0, 1.62, 0.7, 0.7, ART.enso));
  at(-1.35, -17.85, -1.07, () => D.armchair({ pillow: PAL.rust }));
  D.snakePlant(-1.05, -18.3, 0.75, 0x3d3a36);
  // --- chambre 2 : lit, bureau sous la fenêtre, armoire
  at(-4.15, -12.7, 0, () => D.rugF(1.7, 1.2, 'wool', C(0xe2d9c9), false));
  at(-4.15, -11.525, PI, () => D.bed(1.4, 2.0, { head: PAL.linenSand, duvet: PAL.linenWhite, pillow2: PAL.linenOat, accent: PAL.sage, throw: PAL.clay }));
  at(-5.19, -11.735, PI, () => D.nightstand({ lamp: false }));
  at(-3.11, -11.735, PI, () => D.nightstand({ lampKind: 1 }));
  face(-4.15, -11.525, PI, () => D.art(0, 1.6, 0.55, 0.75, ART.leaf));
  at(-3.375, -15.58, 0, () => D.wardrobe(1.45, 0.58, { col: 0xe4ddd1 }));
  at(-5.305, -14.6, PI / 2, () => D.desk(1.1, 0.55));
  at(-4.75, -14.6, -PI / 2, () => D.chair({ seat: PAL.terracotta }));
  // --- salle d'eau : douche à l'italienne, vasque, sèche-serviettes
  D.box('travertine', 0.4, 1.3, 0, 0.025, -15.87, -14.97, D.WHITE);
  at(0.85, -15.87, 0, () => { D.tileWall(-0.45, 0.45, 0.025, 2.1, 0); D.showerHead(0, 0.35); });
  at(1.3, -15.42, -PI / 2, () => D.tileWall(-0.45, 0.45, 0.025, 2.1, 0));
  at(0.4, -15.535, PI / 2, () => D.glassPanel(-0.335, 0.3, 0, 0.025, 1.95));
  at(-0.42, -14.9, PI / 2, () => { D.vanity(0.8); D.rectMirror(0, 1.62, 0.6, 0.8, 'oak'); });
  at(1.3, -14.55, -PI / 2, () => D.towelRail(0.45, 1.0, 0.35, PAL.clay));
  // --- WC
  at(-1.02, -15.87, 0, () => D.wc());
  face(-1.02, -15.87, 0, () => D.art(0, 1.5, 0.3, 0.4, ART.sketch, { frame: 'black' }));
  // --- entrée : placard, console et miroir, banc et patères
  at(-1.2, -11.775, PI, () => D.wardrobe(1.8, 0.5, { col: 0xe9e4da }));
  at(-0.85, -13.74, 0, () => D.consoleTable(1.1, 0.32));
  face(-0.85, -13.9, 0, () => D.roundMirror(0, 1.55, 0.36));
  at(-2.33, -13.0, PI / 2, () => D.bench(0.9, 0.36, { cushion: PAL.linenSand }));
  face(-2.52, -13.0, PI / 2, () => D.pegRail(0.9, 1.72, 4, { coat: PAL.ink, bag: PAL.linenOat }));
  D.akari(-0.6, -12.75, 1.95, 0.22, 0.32);
  // --- dressing
  at(1.3, -17.3, -PI / 2, () => D.dressing(2.4, 0.55));
}
