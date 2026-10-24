// Canopée — story 20 s : découpage, trajectoires de caméra et réglages par plan.
// stateAt(t) → état complet de la maquette au temps t (secondes), consommé par story-page.js.
// Trajectoires : Catmull-Rom uniforme sur positions et cibles, reparamétrées par un easing doux
// (vitesse jamais nulle aux coupes franches, sauf au début et à la fin du film).

const DURATION = 20, FPS = 30;

// étalonnage « heure dorée » (surcharges de LOOK via __viewer.tune)
const GOLD = { warm: 2.2, sun: 1.4, hemi: 1.3, fogWarm: 0.8, exposure: 0.98 };

const lerp = (a, b, k) => a + (b - a) * k;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const smoother = (x) => { x = clamp01(x); return x * x * x * (x * (x * 6 - 15) + 10); };
const sstep = (a, b, x) => smooth((x - a) / (b - a));
// easing partiel : a = 0 linéaire, a = 1 smoothstep complet
const easeMix = (x, a) => lerp(x, smooth(x), a);
// easing à vitesse d'entrée/sortie réglable (v0, v1 relatives à la vitesse moyenne : 0 = arrêt, 1 = linéaire)
function hermite(x, v0 = 0.6, v1 = 0.6) {
  x = clamp01(x);
  const x2 = x * x, x3 = x2 * x;
  return (x3 - 2 * x2 + x) * v0 + (-2 * x3 + 3 * x2) + (x3 - x2) * v1;
}

function cr1(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
// courbe Catmull-Rom passant par pts (tableaux de même dimension), s ∈ [0, 1]
function spline(pts, s) {
  const n = pts.length;
  if (n === 1) return pts[0].slice();
  const P = (i) => {
    if (i < 0) return pts[0].map((v, k) => 2 * v - pts[1][k]);
    if (i > n - 1) return pts[n - 1].map((v, k) => 2 * v - pts[n - 2][k]);
    return pts[i];
  };
  const f = clamp01(s) * (n - 1);
  const i = Math.min(n - 2, Math.floor(f)), t = f - i;
  return pts[0].map((_, k) => cr1(P(i - 1)[k], P(i)[k], P(i + 1)[k], P(i + 2)[k], t));
}
const scalarSpline = (vals, s) => spline(vals.map((v) => [v]), s)[0];

// ------------------------------------------------------------------ plans
const SHOTS = [
  {
    id: 1, t0: 0, t1: 3, name: 'Accroche — drone le long de la façade',
    // départ au ras des massifs (trottoir, angle avant gauche), montée et légère rotation vers le toit-terrasse
    keys: [
      { pos: [-7.0, 0.55, 8.6], tgt: [-3.6, 5.0, -1.5], fov: 60 },
      { pos: [-7.6, 5.4, 9.4], tgt: [-3.4, 8.0, -3.4], fov: 56 },
      { pos: [-9.2, 11.0, 9.2], tgt: [-2.6, 10.8, -5.0], fov: 52 },
      { pos: [-10.6, 16.8, 7.6], tgt: [-1.6, 12.3, -6.4], fov: 50 },
    ],
    warp: (x) => hermite(x, 0.55, 1.15),
    hour: () => 20.9, look: () => GOLD,
  },
  {
    id: 2, t0: 3, t1: 6, name: 'Toit-terrasse — survol rasant',
    keys: [
      { pos: [4.1, 13.85, -18.2], tgt: [0.9, 13.05, -6.5], fov: 56 },
      { pos: [3.6, 13.9, -14.8], tgt: [0.2, 12.95, -3.6], fov: 55 },
      { pos: [3.25, 14.15, -11.6], tgt: [-0.6, 12.85, -1.4], fov: 54 },
      { pos: [3.05, 14.55, -9.3], tgt: [-1.4, 12.8, 0.4], fov: 53 },
    ],
    warp: (x) => hermite(x, 1.0, 0.9),
    hour: () => 20.3, look: () => GOLD,
  },
  {
    id: 3, t0: 6, t1: 9.5, name: 'Coupe d’étage — R+2',
    keys: [
      { pos: [-9.5, 29.5, 13.5], tgt: [0.2, 9.0, -9.4], fov: 44 },
      { pos: [-7.2, 27.0, 11.6], tgt: [0.3, 8.8, -9.3], fov: 43 },
      { pos: [-4.6, 24.6, 10.0], tgt: [0.4, 8.6, -9.2], fov: 42 },
    ],
    warp: (x) => hermite(x, 1.0, 0.8),
    hour: () => 19.9, look: () => GOLD,
    floor: 2, view: 'plan', tint: 0.2,
    // le plan de coupe part au-dessus de l'édicule et descend jusqu'à 1,2 m au-dessus du sol du R+2
    cut: (lt) => lerp(16.4, 7.6, smoother((lt - 0.25) / 2.35)),
  },
  {
    id: 4, t0: 9.5, t1: 13, name: 'On entre — séjour du 201',
    keys: [
      { pos: [3.0, 13.0, -8.4], tgt: [3.0, 6.0, -3.4], fov: 54 },
      { pos: [3.0, 10.1, -5.5], tgt: [3.0, 7.2, 1.0], fov: 56 },
      { pos: [3.0, 8.05, -4.75], tgt: [3.0, 7.75, 4.0], fov: 58 },
      { pos: [3.0, 8.0, -4.0], tgt: [3.0, 7.7, 5.0], fov: 58 },
      { pos: [3.0, 7.98, -3.3], tgt: [3.0, 7.68, 6.5], fov: 57 },
    ],
    warp: (x) => hermite(x, 1.3, 0.3),
    hour: () => 20.3, look: () => GOLD,
    floor: 2, view: 'walk', cut: () => 8.92,
    walk: (lt) => lt > 0.9, indoor: (lt, u, pos) => lt > 0.9 && pos[2] < -1.3,
  },
  {
    id: 5, t0: 13, t1: 16.5, name: 'Heure qui passe — façade',
    keys: [
      { pos: [-11.6, 8.4, 19.5], tgt: [-1.2, 8.6, -5.0], fov: 45 },
      { pos: [-10.4, 8.1, 20.2], tgt: [-1.0, 8.6, -5.2], fov: 45 },
      { pos: [-9.2, 7.8, 20.8], tgt: [-0.8, 8.6, -5.4], fov: 45 },
    ],
    warp: (x) => x,
    // 17 h → heure bleue : on s'attarde sur l'heure dorée puis sur l'allumage des fenêtres
    hour: (lt, u) => scalarSpline([17.0, 19.6, 21.0, 21.9, 22.6], u),
    look: (lt, u, h) => { const w = sstep(18.8, 20.4, h) * (1 - sstep(21.4, 22.2, h)); return w > 0.001 ? mixLook(w) : null; },
  },
  {
    id: 6, t0: 16.5, t1: 20, name: 'Clôture — heure bleue, travelling arrière',
    keys: [
      { pos: [2.5, 1.3, 12.5], tgt: [0.0, 8.4, -6.0], fov: 56 },
      { pos: [3.8, 1.45, 17.5], tgt: [0.0, 8.0, -6.0], fov: 51 },
      { pos: [5.0, 1.7, 24.5], tgt: [0.0, 7.6, -6.0], fov: 48 },
    ],
    warp: (x) => hermite(x, 1.1, 0.0),
    hour: () => 22.6, look: () => null,
  },
];
function mixLook(w) {
  const base = { warm: 0.6, sun: 0.95, hemi: 1.9, fogWarm: 0.45, exposure: 1.05 };
  const o = {};
  for (const k of Object.keys(GOLD)) o[k] = +lerp(base[k], GOLD[k], w).toFixed(3);
  return o;
}

function shotAt(t) {
  for (const s of SHOTS) if (t < s.t1) return s;
  return SHOTS[SHOTS.length - 1];
}
function stateAt(t) {
  const s = shotAt(t);
  const lt = t - s.t0, x = clamp01(lt / (s.t1 - s.t0));
  const u = s.warp ? s.warp(x) : x;
  const pos = spline(s.keys.map((k) => k.pos), u);
  const tgt = spline(s.keys.map((k) => k.tgt), u);
  const fov = scalarSpline(s.keys.map((k) => k.fov), u);
  const hour = s.hour(lt, u);
  const look = s.look ? s.look(lt, u, hour) : null;
  const st = { shot: s.id, pos, tgt, fov, hour };
  if (look) st.look = look;
  if (s.floor != null) { st.floor = s.floor; st.view = s.view || 'plan'; }
  if (s.cut) st.cut = s.cut(lt, u);
  if (s.walk) st.walk = s.walk(lt, u);
  if (s.indoor) st.indoor = s.indoor(lt, u, pos);
  if (s.tint != null) st.tint = s.tint;
  return st;
}

module.exports = { DURATION, FPS, SHOTS, stateAt, shotAt, GOLD, spline, scalarSpline, hermite, smoother, sstep, lerp, clamp01, mixLook };
