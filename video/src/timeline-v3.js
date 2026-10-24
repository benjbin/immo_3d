// Story v3 : seul le plan 4 (disponibilités + heure qui passe, 12,5–15 s) est re-tourné ;
// les autres plans réutilisent les images v2 (voir compose-v3.js).
const T = require('./timeline');
const { GOLD, spline, scalarSpline, hermite, sstep, clamp01, mixLook } = T;
const DURATION = 20, FPS = 30;
const orbit = (th, r, y, ty = 6.6) => ({ pos: [r * Math.sin(th), y, -9.5 + r * Math.cos(th)], tgt: [0, ty, -9.5], fov: 40 });
// ancres des étiquettes : milieu des façades rue (zone A) et droite (zone B), à mi-hauteur de l'étage
const LABELS = [
  { id: '101', p: [3.0, 4.6, 1.9] }, { id: '201', p: [3.0, 7.6, 1.9] }, { id: '302', p: [3.0, 10.6, 1.9] },
  { id: '102', p: [6.5, 4.6, -15.0] }, { id: '202', p: [6.5, 7.6, -15.0] }, { id: '301', p: [6.5, 10.6, -15.0] },
];
const SHOTS = [
  { id: 4, t0: 12.5, t1: 15.0, keys: [orbit(0.14, 37, 17.5), orbit(0.32, 36, 16.9), orbit(0.5, 35, 16.3)], warp: (x) => hermite(x, 1, 1),
    hour: (lt, u) => scalarSpline([20.3, 20.9, 21.6, 22.1, 22.5], u) },
];
function shotAt(t) { return SHOTS.find((s) => t >= s.t0 && t < s.t1) || null; }
function stateAt(t) {
  const s = shotAt(t);
  if (!s) return { none: true };
  const x = clamp01((t - s.t0) / (s.t1 - s.t0)), u = s.warp(x);
  const hour = s.hour(t - s.t0, u);
  const w = sstep(19.5, 20.4, hour) * (1 - sstep(21.2, 22.0, hour));
  const st = { shot: s.id, pos: spline(s.keys.map((k) => k.pos), u), tgt: spline(s.keys.map((k) => k.tgt), u), fov: 40, hour, avail: true, labels: LABELS };
  if (w > 0.001) st.look = mixLook(w);
  return st;
}
module.exports = { DURATION, FPS, SHOTS, stateAt, shotAt, LABELS };
