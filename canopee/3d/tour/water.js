// Canopée — tour/water.js
// Eau : canal du Midi (écluse Bayard), Garonne, canal de Brienne ; quais, margelles, berges, portes d'écluse.
// Contrat : buildWater(THREE, M, ctx) → THREE.Group ou null (null : city.js garde sa version simple).
// ctx = { data, T, TP, near, inKeep, keepSeg, radius, rnd, CM, farBuf } (voir createCity dans city.js).
// Le groupe porte userData.onLight(dusk, night) et userData.holes = { rings, cut(geo) } : landscape.js y découpe
// le sol (y = 0) au droit de l'eau. L'eau est sous le sol : canal −1,6 m (bief aval de l'écluse −2,9 m), Garonne −7 m.
// Rendu : matériau physique (fresnel ior 1,33, reflet du ciel scene.environment, reflets du soleil) dont la normale
// vient d'une texture de vaguelettes procédurale échantillonnée à trois échelles en mètres + plaques de vent
// (pas de répétition visible de loin) ; aucune animation (rendu à la demande).
import { mulberry32 } from '../materials.js';

const area2 = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a; };
const areaF = (P) => { let a = 0; const n = P.length / 2; for (let i = 0; i < n; i++) { const j = (i + 1) % n; a += P[2 * i] * P[2 * j + 1] - P[2 * j] * P[2 * i + 1]; } return a; };
const inRing = (x, z, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
const bbOf = (r) => { const b = [1e9, 1e9, -1e9, -1e9]; for (const [x, z] of r) { if (x < b[0]) b[0] = x; if (z < b[1]) b[1] = z; if (x > b[2]) b[2] = x; if (z > b[3]) b[3] = z; } return b; };
const bbF = (P) => { const b = [1e9, 1e9, -1e9, -1e9]; for (let i = 0; i < P.length; i += 2) { const x = P[i], z = P[i + 1]; if (x < b[0]) b[0] = x; if (z < b[1]) b[1] = z; if (x > b[2]) b[2] = x; if (z > b[3]) b[3] = z; } return b; };
const bbHit = (a, b, m = 0) => a[0] <= b[2] + m && b[0] <= a[2] + m && a[1] <= b[3] + m && b[1] <= a[3] + m;

// ---------- découpe polygonale : polygone convexe P (plat [x,z,…]) moins triangle C (sens area2 > 0) ----------
const clipHP = (P, ax, az, nx, nz, s) => {   // garde s·((p − a)·n) ≤ 0
  const out = [], n = P.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, x1 = P[2 * i], z1 = P[2 * i + 1], x2 = P[2 * j], z2 = P[2 * j + 1];
    const d1 = s * ((x1 - ax) * nx + (z1 - az) * nz), d2 = s * ((x2 - ax) * nx + (z2 - az) * nz);
    if (d1 <= 0) out.push(x1, z1);
    if ((d1 < 0 && d2 > 0) || (d1 > 0 && d2 < 0)) { const t = d1 / (d1 - d2); out.push(x1 + (x2 - x1) * t, z1 + (z2 - z1) * t); }
  }
  return out;
};
const subTri = (P, C, out) => {
  let cur = P;
  for (let e = 0; e < 3; e++) {
    const ax = C[2 * e], az = C[2 * e + 1], bx = C[(2 * e + 2) % 6], bz = C[(2 * e + 3) % 6], nx = bz - az, nz = ax - bx;   // normale extérieure
    const o = clipHP(cur, ax, az, nx, nz, -1);
    if (o.length >= 6 && Math.abs(areaF(o)) > 2e-4) out.push(o);
    cur = clipHP(cur, ax, az, nx, nz, 1);
    if (cur.length < 6) return;
  }
};
// grille d'accès aux triangles d'eau
class Grid {
  constructor(c) { this.c = c; this.m = new Map(); this.stamp = 0; }
  add(t) { const c = this.c; for (let i = Math.floor(t.bb[0] / c); i <= Math.floor(t.bb[2] / c); i++) for (let j = Math.floor(t.bb[1] / c); j <= Math.floor(t.bb[3] / c); j++) { const k = i * 65536 + j; let L = this.m.get(k); if (!L) this.m.set(k, L = []); L.push(t); } }
  query(bb, fn) {
    const c = this.c, s = ++this.stamp;
    for (let i = Math.floor(bb[0] / c); i <= Math.floor(bb[2] / c); i++) for (let j = Math.floor(bb[1] / c); j <= Math.floor(bb[3] / c); j++) {
      const L = this.m.get(i * 65536 + j); if (L) for (const t of L) if (t.s !== s) { t.s = s; if (bbHit(bb, t.bb) && fn(t) === false) return; }
    }
  }
}
const subtract = (P, grid, keep = () => true) => {
  let pcs = [P];
  grid.query(bbF(P), (t) => {
    if (!keep(t)) return;
    const np = [];
    for (const q of pcs) { if (bbHit(bbF(q), t.bb, 1e-6)) subTri(q, t.p, np); else np.push(q); }
    pcs = np; if (!pcs.length) return false;
  });
  return pcs;
};

export function buildWater(THREE, M, ctx) {
  const t0 = performance.now();
  const { data, T, near } = ctx;
  const far = data.far || null;
  // inverse de T (affine : rotation, symétrie, translation) → zones des berges en coordonnées des données
  const O = T([0, 0]), EX = T([1, 0]), EZ = T([0, 1]);
  const ia = EX[0] - O[0], ib = EZ[0] - O[0], ic = EX[1] - O[1], id = EZ[1] - O[1], det = ia * id - ib * ic;
  const Ti = (x, z) => { const X = x - O[0], Z = z - O[1]; return [(id * X - ib * Z) / det, (-ic * X + ia * Z) / det]; };

  // ---------- polygones d'eau ----------
  const polys = [];
  const take = (src, isFar) => {
    const pts = src && !Array.isArray(src[0]) ? src.p : src; if (!pts || pts.length < 3) return;
    let r = pts.map(T).filter((p, i, a) => { const q = a[(i + a.length - 1) % a.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.05; });
    if (r.length < 3 || (!isFar && !near(r))) return;
    const A = area2(r); if (Math.abs(A) < 4) return;
    if (A < 0) r.reverse();
    let per = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; per += Math.hypot(q[0] - p[0], q[1] - p[1]); }
    const holes = ((src && src.holes) || []).map((h) => { const hr = h.map(T); if (area2(hr) > 0) hr.reverse(); return hr; });
    polys.push({ r, holes, far: isFar, area: Math.abs(A) / 2, per, bb: bbOf(r) });
  };
  for (const p of data.water || []) take(p, false);
  for (const p of (far && far.water) || []) take(p, true);
  if (!polys.length) return null;
  // îlots : un polygone contenu dans un plus grand devient un trou (terre au milieu de l'eau)
  polys.sort((a, b) => a.area - b.area);
  for (let i = 0; i < polys.length; i++) {
    const P = polys[i];
    const Q = polys.slice(i + 1).find((Q) => Q.far === P.far && bbHit(P.bb, Q.bb) && P.r.every(([x, z], k) => k % Math.max(1, P.r.length >> 3) || inRing(x, z, Q.r)) && P.area < Q.area * 0.5);
    if (Q) { Q.holes.push(P.r.slice().reverse()); P.dead = true; }
  }
  const inside = (Q, x, z) => x >= Q.bb[0] && x <= Q.bb[2] && z >= Q.bb[1] && z <= Q.bb[3] && inRing(x, z, Q.r) && !Q.holes.some((h) => inRing(x, z, h));
  const live = polys.filter((p) => !p.dead);
  // îles : la Garonne d'OSM n'a pas de trous ; un espace vert entièrement dans le lit devient une île
  for (const P of live) if (2 * P.area / P.per > 45 && P.area > 15000) {
    for (const gp of [...(data.green || []), ...((far && far.green) || [])]) {
      let r = (gp.p || gp).map(T); if (r.length < 3) continue;
      const b = bbOf(r); if (!bbHit(b, P.bb) || b[0] < P.bb[0] || b[2] > P.bb[2] || b[1] < P.bb[1] || b[3] > P.bb[3]) continue;
      if (!r.every(([x, z]) => inRing(x, z, P.r) && !P.holes.some((h) => inRing(x, z, h)))) continue;
      if (P.holes.some((h) => h.some(([x, z]) => inRing(x, z, r)))) continue;
      if (area2(r) > 0) r.reverse(); P.holes.push(r);
    }
  }
  // nature : Garonne (large), sas d'écluse (petit bassin étroit du canal proche), canal
  for (const P of live) {
    const w = 2 * P.area / P.per;
    P.kind = w > 45 && P.area > 15000 ? 'river' : (!P.far && P.area < 900 && w < 12 ? 'lock' : 'canal');
    let cx = 0, cz = 0; for (const [x, z] of P.r) { cx += x; cz += z; } P.c = [cx / P.r.length, cz / P.r.length]; P.dc = Ti(P.c[0], P.c[1]);
  }
  // bassins isolés (fontaines, étangs des jardins) : pas de bief voisin → plan d'eau à −0,5 m
  for (const P of live) if (P.kind === 'canal' && P.area < 4000) {
    const r = P.r; let touch = false;
    for (let i = 0; i < r.length && !touch; i++) {
      const [ax, az] = r[i], [bx, bz] = r[(i + 1) % r.length], L = Math.hypot(bx - ax, bz - az) || 1, mx = (ax + bx) / 2 + (bz - az) / L * 1.5, mz = (az + bz) / 2 + (ax - bx) / L * 1.5;
      touch = live.some((Q) => Q !== P && inside(Q, mx, mz));
    }
    if (!touch) P.kind = 'pond';
  }
  // niveaux : écluse Bayard — le canal monte vers le sud-est (Naurouze) ; bief aval (nord-ouest, vers les
  // Ponts-Jumeaux) 1,3 m plus bas que le bief amont ; le sas est au niveau aval (porte amont fermée)
  const lock = live.find((p) => p.kind === 'lock');
  const UP = -1.6, DOWN = -2.9, RIVER = -7;
  for (const P of live) P.level = P.kind === 'river' ? RIVER : P.kind === 'pond' ? -0.5 : P.kind === 'lock' ? DOWN : lock && P.dc[1] < lock.dc[1] ? DOWN : UP;
  for (const P of live) P.prio = P.kind === 'lock' ? 0 : P.far ? 2 : 1;
  // le sas d'OSM s'arrête 1,5–2 m avant les biefs : ses extrémités sont poussées jusqu'à chevaucher l'eau voisine
  for (const P of live) if (P.kind === 'lock') {
    const r = P.r, n = r.length, E = [];
    for (let i = 0; i < n; i++) {
      const [ax, az] = r[i], [bx, bz] = r[(i + 1) % n], L = Math.hypot(bx - ax, bz - az), nx = (bz - az) / L, nz = (ax - bx) / L, mx = (ax + bx) / 2, mz = (az + bz) / 2;
      let d = 0; for (const s of [0.6, 1.2, 1.8, 2.4, 3.0]) if (live.some((Q) => Q !== P && inside(Q, mx + nx * s, mz + nz * s))) { d = s + 0.8; break; }
      E.push([nx, nz, d]);
    }
    P.r = r.map(([x, z], i) => {
      const e0 = E[(i - 1 + n) % n], e1 = E[i], d = Math.max(e0[2], e1[2]); if (!d) return [x, z];
      let mx = e0[0] * e0[2] + e1[0] * e1[2], mz = e0[1] * e0[2] + e1[1] * e1[2]; const l = Math.hypot(mx, mz) || 1;
      return [x + mx / l * d, z + mz / l * d];
    });
    P.bb = bbOf(P.r);
  }
  live.sort((a, b) => a.prio - b.prio || b.area - a.area);

  // ---------- triangulation ----------
  const gAll = new Grid(24), gDone = new Grid(24);
  for (const P of live) {
    const V = (r) => r.map(([x, z]) => new THREE.Vector2(x, z));
    const flat = [...P.r, ...P.holes.flat()];
    const tri = THREE.ShapeUtils.triangulateShape(V(P.r), P.holes.map(V));
    P.tris = [];
    for (const [a, b, c] of tri) {
      let p = [flat[a][0], flat[a][1], flat[b][0], flat[b][1], flat[c][0], flat[c][1]];
      const A = areaF(p); if (Math.abs(A) < 1e-6) continue;
      if (A < 0) p = [p[0], p[1], p[4], p[5], p[2], p[3]];
      const t = { p, bb: bbF(p), P, s: 0 }; P.tris.push(t); gAll.add(t);
    }
  }

  // ---------- matériaux ----------
  const r0 = mulberry32(4242);
  // vaguelettes : champ de hauteur périodique (vecteurs d'onde entiers → tuilable), normale analytique en RG,
  // plaques de vent (bruit très lent, périodique) en B
  const ripple = (() => {
    const S = 256, d = new Uint8Array(S * S * 4), W = [], Pw = [];
    for (let k = 0; k < 44; k++) {
      const f = 1 + Math.floor(Math.pow(r0(), 1.4) * 18), a = r0() * Math.PI * 2, kx = Math.round(f * Math.cos(a)), ky = Math.round(f * Math.sin(a) * 0.8);
      if (!kx && !ky) continue; W.push(kx, ky, Math.pow(Math.hypot(kx, ky), -2.0), r0() * Math.PI * 2);
    }
    for (let k = 0; k < 10; k++) { const kx = Math.floor(r0() * 7) - 3, ky = Math.floor(r0() * 7) - 3; if (kx || ky) Pw.push(kx, ky, 1 / Math.hypot(kx, ky), r0() * 6.283); }
    const gx = new Float32Array(S * S), gy = new Float32Array(S * S), pn = new Float32Array(S * S); let rms = 0, pmin = 1e9, pmax = -1e9;
    const TAU = Math.PI * 2;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S; let sx = 0, sy = 0, pp = 0;
      for (let k = 0; k < W.length; k += 4) { const c = W[k + 2] * Math.cos(TAU * (W[k] * u + W[k + 1] * v) + W[k + 3]); sx += c * W[k]; sy += c * W[k + 1]; }
      for (let k = 0; k < Pw.length; k += 4) pp += Pw[k + 2] * Math.sin(TAU * (Pw[k] * u + Pw[k + 1] * v) + Pw[k + 3]);
      const i = y * S + x; gx[i] = sx; gy[i] = sy; pn[i] = pp; rms += sx * sx + sy * sy; if (pp < pmin) pmin = pp; if (pp > pmax) pmax = pp;
    }
    const k = 0.55 / Math.sqrt(rms / (S * S));
    for (let i = 0; i < S * S; i++) {
      const nx = -gx[i] * k, ny = -gy[i] * k, l = Math.hypot(nx, ny, 1);
      d[4 * i] = (nx / l * 0.5 + 0.5) * 255; d[4 * i + 1] = (ny / l * 0.5 + 0.5) * 255; d[4 * i + 2] = (pn[i] - pmin) / (pmax - pmin) * 255; d[4 * i + 3] = 255;
    }
    const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 8; t.needsUpdate = true;
    return t;
  })();
  const waterMat = (name, o) => {
    const m = new THREE.MeshPhysicalMaterial({ name, color: o.color, roughness: o.rough, metalness: 0, ior: 1.333, specularIntensity: 1, envMapIntensity: 1, normalMap: ripple });
    const U = { uS: { value: new THREE.Vector3(...o.scales) }, uStr: { value: o.str }, uRoughFar: { value: o.roughFar }, uPatch: { value: o.patch }, uHor: { value: new THREE.Vector2(...o.hor) }, uBank: { value: o.bank } };
    m.userData.u = U; m.userData.base = new THREE.Color(o.color);
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.fragmentShader = 'uniform vec3 uS;\nuniform vec2 uHor;\nuniform float uStr, uRoughFar, uPatch, uBank;\n' + sh.fragmentShader
        .replace('#include <roughnessmap_fragment>', `
          vec2 wp = vNormalMapUv; float wDist = length( vViewPosition );
          float wPatch = texture2D( normalMap, wp / 173.0 + vec2( 0.37, 0.11 ) ).b * 0.65 + texture2D( normalMap, wp / 61.0 + vec2( 0.7, 0.4 ) ).b * 0.35;
          float wK = mix( 1.0 - uPatch, 1.0 + uPatch, smoothstep( 0.3, 0.72, wPatch ) );   // plaques de vent : eau lisse / ridée
          diffuseColor.rgb *= mix( 0.9, 1.08, wPatch );
          float roughnessFactor = mix( roughness, uRoughFar, smoothstep( 15.0, 450.0, wDist ) ) * mix( 0.6, 1.25, wK - 0.5 );`)
        .replace('#include <normal_fragment_maps>', `
          vec2 wg = ( texture2D( normalMap, wp / uS.x ).xy * 2.0 - 1.0 )
                  + ( texture2D( normalMap, mat2( 0.8, -0.6, 0.6, 0.8 ) * wp / uS.y + vec2( 0.13, 0.57 ) ).xy * 2.0 - 1.0 ) * 0.75
                  + ( texture2D( normalMap, mat2( 0.28, 0.96, -0.96, 0.28 ) * wp / uS.z + vec2( 0.71, 0.29 ) ).xy * 2.0 - 1.0 ) * 0.6;
          wg *= uStr * wK * mix( 1.0, 0.4, smoothstep( 25.0, 350.0, wDist ) );   // au loin, les vaguelettes se moyennent (rugosité)
          wg *= mix( 0.35, 1.0, smoothstep( 0.02, 0.3, dot( normalize( vViewPosition ), - nonPerturbedNormal ) ) );   // vue rasante : faces cachées des vagues (sinon reflets sous l'horizon)
          normal = normalize( ( viewMatrix * vec4( normalize( vec3( wg.x, 1.0, -wg.y ) ), 0.0 ) ).xyz );`)
        // l'horizon n'est pas du ciel : quais, arbres et façades ; le reflet rasant de l'environnement est assombri
        .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
          #if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
            { vec3 wR = inverseTransformDirection( reflect( - geometryViewDir, geometryNormal ), viewMatrix ), wF = inverseTransformDirection( reflect( - geometryViewDir, nonPerturbedNormal ), viewMatrix );
              // une vaguelette ne renvoie pas le dessous de l'horizon (taches noires en vue rasante) : normale redressée
              vec3 nFix = normalize( mix( geometryNormal, nonPerturbedNormal, smoothstep( 0.1, -0.02, wR.y ) ) );
              radiance = getIBLRadiance( geometryViewDir, nFix, material.roughness ) * mix( uBank, 1.0, smoothstep( uHor.x, uHor.y, mix( wF.y, wR.y, 0.35 ) ) ); }
          #endif`);
    };
    m.customProgramCacheKey = () => 'canopee-eau';
    return m;
  };
  const MAT = {
    canal: waterMat('eau:canal', { color: 0x222a1c, rough: 0.045, roughFar: 0.1, scales: [3.7, 9.1, 23], str: 0.2, patch: 0.45, hor: [-0.04, 0.3], bank: 0.32 }),
    river: waterMat('eau:garonne', { color: 0x37372a, rough: 0.07, roughFar: 0.17, scales: [7.9, 19.3, 47], str: 0.28, patch: 0.35, hor: [-0.03, 0.12], bank: 0.4 }),
  };
  // maçonneries : pierre calcaire et brique foraine du canal, brique des quais de Garonne (canvas, uv en mètres)
  const canvasTex = (S, rep, draw, srgb = true) => {
    const c = document.createElement('canvas'); c.width = c.height = S; draw(c.getContext('2d'), S);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    t.repeat.set(1 / rep[0], 1 / rep[1]); return t;
  };
  const hsl = (h, s, l) => `hsl(${h},${s}%,${l}%)`;
  const speckle = (g, S, n, a) => { for (let i = 0; i < n; i++) { const v = r0(); g.fillStyle = v < 0.5 ? `rgba(0,0,0,${a * r0()})` : `rgba(255,255,255,${a * r0()})`; g.fillRect(r0() * S, r0() * S, 1 + r0() * 2, 1 + r0() * 2); } };
  // pierre : assises de 0,4 m, blocs de 0,5–1,1 m, une assise de brique toutes les cinq (2,4 × 2,4 m)
  const stoneDraw = (bump) => (g, S) => {
    const px = S / 2.4, rr = mulberry32(77);
    g.fillStyle = bump ? '#202020' : '#9d9483'; g.fillRect(0, 0, S, S);
    for (let row = 0, y = 0; row < 6; row++) {
      const h = (row === 5 ? 0.4 : 0.4) * px, brick = row === 5;
      if (brick) { for (let c = 0; c < 5; c++) for (let x = (c & 1) * 0.11 * px - 0.22 * px; x < S; x += 0.44 * px) { g.fillStyle = bump ? '#b0b0b0' : hsl(10 + rr() * 12, 40 + rr() * 15, 40 + rr() * 14); g.fillRect(x + 1.5, y + c * h / 5 + 1.2, 0.42 * px - 3, h / 5 - 2.4); } }
      else for (let x = -rr() * 0.6 * px; x < S;) { const w = (0.5 + rr() * 0.6) * px, k = rr(); g.fillStyle = bump ? `rgb(${200 + k * 40 | 0},${200 + k * 40 | 0},${200 + k * 40 | 0})` : hsl(34 + k * 10, 10 + k * 12, 58 + k * 14 - rr() * 8); g.fillRect(x + 2, y + 2, w - 4, h - 4); x += w; }
      y += h;
    }
    speckle(g, S, 9000, bump ? 0.25 : 0.12);
  };
  // brique foraine des quais : 42 × 5 cm, joints de 2 cm (1,76 × 1,68 m)
  const brickDraw = (bump) => (g, S) => {
    const rr = mulberry32(91), sx = S / 1.76, sy = S / 1.68;
    g.fillStyle = bump ? '#303030' : '#c9b49a'; g.fillRect(0, 0, S, S);
    for (let row = 0; row < 24; row++) for (let x = (row & 1) * 0.22 - 0.44; x < 1.76; x += 0.44) {
      const v = 190 + rr() * 50 | 0; g.fillStyle = bump ? `rgb(${v},${v},${v})` : hsl(9 + rr() * 13, 42 + rr() * 16, 42 + rr() * 16 - (rr() < 0.08 ? 12 : 0));
      g.fillRect((x + 0.01) * sx, (row * 0.07 + 0.01) * sy, 0.42 * sx, 0.05 * sy);
    }
    speckle(g, S, 7000, bump ? 0.3 : 0.1);
  };
  const copeDraw = (g, S) => { g.fillStyle = '#c7bca8'; g.fillRect(0, 0, S, S); const rr = mulberry32(5); for (let x = 0; x < S; x += S / 2) { g.fillStyle = 'rgba(70,60,50,0.5)'; g.fillRect(x, 0, 2, S); } speckle(g, S, 3000, 0.12); for (let i = 0; i < 14; i++) { g.fillStyle = `rgba(90,85,70,${0.05 + rr() * 0.08})`; g.beginPath(); g.arc(rr() * S, rr() * S, 6 + rr() * 30, 0, 7); g.fill(); } };
  const masonry = (name, draw, rep, o = {}) => new THREE.MeshStandardMaterial({ name, map: canvasTex(512, rep, draw(false)), bumpMap: canvasTex(512, rep, draw(true), false), bumpScale: 1.2, roughness: 0.88, metalness: 0, vertexColors: true, ...o });
  Object.assign(MAT, {
    stone: masonry('eau:quaiPierre', stoneDraw, [2.4, 2.4]),
    brick: masonry('eau:quaiBrique', brickDraw, [1.76, 1.68]),
    cope: new THREE.MeshStandardMaterial({ name: 'eau:margelle', map: canvasTex(256, [2.0, 2.0], copeDraw), roughness: 0.8, metalness: 0 }),
    wood: new THREE.MeshStandardMaterial({ name: 'eau:porteEcluse', color: 0x3a2e24, roughness: 0.78, metalness: 0.05 }),
  });
  MAT.bank = M.grass.clone(); MAT.bank.name = 'eau:berge'; MAT.bank.vertexColors = true;

  // ---------- accumulateurs ----------
  class Acc {
    constructor() { this.p = []; this.u = []; this.c = []; this.i = []; }
    v(x, y, z, u, w, c = [1, 1, 1]) { this.p.push(x, y, z); this.u.push(u, w); this.c.push(c[0], c[1], c[2]); return this.p.length / 3 - 1; }
    // bande entre deux rangées de sommets (indices), orientée pour que la normale suive `want` (vecteur 3)
    skin(A, B, want) {
      if (A.length < 2) return;
      const P = this.p, a = A[0] * 3, b = B[0] * 3, c = A[1] * 3;
      const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const flip = n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0;
      for (let i = 0; i < A.length - 1; i++) {
        if (flip) this.i.push(A[i], A[i + 1], B[i], A[i + 1], B[i + 1], B[i]); else this.i.push(A[i], B[i], A[i + 1], A[i + 1], B[i], B[i + 1]);
      }
    }
    geo(normals = true) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
      g.setIndex(this.i); if (normals) g.computeVertexNormals(); return g;
    }
  }
  const acc = {}; const A_ = (k) => acc[k] || (acc[k] = new Acc());

  // ---------- surfaces : chaque polygone moins ceux déjà posés (sas d'abord, puis canal proche, puis lointain) ----------
  let nTri = 0;
  for (const P of live) {
    const a = A_(P.kind === 'river' ? 'river' : 'canal');
    for (const t of P.tris) {
      for (const q of subtract(t.p, gDone)) {
        const n = q.length / 2, b = a.p.length / 3;
        for (let i = 0; i < n; i++) a.v(q[2 * i], P.level, q[2 * i + 1], q[2 * i], -q[2 * i + 1]);
        for (let i = 1; i < n - 1; i++) a.i.push(b, b + i + 1, b + i);   // area2 > 0 → inversé : face vers le haut
        nTri += n - 2;
      }
    }
    for (const t of P.tris) gDone.add(t);
  }

  // ---------- rives : murs de quai, margelles, parapets, talus, portes d'écluse ----------
  const farR = far && far.radius ? far.radius : 1e9;
  const zoneOf = (P, mx, mz, nx, nz) => {   // style de la rive
    if (P.kind !== 'river') return 'quai';
    if (curHole) return 'talus';                                                   // îles
    const [dx, dz] = Ti(mx, mz), [ex] = Ti(mx + nx, mz + nz), east = ex - dx > 0;   // terre à l'est : rive droite
    const ville = dx > -1600 && dx < -600 && dz > 520 && dz < 2150;               // Saint-Pierre → Saint-Michel
    if (ville && east) return 'brique';                                            // quais de la Daurade, de Tounis
    if (ville && dz < 1250) return 'brique';                                       // Hôtel-Dieu, la Grave
    if (ville) return 'prairie';                                                   // prairie des Filtres
    return 'talus';
  };
  const labelOf = (P, ax, az, bx, bz) => {
    const L = Math.hypot(bx - ax, bz - az), nx = (bz - az) / L, nz = (ax - bx) / L, mx = (ax + bx) / 2, mz = (az + bz) / 2;
    const da = Ti(ax, az), db = Ti(bx, bz);
    if (!P.far && Math.max(Math.abs(da[0]), Math.abs(da[1])) > 799 && Math.max(Math.abs(db[0]), Math.abs(db[1])) > 799 && (Math.abs(da[0] - db[0]) < 1 || Math.abs(da[1] - db[1]) < 1)) return { k: 'open' };   // bord de l'extrait proche
    if (P.far && Math.hypot(...da) > farR * 0.97 && Math.hypot(...db) > farR * 0.97) return { k: 'open' };
    const ox = mx + nx * 1.2, oz = mz + nz * 1.2, qx = mx - nx * 1.2, qz = mz - nz * 1.2;
    for (const Q of live) if (Q !== P && inside(Q, ox, oz)) return { k: P.kind === 'lock' ? 'gate' : 'open', Q };
    for (const Q of live) if (Q !== P && Q.prio < P.prio && inside(Q, qx, qz)) return { k: 'open' };   // rive déjà tenue par un polygone prioritaire
    return { k: zoneOf(P, mx, mz, nx, nz) };
  };
  const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const WHITE = [1, 1, 1], DAMP = [0.5, 0.52, 0.42], ALGAE = [0.3, 0.34, 0.24];
  // décalage à onglet d'une polyligne (normales de segments ns, vers la terre) de d mètres
  const offs = (pts, ns, closed, d) => pts.map((p, i) => {
    const n0 = ns[closed ? (i - 1 + ns.length) % ns.length : Math.max(0, i - 1)], n1 = ns[closed ? i % ns.length : Math.min(ns.length - 1, i)];
    let mx = n0[0] + n1[0], mz = n0[1] + n1[1]; const l = Math.hypot(mx, mz) || 1; mx /= l; mz /= l;
    const k = 1 / Math.max(0.5, mx * n1[0] + mz * n1[1]);
    return [p[0] + mx * d * k, p[1] + mz * d * k];
  });
  const row = (a, pts, y, off, ns, closed, uv, col) => {   // une rangée de sommets ; uv : 'len' (u = abscisse, v = y) | 'xz'
    const q = off ? offs(pts, ns, closed, off) : pts, R = []; let s = 0;
    for (let i = 0; i < q.length; i++) {
      if (i) s += Math.hypot(q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]);
      const yy = typeof y === 'function' ? y(i) : y, c = typeof col === 'function' ? col(i) : col;
      R.push(uv === 'xz' ? a.v(q[i][0], yy, q[i][1], q[i][0], -q[i][1], c) : a.v(q[i][0], yy, q[i][1], s, uv === 'off' ? off : yy, c));
    }
    return R;
  };
  const gates = [], LAB = {}; let curHole = false;
  const buildRun = (P, pts, ns, closed, k) => {
    if (closed) pts = pts.concat([pts[0]]), ns = ns.concat([ns[0]]);
    const lvl = P.level, inw = (i) => [-ns[Math.min(i, ns.length - 1)][0], 0, -ns[Math.min(i, ns.length - 1)][1]];
    const N0 = inw(0), UPV = [0, 1, 0], OUT = [-N0[0], 0, -N0[2]];
    if (k === 'quai' || k === 'brique') {
      const brick = k === 'brique', a = A_(brick ? 'brick' : 'stone'), bot = lvl - 0.6, top = brick ? 1.0 : 0, batter = brick ? 0.09 * (top - bot) : 0;
      const yr = [top, lvl + 0.8, lvl + 0.08, bot], cr = [WHITE, mixc(WHITE, DAMP, 0.35), ALGAE, mixc(ALGAE, [0.2, 0.2, 0.18], 0.5)];
      const off = (y) => -batter * (top - y) / (top - bot);   // fruit du mur (vers l'eau en descendant)
      const R = yr.map((y, j) => row(a, pts, y, off(y), ns, false, 'len', cr[j]));
      for (let j = 0; j < 3; j++) a.skin(R[j], R[j + 1], N0);
      const c = A_('cope');
      if (brick) {   // parapet de brique (1 m) coiffé de pierre
        const back = [row(a, pts, top, 0.45, ns, false, 'len', WHITE), row(a, pts, -0.02, 0.45, ns, false, 'len', WHITE)]; a.skin(back[0], back[1], OUT);
        const ct = 1.13, i0 = row(c, pts, ct, -0.06, ns, false, 'off', WHITE), o0 = row(c, pts, ct, 0.51, ns, false, 'off', WHITE);
        c.skin(i0, o0, UPV); c.skin(row(c, pts, top - 0.02, -0.06, ns, false, 'len', WHITE), row(c, pts, ct, -0.06, ns, false, 'len', WHITE), N0);
        c.skin(row(c, pts, ct, 0.51, ns, false, 'len', WHITE), row(c, pts, top - 0.02, 0.51, ns, false, 'len', WHITE), OUT);
      } else {      // margelle : 50 cm de pierre, 8 cm en surplomb sur l'eau, 14 cm au-dessus du sol
        const ct = 0.15, i0 = row(c, pts, ct, -0.08, ns, false, 'off', WHITE), o0 = row(c, pts, ct, 0.42, ns, false, 'off', WHITE);
        c.skin(i0, o0, UPV);
        c.skin(row(c, pts, ct, -0.08, ns, false, 'len', WHITE), row(c, pts, -0.12, -0.08, ns, false, 'len', [0.7, 0.7, 0.66]), N0);
        c.skin(row(c, pts, ct, 0.42, ns, false, 'len', WHITE), row(c, pts, -0.02, 0.42, ns, false, 'len', WHITE), OUT);
      }
    } else if (k === 'talus' || k === 'prairie') {   // berge en pente douce, herbe puis vase vers l'eau
      const a = A_('bank'), W = k === 'prairie' ? 26 : 15, bot = lvl - 0.8;
      const MUD = [0.62, 0.52, 0.38], ym = lvl + 0.9, fm = (0.02 - ym) / (0.02 - bot);
      const R = [row(a, pts, 0.02, 0, ns, false, 'xz', WHITE), row(a, pts, ym, -W * fm, ns, false, 'xz', [0.85, 0.85, 0.75]), row(a, pts, bot, -W, ns, false, 'xz', MUD)];
      a.skin(R[0], R[1], UPV); a.skin(R[1], R[2], UPV);
    }
  };
  for (const P of live) {
    for (const ring of [P.r, ...P.holes]) {
      curHole = ring !== P.r;
      // sous-segments ≤ 12 m, étiquetés
      const pts = [], lab = [], ns = [];
      for (let i = 0; i < ring.length; i++) {
        const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / 12));
        for (let j = 0; j < n; j++) {
          const x0 = ax + (bx - ax) * j / n, z0 = az + (bz - az) * j / n, x1 = ax + (bx - ax) * (j + 1) / n, z1 = az + (bz - az) * (j + 1) / n;
          pts.push([x0, z0]); lab.push(labelOf(P, x0, z0, x1, z1)); ns.push([(bz - az) / L, (ax - bx) / L]);
          const kk = P.kind + ':' + lab[lab.length - 1].k; LAB[kk] = (LAB[kk] || 0) + 1;
        }
      }
      const n = pts.length, same = (i, j) => lab[i].k === lab[j].k && lab[i].Q === lab[j].Q;
      let s0 = 0; while (s0 < n && same(s0, (s0 - 1 + n) % n)) s0++;
      if (s0 === n) { buildRun(P, pts, ns, true, lab[0].k); continue; }
      for (let i = 0; i < n;) {
        const st = (s0 + i) % n; let j = i + 1; while (j < n && same((s0 + j) % n, st)) j++;
        const idx = []; for (let q = i; q <= j; q++) idx.push((s0 + q) % n);
        const rp = idx.map((q) => pts[q]), rn = idx.slice(0, -1).map((q) => ns[q]);
        if (lab[st].k === 'gate') gates.push({ P, Q: lab[st].Q, pts: rp, ns: rn }); else buildRun(P, rp, rn, false, lab[st].k);
        i = j;
      }
    }
  }
  // portes busquées du sas (deux vantaux en V pointant vers l'amont), balanciers et garde-corps
  const box = (a, x0, z0, x1, z1, w, y0, y1) => {
    const L = Math.hypot(x1 - x0, z1 - z0) || 1, nx = -(z1 - z0) / L * w / 2, nz = (x1 - x0) / L * w / 2;
    const c = [[x0 + nx, z0 + nz], [x1 + nx, z1 + nz], [x1 - nx, z1 - nz], [x0 - nx, z0 - nz]], ex = (x0 + x1) / 2, ez = (z0 + z1) / 2;
    for (let i = 0; i < 4; i++) {
      const p = c[i], q = c[(i + 1) % 4], mx = (p[0] + q[0]) / 2 - ex, mz = (p[1] + q[1]) / 2 - ez, l = Math.hypot(p[0] - q[0], p[1] - q[1]);
      a.skin([a.v(p[0], y1, p[1], 0, y1), a.v(q[0], y1, q[1], l, y1)], [a.v(p[0], y0, p[1], 0, y0), a.v(q[0], y0, q[1], l, y0)], [mx, 0, mz]);
    }
    a.skin([a.v(c[0][0], y1, c[0][1], 0, 0), a.v(c[1][0], y1, c[1][1], L, 0)], [a.v(c[3][0], y1, c[3][1], 0, w), a.v(c[2][0], y1, c[2][1], L, w)], [0, 1, 0]);
  };
  for (const G of gates) {
    const a = A_('wood'), A0 = G.pts[0], B0 = G.pts[G.pts.length - 1], L = Math.hypot(B0[0] - A0[0], B0[1] - A0[1]); if (L < 1.5) continue;
    let nx = 0, nz = 0; for (const n of G.ns) { nx += n[0]; nz += n[1]; } const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
    const up = G.Q.level > G.P.level ? 1 : -1, mx = (A0[0] + B0[0]) / 2 + nx * up * 0.2 * L, mz = (A0[1] + B0[1]) / 2 + nz * up * 0.2 * L;
    const y0 = Math.min(G.P.level, G.Q.level) - 0.5;
    for (const E of [A0, B0]) {
      box(a, E[0], E[1], mx, mz, 0.32, y0, 0.32);                                         // vantail
      const dx = E[0] - mx, dz = E[1] - mz, dl = Math.hypot(dx, dz);
      box(a, E[0] - dx / dl * 0.4, E[1] - dz / dl * 0.4, E[0] + dx / dl * 4.6, E[1] + dz / dl * 4.6, 0.3, 0.72, 1.02);   // balancier
      box(a, E[0], E[1], mx, mz, 0.05, 1.0, 1.06);                                          // main courante
      for (let k = 0; k <= 3; k++) { const t = k / 3, px = E[0] + (mx - E[0]) * t, pz = E[1] + (mz - E[1]) * t; box(a, px - 0.03, pz, px + 0.03, pz, 0.06, 0.32, 1.02); }
    }
  }

  // ---------- maillages ----------
  const g = new THREE.Group(); g.name = 'eau';
  const add = (k, mat, cast) => {
    const a = acc[k]; if (!a || !a.i.length) return;
    const m = new THREE.Mesh(a.geo(), mat); m.name = 'eau:' + k; m.castShadow = cast; m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix(); g.add(m);
  };
  add('canal', MAT.canal, false); add('river', MAT.river, false);
  add('stone', MAT.stone, true); add('brick', MAT.brick, true); add('cope', MAT.cope, true); add('bank', MAT.bank, false); add('wood', MAT.wood, true);

  // ---------- trous du sol (landscape.js) : géométrie du sol moins l'eau, attributs interpolés ----------
  const cut = (geo) => {
    const pos = geo.attributes.position, names = Object.keys(geo.attributes), src = names.map((n) => geo.attributes[n]);
    const out = src.map((s) => Array.from(s.array)), I = [], ix = geo.index ? geo.index.array : null;
    const nT = ix ? ix.length / 3 : pos.count / 3;
    let nv = pos.count;
    for (let t = 0; t < nT; t++) {
      const i0 = ix ? ix[3 * t] : 3 * t, i1 = ix ? ix[3 * t + 1] : 3 * t + 1, i2 = ix ? ix[3 * t + 2] : 3 * t + 2;
      const ax = pos.getX(i0), az = pos.getZ(i0), bx = pos.getX(i1), bz = pos.getZ(i1), cx = pos.getX(i2), cz = pos.getZ(i2);
      let P = [ax, az, bx, bz, cx, cz]; const A = areaF(P), rev = A < 0;
      if (Math.abs(A) < 1e-9) { I.push(i0, i1, i2); continue; }
      if (rev) P = [ax, az, cx, cz, bx, bz];
      let hit = false; gAll.query(bbF(P), () => { hit = true; return false; });
      if (!hit) { I.push(i0, i1, i2); continue; }
      const pcs = subtract(P, gAll);
      if (pcs.length === 1 && pcs[0] === P) { I.push(i0, i1, i2); continue; }
      for (const q of pcs) {
        const n = q.length / 2, b = nv;
        for (let i = 0; i < n; i++) {   // barycentriques dans le triangle d'origine
          const x = q[2 * i], z = q[2 * i + 1], d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
          const w0 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, w1 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, w2 = 1 - w0 - w1;
          src.forEach((s, k) => { const o = out[k], is = s.itemSize; for (let c = 0; c < is; c++) o.push(s.array[i0 * is + c] * w0 + s.array[i1 * is + c] * w1 + s.array[i2 * is + c] * w2); });
          nv++;
        }
        for (let i = 1; i < n - 1; i++) { if (rev) I.push(b, b + i + 1, b + i); else I.push(b, b + i, b + i + 1); }
      }
    }
    const ng = new THREE.BufferGeometry();
    names.forEach((n, k) => ng.setAttribute(n, new THREE.Float32BufferAttribute(out[k], src[k].itemSize)));
    ng.setIndex(I); return ng;
  };
  const holes = { rings: live.map((P) => [P.r, ...P.holes]), cut };

  g.userData = {
    holes, stats: { polys: live.length, kinds: live.reduce((o, P) => (o[P.kind] = (o[P.kind] || 0) + 1, o), {}), labels: LAB, gates: gates.length, tris: nTri, ms: 0 },
    onLight: (dusk, night) => {
      for (const m of [MAT.canal, MAT.river]) { m.color.copy(m.userData.base).multiplyScalar(1 - 0.25 * dusk - 0.45 * night); m.envMapIntensity = 1 - 0.15 * night; }
    },
  };
  g.userData.stats.ms = Math.round(performance.now() - t0);
  console.log('[t] eau', g.userData.stats.ms, 'ms', live.length, 'polygones', g.children.length, 'maillages');
  return g;
}
