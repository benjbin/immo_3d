// BVH (SAH par casiers) sur une soupe de triangles + parcours « premier impact ». Aucune dépendance.
// build(P, nTri) → { nb, nl, T, id, nNodes } ; tampons partageables (SharedArrayBuffer) entre fils d'exécution.
//   nb : Float32 ×6 par nœud (min xyz, max xyz) ; nl : Int32 ×2 par nœud (feuille : [premier, nombre] ; interne : [fils droit, −(axe de coupe + 1)],
//   le fils gauche est le nœud suivant) ; T : Float32 ×9 par triangle rangé (v0, e1, e2) ; id : triangle d'origine.
const F32 = (n) => new Float32Array(new SharedArrayBuffer(n * 4));
const I32 = (n) => new Int32Array(new SharedArrayBuffer(n * 4));

export function build(P, nTri) {
  const cen = new Float32Array(nTri * 3), bb = new Float32Array(nTri * 6);
  for (let t = 0; t < nTri; t++) {
    const o = t * 9;
    for (let a = 0; a < 3; a++) {
      const p = P[o + a], q = P[o + 3 + a], r = P[o + 6 + a];
      const lo = Math.min(p, q, r), hi = Math.max(p, q, r);
      bb[t * 6 + a] = lo; bb[t * 6 + 3 + a] = hi; cen[t * 3 + a] = (lo + hi) * 0.5;
    }
  }
  const idx = new Uint32Array(nTri); for (let i = 0; i < nTri; i++) idx[i] = i;
  const nb = F32(nTri * 2 * 6), nl = I32(nTri * 2 * 2);
  let nNodes = 0;
  const NB = 16, cnt = new Int32Array(NB), bmin = new Float32Array(NB * 3), bmax = new Float32Array(NB * 3), rA = new Float32Array(NB), rN = new Int32Array(NB);
  const stack = [[0, nTri, -1]];
  while (stack.length) {
    const [s, e, parent] = stack.pop();
    const node = nNodes++;
    if (parent >= 0) nl[parent * 2] = node;          // fils droit (le gauche suit immédiatement son parent)
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    let c0x = Infinity, c0y = Infinity, c0z = Infinity, c1x = -Infinity, c1y = -Infinity, c1z = -Infinity;
    for (let i = s; i < e; i++) {
      const t = idx[i], b = t * 6, c = t * 3;
      if (bb[b] < x0) x0 = bb[b]; if (bb[b + 1] < y0) y0 = bb[b + 1]; if (bb[b + 2] < z0) z0 = bb[b + 2];
      if (bb[b + 3] > x1) x1 = bb[b + 3]; if (bb[b + 4] > y1) y1 = bb[b + 4]; if (bb[b + 5] > z1) z1 = bb[b + 5];
      if (cen[c] < c0x) c0x = cen[c]; if (cen[c + 1] < c0y) c0y = cen[c + 1]; if (cen[c + 2] < c0z) c0z = cen[c + 2];
      if (cen[c] > c1x) c1x = cen[c]; if (cen[c + 1] > c1y) c1y = cen[c + 1]; if (cen[c + 2] > c1z) c1z = cen[c + 2];
    }
    const n6 = node * 6; nb[n6] = x0; nb[n6 + 1] = y0; nb[n6 + 2] = z0; nb[n6 + 3] = x1; nb[n6 + 4] = y1; nb[n6 + 5] = z1;
    const n = e - s;
    const leaf = () => { nl[node * 2] = s; nl[node * 2 + 1] = n; };
    if (n <= 4) { leaf(); continue; }
    const ext = [c1x - c0x, c1y - c0y, c1z - c0z], c0 = [c0x, c0y, c0z];
    let best = Infinity, bAxis = -1, bSplit = 0;
    for (let ax = 0; ax < 3; ax++) {
      if (!(ext[ax] > 1e-7)) continue;
      const k = NB / ext[ax] * 0.9999;
      cnt.fill(0); bmin.fill(Infinity); bmax.fill(-Infinity);
      for (let i = s; i < e; i++) {
        const t = idx[i], b = ((cen[t * 3 + ax] - c0[ax]) * k) | 0, q = t * 6, o = b * 3;
        cnt[b]++;
        if (bb[q] < bmin[o]) bmin[o] = bb[q]; if (bb[q + 1] < bmin[o + 1]) bmin[o + 1] = bb[q + 1]; if (bb[q + 2] < bmin[o + 2]) bmin[o + 2] = bb[q + 2];
        if (bb[q + 3] > bmax[o]) bmax[o] = bb[q + 3]; if (bb[q + 4] > bmax[o + 1]) bmax[o + 1] = bb[q + 4]; if (bb[q + 5] > bmax[o + 2]) bmax[o + 2] = bb[q + 5];
      }
      let ax0 = Infinity, ay0 = Infinity, az0 = Infinity, ax1 = -Infinity, ay1 = -Infinity, az1 = -Infinity, m = 0;
      for (let b = NB - 1; b > 0; b--) {
        const o = b * 3; m += cnt[b];
        if (bmin[o] < ax0) ax0 = bmin[o]; if (bmin[o + 1] < ay0) ay0 = bmin[o + 1]; if (bmin[o + 2] < az0) az0 = bmin[o + 2];
        if (bmax[o] > ax1) ax1 = bmax[o]; if (bmax[o + 1] > ay1) ay1 = bmax[o + 1]; if (bmax[o + 2] > az1) az1 = bmax[o + 2];
        const dx = ax1 - ax0, dy = ay1 - ay0, dz = az1 - az0;
        rA[b] = m ? dx * dy + dy * dz + dz * dx : 0; rN[b] = m;
      }
      ax0 = ay0 = az0 = Infinity; ax1 = ay1 = az1 = -Infinity; m = 0;
      for (let b = 0; b < NB - 1; b++) {
        const o = b * 3; m += cnt[b];
        if (bmin[o] < ax0) ax0 = bmin[o]; if (bmin[o + 1] < ay0) ay0 = bmin[o + 1]; if (bmin[o + 2] < az0) az0 = bmin[o + 2];
        if (bmax[o] > ax1) ax1 = bmax[o]; if (bmax[o + 1] > ay1) ay1 = bmax[o + 1]; if (bmax[o + 2] > az1) az1 = bmax[o + 2];
        if (!m || !rN[b + 1]) continue;
        const dx = ax1 - ax0, dy = ay1 - ay0, dz = az1 - az0;
        const cost = (dx * dy + dy * dz + dz * dx) * m + rA[b + 1] * rN[b + 1];
        if (cost < best) { best = cost; bAxis = ax; bSplit = b + 1; }
      }
    }
    if (bAxis < 0) {                                   // centres confondus
      if (n <= 16) { leaf(); continue; }
      const mid = (s + e) >> 1; nl[node * 2 + 1] = -1; stack.push([mid, e, node]); stack.push([s, mid, -1]); continue;
    }
    const k = NB / ext[bAxis] * 0.9999, cc = c0[bAxis];
    let i = s, j = e - 1;
    while (i <= j) {
      if ((((cen[idx[i] * 3 + bAxis] - cc) * k) | 0) < bSplit) i++;
      else { const t = idx[i]; idx[i] = idx[j]; idx[j] = t; j--; }
    }
    if (i === s || i === e) i = (s + e) >> 1;
    nl[node * 2 + 1] = -(bAxis + 1);
    stack.push([i, e, node]);     // droit : dépilé après tout le sous-arbre gauche
    stack.push([s, i, -1]);       // gauche : nœud suivant
  }
  const T = F32(nTri * 9), id = I32(nTri);
  for (let i = 0; i < nTri; i++) {
    const t = idx[i], o = t * 9, d = i * 9; id[i] = t;
    T[d] = P[o]; T[d + 1] = P[o + 1]; T[d + 2] = P[o + 2];
    T[d + 3] = P[o + 3] - P[o]; T[d + 4] = P[o + 4] - P[o + 1]; T[d + 5] = P[o + 5] - P[o + 2];
    T[d + 6] = P[o + 6] - P[o]; T[d + 7] = P[o + 7] - P[o + 1]; T[d + 8] = P[o + 8] - P[o + 2];
  }
  return { nb, nl, T, id, nNodes };
}

// tracer(bvh) → fonction hit(ox, oy, oz, dx, dy, dz) : distance du premier impact (Infinity si aucun) ;
// résultat détaillé dans tracer.tri (triangle d'origine), .u, .v, .back (touché par l'arrière)
export function tracer({ nb, nl, T, id }) {
  const stack = new Int32Array(128);
  const R = { tri: -1, u: 0, v: 0, back: false, hit: null };
  R.hit = (ox, oy, oz, dx, dy, dz) => {
    const ix = 1 / (dx || 1e-30), iy = 1 / (dy || 1e-30), iz = 1 / (dz || 1e-30);
    let tBest = Infinity, best = -1, bu = 0, bv = 0, bdet = 0, sp = 0, node = 0;
    for (;;) {
      const n6 = node * 6;
      let t0 = (nb[n6] - ox) * ix, t1 = (nb[n6 + 3] - ox) * ix, lo, hi;
      if (t0 > t1) { lo = t1; hi = t0; } else { lo = t0; hi = t1; }
      t0 = (nb[n6 + 1] - oy) * iy; t1 = (nb[n6 + 4] - oy) * iy;
      if (t0 > t1) { if (t1 > lo) lo = t1; if (t0 < hi) hi = t0; } else { if (t0 > lo) lo = t0; if (t1 < hi) hi = t1; }
      t0 = (nb[n6 + 2] - oz) * iz; t1 = (nb[n6 + 5] - oz) * iz;
      if (t0 > t1) { if (t1 > lo) lo = t1; if (t0 < hi) hi = t0; } else { if (t0 > lo) lo = t0; if (t1 < hi) hi = t1; }
      if (lo <= hi && hi > 0 && lo < tBest) {
        const c = nl[node * 2 + 1];
        if (c < 0) {                                  // le fils du côté d'où vient le rayon d'abord
          const far = c === -1 ? dx < 0 : c === -2 ? dy < 0 : dz < 0;
          if (far) { stack[sp++] = node + 1; node = nl[node * 2]; } else { stack[sp++] = nl[node * 2]; node = node + 1; }
          continue;
        }
        const f = nl[node * 2];
        for (let i = f; i < f + c; i++) {
          const o = i * 9;
          const e1x = T[o + 3], e1y = T[o + 4], e1z = T[o + 5], e2x = T[o + 6], e2y = T[o + 7], e2z = T[o + 8];
          const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
          const det = e1x * px + e1y * py + e1z * pz;
          if (det > -1e-12 && det < 1e-12) continue;
          const inv = 1 / det, tx = ox - T[o], ty = oy - T[o + 1], tz = oz - T[o + 2];
          const u = (tx * px + ty * py + tz * pz) * inv; if (u < 0 || u > 1) continue;
          const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
          const v = (dx * qx + dy * qy + dz * qz) * inv; if (v < 0 || u + v > 1) continue;
          const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
          if (t > 1e-5 && t < tBest) { tBest = t; best = i; bu = u; bv = v; bdet = det; }
        }
      }
      if (sp === 0) break;
      node = stack[--sp];
    }
    if (best >= 0) { R.tri = id[best]; R.u = bu; R.v = bv; R.back = bdet < 0; }
    return tBest;
  };
  return R;
}
