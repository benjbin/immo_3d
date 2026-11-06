// Canopée — tour/citymat.js
// Matériaux procéduraux du quartier Matabiau / Marengo (ville rose) autour de la tour : façades, rez-de-chaussée,
// toitures, murs pignons. Tout est dessiné au canvas, sans image, avec un aléatoire reproductible.
// Convention d'uv : u = mètres le long de la façade, v = mètres au-dessus du pied de la bande
// (façades : v = 0 au haut du rez-de-chaussée ; rez-de-chaussée : v = 0 au sol). Toits : uv = x, z en mètres.
// Chaque tuile contient un nombre entier de travées × niveaux : les fenêtres tombent juste sur floorH.
// Canvas « data » partagé : R = relief (bumpMap), G = rugosité (roughnessMap), B = métal (metalnessMap).
import { mulberry32, fbm2 } from '../materials.js';

export function cityMaterials(THREE) {
  const t0 = performance.now();
  // ---------- outils ----------
  const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const cl = (x) => x < 0 ? 0 : x > 255 ? 255 : x | 0;
  const hx = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
  const rgb = (c, k = 1, a = 1) => `rgba(${cl(c[0] * k)},${cl(c[1] * k)},${cl(c[2] * k)},${a})`;
  const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const dat = (h, r, m = 0) => `rgb(${cl(h * 255)},${cl(r * 255)},${cl(m * 255)})`;
  const pick = (r, a) => a[r() * a.length | 0];
  const R = (g, s, x, y, w, h) => { g.fillStyle = s; g.fillRect(x, y, w, h); };

  // bruits tuilables (tore : quatre échantillons de fbm2 mélangés), 128², étirés sur la tuile entière
  const noise = (n, f, seed) => {
    const v = new Float32Array(n * n); let lo = 1, hi = 0;
    for (let y = 0, i = 0; y < n; y++) for (let x = 0; x < n; x++, i++) {
      const u = x / n, w = y / n, X = u * f, Y = w * f;
      const s = (1 - u) * (1 - w) * fbm2(X, Y, 4, seed) + u * (1 - w) * fbm2(X - f, Y, 4, seed) + (1 - u) * w * fbm2(X, Y - f, 4, seed) + u * w * fbm2(X - f, Y - f, 4, seed);
      v[i] = s; if (s < lo) lo = s; if (s > hi) hi = s;
    }
    const c = cv(n, n), g = c.getContext('2d'), im = g.createImageData(n, n);
    for (let i = 0; i < n * n; i++) { const k = (v[i] - lo) / (hi - lo) * 255; im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = k; im.data[i * 4 + 3] = 255; }
    g.putImageData(im, 0, 0); return c;
  };
  const NZ = [noise(128, 3, 11), noise(128, 6, 23), noise(128, 2, 37)];
  const GRAIN = (() => { const c = cv(256, 256), g = c.getContext('2d'), im = g.createImageData(256, 256), r = mulberry32(77);
    for (let i = 0; i < 65536; i++) { const k = 128 + (r() - 0.5) * 200; im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = k; im.data[i * 4 + 3] = 255; }
    g.putImageData(im, 0, 0); return c; })();
  // salissures : bruit étiré sur la tuile (n × n copies), en multiplication
  const grime = (g, L, k, a, n = 1, mode = 'multiply') => { g.save(); g.globalCompositeOperation = mode; g.globalAlpha = a;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) g.drawImage(NZ[k], i * L.tw / n, j * L.th / n, L.tw / n, L.th / n); g.restore(); };
  const grain = (g, a) => { const W = g.canvas.width, H = g.canvas.height; g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'soft-light'; g.globalAlpha = a;
    for (let x = 0; x < W; x += 256) for (let y = 0; y < H; y += 256) g.drawImage(GRAIN, x, y); g.restore(); };

  // couche de dessin en mètres, y vers le haut (couleur pleine résolution, data et émissif à demi-résolution)
  const layer = (tw, th, W = 1024, H = 1024) => {
    const mk = (w, h) => { const g = cv(w, h).getContext('2d'); g.setTransform(w / tw, 0, 0, -h / th, 0, h); return g; };
    const L = { tw, th, c: mk(W, H), d: mk(W / 2, H / 2), e: mk(W / 2, H / 2) };
    R(L.e, '#000', 0, 0, tw, th); return L;
  };
  const all = (L, c, d, x, y, w, h, e = '#000') => { R(L.c, c, x, y, w, h); R(L.d, d, x, y, w, h); if (e) R(L.e, e, x, y, w, h); };
  const text = (g, L, s, x, y, size, col, maxW = 6, weight = 600) => {
    const W = g.canvas.width, H = g.canvas.height, sx = W / L.tw, sy = H / L.th;
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.font = `${weight} ${Math.round(size * sy)}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = col; g.fillText(s, x * sx, H - y * sy, maxW * sx); g.restore();
  };
  const tex = (g, L, srgb) => { const t = new THREE.CanvasTexture(g.canvas); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.repeat.set(1 / L.tw, 1 / L.th); return t; };
  const material = (name, L, { bump = 0.6, emis = true, env = 1 } = {}) => {
    const dt = tex(L.d, L, false);
    return new THREE.MeshStandardMaterial({ name, map: tex(L.c, L, true), roughnessMap: dt, metalnessMap: dt, bumpMap: dt, bumpScale: bump, roughness: 1, metalness: 1, envMapIntensity: env,
      ...(emis ? { emissive: 0xffffff, emissiveMap: tex(L.e, L, true), emissiveIntensity: 0 } : {}) });
  };

  // ---------- briques foraines : motif tuilable (nx × ny briques), couleur et data ----------
  // pal : [teinte, saturation, luminosité, poids] ; chaque brique tirée puis légèrement décalée
  const PAL_TLS = [[14, 52, 55, 5], [18, 55, 60, 4], [10, 48, 48, 3], [22, 50, 66, 2], [8, 42, 40, 1], [26, 40, 72, 1]];
  const brickCol = (r, pal) => { let t = r() * pal.reduce((s, p) => s + p[3], 0), p = pal[0]; for (const q of pal) { if ((t -= q[3]) < 0) { p = q; break; } }
    return `hsl(${p[0] + (r() - 0.5) * 5},${p[1] + (r() - 0.5) * 10}%,${p[2] + (r() - 0.5) * 9}%)`; };
  const brickPat = (L, { bl, ch, nx, ny, pal = PAL_TLS, mortar = '#d8c3a8', seed = 1, jh = 0.24, jv = 0.014 }) => {
    const r = mulberry32(seed), pw = nx * bl, ph = ny * ch, out = {};
    const cols = []; for (let i = 0; i < nx * ny; i++) cols.push([brickCol(r, pal), 0.82 + 0.14 * r(), 0.72 + 0.16 * r()]);
    for (const [k, base] of [['c', L.c], ['d', L.d]]) {
      const sx = base.canvas.width / L.tw, sy = base.canvas.height / L.th, w = Math.max(2, Math.round(pw * sx)), h = Math.max(2, Math.round(ph * sy));
      const g = cv(w, h).getContext('2d'); g.setTransform(w / pw, 0, 0, h / ph, 0, 0);
      R(g, k === 'c' ? mortar : dat(0.5, 0.95), 0, 0, pw, ph);
      for (let j = 0; j < ny; j++) { const off = (j % 2) * bl / 2;
        for (let i = -1; i < nx; i++) { const q = cols[j * nx + ((i % nx) + nx) % nx];
          R(g, k === 'c' ? q[0] : dat(q[1], q[2]), i * bl + off + jv / 2, j * ch + ch * jh / 2, bl - jv, ch * (1 - jh)); } }
      const p = base.createPattern(g.canvas, 'repeat'); p.setTransform(new DOMMatrix([pw / w, 0, 0, ph / h, 0, 0])); out[k] = p;
    }
    out.fill = (x, y, w, h) => { R(L.c, out.c, x, y, w, h); R(L.d, out.d, x, y, w, h); R(L.e, '#000', x, y, w, h); };
    return out;
  };

  // ---------- fenêtres ----------
  const WARM = ['#ffb066', '#ffbf80', '#ffcb96', '#ffb877', '#ffd8ae', '#ffc68c'].map(hx);
  const G0 = hx('#25292c'), G1 = hx('#414d57'), G2 = hx('#7d8e9d');
  // pièce éclairée derrière la vitre, sur le canvas émissif
  const lightUp = (L, x, y, w, h, r, o = {}) => {
    const g = L.e, c = o.col || pick(r, WARM), I = o.I ?? (0.5 + 0.5 * r());
    if (o.curtain) { const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, rgb(c, 0.42 * I)); gr.addColorStop(1, rgb(c, 0.28 * I)); g.fillStyle = gr; g.fillRect(x, y, w, h); return; }
    if (r() < 0.6) { const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, rgb(c, 0.55 * I)); gr.addColorStop(1, rgb(c, I)); g.fillStyle = gr; }
    else { const cx = x + w * (0.15 + 0.7 * r()), cy = y + h * (0.2 + 0.35 * r()), gr = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.75);
      gr.addColorStop(0, rgb(c, I)); gr.addColorStop(1, rgb(c, 0.1 * I)); g.fillStyle = gr; }   // lampe d'appoint dans un coin
    g.fillRect(x, y, w, h);
    if (r() < 0.5) R(g, 'rgba(0,0,0,.55)', x + w * 0.5 * r(), y, w * (0.2 + 0.3 * r()), h * (0.18 + 0.25 * r()));   // meuble en contre-jour
  };
  // vitrage : reflet du ciel en haut, de la rue en bas, luminosité propre à chaque fenêtre
  const glass = (L, x, y, w, h, r, o = {}) => {
    const g = L.c, b = (o.b ?? 1) * (0.62 + 0.6 * r()), t = o.tint || [1, 1, 1], m = (c) => [c[0] * t[0], c[1] * t[1], c[2] * t[2]];
    const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, rgb(m(G0), b)); gr.addColorStop(0.45 + 0.25 * r(), rgb(m(G1), b)); gr.addColorStop(1, rgb(m(G2), b * (0.85 + 0.2 * r())));
    g.fillStyle = gr; g.fillRect(x, y, w, h);
    if (r() < 0.6) R(g, 'rgba(12,9,7,.3)', x + w * 0.6 * r(), y, w * (0.15 + 0.3 * r()), h * (0.2 + 0.3 * r()));
    if (r() < 0.3) { g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.fillStyle = 'rgba(255,255,255,.07)'; const s = x - h * 0.4 + (w + h * 0.4) * r(), k = w * (0.2 + 0.3 * r());
      g.beginPath(); g.moveTo(s, y); g.lineTo(s + k, y); g.lineTo(s + k + h * 0.5, y + h); g.lineTo(s + h * 0.5, y + h); g.fill(); g.restore(); }
    const sh = g.createLinearGradient(0, y + h, 0, y + h - Math.min(0.4, h * 0.3)); sh.addColorStop(0, 'rgba(0,0,0,.4)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = sh; g.fillRect(x, y + h - 0.4, w, 0.4);                                         // ombre du linteau
    const cur = o.curtain ?? r() < 0.35;
    if (cur) { if (r() < 0.65) R(g, `rgba(228,222,208,${0.3 + 0.25 * r()})`, x, y, w, h * (0.55 + 0.45 * r()));   // voilage
      else { const cc = pick(r, ['rgba(150,118,96,.7)', 'rgba(120,128,120,.7)', 'rgba(200,188,165,.7)', 'rgba(110,70,62,.7)']); R(g, cc, x, y, w * 0.24, h); R(g, cc, x + w * 0.76, y, w * 0.24, h); } }
    R(L.d, dat(0.22, 0.05 + 0.07 * r(), (o.metal ?? 0.32) * (0.65 + 0.6 * r())), x, y, w, h);
    const lit = r() < (o.lit ?? 0.3);
    if (lit) lightUp(L, x, y, w, h, r, { curtain: cur && r() < 0.7, col: o.col, I: o.I });
    return { lit, cur };
  };
  const reveal = (L, x, y, w, h, d = 0.05) => { R(L.c, 'rgba(20,12,8,.35)', x - d, y - d * 0.5, w + 2 * d, h + d * 1.5); R(L.d, dat(0.35, 0.85), x - d, y - d * 0.5, w + 2 * d, h + d * 1.5); };
  // menuiserie : cadre, montant central, petits bois, imposte
  const frame = (L, x, y, w, h, col, { t = 0.06, mid = true, bars = 0, tr = 0, mullions = 0 } = {}) => {
    const q = [[x, y, w, t], [x, y + h - t, w, t], [x, y, t, h], [x + w - t, y, t, h]];
    if (mid) q.push([x + w / 2 - t * 0.7, y, t * 1.4, h - tr]);
    for (let k = 1; k <= mullions; k++) q.push([x + w * k / (mullions + 1) - t / 2, y, t, h]);
    for (let k = 1; k <= bars; k++) q.push([x, y + (h - tr) * k / (bars + 1) - 0.015, w, 0.03]);
    if (tr) q.push([x, y + h - tr - t, w, t]);
    for (const [a, b, c, d] of q) all(L, col, dat(0.62, 0.55), a, b, c, d);
  };
  // persiennes toulousaines (bois peint, lames)
  const shutter = (L, x, y, w, h, col, r, slits) => {
    const g = L.c; R(g, rgb(col, 0.9 + 0.14 * r()), x, y, w, h);
    g.fillStyle = 'rgba(0,0,0,.2)'; for (let yy = y + 0.06; yy < y + h - 0.06; yy += 0.07) g.fillRect(x + 0.04, yy, w - 0.08, 0.022);
    g.fillStyle = 'rgba(255,255,255,.08)'; for (let yy = y + 0.085; yy < y + h - 0.06; yy += 0.07) g.fillRect(x + 0.04, yy, w - 0.08, 0.012);
    g.strokeStyle = 'rgba(0,0,0,.3)'; g.lineWidth = 0.025; g.strokeRect(x + 0.012, y + 0.012, w - 0.024, h - 0.024);
    R(L.d, dat(0.92, 0.72), x, y, w, h); R(L.e, '#000', x, y, w, h);
    if (slits) { L.e.fillStyle = rgb(pick(r, WARM), 0.35); for (let yy = y + 0.07; yy < y + h - 0.06; yy += 0.07) L.e.fillRect(x + 0.05, yy, w - 0.1, 0.012); }
  };
  // garde-corps en fer forgé (balconnet), barreaux et volutes
  const rail = (L, x, y, w, h = 0.95, fancy = true) => {
    for (const [g, col] of [[L.c, '#2a2725'], [L.d, dat(0.95, 0.45, 0.55)], [L.e, '#000']]) {
      R(g, col, x - 0.05, y + h - 0.045, w + 0.1, 0.045); R(g, col, x - 0.03, y + 0.05, w + 0.06, 0.03);
      for (let xx = x; xx <= x + w + 1e-3; xx += 0.11) R(g, col, xx, y + 0.05, 0.016, h - 0.05);
      if (fancy) { g.strokeStyle = col; g.lineWidth = 0.014; R(g, col, x, y + h * 0.72, w, 0.016);
        for (let xx = x + 0.055; xx < x + w - 0.05; xx += 0.22) { g.beginPath(); g.arc(xx + 0.055, y + h * 0.36, 0.05, 0, 6.283); g.stroke(); } }
    }
  };
  const streak = (L, x, y, w, len = 1.1, a = 0.2, col = '60,46,38') => {
    const g = L.c; for (const o of y - len < 0 ? [0, L.th] : [0]) { const gr = g.createLinearGradient(0, y + o, 0, y + o - len);
      gr.addColorStop(0, `rgba(${col},${a})`); gr.addColorStop(1, `rgba(${col},0)`); g.fillStyle = gr; g.fillRect(x, y + o - len, w, len); }
  };

  // ---------- 1–2. immeubles toulousains du XIXe : brique foraine ou brique + enduit ----------
  const SHUT_BLUE = ['#7f93a1', '#93a6b2', '#6f8594', '#a3b2b8'].map(hx), SHUT_GREEN = ['#8c9a89', '#7b8b7b', '#a2ab98', '#6e7d70'].map(hx), SHUT_FADED = ['#b3ab9b', '#9aa3a6', '#8f8a7c'].map(hx);
  const classic = (name, o) => {
    const { bay, fh, nb, nf } = o, tw = bay * nb, th = fh * nf, L = layer(tw, th), r = mulberry32(o.seed);
    const bp = brickPat(L, { bl: o.bl, ch: fh / o.courses, nx: o.bnx, ny: o.courses, pal: o.pal, mortar: o.mortar, seed: o.seed + 1 });
    if (o.render) {                                                        // enduit, bandeaux d'étage et chaînes en brique
      all(L, rgb(hx(o.render)), dat(0.8, 0.9), 0, 0, tw, th);
      grime(L.c, L, 0, 0.22, 1); grime(L.c, L, 1, 0.14, 2);
      for (let f = 0; f < nf; f++) { const y = f * fh;
        bp.fill(0, y - 0.04, tw, 0.36); if (f === 0) bp.fill(0, th - 0.04, tw, 0.04);
        R(L.c, '#ebe0cc', 0, y + 0.32, tw, 0.06); R(L.d, dat(1, 0.8), 0, y + 0.32, tw, 0.06);           // moulure
        const s = L.c.createLinearGradient(0, y - 0.04, 0, y - 0.2); s.addColorStop(0, 'rgba(40,25,15,.35)'); s.addColorStop(1, 'rgba(40,25,15,0)'); L.c.fillStyle = s; L.c.fillRect(0, y - 0.2, tw, 0.16);
      }
      for (const x of [0, tw / 2 - 0.26, tw - 0.26]) bp.fill(x, 0, x === 0 ? 0.26 : x === tw - 0.26 ? 0.26 : 0.52, th);
    } else { bp.fill(0, 0, tw, th); grime(L.c, L, 0, 0.2, 1); grime(L.c, L, 2, 0.12, 2); grime(L.c, L, 1, 0.12, 1, 'soft-light'); }
    for (let f = 0; f < nf; f++) for (let i = 0; i < nb; i++) {
      const w = o.ww, h = o.wh - (f === nf - 1 && o.attic ? 0.4 : 0), x = i * bay + (bay - w) / 2, y = f * fh + o.sill;
      // encadrement
      if (o.surround === 'stone') { const sc = rgb(hx('#e3d5bd'), 0.93 + 0.1 * r());
        all(L, sc, dat(0.95, 0.8), x - 0.15, y, w + 0.3, h + 0.3); R(L.c, 'rgba(0,0,0,.08)', x - 0.15, y + h + 0.24, w + 0.3, 0.06);
        all(L, '#d9ccb4', dat(0.95, 0.8), x + w / 2 - 0.1, y + h, 0.2, 0.32); }                         // clé
      else if (o.surround === 'brick' || o.render) { const p = o.render ? 0.2 : 0.12;
        if (o.render) bp.fill(x - p, y, w + 2 * p, h + 0.3);
        R(L.c, o.mortar, x - p, y + h + 0.02, w + 2 * p, 0.26); for (let xx = x - p; xx < x + w + p - 0.02; xx += 0.075) R(L.c, brickCol(r, o.pal), xx + 0.006, y + h + 0.03, 0.063, 0.24); }   // plate-bande en briques posées de chant
      // appui
      const sill = o.surround === 'stone' ? '#e6dac4' : '#d9cbb3';
      all(L, sill, dat(1, 0.8), x - 0.12, y - 0.09, w + 0.24, 0.09); streak(L, x - 0.05, y - 0.09, w + 0.1, 0.9 + 0.8 * r(), o.render ? 0.16 : 0.12);
      reveal(L, x, y, w, h);
      const sh = r(), shut = sh < o.pShut, closed = shut && r() < 0.32, half = shut && !closed && r() < 0.15;
      const gx = glass(L, x + 0.03, y + 0.03, w - 0.06, h - 0.06, r, { lit: closed ? 0.3 : 0.3 });
      frame(L, x, y, w, h, o.frame || '#e4dfd4', { t: 0.06, bars: 2, tr: 0.55 });
      if (o.pRail && r() < o.pRail) rail(L, x + 0.02, y, w - 0.04, 0.95, r() < 0.7);
      if (shut) { const sc = pick(r, o.shutCols), sw = w / 2;
        if (closed) { shutter(L, x, y, sw, h, sc, r, gx.lit); shutter(L, x + sw, y, sw, h, sc, r, gx.lit); }
        else if (half) { shutter(L, x - sw, y, sw, h, sc, r); shutter(L, x + w - sw * 0.5, y, sw * 0.5, h, sc, r); }   // un battant entrebâillé
        else { shutter(L, x - sw - 0.02, y, sw, h, sc, r); shutter(L, x + w + 0.02, y, sw, h, sc, r); } }
    }
    grain(L.c, 0.22);
    return { L, mat: material(name, L, { bump: 0.5 }) };
  };

  // ---------- 3. enduit clair des années 1960–80 : coffres de volets roulants, loggias ----------
  const modern = (name, o) => {
    const bay = 3, nb = 4, fh = 2.9, nf = 5, tw = bay * nb, th = fh * nf, L = layer(tw, th), r = mulberry32(o.seed), base = hx(o.render);
    all(L, rgb(base), dat(0.8, 0.9), 0, 0, tw, th); grime(L.c, L, 0, 0.16, 1); grime(L.c, L, 1, 0.1, 2);
    const fr = '#ece9e2';
    for (let f = 0; f < nf; f++) for (let i = 0; i < nb; i++) {
      const t = o.cols[i], x0 = i * bay, y0 = f * fh;
      if (t === 'loggia') {
        const lx = x0 + 0.15, lw = bay - 0.3, ly = y0 + 0.18;
        all(L, rgb(base, 0.62), dat(0.3, 0.9), lx, ly, lw, fh - 0.18);                                    // fond de loggia à l'ombre
        const s = L.c.createLinearGradient(0, y0 + fh, 0, y0 + fh - 0.9); s.addColorStop(0, 'rgba(0,0,0,.35)'); s.addColorStop(1, 'rgba(0,0,0,0)'); L.c.fillStyle = s; L.c.fillRect(lx, y0 + fh - 0.9, lw, 0.9);
        glass(L, lx + 0.3, ly + 0.02, 1.5, 2.2, r, { b: 0.7 }); frame(L, lx + 0.3, ly + 0.02, 1.5, 2.2, fr, { t: 0.07 });
        if (r() < 0.6) { const p = 0.5 + 0.5 * r(); all(L, '#d8d6d0', dat(0.5, 0.6), lx + 0.33, ly + 2.2 - 2.2 * p * 0.4, 1.44, 2.2 * p * 0.4); }   // store roulant mi-descendu
        glass(L, lx + 2.05, ly + 0.95, 0.5, 1.2, r, { b: 0.7 }); frame(L, lx + 2.05, ly + 0.95, 0.5, 1.2, fr, { mid: false });
        if (r() < 0.5) R(L.c, pick(r, ['rgba(70,90,70,.8)', 'rgba(140,70,50,.75)', 'rgba(90,80,70,.8)']), lx + 2.0 + 0.4 * r(), ly, 0.35, 0.5 + 0.4 * r());   // plantes, linge
        all(L, '#ece8df', dat(1, 0.85), x0 + 0.05, y0, bay - 0.1, 0.18);                                   // nez de dalle
        const kind = o.railKind ?? (r() * 3 | 0);
        if (kind === 0) rail(L, x0 + 0.1, y0 + 0.18, bay - 0.2, 1.0, false);
        else if (kind === 1) { all(L, o.panel || 'rgba(205,212,214,.85)', dat(0.9, 0.3, 0.2), x0 + 0.1, y0 + 0.18, bay - 0.2, 0.95); all(L, '#9aa0a3', dat(1, 0.4, 0.7), x0 + 0.1, y0 + 1.1, bay - 0.2, 0.04); }
        else all(L, rgb(base, 0.96), dat(0.95, 0.9), x0 + 0.1, y0 + 0.18, bay - 0.2, 0.9);                  // allège maçonnée
        streak(L, x0 + 0.1, y0, bay - 0.2, 0.7, 0.14, '70,70,70');
      } else {
        const small = t === 'small', w = small ? 0.6 : 1.4, h = small ? 0.65 : 1.45, x = x0 + (bay - w) / 2, y = y0 + (small ? 1.55 : 0.92);
        all(L, '#cfccc5', dat(1, 0.75), x - 0.05, y - 0.06, w + 0.1, 0.06); streak(L, x, y - 0.06, w, 1.2 + r(), 0.18, '80,78,74');
        reveal(L, x, y, w, h + 0.24, 0.04);
        const gx = glass(L, x + 0.03, y + 0.03, w - 0.06, h - 0.06, r, { curtain: small ? true : undefined, b: small ? 1.6 : 1 });
        if (small) R(L.c, 'rgba(225,228,226,.55)', x, y, w, h);                                             // verre dépoli
        frame(L, x, y, w, h, fr, { t: 0.06, mid: !small });
        all(L, fr, dat(0.75, 0.55), x - 0.02, y + h, w + 0.04, 0.22);                                      // coffre de volet roulant
        const p = pick(r, [0, 0, 0, 0.2, 0.35, 0.5, 0.7, 1]);
        if (p > 0) { const ph = (h - 0.06) * p, sy = y + h - ph; all(L, '#d9d7d1', dat(0.7, 0.55), x + 0.05, sy, w - 0.1, ph);
          L.c.fillStyle = 'rgba(0,0,0,.14)'; for (let yy = sy; yy < y + h; yy += 0.05) L.c.fillRect(x + 0.05, yy, w - 0.1, 0.012);
          if (p === 1 && gx.lit) { L.e.fillStyle = rgb(pick(r, WARM), 0.25); for (let yy = sy + 0.02; yy < y + h; yy += 0.05) L.e.fillRect(x + 0.06, yy, w - 0.12, 0.008); } }
      }
    }
    // joints de dilatation et ligne de dalle légère
    for (let f = 0; f < nf; f++) R(L.c, 'rgba(0,0,0,.05)', 0, f * fh, tw, 0.04);
    grain(L.c, 0.2);
    return { L, mat: material(name, L, { bump: 0.4 }) };
  };

  // ---------- 4. logements contemporains en brique (années 2000) ----------
  const contemp = (name, o) => {
    const bay = 3.6, nb = 4, fh = 3, nf = 4, tw = bay * nb, th = fh * nf, L = layer(tw, th), r = mulberry32(o.seed);
    const bp = brickPat(L, { bl: 0.24, ch: fh / 48, nx: 30, ny: 48, pal: o.pal, mortar: o.mortar, seed: o.seed + 1, jh: 0.18, jv: 0.012 });
    bp.fill(0, 0, tw, th); grime(L.c, L, 0, 0.1, 1); grime(L.c, L, 2, 0.08, 1, 'soft-light');
    const anth = '#3d4246';
    for (let f = 0; f < nf; f++) for (let i = 0; i < nb; i++) {
      const w = 1.9, h = 2.4, x = i * bay + (bay - w) / 2 + ((f + i) % 2 ? 0.32 : -0.32), y = f * fh + 0.12;
      const balc = (i === 1 || i === 3) && (f % 2 === 0) === (i === 1);
      if ((i + f) % 3 === 0) all(L, '#55595c', dat(0.85, 0.42, 0.6), x + ((f + i) % 2 ? -0.62 : w + 0.02), y, 0.6, h);   // bardage métallique
      all(L, '#8d8e8c', dat(0.9, 0.7), x - 0.06, y + h, w + 0.12, 0.08);                                     // linteau béton
      reveal(L, x, y, w, h, 0.06);
      glass(L, x + 0.03, y + 0.03, w - 0.06, h - 0.06, r, { b: 1.05, metal: 0.4 });
      frame(L, x, y, w, h, anth, { t: 0.05, mid: false, mullions: 1 });
      if (r() < 0.25) { const p = 0.3 + 0.6 * r(); all(L, '#9a9c9b', dat(0.6, 0.6, 0.3), x + 0.05, y + h - h * p, w - 0.1, h * p - 0.05);
        L.c.fillStyle = 'rgba(0,0,0,.12)'; for (let yy = y + h - h * p; yy < y + h - 0.05; yy += 0.06) L.c.fillRect(x + 0.05, yy, w - 0.1, 0.012); }   // brise-soleil orientable
      if (balc) { all(L, '#e6e3dc', dat(1, 0.8), x - 0.5, y - 0.12, w + 1, 0.2); streak(L, x - 0.5, y - 0.12, w + 1, 0.5, 0.12, '60,60,60');
        all(L, 'rgba(150,158,160,.55)', dat(0.95, 0.35, 0.5), x - 0.5, y + 0.08, w + 1, 1.0); all(L, anth, dat(1, 0.4, 0.7), x - 0.5, y + 1.05, w + 1, 0.05); }   // balcon : nez de dalle, tôle perforée
      else rail(L, x + 0.04, y, w - 0.08, 1.0, false);
      all(L, '#a9a6a0', dat(1, 0.7), x - 0.04, y - 0.05, w + 0.08, 0.05);
    }
    grain(L.c, 0.18);
    return { L, mat: material(name, L, { bump: 0.4 }) };
  };

  // ---------- 5–6. murs-rideaux de bureaux, béton à fenêtres en bandeau ----------
  const OFFICE = ['#fff1d9', '#ffe9cc', '#fff6e6', '#ffe2bd'].map(hx);
  const panes = (L, r, y, h, x0, pw, n, o) => {        // une rangée de vitrages : éclairage par plateaux, stores vénitiens
    let on = r() < o.lit, run = 0;
    for (let k = 0; k < n; k++) {
      if (--run <= 0) { on = r() < o.lit; run = 2 + (r() * 5 | 0); }
      const x = x0 + k * pw, c = pick(r, OFFICE), I = 0.45 + 0.4 * r();
      glass(L, x, y, pw, h, r, { b: o.b, tint: o.tint, metal: o.metal, lit: on ? 1 : 0, curtain: false, col: c, I });
      if (on) { const gr = L.e.createLinearGradient(0, y + h, 0, y + h - 0.5); gr.addColorStop(0, rgb(c, 0.9 * I)); gr.addColorStop(1, rgb(c, 0)); L.e.fillStyle = gr; L.e.fillRect(x, y + h - 0.5, pw, 0.5); }   // luminaires
      if (r() < o.blind) { const p = 0.2 + 0.75 * r(), bh = h * p; R(L.c, 'rgba(196,198,194,.88)', x, y + h - bh, pw, bh);
        L.c.fillStyle = 'rgba(0,0,0,.1)'; for (let yy = y + h - bh; yy < y + h; yy += 0.05) L.c.fillRect(x, yy, pw, 0.015);
        if (on) R(L.e, 'rgba(0,0,0,.55)', x, y + h - bh, pw, bh); else R(L.d, dat(0.3, 0.5, 0.1), x, y + h - bh, pw, bh); }
    }
  };
  const offices = (name, o) => {
    const pw = 1.35, np = 8, fh = 3.6, nf = 4, tw = pw * np, th = fh * nf, L = layer(tw, th), r = mulberry32(o.seed), sp = 0.95;
    for (let f = 0; f < nf; f++) {
      const y = f * fh;
      all(L, o.spandrel, dat(0.5, 0.25, 0.65), 0, y, tw, sp);                                              // allège en verre émaillé
      for (let k = 0; k < np; k++) R(L.c, `rgba(255,255,255,${0.02 + 0.05 * r()})`, k * pw, y, pw, sp);
      panes(L, r, y + sp, fh - sp, 0, pw, np, { lit: 0.4, blind: 0.3, b: o.b, tint: o.tint, metal: 0.62 });
      all(L, '#a7aeb4', dat(0.9, 0.32, 0.85), 0, y + sp - 0.04, tw, 0.08); all(L, '#9aa1a7', dat(0.9, 0.32, 0.85), 0, y - 0.03, tw, 0.06);   // traverses
    }
    for (let k = 0; k <= np; k++) all(L, '#b3b9be', dat(1, 0.3, 0.85), k * pw - 0.035, 0, 0.07, th);        // montants tous les 1,35 m
    grain(L.c, 0.08);
    return { L, mat: material(name, L, { bump: 0.25, env: 1.15 }) };
  };
  const concrete = (name, o) => {
    const fh = 4, nf = 4, tw = 12, th = fh * nf, L = layer(tw, th), r = mulberry32(o.seed), pw = 1.5, base = hx(o.col);
    all(L, rgb(base), dat(0.85, 0.9), 0, 0, tw, th); grime(L.c, L, 0, 0.25, 1); grime(L.c, L, 1, 0.18, 2); grime(L.c, L, 2, 0.15, 1, 'soft-light');
    for (let f = 0; f < nf; f++) { const y = f * fh;
      for (let x = 0; x < tw; x += 3) { R(L.c, 'rgba(0,0,0,.18)', x, y, 0.025, fh); R(L.d, dat(0.4, 0.95), x, y, 0.03, fh); }   // joints de panneaux
      R(L.c, 'rgba(0,0,0,.2)', 0, y, tw, 0.025); R(L.d, dat(0.4, 0.95), 0, y, tw, 0.03);
      for (let k = 0; k < 14; k++) streak(L, r() * tw, y + 1.05, 0.08 + 0.3 * r(), 0.6 + 1.6 * r(), 0.08 + 0.12 * r(), '50,50,48');   // coulures
      const wy = y + 1.15, wh = 1.75;
      all(L, '#7d7f7f', dat(0.9, 0.6, 0.4), 0, wy - 0.1, tw, 0.1);                                         // appui filant
      panes(L, r, wy, wh, 0, pw, tw / pw, { lit: 0.35, blind: 0.4, b: 0.85, tint: [0.95, 1.02, 1], metal: 0.4 });
      R(L.c, 'rgba(0,0,0,.25)', 0, wy + wh, tw, 0.08);
      for (let k = 0; k <= tw / pw; k++) all(L, '#5d6266', dat(0.8, 0.4, 0.7), k * pw - 0.035, wy, 0.07, wh);
      all(L, '#5d6266', dat(0.8, 0.4, 0.7), 0, wy, tw, 0.05); all(L, '#5d6266', dat(0.8, 0.4, 0.7), 0, wy + wh - 0.05, tw, 0.05);
    }
    grain(L.c, 0.3);
    return { L, mat: material(name, L, { bump: 0.5 }) };
  };

  // ---------- rez-de-chaussée (bande de 4,5 m, v = 0 au sol) ----------
  const GH = 4.5;
  const FRAMES = ['#2f3b36', '#3a3431', '#4b2f2e', '#2d3542', '#55534e', '#3e4a4a'];
  const SIGNS = ['BOULANGERIE', 'PHARMACIE', 'TABAC PRESSE', 'CAFÉ DE LA GARE', 'OPTIQUE', 'LIBRAIRIE', 'COIFFURE', 'PRIMEUR', 'HÔTEL', 'AGENCE', 'BRASSERIE', 'FLEURS'];
  const SHOPLIT = ['#fff0d6', '#ffe4b8', '#fff6ea', '#ffd9a0'].map(hx);
  const shopWin = (L, r, x, y, w, h, fc, open) => {                         // vitrine : intérieur, étagères, reflets
    glass(L, x, y, w, h, r, { b: 0.95, metal: 0.38, lit: 0, curtain: false });
    const g = L.c; for (let k = 0; k < 3; k++) { const yy = y + 0.5 + k * 0.55; R(g, 'rgba(160,140,115,.22)', x + 0.1, yy, w - 0.2, 0.04);
      for (let q = 0; q < 6; q++) R(g, `rgba(${110 + 120 * r() | 0},${90 + 90 * r() | 0},${70 + 80 * r() | 0},.25)`, x + 0.15 + (w - 0.4) * r(), yy + 0.04, 0.12 + 0.15 * r(), 0.12 + 0.18 * r()); }
    if (open) { const c = pick(r, SHOPLIT), I = 0.45 + 0.25 * r(), gr = L.e.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, rgb(c, 0.55 * I)); gr.addColorStop(0.7, rgb(c, I)); gr.addColorStop(1, rgb(c, 0.8 * I));
      L.e.fillStyle = gr; L.e.fillRect(x, y, w, h); for (let k = 0; k < 3; k++) { R(L.e, 'rgba(0,0,0,.4)', x + 0.1, y + 0.5 + k * 0.55, w - 0.2, 0.06); for (let q = 0; q < 5; q++) R(L.e, 'rgba(0,0,0,.3)', x + 0.15 + (w - 0.4) * r(), y + 0.56 + k * 0.55, 0.12 + 0.2 * r(), 0.15 + 0.2 * r()); } }
    else { all(L, '#9b9c99', dat(0.7, 0.55, 0.5), x, y + h * 0.15, w, h * 0.85); L.c.fillStyle = 'rgba(0,0,0,.16)'; for (let yy = y + h * 0.15; yy < y + h; yy += 0.06) L.c.fillRect(x, yy, w, 0.02); }   // rideau métallique baissé
  };
  const woodDoor = (L, r, x, y, w, h, col, arch) => {                      // porte en bois à panneaux (porte cochère si large)
    all(L, rgb(col), dat(0.75, 0.62), x, y, w, h);
    const n = w > 1.6 ? 2 : 1, lw = w / n, g = L.c;
    for (let k = 0; k < n; k++) { const lx = x + k * lw;
      for (const [py, ph] of [[0.25, h * 0.32], [0.45 + h * 0.32, h * 0.38]]) { R(g, rgb(col, 0.78), lx + 0.12, y + py, lw - 0.24, ph); R(g, rgb(col, 1.15), lx + 0.16, y + py + 0.04, lw - 0.32, ph - 0.08); }
      R(g, 'rgba(0,0,0,.35)', lx + lw - 0.02, y, 0.03, h); }
    if (n === 2) { all(L, rgb(col, 0.9), dat(0.8, 0.6), x + w * 0.62, y, 0.9, 2.1); R(g, 'rgba(0,0,0,.3)', x + w * 0.62, y, 0.025, 2.1); }   // portillon
    all(L, '#b49a5a', dat(1, 0.35, 0.8), x + w / 2 + 0.08, y + 1.05, 0.06, 0.1);
  };
  const vitrine = () => {
    const tw = 16, L = layer(tw, GH, 1024, 256), r = mulberry32(501);
    const bp = brickPat(L, { bl: 0.4, ch: GH / 100, nx: 20, ny: 20, seed: 502 });
    bp.fill(0, 0, tw, GH); grime(L.c, L, 0, 0.18, 1);
    all(L, '#cdbfa8', dat(0.95, 0.85), 0, 0, tw, 0.3);                                                    // soubassement en pierre
    const units = [[0.25, 5.2, 'shop'], [5.95, 1.6, 'door'], [8.05, 4.4, 'shop'], [12.95, 2.8, 'shop']];
    for (const [x, w, k] of units) {
      if (k === 'door') { reveal(L, x + 0.2, 0, 1.2, 2.9); woodDoor(L, r, x + 0.2, 0, 1.2, 2.5, hx('#34443e')); glass(L, x + 0.25, 2.55, 1.1, 0.35, r, { lit: 0.6 }); continue; }
      const fc = pick(r, FRAMES), sign = pick(r, SIGNS), open = r() < 0.8;
      all(L, fc, dat(0.95, 0.5, 0.3), x, 0.3, w, 3.3);                                                    // devanture
      const dw = 1.0, dx = r() < 0.5 ? x + 0.12 : x + w - dw - 0.12;
      shopWin(L, r, x + 0.12, 0.42, w - 0.24, 2.3, fc, open);
      frame(L, x + 0.12, 0.42, w - 0.24, 2.3, fc, { t: 0.07, mid: false, mullions: w > 4 ? 2 : 1 });
      glass(L, dx, 0.3, dw, 2.42, r, { lit: open ? 1 : 0, curtain: false, col: SHOPLIT[0], I: 0.55 }); frame(L, dx, 0.3, dw, 2.42, fc, { t: 0.08, mid: false });   // porte vitrée
      glass(L, x + 0.12, 2.8, w - 0.24, 0.45, r, { lit: open ? 0.8 : 0, curtain: false });                 // imposte
      frame(L, x + 0.12, 2.8, w - 0.24, 0.45, fc, { t: 0.05, mid: false, mullions: 3 });
      const sc = hx(pick(r, ['#e7dcc4', '#2f3b36', '#4b2f2e', '#e1d2b0', '#36404c']));
      all(L, rgb(sc), dat(0.98, 0.5, 0.2), x - 0.05, 3.3, w + 0.1, 0.55);                                  // bandeau d'enseigne
      const tc = sc[0] > 150 ? '#3a3330' : '#e8d9b5';
      text(L.c, L, sign, x + w / 2, 3.58, 0.3, tc, w - 0.5);
      if (open || r() < 0.5) text(L.e, L, sign, x + w / 2, 3.58, 0.3, sign === 'PHARMACIE' ? '#3cff7a' : '#ffd9a0', w - 0.5);
      if (sign === 'PHARMACIE') { for (const [g, c] of [[L.c, '#2f9a55'], [L.e, '#30ff70']]) { R(g, c, x + w - 0.5, 3.35, 0.15, 0.45); R(g, c, x + w - 0.65, 3.5, 0.45, 0.15); } }
      if (r() < 0.4) { const ac = pick(r, ['#7b2e2a', '#2d4a3a', '#c9b48a', '#38485a']);                   // lambrequin de store banne
        for (let xx = x; xx < x + w; xx += 0.3) R(L.c, ac, xx, 2.95, 0.3, 0.3);
        L.c.fillStyle = 'rgba(255,255,255,.16)'; for (let xx = x; xx < x + w; xx += 0.6) L.c.fillRect(xx, 2.95, 0.3, 0.3);
        R(L.d, dat(0.95, 0.9), x, 2.95, w, 0.3); R(L.e, '#000', x, 2.95, w, 0.3); }
    }
    R(L.c, 'rgba(0,0,0,.2)', 0, 3.85, tw, 0.06);
    grain(L.c, 0.2);
    return material('city:rdc-vitrines', L, { bump: 0.4 });
  };
  const arcade = () => {
    const tw = 12, L = layer(tw, GH, 1024, 256), r = mulberry32(601);
    const bp = brickPat(L, { bl: 0.4, ch: GH / 100, nx: 15, ny: 20, seed: 602, pal: [[13, 50, 52, 5], [17, 52, 58, 4], [9, 45, 45, 3], [24, 45, 65, 1]] });
    bp.fill(0, 0, tw, GH); grime(L.c, L, 0, 0.22, 1); grime(L.c, L, 1, 0.12, 2);
    all(L, '#cbbca3', dat(0.95, 0.85), 0, 0, tw, 0.5);
    const archPath = (g, x, w, hs, k = 0) => { g.beginPath(); g.moveTo(x - k, 0); g.lineTo(x - k, hs); g.arc(x + w / 2, hs, w / 2 + k, Math.PI, 0, true); g.lineTo(x + w + k, 0); g.closePath(); };
    const ops = [[0.9, 2.2, 'shop'], [4.7, 2.6, 'cochere'], [8.9, 2.2, 'shop']];
    for (const [x, w, k] of ops) {
      const hs = k === 'cochere' ? 2.4 : 2.2;
      for (const [g, c] of [[L.c, '#e0d2b8'], [L.d, dat(0.95, 0.82)]]) { g.fillStyle = c; archPath(g, x, w, hs, 0.22); g.fill(); }        // arc en pierre
      L.c.strokeStyle = 'rgba(0,0,0,.18)'; L.c.lineWidth = 0.02; for (let a = 0.15; a < 3.1; a += 0.39) { const cx = x + w / 2; L.c.beginPath(); L.c.moveTo(cx + Math.cos(a) * w / 2, hs + Math.sin(a) * w / 2); L.c.lineTo(cx + Math.cos(a) * (w / 2 + 0.22), hs + Math.sin(a) * (w / 2 + 0.22)); L.c.stroke(); }   // claveaux
      L.c.save(); archPath(L.c, x, w, hs); L.c.clip(); L.d.save(); archPath(L.d, x, w, hs); L.d.clip(); L.e.save(); archPath(L.e, x, w, hs); L.e.clip();
      if (k === 'cochere') { woodDoor(L, r, x, 0, w, hs + w / 2, hx(pick(r, ['#3b4a40', '#4a3426', '#2e3c4a']))); R(L.c, 'rgba(0,0,0,.25)', x, hs, w, 0.06);
        glass(L, x, hs + 0.06, w, w / 2, r, { lit: 0.5, b: 0.8 }); for (let a = 0.4; a < 3; a += 0.45) { for (const [g, c] of [[L.c, '#2a2725'], [L.e, '#000']]) { g.strokeStyle = c; g.lineWidth = 0.03; g.beginPath(); g.moveTo(x + w / 2, hs + 0.06); g.lineTo(x + w / 2 + Math.cos(a) * w, hs + 0.06 + Math.sin(a) * w); g.stroke(); } } }   // imposte en éventail
      else { const fc = pick(r, FRAMES), open = r() < 0.75;
        all(L, fc, dat(0.9, 0.5, 0.3), x, 0, w, hs + w / 2);
        shopWin(L, r, x + 0.1, 0.5, w - 0.2, hs - 0.5, fc, open); frame(L, x + 0.1, 0.5, w - 0.2, hs - 0.5, fc, { t: 0.07, mid: true });
        glass(L, x + 0.1, hs + 0.05, w - 0.2, w / 2, r, { lit: open ? 1 : 0.2, curtain: false, col: SHOPLIT[1], I: 0.7 });
        rail(L, x + 0.15, hs + 0.1, w - 0.3, 0.5, true); }
      L.c.restore(); L.d.restore(); L.e.restore();
      R(L.c, 'rgba(0,0,0,.18)', x, 0, 0.06, hs);
    }
    // enseigne peinte sur la brique et petites fenêtres d'entresol
    text(L.c, L, pick(r, ['ATELIER', 'ÉPICERIE', 'GALERIE']), 2.0, 4.05, 0.26, 'rgba(235,225,200,.75)');
    R(L.c, 'rgba(0,0,0,.18)', 0, 4.35, tw, 0.05);
    grain(L.c, 0.22);
    return material('city:rdc-arcades', L, { bump: 0.5 });
  };
  const hall = () => {
    const tw = 12, L = layer(tw, GH, 1024, 256), r = mulberry32(701), base = hx('#d8d0c2');
    all(L, rgb(base), dat(0.85, 0.88), 0, 0, tw, GH); grime(L.c, L, 0, 0.2, 1); grime(L.c, L, 1, 0.1, 2);
    for (let y = 0.9; y < 4.2; y += 0.45) { R(L.c, 'rgba(60,50,40,.28)', 0, y, tw, 0.03); R(L.c, 'rgba(255,255,255,.18)', 0, y - 0.025, tw, 0.02); R(L.d, dat(0.45, 0.95), 0, y, tw, 0.03); }   // bossages
    all(L, '#bdb3a2', dat(0.95, 0.85), 0, 0, tw, 0.85); R(L.c, 'rgba(0,0,0,.15)', 0, 0.85, tw, 0.03);   // soubassement
    for (const x of [0.9, 3.2, 9.4]) {                                      // fenêtres barreaudées
      const w = 1.1, h = 1.85, y = 1.2;
      reveal(L, x, y, w, h); glass(L, x + 0.03, y + 0.03, w - 0.06, h - 0.06, r, { lit: 0.35 }); frame(L, x, y, w, h, '#e4dfd4', { bars: 2 });
      for (const [g, c] of [[L.c, '#2a2725'], [L.d, dat(1, 0.45, 0.6)], [L.e, '#000']]) { for (let xx = x + 0.1; xx < x + w; xx += 0.13) R(g, c, xx, y - 0.05, 0.02, h + 0.1); R(g, c, x - 0.03, y + 0.3, w + 0.06, 0.03); R(g, c, x - 0.03, y + h - 0.3, w + 0.06, 0.03); }
      all(L, '#cfc6b5', dat(1, 0.8), x - 0.1, y - 0.08, w + 0.3, 0.08);
    }
    // entrée d'immeuble : porte vitrée, hall éclairé, boîtes aux lettres
    const ex = 5.3, ew = 1.7, eh = 2.7;
    all(L, '#8f8778', dat(0.9, 0.8), ex - 0.25, 0, ew + 0.5, eh + 0.25);
    glass(L, ex, 0, ew, eh, r, { lit: 0, curtain: false, b: 1.1 });
    R(L.c, 'rgba(210,190,150,.35)', ex + 0.1, 0, ew - 0.2, eh * 0.85); R(L.c, 'rgba(90,80,70,.5)', ex + 0.3, 1.0, 0.5, 0.45);
    { const gr = L.e.createLinearGradient(0, 0, 0, eh); gr.addColorStop(0, rgb(SHOPLIT[1], 0.85)); gr.addColorStop(1, rgb(SHOPLIT[1], 0.6)); L.e.fillStyle = gr; L.e.fillRect(ex, 0, ew, eh); }
    frame(L, ex, 0, ew, eh, '#2f3336', { t: 0.07, mid: true, tr: 0.5 });
    all(L, '#b7b9b6', dat(0.9, 0.35, 0.8), ex + ew + 0.08, 1.2, 0.12, 0.2);                               // interphone
    // porte de garage
    const gx = 7.6, gw = 1.5 * 1.0 + 1.0;
    all(L, '#7c7f80', dat(0.7, 0.55, 0.6), gx, 0, gw, 2.3); L.c.fillStyle = 'rgba(0,0,0,.18)'; for (let y = 0.1; y < 2.3; y += 0.12) L.c.fillRect(gx, y, gw, 0.02);
    R(L.c, 'rgba(0,0,0,.3)', gx - 0.04, 2.3, gw + 0.08, 0.06);
    for (const x of [0.6, 2.9, 9.1]) { streak(L, x, 3.3, 1.6, 0.7, 0.12); }
    R(L.c, 'rgba(0,0,0,.2)', 0, 4.25, tw, 0.05);
    grain(L.c, 0.2);
    return material('city:rdc-hall', L, { bump: 0.5 });
  };

  // ---------- toitures (uv = x, z en mètres) ----------
  const flatRoof = (name, col, seams, seed, light) => {
    const t = 8, L = layer(t, t, 512, 512), r = mulberry32(seed), c = hx(col);
    all(L, rgb(c), dat(0.8, light ? 0.7 : 0.95), 0, 0, t, t, null);
    grime(L.c, L, 0, 0.25, 1); grime(L.c, L, 1, 0.2, 2);
    if (!light) { for (let k = 0; k < 2500; k++) R(L.c, rgb(c, 0.65 + 0.7 * r(), 0.7), r() * t, r() * t, 0.03, 0.03);           // gravillons
      for (let k = 0; k < 3; k++) { L.c.fillStyle = 'rgba(30,30,32,.12)'; L.c.beginPath(); L.c.ellipse(r() * t, r() * t, 0.3 + r(), 0.2 + 0.6 * r(), r() * 3, 0, 6.283); L.c.fill(); } }   // reprises d'étanchéité
    for (let x = 0; x < t; x += seams) { R(L.c, light ? 'rgba(255,255,255,.35)' : 'rgba(0,0,0,.18)', x, 0, 0.04, t); R(L.d, dat(1, light ? 0.55 : 0.9), x, 0, 0.04, t); }
    if (light) for (let k = 0; k < 6; k++) streak(L, r() * t, t * r(), 0.5 + r(), 1 + 2 * r(), 0.1, '80,80,70');
    grain(L.c, light ? 0.12 : 0.4);
    return material(name, L, { bump: 0.3, emis: false });
  };
  const tileRoof = () => {                                                // tuiles canal : courants et couvrants, rangs décalés
    const t = 4, L = layer(t, t, 512, 512), r = mulberry32(801), cw = 0.2, rl = 0.38, nc = t / cw;
    const tc = () => { const q = r(); return q < 0.07 ? [22, 30, 38] : q < 0.12 ? [26, 70, 58] : [12 + 12 * r(), 42 + 18 * r(), 44 + 14 * r()]; };   // tuile noircie, tuile neuve
    R(L.c, '#5a3426', 0, 0, t, t); R(L.d, dat(0.1, 0.9), 0, 0, t, t);
    for (let c = 0; c < nc; c++) { const cov = c % 2, x = c * cw, off = cov ? rl / 2 : 0, n = Math.round(t / rl);
      for (let j = -1; j <= n; j++) { const y = j * (t / n) + off, h = t / n + 0.02, [hh, ss, ll] = tc();
        const gr = L.c.createLinearGradient(x, 0, x + cw, 0);
        if (cov) { gr.addColorStop(0, `hsl(${hh},${ss}%,${ll * 0.55}%)`); gr.addColorStop(0.45, `hsl(${hh},${ss}%,${ll * 1.12}%)`); gr.addColorStop(1, `hsl(${hh},${ss}%,${ll * 0.5}%)`); }
        else { gr.addColorStop(0, `hsl(${hh},${ss}%,${ll * 0.85}%)`); gr.addColorStop(0.5, `hsl(${hh},${ss}%,${ll * 0.68}%)`); gr.addColorStop(1, `hsl(${hh},${ss}%,${ll * 0.85}%)`); }
        L.c.fillStyle = gr; L.c.fillRect(x, y, cw, h);
        const gd = L.d.createLinearGradient(x, 0, x + cw, 0);
        if (cov) { gd.addColorStop(0, dat(0.45, 0.8)); gd.addColorStop(0.5, dat(1, 0.72)); gd.addColorStop(1, dat(0.45, 0.8)); } else { gd.addColorStop(0, dat(0.4, 0.85)); gd.addColorStop(0.5, dat(0.15, 0.88)); gd.addColorStop(1, dat(0.4, 0.85)); }
        L.d.fillStyle = gd; L.d.fillRect(x, y, cw, h);
        R(L.c, 'rgba(30,12,6,.45)', x, y, cw, 0.025); R(L.d, dat(0.05, 0.9), x, y, cw, 0.02);              // about de la tuile du rang suivant
      } }
    grime(L.c, L, 0, 0.22, 1); grime(L.c, L, 2, 0.16, 2);
    for (let k = 0; k < 18; k++) { L.c.fillStyle = `rgba(${90 + 40 * r() | 0},${95 + 30 * r() | 0},${70 + 20 * r() | 0},${0.2 + 0.25 * r()})`; L.c.beginPath(); L.c.ellipse(r() * t, r() * t, 0.05 + 0.2 * r(), 0.04 + 0.12 * r(), 0, 0, 6.283); L.c.fill(); }   // lichens
    grain(L.c, 0.25);
    return material('city:tuile-canal', L, { bump: 1.2, emis: false });
  };
  const zinc = () => {
    const t = 4, L = layer(t, t, 512, 512), r = mulberry32(901), s = 0.5, base = hx('#8a9094');
    for (let x = 0; x < t; x += s) all(L, rgb(base, 0.94 + 0.12 * r()), dat(0.7, 0.4 + 0.08 * r(), 0.55), x, 0, s, t, null);
    grime(L.c, L, 1, 0.12, 1); grime(L.c, L, 0, 0.1, 2, 'soft-light');
    for (let x = 0; x < t; x += s) { R(L.c, 'rgba(255,255,255,.3)', x - 0.012, 0, 0.022, t); R(L.c, 'rgba(0,0,0,.25)', x + 0.012, 0, 0.03, t); R(L.d, dat(1, 0.35, 0.7), x - 0.012, 0, 0.025, t); }   // joints debout
    grain(L.c, 0.1);
    return material('city:zinc', L, { bump: 0.6, emis: false });
  };
  const pignon = () => {                                                  // mur pignon aveugle : brique, restes d'enduit
    const tw = 8, th = 8.1, L = layer(tw, th), r = mulberry32(1001);
    const bp = brickPat(L, { bl: 0.4, ch: 0.045, nx: 10, ny: 60, seed: 1002, pal: [[13, 45, 50, 5], [18, 48, 56, 4], [9, 40, 42, 3], [24, 40, 64, 2]] });
    bp.fill(0, 0, tw, th); grime(L.c, L, 0, 0.3, 1); grime(L.c, L, 1, 0.18, 2);
    grime(L.c, L, 1, 0.12, 1, 'soft-light');                                   // brique nue, sans plaques d'enduit (elles faisaient des pois)
    grime(L.c, L, 2, 0.18, 1, 'multiply');
    for (let k = 0; k < 10; k++) streak(L, r() * tw, th * r(), 0.1 + 0.4 * r(), 1 + 2 * r(), 0.12, '40,30,25');
    grain(L.c, 0.25);
    return material('city:pignon', L, { bump: 0.5, emis: false });
  };

  // ---------- monuments : gare Matabiau (pierre et brique, 1905), pavillon de l'horloge, médiathèque, arche ----------
  const STONE = '#ddd1b9';
  const archP = (g, x, y, w, hs) => { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + hs); g.arc(x + w / 2, y + hs, w / 2, Math.PI, 0, true); g.lineTo(x + w, y); g.closePath(); };
  const inArch = (L, x, y, w, hs, fn) => { for (const g of [L.c, L.d, L.e]) { g.save(); archP(g, x, y, w, hs); g.clip(); } fn(); for (const g of [L.c, L.d, L.e]) g.restore(); };
  const bossage = (L, x, y, w, h, step = 0.45) => { all(L, STONE, dat(0.9, 0.82), x, y, w, h); grime(L.c, L, 0, 0.12, 1);
    for (let yy = y + step; yy < y + h; yy += step) { R(L.c, 'rgba(70,55,40,.32)', x, yy, w, 0.035); R(L.c, 'rgba(255,255,255,.2)', x, yy - 0.03, w, 0.025); R(L.d, dat(0.4, 0.95), x, yy, w, 0.035); } };
  const cornice = (L, x, y, w, h) => { all(L, '#e6dbc5', dat(1, 0.78), x, y, w, h); R(L.c, 'rgba(60,45,30,.35)', x, y, w, 0.06);
    for (let xx = x + 0.05; xx < x + w; xx += 0.22) R(L.c, 'rgba(60,45,30,.25)', xx, y + h * 0.35, 0.1, h * 0.25);                 // denticules
    const s = L.c.createLinearGradient(0, y, 0, y - 0.5); s.addColorStop(0, 'rgba(30,20,10,.35)'); s.addColorStop(1, 'rgba(30,20,10,0)'); L.c.fillStyle = s; L.c.fillRect(x, y - 0.5, w, 0.5); };
  // grande baie cintrée vitrée (rez-de-chaussée de la gare) : petits bois, imposte en éventail
  const archWin = (L, r, x, y, w, hs, lit = 0.7) => {
    all(L, '#cdbfa5', dat(0.95, 0.8), x - 0.25, y, w + 0.5, hs + w / 2 + 0.25);
    for (const g of [L.c, L.d]) { g.fillStyle = g === L.c ? '#e3d7bf' : dat(0.95, 0.8); archP(g, x - 0.25, y, w + 0.5, hs); g.fill(); }
    inArch(L, x, y, w, hs, () => { glass(L, x, y, w, hs + w / 2, r, { lit, curtain: false, col: SHOPLIT[1], I: 0.8, b: 0.9 });
      for (const [g, c] of [[L.c, '#3b3f3c'], [L.e, '#000']]) { g.fillStyle = c; for (let k = 1; k < 4; k++) g.fillRect(x + w * k / 4 - 0.025, y, 0.05, hs + w);
        for (let yy = y + 1.1; yy < y + hs; yy += 1.1) g.fillRect(x, yy, w, 0.04); g.fillRect(x, y + hs - 0.03, w, 0.07); } });
    all(L, '#d6c9ae', dat(1, 0.8), x + w / 2 - 0.18, y + hs + w / 2 - 0.1, 0.36, 0.45);                                       // clé de voûte
  };
  const stoneWin = (L, r, x, y, w, h, pediment) => {                        // fenêtre d'étage, encadrement de pierre, fronton
    all(L, '#e3d7bf', dat(0.95, 0.8), x - 0.22, y - 0.12, w + 0.44, h + 0.4);
    if (pediment) { for (const g of [L.c, L.d]) { g.fillStyle = g === L.c ? '#e6dbc5' : dat(1, 0.8); g.beginPath(); g.moveTo(x - 0.4, y + h + 0.3); g.lineTo(x + w + 0.4, y + h + 0.3); g.lineTo(x + w / 2, y + h + 0.95); g.closePath(); g.fill(); }
      R(L.c, 'rgba(50,35,20,.3)', x - 0.4, y + h + 0.28, w + 0.8, 0.05); }
    reveal(L, x, y, w, h); glass(L, x + 0.03, y + 0.03, w - 0.06, h - 0.06, r, { lit: 0.45 }); frame(L, x, y, w, h, '#e8e2d6', { t: 0.06, bars: 3, tr: 0.6 });
    rail(L, x - 0.05, y, w + 0.1, 0.8, true);
  };
  const gare = () => {
    const tw = 5, th = 16, L = layer(tw, th, 512, 1024), r = mulberry32(1301);
    const bp = brickPat(L, { bl: 0.42, ch: 0.075, nx: 12, ny: 40, pal: PAL_TLS, mortar: '#dcc6a8', seed: 1302 });
    bp.fill(0, 0, tw, th); grime(L.c, L, 0, 0.15, 1);
    all(L, '#c9bca2', dat(0.95, 0.85), 0, 0, tw, 0.6);                                                         // soubassement
    bossage(L, 0, 0.6, tw, 5.0);
    archWin(L, r, 1.0, 0.6, 3.0, 3.4);
    cornice(L, 0, 5.6, tw, 0.55);
    bossage(L, 0, 6.15, 0.55, 5.3, 0.5); bossage(L, tw - 0.55, 6.15, 0.55, 5.3, 0.5);                            // chaînes d'angle (pilastres)
    stoneWin(L, r, 1.6, 7.0, 1.8, 3.0, true);
    cornice(L, 0, 11.45, tw, 0.9);
    all(L, STONE, dat(0.9, 0.85), 0, 12.35, tw, 1.15);                                                          // balustrade de l'attique
    for (let x = 0.3; x < tw - 0.2; x += 0.32) { R(L.c, 'rgba(60,45,30,.45)', x + 0.1, 12.5, 0.12, 0.75); R(L.e, '#000', x, 12.5, 0.3, 0.75); }
    all(L, '#e6dbc5', dat(1, 0.8), 0, 13.3, tw, 0.2);
    grain(L.c, 0.18);
    return material('city:gare', L, { bump: 0.5 });
  };
  const horloge = () => {                                                  // façade du pavillon central (18 × 21 m), cadran éclairé la nuit
    const tw = 18, th = 21, L = layer(tw, th, 1024, 1024), r = mulberry32(1401);
    bossage(L, 0, 0, tw, th, 0.5); grime(L.c, L, 1, 0.12, 2);
    all(L, '#c9bca2', dat(0.95, 0.85), 0, 0, tw, 0.6);
    for (const cx of [4.3, 9, 13.7]) archWin(L, r, cx - 1.7, 0.6, 3.4, 3.6, 1);
    cornice(L, 0, 6.2, tw, 0.6);
    for (const cx of [4.3, 9, 13.7]) stoneWin(L, r, cx - 1.0, 7.4, 2.0, 3.4, cx === 9);
    for (const x of [0, 6.4, 11, tw - 0.7]) all(L, '#e6dbc5', dat(1, 0.8), x, 6.8, 0.7, 5.6);                      // pilastres
    cornice(L, 0, 12.4, tw, 1.0);
    // attique de l'horloge
    all(L, '#e3d7bf', dat(0.95, 0.82), 4.2, 13.4, 9.6, 6.4);
    for (const x of [4.2, 13.1]) all(L, '#d8cbb0', dat(0.95, 0.82), x, 13.4, 0.7, 6.4);
    const cx = 9, cy = 16.6, R0 = 2.35;
    for (const [g, c] of [[L.c, '#d0c3a6'], [L.d, dat(1, 0.8)]]) { g.fillStyle = c; g.beginPath(); g.arc(cx, cy, R0 + 0.35, 0, 6.283); g.fill(); }
    for (const [g, c] of [[L.c, '#f4f0e4'], [L.d, dat(0.3, 0.25, 0.1)], [L.e, '#fff3dc']]) { g.fillStyle = c; g.beginPath(); g.arc(cx, cy, R0, 0, 6.283); g.fill(); }
    for (const g of [L.c, L.e]) { g.fillStyle = '#1d1c1a'; g.strokeStyle = '#1d1c1a';
      for (let k = 0; k < 60; k++) { const a = k / 60 * 6.283, l = k % 5 ? 0.12 : 0.38, w = k % 5 ? 0.03 : 0.09;
        g.save(); g.translate(cx, cy); g.rotate(-a); g.fillRect(-w / 2, R0 - 0.08 - l, w, l); g.restore(); }
      g.lineCap = 'round'; g.lineWidth = 0.16; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.sin(-0.52) * 1.25, cy + Math.cos(-0.52) * 1.25); g.stroke();   // 10 h 10
      g.lineWidth = 0.1; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.sin(1.05) * 1.95, cy + Math.cos(1.05) * 1.95); g.stroke(); }
    cornice(L, 3.8, 19.8, 10.4, 0.7); all(L, '#e6dbc5', dat(1, 0.8), 0, 20.5, tw, 0.5);
    grain(L.c, 0.16);
    return material('city:gare-horloge', L, { bump: 0.45 });
  };
  const verriere = () => {                                                 // mur-rideau de la médiathèque : grands vitrages, raidisseurs fins
    const tw = 6, th = 6, L = layer(tw, th, 512, 512), r = mulberry32(1501);
    for (let x = 0; x < tw; x += 1.5) for (let y = 0; y < th; y += 2) {
      glass(L, x, y, 1.5, 2, r, { lit: 0, curtain: false, b: 1.15, tint: [0.9, 1, 1.06], metal: 0.55 });
      const I = 0.55 + 0.25 * r(), gr = L.e.createLinearGradient(0, y, 0, y + 2); gr.addColorStop(0, rgb(SHOPLIT[2], 0.5 * I)); gr.addColorStop(1, rgb(SHOPLIT[0], I)); L.e.fillStyle = gr; L.e.fillRect(x, y, 1.5, 2);
      if (y === 0 || y === 4) for (let k = 0; k < 3; k++) R(L.e, 'rgba(0,0,0,.35)', x + 0.1 + r() * 1.1, y + 0.2, 0.25 + 0.2 * r(), 1.3 + 0.3 * r());   // rayonnages en contre-jour
    }
    for (let x = 0; x <= tw; x += 1.5) all(L, '#c9ced2', dat(0.9, 0.3, 0.85), x - 0.03, 0, 0.06, th);
    for (let y = 0; y <= th; y += 2) all(L, '#c9ced2', dat(0.9, 0.3, 0.85), 0, y - 0.04, tw, y % 6 ? 0.06 : 0.14);
    grain(L.c, 0.06);
    return material('city:verriere', L, { bump: 0.2, env: 1.2 });
  };
  const pierreBureaux = () => {                                             // béton blanc de l'arche Marengo : fenêtres verticales régulières
    const tw = 3, th = 3.5, L = layer(tw, th, 256, 256), r = mulberry32(1601);
    all(L, '#e9e5dc', dat(0.85, 0.8), 0, 0, tw, th); grime(L.c, L, 0, 0.1, 1);
    R(L.c, 'rgba(0,0,0,.08)', 0, 0, tw, 0.03); R(L.c, 'rgba(0,0,0,.06)', 0, 0, 0.03, th);
    reveal(L, 0.95, 0.8, 1.1, 2.2, 0.08); glass(L, 0.95, 0.8, 1.1, 2.2, r, { lit: 0.5, curtain: false, col: OFFICE[0], b: 0.9, metal: 0.5 });
    frame(L, 0.95, 0.8, 1.1, 2.2, '#9aa0a4', { t: 0.05, mid: false });
    grain(L.c, 0.1);
    return material('city:arche', L, { bump: 0.3 });
  };
  const vegetal = () => {                                                  // toiture végétalisée : sédums, bordure de gravier
    const t = 8, L = layer(t, t, 512, 512), r = mulberry32(1701);
    all(L, '#6c7a40', dat(0.6, 0.95), 0, 0, t, t, null);
    for (let k = 0; k < 900; k++) { const c = pick(r, ['#7f8c48', '#5d6b35', '#8f7d43', '#8a4f3a', '#a39a52', '#4f5e30']); L.c.fillStyle = c; L.c.globalAlpha = 0.55;
      L.c.beginPath(); L.c.ellipse(r() * t, r() * t, 0.08 + 0.3 * r(), 0.06 + 0.22 * r(), r() * 3, 0, 6.283); L.c.fill(); }
    L.c.globalAlpha = 1; grime(L.c, L, 0, 0.3, 1); grime(L.c, L, 1, 0.2, 2, 'soft-light'); grain(L.c, 0.35);
    return material('city:toit-vegetal', L, { bump: 0.8, emis: false });
  };

  // ---------- assemblage ----------
  const PAL_PINK = [[16, 46, 62, 5], [20, 50, 66, 4], [12, 44, 55, 3], [26, 42, 72, 2], [10, 38, 46, 1]];
  const briqueA = classic('city:brique', { bay: 3.4, fh: 3.3, nb: 4, nf: 4, courses: 74, bl: 0.425, bnx: 16, seed: 101, ww: 1.2, wh: 2.5, sill: 0.15,
    surround: 'brick', pShut: 0.7, pRail: 0.6, shutCols: [...SHUT_BLUE, ...SHUT_FADED], mortar: '#d6bfa3', pal: PAL_TLS, attic: false });
  const briqueB = classic('city:brique-pierre', { bay: 3.2, fh: 3.4, nb: 4, nf: 4, courses: 74, bl: 0.4, bnx: 16, seed: 151, ww: 1.15, wh: 2.45, sill: 0.15,
    surround: 'stone', pShut: 0.45, pRail: 0.95, shutCols: [...SHUT_GREEN, ...SHUT_FADED], mortar: '#dcc8ae', pal: PAL_PINK });
  const enduitBrique = classic('city:brique-enduit', { bay: 3.2, fh: 3.2, nb: 4, nf: 4, courses: 70, bl: 0.4, bnx: 16, seed: 201, ww: 1.1, wh: 2.3, sill: 0.4,
    render: '#dcb592', pShut: 0.75, pRail: 0.4, shutCols: [...SHUT_GREEN, ...SHUT_BLUE, ...SHUT_FADED], mortar: '#d9c4a6', pal: PAL_TLS });
  const enduitRose = classic('city:enduit-rose', { bay: 3.2, fh: 3.2, nb: 4, nf: 4, courses: 70, bl: 0.4, bnx: 16, seed: 251, ww: 1.1, wh: 2.3, sill: 0.4,
    render: '#e3bba6', pShut: 0.8, pRail: 0.3, shutCols: [...SHUT_BLUE, ...SHUT_FADED], mortar: '#dbc6aa', pal: PAL_PINK });
  const enduitA = modern('city:enduit', { seed: 301, render: '#e8e2d5', cols: ['win', 'loggia', 'win', 'small'] });
  const enduitB = modern('city:enduit-beige', { seed: 351, render: '#dccdb3', cols: ['loggia', 'win', 'win', 'loggia'], railKind: 1, panel: 'rgba(170,120,90,.9)' });
  const contempA = contemp('city:brique-contemporaine', { seed: 401, mortar: '#b9b3aa', pal: [[16, 48, 50, 4], [12, 45, 44, 3], [20, 46, 58, 3], [8, 35, 36, 1], [24, 40, 64, 1]] });
  const bur = offices('city:bureaux', { seed: 501, spandrel: '#36414b', b: 1.1, tint: [0.92, 1, 1.08] });
  const bet = concrete('city:beton', { seed: 601, col: '#a6a49e' });
  // variantes : volets lie-de-vin / bruns, enduit ocre à volets gris
  const SHUT_WINE = ['#7a3b33', '#8a4a3c', '#6b3a32', '#91574a'].map(hx), SHUT_GREY = ['#c9c6bd', '#b7b8b3', '#d8d3c6', '#a9aeb0'].map(hx);
  const briqueC = classic('city:brique-volets', { bay: 3.3, fh: 3.3, nb: 4, nf: 4, courses: 74, bl: 0.41, bnx: 16, seed: 121, ww: 1.15, wh: 2.45, sill: 0.15,
    surround: 'brick', pShut: 0.8, pRail: 0.5, shutCols: [...SHUT_WINE, ...SHUT_FADED], mortar: '#d3baa0', pal: PAL_TLS });
  const enduitOcre = classic('city:enduit-ocre', { bay: 3.2, fh: 3.2, nb: 4, nf: 4, courses: 70, bl: 0.4, bnx: 16, seed: 271, ww: 1.1, wh: 2.3, sill: 0.4,
    render: '#d9b183', pShut: 0.85, pRail: 0.35, shutCols: [...SHUT_GREY, ...SHUT_GREEN], mortar: '#d8c2a2', pal: PAL_PINK });
  // bay = largeur de travée (m) : city.js arrondit chaque pan de mur à un nombre entier de travées ; nf = niveaux par tuile
  // old = faubourg XIXe (toits de tuiles, cheminées) ; floors = plage de niveaux plausible
  const facades = [
    { key: 'brique', pv: [2.97, 3.28], mat: briqueA.mat, floorH: 3.3, groundH: 4.5, bay: 3.4, nf: 4, old: true, weight: 0.2, minH: 12, maxH: 25 },
    { key: 'briquePierre', pv: [3.05, 3.38], mat: briqueB.mat, floorH: 3.4, groundH: 4.5, bay: 3.2, nf: 4, old: true, weight: 0.12, minH: 12, maxH: 25 },
    { key: 'briqueVolets', pv: [2.95, 3.28], mat: briqueC.mat, floorH: 3.3, groundH: 4.5, bay: 3.3, nf: 4, old: true, weight: 0.14, minH: 12, maxH: 25 },
    { key: 'briqueEnduit', pv: [3.02, 3.18], mat: enduitBrique.mat, floorH: 3.2, groundH: 4.5, bay: 3.2, nf: 4, old: true, weight: 0.12, minH: 10, maxH: 22 },
    { key: 'enduitRose', pv: [3.02, 3.18], mat: enduitRose.mat, floorH: 3.2, groundH: 4.5, bay: 3.2, nf: 4, old: true, weight: 0.08, minH: 10, maxH: 22 },
    { key: 'enduitOcre', pv: [3.02, 3.18], mat: enduitOcre.mat, floorH: 3.2, groundH: 4.5, bay: 3.2, nf: 4, old: true, weight: 0.08, minH: 10, maxH: 22 },
    { key: 'enduit', pv: [0.01, 0.16], mat: enduitA.mat, floorH: 2.9, groundH: 4.0, bay: 3, nf: 5, weight: 0.12, minH: 9, maxH: 36 },
    { key: 'enduitBeige', pv: [0.01, 0.16], mat: enduitB.mat, floorH: 2.9, groundH: 4.0, bay: 3, nf: 5, weight: 0.08, minH: 9, maxH: 36 },
    { key: 'briqueContemporaine', pv: [2.64, 2.98], mat: contempA.mat, floorH: 3.0, groundH: 4.5, bay: 3.6, nf: 4, weight: 0.12, minH: 9, maxH: 28 },
    { key: 'bureaux', pv: [0.05, 0.88], mat: bur.mat, floorH: 3.6, groundH: 4.5, bay: 1.35, nf: 4, weight: 0.07, minH: 15, maxH: 80 },
    { key: 'beton', pv: [0.1, 1.0], mat: bet.mat, floorH: 4.0, groundH: 4.5, bay: 3, nf: 4, weight: 0.05, minH: 8, maxH: 30 },
  ];
  const shops = [vitrine(), arcade(), hall()];
  const roofs = { flat: flatRoof('city:toit-gravillons', '#77746d', 1, 1101, false), flatLight: flatRoof('city:toit-membrane', '#cfccc4', 2, 1201, true), tile: tileRoof(), zinc: zinc(), green: vegetal() };
  const blank = pignon();
  // monuments
  const land = { gare: gare(), horloge: horloge(), verriere: verriere(), arche: pierreBureaux() };
  const genMs = performance.now() - t0;
  // allumage : logements au crépuscule puis la nuit, bureaux surtout au crépuscule, vitrines plus fortes
  const setLight = (dusk, night) => {
    const k = 0.25 * dusk * dusk + 0.9 * night, kb = 0.4 * dusk * dusk + 0.45 * night;
    for (const f of facades) f.mat.emissiveIntensity = f.key === 'bureaux' || f.key === 'beton' ? kb : k;
    for (const m of shops) m.emissiveIntensity = 1.1 * k;
    land.gare.emissiveIntensity = 1.1 * k; land.horloge.emissiveIntensity = 1.3 * k; land.verriere.emissiveIntensity = 0.5 * dusk + 0.6 * night; land.arche.emissiveIntensity = kb;
  };
  return { facades, shops, roofs, blank, land, setLight, genMs };
}
