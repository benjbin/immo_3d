// Story v4 « la puissance technologique » (30 s) : plans 3D tournés dans la maquette (les autres sont graphiques).
// VARIANT=wire : seconde passe « fil de fer » du plan 1 (alignement sur la photo d'architecte).
const T = require('./timeline');
const { GOLD, spline, scalarSpline, hermite, smoother, sstep, lerp, clamp01, mixLook } = T;
const DURATION = 30, FPS = 30;
const VARIANT = process.env.VARIANT || 'real';
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const orbit = (th, r, y, ty = 6.2, fov = 38) => ({ pos: [r * Math.sin(th), y, -9.5 + r * Math.cos(th)], tgt: [0, ty, -9.5], fov });
const DRONE = [
  { pos: [-15, 7, 13], tgt: [-2, 7, -6], fov: 50 },
  { pos: [-8.5, 13.5, 6.5], tgt: [0, 10, -8], fov: 50 },
  { pos: [2, 18.5, -3], tgt: [2, 12.5, -14], fov: 52 },
  { pos: [13, 16, -14], tgt: [-1, 9, -10], fov: 50 },
  { pos: [12, 12, -34], tgt: [0, 8, -10], fov: 48 },
];
const SHOTS = [
  { id: 0, t0: 0, t1: 2.0, keys: [orbit(-0.62, 74, 25, 7.2, 34), orbit(-0.44, 70, 23, 7.2, 34)], warp: (x) => x, hour: () => 20.3,
    fx: (lt) => { const r = lerp(-0.4, 16.5, smoother((lt - 0.05) / 1.35)); return { mode: 'wire', reveal: r, ringY: lt < 1.5 ? Math.min(r, 15.2) : null, lw: 2.4 }; } },
  { id: 1, t0: 2.0, t1: 4.5, keys: [{ pos: [0.2, 8.5, 27], tgt: [0.3, 6.4, -8.5], fov: 38 }], warp: (x) => x, hour: () => 17.0,
    fx: () => ({ mode: VARIANT === 'wire' ? 'wire' : 'real', lw: 2.2, proj: [[-6.72, 0, 0.4], [6.72, 0, 0.4], [0, 12.35, 0]] }) },
  { id: 2, t0: 4.5, t1: 7.5, keys: [orbit(-0.82, 56, 33, 7.0), orbit(-0.62, 52, 30, 7.2)], warp: (x) => hermite(x, 1, 1), hour: () => 20.4, look: () => GOLD,
    cutY: (lt) => lerp(-0.3, 15.4, smoother((lt - 0.1) / 2.5)),
    fx: (lt, y) => ({ mode: 'blueprint', cut: y, ringY: y < 15.2 && y > 0.5 ? y : null, lw: 1.6, edgeOpacity: 0.9 }) },
  { id: 3, t0: 7.5, t1: 10.5, keys: [{ pos: [0.5, 5.6, 24.5], tgt: [0.3, 7.6, -6], fov: 46 }, { pos: [0.3, 6.0, 21.8], tgt: [0.3, 7.6, -6], fov: 46 }], warp: (x) => x,
    hour: (lt, u) => lerp(7.0, 22.5, hermite(u, 0.7, 0.5)), look: (lt, u, h) => { const w = sstep(18.6, 20.3, h) * (1 - sstep(21.3, 22.0, h)); return w > 0.001 ? mixLook(w) : null; } },
  { id: 4, t0: 10.5, t1: 13.5, keys: [{ pos: [-8.5, 28.5, 12.5], tgt: [0.2, 8.4, -9.4], fov: 42 }, { pos: [-5.2, 24.8, 10.2], tgt: [0.4, 8.0, -9.2], fov: 41 }], warp: (x) => hermite(x, 1, 0.6),
    hour: () => 20.3, look: () => GOLD, floor: 2, view: 'plan', tint: 0.2, cutY: (lt) => lerp(10.6, 7.6, smoother((lt - 0.15) / 1.25)), fx: () => ({ proj: ['201', '202'] }) },
  { id: 6, t0: 16.5, t1: 19.5, keys: [
      { pos: [3.0, 8.05, -4.8], tgt: [1.6, 7.7, 3.0], fov: 58 }, { pos: [3.0, 8.0, -3.5], tgt: [2.6, 7.7, 5.0], fov: 58 },
      { pos: [3.0, 7.97, -1.9], tgt: [3.0, 7.65, 6.5], fov: 59 }, { pos: [3.05, 7.95, -0.1], tgt: [3.4, 7.3, 9.0], fov: 62 }],
    warp: (x) => hermite(x, 0.8, 0.6), hour: () => 20.3, look: () => GOLD, floor: 2, view: 'walk', cutY: () => 8.92, walk: true, indoorZ: -1.3 },
  { id: 7, t0: 19.5, t1: 22.5, keys: DRONE, warp: (x) => hermite(x, 1.1, 1.1), hour: () => 20.3, look: () => GOLD },
  { id: 8, t0: 22.5, t1: 25.5, keys: [orbit(0.95, 50, 34, 6.5, 42), orbit(0.72, 48, 32, 6.5, 42)], warp: (x) => x, hour: () => 20.3, look: () => GOLD,
    fx: (lt) => ({ path: { pts: DRONE.map((k) => k.pos), progress: smooth((lt - 0.1) / 1.3), cam: clamp01((lt - 0.25) / 2.6) }, proj: DRONE.map((k) => k.pos) }) },
];
function shotAt(t) { return SHOTS.find((s) => t >= s.t0 && t < s.t1) || null; }
function stateAt(t) {
  const s = shotAt(t);
  if (!s) return { none: true };
  const lt = t - s.t0, x = clamp01(lt / (s.t1 - s.t0)), u = s.warp(x);
  const hour = s.hour(lt, u);
  const st = { t, shot: s.id, pos: spline(s.keys.map((k) => k.pos), u), tgt: spline(s.keys.map((k) => k.tgt), u), fov: scalarSpline(s.keys.map((k) => k.fov), u), hour };
  const look = s.look ? s.look(lt, u, hour) : null; if (look) st.look = look;
  if (s.floor != null) { st.floor = s.floor; st.view = s.view; }
  const y = s.cutY ? s.cutY(lt) : null; if (y != null) st.cut = y;
  if (s.tint != null) st.tint = s.tint;
  if (s.walk) { st.walk = true; st.indoor = st.pos[2] < s.indoorZ; }
  if (s.fx) st.fx = s.fx(lt, y);
  return st;
}
module.exports = { DURATION, FPS, SHOTS, stateAt, shotAt, DRONE };
