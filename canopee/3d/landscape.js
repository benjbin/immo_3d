// Canopée — landscape.js
// Paysage procédural : sol, rue, trottoir, allée, massifs, arbres, plantes des jardinières
// et toiture végétalisée. Tout le végétal est instancié (InstancedMesh) ; les surfaces
// minérales sont fusionnées par matériau. Génération déterministe (PRNG à graine).

import { mulberry32, fbm2, patchAntiTile } from './materials.js';

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

export function createLandscape(THREE, M, bud = {}) {
  const t0 = performance.now();
  const V3 = THREE.Vector3;
  const group = new THREE.Group();
  group.name = 'landscape';

  const rnd = mulberry32(20261023);
  const rr = (a, b) => a + rnd() * (b - a);
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const unit = (out = new V3()) => {
    const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, s = Math.sqrt(1 - z * z);
    return out.set(Math.cos(a) * s, z, Math.sin(a) * s);
  };

  // Centre du bâtiment (repère du SPEC)
  const BC = { x: 0, z: -9.5 };
  // Emprise du bâtiment lue dans building.userData.bounds (socle) ; SX = facteur de largeur
  // par rapport au SPEC initial (1 → socle de 11,2 m ; 1.2 → révision 2, socle de 13,44 m)
  const BND = bud.bounds || { minX: -5.6, maxX: 5.6, minZ: -19, maxZ: 1.5 };
  const SX = (BND.maxX - BND.minX) / 11.2;
  const sMinX = BND.minX, sMaxX = BND.maxX, bMinZ = BND.minZ, frontZ = BND.socleMaxZ ?? 0.4;
  const DR = [-3.5 * SX, 2.3 * SX], ST = [2.3 * SX, 3.8 * SX];     // allée pavée, marches de l'entrée
  BC.z = (bMinZ + frontZ) / 2;
  // Jardin naturel : prairie haute autour du bâtiment (rayon ~35 m), quelques clairières tondues
  const meadowF = (x, z) => {
    if (z > 4.4) return 0;
    const d = Math.hypot(x - BC.x, z - BC.z);
    const base = sstep(42, 30, d);
    const lawn = sstep(0.57, 0.66, fbm2(x * 0.05 + 2, z * 0.05 + 9, 3, 51));
    return base * (1 - lawn);
  };

  // Relief très doux, seulement loin du bâtiment et de la rue
  const groundY = (x, z) => {
    const d = Math.hypot(x - BC.x, z - BC.z);
    const a = sstep(48, 105, d) * sstep(12, 34, Math.abs(z - 11.25));
    return a === 0 ? 0 : a * (fbm2(x * 0.017 + 3.1, z * 0.017 + 1.7, 3, 5) - 0.45) * 8;
  };

  // -------------------------------------------------------------------------
  // Utilitaires de géométrie
  // -------------------------------------------------------------------------
  // UV en mètres selon l'axe dominant de la normale (1 unité UV = 1 m)
  function worldUV(geo) {
    const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
      if (ay >= ax && ay >= az) uv.setXY(i, x, -z);
      else if (ax >= az) uv.setXY(i, -z * Math.sign(n.getX(i)), y);
      else uv.setXY(i, x * Math.sign(n.getZ(i)), y);
    }
    return geo;
  }
  function boxGeo(x0, x1, y0, y1, z0, z1) {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    return worldUV(g);
  }
  function merge(geos) {
    let nv = 0, ni = 0;
    for (const g of geos) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
    const hasCol = geos.every(g => g.attributes.color);
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), col = hasCol ? new Float32Array(nv * 3) : null;
    const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let vo = 0, io = 0;
    for (const g of geos) {
      const c = g.attributes.position.count;
      pos.set(g.attributes.position.array, vo * 3); nor.set(g.attributes.normal.array, vo * 3); uv.set(g.attributes.uv.array, vo * 2);
      if (col) col.set(g.attributes.color.array, vo * 3);
      if (g.index) { const a = g.index.array; for (let k = 0; k < a.length; k++) idx[io++] = a[k] + vo; }
      else for (let k = 0; k < c; k++) idx[io++] = k + vo;
      vo += c;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    return out;
  }
  // Accumulateur de géométrie
  class Acc {
    constructor() { this.p = []; this.n = []; this.u = []; this.c = []; this.i = []; }
    get count() { return this.p.length / 3; }
    v(p, n, u, v, c) { this.p.push(p.x, p.y, p.z); this.n.push(n.x, n.y, n.z); this.u.push(u, v); if (c) this.c.push(c[0], c[1], c[2]); return this.count - 1; }
    tri(a, b, c) { this.i.push(a, b, c); }
    geo() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
      if (this.c.length) g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
      g.setIndex(this.i);
      return g;
    }
  }
  const meshes = [];
  function addMesh(geo, mat, { cast = false, receive = true, name } = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast; m.receiveShadow = receive; if (name) m.name = name;
    m.matrixAutoUpdate = false; m.updateMatrix();
    group.add(m); meshes.push(m);
    return m;
  }

  // Lots d'instances : un InstancedMesh par (géométrie, matériau)
  class Batch {
    constructor(name, geo, mat, { crown = false, cast = true, receive = true } = {}) {
      Object.assign(this, { name, geo, mat, crown, cast, receive });
      this.t = []; this.c = []; this.n = [];
    }
    add(p, q, s, c, cn) {
      const sx = typeof s === 'number' ? s : s.x, sy = typeof s === 'number' ? s : s.y, sz = typeof s === 'number' ? s : s.z;
      this.t.push(p.x, p.y, p.z, q.x, q.y, q.z, q.w, sx, sy, sz);
      this.c.push(c[0], c[1], c[2]);
      if (this.crown) this.n.push(cn ? cn.x : 0, cn ? cn.y : 0, cn ? cn.z : 0);
    }
    build() {
      const n = this.t.length / 10;
      if (!n) return null;
      const geo = this.geo.clone();
      const mesh = new THREE.InstancedMesh(geo, this.mat, n);
      const m4 = new THREE.Matrix4(), p = new V3(), q = new THREE.Quaternion(), s = new V3(), arr = mesh.instanceMatrix.array, t = this.t;
      for (let i = 0; i < n; i++) {
        const o = i * 10;
        p.set(t[o], t[o + 1], t[o + 2]); q.set(t[o + 3], t[o + 4], t[o + 5], t[o + 6]); s.set(t[o + 7], t[o + 8], t[o + 9]);
        m4.compose(p, q, s); m4.toArray(arr, i * 16);
      }
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.c), 3);
      geo.setAttribute('aCrownN', new THREE.InstancedBufferAttribute(this.crown ? new Float32Array(this.n) : new Float32Array(n * 3), 3));
      mesh.castShadow = this.cast; mesh.receiveShadow = this.receive; mesh.name = this.name;
      mesh.computeBoundingSphere(); mesh.computeBoundingBox?.();
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      group.add(mesh); meshes.push(mesh);
      return mesh;
    }
  }
  const batches = [];
  const batch = (...a) => { const b = new Batch(...a); batches.push(b); return b; };

  // Quaternion d'un repère dont l'axe Y local suit `yAxis` et la normale (Z) se rapproche de `zHint`
  const _x = new V3(), _y = new V3(), _z = new V3(), _m = new THREE.Matrix4();
  function quatYZ(yAxis, zHint, out = new THREE.Quaternion()) {
    _y.copy(yAxis).normalize();
    _x.crossVectors(_y, zHint);
    if (_x.lengthSq() < 1e-6) _x.set(1, 0, 0).cross(_y);
    _x.normalize(); _z.crossVectors(_x, _y);
    _m.makeBasis(_x, _y, _z);
    return out.setFromRotationMatrix(_m);
  }
  const qY = (a, out = new THREE.Quaternion()) => out.setFromAxisAngle(new V3(0, 1, 0), a);

  // -------------------------------------------------------------------------
  // Géométries de base de la végétation
  // -------------------------------------------------------------------------
  // Carte de feuillage pliée en V (pivot au pied, hauteur 1)
  function cardGeo(fold) {
    const A = new Acc(), n = new V3(0, 0, 1);
    const P = [[-0.5, 0, 0], [0, 0, fold], [0.5, 0, 0], [-0.5, 1, 0], [0, 1, fold], [0.5, 1, 0]];
    const U = [[0, 0], [0.5, 0], [1, 0], [0, 1], [0.5, 1], [1, 1]];
    P.forEach((p, k) => A.v(new V3(...p), n, U[k][0], U[k][1]));
    if (fold) { A.tri(0, 1, 4); A.tri(0, 4, 3); A.tri(1, 2, 5); A.tri(1, 5, 4); }
    else { A.tri(0, 2, 5); A.tri(0, 5, 3); }
    return A.geo();
  }
  // Bande (feuille longue) : rangées {c, side, nrm, w, v}, pli central optionnel
  function strip(A, rows, fold = 0) {
    const base = A.count;
    for (const r of rows) {
      const hw = r.w / 2;
      A.v(r.c.clone().addScaledVector(r.side, -hw), r.nrm, 0, r.v);
      A.v(r.c.clone().addScaledVector(r.nrmFold || r.nrm, fold * r.w), r.nrm, 0.5, r.v);
      A.v(r.c.clone().addScaledVector(r.side, hw), r.nrm, 1, r.v);
    }
    for (let i = 0; i < rows.length - 1; i++) {
      const a = base + i * 3, b = a + 3;
      A.tri(a, a + 1, b); A.tri(a + 1, b + 1, b); A.tri(a + 1, a + 2, b + 1); A.tri(a + 2, b + 2, b + 1);
    }
  }
  // Touffe de plans croisés (graminées, fleurs) — normales orientées « dôme »
  function tuftGeo(planes = 3, fan = 0.35, lo = false) {
    const A = new Acc();
    for (let k = 0; k < planes; k++) {
      const a = k / planes * Math.PI + 0.3, s = new V3(Math.cos(a), 0, Math.sin(a));
      const rows = (lo ? [0, 1] : [0, 0.5, 1]).map(t => {
        const w = lerp(0.55, 1, Math.pow(t, 0.7)) * (1 + fan * t);
        return { c: new V3(0, t, 0), side: s, nrm: new V3(0, 1, 0), w, v: t };
      });
      strip(A, rows, 0);
    }
    const g = A.geo(), p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) { const v = new V3(p.getX(i) * 0.35, 1, p.getZ(i) * 0.35).normalize(); n.setXYZ(i, v.x, v.y, v.z); }
    return g;
  }
  // Rosette de rameaux (vivaces) : cartes inclinées vers l'extérieur et arquées
  function rosetteGeo(n, seed) {
    const r = mulberry32(seed), A = new Acc();
    for (let k = 0; k < n; k++) {
      const phi = k / n * Math.PI * 2 + r() * 0.5, tilt = 0.45 + r() * 0.5, L = 0.75 + r() * 0.35;
      const out = new V3(Math.cos(phi), 0, Math.sin(phi)), side = new V3(-out.z, 0, out.x);
      const rows = []; let c = new V3(0, 0, 0);
      for (let i = 0; i <= 3; i++) {
        const t = i / 3, th = tilt + t * 0.5;
        const d = new V3(out.x * Math.sin(th), Math.cos(th), out.z * Math.sin(th));
        rows.push({ c: c.clone(), side, nrm: new V3(out.x * 0.6, 1, out.z * 0.6).normalize(), w: L * 0.95, v: t });
        c.addScaledVector(d, L / 3);
      }
      strip(A, rows, 0.08);
    }
    return A.geo();
  }
  // Touffe de strelitzia : grandes feuilles en éventail sur longs pétioles
  function strelitziaGeo(seed) {
    const r = mulberry32(seed), A = new Acc(), n = 7 + Math.floor(r() * 3), fanA = r() * Math.PI;
    for (let k = 0; k < n; k++) {
      const phi = fanA + (k % 2 ? Math.PI : 0) + (r() - 0.5) * 1.1;
      const tilt = 0.08 + r() * 0.45, bend = 0.25 + r() * 0.6, L = 0.75 + r() * 0.45, W = L * 0.25;
      const out = new V3(Math.cos(phi), 0, Math.sin(phi));
      const twist = (r() - 0.5) * 0.9;
      const rows = []; const c = new V3((r() - 0.5) * 0.08, 0, (r() - 0.5) * 0.08);
      for (let i = 0; i <= 6; i++) {
        const t = i / 6, th = tilt + bend * t * t;
        const d = new V3(out.x * Math.sin(th), Math.cos(th), out.z * Math.sin(th));
        const side0 = new V3(-out.z, 0, out.x), side = side0.clone().applyAxisAngle(d, twist * t).normalize();
        let nr = new V3().crossVectors(side, d).normalize(); if (nr.dot(out) < 0) nr.negate();
        nr.lerp(new V3(0, 1, 0), 0.3).normalize();
        rows.push({ c: c.clone(), side, nrm: nr, w: W, v: t });
        c.addScaledVector(d, L / 6);
      }
      strip(A, rows, 0.06);
    }
    return A.geo();
  }
  // Palmier nain : palmes arquées et pliées en V
  function palmGeo(seed) {
    const r = mulberry32(seed), A = new Acc(), n = 9 + Math.floor(r() * 4);
    for (let k = 0; k < n; k++) {
      const phi = k * 2.399 + r() * 0.4, tilt = 0.15 + r() * 0.75, L = 0.65 + r() * 0.4, W = L * 0.5;
      const out = new V3(Math.cos(phi), 0, Math.sin(phi)), side = new V3(-out.z, 0, out.x);
      const rows = []; const c = new V3(0, 0, 0);
      for (let i = 0; i <= 7; i++) {
        const t = i / 7, th = tilt + 1.5 * Math.pow(t, 1.6) * (0.6 + tilt * 0.5);
        const d = new V3(out.x * Math.sin(th), Math.cos(th), out.z * Math.sin(th));
        let nr = new V3().crossVectors(side, d).normalize(); if (nr.y < 0) nr.negate();
        rows.push({ c: c.clone(), side, nrm: nr.clone().lerp(new V3(0, 1, 0), 0.3).normalize(), nrmFold: nr, w: W * (0.6 + 0.4 * Math.sin(Math.PI * Math.min(1, t * 1.2 + 0.1))), v: t });
        c.addScaledVector(d, L / 7);
      }
      strip(A, rows, 0.12);
    }
    return A.geo();
  }
  // Tige retombante (attache en haut, pend vers -Y, s'écarte vers +Z)
  function trailGeo() {
    const A = new Acc(), rows = [], side = new V3(1, 0, 0);
    // passe par-dessus le rebord puis retombe
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const c = new V3(0, 0.06 * Math.sin(Math.min(1, t * 4) * Math.PI) - t, 0.2 * Math.sin(Math.min(1, t * 2.2) * Math.PI / 2) + 0.06 * t);
      rows.push({ c, side, nrm: new V3(0, 0.4, 1).normalize(), w: 0.3, v: 1 - t });
    }
    strip(A, rows, 0.08);
    return A.geo();
  }
  // Tapis horizontal (sedums)
  function matGeo() {
    const g = new THREE.PlaneGeometry(1, 1, 2, 2); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const d = Math.hypot(p.getX(i), p.getZ(i)); p.setY(i, 0.06 * (1 - d * 1.4)); }
    g.computeVertexNormals();
    const n = g.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
    return g;
  }

  const G = {
    card: cardGeo(0.12), cardC: cardGeo(0).translate(0, -0.5, 0), tuft3: tuftGeo(3, 0.35), tuft4: tuftGeo(4, 0.5), tuftLo: tuftGeo(3, 0.45, true),
    rosette: [rosetteGeo(7, 1), rosetteGeo(9, 2)], strel: [strelitziaGeo(11), strelitziaGeo(12), strelitziaGeo(13)],
    palm: [palmGeo(21), palmGeo(22), palmGeo(23)], trail: trailGeo(), mat: matGeo(),
  };

  // -------------------------------------------------------------------------
  // Sol : disque de pelouse qui se fond en sous-bois sombre
  // (construit après les arbres : assombrissement sous les houppiers)
  // -------------------------------------------------------------------------
  function buildGround() {
    const A = new Acc(), NR = 72, NA = 180, RMAX = 120;
    const radii = [];
    for (let i = 1; i <= NR; i++) radii.push(RMAX * Math.pow(i / NR, 1.75));
    radii.push(170, 260, 420, 700);
    const colAt = (x, z) => {
      const d = Math.hypot(x - BC.x, z - BC.z);
      const macro = 0.66 + 0.34 * fbm2(x / 13 + 7, z / 13 + 3, 4, 2);
      const dry = sstep(0.55, 0.8, fbm2(x / 23 + 1, z / 23 + 5, 3, 4)) * 0.35;
      // ombre portée diffuse et litière sous les arbres
      let sh = 1;
      for (const t of trees) {
        const dd = (t.x - x) ** 2 + (t.z - z) ** 2, R = t.radius * 1.35;
        if (dd < R * R) sh *= 1 - (t.kind === 'bg' ? 0.45 : 0.32) * sstep(R, R * 0.25, Math.sqrt(dd));
      }
      const f = sstep(28, 80, d);
      const under = (0.4 + 0.25 * fbm2(x / 5, z / 5, 3, 9));
      const m = meadowF(x, z);
      const lr = macro * (1 + dry * 0.35) * sh * lerp(1, 1.02, m), lg = macro * (0.92 + dry * 0.08) * sh * lerp(1, 0.86, m), lb = macro * (0.72 - dry * 0.3) * sh * lerp(1, 0.5, m);
      return [lerp(lr, under * 0.95, f), lerp(lg, under * 0.85, f), lerp(lb, under * 0.55, f)];
    };
    const up = new V3(0, 1, 0);
    A.v(new V3(BC.x, 0, BC.z), up, BC.x, -BC.z, colAt(BC.x, BC.z));
    for (const r of radii) for (let a = 0; a < NA; a++) {
      const ang = a / NA * Math.PI * 2, x = BC.x + Math.cos(ang) * r, z = BC.z + Math.sin(ang) * r;
      A.v(new V3(x, groundY(x, z), z), up, x, -z, colAt(x, z));
    }
    for (let a = 0; a < NA; a++) A.tri(0, 1 + (a + 1) % NA, 1 + a);
    for (let k = 0; k < radii.length - 1; k++) for (let a = 0; a < NA; a++) {
      const i0 = 1 + k * NA + a, i1 = 1 + k * NA + (a + 1) % NA, j0 = i0 + NA, j1 = i1 + NA;
      A.tri(i0, i1, j0); A.tri(i1, j1, j0);
    }
    const geo = A.geo(); geo.computeVertexNormals();
    const mat = M.grass.clone();
    mat.name = 'ground'; mat.vertexColors = true;
    mat.polygonOffset = true; mat.polygonOffsetFactor = 1; mat.polygonOffsetUnits = 2;
    patchAntiTile(mat, 0.45);
    addMesh(geo, mat, { receive: true, name: 'ground' });
  }

  // -------------------------------------------------------------------------
  // Rue, bordures, trottoir, allée, marches
  // -------------------------------------------------------------------------
  const RX = 150;
  {
    const road = new THREE.PlaneGeometry(2 * RX, 7.4); road.rotateX(-Math.PI / 2); road.translate(0, 0.01, 11.25);
    addMesh(worldUV(road), M.asphalt, { name: 'road' });
    // marquage pointillé central
    const dashes = [];
    for (let x = -RX + 2; x < RX - 3; x += 6) { const d = new THREE.PlaneGeometry(3, 0.12); d.rotateX(-Math.PI / 2); d.translate(x + 1.5, 0.014, 11.25); dashes.push(worldUV(d)); }
    addMesh(merge(dashes), M.marking, { name: 'marking' });

    const curbs = [];
    // bordure côté trottoir, abaissée devant l'allée des garages
    const c0 = DR[0] - 0.5, c1 = ST[0] + 0.6;
    curbs.push(boxGeo(-RX, c0 - 0.6, 0, 0.15, 7.35, 7.55), boxGeo(c0 - 0.6, c0, 0, 0.1, 7.35, 7.55), boxGeo(c0, c1, 0, 0.05, 7.35, 7.55),
      boxGeo(c1, c1 + 0.6, 0, 0.1, 7.35, 7.55), boxGeo(c1 + 0.6, RX, 0, 0.15, 7.35, 7.55));
    curbs.push(boxGeo(-RX, RX, 0, 0.15, 14.95, 15.15));
    // bordurette de l'allée côté gauche
    curbs.push(boxGeo(DR[0] - 0.12, DR[0], 0, 0.09, frontZ, 4.5));
    addMesh(merge(curbs), M.curb, { cast: true, name: 'curbs' });

    const walk = [boxGeo(-RX, RX, 0, 0.14, 4.5, 7.35)];
    // marches devant l'entrée (x 2.3 → 3.8) : palier puis marche
    walk.push(boxGeo(ST[0], ST[1], 0, 0.16, frontZ, frontZ + 0.75), boxGeo(ST[0], ST[1], 0, 0.08, frontZ + 0.75, frontZ + 1.2));
    addMesh(merge(walk), M.sidewalk, { cast: true, name: 'sidewalk' });

    // Allée pavée légèrement en pente vers le trottoir + chemin piéton vers les marches
    const drive = (x0, x1, z0, z1, y0, y1) => {
      const g = new THREE.BoxGeometry(x1 - x0, 1, z1 - z0); g.translate((x0 + x1) / 2, 0.5, (z0 + z1) / 2);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) if (p.getY(i) > 0.5) p.setY(i, lerp(y0, y1, (p.getZ(i) - z0) / (z1 - z0))); else p.setY(i, -0.05);
      return worldUV(g);
    };
    addMesh(merge([drive(DR[0], DR[1], frontZ, 4.5, 0.03, 0.14), drive(ST[0], ST[1], frontZ + 1.2, 4.5, 0.05, 0.14)]), M.paver, { name: 'driveway' });
  }

  // -------------------------------------------------------------------------
  // Arbres procéduraux
  // -------------------------------------------------------------------------
  const trees = [];
  const bark = { main: new Acc(), bg: new Acc() };
  const LB = {
    leafA: batch('leavesA', G.card, M.leafA, { crown: true }), leafB: batch('leavesB', G.card, M.leafB, { crown: true }), leafC: batch('leavesC', G.card, M.leafC, { crown: true }),
    core: batch('leavesCore', G.cardC, M.leafClump, { crown: true }),
    bg: batch('bgLeaves', G.cardC, M.leafClump, { crown: true, cast: false }),
  };
  // teinte des masses internes selon l'essence (accordée aux cartes de rameaux)
  const HUE = { leafA: [1, 1, 1], leafB: [0.8, 0.9, 0.86], leafC: [1.15, 1.1, 0.72] };

  // Tube effilé le long d'une polyligne (repères à transport parallèle)
  function tube(A, pts, r0, r1, radial, tint, flare = 1) {
    const n = pts.length, base = A.count;
    const T = new V3(), N = new V3(), B = new V3(), dir = new V3(), p = new V3();
    T.subVectors(pts[1], pts[0]).normalize();
    N.set(0, 0, 1); if (Math.abs(T.z) > 0.9) N.set(1, 0, 0);
    N.addScaledVector(T, -N.dot(T)).normalize();
    const uMax = Math.max(0.8, Math.round(2 * Math.PI * r0 / 0.8) * 0.8);
    let vlen = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0) {
        if (i < n - 1) T.subVectors(pts[i + 1], pts[i - 1]).normalize(); else T.subVectors(pts[i], pts[i - 1]).normalize();
        N.addScaledVector(T, -N.dot(T)).normalize();
        vlen += pts[i].distanceTo(pts[i - 1]);
      }
      B.crossVectors(T, N);
      const t = i / (n - 1);
      const r = lerp(r0, r1, t) * (i === 0 ? flare : 1);
      for (let j = 0; j <= radial; j++) {
        const a = j / radial * Math.PI * 2;
        dir.copy(N).multiplyScalar(Math.cos(a)).addScaledVector(B, Math.sin(a));
        p.copy(pts[i]).addScaledVector(dir, r);
        A.v(p, dir, j / radial * uMax, vlen, tint);
      }
    }
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < radial; j++) {
      const a = base + i * (radial + 1) + j, b = a + radial + 1;
      A.tri(a, a + 1, b); A.tri(b, a + 1, b + 1);
    }
  }
  const bez = (a, b, c, n) => { const out = []; for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; out.push(new V3(u * u * a.x + 2 * u * t * b.x + t * t * c.x, u * u * a.y + 2 * u * t * b.y + t * t * c.y, u * u * a.z + 2 * u * t * b.z + t * t * c.z)); } return out; };

  const SP = {
    oak:      { leaf: 'leafA', fork: 0.3, leader: false, cw: 0.48, ch: 0.72, r: 0.022, lobes: [8, 10], lobeR: 0.44, clumps: [4, 6], clumpR: [0.85, 1.3], card: [0.8, 1.15], dens: 52, core: [5, 8] },
    linden:   { leaf: 'leafA', fork: 0.2, leader: true, cw: 0.33, ch: 0.8, r: 0.02, lobes: [10, 13], lobeR: 0.46, clumps: [3, 5], clumpR: [0.8, 1.2], card: [0.8, 1.1], dens: 52, core: [4, 7] },
    ash:      { leaf: 'leafC', fork: 0.35, leader: false, cw: 0.45, ch: 0.64, r: 0.02, lobes: [7, 9], lobeR: 0.44, clumps: [3, 5], clumpR: [0.75, 1.15], card: [0.85, 1.2], dens: 44, core: [3, 6] },
    birch:    { leaf: 'leafB', fork: 0.3, leader: true, cw: 0.25, ch: 0.68, r: 0.014, lobes: [8, 10], lobeR: 0.48, clumps: [3, 4], clumpR: [0.6, 0.95], card: [0.6, 0.85], dens: 50, core: [2, 4], bark: 1.6 },
    hornbeam: { leaf: 'leafB', fork: 0.12, leader: true, cw: 0.21, ch: 0.86, r: 0.018, lobes: [11, 14], lobeR: 0.52, clumps: [3, 4], clumpR: [0.65, 1.05], card: [0.65, 0.95], dens: 54, core: [4, 6] },
    young:    { leaf: 'leafA', fork: 0.42, leader: true, cw: 0.26, ch: 0.56, r: 0.013, lobes: [6, 8], lobeR: 0.5, clumps: [2, 4], clumpR: [0.55, 0.85], card: [0.6, 0.85], dens: 44, core: [1, 3] },
  };

  function growTree(spName, x, z, H, seed, lod = 0, kind = 'main') {
    const sp = SP[spName], r = mulberry32(seed);
    const R = (a, b) => a + r() * (b - a), RI = (a, b) => a + Math.floor(r() * (b - a + 1));
    const A = lod ? bark.bg : bark.main;
    const y0 = groundY(x, z);
    const crownH = Math.min(0.86, sp.ch * (lod ? 1.18 : 1)) * H, crownBot = H - crownH, rx = sp.cw * H * R(0.88, 1.12) * (lod ? 1.55 : 1), ry = crownH / 2;
    const lean = new V3(R(-1, 1), 0, R(-1, 1)).multiplyScalar(H * 0.025);
    // centre du houppier décentré : silhouettes asymétriques
    const C = new V3(x + lean.x * 2 + rx * R(-0.2, 0.2), y0 + crownBot + ry, z + lean.z * 2 + rx * R(-0.2, 0.2));
    const bt = (sp.bark ?? 1) * R(0.55, 0.75) * (lod ? 0.6 : 1), tint = [bt, bt * 0.97, bt * 0.93];
    // Tronc
    const r0 = sp.r * H * R(0.85, 1.15);
    const topH = sp.leader ? crownBot + crownH * 0.86 : Math.min(sp.fork * H, crownBot + ry * 0.35);
    const trunk = [];
    const nT = lod ? 3 : 6;
    for (let i = 0; i <= nT; i++) {
      const t = i / nT;
      trunk.push(new V3(x + lean.x * t * 2 + Math.sin(t * 5 + seed) * 0.05 * H * 0.02, y0 - 0.15 + t * (topH + 0.15), z + lean.z * t * 2 + Math.cos(t * 4 + seed) * 0.05 * H * 0.02));
    }
    tube(A, trunk, r0, r0 * (sp.leader ? 0.22 : 0.62), lod ? 5 : 9, tint, 1.35);
    const trunkAt = h => { const t = clamp01((h - y0 + 0.15) / (topH + 0.15)); const i = Math.min(nT - 1, Math.floor(t * nT)); return trunk[i].clone().lerp(trunk[i + 1], t * nT - i); };
    // Teinte du houppier
    // palette par arbre : vert sombre, olive, vert moyen, vert clair, olive sombre
    const PAL = [[0.7, 0.86, 0.74], [0.62, 0.78, 0.68], [0.96, 0.94, 0.66], [0.9, 1.0, 0.86], [1.06, 1.06, 0.74], [0.8, 0.88, 0.66]];
    const pal = PAL[Math.floor(r() * PAL.length)];
    const ht = [pal[0] * (1 + (r() - 0.5) * 0.08), pal[1] * (1 + (r() - 0.5) * 0.06), pal[2] * (1 + (r() - 0.5) * 0.1)];
    const hk = HUE[sp.leaf], hc = [ht[0] * hk[0], ht[1] * hk[1], ht[2] * hk[2]];
    // Lobes
    const nL = lod ? RI(5, 7) : RI(sp.lobes[0], sp.lobes[1]);
    const card = sp.card, dens = sp.dens, cr = sp.clumpR;
    const p = new V3(), outv = new V3(), yv = new V3(), zh = new V3(), q = new THREE.Quaternion(), cn = new V3(), tmp = new V3();
    for (let k = 0; k < nL; k++) {
      if (k > 0 && r() < 0.14) continue;   // lobe manquant : trou dans le houppier
      const ang = k / nL * Math.PI * 2 + R(-0.4, 0.4);
      const hy = sp.leader ? lerp(0.12, 0.92, (k + r()) / nL) : R(0.3, 0.92);
      const yl = y0 + crownBot + crownH * hy;
      const e = Math.sqrt(Math.max(0.05, 1 - Math.pow((yl - C.y) / ry, 2)));
      const reach = rx * e * R(0.35, 0.92);
      const Lc = new V3(C.x + Math.cos(ang) * reach, yl, C.z + Math.sin(ang) * reach);
      const lobeR = sp.lobeR * rx * R(0.55, 1.35) * (lod ? 1.2 : 1);
      // Charpentière
      const start = sp.leader ? trunkAt(Math.max(y0 + crownBot * 0.8, yl - 1.2 - rx * 0.3)) : trunkAt(y0 + topH - R(0, 0.4));
      const mid = start.clone().lerp(Lc, 0.5); mid.y += R(0.2, 0.8);
      const limb = bez(start, mid, Lc, lod ? 2 : 4);
      const rl = r0 * (sp.leader ? 0.38 : 0.55) * Math.sqrt(lobeR / rx * 2);
      tube(A, limb, rl, rl * 0.3, lod ? 4 : 6, tint);
      // Masse interne : cartes « bouquet » orientées vers l'extérieur du houppier
      const nCore = lod ? RI(13, 18) : RI(sp.core[0], sp.core[1]);
      for (let i = 0; i < nCore; i++) {
        unit(outv); outv.y *= 0.8;
        p.copy(Lc).addScaledVector(outv, lobeR * (lod ? 0.9 * Math.pow(r(), 0.5) : 0.6 * Math.pow(r(), 0.7)));
        if (p.y < y0 + crownBot + 0.3) p.y = y0 + crownBot + 0.3 + r() * 0.5;
        const ex = (p.x - C.x) / rx, ey = (p.y - C.y) / ry, ez = (p.z - C.z) / rx, de = Math.sqrt(ex * ex + ey * ey + ez * ez);
        cn.set(ex, ey * 0.8 + 0.15, ez).normalize().multiplyScalar(0.7).addScaledVector(outv.normalize(), 0.3).normalize();
        zh.copy(cn).lerp(unit(tmp), 0.35).normalize();
        yv.crossVectors(zh, unit(tmp)).normalize();
        quatYZ(yv, zh, q);
        const s = lod ? R(2.1, 3.0) * Math.min(1.25, H / 12) : R(1.4, 2.0);
        const ao = lod ? (0.38 + 0.65 * sstep(0.15, 1.0, de)) * (0.8 + 0.3 * clamp01((p.y - y0 - crownBot) / crownH))
                       : (0.2 + 0.3 * sstep(0.1, 1.0, de));
        const b = R(0.85, 1.12) * ao;
        (lod ? LB.bg : LB.core).add(p, q, s, [hc[0] * b, hc[1] * b, hc[2] * b], cn);
      }
      if (lod) continue;
      const nC = RI(sp.clumps[0], sp.clumps[1]);
      for (let c = 0; c < nC; c++) {
        unit(tmp); tmp.y *= 0.7;
        const cc = Lc.clone().addScaledVector(tmp, lobeR * R(0.3, 0.8));
        if (cc.y < y0 + crownBot) cc.y = y0 + crownBot + R(0, 0.4);
        {
          const s = limb[Math.min(limb.length - 1, 1 + Math.floor(r() * (limb.length - 1)))];
          const m2 = s.clone().lerp(cc, 0.5); m2.y += 0.15;
          tube(A, bez(s, m2, cc, 2), rl * 0.4, 0.015, 4, tint);
        }
        const cR = R(cr[0], cr[1]);
        const nCards = Math.round(dens * cR * cR * R(0.8, 1.2));
        for (let i = 0; i < nCards; i++) {
          unit(outv);
          const d = cR * Math.pow(r(), 0.45);
          p.copy(cc).addScaledVector(outv, d); p.y = lerp(cc.y, p.y, 0.8);
          if (p.y < y0 + 0.8) continue;
          yv.copy(outv).multiplyScalar(0.8).add(unit(tmp).multiplyScalar(0.55)); yv.y += 0.25;
          zh.copy(unit(tmp));
          quatYZ(yv, zh, q);
          const s = R(card[0], card[1]);
          // centre de la carte → normale de houppier et occlusion
          tmp.set(0, s * 0.5, 0).applyQuaternion(q).add(p);
          const ex = (tmp.x - C.x) / rx, ey = (tmp.y - C.y) / ry, ez = (tmp.z - C.z) / rx;
          const de = Math.sqrt(ex * ex + ey * ey + ez * ez);
          cn.set(ex, ey * 0.8 + 0.15, ez).normalize().multiplyScalar(0.75).add(outv.clone().multiplyScalar(0.25)).normalize();
          const ao = (0.18 + 0.82 * sstep(0.3, 1.0, de)) * (de > 0.85 ? 1.1 : 1) * (0.74 + 0.34 * clamp01((tmp.y - y0 - crownBot) / crownH));
          const b = R(0.85, 1.12) * ao;
          LB[sp.leaf].add(p, q, s, [ht[0] * b, ht[1] * b, ht[2] * b], cn);
        }
      }
    }
    trees.push({ x, z, height: H, radius: rx, kind, species: spName });
  }

  // Arbres principaux (aucun devant la façade rue ; dégagement côté gauche pour la vue p07)
  const MAIN = [
    ['birch', -11.5, 3.6, 9.0], ['oak', -20, 3.5, 11.0], ['linden', -15, -27, 12.0], ['oak', -3.0, -29, 12.5],
    ['linden', 8.5, -27, 11.0], ['ash', 21.5, -23, 11.0], ['oak', 26.5, -13, 10.5], ['birch', 24.5, 3.0, 8.5],
    ['linden', 23.5, -6.0, 12.0], ['ash', -25, -27, 11.0], ['oak', 24, -29, 12.0], ['hornbeam', -24, 3.5, 11.0],
    ['ash', 3.0, -40, 12.0], ['hornbeam', 28, -3, 11.5], ['linden', 20.0, -31, 11.5], ['oak', 24.5, -19.5, 10.0],
    ['ash', -7.5, -33, 11.5],
  ];
  MAIN.forEach(([s, x, z, h], k) => growTree(s, x, z, h, 1000 + k * 17));
  // Arbres d'alignement sur le trottoir
  growTree('young', -8 * SX, 6, 5.6, 501, 0, 'street');
  growTree('young', 8 * SX, 6, 5.3, 502, 0, 'street');
  // petits arbres d'ornement dans les massifs avant (de part et d'autre, jamais devant la façade)
  growTree('birch', sMinX - 3.6, 1.9, 6.5, 503, 0, 'garden');
  growTree('young', sMaxX + 3.4, 1.6, 3.0, 504, 0, 'garden');   // jeune arbre bas : la façade droite reste lisible

  // Masses arbustives du jardin (bosquets de 1 à 3 m) : emplacements (géométrie construite avec les massifs)
  const massList = [];
  {
    let placed = 0;
    for (let k = 0; k < 2500 && placed < 140; k++) {
      const a = rnd() * Math.PI * 2, d = rr(9, 34), x = BC.x + Math.cos(a) * d, z = BC.z + Math.sin(a) * d;
      if (z > 3.2 || (x > sMinX - 3.2 && x < sMaxX + 3.2 && z > bMinZ - 4)) continue;   // rue, allée, façades
      if (fbm2(x * 0.12 + 3, z * 0.12 + 7, 2, 41) < 0.47) continue;          // regroupement en massifs
      if (trees.some(t => (t.x - x) ** 2 + (t.z - z) ** 2 < 4)) continue;
      const R = rr(0.8, 1.7), hue = [[1.12, 1.06, 0.72], [0.78, 0.88, 0.8], [1, 1, 1], [0.92, 0.95, 0.78]][Math.floor(rnd() * 4)];
      massList.push({ x, z, R, hue });
      placed++;
      trees.push({ x, z, height: R * 1.6, radius: R, kind: 'shrub' });
    }
  }

  // Rideau d'arbres de fond (LOD simplifié)
  {
    const pts = [];
    const ok = (x, z) => {
      if (z > 3 && z < 19) return false;                                 // rue et ses abords
      if (z >= 19 && z < 48 && Math.abs(x) < 32) return false;            // champ des vues depuis la rue
      if (x > -48 && x < 0 && z > -20 && z < 5) return false;             // cône de la vue p07 (façade gauche)
      for (const p of pts) if ((p[0] - x) ** 2 + (p[1] - z) ** 2 < 30) return false;
      for (const t of trees) if ((t.x - x) ** 2 + (t.z - z) ** 2 < 49) return false;
      return true;
    };
    const species = ['oak', 'linden', 'ash', 'oak', 'hornbeam', 'birch'];
    let tries = 0;
    // bosquets : acceptation pilotée par un bruit basse fréquence, rideau continu au-delà de 70 m
    while (pts.length < 470 && tries++ < 30000) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rr(28 * 28, 136 * 136));
      const x = BC.x + Math.cos(a) * d, z = BC.z + Math.sin(a) * d;
      const grove = sstep(0.38, 0.6, fbm2(x * 0.035 + 4, z * 0.035 + 8, 3, 31)) + sstep(55, 85, d);
      if (rnd() > grove + 0.12) continue;
      if (ok(x, z)) pts.push([x, z]);
    }
    pts.forEach(([x, z], k) => {
      const d = Math.hypot(x - BC.x, z - BC.z);
      growTree(species[k % species.length], x, z, rr(11, 17) * (d > 90 ? 1.15 : 1), 3000 + k * 13, 1, 'bg');
      // sous-étage arbustif qui masque les troncs
      if (rnd() < 0.75) {
        const n = ri(2, 5), y0 = groundY(x, z), q = new THREE.Quaternion(), cn = new V3(), zh = new V3(), yv = new V3(), tmp = new V3();
        for (let i = 0; i < n; i++) {
          const a = rnd() * 6.28, rr0 = rr(0.5, 3.2), px = x + Math.cos(a) * rr0, pz = z + Math.sin(a) * rr0;
          cn.set(Math.cos(a), 0.6, Math.sin(a)).normalize();
          zh.copy(cn).lerp(unit(tmp), 0.3).normalize(); yv.crossVectors(zh, unit(tmp)).normalize();
          quatYZ(yv, zh, q);
          const b = rr(0.45, 0.7);
          LB.bg.add(new V3(px, y0 + rr(0.7, 1.4), pz), q, rr(1.8, 2.8), [0.9 * b, 0.95 * b, 0.85 * b], cn);
        }
      }
    });
  }

  buildGround();

  // Tapis herbacé de la prairie : texture détaillée, fondu tramé (alphaHash) vers la pelouse
  if (M.meadowGround) {
    const A = new Acc(), N = 92, S0 = 92, up = new V3(0, 1, 0);
    const x0 = BC.x - S0 / 2, z0 = BC.z - S0 / 2;
    const inBuild = (x, z) => x > sMinX - 0.2 && x < sMaxX + 0.2 && z > bMinZ - 0.2 && z < frontZ + 0.2;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const x = x0 + i * S0 / N, z = z0 + j * S0 / N;
      const a = inBuild(x, z) || z > 4.4 ? 0 : clamp01(meadowF(x, z) * 1.6);
      const k = 0.85 + 0.3 * fbm2(x / 9 + 4, z / 9 + 1, 3, 71);
      A.p.push(x, 0.006, z); A.n.push(0, 1, 0); A.u.push(x, -z); A.c.push(k, k, k, a);
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i; A.tri(a, a + N + 1, a + 1); A.tri(a + 1, a + N + 1, a + N + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(A.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(A.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(A.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(A.c, 4));
    g.setIndex(A.i);
    const mm = M.meadowGround.clone(); mm.vertexColors = true; mm.alphaHash = true;
    patchAntiTile(mm, 0.4);
    addMesh(g, mm, { receive: true, name: 'meadowGround' });
  }

  // Lisière lointaine : anneau de houppiers peints qui ferme l'horizon (r = 145 m)
  {
    const R0 = 145, H0 = 26, n = 160, rep = 20;
    const A = new Acc();
    for (let i = 0; i <= n; i++) {
      const a = i / n * Math.PI * 2, x = BC.x + Math.cos(a) * R0, z = BC.z + Math.sin(a) * R0;
      const nr = new V3(-Math.cos(a) * 0.55, 1, -Math.sin(a) * 0.55).normalize();
      const y0 = groundY(x, z) - 3;
      A.v(new V3(x, y0, z), nr, i / n * rep, 0); A.v(new V3(x, y0 + H0 + 3, z), nr, i / n * rep, 1);
    }
    for (let i = 0; i < n; i++) { const a = i * 2; A.tri(a, a + 2, a + 1); A.tri(a + 1, a + 2, a + 3); }
    const wg = A.geo(); wg.setAttribute('aCrownN', new THREE.Float32BufferAttribute(new Float32Array(wg.attributes.position.count * 3), 3));
    const wall = addMesh(wg, M.forestEdge, { receive: false, name: 'forestEdge' });
    wall.userData.noAO = true;
  }

  // Écorces fusionnées
  {
    const barkMat = M.bark.clone(); barkMat.name = 'barkTinted'; barkMat.vertexColors = true;
    addMesh(bark.main.geo(), barkMat, { cast: true, name: 'trunks' });
    addMesh(bark.bg.geo(), barkMat, { cast: false, name: 'bgTrunks' });
  }

  // Fosses des arbres d'alignement
  {
    const soilMat = M.soil.clone(); soilMat.polygonOffset = true; soilMat.polygonOffsetFactor = -1; soilMat.polygonOffsetUnits = -2;
    const pits = [], frames = [];
    for (const x of [-8 * SX, 8 * SX]) {
      const g = new THREE.PlaneGeometry(1.2, 1.2); g.rotateX(-Math.PI / 2); g.translate(x, 0.145, 6); pits.push(worldUV(g));
      frames.push(boxGeo(x - 0.65, x + 0.65, 0.13, 0.15, 5.35, 5.4), boxGeo(x - 0.65, x + 0.65, 0.13, 0.15, 6.6, 6.65), boxGeo(x - 0.65, x - 0.6, 0.13, 0.15, 5.4, 6.6), boxGeo(x + 0.6, x + 0.65, 0.13, 0.15, 5.4, 6.6));
    }
    addMesh(merge(pits), soilMat, { name: 'treePits' });
    addMesh(merge(frames), M.frameDark, { name: 'treePitFrames' });
  }

  // -------------------------------------------------------------------------
  // Massifs
  // -------------------------------------------------------------------------
  const B = {
    shrub: batch('shrubs', G.card, M.leafB, { crown: true }),
    shrubA: batch('shrubsA', G.card, M.leafA, { crown: true }),
    rosette0: batch('perennials0', G.rosette[0], M.leafA), rosette1: batch('perennials1', G.rosette[1], M.leafC),
    grass: batch('grasses', G.tuft3, M.grassBlade), plume: batch('plumes', G.tuft4, M.grassPlume),
    lav: batch('lavender', G.tuft3, M.flowerLav), white: batch('whiteFlowers', G.tuft3, M.flowerWhite),
    lawn: batch('lawnTufts', G.tuftLo, M.grassBlade, { cast: false }),
    meadow: batch('meadow', G.tuftLo, M.grassBlade, { cast: true }),
    sedum: batch('sedum', G.mat, M.sedum, { cast: false }),
    strel: G.strel.map((g, k) => batch('strelitzia' + k, g, M.leafTropical)),
    palm: G.palm.map((g, k) => batch('palm' + k, g, M.leafPalm)),
    trail: batch('trailing', G.trail, M.leafTrail),
  };
  const Q = new THREE.Quaternion(), P = new V3();

  // Arbuste arrondi : nuage de cartes à normales sphériques
  function shrub(x, y, z, R, opt = {}) {
    const nb = opt.blobs ?? (R > 0.35 ? ri(2, 3) : 1);
    if (nb > 1) {
      // sous-masses décentrées de tailles inégales : silhouette irrégulière
      const a0 = rnd() * 6.28;
      for (let k = 0; k < nb; k++) {
        const a = a0 + k * 2.4 + rr(-0.5, 0.5), d = R * rr(0.25, 0.6), r2 = R * rr(0.5, 0.85);
        shrub(x + Math.cos(a) * d, y, z + Math.sin(a) * d, r2, { ...opt, blobs: 1, squash: rr(0.55, 0.9) });
      }
      return;
    }
    const bt = opt.batch || B.shrub, hue = opt.tint || [1, 1, 1], sq = opt.squash ?? 0.8;
    const n = Math.round((opt.dens ?? 70) * R * R + 6);
    const c = new V3(x, y + R * 0.75 * sq, z), p = new V3(), o = new V3(), yv = new V3(), cn = new V3(), tmp = new V3(), q = new THREE.Quaternion();
    for (let i = 0; i < n; i++) {
      unit(o); o.y = Math.abs(o.y) * 0.9 - 0.15;
      o.normalize();
      p.copy(c).addScaledVector(o, R * Math.pow(rnd(), 0.4) * 0.8); p.y = c.y + (p.y - c.y) * sq; if (p.y < y + 0.03) p.y = y + 0.03;
      yv.copy(o).add(unit(tmp).multiplyScalar(0.6)); yv.y += 0.2;
      quatYZ(yv, unit(tmp), q);
      const s = rr(0.28, 0.42) * (opt.card ?? 1);
      tmp.set(0, s * 0.5, 0).applyQuaternion(q).add(p);
      cn.subVectors(tmp, c).normalize(); cn.y += 0.25; cn.normalize();
      const de = tmp.distanceTo(c) / R, ao = (0.3 + 0.75 * sstep(0.2, 1, de)) * (0.7 + 0.35 * clamp01((tmp.y - y) / (R * 1.4)));
      const b = rr(0.8, 1.12) * ao;
      bt.add(p, q, s, [hue[0] * b, hue[1] * b, hue[2] * b], cn);
    }
  }

  const tintGrass = () => { const k = rr(0.85, 1.1); return [0.56 * k, 0.7 * k, 0.36 * k]; };
  for (const m of massList) shrub(m.x, 0, m.z, m.R, { tint: m.hue, dens: 34, card: 1.5, blobs: ri(3, 5), batch: rnd() < 0.55 ? B.shrub : B.shrubA });
  const beds = [
    // [x0, x1, z0, z1, mur le plus proche : 'z0'|'z1'|'x0'|'x1']
    [sMinX - 4.0, DR[0] - 0.25, frontZ + 0.1, 4.3, 'z0'], [ST[1] + 0.15, sMaxX + 4.0, frontZ + 0.1, 4.3, 'z0'],
    [sMinX - 2.8, sMinX - 0.15, bMinZ - 0.6, frontZ + 0.1, 'x1'], [sMaxX + 0.15, sMaxX + 2.8, bMinZ - 0.6, frontZ + 0.1, 'x0'],
    [sMinX - 2.8, sMaxX + 2.8, bMinZ - 3.4, bMinZ - 0.15, 'z1'],
  ];
  {
    const soilGeos = [];
    for (const [x0, x1, z0, z1, wall] of beds) {
      // contour irrégulier
      const shape = new THREE.Shape(), pts = [];
      const per = (a, b, n, f) => { for (let i = 0; i < n; i++) pts.push(f(a + (b - a) * i / n)); };
      const j = () => rr(-0.12, 0.12);
      per(x0, x1, Math.ceil((x1 - x0) / 0.4), x => [x, z1 + (wall === 'z1' ? 0 : j())]);
      per(z1, z0, Math.ceil((z1 - z0) / 0.4), z => [x1 + (wall === 'x1' ? 0 : j()), z]);
      per(x1, x0, Math.ceil((x1 - x0) / 0.4), x => [x, z0 + (wall === 'z0' ? 0 : j())]);
      per(z0, z1, Math.ceil((z1 - z0) / 0.4), z => [x0 + (wall === 'x0' ? 0 : j()), z]);
      pts.forEach(([x, z], k) => k ? shape.lineTo(x, -z) : shape.moveTo(x, -z));
      const g = new THREE.ShapeGeometry(shape); g.rotateX(-Math.PI / 2); g.translate(0, 0.015, 0);
      soilGeos.push(worldUV(g));

      // plantation en dérives (bruit) avec étagement : haut près du mur, bas devant
      const step = 0.4;
      for (let x = x0 + 0.2; x < x1 - 0.1; x += step) for (let z = z0 + 0.2; z < z1 - 0.1; z += step) {
        const px = x + rr(-0.4, 0.4) * step, pz = z + rr(-0.4, 0.4) * step;
        const dw = wall === 'z0' ? pz - z0 : wall === 'z1' ? z1 - pz : wall === 'x0' ? px - x0 : x1 - px;
        const depth = wall[0] === 'z' ? z1 - z0 : x1 - x0;
        const hf = lerp(1.75, 0.65, Math.pow(clamp01(dw / depth), 0.8));
        let n = fbm2(px * 0.33 + 5, pz * 0.33 + 1, 3, 11);
        if (rnd() < 0.15) n = rnd();
        P.set(px, 0.015, pz);
        const rot = qY(rnd() * Math.PI * 2, Q);
        if (n < 0.33) {
          const tint = rnd() < 0.2 ? [1.1, 1.08, 0.75] : rnd() < 0.2 ? [0.8, 0.9, 0.95] : [1, 1, 1];
          shrub(px, 0.015, pz, rr(0.38, 0.62) * hf, { tint, batch: rnd() < 0.3 ? B.shrubA : B.shrub, dens: 60 });
        } else if (n < 0.46) B.grass.add(P, rot, new V3(rr(0.55, 0.8) * hf, rr(0.5, 0.85) * hf, rr(0.55, 0.8) * hf), tintGrass());
        else if (n < 0.6) { const k = rnd() < 0.5 ? 0 : 1; const s = rr(0.4, 0.6) * hf; B['rosette' + k].add(P, rot, new V3(s, s * rr(0.8, 1.1), s), [rr(0.85, 1.05), rr(0.9, 1.05), rr(0.8, 1)]); }
        else if (n < 0.65) { const s = rr(0.5, 0.7); B.lav.add(P, rot, new V3(s, s * hf, s), [1, 1, 1]); }
        else if (n < 0.71) { const s = rr(0.45, 0.65); B.white.add(P, rot, new V3(s, s * hf, s), [1, 1, 1]); }
        else if (n < 0.86) B.grass.add(P, rot, new V3(rr(0.5, 0.7) * hf, rr(0.45, 0.7) * hf, rr(0.5, 0.7) * hf), [0.75, 0.72, 0.45]);
        else { const s = rr(0.7, 0.95); B.plume.add(P, rot, new V3(s, s * rr(1.0, 1.35) * hf, s), [rr(0.9, 1), rr(0.88, 0.95), rr(0.75, 0.85)]); }
      }
    }
    const soilMat = M.soil.clone(); soilMat.polygonOffset = true; soilMat.polygonOffsetFactor = -1; soilMat.polygonOffsetUnits = -2;
    addMesh(merge(soilGeos), soilMat, { name: 'bedsSoil' });
  }

  // Prairie haute, vivaces et touffes autour du bâtiment ; gazon ras dans les clairières
  {
    const inBuild = (x, z) => x > sMinX - 4.1 && x < sMaxX + 4.1 && z > bMinZ - 3.5 && z < 4.5;
    let nm = 0, nl = 0;
    for (let k = 0; k < 90000 && (nm < 16000 || nl < 3000); k++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * 42, x = BC.x + Math.cos(a) * d, z = BC.z + Math.sin(a) * d;
      if (inBuild(x, z) || z > 4.3) continue;
      const m = meadowF(x, z);
      const rot = qY(rnd() * 6.28, Q);
      P.set(x, 0, z);
      if (rnd() < m) {
        if (nm >= 16000) continue;
        nm++;
        const t = rnd(), hue = fbm2(x * 0.15 + 1, z * 0.15 + 3, 2, 61);
        if (t < 0.74) {
          const g = [0.5, 0.62, 0.27], o = [0.72, 0.68, 0.32], st = [0.95, 0.8, 0.48];
          const c = hue < 0.45 ? g : hue < 0.62 ? g.map((v, i) => lerp(v, o[i], (hue - 0.45) / 0.17)) : o.map((v, i) => lerp(v, st[i], sstep(0.62, 0.8, hue)));
          const k2 = rr(0.8, 1.15), sc = rr(0.4, 0.75);
          const qt = new THREE.Quaternion().setFromEuler(new THREE.Euler(rr(-0.4, 0.4), rnd() * 6.28, rr(-0.4, 0.4)));
          B.meadow.add(P, qt, new V3(sc * rr(0.9, 1.5), rr(0.3, 0.75) * (0.7 + 0.5 * m), sc * rr(0.6, 1)), c.map(v => v * k2));
        } else if (t < 0.83) { const sc = rr(0.6, 0.9); B.plume.add(P, rot, new V3(sc, rr(0.8, 1.25), sc), [rr(0.92, 1), rr(0.85, 0.95), rr(0.68, 0.8)]); }
        else if (t < 0.86) { const sc = rr(0.45, 0.65); B.lav.add(P, rot, new V3(sc, sc, sc), [1, 1, 1]); }
        else if (t < 0.9) { const sc = rr(0.45, 0.65); B.white.add(P, rot, new V3(sc, sc * 1.1, sc), [1, 1, 1]); }
        else if (t < 0.95) { const sc = rr(0.4, 0.6); B['rosette' + (rnd() < 0.5 ? 0 : 1)].add(P, rot, new V3(sc, sc, sc), [rr(0.9, 1.1), rr(0.95, 1.05), rr(0.7, 0.9)]); }
        else { const sc = rr(0.5, 0.8); B.plume.add(P, rot, new V3(sc, rr(0.55, 0.9), sc), [rr(0.75, 0.9), rr(0.8, 0.9), rr(0.5, 0.6)]); }
      } else if (d < 32 && nl < 3000) {
        nl++;
        const sc = rr(0.25, 0.42), k2 = 0.8 + 0.4 * fbm2(x / 13 + 7, z / 13 + 3, 4, 2);
        B.lawn.add(P, rot, new V3(sc, rr(0.1, 0.2), sc), [0.34 * k2, 0.37 * k2, 0.14 * k2]);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Jardinières et toiture végétalisée (d'après building.userData.planters)
  // -------------------------------------------------------------------------
  const planters = Array.isArray(bud.planters) ? bud.planters : [];
  const bcx = bud.bounds ? (bud.bounds.minX + bud.bounds.maxX) / 2 : 0, bcz = bud.bounds ? (bud.bounds.minZ + bud.bounds.maxZ) / 2 : -9;

  function planterPlants(pl) {
    const alongX = pl.w >= pl.d, L = Math.max(pl.w, pl.d), W = Math.min(pl.w, pl.d);
    const axis = alongX ? new V3(1, 0, 0) : new V3(0, 0, 1), perp = alongX ? new V3(0, 0, 1) : new V3(1, 0, 0);
    // côté intérieur (vers le bâtiment) pour les retombantes
    const toB = new V3(bcx - pl.x, 0, bcz - pl.z);
    const inner = perp.dot(toB) >= 0 ? 1 : -1;
    const big = pl.kind === 'roof' ? 1.25 : 1;
    const n = Math.max(1, Math.round(L / 0.42)), rows = Math.max(1, Math.round(W / 0.6));
    for (let row = 0; row < rows; row++) for (let i = 0; i < n; i++) {
      const t = (i + 0.5 + (row % 2) * 0.4) / n - 0.5;
      if (t > 0.5) continue;
      const across = rows > 1 ? ((row + 0.5) / rows - 0.5) * W : rr(-0.12, 0.12) * W;
      const pos = new V3(pl.x, pl.y, pl.z).addScaledVector(axis, t * L).addScaledVector(perp, across + rr(-0.05, 0.05));
      const h = rnd() * 9;
      const rot = qY(rnd() * Math.PI * 2, Q);
      if (h < 3.2 || (n === 1 && pl.kind === 'roof')) {
        const s = rr(0.9, 1.35) * big;
        B.strel[ri(0, 2)].add(pos, rot, new V3(s, s, s), [rr(0.9, 1.05), rr(0.95, 1.08), rr(0.9, 1.0)]);
      } else if (h < 6) {
        const s = rr(0.8, 1.15) * big;
        B.palm[ri(0, 2)].add(pos, rot, new V3(s, s, s), [rr(0.92, 1.05), rr(0.95, 1.08), rr(0.88, 1.0)]);
      } else {
        shrub(pos.x, pos.y, pos.z, rr(0.22, 0.32) * big, { dens: 90, card: 0.75, tint: [0.95, 1.05, 0.9], batch: rnd() < 0.5 ? B.shrub : B.shrubA });
        const s = rr(0.4, 0.55); B.grass.add(pos.clone().addScaledVector(axis, 0.15), rot, new V3(s, s, s), tintGrass());
      }
    }
    // retombantes
    const nt = Math.max(2, Math.round(L / 0.3));
    for (let i = 0; i < nt; i++) {
      if (rnd() < 0.45) continue;
      const t = (i + rr(0.2, 0.8)) / nt - 0.5;
      const sides = pl.kind === 'roof' ? [1, -1] : [inner];
      for (const sd of sides) {
        const pos = new V3(pl.x, pl.y + 0.02, pl.z).addScaledVector(axis, t * L).addScaledVector(perp, sd * (W / 2 + 0.02));
        const outDir = perp.clone().multiplyScalar(sd);
        outDir.applyAxisAngle(new V3(0, 1, 0), rr(-0.45, 0.45));
        const q = quatYZ(new V3(0, 1, 0), outDir, new THREE.Quaternion());
        const s = rr(0.7, 1.1);
        B.trail.add(pos, q, new V3(s, rr(0.3, 0.75), s), [rr(0.9, 1.05), rr(0.95, 1.1), rr(0.85, 1)]);
      }
    }
  }

  function greenRoof(pl) {
    const x0 = pl.x - pl.w / 2 + 0.12, x1 = pl.x + pl.w / 2 - 0.12, z0 = pl.z - pl.d / 2 + 0.12, z1 = pl.z + pl.d / 2 - 0.12;
    const holes = bud.greenroofHoles || [];
    const free = (x, z, m = 0) => !holes.some(h => x > h.x0 - m && x < h.x1 + m && z > h.z0 - m && z < h.z1 + m);
    const pal = (x, z) => {
      const a = fbm2(x * 0.42 + 11, z * 0.42 + 4, 3, 21), b = fbm2(x * 0.3 + 2, z * 0.3 + 9, 2, 22);
      const green = [0.46, 0.66, 0.3], olive = [0.64, 0.66, 0.33], ocre = [0.88, 0.66, 0.36], rust = [0.8, 0.42, 0.26];
      const m = (u, v, t) => u.map((c, i) => lerp(c, v[i], t));
      let c = m(green, olive, sstep(0.42, 0.52, a));
      c = m(c, m(ocre, rust, sstep(0.42, 0.6, b)), sstep(0.56, 0.66, a));
      const k = rr(0.7, 1.02);
      return { c: c.map(v => v * k), a };
    };
    const y = pl.y;
    for (let x = x0; x < x1; x += 0.4) for (let z = z0; z < z1; z += 0.4) {
      const px = x + rr(0, 0.4), pz = z + rr(0, 0.4);
      if (px > x1 || pz > z1 || !free(px, pz)) continue;
      const { c, a } = pal(px, pz);
      const s = rr(0.5, 0.8);
      P.set(px, y + 0.01 + rnd() * 0.05, pz);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rr(-0.12, 0.12), rnd() * 6.28, rr(-0.12, 0.12)));
      B.sedum.add(P, q, new V3(s, s, s), c);
      const r2 = rnd();
      if (r2 < 0.42) {
        const hs = rr(0.35, 0.55);
        B.grass.add(P.set(px + rr(-0.15, 0.15), y, pz + rr(-0.15, 0.15)), qY(rnd() * 6.28, Q), new V3(hs, rr(0.22, 0.42), hs), c.map((v, i) => v * [0.95, 0.95, 0.9][i]));
      } else if (r2 < 0.5 && a > 0.5) {
        const hs = rr(0.55, 0.75);
        B.plume.add(P.set(px, y, pz), qY(rnd() * 6.28, Q), new V3(hs, rr(0.6, 0.9), hs), [rr(0.95, 1.05), rr(0.85, 0.95), rr(0.65, 0.78)]);
      } else if (r2 < 0.53) {
        const s2 = rr(0.4, 0.5); B.lav.add(P.set(px, y, pz), qY(rnd() * 6.28, Q), new V3(s2, s2 * 0.8, s2), [1, 1, 1]);
      } else if (r2 < 0.545) shrub(px, y, pz, rr(0.22, 0.35), { dens: 80, card: 0.8, tint: [0.9, 1, 0.85] });
    }
  }

  for (const pl of planters) {
    if (pl.kind === 'greenroof') greenRoof(pl);
    else if (pl.kind === 'balcony' || pl.kind === 'loggia' || pl.kind === 'roof') planterPlants(pl);
    else if (pl.kind === 'indoor') {
      const s = rr(0.26, 0.32);
      B.strel[ri(0, 2)].add(new V3(pl.x, pl.y, pl.z), qY(rnd() * 6.28, Q), new V3(s, s * 0.9, s), [0.95, 1.05, 0.95]);
    }
  }

  // -------------------------------------------------------------------------
  // Construction des InstancedMesh et statistiques
  // -------------------------------------------------------------------------
  for (const b of batches) b.build();

  let tris = 0, instances = 0;
  for (const m of meshes) {
    const g = m.geometry, t = (g.index ? g.index.count : g.attributes.position.count) / 3;
    const n = m.isInstancedMesh ? m.count : 1;
    tris += t * n; instances += m.isInstancedMesh ? n : 0;
  }
  group.userData = {
    trees: trees.filter(t => t.kind !== 'shrub'),
    stats: { triangles: Math.round(tris), drawCalls: meshes.length, instances, buildTime: Math.round(performance.now() - t0) },
  };
  return group;
}
