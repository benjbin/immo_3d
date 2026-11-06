// Canopée — tour/cityfar.js
// Ville lointaine (au-delà du rayon de la ville détaillée) jusqu’à l’horizon : centre de briques roses et toits de
// tuiles, faubourgs, rues, voies ferrées et parcs (city-far.bin + city.far, © les contributeurs d'OpenStreetMap, ODbL).
// Contrat : buildFar(THREE, M, ctx) → THREE.Group ou null (null : city.js garde sa version simple).
// ctx = { data, T, TP, near, inKeep, keepSeg, radius, rnd, CM, farBuf } (voir createCity dans city.js).
// Le groupe porte userData.onLight(dusk, night) (0..1 chacun), appelé à chaque changement d'heure.
// Géométrie fusionnée à la main (tableaux typés), quatre quadrants par matériau pour le tri de visibilité :
// 3 matériaux de bâti × 4 quadrants + 4 sols = 16 appels de rendu. L'eau (Garonne, canal de Brienne) est dessinée
// par water.js, qui perce aussi le sol de landscape.js.
import { mulberry32, fbm2 } from '../materials.js';

// ---------- accumulateur extensible : positions, normales, uv, couleurs, indices ----------
class Acc {
  constructor(n = 8192) { this.P = new Float32Array(n * 3); this.N = new Float32Array(n * 3); this.U = new Float32Array(n * 2); this.C = new Float32Array(n * 3); this.I = new Uint32Array(n * 2); this.nv = 0; this.ni = 0; }
  need(nv, ni) {   // réserve nv sommets et ni indices
    const cap = this.P.length / 3;
    if (this.nv + nv > cap) { const c = Math.max(cap * 2, this.nv + nv); for (const [k, s] of [['P', 3], ['N', 3], ['U', 2], ['C', 3]]) { const a = new Float32Array(c * s); a.set(this[k]); this[k] = a; } }
    if (this.ni + ni > this.I.length) { const a = new Uint32Array(Math.max(this.I.length * 2, this.ni + ni)); a.set(this.I); this.I = a; }
  }
  v(x, y, z, nx, ny, nz, u, w, r, g, b) {
    const i = this.nv++, p = i * 3, q = i * 2, P = this.P, N = this.N, C = this.C;
    P[p] = x; P[p + 1] = y; P[p + 2] = z; N[p] = nx; N[p + 1] = ny; N[p + 2] = nz; C[p] = r; C[p + 1] = g; C[p + 2] = b; this.U[q] = u; this.U[q + 1] = w;
    return i;
  }
  t(a, b, c) { const I = this.I, k = this.ni; I[k] = a; I[k + 1] = b; I[k + 2] = c; this.ni += 3; }
  // triangle horizontal tourné vers le haut (même test que faceUp de city.js)
  up(a, b, c) {
    const P = this.P, A = a * 3, B = b * 3, Cc = c * 3;
    const ny = (P[Cc] - P[A]) * (P[B + 2] - P[A + 2]) - (P[B] - P[A]) * (P[Cc + 2] - P[A + 2]);
    if (ny < 0) this.t(a, c, b); else this.t(a, b, c);
  }
  mesh(THREE, mat, name) {
    if (!this.ni) return null;
    const g = new THREE.BufferGeometry(), n = this.nv;
    g.setAttribute('position', new THREE.BufferAttribute(this.P.slice(0, n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.N.slice(0, n * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.U.slice(0, n * 2), 2));
    g.setAttribute('color', new THREE.BufferAttribute(this.C.slice(0, n * 3), 3));
    g.setIndex(new THREE.BufferAttribute(n < 65536 ? Uint16Array.from(this.I.subarray(0, this.ni)) : this.I.slice(0, this.ni), 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat); m.name = name; m.matrixAutoUpdate = false; m.updateMatrix();
    m.castShadow = false; m.receiveShadow = false;
    return m;
  }
}

const inPoly = (x, z, X, Z, n) => { let c = false; for (let i = 0, j = n - 1; i < n; j = i++) if ((Z[i] > z) !== (Z[j] > z) && x < (X[j] - X[i]) * (z - Z[i]) / (Z[j] - Z[i]) + X[i]) c = !c; return c; };

export function buildFar(THREE, M, ctx) {
  const { data, T, radius = 560, farBuf } = ctx;
  const far = data && data.far;
  if (!farBuf && !far) return null;
  const t0 = performance.now();
  const group = new THREE.Group(); group.name = 'villeLointaine';
  const rnd = mulberry32(4242);
  const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };   // sRGB → linéaire (vertex colors)
  const pick = (a) => a[(rnd() * a.length) | 0];

  // repère : T est affine (rotation + translation), on en tire la matrice une fois pour toutes
  const o = T([0, 0]), ex = T([1, 0]), ez = T([0, 1]);
  const exx = ex[0] - o[0], exz = ex[1] - o[1], ezx = ez[0] - o[0], ezz = ez[1] - o[1];
  const TX = (e, s) => o[0] + e * exx + s * ezx, TZ = (e, s) => o[1] + e * exz + s * ezz;

  // ---------- textures procédurales ----------
  const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const texOf = (c, srgb = true) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  const r2 = mulberry32(77);
  // façade : tuile de 8 travées × 8 niveaux (3,3 m × 3 m) ; base claire teintée par la couleur de sommet,
  // fenêtres sombres ou volets (bleu-gris, vert, passés) ; carte émissive : fenêtres éclairées au hasard
  const NB = 8, BAY = 3.3, FLR = 3.0, TWU = NB * BAY, THV = NB * FLR;
  const facC = cv(256, 256), facE = cv(256, 256), gC = facC.getContext('2d'), gE = facE.getContext('2d');
  {
    const S = 32;
    gC.fillStyle = '#f1ece4'; gC.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2500; i++) { const v = 215 + r2() * 40 | 0; gC.fillStyle = `rgba(${v},${v - 4},${v - 10},.35)`; gC.fillRect(r2() * 256, r2() * 256, 2, 2); }
    gE.fillStyle = '#000'; gE.fillRect(0, 0, 256, 256);
    const SHUT = ['#8fa2ae', '#97a99c', '#b9b1a2', '#a2a9ab', '#c9c2b4'], WARM = ['#ffc27a', '#ffd29a', '#ffb767', '#ffe0b5', '#ffcf8f'];
    for (let fy = 0; fy < NB; fy++) for (let bx = 0; bx < NB; bx++) {
      // v = 0 en bas de la tuile (pied du bâtiment) : le canvas a y vers le bas, rang 0 = haut du canvas = niveau NB−1
      const x = bx * S + 9, y = fy * S + 7, w = 14, h = 18, rr = r2();
      gC.fillStyle = 'rgba(120,110,100,.25)'; gC.fillRect(x - 1, y - 1, w + 2, h + 2);
      if (rr < 0.16) gC.fillStyle = SHUT[(r2() * SHUT.length) | 0];
      else { const k = 40 + r2() * 30 | 0; gC.fillStyle = `rgb(${k},${k + 6},${k + 14})`; }
      gC.fillRect(x, y, w, h);
      gC.fillStyle = 'rgba(255,255,255,.55)'; gC.fillRect(x - 2, y + h, w + 4, 2);                  // appui
      if (rr >= 0.16 && r2() < 0.42) { const c = WARM[(r2() * WARM.length) | 0], k = 0.45 + 0.55 * r2(); gE.globalAlpha = k; gE.fillStyle = c; gE.fillRect(x, y, w, h); gE.globalAlpha = 1; }
    }
  }
  // murs nus (hangars, églises, équipements) : panneaux discrets et salissures
  const bareC = cv(256, 256);
  {
    const g = bareC.getContext('2d'); g.fillStyle = '#ece8e1'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 4000; i++) { const v = 200 + r2() * 55 | 0; g.fillStyle = `rgba(${v},${v - 3},${v - 8},.4)`; g.fillRect(r2() * 256, r2() * 256, 2, 3); }
    g.fillStyle = 'rgba(90,85,80,.18)'; for (let x = 0; x < 256; x += 32) g.fillRect(x, 0, 2, 256);
    g.fillStyle = 'rgba(70,72,78,.55)'; g.fillRect(0, 100, 256, 10);                                        // bandeau vitré haut
    const grd = g.createLinearGradient(0, 200, 0, 256); grd.addColorStop(0, 'rgba(80,70,60,0)'); grd.addColorStop(1, 'rgba(80,70,60,.25)'); g.fillStyle = grd; g.fillRect(0, 200, 256, 56);
  }
  // toits : grain et rangs de tuiles très fins (tuile de 16 m)
  const roofC = cv(128, 128);
  {
    const g = roofC.getContext('2d'), im = g.createImageData(128, 128);
    for (let y = 0, i = 0; y < 128; y++) for (let x = 0; x < 128; x++, i += 4) {
      const n = 0.82 + 0.22 * fbm2(x / 9, y / 9, 3, 13) + 0.08 * (r2() - 0.5) - (y % 4 === 0 ? 0.08 : 0);
      im.data[i] = im.data[i + 1] = im.data[i + 2] = Math.max(0, Math.min(255, n * 235)); im.data[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
  }

  // parcs, jardins et cimetières lointains : herbe olive piquée de houppiers (tuile de 64 m)
  const parkC = cv(256, 256);
  {
    const g = parkC.getContext('2d'); g.fillStyle = '#6a7442'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1800; i++) { const v = r2(); g.fillStyle = v < 0.5 ? 'rgba(150,160,90,.35)' : 'rgba(95,105,55,.35)'; g.fillRect(r2() * 256, r2() * 256, 3, 3); }
    for (let i = 0; i < 520; i++) {   // houppiers, avec leur ombre et un reflet
      const x = r2() * 256, y = r2() * 256, r = 6 + r2() * 10, c = ['#3f5127', '#4a5c2d', '#384a23', '#536532'][(r2() * 4) | 0];
      for (const [dx, dy] of [[0, 0], [256, 0], [-256, 0], [0, 256], [0, -256]]) {
        g.fillStyle = 'rgba(40,45,25,.35)'; g.beginPath(); g.arc(x + dx + r * 0.3, y + dy + r * 0.3, r, 0, 7); g.fill();
        g.fillStyle = c; g.beginPath(); g.arc(x + dx, y + dy, r, 0, 7); g.fill();
        g.fillStyle = 'rgba(160,175,100,.25)'; g.beginPath(); g.arc(x + dx - r * 0.3, y + dy - r * 0.3, r * 0.5, 0, 7); g.fill();
      }
    }
  }

  // ---------- matériaux ----------
  const facTex = texOf(facC), facEm = texOf(facE), bareTex = texOf(bareC), roofTex = texOf(roofC);
  const MAT = {
    wall: new THREE.MeshStandardMaterial({ name: 'far:facades', map: facTex, vertexColors: true, roughness: 0.88, emissive: 0xffffff, emissiveMap: facEm, emissiveIntensity: 0 }),
    bare: new THREE.MeshStandardMaterial({ name: 'far:murs', map: bareTex, vertexColors: true, roughness: 0.9 }),
    roof: new THREE.MeshStandardMaterial({ name: 'far:toits', map: roofTex, vertexColors: true, roughness: 0.92 }),
    asph: new THREE.MeshStandardMaterial({ name: 'far:chaussee', color: 0x5a5b5e, roughness: 0.95, emissive: 0xff9a40, emissiveIntensity: 0 }),
    walk: new THREE.MeshStandardMaterial({ name: 'far:trottoir', color: 0x9d988f, roughness: 0.95 }),
    rail: new THREE.MeshStandardMaterial({ name: 'far:ballast', color: 0x6c645b, roughness: 0.97 }),
    park: new THREE.MeshStandardMaterial({ name: 'far:parcs', map: texOf(parkC), roughness: 0.95 }),
  };
  // sols empilés : même ordre que city.js (eau < ballast < herbe < voie < trottoir < pavés < chaussée), la chaussée
  // lointaine cède à la chaussée détaillée là où elles se recouvrent (anneau de raccord)
  for (const [m, f] of [[MAT.rail, 2], [MAT.walk, 5], [MAT.asph, 6]]) { m.polygonOffset = true; m.polygonOffsetFactor = -f; m.polygonOffsetUnits = -4 * f; }
  MAT.park.polygonOffset = true; MAT.park.polygonOffsetFactor = -3; MAT.park.polygonOffsetUnits = -10;   // sous l'herbe détaillée (−3/−12) là où elles se recouvrent

  // ---------- palettes (sRGB → linéaire) ----------
  const PAL = {
    brick: ['#c27a5c', '#b76c52', '#cd8a6b', '#d49a7e', '#bf7f66', '#c98f73', '#ad6650'].map(lin),     // brique foraine
    render: ['#e3d6c3', '#dccbb2', '#e8dfd0', '#d9b99f', '#e0c3a6', '#d6cbb9', '#ebe4d8', '#d8a68c'].map(lin),
    office: ['#a7b0b6', '#c8c5bd', '#8f9ba5', '#b7bcbd', '#d0cbc0'].map(lin),
    retail: ['#d4cec2', '#bdb7ac', '#c9c0b0'].map(lin),
    indus: ['#b9b5ac', '#a2a6a8', '#c6c0b3', '#9b9890', '#b0aa9c'].map(lin),
    civic: ['#c98a6c', '#d8cbb5', '#c27f62', '#ddd2c0'].map(lin),
    church: ['#b8694d', '#c27556', '#ad6248'].map(lin),
    tile: ['#b0583a', '#a34f36', '#bd6646', '#9b5844', '#c27352', '#ab6045', '#b86a4e'].map(lin),
    flat: ['#8d8a84', '#7a7771', '#a5a29b', '#b8b5ad', '#94928b', '#6f6d69'].map(lin),
  };

  // ---------- lecture de city-far.bin ----------
  let nB = 0, scale = 0.1, dv = null;
  if (farBuf && farBuf.byteLength >= 16) {
    dv = new DataView(farBuf);
    const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
    if (magic === 'CFAR' && dv.getUint32(4, true) === 1) { nB = dv.getUint32(8, true); scale = dv.getFloat32(12, true) || 0.1; } else dv = null;
  }

  // repères : monuments (city.far.landmarks) et centre historique (Capitole) pour le choix des teintes
  const LM = ((far && far.landmarks) || []).filter((l) => l && Number.isFinite(l.x) && Number.isFinite(l.z))
    .map((l) => ({ name: l.name || '', x: TX(l.x, l.z), z: TZ(l.x, l.z), h: l.h || 0, used: false }));
  const cap = LM.find((l) => /capitole/i.test(l.name));
  const CX = cap ? cap.x : TX(-800, 640), CZ = cap ? cap.z : TZ(-800, 640);

  const S = (k) => [0, 1, 2, 3].map(() => new Acc(k));
  const A = { wall: S(32768), bare: S(4096), roof: S(16384) };
  const sec = (x, z) => ((Math.atan2(z, x) + Math.PI) / (Math.PI / 2)) & 3;

  // ---------- primitives ----------
  // façades le long d'un anneau (sens de city.js : normale extérieure (−dz, 0, dx)) ; v = hauteur au-dessus du sol
  const walls = (acc, X, Z, n, y0, y1, col, uOff, uS, vS) => {
    acc.need(n * 4, n * 6);
    const [r, g, b] = col, kb = 0.74;
    let u = uOff;
    for (let i = 0; i < n; i++) {
      const j = i + 1 === n ? 0 : i + 1, ax = X[i], az = Z[i], bx = X[j], bz = Z[j], dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
      if (L < 0.05) continue;
      const nx = -dz / L, nz = dx / L, u1 = u + L * uS;
      const a0 = acc.v(ax, y0, az, nx, 0, nz, u, y0 * vS, r * kb, g * kb, b * kb);
      acc.v(bx, y0, bz, nx, 0, nz, u1, y0 * vS, r * kb, g * kb, b * kb);
      acc.v(bx, y1, bz, nx, 0, nz, u1, y1 * vS, r, g, b);
      acc.v(ax, y1, az, nx, 0, nz, u, y1 * vS, r, g, b);
      acc.t(a0, a0 + 1, a0 + 2); acc.t(a0, a0 + 2, a0 + 3);
      u = u1;
    }
  };
  const V2 = THREE.Vector2;
  const flat = (acc, X, Z, n, y, col) => {   // toit-terrasse (ou dalle) horizontal
    acc.need(n, (n - 2) * 3);
    const b0 = acc.nv, [r, g, b] = col;
    for (let i = 0; i < n; i++) acc.v(X[i], y, Z[i], 0, 1, 0, X[i] / 16, -Z[i] / 16, r, g, b);
    if (n <= 4) { acc.up(b0, b0 + 1, b0 + 2); if (n === 4) acc.up(b0, b0 + 2, b0 + 3); return; }
    const pts = []; for (let i = 0; i < n; i++) pts.push(new V2(X[i], Z[i]));
    const tri = THREE.ShapeUtils.triangulateShape(pts, []);
    acc.need(0, tri.length * 3);
    for (const [a, b2, c] of tri) acc.up(b0 + a, b0 + b2, b0 + c);
  };
  // face de toit plane (3 ou 4 sommets), normale calculée, tournée vers le haut
  const face = (acc, pts, col) => {
    const [p, q, s] = pts;
    let nx = (q[1] - p[1]) * (s[2] - p[2]) - (q[2] - p[2]) * (s[1] - p[1]), ny = (q[2] - p[2]) * (s[0] - p[0]) - (q[0] - p[0]) * (s[2] - p[2]), nz = (q[0] - p[0]) * (s[1] - p[1]) - (q[1] - p[1]) * (s[0] - p[0]);
    let flip = false; if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; flip = true; }
    const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
    acc.need(pts.length, (pts.length - 2) * 3);
    const b0 = acc.nv, [r, g, b] = col;
    for (const [x, y, z] of pts) acc.v(x, y, z, nx, ny, nz, x / 16, -z / 16 + y / 16, r, g, b);
    for (let i = 1; i < pts.length - 1; i++) flip ? acc.t(b0, b0 + i + 1, b0 + i) : acc.t(b0, b0 + i, b0 + i + 1);
  };
  // toit de tuiles : croupe sur les plans à 4 côtés, pavillon (pointe au centre) sinon
  const tiled = (acc, X, Z, n, h, area, cx, cz, col) => {
    if (n === 4) {
      const l0 = Math.hypot(X[1] - X[0], Z[1] - Z[0]) + Math.hypot(X[3] - X[2], Z[3] - Z[2]), l1 = Math.hypot(X[2] - X[1], Z[2] - Z[1]) + Math.hypot(X[0] - X[3], Z[0] - Z[3]);
      const k = l0 >= l1 ? 0 : 1, a = k, b = k + 1, c = (k + 2) & 3, d = (k + 3) & 3;      // côtés longs ab et cd
      const m1 = [(X[d] + X[a]) / 2, (Z[d] + Z[a]) / 2], m2 = [(X[b] + X[c]) / 2, (Z[b] + Z[c]) / 2];
      const w = (k ? l0 : l1) / 2, Lr = Math.hypot(m2[0] - m1[0], m2[1] - m1[1]), rise = Math.min(4, w * 0.18);
      if (Lr > w * 1.05) {
        const ux = (m2[0] - m1[0]) / Lr, uz = (m2[1] - m1[1]) / Lr, e = w / 2;
        const R1 = [m1[0] + ux * e, h + rise, m1[1] + uz * e], R2 = [m2[0] - ux * e, h + rise, m2[1] - uz * e];
        const P = (i) => [X[i], h, Z[i]];
        face(acc, [P(a), P(b), R2, R1], col); face(acc, [P(b), P(c), R2], col); face(acc, [P(c), P(d), R1, R2], col); face(acc, [P(d), P(a), R1], col);
        return;
      }
    }
    const ap = [cx, h + Math.min(3.5, Math.sqrt(area) * 0.16), cz];
    for (let i = 0; i < n; i++) { const j = i + 1 === n ? 0 : i + 1; face(acc, [[X[i], h, Z[i]], [X[j], h, Z[j]], ap], col); }
  };
  // prisme régulier (tours de monuments) et flèche
  const ring = (cx, cz, r, ns, rot) => { const X = new Float64Array(ns), Z = new Float64Array(ns); for (let i = 0; i < ns; i++) { const a = rot - i / ns * Math.PI * 2; X[i] = cx + Math.cos(a) * r; Z[i] = cz + Math.sin(a) * r; } return [X, Z]; };
  const orient = (X, Z, n) => { let s = 0; for (let i = 0; i < n; i++) { const j = (i + 1) % n; s += X[i] * Z[j] - X[j] * Z[i]; } if (s > 0) { X.subarray(0, n).reverse(); Z.subarray(0, n).reverse(); } };
  const prism = (k, cx, cz, r, ns, y0, y1, col, roofCol) => {
    const [X, Z] = ring(cx, cz, r, ns, Math.PI / ns); orient(X, Z, ns);
    walls(A.bare[k], X, Z, ns, y0, y1, col, 0, 1 / 32, 1 / 32); flat(A.roof[k], X, Z, ns, y1, roofCol);
  };
  const spire = (k, cx, cz, r, ns, y0, y1, col) => {
    const [X, Z] = ring(cx, cz, r, ns, Math.PI / ns);
    for (let i = 0; i < ns; i++) { const j = (i + 1) % ns; face(A.roof[k], [[X[i], y0, Z[i]], [X[j], y0, Z[j]], [cx, y1, cz]], col); }
  };
  // clocher toulousain : base carrée puis étages octogonaux en retrait (Saint-Sernin, Jacobins, Taur…)
  const belfry = (k, cx, cz, hb, h, octo) => {
    const brick = PAL.church[0], stone = lin('#d9c6aa'), slate = octo ? lin('#c99a7c') : lin('#6f6a66');   // flèche de brique et pierre (Saint-Sernin), ardoise ailleurs
    if (octo) {
      prism(k, cx, cz, 9, 4, 0, hb + 4, brick, brick);
      const nT = 5, top = Math.max(hb + 14, h * 0.74), th = (top - hb - 4) / nT;
      for (let t = 0; t < nT; t++) prism(k, cx, cz, 6.6 - t * 0.55, 8, hb + 4 + t * th, hb + 4 + (t + 1) * th - 0.4, t % 2 ? brick : PAL.church[1], stone);
      spire(k, cx, cz, 6.6 - nT * 0.55 + 0.3, 8, top, h, slate);
    } else {
      const top = Math.max(hb + 8, h * 0.68);
      prism(k, cx, cz, 6.5, 4, 0, top, brick, brick);
      spire(k, cx, cz, 5.2, 4, top, h, slate);
    }
  };

  // dôme (la Grave) : tambour octogonal puis calotte à facettes, lanterne
  const dome = (k, cx, cz, hb, h) => {
    const stone = lin('#d9c6aa'), lead = lin('#7d8a8a'), r0 = Math.max(8, (h - hb) * 0.55), yd = hb + (h - hb) * 0.3;
    prism(k, cx, cz, r0, 16, 0, yd, stone, stone);
    const nR = 4; let yp = yd, rp = r0;
    for (let i = 1; i <= nR; i++) {
      const a = i / nR * Math.PI / 2, r = r0 * Math.cos(a), y = yd + (h - yd) * 0.82 * Math.sin(a);
      const [X0, Z0] = ring(cx, cz, rp, 16, Math.PI / 16), [X1, Z1] = ring(cx, cz, Math.max(r, 0.01), 16, Math.PI / 16);
      for (let j = 0; j < 16; j++) { const q = (j + 1) % 16; face(A.roof[k], [[X0[j], yp, Z0[j]], [X0[q], yp, Z0[q]], [X1[q], y, Z1[q]], [X1[j], y, Z1[j]]], lead); }
      yp = y; rp = r;
    }
    spire(k, cx, cz, r0 * 0.15, 8, yp, h, lead);
  };

  // ---------- bâtiments ----------
  const MAXP = 4096, X = new Float64Array(MAXP), Z = new Float64Array(MAXP);
  let off = 16, nBld = 0, nPts = 0;
  for (let bi = 0; dv && bi < nB; bi++) {
    if (off + 6 > dv.byteLength) break;
    const np = dv.getUint16(off, true), hdm = dv.getUint16(off + 2, true), type = dv.getUint8(off + 4), flags = dv.getUint8(off + 5);
    off += 6;
    if (off + np * 4 > dv.byteLength) break;
    // lecture et simplification (sommets trop proches : plus on est petit, plus on simplifie)
    let n = 0, bxMin = 1e9, bxMax = -1e9, bzMin = 1e9, bzMax = -1e9;
    const raw = off; off += np * 4;
    if (np < 3 || np > MAXP) continue;
    for (let i = 0; i < np; i++) {
      const e = dv.getInt16(raw + i * 4, true) * scale, s = dv.getInt16(raw + i * 4 + 2, true) * scale;
      const x = TX(e, s), z = TZ(e, s);
      if (x < bxMin) bxMin = x; if (x > bxMax) bxMax = x; if (z < bzMin) bzMin = z; if (z > bzMax) bzMax = z;
      X[n] = x; Z[n] = z; n++;
    }
    if (n > 3 && X[n - 1] === X[0] && Z[n - 1] === Z[0]) n--;                          // anneau fermé
    const ext = Math.max(bxMax - bxMin, bzMax - bzMin), minE = ext < 14 ? 1.6 : ext < 30 ? 1.0 : 0.5;
    let m = 1;
    for (let i = 1; i < n; i++) if (Math.hypot(X[i] - X[m - 1], Z[i] - Z[m - 1]) >= minE) { X[m] = X[i]; Z[m] = Z[i]; m++; }
    while (m > 3 && Math.hypot(X[m - 1] - X[0], Z[m - 1] - Z[0]) < minE) m--;
    n = m; if (n < 3) continue;
    // sens trigonométrique vu du dessus (comme city.js), aire et centre
    let a2 = 0, cx = 0, cz = 0;
    for (let i = 0; i < n; i++) { const j = i + 1 === n ? 0 : i + 1; a2 += X[i] * Z[j] - X[j] * Z[i]; cx += X[i]; cz += Z[i]; }
    cx /= n; cz /= n;
    if (a2 > 0) { X.subarray(0, n).reverse(); Z.subarray(0, n).reverse(); }
    const area = Math.abs(a2) / 2; if (area < 6) continue;
    let h = Math.max(3, hdm / 10);
    const k = sec(cx, cz), landmark = (flags & 2) !== 0;
    // monuments : un repère de city.far.landmarks dans l'emprise porte le clocher ; les églises hautes sans repère
    // gardent une nef basse et un clocher au centre
    let tower = null;
    if (landmark || type === 7) {
      const lm = LM.find((l) => !l.used && l.x >= bxMin - 5 && l.x <= bxMax + 5 && l.z >= bzMin - 5 && l.z <= bzMax + 5 && inPoly(l.x, l.z, X, Z, n));
      const th = Math.max(h, lm ? lm.h : 0);
      if (lm) for (const l of LM) if (Math.hypot(l.x - lm.x, l.z - lm.z) < 20) l.used = true;   // doublons (même monument sous deux noms)
      if (lm && /dôme|dome/i.test(lm.name) && th > 26) { h = Math.min(h, th * 0.5); tower = { x: lm.x, z: lm.z, h: th, hb: h, dome: true }; }
      else if ((type === 7 || (lm && /sernin|jacobins|taur|augustins|dalbade|daurade|cathédrale|église|basilique|clocher/i.test(lm.name))) && th > 26) {
        const hb = Math.min(22, Math.max(12, th * 0.3));
        tower = { x: lm ? lm.x : cx, z: lm ? lm.z : cz, h: th, hb, octo: !lm || /sernin|jacobins|taur|augustins|dalbade/i.test(lm.name) };
        h = hb;
      }
    }
    // teintes : briques au centre historique, enduits clairs vers les faubourgs
    const dc = Math.hypot(cx - CX, cz - CZ), brickP = dc < 900 ? 0.72 : dc < 1600 ? 0.45 : 0.22;
    let col, acc = A.wall[k], uS = 1 / TWU, vS = 1 / THV;
    if (type === 7) { col = pick(PAL.church); acc = A.bare[k]; uS = vS = 1 / 32; }
    else if (type === 5) { col = pick(PAL.indus); acc = A.bare[k]; uS = vS = 1 / 32; }
    else if (type === 3 || (h > 30 && type === 0)) col = pick(PAL.office);
    else if (type === 4) { col = pick(PAL.retail); if (area > 1500) { acc = A.bare[k]; uS = vS = 1 / 32; } }
    else if (type === 6) col = rnd() < brickP ? pick(PAL.brick) : pick(PAL.civic);
    else col = rnd() < brickP ? pick(PAL.brick) : pick(PAL.render);
    const jit = 0.92 + 0.14 * rnd(); col = [col[0] * jit, col[1] * jit, col[2] * jit];
    walls(acc, X, Z, n, 0, h, col, rnd() * NB, uS, vS);
    const tiledRoof = ((flags & 1) || tower) && area < 4000;
    if (tiledRoof) tiled(A.roof[k], X, Z, n, h, area, cx, cz, pick(PAL.tile));
    else flat(A.roof[k], X, Z, n, h, (type === 7 || tower || (flags & 1)) ? pick(PAL.tile) : pick(PAL.flat));   // grandes nefs et grands toits de tuiles : à plat, mais en terre cuite
    if (tower) (tower.dome ? dome : belfry)(sec(tower.x, tower.z), tower.x, tower.z, tower.hb, tower.h, tower.octo);
    nBld++; nPts += n;
  }
  // repères sans emprise reconnue : clocher seul (églises) — les autres monuments sont déjà dans le bâti
  for (const l of LM) if (!l.used && l.h > 26 && Math.hypot(l.x, l.z) > radius && /sernin|jacobins|taur|augustins|dalbade|daurade|cathédrale|église|basilique|clocher/i.test(l.name))
    belfry(sec(l.x, l.z), l.x, l.z, Math.min(22, Math.max(12, l.h * 0.3)), l.h, /sernin|jacobins|taur|augustins|dalbade/i.test(l.name));

  // ---------- sols lointains : rues, trottoirs, voies ferrées, parcs ----------
  const G = { asph: new Acc(16384), walk: new Acc(16384), rail: new Acc(2048), green: new Acc(4096) };
  const R0 = radius - 25;   // raccord : la ville détaillée dessine ses rues jusqu'à radius + 40
  // polyligne (données) → morceaux hors du disque détaillé, coupés exactement sur le cercle R0
  const outside = (c) => {
    const out = []; let cur = null, px = 0, pz = 0, pin = true;
    for (let i = 0; i < c.length; i++) {
      const x = TX(c[i][0], c[i][1]), z = TZ(c[i][0], c[i][1]), inn = x * x + z * z < R0 * R0;
      if (i && inn !== pin) {   // franchissement du cercle : point de coupe par dichotomie
        let lo = 0, hi = 1; for (let k = 0; k < 14; k++) { const t = (lo + hi) / 2, qx = px + (x - px) * t, qz = pz + (z - pz) * t; ((qx * qx + qz * qz < R0 * R0) === pin) ? lo = t : hi = t; }
        const t = (lo + hi) / 2, q = [px + (x - px) * t, pz + (z - pz) * t];
        if (pin) cur = [q]; else { cur.push(q); if (cur.length > 1) out.push(cur); cur = null; }
      }
      if (!inn) { if (!cur) cur = []; cur.push([x, z]); }
      px = x; pz = z; pin = inn;
    }
    if (cur && cur.length > 1) out.push(cur);
    return out;
  };
  const ribbon = (acc, c, w, y) => {
    const n = c.length; if (n < 2) return;
    acc.need(n * 2, (n - 1) * 6);
    const hw = w / 2, base = acc.nv;
    for (let i = 0; i < n; i++) {
      const p = c[i], a = c[Math.max(0, i - 1)], b = c[Math.min(n - 1, i + 1)];
      let tx = b[0] - a[0], tz = b[1] - a[1]; const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
      let k = 1;
      if (i > 0 && i < n - 1) {
        const ux = p[0] - a[0], uz = p[1] - a[1], ul = Math.hypot(ux, uz) || 1, vx = b[0] - p[0], vz = b[1] - p[1], vl = Math.hypot(vx, vz) || 1;
        k = Math.min(2.5, 1 / Math.sqrt(Math.max(0.16, (1 + (ux * vx + uz * vz) / (ul * vl)) / 2)));
      }
      const nx = -tz * hw * k, nz = tx * hw * k;
      acc.v(p[0] + nx, y, p[1] + nz, 0, 1, 0, p[0] + nx, -(p[1] + nz), 1, 1, 1);
      acc.v(p[0] - nx, y, p[1] - nz, 0, 1, 0, p[0] - nx, -(p[1] - nz), 1, 1, 1);
    }
    for (let i = 0; i < n - 1; i++) { const a = base + i * 2; acc.up(a, a + 1, a + 3); acc.up(a, a + 3, a + 2); }
  };
  const W = { motorway: 22, trunk: 18, primary: 13, secondary: 11, tertiary: 9, residential: 7, unclassified: 6, living_street: 5, service: 4, pedestrian: 6, footway: 2.5, path: 2, cycleway: 2.5, track: 3 };
  const SIDE = { primary: 3.5, secondary: 3, tertiary: 3, residential: 2.5, unclassified: 2, trunk: 3 };
  for (const r of (far && far.roads) || []) {
    if (!r || !r.c || r.c.length < 2 || r.kind === 'steps') continue;
    const w = r.w || W[r.kind] || 6, walkOnly = /footway|path|cycleway|pedestrian|track|living_street/.test(r.kind || '');
    for (const c of outside(r.c)) {
      if (walkOnly) { ribbon(G.walk, c, w, 0.11); continue; }
      const sd = SIDE[r.kind] || 0; if (sd) ribbon(G.walk, c, w + 2 * sd, 0.11);
      ribbon(G.asph, c, w, 0.13);
    }
  }
  for (const r of (far && far.rails) || []) {
    if (!r || !r.c || r.tunnel || /tram|subway/.test(r.kind || '')) continue;
    for (const c of outside(r.c)) ribbon(G.rail, c, 3.4, 0.09);
  }
  const grassCol = [1, 1, 1];
  for (const p of (far && far.green) || []) {
    if (!p || p.length < 3) continue;
    let n = 0; for (const q of p) { if (n >= MAXP) break; X[n] = TX(q[0], q[1]); Z[n] = TZ(q[0], q[1]); n++; }
    let allIn = true; for (let i = 0; i < n; i++) if (X[i] * X[i] + Z[i] * Z[i] > radius * radius) { allIn = false; break; }
    if (allIn) continue;   // déjà dans la ville détaillée
    const acc = G.green, b0 = acc.nv; acc.need(n, 0);
    for (let i = 0; i < n; i++) acc.v(X[i], 0.065, Z[i], 0, 1, 0, X[i] / 64, -Z[i] / 64, ...grassCol);
    const pts = []; for (let i = 0; i < n; i++) pts.push(new V2(X[i], Z[i]));
    const tri = THREE.ShapeUtils.triangulateShape(pts, []);
    acc.need(0, tri.length * 3); for (const [a, b, c] of tri) acc.up(b0 + a, b0 + b, b0 + c);
  }

  // ---------- maillages ----------
  let tris = 0, calls = 0;
  const add = (m) => { if (!m) return; group.add(m); tris += m.geometry.index.count / 3; calls++; };
  for (let k = 0; k < 4; k++) { add(A.wall[k].mesh(THREE, MAT.wall, 'far:facades' + k)); add(A.bare[k].mesh(THREE, MAT.bare, 'far:murs' + k)); add(A.roof[k].mesh(THREE, MAT.roof, 'far:toits' + k)); }
  add(G.asph.mesh(THREE, MAT.asph, 'far:chaussees')); add(G.walk.mesh(THREE, MAT.walk, 'far:trottoirs')); add(G.rail.mesh(THREE, MAT.rail, 'far:voies'));
  add(G.green.mesh(THREE, MAT.park, 'far:parcs'));
  group.matrixAutoUpdate = false;

  const ms = Math.round(performance.now() - t0);
  group.userData = {
    stats: { buildings: nBld, points: nPts, triangles: tris, drawCalls: calls, ms },
    onLight: (dusk, night) => {
      const k = Math.min(1, 0.3 * dusk * dusk + 0.9 * night);
      MAT.wall.emissiveIntensity = 1.6 * k;
      MAT.asph.emissiveIntensity = 0.05 * k;   // halo orangé des lampadaires
    },
  };
  console.log(`[far] ${nBld} bâtiments, ${Math.round(tris / 1000)} k triangles, ${calls} appels, ${ms} ms`);
  return group;
}
