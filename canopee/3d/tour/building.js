// Canopée — maquette 02 : la tour (module bâtiment de viewer.js, voir tour/index.html)
// Tour de verre de 150 m à plan en goutte d'eau, posée sur un socle en L de 29 m à façades pliées et toiture jardin.
// Une faille plantée large fait un tour complet de la tour, du toit du socle jusqu'au sommet, où elle débouche sur
// une toiture en gradins qui monte en spirale jusqu'à la pointe de verre. Mur-rideau (montants et nez de dalle
// métalliques), plateaux de bureaux éclairés derrière le verre, terrasses de la faille avec jardinières et
// garde-corps vitrés. Les plantes, arbres et toitures végétalisées sont posés par landscape.js (userData).

export const H = 150;                       // hauteur hors tout (m), à la pointe
export const FLOOR = 3.6;                   // étage courant de la tour
export const HP = 29, NP = 7, FP = HP / NP; // socle : hauteur, niveaux, hauteur de niveau
export const FLOORS = NP + Math.floor((H - HP) / FLOOR);
const SP = HP / H;                          // toit du socle, en fraction de hauteur
const TA = 20, TB = 26, TM = 0.9;           // goutte : demi-largeur (échelle), demi-longueur, finesse de la pointe
const TWIST = 0.5;                         // légère vrille de la section sur toute la hauteur (rad)
const TURNS = 1;                            // tours de la faille entre le socle et le sommet
const G_END = 0.45;                         // position de la faille au sommet (0 = pointe) : elle débouche dans le bas des gradins
const GROOVE_W = 0.14;                      // demi-largeur de la faille (fraction du pourtour)
const GROOVE_D = 7.5;                       // profondeur des terrasses de la faille (m)
const DROP = 30;                            // dénivelé de la toiture en gradins, de la pointe au point bas
const RREF = 17;                            // rayon de référence pour creuser la faille vers le centre
const SW = 0.24;                            // enroulement des contremarches des gradins vers le centre (fraction du pourtour)

const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const wrap = (u) => u - Math.floor(u);
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ---------- plan en goutte : pointe au nord (z < 0), bout arrondi au sud ----------
const td = (t, o) => { o[0] = TA * Math.sin(t) * Math.pow(Math.abs(Math.sin(t / 2)), TM); o[1] = -TB * Math.cos(t); return o; };
// paramètre u ∈ [0,1) proportionnel à la longueur de pourtour (montants régulièrement espacés), centre de gravité
const NL = 4096, T_OF_U = new Float64Array(NL + 1);
let CX = 0, CZ = 0, PERIM = 0;
{
  const len = new Float64Array(NL + 1), a = td(0, [0, 0]), b = [0, 0];
  let area = 0;
  for (let i = 1; i <= NL; i++) {
    td((i / NL) * Math.PI * 2, b);
    len[i] = len[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]);
    const cr = a[0] * b[1] - b[0] * a[1]; area += cr; CX += (a[0] + b[0]) * cr; CZ += (a[1] + b[1]) * cr;
    a[0] = b[0]; a[1] = b[1];
  }
  CX /= 3 * area; CZ /= 3 * area; PERIM = len[NL];
  let j = 0;
  for (let i = 0; i <= NL; i++) {
    const L = (i / NL) * PERIM;
    while (j < NL - 1 && len[j + 1] < L) j++;
    T_OF_U[i] = ((j + (L - len[j]) / (len[j + 1] - len[j] || 1)) / NL) * Math.PI * 2;
  }
}
const tOf = (u) => { const x = wrap(u) * NL, i = Math.min(NL - 1, x | 0); return T_OF_U[i] + (T_OF_U[i + 1] - T_OF_U[i]) * (x - i); };

// ---------- forme ----------
// échelle de la section selon la hauteur s ∈ [0,1] : léger renflement à mi-hauteur, resserrement au sommet
export const prof = (s) => (1 + 0.05 * Math.sin(Math.PI * s)) * (1 - 0.08 * s * s);
const twist = (s) => TWIST * s;
const sn = (s) => (s - SP) / (1 - SP);
export const grooveC = (s) => G_END - TURNS * (1 - sn(s));         // centre de la faille sur le pourtour (en tours)
const grooveDepth = (s) => GROOVE_D * smooth(SP + 0.004, SP + 0.03, s);
const cdist = (u, c) => { const d = Math.abs(wrap(u - c)); return Math.min(d, 1 - d); };
const grooveW = (u, s) => 1 - smooth(GROOVE_W - 0.012, GROOVE_W + 0.002, cdist(u, grooveC(s)));
const inGroove = (u, s) => grooveDepth(s) > 0.4 && grooveW(u, s) > 0.5;
// arête haute du mur-rideau : monte de H − DROP (juste après la pointe) à H (en revenant à la pointe), u ∈ [0,1]
export const roofY = (u) => H - DROP * (1 - Math.min(1, Math.max(0, u)));
const roofYw = (u) => roofY(wrap(u));

const pA = [0, 0], pB = [0, 0], tmpS = { x: 0, z: 0, nx: 0, nz: 0 };
function section(s, u) {
  const t = tOf(u), k = prof(s);
  td(t - 1e-3, pA); td(t + 1e-3, pB);
  const dx = pB[0] - pA[0], dz = pB[1] - pA[1], l = Math.hypot(dx, dz) || 1;
  td(t, pA);
  tmpS.x = CX + (pA[0] - CX) * k; tmpS.z = CZ + (pA[1] - CZ) * k; tmpS.nx = dz / l; tmpS.nz = -dx / l;
  return tmpS;
}
// point monde de la paroi : `inset` m vers l'intérieur ; groove = 1 suit le fond de la faille, 0 la peau extérieure.
// La faille est creusée en resserrant la section vers son centre (jamais de repli, même près de la pointe).
export function towerPoint(s, u, inset, groove, out) {
  const p = section(s, u);
  let x = p.x - p.nx * inset, z = p.z - p.nz * inset;
  const g = groove ? grooveDepth(s) * grooveW(u, s) * groove : 0;
  if (g) { const f = 1 - g / (RREF * prof(s)); x = CX + (x - CX) * f; z = CZ + (z - CZ) * f; }
  const th = twist(s), c = Math.cos(th), sn_ = Math.sin(th);
  out.x = x * c - z * sn_; out.y = s * H; out.z = x * sn_ + z * c;
  return out;
}
const centre = (s, out) => { const th = twist(s), c = Math.cos(th), sn_ = Math.sin(th); out.x = CX * c - CZ * sn_; out.z = CX * sn_ + CZ * c; return out; };

// ---------- socle en L (plan d'après la toiture : goutte de la tour élargie + aile vers l'est) ----------
function podiumPlan() {
  const P = { x: 0, y: 0, z: 0 }, pts = [];
  // côté est de la goutte à z = 10 (raccord avec l'aile)
  let ue = 0.25;
  for (let i = 0; i < 400; i++) { const u = 0.05 + 0.4 * i / 400; towerPoint(SP, u, -4.5, 0, P); if (P.z > 10) { ue = u; break; } }
  // de la pointe vers l'ouest puis le sud, jusqu'au départ de la façade sud rectiligne
  const N = 70;
  for (let i = 0; i <= N; i++) { const u = ue - (ue + 1 - 0.56) * i / N; towerPoint(SP, wrap(u), -4.5, 0, P); pts.push([P.x, P.z]); }
  // façade sud rectiligne, angle arrondi, pointe est, retour nord de l'aile (avec le décroché)
  for (const p of [[49.5, 31.5], [52.6, 31.1], [54.6, 29.6], [65.9, 8.6], [66.2, 6.7], [64.8, 5.7], [51.2, 5.4], [44.2, 10]]) pts.push(p);
  return pts;
}
const area2 = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a; };
// normales extérieures en onglet (bornées) d'un polygone fermé
function miters(pts) {
  const sgn = area2(pts) > 0 ? 1 : -1, n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
    const e1 = [b[0] - a[0], b[1] - a[1]], e2 = [c[0] - b[0], c[1] - b[1]];
    const l1 = Math.hypot(...e1) || 1, l2 = Math.hypot(...e2) || 1;
    const n1 = [sgn * e1[1] / l1, -sgn * e1[0] / l1], n2 = [sgn * e2[1] / l2, -sgn * e2[0] / l2];
    let mx = n1[0] + n2[0], mz = n1[1] + n2[1]; const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
    const k = Math.min(2.2, 1 / Math.max(0.35, mx * n1[0] + mz * n1[1]));
    out.push([mx * k, mz * k]);
  }
  return out;
}
const offsetPoly = (pts, d) => { const m = miters(pts); return pts.map((p, i) => [p[0] + m[i][0] * d, p[1] + m[i][1] * d]); };
// redécoupe des côtés en tronçons d'au plus `max` m (plis de façade)
function resample(pts, max) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(L / max));
    for (let k = 0; k < n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
  }
  return out;
}
const inPoly = (x, z, pts) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, zi] = pts[i], [xj, zj] = pts[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
const segDist = (x, z, pts) => {
  let d = 1e9;
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length], ex = bx - ax, ez = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
    d = Math.min(d, Math.hypot(x - ax - ex * t, z - az - ez * t));
  }
  return d;
};

export function createBuilding(THREE, M) {
  const group = new THREE.Group();
  group.name = 'tour';
  const rnd = mulberry32(150);

  // ---------- matériaux propres à la tour ----------
  const canvasTex = (w, h, draw) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
  };
  // plafonds de bureaux : dalles claires et rangées de luminaires linéaires
  const ceilTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#d9d6cf'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(0,0,0,.08)'; g.lineWidth = 2; for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, h); g.moveTo(0, i * 64); g.lineTo(w, i * 64); g.stroke(); }
  });
  const ceilEm = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#4c4c4c'; g.fillRect(0, 0, w, h);                         // dalle éclairée par réflexion
    g.fillStyle = '#fff'; for (const y of [60, 188]) g.fillRect(20, y, 216, 8);
  });
  ceilTex.repeat.set(1 / 4.8, 1 / 4.8); ceilEm.repeat.copy(ceilTex.repeat);
  // trame du socle : montants tous les 1,6 m et bandeau de dalle à chaque niveau (u = m / 1,6, v = niveaux)
  const podTex = canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = '#8d9dad'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#bcc4cc'; g.fillRect(0, 0, 3, h);
    g.fillStyle = '#3c444c'; g.fillRect(0, h - 26, w, 20);
    g.fillStyle = '#d3d9de'; g.fillRect(0, h - 6, w, 6); g.fillRect(0, 0, w, 3);
  });
  // spots encastrés tous les 1,8 m, halo léger autour
  const downlights = canvasTex(64, 64, (g) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, 64, 64);
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 30); gr.addColorStop(0, '#fff'); gr.addColorStop(0.18, '#fff'); gr.addColorStop(0.22, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,.04)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  });
  downlights.repeat.set(1 / 1.8, 1 / 1.8);
  const glassOpts = { metalness: 0.62, roughness: 0.045, envMapIntensity: 1.25, clearcoat: 1, clearcoatRoughness: 0.02, transparent: true, opacity: 0.86, side: THREE.DoubleSide };
  const mat = {
    // verre de façade à couche argentée : reflet fort, intérieur à peine perceptible
    glass: new THREE.MeshPhysicalMaterial({ name: 'towerGlass', color: 0x7f8f9f, ...glassOpts, opacity: 0.97 }),
    // voile de verre de la pointe : verre clair extra-blanc, on y lit les plateaux éclairés et les jardins derrière
    sail: new THREE.MeshPhysicalMaterial({ name: 'crownGlass', color: 0xdfe8ee, ...glassOpts, metalness: 0.25, roughness: 0.03, envMapIntensity: 1.5, opacity: 0.42, emissive: 0xfff0dc, emissiveIntensity: 0 }),
    podGlass: new THREE.MeshPhysicalMaterial({ name: 'podiumGlass', color: 0xffffff, map: podTex, ...glassOpts, flatShading: true }),
    mullion: new THREE.MeshStandardMaterial({ name: 'towerMullion', color: 0xb9c0c8, metalness: 0.85, roughness: 0.3 }),
    spandrel: new THREE.MeshStandardMaterial({ name: 'towerSpandrel', color: 0x3c444c, metalness: 0.6, roughness: 0.38 }),
    slabEdge: M.slabWhite,
    floor: new THREE.MeshStandardMaterial({ name: 'towerFloor', color: 0x8d867c, roughness: 0.85, emissive: 0xffe2bc, emissiveIntensity: 0 }),
    ceiling: new THREE.MeshStandardMaterial({ name: 'towerCeiling', map: ceilTex, emissiveMap: ceilEm, emissive: 0xffe9cc, emissiveIntensity: 1.6, roughness: 0.9 }),
    // le soir, tous les plateaux ne sont pas allumés : veilleuses (couloirs, écrans) et bureaux éteints
    ceilDim: new THREE.MeshStandardMaterial({ name: 'towerCeilingDim', map: ceilTex, emissiveMap: ceilEm, emissive: 0xffd2a0, emissiveIntensity: 0.35, roughness: 0.9 }),
    furniture: new THREE.MeshStandardMaterial({ name: 'towerFurniture', color: 0x3a3836, roughness: 0.8 }),
    // sous-faces de la faille et bornes du parvis : éteintes le jour, allumées au crépuscule (onLight)
    soffit: new THREE.MeshStandardMaterial({ name: 'terraceSoffit', color: 0xd8d4cc, roughness: 0.9, emissive: 0xffd9a6, emissiveMap: downlights, emissiveIntensity: 0 }),
    lamp: new THREE.MeshStandardMaterial({ name: 'bollardLamp', color: 0xe8e4dc, roughness: 0.5, emissive: 0xffd49a, emissiveIntensity: 0 }),
    ceilOff: new THREE.MeshStandardMaterial({ name: 'towerCeilingOff', map: ceilTex, color: 0x8a8780, roughness: 0.9 }),
    core: new THREE.MeshStandardMaterial({ name: 'towerCore', color: 0x9a968f, roughness: 0.9 }),
    deck: M.deck, planter: M.planter, soil: M.soil, rail: M.glassRail, paver: M.paver, curb: M.curb, metal: M.metal,
  };
  const add = (geo, m, { cast = true, receive = true, name } = {}) => {
    const mesh = new THREE.Mesh(geo, m); mesh.castShadow = cast; mesh.receiveShadow = receive; if (name) mesh.name = name;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix(); group.add(mesh); return mesh;
  };
  // accumulateur de triangles (positions, uv en mètres)
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
  // plan horizontal (polygone + trous éventuels, en x,z) à la hauteur y, face vers le haut ou le bas
  const flat = (pts, y, up = true, holes = []) => {
    const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, up ? -z : z)));
    for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, up ? -z : z))));
    const g = new THREE.ShapeGeometry(shape); g.rotateX(up ? -Math.PI / 2 : Math.PI / 2); g.translate(0, y, 0);
    const uv = g.attributes.uv, p = g.attributes.position; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), -p.getZ(i));
    return g;
  };
  // ajoute une géométrie indexée (flat) à un accumulateur
  const addFlat = (acc, g) => {
    const p = g.attributes.position, uv = g.attributes.uv, b = acc.p.length / 3;
    for (let i = 0; i < p.count; i++) acc.v(p.getX(i), p.getY(i), p.getZ(i), uv.getX(i), uv.getY(i));
    const ix = g.index.array; for (let i = 0; i < ix.length; i++) acc.i.push(b + ix[i]);
  };
  // paroi verticale le long d'un polygone fermé
  const wall = (acc, pts, y0, y1, closed = true) => {
    for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length], b = acc.p.length / 3, L = Math.hypot(bx - ax, bz - az);
      for (let f = 0; f < 2; f++) { acc.v(ax, y0, az, 0, y0); acc.v(bx, y0, bz, L, y0); acc.v(bx, y1, bz, L, y1); acc.v(ax, y1, az, 0, y1); }
      acc.quad(b, b + 1, b + 2, b + 3); acc.quad(b + 4, b + 7, b + 6, b + 5);   // deux faces, sommets distincts (normales justes)
    }
  };
  // pavé orienté : centre (cx, cz), direction (tx, tz), longueur L, largeur W, de y0 à y1 (faces latérales, dessus et dessous)
  const box = (acc, cx, cz, tx, tz, L, W, y0, y1) => {
    const n = Math.hypot(tx, tz) || 1, ax = tx / n * L / 2, az = tz / n * L / 2, bx = -tz / n * W / 2, bz = tx / n * W / 2;
    const pts = [[cx - ax - bx, cz - az - bz], [cx + ax - bx, cz + az - bz], [cx + ax + bx, cz + az + bz], [cx - ax + bx, cz - az + bz]];
    wall(acc, pts, y0, y1);
    for (const y of [y0, y1]) { const b = acc.p.length / 3; for (const [x, z] of pts) acc.v(x, y, z, x, -z); for (const [x, z] of pts) acc.v(x, y, z, x, -z); acc.quad(b, b + 1, b + 2, b + 3); acc.quad(b + 4, b + 7, b + 6, b + 5); }
  };
  const P = { x: 0, y: 0, z: 0 }, Q = { x: 0, y: 0, z: 0 }, C = { x: 0, z: 0 };
  const planters = [], trees = [];
  const ys = [];                                    // niveaux de la tour, du toit du socle au sommet
  for (let y = HP; y < H - 1; y += FLOOR) ys.push(y);

  // ---------- mur-rideau de la tour : peau extérieure et vitrage du fond de la faille ----------
  {
    const NU = 360, NS = 420, skin = new Acc(), back = new Acc(), idx = [];
    for (let j = 0; j <= NS; j++) {
      const s = SP + (1 - SP) * j / NS;
      for (let i = 0; i <= NU; i++) {
        const u = i / NU, sv = Math.min(s, roofY(u) / H);       // arête haute en gradins
        towerPoint(sv, u, 0, 1, P);
        idx.push([skin.v(P.x, P.y, P.z, u, sv), back.v(P.x, P.y, P.z, u, sv)]);
      }
    }
    for (let j = 0; j < NS; j++) {
      const s = SP + (1 - SP) * (j + 0.5) / NS;
      for (let i = 0; i < NU; i++) {
        const u = (i + 0.5) / NU;
        if (s * H > roofY(u) + 2) continue;
        const a = j * (NU + 1) + i, b = a + 1, c = a + NU + 1, d = c + 1;
        const k = inGroove(u, s) ? 1 : 0, A_ = k ? back : skin;
        A_.quad(idx[a][k], idx[c][k], idx[d][k], idx[b][k]);
      }
    }
    const m1 = add(skin.geo(), mat.glass, { cast: false, name: 'curtainWall' }), m2 = add(back.geo(), mat.glass, { cast: false, name: 'terraceGlazing' });
    m1.renderOrder = m2.renderOrder = 2;

    // couvertine métallique sur l'arête haute, et arête verticale de la pointe
    const cop = new Acc(), led = new Acc();
    for (let i = 0; i <= NU; i++) {
      const u = i / NU, s = roofY(u) / H;
      towerPoint(s, u, -0.07, 1, P); towerPoint(s, u, 0.32, 1, Q);
      cop.v(P.x, P.y + 0.12, P.z, u * PERIM, 0); cop.v(Q.x, Q.y + 0.12, Q.z, u * PERIM, 0.4);
      if (i) { const b = cop.p.length / 3 - 4; cop.quad(b, b + 2, b + 3, b + 1); }
      // ligne LED sous la couvertine : dessine la spirale du sommet la nuit
      towerPoint(s, u, -0.09, 1, P);
      led.v(P.x, P.y - 0.02, P.z, 0, 0); led.v(P.x, P.y + 0.1, P.z, 0, 1);
      if (i) { const b = led.p.length / 3 - 4; led.quad(b, b + 2, b + 3, b + 1); }
    }
    add(led.geo(), mat.lamp, { cast: false, name: 'crownLed' }).userData.noAO = true;
    const b0 = cop.p.length / 3;
    for (let j = 0; j <= 24; j++) {
      const s = (H - DROP + DROP * j / 24) / H;
      towerPoint(s, 0, -0.07, 0, P); towerPoint(s, 0, 0.5, 0, Q);
      cop.v(P.x, P.y, P.z, 0, P.y); cop.v(Q.x, Q.y, Q.z, 0.5, Q.y); cop.v(P.x, P.y, P.z, 0, P.y); cop.v(Q.x, Q.y, Q.z, 0.5, Q.y);
      if (j) { const b = b0 + (j - 1) * 4; cop.quad(b, b + 4, b + 5, b + 1); cop.quad(b + 2, b + 3, b + 7, b + 6); }
    }
    add(cop.geo(), mat.mullion, { name: 'coping' });
  }

  // ---------- montants verticaux (pas ≈ 1,2 m) et nez de dalle ----------
  {
    const fins = new Acc(), NMU = 100, NS = 300;
    for (let m = 0; m < NMU; m++) {
      const u = (m + 0.5) / NMU, sTop = roofY(u) / H - 0.002;
      let run = [];
      const flush = () => {
        if (run.length > 1) {
          const base = fins.p.length / 3;
          for (const [s, du] of run) {
            for (const [off, ins] of [[-du, 0.02], [-du, -0.16], [du, -0.16], [du, 0.02]]) { towerPoint(s, u + off, ins, 0, P); fins.v(P.x, P.y, P.z, 0, s * H); }
          }
          for (let r = 0; r < run.length - 1; r++) {
            const o = base + r * 4, n = o + 4;
            fins.quad(o, n, n + 1, o + 1); fins.quad(o + 1, n + 1, n + 2, o + 2); fins.quad(o + 2, n + 2, n + 3, o + 3);
          }
        }
        run = [];
      };
      for (let j = 0; j <= NS; j++) {
        const s = SP + (sTop - SP) * j / NS;
        const du = 0.035 / (PERIM * prof(s));   // ≈ 7 cm de large
        if (inGroove(u, s) || grooveW(u, s) > 0.05 && grooveDepth(s) > 0.4) { flush(); continue; }
        run.push([s, du]);
      }
      flush();
    }
    add(fins.geo(), mat.mullion, { name: 'mullions' }).userData.noAO = true;   // hors GTAO : sinon halo sombre sur les dalles vues derrière le verre

    // nez de dalle : bandeau de 22 cm en saillie de 6 cm, et allège opaque derrière le verre
    const caps = new Acc(), spand = new Acc(), NU = 360;
    for (const y of ys.slice(1)) {
      const s = y / H;
      const ring = (acc, y0, y1, ins0, ins1, groove) => {
        const base = acc.p.length / 3;
        for (let i = 0; i <= NU; i++) {
          const u = i / NU;
          towerPoint(y0 / H, u, ins0, groove, P); acc.v(P.x, y0, P.z, u * 100, 0);
          towerPoint(y1 / H, u, ins1, groove, Q); acc.v(Q.x, y1, Q.z, u * 100, 1);
        }
        for (let i = 0; i < NU; i++) {
          const u = (i + 0.5) / NU;
          if (y1 > roofY(u) - 0.05) continue;                                      // au-dessus de l'arête haute
          if (!groove && grooveW(u, s) > 0.02 && grooveDepth(s) > 0.4) continue;   // pas de bandeau dans la faille
          const a = base + i * 2; acc.quad(a, a + 2, a + 3, a + 1);
        }
      };
      ring(caps, y - 0.14, y + 0.08, -0.06, -0.06, 0);
      ring(spand, y - 0.4, y + 0.55, 0.14, 0.14, 1);
    }
    add(caps.geo(), mat.mullion, { name: 'slabNoses' });
    add(spand.geo(), mat.spandrel, { cast: false, name: 'spandrels' });
  }

  // ---------- plateaux de la tour : dalles, plafonds éclairés, noyau, gradins de la toiture ----------
  {
    const floorAcc = new Acc(), ceilAccs = [new Acc(), new Acc(), new Acc()], edgeAcc = new Acc(), riser = new Acc(), NU = 180;
    const lightR = mulberry32(4242), furn = new Acc();   // allumage des plateaux : 0 allumé, 1 veilleuse, 2 éteint
    const contour = (s, ins, groove) => { const pts = []; for (let i = 0; i < NU; i++) { towerPoint(s, i / NU, ins, groove, P); pts.push([P.x, P.z]); } return pts; };
    // éventail depuis le centre, limité aux tronçons de pourtour retenus par keep(u)
    const fan = (acc, pts, y, up, keep, cx, cz) => {
      const c = acc.v(cx, y, cz, cx, -cz), base = acc.p.length / 3;
      for (const [x, z] of pts) acc.v(x, y, z, x, -z);
      for (let i = 0; i < pts.length; i++) {
        if (!keep((i + 0.5) / pts.length)) continue;
        const a = base + i, b = base + (i + 1) % pts.length; if (up) acc.i.push(c, b, a); else acc.i.push(c, a, b);
      }
    };
    // gradins : chaque étage partiel est bordé par une contremarche courbe qui part du pourtour (en u = a) et s'enroule
    // vers le centre ; en a = 0 et a = 1 elle se confond avec la lame radiale de la pointe
    const stepU = (a, r) => a + SW * Math.sin(Math.PI * a) * (1 - r);
    const stepPt = (s, a, r, ins, groove) => { towerPoint(s, stepU(a, r), ins, groove, P); return [C.x + (P.x - C.x) * r, C.z + (P.z - C.z) * r]; };
    const NR = 14;
    const perim = (s, u0, u1, ins, groove) => { const n = Math.max(2, Math.ceil(Math.abs(u1 - u0) * 140)), o = []; for (let i = 0; i <= n; i++) { towerPoint(s, u0 + (u1 - u0) * i / n, ins, groove, P); o.push([P.x, P.z]); } return o; };
    const spiral = (s, a, ins, groove, rFrom, rTo) => { const o = []; for (let i = 1; i < NR; i++) { const r = rFrom + (rTo - rFrom) * i / NR; o.push(stepPt(s, a, r, ins, groove)); } return o; };
    // plateau partiel : de la contremarche u = a à la lame u = 1
    const platePoly = (s, a, ins, groove) => [[C.x, C.z], ...perim(s, 1, a, ins, groove), ...spiral(s, a, ins, groove, 1, 0)];
    const noses = new Acc(), posts = new Acc();
    // montant vertical perpendiculaire à une paroi (ép. 16 cm de part et d'autre)
    const post = (x, z, tx, tz, y0, y1) => { const L = Math.hypot(tx, tz) || 1, nx = -tz / L * 0.09, nz = tx / L * 0.09; wall(posts, [[x - nx, z - nz], [x + nx, z + nz]], y0, y1, false); };
    const mullionsAlong = (pts, y0, y1) => {
      let acc = 0;
      for (let i = 1; i < pts.length; i++) {
        const [ax, az] = pts[i - 1], [bx, bz] = pts[i], L = Math.hypot(bx - ax, bz - az);
        for (let d = 1.5 - acc; d < L; d += 1.5) post(ax + (bx - ax) * d / L, az + (bz - az) * d / L, bx - ax, bz - az, y0, y1);
        acc = (acc + L) % 1.5;
      }
    };
    ys.forEach((y, k) => {
      const s = y / H; centre(s, C);
      const has = (u) => y <= roofY(u) - 0.05;                 // dalle présente (couverte ou en toiture), sur le pourtour
      const ua0 = (y - (H - DROP)) / DROP;                     // > 0 : étage partiel des gradins
      const outer = contour(s, 0.12, 0);
      if (ua0 > 0) addFlat(floorAcc, flat(platePoly(s, ua0 + 0.002, 0.12, 0), y + 0.02));
      else fan(floorAcc, outer, y + 0.02, true, has, C.x, C.z);
      if (k > 0) {
        if (ua0 > 0) addFlat(ceilAccs[0], flat(platePoly(s, ua0 + 0.002, 0.6, 1), y - 0.36, false));   // plafond de l'étage du dessous
        else {
          // plateau découpé en 4 à 7 zones d'éclairage ; un étage sur six presque entièrement éteint
          const nz = 4 + (lightR() * 4 | 0), u0 = lightR(), quiet = lightR() < 0.17, st = [];
          for (let z = 0; z < nz; z++) { const r = lightR(); st.push(quiet ? (r < 0.15 ? 1 : 2) : r < 0.58 ? 0 : r < 0.78 ? 1 : 2); }
          const zone = (u) => Math.floor(wrap(u - u0) * nz);
          const ring = contour(s, 0.6, 1);
          for (let m = 0; m < 3; m++) fan(ceilAccs[m], ring, y - 0.36, false, (u) => has(u) && st[zone(u)] === m, C.x, C.z);
        }
        const base = edgeAcc.p.length / 3;
        for (const [x, z] of outer) { edgeAcc.v(x, y + 0.02, z, 0, 0); edgeAcc.v(x, y - 0.34, z, 0, 1); }
        for (let i = 0; i < outer.length; i++) { if (!has((i + 0.5) / NU)) continue; const a = base + i * 2, b = base + ((i + 1) % outer.length) * 2; edgeAcc.quad(a, b, b + 1, a + 1); }
        if (ua0 > 0) addFlat(edgeAcc, flat(platePoly(s, ua0 + 0.002, 0.12, 0), y - 0.34, false));
        else fan(edgeAcc, outer, y - 0.34, false, has, C.x, C.z);
      }
      // mobilier des bureaux (silhouettes vues à travers le verre le soir) : deux rangées de postes le long des vitrages
      if (ua0 <= 0 && k > 0) {
        for (const [ins, step] of [[3.0, 2.3], [5.4, 2.6]]) {
          const n = Math.floor(PERIM * prof(s) * 0.9 / step);
          for (let i = 0; i < n; i++) {
            const u = (i + 0.5) / n; if (!has(u) || lightR() < 0.22) continue;
            towerPoint(s, u, ins, 1, P); towerPoint(s, u + 0.004, ins, 1, Q);
            box(furn, P.x, P.z, Q.x - P.x, Q.z - P.z, 1.6, 0.8, y + 0.02, y + 0.76);
            if (lightR() < 0.5) box(furn, P.x, P.z, Q.x - P.x, Q.z - P.z, 1.6, 0.05, y + 0.76, y + 1.25);   // cloisonnette
          }
        }
      }
      // contremarche vitrée de l'étage partiel au-dessus : verre, montants, bandeau de dalle
      const uk = (y + FLOOR - (H - DROP)) / DROP;
      if (uk > 0 && uk < 1) {
        const line = [[C.x, C.z], ...spiral(s, uk, 0.1, 1, 0, 1), stepPt(s, uk, 1, 0.1, 1)];
        const y0 = y + 0.02, y1 = y + FLOOR - 0.34;
        let d = 0;
        for (let i = 1; i < line.length; i++) {
          const [ax, az] = line[i - 1], [bx, bz] = line[i], L = Math.hypot(bx - ax, bz - az), b = riser.p.length / 3;
          riser.v(ax, y0, az, d, y0); riser.v(bx, y0, bz, d + L, y0); riser.v(bx, y1, bz, d + L, y1); riser.v(ax, y1, az, d, y1);
          riser.quad(b, b + 1, b + 2, b + 3); d += L;
        }
        wall(noses, line, y1, y + FLOOR + 0.1, false);
        mullionsAlong(line, y0, y1);
      }
      // toiture-jardin de ce gradin (entre deux contremarches, à ciel ouvert) : terre, végétation, garde-corps, arbres
      const ua = Math.max(0, ua0), ub = Math.min(1, uk);
      if (ub - ua > 0.004) {
        const rails = new Acc();
        const poly = [...perim(s, ua, ub, 1.0, 0), ...spiral(s, ub, 1.0, 0, 1, 0), [C.x, C.z], ...spiral(s, ua, 1.0, 0, 0, 1)];
        const g = flat(poly, y + 0.12); add(g, mat.soil, { cast: false, name: 'roofSoil' });
        let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const [x, z] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
        planters.push({ kind: 'greenroof', x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, y: y + 0.12, poly, lush: 0.18 });
        // garde-corps vitré là où l'arête du mur-rideau est trop basse
        const uRail = Math.min(ub, (y + 1.1 - (H - DROP)) / DROP);
        if (uRail > ua) {
          const m = Math.max(2, Math.ceil((uRail - ua) * 200));
          for (let i = 0; i < m; i++) {
            towerPoint(s, ua + (uRail - ua) * i / m, 0.25, 0, P); towerPoint(s, ua + (uRail - ua) * (i + 1) / m, 0.25, 0, Q);
            const r0 = rails.p.length / 3;
            rails.v(P.x, y + 0.1, P.z, 0, 0); rails.v(Q.x, y + 0.1, Q.z, 1, 0); rails.v(Q.x, y + 1.1, Q.z, 1, 1); rails.v(P.x, y + 1.1, P.z, 0, 1);
            rails.quad(r0, r0 + 1, r0 + 2, r0 + 3);
          }
          const rm = add(rails.geo(), mat.rail, { cast: false, name: 'roofRail' }); rm.renderOrder = 3;
        }
        // arbres au milieu de la bande, entre les deux contremarches
        const nt = ub - ua > 0.07 ? 3 : ub - ua > 0.035 ? 2 : 1;
        for (let t = 0; t < nt; t++) {
          const r = 0.42 + 0.4 * (t + 0.5) / nt + (rnd() - 0.5) * 0.06;
          const um = (stepU(ua, r) + stepU(ub, r)) / 2 + (rnd() - 0.5) * 0.2 * (stepU(ub, r) - stepU(ua, r));
          towerPoint(s, um, 0, 0, P);
          trees.push([rnd() < 0.5 ? 'young' : 'birch', +(C.x + (P.x - C.x) * r).toFixed(2), +(C.z + (P.z - C.z) * r).toFixed(2), +(4.2 + rnd() * 2).toFixed(2), +(y + 0.12).toFixed(2)]);
        }
      }
    });
    add(floorAcc.geo(), mat.floor, { name: 'floors' });
    add(furn.geo(), mat.furniture, { cast: false, name: 'furniture' });
    [mat.ceiling, mat.ceilDim, mat.ceilOff].forEach((m, i) => add(ceilAccs[i].geo(), m, { cast: false, name: 'ceilings' + i }));
    add(edgeAcc.geo(), mat.slabEdge, { name: 'slabs' });
    // lame de verre de la pointe, du centre à la pointe, du gradin le plus bas au sommet : bandeau à chaque étage, montants
    const blade = [], sail = new Acc();
    for (let j = 0; j <= 8; j++) {
      const y = H - DROP + DROP * j / 8, s = y / H; centre(s, C); towerPoint(s, 1, 0.1, 0, P);
      sail.v(C.x, y, C.z, 0, y); sail.v(P.x, y, P.z, Math.hypot(P.x - C.x, P.z - C.z), y);
      if (j) { const b = sail.p.length / 3 - 4; sail.quad(b, b + 1, b + 3, b + 2); }
      if (j === 4) blade.push([C.x, C.z], [P.x, P.z]);
    }
    for (const y of ys) if (y > H - DROP + 0.5) wall(noses, blade, y - 0.34, y + 0.1, false);
    wall(noses, blade, H - 0.3, H + 0.12, false);
    mullionsAlong(blade, H - DROP, H);
    add(noses.geo(), mat.mullion, { name: 'stepNoses' });
    add(posts.geo(), mat.mullion, { cast: false, name: 'stepMullions' }).userData.noAO = true;
    const rz = add(riser.geo(), mat.glass, { cast: false, name: 'stepGlazing' }); rz.renderOrder = 2;
    const sz = add(sail.geo(), mat.sail, { cast: false, name: 'crownGlazing' }); sz.renderOrder = 2;

    // noyau de circulations : goutte réduite, jusque sous le gradin le plus bas
    const core = new Acc(), NC = 64, NSc = 40, yC = H - DROP - FLOOR;
    for (let j = 0; j <= NSc; j++) {
      const s = (HP + (yC - HP) * j / NSc) / H;
      centre(s, C);
      for (let i = 0; i <= NC; i++) { towerPoint(s, i / NC, 0, 0, P); core.v(C.x + (P.x - C.x) * 0.3, s * H, C.z + (P.z - C.z) * 0.3, i / NC * 30, s * H); }
    }
    for (let j = 0; j < NSc; j++) for (let i = 0; i < NC; i++) { const a = j * (NC + 1) + i; core.quad(a, a + 1, a + NC + 2, a + NC + 1); }
    add(core.geo(), mat.core, { name: 'core' });
  }

  // ---------- terrasses de la faille : platelage, jardinières, garde-corps vitrés, arbres ----------
  {
    const railGeo = new Acc(), planterAcc = new Acc(), soilAcc = new Acc(), deckAcc = new Acc(), soff = new Acc();
    ys.forEach((y, k) => {
      const s = y / H;
      if (k === 0 || grooveDepth(s) < 0.8) return;
      const c = grooveC(s), span = 2 * (GROOVE_W - 0.006);
      const n = Math.max(3, Math.round(PERIM * prof(s) * span / 1.4));
      for (let i = 0; i < n; i++) {
        const u0 = c - span / 2 + (span * i) / n, u1 = c - span / 2 + (span * (i + 1)) / n;
        if (y + FLOOR > roofYw((u0 + u1) / 2) - 0.05) continue;     // à ciel ouvert : traité en toiture
        // jardinière en rive : de 0,15 à 1,55 m de la peau, 0,7 m de haut
        const pts = [];
        for (const [u, ins] of [[u0, 0.15], [u1, 0.15], [u1, 2.4], [u0, 2.4]]) { towerPoint(s, u, ins, 0, P); pts.push([P.x, P.z]); }
        const yT = y + 0.72;
        const b = planterAcc.p.length / 3;
        for (const [x, z] of pts) planterAcc.v(x, y + 0.02, z, x + z, 0);
        for (const [x, z] of pts) planterAcc.v(x, yT, z, x + z, 0.7);
        for (let e = 0; e < 4; e++) { const a = b + e, a2 = b + (e + 1) % 4; planterAcc.quad(a, a2, a2 + 4, a + 4); }
        const t0 = soilAcc.p.length / 3;
        for (const [x, z] of pts) soilAcc.v(x, yT - 0.06, z, x, -z);
        soilAcc.i.push(t0, t0 + 2, t0 + 1, t0, t0 + 3, t0 + 2);
        // garde-corps vitré à l'aplomb de la rive (1,1 m au-dessus du platelage)
        const r0 = railGeo.p.length / 3;
        towerPoint(s, u0, 0.08, 0, P); towerPoint(s, u1, 0.08, 0, Q);
        railGeo.v(P.x, yT, P.z, 0, 0); railGeo.v(Q.x, yT, Q.z, 1, 0); railGeo.v(Q.x, y + 1.1, Q.z, 1, 1); railGeo.v(P.x, y + 1.1, P.z, 0, 1);
        railGeo.quad(r0, r0 + 1, r0 + 2, r0 + 3);
        const cx = (pts[0][0] + pts[1][0] + pts[2][0] + pts[3][0]) / 4, cz = (pts[0][1] + pts[1][1] + pts[2][1] + pts[3][1]) / 4;
        const L = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
        const alongX = Math.abs(pts[1][0] - pts[0][0]) >= Math.abs(pts[1][1] - pts[0][1]);
        planters.push({ x: +cx.toFixed(3), y: +(yT - 0.04).toFixed(3), z: +cz.toFixed(3), w: alongX ? L : 2.1, d: alongX ? 2.1 : L, kind: 'roof', trailSkip: 0.1, trailLen: 2.6 });   // retombantes longues sur la rive
        // platelage bois, entre la jardinière et le vitrage du fond
        const d0 = deckAcc.p.length / 3;
        for (const [u, ins, gr] of [[u0, 2.4, 0], [u1, 2.4, 0], [u1, 0.05, 1], [u0, 0.05, 1]]) { towerPoint(s, u, ins, gr, P); deckAcc.v(P.x, y + 0.06, P.z, P.x, -P.z); }
        deckAcc.i.push(d0, d0 + 2, d0 + 1, d0, d0 + 3, d0 + 2);
        // sous-face de la dalle du dessus, spots encastrés
        const f0 = soff.p.length / 3;
        for (const [u, ins, gr] of [[u0, 0.3, 0], [u1, 0.3, 0], [u1, 0.05, 1], [u0, 0.05, 1]]) { towerPoint(s, u, ins, gr, P); soff.v(P.x, y + FLOOR - 0.37, P.z, P.x, -P.z); }
        soff.i.push(f0, f0 + 1, f0 + 2, f0, f0 + 2, f0 + 3);
      }
      // petits arbres en pleine terre des jardinières, deux par étage en quinconce
      for (const du of k % 2 ? [-0.4, 0, 0.38] : [-0.2, 0.18]) {
        const ut = c + (du + (rnd() - 0.5) * 0.08) * span;
        if (y + FLOOR > roofYw(ut) - 0.05) continue;
        towerPoint(s, ut, 1.3, 0, P);
        trees.push([rnd() < 0.6 ? 'young' : 'birch', +P.x.toFixed(2), +P.z.toFixed(2), +(2.7 + rnd() * 0.5).toFixed(2), +(y + 0.68).toFixed(2)]);
      }
    });
    add(planterAcc.geo(), mat.planter, { name: 'terracePlanters' });
    add(soilAcc.geo(), mat.soil, { cast: false, name: 'terraceSoil' });
    add(deckAcc.geo(), mat.deck, { cast: false, name: 'terraceDecks' });
    add(soff.geo(), mat.soffit, { cast: false, name: 'terraceSoffits' });
    const rm = add(railGeo.geo(), mat.rail, { cast: false, name: 'terraceRails' }); rm.renderOrder = 3;
  }

  // ---------- socle : façades de verre pliées, plateaux éclairés, toiture-jardin ----------
  const plan = podiumPlan();
  let roofPoly;
  {
    const ring = resample(plan, 9);
    if (ring.length % 2) ring.push(ring.shift());                  // nombre pair : plis alternés réguliers
    const n = ring.length, mt = miters(ring);
    // déport vers l'extérieur aux trois rangs (sol, mi-hauteur, toit), sommets pairs / impairs : plis en losange
    const ROWS = [[0, 0.4, 0.4], [HP * 0.5, 2.8, 0.2], [HP, 1.6, 1.6]];
    const dOff = (i, y) => { const k = 1 + (i % 2); let a = ROWS[0], b = ROWS[1]; if (y > ROWS[1][0]) { a = ROWS[1]; b = ROWS[2]; } const t = (y - a[0]) / (b[0] - a[0]); return a[k] + (b[k] - a[k]) * t; };
    const off = (i, y) => { const d = dOff(i, y); return [ring[i][0] + mt[i][0] * d, ring[i][1] + mt[i][1] * d]; };
    const at = (y, extra = 0) => ring.map((_, i) => { const p = off(i, y); return [p[0] + mt[i][0] * extra, p[1] + mt[i][1] * extra]; });
    // façade : chaque pan est plié en deux triangles, diagonales alternées
    const fac = [], fuv = [];
    let dist = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, L = Math.hypot(ring[j][0] - ring[i][0], ring[j][1] - ring[i][1]);
      for (let r = 0; r < 2; r++) {
        const ya = ROWS[r][0], yb = ROWS[r + 1][0], b0 = off(i, ya), b1 = off(j, ya), t0 = off(i, yb), t1 = off(j, yb);
        const V = { b0: [b0[0], ya, b0[1], dist, ya / FP], b1: [b1[0], ya, b1[1], dist + L, ya / FP], t0: [t0[0], yb, t0[1], dist, yb / FP], t1: [t1[0], yb, t1[1], dist + L, yb / FP] };
        const tris = (i + r) % 2 ? [['b0', 'b1', 't1'], ['b0', 't1', 't0']] : [['b0', 'b1', 't0'], ['b1', 't1', 't0']];
        for (const tr of tris) for (const key of tr) { const v = V[key]; fac.push(v[0], v[1], v[2]); fuv.push(v[3] / 1.6, v[4]); }
      }
      dist += L;
    }
    // orientation : normales vers l'extérieur
    if (area2(ring) > 0) for (let i = 0; i < fac.length; i += 9) for (let c = 0; c < 3; c++) { const t = fac[i + 3 + c]; fac[i + 3 + c] = fac[i + 6 + c]; fac[i + 6 + c] = t; }
    if (area2(ring) > 0) for (let i = 0; i < fuv.length; i += 6) for (let c = 0; c < 2; c++) { const t = fuv[i + 2 + c]; fuv[i + 2 + c] = fuv[i + 4 + c]; fuv[i + 4 + c] = t; }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(fac, 3)); fg.setAttribute('uv', new THREE.Float32BufferAttribute(fuv, 2)); fg.computeVertexNormals();
    const fm = add(fg, mat.podGlass, { cast: false, name: 'podiumFacade' }); fm.renderOrder = 2;
    // arêtes des plis : montants métalliques
    const ribs = new Acc();
    for (let i = 0; i < n; i++) {
      const m = mt[i], tx = -m[1] * 0.05, tz = m[0] * 0.05;
      for (let r = 0; r < 2; r++) {
        const ya = ROWS[r][0], yb = ROWS[r + 1][0], b = off(i, ya), t = off(i, yb), o = ribs.p.length / 3;
        ribs.v(b[0] - tx + m[0] * 0.05, ya, b[1] - tz + m[1] * 0.05, 0, ya); ribs.v(b[0] + tx + m[0] * 0.05, ya, b[1] + tz + m[1] * 0.05, 0.1, ya);
        ribs.v(t[0] + tx + m[0] * 0.05, yb, t[1] + tz + m[1] * 0.05, 0.1, yb); ribs.v(t[0] - tx + m[0] * 0.05, yb, t[1] - tz + m[1] * 0.05, 0, yb);
        for (let q = 0; q < 4; q++) ribs.v(ribs.p[(o + q) * 3], ribs.p[(o + q) * 3 + 1], ribs.p[(o + q) * 3 + 2], 0, 0);
        ribs.quad(o, o + 1, o + 2, o + 3); ribs.quad(o + 4, o + 7, o + 6, o + 5);
      }
    }
    add(ribs.geo(), mat.mullion, { name: 'podiumRibs' });
    // plateaux et plafonds éclairés (le trou de la tour n'est pas utile : ses étages commencent au toit du socle)
    for (let j = 0; j < NP; j++) {
      const y = j * FP;
      add(flat(at(y + 0.02, -0.45), y + 0.02), j ? mat.floor : mat.paver, { name: 'podiumFloor' });
      if (j) add(flat(at(y - 0.36, -0.5), y - 0.36, false), [mat.ceiling, mat.ceilDim, mat.ceiling, mat.ceilOff, mat.ceiling, mat.ceilDim][j - 1], { cast: false, name: 'podiumCeiling' });
    }
    add(flat(at(HP - 0.36, -0.5), HP - 0.36, false), mat.ceiling, { cast: false, name: 'podiumCeiling' });
    // toiture : dalle pavée percée par la tour, bac planté, garde-corps et couvertine
    roofPoly = at(HP, -0.05);
    const towerHole = []; for (let i = 0; i < 120; i++) { towerPoint(SP, i / 120, 0.05, 0, P); towerHole.push([P.x, P.z]); }
    add(flat(roofPoly, HP, true, [towerHole]), mat.paver, { cast: false, name: 'podiumRoof' });
    const edge = new Acc(); wall(edge, roofPoly, HP - 0.4, HP + 0.02); add(edge.geo(), mat.slabEdge, { name: 'podiumRoofEdge' });
    const bed = offsetPoly(resample(plan, 3), -1.2), bedHole = []; for (let i = 0; i < 120; i++) { towerPoint(SP, i / 120, -3, 0, P); bedHole.push([P.x, P.z]); }
    const yB = HP + 0.45;
    add(flat(bed, yB, true, [bedHole]), mat.soil, { cast: false, name: 'podiumBedSoil' });
    const bw = new Acc(); wall(bw, bed, HP, yB + 0.05); wall(bw, bedHole, HP, yB + 0.05); add(bw.geo(), mat.mullion, { name: 'podiumBedWalls' });
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const [x, z] of bed) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    planters.push({ kind: 'greenroof', x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, y: yB, poly: bed, hole: bedHole, lush: 0.14 });
    const rail = new Acc(); wall(rail, at(HP, -0.25), HP + 0.02, HP + 1.1);
    const rr = add(rail.geo(), mat.rail, { cast: false, name: 'podiumRail' }); rr.renderOrder = 3;
    const cop = new Acc(), outer = at(HP, 0.06), inner = at(HP, -0.3);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, b = cop.p.length / 3;
      cop.v(outer[i][0], HP + 0.08, outer[i][1], 0, 0); cop.v(outer[j][0], HP + 0.08, outer[j][1], 1, 0); cop.v(inner[j][0], HP + 0.08, inner[j][1], 1, 1); cop.v(inner[i][0], HP + 0.08, inner[i][1], 0, 1);
      cop.quad(b, b + 3, b + 2, b + 1);
    }
    add(cop.geo(), mat.mullion, { name: 'podiumCoping' });
    const pled = new Acc(); wall(pled, at(HP, 0.07), HP - 0.12, HP - 0.02); add(pled.geo(), mat.lamp, { cast: false, name: 'podiumLed' }).userData.noAO = true;
    // entrée principale côté parvis sud : auvent en porte-à-faux éclairé, portes
    {
      const base = at(0); let e = 0; base.forEach(([x, z], i) => { if (z - Math.abs(x) * 0.3 > base[e][1] - Math.abs(base[e][0]) * 0.3) e = i; });
      const [ex, ez] = base[e], m = mt[e], tx = -m[1], tz = m[0];
      const cv = new Acc(); box(cv, ex + m[0] * 3, ez + m[1] * 3, tx, tz, 18, 7.5, 5.0, 5.45); add(cv.geo(), mat.slabEdge, { name: 'entranceCanopy' });
      const lit = new Acc(); box(lit, ex + m[0] * 3, ez + m[1] * 3, tx, tz, 16, 6, 4.98, 5.0); add(lit.geo(), mat.ceiling, { cast: false, name: 'entranceSoffit' });
      // portes : quatre cadres métalliques sous l'auvent
      const fr = new Acc(); for (const k of [-3, -1, 1, 3]) box(fr, ex + m[0] * 0.5 + tx * k * 1.2, ez + m[1] * 0.5 + tz * k * 1.2, tx, tz, 2.2, 0.12, 0.04, 2.9);
      add(fr.geo(), mat.spandrel, { name: 'entranceDoors' });
    }
    // arbres de la toiture du socle, à distance des bords du bac et de la tour
    const pts = [];
    for (let tries = 0; pts.length < 30 && tries < 6000; tries++) {
      const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0);
      if (!inPoly(x, z, bed) || inPoly(x, z, bedHole) || segDist(x, z, bed) < 2 || segDist(x, z, bedHole) < 2) continue;
      if (pts.some(([px, pz]) => (px - x) ** 2 + (pz - z) ** 2 < 30)) continue;
      pts.push([x, z]);
    }
    const sp = ['hornbeam', 'birch', 'young', 'linden'];
    pts.forEach(([x, z], k) => trees.push([sp[k % sp.length], +x.toFixed(2), +z.toFixed(2), +(4 + rnd() * 4).toFixed(2), yB]));
  }

  // ---------- parvis : dallage autour du socle, bordure, arbres d'alignement ----------
  const plazaPoly = offsetPoly(resample(plan, 2), 13);
  {
    add(flat(plazaPoly, 0.04), mat.paver, { cast: false, name: 'plaza' });
    const curb = new Acc(), out = offsetPoly(resample(plan, 2), 13.25);
    for (let i = 0; i < plazaPoly.length; i++) {
      const j = (i + 1) % plazaPoly.length, b = curb.p.length / 3;
      curb.v(plazaPoly[i][0], 0.1, plazaPoly[i][1], i * 2, 0); curb.v(plazaPoly[j][0], 0.1, plazaPoly[j][1], i * 2 + 2, 0); curb.v(out[j][0], 0.1, out[j][1], i * 2 + 2, 0.25); curb.v(out[i][0], 0.1, out[i][1], i * 2, 0.25);
      curb.quad(b, b + 3, b + 2, b + 1);
    }
    add(curb.geo(), mat.curb, { cast: false, name: 'plazaCurb' });
    const line = offsetPoly(resample(plan, 1), 8.5), species = ['linden', 'oak', 'ash', 'hornbeam'];
    let acc = 0, next = 6, k = 0;
    for (let i = 0; i < line.length; i++) {
      const a = line[i], b = line[(i + 1) % line.length]; acc += Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (acc < next) continue;
      next = acc + 13 + rnd() * 3;
      trees.push([species[k++ % species.length], +a[0].toFixed(2), +a[1].toFixed(2), +(8.5 + rnd() * 3).toFixed(2)]);
    }
    // massifs plantés bas et bancs bois le long de l'alignement, sauf devant l'entrée sud
    const beds = new Acc(), seats = new Acc(), seatBase = new Acc(), mid = offsetPoly(resample(plan, 1), 8.5);
    let run = 0, nextB = 9;
    for (let i = 0; i < mid.length; i++) {
      const a = mid[i], b = mid[(i + 1) % mid.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); run += L;
      if (run < nextB || L < 1e-3) continue;
      nextB = run + 14.5;
      if (a[1] > 30 && Math.abs(a[0]) < 22) continue;                       // dégagement devant l'entrée
      const tx = b[0] - a[0], tz = b[1] - a[1], n = Math.hypot(tx, tz), ux = tx / n, uz = tz / n;
      const cx = a[0] + ux * 6.5, cz = a[1] + uz * 6.5;
      if (!inPoly(cx, cz, plazaPoly) || inPoly(cx, cz, offsetPoly(plan, 2))) continue;
      box(beds, cx, cz, ux, uz, 7.5, 2.2, 0.04, 0.45);
      const bp = [[-3.6, -1], [3.6, -1], [3.6, 1], [-3.6, 1]].map(([l, w]) => [cx + ux * l - uz * w, cz + uz * l + ux * w]);
      planters.push({ kind: 'greenroof', x: cx, z: cz, w: 8, d: 8, y: 0.42, poly: bp, lush: 0.2 });
      // banc adossé au massif, côté socle
      const sx = cx + uz * 1.75, sz = cz - ux * 1.75;
      box(seatBase, sx, sz, ux, uz, 4.2, 0.45, 0.04, 0.38); box(seats, sx, sz, ux, uz, 4.4, 0.6, 0.38, 0.46);
    }
    add(beds.geo(), mat.planter, { name: 'plazaBeds' });
    add(seatBase.geo(), mat.curb, { name: 'benchBase' });
    add(seats.geo(), mat.deck, { name: 'benchSeat' });
    // bornes lumineuses au bord du parvis, tous les 7 m environ
    const posts = new Acc(), caps = new Acc(), edgeL = offsetPoly(resample(plan, 1), 11.3);
    let runL = 0, nextL = 3;
    for (let i = 0; i < edgeL.length; i++) {
      const a = edgeL[i], b = edgeL[(i + 1) % edgeL.length]; runL += Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (runL < nextL) continue; nextL = runL + 7;
      box(posts, a[0], a[1], b[0] - a[0], b[1] - a[1], 0.16, 0.16, 0.04, 0.8); box(caps, a[0], a[1], b[0] - a[0], b[1] - a[1], 0.17, 0.17, 0.8, 0.95);
    }
    add(posts.geo(), mat.spandrel, { name: 'bollards' });
    add(caps.geo(), mat.lamp, { cast: false, name: 'bollardLamps' });
  }

  // ---------- métadonnées pour viewer.js et landscape.js ----------
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  const grow = (x, z) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); };
  for (let j = 0; j <= 40; j++) for (let i = 0; i < 64; i++) { towerPoint(SP + (1 - SP) * j / 40, i / 64, 0, 0, P); grow(P.x, P.z); }
  for (const [x, z] of roofPoly) grow(x, z);
  const pcx = (minX + maxX) / 2, pcz = (minZ + maxZ) / 2; let pr = 0;
  for (const [x, z] of plazaPoly) pr = Math.max(pr, Math.hypot(x - pcx, z - pcz));
  group.userData = {
    // appelé par viewer.js à chaque changement d'heure : les bureaux s'allument au crépuscule
    // le soir, le reflet du ciel s'efface derrière les plateaux éclairés : verre moins couvrant, vraie profondeur
    onLight: (dusk, night) => { const k = Math.max(0, dusk - 0.35) / 0.65; mat.glass.opacity = 0.97 - 0.1 * k - 0.25 * night; mat.podGlass.opacity = 0.86 - 0.08 * k - 0.2 * night;
      const g = 1 + 0.6 * k + 1.3 * night;
      mat.ceiling.emissiveIntensity = 1.6 * g; mat.ceilDim.emissiveIntensity = 0.35 * g; mat.floor.emissiveIntensity = 0.03 * k + 0.1 * night;
      mat.soffit.emissiveIntensity = 1.2 * k + 1.6 * night; mat.lamp.emissiveIntensity = 2 * k + 3 * night; mat.sail.emissiveIntensity = 0.12 * k + 0.35 * night;   // pointe éclairée de l'intérieur   // rebond de la lumière sur les sols
    },
    site: 'tour', plazaR: pr, plazaC: [pcx, pcz], trees, planters,
    bounds: { minX, maxX, minZ, maxZ, height: H, socleMaxZ: maxZ },
    levels: [
      { key: 0, name: 'Socle', y0: 0, y1: HP },
      { key: 1, name: 'Étage 15', y0: HP + 7 * FLOOR, y1: HP + 8 * FLOOR },
      { key: 2, name: 'Étage 25', y0: HP + 17 * FLOOR, y1: HP + 18 * FLOOR },
      { key: 3, name: 'Étage 35', y0: HP + 27 * FLOOR, y1: HP + 28 * FLOOR },
      { key: 4, name: 'Sommet', y0: H - DROP, y1: H },
    ],
  };
  return group;
}
