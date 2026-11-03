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
    const key = [w, h, d, r, o.puff, o.sag, o.side, o.wob, o.step].map((v) => (v == null ? '-' : (+v).toFixed(4))).join('|');
    if (!PB.has(key)) PB.set(key, puffBox0(w, h, d, r, o));
    return PB.get(key).clone();
  }
  function puffBox0(w, h, d, r, o = {}) {
    const st = o.step || 0.04, g0 = new THREE.BoxGeometry(w, h, d, Math.max(2, Math.ceil(w / st)), Math.max(2, Math.ceil(h / st)), Math.max(2, Math.ceil(d / st)));
    g0.deleteAttribute('normal'); g0.deleteAttribute('uv');
    const g = mergeVertices(g0); g0.dispose();
    const p = g.attributes.position, a = w / 2, b = h / 2, c = d / 2, ia = a - r, ib = b - r, ic = c - r, v = new V3(), q = new V3();
    const puff = o.puff ?? 0.25, sag = o.sag ?? 0, side = o.side ?? 0.12, seed = (w * 13.7 + d * 7.1) % 10, wob = o.wob ?? 0.002;
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
      // froissé doux du tissu tendu
      if (wob) { const k = wob * (Math.sin(v.x * 37 + seed) * Math.sin(v.z * 29 - seed) + 0.6 * Math.sin((v.x + v.z) * 61 + seed * 2)); v.y += k * Math.sign(v.y) * Math.abs(ny); }
      p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    return g;
  }
  function cushion(mk, w, h, d, x, y, z, col, o = {}) {
    const a = w / 2, b = h / 2, c = d / 2, ro = { rx: o.rx || 0, ry: o.ry || 0, rz: o.rz || 0 };
    const e = o.e ?? 0.16;
    const g = puffBox(w, h, d, Math.min(o.r ?? h * 0.32, h / 2 - 1e-3), { puff: o.puff ?? 0.25, sag: o.sag ?? 0.05, wob: o.wob ?? 0.0012, step: o.step });
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

  // ------------------------------------------------------------------ canapé 3 places
  // o.mk : 'textile' (lin), 'boucle', 'velvet' ; o.base : 'plinth' (socle chêne) | 'legs' (pieds fuselés) ;
  // o.col, o.pillows, o.plaid (couleurs), o.d (profondeur)
  function sofa(w, o = {}) {
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
    rb(mk, w - 2 * armW + 0.04, deckT, d - 0.06, 0.05, 0, y0 + deckT / 2, 0.01, colD, { seg: 4 });
    rb(mk, w - 2 * armW + 0.04, backTop - y0, 0.17, 0.06, 0, y0 + (backTop - y0) / 2, -d / 2 + 0.085, colD, { seg: 4 });
    // accoudoirs : rayon 7 cm, passepoil sur la face avant
    for (const s of [-1, 1]) {
      const ax = s * (w / 2 - armW / 2), ah = armH - y0;
      rb(mk, armW, ah, d, 0.07, ax, y0 + ah / 2, 0, col, { seg: 5 });
      seamLoop(mk, armW / 2 * 0.93, ah / 2 * 0.95, 0.004, ax, y0 + ah / 2, d / 2 - 0.004, col.map((v) => v * 0.86), { rx: Math.PI / 2 }, 0.22, 56);
    }
    // coussins d'assise : bombés, affaissés là où ils se touchent, légèrement décalés
    const n = w > 2.0 ? 3 : 2, inner = w - 2 * armW, cw = inner / n, sTop = y0 + deckT;
    for (let i = 0; i < n; i++) {
      const x = -inner / 2 + cw * (i + 0.5) + jit(0.006);
      cushion(mk, cw - 0.008, seatT, d - 0.25, x, sTop + seatT / 2 - 0.006, 0.085 + jit(0.008), C(o.col || PAL.linenSand, 0.055), { puff: 0.32, sag: 0.12, crease: 0.08, rz: jit(0.012), e: 0.17 });
    }
    // coussins de dossier libres, inclinés de 12°, bombés vers l'avant
    for (let i = 0; i < n; i++) {
      const x = -inner / 2 + cw * (i + 0.5) + jit(0.008), hgt = 0.5;
      cushion(mk, cw - 0.012, 0.19, hgt, x, sTop + seatT + hgt / 2 - 0.03, -d / 2 + 0.255, C(o.col || PAL.linenSand, 0.055), { rx: -Math.PI / 2 + 0.21 + jit(0.03), rz: jit(0.02), puff: 0.42, sag: 0.04, crease: 0.12, e: 0.2, e1: 0.3 });
    }
    // coussins décoratifs (coins pincés, plis), plaid jeté sur un accoudoir
    const pc = o.pillows || [PAL.terracotta, PAL.linenOat, PAL.ochre];
    const spots = [[-inner / 2 + 0.26, 0.5, 0.14], [-inner / 2 + 0.6, 0.44, -0.12], [inner / 2 - 0.3, 0.5, -0.08], [inner / 2 - 0.62, 0.42, 0.18]];
    pc.forEach((cc, i) => { const [x, s, rz] = spots[i % spots.length]; pillow(x + jit(0.03), sTop + seatT + s / 2 - 0.06, -d / 2 + 0.43 + (i % 2) * 0.05, s, 0.15, C(cc, 0.03), { mk: o.pillowMk || (mk === 'velvet' ? 'velvet' : 'textile'), rx: -Math.PI / 2 + 0.36 + jit(0.08), rz: rz * 0.6, crease: 0.1 }); });
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

  return { sofa, chair, rectTable, cushion, strut, ribbon, kitchenTap, vanity, towelRail, showerSet, hangingTowel, barHandle, puffBox, bathTub };
}
