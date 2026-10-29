// « Dans la peau de l'acheteur » — scrollytelling sur la maquette Canopée (iframe de même origine).
// Le défilement fait avancer une timeline 0 → 1 ; la caméra suit des splines (Catmull-Rom) reprises des
// tournages vidéo (video/src/timeline*.js), avec amortissement. Aucune modification de canopee/3d/.

const $ = (s) => document.querySelector(s);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const smoother = (x) => { x = clamp01(x); return x * x * x * (x * (x * 6 - 15) + 10); };
const sstep = (a, b, x) => smooth((x - a) / (b - a));

// ------------------------------------------------------------------ chapitres
const CH = [
  { nom: 'Arrivée', a: 0.0, b: 0.115 }, { nom: 'Balcon', a: 0.145, b: 0.275 }, { nom: 'Votre lot', a: 0.325, b: 0.452 },
  { nom: 'Séjour', a: 0.505, b: 0.632 }, { nom: 'Le soir', a: 0.668, b: 0.795 }, { nom: 'Adresse', a: 0.848, b: 0.925 },
  { nom: 'Neokrome', a: 0.962, b: 1.001 },
];
const centre = (i) => (i === 0 ? 0.05 : i === CH.length - 1 ? 1 : (CH[i].a + CH[i].b) / 2);

// ------------------------------------------------------------------ trajectoires (3 blocs séparés par des fondus)
// t = position sur la timeline ; pos / tgt en mètres ; fov vertical pour un écran 16:10 (adapté au portrait)
const BLOCS = [
  { de: 0, a: 0.476, mode: 'ext', keys: [
    { t: 0.0, pos: [0.3, 1.7, 21.5], tgt: [0.3, 5.4, -6], fov: 46 },
    { t: 0.11, pos: [0.3, 1.7, 17.6], tgt: [0.4, 5.8, -6], fov: 46 },
    { t: 0.16, pos: [2.0, 3.6, 13.0], tgt: [2.8, 7.2, -2], fov: 50 },
    { t: 0.27, pos: [3.6, 8.4, 6.6], tgt: [3.0, 7.9, -2.5], fov: 50 },
    { t: 0.33, pos: [-11.5, 29.5, 15.5], tgt: [0.3, 7.4, -9.3], fov: 40 },
    { t: 0.476, pos: [-6.8, 24.8, 11.2], tgt: [0.4, 7.2, -9.2], fov: 40 },
  ] },
  { de: 0.476, a: 0.82, mode: 'walk', keys: [
    { t: 0.476, pos: [3.0, 8.05, -5.45], tgt: [1.4, 7.7, 3.0], fov: 60, int: true },
    { t: 0.505, pos: [3.0, 8.05, -5.2], tgt: [1.8, 7.7, 3.2], fov: 60, int: true },
    { t: 0.632, pos: [3.0, 7.98, -3.35], tgt: [3.0, 7.68, 6.5], fov: 59, int: true },
    { t: 0.672, pos: [3.05, 7.95, -0.3], tgt: [3.3, 7.45, 9.0], fov: 62, int: true },
    { t: 0.82, pos: [3.0, 7.95, 0.15], tgt: [-1.5, 8.9, 9.0], fov: 62, int: true },
  ] },
  { de: 0.82, a: 1.0, mode: 'ext', keys: [
    { t: 0.82, pos: [4.4, 1.5, 15.5], tgt: [0.0, 8.2, -6], fov: 52 },
    { t: 0.85, pos: [4.6, 1.55, 16.5], tgt: [0.0, 8.1, -6], fov: 52 },
    { t: 0.94, pos: [6.0, 1.9, 26.0], tgt: [0.0, 7.8, -6], fov: 48 },
    { t: 1.0, pos: [6.4, 2.0, 28.0], tgt: [0.0, 7.7, -6], fov: 48 },
  ] },
];
// heure du jour le long de la timeline (21 juin) : heure dorée → coucher → heure bleue
const HEURES = [[0, 19.6], [0.47, 19.8], [0.64, 20.1], [0.68, 20.5], [0.8, 21.7], [0.83, 22.45], [1, 22.6]];
// coupe d'étage (chapitre 3) et mise en avant du lot 201
const coupe = (t) => (t < 0.31 ? null : lerp(16.4, 7.6, smoother((t - 0.325) / 0.075)));
const LOT = '201';

function cr1(p0, p1, p2, p3, u) { const u2 = u * u, u3 = u2 * u; return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3); }
// Catmull-Rom non uniforme en temps : on cherche le segment de t puis on interpole
function splineAt(keys, t, f) {
  const n = keys.length;
  if (t <= keys[0].t) return f(keys[0]);
  if (t >= keys[n - 1].t) return f(keys[n - 1]);
  let i = 0; while (i < n - 2 && t > keys[i + 1].t) i++;
  const u = (t - keys[i].t) / (keys[i + 1].t - keys[i].t);
  const g = (k) => f(keys[Math.max(0, Math.min(n - 1, k))]);
  const P0 = i === 0 ? g(0).map((v, j) => 2 * v - g(1)[j]) : g(i - 1), P3 = i + 2 > n - 1 ? g(n - 1).map((v, j) => 2 * v - g(n - 2)[j]) : g(i + 2);
  const P1 = g(i), P2 = g(i + 1);
  return P1.map((_, j) => cr1(P0[j], P1[j], P2[j], P3[j], u));
}
function heureAt(t) {
  for (let i = 0; i < HEURES.length - 1; i++) { const [t0, h0] = HEURES[i], [t1, h1] = HEURES[i + 1]; if (t <= t1) return lerp(h0, h1, smooth((t - t0) / (t1 - t0))); }
  return HEURES[HEURES.length - 1][1];
}
const GOLD = { warm: 2.2, sun: 1.4, hemi: 1.3, fogWarm: 0.8, exposure: 0.98 }, BASE = { warm: 0.6, sun: 0.95, hemi: 1.9, fogWarm: 0.45, exposure: 1.05 };
function lookFor(h) { const w = sstep(18.6, 19.5, h) * (1 - sstep(21.2, 22.1, h)); const o = {}; for (const k in GOLD) o[k] = +lerp(BASE[k], GOLD[k], w).toFixed(2); return o; }

// ------------------------------------------------------------------ pilotage de la maquette
let V = null, THREE = null, cam = null, hPlane = null, S = { walk: false, indoor: false };
const cur = { mode: null, hour: null, look: '', cut: null, lot: false, hourAt: 0 };
function setupViewer(w) {
  V = w.__viewer; THREE = V.THREE; cam = V.camera;
  V.controls.update = () => false; V.controls.enabled = false;
  if (V.nav) {
    V.nav.update = () => false;
    const gs0 = V.nav.getState.bind(V.nav);
    V.nav.getState = () => ({ ...gs0(), mode: S.walk ? 'walk' : 'orbit', indoor: S.walk && S.indoor });
  }
  const hourEl = w.document.getElementById('hour');
  if (hourEl) { hourEl.min = '4'; hourEl.max = '23.5'; hourEl.step = 'any'; }
  hPlane = V.M.renderWhite.clippingPlanes[0];
  V.lots.group.traverse((o) => { if (o.isSprite) o.visible = false; });
}
const finishCut = () => { const an = V.cfg.cut.anim; V.cfg.cut.anim = null; if (an && an.onEnd) an.onEnd(); };
const noOffset = () => { const vo = V.cfg.vo; vo.x = vo.tx = vo.y = vo.ty = 0; cam.clearViewOffset(); };
function setMode(m) {
  if (m === cur.mode) return;
  if (m === 'ext') { V.closeSheet(); V.setFloor(null, { fly: false }); finishCut(); }
  else if (m === 'plan') { V.setFloor(2, { fly: false, view: 'plan' }); finishCut(); V.lots.setFloor(2); V.lots.setViewMode && V.lots.setViewMode('plan'); V.cfg.cut.ready = true; }
  else if (m === 'walk') { V.closeSheet(); V.setFloor(2, { fly: false, view: 'walk' }); finishCut(); V.lots.setFloor(2); V.lots.setViewMode && V.lots.setViewMode('walk'); V.cfg.cut.ready = true; }
  V.lots.group.traverse((o) => { if (o.isSprite) o.visible = false; });
  noOffset();
  cur.mode = m; cur.lot = false; cur.cut = null;
}
function setLot(on) {
  if (on === cur.lot) return;
  if (on) V.selectLot(LOT, { fly: false, open: false }); else { V.lots.setSelected(null); V.lots.setFilter(null); }
  noOffset(); cur.lot = on;
}
function setCut(y) {
  const c = y == null ? 1e4 : y;
  if (cur.cut != null && Math.abs(cur.cut - c) < 1e-3) return;
  V.cfg.cut.anim = null; V.cfg.cut.y = c; hPlane.constant = c; V.renderer.shadowMap.needsUpdate = true; cur.cut = c;
}
function setHeure(h, now, force) {
  const lk = JSON.stringify(lookFor(h));
  if (lk !== cur.look) { V.tune(JSON.parse(lk)); cur.look = lk; cur.hour = null; }
  // l'environnement (PMREM) est recalculé à chaque heure : au plus ~8 fois par seconde
  if (force || cur.hour == null || (Math.abs(cur.hour - h) > 0.015 && now - cur.hourAt > 120)) { V.setHour(h); cur.hour = h; cur.hourAt = now; }
}
const _t = { x: 0, y: 0, z: 0 };
function poser(t, now, force) {
  const bloc = BLOCS.find((b) => t >= b.de && t <= b.a) || BLOCS[BLOCS.length - 1];
  let mode = bloc.mode;
  const y = coupe(t);
  if (mode === 'ext' && y != null && t < 0.5) mode = 'plan';
  setMode(mode);
  setHeure(heureAt(t), now, force);
  setCut(mode === 'walk' ? 8.92 : mode === 'plan' ? y : null);
  if (mode === 'plan') setLot(t > 0.388);
  let pos = splineAt(bloc.keys, t, (k) => k.pos), tgt = splineAt(bloc.keys, t, (k) => k.tgt);
  let fov = splineAt(bloc.keys, t, (k) => [k.fov])[0];
  const interieur = bloc.keys[0].int;
  // adaptation au cadre : on conserve le champ horizontal prévu pour 16:10, en reculant si le champ vertical serait trop grand
  const asp = innerWidth / innerHeight, D = Math.PI / 180;
  const hHalf = Math.atan(Math.tan(fov * D / 2) * 1.6), vWanted = Math.atan(Math.tan(hHalf) / asp) * 2 / D;
  const cap = interieur ? 74 : 64;
  fov = Math.min(vWanted, cap);
  if (vWanted > cap && !interieur) {
    const k = Math.min(1.7, Math.tan(vWanted * D / 2) / Math.tan(cap * D / 2));
    pos = pos.map((v, j) => tgt[j] + (v - tgt[j]) * k);
    if (pos[1] < 1.4) pos[1] = 1.4;
  }
  S.walk = mode === 'walk'; S.indoor = S.walk && pos[2] < -1.3;
  cam.position.set(pos[0], pos[1], pos[2]);
  V.controls.target.set(tgt[0], tgt[1], tgt[2]);
  cam.up.set(0, 1, 0);
  _t.x = tgt[0]; _t.y = tgt[1]; _t.z = tgt[2];
  cam.lookAt(_t.x, _t.y, _t.z);
  cam.fov = fov; cam.zoom = 1; cam.updateProjectionMatrix();
  if (V.lots.update) V.lots.update(1 / 60);
  V.lots.group.traverse((o) => { const m = o.material; if (m && m.name && m.name.startsWith('lotTint:')) m.opacity = m.name.endsWith(LOT) && cur.lot ? 0.3 : Math.min(m.opacity, 0.12); });
  V.controls.dispatchEvent({ type: 'change' });          // le viewer rend l'image dans sa propre boucle
}

// ------------------------------------------------------------------ interface : chapitres, fondus, saisie
const chaps = [...document.querySelectorAll('.chap')];
chaps.forEach((c) => c.querySelectorAll('.titre').forEach((h) => {
  // titres découpés en lignes masquées (le texte reste lisible tel quel par les lecteurs d'écran)
  const html = h.innerHTML; h.setAttribute('aria-label', h.textContent);
  h.innerHTML = `<span class="ligne" aria-hidden="true"><span>${html}</span></span>`;
}));
const barre = $('#barre');
CH.forEach((c, i) => {
  const li = document.createElement('li');
  li.innerHTML = `<button type="button" aria-label="Chapitre ${i + 1} : ${c.nom}"><i><b></b></i><span class="num">${String(i + 1).padStart(2, '0')}</span> <span class="nom">${c.nom}</span></button>`;
  li.querySelector('button').addEventListener('click', () => allerA(i));
  barre.appendChild(li);
});
const btns = [...barre.querySelectorAll('button')];
let cible = 0, affiche = 0, actif = -1, demarre = false, dernier = performance.now();
const chapDe = (t) => { let k = 0; CH.forEach((c, i) => { if (t >= c.a - 0.02) k = i; }); return k; };
function allerA(i) { cible = centre(i); if (REDUCED) { affiche = cible; fondu(); } masquerAide(); }
let fonduT = -1; function fondu() { fonduT = performance.now(); }

function majInterface(t, now) {
  // chapitres visibles
  let vis = -1;
  CH.forEach((c, i) => { if (t >= c.a && t <= c.b) vis = i; });
  if (t < CH[0].a + 0.001) vis = 0;
  chaps.forEach((el, i) => {
    const on = i === vis;
    if (on !== el.classList.contains('vis')) { el.classList.toggle('vis', on); el.setAttribute('aria-hidden', String(!on)); }
    // fondu doux en entrée/sortie de plage
    const c = CH[i], f = Math.min(i === 0 ? 1 : sstep(c.a, c.a + 0.012, t), 1 - sstep(c.b - 0.012, c.b, t));
    el.style.opacity = String(i === CH.length - 1 ? sstep(c.a, c.a + 0.015, t) : f);
  });
  const k = chapDe(t);
  if (k !== actif) { actif = k; btns.forEach((b, i) => { if (i === k) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); }); }
  btns.forEach((b, i) => { const c = CH[i], a = i ? CH[i - 1].b : 0; b.querySelector('b').style.setProperty('--p', String(clamp01((t - a) / (c.b - a)))); });
  // fondus de passage (extérieur → visite, balcon → extérieur) et fond nuit final
  const dip = (c, w) => 1 - smooth(Math.abs(t - c) / w);
  let noir = Math.max(dip(0.476, 0.022), dip(0.82, 0.02));
  if (REDUCED && fonduT > 0) noir = Math.max(noir, 1 - clamp01((now - fonduT) / 450));
  const nuit = sstep(0.935, 0.972, t);
  const n = $('#noir'); n.classList.toggle('nuit', nuit > 0.01 && noir < 0.5); n.style.opacity = String(Math.max(noir, nuit));
  $('.voile').style.opacity = String(1 - nuit);
}

// saisie : molette / trackpad, clavier, glisser (doigt ou souris)
const PAS = 0.00016;
function ajoute(d) { if (!demarre) return; if (REDUCED) return; cible = clamp01(cible + d); masquerAide(); }
addEventListener('wheel', (e) => { e.preventDefault(); if (REDUCED) { if (Math.abs(e.deltaY) > 20) pasChapitre(Math.sign(e.deltaY)); return; } const k = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? innerHeight : 1; ajoute(e.deltaY * k * PAS); }, { passive: false });
let lastStep = 0;
function pasChapitre(dir) { const now = performance.now(); if (now - lastStep < 500) return; lastStep = now; const k = chapDe(cible + (dir > 0 ? 0.001 : -0.001)); const next = Math.max(0, Math.min(CH.length - 1, dir > 0 ? (cible < centre(k) - 0.005 ? k : k + 1) : (cible > centre(k) + 0.005 ? k : k - 1))); allerA(next); }
addEventListener('keydown', (e) => {
  if (!demarre) return;
  const tag = (e.target && e.target.tagName) || '';
  if (['ArrowDown', 'PageDown'].includes(e.key) || (e.key === ' ' && tag !== 'BUTTON' && tag !== 'A')) { e.preventDefault(); pasChapitre(1); }
  else if (['ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); pasChapitre(-1); }
  else if (e.key === 'Home') { e.preventDefault(); allerA(0); }
  else if (e.key === 'End') { e.preventDefault(); allerA(CH.length - 1); }
});
let glisse = null;
addEventListener('pointerdown', (e) => { if (e.target.closest('a,button')) return; glisse = { y: e.clientY, c: cible, t: performance.now() }; });
addEventListener('pointermove', (e) => { if (!glisse || REDUCED) return; cible = clamp01(glisse.c + (glisse.y - e.clientY) / innerHeight * 0.32); masquerAide(); });
addEventListener('pointerup', (e) => { if (glisse && REDUCED && Math.abs(glisse.y - e.clientY) > 40) pasChapitre(glisse.y > e.clientY ? 1 : -1); glisse = null; });
addEventListener('pointercancel', () => { glisse = null; });
function masquerAide() { $('#aide').classList.add('off'); }

// ------------------------------------------------------------------ boucle
function boucle(now) {
  requestAnimationFrame(boucle);
  const dt = Math.min(0.1, (now - dernier) / 1000); dernier = now;
  if (!V || !demarre) return;
  // amortissement : la caméra rejoint la timeline visée sans à-coup
  affiche = REDUCED ? cible : affiche + (cible - affiche) * (1 - Math.exp(-dt * 4.2));
  if (Math.abs(cible - affiche) < 1e-5) affiche = cible;
  poser(affiche, now, false);
  majInterface(affiche, now);
}

// ------------------------------------------------------------------ son d'ambiance (généré, coupé par défaut)
let audio = null;
function son(on) {
  if (on && !audio) {
    const ctx = new AudioContext(), len = ctx.sampleRate * 4, buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); let b = 0; for (let i = 0; i < len; i++) { b = (b + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = b * 3.2; } }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(lp).connect(g).connect(ctx.destination); src.start();
    audio = { ctx, g };
  }
  if (!audio) return;
  audio.ctx.resume();
  audio.g.gain.setTargetAtTime(on ? 0.16 : 0, audio.ctx.currentTime, 0.4);
}
$('#son').addEventListener('click', (e) => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', String(on)); e.currentTarget.setAttribute('aria-label', on ? 'Couper le son d’ambiance' : 'Activer le son d’ambiance'); son(on); });

// ------------------------------------------------------------------ chargement et entrée
const ifr = $('#scene');
const entrer = $('#entrer');
async function carteLot() {
  try {
    const d = await (await fetch('../../canopee/3d/lots.json')).json();
    const L = d.lots.find((l) => String(l.id) === LOT), st = d.statuts[L.status];
    const ext = (L.exterieurs || []).reduce((a, e) => a + e.surface, 0);
    $('#carte').innerHTML = `<span class="k">R+${L.level} · côté rue · ${L.orientation}</span>
      <b>Lot ${L.id} · ${L.typo}</b><span class="prix">${new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(L.prix)}</span>
      <span class="st">${st.label}</span><span class="d">${L.surface} m² · ${ext} m² d’extérieurs</span>`;
  } catch (e) { $('#carte').textContent = 'Lot 201 · T4 · 77 m² · disponible'; }
}
carteLot();
const attente = setInterval(() => {
  let w = null; try { w = ifr.contentWindow; } catch (e) { return; }
  if (!w) return;
  try { const b = w.document.getElementById('loadBar'); if (b) $('#chargeB').style.width = b.style.width; } catch (e) { /* chargement */ }
  if (w.__viewer && w.__viewer.lots) {
    clearInterval(attente);
    setupViewer(w);
    poser(0, performance.now(), true);
    $('#chargeB').style.width = '100%';
    entrer.disabled = false; $('#entrerT').textContent = 'Entrer';
    entrer.focus();
  }
}, 150);
entrer.addEventListener('click', () => {
  demarre = true;
  $('#accueil').classList.add('parti');
  $('#accueil').setAttribute('aria-hidden', 'true');
  document.querySelector('main').focus?.();
  dernier = performance.now();
  // le clic d'entrée débloque l'audio (le son reste coupé tant qu'on ne l'active pas)
  try { if (!audio) { son(false); } } catch (e) { /* audio indisponible */ }
  setTimeout(() => { if (cible < 0.004 && !REDUCED) cible = 0.03; }, 600);
});
window.__xp = { get t() { return affiche; }, set cible(v) { cible = clamp01(v); }, get cible() { return cible; }, allerA, CH, get V() { return V; } };
requestAnimationFrame(boucle);
