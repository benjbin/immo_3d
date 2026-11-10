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
  // lin lavé : toile (fil de 1,6 mm, 128 fils par répétition de 0,2 m). Ce qui se lit à 1–2 m n'est pas l'armure
  // mais l'irrégularité des fils : chaque fil a son ton et son épaisseur, avec des flammes (surépaisseurs claires).
  'deco:linen': () => {
    const S = 512, P = 4, N = S / P;
    return paintData(S, S, (u, v, o) => {
      const x = u * S / P, y = v * S / P, i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
      // fil de chaîne i (court le long de v), fil de trame j (le long de u) : ton propre + flammes
      const sw = pn(i, v * 5 + hash2(i, 1, 2) * 7, N, 5, 9), sf = pn(u * 5 + hash2(j, 3, 4) * 7, j, 5, N, 12);
      const flW = clamp((sw - 0.66) / 0.2), flF = clamp((sf - 0.66) / 0.2);
      const tW = 0.94 + 0.05 * hash2(i, 7, 3) + 0.06 * flW + 0.03 * (pn(i, v * 24, N, 24, 31) - 0.5);
      const tF = 0.94 + 0.05 * hash2(j, 11, 5) + 0.06 * flF + 0.03 * (pn(u * 24, j, 24, N, 33) - 0.5);
      const top = ((i + j) & 1) === 0, aW = Math.sin(Math.PI * fx), aF = Math.sin(Math.PI * fy);
      // relief : le fil du dessus bombe en travers et plonge aux croisements ; creux sombres entre quatre fils
      const h = top ? (0.45 + 0.55 * aW) * (0.7 + 0.3 * aF) * (1 + 0.5 * flW) : (0.45 + 0.55 * aF) * (0.7 + 0.3 * aW) * (1 + 0.5 * flF);
      const hole = Math.sqrt(aW * aF);
      const l = (top ? 0.68 * tW + 0.32 * tF : 0.68 * tF + 0.32 * tW) * (0.84 + 0.1 * Math.min(1, h) + 0.08 * hole);
      o[0] = 244 * l; o[1] = 242 * l; o[2] = 237 * l; o[3] = h; o[4] = 0.95;
    });
  },
  // bouclé fin chiné (tissu d'ameublement) : brins frisés de 1,5–2,5 mm jetés en tous sens, serrés par touffes ;
  // un brin sur cinq un ton plus soutenu (chiné), creux entre les brins assombris. Peu contrasté : 0,3 m.
  'deco:boucle': () => {
    const S = 512, R = rng(41), H = new Float32Array(S * S), Tn = new Float32Array(S * S);
    // fond feutré : les creux entre brins restent peu profonds (pas de piqué sombre)
    for (let i = 0; i < S * S; i++) H[i] = 0.34 + 0.2 * hash2(i % S, (i / S) | 0, 6);
    for (let k = 0; k < 15000; k++) {
      let x = R() * S, y = R() * S, a = R() * 6.2832;
      const cur = (R() - 0.5) * 1.3, len = 5 + ((R() * 9) | 0), r = 1.25 + R() * 0.9, r2 = r * r, rc = Math.ceil(r);
      const lvl = (0.55 + 0.45 * R()) * (0.78 + 0.44 * fbmP(x / S, y / S, 14, 14, 2, 5));
      const tone = R() < 0.16 ? -(0.03 + 0.045 * R()) : (R() - 0.5) * 0.045;
      for (let s = 0; s < len; s++) {
        const cx = Math.floor(x), cy = Math.floor(y);
        for (let dy = -rc; dy <= rc; dy++) for (let dx = -rc; dx <= rc; dx++) {
          const ex = cx + dx + 0.5 - x, ey = cy + dy + 0.5 - y, d2 = ex * ex + ey * ey; if (d2 >= r2) continue;
          const i = (((cy + dy) % S + S) % S) * S + (((cx + dx) % S + S) % S), h = lvl * (0.5 + 0.5 * Math.sqrt(1 - d2 / r2));
          if (h > H[i]) { H[i] = h; Tn[i] = tone; }
        }
        x += Math.cos(a); y += Math.sin(a); a += cur;
      }
    }
    // relief adouci (brins ronds, pas d'arêtes de pastilles)
    const B = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const xm = (x + S - 1) % S, xp = (x + 1) % S, ym = ((y + S - 1) % S) * S, yp = ((y + 1) % S) * S, yy = y * S;
      B[yy + x] = (H[yy + x] * 4 + (H[yy + xm] + H[yy + xp] + H[ym + x] + H[yp + x]) * 2 + H[ym + xm] + H[ym + xp] + H[yp + xm] + H[yp + xp]) / 16;
    }
    return paintData(S, S, (u, v, o) => {
      const i = ((v * S) | 0) * S + ((u * S) | 0), h = B[i], t = Tn[i];
      const l = 0.86 + 0.13 * Math.min(1, h * 1.2) + t + 0.065 * (fbmP(u, v, 16, 16, 2, 3) - 0.5);
      // brins chinés : à peine plus chauds que le fond écru
      const w = t < -0.03 ? 1 : 0;
      o[0] = 246 * l; o[1] = (241 - 1.5 * w) * l; o[2] = (233 - 5 * w) * l; o[3] = h; o[4] = 1;
    });
  },
  // velours ras : poil très fin, presque uni (le caractère vient du duvet rasant et du sens du poil, dans le shader)
  'deco:velvet': () => paintData(256, 256, (u, v, o) => {
    const t = fbmP(u, v, 72, 72, 2, 51), s = fbmP(u, v, 10, 60, 2, 52);
    const l = 0.93 + 0.06 * (t - 0.5) + 0.04 * (s - 0.5); o[0] = o[1] = o[2] = 244 * l; o[3] = 0.7 * t + 0.3 * s; o[4] = 1;
  }),
  // variations lentes des tissus (R, G, B : trois bruits indépendants), lues en coordonnées monde par le shader
  'deco:fablo': () => paintData(128, 128, (u, v, o) => {
    o[0] = 255 * fbmP(u, v, 3, 3, 4, 101); o[1] = 255 * fbmP(u, v, 5, 5, 3, 102); o[2] = 255 * fbmP(u, v, 4, 4, 4, 103);
  }),
  // surfaces lisses (laque, émail, métal thermolaqué, vitrocéramique) : peau d'orange très fine en relief,
  // rugosité inégale (traces d'essuyage, zones plus mates) — ce sont elles qui cassent les reflets « plastique »
  'deco:satin': () => paintData(512, 512, (u, v, o) => {
    const peel = fbmP(u, v, 110, 110, 2, 71), sm = fbmP(u, v, 4, 4, 4, 72), wipe = fbmP(u, v, 3, 36, 2, 73), dust = fbmP(u, v, 40, 40, 2, 74);
    const l = 0.985 + 0.02 * (sm - 0.5);
    o[0] = o[1] = o[2] = 250 * l; o[3] = peel;
    o[4] = clamp(0.76 + 0.42 * (sm - 0.5) + 0.16 * (wipe - 0.5) + 0.08 * (peel - 0.5) + (dust > 0.72 ? 0.5 * (dust - 0.72) : 0));
  }),
  // métal brossé (laiton, inox) : stries serrées dans le sens du brossage, patine lente
  'deco:brushed': () => paintData(256, 256, (u, v, o) => {
    const st = fbmP(u, v, 2, 128, 3, 81), lo = fbmP(u, v, 3, 3, 3, 82);
    const l = 0.95 + 0.05 * st + 0.04 * (lo - 0.5);
    o[0] = o[1] = o[2] = 250 * l; o[3] = st; o[4] = clamp(0.74 + 0.3 * (st - 0.5) + 0.22 * (lo - 0.5));
  }),
  'deco:rug': () => paintData(512, 512, (u, v, o) => {
    const tuft = fbmP(u, v, 96, 96, 2, 13), big = fbmP(u, v, 4, 4, 3, 2);
    const x = (u - 0.5) * 2, y = (v - 0.5) * 2, dia = Math.abs(Math.abs(x) + Math.abs(y) - 0.9), dia2 = Math.abs(Math.abs(x) + Math.abs(y) - 0.15);
    const wob = 0.025 * (fbmP(u, v, 12, 12, 2, 4) - 0.5);
    const line = (dia + wob < 0.035 || dia2 + wob < 0.03) ? 1 : 0;
    const l = 0.82 + 0.1 * tuft + 0.06 * (big - 0.5);
    if (line) { o[0] = 70 * l; o[1] = 60 * l; o[2] = 52 * l; } else { o[0] = 238 * l; o[1] = 230 * l; o[2] = 214 * l; }
    o[3] = tuft; o[4] = 1;
  }),
  // laine (plaids, manteaux, tapis unis) : feutre fin à fibres couchées, mèches plus claires — pas de bosses
  'deco:wool': () => paintData(256, 256, (u, v, o) => {
    const f = fbmP(u, v, 100, 100, 2, 77), fib = fbmP(u, v, 20, 128, 2, 78), tuft = fbmP(u, v, 14, 14, 2, 79);
    const t = 0.45 * f + 0.35 * fib + 0.2 * tuft, l = 0.86 + 0.16 * t;
    o[0] = o[1] = o[2] = 238 * l; o[3] = t; o[4] = 1;
  }),
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
    // grain minéral fin, cristaux clairs épars, zones un peu moins polies (traces d'usage)
    const gr = pn(u * 180, v * 180, 180, 180, 63), fl = hash2((u * 1024) | 0, (v * 1024) | 0, 9), use = fbmP(u, v, 6, 6, 2, 64);
    const l = 0.93 + 0.03 * n - 0.22 * vein + 0.035 * (gr - 0.5) + (fl > 0.985 ? 0.03 : fl < 0.012 ? -0.05 : 0);
    o[0] = 240 * l; o[1] = 236 * l; o[2] = 228 * l; o[3] = -0.6 * vein + 0.25 * (gr - 0.5); o[4] = 0.2 + 0.08 * n + 0.2 * vein + 0.16 * (use - 0.5) + 0.06 * (gr - 0.5);
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
