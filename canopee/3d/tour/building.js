// Canopée — maquette 02 : la tour (module bâtiment de viewer.js, voir tour/index.html)
// Flèche de verre de 150 m et 40 étages, à section en amande vrillée sur elle-même, creusée d'un sillon planté qui
// s'enroule de la rue jusqu'au sommet. Mur-rideau (verre de la résidence, montants et nez de dalle métalliques),
// plateaux de bureaux visibles derrière le verre, terrasses du sillon avec jardinières et garde-corps vitrés,
// parvis pavé. Les plantes des jardinières et les arbres du parvis sont posés par landscape.js (userData).

export const H = 150;            // hauteur hors tout (m)
export const FLOOR = 3.6;        // hauteur d'étage
export const FLOORS = 40;
const A = 19.5, B = 11;          // demi-longueur et demi-largeur de la section à la base
const TWIST = 3.4;               // vrille totale de la section (rad)
const TURNS = 0.62;              // tours du sillon autour de la section, en plus de la vrille
const GROOVE_W = 0.085;          // demi-largeur du sillon (fraction du pourtour)
const GROOVE_D = 3.4;            // profondeur des terrasses (m)
const PLAZA_R = 46;              // rayon du parvis

const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ---------- forme ----------
// échelle de la section selon la hauteur s ∈ [0,1] : léger renflement puis effilement en pointe
export const prof = (s) => (1 + 0.08 * Math.sin(Math.PI * Math.min(1, s * 1.2))) * (1 - Math.pow(s, 4.5)) * (1 - 0.18 * s);
const twist = (s) => TWIST * s;
export const grooveC = (s) => 0.18 + TURNS * s;                    // centre du sillon sur le pourtour (en tours)
const grooveDepth = (s) => GROOVE_D * smooth(0.985, 0.9, s);       // le sillon s'éteint sous la pointe
const cdist = (u, c) => { const d = Math.abs(((u - c) % 1 + 1) % 1); return Math.min(d, 1 - d); };
const grooveW = (u, s) => 1 - smooth(GROOVE_W - 0.012, GROOVE_W + 0.002, cdist(u, grooveC(s)));
const TOP_FLOOR_S = 0.93;                                          // dernier plateau ; au-dessus, la pointe vitrée

const tmpS = { x: 0, z: 0, nx: 0, nz: 0 };
function section(s, u) {
  const t = u * Math.PI * 2, k = prof(s), a = A * k, b = B * k;
  const st = Math.sin(t), ct = Math.cos(t), as = Math.abs(st);
  const x = a * ct, z = b * Math.sign(st) * Math.pow(as, 1.45);
  const dx = -a * st, dz = b * 1.45 * Math.pow(Math.max(as, 1e-4), 0.45) * ct;
  const l = Math.hypot(dx, dz) || 1;
  tmpS.x = x; tmpS.z = z; tmpS.nx = dz / l; tmpS.nz = -dx / l;
  return tmpS;
}
// point monde de la paroi : `inset` m vers l'intérieur ; groove = 1 suit le fond du sillon, 0 la peau extérieure
export function towerPoint(s, u, inset, groove, out) {
  const p = section(s, u);
  const d = grooveDepth(s) * grooveW(u, s) * groove + inset;
  const x = p.x - p.nx * d, z = p.z - p.nz * d;
  const th = twist(s), c = Math.cos(th), sn = Math.sin(th);
  out.x = x * c - z * sn; out.y = s * H; out.z = x * sn + z * c;
  return out;
}
const inGroove = (u, s) => grooveDepth(s) > 0.4 && grooveW(u, s) > 0.5;

export function createBuilding(THREE, M) {
  const group = new THREE.Group();
  group.name = 'tour';
  const V = () => new THREE.Vector3();
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
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; for (const y of [60, 188]) g.fillRect(20, y, 216, 8);
  });
  ceilTex.repeat.set(1 / 4.8, 1 / 4.8); ceilEm.repeat.copy(ceilTex.repeat);
  const mat = {
    // verre de façade à couche argentée (« silvertine ») : reflet fort, intérieur à peine perceptible
    glass: new THREE.MeshPhysicalMaterial({ name: 'towerGlass', color: 0x7f8f9f, metalness: 0.62, roughness: 0.045, envMapIntensity: 1.25,
      clearcoat: 1, clearcoatRoughness: 0.02, transparent: true, opacity: 0.86 }),
    mullion: new THREE.MeshStandardMaterial({ name: 'towerMullion', color: 0xb9c0c8, metalness: 0.85, roughness: 0.3 }),
    spandrel: new THREE.MeshStandardMaterial({ name: 'towerSpandrel', color: 0x3c444c, metalness: 0.6, roughness: 0.38 }),
    slabEdge: M.slabWhite,
    floor: new THREE.MeshStandardMaterial({ name: 'towerFloor', color: 0x8d867c, roughness: 0.85 }),
    ceiling: new THREE.MeshStandardMaterial({ name: 'towerCeiling', map: ceilTex, emissiveMap: ceilEm, emissive: 0xfff2dc, emissiveIntensity: 1.6, roughness: 0.9 }),
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
  const P = { x: 0, y: 0, z: 0 }, Q = { x: 0, y: 0, z: 0 };

  // ---------- mur-rideau : peau extérieure et vitrage du fond des terrasses ----------
  {
    const NU = 320, NS = 400, skin = new Acc(), back = new Acc();
    const idx = [];
    for (let j = 0; j <= NS; j++) {
      const s = j / NS;
      for (let i = 0; i <= NU; i++) {
        towerPoint(s, i / NU, 0, 1, P);
        idx.push([skin.v(P.x, P.y, P.z, i / NU, s), back.v(P.x, P.y, P.z, i / NU, s)]);
      }
    }
    for (let j = 0; j < NS; j++) {
      const s = (j + 0.5) / NS;
      for (let i = 0; i < NU; i++) {
        const a = j * (NU + 1) + i, b = a + 1, c = a + NU + 1, d = c + 1;
        const k = inGroove((i + 0.5) / NU, s) ? 1 : 0, A_ = k ? back : skin;
        A_.quad(idx[a][k], idx[c][k], idx[d][k], idx[b][k]);
      }
    }
    const g1 = skin.geo(), g2 = back.geo();
    const m1 = add(g1, mat.glass, { cast: false, name: 'curtainWall' }), m2 = add(g2, mat.glass, { cast: false, name: 'terraceGlazing' });
    m1.renderOrder = m2.renderOrder = 2;
  }

  // ---------- montants verticaux (pas ≈ 1,5 m) et nez de dalle ----------
  {
    const fins = new Acc(), NMU = 80, NS = 300, sTop = 0.965;
    for (let m = 0; m < NMU; m++) {
      const u = (m + 0.5) / NMU;
      // segments continus hors du sillon
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
        const s = (j / NS) * sTop;
        const k = prof(s), du = 0.035 / (Math.PI * (A + B) * k + 1e-3);   // ≈ 7 cm de large
        if (inGroove(u, s) || grooveW(u, s) > 0.05 && grooveDepth(s) > 0.4) { flush(); continue; }
        run.push([s, du]);
      }
      flush();
    }
    add(fins.geo(), mat.mullion, { name: 'mullions' });

    // nez de dalle : bandeau de 22 cm en saillie de 6 cm, et allège opaque derrière le verre
    const caps = new Acc(), spand = new Acc(), NU = 320;
    for (let f = 1; f <= FLOORS; f++) {
      const y = f * FLOOR, s = y / H;
      if (s > TOP_FLOOR_S) break;
      const ring = (acc, y0, y1, ins0, ins1, groove) => {
        const base = acc.p.length / 3;
        for (let i = 0; i <= NU; i++) {
          const u = i / NU;
          towerPoint(y0 / H, u, ins0, groove, P); acc.v(P.x, y0, P.z, u * 100, 0);
          towerPoint(y1 / H, u, ins1, groove, Q); acc.v(Q.x, y1, Q.z, u * 100, 1);
        }
        for (let i = 0; i < NU; i++) {
          const u = (i + 0.5) / NU;
          if (!groove && grooveW(u, s) > 0.02 && grooveDepth(s) > 0.4) continue;   // pas de bandeau dans le sillon
          const a = base + i * 2; acc.quad(a, a + 2, a + 3, a + 1);
        }
      };
      ring(caps, y - 0.14, y + 0.08, -0.06, -0.06, 0);
      ring(spand, y - 0.4, y + 0.55, 0.14, 0.14, 1);
    }
    add(caps.geo(), mat.mullion, { name: 'slabNoses' });
    add(spand.geo(), mat.spandrel, { cast: false, name: 'spandrels' });
  }

  // ---------- plateaux : dalles, plafonds éclairés, noyau ----------
  const planters = [], railGeo = new Acc(), planterAcc = new Acc(), soilAcc = new Acc(), deckAcc = new Acc();
  {
    const floorAcc = new Acc(), ceilAcc = new Acc(), edgeAcc = new Acc(), NU = 160;
    const contour = (s, ins, groove) => { const pts = []; for (let i = 0; i < NU; i++) { towerPoint(s, i / NU, ins, groove, P); pts.push([P.x, P.z]); } return pts; };
    const fan = (acc, pts, y, up) => {
      // plateau convexe (section en amande) : éventail depuis le centre
      let cx = 0, cz = 0; for (const [x, z] of pts) { cx += x; cz += z; } cx /= pts.length; cz /= pts.length;
      const c = acc.v(cx, y, cz, cx, -cz), base = acc.p.length / 3;
      for (const [x, z] of pts) acc.v(x, y, z, x, -z);
      for (let i = 0; i < pts.length; i++) { const a = base + i, b = base + (i + 1) % pts.length; if (up) acc.i.push(c, b, a); else acc.i.push(c, a, b); }
    };
    for (let f = 0; f <= FLOORS; f++) {
      const y = f * FLOOR, s = y / H;
      if (s > TOP_FLOOR_S) break;
      const outer = contour(s, 0.12, 0);                      // dalle jusqu'à la peau (terrasses comprises)
      fan(floorAcc, outer, y + 0.02, true);
      if (f > 0) {
        const inner = contour(s, 0.6, 1);                     // plafond de l'étage du dessous, derrière le vitrage
        fan(ceilAcc, inner, y - 0.36, false);
        // tranche de la dalle
        const base = edgeAcc.p.length / 3;
        for (const [x, z] of outer) { edgeAcc.v(x, y + 0.02, z, 0, 0); edgeAcc.v(x, y - 0.34, z, 0, 1); }
        for (let i = 0; i < outer.length; i++) { const a = base + i * 2, b = base + ((i + 1) % outer.length) * 2; edgeAcc.quad(a, b, b + 1, a + 1); }
        // sous-face hors plafond (terrasses) : dalle blanche
        fan(edgeAcc, outer, y - 0.34, false);
      }
    }
    add(floorAcc.geo(), mat.floor, { name: 'floors' });
    add(ceilAcc.geo(), mat.ceiling, { cast: false, name: 'ceilings' });
    add(edgeAcc.geo(), mat.slabEdge, { name: 'slabs' });

    // noyau de circulations : amande réduite
    const core = new Acc(), NC = 64, NSc = 60, sC = TOP_FLOOR_S;
    for (let j = 0; j <= NSc; j++) {
      const s = (j / NSc) * sC;
      for (let i = 0; i <= NC; i++) {
        const p = section(s, i / NC), th = twist(s), c = Math.cos(th), sn = Math.sin(th), k = 0.34;
        core.v((p.x * c - p.z * sn) * k, s * H, (p.x * sn + p.z * c) * k, i / NC * 30, s * H);
      }
    }
    for (let j = 0; j < NSc; j++) for (let i = 0; i < NC; i++) { const a = j * (NC + 1) + i; core.quad(a, a + 1, a + NC + 2, a + NC + 1); }
    add(core.geo(), mat.core, { name: 'core' });
  }

  // ---------- terrasses du sillon : platelage, jardinières, garde-corps vitrés ----------
  {
    for (let f = 1; f <= FLOORS; f++) {
      const y = f * FLOOR, s = y / H;
      if (s > TOP_FLOOR_S || grooveDepth(s) < 0.8) continue;
      const c = grooveC(s), span = 2 * (GROOVE_W - 0.006);
      const k = prof(s), perim = Math.PI * (A + B) * k * 1.1;
      const n = Math.max(3, Math.round(perim * span / 1.4));
      const D = grooveDepth(s);
      for (let i = 0; i < n; i++) {
        const u0 = c - span / 2 + (span * i) / n, u1 = c - span / 2 + (span * (i + 1)) / n;
        // jardinière en rive : de 0,15 à 1,05 m de la peau, 0,7 m de haut
        const pts = [];
        for (const [u, ins] of [[u0, 0.15], [u1, 0.15], [u1, 1.55], [u0, 1.55]]) { towerPoint(s, u, ins, 0, P); pts.push([P.x, P.z]); }
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
        // plantation (landscape.js) : jardinière alignée sur l'axe dominant
        const cx = (pts[0][0] + pts[1][0] + pts[2][0] + pts[3][0]) / 4, cz = (pts[0][1] + pts[1][1] + pts[2][1] + pts[3][1]) / 4;
        const L = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
        const alongX = Math.abs(pts[1][0] - pts[0][0]) >= Math.abs(pts[1][1] - pts[0][1]);
        planters.push({ x: +cx.toFixed(3), y: +(yT - 0.04).toFixed(3), z: +cz.toFixed(3), w: alongX ? L : 1.3, d: alongX ? 1.3 : L, kind: 'roof' });
        // platelage bois de la terrasse, entre la jardinière et le vitrage du fond
        const d0 = deckAcc.p.length / 3;
        for (const [u, ins] of [[u0, 1.55], [u1, 1.55], [u1, D - 0.05], [u0, D - 0.05]]) { towerPoint(s, u, ins, 0, P); deckAcc.v(P.x, y + 0.06, P.z, P.x, -P.z); }
        deckAcc.i.push(d0, d0 + 2, d0 + 1, d0, d0 + 3, d0 + 2);
      }
    }
    add(planterAcc.geo(), mat.planter, { name: 'terracePlanters' });
    add(soilAcc.geo(), mat.soil, { cast: false, name: 'terraceSoil' });
    add(deckAcc.geo(), mat.deck, { cast: false, name: 'terraceDecks' });
    const rm = add(railGeo.geo(), mat.rail, { cast: false, name: 'terraceRails' }); rm.renderOrder = 3;
  }

  // ---------- parvis : dallage, bordure, bancs ----------
  const trees = [];
  {
    const disc = new THREE.CircleGeometry(PLAZA_R, 128); disc.rotateX(-Math.PI / 2); disc.translate(0, 0.04, 0);
    const uv = disc.attributes.uv, p = disc.attributes.position; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), -p.getZ(i));
    add(disc, mat.paver, { cast: false, name: 'plaza' });
    const curb = new THREE.RingGeometry(PLAZA_R, PLAZA_R + 0.25, 128); curb.rotateX(-Math.PI / 2); curb.translate(0, 0.1, 0);
    add(curb, mat.curb, { cast: false, name: 'plazaCurb' });
    // arbres en couronne sur le parvis (laissent dégagés les vues sur l'entrée)
    const species = ['linden', 'oak', 'ash', 'hornbeam'];
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + rnd() * 0.06, r = PLAZA_R - 6 + rnd() * 2;
      trees.push([species[i % species.length], +(Math.cos(a) * r).toFixed(2), +(Math.sin(a) * r).toFixed(2), +(8.5 + rnd() * 3).toFixed(2)]);
    }
  }

  // ---------- métadonnées pour viewer.js et landscape.js ----------
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (let j = 0; j <= 40; j++) for (let i = 0; i < 64; i++) { towerPoint(j / 40, i / 64, 0, 0, P); minX = Math.min(minX, P.x); maxX = Math.max(maxX, P.x); minZ = Math.min(minZ, P.z); maxZ = Math.max(maxZ, P.z); }
  group.userData = {
    site: 'tour', plazaR: PLAZA_R, trees, planters,
    bounds: { minX, maxX, minZ, maxZ, height: H, socleMaxZ: maxZ },
    levels: [
      { key: 0, name: 'Parvis', y0: 0, y1: FLOOR },
      { key: 1, name: 'Étage 10', y0: 10 * FLOOR, y1: 11 * FLOOR },
      { key: 2, name: 'Étage 20', y0: 20 * FLOOR, y1: 21 * FLOOR },
      { key: 3, name: 'Étage 30', y0: 30 * FLOOR, y1: 31 * FLOOR },
      { key: 4, name: 'Sommet', y0: 38 * FLOOR, y1: H },
    ],
  };
  return group;
}
