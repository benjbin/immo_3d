// Canopée — decortex.js
// Aléatoire, bruit périodique et textures peintes de la décoration (decor.js), sans dépendance à three.js ni
// au DOM : chargeable par les workers de texpool.js, qui calculent les DECOR_TASKS en parallèle dès l'ouverture
// de la maquette. decor.js reprend leurs pixels (texcache.js) ou exécute la tâche sur place : mêmes pixels.

// ------------------------------------------------------------------ aléatoire & bruit périodique
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const hash2 = (i, j, s) => { let h = (i * 374761393 + j * 668265263 + s * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
// bruit de valeur périodique (px × py cellules)
export function pn(x, y, px, py, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y); let tx = x - xi, ty = y - yi;
  tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
  // modulo positif écrit en ligne (une fermeture créée à chaque appel coûtait ~0,2 s au chargement)
  const x0 = ((xi % px) + px) % px, x1 = (((xi + 1) % px) + px) % px, y0 = ((yi % py) + py) % py, y1 = (((yi + 1) % py) + py) % py;
  const a = hash2(x0, y0, s), b = hash2(x1, y0, s), c = hash2(x0, y1, s), d = hash2(x1, y1, s);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}
// fbm périodique : u, v ∈ [0, 1) sur la tuile
export function fbmP(u, v, px, py, oct = 4, s = 0) {
  let t = 0, a = 0.5, n = 0;
  for (let k = 0; k < oct; k++) { t += a * pn(u * px, v * py, px, py, s + k * 17); n += a; px *= 2; py *= 2; a *= 0.5; }
  return t / n;
}
export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);

// pixels d'une texture peinte : f(u, v, o) écrit o = [r, g, b (0–255), hauteur, rugosité 0–1 (défaut 200/255)] ;
// couleur et rugosité en RGBA (ce que paint() met en canvas), hauteur en flottants
export function paintData(w, h, f) {
  const d = new Uint8ClampedArray(w * h * 4), hgt = new Float32Array(w * h), rough = new Uint8ClampedArray(w * h);
  const out = [0, 0, 0, 0, 0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    out[3] = 0; out[4] = -1;
    f((x + 0.5) / w, (y + 0.5) / h, out);
    const o = (y * w + x) * 4; d[o] = out[0]; d[o + 1] = out[1]; d[o + 2] = out[2]; d[o + 3] = 255;
    hgt[y * w + x] = out[3]; rough[y * w + x] = out[4] < 0 ? 200 : out[4] * 255;
  }
  const rr = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { rr[i * 4] = rr[i * 4 + 1] = rr[i * 4 + 2] = rough[i]; rr[i * 4 + 3] = 255; }
  return { w, h, col: d, hgt, rough: rr };
}

export const DECOR_TASKS = {
  'deco:oak': () => paintData(1024, 256, (u, v, o) => {
    const w = fbmP(u, v, 3, 1, 3, 11), ring = v * 34 + w * 6 + fbmP(u, v, 24, 2, 2, 5) * 0.6;
    const g = 0.5 + 0.5 * Math.sin(ring * Math.PI * 2), fine = fbmP(u, v, 160, 6, 2, 9);
    const pore = fbmP(u, v, 220, 40, 1, 3) > 0.78 ? 1 : 0, ray = fbmP(u, v, 40, 90, 1, 21) > 0.86 ? 1 : 0;
    const l = 0.86 + 0.09 * g + 0.05 * fine - 0.08 * pore + 0.04 * ray + 0.05 * (w - 0.5);
    o[0] = 208 * l; o[1] = 172 * l; o[2] = 128 * l; o[3] = g * 0.4 + fine * 0.2 - pore * 0.6; o[4] = 0.6 + 0.12 * pore - 0.08 * g;
  }),
  'deco:linen': () => paintData(512, 512, (u, v, o) => {
    const wx = Math.sin(u * 512 * Math.PI * 0.5), wy = Math.sin(v * 512 * Math.PI * 0.5);
    const slubX = fbmP(u, v, 2, 64, 2, 3), slubY = fbmP(u, v, 64, 2, 2, 7);
    const h = (wx > 0 ? 0.5 + 0.5 * slubX : 0.5 + 0.5 * slubY) * (0.6 + 0.4 * Math.abs(wx * wy));
    const l = 0.86 + 0.08 * (slubX - 0.5) + 0.08 * (slubY - 0.5) + 0.06 * h + 0.03 * fbmP(u, v, 6, 6, 3, 1);
    o[0] = o[1] = o[2] = 236 * l; o[1] *= 0.995; o[2] *= 0.985; o[3] = h; o[4] = 0.95;
  }),
  'deco:boucle': () => {
    const R = rng(41), loops = new Float32Array(256 * 256);
    for (let k = 0; k < 2600; k++) {
      const cx = R() * 256, cy = R() * 256, r = 2.2 + R() * 2.6;
      for (let y = -6; y <= 6; y++) for (let x = -6; x <= 6; x++) { const d = Math.hypot(x, y); if (d > r + 1.2) continue; const v = Math.max(0, 1 - Math.abs(d - r * 0.7) / 1.3); const i = (((cy + y) | 0) & 255) * 256 + (((cx + x) | 0) & 255); loops[i] = Math.max(loops[i], v * (0.6 + 0.4 * R())); }
    }
    return paintData(256, 256, (u, v, o) => { const h = loops[((v * 256) | 0) * 256 + ((u * 256) | 0)]; const l = 0.9 + 0.08 * h + 0.03 * fbmP(u, v, 8, 8, 2, 3); o[0] = 240 * l; o[1] = 234 * l; o[2] = 222 * l; o[3] = h; o[4] = 1; });
  },
  'deco:rug': () => paintData(512, 512, (u, v, o) => {
    const tuft = fbmP(u, v, 96, 96, 2, 13), big = fbmP(u, v, 4, 4, 3, 2);
    const x = (u - 0.5) * 2, y = (v - 0.5) * 2, dia = Math.abs(Math.abs(x) + Math.abs(y) - 0.9), dia2 = Math.abs(Math.abs(x) + Math.abs(y) - 0.15);
    const wob = 0.025 * (fbmP(u, v, 12, 12, 2, 4) - 0.5);
    const line = (dia + wob < 0.035 || dia2 + wob < 0.03) ? 1 : 0;
    const l = 0.82 + 0.1 * tuft + 0.06 * (big - 0.5);
    if (line) { o[0] = 70 * l; o[1] = 60 * l; o[2] = 52 * l; } else { o[0] = 238 * l; o[1] = 230 * l; o[2] = 214 * l; }
    o[3] = tuft; o[4] = 1;
  }),
  'deco:wool': () => paintData(256, 256, (u, v, o) => { const t = fbmP(u, v, 48, 48, 3, 77); const l = 0.85 + 0.15 * t; o[0] = o[1] = o[2] = 235 * l; o[3] = t; o[4] = 1; }),
  'deco:jute': () => paintData(256, 256, (u, v, o) => {
    const n = 8, cu = Math.floor(u * n), cv = Math.floor(v * n), fu = (u * n) % 1, fv = (v * n) % 1, hor = (cu + cv) % 2 === 0;
    const across = hor ? fv : fu, along = hor ? fu : fv, k = (across * 3) % 1;
    const strand = Math.sin(k * Math.PI), fib = fbmP(u, v, hor ? 64 : 6, hor ? 6 : 64, 2, 23);
    const l = 0.7 + 0.22 * strand + 0.1 * (fib - 0.5) + 0.05 * Math.sin(along * Math.PI) + 0.04 * (fbmP(u, v, 3, 3, 2, 5) - 0.5);
    o[0] = 196 * l; o[1] = 168 * l; o[2] = 124 * l; o[3] = strand * 0.8 + fib * 0.2; o[4] = 0.95;
  }),
  'deco:cane': () => paintData(256, 256, (u, v, o) => {
    const f = (t) => Math.abs(((t % 1) + 1) % 1 - 0.5);
    const dh = f(v * 4), dv = f(u * 4), d1 = f((u + v) * 2), d2 = f((u - v) * 2 + 0.25);
    const w = 0.09, sH = dh < w, sV = dv < w, sD1 = d1 < w * 0.8, sD2 = d2 < w * 0.8, on = sH || sV || sD1 || sD2;
    const grain = fbmP(u, v, 40, 40, 2, 31);
    if (on) { const l = 0.88 + 0.1 * grain; o[0] = 222 * l; o[1] = 190 * l; o[2] = 138 * l; o[3] = 0.7; o[4] = 0.55; }
    else { o[0] = 58; o[1] = 46; o[2] = 36; o[3] = 0; o[4] = 0.9; }
  }),
  'deco:trav': () => paintData(1024, 1024, (u, v, o) => {
    const band = fbmP(u, v, 2, 14, 4, 31), w = fbmP(u, v, 6, 30, 3, 8);
    const pore = fbmP(u, v, 60, 260, 2, 19), pit = pore > 0.74 ? (pore - 0.74) / 0.26 : 0;
    const vein = Math.abs(Math.sin((v * 9 + band * 1.6) * Math.PI)) < 0.05 ? 0.05 : 0;
    const l = 0.84 + 0.1 * band + 0.05 * w - 0.35 * pit - vein;
    o[0] = 226 * l; o[1] = 208 * l; o[2] = 182 * l; o[3] = -pit * 1.5 + band * 0.2; o[4] = 0.45 + 0.4 * pit;
  }),
  'deco:qz': () => paintData(1024, 1024, (u, v, o) => {
    const n = fbmP(u, v, 3, 3, 5, 61), m = fbmP(u, v, 5, 5, 4, 62);
    const vein = Math.exp(-Math.abs(Math.sin((u * 2 + v * 1.2 + n * 1.8) * Math.PI * 2)) * 18) * 0.5 + Math.exp(-Math.abs(Math.sin((u * 3.1 - v * 2 + m * 2.2) * Math.PI * 2)) * 30) * 0.25;
    const l = 0.94 + 0.03 * n - 0.22 * vein;
    o[0] = 240 * l; o[1] = 236 * l; o[2] = 228 * l; o[3] = -0.6 * vein; o[4] = 0.22 + 0.08 * n + 0.2 * vein;
  }),
  'deco:zel': () => paintData(512, 512, (u, v, o) => {
    const N = 4, i = Math.floor(u * N), j = Math.floor(v * N), fu = u * N - i, fv = v * N - j;
    const e = Math.min(fu, fv, 1 - fu, 1 - fv), grout = e < 0.035;
    const tone = hash2(i, j, 5), wav = fbmP(u, v, 16, 16, 2, i * 7 + j);
    const edge = clamp(e / 0.12);
    const l = grout ? 0.72 : 0.88 + 0.1 * tone + 0.04 * wav - 0.06 * (1 - edge);
    o[0] = (grout ? 210 : 246) * l; o[1] = (grout ? 204 : 238) * l; o[2] = (grout ? 194 : 224) * l;
    o[3] = grout ? -0.6 : 0.4 * edge + 0.25 * wav; o[4] = grout ? 0.9 : 0.08 + 0.12 * wav;
  }),
  'deco:grain': () => paintData(256, 256, (u, v, o) => { const t = fbmP(u, v, 32, 32, 3, 91), s = hash2((u * 256) | 0, (v * 256) | 0, 3); const l = 0.9 + 0.06 * t + (s > 0.97 ? -0.15 : 0); o[0] = o[1] = o[2] = 240 * l; o[3] = t; o[4] = 0.75 + 0.15 * t; }),
  'deco:washi': () => paintData(256, 256, (u, v, o) => {
    const rib = Math.abs(Math.sin(v * Math.PI * 8)) < 0.06 ? 1 : 0, fib = fbmP(u, v, 40, 8, 3, 17);
    const l = 0.9 + 0.08 * fib - 0.25 * rib; o[0] = 250 * l; o[1] = 244 * l; o[2] = 230 * l; o[3] = rib; o[4] = 1;
  }),
};
