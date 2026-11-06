// Canopée — tour/city.js
// La ville réelle autour de la tour : quartier Matabiau – Marengo à Toulouse, d'après OpenStreetMap (city-data.json,
// © les contributeurs d'OpenStreetMap, ODbL). Bâtiments extrudés (rez-de-chaussée + étages, toits plats ou en tuiles),
// rues et trottoirs, voies ferrées de la gare, canal du Midi, espaces verts, arbres d'alignement.
// Données : x vers l'est, z vers le sud (m). Maquette : l'axe +Z pointe vers l'azimut `facadeAz` (voir SITE de viewer.js),
// la tour reste dans son repère et c'est la ville qui tourne autour d'elle.
import { cityMaterials } from './citymat.js';

function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const area2 = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a; };
const inPoly = (x, z, pts) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, zi] = pts[i], [xj, zj] = pts[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
const centroid = (pts) => { let x = 0, z = 0; for (const p of pts) { x += p[0]; z += p[1]; } return [x / pts.length, z / pts.length]; };

// données (est, sud) → maquette : translation à l'emplacement de la tour (origin, en données) puis rotation du site
export function siteTransform(facadeAz = 180, origin = [0, 0]) {
  const F = facadeAz * Math.PI / 180, cF = Math.cos(F), sF = Math.sin(F);
  return ([e, s]) => { e -= origin[0]; const n = -(s - origin[1]); return [-(e * cF - n * sF), n * cF + e * sF]; };
}

export function createCity(THREE, M, { data, facadeAz = 180, origin = [0, 0], keep = [], radius = 600 }) {
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
  const facadeFor = (b, area, h) => {
    const t = b.type || 'yes', F_ = CM.facades, pick = (keys) => {
      const c = F_.filter((f) => keys.includes(f.key) && h >= (f.minH ?? 0) - 1 && h <= (f.maxH ?? 999) + 6);
      const L = c.length ? c : F_.filter((f) => keys.includes(f.key));
      const tot = L.reduce((s, f) => s + (f.weight || 1), 0); let r = rnd() * tot;
      for (const f of L) { r -= f.weight || 1; if (r <= 0) return f; } return L[0];
    };
    const keys = F_.map((f) => f.key), has = (k) => keys.find((x) => x.includes(k));
    if (/office|commercial/.test(t) || (h > 30 && /yes|retail/.test(t))) return pick([has('bureau'), has('contemp')].filter(Boolean));
    if (/industrial|warehouse|train_station|transportation|garages|parking|service|hangar/.test(t)) return pick([has('beton'), has('bureau')].filter(Boolean));
    if (h > 24) return pick([has('moderne'), has('contemp'), has('beton')].filter(Boolean));
    return pick(keys.filter((k) => !/bureau|beton/.test(k)));
  };
  let nb = 0;
  for (const b of data.buildings || []) {
    let ring = TP(b.p); if (ring.length < 3 || !near(ring)) continue;
    const [cx, cz] = centroid(ring);
    if (inKeep(cx, cz) || ring.some(([x, z]) => inKeep(x, z))) continue;
    let holes = (b.holes || []).map(TP);
    if (area2(ring) > 0) ring = ring.reverse();                      // sens trigonométrique vu du dessus (x est, z sud)
    holes = holes.map((h) => (area2(h) < 0 ? h.reverse() : h));
    const area = Math.abs(area2(ring)) / 2, h = Math.max(3, b.h || 9), y0 = Math.max(0, b.minH || 0);
    const fac = facadeFor(b, area, h);
    const gH = h - y0 >= 7 && y0 === 0 ? (fac.groundH || 4.2) : 0;
    if (gH) {
      const shop = CM.shops[(rnd() * CM.shops.length) | 0];
      band(accOf(shop), ring, 0, gH, 0);
      for (const hl of holes) band(accOf(CM.blank), hl, 0, gH, 0);
    }
    band(accOf(fac.mat), ring, y0 + gH, h, y0 + gH);
    for (const hl of holes) band(accOf(fac.mat), hl, y0 + gH, h, y0 + gH);   // cours intérieures (anneau horaire : faces vers la cour)
    // toit : tuiles canal en croupe sur les petits immeubles anciens, terrasse ailleurs (avec acrotère)
    const tiled = /roof|gabled|hipped|pyramidal/.test(b.roof || '') || (h <= 16 && area < 450 && !/office|commercial|industrial|warehouse|retail/.test(b.type || '') && rnd() < 0.7);
    if (tiled && !holes.length) {
      const acc = accOf(CM.roofs.tile), ridge = h + Math.min(3.2, Math.sqrt(area) * 0.18), base = acc.p.length / 3;
      const c = acc.v(cx, ridge, cz, cx, -cz);
      for (const [x, z] of ring) acc.v(x, h, z, x, -z);
      for (let i = 0; i < ring.length; i++) acc.i.push(c, base + 1 + i, base + 1 + (i + 1) % ring.length);
      faceUp(acc, acc.i.length - ring.length * 3);
    } else {
      flatInto(accOf(rnd() < 0.75 ? CM.roofs.flat : CM.roofs.flatLight), ring, h - 0.05, holes);
      band(accOf(CM.blank), ring, h - 0.05, h + 0.6, h);
      band(accOf(CM.blank), ring.slice().reverse().map(([x, z]) => [x + (cx - x) * 0.01, z + (cz - z) * 0.01]), h, h + 0.6, h);
    }
    nb++;
  }

  // ---------- sols : rues, trottoirs, places, parkings, voies ferrées, canal, verdure ----------
  const keepSeg = (c) => {   // coupe les polylignes qui traversent le parvis de la tour ou sortent du rayon
    const out = []; let cur = [];
    for (const p of c) { const ok = !inKeep(p[0], p[1]) && Math.hypot(p[0], p[1]) < radius + 40; if (ok) cur.push(p); else { if (cur.length > 1) out.push(cur); cur = []; } }
    if (cur.length > 1) out.push(cur); return out;
  };
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
  for (const p of A.parking || []) { const q = TP(p); if (near(q) && !q.some(([x, z]) => inKeep(x, z))) flatInto(asph, q, 0.115); }
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
  const wat = accOf(MAT.water), w0 = wat.i.length;
  for (const p of data.water || []) {
    let q = TP(p); if (!near(q) || q.length < 3) continue;
    flatInto(wat, q, 0.04);
    if (area2(q) > 0) q = q.reverse();
    band(accOf(MAT.quay), q.slice().reverse(), 0.04, 0.5, 0);   // margelle de pierre
  }
  faceUp(wat, w0);
  const grs = accOf(M.grass), g0 = grs.i.length;
  for (const p of data.green || []) { const q = TP(p); if (near(q) && !q.some(([x, z]) => inKeep(x, z))) flatInto(grs, q, 0.07); }
  faceUp(grs, g0);

  for (const [mat, acc] of accs) {
    if (!acc.i.length) continue;
    const mesh = new THREE.Mesh(acc.geo(), mat);
    const isGround = mat === M.sidewalk || mat === M.asphalt || mat === M.paver || mat === M.grass || mat === MAT.ballast || mat === MAT.water || mat === MAT.track;
    mesh.castShadow = !isGround; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    if (isGround) { mat.polygonOffset = mat.polygonOffset || false; }
    group.add(mesh);
  }

  // ---------- arbres (pour landscape.js) ----------
  const trees = [], species = ['linden', 'ash', 'oak', 'hornbeam'];
  const pts = (data.trees || []).map(T).filter(([x, z]) => Math.hypot(x, z) < radius && !inKeep(x, z));
  pts.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
  for (const [x, z] of pts.slice(0, 900)) trees.push([species[(rnd() * species.length) | 0], +x.toFixed(2), +z.toFixed(2), +(9 + rnd() * 8).toFixed(2)]);

  group.userData = {
    trees, buildings: nb, source: data.source,
    onLight: (dusk, night) => CM.setLight(dusk, night),
  };
  return group;
}
