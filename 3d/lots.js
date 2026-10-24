/**
 * Canopée — lots, plans d'étage, visite intérieure et volumes de disponibilité (Three.js 0.160)
 *
 *   export function createLots(THREE, M, buildingUserData, lotsData) → API (SPEC, révision 3 + passe 6)
 *
 * Chaque étage existe en deux présentations, partageant sols et mobilier :
 *  - 'plan'  : maquette coupée à 1,2 m (tranche de coupe sombre unique, portes avec vantail et arc,
 *              vitrages en traits fins, étiquettes) — matériaux éclairés par la scène ;
 *  - 'walk'  : intérieur pleine hauteur pour la visite à pied (doublages des façades percés des baies,
 *              cloisons, linteaux, plafond avec spots) — éclairage baké dans les couleurs de sommet,
 *              matériaux non éclairés.
 * Les plans suivent le gabarit exporté par building.js (userData.layout). Les pièces modélisées et
 * simulées d'interiors.js sont masquées dans la tranche de l'étage affiché (setInteriorBand).
 *
 * Conventions : mètres, Y vers le haut, rue vers +Z. yaw : rotation de caméra three.js (ordre 'YXZ'),
 * yaw = 0 regarde vers -Z, yaw = π regarde la rue, yaw = -π/2 regarde vers +X.
 */
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { drawParquet, mulberry32 } from './interiors.js';
import { createCar } from './cars.js';

// Gabarit de repli (identique à building.js passe 5) si building.js ne l'exporte pas
const DEF_LAYOUT = {
  HW: 6, T: 0.42, SOCLE: 6.72, FLOORS: [3, 6, 9], SLAB: 0.4, DECK: 12.45,
  slab: { x0: -0.6, x1: 6.72, z0: -1.2, z1: 1.5, retX: 4.8, retZ: -11 },
  loggias: { A: [-4.6, -2.8], B: [-9.0, -7.2], C: [-17.6, -15.4], depthX: 4.8 },
  loggiaDoors: { A: [-4.15, -3.05], B: [-8.55, -7.45], C: [-16.8, -15.7] },
  frontBaie: [-4.296, -0.984], loggiaGlass: [1.08, 4.92], lame: [-6, -4.488], sideWall: [-1.02, -0.6],
  leftWin: [-2.4, -5.4, -6.9, -12.1, -13.6, -15.2, -17.6], leftWinW: 0.95, stairWin: [-10.15, -9.15],
  backWinX: [-4.5, -1.5, 1.5, 4.5], rdcLeftWin: [-5.4, -12.1, -15.2, -17.6],
  edicule: { x: [-4.8, -1.92], z: [-10.6, -7.6] },
  rdc: { garages: [[-4.02, -0.78], [-0.6, 2.64]], door: [2.82, 4.14], window: [-5.52, -4.44], socleDepth: -1.4 },
};
const DEF_LEVELS = [
  { key: 0, name: 'RDC', y0: 0, y1: 3 }, { key: 1, name: 'R+1', y0: 3, y1: 6 }, { key: 2, name: 'R+2', y0: 6, y1: 9 },
  { key: 3, name: 'R+3', y0: 9, y1: 12 }, { key: 4, name: 'Toit', y0: 12, y1: 13.2 },
];
const STATUS_DEF = { disponible: '#3f8f5f', reserve: '#c9932f', vendu: '#b0503c' };
const CUT = 1.2;            // plan de coupe : 1,2 m au-dessus du sol fini
const WALL_T = 0.25;        // murs porteurs intérieurs (noyau, séparatifs)
const PART_T = 0.08;        // cloisons
const DOOR_H = 2.04;        // hauteur de passage des portes

// ---------- géométrie plane ----------
const area = (P) => { let a = 0; for (let i = 0; i < P.length; i++) { const [x0, z0] = P[i], [x1, z1] = P[(i + 1) % P.length]; a += x0 * z1 - x1 * z0; } return a / 2; };
const centroid = (P) => {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0; i < P.length; i++) { const [x0, z0] = P[i], [x1, z1] = P[(i + 1) % P.length], c = x0 * z1 - x1 * z0; a += c; cx += (x0 + x1) * c; cz += (z0 + z1) * c; }
  a /= 2; return [cx / (6 * a), cz / (6 * a)];
};
const inside = (P, x, z) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, zi] = P[i], [xj, zj] = P[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
const rect = (x0, x1, z0, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
// décalage d'un polygone orthogonal : d(i) > 0 vers l'extérieur pour l'arête i
function offsetOrtho(P, d) {
  const s = Math.sign(area(P)) || 1, n = P.length, lines = [];
  for (let i = 0; i < n; i++) {
    const [x0, z0] = P[i], [x1, z1] = P[(i + 1) % n];
    const horiz = Math.abs(z1 - z0) < 1e-9;
    const nx = (z1 - z0) * s, nz = -(x1 - x0) * s, L = Math.hypot(nx, nz) || 1;
    lines.push({ horiz, c: horiz ? z0 + (nz / L) * d(i) : x0 + (nx / L) * d(i) });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = lines[(i - 1 + n) % n], b = lines[i];
    if (a.horiz === b.horiz) { out.push(P[i]); continue; }
    out.push(a.horiz ? [b.c, a.c] : [a.c, b.c]);
  }
  return out;
}
const segDist = (x, z, s) => {
  const [ax, az] = s.a, [bx, bz] = s.b, dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
  return Math.hypot(x - ax - t * dx, z - az - t * dz);
};

export function createLots(THREE, M, buildingUserData = {}, lotsData = {}) {
  const bud = buildingUserData || {};
  const LY = { ...DEF_LAYOUT, ...(bud.layout || {}) };
  const HW = LY.HW, T = LY.T, FL = LY.FLOORS, SLAB = LY.SLAB, DECK = LY.DECK;
  const IN = HW - T;                                    // nu intérieur des façades latérales
  const levels = bud.levels || DEF_LEVELS;
  const lotsList = (lotsData && lotsData.lots) || [];
  const zones = (lotsData && lotsData.zones) || {};
  const statusColor = (s) => new THREE.Color(((lotsData.statuts || {})[s] || {}).color || STATUS_DEF[s] || '#888888');
  const floorY = (k) => (k === 0 ? 0 : k === 4 ? DECK : FL[k - 1] + SLAB);
  const ceilH = (k) => (k === 0 ? 2.7 : k === 4 ? 0 : 2.5);      // hauteur sous plafond (balade)
  const walkCeilingY = (k) => (k === 4 || k == null ? null : +(floorY(+k) + ceilH(+k)).toFixed(3));
  const floors = levels.map((l) => ({ key: l.key, name: l.name, y0: l.y0, cutY: +(floorY(l.key) + CUT).toFixed(3), floorY: floorY(l.key), ceilingY: walkCeilingY(l.key) }));

  const group = new THREE.Group();
  group.name = 'lots';
  const disposables = [];

  // ---------------------------------------------------------------- textures & matériaux
  const tex = (cv, rep) => { const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; disposables.push(t); return t; };
  const texParquet = tex(drawParquet(mulberry32(77)), 1 / 2.4);
  const texTile = (() => { // carrelage grand format 60 × 60, joints fins (1,2 m par répétition)
    const S = 512, cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d'), r = mulberry32(5);
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { const l = 86 + r() * 4; g.fillStyle = `hsl(205,10%,${l}%)`; g.fillRect(i * S / 2, j * S / 2, S / 2, S / 2); }
    for (let k = 0; k < 3000; k++) { g.fillStyle = `rgba(0,0,0,${0.03 * r()})`; g.fillRect(r() * S, r() * S, 2, 2); }
    g.fillStyle = '#9fa6ab'; g.fillRect(0, 0, S, 2); g.fillRect(0, S / 2 - 1, S, 2); g.fillRect(0, 0, 2, S); g.fillRect(S / 2 - 1, 0, 2, S);
    return tex(cv, 1 / 1.2);
  })();
  const std = (name, color, p = {}) => { const m = new THREE.MeshStandardMaterial({ name, color, roughness: 0.85, metalness: 0, ...p }); disposables.push(m); return m; };
  const basic = (name, color, p = {}) => { const m = new THREE.MeshBasicMaterial({ name, color, ...p }); disposables.push(m); return m; };
  const MAT = {
    wall: std('planWall', 0xf1eee8, { roughness: 0.92 }),
    cut: basic('planCut', 0x2a2b2c),
    sill: basic('planSill', 0xdcd8d1),
    parquet: std('planParquet', 0xe9d2b5, { map: texParquet, roughness: 0.6 }),
    tile: std('planTile', 0xffffff, { map: texTile, roughness: 0.35 }),
    concrete: std('planConcrete', 0xb4b0a9, { roughness: 0.95 }),
    ceil: std('planCeiling', 0xf5f3ef, { roughness: 0.95 }),
    furn: std('planFurn', 0xf3f0ea, { roughness: 0.7 }),
    wood: std('planWood', 0xb88d60, { roughness: 0.6 }),
    fabric: std('planFabric', 0xd9d0c3, { roughness: 0.95, map: (M && M.fabric && M.fabric.map) || null }),
    bedding: std('planBedding', 0xf7f5f1, { roughness: 0.95 }),
    ceramic: std('planCeramic', 0xffffff, { roughness: 0.15 }),
    dark: std('planDark', 0x3b3d40, { roughness: 0.55 }),
    green: std('planGreen', 0x5e7d47, { roughness: 0.9 }),
    glass: basic('planGlass', 0x4f7f9a),
    screen: basic('planScreen', 0xbfd6e0, { transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }),
    arc: basic('planArc', 0x6e6a64, { side: THREE.DoubleSide }),
    rail: basic('planRail', 0x8a8780),
    spot: basic('planSpot', 0xffffff),
    paintA: std('carPaintA', 0x2c3136, { roughness: 0.3, metalness: 0.6 }),
    paintB: std('carPaintB', 0xe8e8e6, { roughness: 0.3, metalness: 0.4 }),
    paintC: std('carPaintC', 0x5d6b78, { roughness: 0.3, metalness: 0.6 }),
    carGlass: std('carGlass', 0x1a2026, { roughness: 0.05, metalness: 0.2 }),
    tire: std('carTire', 0x1c1c1d, { roughness: 0.9 }),
    lightF: basic('carLightF', 0xf3f1e6), lightR: basic('carLightR', 0xa3261f),
  };
  MAT.spot.color.setRGB(3.2, 2.9, 2.4);
  for (const m of Object.values(MAT)) m.userData.lotsPlan = true;
  // variantes « visite » : mêmes couleurs et textures, éclairage baké (couleurs de sommet), non éclairées
  const WALK = {};
  const walkMat = (k) => {
    if (WALK[k]) return WALK[k];
    const s = MAT[k];
    if (!s || s.isMeshBasicMaterial) return (WALK[k] = s);
    const m = basic(s.name + 'Walk', s.color.getHex(), { map: s.map || null, vertexColors: true });
    // en visite, les doublages affleurent la face intérieure des façades : ils doivent toujours gagner
    // (sinon le bardage traverse en rayures sombres quand on bouge)
    Object.assign(m, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    return (WALK[k] = m);
  };

  // ---------------------------------------------------------------- constructeur d'un étage
  function FloorBuilder(key) {
    const fy = floorY(key), cy = fy + CUT, H = ceilH(key), buckets = {}, rooms = [], labels = [], colliders = [], lights = [], furniture = [];
    let xf = null, tag = 'common', track = null;
    const withTag = (t, fn) => { const p = tag; tag = t; fn(); tag = p; };
    const push = (mk, g) => {
      if (g.index) g = g.toNonIndexed();
      if (xf) g.applyMatrix4(xf);
      for (const n of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(n)) g.deleteAttribute(n);
      if (!g.attributes.normal) g.computeVertexNormals();
      boxUV(g);
      g.clearGroups();
      const k = tag + '|' + mk;
      (buckets[k] || (buckets[k] = [])).push(g);
      if (track && tag !== 'plan') { g.computeBoundingBox(); track.union(g.boundingBox); }
    };
    // boîte en coordonnées « étage » (y relatif au sol fini) ; seg : subdivisions pour la cuisson
    const B = (mk, x0, x1, y0, y1, z0, z1, skip = '', seg = 0) => {
      const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0), d = Math.abs(z1 - z0);
      if (w < 1e-4 || h < 1e-4 || d < 1e-4) return;
      const g = seg ? new THREE.BoxGeometry(w, h, d, Math.max(1, Math.ceil(w / seg)), Math.max(1, Math.ceil(h / seg)), Math.max(1, Math.ceil(d / seg))) : new THREE.BoxGeometry(w, h, d);
      g.translate((x0 + x1) / 2, fy + (y0 + y1) / 2, (z0 + z1) / 2);
      if (skip) { // faces à retirer : 'px nx py ny pz nz' (ordre des groupes de BoxGeometry)
        const names = ['px', 'nx', 'py', 'ny', 'pz', 'nz'], keep = [];
        const idx = g.index.array;
        g.groups.forEach((gr, i) => { if (!skip.includes(names[i])) for (let j = gr.start; j < gr.start + gr.count; j++) keep.push(idx[j]); });
        g.setIndex(keep);
      }
      push(mk, g);
    };
    const RB = (mk, w, h, d, r, x, y, z, rx = 0) => {
      const g = new RoundedBoxGeometry(w, h, d, 1, r);
      if (rx) g.rotateX(rx);
      g.translate(x, fy + y, z);
      push(mk, g);
    };
    const CY = (mk, rt, rb, h, x, y, z, seg = 14) => { const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1); g.translate(x, fy + y + h / 2, z); push(mk, g); };
    const SPH = (mk, r, x, y, z, sy = 1) => { const g = new THREE.SphereGeometry(r, 12, 8); g.scale(1, sy, 1); g.translate(x, fy + y, z); push(mk, g); };
    // polygone horizontal à la hauteur absolue y (simple, pour les tranches)
    const flat = (mk, P, y, down = false) => {
      const g = new THREE.ShapeGeometry(new THREE.Shape(P.map(([x, z]) => new THREE.Vector2(x, -z))));
      g.rotateX(down ? Math.PI / 2 : -Math.PI / 2);
      if (down) g.scale(1, 1, -1);
      g.translate(0, y, 0);
      push(mk, g);
    };
    // polygone horizontal maillé (≈ 0,4 m) pour recevoir l'éclairage baké (sols, plafonds)
    const gridPoly = (mk, P, y, down = false, step = 0.4) => {
      const xs = [...new Set(P.map(p => p[0]))].sort((a, b) => a - b), zs = [...new Set(P.map(p => p[1]))].sort((a, b) => a - b);
      const refine = (arr) => { const o = []; for (let i = 0; i < arr.length - 1; i++) { const n = Math.max(1, Math.ceil((arr[i + 1] - arr[i]) / step)); for (let k = 0; k < n; k++) o.push(arr[i] + (arr[i + 1] - arr[i]) * k / n); } o.push(arr[arr.length - 1]); return o; };
      const gx = refine(xs), gz = refine(zs), pos = [];
      for (let i = 0; i < gx.length - 1; i++) for (let j = 0; j < gz.length - 1; j++) {
        const x0 = gx[i], x1 = gx[i + 1], z0 = gz[j], z1 = gz[j + 1];
        if (!inside(P, (x0 + x1) / 2, (z0 + z1) / 2)) continue;
        if (!down) pos.push(x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z1, x1, y, z0, x0, y, z0);
        else pos.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z0, x1, y, z1, x0, y, z1);
      }
      if (!pos.length) return;
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
      push(mk, g);
    };
    const at = (x, z, ry, fn) => {
      const prev = xf, top = !track;
      const m = new THREE.Matrix4().makeRotationY(ry).setPosition(x, 0, z); xf = prev ? prev.clone().multiply(m) : m;
      if (top) track = new THREE.Box3();
      fn();
      xf = prev;
      if (top) {
        // meuble posé au sol, assez haut et assez grand pour qu'on bute dessus en visite (îlot, table, lit, canapé…)
        const b = track; track = null;
        if (!b.isEmpty() && b.min.y - fy < 0.5 && b.max.y - b.min.y > 0.3 && (b.max.x - b.min.x) * (b.max.z - b.min.z) > 0.12)
          furniture.push({ kind: 'meuble', min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] });
      }
    };
    const planOnly = (fn) => withTag('plan', fn), walkOnly = (fn) => withTag('walk', fn);

    // ----- murs -----
    // mur intérieur : plan = 1,2 m + tranche ; visite = pleine hauteur ; façades (faces=false) : tranche seule
    const wallRect = (x0, x1, z0, z1, faces = true, collide = true) => {
      if (x1 - x0 < 1e-3 || z1 - z0 < 1e-3) return;
      planOnly(() => {
        if (faces) B('wall', x0, x1, 0, CUT, z0, z1, 'py ny');
        flat('cut', rect(x0, x1, z0, z1), cy + 0.002);
      });
      if (faces && H > 0) walkOnly(() => B('wall', x0, x1, 0, H, z0, z1, 'py ny', 0.5));
      if (collide) colliders.push(...rectSegs(x0, x1, z0, z1));
    };
    const lintel = (axis, c0, c1, a, b) => {
      if (H <= DOOR_H) return;
      walkOnly(() => axis === 'x' ? B('wall', a, b, DOOR_H, H, c0, c1, 'py', 0.5) : B('wall', c0, c1, DOOR_H, H, a, b, 'py', 0.5));
    };
    // mur le long d'un axe avec ouvertures : axis 'x' (mur parallèle à X, épaisseur en z) ou 'z'
    // openings : [{a, b, type: 'win'|'door'|'void'|'gdoor', noLintel}]
    const run = (axis, c0, c1, s0, s1, openings = [], faces = true) => {
      const ops = openings.filter(o => o.b > s0 && o.a < s1).sort((p, q) => p.a - q.a);
      let s = s0;
      const R = (a, b, collide = true) => axis === 'x' ? wallRect(a, b, c0, c1, faces, collide) : wallRect(c0, c1, a, b, faces, collide);
      const R2 = (a, b, g0, g1) => (axis === 'x' ? rect(a, b, g0, g1) : rect(g0, g1, a, b));
      for (const o of ops) {
        if (o.a > s) R(s, o.a);
        const a = Math.max(o.a, s0), b = Math.min(o.b, s1), mid = (c0 + c1) / 2;
        if (o.type === 'win' || o.type === 'door') planOnly(() => { // baie : tableau clair + trait de vitrage fin
          if (o.type === 'win') flat('sill', R2(a, b, c0, c1), cy + 0.002);
          flat('glass', R2(a, b, mid - 0.012, mid + 0.012), cy + 0.004);
          flat('cut', R2(a - 0.0, a + 0.03, c0, c1), cy + 0.003); flat('cut', R2(b - 0.03, b, c0, c1), cy + 0.003);
        });
        if (o.type === 'win') colliders.push(...(axis === 'x' ? rectSegs(a, b, c0, c1) : rectSegs(c0, c1, a, b)));
        if (o.type === 'gdoor') { // porte sectionnelle fermée : tablier sombre + rails en pointillé
          planOnly(() => flat('cut', R2(a, b, mid - 0.035, mid + 0.035), cy + 0.003));
          colliders.push(...rectSegs(...(axis === 'x' ? [a, b, mid - 0.035, mid + 0.035] : [mid - 0.035, mid + 0.035, a, b])));
        }
        if (o.type === 'void' && faces && !o.noLintel) lintel(axis, c0, c1, a, b);
        s = Math.max(s, o.b);
      }
      if (s < s1) R(s, s1);
    };
    // cloison / mur intérieur centré sur une ligne, avec portes {a, b, hinge:'a'|'b', side:±1}
    const partition = (axis, c, s0, s1, doors = [], t = PART_T) => {
      run(axis, c - t / 2, c + t / 2, s0, s1, doors.map(d => ({ a: d.a, b: d.b, type: 'void' })));
      for (const d of doors) door(axis, c, d);
    };
    // vantail ouvert à 90° (plan : coupé à 1,2 m ; visite : 2,04 m) + arc de débattement au sol
    const door = (axis, c, d) => {
      const w = d.b - d.a, hs = d.hinge === 'b' ? d.b : d.a, dir = d.hinge === 'b' ? -1 : 1, side = d.side || 1, th = 0.04;
      const leaf = (h) => {
        if (axis === 'x') { const x0 = dir > 0 ? hs : hs - th, z0 = c, z1 = c + side * w; B('furn', x0, x0 + th, 0, h, Math.min(z0, z1), Math.max(z0, z1)); return rect(x0, x0 + th, Math.min(z0, z1), Math.max(z0, z1)); }
        const z0 = dir > 0 ? hs : hs - th, x0 = c, x1 = c + side * w; B('furn', Math.min(x0, x1), Math.max(x0, x1), 0, h, z0, z0 + th); return rect(Math.min(x0, x1), Math.max(x0, x1), z0, z0 + th);
      };
      planOnly(() => {
        const R = leaf(CUT - 0.02); flat('cut', R, cy + 0.003);
        if (axis === 'x') arc(hs, c, w, dir > 0 ? 0 : Math.PI, side > 0 ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? -Math.PI / 2 : Math.PI / 2));
        else arc(c, hs, w, dir > 0 ? Math.PI / 2 : -Math.PI / 2, side > 0 ? (dir > 0 ? -Math.PI / 2 : Math.PI / 2) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2));
      });
      if (H > 0) walkOnly(() => leaf(DOOR_H - 0.01));
    };
    const arc = (x, z, r, a0, da) => {
      const pos = [], n = 16;
      for (let i = 0; i < n; i++) {
        const t0 = a0 + da * i / n, t1 = a0 + da * (i + 1) / n;
        const p = (t, rr) => [x + Math.cos(t) * rr, fy + 0.01, z + Math.sin(t) * rr];
        const A = p(t0, r - 0.02), Bq = p(t0, r), C = p(t1, r), D = p(t1, r - 0.02);
        pos.push(...A, ...Bq, ...C, ...A, ...C, ...D);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
      push('arc', g);
    };
    // doublage intérieur d'une façade (visite) : plaque de 12 mm au nu intérieur, percée des baies
    // axis 'x' : façade parallèle à X au nu cIn, pièce du côté dir (±1) ; holes [{a, b, y0, y1}] (y relatifs)
    const lining = (axis, cIn, dir, s0, s1, holes = []) => {
      if (H <= 0) return;
      const c0 = Math.min(cIn, cIn + dir * 0.012), c1 = Math.max(cIn, cIn + dir * 0.012);
      const Hs = holes.map(h => [Math.max(h.a, s0), Math.min(h.b, s1), Math.max(0, h.y0), Math.min(H, h.y1)]).filter(h => h[1] > h[0] && h[3] > h[2]);
      const uniq = (a) => [...new Set(a.map(v => Math.round(v * 1e4) / 1e4))].sort((p, q) => p - q);
      const ss = uniq([s0, s1, ...Hs.flatMap(h => [h[0], h[1]])]), ys = uniq([0, H, ...Hs.flatMap(h => [h[2], h[3]])]);
      walkOnly(() => {
        for (let j = 0; j < ys.length - 1; j++) for (let i = 0; i < ss.length - 1; i++) {
          const cs = (ss[i] + ss[i + 1]) / 2, cyy = (ys[j] + ys[j + 1]) / 2;
          if (Hs.some(h => cs > h[0] && cs < h[1] && cyy > h[2] && cyy < h[3])) continue;
          if (axis === 'x') B('wall', ss[i], ss[i + 1], ys[j], ys[j + 1], c0, c1, '', 0.5);
          else B('wall', c0, c1, ys[j], ys[j + 1], ss[i], ss[i + 1], '', 0.5);
        }
      });
    };

    // ----- pièces -----
    const room = (name, P, floorMat, lot = null, labelAt = null, show = true) => {
      if (floorMat !== 'none') gridPoly(floorMat, P, fy + 0.004);
      if (H > 0 && floorMat !== 'none') walkOnly(() => gridPoly('ceil', P, fy + H, true, 0.5));
      const s = Math.abs(area(P));
      const c = labelAt || centroid(P);
      rooms.push({ name, surface: +s.toFixed(1), poly: P.map(p => [+p[0].toFixed(3), +p[1].toFixed(3)]), lot, level: key, label: c });
      if (show) labels.push({ name, surface: s, x: c[0], z: c[1], y: cy + 0.12 });
      // spots de plafond (éclairage baké de la visite)
      if (H > 0 && floorMat !== 'none' && s > 1.5) {
        const xs = P.map(p => p[0]), zs = P.map(p => p[1]), w = Math.max(...xs) - Math.min(...xs), d = Math.max(...zs) - Math.min(...zs);
        const pts = s > 14 ? (w > d ? [[c[0] - w / 4, c[1]], [c[0] + w / 4, c[1]]] : [[c[0], c[1] - d / 4], [c[0], c[1] + d / 4]]) : [c];
        for (const [x, z] of pts) {
          if (!inside(P, x, z)) continue;
          lights.push({ x, y: fy + H - 0.2, z, I: s > 8 ? 0.6 : 0.45, r2: 4.5 });
          walkOnly(() => CY('spot', 0.06, 0.06, 0.008, x, H - 0.009, z, 16));
        }
      }
    };

    // ----- mobilier simplifié (repère meuble : sol y = 0, face avant vers +z) -----
    const F = {
      bed(w, L = 2.0) {
        B('wood', -w / 2 - 0.03, w / 2 + 0.03, 0, 0.28, 0, L + 0.02);
        RB('bedding', w, 0.2, L - 0.04, 0.05, 0, 0.38, L / 2 + 0.02);
        RB('fabric', w + 0.02, 0.07, L * 0.55, 0.03, 0, 0.5, L * 0.7);
        for (const s of [-1, 1]) RB('bedding', w / 2 - 0.12, 0.13, 0.4, 0.06, s * w / 4, 0.53, 0.32);
        B('fabric', -w / 2 - 0.05, w / 2 + 0.05, 0, 1.0, -0.06, 0.03);
        for (const s of [-1, 1]) B('wood', s * (w / 2 + 0.07), s * (w / 2 + 0.52), 0, 0.48, 0.0, 0.4);
        walkOnly(() => { for (const s of [-1, 1]) { CY('dark', 0.05, 0.07, 0.3, s * (w / 2 + 0.3), 0.48, 0.2); CY('spot', 0.11, 0.14, 0.16, s * (w / 2 + 0.3), 0.78, 0.2); } });
      },
      sofa(w) {
        B('dark', -w / 2 + 0.1, w / 2 - 0.1, 0, 0.08, -0.35, 0.35);
        RB('fabric', w, 0.25, 0.9, 0.04, 0, 0.2, 0);
        RB('fabric', w, 0.42, 0.2, 0.06, 0, 0.55, -0.35);
        for (const s of [-1, 1]) RB('fabric', 0.18, 0.32, 0.9, 0.05, s * (w / 2 - 0.09), 0.48, 0);
        const n = Math.max(1, Math.round((w - 0.36) / 0.7));
        for (let i = 0; i < n; i++) RB('bedding', (w - 0.36) / n - 0.03, 0.12, 0.62, 0.05, -w / 2 + 0.18 + (w - 0.36) * (i + 0.5) / n, 0.38, 0.07);
      },
      armchair() { RB('fabric', 0.8, 0.4, 0.82, 0.06, 0, 0.2, 0); RB('fabric', 0.8, 0.42, 0.18, 0.06, 0, 0.6, -0.32); RB('bedding', 0.5, 0.1, 0.55, 0.04, 0, 0.45, 0.06); },
      coffee(w, d) { B('wood', -w / 2, w / 2, 0.34, 0.38, -d / 2, d / 2); for (const sx of [-1, 1]) for (const sz of [-1, 1]) B('dark', sx * (w / 2 - 0.06) - 0.02, sx * (w / 2 - 0.06) + 0.02, 0, 0.34, sz * (d / 2 - 0.06) - 0.02, sz * (d / 2 - 0.06) + 0.02); },
      rug(w, d) { B('fabric', -w / 2, w / 2, 0, 0.012, -d / 2, d / 2); },
      dining(w, d, n) {
        B('wood', -w / 2, w / 2, 0.72, 0.76, -d / 2, d / 2);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) B('dark', sx * (w / 2 - 0.08) - 0.025, sx * (w / 2 - 0.08) + 0.025, 0, 0.72, sz * (d / 2 - 0.08) - 0.025, sz * (d / 2 - 0.08) + 0.025);
        const per = Math.ceil(n / 2);
        for (let s = 0; s < 2; s++) for (let i = 0; i < per; i++) at(-w / 2 + w * (i + 0.5) / per, (s ? 1 : -1) * (d / 2 + 0.2), s ? Math.PI : 0, () => F.chair());
        walkOnly(() => { for (const x of [-w / 4, w / 4]) { B('dark', x - 0.004, x + 0.004, 1.75, H, -0.004, 0.004); CY('dark', 0.05, 0.2, 0.22, x, 1.55, 0, 18); CY('spot', 0.18, 0.18, 0.005, x, 1.548, 0, 18); } });
      },
      chair() { RB('furn', 0.44, 0.05, 0.44, 0.02, 0, 0.45, 0); B('furn', -0.22, 0.22, 0.45, 0.85, -0.22, -0.19); for (const sx of [-1, 1]) for (const sz of [-1, 1]) B('dark', sx * 0.19 - 0.012, sx * 0.19 + 0.012, 0, 0.45, sz * 0.19 - 0.012, sz * 0.19 + 0.012); },
      kitchen(w) { // linéaire contre le mur (face avant +z), colonne four-frigo
        B('furn', -w / 2, w / 2 - 0.62, 0, 0.88, -0.3, 0.3);
        B('dark', -w / 2, w / 2 - 0.62, 0.88, 0.92, -0.31, 0.31);
        B('ceramic', -w / 2 + 0.3, -w / 2 + 0.85, 0.921, 0.925, -0.2, 0.15);
        B('dark', 0.1, 0.7, 0.922, 0.926, -0.22, 0.18);
        planOnly(() => { B('furn', w / 2 - 0.62, w / 2, 0, CUT - 0.01, -0.3, 0.3); flat('cut', [[w / 2 - 0.62, -0.3], [w / 2, -0.3], [w / 2, 0.3], [w / 2 - 0.62, 0.3]], cy + 0.003); });
        walkOnly(() => { B('furn', w / 2 - 0.62, w / 2, 0, 2.2, -0.3, 0.3); B('wood', -w / 2, w / 2 - 0.62, 1.5, 2.2, -0.3, 0.05); B('ceramic', -w / 2, w / 2 - 0.62, 0.92, 1.5, -0.305, -0.295); });
      },
      island(w) { B('wood', -w / 2, w / 2, 0, 0.88, -0.45, 0.45); B('ceramic', -w / 2 - 0.03, w / 2 + 0.03, 0.88, 0.92, -0.48, 0.48); for (let i = 0; i < 3; i++) CY('dark', 0.17, 0.17, 0.05, -w / 2 + w * (i + 0.5) / 3, 0.62, 0.72); },
      wardrobe(w, d = 0.6) {
        planOnly(() => { B('furn', -w / 2, w / 2, 0, CUT - 0.01, -d / 2, d / 2); flat('cut', [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]], cy + 0.003); });
        walkOnly(() => { B('furn', -w / 2, w / 2, 0, 2.3, -d / 2, d / 2); for (let i = 1; i < Math.round(w / 0.6); i++) { const x = -w / 2 + i * w / Math.round(w / 0.6); B('dark', x - 0.003, x + 0.003, 0.05, 2.25, d / 2, d / 2 + 0.004); } });
      },
      bath() { B('ceramic', -0.85, 0.85, 0, 0.55, -0.37, 0.37); B('glass', -0.75, 0.75, 0.551, 0.552, -0.28, 0.28); },
      shower(s = 0.9) { B('ceramic', -s / 2, s / 2, 0, 0.04, -s / 2, s / 2); B('screen', -s / 2, s / 2, 0.04, H > 0 ? 2.0 : 1.15, s / 2 - 0.01, s / 2); },
      wc() { RB('ceramic', 0.38, 0.4, 0.5, 0.12, 0, 0.2, 0.05); B('ceramic', -0.2, 0.2, 0.0, 0.8, -0.25, -0.1); },
      vanity(w) { B('wood', -w / 2, w / 2, 0.35, 0.82, -0.23, 0.23); B('ceramic', -w / 2, w / 2, 0.82, 0.86, -0.25, 0.25); CY('ceramic', 0.18, 0.15, 0.06, 0, 0.86, 0); walkOnly(() => B('glass', -w / 2 + 0.05, w / 2 - 0.05, 1.05, 1.8, -0.25, -0.24)); },
      desk(w) { B('furn', -w / 2, w / 2, 0.72, 0.75, -0.35, 0.35); for (const s of [-1, 1]) B('dark', s * (w / 2 - 0.04) - 0.015, s * (w / 2 - 0.04) + 0.015, 0, 0.72, -0.3, 0.3); at(0, 0.55, Math.PI, () => F.chair()); },
      tvUnit(w) { B('wood', -w / 2, w / 2, 0.1, 0.5, -0.22, 0.22); B('dark', -0.65, 0.65, 0.5, 1.15, -0.04, 0.0); },
      plant(x, z, h = 1.0) { CY('furn', 0.18, 0.14, 0.38, x, 0, z); SPH('green', 0.32 * h, x, 0.38 + 0.3 * h, z, 1.2); },
      shelves(w, d = 0.35) {
        const top = H > 0 ? 2.1 : CUT - 0.05;
        planOnly(() => { for (const y of [0.0, 0.4, 0.8, CUT - 0.05]) B('furn', -w / 2, w / 2, y, y + 0.03, -d / 2, d / 2); for (const s of [-1, 1]) B('furn', s * w / 2 - 0.015, s * w / 2 + 0.015, 0, CUT - 0.02, -d / 2, d / 2); });
        walkOnly(() => { for (const y of [0.0, 0.4, 0.8, 1.2, 1.6, top]) B('furn', -w / 2, w / 2, y, y + 0.03, -d / 2, d / 2); for (const s of [-1, 1]) B('furn', s * w / 2 - 0.015, s * w / 2 + 0.015, 0, top + 0.03, -d / 2, d / 2); });
      },
      // voiture : caisse galbée, habitacle vitré trapézoïdal, roues, optiques
      car(paint = 'paintA') {
        RB(paint, 1.82, 0.56, 4.45, 0.16, 0, 0.6, 0);
        RB(paint, 1.78, 0.22, 1.05, 0.1, 0, 0.82, 1.55);           // capot
        const cab = new THREE.BoxGeometry(1.6, 0.52, 2.35, 1, 1, 1);
        const p = cab.attributes.position;
        for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * 0.84); p.setZ(i, p.getZ(i) * (p.getZ(i) > 0 ? 0.62 : 0.86)); }
        cab.computeVertexNormals(); cab.translate(0, fy + 1.13, -0.2); push('carGlass', cab);
        const roof = new THREE.BoxGeometry(1.3, 0.04, 1.6); roof.translate(0, fy + 1.4, -0.32); push(paint, roof);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          const g = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 20); g.rotateZ(Math.PI / 2); g.translate(sx * 0.8, fy + 0.33, sz * 1.42); push('tire', g);
          const r = new THREE.CylinderGeometry(0.2, 0.2, 0.25, 16); r.rotateZ(Math.PI / 2); r.translate(sx * 0.8, fy + 0.33, sz * 1.42); push('ceramic', r);
        }
        for (const sx of [-1, 1]) { B('lightF', sx * 0.72 - 0.16, sx * 0.72 + 0.16, 0.72, 0.8, 2.2, 2.235); B('lightR', sx * 0.72 - 0.16, sx * 0.72 + 0.16, 0.74, 0.82, -2.235, -2.2); }
      },
      bikes(n, len) { for (let i = 0; i < n; i++) { const x = -len / 2 + len * (i + 0.5) / n; B('dark', x - 0.02, x + 0.02, 0.3, 0.95, -0.85, 0.85); for (const s of [-1, 1]) { const g = new THREE.TorusGeometry(0.33, 0.025, 6, 18); g.rotateY(Math.PI / 2); g.translate(x, fy + 0.35, s * 0.52); push('dark', g); } } },
    };

    // ----- noyau : escalier à deux volées, palier intermédiaire, ascenseur -----
    const core = () => {
      const zN = -7.6, zS = -11.4, xW = -IN, xE = -1.4;
      const nN = zN - WALL_T / 2, nS = zS + WALL_T / 2, nE = xE - WALL_T / 2;
      room('Escalier', rect(xW, -3.3, nS, nN), 'concrete', null, [-4.45, -9.5]);
      const fw = 1.05, x1a = xW + 0.02, x1b = x1a + fw, x2b = -3.32, x2a = x2b - fw, tread = 0.28, rise = 0.17;
      // plan : marches jusqu'au plan de coupe, ligne de coupe ; visite : volées complètes
      planOnly(() => {
        let z = nN - 0.05, h = 0;
        while (h + rise <= CUT - 0.02 && z - tread > nS + 1.1) { h += rise; B('concrete', x1a, x1b, 0, h, z - tread, z); z -= tread; }
        flat('cut', rect(x1a, x1b, z, z + tread), cy + 0.004);
        for (let k = 0; k < 9; k++) { const zz = nN - 0.4 - k * tread; B('dark', x2a, x2b, 0, 0.012, zz - 0.012, zz); }
      });
      if (H > 0) walkOnly(() => {
        let z = nN - 0.05, h = 0;
        for (let k = 0; k < 8; k++) { h += rise; B('concrete', x1a, x1b, 0, h, z - tread, z); z -= tread; }
        B('concrete', xW + 0.02, x2b, h - 0.12, h, nS + 0.02, z);                 // palier de demi-niveau
        let z2 = z, h2 = h;
        for (let k = 0; k < 6 && h2 + rise < H - 0.4; k++) { h2 += rise; B('concrete', x2a, x2b, h2 - rise, h2, z2, z2 + tread); z2 += tread; }
        B('dark', x2a - 0.02, x2a, 0, h2 + 0.9, nS + 0.1, z2);                    // garde-corps de la trémie
      });
      planOnly(() => B('concrete', xW + 0.02, x2b, 0, 0.012, nS + 0.02, nS + 1.05));
      wallRect(x1b + 0.02, x2a - 0.02, nN - 0.4, nS + 1.1);             // mur d'échiffre
      // cage d'ascenseur
      const lx0 = -3.1, lx1 = nE, lz0 = -9.3;
      run('x', lz0 - 0.1, lz0, lx0, lx1, [{ a: -2.75, b: -1.95, type: 'void' }]);
      run('z', lx0 - 0.2, lx0, lz0 - 0.1, nN, []);
      planOnly(() => {
        B('dark', lx0 + 0.08, lx1 - 0.08, 0, 0.01, lz0 + 0.08, nN - 0.08);
        for (const sgn of [-1, 1]) { const g = new THREE.BoxGeometry(Math.hypot(lx1 - lx0, nN - lz0) - 0.2, 0.012, 0.03); g.rotateY(sgn * Math.atan2(nN - lz0, lx1 - lx0)); g.translate((lx0 + lx1) / 2, fy + 0.016, (lz0 + nN) / 2); push('furn', g); }
      });
      if (H > 0) walkOnly(() => { B('dark', -2.75, -1.95, 0, DOOR_H, lz0 - 0.06, lz0 - 0.04); B('ceramic', -2.36, -2.34, 0.04, DOOR_H - 0.04, lz0 - 0.065, lz0 - 0.06); B('ceramic', -1.85, -1.78, 1.0, 1.25, lz0 - 0.11, lz0 - 0.1); });
      room('Ascenseur', rect(lx0, lx1, lz0, nN), 'concrete', null, null, false);
      room('Palier', rect(-3.3, nE, nS, lz0 - 0.1), 'concrete', null, null, false);
      run('x', zN - WALL_T / 2, zN + WALL_T / 2, xW, xE + WALL_T / 2, []);
      run('x', zS - WALL_T / 2, zS + WALL_T / 2, xW, xE + WALL_T / 2, []);
      run('z', xE - WALL_T / 2, xE + WALL_T / 2, zS, zN, [{ a: -11.15, b: -9.55, type: 'void' }]);
      run('z', -3.3, -3.1, nS, nN, [{ a: nS + 0.1, b: -9.45, type: 'void' }]);
    };

    return { key, fy, cy, H, B, RB, CY, flat, at, F, run, partition, wallRect, lining, room, core, rooms, labels, colliders, lights, buckets, door, planOnly, walkOnly, furniture };
  }

  function rectSegs(x0, x1, z0, z1) { return [{ a: [x0, z0], b: [x1, z0] }, { a: [x1, z0], b: [x1, z1] }, { a: [x1, z1], b: [x0, z1] }, { a: [x0, z1], b: [x0, z0] }]; }
  function boxUV(g) {
    const p = g.attributes.position.array, n = p.length / 3, uv = new Float32Array(n * 2);
    for (let i = 0; i + 2 < n; i += 3) {
      const o = i * 3;
      const ax = p[o + 3] - p[o], ay = p[o + 4] - p[o + 1], az = p[o + 5] - p[o + 2], bx = p[o + 6] - p[o], by = p[o + 7] - p[o + 1], bz = p[o + 8] - p[o + 2];
      const nx = Math.abs(ay * bz - az * by), ny = Math.abs(az * bx - ax * bz), nz = Math.abs(ax * by - ay * bx);
      for (let k = 0; k < 3; k++) { const j = i + k, x = p[j * 3], y = p[j * 3 + 1], z = p[j * 3 + 2]; let u, v; if (nx >= ny && nx >= nz) { u = z; v = y; } else if (ny >= nz) { u = x; v = -z; } else { u = x; v = y; } uv[j * 2] = u; uv[j * 2 + 1] = v; }
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }

  // ---------------------------------------------------------------- façades (tranche, vitrages, doublages)
  const win = (c, w = LY.leftWinW) => ({ a: c - w / 2, b: c + w / 2, type: 'win' });
  function facadesUpper(P) {
    const [ba, bb] = LY.frontBaie, [ga, gb] = LY.loggiaGlass, [sw0, sw1] = LY.sideWall, rx = LY.loggias.depthX;
    const L = LY.loggias, D = LY.loggiaDoors;
    const sq = (c) => ({ ...win(c), y0: 0.55, y1: 1.6 });          // fenêtres carrées : sol fini + 0,55 → 1,6
    P.run('x', -T, 0, -IN, sw1, [{ a: ba, b: bb, type: 'win' }], false);
    P.wallRect(LY.lame[0], LY.lame[1], -0.02, 0.25, false);
    P.wallRect(sw0, sw1, LY.slab.z0, -T, false);
    P.wallRect(sw0, sw1, LY.slab.z0 - T, LY.slab.z0, false);
    P.run('x', LY.slab.z0 - T, LY.slab.z0, sw1, IN, [{ a: ga, b: gb, type: 'door' }], false);
    P.run('z', -HW, -IN, -19, 0, [...LY.leftWin.map(z => win(z)), { a: LY.stairWin[0], b: LY.stairWin[1], type: 'win' }], false);
    P.run('x', -19, -19 + T, -HW, HW, LY.backWinX.map(x => win(x)), false);
    P.run('z', IN, HW, -19 + T, LY.slab.z0, [L.A, L.B, L.C].map(([a, b]) => ({ a, b, type: 'void' })), false);
    for (const k of ['A', 'B', 'C']) {
      const [za, zb] = L[k];
      P.run('z', rx - T, rx, za, zb, [{ a: D[k][0], b: D[k][1], type: 'door' }], false);
      P.wallRect(rx, HW, zb, zb + 0.3, false); P.wallRect(rx, HW, za - 0.3, za, false);
      // visite : retours des loggias (faces côté pièce) et doublage du fond de loggia
      P.walkOnly(() => { P.B('wall', rx - 0.012, IN, 0, P.H, zb, zb + 0.312, 'py ny', 0.5); P.B('wall', rx - 0.012, IN, 0, P.H, za - 0.312, za, 'py ny', 0.5); });
      const sill = k === 'C' ? 0.15 : 0;
      P.lining('z', rx - T, -1, za, zb, [{ a: D[k][0], b: D[k][1], y0: sill, y1: sill + 2.08 }]);
    }
    // doublages des façades (visite)
    P.lining('x', -T, -1, -IN, sw0, [{ a: ba, b: bb, y0: 0.1, y1: 2.15 }]);
    P.lining('x', LY.slab.z0 - T, -1, sw0, IN, [{ a: ga, b: gb, y0: 0, y1: 2.25 }]);
    P.lining('z', -IN, 1, -19 + T, -T, [...LY.leftWin.map(sq), { a: LY.stairWin[0], b: LY.stairWin[1], y0: 0, y1: 2.5 }]);
    P.lining('x', -19 + T, 1, -IN, IN, LY.backWinX.map(x => ({ ...win(x), y0: 0.55, y1: 1.6 })));
    const segs = []; let z = -19 + T;
    for (const [a, b] of [L.C, L.B, L.A]) { segs.push([z, a - 0.312]); z = b + 0.312; }
    segs.push([z, LY.slab.z0 - T]);
    for (const [a, b] of segs) P.lining('z', IN, -1, a, b, []);
  }

  // ---------------------------------------------------------------- plans par étage
  const plans = new Map();
  const lotRooms = new Map();
  const lotsByLevel = (lv) => lotsList.filter(l => l.level === lv);
  const lotOfZone = (lv, zone) => lotsByLevel(lv).find(l => l.zone === zone) || null;

  function planUpper(key) {
    const P = FloorBuilder(key), F = P.F;
    const lotA = lotOfZone(key, 'A'), lotB = lotOfZone(key, 'B');
    const idA = lotA && lotA.id, idB = lotB && lotB.id, suite = lotA && lotA.attique;
    facadesUpper(P);
    P.core();
    P.room('Palier', rect(-1.4 + WALL_T / 2, 2.2 - WALL_T / 2, -11.4 + WALL_T / 2, -9.4 - WALL_T / 2), 'concrete', null, [0.4, -10.4]);
    P.run('x', -9.4 - WALL_T / 2, -9.4 + WALL_T / 2, -1.4, IN, [{ a: 0.75, b: 1.65, type: 'void' }]);
    P.door('x', -9.4 + WALL_T / 2, { a: 0.75, b: 1.65, hinge: 'b', side: 1 });
    P.run('x', -11.4 - WALL_T / 2, -11.4 + WALL_T / 2, -1.4, 2.2 + WALL_T / 2, [{ a: -0.3, b: 0.6, type: 'void' }]);
    P.door('x', -11.4 - WALL_T / 2, { a: -0.3, b: 0.6, hinge: 'a', side: -1 });
    P.run('z', 2.2 - WALL_T / 2, 2.2 + WALL_T / 2, -11.4, -9.4, []);

    // ===== lot A =====
    const zA = LY.loggias.A, zB = LY.loggias.B, rx = LY.loggias.depthX - T;
    P.room('Séjour-cuisine', [[-0.92, -1.62], [IN, -1.62], [IN, zA[1]], [rx, zA[1]], [rx, zA[0]], [IN, zA[0]], [IN, -5.86], [2.11, -5.86], [2.11, -7.56], [-0.92, -7.56]], 'parquet', idA, [2.4, -3.4]);
    P.room(suite ? 'Suite parentale' : 'Chambre 1', rect(-IN, -1.02, -3.96, -T), 'parquet', idA);
    P.room('Chambre 2', rect(-IN, -2.89, -7.475, -4.04), 'parquet', idA);
    P.room('Chambre 3', [[2.19, -5.94], [IN, -5.94], [IN, zB[1]], [rx, zB[1]], [rx, zB[0]], [IN, zB[0]], [IN, -9.275], [2.19, -9.275]], 'parquet', idA, [3.2, -7.6]);
    P.room('Dégagement', rect(-2.81, -0.93, -5.21, -4.04), 'parquet', idA, null, false);
    P.room('Salle de bains', rect(-2.81, -1.01, -7.475, -5.29), 'tile', idA);
    P.room("Salle d'eau · WC", rect(-1.275, 0.47, -9.275, -7.64), 'tile', idA, [-0.4, -8.45]);
    P.room('Entrée', rect(0.55, 2.11, -9.275, -7.64), 'parquet', idA, [1.33, -8.25]);
    P.wallRect(-1.02, -0.6, -1.62, -1.2, false);
    P.partition('z', -0.97, -4.0, -1.62, []);
    P.partition('x', -4.0, -IN, -0.92, [{ a: -2.6, b: -1.8, hinge: 'a', side: 1 }]);
    P.partition('z', -2.85, -7.475, -4.04, [{ a: -5.0, b: -4.2, hinge: 'b', side: -1 }]);
    P.partition('x', -5.25, -2.81, -0.92, [{ a: -2.2, b: -1.5, hinge: 'a', side: -1 }]);
    P.partition('z', -0.97, -7.6, -5.21, []);
    P.partition('z', 2.15, -9.275, -5.9, [{ a: -9.05, b: -8.25, hinge: 'a', side: 1 }]);
    P.partition('x', -5.9, 2.11, IN, []);
    P.partition('x', -7.6, -1.275, 0.7, []);
    P.partition('x', -7.6, 1.9, 2.11, []);
    P.walkOnly(() => P.B('wall', 0.7, 1.9, DOOR_H + 0.1, P.H, -7.64, -7.56, 'py', 0.5));    // retombée de l'entrée
    P.partition('z', 0.51, -9.275, -7.64, [{ a: -8.75, b: -8.0, hinge: 'b', side: -1 }]);
    P.at(-0.92 + 0.3, -6.4, Math.PI / 2, () => F.kitchen(2.2));
    P.at(0.6, -6.4, Math.PI / 2, () => F.island(1.6));
    P.at(0.9, -3.0, 0, () => F.dining(1.8, 0.9, 6));
    P.at(3.4, -5.86 + 0.48, 0, () => F.sofa(2.4));
    P.at(3.4, -4.45, 0, () => F.coffee(1.1, 0.55));
    P.at(3.4, -4.6, 0, () => F.rug(2.6, 1.8));
    P.at(2.2, -4.3, Math.PI / 2 + 0.3, () => F.armchair());
    F.plant(IN - 0.35, -2.05, 1.1); F.plant(-0.55, -2.0, 0.9);
    P.at(-3.3, -3.94, 0, () => F.bed(suite ? 1.8 : 1.6));
    P.at(-IN + 0.32, -1.3, Math.PI / 2, () => F.wardrobe(1.6));
    P.at(-4.25, -7.475 + 0.02, 0, () => F.bed(1.4));
    P.at(-5.25, -4.9, Math.PI / 2, () => F.desk(1.0));
    P.at(3.4, -5.94 - 0.02, Math.PI, () => F.bed(1.4));
    F.plant(2.55, -8.9, 0.8);
    P.at(-1.95, -6.95, 0, () => F.bath());
    P.at(-1.6, -5.55, Math.PI, () => F.vanity(0.9));
    P.at(-0.84, -8.83, Math.PI / 2, () => F.shower(0.85));
    P.at(0.0, -9.0, 0, () => F.wc());
    P.at(-0.05, -7.95, Math.PI, () => F.vanity(0.6));

    // ===== lot B =====
    const zC = LY.loggias.C;
    P.room('Séjour-cuisine', [[2.325, -9.525], [IN, -9.525], [IN, zC[1]], [rx, zC[1]], [rx, zC[0]], [IN, zC[0]], [IN, -19 + T], [1.38, -19 + T], [1.38, -11.525], [2.325, -11.525]], 'parquet', idB, [3.0, -15.0]);
    P.room('Entrée', rect(-2.52, 1.3, -13.9, -11.525), 'parquet', idB, [-0.6, -12.6]);
    P.room('Chambre 2', rect(-IN, -2.6, -15.87, -11.525), 'parquet', idB);
    P.room('Chambre 1', rect(-IN, -0.75, -19 + T, -15.95), 'parquet', idB);
    P.room('Dressing', rect(-0.67, 1.3, -19 + T, -15.95), 'parquet', idB);
    P.room('Dégagement', rect(-2.52, -1.62, -15.87, -13.98), 'parquet', idB, null, false);
    P.room('WC', rect(-1.54, -0.5, -15.87, -13.98), 'tile', idB);
    P.room("Salle d'eau", rect(-0.42, 1.3, -15.87, -13.98), 'tile', idB);
    P.partition('z', -2.56, -15.91, -11.525, [{ a: -15.2, b: -14.4, hinge: 'a', side: 1 }]);
    P.partition('x', -13.94, -1.58, 1.34, [{ a: 0.0, b: 0.75, hinge: 'b', side: 1 }]);
    P.partition('z', -1.58, -15.91, -13.94, [{ a: -15.0, b: -14.3, hinge: 'a', side: 1 }]);
    P.partition('z', -0.46, -15.91, -13.98, []);
    P.partition('x', -15.91, -IN, 1.34, [{ a: -2.45, b: -1.7, hinge: 'a', side: -1 }]);
    P.partition('z', -0.71, -19 + T, -15.95, [{ a: -17.0, b: -16.2, hinge: 'b', side: 1 }]);
    P.partition('z', 1.34, -19 + T, -13.9, []);
    P.at(4.0, -9.525 - 0.3, Math.PI, () => F.kitchen(3.0));
    P.at(3.95, -10.9, Math.PI, () => F.island(1.6));
    P.at(2.9, -13.1, 0, () => F.dining(1.6, 0.85, 4));
    P.at(3.0, -19 + T + 0.48, 0, () => F.sofa(2.2));
    P.at(3.0, -17.2, 0, () => F.coffee(1.0, 0.55));
    P.at(3.0, -17.3, 0, () => F.rug(2.4, 1.7));
    P.at(2.0, -15.6, 0.5, () => F.armchair());
    F.plant(rx - 0.3, -14.0, 1.1);
    P.at(-4.05, -11.55, Math.PI, () => F.bed(1.4));
    P.at(-IN + 0.32, -14.6, Math.PI / 2, () => F.wardrobe(1.4));
    P.at(-3.2, -19 + T + 0.02, 0, () => F.bed(1.6));
    P.at(1.08, -17.25, -Math.PI / 2, () => F.shelves(2.4, 0.4));
    P.at(-1.02, -15.6, 0, () => F.wc());
    P.at(0.85, -14.45, Math.PI / 2, () => F.shower(0.85));
    P.at(0.0, -15.62, 0, () => F.vanity(0.6));
    P.at(-1.2, -11.85, 0, () => F.wardrobe(1.8, 0.5));

    // garde-corps des balcons et de la loggia C (collisions de la balade)
    const s = LY.slab, e = 0.07;
    const rail = [[s.x0 + 0.05, 0], [s.x0 + 0.05, s.z1 - e], [s.x1 - e, s.z1 - e], [s.x1 - e, s.retZ + e], [HW, s.retZ + e]];
    for (let i = 0; i < rail.length - 1; i++) P.colliders.push({ a: rail[i], b: rail[i + 1] });
    P.colliders.push({ a: [HW - 0.06, zC[0]], b: [HW - 0.06, zC[1]] });
    return finish(P);
  }

  function planRDC() {
    const P = FloorBuilder(0), F = P.F, R = LY.rdc, S = LY.SOCLE;
    const [g1, g2] = R.garages, dr = R.door, zf0 = 0.4 - T, zf1 = 0.4;
    P.wallRect(-S, g1[0] - 0.18, zf0, zf1, false);
    P.wallRect(dr[1] + 1.98, S, zf0, zf1, false);
    P.run('x', 0.15, 0.25, g1[0] - 0.18, dr[1] + 1.98, [{ a: g1[0], b: g1[1], type: 'gdoor' }, { a: g2[0], b: g2[1], type: 'gdoor' }, { a: dr[0], b: dr[1], type: 'door' }], false);
    P.door('x', 0.15, { a: dr[0] + 0.05, b: dr[1] - 0.05, hinge: 'b', side: -1 });
    // rails des portes sectionnelles (pointillés au sol, comme sur un plan)
    P.planOnly(() => { for (const [a, b] of [g1, g2]) for (const x of [a + 0.12, b - 0.12]) for (let z = 0.0; z > -3.2; z -= 0.3) P.B('rail', x - 0.012, x + 0.012, 0.005, 0.012, z - 0.16, z); });
    P.wallRect(-S, -HW, -1.4, -0.02, false); P.wallRect(HW, S, -1.4, -0.02, false);
    P.run('z', -HW, -IN, -19, -0.02, LY.rdcLeftWin.map(z => win(z)), false);
    P.run('z', IN, HW, -19 + T, -1.2, [], false);
    P.run('x', -19, -19 + T, -HW, HW, LY.backWinX.map(x => win(x)), false);
    // doublages (visite du hall)
    P.lining('x', 0.15, -1, dr[1], dr[1] + 1.98, []);
    P.lining('x', 0.15, -1, 2.74 + 0.075, dr[0], []);
    P.walkOnly(() => P.B('wall', dr[0], dr[1], 2.35, P.H, 0.138, 0.15));
    P.lining('z', IN, -1, -11.275, -1.2, []);
    P.walkOnly(() => P.B('wall', IN, HW - 0.012, 0, P.H, -1.212, -1.2));
    P.lining('z', HW, -1, -1.2, -0.02, []);
    P.core();
    P.room('Garages 1 et 2', rect(-IN, -0.73, -7.475, -0.02), 'concrete', null, [-3.2, -5.6]);
    P.room('Garages 3 et 4', rect(-0.65, 2.7, -9.275, -0.02), 'concrete', null, [1.0, -4.8]);
    P.partition('z', -0.69, -9.4, 0.15, [], 0.08);
    P.partition('z', 2.74, -9.4, 0.15, [{ a: -8.9, b: -8.1, hinge: 'b', side: 1 }], 0.15);
    // voitures (cars.js) : groupes éclairés séparés, ajoutés au plan après assemblage ; repli : volumes simplifiés
    const CARS = [
      { x: -4.42, z: -3.6, ry: 0.1, model: 'berline', color: 0x3a3e43, seed: 11, rim: 5, rimFinish: 'alu', caliper: 'grey', steer: 0 },
      { x: -2.05, z: -3.5, ry: -0.04, model: 'suv', color: 0xe9e7e1, seed: 12, rim: 10, rimFinish: 'graphite', caliper: 'grey', panoroof: true, steer: 0.12 },
      { x: 1.0, z: -2.4, ry: 0, model: 'berline', color: 0x14203a, seed: 13, rim: 10, rimFinish: 'alu', caliper: 'blue', steer: 0 },
      { x: 1.0, z: -7.05, ry: 0, model: 'citadine', color: 0x0c0d0f, seed: 14, rim: 5, rimFinish: 'alu', caliper: 'grey', blackRoof: false, steer: -0.1 },
    ];
    let cars = null;
    try { cars = CARS.map((c) => { const g = createCar(THREE, c); g.position.set(c.x, P.fy, c.z); g.rotation.y = c.ry; return g; }); } catch (e) { console.warn('[lots] cars.js indisponible, voitures simplifiées', e); }
    if (!cars) for (const c of CARS) P.at(c.x, c.z, c.ry, () => F.car(c.color === 0xe9e7e1 ? 'paintB' : 'paintA'));
    else for (const [i, c] of CARS.entries()) { // emprise au sol pour les collisions de la balade
      const d = cars[i].userData.dims, cs = Math.cos(c.ry), sn = Math.sin(c.ry), hw = d.W / 2 - 0.1, hl = d.L / 2;
      const q = [[-hw, -hl], [hw, -hl], [hw, hl], [-hw, hl]].map(([x, z]) => [c.x + x * cs + z * sn, c.z - x * sn + z * cs]);
      for (let k = 0; k < 4; k++) P.colliders.push({ a: q[k], b: q[(k + 1) % 4] });
    }
    P.room("Hall d'entrée", [[2.78, -0.02], [HW, -0.02], [HW, -1.2], [IN, -1.2], [IN, -11.275], [-1.4 + WALL_T / 2, -11.275], [-1.4 + WALL_T / 2, -9.525], [2.78, -9.525]], 'tile', null, [4.2, -4.5]);
    P.run('x', -9.4 - WALL_T / 2, -9.4 + WALL_T / 2, -1.4, 2.78, []);
    P.at(IN - 0.2, -3.0, -Math.PI / 2, () => { P.B('wood', -0.9, 0.9, 0.9, 1.15, -0.15, 0.15); P.B('dark', -0.9, 0.9, 0.0, 0.9, -0.15, 0.15); });
    F.plant(IN - 0.4, -0.5, 1.2);
    P.run('x', -11.4 - WALL_T / 2, -11.4 + WALL_T / 2, -IN, IN, [{ a: -0.9, b: 0.0, type: 'void' }, { a: 1.2, b: 2.1, type: 'void' }]);
    P.door('x', -11.4 - WALL_T / 2, { a: -0.9, b: 0.0, hinge: 'a', side: -1 });
    P.door('x', -11.4 - WALL_T / 2, { a: 1.2, b: 2.1, hinge: 'b', side: -1 });
    P.room('Local vélos et poussettes', rect(-IN, 0.6, -15.4, -11.525), 'concrete', null, [-2.6, -13.4]);
    P.room('Local technique', rect(0.68, IN, -15.4, -11.525), 'concrete', null, [3.2, -13.4]);
    P.partition('z', 0.64, -15.45, -11.525, []);
    P.partition('x', -15.45, -IN, IN, [{ a: -3.0, b: -2.1, hinge: 'a', side: -1 }], 0.15);
    P.room('Caves', rect(-IN, IN, -19 + T, -15.525), 'concrete', null, [0, -16.0]);
    P.partition('x', -16.55, -IN, IN, Array.from({ length: 6 }, (_, i) => { const x = -IN + (2 * IN) * (i + 0.5) / 6; return { a: x - 0.4, b: x + 0.4, hinge: 'a', side: -1 }; }));
    for (let i = 1; i < 6; i++) P.partition('z', -IN + (2 * IN) * i / 6, -19 + T, -16.55, []);
    P.at(-2.6, -13.5, 0, () => F.bikes(7, 5.2));
    const res = finish(P);
    if (cars) { const cg = new THREE.Group(); cg.name = 'plan:0:voitures'; cg.add(...cars); res.group.add(cg); }
    return res;
  }

  function planRoof() {
    const P = FloorBuilder(4), E = LY.edicule;
    const lot302 = lotsList.find(l => l.level === 3 && l.zone === 'A') || null;
    P.room('Terrasse privative', rect(-IN, IN, -7.5, -T), 'none', lot302 && lot302.id, [1.2, -1.2]);
    P.room('Toiture végétalisée', rect(-IN + 0.4, IN - 0.4, -18.2, -10.8), 'none', null, [1.5, -14.5]);
    const [x0, x1] = E.x, [z0, z1] = E.z, t = 0.2;
    P.room('Édicule', rect(x0 + t, x1 - t, z0 + t, z1 - 0.3), 'concrete', null, [(x0 + x1) / 2, (z0 + z1) / 2]);
    P.wallRect(x0, x1, z0, z0 + t, false); P.wallRect(x0, x0 + t, z0, z1, false); P.wallRect(x1 - t, x1, z0, z1, false);
    P.run('x', z1 - 0.3, z1, x0 + t, x1 - t, [{ a: x0 + 0.1, b: x1 - 1.1, type: 'win' }, { a: x1 - 1.1, b: x1 - 0.1, type: 'door' }], false);
    for (let k = 0; k < 6; k++) { const zz = z0 + t + 0.3 + k * 0.28; P.B('dark', x0 + t + 0.02, x0 + t + 1.1, 0, 0.012, zz, zz + 0.012); }
    P.B('dark', x1 - 1.6, x1 - t - 0.05, 0, 0.01, z0 + t + 0.05, z0 + 1.6);
    const r = HW - 0.18;
    P.colliders.push({ a: [-r, -0.2], b: [r, -0.2] }, { a: [r, -0.2], b: [r, -18.82] }, { a: [r, -18.82], b: [-r, -18.82] }, { a: [-r, -18.82], b: [-r, -0.2] });
    P.colliders.push({ a: [x1 + 0.2, -7.5], b: [IN, -7.5] }, { a: [-IN, -7.5], b: [x0 - 0.1, -7.5] });
    return finish(P);
  }

  // ---------------------------------------------------------------- assemblage d'un plan
  const labelMats = [];
  const labels = new THREE.Group();
  labels.name = 'lots:etiquettes';
  group.add(labels);
  let labelsOn = true;
  const _cam = new THREE.Vector3(), _size = new THREE.Vector2();
  const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const _p = new THREE.Vector3(), _n = new THREE.Vector3();
  // éclairage baké : ambiance (occlusion près du sol, du plafond et des murs) + spots chauds
  function bake(g, P) {
    const pos = g.attributes.position, nor = g.attributes.normal, col = new Float32Array(pos.count * 3), H = P.H || 2.6;
    const segs = P.colliders;
    for (let i = 0; i < pos.count; i++) {
      _p.fromBufferAttribute(pos, i); _n.fromBufferAttribute(nor, i);
      const y = _p.y - P.fy;
      let occ = (1 - 0.32 * Math.exp(-Math.max(0, y) / 0.25)) * (1 - 0.22 * Math.exp(-Math.max(0, H - y) / 0.3));
      if (_n.y > 0.5 && y < 0.05) { let d = 9; for (const s of segs) d = Math.min(d, segDist(_p.x, _p.z, s)); occ *= 1 - 0.32 * Math.exp(-d / 0.28); }
      const a = 0.5 * occ * (0.85 + 0.15 * _n.y);
      let r = a, gg = a * 0.95, b = a * 0.88;
      for (const L of P.lights) {
        const lx = L.x - _p.x, ly = L.y - _p.y, lz = L.z - _p.z, d2 = lx * lx + ly * ly + lz * lz, dl = Math.sqrt(d2) || 1;
        const k = L.I * Math.max(0.15, (_n.x * lx + _n.y * ly + _n.z * lz) / dl) / (1 + d2 / L.r2);
        r += k; gg += k * 0.84; b += k * 0.66;
      }
      col[i * 3] = r; col[i * 3 + 1] = gg; col[i * 3 + 2] = b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  function finish(P) {
    const root = new THREE.Group(); root.name = 'plan:' + P.key;
    const gPlan = new THREE.Group(); gPlan.name = 'plan:' + P.key + ':coupe';
    const gWalk = new THREE.Group(); gWalk.name = 'plan:' + P.key + ':visite'; gWalk.visible = false;
    root.add(gPlan, gWalk);
    const common = [];
    for (const [k, list] of Object.entries(P.buckets)) {
      const [tag, mk] = k.split('|');
      if (mk === 'none' || !list.length) continue;
      const mat = MAT[mk];
      if (!mat) continue;
      const geo = mergeGeometries(list, false); for (const x of list) x.dispose();
      if (tag !== 'plan' && !mat.isMeshBasicMaterial) bake(geo, P);
      geo.computeBoundingSphere();
      const walkM = walkMat(mk);
      const mesh = new THREE.Mesh(geo, tag === 'walk' ? walkM : mat);
      mesh.name = `lots:${P.key}:${tag}:${mk}`;
      mesh.castShadow = false; mesh.receiveShadow = false;
      if (['glass', 'arc', 'cut', 'sill', 'rail', 'screen', 'spot'].includes(mk)) mesh.userData.noAO = true;
      if (tag === 'plan') gPlan.add(mesh); else if (tag === 'walk') gWalk.add(mesh); else { root.add(mesh); common.push({ mesh, plan: mat, walk: walkM }); }
    }
    const lg = new THREE.Group(); lg.name = 'labels:' + P.key;
    for (const L of P.labels) {
      const sp = makeLabel(L.name, L.surface, P.fy);
      sp.position.set(L.x, L.y, L.z);
      sp.userData.noAO = true;
      lg.add(sp);
    }
    root.visible = false; lg.visible = false;
    group.add(root); labels.add(lg);
    for (const r of P.rooms) if (r.lot) { if (!lotRooms.has(r.lot)) lotRooms.set(r.lot, []); lotRooms.get(r.lot).push({ name: r.name, surface: r.surface, poly: r.poly, level: r.level, label: r.label }); }
    return { group: root, plan: gPlan, walk: gWalk, labels: lg, common, rooms: P.rooms, colliders: P.colliders, labelList: P.labels, fy: P.fy, cy: P.cy, furniture: P.furniture };
  }
  function makeLabel(name, surface, fy) {
    const W = 512, H = 150, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    const txt = `${surface.toFixed(1).replace('.', ',')} m²`;
    g.font = '600 46px Inter, "Helvetica Neue", Arial, sans-serif';
    const w1 = g.measureText(name).width; g.font = '500 38px Inter, "Helvetica Neue", Arial, sans-serif';
    const w = Math.min(W - 8, Math.max(w1, g.measureText(txt).width) + 56);
    g.fillStyle = 'rgba(22,24,27,0.78)'; g.beginPath(); g.roundRect((W - w) / 2, 6, w, H - 12, 26); g.fill();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#ffffff'; g.font = '600 46px Inter, "Helvetica Neue", Arial, sans-serif'; g.fillText(name, W / 2, 52, W - 40);
    g.fillStyle = '#d8bd8c'; g.font = '500 38px Inter, "Helvetica Neue", Arial, sans-serif'; g.fillText(txt, W / 2, 104);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; disposables.push(t);
    const m = new THREE.SpriteMaterial({ map: t, depthTest: false, depthWrite: false, transparent: true, toneMapped: false, fog: false });
    disposables.push(m); labelMats.push(m);
    const sp = new THREE.Sprite(m);
    sp.scale.set(1.9, 1.9 * H / W, 1);
    sp.renderOrder = 20;
    sp.raycast = () => {};
    // fondu quand l'œil est à moins de ~4 m au-dessus du sol fini ou à moins de 4 m ; hauteur écran 16–30 px
    const aspect = W / H;
    sp.onBeforeRender = function (renderer, scene, camera) {
      if (!camera.isPerspectiveCamera) return;
      _cam.setFromMatrixPosition(camera.matrixWorld);
      const dist = Math.max(0.1, _cam.distanceTo(this.position));
      this.material.opacity = sstep(2.6, 4.2, _cam.y - fy) * sstep(2.5, 4.0, dist);
      renderer.getSize(_size);
      const pxPerM = _size.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * dist);
      const hM = Math.min(30, Math.max(16, 0.556 * pxPerM)) / pxPerM;
      this.scale.set(hM * aspect, hM, 1);
      this.updateMatrixWorld();
    };
    return sp;
  }

  for (const l of levels) {
    let p = null;
    if (l.key >= 1 && l.key <= 3) p = planUpper(l.key);
    else if (l.key === 0) p = planRDC();
    else if (l.key === 4) p = planRoof();
    if (p) plans.set(l.key, p);
  }

  // ---------------------------------------------------------------- lots : couleurs, contours, volumes
  const lotState = new Map();
  const availGroup = new THREE.Group(); availGroup.name = 'lots:volumes'; availGroup.visible = false; group.add(availGroup);
  const pickables = [];
  const envelope = (x0, z0, x1, z1) => (Math.abs(x0 - x1) < 1e-6 && Math.abs(Math.abs(x0) - HW) < 1e-6) || (Math.abs(z0 - z1) < 1e-6 && (Math.abs(z0) < 1e-6 || Math.abs(z0 + 19) < 1e-6));
  for (const lot of lotsList) {
    const zone = zones[lot.zone]; if (!zone) continue;
    const poly = zone.poly.map(p => [p[0], p[1]]);
    const yl = FL[lot.level - 1] ?? (lot.level * 3), fy = floorY(lot.level), cy = fy + CUT;
    const col = statusColor(lot.status);
    const tintM = basic('lotTint:' + lot.id, col, { transparent: true, opacity: 0.1, depthWrite: false });
    const lineM = basic('lotLine:' + lot.id, col, { transparent: true, opacity: 0.95, depthWrite: false });
    const tg = new THREE.ShapeGeometry(new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)))); tg.rotateX(-Math.PI / 2); tg.translate(0, fy + 0.03, 0);
    const tint = new THREE.Mesh(tg, tintM); tint.renderOrder = 3; tint.userData.noAO = true;
    const line = new THREE.Mesh(stripGeometry(offsetOrtho(poly, () => -0.07), 0.12, cy + 0.008), lineM); line.renderOrder = 4; line.userData.noAO = true;
    const pl = plans.get(lot.level);
    if (pl) pl.plan.add(tint, line);
    const vpoly = offsetOrtho(poly, (i) => { const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % poly.length]; return envelope(x0, z0, x1, z1) ? 0.08 : -0.04; });
    const y0 = yl + 0.03, y1 = yl + 2.97;
    const vg = new THREE.ExtrudeGeometry(new THREE.Shape(vpoly.map(([x, z]) => new THREE.Vector2(x, -z))), { depth: y1 - y0, bevelEnabled: false });
    vg.rotateX(-Math.PI / 2); vg.translate(0, y0, 0);
    const volM = basic('lotVolume:' + lot.id, col, { transparent: true, opacity: 0.0, depthWrite: false });
    const vol = new THREE.Mesh(vg, volM); vol.renderOrder = 6; vol.userData.noAO = true; vol.userData.lotId = lot.id; vol.raycast = () => {};
    const edgeM = basic('lotEdge:' + lot.id, col.clone().lerp(new THREE.Color(1, 1, 1), 0.35), { transparent: true, opacity: 0.0, depthWrite: false });
    const edges = new THREE.Mesh(edgeGeometry(vpoly, y0, y1, 0.035), edgeM); edges.renderOrder = 7; edges.userData.noAO = true; edges.raycast = () => {};
    availGroup.add(vol, edges);
    // picking hors coupe : faces d'enveloppe seulement (pas de lot atteint à travers le bâtiment) ; en coupe : sol du lot
    const extPos = [];
    for (let i = 0; i < poly.length; i++) {
      const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % poly.length];
      if (!envelope(x0, z0, x1, z1)) continue;
      const a = vpoly[i], b = vpoly[(i + 1) % vpoly.length];
      extPos.push(a[0], y0, a[1], b[0], y0, b[1], b[0], y1, b[1], a[0], y0, a[1], b[0], y1, b[1], a[0], y1, a[1]);
    }
    const pickExt = new THREE.BufferGeometry(); pickExt.setAttribute('position', new THREE.Float32BufferAttribute(extPos, 3)); pickExt.computeVertexNormals();
    {
      const pa = pickExt.attributes.position, na = pickExt.attributes.normal, cc = centroid(poly);
      for (let t = 0; t < pa.count; t += 3) {
        const mx = (pa.getX(t) + pa.getX(t + 1) + pa.getX(t + 2)) / 3 - cc[0], mz = (pa.getZ(t) + pa.getZ(t + 1) + pa.getZ(t + 2)) / 3 - cc[1];
        if (na.getX(t) * mx + na.getZ(t) * mz < 0) for (const ax of ['X', 'Y', 'Z']) { const v = pa['get' + ax](t + 1); pa['set' + ax](t + 1, pa['get' + ax](t + 2)); pa['set' + ax](t + 2, v); }
      }
      pickExt.computeVertexNormals(); pickExt.computeBoundingSphere();
    }
    const fg = new THREE.ShapeGeometry(new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)))); fg.rotateX(-Math.PI / 2); fg.translate(0, fy + 0.05, 0); fg.computeBoundingSphere();
    let roofG = null;
    if (lot.attique) { roofG = new THREE.ShapeGeometry(new THREE.Shape(rect(-IN, IN, -7.5, -T).map(([x, z]) => new THREE.Vector2(x, -z)))); roofG.rotateX(-Math.PI / 2); roofG.translate(0, DECK + 0.05, 0); roofG.computeBoundingSphere(); }
    const pick = new THREE.Mesh(pickExt, basic('lotPick:' + lot.id, 0xffffff, { visible: false }));
    pick.userData.geoms = { ext: pickExt, floor: fg, roof: roofG };
    pick.name = 'lotPick:' + lot.id; pick.userData.lotId = lot.id; pick.userData.level = lot.level; pick.userData.noAO = true;
    group.add(pick); pickables.push(pick);
    const c = centroid(poly);
    lotState.set(lot.id, {
      data: lot, col, tintM, lineM, volM, edgeM, pick, match: true, poly, yl, fy,
      center: new THREE.Vector3(c[0], fy + 1.3, c[1]),
      cur: { tint: 0.1, line: 0.95, vol: 0, edge: 0, mix: 0 }, tgt: { tint: 0.1, line: 0.95, vol: 0, edge: 0, mix: 0 },
    });
  }
  function stripGeometry(P, w, y) {
    const pos = [];
    for (let i = 0; i < P.length; i++) {
      const [x0, z0] = P[i], [x1, z1] = P[(i + 1) % P.length];
      const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz) || 1, nx = -dz / L * w / 2, nz = dx / L * w / 2, ex = dx / L * w / 2, ez = dz / L * w / 2;
      const a = [x0 - ex + nx, y, z0 - ez + nz], b = [x1 + ex + nx, y, z1 + ez + nz], c = [x1 + ex - nx, y, z1 + ez - nz], d = [x0 - ex - nx, y, z0 - ez - nz];
      pos.push(...a, ...b, ...c, ...a, ...c, ...d, ...a, ...c, ...b, ...a, ...d, ...c);   // double face
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    return g;
  }
  function edgeGeometry(P, y0, y1, t) {
    const parts = [];
    for (let i = 0; i < P.length; i++) {
      const [x0, z0] = P[i], [x1, z1] = P[(i + 1) % P.length];
      for (const y of [y0, y1]) { const g = new THREE.BoxGeometry(Math.abs(x1 - x0) + t, t, Math.abs(z1 - z0) + t); g.translate((x0 + x1) / 2, y, (z0 + z1) / 2); parts.push(g); }
      const v = new THREE.BoxGeometry(t, y1 - y0, t); v.translate(x0, (y0 + y1) / 2, z0); parts.push(v);
    }
    const g = mergeGeometries(parts.map(p => p.toNonIndexed()), false); parts.forEach(p => p.dispose());
    return g;
  }

  // ---------------------------------------------------------------- état et API
  let floorKey = null, mode = 'none', viewMode = 'plan', hoverId = null, selId = null, filter = null, animating = false;
  const refreshTargets = () => {
    const outside = floorKey == null;
    const selHere = selId && lotState.has(selId) && floorKey != null && (lotState.get(selId).data.level === floorKey || (floorKey === 4 && lotState.get(selId).data.attique));
    for (const [id, s] of lotState) {
      const on = s.match, isSel = id === selId, isHov = id === hoverId;
      // plan en coupe : lot sélectionné nettement en avant, les autres atténués
      if (!on) { s.tgt.tint = 0.03; s.tgt.line = 0.2; }
      else if (selHere) { s.tgt.tint = isSel ? 0.24 : isHov ? 0.12 : 0.035; s.tgt.line = isSel ? 1 : isHov ? 0.8 : 0.3; }
      else { s.tgt.tint = isHov ? 0.2 : 0.1; s.tgt.line = 0.95; }
      s.tgt.mix = on && (isSel || isHov) ? (isSel ? 0.16 : 0.1) : 0;
      // volumes : mode disponibilités, ou survol / sélection en vue extérieure
      if (mode === 'availability') { s.tgt.vol = !on ? 0.05 : isSel ? 0.55 : isHov ? 0.46 : 0.32; s.tgt.edge = !on ? 0.15 : (isSel || isHov) ? 1 : 0.85; }
      else if (outside && (isHov || isSel)) { s.tgt.vol = isHov ? 0.4 : 0.3; s.tgt.edge = 1; }
      else { s.tgt.vol = 0; s.tgt.edge = 0; }
    }
    availGroup.visible = true;
    animating = true;
  };
  const white = new THREE.Color(1, 1, 1), grey = new THREE.Color(0.55, 0.56, 0.58), tmp = new THREE.Color();
  function applyState(s) {
    s.tintM.opacity = s.cur.tint; s.lineM.opacity = s.cur.line; s.volM.opacity = s.cur.vol; s.edgeM.opacity = s.cur.edge;
    tmp.copy(s.match ? s.col : grey).lerp(white, s.cur.mix);
    s.tintM.color.copy(tmp); s.lineM.color.copy(tmp); s.volM.color.copy(tmp);
    s.edgeM.color.copy(s.match ? s.col : grey).lerp(white, 0.3 + 2.5 * s.cur.mix);
    s.volM.visible = s.cur.vol > 0.003; s.edgeM.visible = s.cur.edge > 0.003;
  }
  function applyVisibility() {
    for (const [k, p] of plans) {
      const on = k === floorKey;
      p.group.visible = on;
      p.plan.visible = viewMode === 'plan';
      p.walk.visible = viewMode === 'walk';
      p.labels.visible = on && viewMode === 'plan';
      for (const c of p.common) c.mesh.material = viewMode === 'walk' ? c.walk : c.plan;
    }
    labels.visible = labelsOn;
  }
  function setFloor(key) {
    floorKey = key == null ? null : +key;
    applyVisibility();
    if (typeof bud.setInteriorBand === 'function') {
      if (floorKey == null) bud.setInteriorBand(null, null);
      else if (floorKey === 0) bud.setInteriorBand(-0.5, 2.95);
      else if (floorKey === 4) bud.setInteriorBand(12.3, 15);
      else { const yl = FL[floorKey - 1]; bud.setInteriorBand(yl + 0.05, yl + 2.98); }
    }
    const noRay = () => {};
    for (const p of pickables) {
      const G = p.userData.geoms;
      const geo = floorKey == null ? G.ext : p.userData.level === floorKey ? G.floor : floorKey === 4 && G.roof ? G.roof : null;
      if (geo) { p.geometry = geo; p.raycast = THREE.Mesh.prototype.raycast; } else p.raycast = noRay;
    }
    refreshTargets();
  }
  function setViewMode(m) { viewMode = m === 'walk' ? 'walk' : 'plan'; applyVisibility(); animating = true; }
  function setMode(m) { mode = m === 'availability' ? 'availability' : 'none'; refreshTargets(); }
  function setHover(id) { hoverId = id == null ? null : String(id); refreshTargets(); }
  function setSelected(id) { selId = id == null ? null : String(id); refreshTargets(); }
  function setFilter(pred) { filter = typeof pred === 'function' ? pred : null; for (const s of lotState.values()) s.match = filter ? !!filter(s.data) : true; refreshTargets(); }
  function update(dt = 0.016) {
    if (!animating) return false;
    const k = 1 - Math.exp(-dt * 10);
    let moving = false;
    for (const s of lotState.values()) {
      for (const f of ['tint', 'line', 'vol', 'edge', 'mix']) {
        const d = s.tgt[f] - s.cur[f];
        if (Math.abs(d) > 0.002) { s.cur[f] += d * k; moving = true; } else s.cur[f] = s.tgt[f];
      }
      applyState(s);
    }
    if (!moving) animating = false;
    return true;
  }

  // ---------------------------------------------------------------- fiches, repères, collisions
  const look = (pos, [dx, dz], pitch = -8) => {
    const L = Math.hypot(dx, dz), d = 20, t = Math.tan(THREE.MathUtils.degToRad(pitch));
    return { pos, tgt: [pos[0] + dx / L * d, pos[1] + t * d, pos[2] + dz / L * d], fov: 60 };
  };
  function lot(id) {
    const s = lotState.get(String(id)); if (!s) return null;
    const L = s.data, fy = s.fy, all = lotRooms.get(L.id) || [];
    let viewpoint;
    if (L.zone === 'A' && L.attique) viewpoint = look([1.4, DECK + 1.65, -1.25], [0.12, 1]);
    else if (L.zone === 'A') viewpoint = look([3.2, fy + 0.008 + 1.65, 0.0], [0.18, 1], -9);
    else { const zc = (LY.loggias.C[0] + LY.loggias.C[1]) / 2, yC = s.yl + 0.55; viewpoint = look([HW - 1.15, yC + 0.012 + 1.65, zc], [1, 0.22], -10); }
    const entry = L.zone === 'A' ? { pos: [2.4, fy + 1.65, -4.4], yaw: Math.PI } : { pos: [2.1, fy + 1.65, -14.4], yaw: -1.03 };
    const own = all.filter(r => r.level === L.level), other = all.filter(r => r.level !== L.level);
    const sej = own.find(r => /^Séjour/.test(r.name)) || own[0];
    const c = sej ? sej.label : centroid(s.poly);
    const cp = (r) => ({ name: r.name, surface: r.surface, poly: r.poly.map(p => p.slice()), level: r.level });
    return {
      ...L,
      center: s.center.clone(),
      labelAnchor: new THREE.Vector3(c[0], fy + 0.1, c[1]),
      viewpoint, entry,
      rooms: own.map(cp),
      roomsOther: other.map(cp),
      surfaceCalculee: +own.reduce((a, r) => a + r.surface, 0).toFixed(1),
    };
  }
  function colliders(key) { const p = plans.get(key == null ? floorKey : +key); return p ? p.colliders.map(s => ({ a: s.a.slice(), b: s.b.slice() })) : []; }
  // ancres des étiquettes de pièces (rendu HTML côté viewer)
  function roomLabels(key) {
    const p = plans.get(key == null ? floorKey : +key); if (!p) return [];
    return p.labelList.map(L => ({ text: L.name, sub: `${L.surface.toFixed(1).replace('.', ',')} m²`, pos: [+L.x.toFixed(3), +(p.cy + 0.05).toFixed(3), +L.z.toFixed(3)], floorPos: [+L.x.toFixed(3), +(p.fy + 0.1).toFixed(3), +L.z.toFixed(3)] }));
  }
  // sortie d'ascenseur sur le palier de l'étage (téléportation « ascenseur »)
  function liftStop(key) {
    const k = +key, fy = floorY(k);
    if (k === 4) { const E = LY.edicule; return { pos: [E.x[1] - 0.6, fy + 1.65, E.z[1] + 0.9], yaw: Math.PI }; }
    return { pos: [-2.35, fy + 1.65, -10.25], yaw: -Math.PI / 2 };
  }
  // boîtes de collision 3D (drone / balade) : volumes extérieurs du bâtiment
  function collisionBoxes() {
    const s = LY.slab, out = [], b = (kind, x0, x1, y0, y1, z0, z1) => out.push({ kind, min: [x0, y0, z0], max: [x1, y1, z1] });
    const yl = [...FL, LY.ROOF ?? 12];
    yl.forEach((y, i) => {
      const lo = i === 0 ? y : y - 0.2, hi = y + SLAB;
      b('dalle', s.x0, s.x1, lo, hi, s.z0, s.z1);
      b('dalle', s.retX, s.x1, lo, hi, s.retZ, s.z0);
      if (i < FL.length) {
        const r0 = hi, r1 = hi + 1.0, e = 0.07, t = 0.05;
        b('garde-corps', s.x0, s.x1, r0, r1, s.z1 - e - t, s.z1 - e + t);
        b('garde-corps', s.x1 - e - t, s.x1 - e + t, r0, r1, s.retZ, s.z1);
        b('garde-corps', s.x0 + 0.05 - t, s.x0 + 0.05 + t, r0, r1, 0, s.z1);
        b('garde-corps', HW, s.x1, r0, r1, s.retZ + e - t, s.retZ + e + t);
        const [za, zb] = LY.loggias.C;
        b('garde-corps', HW - 0.1, HW - 0.02, y + 0.56, y + 1.56, za, zb);
      }
    });
    b('corps', -HW, LY.sideWall[1], 3, 12.4, -19, 0);
    b('corps', LY.sideWall[1], HW, 3, 12.0, -19, s.z0);
    b('corps', -HW, HW, 0, 3, -19, -0.02);
    b('socle', -LY.SOCLE, LY.SOCLE, 0, 3, LY.rdc.socleDepth ?? -1.4, 0.4);
    b('lame', LY.lame[0], LY.lame[1], 3, 12.45, -0.02, 0.25);
    b('toiture', -HW, HW, 12.0, 12.45, -19, 0);
    b('acrotere', -HW - 0.02, HW + 0.02, 12.4, 13.5, -19.02, -18.6);
    b('acrotere', -HW - 0.02, -HW + 0.4, 12.4, 13.5, -19.02, 0);
    b('acrotere', HW - 0.4, HW + 0.02, 12.4, 13.5, -19.02, 0);
    b('garde-corps', -HW, HW, 12.42, 13.5, -0.25, -0.15);
    const E = LY.edicule;
    b('edicule', E.x[0] - 0.1, E.x[1] + 0.1, 12.3, 14.9, E.z[0] - 0.1, E.z[1] + 0.1);
    // fonds de loggia (le corps couvre déjà les creux : le drone n'y entre pas)
    for (const k of ['A', 'B', 'C']) { const [za, zb] = LY.loggias[k]; b('loggia', LY.loggias.depthX - T, LY.loggias.depthX, 3, 12, za, zb); }
    // mobilier des étages (îlots, tables, lits…) : bloque la visite à pied
    for (const p of plans.values()) for (const f of (p.furniture || [])) out.push({ kind: f.kind, min: f.min.slice(), max: f.max.slice() });
    return out;
  }
  function dispose() {
    group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.userData.geoms) for (const g of Object.values(o.userData.geoms)) g && g.dispose(); });
    for (const d of disposables) d.dispose && d.dispose();
    group.removeFromParent();
  }

  setFloor(null);
  update(1);

  let tris = 0;
  group.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.attributes.position && !o.name.startsWith('lotPick')) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
  group.userData.stats = { triangles: Math.round(tris), plans: plans.size };

  return {
    group, floors, pickables, labels,
    setFloor, setMode, setHover, setSelected, setFilter, setViewMode,
    lot, colliders, floorY, walkCeilingY, roomLabels, liftStop, collisionBoxes, update, dispose,
    setLabelsVisible(v) { labelsOn = !!v; labels.visible = labelsOn; },
    get floor() { return floorKey; }, get mode() { return mode; }, get viewMode() { return viewMode; },
  };
}
