// Expérience v2 — « chez vous, avant qu'il existe » : un plan-séquence à la première personne dans la maquette Canopée.
// La page pilote l'iframe de même origine (contentWindow.__viewer) ; les effets cinéma (profondeur de champ,
// aberration, grain) sont un module injecté dans l'iframe (fx-xp.js). Aucune modification de canopee/3d/.

const $ = (s) => document.querySelector(s);
const Q = new URLSearchParams(location.search);
const POSTER = Q.get('poster') === '1';                 // mode capture de l'image fixe d'attente
if (Q.get('embed') === '1') document.body.classList.add('embed');
if (POSTER) document.body.classList.add('poster');
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches || POSTER;
const D2R = Math.PI / 180;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const smoother = (x) => { x = clamp01(x); return x * x * x * (x * (x * 6 - 15) + 10); };
const sstep = (a, b, x) => smooth((x - a) / (b - a));

// ------------------------------------------------------------------ plan-séquence
// clé : t (timeline 0→1), pos, regard (vers un point) → cap/tangage, hf = champ horizontal (°),
// mise au point (focus, m) et flou (blur) pour la profondeur de champ
const look = (pos, tgt) => { const dx = tgt[0] - pos[0], dy = tgt[1] - pos[1], dz = tgt[2] - pos[2]; return [Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))]; };
const K = (t, pos, tgt, o = {}) => { const [yaw, pitch] = Array.isArray(tgt) ? look(pos, tgt) : [tgt.yaw, tgt.pitch]; return { t, pos, yaw, pitch, hf: o.hf ?? 64, focus: o.focus ?? 10, blur: o.blur ?? 0, range: o.range ?? 8 }; };
const RUE = { hf: 64, focus: 15, blur: 7, range: 9 }, MONTEE = { hf: 64, focus: 7, blur: 3, range: 6 }, BAIE = { hf: 66, focus: 4.5, blur: 2.4, range: 4 };
const DEDANS = { hf: 68, focus: 4, blur: 2.2, range: 4 }, CIEL = { hf: 52, focus: 30, blur: 0, range: 30 }, VUE = { hf: 66, focus: 40, blur: 6, range: 30 }, FIN = { hf: 68, focus: 20, blur: 0, range: 20 };
const COMMUN = [
  K(0.0, [-16.5, 1.65, 7.35], [-1.5, 4.2, -1.0], RUE),
  K(0.06, [-11.2, 1.65, 7.3], [0.0, 4.4, -2.0], RUE),
  K(0.12, [-5.6, 1.65, 7.1], [1.0, 4.8, -3.0], RUE),
  K(0.165, [-1.0, 1.66, 6.5], [1.6, 6.6, -4], RUE),
  K(0.21, [1.6, 3.4, 5.9], [2.7, 7.0, -3], MONTEE),
  K(0.255, [2.8, 6.5, 4.4], [3.0, 8.0, -3], MONTEE),
  K(0.29, [3.0, 8.12, 2.6], [3.0, 7.75, -6], BAIE),
  K(0.32, [3.0, 8.08, 0.55], [3.0, 7.9, -6], BAIE),
  K(0.345, [3.0, 8.05, -1.2], [3.0, 8.0, -6], BAIE),
  K(0.37, [3.1, 8.05, -1.6], [0.5, 7.85, -6.5], DEDANS),
  K(0.42, [3.2, 8.05, -1.75], [-2.5, 7.85, -4.5], DEDANS),
  K(0.47, [3.2, 8.05, -1.8], [-3.0, 7.85, -2.6], DEDANS),
  K(0.51, [3.0, 8.05, -1.5], [0.5, 7.9, -6.5], BAIE),
  K(0.535, [3.0, 8.1, -0.9], [3.0, 8.0, -8], BAIE),
  K(0.565, [3.0, 8.12, 2.8], [3.0, 7.6, -8], MONTEE),
  K(0.6, [0.5, 15.5, 12.5], [0.3, 7.2, -9], CIEL),
  K(0.64, [-7, 25, 11.5], [0.4, 7.2, -9.3], CIEL),
];
const CHOIX_T = 0.64;
function suite(lot, V) {
  if (lot === '202') {
    const vp = V ? V.lots.lot('202').viewpoint : { pos: [4.85, 8.2, -16.5], tgt: [24.5, 6.1, -12.1] };
    const P = vp.pos, T = vp.tgt;
    return [
      K(0.668, [-0.5, 20, -8], [2.2, 7.0, -14.0], CIEL),
      K(0.7, [2.4, 12.5, -12.4], [2.2, 6.5, -14.8], CIEL),
      K(0.735, [2.2, 9.4, -13.4], [3.0, 7.6, -17], DEDANS),
      K(0.765, [2.3, 8.05, -14.8], T, DEDANS),
      K(0.81, [3.4, 8.05, -15.9], T, BAIE),
      K(0.86, [P[0] - 0.2, P[1] - 0.15, P[2]], T, VUE),
      K(0.89, [P[0] - 0.1, P[1] - 0.15, P[2] + 0.2], [T[0], T[1] + 2.5, T[2] + 6], VUE),
      K(0.915, [P[0] + 1.8, P[1] + 0.8, P[2] + 0.4], [T[0], T[1] + 2, T[2] + 4], FIN),
      K(0.945, [12, 4.5, -14], [0, 8, -10], FIN),
      K(0.975, [13, 1.65, -11.5], [0, 8.6, -10], FIN),
      K(1.0, [17.5, 1.7, -10.5], [0, 8.2, -10], FIN),
    ];
  }
  return [
    K(0.668, [-1.0, 20, -1.5], [2.6, 7.0, -6.0], CIEL),
    K(0.7, [2.8, 12.5, -7.6], [2.8, 6.5, -3.6], CIEL),
    K(0.735, [2.8, 9.4, -5.6], [3.0, 7.6, 0], DEDANS),
    K(0.765, [2.8, 8.05, -4.9], [3.0, 7.8, 5], DEDANS),
    K(0.8, [3.0, 8.0, -3.0], [3.0, 7.7, 6], BAIE),
    K(0.83, [3.0, 7.97, -1.4], [3.1, 7.6, 7], BAIE),
    K(0.86, [3.05, 7.95, 0.25], [3.3, 7.4, 9], VUE),
    K(0.89, [3.0, 7.95, 0.3], [-1.6, 8.6, 9], VUE),
    K(0.915, [3.2, 9.0, 2.6], [-1.0, 8.5, 9], FIN),
    K(0.945, [4.4, 4.2, 9.5], [0, 8, -4], FIN),
    K(0.975, [5.4, 1.65, 16], [0, 8.6, -5], FIN),
    K(1.0, [7.2, 1.7, 26], [0, 8.2, -5], FIN),
  ];
}
let LOT = null;
let KEYS = COMMUN.concat(suite('201'));
function unwrapYaw(keys) { for (let i = 1; i < keys.length; i++) { while (keys[i].yaw - keys[i - 1].yaw > Math.PI) keys[i].yaw -= 2 * Math.PI; while (keys[i].yaw - keys[i - 1].yaw < -Math.PI) keys[i].yaw += 2 * Math.PI; } return keys; }
unwrapYaw(KEYS);
const HEURES = [[0, 19.7], [0.5, 19.9], [0.66, 20.0], [0.8, 20.4], [0.885, 21.8], [0.93, 22.4], [1, 22.6]];
const TEXTE = [];

function cr(p0, p1, p2, p3, u) { const u2 = u * u, u3 = u2 * u; return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3); }
// Catmull-Rom centripète simplifiée : interpolation des vecteurs [x, y, z, cap, tangage, hf, focus, blur, range]
const vec = (k) => [...k.pos, k.yaw, k.pitch, k.hf, k.focus, k.blur, k.range];
function echantillon(t) {
  const n = KEYS.length;
  if (t <= KEYS[0].t) return vec(KEYS[0]);
  if (t >= KEYS[n - 1].t) return vec(KEYS[n - 1]);
  let i = 0; while (i < n - 2 && t > KEYS[i + 1].t) i++;
  const u = (t - KEYS[i].t) / (KEYS[i + 1].t - KEYS[i].t);
  const g = (k) => vec(KEYS[Math.max(0, Math.min(n - 1, k))]);
  const P1 = g(i), P2 = g(i + 1);
  const P0 = i === 0 ? P1.map((v, j) => 2 * v - P2[j]) : g(i - 1), P3 = i + 2 > n - 1 ? P2.map((v, j) => 2 * v - P1[j]) : g(i + 2);
  const r = P1.map((_, j) => cr(P0[j], P1[j], P2[j], P3[j], u));
  for (let j = 6; j < 9; j++) r[j] = lerp(P1[j], P2[j], smooth(u));   // focales et flou : interpolation douce sans dépassement
  return r;
}
function heureAt(t) { for (let i = 0; i < HEURES.length - 1; i++) { const [t0, h0] = HEURES[i], [t1, h1] = HEURES[i + 1]; if (t <= t1) return lerp(h0, h1, smooth((t - t0) / (t1 - t0))); } return 22.6; }
const GOLD = { warm: 2.2, sun: 1.4, hemi: 1.3, fogWarm: 0.8, exposure: 0.98 }, BASE = { warm: 0.6, sun: 0.95, hemi: 1.9, fogWarm: 0.45, exposure: 1.05 };
function lookFor(h) { const w = sstep(18.6, 19.5, h) * (1 - sstep(21.2, 22.1, h)); const o = {}; for (const k in GOLD) o[k] = +lerp(BASE[k], GOLD[k], w).toFixed(2); return o; }

// ------------------------------------------------------------------ pilotage de la maquette
let W = null, V = null, cam = null, hPlane = null;
const S = { walk: false, indoor: false };
const cur = { mode: null, hour: null, look: '', cut: null, hourAt: 0 };
function preparer(w) {
  W = w; V = w.__viewer; cam = V.camera;
  V.controls.update = () => false; V.controls.enabled = false;
  if (V.nav) { V.nav.update = () => false; const gs0 = V.nav.getState.bind(V.nav); V.nav.getState = () => ({ ...gs0(), mode: S.walk ? 'walk' : 'orbit', indoor: S.walk && S.indoor }); }
  const h = w.document.getElementById('hour'); if (h) { h.min = '4'; h.max = '23.5'; h.step = 'any'; }
  hPlane = V.M.renderWhite.clippingPlanes[0];
  cam.near = 0.05; cam.updateProjectionMatrix();              // on frôle garde-corps et feuillages : plan proche rapproché
  V.lots.group.traverse((o) => { if (o.isSprite) o.visible = false; });
}
const finishCut = () => { const an = V.cfg.cut.anim; V.cfg.cut.anim = null; if (an && an.onEnd) an.onEnd(); };
const noOffset = () => { const vo = V.cfg.vo; vo.x = vo.tx = vo.y = vo.ty = 0; cam.clearViewOffset(); };
function setMode(m) {
  if (m === cur.mode) return;
  if (m === 'ext') { V.setFloor(null, { fly: false }); finishCut(); }
  else { V.setFloor(2, { fly: false, view: m === 'walk' ? 'walk' : 'plan' }); finishCut(); V.lots.setFloor(2); V.lots.setViewMode && V.lots.setViewMode(m === 'walk' ? 'walk' : 'plan'); V.cfg.cut.ready = true; }
  V.lots.group.traverse((o) => { if (o.isSprite) o.visible = false; });
  noOffset(); cur.mode = m; cur.cut = null;
}
function setCut(y) {
  const c = y == null ? 1e4 : y;
  if (cur.cut != null && Math.abs(cur.cut - c) < 1e-3) return;
  V.cfg.cut.anim = null; V.cfg.cut.y = c; hPlane.constant = c; V.renderer.shadowMap.needsUpdate = true; cur.cut = c;
}
function setHeure(h, now, force) {
  const lk = JSON.stringify(lookFor(h));
  if (lk !== cur.look && (force || now - cur.hourAt > 120)) { V.tune(JSON.parse(lk)); cur.look = lk; cur.hour = null; }
  if (force || cur.hour == null || (Math.abs(cur.hour - h) > 0.012 && now - cur.hourAt > 110)) { V.setHour(h); cur.hour = h; cur.hourAt = now; cur.expo = V.renderer.toneMappingExposure; }
}
function modeAt(t, p) {
  if (t < 0.555) return p[2] < -1.15 ? 'walk' : 'ext';
  if (t < 0.665) return 'plan';
  if (t < 0.9) return 'walk';
  const lot = LOT || '201';
  return (lot === '202' ? p[0] > 6.35 : p[2] > 1.62) ? 'ext' : 'walk';
}
const coupeAt = (t) => lerp(16.4, 7.6, smoother((t - 0.565) / 0.06));

// regard libre (souris / inclinaison / doigt), respiration et micro-dérive
const R = { yaw: 0, pitch: 0, ty: 0, tp: 0 };
let horloge = 0;
function poser(t, now, dt, force) {
  const p = echantillon(t);
  const mode = modeAt(t, p);
  setMode(mode);
  setHeure(heureAt(t), now, force);
  setCut(mode === 'walk' ? 8.92 : mode === 'plan' ? coupeAt(t) : null);
  // le plan de l'étage n'apparaît qu'une fois la coupe arrivée sous le R+3 (pas de lignes de lots vues de dehors)
  if (mode === 'plan') { const planVis = coupeAt(t) < 9.6; if (planVis !== cur.planVis) { V.lots.setFloor(planVis ? 2 : null); cur.planVis = planVis; } } else cur.planVis = undefined;
  // la tête suit doucement la souris, puis revient au cap du plan
  const k = 1 - Math.exp(-dt * (REDUCED ? 12 : 2.6));
  R.yaw += (R.ty - R.yaw) * k; R.pitch += (R.tp - R.pitch) * k;
  horloge += dt;
  const sol = mode !== 'plan' && !(t > 0.565 && t < 0.72) && !(t > 0.18 && t < 0.3);
  const resp = REDUCED ? 0 : (sol ? 0.014 : 0.03) * Math.sin(horloge * 2 * Math.PI * 0.2);
  const drift = REDUCED ? 0 : 1;
  const yaw = p[3] + R.yaw + drift * 0.012 * Math.sin(horloge * 0.31) + drift * 0.006 * Math.sin(horloge * 0.83);
  const pitch = p[4] + R.pitch + drift * 0.006 * Math.sin(horloge * 0.23 + 1.3) + (REDUCED ? 0 : 0.0025 * Math.sin(horloge * 2 * Math.PI * 0.2 + 0.6));
  cam.position.set(p[0], p[1] + resp, p[2]);
  const cx = Math.cos(pitch);
  const fx = -Math.sin(yaw) * cx, fy = Math.sin(pitch), fz = -Math.cos(yaw) * cx;
  cam.up.set(0, 1, 0);
  V.controls.target.set(p[0] + fx * 6, p[1] + fy * 6, p[2] + fz * 6);
  cam.lookAt(p[0] + fx * 6, p[1] + resp + fy * 6, p[2] + fz * 6);
  // champ horizontal conservé ; en portrait on plafonne le champ vertical (première personne sur téléphone)
  const asp = innerWidth / innerHeight, hf = p[5] * D2R;
  cam.fov = Math.min(Math.atan(Math.tan(hf / 2) / asp) * 2 / D2R, asp < 1 ? 70 : 62);
  cam.zoom = 1; cam.updateProjectionMatrix();
  S.walk = mode === 'walk'; S.indoor = S.walk && (LOT === '202' || t < 0.66 ? p[0] < 4.7 : p[2] < -1.3);
  if (LOT && t > 0.7 && cur.sel) { V.lots.setSelected(null); V.lots.setFilter(null); cur.sel = false; }
  // intérieur : éclairage baké très lumineux, exposition réduite pour garder du contraste
  if (cur.expo) { const k = S.indoor ? 0.8 : 1; cur.ek = cur.ek == null ? k : cur.ek + (k - cur.ek) * (1 - Math.exp(-dt * 3)); V.renderer.toneMappingExposure = cur.expo * cur.ek; }
  if (V.lots.update) V.lots.update(dt);
  if (W.__xpfx) W.__xpfx.set({ focus: p[6], blur: REDUCED ? 0 : p[7], range: p[8] });
  V.controls.dispatchEvent({ type: 'change' });               // le viewer dessine dans sa propre boucle
  return { p, mode };
}

// ------------------------------------------------------------------ choix du lot dans la 3D
const etiq = $('#etiq');
let survol = null, choixActif = false, poussee = 0;
const DATA = { 201: { t: 'Lot 201 · T4', d: '77 m² · côté rue · 485 000 €', mot: 'Lot 201. <em>485 000 €.</em>' }, 202: { t: 'Lot 202 · T3', d: '80 m² · côté jardin · 460 000 €', mot: 'Lot 202. <em>Côté jardin.</em>' } };
function choisir(id) {
  if (LOT) return;
  LOT = id === '202' ? '202' : '201';
  KEYS = unwrapYaw(COMMUN.concat(suite(LOT, V)));
  V.lots.setHover(null); V.lots.setSelected(LOT); cur.sel = true;
  etiq.classList.remove('on'); document.body.classList.remove('survol');
  $('#lotMot').innerHTML = DATA[LOT].mot; decouper($('#lotMot'));
  $('#libre').href = `../canopee/3d/?lot=${LOT}`;
  cible = Math.max(cible, CHOIX_T + 0.012);
  son.declic && son.declic();
}
function placerEtiq(id) {
  const pr = V.projectLot(id);
  if (!pr || pr.z > 1) { etiq.classList.remove('on'); return; }
  etiq.innerHTML = `<b><i></i>${DATA[id].t}</b><span>${DATA[id].d}</span>`;
  etiq.style.transform = `translate(${Math.round(pr.x)}px, ${Math.round(pr.y - 18)}px) translate(-50%, -100%)`;
  etiq.classList.add('on');
}
function survoler(x, y) {
  if (!choixActif || LOT) return;
  let id = null; try { id = V.pickAt(x, y); } catch (e) { id = null; }
  if (id !== '201' && id !== '202') id = null;
  if (id !== survol) { survol = id; V.lots.setHover(id); document.body.classList.toggle('survol', !!id); if (id) son.tic && son.tic(); }
  if (id) placerEtiq(id); else etiq.classList.remove('on');
}
$('#choixLots').addEventListener('click', (e) => { const b = e.target.closest('[data-lot]'); if (b) choisir(b.dataset.lot); });

// ------------------------------------------------------------------ mots (masqués ligne par ligne)
function decouper(el) {
  const brut = el.innerHTML.replace(/<span class="l"[^>]*><span>|<\/span><\/span>/g, '');
  el.setAttribute('aria-label', el.textContent);
  const m = brut.match(/^(.*?)(<em>.*<\/em>)\s*$/);
  const lignes = m ? [m[1].trim(), m[2]] : [brut];
  el.innerHTML = lignes.filter(Boolean).map((l) => `<span class="l" aria-hidden="true"><span>${l}</span></span>`).join('');
}
const mots = [...document.querySelectorAll('.mot')];
mots.forEach(decouper);
function majMots(t) {
  for (const el of mots) {
    const a = +el.dataset.a, b = +el.dataset.b;
    const avant = el.id === 'choix' ? (!choixActif || LOT) : false;
    const vis = t >= a && t <= b && !avant && !(el.id === 'lotMot' && !LOT);
    const part = !vis && el.classList.contains('vis');
    if (vis !== el.classList.contains('vis')) { el.classList.toggle('vis', vis); el.classList.toggle('part', part); el.setAttribute('aria-hidden', String(!vis)); }
  }
  const fin = $('#fin'), vf = t >= +fin.dataset.a;
  if (vf !== fin.classList.contains('vis')) fin.classList.toggle('vis', vf);
}

// ------------------------------------------------------------------ saisie
let cible = 0, affiche = 0, demarre = false, premierGeste = false;
const PAS = 0.000105;
function geste() {
  if (!premierGeste) { premierGeste = true; $('#defiler').classList.add('off'); }
  son.reveil();
}
function avance(d) {
  if (!demarre) return;
  let c = cible + d;
  if (!LOT && c > CHOIX_T) { c = CHOIX_T; if (d > 0) poussee += 1; }
  cible = clamp01(c);
}
addEventListener('wheel', (e) => { e.preventDefault(); const k = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? innerHeight : 1; geste(); avance(Math.max(-160, Math.min(160, e.deltaY * k)) * PAS); }, { passive: false });
addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'A' || tag === 'BUTTON') { if (e.key !== ' ' && e.key !== 'Enter') { /* navigation au clavier */ } else return; }
  const map = { ArrowDown: 0.018, PageDown: 0.06, ' ': 0.06, ArrowUp: -0.018, PageUp: -0.06 };
  if (e.key in map) { e.preventDefault(); geste(); avance(map[e.key]); }
  else if (e.key === 'Home') { e.preventDefault(); cible = 0; }
  else if (e.key === 'End') { e.preventDefault(); geste(); if (!LOT) choisir('201'); cible = 1; }
  else if (e.key === 'ArrowLeft') R.ty = 10 * D2R;
  else if (e.key === 'ArrowRight') R.ty = -10 * D2R;
});
addEventListener('keyup', (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') R.ty = 0; });
// souris : la tête suit le pointeur (±10° en cap, ±6° en tangage)
let pointeurFin = matchMedia('(hover: hover) and (pointer: fine)').matches;
addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse') {
    R.ty = -(e.clientX / innerWidth - 0.5) * 2 * 10 * D2R;
    R.tp = -(e.clientY / innerHeight - 0.5) * 2 * 6 * D2R;
    survoler(e.clientX, e.clientY);
  } else if (doigt) {
    // au doigt : vertical = avancer, horizontal = tourner la tête (retour au cap au relâchement)
    const dx = e.clientX - doigt.x, dy = e.clientY - doigt.y;
    avance((doigt.ly - e.clientY) / innerHeight * 0.16); doigt.ly = e.clientY;
    if (!orientationActive) R.ty = Math.max(-1, Math.min(1, dx / (innerWidth * 0.5))) * 10 * D2R;
    if (Math.hypot(dx, dy) > 10) doigt.bouge = true;
  }
});
document.documentElement.addEventListener('mouseleave', () => { R.ty = 0; R.tp = 0; });
let doigt = null;
addEventListener('pointerdown', (e) => { geste(); if (e.target.closest('a,button')) return; if (e.pointerType !== 'mouse') doigt = { x: e.clientX, y: e.clientY, ly: e.clientY, bouge: false }; demanderOrientation(); });
addEventListener('pointerup', (e) => {
  if (e.target.closest && e.target.closest('a,button')) { doigt = null; return; }
  const tap = !doigt || !doigt.bouge;
  if (tap && choixActif && !LOT) { survoler(e.clientX, e.clientY); if (survol) choisir(survol); }
  if (doigt && !orientationActive) R.ty = 0;
  doigt = null;
});
// inclinaison du téléphone = regard
let orientationActive = false, ori0 = null;
function demanderOrientation() {
  if (orientationActive || pointeurFin || !('DeviceOrientationEvent' in window)) return;
  const brancher = () => addEventListener('deviceorientation', (e) => {
    if (e.gamma == null) return;
    orientationActive = true;
    if (!ori0) ori0 = { b: e.beta, g: e.gamma };
    R.ty = -Math.max(-1, Math.min(1, (e.gamma - ori0.g) / 25)) * 10 * D2R;
    R.tp = Math.max(-1, Math.min(1, (e.beta - ori0.b) / 25)) * 6 * D2R;
  });
  if (typeof DeviceOrientationEvent.requestPermission === 'function') DeviceOrientationEvent.requestPermission().then((r) => { if (r === 'granted') brancher(); }).catch(() => {});
  else brancher();
  pointeurFin = true;
}
$('#passer').addEventListener('click', (e) => { e.preventDefault(); if (!LOT) choisir('201'); cible = 1; affiche = Math.max(affiche, 0.95); $('#fin .btn').focus({ preventScroll: true }); });

// ------------------------------------------------------------------ son d'ambiance (WebAudio, synthétisé)
const son = (() => {
  let ctx = null, maitre = null, filtre = null, humide = null, sec = null, vent = null, ventF = null, ville = null, actif = false, voulu = true;
  const bouton = $('#son');
  function bruit(sec2, brun) {
    const n = ctx.sampleRate * sec2, b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); let x = 0; for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; if (brun) { x = (x + 0.02 * w) / 1.02; d[i] = x * 3.5; } else d[i] = w * 0.5; } }
    const s = ctx.createBufferSource(); s.buffer = b; s.loop = true; s.start(); return s;
  }
  function construire() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    maitre = ctx.createGain(); maitre.gain.value = 0;
    filtre = ctx.createBiquadFilter(); filtre.type = 'lowpass'; filtre.frequency.value = 16000;
    sec = ctx.createGain(); humide = ctx.createGain(); humide.gain.value = 0;
    const rev = ctx.createConvolver();
    { const n = ctx.sampleRate * 0.6, ir = ctx.createBuffer(2, n, ctx.sampleRate); for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2); } rev.buffer = ir; }
    maitre.connect(filtre); filtre.connect(sec).connect(ctx.destination); filtre.connect(rev).connect(humide).connect(ctx.destination);
    // vent dans les feuilles : bruit blanc en bande passante, modulé lentement
    vent = ctx.createGain(); vent.gain.value = 0.11;
    ventF = ctx.createBiquadFilter(); ventF.type = 'bandpass'; ventF.frequency.value = 700; ventF.Q.value = 0.6;
    bruit(5, false).connect(ventF).connect(vent).connect(maitre);
    const lfo = ctx.createOscillator(), lfoG = ctx.createGain(); lfo.frequency.value = 0.09; lfoG.gain.value = 320; lfo.connect(lfoG).connect(ventF.frequency); lfo.start();
    const lfo2 = ctx.createOscillator(), lfo2G = ctx.createGain(); lfo2.frequency.value = 0.053; lfo2G.gain.value = 0.05; lfo2.connect(lfo2G).connect(vent.gain); lfo2.start();
    // rumeur de ville lointaine : bruit brun très filtré
    ville = ctx.createGain(); ville.gain.value = 0.22;
    const vf = ctx.createBiquadFilter(); vf.type = 'lowpass'; vf.frequency.value = 260;
    bruit(6, true).connect(vf).connect(ville).connect(maitre);
    oiseaux();
  }
  function gazouillis() {
    const t0 = ctx.currentTime + 0.02, notes = 2 + Math.floor(Math.random() * 5), base = 2600 + Math.random() * 2600;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null; if (pan) pan.pan.value = Math.random() * 1.6 - 0.8;
    const g = ctx.createGain(); g.gain.value = 0; (pan ? g.connect(pan).connect(maitre) : g.connect(maitre));
    for (let i = 0; i < notes; i++) {
      const o = ctx.createOscillator(), m = ctx.createOscillator(), mg = ctx.createGain(), e = ctx.createGain();
      const t = t0 + i * (0.09 + Math.random() * 0.07), d = 0.05 + Math.random() * 0.07, f = base * (0.85 + Math.random() * 0.4);
      o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * (Math.random() > 0.5 ? 1.35 : 0.72), t + d);
      m.frequency.value = 40 + Math.random() * 60; mg.gain.value = f * 0.06; m.connect(mg).connect(o.frequency);
      e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(0.05, t + 0.012); e.gain.exponentialRampToValueAtTime(0.0008, t + d);
      o.connect(e).connect(g); o.start(t); m.start(t); o.stop(t + d + 0.05); m.stop(t + d + 0.05);
    }
    g.gain.value = 1;
  }
  function oiseaux() { const boucle = () => { if (ctx && actif && espace !== 'dedans' && Math.random() < 0.8) gazouillis(); setTimeout(boucle, 1400 + Math.random() * 3800); }; boucle(); }
  let espace = 'dehors';
  function espaceAt(t, mode) {
    const e = mode === 'walk' ? (S.indoor ? 'dedans' : 'balcon') : 'dehors';
    if (!ctx || e === espace) return; espace = e;
    const now = ctx.currentTime;
    filtre.frequency.setTargetAtTime(e === 'dedans' ? 1300 : e === 'balcon' ? 7000 : 16000, now, 0.5);
    humide.gain.setTargetAtTime(e === 'dedans' ? 0.32 : 0.04, now, 0.5);
    vent.gain.setTargetAtTime(e === 'dedans' ? 0.04 : 0.11, now, 0.6);
  }
  function appliquer() {
    if (!ctx) return;
    maitre.gain.setTargetAtTime(actif ? 0.9 : 0, ctx.currentTime, 0.6);
    bouton.setAttribute('aria-pressed', String(actif)); bouton.setAttribute('aria-label', actif ? 'Couper le son d’ambiance' : 'Activer le son d’ambiance');
  }
  bouton.addEventListener('click', (e) => { e.stopPropagation(); voulu = !actif; if (!ctx) construire(); ctx.resume(); actif = voulu; appliquer(); });
  return {
    reveil() { if (POSTER || ctx) return; try { construire(); ctx.resume(); actif = voulu; appliquer(); } catch (e) { /* audio indisponible */ } },
    espace: espaceAt,
    tic() { if (!ctx || !actif) return; const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 1800; g.gain.setValueAtTime(0.03, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.0005, ctx.currentTime + 0.06); o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.08); },
    declic() { if (!ctx || !actif) return; const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(660, ctx.currentTime); o.frequency.exponentialRampToValueAtTime(990, ctx.currentTime + 0.18); g.gain.setValueAtTime(0.05, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.0005, ctx.currentTime + 0.5); o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.55); },
  };
})();

// ------------------------------------------------------------------ boucle
let dernier = performance.now();
function boucle(now) {
  requestAnimationFrame(boucle);
  const dt = Math.min(0.1, (now - dernier) / 1000); dernier = now;
  if (!V || !demarre) return;
  // lissage façon Lenis : la timeline affichée rejoint la cible avec inertie
  affiche += (cible - affiche) * (1 - Math.exp(-dt * (REDUCED ? 9 : 2.8)));
  if (Math.abs(cible - affiche) < 2e-6) affiche = cible;
  const { mode } = poser(affiche, now, dt, false);
  // moment du choix : survol actif ; sans clic après ~4 s de défilement contre la butée, le 201 est choisi
  choixActif = !LOT && affiche > CHOIX_T - 0.012;
  if (!LOT && poussee > 0) { pousseeT += dt; poussee = 0; }
  if (!LOT && pousseeT > 4) choisir('201');
  if (choixActif && survol) placerEtiq(survol);
  majMots(affiche);
  son.espace(affiche, mode);
  $('#filB').style.transform = `scaleX(${affiche})`;
}
let pousseeT = 0;

// ------------------------------------------------------------------ chargement : l'image fixe attend, la 3D la remplace
const ifr = $('#scene');
let style = false;
const attente = setInterval(() => {
  let w = null; try { w = ifr.contentWindow; } catch (e) { return; }
  if (!w || !w.document) return;
  // l'écran de chargement de la maquette ne doit jamais apparaître
  if (!style && w.document.head) { const s = w.document.createElement('style'); s.textContent = '#loader,.loader{display:none!important}'; w.document.head.appendChild(s); style = true; }
  if (w.__viewer && w.__viewer.lots && w.__viewer.composer) {
    clearInterval(attente);
    preparer(w);
    const sc = w.document.createElement('script'); sc.type = 'module'; sc.src = new URL('fx-xp.js', location.href).href; w.document.head.appendChild(sc);
    const pret = () => {
      poser(0, performance.now(), 0.016, true);
      demarre = true;
      // deux images rendues avant le fondu (environnement et ombres stabilisés)
      setTimeout(() => { ifr.classList.add('pret'); document.body.classList.add('pret'); }, POSTER ? 0 : 450);
    };
    const t0 = performance.now();
    const att = setInterval(() => { if (w.__xpfx || performance.now() - t0 > 4000) { clearInterval(att); pret(); } }, 50);
  }
}, 60);
window.__xp = { saut(v) { cible = affiche = clamp01(v); }, get t() { return affiche; }, set cible(v) { cible = clamp01(v); }, get cible() { return cible; }, choisir, get lot() { return LOT; }, get V() { return V; }, get pret() { return ifr.classList.contains('pret'); }, look: R };
requestAnimationFrame(boucle);
