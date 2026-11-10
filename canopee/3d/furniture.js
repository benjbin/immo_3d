/**
 * Canopée — bibliothèque de mobilier modélisé en code (Three.js 0.160), qualité « catalogue »
 *
 *   createFurniture(THREE, K) → { sofa, chair, rectTable, cushion, strut, ribbon, kitchenTap }
 *
 * K est la boîte à outils de decor.js (primitives qui poussent la géométrie dans les seaux par matériau de
 * lots.js, donc fusionnées par matériau et par étage) : put, sq, seamLoop, tube, lathe, cyl, rb, rbb, slab,
 * pillow, plaidOverArm, contact, C, R, PAL, WHITE. Repère local : y depuis le sol fini, façade vers +z.
 *
 * Références (cotes du commerce) :
 *  - canapé 3 places type La Redoute Intérieurs / Habitat : 220 × 95 cm, assise 44 cm, accoudoirs 62 cm,
 *    dossier 80 cm ; coussins d'assise 17 cm à passepoils, coussins de dossier libres inclinés de 12°,
 *    accoudoirs à grand rayon ; socle chêne en retrait ou pieds fuselés ;
 *  - chaise « wishbone » (Carl Hansen CH24) : 55 × 51 cm, assise 44 cm, dossier 73 cm, arc cintré en
 *    lamellé, pieds arrière cintrés, assise en corde de papier tressée ;
 *  - table chêne massif : plateau 3,5 cm à chanfrein, pieds fuselés de section carrée, ceinture en retrait.
 */
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const PB = new Map();   // géométries de coussins partagées par tous les étages (voir puffBox)

export function createFurniture(THREE, K) {
  const { put, sq, seamLoop, tube, rb, rbb, slab, pillow, plaidOverArm, contact, C, R, PAL, WHITE } = K;
  const V3 = THREE.Vector3;
  const jit = (s) => (R() - 0.5) * s;

  // montant fuselé entre deux points (section ronde ou carrée), rayons r0 (p0) → r1 (p1)
  function strut(mk, p0, p1, r0, r1, col, o = {}) {
    const a = new V3(...p0), b = new V3(...p1), L = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(r1, r0, L, o.square ? 4 : (o.seg || 12), 1, false);
    if (o.square) g.rotateY(Math.PI / 4);
    g.translate(0, L / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), b.clone().sub(a).normalize());
    g.applyQuaternion(q); g.translate(a.x, a.y, a.z);
    put(mk, g, col);
  }
  // profilé extrudé le long d'une courbe (bois cintré, lamellé) : section rectangulaire arrondie w × t
  function ribbon(mk, pts, w, t, col, o = {}) {
    const s = new THREE.Shape(), hw = w / 2, ht = t / 2, r = Math.min(o.r ?? t * 0.45, hw, ht);
    s.moveTo(-hw + r, -ht); s.lineTo(hw - r, -ht); s.quadraticCurveTo(hw, -ht, hw, -ht + r); s.lineTo(hw, ht - r); s.quadraticCurveTo(hw, ht, hw - r, ht);
    s.lineTo(-hw + r, ht); s.quadraticCurveTo(-hw, ht, -hw, ht - r); s.lineTo(-hw, -ht + r); s.quadraticCurveTo(-hw, -ht, -hw + r, -ht);
    const path = new THREE.CatmullRomCurve3(pts.map((p) => new V3(...p)), false, 'centripetal');
    const g = new THREE.ExtrudeGeometry(s, { steps: o.steps || 32, bevelEnabled: false, extrudePath: path, curveSegments: 2 });
    put(mk, g, col);
  }
  // coussin « boîte » : faces quasi planes, arêtes arrondies, dessus bombé, passepoils en haut et en bas.
  // w × h × d (h = épaisseur, selon y local) ; o.rx/ry/rz : rotations ; o.puff, o.sag, o.crease
  // boîte arrondie subdivisée régulièrement (faces planes maillées finement, arêtes de rayon r) :
  // contrairement à la superquadrique, le dessus reçoit un maillage uniforme (bombé et plis sans facettes)
  // cache : les coussins identiques (assise, dossier d'un même canapé, matelas d'un même lit sur les trois
  // étages) ne sont calculés qu'une fois (chargement plus court) ; chaque appel reçoit une copie
  function puffBox(w, h, d, r, o = {}) {
    const key = [w, h, d, r, o.puff, o.sag, o.side, o.wob, o.step, o.crease, o.seed].map((v) => (v == null ? '-' : (+v).toFixed(4))).join('|');
    if (!PB.has(key)) PB.set(key, puffBox0(w, h, d, r, o));
    return PB.get(key).clone();
  }
  function puffBox0(w, h, d, r, o = {}) {
    const st = o.step || 0.028, g0 = new THREE.BoxGeometry(w, h, d, Math.max(2, Math.ceil(w / st)), Math.max(3, Math.ceil(h / st)), Math.max(2, Math.ceil(d / st)));
    g0.deleteAttribute('normal'); g0.deleteAttribute('uv');
    const g = mergeVertices(g0); g0.dispose();
    const p = g.attributes.position, a = w / 2, b = h / 2, c = d / 2, ia = a - r, ib = b - r, ic = c - r, v = new V3(), q = new V3();
    const puff = o.puff ?? 0.25, sag = o.sag ?? 0, side = o.side ?? 0.12, seed = ((w * 13.7 + d * 7.1) % 10) + (o.seed || 0) * 3.7, wob = o.wob ?? 0.002;
    const crease = o.crease ?? 0, shade = new Float32Array(p.count);
    // plis du tissu tendu : sillons qui partent des coins et des bords (là où la housse tire), larges de 2–4 cm
    const hs = (n) => { const x = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453; return x - Math.floor(x); };
    const FOLDS = crease ? Array.from({ length: 9 }, (_, k) => {
      const corner = k < 4, sx = k & 1 ? 1 : -1, sz = k & 2 ? 1 : -1, t = hs(k + 1);
      const px = corner ? sx * 0.96 : (hs(k + 9) < 0.5 ? sx * 0.98 : (t * 2 - 1) * 0.7), pz = corner ? sz * 0.96 : (Math.abs(px) > 0.9 ? (t * 2 - 1) * 0.7 : sz * 0.98);
      const ang = Math.atan2(-pz, -px) + (hs(k + 20) - 0.5) * (corner ? 0.5 : 1.1);
      return { px, pz, dx: Math.cos(ang), dz: Math.sin(ang), L: (corner ? 0.55 : 0.32) + hs(k + 30) * 0.3, wd: 0.045 + hs(k + 40) * 0.05, k: 0.6 + hs(k + 50) * 0.6 };
    }) : null;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      q.set(Math.max(-ia, Math.min(ia, v.x)), Math.max(-ib, Math.min(ib, v.y)), Math.max(-ic, Math.min(ic, v.z)));
      const dv = v.clone().sub(q); if (dv.lengthSq() > 1e-12) v.copy(q.add(dv.normalize().multiplyScalar(r)));
      const nx = v.x / a, nz = v.z / c, ny = v.y / b, cx = 1 - nx * nx, cz = 1 - nz * nz;
      // dessus / dessous bombés (rembourrage), affaissement au centre (o.sag), flancs légèrement gonflés
      const crown = Math.max(0, cx) * Math.max(0, cz);
      v.y += Math.sign(v.y) * (puff * b * Math.pow(crown, 0.8) * Math.min(1, Math.abs(ny) * 1.6) - (v.y > 0 ? sag * b * Math.pow(crown, 0.6) : 0));
      const sb = side * b * (1 - ny * ny);
      v.x += Math.sign(v.x) * sb * Math.max(0, cz) * Math.abs(nx) * 0.5; v.z += Math.sign(v.z) * sb * Math.max(0, cx) * Math.abs(nz) * 0.5;
      let dip = 0;
      if (FOLDS && Math.abs(ny) > 0.35) {
        for (const f of FOLDS) { const qx = nx - f.px, qz = nz - f.pz, t = qx * f.dx + qz * f.dz; if (t < -0.05 || t > f.L) continue; const dd = Math.abs(qx * f.dz - qz * f.dx); dip += f.k * Math.exp(-Math.pow(dd / f.wd, 2)) * Math.min(1, (t + 0.05) / 0.12) * (1 - t / f.L); }
        // bourrelet au ras des coutures : le rembourrage retombe juste avant le passepoil
        const eg = Math.max(Math.abs(nx), Math.abs(nz)); dip += 0.5 * Math.exp(-Math.pow((eg - 0.9) / 0.05, 2)) * (0.6 + 0.4 * Math.sin(nx * 9 + nz * 7 + seed));
        v.y -= Math.sign(v.y) * crease * b * dip * Math.min(1, (Math.abs(ny) - 0.35) * 3);
      }
      // froissé doux du tissu tendu
      if (wob) { const k = wob * (Math.sin(v.x * 37 + seed) * Math.sin(v.z * 29 - seed) + 0.6 * Math.sin((v.x + v.z) * 61 + seed * 2)); v.y += k * Math.sign(v.y) * Math.abs(ny); }
      p.setXYZ(i, v.x, v.y, v.z);
      // ombre propre : flancs (coussins serrés les uns contre les autres) et dessous sombres, bord du dessus un peu
      // assombri, fond des plis marqué — ce que l'éclairage temps réel ne donne pas entre deux coussins
      const eg = Math.max(Math.abs(nx), Math.abs(nz)), sideK = THREE.MathUtils.smoothstep(eg, 0.82, 1.0), low = 0.5 - 0.5 * Math.max(-1, Math.min(1, ny));
      const mot = 0.965 + 0.035 * (Math.sin(v.x * 11 + seed * 2) * Math.sin(v.z * 9 - seed) + 0.5 * Math.sin((v.x - v.z) * 23 + seed));   // nuances du tissu
      shade[i] = mot * Math.max(0.42, (1 - 0.3 * sideK * (0.35 + 0.65 * low) - 0.25 * low * low) * (1 - 0.16 * Math.min(1.5, dip)) * (0.93 + 0.07 * crown));
    }
    g.setAttribute('shade', new THREE.BufferAttribute(shade, 1));
    g.computeVertexNormals();
    return g;
  }
  function cushion(mk, w, h, d, x, y, z, col, o = {}) {
    const a = w / 2, b = h / 2, c = d / 2, ro = { rx: o.rx || 0, ry: o.ry || 0, rz: o.rz || 0 };
    const e = o.e ?? 0.16;
    const g = puffBox(w, h, d, Math.min(o.r ?? h * 0.32, h / 2 - 1e-3), { puff: o.puff ?? 0.25, sag: o.sag ?? 0.05, wob: o.wob ?? 0.0012, step: o.step, crease: o.crease, seed: o.seed });
    if (ro.rz) g.rotateZ(ro.rz); if (ro.rx) g.rotateX(ro.rx); if (ro.ry) g.rotateY(ro.ry);
    g.translate(x, y, z); put(mk, g, col);
    if (o.piping === false) return;
    const pc = col.map((v) => v * 0.86), pr = o.pr || 0.0042;
    // passepoils : superellipses au niveau des arêtes haute et basse (même rotation que le coussin)
    const rot = new THREE.Euler(ro.rx, ro.ry, ro.rz, 'YXZ');   // même ordre que rot() de decor.js (z, puis x, puis y)
    const rr = Math.min(o.r ?? h * 0.32, h / 2 - 1e-3), k = 0.3 * rr;
    for (const sy of [1, -1]) {
      const off = new V3(0, sy * (b - k), 0).applyEuler(rot);
      seamLoop(mk, a - k + 0.002, c - k + 0.002, pr, x + off.x, y + off.y, z + off.z, pc, ro, e, 48);
    }
  }

  // coussin déco : deux faces bombées cousues bord à bord (couture « couteau »), coins en oreilles, garnissage
  // qui descend (plus ventru en bas), plis qui partent des coins, creux du « coup du tranchant » en tête (o.chop),
  // ombre propre vers la couture et dans les plis. s × (o.h || s), épaisseur t selon y local.
  // Pose : o.roll (dans son plan), o.tilt (adossé, sommet vers −z), o.ry ; o.rx/o.rz : ancien usage (à plat ou incliné).
  // o.planes [[nx, ny, nz, d]] : appuis (assise, dossier) sur lesquels le coussin s'écrase ; o.press [{c, r, dir, k}] :
  // empreinte d'un voisin qui s'appuie dessus (creux + ombre de contact).
  const SM = THREE.MathUtils.smoothstep;
  function softPillow(mk, x, y, z, s, t, col, o = {}) {
    const n = o.n || 20, a = s / 2, c = (o.h || s) / 2, pos = [], sh = [], idx = [], seed = R() * 10;
    const hs = (k) => { const v = Math.sin(k * 127.1 + seed * 311.7) * 43758.5453; return v - Math.floor(v); };
    const chop = o.chop ?? 0, slump = o.slump ?? 0.2, back = o.back ?? 0.72;
    const F = [];
    for (let k = 0; k < 4; k++) { const sx = k & 1 ? 1 : -1, sz = k & 2 ? 1 : -1, m = 2 + (hs(k + 3) > 0.45 ? 1 : 0);
      for (let j = 0; j < m; j++) { const ang = Math.atan2(-sz, -sx) + (hs(k * 7 + j + 11) - 0.5) * 1.25; F.push({ px: sx * 0.98, pz: sz * 0.98, dx: Math.cos(ang), dz: Math.sin(ang), L: 0.4 + hs(k * 5 + j + 30) * 0.55, wd: 0.05 + hs(k * 3 + j + 40) * 0.06, k: 0.45 + hs(k * 9 + j + 50) * 0.8 }); } }
    for (const side of [1, -1]) {
      const base = pos.length / 3;
      for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
        // maillage resserré vers la couture (là où la courbure est forte)
        const u = Math.sin((-1 + 2 * i / n) * Math.PI / 2), v = Math.sin((-1 + 2 * j / n) * Math.PI / 2), eu = 1 - u * u, ev = 1 - v * v, au = Math.abs(u), av = Math.abs(v);
        let h = (t / 2) * Math.pow(eu * ev, 0.36);
        h *= (1 - slump * v * (0.5 + 0.5 * eu)) * (1 - 0.4 * Math.pow(au * av, 1.4));
        if (chop) h *= 1 - chop * Math.exp(-u * u / 0.045) * SM(v, -0.3, 0.9);
        let dip = 0;
        for (const f of F) { const qx = u - f.px, qz = v - f.pz, tt = qx * f.dx + qz * f.dz; if (tt < -0.05 || tt > f.L) continue; const dd = Math.abs(qx * f.dz - qz * f.dx); dip += f.k * Math.exp(-Math.pow(dd / f.wd, 2)) * Math.min(1, (tt + 0.05) / 0.15) * (1 - tt / f.L); }
        h *= 1 - Math.min(0.45, 0.2 * dip);
        h += (t / 2) * 0.05 * Math.sin(u * 4.3 + seed) * Math.sin(v * 3.7 - seed * side) * eu * ev;
        // contour : bords rentrés entre les coins, plus rentrés en haut (le garnissage est descendu), haut entaillé par le coup
        let px = a * u * (1 - 0.13 * ev * (1 + 0.45 * v)), pz = c * v * (1 - 0.12 * eu * (1 + 0.3 * v));
        if (chop) pz -= c * chop * 0.3 * Math.exp(-u * u / 0.07) * Math.max(0, v) * Math.max(0, v);
        px += a * 0.012 * Math.sin(v * 5 + seed * 2) * eu; pz += c * 0.012 * Math.sin(u * 6 + seed * 3) * ev * 0;
        pos.push(px, side * h * (side > 0 ? back : 1), pz);
        const mot = 0.97 + 0.03 * Math.sin(u * 7 + seed) * Math.sin(v * 6 - seed);
        sh.push(mot * (0.6 + 0.4 * Math.pow(eu * ev, 0.3)) * (1 - 0.2 * Math.min(1.4, dip)) * (side > 0 ? 0.9 : 1) * (1 - 0.06 * v));
      }
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a0 = base + j * (n + 1) + i, b0 = a0 + n + 1; if (side > 0) idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1); else idx.push(a0, a0 + 1, b0, a0 + 1, b0 + 1, b0); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    if (o.roll) g.rotateY(o.roll);
    if (o.tilt != null) g.rotateX(-Math.PI / 2 - o.tilt);
    if (o.rz) g.rotateZ(o.rz); if (o.rx) g.rotateX(o.rx); if (o.ry) g.rotateY(o.ry);
    g.translate(x, y, z);
    const p = g.attributes.position;
    if (o.planes || o.press) for (let i = 0; i < p.count; i++) {
      let vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i), k = 1;
      for (const [nx, ny, nz, d0] of (o.planes || [])) {   // appui : la matière qui dépasserait s'étale juste au-dessus du plan
        const m = 0.03, e = vx * nx + vy * ny + vz * nz - d0, e1 = e < m ? m * Math.exp((e - m) / m) : e;
        vx += nx * (e1 - e); vy += ny * (e1 - e); vz += nz * (e1 - e); k *= 0.72 + 0.28 * SM(e1, 0, 0.07);
      }
      for (const q of (o.press || [])) {
        const dd = Math.hypot(vx - q.c[0], vy - q.c[1], vz - q.c[2]) / q.r; if (dd >= 1) continue;
        const w = (1 - dd * dd) * (1 - dd * dd), kk = q.k ?? 0.03; vx += q.dir[0] * kk * w; vy += q.dir[1] * kk * w; vz += q.dir[2] * kk * w; k *= 1 - 0.3 * w;
      }
      p.setXYZ(i, vx, vy, vz); sh[i] *= k;
    }
    g.computeVertexNormals();
    // lumière du ciel : ce qui regarde vers le haut est plus clair, ce qui regarde le sol plus sombre (lecture du volume)
    { const nr = g.attributes.normal; for (let i = 0; i < p.count; i++) sh[i] *= 0.8 + 0.2 * (0.5 + 0.5 * nr.getY(i)) * 1.25; }
    g.setAttribute('shade', new THREE.Float32BufferAttribute(sh, 1));
    put(mk, g, col);
  }

  // ------------------------------------------------------------------ canapé « capitonné » en bouclé
  // Assise d'un bloc jusqu'au sol : dessus capitonné en carrés, face avant en canaux verticaux qui prolongent les
  // colonnes du dessus ; dossier et accoudoirs d'une seule coque arrondie qui enveloppe l'assise et plonge vers
  // l'avant ; coussins libres dans le même tissu. Emprise w × d, comme sofa().
  // Rien n'est régulier : largeur des colonnes et position des coutures tirées au sort (graine fixe), gonflant
  // propre à chaque carré, fronces le long des coutures, assise tassée aux places, ventre des canaux en façade.
  const lobe = (t) => Math.pow(Math.abs(Math.sin(Math.PI * t)), 0.42);   // 0 sur la couture, 1 au milieu du boudin
  function tuftBlock(w, h, d, r, nCol, nRow, amp, sinks = []) {
    const key = ['tb2', w, h, d, r, nCol, nRow, amp, ...sinks.flat()].map((v) => (+v).toFixed(4)).join('|');
    if (PB.has(key)) return PB.get(key).clone();
    const st = 0.022, g0 = new THREE.BoxGeometry(w, h, d, Math.ceil(w / st), Math.ceil(h / st), Math.ceil(d / st));
    g0.deleteAttribute('normal'); g0.deleteAttribute('uv');
    const g = mergeVertices(g0); g0.dispose();
    const p = g.attributes.position, a = w / 2, b = h / 2, c = d / 2, v = new V3(), q = new V3(), n = new V3(), shade = new Float32Array(p.count);
    // faces jamais vues (dos contre la coque, dessous hors d'une bande le long des bords visibles) : retirées
    { const ix = g.index.array, keep = [];
      for (let t = 0; t < ix.length; t += 3) {
        const i0 = ix[t], i1 = ix[t + 1], i2 = ix[t + 2];
        if (p.getZ(i0) < -c + 1e-5 && p.getZ(i1) < -c + 1e-5 && p.getZ(i2) < -c + 1e-5) continue;
        if (p.getY(i0) < -b + 1e-5 && p.getY(i1) < -b + 1e-5 && p.getY(i2) < -b + 1e-5) { const mx = Math.max(Math.abs(p.getX(i0)), Math.abs(p.getX(i1)), Math.abs(p.getX(i2))), mz = Math.max(p.getZ(i0), p.getZ(i1), p.getZ(i2)); if (mx < a - r - 0.06 && mz < c - r - 0.06) continue; }
        keep.push(i0, i1, i2);
      }
      g.setIndex(keep); }
    const hs = (i, j) => { const x = Math.sin(i * 127.1 + j * 269.5 + w * 31.7) * 43758.5453; return x - Math.floor(x); };
    // coutures : colonnes de largeur inégale (± 7 %), rangées décalées d'une colonne à l'autre (± 1,2 cm)
    const XS = [-a]; for (let k = 1; k < nCol; k++) XS.push(-a + (w / nCol) * (k + (hs(k, 1) - 0.5) * 0.14)); XS.push(a);
    const ZC = [-c]; const nz = Math.round(d / (w / nCol)); for (let k = 1; k < nz; k++) ZC.push(-c + (d / nz) * (k + (hs(k, 2) - 0.5) * 0.12)); ZC.push(c);
    const ZS = (ci) => { const out = [-c]; for (let k = 1; k < nRow; k++) out.push(-c + (d / nRow) * k + (hs(ci, k + 5) - 0.5) * 0.026); out.push(c); return out; };
    const ZR = XS.map((_, ci) => ZS(ci));
    const cell = (arr, x) => { let k = 0; while (k < arr.length - 2 && x >= arr[k + 1]) k++; return [k, Math.max(0, Math.min(1, (x - arr[k]) / (arr[k + 1] - arr[k])))]; };
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      q.set(Math.max(-a + r, Math.min(a - r, v.x)), Math.max(-b + r, Math.min(b - r, v.y)), Math.max(-c + r, Math.min(c - r, v.z)));
      n.copy(v).sub(q); if (n.lengthSq() < 1e-12) { shade[i] = 1; continue; }
      n.normalize(); v.copy(q).addScaledVector(n, r);
      const top = Math.max(0, n.y), sx = n.x * n.x, yn = (v.y + b) / h;
      const [ci, tx] = cell(XS, v.x), [zi, tz] = cell(ZC, v.z), [ri, tr] = cell(ZR[ci], v.z);
      // canaux : selon x sur le dessus et la face avant, selon z sur les flancs ; rangées en plus sur le dessus
      const col = lobe(tx) * (1 - sx) + lobe(tz) * sx, row = lobe(tr), k = col * (1 - top + top * row);
      const under = n.y < -0.5 ? 0 : 1, fat = 0.72 + 0.56 * hs(ci * 7 + (top > 0.5 ? ri + 1 : 0), sx > 0.5 ? 40 + zi : 9);   // gonflant propre à chaque carré
      v.addScaledVector(n, -amp * (1 - k) * under);
      // carrés bombés (dessus), ventre des canaux à mi-hauteur et pincement vers le sol (façade, flancs)
      v.y += top * amp * 0.42 * col * row * fat;
      const belly = (1 - top) * under * (0.011 * Math.sin(Math.PI * Math.min(1, yn * 1.15)) * fat - 0.012 * (1 - SM(yn, 0, 0.16))) * col;
      v.addScaledVector(n, belly);
      // fronces le long des coutures, vie du tissu
      const ds = Math.min(tx, 1 - tx) * (XS[ci + 1] - XS[ci]), al = top > 0.5 ? v.z : v.y;
      v.addScaledVector(n, under * (0.0028 * Math.sin(al * 68 + hs(ci, 77) * 6.3 + (tx > 0.5 ? 1.7 : 0)) * Math.exp(-Math.pow(ds / 0.024, 2)) * (1 - sx)
        + 0.0022 * (Math.sin(v.x * 19 + v.y * 7 + 1.3) * Math.sin(v.z * 15 - v.y * 11) + 0.6 * Math.sin((v.x + v.z) * 9 + 2))));
      // tassement aux places assises
      let sink = 0; for (const [sxp, szp, sd] of sinks) sink += sd * Math.exp(-Math.pow((v.x - sxp) / 0.34, 2) - Math.pow((v.z - szp) / 0.3, 2));
      v.y -= sink * SM(yn, 0.3, 1);
      shade[i] = (0.46 + 0.54 * Math.pow(k, 0.55)) * (0.8 + 0.2 * Math.min(1, (v.y + b) / 0.14)) * (0.95 + 0.07 * fat * top) * (1 - 2.2 * sink * top);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    g.setAttribute('shade', new THREE.BufferAttribute(shade, 1));
    g.computeVertexNormals();
    PB.set(key, g);
    return g.clone();
  }
  function channelSofa(w, o = {}) {
    const d = o.d || 0.98, mk = o.mk || 'textile', col = C(o.shell || 0xb7ab9c, 0.015);
    const seatH = 0.43, th = w < 1.2 ? 0.2 : 0.25, backH = o.backH || 0.76, armH = o.armH || 0.6, Rc = Math.min(o.Rc || 0.3, w / 2 - th / 2 - 0.005);
    const xs = w / 2 - th / 2, zb = -d / 2 + th / 2, zf = d / 2 - 0.34, zi = zb + th / 2, xi = xs - th / 2;
    // --- assise
    const bw = w - 0.1, bd = d - 0.16, nCol = Math.max(3, Math.round(bw / 0.215)), bz = d / 2 - bd / 2;
    const gb = tuftBlock(bw, seatH - 0.02, bd, 0.115, nCol, w < 1.2 ? 3 : 4, 0.05, w > 1.7 ? [[-0.47, 0.1, 0.014], [0.5, 0.06, 0.01]] : [[0, 0.08, 0.012]]);
    { // ombre de contact au pied du dossier, des accoudoirs et sous les coussins
      const pa = gb.attributes.position, sa = gb.attributes.shade;
      for (let i = 0; i < pa.count; i++) { if (pa.getY(i) < 0.08) continue; const zz = pa.getZ(i) + bz, ax = Math.abs(pa.getX(i)); sa.setX(i, sa.getX(i) * (0.66 + 0.34 * SM(zz, zi, zi + 0.3)) * (zz < zf + 0.1 ? 0.7 + 0.3 * SM(xi - ax, 0, 0.16) : 1)); }
    }
    gb.translate(0, 0.02 + (seatH - 0.02) / 2, bz); put(mk, gb, col);
    // --- coque dossier + accoudoirs : section arrondie balayée le long d'un U (axe à th/2 du contour extérieur)
    const L1 = zf - (zb + Rc), La = Math.PI * Rc / 2, L2 = 2 * (xs - Rc), LT = 2 * L1 + 2 * La + L2;
    const at = (s) => {   // abscisse curviligne → point de l'axe, normale extérieure
      if (s < L1) return [-xs, zf - s, -1, 0];
      s -= L1; if (s < La) { const t = s / Rc; return [-xs + Rc - Rc * Math.cos(t), zb + Rc - Rc * Math.sin(t), -Math.cos(t), -Math.sin(t)]; }
      s -= La; if (s < L2) return [-xs + Rc + s, zb, 0, -1];
      s -= L2; if (s < La) { const t = s / Rc; return [xs - Rc + Rc * Math.sin(t), zb + Rc - Rc * Math.cos(t), Math.sin(t), -Math.cos(t)]; }
      s -= La; return [xs, zb + Rc + s, 1, 0];
    };
    // abscisses : serrées au bout des accoudoirs (calotte) et dans les deux virages, lâches sur les parties droites
    const capL = Math.min(0.2, L1 - 0.03), SS = [], seg = (s0, s1, m) => { for (let k = 0; k < m; k++) SS.push(s0 + (s1 - s0) * k / m); };
    seg(0, capL, 9); seg(capL, L1, Math.max(2, Math.round((L1 - capL) / 0.06))); seg(L1, L1 + La, 16); seg(L1 + La, L1 + La + L2, Math.round(L2 / 0.07)); seg(L1 + La + L2, LT - L1, 16); seg(LT - L1, LT - capL, Math.max(2, Math.round((L1 - capL) / 0.06))); seg(LT - capL, LT, 9); SS.push(LT);
    const NS = SS.length - 1, NT = 28, pos = [], sh = [], idx = [], e = 0.6, pipe = [], ph = R() * 6;
    for (let i = 0; i <= NS; i++) {
      const s = SS[i], [px, pz, nx, nz] = at(Math.min(LT - 1e-6, s));
      const de = Math.min(s, LT - s);                                  // distance au bout d'accoudoir
      const cap = de >= capL ? 1 : Math.sqrt(Math.max(0, 1 - Math.pow(1 - de / capL, 2)));
      const arm = SM(de, 0, L1 + La * 0.9);   // 0 au bout de l'accoudoir, 1 au dossier
      // le rembourrage n'est jamais tendu au cordeau : la crête ondule de quelques millimètres
      const H = (armH + (backH - armH) * arm) * (0.62 + 0.38 * cap) + 0.005 * Math.sin(s * 5.1 + ph) + 0.003 * Math.sin(s * 12.7 + 2 * ph), hw = (th / 2) * (0.25 + 0.75 * cap), y0 = 0.02, hh = (H - y0) / 2;
      for (let j = 0; j <= NT; j++) {
        const a = 2 * Math.PI * j / NT, ca = Math.cos(a), sa = Math.sin(a);
        let ox = hw * Math.sign(ca) * Math.pow(Math.abs(ca), e), oy = hh * Math.sign(sa) * Math.pow(Math.abs(sa), e);
        // ventre du rembourrage (plus gonflé à mi-hauteur côté assise et en haut), tissu qui vit
        ox *= 1 + 0.07 * Math.max(0, sa) * Math.sin(Math.PI * Math.min(1, Math.max(0, (oy + hh) / (2 * hh)))) + 0.05 * (ca < 0 ? 1 : 0.4) * Math.pow(1 - sa * sa, 2);
        ox += (j === NT ? 0 : 0.0035) * Math.sin(s * 8.3 + a * 2 + ph) * Math.sin(a * 3 + s * 4.1) * cap;
        // le haut penche un peu vers l'extérieur (dossier incliné), l'intérieur du haut est plus rond
        const lean = 0.04 * Math.max(0, oy / hh) * arm;
        const yy = y0 + hh + oy;
        pos.push(px + nx * (ox + lean), yy, pz + nz * (ox + lean));
        // ombre propre : pied de coque, face intérieure au ras de l'assise et derrière les coussins
        const inner = ca < 0 ? SM(-ca, 0, 0.5) : 0;
        sh.push((0.7 + 0.3 * Math.min(1, yy / 0.3)) * (1 - inner * (0.3 * (1 - SM(yy, seatH + 0.02, seatH + 0.2)) + 0.1 * arm * (1 - SM(yy, seatH + 0.2, seatH + 0.42)))) * (0.975 + 0.025 * Math.sin(s * 6 + a * 3 + ph)));
        if (j === Math.round(NT * 0.115)) pipe.push(new V3(px + nx * (ox + lean + 0.002), yy + 0.002, pz + nz * (ox + lean + 0.002)));
      }
    }
    for (let i = 0; i < NS; i++) for (let j = 0; j < NT; j++) { const a0 = i * (NT + 1) + j, b0 = a0 + NT + 1; idx.push(a0, a0 + 1, b0, a0 + 1, b0 + 1, b0); }
    // bouts d'accoudoir fermés
    for (const [i0, flip] of [[0, false], [NS, true]]) { const c0 = pos.length / 3, [px, pz] = at(i0 ? LT - 1e-6 : 0); pos.push(px, 0.3, pz); sh.push(0.8); for (let j = 0; j < NT; j++) { const a0 = i0 * (NT + 1) + j; if (flip) idx.push(c0, a0, a0 + 1); else idx.push(c0, a0 + 1, a0); } }
    const gs = new THREE.BufferGeometry(); gs.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); gs.setAttribute('shade', new THREE.Float32BufferAttribute(sh, 1)); gs.setIndex(idx); gs.computeVertexNormals();
    put(mk, gs, col);
    // passepoil le long de l'arête haute extérieure
    put(mk, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pipe.slice(3, -3), false, 'centripetal'), 110, 0.0045, 4, false), col.map((v) => v * 0.82));
    // --- coussins libres, même tissu : deux dans chaque angle, le petit affalé contre le grand, tous écrasés sur l'assise
    const pc = C(o.shell || 0xb7ab9c, 0.03), sT = seatH + 0.008, planes = [[0, 1, 0, sT], [0, 0.12, 1, zi - 0.012 + 0.12 * 0.6]];
    const P = w > 1.7
      ? [[-xi + 0.29, -0.1, 0.5, 0, 0.22, 0.24, 0.34, 0.05, 0.3], [-xi + 0.58, 0.06, 0.42, 0, 0.2, 0.5, 0.08, 0.16, 0], [xi - 0.28, -0.105, 0.48, 0, 0.21, 0.2, -0.32, -0.07, 0.22], [xi - 0.6, 0.07, 0.5, 0.3, 0.18, 0.58, -0.1, -0.1, 0]]
      : w > 1.2 ? [[-xi + 0.3, -0.1, 0.5, 0, 0.2, 0.2, 0.3, 0.03, 0.25], [xi - 0.3, -0.1, 0.46, 0, 0.19, 0.24, -0.3, -0.04, 0]]
      : o.pillowC ? [[0.03, -0.06, 0.42, 0, 0.18, 0.3, 0.1, 0.05, 0.2]] : [];
    const ctr = P.map(([x, z, s, hh, t, tilt]) => [x, sT + ((hh || s) / 2) * Math.cos(tilt) - 0.012, z]);
    P.forEach(([x, z, s, hh, t, tilt, ry, roll, chop], i) => {
      const big = i % 2 === 0 && P.length > 2, nb = big ? ctr[i + 1] : null;
      softPillow(o.pillowC ? 'textile' : mk, x + jit(0.02), ctr[i][1], z + jit(0.015), s, t, o.pillowC ? C(o.pillowC, 0.03) : i % 2 ? pc.map((v) => v * 0.965) : pc,
        { h: hh || 0, tilt: tilt + jit(0.05), ry: ry + jit(0.06), roll: roll + jit(0.03), chop, planes, n: big ? 22 : 18, press: nb ? [{ c: [nb[0], nb[1] + 0.02, nb[2] - 0.06], r: 0.27, dir: [0, -0.2, -1], k: 0.035 }] : null });
    });
    contact(0, 0, w + 0.15, d + 0.15);
  }

  // ------------------------------------------------------------------ canapé 3 places
  // o.mk : 'textile' (lin), 'boucle', 'velvet' ; o.base : 'plinth' (socle chêne) | 'legs' (pieds fuselés) ;
  // o.col, o.pillows, o.plaid (couleurs), o.d (profondeur)
  function sofa(w, o = {}) {
    if (o.style !== 'classic') return channelSofa(w, { ...o, mk: 'boucle' });
    const d = o.d || 0.95, mk = o.mk || 'textile', col = C(o.col || PAL.linenSand, 0.02), colD = col.map((v) => v * 0.9);
    const base = o.base || (mk === 'velvet' ? 'legs' : 'plinth');
    const y0 = base === 'legs' ? 0.15 : 0.07, armW = 0.17, armH = 0.62, deckT = 0.17, seatT = 0.165, backTop = 0.8;
    const oak = C(0xeadbc6, 0.03);
    if (base === 'legs') {
      const n = w > 2.0 ? 3 : 2;
      for (const sz of [-1, 1]) for (let i = 0; i < n; i++) {
        const x = -w / 2 + 0.09 + (w - 0.18) * i / (n - 1), z = sz * (d / 2 - 0.09);
        strut('oak', [x + 0.01 * Math.sign(x || 1), 0, z + 0.012 * sz], [x, y0 + 0.01, z], 0.016, 0.024, oak, { seg: 14 });
      }
    } else {
      rbb('oak', -w / 2 + 0.05, w / 2 - 0.05, 0, y0, -d / 2 + 0.07, d / 2 - 0.08, 0.008, oak, { seg: 2 });
    }
    // caisse (assise ferme) et dossier : volumes tapissés à grands rayons
    const colS = col.map((v) => v * 0.74);   // caisse et dossier : dans l'ombre des coussins
    rb(mk, w - 2 * armW + 0.04, deckT, d - 0.06, 0.05, 0, y0 + deckT / 2, 0.01, colS, { seg: 4 });
    rb(mk, w - 2 * armW + 0.04, backTop - y0, 0.17, 0.06, 0, y0 + (backTop - y0) / 2, -d / 2 + 0.085, colD, { seg: 4 });
    // accoudoirs : rayon 7 cm, passepoil sur la face avant
    for (const s of [-1, 1]) {
      const ax = s * (w / 2 - armW / 2), ah = armH - y0;
      rb(mk, armW, ah, d, 0.07, ax, y0 + ah / 2, 0, col, { seg: 5 });
    }
    // coussins d'assise : bombés, affaissés là où ils se touchent, légèrement décalés
    const n = w > 2.0 ? 3 : 2, inner = w - 2 * armW, cw = inner / n, sTop = y0 + deckT;
    for (let i = 0; i < n; i++) {
      const x = -inner / 2 + cw * (i + 0.5) + jit(0.006);
      cushion(mk, cw - 0.006, seatT, d - 0.25, x, sTop + seatT / 2 - 0.006, 0.085 + jit(0.008), C(o.col || PAL.linenSand, 0.045), { r: seatT * 0.42, puff: 0.42, sag: 0.2, crease: 0.11, seed: i + 1, rz: jit(0.012), e: 0.17, wob: 0.002 });
    }
    // coussins de dossier libres, inclinés de 12°, bombés vers l'avant
    for (let i = 0; i < n; i++) {
      const x = -inner / 2 + cw * (i + 0.5) + jit(0.008), hgt = 0.5;
      cushion(mk, cw - 0.012, 0.19, hgt, x, sTop + seatT + hgt / 2 - 0.03, -d / 2 + 0.255, C(o.col || PAL.linenSand, 0.055), { r: 0.085, rx: -Math.PI / 2 + 0.21 + jit(0.04), rz: jit(0.03), puff: 0.62, sag: 0.1, crease: 0.13, seed: i + 5, e: 0.2, e1: 0.3, wob: 0.0025 });
    }
    // coussins décoratifs (coins pincés, plis), plaid jeté sur un accoudoir
    const pc = o.pillows || [PAL.terracotta, PAL.linenOat, PAL.ochre];
    const spots = [[-inner / 2 + 0.26, 0.5, 0.14], [-inner / 2 + 0.6, 0.44, -0.12], [inner / 2 - 0.3, 0.5, -0.08], [inner / 2 - 0.62, 0.42, 0.18]];
    pc.forEach((cc, i) => { const [x, s, rz] = spots[i % spots.length]; softPillow(o.pillowMk || (mk === 'velvet' ? 'velvet' : 'textile'), x + jit(0.03), sTop + seatT + s / 2 - 0.045, -d / 2 + 0.44 + (i % 2) * 0.06, s, 0.17, C(cc, 0.03), { rx: -Math.PI / 2 + 0.34 + jit(0.1), rz: rz * 0.6 + jit(0.05), ry: jit(0.12) }); });
    if (o.plaid !== false) plaidOverArm(w / 2 - armW / 2, armH, armW, -0.12, 0.38, C(o.plaid || PAL.rust, 0.03));
    contact(0, 0, w + 0.15, d + 0.15);
  }

  // ------------------------------------------------------------------ chaise « wishbone »
  function chair(o = {}) {
    const oak = C(o.wood || 0xd4b48c, 0.04), sh = 0.44, hw = 0.215;
    // pieds avant fuselés, pieds arrière cintrés qui montent jusqu'à l'arc du dossier
    for (const s of [-1, 1]) {
      strut('oak', [s * (hw + 0.008), 0, 0.215], [s * hw, sh - 0.02, 0.195], 0.015, 0.019, oak, { seg: 12 });
      tube('oak', [[s * (hw - 0.005), 0, -0.235], [s * hw, 0.22, -0.205], [s * hw, sh - 0.02, -0.18], [s * (hw - 0.01), 0.6, -0.19], [s * (hw - 0.03), 0.67, -0.205]], 0.0175, oak, { seg: 16, rad: 7 });
    }
    // arc du dossier : lamellé cintré en U, section 5 × 2,2 cm, accoudoirs qui redescendent vers l'avant
    const arc = []; for (let k = 0; k <= 20; k++) { const t = k / 20, a = -Math.PI / 2 + Math.PI * t; arc.push([Math.sin(a) * (hw + 0.025), 0.7 - 0.05 * Math.pow(Math.abs(Math.sin(a)), 3), -0.205 - Math.cos(a) * 0.075 + 0.11 * Math.pow(Math.abs(Math.sin(a)), 6)]); }
    ribbon('oak', arc, 0.05, 0.022, oak, { steps: 32 });
    // dosseret en Y : planche cintrée de l'arc au cadre d'assise
    ribbon('oak', [[0, sh + 0.02, -0.19], [0, 0.56, -0.235], [0, 0.69, -0.28]], 0.06, 0.016, oak, { steps: 12 });
    // cadre d'assise et traverses basses
    for (const s of [-1, 1]) { rbb('oak', s * hw - 0.012, s * hw + 0.012, sh - 0.06, sh - 0.01, -0.19, 0.2, 0.004, oak); }
    rbb('oak', -hw, hw, sh - 0.06, sh - 0.01, 0.185, 0.205, 0.004, oak); rbb('oak', -hw, hw, sh - 0.06, sh - 0.01, -0.2, -0.18, 0.004, oak);
    for (const s of [-1, 1]) strut('oak', [s * hw, 0.17, 0.2], [s * hw, 0.17, -0.215], 0.008, 0.008, oak, { seg: 8, ...{} });
    // assise en corde de papier tressée (natté du jute, teinte paille), légèrement creusée
    sq('jute', hw + 0.008, 0.018, 0.205, 0, sh - 0.012, 0.005, C(o.seat || PAL.straw, 0.05), { e1: 0.25, e2: 0.1, sag: 0.35, nu: 26, nv: 8 });
    if (o.cushion) pillow(0, sh + 0.03, 0.01, 0.38, 0.05, C(o.cushion));
    contact(0, 0, 0.6, 0.6, 0.007);
  }

  // ------------------------------------------------------------------ table rectangulaire en chêne massif
  function rectTable(w = 1.6, d = 0.9, o = {}) {
    const oak = C(o.wood || 0xf3e6d3, 0.03), h = 0.75, tt = 0.035;
    slab('oak', w, d, tt, 0.012, 0, h - tt, 0, oak, { bevel: 0.01, curve: 4 });        // plateau à chanfrein
    const ix = w / 2 - 0.07, iz = d / 2 - 0.07;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) strut('oak', [sx * (ix - 0.012), 0, sz * (iz - 0.012)], [sx * ix, h - tt, sz * iz], 0.022, 0.032, oak, { square: true });
    // ceinture en retrait de 2 cm
    rbb('oak', -ix + 0.02, ix - 0.02, h - tt - 0.08, h - tt, -iz - 0.008, -iz + 0.012, 0.004, oak);
    rbb('oak', -ix + 0.02, ix - 0.02, h - tt - 0.08, h - tt, iz - 0.012, iz + 0.008, 0.004, oak);
    for (const sx of [-1, 1]) rbb('oak', sx * ix - 0.01, sx * ix + 0.01, h - tt - 0.08, h - tt, -iz + 0.02, iz - 0.02, 0.004, oak);
    contact(0, 0, w + 0.6, d + 0.9);
  }

  // ------------------------------------------------------------------ robinet de cuisine col de cygne
  function kitchenTap(x, y, z, mk = 'black') {
    K.lathe(mk, [[0, 0], [0.026, 0], [0.026, 0.006], [0.021, 0.012], [0.019, 0.07], [0, 0.07]], x, y, z, WHITE, { seg: 24 });
    const arc = []; for (let k = 0; k <= 18; k++) { const a = Math.PI * k / 18; arc.push([x, y + 0.07 + 0.2 + Math.sin(a) * 0.1, z + 0.1 - Math.cos(a) * 0.1]); }
    tube(mk, [[x, y + 0.06, z], [x, y + 0.22, z], ...arc.slice(1), [x, y + 0.24, z + 0.2]], 0.0115, WHITE, { seg: 60, rad: 12 });
    K.cyl(mk, 0.014, 0.0135, 0.03, x, y + 0.225, z + 0.2, WHITE, { seg: 16 });             // mousseur
    // mitigeur latéral : levier fin
    K.cyl(mk, 0.017, 0.017, 0.03, x + 0.022, y + 0.05, z, WHITE, { rz: Math.PI / 2, seg: 16 });
    tube(mk, [[x + 0.035, y + 0.05, z], [x + 0.05, y + 0.08, z - 0.01], [x + 0.055, y + 0.13, z - 0.02]], 0.0045, WHITE, { seg: 10, rad: 8 });
  }

  // ------------------------------------------------------------------ salle de bains
  // poignée barre fine sur deux plots (cuisine, placards, meuble vasque) : façade au plan z, longueur L
  function barHandle(mk, x, y, z, L, o = {}) {
    const vert = !!o.vertical, r = o.r || 0.006, off = o.off || 0.028;
    const a = vert ? [x, y - L / 2, z + off] : [x - L / 2, y, z + off], b = vert ? [x, y + L / 2, z + off] : [x + L / 2, y, z + off];
    K.cyl(mk, r, r, L, vert ? x : x - L / 2, vert ? y - L / 2 : y, z + off, WHITE, vert ? { seg: 10 } : { rz: -Math.PI / 2, seg: 10 });
    for (const p of [a, b]) { const px = vert ? p[0] : p[0] + (p === a ? 0.012 : -0.012), py = vert ? p[1] + (p === a ? 0.012 : -0.012) : p[1]; K.cyl(mk, r * 0.8, r * 0.8, off, px, py, z, WHITE, { rx: Math.PI / 2, seg: 8 }); }
  }
  // meuble vasque suspendu en chêne : deux tiroirs (joints de 3 mm, prise de main en creux), plan en pierre,
  // vasque semi-encastrée tournée (paroi fine, lèvre arrondie), mitigeur sur plan
  function vanity(w, o = {}) {
    const oak = C(o.wood || 0xf1e2cc, 0.03), d = 0.47, y0 = 0.36, y1 = 0.82, tt = 0.02, g = 0.0015;
    rbb('oak', -w / 2, w / 2, y0, y1 - tt, 0, d - 0.02, 0.004, oak.map((v) => v * 0.8));          // caisson (visible dans les joints)
    const ym = y0 + (y1 - tt - y0) * 0.5;
    for (const [a, b] of [[y0, ym], [ym, y1 - tt]]) {
      rbb('oak', -w / 2 + g, w / 2 - g, a + g, b - g - 0.018, d - 0.02, d, 0.003, oak, { seg: 2 });
      K.box('black', -w / 2 + 0.02, w / 2 - 0.02, b - g - 0.018, b - g, d - 0.03, d - 0.018, C(0x2a2622));   // creux de prise de main
    }
    slab('travertine', w + 0.01, d + 0.01, tt, 0.006, 0, y1 - tt, d / 2, C(0xffffff), { bevel: 0.004 });
    const bx = o.basinX || 0, br = Math.min(0.2, w * 0.28), bz = d / 2 + 0.01, by = y1;
    // vasque : profil extérieur puis intérieur (épaisseur 8 mm), bonde inox
    // vasque à poser : galbe extérieur, lèvre arrondie, paroi de 8 mm, fond creusé vers la bonde
    K.lathe('ceramic', [[0, 0.002], [br * 0.5, 0.002], [br * 0.82, 0.02], [br * 0.97, 0.07], [br, 0.125], [br - 0.004, 0.133], [br - 0.009, 0.128], [br - 0.012, 0.08], [br * 0.8, 0.035], [br * 0.45, 0.018], [0.025, 0.012], [0, 0.011]], bx, by, bz, C(0xf7f5f0), { seg: 64 });
    K.cyl('steel', 0.02, 0.02, 0.003, bx, by + 0.011, bz, C(0x9a9da0), { seg: 20 });
    // mitigeur : corps fuselé, bec, levier
    const mx = bx, mz = bz - br - 0.045, mk = o.tap || 'black', th = 0.3;   // mitigeur haut (vasque à poser)
    K.lathe(mk, [[0, 0], [0.024, 0], [0.024, 0.004], [0.017, 0.012], [0.016, th], [0, th]], mx, by, mz, WHITE, { seg: 24 });
    tube(mk, [[mx, by + th - 0.02, mz], [mx, by + th - 0.005, mz + 0.06], [mx, by + th - 0.03, mz + 0.15]], 0.009, WHITE, { seg: 16, rad: 10 });
    tube(mk, [[mx, by + th - 0.01, mz], [mx, by + th + 0.02, mz - 0.03], [mx, by + th + 0.025, mz - 0.075]], 0.0045, WHITE, { seg: 10, rad: 8 });
    // flacons, serviette roulée
    K.cyl('stoneware', 0.03, 0.028, 0.14, w / 2 - 0.09, y1, 0.12, C(0x8e6a4a)); K.cyl('black', 0.009, 0.009, 0.035, w / 2 - 0.09, y1 + 0.14, 0.12);
    if (w > 0.7) for (let i = 0; i < 2; i++) K.cyl('textile', 0.048, 0.048, 0.22, -w / 2 + 0.16, y1 + 0.048, 0.1 + i * 0.1, C(o.towel || PAL.linenOat, 0.03), { rz: Math.PI / 2, seg: 18 });
    contact(0, d / 2, w + 0.1, d + 0.1);
  }
  // serviette suspendue sur une barre (rayon de la barre rb) : retombée avant et arrière, plis verticaux
  function hangingTowel(x, y, z, w, drop, col, o = {}) {
    const rr = (o.rb || 0.01) + 0.006, dropB = drop * (o.back ?? 0.85), ph = R() * 6;
    const prof = (v) => { // v ∈ [0, 1] : bas avant → dessus de la barre → bas arrière
      const L = drop + Math.PI * rr + dropB, s = v * L;
      if (s < drop) return [y - drop + s, rr];
      if (s < drop + Math.PI * rr) { const a = (s - drop) / rr; return [y + Math.sin(a) * rr, Math.cos(a) * rr]; }
      return [y - (s - drop - Math.PI * rr), -rr];
    };
    K.thickSheet('textile', 14, 40, (u, v) => {
      const [py, pz] = prof(v), hang = Math.min(1, Math.max(0, (y - py) / drop)), xx = (u - 0.5) * w;
      const fold = 0.006 * hang * Math.sin(u * 11 + ph) + 0.003 * Math.sin(u * 23 + v * 4);
      return [x + xx * (1 + 0.02 * hang), py, z + pz + Math.sign(pz) * fold];
    }, col, 0.006, 'u0 u1 v0 v1');
  }
  // sèche-serviettes échelle noir mat sur mur z = 0, deux serviettes de bain pliées en deux
  function towelRail(w = 0.5, h = 1.2, y0 = 0.25, col = PAL.linenOat) {
    K.walk(() => {
      for (const s of [-1, 1]) { K.cyl('black', 0.013, 0.013, h, s * w / 2, y0, 0.06, WHITE, { seg: 12 }); for (const yy of [y0 + 0.1, y0 + h - 0.1]) K.cyl('black', 0.008, 0.008, 0.06, s * w / 2, yy, 0, WHITE, { rx: Math.PI / 2, seg: 8 }); }
      for (let y = y0 + 0.08; y < y0 + h - 0.02; y += 0.11) K.cyl('black', 0.009, 0.009, w, -w / 2, y, 0.06, WHITE, { rz: -Math.PI / 2, seg: 10 });
      const c = C(col, 0.03);
      hangingTowel(0, y0 + h - 0.13, 0.06, w - 0.07, 0.42, c, { rb: 0.009 });
      hangingTowel(0.01, y0 + h - 0.46, 0.06, w - 0.09, 0.3, c.map((v) => v * 0.94), { rb: 0.009, back: 0.7 });
    });
  }
  // colonne de douche : pommeau de tête carré-arrondi sur bras mural, barre thermostatique, douchette
  function showerSet(x, z, y = 2.15) {
    K.walk(() => {
      tube('black', [[x, y + 0.2, z - 0.35], [x, y + 0.2, z - 0.05]], 0.01, WHITE, { seg: 2, rad: 10 });
      K.cyl('black', 0.13, 0.13, 0.01, x, y + 0.185, z, WHITE, { seg: 48 });
      K.cyl('steel', 0.118, 0.118, 0.002, x, y + 0.183, z, C(0x3a3b3d), { seg: 48 });              // plaque de buses
      // barre thermostatique 30 cm : deux poignées moletées
      const by = 1.05, bz = z - 0.35 + 0.045;
      K.cyl('black', 0.024, 0.024, 0.3, x - 0.15, by, bz, WHITE, { rz: -Math.PI / 2, seg: 18 });
      for (const s of [-1, 1]) K.cyl('black', 0.03, 0.03, 0.05, x + s * 0.17 - 0.025, by, bz, WHITE, { rz: -Math.PI / 2, seg: 18 });
      for (const s of [-1, 1]) K.cyl('black', 0.012, 0.012, 0.045, x + s * 0.12, by, bz - 0.045, WHITE, { rx: Math.PI / 2, seg: 10 });
      // colonne montante vers le bras, douchette sur support
      K.cyl('black', 0.011, 0.011, y + 0.2 - by - 0.02, x, by + 0.02, bz - 0.02, WHITE, { seg: 10 });
      tube('black', [[x + 0.15, by + 0.35, bz], [x + 0.15, by + 0.55, bz + 0.01]], 0.013, WHITE, { seg: 4, rad: 10 });
      K.cyl('black', 0.035, 0.03, 0.03, x + 0.15, by + 0.55, bz + 0.01, WHITE, { seg: 20 });
    });
  }

  // ------------------------------------------------------------------ baignoire encastrée (tablier carrelé)
  // L × W (x × z local), dos au mur z = −W/2 ; cuve en céramique émaillée : bords arrondis (rayon 12 cm en plan,
  // 6 cm en fond), plage fine de 3 cm, trop-plein et bonde inox, bec mural et mitigeur sur la plage côté mur
  function bathTub(L = 1.7, W = 0.75) {
    const h = 0.56, rim = 0.035, ce = C(0xf7f6f2), depth = 0.42;
    K.box('zellige', -L / 2, L / 2, 0.06, h - 0.03, W / 2 - 0.01, W / 2, C(0xffffff));         // tablier
    K.box('lacquer', -L / 2, L / 2, 0, 0.06, -W / 2, W / 2 - 0.04, C(0x4a4744));
    // plage : anneau extrudé (rectangle extérieur, découpe aux angles arrondis)
    const rr = (sh, hw, hd, r) => { sh.moveTo(-hw + r, -hd); sh.lineTo(hw - r, -hd); sh.quadraticCurveTo(hw, -hd, hw, -hd + r); sh.lineTo(hw, hd - r); sh.quadraticCurveTo(hw, hd, hw - r, hd); sh.lineTo(-hw + r, hd); sh.quadraticCurveTo(-hw, hd, -hw, hd - r); sh.lineTo(-hw, -hd + r); sh.quadraticCurveTo(-hw, -hd, -hw + r, -hd); return sh; };
    const ia = L / 2 - rim, ib = W / 2 - rim, rc = 0.12;
    const outer = rr(new THREE.Shape(), L / 2, W / 2, 0.01), hole = rr(new THREE.Path(), ia, ib, rc); outer.holes.push(hole);
    const deck = new THREE.ExtrudeGeometry(outer, { depth: 0.024, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2, curveSegments: 10 });
    deck.rotateX(-Math.PI / 2); deck.translate(0, h - 0.028, 0); put('ceramic', deck, ce);
    // cuve : anneaux de superellipse qui se resserrent avec la profondeur, fond plat légèrement en pente vers la bonde
    const nu = 96, rings = [], sup = (t, a, b, e) => { const c = Math.cos(t), sn = Math.sin(t); return [a * Math.sign(c) * Math.pow(Math.abs(c), e), b * Math.sign(sn) * Math.pow(Math.abs(sn), e)]; };
    const prof = []; for (let k = 0; k <= 10; k++) { const t = k / 10, ang = t * Math.PI / 2; prof.push([1 - (1 - Math.cos(ang)) * 0.075 / 0.34 - 0.03 * t, -Math.sin(ang) * 0.075 - (depth - 0.075) * 0]); }
    const levels = [[1, 0], [0.995, -0.04], [0.985, -0.2], [0.97, -(depth - 0.07)], ...prof.slice(1).map(([s0, y]) => [0.97 * s0, -(depth - 0.07) + y]), [0.55, -depth], [0.2, -depth - 0.004], [0.0, -depth - 0.006]];
    const pos = [], idx = [];
    for (let j = 0; j < levels.length; j++) { const [sc, y] = levels[j], e = 0.22 + 0.4 * (1 - sc); for (let i = 0; i <= nu; i++) { const [px, pz] = sup(2 * Math.PI * i / nu, ia * sc, ib * sc, e); pos.push(px, h - 0.028 + y, pz); } }
    // orientation : chaque face regarde vers l'intérieur de la cuve et vers le haut (parois et fond visibles)
    const tri = (p, q, r) => {
      const P = (k) => new V3(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]), A = P(p), B = P(q), Cc = P(r);
      const n = B.clone().sub(A).cross(Cc.clone().sub(A)), c = A.add(B).add(Cc).multiplyScalar(1 / 3);
      if (n.dot(new V3(-c.x / ia, 0.6, -c.z / ib)) < 0) idx.push(p, r, q); else idx.push(p, q, r);
    };
    for (let j = 0; j < levels.length - 1; j++) for (let i = 0; i < nu; i++) { const a0 = j * (nu + 1) + i, b0 = a0 + nu + 1; tri(a0, a0 + 1, b0); tri(a0 + 1, b0 + 1, b0); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); put('ceramic', g, ce);
    // bonde, trop-plein (paroi de tête), bec mural et mitigeur
    K.cyl('steel', 0.03, 0.03, 0.004, L / 2 - 0.25, h - 0.028 - depth - 0.002, 0, C(0xd6d9dc), { seg: 24 });
    K.cyl('steel', 0.028, 0.028, 0.006, L / 2 - rim - 0.012, h - 0.12, 0, C(0xd6d9dc), { rz: Math.PI / 2, seg: 24 });
    K.walk(() => {
      tube('black', [[L / 2 - 0.3, h + 0.16, -W / 2], [L / 2 - 0.3, h + 0.16, -W / 2 + 0.16], [L / 2 - 0.3, h + 0.13, -W / 2 + 0.19]], 0.011, WHITE, { seg: 12, rad: 10 });
      K.cyl('black', 0.03, 0.03, 0.012, L / 2 - 0.3, h + 0.16, -W / 2, WHITE, { rx: Math.PI / 2, seg: 20 });
      K.cyl('black', 0.024, 0.024, 0.03, L / 2 - 0.45, h + 0.16, -W / 2, WHITE, { rx: Math.PI / 2, seg: 20 }); K.cyl('black', 0.006, 0.006, 0.06, L / 2 - 0.45, h + 0.16, -W / 2 + 0.03, WHITE, { rx: Math.PI / 2, seg: 8 });
    });
    K.foldedThrow(-L / 2 + 0.22, h, -W / 2 + 0.02, 0.26, 0.05, C(PAL.linenOat));
    const vh = K.vase(-L / 2 + 0.03, h, W / 2 - 0.03, 2, 0x3d3a36); K.branches(-L / 2 + 0.03, h + vh, W / 2 - 0.03, 0.35, 4);
  }

  // ------------------------------------------------------------------ petites assises, îlot, tapis
  // solide de révolution avec ombre propre : prof = [[r, y, ombre]], f(θ, j) → [facteur de rayon, facteur d'ombre]
  function revolve(mk, prof, col, seg = 40, f = null, x = 0, z = 0) {
    const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), seg), p = g.attributes.position, m = prof.length, sh = new Float32Array(p.count);
    for (let k = 0; k < p.count; k++) {
      const j = k % m, th = 2 * Math.PI * Math.floor(k / m) / seg, [kr, ks] = f ? f(th, j) : [1, 1];
      p.setX(k, p.getX(k) * kr); p.setZ(k, p.getZ(k) * kr); sh[k] = (prof[j][2] ?? 1) * ks;
    }
    g.computeVertexNormals();
    // la couture de la révolution (premier et dernier méridien confondus) garde une normale continue
    { const nr = g.attributes.normal; for (let j = 0; j < m; j++) { const a = j, b = seg * m + j, nx = nr.getX(a) + nr.getX(b), ny = nr.getY(a) + nr.getY(b), nz = nr.getZ(a) + nr.getZ(b), L = Math.hypot(nx, ny, nz) || 1; nr.setXYZ(a, nx / L, ny / L, nz / L); nr.setXYZ(b, nx / L, ny / L, nz / L); } }
    g.setAttribute('shade', new THREE.BufferAttribute(sh, 1)); g.deleteAttribute('uv');
    g.translate(x, 0, z); put(mk, g, col);
  }
  // tabouret de bar : quatre pieds fuselés évasés, repose-pieds en acier, galette de chêne tournée, coussin de cuir
  // bombé au bord roulé, un peu creusé au centre (on s'y est assis)
  function barStool(o = {}) {
    const oak = C(o.wood || 0xfaf3ea, 0.04), sh = 0.65, ph = R() * 6.3;
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4, ca = Math.cos(a), sa = Math.sin(a); strut('oak', [ca * 0.205, 0, sa * 0.205], [ca * 0.118, sh - 0.045, sa * 0.118], 0.0125, 0.02, oak, { seg: 12 }); }
    K.torus('black', 0.178, 0.0075, 0, 0.245, 0, WHITE, { seg: 40, rad: 8 });
    K.lathe('oak', [[0, sh - 0.052], [0.125, sh - 0.052], [0.166, sh - 0.042], [0.176, sh - 0.032], [0.177, sh - 0.024], [0.172, sh - 0.017], [0, sh - 0.017]], 0, 0, 0, oak, { seg: 40 });
    const y0 = sh - 0.017;
    revolve('textile', [[0.155, y0 - 0.002, 0.55], [0.168, y0 + 0.002, 0.6], [0.1745, y0 + 0.011, 0.86], [0.175, y0 + 0.02, 0.97], [0.17, y0 + 0.03, 1], [0.157, y0 + 0.038, 1.02], [0.13, y0 + 0.043, 1], [0.085, y0 + 0.0425, 0.96], [0.04, y0 + 0.04, 0.93], [0, y0 + 0.039, 0.92]],
      C(o.seat || PAL.cognac, 0.05), 40, (th, j) => [1 + 0.005 * Math.sin(th * 3 + ph) + (j > 4 ? 0 : 0.003 * Math.sin(th * 17 + ph)), 0.97 + 0.03 * Math.sin(th * 2 + ph)]);
    K.torus('textile', 0.1735, 0.0028, 0, y0 + 0.004, 0, C(o.seat || PAL.cognac, 0.05).map((v) => v * 0.7), { seg: 48, rad: 4 });
    contact(0, 0, 0.5, 0.5);
  }
  // pouf rond : flanc ventru tassé vers le bas, quatre coutures verticales en creux, dessus bombé cerné d'un passepoil
  function pouf(r = 0.23, h = 0.42, col = PAL.boucle, mk = 'boucle') {
    const c = C(col, 0.02), ph = R() * 6.3;
    const prof = [[0, 0.004, 0.4], [r * 0.82, 0.004, 0.45], [r * 0.95, 0.012, 0.55], [r * 1.02, h * 0.1, 0.74], [r * 1.05, h * 0.25, 0.88], [r * 1.045, h * 0.45, 0.96], [r * 1.02, h * 0.65, 1], [r * 0.985, h * 0.82, 1], [r * 0.955, h * 0.915, 0.9], [r * 0.93, h * 0.945, 0.72], [r * 0.91, h * 0.965, 0.9], [r * 0.82, h * 0.99, 1], [r * 0.6, h * 1.005, 1.02], [r * 0.3, h * 1.0, 0.99], [0, h * 0.992, 0.97]];
    revolve(mk, prof, c, 56, (th, j) => {
      const a = ((th + ph) % (Math.PI / 2) + Math.PI / 2) % (Math.PI / 2), ds = Math.min(a, Math.PI / 2 - a), seam = j > 1 && j < 10 ? Math.exp(-Math.pow(ds / 0.11, 2)) : 0;
      return [1 - 0.028 * seam + 0.008 * Math.sin(th * 2 + ph) + 0.004 * Math.sin(th * 7 + j * 0.9 + ph), (1 - 0.3 * seam) * (0.97 + 0.03 * Math.sin(th * 3 + j + ph))];
    });
    K.torus(mk, r * 0.932, 0.0045, 0, h * 0.945, 0, c.map((v) => v * 0.82), { seg: 56, rad: 5 });
    contact(0, 0, 2 * r + 0.15, 2 * r + 0.15);
  }
  // fauteuil assorti au canapé : même coque enveloppante, assise capitonnée, un coussin
  function armchair(o = {}) {
    channelSofa(0.86, { d: 0.88, shell: o.col || PAL.boucle, mk: o.mk || 'boucle', Rc: 0.27, pillowC: o.pillow, backH: 0.74, armH: 0.6 });
  }
  // îlot : plinthe en retrait sur tout le tour, joues et dos en panneaux de 19 mm (chants adoucis), façades côté
  // cuisine séparées par des joints de 3 mm, joint creux de 8 mm sous le plan, plan aux arêtes adoucies
  function island(w, d, o = {}) {
    const fc = C(o.frontC || 0xffffff, 0.01), fr = o.front || 'oak', over = o.over ?? 0.25, body = d - over, za = -d / 2, zb = -d / 2 + body, y0 = 0.1, y1 = 0.862, t = 0.019;
    K.box('lacquer', -w / 2 + 0.03, w / 2 - 0.03, 0, y0, za + 0.05, zb - 0.035, C(0x3e3b38));
    K.box('lacquer', -w / 2 + 0.006, w / 2 - 0.006, y0 + 0.002, 0.87, za + t + 0.002, zb - 0.006, C(0x45413c));          // caisson (se lit dans les joints)
    for (const s of [-1, 1]) rbb(fr, s > 0 ? w / 2 - t : -w / 2, s > 0 ? w / 2 : -w / 2 + t, y0, y1, za, zb, 0.0018, fc.map((v) => v * (s > 0 ? 1 : 0.985)), { seg: 1 });
    rbb(fr, -w / 2 + t + 0.002, w / 2 - t - 0.002, y0, y1, zb - t, zb - 0.001, 0.0018, fc.map((v) => v * 0.97), { seg: 1 });   // dos, côté séjour
    const n = Math.max(2, Math.round(w / 0.6)), iw = w - 2 * t - 0.004;
    for (let i = 0; i < n; i++) {
      const x0 = -iw / 2 + i * iw / n + 0.0015, x1 = x0 + iw / n - 0.003, dz = jit(0.0014);
      rbb(fr, x0, x1, y0 + 0.002, y1 - 0.002, za + dz, za + t + dz, 0.0018, fc.map((v) => v * (0.975 + 0.05 * R())), { seg: 1 });
      const hx = (x0 + x1) / 2, hm = o.handleMk || 'brass', hz = za + dz - 0.026;   // poignée barre sur deux plots, côté cuisine (−z)
      K.cyl(hm, 0.0055, 0.0055, 0.16, hx - 0.08, 0.8, hz, WHITE, { rz: -Math.PI / 2, seg: 10 });
      for (const s of [-1, 1]) K.cyl(hm, 0.0045, 0.0045, 0.026, hx + s * 0.066, 0.8, hz, WHITE, { rx: Math.PI / 2, seg: 8 });
    }
    slab(o.top || 'stone', w + 0.04, d, 0.04, 0.008, 0, 0.87, 0, C(o.topC || 0xffffff), { bevel: 0.0035, curve: 3 });
    contact(0, 0, w + 0.3, d + 0.3);
  }
  // tapis : nappe épaisse jamais parfaitement plate (ondes d'un à deux millimètres), bords qui retombent au sol,
  // un coin qui rebique ; franges irrégulières aux extrémités
  function rugF(w, d, mk = 'rug', col = WHITE, withFringe = true) {
    const ph = R() * 6.3, th = mk === 'wool' ? 0.02 : mk === 'jute' ? 0.011 : 0.014, nu = Math.max(8, Math.round(d / 0.1)), nv = Math.max(8, Math.round(w / 0.1)), cx = R() < 0.5 ? -1 : 1, cz = R() < 0.5 ? -1 : 1;
    const E = (t, n, L) => { const k = Math.round(t * n), e = 0.012 / L; return k <= 0 ? 0 : k >= n ? 1 : e + (k - 1) / (n - 2) * (1 - 2 * e); };   // premier et dernier rangs : 1,2 cm (le bord qui retombe)
    K.sheet(mk, nu, nv, (u, v) => {
      const fx = E(v, nv, w), fz = E(u, nu, d), x = (fx - 0.5) * w, z = (fz - 0.5) * d, edge = Math.min(fx, 1 - fx) * w < 1e-4 || Math.min(fz, 1 - fz) * d < 1e-4;
      const lift = 0.007 * Math.exp(-(Math.pow(x - cx * w / 2, 2) + Math.pow(z - cz * d / 2, 2)) / 0.02);
      const y = edge ? 0.003 + lift * 0.9 : th + 0.0016 * (Math.sin(x * 4.1 + ph) * Math.sin(z * 3.3 - ph) + 0.6 * Math.sin((x + z) * 7 + ph)) + lift;
      return [x + 0.004 * Math.sin(z * 2.3 + ph) * (edge ? 1 : 0.5), y, z + 0.004 * Math.sin(x * 1.9 + 2 * ph) * (edge ? 1 : 0.5)];
    }, col);
    if (withFringe) for (const s of [-1, 1]) for (let z = -d / 2 + 0.012; z < d / 2 - 0.008; z += 0.02 + R() * 0.008) {
      const L = 0.045 + R() * 0.03, a = jit(0.5), g = new THREE.BoxGeometry(L, 0.0028, 0.0055);
      g.translate(L / 2, 0.003, 0); g.rotateZ(-0.03 - R() * 0.05); g.rotateY(a); if (s < 0) g.rotateY(Math.PI); g.translate(s * (w / 2 - 0.004), 0.003, z); put(mk, g, C(0xf2ebdd, 0.1));
    }
    contact(0, 0, w + 0.1, d + 0.1, 0.006);
  }

  return { sofa, chair, rectTable, cushion, strut, ribbon, kitchenTap, vanity, towelRail, showerSet, hangingTowel, barHandle, puffBox, softPillow, bathTub, barStool, pouf, armchair, island, rugF };
}
