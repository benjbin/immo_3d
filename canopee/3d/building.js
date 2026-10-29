/**
 * Canopée — modélisation du bâtiment (Three.js 0.160)
 *
 *   export function createBuilding(THREE, M) → THREE.Group « building »
 *
 * Repère : mètres, Y vers le haut, façade rue vers +Z, +X à droite vu de la rue.
 * Toute la géométrie est générée ici, puis fusionnée par (sous-groupe, matériau)
 * pour limiter les draw calls. Les UV sont projetées en coordonnées monde
 * (1 unité de texture = 1 m) sauf pour les fonds d'intérieur (UV par baie).
 */
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createInteriors } from './interiors.js';

// ---------------------------------------------------------------------------
// Constantes d'implantation
// ---------------------------------------------------------------------------
// Révision 2 : toutes les coordonnées X d'implantation sont multipliées par SX (épaisseurs,
// profils et fenêtres carrées latérales gardent leurs dimensions réelles).
const SX = 1.2;
const X = (v) => Math.round(v * SX * 1e4) / 1e4;
const HW = X(5);           // demi-largeur des étages : x ∈ [-6, 6]
const SOCLE = X(5.6);      // demi-largeur du socle : x ∈ [-6.72, 6.72]
const T = 0.42;            // épaisseur des murs extérieurs (isolant compris)
const FLOORS = [3, 6, 9];  // y bas des étages courants R+1..R+3
const SLAB = 0.4;          // dessus des dalles de balcon au-dessus du niveau d'étage
const DROP = 0.2;          // retombée des dalles sous le niveau (rive totale 0.6 m)
const CEIL = 3 - DROP;     // hauteur sous plafond des loggias (depuis le niveau d'étage)
const ROOF = 12;           // dessous de la dalle de toit
const TOP = 12.4;          // arase des acrotères / dessus de l'auvent
const DECK = 12.45;        // dessus de la terrasse bois
const RET_Z = -11;         // fin du retour des dalles sur la façade droite
const RET_X = X(4.0);      // nu intérieur du retour et fond des loggias droites (4.8)
const SLAB_X0 = X(-0.5), SLAB_X1 = SOCLE, SLAB_Z0 = -1.2, SLAB_Z1 = 1.5;
// loggias de la façade droite (z min, z max)
const LOG_A = [-4.6, -2.8];      // sous le retour de dalle
const LOG_B = [-9.0, -7.2];      // sous le retour de dalle (passe 5 : entièrement dans le lot A, chambre 3)
const LOG_C = [-17.6, -15.4];    // loggia creusée dans le mur plein (p02)
// fenêtres carrées de la façade gauche (centres en z)
const ED_X = [X(-4.0), X(-1.6)]; // emprise de l'édicule en x
const ED_Z = [-10.6, -7.6];      // emprise de l'édicule en z (façade vitrée vers +Z)
// façade gauche (recalée sur p04/p05/p07) : bande d'escalier sous l'édicule, bande pleine à l'arrière
const STAIR_Z = [-10.4, -8.9];
const BAND1_Z = [-14.2, -13.0];
const LEFT_WIN = [-2.4, -5.4, -6.9, -12.1, -13.6, -15.2, -17.6];

// Générateur pseudo-aléatoire déterministe
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Faces d'une boîte : 4 coins (BL, BR, TR, TL vus de l'extérieur) + normale
const FACES = {
  px: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1], [1, 0, 0]],
  nx: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, 0, 0]],
  py: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1], [0, 1, 0]],
  ny: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1], [0, -1, 0]],
  pz: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1], [0, 0, 1]],
  nz: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1], [0, 0, -1]],
};

// Repères de façade : (s horizontal vers la droite vu de l'extérieur, y, d profondeur vers l'intérieur)
const FR = {
  front: (z0) => (s, y, d) => [s, y, z0 - d],
  back: (z0) => (s, y, d) => [-s, y, z0 + d],
  right: (x0) => (s, y, d) => [x0 - d, y, -s],
  left: (x0) => (s, y, d) => [x0 + d, y, s],
};

export function createBuilding(THREE, M) {
  const rand = mulberry32(20261023);
  const buckets = new Map();      // "sous-groupe|matériau" → [BufferGeometry]
  let grp = 'structure';          // sous-groupe courant
  let xf = null;                  // matrice locale courante (mobilier)
  const planters = [];

  // -------------------------------------------------------------------------
  // Primitives géométriques
  // -------------------------------------------------------------------------

  // UV projetées par la normale de face (mètres)
  function boxUV(g, sc = 1) {
    const p = g.attributes.position.array;
    const n = p.length / 3;
    const uv = new Float32Array(n * 2);
    for (let i = 0; i + 2 < n; i += 3) {
      const o = i * 3;
      const ax = p[o + 3] - p[o], ay = p[o + 4] - p[o + 1], az = p[o + 5] - p[o + 2];
      const bx = p[o + 6] - p[o], by = p[o + 7] - p[o + 1], bz = p[o + 8] - p[o + 2];
      const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const anx = Math.abs(nx), any = Math.abs(ny), anz = Math.abs(nz);
      for (let k = 0; k < 3; k++) {
        const j = i + k, x = p[j * 3], y = p[j * 3 + 1], z = p[j * 3 + 2];
        let u, v;
        if (anx >= any && anx >= anz) { u = nx > 0 ? -z : z; v = y; }
        else if (any >= anz) { u = x; v = ny > 0 ? -z : z; }
        else { u = nz > 0 ? x : -x; v = y; }
        uv[j * 2] = u * sc; uv[j * 2 + 1] = v * sc;
      }
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }

  // Range une géométrie dans le seau de son matériau
  function push(key, g, opt = {}) {
    if (g.index) g = g.toNonIndexed();
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    if (xf && !opt.world) g.applyMatrix4(xf);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!opt.keepUV || !g.attributes.uv) boxUV(g, opt.uvScale || 1);
    g.clearGroups();
    const k = grp + '|' + key;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(g);
  }

  // Boîte alignée sur les axes, faces optionnellement omises ('py', 'nz'…)
  function boxGeom(x0, x1, y0, y1, z0, z1, skip = '') {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
    const hx = Math.abs(x1 - x0) / 2, hy = Math.abs(y1 - y0) / 2, hz = Math.abs(z1 - z0) / 2;
    const pos = [], nor = [];
    for (const f in FACES) {
      if (skip.includes(f)) continue;
      const F = FACES[f];
      for (const idx of [0, 1, 2, 0, 2, 3]) {
        const c = F[idx];
        pos.push(cx + c[0] * hx, cy + c[1] * hy, cz + c[2] * hz);
        nor.push(F[4][0], F[4][1], F[4][2]);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    return g;
  }
  function box(key, x0, x1, y0, y1, z0, z1, skip = '', opt) {
    if (Math.abs(x1 - x0) < 1e-4 || Math.abs(y1 - y0) < 1e-4 || Math.abs(z1 - z0) < 1e-4) return;
    push(key, boxGeom(Math.min(x0, x1), Math.max(x0, x1), Math.min(y0, y1), Math.max(y0, y1),
      Math.min(z0, z1), Math.max(z0, z1), skip), opt);
  }

  // Boîte aux 12 arêtes chanfreinées (extrusion d'un octogone biseauté)
  function cbox(key, x0, x1, y0, y1, z0, z1, c = 0.012) {
    const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0), d = Math.abs(z1 - z0);
    c = Math.min(c, w / 4, h / 4, d / 4);
    const hw = w / 2 - c, hh = h / 2 - c, e = 0.414 * c;
    const s = new THREE.Shape();
    s.moveTo(-hw + e, -hh); s.lineTo(hw - e, -hh); s.lineTo(hw, -hh + e); s.lineTo(hw, hh - e);
    s.lineTo(hw - e, hh); s.lineTo(-hw + e, hh); s.lineTo(-hw, hh - e); s.lineTo(-hw, -hh + e);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, {
      depth: d - 2 * c, bevelEnabled: true, bevelThickness: c, bevelSize: c,
      bevelOffset: 0, bevelSegments: 1, steps: 1, curveSegments: 1,
    });
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, Math.min(z0, z1) + c);
    push(key, g);
  }

  // Boîte arrondie (coussins)
  function rbox(key, w, h, d, r, x, y, z, rx = 0, ry = 0) {
    const g = new RoundedBoxGeometry(w, h, d, 2, r);
    if (rx) g.rotateX(rx);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    push(key, g);
  }

  function cyl(key, r, h, x, y, z, seg = 12) {
    const g = new THREE.CylinderGeometry(r, r, h, seg, 1);
    g.translate(x, y + h / 2, z);
    push(key, g);
  }

  // Exécute fn dans un repère local (position x,y,z + rotation autour de Y)
  function local(x, y, z, ry, fn) {
    const prev = xf;
    xf = new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z);
    fn();
    xf = prev;
  }

  // ----- Outils de façade (coordonnées s, y, d) -----
  function fbox(F, key, s0, s1, y0, y1, d0, d1, skip) {
    const a = F(s0, y0, d0), b = F(s1, y1, d1);
    box(key, a[0], b[0], a[1], b[1], a[2], b[2], skip);
  }
  // Quadrilatère tourné vers l'extérieur, avec UV propres en option
  function fquad(F, key, s0, s1, y0, y1, d, uvr) {
    const P = [F(s0, y0, d), F(s1, y0, d), F(s1, y1, d), F(s0, y1, d)];
    const o = F(0, 0, -1), z = F(0, 0, 0);
    const n = [o[0] - z[0], o[1] - z[1], o[2] - z[2]];
    const U = uvr ? [[uvr[0], uvr[2]], [uvr[1], uvr[2]], [uvr[1], uvr[3]], [uvr[0], uvr[3]]] : null;
    const pos = [], nor = [], uv = [];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      pos.push(...P[i]); nor.push(...n);
      if (U) uv.push(...U[i]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    if (U) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    push(key, g, { keepUV: !!U });
  }
  // Quadrilatère quelconque en coordonnées monde (a, b, c, d dans le sens trigonométrique)
  function quadW(key, a, b, c, d) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d], 3));
    g.computeVertexNormals();
    push(key, g);
  }
  // Pan de mur percé : décomposition en bandes autour des ouvertures [s0,s1,y0,y1]
  function wall(F, key, s0, s1, y0, y1, d0, d1, holes = []) {
    // les cellules débordent de 2 mm sur leurs voisines pour masquer les fissures de T-jonction
    const e = 0.002, cell = (a, b, ya, yb) =>
      fbox(F, key, Math.max(s0, a - e), Math.min(s1, b + e), Math.max(y0, ya - e), Math.min(y1, yb + e), d0, d1);
    const H = holes.map(h => [Math.max(h[0], s0), Math.min(h[1], s1), Math.max(h[2], y0), Math.min(h[3], y1)])
      .filter(h => h[1] > h[0] && h[3] > h[2]);
    const uniq = a => [...new Set(a.map(v => Math.round(v * 1e4) / 1e4))].sort((p, q) => p - q);
    const ss = uniq([s0, s1, ...H.flatMap(h => [h[0], h[1]])]);
    const ys = uniq([y0, y1, ...H.flatMap(h => [h[2], h[3]])]);
    for (let j = 0; j < ys.length - 1; j++) {
      const cy = (ys[j] + ys[j + 1]) / 2;
      let run = null;
      for (let i = 0; i < ss.length - 1; i++) {
        const cs = (ss[i] + ss[i + 1]) / 2;
        const hole = H.some(h => cs > h[0] && cs < h[1] && cy > h[2] && cy < h[3]);
        if (!hole && run === null) run = ss[i];
        if (hole && run !== null) { cell(run, ss[i], ys[j], ys[j + 1]); run = null; }
      }
      if (run !== null) cell(run, ss[ss.length - 1], ys[j], ys[j + 1]);
    }
  }

  // Menuiserie complète : cadre, meneaux, vitrage en retrait, fond d'intérieur, appui
  function windowUnit(F, o) {
    const { s0, s1, y0, y1 } = o;
    const fw = o.fw ?? 0.06;               // largeur vue du profil
    const gd = o.gd ?? 0.15;               // profondeur du vitrage depuis le nu extérieur
    const fd = o.fd ?? 0.07;               // épaisseur du dormant
    const proud = o.proud ?? 0;            // saillie du cadre devant le nu
    const a = Math.min(gd - fd / 2, -proud), b = gd + fd / 2;
    fbox(F, 'frameDark', s0, s0 + fw, y0, y1, a, b);
    fbox(F, 'frameDark', s1 - fw, s1, y0, y1, a, b);
    fbox(F, 'frameDark', s0 + fw, s1 - fw, y0, y0 + fw, a, b);
    fbox(F, 'frameDark', s0 + fw, s1 - fw, y1 - fw, y1, a, b);
    // ouvrants : meneaux (alternés en profondeur pour les coulissants)
    (o.mull || []).forEach((m, i) => {
      const off = o.sliding ? (i % 2 ? 0.02 : -0.02) : 0;
      fbox(F, 'frameDark', m - fw * 0.5, m + fw * 0.5, y0 + fw, y1 - fw, gd - 0.035 + off, gd + 0.035 + off);
    });
    (o.trans || []).forEach(t => fbox(F, 'frameDark', s0 + fw, s1 - fw, t - fw * 0.4, t + fw * 0.4, gd - 0.03, gd + 0.03));
    // ouvrants : un cadre fin par vantail, légèrement devant le vitrage
    if (o.sash !== false) {
      const cuts = [s0 + fw, ...(o.mull || []).flatMap(m => [m - fw * 0.5, m + fw * 0.5]), s1 - fw];
      const sw = 0.042, ya = y0 + fw, yb = y1 - fw;
      for (let i = 0; i < cuts.length; i += 2) {
        const a = cuts[i], b = cuts[i + 1];
        if (b - a < 2.5 * sw) continue;
        const za = gd - 0.03, zb = gd + 0.012;
        fbox(F, 'frameDark', a, a + sw, ya, yb, za, zb);
        fbox(F, 'frameDark', b - sw, b, ya, yb, za, zb);
        fbox(F, 'frameDark', a + sw, b - sw, ya, ya + sw, za, zb);
        fbox(F, 'frameDark', a + sw, b - sw, yb - sw, yb, za, zb);
      }
    }
    // vitrage
    fquad(F, 'glass', s0 + fw * 0.5, s1 - fw * 0.5, y0 + fw * 0.5, y1 - fw * 0.5, gd);
    // intérieur : pièce modélisée (o.room) ou pièce simulée posée juste derrière le vitrage
    if (!o.room) {
      const lvl = Math.floor((y0 + 0.01) / 3) * 3;
      const fy = o.floorY ?? (lvl === 0 ? 0 : lvl + SLAB);
      imWindow(F, s0, s1, y0, y1, gd + 0.008, { sill: y0 - fy, ...(o.im || {}) });
    }
    // appui de fenêtre (alu)
    if (o.sill) fbox(F, 'frameDark', s0 - 0.04, s1 + 0.04, y0 - 0.045, y0 + 0.004, -0.05 - proud, gd - fd / 2);
    // seuil (porte-fenêtre)
    if (o.threshold) fbox(F, 'metal', s0, s1, y0 - 0.01, y0 + 0.012, -0.03, gd);
  }

  // Pièce simulée (interior mapping) : quad + description de la pièce virtuelle
  const imWindows = [];
  function imWindow(F, s0, s1, y0, y1, d, o = {}) {
    const w = s1 - s0, h = y1 - y0;
    const c = [F(s0, y0, d), F(s1, y0, d), F(s1, y1, d), F(s0, y1, d)];
    const o0 = F(0, 0, 0), ts = F(1, 0, 0), to = F(0, 0, -1);
    const T3 = [ts[0] - o0[0], ts[1] - o0[1], ts[2] - o0[2]], N3 = [to[0] - o0[0], to[1] - o0[1], to[2] - o0[2]];
    const sill = Math.max(0.03, o.sill ?? 0.9);
    const RH = Math.max(o.RH ?? 2.5, sill + h + 0.12);
    const RW = Math.max(w + 1.0, o.RW ?? (3.2 + rand() * 1.4));
    imWindows.push({
      corners: c, T: T3, N: N3, w, h, sill, RH, RW,
      RD: o.RD ?? (3.2 + rand() * 1.3), xOff: (RW - w) * (0.25 + 0.5 * rand()),
      kind: o.kind ?? 0, seed: Math.min(9.99, rand() * 10),
    });
  }

  // Garde-corps vitré le long d'une polyligne orthogonale [[x,z],…]
  function railing(pts, y0, h, opt = {}) {
    const posts = !!opt.posts, maxP = opt.panel || 1.45;
    for (let i = 0; i < pts.length - 1; i++) {
      const [xa, za] = pts[i], [xb, zb] = pts[i + 1];
      const alongX = Math.abs(zb - za) < 1e-6;
      const L = alongX ? Math.abs(xb - xa) : Math.abs(zb - za);
      const sg = alongX ? Math.sign(xb - xa) : Math.sign(zb - za);
      const at = t => alongX ? [xa + sg * t, za] : [xa, za + sg * t];
      const seg = (key, t0, t1, w, ya, yb) => {
        const p = at(t0), q = at(t1);
        if (alongX) box(key, p[0], q[0], ya, yb, za - w / 2, za + w / 2);
        else box(key, xa - w / 2, xa + w / 2, ya, yb, p[1], q[1]);
      };
      const e0 = i === 0 ? 0 : -0.035, e1 = i === pts.length - 2 ? 0 : 0.035;
      seg('frameDark', e0, L + e1, 0.07, y0, y0 + 0.085);             // sabot bas
      seg('frameDark', e0, L + e1, 0.05, y0 + h - 0.035, y0 + h);     // main courante
      const n = Math.max(1, Math.ceil(L / maxP)), pl = L / n;
      for (let k = 0; k < n; k++) {
        // verre : un seul plan par panneau (matériau double face, évite de cumuler l'opacité)
        const p = at(k * pl + 0.008), q = at((k + 1) * pl - 0.008), ya = y0 + 0.05, yb = y0 + h - 0.03;
        quadW('glassRail', [p[0], ya, p[1]], [q[0], ya, q[1]], [q[0], yb, q[1]], [p[0], yb, p[1]]);
        if (posts) seg('frameDark', k * pl - 0.02, k * pl + 0.02, 0.04, y0, y0 + h);
      }
      if (posts && i === pts.length - 2) seg('frameDark', L - 0.02, L + 0.02, 0.04, y0, y0 + h);
    }
  }

  // Bac de jardinière (enveloppe, rebord, terre) + entrée userData.planters
  function planter(x0, x1, z0, z1, y0, h, kind) {
    const t = 0.035, ys = y0 + h - 0.06;
    box('planter', x0, x1, y0, ys, z0, z1, 'py');
    box('planter', x0, x1, ys, y0 + h, z0, z0 + t);
    box('planter', x0, x1, ys, y0 + h, z1 - t, z1);
    box('planter', x0, x0 + t, ys, y0 + h, z0 + t, z1 - t);
    box('planter', x1 - t, x1, ys, y0 + h, z0 + t, z1 - t);
    box('soil', x0 + t, x1 - t, ys - 0.01, ys, z0 + t, z1 - t, 'nx px ny pz nz');
    planters.push({
      x: +((x0 + x1) / 2).toFixed(3), y: +ys.toFixed(3), z: +((z0 + z1) / 2).toFixed(3),
      w: +(x1 - x0 - 2 * t).toFixed(3), d: +(z1 - z0 - 2 * t).toFixed(3), kind,
    });
  }

  // Dalle en L chanfreinée : avant x[SLAB_X0,SLAB_X1] z[SLAB_Z0,SLAB_Z1] + retour x[RET_X,SLAB_X1] z[RET_Z,SLAB_Z0]
  function slabL(y0, y1, key = 'slabWhite') {
    const c = 0.018, th = y1 - y0;
    const P = [[SLAB_X0 + c, SLAB_Z1 - c], [SLAB_X1 - c, SLAB_Z1 - c], [SLAB_X1 - c, RET_Z + c],
      [RET_X + c, RET_Z + c], [RET_X + c, SLAB_Z0 + c], [SLAB_X0 + c, SLAB_Z0 + c]];
    const s = new THREE.Shape(P.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ExtrudeGeometry(s, {
      depth: th - 2 * c, bevelEnabled: true, bevelThickness: c, bevelSize: c,
      bevelOffset: 0, bevelSegments: 1, steps: 1,
    });
    g.rotateX(-Math.PI / 2);
    g.translate(0, y0 + c, 0);
    push(key, g);
  }
  // Sous-face bois en L (légèrement en retrait des rives)
  function soffitL(y) {
    const m = 0.16;
    const P = [[SLAB_X0, SLAB_Z1 - m], [SLAB_X1 - m, SLAB_Z1 - m], [SLAB_X1 - m, RET_Z + m],
      [RET_X, RET_Z + m], [RET_X, SLAB_Z0], [SLAB_X0, SLAB_Z0]];
    const s = new THREE.Shape(P.map(([x, z]) => new THREE.Vector2(x, z)));
    const g = new THREE.ShapeGeometry(s);
    g.rotateX(Math.PI / 2);          // normale vers le bas, (x, y) → (x, 0, y)
    g.translate(0, y - 0.006, 0);
    push('woodSoffit', g);
    // liserés d'ombre (joint creux) entre bois et rive blanche
    box('frameDark', SLAB_X0, SLAB_X1 - m, y - 0.012, y - 0.004, SLAB_Z1 - m, SLAB_Z1 - m + 0.02, 'py');
    box('frameDark', SLAB_X1 - m, SLAB_X1 - m + 0.02, y - 0.012, y - 0.004, RET_Z + m, SLAB_Z1 - m + 0.02, 'py');
  }
  // Spots encastrés
  function downlight(x, y, z) {
    const g = new THREE.CylinderGeometry(0.055, 0.055, 0.012, 14, 1);
    g.translate(x, y - 0.006 - 0.006, z);
    push('interiorWarm', g);
  }

  // =========================================================================
  // 1. RDC — socle blanc, portes de garage, entrée
  // =========================================================================
  grp = 'rdc';
  {
    const F = FR.front(0.4);
    // façade du socle (cadre blanc percé)
    const OP = [X(-3.5), X(5.1)];   // grande ouverture garages + entrée
    wall(F, 'renderWhite', -SOCLE, SOCLE, 0, 3, 0, T, [[X(-4.6), X(-3.7), 1.35, 2.35], [OP[0], OP[1], 0, 2.4]]);
    // retours latéraux du socle
    box('renderWhite', -SOCLE, -HW, 0, 3, -1.4, -0.02);
    box('renderWhite', HW, SOCLE, 0, 3, -1.4, -0.02);
    // petite fenêtre éclairée
    windowUnit(F, { s0: X(-4.6), s1: X(-3.7), y0: 1.35, y1: 2.35, gd: 0.12, fw: 0.05, mull: [X(-4.15)], sill: true });
    // remplissage anthracite en retrait de 15 cm (trumeaux, imposte, panneau d'entrée)
    const G1 = [X(-3.35), X(-0.65)], G2 = [X(-0.5), X(2.2)], DR = [X(2.35), X(3.45)], HG = 2.35;
    wall(F, 'cladding', OP[0], OP[1], 0, 2.4, 0.15, 0.25, [[G1[0], G1[1], 0, HG], [G2[0], G2[1], 0, HG], [DR[0], DR[1], 0, HG]]);
    // portes sectionnelles + cadres + serrures
    for (const [a, b] of [G1, G2]) {
      box('garageDoor', a + 0.04, b - 0.04, 0, HG - 0.04, 0.4 - 0.24, 0.4 - 0.17);
      fbox(F, 'frameDark', a, a + 0.04, 0, HG, 0.15, 0.2);
      fbox(F, 'frameDark', b - 0.04, b, 0, HG, 0.15, 0.2);
      fbox(F, 'frameDark', a + 0.04, b - 0.04, HG - 0.04, HG, 0.15, 0.2);
      const m = (a + b) / 2;
      fbox(F, 'metal', m - 0.035, m + 0.035, 1.0, 1.12, 0.155, 0.17);
      // joint de seuil
      fbox(F, 'frameDark', a + 0.04, b - 0.04, 0, 0.03, 0.16, 0.175);
    }
    // porte d'entrée : vantail anthracite avec imposte vitrée verticale étroite
    const [d0, d1] = DR;
    fbox(F, 'frameDark', d0, d0 + 0.05, 0, HG, 0.15, 0.21);
    fbox(F, 'frameDark', d1 - 0.05, d1, 0, HG, 0.15, 0.21);
    fbox(F, 'frameDark', d0 + 0.05, d1 - 0.05, HG - 0.05, HG, 0.15, 0.21);
    const strip = [d0 + 0.2, d0 + 0.34, 0.3, 2.05];
    wall(F, 'doorDark', d0 + 0.05, d1 - 0.05, 0, HG - 0.05, 0.17, 0.22, [strip]);
    fbox(F, 'frameDark', strip[0] - 0.012, strip[0], strip[2], strip[3], 0.16, 0.2);
    fbox(F, 'frameDark', strip[1], strip[1] + 0.012, strip[2], strip[3], 0.16, 0.2);
    fquad(F, 'glass', strip[0], strip[1], strip[2], strip[3], 0.19);
    imWindow(F, strip[0], strip[1], strip[2], strip[3], 0.198, { kind: 1, sill: 0.3, RH: 2.6, RD: 3.0, RW: 2.0 });
    // poignée bâton inox verticale (deux entretoises)
    const hx = d1 - 0.16;
    fbox(F, 'metal', hx - 0.015, hx + 0.015, 0.55, 1.75, 0.1, 0.13);
    fbox(F, 'metal', hx - 0.01, hx + 0.01, 0.7, 0.72, 0.13, 0.17);
    fbox(F, 'metal', hx - 0.01, hx + 0.01, 1.58, 1.6, 0.13, 0.17);
    // seuil pierre
    fbox(F, 'slabWhite', d0, d1, 0, 0.025, -0.06, 0.17);
    // applique au-dessus de l'entrée
    const ax = X(4.2);
    fbox(F, 'frameDark', ax - 0.075, ax + 0.075, 1.95, 2.15, 0.1, 0.15);
    fbox(F, 'interiorWarm', ax - 0.065, ax + 0.065, 1.94, 1.95, 0.11, 0.14);
  }

  // =========================================================================
  // 2. Murs des étages
  // =========================================================================
  grp = 'facades';
  // --- façade avant, partie gauche (bardage + baies 2 vantaux) ---
  {
    const F = FR.front(0);
    const s0 = X(-3.58), s1 = X(-0.82);
    const holes = FLOORS.map(y => [s0, s1, y + 0.5, y + 2.55]);
    wall(F, 'cladding', -HW + T, SLAB_X0, 3, TOP, 0, T, holes);
    for (const y of FLOORS) {
      windowUnit(F, { s0, s1, y0: y + 0.5, y1: y + 2.55, gd: 0.16, mull: [(s0 + s1) / 2], sill: true, room: true });
    }
    // lame verticale blanche : deux pilastres + rainure sombre
    const L1 = X(-4.42), L2 = X(-4.34);
    cbox('renderWhite', -HW, L1, 3, TOP + 0.05, -0.02, 0.25, 0.015);
    cbox('renderWhite', L2, X(-3.74), 3, TOP + 0.05, -0.02, 0.25, 0.015);
    box('frameDark', L1, L2, 3, TOP + 0.02, -0.02, 0.06);
    // retour latéral sur la loggia (x = SLAB_X0)
    box('cladding', SLAB_X0 - T, SLAB_X0, 3, TOP, -1.2, -0.42);
  }
  // --- fond de la loggia avant (z = -1.2) ---
  {
    const F = FR.front(SLAB_Z0);
    const g0 = X(0.9), g1 = X(4.1);
    wall(F, 'cladding', SLAB_X0, HW - T, 3, ROOF, 0, T, FLOORS.map(y => [g0, g1, y + SLAB, y + 2.65]));
    for (const y of FLOORS) {
      const w = (g1 - g0) / 3;
      windowUnit(F, { s0: g0, s1: g1, y0: y + SLAB, y1: y + 2.65, gd: 0.12, mull: [g0 + w, g0 + 2 * w], sliding: true, threshold: true, room: true });
      // panneau bois à gauche de la baie
      fbox(F, 'woodSoffit', X(-0.3), g0 - 0.12, y + SLAB, y + CEIL, -0.03, 0);
      fbox(F, 'frameDark', X(-0.3) - 0.02, X(-0.3), y + SLAB, y + CEIL, -0.035, 0);
    }
  }
  // --- façade droite (x = +HW) : retours de loggias, panneaux pleins, loggias creusées ---
  {
    const F = FR.right(HW);
    const sA = [-LOG_A[1], -LOG_A[0]], sB = [-LOG_B[1], -LOG_B[0]], sC = [-LOG_C[1], -LOG_C[0]];
    const holesFront = [], holesBack = [];
    for (const y of FLOORS) {
      holesFront.push([sA[0], sA[1], y + SLAB, y + 3], [sB[0], sB[1], y + SLAB, y + 3]);
      holesBack.push([sC[0], sC[1], y + 0.55, y + 2.75]);
    }
    wall(F, 'cladding', -SLAB_Z0, -RET_Z, 0, ROOF, 0, T, holesFront);   // sous l'auvent
    wall(F, 'cladding', -RET_Z, 18.58, 0, TOP, 0, T, holesBack);         // mur plein arrière
    const FB = FR.right(RET_X);
    for (const y of FLOORS) {
      // loggias A et B (sol = retour de dalle, plafond = sous-face bois)
      for (const [za, zb] of [LOG_A, LOG_B]) {
        box('cladding', RET_X, HW - T, y + SLAB, y + CEIL, zb, zb + 0.3);
        box('cladding', RET_X, HW - T, y + SLAB, y + CEIL, za - 0.3, za);
        const s0 = -zb, s1 = -za, d0 = s0 + 0.25, d1 = d0 + 1.1;
        wall(FB, 'woodSoffit', s0, s1, y + SLAB, y + CEIL, 0, T, [[d0, d1, y + SLAB, y + 2.6]]);
        // loggia A : la porte donne sur le séjour modélisé ; loggia B : chambre (pièce simulée)
        windowUnit(FB, { s0: d0, s1: d1, y0: y + SLAB, y1: y + 2.6, gd: 0.1, mull: [(d0 + d1) / 2], threshold: true, room: za === LOG_A[0] });
        downlight((RET_X + HW) / 2, y + CEIL, (za + zb) / 2);
        planter(SLAB_X1 - 0.5, SLAB_X1 - 0.12, za + 0.1, zb - 0.1, y + SLAB, 0.45, 'balcony');
      }
      // loggia C creusée dans le mur plein
      const [za, zb] = LOG_C, yb = y + 0.55, yt = y + 2.75;
      box('cladding', RET_X, HW - T, yb, yt, zb, zb + 0.3);
      box('cladding', RET_X, HW - T, yb, yt, za - 0.3, za);
      box('slabWhite', RET_X, HW - T, y + 0.3, yb, za, zb);
      cbox('slabWhite', HW - T, HW + 0.04, yb - 0.07, yb + 0.012, za, zb, 0.01);
      box('woodSoffit', RET_X, HW - T, yt, yt + 0.2, za, zb);
      const s0 = -zb, s1 = -za, d0 = s0 + 0.3, d1 = d0 + 1.1;
      wall(FB, 'woodSoffit', s0, s1, yb, yt, 0, T, [[d0, d1, yb, yt - 0.12]]);
      windowUnit(FB, { s0: d0, s1: d1, y0: yb, y1: yt - 0.12, gd: 0.1, mull: [(d0 + d1) / 2], threshold: true, room: true });
      downlight((RET_X + HW) / 2, yt, (za + zb) / 2);
      planter(HW - 0.64, HW - 0.22, za + 0.08, zb - 0.08, yb + 0.012, 0.42, 'loggia');
      railing([[HW - 0.06, za + 0.04], [HW - 0.06, zb - 0.04]], yb + 0.012, 1.0);
    }
  }
  // --- façade gauche (x = -HW) : enduit blanc, deux bandes anthracite, fenêtres carrées ---
  {
    const F = FR.left(-HW);
    const sq = [], stair = [];
    for (const y of FLOORS) {
      for (const z of LEFT_WIN) sq.push([z - 0.475, z + 0.475, y + 0.95, y + 2.0]);
      const zc = (STAIR_Z[0] + STAIR_Z[1]) / 2;
      stair.push([zc - 0.5, zc + 0.5, y + 0.3, y + 2.9]);
    }
    for (const z of [-5.4, -12.1, -15.2, -17.6]) sq.push([z - 0.475, z + 0.475, 0.95, 2.0]);   // RDC
    wall(F, 'renderWhite', -18.58, 0, 0, TOP, 0, T, [...sq, ...stair]);
    // bandes verticales anthracite (légère saillie)
    const inBand = h => h[0] < BAND1_Z[1] && h[1] > BAND1_Z[0] && h[2] >= 3;
    wall(F, 'cladding', BAND1_Z[0], BAND1_Z[1], 3, TOP, -0.03, 0, sq.filter(inBand));
    wall(F, 'cladding', STAIR_Z[0], STAIR_Z[1], 3, TOP, -0.03, 0, stair);
    // la fenêtre z = -2.4 des étages éclaire la chambre 1 modélisée (pièce réelle derrière)
    for (const h of sq) windowUnit(F, { s0: h[0], s1: h[1], y0: h[2], y1: h[3], proud: inBand(h) ? 0.07 : 0.04, gd: 0.07, fw: 0.065, mull: [(h[0] + h[1]) / 2], room: h[2] > 3 && Math.abs((h[0] + h[1]) / 2 + 2.4) < 0.01 });
    for (const h of stair) windowUnit(F, { s0: h[0], s1: h[1], y0: h[2], y1: h[3], proud: 0.07, gd: 0.06, fw: 0.07, trans: [h[2] + 1.3], im: { kind: 1, sill: 0.3, RH: 3.3, RD: 2.6, RW: 3.0 } });
  }
  // --- façade arrière (z = -19) ---
  {
    const F = FR.back(-19);
    const hs = [];
    for (const y of [0, ...FLOORS]) for (const x of [-3.75, -1.25, 1.25, 3.75].map(X)) hs.push([-x - 0.475, -x + 0.475, y + 0.95, y + 2.0]);
    wall(F, 'renderWhite', -HW, HW, 0, TOP, 0, T, hs);
    // fenêtres x > 0 des étages : séjour du lot B, modélisé
    for (const h of hs) windowUnit(F, { s0: h[0], s1: h[1], y0: h[2], y1: h[3], proud: 0.04, gd: 0.07, fw: 0.065, mull: [(h[0] + h[1]) / 2], room: h[2] > 3 && (h[0] + h[1]) / 2 < 0 });
  }

  // =========================================================================
  // 3. Dalles de balcon, garde-corps, jardinières
  // =========================================================================
  grp = 'balcons';
  for (const y of [...FLOORS, ROOF]) {
    // la dalle du R+1 repose sur le socle ; les suivantes retombent de 15 cm
    if (y > 3) { slabL(y - DROP, y + SLAB); soffitL(y - DROP); }
    else slabL(y, y + SLAB);
  }
  // revêtement de sol des balcons (dalles grises sur plots), en L
  function floorL(y) {
    const m = 0.08;
    const P = [[SLAB_X0, SLAB_Z1 - m], [SLAB_X1 - m, SLAB_Z1 - m], [SLAB_X1 - m, RET_Z + m],
      [RET_X, RET_Z + m], [RET_X, SLAB_Z0], [SLAB_X0, SLAB_Z0]];
    const g = new THREE.ShapeGeometry(new THREE.Shape(P.map(([x, z]) => new THREE.Vector2(x, -z))));
    g.rotateX(-Math.PI / 2);          // (x, y) → (x, 0, -y), normale vers le haut
    g.translate(0, y, 0);
    push('paver', g);
  }
  for (const y of FLOORS) {
    const yb = y + SLAB, e = 0.07;
    floorL(yb + 0.008);
    railing([[SLAB_X0 + 0.05, 0], [SLAB_X0 + 0.05, SLAB_Z1 - e], [SLAB_X1 - e, SLAB_Z1 - e], [SLAB_X1 - e, RET_Z + e], [HW, RET_Z + e]], yb, 1.0);
    planter(SLAB_X0 + 0.12, SLAB_X1 - 0.52, 1.0, 1.38, yb, 0.45, 'balcony');
    planter(SLAB_X1 - 0.5, SLAB_X1 - 0.12, -0.95, 1.38, yb, 0.45, 'balcony');
    downlight(X(1.6), y + CEIL, -0.3);
    downlight(X(3.4), y + CEIL, -0.3);
    downlight(HW, y + CEIL, 0.4);
  }

  // =========================================================================
  // 4. Toiture : dalle, acrotères, terrasse, végétalisation, garde-corps, édicule
  // =========================================================================
  grp = 'toiture';
  {
    const IN = HW - T;
    box('renderWhite', -IN, IN, ROOF, 12.3, -18.58, -0.42, 'ny');
    // couvertines
    box('slabWhite', -HW - 0.02, -IN + 0.02, TOP, TOP + 0.04, -19.02, 0);
    box('slabWhite', -IN + 0.02, HW + 0.02, TOP, TOP + 0.04, -19.02, -18.56);
    box('slabWhite', IN - 0.02, HW + 0.02, TOP, TOP + 0.04, -18.56, RET_Z);
    box('frameDark', -IN + 0.02, SLAB_X0, TOP, TOP + 0.04, -0.44, 0.0);
    // terrasse bois
    box('deck', -IN, IN, 12.3, DECK, -7.5, -0.42);
    // dalle de pavés devant l'édicule
    cbox('paver', ED_X[0] - 0.1, ED_X[1] + 0.2, 12.3, DECK + 0.02, ED_Z[1], ED_Z[1] + 1.5, 0.01);
    // bande de gravier périphérique (UV resserrées pour un grain fin)
    push('asphalt', boxGeom(-IN, IN, 12.3, 12.405, -18.58, -7.5), { uvScale: 2 }); // 5 mm au-dessus de la dalle : évite le z-fighting vu du ciel
    // toiture végétalisée bosselée (bords plongeant dans le gravier)
    {
      const x0 = -(HW - 0.85), x1 = HW - 0.85, z0 = -18.15, z1 = -7.75, nx = 48, nz = 50;
      const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, nx, nz);
      g.rotateX(-Math.PI / 2);
      g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), z = p.getZ(i);
        const edge = Math.min(x - x0, x1 - x, z - z0, z1 - z);
        let h = 12.45 + 0.035 * Math.sin(x * 1.7 + z * 0.6) * Math.cos(z * 1.3 - x * 0.4)
          + 0.02 * Math.sin(x * 4.1 + 1.3) * Math.sin(z * 3.7);
        if (edge < 0.01) h = 12.38;
        p.setY(i, h);
      }
      g.computeVertexNormals();
      push('greenRoof', g);
      // zones plantables (hors emprise de l'édicule)
      const gx0 = ED_X[1] + 0.2;      // à droite de l'édicule (débord de toit compris)
      planters.push({ x: 0, y: 12.45, z: -14.475, w: +(x1 - x0).toFixed(3), d: 7.35, kind: 'greenroof' });
      planters.push({ x: +((gx0 + x1) / 2).toFixed(3), y: 12.45, z: -9.275, w: +(x1 - gx0).toFixed(3), d: 3.05, kind: 'greenroof' });
    }
    // garde-corps vitré périphérique (montants + main courante)
    const r = HW - 0.18;
    railing([[-r, -0.2], [r, -0.2], [r, -18.82], [-r, -18.82], [-r, -0.2]], TOP + 0.03, 1.05, { posts: true, panel: 1.6 });
    // grands bacs plantés
    planter(-IN + 0.08, X(-3.4), -4.2, -0.5, DECK, 0.55, 'roof');
    planter(X(3.9), IN - 0.08, -3.3, -0.5, DECK, 0.55, 'roof');
    planter(X(3.6), IN - 0.08, -7.3, -5.2, DECK, 0.55, 'roof');
    planter(X(-0.3), X(1.1), -7.45, -6.85, DECK, 0.5, 'roof');
    planter(X(1.7), X(3.1), -7.45, -6.85, DECK, 0.5, 'roof');
  }
  // --- édicule (escalier / ascenseur) ---
  {
    const F = FR.front(ED_Z[1]);
    const [e0, e1] = ED_X;
    box('cladding', e0, e1, 12.3, 14.75, ED_Z[0], ED_Z[1] - 0.3, 'pz');
    wall(F, 'cladding', e0, e1, 12.3, 14.75, 0, 0.3, [[e0 + 0.1, e1 - 0.1, DECK, 14.55]]);
    windowUnit(F, { s0: e0 + 0.1, s1: e1 - 0.1, y0: DECK, y1: 14.55, gd: 0.1, fw: 0.055, mull: [e1 - 1.1], trans: [14.0], threshold: true, im: { kind: 1, sill: 0.05, RH: 2.3, RD: 2.4, RW: 3.0 } });
    fbox(F, 'metal', e1 - 1.02, e1 - 1.0, 13.1, 13.7, 0.02, 0.07);
    cbox('frameDark', e0 - 0.1, e1 + 0.1, 14.75, 14.9, ED_Z[0] - 0.1, ED_Z[1] + 0.1, 0.012);
    // applique murale
    fbox(F, 'frameDark', e1 - 0.06, e1 - 0.02, 14.1, 14.27, -0.06, 0);
    fbox(F, 'interiorWarm', e1 - 0.055, e1 - 0.025, 14.09, 14.1, -0.05, -0.01);
  }

  // =========================================================================
  // 5. Mobilier de la terrasse
  // =========================================================================
  grp = 'mobilier';
  const legs = (w, d, h, inset, sz = 0.04) => {
    for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) {
      const x = sx * (w / 2 - inset), z = sz2 * (d / 2 - inset);
      box('metal', x - sz / 2, x + sz / 2, 0, h, z - sz / 2, z + sz / 2);
    }
  };
  // Canapé / fauteuil : cadre bois, coussins écrus
  function sofa(W, seats) {
    const D = 0.9;
    legs(W, D, 0.1, 0.06, 0.035);
    cbox('deck', -W / 2, W / 2, 0.1, 0.3, -D / 2, D / 2, 0.015);
    cbox('deck', -W / 2, -W / 2 + 0.12, 0.3, 0.62, -D / 2, D / 2, 0.015);
    cbox('deck', W / 2 - 0.12, W / 2, 0.3, 0.62, -D / 2, D / 2, 0.015);
    cbox('deck', -W / 2 + 0.12, W / 2 - 0.12, 0.3, 0.5, -D / 2, -D / 2 + 0.1, 0.015);
    const inner = W - 0.24, cw = inner / seats;
    for (let i = 0; i < seats; i++) {
      const x = -inner / 2 + cw * (i + 0.5);
      rbox('fabric', cw - 0.02, 0.17, D - 0.14, 0.05, x, 0.385, 0.05);
      rbox('fabric', cw - 0.03, 0.46, 0.18, 0.07, x, 0.66, -D / 2 + 0.2, -0.16);
    }
    rbox('fabric', 0.42, 0.4, 0.12, 0.06, -W / 2 + 0.38, 0.62, -0.12, -0.25, 0.25);
    if (seats > 1) rbox('fabric', 0.42, 0.4, 0.12, 0.06, W / 2 - 0.38, 0.62, -0.12, -0.25, -0.25);
  }
  function table(W, D, H) {
    legs(W, D, H - 0.045, 0.08, 0.05);
    cbox('deck', -W / 2, W / 2, H - 0.045, H, -D / 2, D / 2, 0.008);
    box('metal', -W / 2 + 0.06, W / 2 - 0.06, H - 0.1, H - 0.045, -D / 2 + 0.06, -D / 2 + 0.1);
    box('metal', -W / 2 + 0.06, W / 2 - 0.06, H - 0.1, H - 0.045, D / 2 - 0.1, D / 2 - 0.06);
  }
  function chair() {
    legs(0.46, 0.46, 0.43, 0.03, 0.028);
    cbox('metal', -0.23, 0.23, 0.42, 0.45, -0.23, 0.23, 0.006);
    rbox('fabric', 0.42, 0.06, 0.42, 0.025, 0, 0.48, 0.01);
    box('metal', -0.23, -0.2, 0.45, 0.88, -0.23, -0.2);
    box('metal', 0.2, 0.23, 0.45, 0.88, -0.23, -0.2);
    cbox('deck', -0.23, 0.23, 0.62, 0.86, -0.235, -0.205, 0.006);
  }
  function pot(x, z, y) {
    cyl('planter', 0.09, 0.14, x, y, z, 14);
    cyl('soil', 0.08, 0.005, x, y + 0.13, z, 14);
    planters.push({ x, y: +(y + 0.135).toFixed(3), z, w: 0.16, d: 0.16, kind: 'indoor' });
  }
  local(X(0.8), DECK, -5.05, 0, () => sofa(2.2, 3));
  local(X(-0.95), DECK, -3.75, Math.PI / 2, () => sofa(0.86, 1));
  local(X(2.55), DECK, -3.75, -Math.PI / 2, () => sofa(0.86, 1));
  local(X(0.8), DECK, -3.75, 0, () => table(1.2, 0.6, 0.38));
  local(X(1.4), DECK, -1.7, 0, () => table(2.0, 0.9, 0.75));
  for (const x of [X(1.4) - 0.6, X(1.4), X(1.4) + 0.6]) {
    local(x, DECK, -2.42, 0, chair);
    local(x, DECK, -0.98, Math.PI, chair);
  }
  pot(X(0.8), -3.75, DECK + 0.38);
  pot(X(1.4), -1.7, DECK + 0.75);

  // =========================================================================
  // 5 bis. Pièces habitées derrière les grandes baies (voir interiors.js)
  // Repère de chaque pièce : sol y = 0, mur de la baie sur z = 0, pièce vers -z.
  // =========================================================================
  const rooms = [];
  const PI = Math.PI;
  const roomAt = (x, y, z, ry = 0) => new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z);
  const curt = (F, a, b, h) => { F.curtain(a, a + 0.42, -0.12, h); F.curtain(b - 0.42, b, -0.12, h); };
  // Passe 5 : les pièces suivent les plans de lots.js (chambre 1 du lot A derrière la baie gauche,
  // séjour-cuisine du lot A derrière les baies des loggias, séjour du lot B derrière la loggia C).
  // --- chambre 1 du lot A (baie 2 vantaux + fenêtre latérale z = -2.4) ---
  {
    const xa = -HW + T, xb = -1.02, D = 3.54, wa = X(-3.58), wb = X(-0.82), cx = (xa + xb) / 2;
    const poly = [[xa, 0], [xb, 0], [xb, -D], [xa, -D]];
    const variants = [
      (F, at) => { // chambre-bureau
        at(cx - 0.1, -D + 0.02, 0, () => F.bed(1.6, 0xf2efe9, 0xb7aa98));
        at(cx - 0.1, -D, 0, () => F.painting(1.1, 0.6, 1.45, 1));
        at(cx - 0.1, -1.9, 0, () => F.rug(2.2, 1.4, 0));
        at(xb - 0.36, -0.95, -PI / 2, () => F.desk(1.2));
        F.plant(xa + 0.4, -0.45, 1.1);
        curt(F, wa, wb, 2.3);
      },
      (F, at) => { // chambre
        at(cx, -D + 0.02, 0, () => F.bed(1.6, 0xeee9e0, 0x8b9a86));
        at(cx, -D, 0, () => F.painting(1.2, 0.7, 1.45, 3));
        at(cx, -2.0, 0, () => F.rug(2.4, 1.5, 1));
        at(xb - 0.55, -0.75, -2.3, () => F.armchair(0xc49a6c));
        F.floorLamp(xb - 0.3, -1.45);
        F.plant(xa + 0.4, -0.45, 1.3);
        curt(F, wa, wb, 2.3);
      },
      (F, at) => { // chambre de la suite
        at(cx, -D + 0.02, 0, () => F.bed(1.8, 0xf2efe9, 0xb7aa98));
        at(cx, -D, 0, () => F.painting(1.1, 0.6, 1.45, 5));
        at(cx, -2.0, 0, () => F.rug(2.6, 1.6, 2));
        at(xa + 0.23, -1.0, PI / 2, () => F.sideboard(1.2, 0.85, 0xd9cbb7));
        F.plant(xb - 0.4, -0.45, 1.0);
        curt(F, wa, wb, 2.3);
      },
    ];
    FLOORS.forEach((y, i) => rooms.push({
      matrix: roomAt(0, y + SLAB, -T), poly, windowEdges: [0], H: 2.5, seed: 11 + i,
      wall: [0xe6dccd, 0xe2dbd0, 0xe8dccb][i], furnish: variants[i],
      spots: [[cx - 0.9, -1.0], [cx + 0.9, -1.0], [cx, -2.6]],
    }));
  }
  // --- séjour-cuisine du lot A (baies coulissantes des loggias, porte de la loggia A) ---
  {
    const xa = -0.92, xb = HW - T, wa = X(0.9);
    // repère : z local = z monde + 1.62 ; recul de la loggia A sur x = 4.38
    const zA0 = LOG_A[1] - (SLAB_Z0 - T), zA1 = LOG_A[0] - (SLAB_Z0 - T);
    const poly = [[xa, 0], [xb, 0], [xb, zA0], [RET_X - T, zA0], [RET_X - T, zA1], [xb, zA1], [xb, -4.24], [2.11, -4.24], [2.11, -5.94], [xa, -5.94]];
    const common = (F, at, isl = true) => {
      at(0.6, -5.94 + 0.3, 0, () => F.kitchen(2.8));
      if (isl) at(0.6, -4.45, 0, () => F.island(1.8));
      F.plant(xb - 0.4, -0.45, 1.25);
      F.curtain(wa, wa + 0.45, -0.12, 2.35);
    };
    const variants = [
      (F, at) => { // séjour + salle à manger
        common(F, at);
        at(0.9, -1.4, 0, () => F.diningTable(1.8, 0.9, 6));
        F.pendant(0.45, -1.4, 1.8); F.pendant(1.35, -1.4, 1.8);
        at(3.5, -4.24 + 0.47, 0, () => F.sofa(2.4, 0xb9b2a6));
        at(3.5, -4.24, 0, () => F.painting(1.3, 0.8, 1.3, 2));
        at(3.5, -2.95, 0, () => F.coffeeTable(1.2, 0.6));
        at(3.5, -3.0, 0, () => F.rug(2.8, 1.9, 0));
        F.floorLamp(5.25, -3.9);
      },
      (F, at) => { // séjour télévision
        common(F, at);
        at(3.3, -4.24 + 0.23, 0, () => { F.sideboard(2.0, 0.55, 0x8c6a4a); F.tv(1.3); });
        at(3.2, -1.9, PI, () => F.sofa(2.2, 0x9ea3a0, [0xd2b48c, 0xe8e2d6]));
        at(3.2, -3.05, 0, () => F.coffeeTable(1.0, 0.55, 0x4a3a2c));
        at(3.2, -2.9, 0, () => F.rug(2.6, 1.9, 1));
        at(0.8, -1.3, 0, () => F.diningTable(1.6, 0.85, 4, 0xa07a54, 0x2f2f2f));
        F.pendant(0.8, -1.3, 1.8, 0.8);
        F.floorLamp(5.25, -3.9);
      },
      (F, at) => { // grande cuisine ouverte (attique)
        common(F, at);
        at(3.3, -1.2, 0, () => F.diningTable(1.8, 0.9, 6));
        F.pendant(2.85, -1.2, 1.8); F.pendant(3.75, -1.2, 1.8);
        at(3.6, -4.24 + 0.47, 0, () => F.sofa(2.2, 0xc2b8a8));
        at(3.6, -4.24, 0, () => F.painting(1.2, 0.7, 1.35, 4));
        at(0.4, -1.2, PI / 2, () => F.armchair(0xa8805c));
        F.floorLamp(-0.6, -0.4);
      },
    ];
    FLOORS.forEach((y, i) => rooms.push({
      matrix: roomAt(0, y + SLAB, SLAB_Z0 - T), poly, windowEdges: [0], H: 2.45, seed: 21 + i,
      wall: [0xe8ddcd, 0xdedad2, 0xe9dece][i], furnish: variants[i],
      spots: [[0.6, -2.6], [2.4, -2.6], [4.2, -0.6], [0.6, -5.0]],
    }));
  }
  // --- séjour du lot B (loggia C, fenêtres arrière x > 0) ---
  // repère : x local = -z monde, z local = x monde - 4.38 (porte de la loggia sur z local = 0)
  {
    const zb = -LOG_C[1], za = -LOG_C[0];          // 15.4 → 17.6
    const zr = HW - T - (RET_X - T);                // 1.2 : nu intérieur de la façade droite
    const poly = [[zb, 0], [za, 0], [za, 0.42], [za + 0.3, 0.42], [za + 0.3, zr], [18.58, zr], [18.58, -3.0],
      [13.26, -3.0], [13.26, zr], [zb - 0.3, zr], [zb - 0.3, 0.42], [zb, 0.42]];
    const variants = [
      (F, at) => {
        at(13.26 + 0.47, -1.2, PI / 2, () => F.sofa(2.2, 0xbdb5a8));
        at(14.95, -1.2, PI / 2, () => F.coffeeTable(1.1, 0.6));
        at(15.0, -1.2, PI / 2, () => F.rug(2.6, 1.8, 0));
        at(17.4, -1.95, 0, () => F.diningTable(1.5, 0.85, 4));
        F.pendant(17.4, -1.95, 1.8, 0.8);
        F.floorLamp(13.6, 0.85); F.plant(18.2, 0.85, 1.2);
      },
      (F, at) => {
        at(16.0, -3.0 + 0.47, 0, () => F.sofa(2.2, 0xc2b8a8));
        at(16.0, -1.75, 0, () => F.coffeeTable(1.0, 0.55));
        at(16.0, -1.85, 0, () => F.rug(2.4, 1.6, 2));
        at(13.26 + 0.19, -1.4, PI / 2, () => F.bookshelf(1.4, 2.0));
        at(17.8, -1.0, -2.2, () => F.armchair(0x8b9a86));
        F.floorLamp(18.2, -2.6); F.plant(14.2, 0.85, 1.3);
        at(16.0, -3.0, 0, () => F.painting(1.1, 0.7, 1.35, 3));
      },
      (F, at) => {
        at(13.26 + 0.47, -1.4, PI / 2, () => F.sofa(2.4, 0x9ea3a0, [0xd2b48c, 0xe8e2d6]));
        at(15.0, -1.4, PI / 2, () => F.coffeeTable(1.1, 0.6, 0x4a3a2c));
        at(17.5, -1.95, 0, () => F.diningTable(1.4, 0.8, 4, 0xa07a54, 0x2f2f2f));
        F.pendant(17.5, -1.95, 1.75, 0.8);
        F.plant(18.2, 0.85, 1.4); F.floorLamp(13.6, 0.85);
      },
    ];
    FLOORS.forEach((y, i) => rooms.push({
      matrix: roomAt(RET_X - T, y + 0.55, 0, PI / 2), poly, windowEdges: [0], H: 2.38, seed: 31 + i,
      wall: [0xe5dacb, 0xe3dcd0, 0xe8dccc][i], furnish: variants[i],
      spots: [[14.6, -1.2], [16.5, -1.2], [17.5, -2.2]],
    }));
  }

  // =========================================================================
  // 6. Fusion par matériau et assemblage
  // =========================================================================
  const group = new THREE.Group();
  group.name = 'building';
  const fallback = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.8 });
  const sub = new Map();
  let tris = 0;
  for (const [k, list] of buckets) {
    const [gname, mkey] = k.split('|');
    const geo = list.length === 1 ? list[0] : mergeGeometries(list, false);
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    tris += geo.attributes.position.count / 3;
    const mesh = new THREE.Mesh(geo, M[mkey] || fallback);
    mesh.name = `${gname}:${mkey}`;
    mesh.castShadow = mkey !== 'glassRail' && mkey !== 'interiorWarm';
    mesh.receiveShadow = true;
    mesh.userData.materialKey = mkey;
    if (!sub.has(gname)) {
      const g = new THREE.Group();
      g.name = gname;
      sub.set(gname, g);
      group.add(g);
    }
    sub.get(gname).add(mesh);
    for (const g of list) if (g !== geo) g.dispose();
  }

  // intérieurs : pièces modélisées + pièces simulées
  const interiors = createInteriors(THREE, M, { rooms, windows: imWindows });
  group.add(interiors);
  tris += interiors.userData.triangles || 0;

  group.userData = {
    levels: [
      { key: 0, name: 'RDC', y0: 0, y1: 3 },
      { key: 1, name: 'R+1', y0: 3, y1: 6 },
      { key: 2, name: 'R+2', y0: 6, y1: 9 },
      { key: 3, name: 'R+3', y0: 9, y1: 12 },
      { key: 4, name: 'Toit', y0: 12, y1: 13.2 },
    ],
    planters,
    bounds: { minX: -SOCLE, maxX: SOCLE, minZ: -19, maxZ: SLAB_Z1, height: 14.9, floorMinX: -HW, floorMaxX: HW, socleMinZ: -1.4, socleMaxZ: 0.4 },
    stats: { triangles: tris, meshes: buckets.size + interiors.children.length, interiorTriangles: interiors.userData.triangles, simulatedWindows: imWindows.length },
    // gabarit du bâtiment, lu par lots.js pour que les plans d'étage suivent les ouvertures réelles
    layout: {
      HW, T, SOCLE, FLOORS, SLAB, DECK, ROOF, TOP,
      slab: { x0: SLAB_X0, x1: SLAB_X1, z0: SLAB_Z0, z1: SLAB_Z1, retX: RET_X, retZ: RET_Z },
      loggias: { A: LOG_A, B: LOG_B, C: LOG_C, depthX: RET_X },
      loggiaDoors: { A: [LOG_A[1] - 1.35, LOG_A[1] - 0.25], B: [LOG_B[1] - 1.35, LOG_B[1] - 0.25], C: [LOG_C[1] - 1.4, LOG_C[1] - 0.3] },
      frontBaie: [X(-3.58), X(-0.82)], loggiaGlass: [X(0.9), X(4.1)],
      lame: [-HW, X(-3.74)], sideWall: [SLAB_X0 - T, SLAB_X0],
      leftWin: LEFT_WIN, leftWinW: 0.95, stairZ: STAIR_Z, band1Z: BAND1_Z, stairWin: [(STAIR_Z[0] + STAIR_Z[1]) / 2 - 0.5, (STAIR_Z[0] + STAIR_Z[1]) / 2 + 0.5],
      backWinX: [-3.75, -1.25, 1.25, 3.75].map(X), rdcLeftWin: [-5.4, -12.1, -15.2, -17.6],
      edicule: { x: ED_X, z: ED_Z },
      rdc: { garages: [[X(-3.35), X(-0.65)], [X(-0.5), X(2.2)]], door: [X(2.35), X(3.45)], window: [X(-4.6), X(-3.7)], socleDepth: -1.4 },
    },
    // masque les intérieurs (pièces modélisées + simulées) dans une tranche de hauteur [y0, y1] ;
    // utilisé par lots.js quand le plan d'un étage remplace ses pièces
    setInteriorBand: (y0, y1) => interiors.userData.setHiddenBand(y0, y1),
  };
  return group;
}
