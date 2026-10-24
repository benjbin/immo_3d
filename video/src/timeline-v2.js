// Story v2 « Art Exposium » : mêmes trajectoires que la v1 (timeline.js), redécoupées selon SCENARIO-v2.md.
// Les plans 0 (ouverture) et 6 (carte de fin) sont purement graphiques : pas d'image 3D (shot.none).
const T = require('./timeline');
const { GOLD, spline, scalarSpline, hermite, smoother, sstep, lerp, clamp01, mixLook } = T;
const V1 = Object.fromEntries(T.SHOTS.map((s) => [s.id, s]));
const DURATION = 20, FPS = 30;
const C = [0, -9.5];
const orbit = (th, r, y, ty = 6.2) => ({ pos: [C[0] + r * Math.sin(th), y, C[1] + r * Math.cos(th)], tgt: [0, ty, -9.5], fov: 40 });
const SHOTS = [
  { id: 0, t0: 0, t1: 1.2, none: true, name: 'Ouverture Art Exposium' },
  { ...V1[1], id: 1, t0: 1.2, t1: 4.0, name: 'Drone le long de la façade' },
  { ...V1[3], id: 2, t0: 4.0, t1: 7.0, name: 'Coupe d’étage', cut: (lt) => lerp(16.4, 7.6, smoother((lt - 0.2) / 2.0)) },
  {
    id: 3, t0: 7.0, t1: 10.5, name: 'Visite à pied du 201 (entrée en fondu, plus de traversée de plafond)',
    keys: [
      { pos: [3.0, 8.05, -5.45], tgt: [1.2, 7.6, 2.0], fov: 60 },
      { pos: [3.0, 8.03, -4.7], tgt: [2.4, 7.65, 4.0], fov: 59 },
      { pos: [3.0, 8.0, -3.95], tgt: [3.0, 7.68, 5.5], fov: 58 },
      { pos: [3.0, 7.98, -3.35], tgt: [3.0, 7.68, 6.5], fov: 57 },
    ],
    warp: (x) => hermite(x, 0.9, 0.2),
    hour: () => 20.3, look: () => GOLD, floor: 2, view: 'walk', cut: () => 8.92, walk: () => true, indoor: () => true,
  },
  {
    ...V1[5], id: 4, t0: 10.5, t1: 13.5, name: 'Heure qui défile',
    hour: (lt, u) => scalarSpline([19.0, 20.4, 21.4, 22.0, 22.5], u),
  },
  {
    id: 5, t0: 13.5, t1: 16.5, name: 'Disponibilités en façade, orbite lente',
    keys: [orbit(0.12, 37, 17.5, 6.6), orbit(0.32, 36, 16.8, 6.6), orbit(0.52, 35, 16.2, 6.6)],
    warp: (x) => hermite(x, 1, 1), hour: () => 20.3, look: () => GOLD, avail: true,
  },
  { id: 6, t0: 16.5, t1: 20, none: true, name: 'Carte de fin Art Exposium' },
];
function shotAt(t) { for (const s of SHOTS) if (t < s.t1) return s; return SHOTS[SHOTS.length - 1]; }
function stateAt(t) {
  const s = shotAt(t);
  if (s.none) return { shot: s.id, none: true };
  const lt = t - s.t0, x = clamp01(lt / (s.t1 - s.t0)), u = s.warp ? s.warp(x) : x;
  const pos = spline(s.keys.map((k) => k.pos), u), tgt = spline(s.keys.map((k) => k.tgt), u);
  const fov = scalarSpline(s.keys.map((k) => k.fov), u), hour = s.hour(lt, u);
  const st = { shot: s.id, pos, tgt, fov, hour };
  const look = s.look ? s.look(lt, u, hour) : null; if (look) st.look = look;
  if (s.floor != null) { st.floor = s.floor; st.view = s.view || 'plan'; }
  if (s.cut) st.cut = s.cut(lt, u);
  if (s.walk) st.walk = s.walk(lt, u);
  if (s.indoor) st.indoor = s.indoor(lt, u, pos);
  if (s.tint != null) st.tint = s.tint;
  if (s.avail) st.avail = true;
  return st;
}
module.exports = { DURATION, FPS, SHOTS, stateAt, shotAt };
