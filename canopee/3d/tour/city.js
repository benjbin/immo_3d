// Canopée — tour/city.js
// La ville réelle autour de la tour : quartier Matabiau – Marengo à Toulouse, d'après OpenStreetMap (city-data.json,
// © les contributeurs d'OpenStreetMap, ODbL). Bâtiments extrudés (rez-de-chaussée + étages, toits plats ou en tuiles),
// rues et trottoirs, voies ferrées de la gare, canal du Midi, espaces verts, arbres d'alignement.
// Données : x vers l'est, z vers le sud (m). Maquette : l'axe +Z pointe vers l'azimut `facadeAz` (voir SITE de viewer.js),
// la tour reste dans son repère et c'est la ville qui tourne autour d'elle.
import { cityMaterials } from './citymat.js';
import { buildRoads } from './roads.js';
import { buildWater } from './water.js';
import { buildFar } from './cityfar.js';

function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const area2 = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a; };
const inPoly = (x, z, pts) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, zi] = pts[i], [xj, zj] = pts[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
const centroid = (pts) => { let x = 0, z = 0; for (const p of pts) { x += p[0]; z += p[1]; } return [x / pts.length, z / pts.length]; };

// données (est, sud) → maquette : translation à l'emplacement de la tour (origin, en données) puis rotation du site
export function siteTransform(facadeAz = 180, origin = [0, 0]) {
  const F = facadeAz * Math.PI / 180, cF = Math.cos(F), sF = Math.sin(F);
  return ([e, s]) => { e -= origin[0]; const n = -(s - origin[1]); return [-(e * cF - n * sF), n * cF + e * sF]; };
}

export function createCity(THREE, M, { data, facadeAz = 180, origin = [0, 0], keep = [], radius = 600, farBuf = null }) {
  const group = new THREE.Group(); group.name = 'ville';
  const CM = cityMaterials(THREE);
  const rnd = mulberry32(31);

  // repère des données (est, sud) → repère de la maquette
  const T = siteTransform(facadeAz, origin);
  const TP = (pts) => pts.map(T);
  const near = (pts) => pts.some(([x, z]) => Math.hypot(x, z) < radius);
  const inKeep = (x, z) => keep.some((k) => inPoly(x, z, k));

  // ---------- accumulateurs par matériau ----------
  class Acc {
    constructor() { this.p = []; this.u = []; this.i = []; }
    v(x, y, z, u, w) { this.p.push(x, y, z); this.u.push(u, w); return this.p.length / 3 - 1; }
    quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
    geo() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
      g.setIndex(this.i); g.computeVertexNormals(); return g;
    }
  }
  const accs = new Map();
  const accOf = (mat) => { let a = accs.get(mat); if (!a) accs.set(mat, a = new Acc()); return a; };
  // polygone horizontal (trous éventuels) à la hauteur y, uv = x, -z en mètres
  const flatInto = (acc, pts, y, holes = []) => {
    const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
    for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, -z))));
    const g = new THREE.ShapeGeometry(shape), p = g.attributes.position, b = acc.p.length / 3;
    for (let i = 0; i < p.count; i++) acc.v(p.getX(i), y, -p.getY(i), p.getX(i), p.getY(i));
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i++) acc.i.push(b + ix[i]);   // sens trigonométrique vu du dessus : face vers le haut
    g.dispose();
  };
  // bande de façade le long d'un anneau (sens trigonométrique vu du dessus → faces vers l'extérieur)
  const band = (acc, ring, y0, y1, vBase) => {
    let u = 0;
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length], L = Math.hypot(bx - ax, bz - az);
      if (L < 0.05) continue;
      const b = acc.v(ax, y0, az, u, y0 - vBase); acc.v(bx, y0, bz, u + L, y0 - vBase); acc.v(bx, y1, bz, u + L, y1 - vBase); acc.v(ax, y1, az, u, y1 - vBase);
      acc.i.push(b, b + 1, b + 2, b, b + 2, b + 3);
      u += L;
    }
  };
  // ruban le long d'une polyligne (largeur w) à la hauteur y
  const ribbon = (acc, c, w, y) => {
    if (c.length < 2) return;
    const h = w / 2, base = acc.p.length / 3;
    for (let i = 0; i < c.length; i++) {
      const p = c[i], a = c[Math.max(0, i - 1)], b = c[Math.min(c.length - 1, i + 1)];
      let tx = b[0] - a[0], tz = b[1] - a[1]; const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
      let k = 1;
      if (i > 0 && i < c.length - 1) {   // onglet aux sommets, borné
        const ux = p[0] - a[0], uz = p[1] - a[1], ul = Math.hypot(ux, uz) || 1, vx = b[0] - p[0], vz = b[1] - p[1], vl = Math.hypot(vx, vz) || 1;
        const cos = (ux * vx + uz * vz) / (ul * vl); k = Math.min(2.5, 1 / Math.sqrt(Math.max(0.16, (1 + cos) / 2)));
      }
      const nx = -tz * h * k, nz = tx * h * k;
      acc.v(p[0] + nx, y, p[1] + nz, p[0] + nx, -(p[1] + nz)); acc.v(p[0] - nx, y, p[1] - nz, p[0] - nx, -(p[1] - nz));
    }
    for (let i = 0; i < c.length - 1; i++) { const a = base + i * 2; acc.i.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  };
  // les rubans peuvent être orientés dans un sens ou dans l'autre : on corrige leurs faces après coup
  const faceUp = (acc, from) => {
    const P = acc.p, I = acc.i;
    for (let t = from; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ny = (P[c] - P[a]) * (P[b + 2] - P[a + 2]) - (P[b] - P[a]) * (P[c + 2] - P[a + 2]);
      if (ny < 0) { const s = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = s; }
    }
  };

  // ---------- matériaux propres (ballast, rails, eau, quais) ----------
  const canvasTex = (w, h, draw, rep) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    t.repeat.set(1 / rep[0], 1 / rep[1]); return t;
  };
  const r2 = mulberry32(7);
  const ballastTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#6f675d'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) { const v = 70 + r2() * 90 | 0; g.fillStyle = `rgb(${v + 8},${v + 2},${v - 6})`; g.fillRect(r2() * w, r2() * h, 2 + r2() * 2, 2 + r2() * 2); }
  }, [3, 3]);
  // voie : ballast et traverses béton tous les 60 cm (u = travers, v = le long de la voie)
  const trackTex = canvasTex(128, 128, (g, w, h) => {
    g.drawImage(ballastTex.image, 0, 0, w, h);
    g.fillStyle = '#8f8b84'; for (let k = 0; k < 4; k++) g.fillRect(8, k * 32 + 10, w - 16, 12);
    g.fillStyle = '#4a4440'; for (const x of [34, 90]) g.fillRect(x, 0, 4, h);
  }, [2.6, 2.4]);
  const MAT = {
    ballast: new THREE.MeshStandardMaterial({ name: 'city:ballast', map: ballastTex, roughness: 0.95 }),
    track: new THREE.MeshStandardMaterial({ name: 'city:voie', map: trackTex, roughness: 0.9 }),
    water: new THREE.MeshPhysicalMaterial({ name: 'city:canal', color: 0x2c4a40, roughness: 0.06, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.1 }),
    quay: new THREE.MeshStandardMaterial({ name: 'city:quai', color: 0xb9ab95, roughness: 0.85 }),
    platform: new THREE.MeshStandardMaterial({ name: 'city:quaiGare', color: 0xa9a49b, roughness: 0.9 }),
  };

  // ---------- bâtiments ----------
  // Chaque immeuble : hauteur plausible (données réelles gardées, sinon déduite des voisins renseignés), façade choisie
  // selon l'époque, pans de mur arrondis à un nombre entier de travées et de niveaux (les fenêtres ne sont jamais coupées
  // aux angles), rez-de-chaussée commerçant sur les grands axes, toits de tuiles canal à 30 % en croupe ou à pignons
  // (squelette droit des pièces convexes), terrasses équipées ou végétalisées, cheminées et édicules instanciés.
  // Monuments : gare Matabiau (façade pierre et brique, pavillon de l'horloge), arche Marengo, médiathèque José-Cabanis.
  const tB = performance.now();
  const bgroup = new THREE.Group(); bgroup.name = 'batiments';
  // accumulateur teinté : couleur par sommet (teinte propre à chaque immeuble) sur des clones vertexColors des matériaux CM
  class TAcc extends Acc {
    constructor() { super(); this.c = []; this.col = [1, 1, 1]; }
    v(x, y, z, u, w) { this.c.push(this.col[0], this.col[1], this.col[2]); return super.v(x, y, z, u, w); }
    geo() { const g = super.geo(); g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3)); return g; }
  }
  const tinted = new Map(), bacc = new Map(), WHITE = [1, 1, 1];
  const tmat = (m) => { let c = tinted.get(m); if (!c) { c = m.clone(); c.vertexColors = true; c.name = m.name + ':t'; tinted.set(m, c); } return c; };
  const B_ = (m, col = WHITE) => { const k = tmat(m); let a = bacc.get(k); if (!a) bacc.set(k, a = new TAcc()); a.col = col; return a; };
  { const set0 = CM.setLight; CM.setLight = (d, n) => { set0(d, n); for (const [m, c] of tinted) c.emissiveIntensity = m.emissiveIntensity; }; }

  // --- géométrie plane ---
  const cross3 = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const simplify = (r, tol = 0.17) => {                       // retire les sommets presque alignés et les arêtes minuscules
    let q = r.slice();
    for (let pass = 0; pass < 3 && q.length > 3; pass++) {
      const o = [];
      for (let i = 0; i < q.length; i++) {
        const a = q[(i - 1 + q.length) % q.length], p = q[i], b = q[(i + 1) % q.length];
        const l1 = Math.hypot(p[0] - a[0], p[1] - a[1]), l2 = Math.hypot(b[0] - p[0], b[1] - p[1]);
        if (l1 < 0.35 || Math.abs(cross3(a, p, b)) / (l1 * l2 || 1) < tol) continue;
        o.push(p);
      }
      if (o.length < 3 || o.length === q.length) { if (o.length >= 3) q = o; break; } q = o;
    }
    return q;
  };
  const isConvex = (r) => { let s = 0; for (let i = 0; i < r.length; i++) { const c = cross3(r[i], r[(i + 1) % r.length], r[(i + 2) % r.length]); if (Math.abs(c) < 1e-6) continue; if (!s) s = Math.sign(c); else if (Math.sign(c) !== s) return false; } return true; };
  const obb = (r) => {                                         // rectangle englobant minimal (axe principal du bâtiment)
    let best = null;
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.5) continue;
      const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L; let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
      for (const p of r) { const u = p[0] * ux + p[1] * uz, v = -p[0] * uz + p[1] * ux; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
      const A = (u1 - u0) * (v1 - v0);
      if (!best || A < best.A) best = { A, ux, uz, lu: u1 - u0, lv: v1 - v0 };
    }
    if (!best) return { A: 0, ax: 1, az: 0, long: 1, short: 1 };
    const { ux, uz, lu, lv } = best;
    return lu >= lv ? { A: best.A, ax: ux, az: uz, long: lu, short: lv } : { A: best.A, ax: -uz, az: ux, long: lv, short: lu };
  };
  const clipHP = (poly, f) => {                                // garde f(p) ≤ 0 (f affine)
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length], fp = f(p), fq = f(q);
      if (fp <= 0) out.push(p);
      if ((fp < 0 && fq > 0) || (fp > 0 && fq < 0)) { const t = fp / (fp - fq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
    }
    return out;
  };
  const triUp = (acc, a, b, c) => {                            // triangle orienté vers le haut (ou vers l'extérieur via n)
    const P = acc.p, ny = (P[c * 3] - P[a * 3]) * (P[b * 3 + 2] - P[a * 3 + 2]) - (P[b * 3] - P[a * 3]) * (P[c * 3 + 2] - P[a * 3 + 2]);
    if (ny < 0) acc.i.push(a, c, b); else acc.i.push(a, b, c);
  };
  // mur vertical a→b (anneau horaire en x,z : faces vers l'extérieur), uv libres
  const quadW = (acc, a, b, y0, y1, u0, u1, v0, v1) => {
    const k = acc.v(a[0], y0, a[1], u0, v0); acc.v(b[0], y0, b[1], u1, v0); acc.v(b[0], y1, b[1], u1, v1); acc.v(a[0], y1, a[1], u0, v1);
    acc.i.push(k, k + 1, k + 2, k, k + 2, k + 3);
  };
  const flatDown = (acc, pts, y) => { const from = acc.i.length; flatInto(acc, pts, y); for (let t = from; t < acc.i.length; t += 3) { const s = acc.i[t + 1]; acc.i[t + 1] = acc.i[t + 2]; acc.i[t + 2] = s; } };

  // --- toits en pente : enveloppe inférieure des plans de versant (squelette droit exact pour une pièce convexe) ---
  // w[i] = 1 : versant (croupe) ; 0 : pignon vertical (mur mitoyen ou arête intérieure d'une décomposition)
  const hipRoof = (P, w, h, pitch, acc, gAcc) => {
    const n = P.length, E = [];
    for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; E.push({ a, b, tx: (b[0] - a[0]) / L, tz: (b[1] - a[1]) / L, nx: (b[1] - a[1]) / L, nz: -(b[0] - a[0]) / L }); }
    const d = (e, p) => e.nx * (p[0] - e.a[0]) + e.nz * (p[1] - e.a[1]);
    const sl = Math.sqrt(1 + pitch * pitch), faces = [];
    for (let i = 0; i < n; i++) {
      if (!w[i]) continue; const ei = E[i]; let F = P;
      for (let j = 0; j < n && F.length >= 3; j++) if (j !== i && w[j]) { const ej = E[j]; F = clipHP(F, (p) => d(ei, p) - d(ej, p)); }
      if (F.length < 3) continue;
      const base = acc.p.length / 3;
      for (const p of F) { const di = Math.max(0, d(ei, p)); acc.v(p[0], h + pitch * di, p[1], ei.tx * p[0] + ei.tz * p[1], di * sl); }
      for (let k = 1; k < F.length - 1; k++) triUp(acc, base, base + k, base + k + 1);
      faces.push([i, F]);
    }
    // pignons : profil du toit le long de l'arête
    if (gAcc) for (let i = 0; i < n; i++) {
      if (w[i]) continue; const e = E[i], L = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]); const top = [];
      for (const [j, F] of faces) for (const p of F) if (Math.abs(d(e, p)) < 1e-3) { const t = (p[0] - e.a[0]) * e.tx + (p[1] - e.a[1]) * e.tz; if (t > 1e-3 && t < L - 1e-3) top.push([t, h + pitch * Math.max(0, d(E[j], p))]); }
      if (!top.length) continue; top.sort((x, y) => x[0] - y[0]);
      const pts = [[0, h], [L, h], ...top.reverse()], base = gAcc.p.length / 3;
      for (const [t, y] of pts) gAcc.v(e.a[0] + e.tx * t, y, e.a[1] + e.tz * t, t, y);
      for (let k = 1; k < pts.length - 1; k++) gAcc.i.push(base, base + k, base + k + 1);   // a, b, … : même sens que les murs → vers l'extérieur
    }
    return { E, d };
  };
  // décomposition en pièces convexes (Hertel–Mehlhorn) d'un anneau simplifié
  const convexPieces = (r) => {
    const n = r.length;
    if (isConvex(r)) return [r.map((_, i) => i)];
    let tris; try { tris = THREE.ShapeUtils.triangulateShape(r.map(([x, z]) => new THREE.Vector2(x, z)), []); } catch (e) { return null; }
    if (!tris || tris.length !== n - 2) return null;
    const sgn = Math.sign(area2(r)), pcs = tris.map((t) => (Math.sign(area2(t.map((i) => r[i]))) === sgn ? t.slice() : t.slice().reverse()));
    for (let changed = true; changed;) {
      changed = false;
      outer: for (let a = 0; a < pcs.length; a++) for (let b = a + 1; b < pcs.length; b++) {
        const A = pcs[a], Bq = pcs[b];
        for (let i = 0; i < A.length; i++) { const u = A[i], v = A[(i + 1) % A.length], j = Bq.indexOf(v);
          if (j < 0 || Bq[(j + 1) % Bq.length] !== u) continue;
          const m = []; for (let k = 0; k < A.length; k++) m.push(A[(i + 1 + k) % A.length]);   // v … u
          for (let k = 2; k < Bq.length; k++) m.push(Bq[(j + k) % Bq.length]);                // après u dans B, jusqu'avant v
          if (isConvex(m.map((q) => r[q]))) { pcs[a] = m; pcs.splice(b, 1); changed = true; break outer; } }
      }
    }
    return pcs;
  };

  // --- index spatiaux : rues (rez-de-chaussée commerçants) et arêtes (murs mitoyens → pignons) ---
  const G = 16, gk = (x, z) => ((x / G) | 0) + ((x < 0) ? -1 : 0) + ',' + (((z / G) | 0) + ((z < 0) ? -1 : 0));
  const roadGrid = new Map(), MAIN = /primary|secondary|tertiary|trunk|pedestrian/, RES = /residential|living_street|unclassified|service/;
  for (const r of data.roads || []) {
    if (r.tunnel || !(MAIN.test(r.kind) || RES.test(r.kind))) continue; const c = TP(r.c), main = MAIN.test(r.kind) ? 1 : 0;
    if (!near(c)) continue;
    for (let i = 0; i < c.length - 1; i++) { const s = [c[i][0], c[i][1], c[i + 1][0], c[i + 1][1], main], L = Math.hypot(s[2] - s[0], s[3] - s[1]);
      for (let t = 0; t <= L; t += G / 2) { const k = gk(s[0] + (s[2] - s[0]) * t / (L || 1), s[1] + (s[3] - s[1]) * t / (L || 1)); let a = roadGrid.get(k); if (!a) roadGrid.set(k, a = new Set()); a.add(s); } }
  }
  const segD = (x, z, s) => { const dx = s[2] - s[0], dz = s[3] - s[1], L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - s[0]) * dx + (z - s[1]) * dz) / L2)); return Math.hypot(x - s[0] - dx * t, z - s[1] - dz * t); };
  const streetAt = (x, z) => {                                 // 2 : grand axe, 1 : rue de desserte, 0 : cour / arrière
    let best = 0; const cx = Math.floor(x / G), cz = Math.floor(z / G);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const a = roadGrid.get((cx + i) + ',' + (cz + j)); if (!a) continue;
      for (const s of a) { const dd = segD(x, z, s); if (s[4] && dd < 13) return 2; if (dd < 11) best = 1; } }
    return best;
  };

  // --- préparation : anneaux en repère maquette, hauteurs, enveloppes de parties ---
  const recs = [];
  for (const b of data.buildings || []) {
    if (/bridge/.test(b.type || '')) continue;
    let ring = TP(b.p); if (ring.length < 3 || !near(ring)) continue;
    const [cx, cz] = centroid(ring);
    if (inKeep(cx, cz) || ring.some(([x, z]) => inKeep(x, z))) continue;
    if (area2(ring) > 0) ring = ring.reverse();
    const holes = (b.holes || []).map(TP).map((h) => (area2(h) < 0 ? h.reverse() : h));
    recs.push({ b, ring, holes, cx, cz, area: Math.abs(area2(ring)) / 2, idx: recs.length });
  }
  const edgeGrid = new Map();
  recs.forEach((R, ri) => { const r = R.ring; for (let i = 0; i < r.length; i++) { const a = r[i], c = r[(i + 1) % r.length], k = gk((a[0] + c[0]) / 2, (a[1] + c[1]) / 2); let s = edgeGrid.get(k); if (!s) edgeGrid.set(k, s = []); s.push([a, c, ri]); } });
  const shared = (a, c, ri) => {                               // une arête d'un autre bâtiment la longe à moins de 0,8 m ?
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L < 1) return false; const tx = (c[0] - a[0]) / L, tz = (c[1] - a[1]) / L, mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
    const gx = Math.floor(mx / G), gz = Math.floor(mz / G);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const [p, q, rj] of edgeGrid.get((gx + i) + ',' + (gz + j)) || []) {
      if (rj === ri) continue; const l = Math.hypot(q[0] - p[0], q[1] - p[1]); if (l < 1) continue;
      const ux = (q[0] - p[0]) / l, uz = (q[1] - p[1]) / l; if (Math.abs(ux * tz - uz * tx) > 0.15) continue;
      if (Math.abs(-(mx - p[0]) * uz + (mz - p[1]) * ux) > 0.8) continue;
      const t0 = (p[0] - a[0]) * tx + (p[1] - a[1]) * tz, t1 = (q[0] - a[0]) * tx + (q[1] - a[1]) * tz, ov = Math.min(L, Math.max(t0, t1)) - Math.max(0, Math.min(t0, t1));
      if (ov > 0.35 * Math.min(L, l)) return true;
    }
    return false;
  };
  // niveaux réels connus → grille pour déduire ceux des immeubles à hauteur par défaut (12 m et 15 m d'OSM sans building:levels)
  const lvGrid = new Map();
  for (const R of recs) { const b = R.b; if (b.levels && !/part:/.test(b.type) && b.levels < 14) { const k = gk(R.cx, R.cz); let a = lvGrid.get(k); if (!a) lvGrid.set(k, a = []); a.push([R.cx, R.cz, b.levels]); } }
  const lvNear = (x, z) => { const o = [], gx = Math.floor(x / G), gz = Math.floor(z / G);
    for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) for (const p of lvGrid.get((gx + i) + ',' + (gz + j)) || []) if (Math.hypot(p[0] - x, p[1] - z) < 65) o.push(p[2]);
    o.sort((a, b) => a - b); return o; };
  // enveloppe d'un ensemble décrit aussi par ses parties (ex. Pré-Catelan, 5 000 m² à 55,8 m) : on la rabaisse
  for (const R of recs) { if (R.area < 2500 || /part:/.test(R.b.type)) continue;
    if (recs.some((Q) => Q !== R && Q.area < R.area && Q.b.h >= R.b.h - 0.5 && inPoly(Q.cx, Q.cz, R.ring))) R.hOverride = Math.max(9, Math.round(R.b.h * 0.4 / 3) * 3); }

  // --- choix de façade ---
  const FAC = Object.fromEntries(CM.facades.map((f) => [f.key, f]));
  const wpick = (keys) => { const L = keys.map((k) => FAC[k]).filter(Boolean); const tot = L.reduce((s, f) => s + (f.weight || 1), 0); let r = rnd() * tot; for (const f of L) { r -= f.weight || 1; if (r <= 0) return f; } return L[0]; };
  const OLD = CM.facades.filter((f) => f.old).map((f) => f.key);
  const facadeFor = (t, floors, area) => {
    if (/office|commercial/.test(t)) return wpick(rnd() < 0.7 ? ['bureaux'] : ['briqueContemporaine', 'enduit']);
    if (/industrial|warehouse|train_station|transportation|garage|parking|service|hangar|shed|roof/.test(t)) return FAC.beton;
    if (/church|chapel|synagogue|cathedral/.test(t)) return FAC.briquePierre;
    if (/school|civic|government|kindergarten|sports|college|university|public/.test(t)) return wpick(['briqueContemporaine', 'enduit', 'beton']);
    if (floors >= 6 || area > 1500) return wpick(['enduit', 'enduitBeige', 'briqueContemporaine']);   // grands ensembles de logements : jamais de mur-rideau
    const q = rnd(); return q < 0.82 ? wpick(OLD) : q < 0.93 ? FAC.briqueContemporaine : wpick(['enduit', 'enduitBeige']);
  };
  const SHOPCUT = [[16, [5.7, 7.8, 12.7, 16]], [12, [4.1, 8.2, 12]], [12, [2.6, 4.9, 7.4, 12]]];
  const snapShop = (k, L) => { const [tw, cuts] = SHOPCUT[k]; let best = tw, bd = 1e9; for (let m = 0; m < 6; m++) for (const c of cuts) { const t = m * tw + c, dd = Math.abs(t - L) / t; if (dd < bd) { bd = dd; best = t; } } return best; };

  // --- façade d'un anneau : chaque pan arrondi à n travées entières, niveaux entiers ---
  const facadeRing = (ring, y0, y1, fac, col, u0, v0, ground) => {
    const H = y1 - y0; if (H < 0.3) return;
    const nF = Math.max(1, Math.round(H / fac.floorH)), vs = nF * fac.floorH / H, acc = B_(fac.mat, col), bl = B_(CM.blank, col);
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.05) continue;
      const nb = Math.round(L / fac.bay);
      if (nb < 1) { if (L < 0.55 * fac.bay) { quadW(bl, a, b, ground ? 0 : y0, y1, 0, L, ground ? 0 : y0, y1); continue; } }
      const U = Math.max(1, nb) * fac.bay;
      if (ground) {                                            // rez-de-chaussée de ce pan, selon la rue qu'il borde
        const nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L, s = streetAt((a[0] + b[0]) / 2 + nx * 3, (a[1] + b[1]) / 2 + nz * 3);
        const k = s === 2 ? ground.shop : s === 1 ? ground.res : -1;
        if (k < 0) quadW(bl, a, b, 0, y0, 0, L, 0, y0);
        else { const T = snapShop(k, L); quadW(B_(CM.shops[k], ground.col), a, b, 0, y0, 0, T, 0, y0); }
      }
      quadW(acc, a, b, y0, y1, u0, u0 + U, v0, v0 + H * vs);
    }
  };
  // acrotère : bande pleine (v comprimé sur le bas de la tuile, toujours sans fenêtre), faces extérieure et intérieure
  const parapet = (ring, h, fac, col, cx, cz, hp = 0.6) => {
    const acc = B_(fac.mat, col), [pa, pb] = fac.pv || [0.01, 0.06], inner = ring.map(([x, z]) => { const dx = cx - x, dz = cz - z, l = Math.hypot(dx, dz) || 1; return [x + dx / l * 0.22, z + dz / l * 0.22]; });
    for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.05) continue;
      quadW(acc, a, b, h - 0.05, h + hp, 0, L, pa, pb); quadW(acc, inner[(i + 1) % ring.length], inner[i], h, h + hp, 0, L, pa, pb); }
    const cap = B_(CM.roofs.flatLight, WHITE), base = cap.p.length / 3;            // couvertine
    for (let i = 0; i < ring.length; i++) { const j = (i + 1) % ring.length;
      const k = cap.v(ring[i][0], h + hp, ring[i][1], ring[i][0], -ring[i][1]); cap.v(ring[j][0], h + hp, ring[j][1], ring[j][0], -ring[j][1]); cap.v(inner[j][0], h + hp, inner[j][1], inner[j][0], -inner[j][1]); cap.v(inner[i][0], h + hp, inner[i][1], inner[i][0], -inner[i][1]);
      triUp(cap, k, k + 1, k + 2); triUp(cap, k, k + 2, k + 3); }
  };

  // --- accessoires instanciés : cheminées, édicules d'ascenseur, groupes de climatisation ---
  const props = [], PCOL = { chim: [0.62, 0.36, 0.27], chimL: [0.78, 0.66, 0.55], hvac: [0.72, 0.73, 0.74], lift: [0.8, 0.78, 0.74] };
  const prop = (x, y, z, sx, sy, sz, ang, col) => props.push([x, y, z, sx, sy, sz, ang, col]);
  const insideM = (x, z, ring, m) => inPoly(x, z, ring) && inPoly(x + m, z, ring) && inPoly(x - m, z, ring) && inPoly(x, z + m, ring) && inPoly(x, z - m, ring);
  const roofKit = (R, h, ax, az, modern) => {                  // terrasse : édicule, climatisations, parfois végétalisée
    const { ring, cx, cz, area } = R, ang = Math.atan2(az, ax);
    if (area > 160 && insideM(cx, cz, ring, 2.2)) prop(cx, h + 1.4, cz, 2.6, 2.8, 3.2, ang, PCOL.lift);
    const n = Math.min(6, Math.floor(area / 120)), [x0, x1, z0, z1] = ring.reduce((m, [x, z]) => [Math.min(m[0], x), Math.max(m[1], x), Math.min(m[2], z), Math.max(m[3], z)], [1e9, -1e9, 1e9, -1e9]);
    for (let k = 0, tries = 0; k < n && tries < 20; tries++) { const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0); if (!insideM(x, z, ring, 1.6)) continue;
      const big = rnd() < 0.3; prop(x, h + (big ? 0.7 : 0.45), z, big ? 2.4 : 1.1, big ? 1.4 : 0.9, big ? 1.2 : 0.8, ang, PCOL.hvac); k++; }
  };

  // --- monuments ---
  const LAND = CM.land || {};
  const named = (re) => recs.filter((R) => re.test(R.b.name || ''));
  const done = new Set();
  const WEST = [Math.cos(331 * Math.PI / 180), -Math.sin(331 * Math.PI / 180)];   // ouest des données en repère maquette (côté canal de la gare)
  const longestFacing = (ring, dir) => { let best = -1, bl = 0; for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const o = (-(b[1] - a[1]) * dir[0] + (b[0] - a[0]) * dir[1]) / (L || 1); if (o > 0.55 && L > bl) { bl = L; best = i; } } return best; };
  // pavillon rectangulaire posé sur une arête : largeur W centrée en t, profondeur dIn vers l'intérieur et dOut en saillie
  const pavilion = (a, b, t, W, dIn, dOut, h, frontMat, sideMat, pitch) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), tx = (b[0] - a[0]) / L, tz = (b[1] - a[1]) / L, ox = -tz, oz = tx;   // o = normale extérieure
    const P = (s, o) => [a[0] + tx * s + ox * o, a[1] + tz * s + oz * o], s0 = t - W / 2, s1 = t + W / 2;
    const q = [P(s0, dOut), P(s1, dOut), P(s1, -dIn), P(s0, -dIn)];         // même sens que l'anneau (horaire)
    quadW(B_(frontMat), q[0], q[1], 0, h, 0, W, 0, h);
    const hs = Math.min(h, 13.5);
    for (const [u, v] of [[1, 2], [2, 3], [3, 0]]) { const l = Math.hypot(q[v][0] - q[u][0], q[v][1] - q[u][1]); quadW(B_(sideMat), q[u], q[v], 0, hs, 0, Math.max(1, Math.round(l / 5)) * 5, 0, hs);
      if (h > hs) quadW(B_(LAND.horloge || sideMat), q[u], q[v], hs, h, 0.1, 3.8, hs, h); }
    hipRoof(q, [1, 1, 1, 1], h, pitch, B_(CM.roofs.zinc), null);
  };
  // gare Matabiau : bâtiment voyageurs (1903–1905) côté canal, pavillon de l'horloge au centre, pavillons d'angle
  for (const R of named(/^Gare de Toulouse-Matabiau/)) {
    const main = R.area > 2000, h = main ? 13.5 : 11, ring = R.ring;
    for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.05) continue;
      quadW(B_(LAND.gare || FAC.briquePierre.mat), a, b, 0, h, 0, Math.max(1, Math.round(L / 5)) * 5, 0, h); }
    flatInto(B_(CM.roofs.zinc), ring, h);
    if (main) {
      const i = longestFacing(ring, WEST);
      if (i >= 0) { const a = ring[i], b = ring[(i + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]), tx = (b[0] - a[0]) / L, tz = (b[1] - a[1]) / L, ix = tz, iz = -tx;
        // long comble d'ardoise/zinc derrière la balustrade
        const P = (s, o) => [a[0] + tx * s + ix * o, a[1] + tz * s + iz * o];
        hipRoof([P(1, 0.8), P(L - 1, 0.8), P(L - 1, 15), P(1, 15)], [1, 1, 1, 1], h, 0.55, B_(CM.roofs.zinc), null);
        pavilion(a, b, L / 2, 18, 9, 3, 21, LAND.horloge || FAC.briquePierre.mat, LAND.gare || FAC.briquePierre.mat, 0.9);
        pavilion(a, b, 6, 12, 7, 1.5, 16, LAND.gare || FAC.briquePierre.mat, LAND.gare || FAC.briquePierre.mat, 0.75);
        pavilion(a, b, L - 6, 12, 7, 1.5, 16, LAND.gare || FAC.briquePierre.mat, LAND.gare || FAC.briquePierre.mat, 0.75); }
    }
    done.add(R);
  }
  // arche Marengo (portique de bureaux, linteau à 25–35 m) et médiathèque José-Cabanis et sa grande verrière
  const media = named(/Médiathèque José Cabanis/)[0], arches = named(/^Arche Marengo/);
  for (const R of arches) {
    const lint = (R.b.minH || 0) > 2, h = R.b.h || 35;
    if (lint) {                                                 // linteau : bande de bureaux, sous-face, terrasse
      facadeRing(R.ring, R.b.minH, h, { mat: LAND.arche || FAC.bureaux.mat, floorH: 3.5, bay: 3 }, WHITE, 0, 0, null);
      flatDown(B_(LAND.arche || FAC.bureaux.mat), R.ring, R.b.minH); flatInto(B_(CM.roofs.flatLight), R.ring, h - 0.02);
      done.add(R); continue;
    }
    // portique : grande arche en plein cintre extrudée sur la profondeur du bâtiment
    const r = R.ring, mc = media ? [media.cx, media.cz] : [R.cx, R.cz + 1];
    let fi = 0, fd = -1; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); const dm = Math.hypot((a[0] + b[0]) / 2 - mc[0], (a[1] + b[1]) / 2 - mc[1]); if (L > 15 && dm > fd) { fd = dm; fi = i; } }
    const A = r[fi], Bp = r[(fi + 1) % r.length], W = Math.hypot(Bp[0] - A[0], Bp[1] - A[1]), ux = (Bp[0] - A[0]) / W, uz = (Bp[1] - A[1]) / W, nx = uz, nz = -ux;   // n : vers l'intérieur
    let D = 0; for (const p of r) D = Math.max(D, (p[0] - A[0]) * nx + (p[1] - A[1]) * nz);
    const lw = W * 0.16, rr = (W - 2 * lw) / 2, sy = Math.max(4, h - 4.5 - rr), sh = new THREE.Shape();
    sh.moveTo(0, 0); sh.lineTo(lw, 0); sh.lineTo(lw, sy); sh.absarc(W / 2, sy, rr, Math.PI, 0, true); sh.lineTo(W - lw, 0); sh.lineTo(W, 0); sh.lineTo(W, h); sh.lineTo(0, h); sh.closePath();
    const eg = new THREE.ExtrudeGeometry(sh, { depth: D, bevelEnabled: false, curveSegments: 28 }), pa = eg.attributes.position, uv = eg.attributes.uv;
    const flip = (ux * nz - uz * nx) < 0;                      // repère (u, y, n) indirect → on retourne les triangles
    for (let i = 0; i < pa.count; i += 3) {
      const loc = [0, 1, 2].map((k) => [pa.getX(i + k), pa.getY(i + k), pa.getZ(i + k)]);
      const e1 = loc[1].map((v, k) => v - loc[0][k]), e2 = loc[2].map((v, k) => v - loc[0][k]), nn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const ax = Math.abs(nn[0]), ay = Math.abs(nn[1]), az = Math.abs(nn[2]);
      for (let k = 0; k < 3; k++) { const [s, y, z] = loc[k]; pa.setXYZ(i + k, A[0] + ux * s + nx * z, y, A[1] + uz * s + nz * z);
        if (az >= ax && az >= ay) uv.setXY(i + k, s, y); else if (ax >= ay) uv.setXY(i + k, z, y); else uv.setXY(i + k, 0.3, 0.3); }
      if (flip) { for (const at of [pa, uv]) { const sz = at.itemSize; for (let c = 0; c < sz; c++) { const t = at.getComponent(i + 1, c); at.setComponent(i + 1, c, at.getComponent(i + 2, c)); at.setComponent(i + 2, c, t); } } }
    }
    eg.computeVertexNormals();
    const am = new THREE.Mesh(eg, LAND.arche || FAC.bureaux.mat); am.castShadow = am.receiveShadow = true; am.matrixAutoUpdate = false; am.updateMatrix(); bgroup.add(am);
    done.add(R);
  }
  if (media) {                                                 // verrière sur le parvis de l'arche, pierre blanche ailleurs
    const r = media.ring, h = media.b.h || 26, ac = arches.length ? centroid(arches.flatMap((R) => R.ring)) : null;
    for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.05) continue;
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L;
      const front = ac && ((ac[0] - mx) * nx + (ac[1] - mz) * nz) > 0 && L > 20;
      if (front) quadW(B_(LAND.verriere || FAC.bureaux.mat), a, b, 0, h, 0, Math.round(L / 1.5) * 1.5, 0, Math.round(h / 2) * 2);
      else quadW(B_(LAND.arche || FAC.bureaux.mat), a, b, 0, h, 0, Math.max(1, Math.round(L / 3)) * 3, 0, Math.round(h / 3.5) * 3.5); }
    flatInto(B_(CM.roofs.flatLight), r, h); parapet(r, h, { mat: LAND.arche || FAC.bureaux.mat }, WHITE, media.cx, media.cz, 0.9);
    done.add(media);
  }

  // --- immeubles courants ---
  let nb = 0, nTile = 0, nFlat = 0, nFail = 0;
  const BLANK = /^(roof|kiosk)$/;
  for (const R of recs) {
    nb++; if (done.has(R)) continue;
    const { b, ring, holes, cx, cz, area } = R, t = b.type || 'yes', y0 = Math.max(0, b.minH || 0);
    if (BLANK.test(t) && !b.levels) {                          // auvent : dalle sur poteaux invisibles
      const h = Math.max(3, b.h || 4); flatInto(B_(CM.roofs.flatLight), ring, h); flatDown(B_(CM.blank), ring, h - 0.35); facadeRing(ring, h - 0.35, h, FAC.beton, WHITE, 0, 0, null); continue;
    }
    // niveaux : réels si renseignés, sinon médiane des voisins (faubourg : 2–4 ; Marengo : 6–10), bornée par l'emprise
    const isDef = b.levels == null && (b.h === 12 || b.h === 15 || b.h === 8) && !R.hOverride;
    let floors;
    if (isDef) {
      const nl = lvNear(cx, cz), med = nl.length >= 3 ? nl[nl.length >> 1] : 3;
      floors = Math.round(med + (rnd() - 0.5) * 2.2);
      if (/house|detached|semidetached|terrace/.test(t)) floors = 1 + (rnd() < 0.65 ? 1 : 0) + (rnd() < 0.15 ? 1 : 0);
      if (/garage|shed|kiosk|service/.test(t)) floors = 1;
      floors = Math.max(1, Math.min(floors, area < 45 ? 2 : area < 90 ? 4 : area < 200 ? 6 : 12));
    } else floors = b.levels || Math.max(1, Math.round((R.hOverride || b.h || 9) / 3.1));
    const fac = /Pré-Catelan|FirstName/.test(b.name || '') ? FAC.enduit : /Ovale/.test(b.name || '') ? FAC.bureaux : facadeFor(t, floors, area);
    const ob = obb(ring), old = !!fac.old;
    const shopOK = floors >= 3 && y0 === 0 && !/church|chapel|synagogue|garage|parking|industrial|warehouse|school|kindergarten|train_station|transportation/.test(t);
    const gH = shopOK ? (fac.groundH || 4.2) : 0;
    let h = isDef ? (gH ? gH + (floors - 1) * fac.floorH : floors * fac.floorH) + (old ? 0.4 : 0.2) : Math.max(3, R.hOverride || b.h || 9);
    if (h - y0 < 2.5) h = y0 + 2.5;
    // teinte propre : brique plus ou moins rose / ocre, enduits plus ou moins clairs
    const lum = 0.86 + rnd() * 0.2, warm = rnd(), col = old ? [lum, lum * (0.95 + 0.05 * warm), lum * (0.9 + 0.08 * warm)] : [lum * 1.02, lum, lum * (0.97 + 0.04 * warm)];
    const ground = gH ? { shop: rnd() < 0.65 ? 0 : 1, res: old ? (rnd() < 0.55 ? 1 : 2) : 2, col: [0.95 + 0.07 * rnd(), 0.97, 0.95 + 0.05 * rnd()] } : null;
    if (ground && !old) ground.shop = 0;
    const u0 = ((rnd() * 4) | 0) * fac.bay, v0 = ((rnd() * (fac.nf || 4)) | 0) * fac.floorH;
    facadeRing(ring, y0 + gH, h, fac, col, u0, v0, ground);
    for (const hl of holes) facadeRing(hl, y0 + gH, h, fac, col, u0, v0, ground ? { ...ground, shop: 2, res: 2 } : null);
    if (y0 > 2) flatDown(B_(CM.blank), ring, y0);
    // toit
    const pitched = /gabled|hipped|pyramidal|roof|half|mansard|skillion/.test(b.roof || '') || /church|chapel/.test(t);
    let tiled = !holes.length && ob.short < 30 && (pitched || (old && floors <= 6 && area < 1400 && rnd() < 0.92) || (!old && floors <= 5 && area < 900 && !/office|commercial|retail|industrial|school|civic/.test(t) && rnd() < 0.5) || (/house|detached|semidetached/.test(t)));
    let pieces = null, sr = null;
    if (tiled) { sr = simplify(ring, 0.2); if (area2(sr) > 0) sr.reverse(); pieces = sr.length <= 24 ? convexPieces(sr) : null; if (!pieces || pieces.length > 9) { tiled = false; nFail++; } }
    if (tiled) {
      const pitch = /church|chapel/.test(t) ? 0.5 : 0.3, n = sr.length, isRing = (u, v) => (v === (u + 1) % n);
      const rcol = [0.86 + 0.22 * rnd(), 0.84 + 0.16 * rnd(), 0.82 + 0.14 * rnd()].map((v, k) => Math.min(1.08, v * (k ? 1 : 1)));
      const ra = B_(CM.roofs.tile, rcol), ga = B_(CM.blank, col), gableEnds = ob.long / Math.max(1, ob.short) > 1.8 && rnd() < 0.35;
      for (const pc of pieces) {
        const P = pc.map((i) => sr[i]), w = pc.map((u, k) => {
          const v = pc[(k + 1) % pc.length]; if (!isRing(u, v)) return 0;                           // arête intérieure : pignon
          const a = sr[u], c = sr[v], L = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1, end = Math.abs(((c[0] - a[0]) * ob.ax + (c[1] - a[1]) * ob.az) / L) < 0.5;
          return end && (gableEnds || shared(a, c, R.idx)) ? 0 : 1;
        });
        if (w.filter(Boolean).length < 2) w.fill(1);
        const { E, d } = hipRoof(P, w, h, pitch, ra, ga);
        // cheminées de brique sur les vieilles maisons, près du faîtage
        if (old && rnd() < 0.75) { const pcx = P.reduce((s, p) => s + p[0], 0) / P.length, pcz = P.reduce((s, p) => s + p[1], 0) / P.length;
          const nc = area > 140 && rnd() < 0.5 ? 2 : 1;
          for (let k = 0; k < nc; k++) { const q = P[(rnd() * P.length) | 0], f = 0.2 + 0.45 * rnd(), x = pcx + (q[0] - pcx) * f, z = pcz + (q[1] - pcz) * f;
            if (!inPoly(x, z, P)) continue; let m = 1e9; E.forEach((e, i) => { if (w[i]) m = Math.min(m, d(e, [x, z])); });
            const top = h + pitch * m + 0.9 + 0.5 * rnd(); prop(x, (top + h + pitch * m - 0.4) / 2, z, 0.55, top - (h + pitch * m - 0.4), 0.8, Math.atan2(ob.az, ob.ax), rnd() < 0.7 ? PCOL.chim : PCOL.chimL); } }
      }
      nTile++;
    } else {
      const green = !old && floors >= 3 && area > 180 && rnd() < 0.18;
      flatInto(B_(green ? CM.roofs.green : rnd() < 0.7 ? CM.roofs.flat : CM.roofs.flatLight, green ? WHITE : [lum, lum, lum]), ring, h - 0.05, holes);
      parapet(ring, h, fac, col, cx, cz, floors >= 3 ? 0.8 : 0.4);
      if (!green && floors >= 3) roofKit(R, h, ob.ax, ob.az, !old);
      nFlat++;
    }
  }
  // flush : un maillage par matériau teinté, un seul InstancedMesh pour tous les accessoires de toiture
  for (const [mat, acc] of bacc) { if (!acc.i.length) continue; const m = new THREE.Mesh(acc.geo(), mat); m.castShadow = m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix(); bgroup.add(m); }
  if (props.length) {
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ name: 'city:edicules', color: 0xffffff, roughness: 0.75, metalness: 0.1 }), props.length);
    const o = new THREE.Object3D(), c = new THREE.Color();
    props.forEach(([x, y, z, sx, sy, sz, a, col], i) => { o.position.set(x, y, z); o.rotation.set(0, -a, 0); o.scale.set(sx, sy, sz); o.updateMatrix(); im.setMatrixAt(i, o.matrix); const k = 0.9 + 0.2 * rnd(); im.setColorAt(i, c.setRGB(col[0] * k, col[1] * k, col[2] * k)); });
    im.castShadow = im.receiveShadow = true; im.matrixAutoUpdate = false; im.updateMatrix(); im.computeBoundingSphere(); bgroup.add(im);
  }
  group.add(bgroup);
  bgroup.userData.stats = { ms: Math.round(performance.now() - tB), cmMs: Math.round(CM.genMs || 0), buildings: nb, tiled: nTile, flat: nFlat, fail: nFail, props: props.length, meshes: bgroup.children.length };

  // ---------- sols : rues, trottoirs, places, parkings, voies ferrées, canal, verdure ----------
  const keepSeg = (c) => {   // coupe les polylignes qui traversent le parvis de la tour ou sortent du rayon
    const out = []; let cur = [];
    for (const p of c) { const ok = !inKeep(p[0], p[1]) && Math.hypot(p[0], p[1]) < radius + 40; if (ok) cur.push(p); else { if (cur.length > 1) out.push(cur); cur = []; } }
    if (cur.length > 1) out.push(cur); return out;
  };
  // modules spécialisés (rues et voies ferrées, eau, ville lointaine) : chacun reçoit le même contexte ;
  // s'il rend null, la version simple ci-dessous sert de repli
  const ctx = { data, T, TP, near, inKeep, keepSeg, radius, rnd: mulberry32(57), CM, farBuf };
  const roadsG = buildRoads(THREE, M, ctx), waterG = buildWater(THREE, M, ctx), farG = buildFar(THREE, M, ctx);
  for (const g of [roadsG, waterG, farG]) if (g) group.add(g);
  if (!roadsG) {
  const walkOf = { motorway: 0, trunk: 3.5, primary: 4, secondary: 3.5, tertiary: 3, residential: 2.5, unclassified: 2.5, living_street: 0, service: 0 };
  const sw = accOf(M.sidewalk), asph = accOf(M.asphalt), pav = accOf(M.paver);
  const sw0 = sw.i.length, as0 = asph.i.length, pv0 = pav.i.length;
  const roads = (data.roads || []).filter((r) => !r.tunnel && (r.layer || 0) >= 0);
  for (const r of roads) for (const c of keepSeg(TP(r.c))) {
    const k = r.kind, w = r.w || 6;
    if (/footway|path|cycleway|steps|pedestrian|track|bridleway/.test(k)) { ribbon(pav, c, w, 0.13); continue; }
    const walk = walkOf[k] ?? 2;
    if (walk) ribbon(sw, c, w + 2 * walk, 0.12);
    ribbon(asph, c, w, 0.14);
  }
  const A = data.areas || {};
  for (const p of A.pedestrian || []) { const q = TP(p); if (near(q)) flatInto(pav, q, 0.135); }
  for (const p of A.parking || []) { const q = TP(p); if (near(q) && !q.some(([x, z]) => inKeep(x, z))) flatInto(asph, q, 0.14); }
  faceUp(sw, sw0); faceUp(asph, as0); faceUp(pav, pv0);
  const bal = accOf(MAT.ballast), b0 = bal.i.length;
  for (const p of A.railway || []) { const q = TP(p); if (near(q)) flatInto(bal, q, 0.05); }
  faceUp(bal, b0);
  // quais de la gare : dalles surélevées de 90 cm
  for (const p of A.platforms || []) {
    let q = TP(p); if (!near(q) || q.length < 3) continue; if (area2(q) > 0) q = q.reverse();
    flatInto(accOf(MAT.platform), q, 0.9); band(accOf(MAT.quay), q, 0, 0.9, 0);
  }
  const trk = accOf(MAT.track), t0 = trk.i.length;
  for (const r of data.rails || []) if (!r.tunnel) for (const c of keepSeg(TP(r.c))) {
    // ruban de voie, v le long de la voie : on recalcule les uv
    const from = trk.p.length / 3; ribbon(trk, c, 2.6, 0.09);
    let d = 0;
    for (let i = 0; i < c.length; i++) { if (i) d += Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]); trk.u[(from + i * 2) * 2] = 0; trk.u[(from + i * 2) * 2 + 1] = d; trk.u[(from + i * 2 + 1) * 2] = 2.6; trk.u[(from + i * 2 + 1) * 2 + 1] = d; }
  }
  faceUp(trk, t0);
  }
  if (!waterG) {
  const wat = accOf(MAT.water), w0 = wat.i.length;
  for (const p of data.water || []) {
    let q = TP(p); if (!near(q) || q.length < 3) continue;
    flatInto(wat, q, 0.04);
    if (area2(q) > 0) q = q.reverse();
    band(accOf(MAT.quay), q.slice().reverse(), 0.04, 0.5, 0);   // margelle de pierre
  }
  faceUp(wat, w0);
  }
  const grs = accOf(M.grass), g0 = grs.i.length;
  for (const p of data.green || []) { const q = TP(p); if (near(q) && !q.some(([x, z]) => inKeep(x, z))) flatInto(grs, q, 0.07); }
  faceUp(grs, g0);

  for (const [mat, acc] of accs) {
    if (!acc.i.length) continue;
    // pelouses OSM qui débordent sur le canal : découpées par les trous d'eau (l'eau est en contrebas)
    const geo = waterG && mat === M.grass ? waterG.userData.holes.cut(acc.geo()) : acc.geo();
    const mesh = new THREE.Mesh(geo, mat);
    const isGround = mat === M.sidewalk || mat === M.asphalt || mat === M.paver || mat === M.grass || mat === MAT.ballast || mat === MAT.water || mat === MAT.track;
    mesh.castShadow = !isGround; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    // sols empilés à quelques centimètres : vus de 300 m, la précision de profondeur ne les sépare plus et ils
    // se battent en rayures qui scintillent dès que la caméra bouge ; un décalage de profondeur par couche les ordonne
    const layer = [MAT.water, MAT.ballast, M.grass, MAT.track, M.sidewalk, M.paver, M.asphalt].indexOf(mat);
    if (layer >= 0) { mat.polygonOffset = true; mat.polygonOffsetFactor = -(layer + 1); mat.polygonOffsetUnits = -4 * (layer + 1); }
    group.add(mesh);
  }

  // ---------- arbres (pour landscape.js) ----------
  const trees = [], species = ['linden', 'ash', 'oak', 'hornbeam'];
  const pts = (data.trees || []).map(T).filter(([x, z]) => Math.hypot(x, z) < radius && !inKeep(x, z));
  pts.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
  for (const [x, z] of pts.slice(0, 900)) trees.push([species[(rnd() * species.length) | 0], +x.toFixed(2), +z.toFixed(2), +(9 + rnd() * 8).toFixed(2)]);

  group.userData = {
    trees, buildings: nb, source: data.source, waterHoles: waterG ? waterG.userData.holes : null,
    onLight: (dusk, night) => { CM.setLight(dusk, night); for (const g of [roadsG, waterG, farG]) if (g && g.userData.onLight) g.userData.onLight(dusk, night); },
  };
  return group;
}
