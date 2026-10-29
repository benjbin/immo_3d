// Canopée — visionneuse 3D temps réel.
// Rendu : AgX/ACES, ciel Preetham + environnement PMREM, soleil à ombres douces, GTAO, bloom léger.
// Modules du modèle (materials.js, building.js, landscape.js) chargés dynamiquement, avec remplacements internes.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/* ------------------------------------------------------------------ */
/* Paramètres d'URL (utiles pour les captures et le débogage)          */
/* ?view=1..8  ?hour=17.5  ?q=auto|high|medium|low  ?ui=0  ?intro=0    */
/* ?fallback=1 (force les remplacements)  ?tm=agx|aces  ?exp=1.0       */
/* ------------------------------------------------------------------ */
const URLP = new URLSearchParams(location.search);
const PARAMS = {
  view: clampInt(URLP.get('view'), 1, 8, 1) - 1,
  hour: URLP.has('hour') ? THREE.MathUtils.clamp(parseFloat(URLP.get('hour')) || 18, 8, 20) : 18,
  quality: ['auto', 'high', 'medium', 'low'].includes(URLP.get('q')) ? URLP.get('q') : 'auto',
  ui: URLP.get('ui') !== '0',
  intro: URLP.get('intro') !== '0',
  fallback: URLP.get('fallback') === '1',
  toneMapping: URLP.get('tm') === 'agx' ? 'agx' : 'aces',
  exposure: URLP.has('exp') ? parseFloat(URLP.get('exp')) || 1 : null,
  season: ['ete', 'equinoxe', 'hiver'].includes(URLP.get('date')) ? URLP.get('date') : 'ete',
  lot: (URLP.get('lot') || '').replace(/[^\w-]/g, '').slice(0, 12) || null,
};
function clampInt(v, a, b, d) { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : d; }

const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;
const TOUCH = matchMedia('(hover: none) and (pointer: coarse)').matches;
document.documentElement.classList.add(TOUCH ? 'touch' : 'notouch');
if (!PARAMS.ui) document.body.classList.add('noui');
if (PARAMS.lot) PARAMS.intro = false;   // arrivée depuis le site : pas d'intro longue

const BRASS = new THREE.Color('#d8bd8c');
// réglages d'ambiance (ajustés par comparaison avec les rendus de référence)
const LOOK = {
  turbidity: 2.5, rayleigh: 1.2, mie: 0.003, mieG: 0.8,                 // ciel Preetham
  skyScale: 0.5, skySat: 1.6, skyTint: [0.85, 0.96, 1.42], skyPop: 0.8,  // fond : bleu franc
  envScale: 1.15, envSat: 0.4, envTint: [1.03, 1.0, 0.96], ground: 1,     // environnement : ciel désaturé, ombres neutres
  sun: 0.95, hemi: 1.9, hemiSky: '#dfe3e8', exposure: 1.05,               // lumières (×) et exposition
  fog: 0.0042, fogWarm: 0.45,                                             // perspective atmosphérique chaude
  greens: 1.3, lift: 0.55, warm: 0.6, contrast: 0.14, sat: 1.1, shadeWB: [1.02, 1.0, 0.98], // étalonnage
};
// ?look={...} : surcharge de réglages pour la mise au point (ignorée si invalide)
try { if (URLP.has('look')) Object.assign(LOOK, JSON.parse(URLP.get('look'))); } catch (e) { /* réglages par défaut */ }
const DEG = Math.PI / 180;

/* ------------------------------------------------------------------ */
/* Points de vue : reproduisent les 8 rendus de référence              */
/* pos / tgt en mètres, fov vertical pour l'aspect de la référence     */
/* ------------------------------------------------------------------ */
const VIEWS = [
  { id: 'p01', t: 'Façade sur rue', d: 'Le socle des garages, puis trois niveaux de balcons plantés.', pos: [0.2, 8.5, 27], tgt: [0.3, 6.4, -8.5], fov: 38, aspect: 4 / 3},
  { id: 'p02', t: "À l'angle", d: 'Les balcons filants qui se retournent sur la façade anthracite.', pos: [25, 2.2, 11.5], tgt: [-1, 6.2, -8], fov: 42, aspect: 4 / 3, crop: 0.7, portrait: { pos: [25, 2.4, 11.5], tgt: [-0.5, 7.4, -8], fov: 66 }},
  { id: 'p03', t: 'Survol de la façade', d: 'Le toit-terrasse apparaît : salon, table et prairie.', pos: [18.1, 24.25, 27.0], tgt: [-0.5, 4.0, -7.0], fov: 35, aspect: 4 / 3},
  { id: 'p04', t: 'Trois-quarts aérien', d: 'La façade blanche se dévoile le long du jardin.', pos: [-20.6, 27.9, 22.9], tgt: [-0.1, 4.8, -7.6], fov: 35, aspect: 4 / 3},
  { id: 'p05', t: "Côté jardin, vu d'en haut", d: 'Une toiture entièrement plantée au-dessus des arbres.', pos: [-28.0, 42.4, 31.2], tgt: [0, 7.5, -7.6], fov: 26, aspect: 16 / 9},
  { id: 'p06', t: 'Côté jardin, plus près', d: 'Le rythme des fenêtres et le noyau anthracite.', pos: [-23.3, 36.1, 24.8], tgt: [0, 7.0, -7.6], fov: 26, aspect: 16 / 9},
  { id: 'p07', t: 'Façade jardin', d: 'Le long du jardin, au-dessus des massifs : fenêtres et cage d’escalier.', pos: [-36.4, 7.1, -7.4], tgt: [0, 7.1, -7.4], fov: 38, aspect: 4 / 3, crop: 0.55},
  { id: 'p08', t: 'Vu du ciel', d: 'Le plan du toit-terrasse, entre prairie et salon d’été.', pos: [0, 47, -7.25], tgt: [0, 6, -7.3], fov: 40, aspect: 4 / 3},
];

/* Réglages par niveau de qualité */
const DPR = Math.min(window.devicePixelRatio || 1, 2);
const QUALITY = {
  high:   { label: 'Haute',   pr: Math.min(DPR, 1.5),  shadow: 4096, ao: true, aoScale: 0.75, aoSamples: 16, pdSamples: 16, msaa: 4, bloom: true,  cheapGlass: false },
  medium: { label: 'Moyenne', pr: Math.min(DPR, 1.25), shadow: 2048, ao: true, aoScale: 0.5, aoSamples: 12, pdSamples: 12, msaa: 4, bloom: true,  cheapGlass: true },
  low:    { label: 'Basse',   pr: 1,                   shadow: 2048, ao: true, aoScale: 0.5, aoSamples: 8,  pdSamples: 8,  msaa: 2, bloom: false, cheapGlass: true, aoFoliage: false },
};
const QUALITY_ORDER = ['high', 'medium', 'low'];

/* Clés de matériaux du contrat (pour compléter un M partiel) */
const MATERIAL_KEYS = ['renderWhite', 'cladding', 'slabWhite', 'glass', 'glassRail', 'frameDark', 'interiorWarm', 'woodSoffit', 'deck',
  'garageDoor', 'doorDark', 'paver', 'sidewalk', 'asphalt', 'curb', 'grass', 'soil', 'leafA', 'leafB', 'leafC', 'bark', 'planter',
  'greenRoof', 'fabric', 'metal'];

const DEFAULT_LEVELS = [
  { key: 0, name: 'RDC', y0: 0, y1: 3 }, { key: 1, name: 'R+1', y0: 3, y1: 6 }, { key: 2, name: 'R+2', y0: 6, y1: 9 },
  { key: 3, name: 'R+3', y0: 9, y1: 12 }, { key: 4, name: 'Toit', y0: 12, y1: 13.2 },
];
const DEFAULT_BOUNDS = { minX: -5.6, maxX: 5.6, minZ: -19, maxZ: 1.5, height: 14.7 };

/* ------------------------------------------------------------------ */
/* Éléments d'interface                                                */
/* ------------------------------------------------------------------ */
const $ = (id) => document.getElementById(id);
const ui = {
  canvas: $('scene'), loader: $('loader'), bar: $('loadBar'), step: $('loadStep'), pct: $('loadPct'), err: $('loadErr'),
  capN: $('capN'), capT: $('capT'), capD: $('capD'), cap: $('cap'),
  views: $('views'), floors: $('floors'), hour: $('hour'), hourOut: $('hourOut'),
  rotate: $('tRotate'), fs: $('tFs'), qBtn: $('tQuality'), qPanel: $('qPanel'), qLabel: $('qLabel'), qNote: $('qNote'), fps: $('fps'),
  hint: $('hint'),
  floorList: $('floorList'), lotsPanel: $('lotsPanel'), lotList: $('lotList'), lotsCount: $('lotsCount'), legend: $('legend'),
  fTypo: $('fTypo'), fStatus: $('fStatus'), fSurf: $('fSurf'), fSurfOut: $('fSurfOut'), fFav: $('fFav'),
  cmpBar: $('cmpBar'), cmpTxt: $('cmpTxt'), cmpGo: $('cmpGo'), cmpClear: $('cmpClear'), cmpDlg: $('compare'), cmpTable: $('cmpTable'),
  sheet: $('sheet'), sheetBody: $('sheetBody'), labels: $('labels'), tip: $('tip'), navRoot: $('navRoot'), navMode: $('navMode'),
  tLots: $('tLots'), tAvail: $('tAvail'), tHelp: $('tHelp'), help: $('help'), dock: $('dock'),
  mmCam: $('mmCam'), mmLots: $('mmLots'), mmCap: $('mmCap'), lotsClose: $('lotsClose'), mmNorth: $('mmNorth'),
  brand: document.querySelector('.brand'), backBtn: $('backBtn'), lift: $('lift'), liftBtns: $('liftBtns'), toast: $('toast'),
  lSort: $('lSort'), sunBar: $('sunBar'), seasons: [...document.querySelectorAll('.seasons [data-season]')],
};

let loadShown = 0;
function progress(p, label) {
  loadShown = Math.max(loadShown, p);
  ui.bar.style.width = `${Math.round(loadShown * 100)}%`;
  ui.pct.textContent = `${Math.round(loadShown * 100)} %`;
  if (label) ui.step.textContent = label;
}
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const idle = () => new Promise((r) => setTimeout(r, 0));

function fail(msg) {
  ui.err.hidden = false;
  ui.err.innerHTML = msg;
  ui.step.textContent = 'Chargement interrompu';
}

/* ------------------------------------------------------------------ */
/* Modèle du soleil (heure d'été, latitude moyenne, façade rue au SSO)  */
/* ------------------------------------------------------------------ */
const SITE = { lat: 48.9, lon: 2.35, facadeAz: 200 };   // rue au sud (SSO) ; +X vers l'est-sud-est
const SEASONS = { ete: { doy: 172, tz: 2 }, equinoxe: { doy: 80, tz: 1 }, hiver: { doy: 355, tz: 1 } };
// position du soleil (algorithme NOAA simplifié), heure légale locale
function solarPosition(hour, season = 'ete') {
  const S = SEASONS[season] || SEASONS.ete;
  const g = 2 * Math.PI / 365 * (S.doy - 1 + (hour - S.tz - 12) / 24);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const tst = hour * 60 + eqt + 4 * SITE.lon - 60 * S.tz;
  const ha = (tst / 4 - 180) * DEG, lat = SITE.lat * DEG;
  const cz = THREE.MathUtils.clamp(Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha), -1, 1);
  const zen = Math.acos(cz);
  const ca = THREE.MathUtils.clamp((Math.sin(lat) * cz - Math.sin(decl)) / (Math.cos(lat) * Math.sin(zen) || 1e-6), -1, 1);
  const th = Math.acos(ca) / DEG;
  const az = ha > 0 ? (th + 180) % 360 : (540 - th) % 360;
  return { elev: 90 - zen / DEG, az };
}
function sunState(hour) {
  const { elev, az } = solarPosition(hour, state.season);
  const rel = (az - SITE.facadeAz) * DEG, e = Math.max(elev, -8) * DEG;
  const dir = new THREE.Vector3(-Math.sin(rel) * Math.cos(e), Math.sin(e), Math.cos(rel) * Math.cos(e)).normalize();
  // couleur et intensité selon la hauteur : heure dorée sous ~7°, heure bleue sous l'horizon
  const stops = [[-6, '#6d7fb0'], [0, '#ff7a30'], [5, '#ff9c55'], [12, '#ffc488'], [24, '#ffdba8'], [40, '#ffe6c2'], [60, '#fff3e2']];
  const col = new THREE.Color();
  for (let i = 0; i < stops.length - 1; i++) {
    const [e0, c0] = stops[i], [e1, c1] = stops[i + 1];
    if (elev <= e1 || i === stops.length - 2) { col.set(c0).lerp(new THREE.Color(c1), THREE.MathUtils.clamp((elev - e0) / (e1 - e0), 0, 1)); break; }
  }
  const day = THREE.MathUtils.smoothstep(elev, -1, 20);       // 0 à l'horizon, 1 en plein jour
  const twilight = THREE.MathUtils.smoothstep(elev, -7, 1);   // lumière résiduelle de l'heure bleue
  return { elev, az, dir, color: col, day, twilight, intensity: 3.1 * Math.pow(day, 0.7) };
}
function formatHour(h) {
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  return `${hh} h ${String(mm).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ */
/* Remplacements internes (si les modules ne sont pas encore livrés)   */
/* ------------------------------------------------------------------ */
function createFallbackMaterials() {
  const std = (color, rough = 0.85, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, ...extra });
  return {
    renderWhite: std('#efeee9', 0.9), cladding: std('#34373b', 0.6), slabWhite: std('#f4f3ef', 0.5),
    glass: new THREE.MeshPhysicalMaterial({ color: '#1d2228', roughness: 0.05, metalness: 0, envMapIntensity: 1.2 }),
    glassRail: new THREE.MeshPhysicalMaterial({ color: '#cfdcd6', roughness: 0.05, transparent: true, opacity: 0.25 }),
    frameDark: std('#202326', 0.35, { metalness: 0.6 }),
    interiorWarm: std('#f3d9a8', 0.9, { emissive: new THREE.Color('#ffb766'), emissiveIntensity: 1.2 }),
    woodSoffit: std('#9a6a42', 0.7), deck: std('#8a5a3b', 0.75), garageDoor: std('#2b2e31', 0.5), doorDark: std('#2b2e31', 0.5),
    paver: std('#b9b8b3', 0.9), sidewalk: std('#cfcdc6', 0.9), asphalt: std('#5d6064', 0.95), curb: std('#bdbbb5', 0.85),
    grass: std('#5f7f3a', 1), soil: std('#4a3a2a', 1), leafA: std('#4f7a32', 0.8), leafB: std('#3f6a2a', 0.8), leafC: std('#6a8a3a', 0.8),
    bark: std('#5a4a3c', 0.95), planter: std('#2f3236', 0.6), greenRoof: std('#6d7f3c', 1), fabric: std('#e8e2d4', 0.95), metal: std('#2a2c2e', 0.4, { metalness: 0.8 }),
  };
}

function createFallbackBuilding(M) {
  const g = new THREE.Group();
  g.name = 'building';
  const box = (x0, x1, y0, y1, z0, z1, m, shadow = true) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), m);
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    mesh.castShadow = shadow; mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  box(-5.6, 5.6, 0, 3, -19, 0.4, M.renderWhite);
  box(-3.35, -0.65, 0, 2.35, 0.4, 0.43, M.garageDoor);
  box(-0.5, 2.2, 0, 2.35, 0.4, 0.43, M.garageDoor);
  box(2.35, 3.45, 0, 2.35, 0.4, 0.43, M.doorDark);
  box(-5, 5, 3, 12, -19, -1.2, M.renderWhite);
  box(-4.05, -0.5, 3, 12, -1.2, 0, M.cladding);
  box(-5, -4.05, 3, 12.35, -1.2, 0.25, M.renderWhite);
  box(5, 5.03, 3, 12, -19, -1.2, M.cladding);
  box(-5.03, -5, 3, 12, -6.4, -5.2, M.cladding);
  box(-5.03, -5, 3, 12, -11.6, -10.1, M.cladding);
  for (let i = 0; i < 3; i++) {
    const y = 3 + i * 3;
    box(-3.7, -0.9, y + 0.35, y + 2.55, 0, 0.03, M.glass);
    box(-0.4, 4.9, y + 0.15, y + 2.6, -1.2, -1.17, M.interiorWarm);
    box(-0.5, 5.6, y - 0.35, y, -1.2, 1.5, M.slabWhite);
    box(5, 6.4, y - 0.35, y, -6, -1.2, M.slabWhite);
    box(-0.5, 5.6, y, y + 1, 1.44, 1.5, M.glassRail, false);
    for (const z of [-1.6, -3.4, -7.6, -9.0, -13.2, -14.8, -17.4]) box(-5.06, -5, y + 0.95, y + 2.0, z - 0.475, z + 0.475, M.interiorWarm);
  }
  box(-0.5, 5.6, 11.65, 12.35, -1.2, 1.5, M.slabWhite);
  box(-5, 5, 12, 12.35, -19, -1.2, M.slabWhite);
  box(-4.8, 4.8, 12.35, 12.45, -7.5, -0.3, M.deck);
  box(-4.8, 4.8, 12.35, 12.6, -18.7, -7.5, M.greenRoof);
  box(-3, -0.6, 12, 14.7, -9.8, -7.2, M.cladding);
  g.userData = { levels: DEFAULT_LEVELS, planters: [], bounds: { ...DEFAULT_BOUNDS } };
  return g;
}

function createFallbackLandscape(M) {
  const g = new THREE.Group();
  g.name = 'landscape';
  const ground = new THREE.Mesh(new THREE.CircleGeometry(120, 64), M.grass);
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  g.add(ground);
  const slab = (x0, x1, z0, z1, h, m) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, h, z1 - z0), m);
    mesh.position.set((x0 + x1) / 2, h / 2, (z0 + z1) / 2); mesh.receiveShadow = true;
    g.add(mesh);
  };
  slab(-80, 80, 7.5, 15, 0.02, M.asphalt);
  slab(-80, 80, 4.5, 7.5, 0.12, M.sidewalk);
  slab(-3.5, 2.3, 0.4, 4.5, 0.05, M.paver);
  const trees = [];
  const leaves = ['#4f7a32', '#3f6a2a', '#6a8a3a'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }));
  const rnd = mulberry32(7);
  const addTree = (x, z, h) => {
    const r = h * 0.32;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, h * 0.55, 6), M.bark);
    trunk.position.set(x, h * 0.275, z); trunk.castShadow = true;
    g.add(trunk);
    for (let k = 0; k < 3; k++) {
      const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(r * (0.7 + rnd() * 0.3), 1), leaves[k % 3]);
      blob.position.set(x + (rnd() - 0.5) * r, h * 0.62 + rnd() * r * 0.5, z + (rnd() - 0.5) * r);
      blob.castShadow = blob.receiveShadow = true;
      g.add(blob);
    }
    trees.push({ x, z, height: h, radius: r });
  };
  addTree(-8, 5.6, 5.5); addTree(8, 5.6, 5.5);
  for (const [x, z, h] of [[-12, -4, 9], [-13, -14, 11], [-10, -24, 10], [3, -27, 12], [12, -20, 9], [13, -9, 8], [-20, 2, 10], [20, -2, 11]]) addTree(x, z, h);
  for (let i = 0; i < 40; i++) {
    const a = rnd() * Math.PI * 2, d = 38 + rnd() * 40;
    const x = Math.cos(a) * d, z = Math.sin(a) * d - 8;
    if (z > 3 && z < 18) continue;
    addTree(x, z, 9 + rnd() * 6);
  }
  g.userData.trees = trees;
  return g;
}
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

async function tryImport(path) {
  if (PARAMS.fallback) return null;
  try { return await import(path); } catch (e) { console.warn(`[viewer] ${path} indisponible : remplacement interne.`, e && e.message); return null; }
}
async function tryCall(fn, args, label) {
  if (typeof fn !== 'function') return null;
  try { return await fn(...args); } catch (e) { console.warn(`[viewer] ${label} a échoué : remplacement interne.`, e); return null; }
}

/* ------------------------------------------------------------------ */
/* Ciel : un Sky pour l'arrière-plan (cubemap), un autre sans disque    */
/* solaire pour l'éclairage d'environnement (PMREM)                     */
/* ------------------------------------------------------------------ */
function makeSky(withSunDisc) {
  const sky = new Sky();
  sky.scale.setScalar(1000);
  const m = sky.material;
  m.uniforms.skyScale = { value: 1 };
  m.uniforms.skySat = { value: 1 };
  m.uniforms.skyTint = { value: new THREE.Vector3(1, 1, 1) };
  let fs = m.fragmentShader.replace('uniform vec3 up;', 'uniform vec3 up;\nuniform float skyScale;\nuniform float skySat;\nuniform vec3 skyTint;')
    .replace('gl_FragColor = vec4( retColor, 1.0 );', 'retColor = max( mix( vec3( dot( retColor, vec3( 0.2126, 0.7152, 0.0722 ) ) ), retColor, skySat ), 0.0 );\n\t\t\tgl_FragColor = vec4( retColor * skyTint * skyScale, 1.0 );');
  if (!withSunDisc) fs = fs.replace('19000.0', '0.0');
  m.fragmentShader = fs;
  const u = m.uniforms;
  u.turbidity.value = 4; u.rayleigh.value = 1.5; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.8;
  return sky;
}

/* ------------------------------------------------------------------ */
/* Passe de sortie : tone mapping + sRGB, comme OutputPass, mais avec un */
/* fondu continu ACES → AgX piloté par l'éclairage intérieur             */
/* ------------------------------------------------------------------ */
const TonePassShader = {
  uniforms: { tDiffuse: { value: null }, toneMappingExposure: { value: 1 }, uAgx: { value: 0 }, uBaseAgx: { value: 0 } },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    #include <tonemapping_pars_fragment>
    uniform sampler2D tDiffuse; uniform float uAgx, uBaseAgx; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float w = max(uAgx, uBaseAgx);
      vec3 a = w < 0.999 ? ACESFilmicToneMapping(c.rgb) : vec3(0.0);
      vec3 b = w > 0.001 ? AgXToneMapping(c.rgb) : vec3(0.0);
      gl_FragColor = sRGBTransferOETF(vec4(mix(a, b, w), c.a));
    }`,
};

/* ------------------------------------------------------------------ */
/* Passe finale : vignette douce et légère saturation (espace sRGB)     */
/* ------------------------------------------------------------------ */
const FinishShader = {
  uniforms: { tDiffuse: { value: null }, aspect: { value: 1 }, vignette: { value: 0.16 }, saturation: { value: 1.05 }, warm: { value: 0 }, contrast: { value: 0 }, greens: { value: 0 }, lift: { value: 0 }, skyPop: { value: 0 }, shadeWB: { value: new THREE.Vector3(1, 1, 1) } },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float aspect, vignette, saturation, warm, contrast, greens, lift, skyPop; uniform vec3 shadeWB; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      // verts tirés vers l'olive doré des références, ombres légèrement relevées
      float gm = clamp((c.g - max(c.r, c.b)) * 5.0, 0.0, 1.0) * greens;
      c.rgb = mix(c.rgb, vec3(c.r * 1.3 + 0.025, c.g * 1.1, c.b * 0.55), gm);
      c.rgb = mix(c.rgb, pow(max(c.rgb, 0.0), vec3(0.82)), lift);
      l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, saturation);
      // hautes lumières légèrement dorées, ombres un peu plus froides (étalonnage « fin d'après-midi »)
      // le ciel (bleu dominant) est épargné par le réchauffement et retrouve un bleu franc
      float skyM = clamp((c.b - max(c.r, c.g)) * 8.0, 0.0, 1.0);
      vec3 warmK = mix(vec3(1.0 - 0.02 * warm, 1.0, 1.0 + 0.03 * warm), vec3(1.0 + 0.05 * warm, 1.0 + 0.012 * warm, 1.0 - 0.06 * warm), smoothstep(0.15, 0.85, l));
      c.rgb *= mix(warmK, vec3(1.0 - 0.1 * skyPop, 1.0 - 0.03 * skyPop, 1.0 + 0.08 * skyPop), skyM);
      // ombres et tons moyens réchauffés (le ciel bleu y laisse sinon une dominante froide)
      c.rgb *= mix(vec3(1.0), shadeWB, (1.0 - smoothstep(0.45, 0.85, l)) * (1.0 - skyM));
      c.rgb = mix(c.rgb, c.rgb * c.rgb * (3.0 - 2.0 * c.rgb), contrast);
      vec2 d = vUv - 0.5; d.x *= aspect;
      c.rgb *= mix(1.0 - vignette, 1.0, smoothstep(1.05, 0.28, length(d)));
      c.rgb += (hash(gl_FragCoord.xy) - 0.5) / 255.0; // tramage contre les bandes du ciel
      gl_FragColor = c;
    }`,
};

/* ------------------------------------------------------------------ */
/* Démarrage                                                            */
/* ------------------------------------------------------------------ */
let renderer, scene, camera, controls, composer, renderPass, gtaoPass, bloomPass, outputPass, finishPass;
let sun, hemi, skyBg, skyEnv, skyScene, skyEnvScene, envGround, cubeRT, cubeCam, pmrem, envRT = null;
let building, landscape, M, levels, bounds;
let levelUniform, highlight = null;
const state = {
  quality: PARAMS.quality === 'auto' ? 'high' : PARAMS.quality,
  auto: PARAMS.quality === 'auto',
  hour: PARAMS.hour,
  season: PARAMS.season,
  view: PARAMS.view,
  free: false,
  level: null,
  levelDim: 0, levelDimTarget: 0,
  anim: null,
  needsRender: true,
  activeUntil: 0,
  sun: null,
  fpsAcc: 0, fpsFrames: 0, lastFrame: 0, fps: 0, qualityChangedAt: 0, lowFpsStreak: 0,
  ready: false,
  interiorBase: null,
};

start().catch((e) => {
  console.warn('[viewer] erreur au démarrage', e);
  fail('La maquette n’a pas pu démarrer. <a href="../index.html">Revenir au site</a>.');
});

async function start() {
  progress(0.03, 'Initialisation du rendu…');
  await nextFrame();

  // --- Rendu
  try {
    renderer = new THREE.WebGLRenderer({ canvas: ui.canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  } catch (e) {
    fail('Votre navigateur ne prend pas en charge WebGL 2. Essayez un navigateur récent, ou <a href="../index.html">revenez au site</a>.');
    return;
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = PARAMS.toneMapping === 'aces' ? THREE.ACESFilmicToneMapping : THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;           // la scène est statique : ombres recalculées seulement si le soleil bouge
  renderer.info.autoReset = false;                 // statistiques cumulées sur toutes les passes d'une image
  renderer.setPixelRatio(QUALITY[state.quality].pr);
  renderer.setSize(innerWidth, innerHeight, false);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.2, 1600);

  // --- Ciel et environnement
  progress(0.08, 'Ciel et lumière…');
  skyBg = makeSky(true);
  skyEnv = makeSky(false);
  skyScene = new THREE.Scene(); skyScene.add(skyBg);
  skyEnvScene = new THREE.Scene(); skyEnvScene.add(skyEnv);
  envGround = new THREE.Mesh(new THREE.CircleGeometry(900, 48), new THREE.MeshBasicMaterial({ color: 0x334022 }));
  envGround.rotation.x = -Math.PI / 2; envGround.position.y = -3;
  skyEnvScene.add(envGround);
  cubeRT = new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType, generateMipmaps: false });
  cubeCam = new THREE.CubeCamera(1, 3000, cubeRT);
  pmrem = new THREE.PMREMGenerator(renderer);
  scene.background = cubeRT.texture;
  scene.fog = new THREE.FogExp2(0xbfd2e6, 0.0052);

  sun = new THREE.DirectionalLight(0xfff1d6, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(QUALITY[state.quality].shadow, QUALITY[state.quality].shadow);
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.035;
  scene.add(sun, sun.target);
  hemi = new THREE.HemisphereLight(0xc9dcff, 0x5d5a3e, 0.4);
  scene.add(hemi);

  // --- Modules du modèle (en parallèle)
  progress(0.12, 'Chargement des modules…');
  const [matMod, bldMod, lndMod] = await Promise.all([tryImport('./materials.js'), tryImport('./building.js'), tryImport('./landscape.js')]);
  progress(0.25, 'Matériaux procéduraux…');
  await nextFrame();

  const FM = createFallbackMaterials();
  M = await tryCall(matMod && matMod.createMaterials, [THREE, renderer], 'createMaterials');
  if (!M || typeof M !== 'object') M = FM;
  else for (const k of MATERIAL_KEYS) if (!M[k]) M[k] = FM[k];

  progress(0.42, 'Construction du bâtiment…');
  await nextFrame();
  building = await tryCall(bldMod && bldMod.createBuilding, [THREE, M], 'createBuilding');
  if (!building || !building.isObject3D) building = createFallbackBuilding(M);
  building.name = building.name || 'building';
  const bud = building.userData || (building.userData = {});
  levels = Array.isArray(bud.levels) && bud.levels.length ? bud.levels : DEFAULT_LEVELS;
  bounds = bud.bounds && Number.isFinite(bud.bounds.minX) ? bud.bounds : computeBounds(building);
  bud.levels = levels; bud.bounds = bounds; bud.planters = bud.planters || [];
  scene.add(building);

  progress(0.6, 'Jardin et végétation…');
  await nextFrame();
  landscape = await tryCall(lndMod && lndMod.createLandscape, [THREE, M, bud], 'createLandscape');
  if (!landscape || !landscape.isObject3D) landscape = createFallbackLandscape(M);
  scene.add(landscape);

  progress(0.68, 'Logements et navigation…');
  await nextFrame();
  await setupConfigurator(bud);

  progress(0.74, 'Lumière du jour…');
  await nextFrame();
  setupClipping();
  setupLevelDimming();
  buildPost();
  setupControls();
  await setupNavigation();
  setupInteriorLighting();
  applyHour(state.hour, true);
  onResize();

  progress(0.82, 'Compilation des shaders…');
  await nextFrame();
  // pose de départ (avant l'intro)
  const v0 = VIEWS[state.view];
  const f0 = framing(v0);
  if (PARAMS.intro && !REDUCED_MOTION) {
    const off = f0.pos.clone().sub(f0.tgt);
    const sph = new THREE.Spherical().setFromVector3(off);
    sph.radius *= 1.55; sph.theta -= 0.9; sph.phi = Math.max(0.5, sph.phi - 0.35);
    camera.position.copy(f0.tgt).add(new THREE.Vector3().setFromSpherical(sph));
    controls.target.copy(f0.tgt);
  } else {
    camera.position.copy(f0.pos); controls.target.copy(f0.tgt);
  }
  camera.fov = f0.fov; camera.zoom = f0.zoom || 1; camera.updateProjectionMatrix();
  controls.update();
  try { if (renderer.compileAsync) await renderer.compileAsync(scene, camera); } catch (e) { /* compilation au premier rendu */ }
  await precompileSections();

  progress(0.94, 'Premier rendu…');
  await nextFrame();
  buildUI();
  render();
  await nextFrame();
  progress(1, 'Prêt');
  state.ready = true;
  ui.loader.classList.add('done');
  ui.loader.setAttribute('aria-busy', 'false');
  setTimeout(() => ui.loader.remove(), 1400);
  goToView(state.view, { duration: PARAMS.intro && !REDUCED_MOTION ? 2.6 : 0 });
  invalidate(2500);
  requestAnimationFrame(loop);
  window.__viewer = api();
  // arrivée depuis le site avec ?lot=ID : étage en coupe, lot sélectionné, fiche ouverte
  if (PARAMS.lot && lots && lotData(PARAMS.lot)) setTimeout(() => selectLot(PARAMS.lot, { fly: true }), 120);
  else if (PARAMS.lot) toast(`Lot ${PARAMS.lot} introuvable : voici la résidence.`);
}

function computeBounds(obj) {
  const b = new THREE.Box3().setFromObject(obj);
  if (b.isEmpty()) return { ...DEFAULT_BOUNDS };
  return { minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z, height: b.max.y };
}

/* ------------------------------------------------------------------ */
/* Post-traitement                                                      */
/* ------------------------------------------------------------------ */
function buildPost() {
  const q = QUALITY[state.quality];
  const w = innerWidth, h = innerHeight, pr = q.pr;
  const rt = new THREE.WebGLRenderTarget(Math.round(w * pr), Math.round(h * pr), { type: THREE.HalfFloatType, samples: q.msaa });
  composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(pr);
  renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  gtaoPass = new GTAOPass(scene, camera, w * pr * q.aoScale, h * pr * q.aoScale);
  gtaoPass.output = GTAOPass.OUTPUT.Default;
  gtaoPass.blendIntensity = 1.0;
  // rayon ~1,4 m : assez pour les sous-faces de balcons et les pieds de façade ; scale > 1 accentue le contraste de l'occlusion
  gtaoPass.updateGtaoMaterial({ radius: 1.4, distanceExponent: 1.3, thickness: 2.0, scale: 2.0, samples: q.aoSamples, distanceFallOff: 1.0, screenSpaceRadius: false });
  gtaoPass.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: q.pdSamples });
  patchGtaoGBuffer(gtaoPass);
  gtaoPass.enabled = q.ao;
  composer.addPass(gtaoPass);

  bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.08, 0.45, 0.95);
  bloomPass.enabled = q.bloom;
  composer.addPass(bloomPass);

  outputPass = new ShaderPass(TonePassShader);   // = OutputPass, avec fondu ACES ↔ AgX (intérieurs)
  outputPass.material.toneMapped = false;        // jamais de second tone mapping automatique
  composer.addPass(outputPass);
  finishPass = new ShaderPass(FinishShader);
  composer.addPass(finishPass);
  setCheapGlass(q.cheapGlass);
}

// Le G-buffer de la GTAO ignore par défaut l'alphaTest (feuillages) et les verres :
// on substitue un matériau de normales par objet, avec découpe alpha, et on masque les transparents.
function patchGtaoGBuffer(pass) {
  const base = pass.normalMaterial;
  base.clippingPlanes = CLIP; base.clipIntersection = true;
  const cache = new Map();
  const normalFor = (m) => {
    if (!m) return base;
    const alpha = m.alphaTest > 0 ? (m.alphaMap || m.map) : null;
    if (!alpha && m.side === THREE.FrontSide) return base;
    const useG = !!alpha && alpha === m.alphaMap;
    const key = `${alpha ? alpha.uuid : '-'}|${m.side}|${useG}|${m.alphaTest}`;
    let nm = cache.get(key);
    if (!nm) {
      nm = new THREE.MeshNormalMaterial({ side: m.side });
      nm.blending = THREE.NoBlending;
      nm.clippingPlanes = CLIP; nm.clipIntersection = true;
      if (alpha) {
        nm.defines = { USE_UV: '' };
        const cut = m.alphaTest;
        nm.onBeforeCompile = (s) => {
          s.uniforms.tCut = { value: alpha };
          s.uniforms.cutUvT = { value: alpha.matrix };
          s.fragmentShader = 'uniform sampler2D tCut;\nuniform mat3 cutUvT;\n' + s.fragmentShader.replace('#include <normal_fragment_begin>',
            `if ( texture2D( tCut, ( cutUvT * vec3( vUv, 1.0 ) ).xy ).${useG ? 'g' : 'a'} < ${cut.toFixed(3)} ) discard;\n#include <normal_fragment_begin>`);
        };
        nm.customProgramCacheKey = () => `cnp-cut-${useG ? 'g' : 'a'}-${cut.toFixed(3)}`;
      }
      cache.set(key, nm);
    }
    return nm;
  };
  const skip = (m) => !m || m.visible === false || m.userData.noAO || (m.transmission > 0) || (m.transparent && m.opacity < 0.98 && !(m.alphaTest > 0)) || m.depthWrite === false;
  const swapped = [], hidden = [];
  pass.renderOverride = function (r, overrideMaterial, target, clearColor, clearAlpha) {
    r.getClearColor(this.originalClearColor);
    const oa = r.getClearAlpha(), oc = r.autoClear;
    r.setRenderTarget(target);
    r.autoClear = false;
    r.setClearColor(clearColor); r.setClearAlpha(clearAlpha || 0); r.clear();
    const bg = scene.background;
    scene.background = null;
    scene.traverseVisible((o) => {
      if (o.isLine || o.isPoints || o.isSprite || o.userData.noAO) { hidden.push(o); return; }
      // pièces simulées d'interiors.js : masquées par shader dans la tranche de l'étage affiché ;
      // le G-buffer ne voit pas ce masquage (l'AO dessinerait des meubles « fantômes ») → exclues dès qu'un étage est coupé
      if (cfg.floor != null && o.isMesh && /^interieurs:/.test(o.name || '')) { hidden.push(o); return; }
      if (!o.isMesh) return;
      const m = o.material;
      // qualité basse : le feuillage instancié est exclu du G-buffer (moitié moins de sommets à traiter)
      if (QUALITY[state.quality].aoFoliage === false && o.isInstancedMesh && m && m.alphaTest > 0) { hidden.push(o); return; }
      if (Array.isArray(m)) {
        if (m.every(skip)) { hidden.push(o); return; }
        swapped.push(o, m); o.material = m.map((x) => normalFor(x));
      } else {
        if (skip(m)) { hidden.push(o); return; }
        swapped.push(o, m); o.material = normalFor(m);
      }
    });
    for (const o of hidden) o.visible = false;
    r.render(scene, camera);
    for (const o of hidden) o.visible = true;
    for (let i = 0; i < swapped.length; i += 2) swapped[i].material = swapped[i + 1];
    hidden.length = 0; swapped.length = 0;
    scene.background = bg;
    r.autoClear = oc; r.setClearColor(this.originalClearColor); r.setClearAlpha(oa);
  };
  // la visibilité est gérée ci-dessus
  pass.overrideVisibility = () => {};
  pass.restoreVisibility = () => {};
}

// Verre de garde-corps en transmission : coûteux (passe opaque supplémentaire), remplacé par de l'alpha en qualité réduite
const glassBackup = new Map();
function setCheapGlass(on) {
  const mats = new Set();
  scene.traverse((o) => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m && mats.add(m)); });
  for (const m of mats) {
    if (on && m.transmission > 0 && !glassBackup.has(m)) {
      glassBackup.set(m, { transmission: m.transmission, transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite });
      m.transmission = 0; m.transparent = true; m.opacity = Math.min(m.opacity, 0.3); m.depthWrite = false; m.needsUpdate = true;
    } else if (!on && glassBackup.has(m)) {
      Object.assign(m, glassBackup.get(m)); m.needsUpdate = true; glassBackup.delete(m);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Mise en lumière d'un étage : patch des matériaux (atténuation hors   */
/* de la tranche y0–y1) + volume translucide laiton                    */
/* ------------------------------------------------------------------ */
function setupLevelDimming() {
  levelUniform = { value: new THREE.Vector4(-1e4, 1e4, 0, 0) }; // y0, y1, intensité
  const done = new Set();
  scene.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m || done.has(m) || m.isShaderMaterial || m.isRawShaderMaterial) continue;
      done.add(m);
      patchDim(m);
    }
  });
}
function patchDim(m) {
  const prev = m.onBeforeCompile;
  const ownKey = Object.prototype.hasOwnProperty.call(m, 'customProgramCacheKey') ? m.customProgramCacheKey.bind(m) : null;
  const prevSrc = prev ? prev.toString() : '';
  m.onBeforeCompile = function (s, r) {
    if (prev) prev.call(this, s, r);
    // shaders remplacés (intérieurs simulés) : on ajoute les blocs de clipping pour le plan de coupe
    if (!s.vertexShader.includes('clipping_planes_vertex') && s.vertexShader.includes('#include <project_vertex>') && s.fragmentShader.includes('#include <common>')) {
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\n#include <clipping_planes_pars_vertex>')
        .replace('#include <project_vertex>', '#include <project_vertex>\n#include <clipping_planes_vertex>');
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\n#include <clipping_planes_pars_fragment>')
        .replace(/void\s+main\s*\(\s*\)\s*\{/, (mm) => mm + '\n#include <clipping_planes_fragment>');
    }
    if (!s.vertexShader.includes('#include <project_vertex>') || !s.fragmentShader.includes('#include <dithering_fragment>')) return;
    s.uniforms.cnpLevel = levelUniform;
    s.vertexShader = 'varying float vCnpY;\n' + s.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vec4 cnpW = vec4( transformed, 1.0 );
      #ifdef USE_INSTANCING
        cnpW = instanceMatrix * cnpW;
      #endif
      vCnpY = ( modelMatrix * cnpW ).y;`);
    s.fragmentShader = 'uniform vec4 cnpLevel;\nvarying float vCnpY;\n' + s.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
      if ( cnpLevel.z > 0.001 ) {
        float cnpIn = smoothstep( cnpLevel.x - 0.06, cnpLevel.x + 0.02, vCnpY ) * ( 1.0 - smoothstep( cnpLevel.y - 0.02, cnpLevel.y + 0.06, vCnpY ) );
        float cnpK = cnpLevel.z * ( 1.0 - cnpIn );
        float cnpL = dot( gl_FragColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
        gl_FragColor.rgb = mix( gl_FragColor.rgb, vec3( cnpL ) * vec3( 0.88, 0.92, 0.96 ), 0.45 * cnpK ) * ( 1.0 - 0.38 * cnpK );
      }
      #ifdef DOUBLE_SIDED
        // faces arrière visibles seulement à travers la coupe : « tranche » pleine et sombre, façon maquette
        if ( cnpSection > 0.5 && !gl_FrontFacing ) gl_FragColor = vec4( 0.028, 0.026, 0.024, 1.0 );
      #endif`);
    s.uniforms.cnpSection = { value: this.userData.cnpSection ? 1 : 0 };
    s.fragmentShader = 'uniform float cnpSection;\n' + s.fragmentShader;
  };
  m.customProgramCacheKey = () => (ownKey ? ownKey() : prevSrc) + '|cnp-dim' + (m.userData.cnpSection ? '|sec' : '');
  m.needsUpdate = true;
}

function setLevel(key) {
  const lv = levels.find((l) => l.key === key) || null;
  state.level = lv ? lv.key : null;
  if (highlight) { scene.remove(highlight); highlight.traverse((o) => { o.geometry && o.geometry.dispose(); }); highlight = null; }
  if (lv) {
    const isTop = lv === levels[levels.length - 1];
    const pad = 0.28;
    const y0 = lv.y0 + (lv.y0 > 0 ? 0.01 : 0.02), y1 = isTop ? Math.max(lv.y1, bounds.height) + 0.12 : lv.y1;
    const w = bounds.maxX - bounds.minX + pad * 2, d = bounds.maxZ - bounds.minZ + pad * 2, h = y1 - y0;
    const geo = new THREE.BoxGeometry(w, h, d);
    const fill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: BRASS, transparent: true, opacity: 0.16, depthWrite: false, fog: false }));
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: BRASS.clone().multiplyScalar(1.6), transparent: true, opacity: 0.95, fog: false }));
    highlight = new THREE.Group();
    highlight.add(fill, edges);
    highlight.position.set((bounds.minX + bounds.maxX) / 2, y0 + h / 2, (bounds.minZ + bounds.maxZ) / 2);
    highlight.userData.noAO = true; fill.userData.noAO = true; edges.userData.noAO = true;
    fill.renderOrder = 5; edges.renderOrder = 6;
    highlight.scale.set(1, 0.001, 1);
    highlight.userData.born = performance.now();
    scene.add(highlight);
    levelUniform.value.x = lv.y0; levelUniform.value.y = isTop ? 99 : lv.y1;
    state.levelDimTarget = 1;
  } else {
    state.levelDimTarget = 0;
  }
  invalidate(700);
}

/* ------------------------------------------------------------------ */
/* Heure du jour : soleil, ciel, environnement, brouillard              */
/* ------------------------------------------------------------------ */
let envTimer = 0, envPending = false, lastEnvAt = 0;
const fogRT = new THREE.WebGLRenderTarget(8, 8, { type: THREE.FloatType });
const fogCam = new THREE.PerspectiveCamera(30, 1, 1, 3000);

function applyHour(h, immediate = false) {
  state.hour = h;
  const s = sunState(h);
  state.sun = s;
  // soleil
  const c = new THREE.Vector3((bounds.minX + bounds.maxX) / 2, 5, (bounds.minZ + bounds.maxZ) / 2);
  sun.position.copy(c).addScaledVector(s.dir, 120);
  sun.target.position.copy(c);
  sun.target.updateMatrixWorld();
  sun.color.copy(s.color);
  sun.intensity = s.intensity * LOOK.sun;
  fitShadowCamera(s.dir);
  // ciel
  for (const sky of [skyBg, skyEnv]) {
    const u = sky.material.uniforms;
    u.sunPosition.value.copy(s.dir);
    u.skyScale.value = LOOK.skyScale;
    u.skySat.value = LOOK.skySat;
    u.skyTint.value.set(...LOOK.skyTint);
    u.turbidity.value = LOOK.turbidity; u.rayleigh.value = LOOK.rayleigh;
    u.mieCoefficient.value = LOOK.mie; u.mieDirectionalG.value = LOOK.mieG;
  }
  // l'environnement (diffus + reflets) utilise un ciel désaturé et légèrement réchauffé :
  // le fond reste bleu franc, mais les ombres ne virent plus au bleu marine
  skyEnv.material.uniforms.skyScale.value = LOOK.skyScale * LOOK.envScale;
  skyEnv.material.uniforms.skySat.value = LOOK.envSat;
  skyEnv.material.uniforms.skyTint.value.set(...LOOK.envTint);
  scene.fog.density = LOOK.fog;
  // appoint hémisphérique et sol réfléchi dans l'environnement
  hemi.intensity = (0.05 + 0.13 * s.twilight + 0.22 * s.day) * LOOK.hemi;
  hemi.color.set(LOOK.hemiSky).lerp(new THREE.Color('#ffc59a'), (1 - s.day) * 0.6);
  hemi.groundColor.set('#5e5a4e');   // rebond du sol neutre : évite les ombres verdâtres
  const gi = (0.05 + 0.11 * s.day) * LOOK.ground;
  envGround.material.color.setRGB(0.38 * gi, 0.37 * gi, 0.3 * gi).lerp(s.color.clone().multiplyScalar(gi * 0.5), 0.3);
  // fenêtres plus présentes en soirée
  const dusk = 1 - THREE.MathUtils.smoothstep(s.elev, 4, 22), night = 1 - THREE.MathUtils.smoothstep(s.elev, -4, 5);
  if (M && M.interiorWarm && M.interiorWarm.emissive) {
    if (state.interiorBase === null) state.interiorBase = M.interiorWarm.emissiveIntensity;
    M.interiorWarm.emissiveIntensity = state.interiorBase * (1 + 0.9 * dusk + 1.2 * night);
  }
  setInteriorGain(1 + 0.35 * dusk + 0.6 * night);
  renderer.toneMappingExposure = (PARAMS.exposure ?? LOOK.exposure) * (1 + 0.12 * dusk + 0.25 * night);
  state.baseExposure = renderer.toneMappingExposure; state.baseHemi = hemi.intensity;
  if (finishPass) { const fu = finishPass.uniforms; fu.warm.value = LOOK.warm; fu.contrast.value = LOOK.contrast; fu.saturation.value = LOOK.sat; fu.greens.value = LOOK.greens; fu.lift.value = LOOK.lift; fu.skyPop.value = LOOK.skyPop; fu.shadeWB.value.set(...LOOK.shadeWB); }
  if (bloomPass) { bloomPass.strength = 0.07 + 0.3 * dusk; bloomPass.threshold = 0.95 - 0.35 * dusk; }
  if (IN.ready && lots) lampGlow(Math.max(THREE.MathUtils.smoothstep(h, 18.75, 19.75), 1 - s.day));
  if (IN.ready && IN.k > 0) applyInterior();
  // arrière-plan : cubemap du ciel (peu coûteux)
  cubeCam.update(renderer, skyScene);
  renderer.shadowMap.needsUpdate = true;
  // environnement PMREM + couleur du brouillard : limité à ~4 mises à jour/s
  if (immediate) updateEnvironment();
  else scheduleEnv();
  invalidate(120);
}
let interiorUniforms = null;
function setInteriorGain(g) {
  if (!interiorUniforms) {
    interiorUniforms = [];
    building.traverse((o) => { if (o.isMesh && o.material && o.material.userData && o.material.userData.uniforms && o.material.userData.uniforms.uGain) interiorUniforms.push(o.material.userData.uniforms.uGain); });
  }
  for (const u of interiorUniforms) u.value = g;
}
function scheduleEnv() {
  envPending = true;
  const wait = Math.max(0, 260 - (performance.now() - lastEnvAt));
  clearTimeout(envTimer);
  envTimer = setTimeout(() => { if (envPending) updateEnvironment(); }, wait);
}
function updateEnvironment() {
  envPending = false;
  lastEnvAt = performance.now();
  const rt = pmrem.fromScene(skyEnvScene, 0, 1, 3000);
  if (envRT) envRT.dispose();
  envRT = rt;
  scene.environment = rt.texture;
  updateFogColor();
  invalidate(60);
}
// couleur du brouillard = horizon du ciel, à 90° du soleil (perspective atmosphérique cohérente avec le fond)
const fogPix = new Float32Array(8 * 8 * 4);
function updateFogColor() {
  const s = state.sun;
  const side = new THREE.Vector3(s.dir.z, 0, -s.dir.x).normalize();
  fogCam.position.set(0, 0, 0);
  fogCam.lookAt(side.x, 0.04, side.z);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(fogRT);
  renderer.render(skyScene, fogCam);
  renderer.setRenderTarget(prev);
  let r = 0, g = 0, b = 0;
  try {
    renderer.readRenderTargetPixels(fogRT, 0, 0, 8, 8, fogPix);
    for (let i = 0; i < 64; i++) { r += fogPix[i * 4]; g += fogPix[i * 4 + 1]; b += fogPix[i * 4 + 2]; }
    r /= 64; g /= 64; b /= 64;
  } catch (e) { r = 0.55; g = 0.65; b = 0.8; }
  if (!(r + g + b > 0) || !Number.isFinite(r + g + b)) { r = 0.55; g = 0.65; b = 0.8; }
  // horizon légèrement plus laiteux et un peu plus sombre que le ciel pour fondre les lointains
  const fc = new THREE.Color(r, g, b).multiplyScalar(0.92);
  // teinte chaude (poussière dorée de fin de journée) plutôt que gris-bleu
  fc.lerp(new THREE.Color(0.78, 0.72, 0.56).multiplyScalar((r + g + b) / 3 / 0.68), LOOK.fogWarm);
  scene.fog.color.copy(fc);
}

// Caméra d'ombre serrée sur le bâtiment, ses abords et les arbres proches
const _m4 = new THREE.Matrix4(), _v = new THREE.Vector3();
function fitShadowCamera(dir) {
  const b = new THREE.Box3(
    new THREE.Vector3(bounds.minX - 9, -0.5, bounds.minZ - 9),
    new THREE.Vector3(bounds.maxX + 9, bounds.height + 0.6, bounds.maxZ + 7),
  );
  const trees = (landscape && landscape.userData && landscape.userData.trees) || [];
  for (const t of trees) {
    const dx = Math.max(bounds.minX - t.x, 0, t.x - bounds.maxX), dz = Math.max(bounds.minZ - t.z, 0, t.z - bounds.maxZ);
    if (Math.hypot(dx, dz) < 13) {
      const r = t.radius || 3;
      b.expandByPoint(_v.set(t.x - r, 0, t.z - r)); b.expandByPoint(_v.set(t.x + r, t.height || 10, t.z + r));
    }
  }
  const cam = sun.shadow.camera;
  sun.updateMatrixWorld();
  _m4.lookAt(sun.position, sun.target.position, THREE.Object3D.DEFAULT_UP);
  _m4.setPosition(sun.position);
  const inv = _m4.clone().invert();
  const lb = new THREE.Box3();
  for (let i = 0; i < 8; i++) {
    _v.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(inv);
    lb.expandByPoint(_v);
  }
  cam.left = lb.min.x - 0.5; cam.right = lb.max.x + 0.5;
  cam.bottom = lb.min.y - 0.5; cam.top = lb.max.y + 0.5;
  cam.near = Math.max(0.5, -lb.max.z - 20); cam.far = -lb.min.z + 5;
  cam.updateProjectionMatrix();
}

/* ------------------------------------------------------------------ */
/* Navigation                                                           */
/* ------------------------------------------------------------------ */
function setupControls() {
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.minDistance = 2.5;                    // assez près pour regarder à travers une fenêtre
  controls.zoomToCursor = true;                  // la molette rapproche de ce qui est visé, pas du centre
  controls.maxDistance = 90;
  controls.maxPolarAngle = Math.PI / 2 + 0.2;     // légère contre-plongée possible (vues piétonnes) ; le sol reste borné à part
  controls.rotateSpeed = 0.6;
  controls.zoomSpeed = 0.9;
  controls.panSpeed = 0.8;
  controls.cursor.set((bounds.minX + bounds.maxX) / 2, 6, (bounds.minZ + bounds.maxZ) / 2);
  controls.maxTargetRadius = 26;                 // limite du déplacement latéral (balcons et loggias compris)
  controls.autoRotateSpeed = 0.55;
  let freeTimer = 0;
  controls.addEventListener('change', () => {
    invalidate();
    if (!state.anim && !state.free && state.ready) { clearTimeout(freeTimer); freeTimer = setTimeout(checkFree, 250); }
  });
  controls.addEventListener('start', () => {
    ui.canvas.classList.add('drag');
    if (state.anim) state.anim = null;
    hideHint();
    state.userMoving = true;
  });
  controls.addEventListener('end', () => {
    ui.canvas.classList.remove('drag');
    state.userMoving = false;
    checkFree();
  });
}

function checkFree() {
  if (state.free || state.anim) return;
  const f = framing(VIEWS[state.view]);
  if (camera.position.distanceTo(f.pos) > 0.6 || controls.target.distanceTo(f.tgt) > 0.6) setFree(true);
}
function setFree(on) {
  state.free = on;
  if (on && cfg.floor != null) { ui.views.querySelectorAll('.vbtn').forEach((b) => b.setAttribute('aria-pressed', 'false')); return; }
  if (on) {
    ui.capN.textContent = `— / 0${VIEWS.length}`;
    ui.capT.textContent = 'Navigation libre';
    ui.capD.textContent = 'Choisissez une vignette pour revenir à un point de vue.';
    ui.views.querySelectorAll('.vbtn').forEach((b) => b.setAttribute('aria-pressed', 'false'));
  }
}

// nav.js ramène la focale à sa valeur d'orbite : l'angle voulu est obtenu par le zoom optique de la caméra
function withZoom(f) {
  const base = navFov || f.fov;
  f.zoom = Math.tan(base * DEG / 2) / Math.tan(f.fov * DEG / 2);
  f.fov = base;
  return f;
}
// adapte le cadrage d'une vue à l'aspect de l'écran (on conserve le champ horizontal de la référence)
const MAX_VFOV = 66;
function framing(v) {
  if (camera.aspect < 1 && v.portrait) {
    // pose dédiée au portrait (l'emprise complète obligerait à reculer derrière les arbres)
    const P = v.portrait, pos = new THREE.Vector3(...P.pos), tgt = new THREE.Vector3(...P.tgt);
    return withZoom({ pos, tgt, fov: P.fov });
  }
  const tgt = new THREE.Vector3(...v.tgt), pos = new THREE.Vector3(...v.pos);
  const aspect = camera.aspect;
  // en portrait on accepte de rogner les bords de la référence (le bâtiment en occupe le centre)
  const ra = (v.aspect || 4 / 3) * (aspect < 1 ? (v.crop || 0.8) : 1);
  let fov = v.fov, k = 1;
  if (aspect < ra) {
    const hHalf = Math.atan(Math.tan(v.fov * DEG / 2) * ra);
    let vHalf = Math.atan(Math.tan(hHalf) / aspect);
    const cap = MAX_VFOV * DEG / 2;
    if (vHalf > cap) { k = Math.tan(hHalf) / (Math.tan(cap) * aspect); vHalf = cap; }
    fov = vHalf * 2 / DEG;
  }
  if (PARAMS.ui) k *= aspect < 1 ? 1.04 : 1.14;   // laisse respirer le bâtiment entre la barre du haut et le dock
  if (k !== 1) pos.sub(tgt).multiplyScalar(k).add(tgt);
  if (aspect < 1) fitBuilding(pos, tgt, fov, aspect);
  if (pos.y < 1.6) pos.y = Math.max(pos.y, Math.min(1.6, v.pos[1]));   // reculer ne doit pas enterrer une vue basse
  avoidTrees(pos, tgt);
  if (aspect < 1) clearSight(pos, tgt);
  return withZoom({ pos, tgt, fov });
}

function goToView(i, { duration } = {}) {
  i = ((i % VIEWS.length) + VIEWS.length) % VIEWS.length;
  if (cfg.floor != null) setFloor(null, { fly: false });
  state.view = i;
  setFree(false);
  const v = VIEWS[i];
  const f = framing(v);
  const dur = flyTo(f, { duration });
  // interface
  ui.views.querySelectorAll('.vbtn').forEach((btn, k) => btn.setAttribute('aria-pressed', String(k === i)));
  const btn = ui.views.children[i];
  if (btn && btn.scrollIntoView && ui.views.scrollWidth > ui.views.clientWidth) btn.scrollIntoView({ inline: 'center', block: 'nearest', behavior: REDUCED_MOTION ? 'auto' : 'smooth' });
  setCaption(`${String(i + 1).padStart(2, '0')} / ${String(VIEWS.length).padStart(2, '0')}`, v.t, v.d);
  invalidate(dur * 1000 + 300);
}

// Vol de la caméra vers une pose {pos, tgt, fov} (orbite) ; hors orbite, la navigation s'en charge
function flyTo(f, { duration } = {}) {
  if (nav && nav.mode !== 'orbit') {
    nav.setMode('orbit', { target: f.tgt.toArray(), position: f.pos.toArray() });
    camera.zoom = f.zoom || 1; camera.updateProjectionMatrix();
    return 1.6;
  }
  controls.maxDistance = Math.max(90, f.pos.distanceTo(f.tgt) + 1);
  // durée selon l'amplitude du mouvement
  const a = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
  const b = new THREE.Spherical().setFromVector3(f.pos.clone().sub(f.tgt));
  let dTheta = b.theta - a.theta; dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta));
  const amp = Math.abs(dTheta) + Math.abs(b.phi - a.phi) + Math.abs(Math.log(b.radius / a.radius)) + controls.target.distanceTo(f.tgt) * 0.04;
  const dur = duration !== undefined ? duration : REDUCED_MOTION ? 0 : THREE.MathUtils.clamp(0.9 + amp * 0.75, 1.1, 2.8);
  if (dur <= 0) {
    state.anim = null;
    camera.position.copy(f.pos); controls.target.copy(f.tgt); camera.fov = f.fov; camera.zoom = f.zoom || 1; camera.updateProjectionMatrix();
    controls.update();
  } else {
    state.anim = { t0: performance.now(), dur: dur * 1000, fromT: controls.target.clone(), toT: f.tgt, a, b, dTheta, fovFrom: camera.fov, fovTo: f.fov, zFrom: camera.zoom, zTo: f.zoom || 1 };
  }
  invalidate(dur * 1000 + 300);
  return dur;
}
function setCaption(n, t, d) {
  ui.capN.textContent = n; ui.capT.textContent = t; ui.capD.textContent = d || '';
  ui.cap.classList.remove('swap'); void ui.cap.offsetWidth; ui.cap.classList.add('swap');
}

// recul minimal pour que les 8 coins de l'emprise tiennent dans la zone sûre (portrait : bandeau du haut et dock)
const _fitCam = new THREE.PerspectiveCamera();
function fitBuilding(pos, tgt, fov, aspect) {
  const corners = [];
  for (let i = 0; i < 8; i++) corners.push(new THREE.Vector3(i & 1 ? bounds.maxX : bounds.minX, i & 2 ? bounds.height : 0, i & 4 ? bounds.maxZ : bounds.minZ));
  const dir = pos.clone().sub(tgt), d0 = dir.length(); dir.normalize();
  _fitCam.fov = fov; _fitCam.aspect = aspect; _fitCam.near = 0.5; _fitCam.far = 2000; _fitCam.updateProjectionMatrix();
  const ok = (d) => {
    _fitCam.position.copy(tgt).addScaledVector(dir, d); _fitCam.lookAt(tgt); _fitCam.updateMatrixWorld();
    return corners.every((c) => { const p = c.clone().project(_fitCam); return p.z < 1 && Math.abs(p.x) < 0.9 && p.y < 0.5 && p.y > -0.62; });
  };
  let d = d0;
  for (let i = 0; i < 24 && !ok(d); i++) d *= 1.06;
  pos.copy(tgt).addScaledVector(dir, d);
}
// si une pose tombe dans un houppier (le paysage peut évoluer), on avance la caméra vers la cible
function avoidTrees(pos, tgt) {
  const trees = (landscape && landscape.userData && landscape.userData.trees) || [];
  const dir = tgt.clone().sub(pos);
  const len = dir.length();
  dir.normalize();
  const inside = (p) => trees.some((t) => {
    const h = t.height || 10, r = (t.radius || 3) * 1.15;
    const cy = h * 0.62, ry = h * 0.42;
    return ((p.x - t.x) ** 2 + (p.z - t.z) ** 2) / (r * r) + ((p.y - cy) ** 2) / (ry * ry) < 1;
  });
  for (let i = 0; i < 60 && inside(pos) && len - (i + 1) * 0.5 > 9; i++) pos.addScaledVector(dir, 0.5);
}
// portrait : la caméra a reculé ; si un houppier masque la façade, on s'élève un peu au-dessus
function clearSight(pos, tgt) {
  const trees = (landscape && landscape.userData && landscape.userData.trees) || [];
  const blocked = () => {
    for (let t = 0.05; t < 0.75; t += 0.05) {
      const q = _v.copy(pos).lerp(tgt, t);
      if (trees.some((T) => { const h = T.height || 10, r = (T.radius || 3) * 0.9; return ((q.x - T.x) ** 2 + (q.z - T.z) ** 2) / (r * r) + ((q.y - h * 0.62) / (h * 0.4)) ** 2 < 1; })) return true;
    }
    return false;
  };
  for (let i = 0; i < 16 && blocked(); i++) pos.y += 1;
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const _sph = new THREE.Spherical();
function stepAnim(now) {
  const an = state.anim;
  if (!an) return;
  const t = Math.min(1, (now - an.t0) / an.dur), k = ease(t);
  controls.target.lerpVectors(an.fromT, an.toT, k);
  _sph.radius = Math.exp(THREE.MathUtils.lerp(Math.log(an.a.radius), Math.log(an.b.radius), k));
  _sph.phi = THREE.MathUtils.lerp(an.a.phi, an.b.phi, k);
  _sph.theta = an.a.theta + an.dTheta * k;
  camera.position.copy(controls.target).add(_v.setFromSpherical(_sph));
  camera.fov = THREE.MathUtils.lerp(an.fovFrom, an.fovTo, k);
  camera.zoom = THREE.MathUtils.lerp(an.zFrom ?? 1, an.zTo ?? 1, k);
  camera.updateProjectionMatrix();
  camera.lookAt(controls.target);
  if (t >= 1) state.anim = null;
  invalidate();
}

/* ------------------------------------------------------------------ */
/* Boucle de rendu (à la demande : rien n'est recalculé à l'arrêt)      */
/* ------------------------------------------------------------------ */
function invalidate(ms = 0) {
  state.needsRender = true;
  if (ms) state.activeUntil = Math.max(state.activeUntil, performance.now() + ms);
}
let lastLoop = 0, liftTick = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = lastLoop ? Math.min(0.1, (now - lastLoop) / 1000) : 0.016;
  lastLoop = now;
  const orbit = !nav || nav.mode === 'orbit';
  if (nav && nav.update(dt)) invalidate();
  if (lots && lots.update && lots.update(dt)) invalidate();
  if (stepInterior(dt)) invalidate();
  const animating = !!state.anim;
  if (!animating && orbit) {
    controls.autoRotate = ui.rotate.getAttribute('aria-pressed') === 'true';
  } else controls.autoRotate = false;
  controls.update();            // amortissement (neutralisé par nav.js hors orbite)
  if (animating) { if (orbit) stepAnim(now); else state.anim = null; }
  // garde-fous : jamais sous le sol, cible raisonnable
  if (camera.position.y < 1.1) { camera.position.y = 1.1; if (orbit) camera.lookAt(controls.target); }
  stepCut(now);
  stepViewOffset();
  if (nav && nav.mode === 'walk' && (++liftTick % 10) === 0) updateLift();
  if (cfg.pointer.dirty) updateHover();
  controls.target.y = THREE.MathUtils.clamp(controls.target.y, 0.5, 16);
  if (controls.autoRotate) { invalidate(); if (!state.free) setFree(true); }
  // fondu de la mise en lumière d'étage
  if (Math.abs(state.levelDim - state.levelDimTarget) > 0.001) {
    state.levelDim += (state.levelDimTarget - state.levelDim) * 0.12;
    if (Math.abs(state.levelDim - state.levelDimTarget) < 0.002) state.levelDim = state.levelDimTarget;
    levelUniform.value.z = state.levelDim * 0.85;
    if (state.levelDim === 0) { levelUniform.value.x = -1e4; levelUniform.value.y = 1e4; }
    invalidate();
  }
  if (highlight) {
    const t = Math.min(1, (now - highlight.userData.born) / 650);
    const s = REDUCED_MOTION ? 1 : ease(t);
    if (highlight.scale.y !== s) { highlight.scale.y = Math.max(0.001, s); invalidate(); }
  }
  if (state.needsRender || now < state.activeUntil) {
    render();
    updateLabels();
    updateMinimap();
    measure(now);
    state.needsRender = false;
  } else {
    state.lastFrame = 0;
  }
}
// Rayon d'AO proportionnel à la distance : 1,4 m convient en vue d'ensemble,
// mais en gros plan sur une fenêtre il produit des taches granuleuses dans les pièces.
let aoRadius = 1.4;
let aoBlend = 1;
function updateAoRadius() {
  if (!gtaoPass || !controls) return;
  // hors orbite (balade, drone, regard), la cible des OrbitControls n'a plus de sens : on se règle sur le mode
  const mode = nav && nav.getState ? nav.getState().mode : 'orbit';
  const indoor = !!(nav && nav.getState && nav.getState().indoor);
  let r;
  if (mode === 'walk' || mode === 'look') r = THREE.MathUtils.lerp(0.35, IN_LOOK.aoRadius, IN.k);
  else if (mode === 'drone') r = 0.9;
  else r = THREE.MathUtils.clamp(camera.position.distanceTo(controls.target) * 0.06, 0.25, 1.4);
  if (Math.abs(r - aoRadius) > 0.02) { aoRadius = r; gtaoPass.updateGtaoMaterial({ radius: r }); }
  // en intérieur (éclairage réel) : occlusion de contact plus courte, un peu atténuée
  const blend = indoor ? +THREE.MathUtils.lerp(1, IN_LOOK.ao, IN.k).toFixed(3) : 1;
  if (blend !== aoBlend) { aoBlend = blend; gtaoPass.blendIntensity = blend; }
}

/* ------------------------------------------------------------------ */
/* Éclairage intérieur (visite à pied)                                 */
/* - lumière du ciel : un projecteur ombré par baie du logement visité, */
/*   placé dehors et tourné vers la pièce (les murs bloquent, pas de    */
/*   fuite à travers les cloisons) ;                                    */
/* - environnement « pièce » (PMREM d'une boîte claire percée d'une     */
/*   fenêtre côté façade) pour le diffus et les reflets des matériaux   */
/*   d'intérieur, au lieu du ciel extérieur ;                           */
/* - lampes le soir : abat-jour et ampoules (M.lampShade, M.bulb) et    */
/*   spots de plafond deviennent de vraies sources ;                    */
/* - exposition, étalonnage, AO et biais d'ombre propres à l'intérieur. */
/* ------------------------------------------------------------------ */
const IN = {
  ready: false, k: 0, target: 0, lotId: null, floor: null, key: '',
  sky: [], lamps: [], downs: [], windows: null, lampPos: new Map(), envRT: null, envScene: null, envMats: null,
  mats: new Set(), lastCheck: 0, skyColor: new THREE.Color(), on: false, roomEnvKey: '',
};
const IN_LOOK = {
  exposure: 2.5,        // × exposition extérieure (l'appareil s'expose pour la pièce)
  sky: 3.4,             // luminance du ciel vue par les baies
  sun: 1.0,             // soleil direct (identique : la tache au sol doit « brûler » légèrement)
  hemi: 0.12,           // part de l'hémisphérique conservée (sans ombre : fuit partout)
  env: 0.85,            // gain de l'environnement « pièce »
  lift: 0.1, contrast: 0.22, sat: 1.12, warm: 0.3, vignette: 0.2,
  lamp: 3.5, down: 10,  // lampes (cd) et spots de plafond (cd) en soirée
  ao: 0.85, aoRadius: 0.55,
  bounce: 0.8,          // rebond sol → plafond (× lumière de la baie)
};
try { if (URLP.has('inlook')) Object.assign(IN_LOOK, JSON.parse(URLP.get('inlook'))); } catch (e) { /* défaut */ }
const N_SKY = 5, N_LAMP = 4, N_DOWN = 4;

function setupInteriorLighting() {
  const mk = (L) => { L.visible = false; scene.add(L); if (L.target) scene.add(L.target); return L; };
  for (let i = 0; i < N_SKY; i++) {
    const L = mk(new THREE.SpotLight(0xdfe8f4, 0, 0, 0.9, 0.85, 2));
    L.castShadow = true;
    L.shadow.mapSize.set(512, 512);
    L.shadow.bias = -0.0006; L.shadow.normalBias = 0.02;
    L.shadow.camera.near = 0.3; L.shadow.camera.far = 16;
    L.shadow.autoUpdate = true;
    IN.sky.push(L);
  }
  // rebond du sol éclairé par chaque baie : projecteur sans ombre posé au sol, tourné vers le plafond
  IN.bounce = [];
  for (let i = 0; i < N_SKY; i++) IN.bounce.push(mk(new THREE.SpotLight(0xfff1e0, 0, 5, 1.25, 1, 2)));
  for (let i = 0; i < N_LAMP; i++) IN.lamps.push(mk(new THREE.PointLight(0xffcf9c, 0, 4.5, 2)));
  for (let i = 0; i < N_DOWN; i++) IN.downs.push(mk(new THREE.SpotLight(0xffdbb0, 0, 4.5, 0.85, 0.9, 2)));
  // les vitrages ne portent pas d'ombre : le soleil entre par les baies (et éclaire les coupes)
  scene.traverse((o) => { if (o.isMesh && o.material && (o.material === M.glass || /:glass$/.test(o.name || ''))) o.castShadow = false; });
  // environnement « pièce »
  const es = new THREE.Scene();
  const box = new THREE.Mesh(new THREE.BoxGeometry(7, 2.7, 7), [0, 1, 2, 3, 4, 5].map(() => new THREE.MeshBasicMaterial({ side: THREE.BackSide })));
  const win = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.1), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const win2 = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.4), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const patch = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.6), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  es.add(box, win, win2, patch);
  IN.envScene = { scene: es, box, win, win2, patch };
  IN.ready = true;
}

// Vitrages du bâtiment regroupés en baies (rectangles verticaux alignés sur x ou z)
function findWindows() {
  if (IN.windows) return IN.windows;
  const rects = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  building.updateMatrixWorld(true);
  building.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || !(o.material === M.glass || /:glass$/.test(o.name || ''))) return;
    const pos = o.geometry.attributes.position, idx = o.geometry.index, cnt = idx ? idx.count : pos.count;
    for (let t = 0; t + 2 < cnt; t += 3) {
      const ia = idx ? idx.getX(t) : t, ib = idx ? idx.getX(t + 1) : t + 1, ic = idx ? idx.getX(t + 2) : t + 2;
      a.fromBufferAttribute(pos, ia).applyMatrix4(o.matrixWorld); b.fromBufferAttribute(pos, ib).applyMatrix4(o.matrixWorld); c.fromBufferAttribute(pos, ic).applyMatrix4(o.matrixWorld);
      n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
      const ax = Math.abs(n.x), az = Math.abs(n.z), ay = Math.abs(n.y);
      if (ay > Math.max(ax, az)) continue;
      const axis = ax > az ? 'x' : 'z', h = axis === 'x' ? 'z' : 'x';
      const r = { axis, p: (a[axis] + b[axis] + c[axis]) / 3, u0: Math.min(a[h], b[h], c[h]), u1: Math.max(a[h], b[h], c[h]), y0: Math.min(a.y, b.y, c.y), y1: Math.max(a.y, b.y, c.y) };
      if (r.u1 - r.u0 < 0.12 || r.y1 - r.y0 < 0.3) continue;
      rects.push(r);
    }
  });
  // fusion (meneaux, vantaux) : même plan à 12 cm près, rectangles jointifs à 15 cm près
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < rects.length && !merged; i++) for (let j = i + 1; j < rects.length; j++) {
      const p = rects[i], q = rects[j];
      if (p.axis !== q.axis || Math.abs(p.p - q.p) > 0.12) continue;
      if (p.u0 > q.u1 + 0.15 || q.u0 > p.u1 + 0.15 || p.y0 > q.y1 + 0.15 || q.y0 > p.y1 + 0.15) continue;
      p.u0 = Math.min(p.u0, q.u0); p.u1 = Math.max(p.u1, q.u1); p.y0 = Math.min(p.y0, q.y0); p.y1 = Math.max(p.y1, q.y1); p.p = (p.p + q.p) / 2;
      rects.splice(j, 1); merged = true; break;
    }
  }
  IN.windows = rects.map((r) => ({ ...r, w: r.u1 - r.u0, h: r.y1 - r.y0, cu: (r.u0 + r.u1) / 2, cy: (r.y0 + r.y1) / 2 }));
  return IN.windows;
}
function pointInPoly(P, x, z) {
  let ins = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, zi] = P[i], [xj, zj] = P[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) ins = !ins;
  }
  return ins;
}
function roomsOfFloor(k) {
  const out = [];
  for (const L0 of allLots()) {
    const L = lotData(L0.id);
    if (!L || L.level !== k) continue;
    for (const r of L.rooms || []) if (Array.isArray(r.poly)) out.push({ lot: String(L.id), name: r.name, poly: r.poly });
  }
  return out;
}
// lot (et pièce) contenant la caméra, sur l'étage visité
function interiorAt(x, z, k) {
  for (const r of roomsOfFloor(k)) if (pointInPoly(r.poly, x, z)) return r;
  return null;
}
// centres des objets d'un matériau donné dans les maillages de l'étage (groupés par proximité)
function clusterCenters(test, k, cell = 0.35) {
  const out = [], seen = new Map(), v = new THREE.Vector3(), fy = lots.floorY(k);
  lots.group.updateMatrixWorld(true);
  lots.group.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (!mats.some(test) && !test(null, o)) return;
    const pos = o.geometry.attributes.position;
    const im = o.isInstancedMesh ? o.count : 0;
    const add = (p) => {
      if (p.y < fy - 0.1 || p.y > fy + 3.2) return;
      const key = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)},${Math.floor(p.z / cell)}`;
      let c = seen.get(key);
      if (!c) { c = { x: 0, y: 0, z: 0, n: 0, minY: 1e9, maxY: -1e9 }; seen.set(key, c); }
      c.x += p.x; c.y += p.y; c.z += p.z; c.n++; c.minY = Math.min(c.minY, p.y); c.maxY = Math.max(c.maxY, p.y);
    };
    const step = Math.max(1, Math.floor(pos.count / 6000));
    if (im) {
      const m4 = new THREE.Matrix4();
      for (let i = 0; i < im; i++) { o.getMatrixAt(i, m4); m4.premultiply(o.matrixWorld); for (let j = 0; j < pos.count; j += Math.max(1, Math.floor(pos.count / 40))) add(v.fromBufferAttribute(pos, j).applyMatrix4(m4)); }
    } else for (let j = 0; j < pos.count; j += step) add(v.fromBufferAttribute(pos, j).applyMatrix4(o.matrixWorld));
  });
  // fusion des cellules voisines
  const cells = [...seen.values()];
  const used = new Set();
  for (let i = 0; i < cells.length; i++) {
    if (used.has(i)) continue;
    const g = { x: 0, y: 0, z: 0, n: 0, minY: 1e9, maxY: -1e9 }, stack = [i]; used.add(i);
    while (stack.length) {
      const c = cells[stack.pop()];
      g.x += c.x; g.y += c.y; g.z += c.z; g.n += c.n; g.minY = Math.min(g.minY, c.minY); g.maxY = Math.max(g.maxY, c.maxY);
      const cx = c.x / c.n, cy = c.y / c.n, cz = c.z / c.n;
      for (let j = 0; j < cells.length; j++) {
        if (used.has(j)) continue;
        const d = cells[j];
        if (Math.abs(d.x / d.n - cx) < cell * 1.6 && Math.abs(d.y / d.n - cy) < cell * 1.6 && Math.abs(d.z / d.n - cz) < cell * 1.6) { used.add(j); stack.push(j); }
      }
    }
    out.push({ x: g.x / g.n, y: g.y / g.n, z: g.z / g.n, minY: g.minY, maxY: g.maxY });
  }
  return out;
}
function lampsOfFloor(k) {
  if (IN.lampPos.has(k)) return IN.lampPos.get(k);
  const isLamp = (m) => !!m && (m === M.lampShade || m === M.bulb || (m.userData && (m.userData.lamp || m.userData.lampShade || m.userData.bulb)) || /shade|bulb/i.test(m.name || ''));
  const isSpot = (m, o) => (!!m && /spot/i.test(m.name || '')) || (!!o && /:walk:spot$/.test(o.name || ''));
  let lamps = [], spots = [];
  try { lamps = clusterCenters(isLamp, k, 0.3); spots = clusterCenters((m, o) => isSpot(m, o), k, 0.25); } catch (e) { /* pas de lampes */ }
  const fy = lots.floorY(k);
  // une ampoule au plafond (suspension) se comporte comme un spot ; un abat-jour bas comme une lampe
  const r = { lamps: lamps.filter((l) => l.y < fy + 2.3), downs: spots.concat(lamps.filter((l) => l.y >= fy + 2.3)) };
  IN.lampPos.set(k, r);
  return r;
}
// matériaux propres aux intérieurs visités (non partagés avec l'extérieur) : environnement « pièce »
function interiorMaterials() {
  if (IN.envMats) return IN.envMats;
  const inside = new Set(), outside = new Set();
  const collect = (root, set) => root.traverse((o) => { if (o.isMesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m && !m.isShaderMaterial && 'envMap' in m) set.add(m); });
  collect(lots.group, inside);
  // plafonds de visite : lots.js y bake une occlusion uniforme de 0,78 (bord haut) qui les grise ;
  // l'occlusion réelle vient désormais de la GTAO et des ombres → on la compense sur le matériau
  lots.group.traverse((o) => { if (o.isMesh && /:walk:ceil$/.test(o.name || '') && o.material && !o.material.userData.ceilFix) { o.material.userData.ceilFix = true; o.material.color.multiplyScalar(1.22); } });
  // voilages et objets translucides : pas d'ombre portée (le soleil filtre à travers)
  lots.group.traverse((o) => { if (o.isMesh && o.castShadow) { const m = Array.isArray(o.material) ? o.material[0] : o.material; if (m && m.transparent && m.opacity < 0.95) o.castShadow = false; } });
  collect(building, outside); collect(landscape, outside);
  IN.envMats = [...inside].filter((m) => !outside.has(m) && !(m.transparent && m.opacity < 0.5 && m !== M.glassClear));
  return IN.envMats;
}
function updateRoomEnv(outDir, s) {
  const E = IN.envScene; if (!E) return;
  const day = s.day, tw = s.twilight;
  const sky = IN.skyColor;
  // radiances (unités de la scène) : murs éclairés par la baie, sol chêne, fenêtre lumineuse
  // tache de soleil dans la pièce : le rebond éclaircit toute la pièce
  const sd = new THREE.Vector3(s.dir.x, 0, s.dir.z).normalize();
  const facing = Math.max(0, sd.dot(outDir)) * THREE.MathUtils.smoothstep(s.elev, 2, 12);
  const amb = (0.03 + 0.2 * day + 0.1 * facing * day) * IN_LOOK.env;
  const wall = new THREE.Color('#e9e7e2').multiplyScalar(amb), ceil = new THREE.Color('#f3f2ee').multiplyScalar(amb * 0.75);
  const floor = new THREE.Color('#c4b9ab').multiplyScalar(amb * 1.7);   // sol éclairé par les baies : rebond vers le plafond
  const mats = E.box.material; // +x, -x, +y, -y, +z, -z
  for (const i of [0, 1, 4, 5]) mats[i].color.copy(wall);
  mats[2].color.copy(ceil); mats[3].color.copy(floor);
  const winL = (0.3 + 2.4 * day + 0.3 * tw) * IN_LOOK.env;
  E.win.material.color.copy(sky).multiplyScalar(winL);
  E.win2.material.color.copy(sky).multiplyScalar(winL * 0.8);
  E.patch.material.color.copy(s.color).lerp(new THREE.Color(1, 1, 1), 0.4).multiplyScalar(0.6 * facing * day * IN_LOOK.env);
  E.patch.visible = facing > 0.02;
  // orientation : fenêtre principale dans la direction de la façade du séjour, une seconde sur un côté
  const ang = Math.atan2(outDir.x, outDir.z);
  // la caméra du PMREM est à l'origine : boîte centrée (sol à −1,35 m, plafond à +1,35 m)
  E.win.position.set(Math.sin(ang) * 3.49, -0.05, Math.cos(ang) * 3.49); E.win.lookAt(0, -0.05, 0);
  E.win2.position.set(Math.cos(ang) * 3.49, 0.0, -Math.sin(ang) * 3.49); E.win2.lookAt(0, 0.0, 0);
  E.patch.position.set(Math.sin(ang) * 1.4, -1.34, Math.cos(ang) * 1.4); E.patch.rotation.set(-Math.PI / 2, 0, ang);
  const rt = pmrem.fromScene(E.scene, 0.02, 0.05, 20);
  if (IN.envRT) IN.envRT.dispose();
  IN.envRT = rt;
}

// baies du logement : un projecteur ombré par baie (les plus grandes d'abord)
function assignSkyLights(lotId, k) {
  const rooms = roomsOfFloor(k).filter((r) => r.lot === lotId);
  const fy = lots.floorY(k), wins = findWindows().filter((w) => w.cy > fy + 0.3 && w.cy < fy + 2.9);
  const picked = [];
  for (const w of wins) {
    // côté intérieur = celui qui tombe dans une pièce du logement
    let inDir = 0, room = null;
    for (const sg of [1, -1]) {
      const px = w.axis === 'x' ? w.p + sg * 0.45 : w.cu, pz = w.axis === 'z' ? w.p + sg * 0.45 : w.cu;
      const r = rooms.find((rr) => pointInPoly(rr.poly, px, pz));
      if (r) { inDir = sg; room = r; break; }
    }
    if (!inDir) continue;
    picked.push({ ...w, inDir, room, area: w.w * w.h });
  }
  picked.sort((p, q) => q.area - p.area);
  const s = state.sun, main = picked[0];
  const outDir = main ? (main.axis === 'x' ? new THREE.Vector3(-main.inDir, 0, 0) : new THREE.Vector3(0, 0, -main.inDir)) : new THREE.Vector3(0, 0, 1);
  IN.outDir = outDir; IN.lotOutDir = outDir.clone();
  IN.skyWins = picked.slice(0, N_SKY);
  IN.sky.forEach((L, i) => {
    const w = IN.skyWins[i];
    L.userData.win = w || null;
    if (!w) { L.intensity = 0; L.position.set(0, -500, 0); L.target.position.set(0, -501, 0); L.target.updateMatrixWorld(); return; }
    const n = w.axis === 'x' ? new THREE.Vector3(w.inDir, 0, 0) : new THREE.Vector3(0, 0, w.inDir);
    const c = w.axis === 'x' ? new THREE.Vector3(w.p, w.cy, w.cu) : new THREE.Vector3(w.cu, w.cy, w.p);
    const half = 0.5 * Math.hypot(w.w, w.h), d = Math.max(0.9, 0.62 * Math.max(w.w, w.h));
    // axe horizontal, plan proche juste derrière le vitrage : les menuiseries ne portent pas d'ombre
    // « de ciel » (qui serait trop nette pour une source aussi étendue) ; les murs, eux, arrêtent la lumière
    // source à hauteur de linteau : le ciel éclaire vers le bas, jamais le plafond en direct
    // (au ras du plafond : le plafond ne reçoit que des rayons rasants, il est éclairé par le rebond)
    L.position.copy(c).addScaledVector(n, -d); L.position.y = Math.max(w.y1 + 0.08, fy + (lots.walkCeilingY ? lots.walkCeilingY(k) - fy : 2.5) - 0.03);
    L.target.position.copy(L.position).addScaledVector(n, 4);
    L.target.updateMatrixWorld();
    L.angle = Math.min(1.3, Math.atan(half / d) + 0.3);
    L.penumbra = 0.9;
    L.shadow.camera.near = d + 0.09; L.shadow.camera.far = d + 14;
    L.shadow.camera.updateProjectionMatrix();
    L.userData.n = n; L.userData.d = d;
    const Bn = IN.bounce[i];
    Bn.position.copy(c).addScaledVector(n, 1.1); Bn.position.y = fy + 0.15;
    Bn.target.position.copy(Bn.position).addScaledVector(n, 1.2); Bn.target.position.y = fy + 3;
    Bn.target.updateMatrixWorld();
  });
  IN.bounce.forEach((Bn, i) => { if (!IN.skyWins[i]) { Bn.position.set(0, -500, 0); Bn.target.position.set(0, -501, 0); Bn.target.updateMatrixWorld(); } });
  // lampes du logement
  const lp = lampsOfFloor(k);
  const inLot = (p) => rooms.some((r) => pointInPoly(r.poly, p.x, p.z));
  IN.lampList = lp.lamps.filter(inLot);
  IN.downList = lp.downs.filter((p) => inLot(p) && p.y > fy + 2.2);
}
function placePracticals() {
  const cx = camera.position.x, cz = camera.position.z;
  const byDist = (arr) => arr.slice().sort((p, q) => Math.hypot(p.x - cx, p.z - cz) - Math.hypot(q.x - cx, q.z - cz));
  const lamps = byDist(IN.lampList || []), downs = byDist(IN.downList || []);
  IN.lamps.forEach((L, i) => {
    const p = lamps[i]; L.userData.on = !!p;
    if (p) L.position.set(p.x, (p.minY + p.maxY) / 2, p.z); else L.position.set(0, -500, 0);
  });
  IN.downs.forEach((L, i) => {
    const p = downs[i]; L.userData.on = !!p;
    if (p) { L.position.set(p.x, p.minY - 0.03, p.z); L.target.position.set(p.x, p.minY - 3, p.z); } else { L.position.set(0, -500, 0); L.target.position.set(0, -501, 0); }
    L.target.updateMatrixWorld();
  });
}
let lampMats = null;
function lampGlow(t) {
  if (!lampMats) {
    lampMats = new Set();
    if (M.lampShade) lampMats.add(M.lampShade);
    if (M.bulb) lampMats.add(M.bulb);
    lots.group.traverse((o) => { if (o.isMesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m && m.emissive && m.userData && (m.userData.lamp || m.userData.lampShade || m.userData.bulb)) lampMats.add(m); });
    for (const m of lampMats) if (m.userData.baseEmissive == null) m.userData.baseEmissive = m === M.lampShade ? 1.4 : m === M.bulb ? 5 : (m.emissiveIntensity || 1);
  }
  for (const m of lampMats) {
    const bulb = m === M.bulb || /bulb/i.test(m.name || '') || m.userData.bulb;
    m.emissiveIntensity = m.userData.baseEmissive * (bulb ? 0.03 + 0.97 * t : t);
  }
}
// baies de l'étage, côté intérieur résolu (toutes les pièces de tous les lots) — pour le fondu au passage d'une baie
const floorWinCache = new Map();
function windowsOfFloor(k) {
  if (floorWinCache.has(k)) return floorWinCache.get(k);
  const rooms = roomsOfFloor(k), fy = lots.floorY(k), out = [];
  for (const w of findWindows()) {
    if (w.cy < fy + 0.3 || w.cy > fy + 2.9) continue;
    for (const sg of [1, -1]) {
      const px = w.axis === 'x' ? w.p + sg * 0.45 : w.cu, pz = w.axis === 'z' ? w.p + sg * 0.45 : w.cu;
      const r = rooms.find((rr) => pointInPoly(rr.poly, px, pz));
      if (r) { out.push({ ...w, inDir: sg, room: r }); break; }
    }
  }
  floorWinCache.set(k, out);
  return out;
}
function interiorTarget() {
  if (!nav || !nav.getState || cfg.immersive) return { t: 0 };
  // étage visité : balade de la maquette, ou étage coupé en vue « visite » (expérience pilotée)
  const k = cfg.walkFloor != null ? cfg.walkFloor : (cfg.viewMode === 'walk' ? cfg.floor : null);
  if (k == null) return { t: 0 };
  const st = nav.getState();
  if (st.mode !== 'walk' && st.mode !== 'look') return { t: 0 };
  const p = camera.position;
  const fy = lots.floorY(k);
  if (p.y < fy || p.y > fy + 3.2) return { t: 0 };
  const r = interiorAt(p.x, p.z, k);
  // au droit d'une baie : fondu continu selon la profondeur de la caméra (de 20 cm dehors à 50 cm dedans),
  // pour que l'exposition ne saute pas quand on franchit le vitrage
  let near = null, best = 9;
  for (const w of windowsOfFloor(k)) {
    const u = w.axis === 'x' ? p.z : p.x, d = ((w.axis === 'x' ? p.x : p.z) - w.p) * w.inDir;
    if (u < w.u0 - 0.4 || u > w.u1 + 0.4 || d < -2.5 || d > 0.9 || p.y > w.y1 + 0.6) continue;
    if (Math.abs(d) < best) { best = Math.abs(d); near = { w, d }; }
  }
  if (near) {
    const x = THREE.MathUtils.clamp((near.d + 0.2) / 0.7, 0, 1), t = x * x * (3 - 2 * x);
    return { t, lot: (r || near.w.room).lot, k, room: r || near.w.room };
  }
  return r ? { t: 1, lot: r.lot, k, room: r } : { t: 0 };
}
// appelée à chaque image (léger) : fondu intérieur/extérieur et réaffectation des sources
function stepInterior(dt) {
  if (!IN.ready || !lots) return false;
  const now = performance.now();
  let changed = false;
  const T = interiorTarget();
  IN.target = T.t;
  if (T.t && (T.lot !== IN.lotId || T.k !== IN.floor)) IN.lastCheck = 0;
  if (now - IN.lastCheck > 150) {
    IN.lastCheck = now;
    if (T.t && (T.lot !== IN.lotId || T.k !== IN.floor)) {
      IN.lotId = T.lot; IN.floor = T.k;
      assignSkyLights(T.lot, T.k);
      IN.roomEnvKey = '';
      renderer.shadowMap.needsUpdate = true;
      changed = true;
    }
    if (IN.k > 0 && IN.lotId) placePracticals();
    // exposition « de pièce » : l'appareil compense une pièce peu vitrée (rapport surface vitrée / surface au sol)
    if (T.t && T.room) {
      let A = 0; const P = T.room.poly;
      for (let i = 0; i < P.length; i++) { const [x0, z0] = P[i], [x1, z1] = P[(i + 1) % P.length]; A += x0 * z1 - x1 * z0; }
      A = Math.abs(A) / 2;
      const wa = (IN.skyWins || []).filter((w) => w.room && w.room.name === T.room.name).reduce((a, w) => a + w.area, 0);
      // environnement orienté vers la plus grande baie de la pièce occupée (sinon celle du logement)
      const wr = (IN.skyWins || []).filter((w) => w.room && w.room.name === T.room.name).sort((a, b) => b.area - a.area)[0];
      const od = wr ? (wr.axis === 'x' ? new THREE.Vector3(-wr.inDir, 0, 0) : new THREE.Vector3(0, 0, -wr.inDir)) : (IN.lotOutDir || IN.outDir);
      if (od && (!IN.outDir || !od.equals(IN.outDir))) { IN.outDir = od.clone(); IN.roomEnvKey = ''; changed = true; }
      IN.roomExp = THREE.MathUtils.clamp(Math.sqrt(0.2 / Math.max(0.04, wa / Math.max(1, A))), 1, 1.3);
    }
  }
  const e0 = IN.roomExpCur ?? 1;
  IN.roomExpCur = e0 + ((IN.roomExp ?? 1) - e0) * Math.min(1, dt * 2.5);
  if (Math.abs(IN.roomExpCur - e0) > 0.002) changed = true;
  const k0 = IN.k;
  const rate = dt / 0.3;
  IN.k = IN.target > IN.k ? Math.min(IN.target, IN.k + rate) : Math.max(IN.target, IN.k - rate);
  if (IN.k !== k0 || changed) { applyInterior(); return true; }
  return false;
}
function applyInterior() {
  const k = IN.k, s = state.sun; if (!s) return;
  const on = k > 0.001;
  const sm = k * k * (3 - 2 * k);
  // heure dorée : la lumière qui entre (ciel bas, façades et sol éclairés par le soleil couchant) se réchauffe
  const gold = 1 - THREE.MathUtils.smoothstep(s.elev, 6, 28);
  IN.skyColor.set('#dde6f2').lerp(new THREE.Color('#ffdcb8'), Math.max((1 - s.day) * 0.7, 0.75 * gold));
  // qualité basse : trois baies ombrées seulement (les plus grandes)
  const nSky = state.quality === 'low' ? 3 : N_SKY;
  if (on !== IN.on || nSky !== IN.nSky) {
    IN.on = on; IN.nSky = nSky;
    IN.sky.forEach((L, i) => { L.visible = on && i < nSky; });
    IN.bounce.forEach((L, i) => { L.visible = on && i < nSky; });
    renderer.shadowMap.needsUpdate = true;
    // environnement « pièce » pour les matériaux d'intérieur
    if (on && !IN.envRT) IN.roomEnvKey = '';
  }
  if (on) {
    const key = `${IN.lotId}|${state.hour.toFixed(2)}|${state.season}`;
    if (key !== IN.roomEnvKey) { IN.roomEnvKey = key; updateRoomEnv(IN.outDir || new THREE.Vector3(0, 0, 1), s); }
  }
  const envOn = on && k > 0.5 && IN.envRT;
  for (const m of interiorMaterials()) { const e = envOn ? IN.envRT.texture : null; if (m.envMap !== e) m.envMap = e; }
  // lumière du ciel par les baies
  const sd = new THREE.Vector3(s.dir.x, 0, s.dir.z); const sdl = sd.length() || 1; sd.divideScalar(sdl);
  // ciel moins lumineux quand le soleil descend (heure dorée)
  const eve = THREE.MathUtils.smoothstep(state.hour, 18.75, 19.75);
  const skyL = (0.04 * s.twilight + 0.36 * s.day * (0.55 + 0.45 * THREE.MathUtils.smoothstep(s.elev, 5, 30))) * IN_LOOK.sky * (1 - 0.3 * eve);
  for (const L of IN.sky) {
    const w = L.userData.win;
    if (!w) { L.intensity = 0; const Bn = IN.bounce[IN.sky.indexOf(L)]; if (Bn) Bn.intensity = 0; continue; }
    const outN = L.userData.n.clone().negate();
    const sunSide = 1 + 0.7 * Math.max(0, outN.dot(sd)) * s.day;          // ciel plus lumineux côté soleil (et sol éclairé)
    const dd = L.userData.d + 2.5;
    L.intensity = skyL * w.area * sunSide * (dd * dd) / 6.25 * sm;
    L.color.copy(IN.skyColor);
    const Bn = IN.bounce[IN.sky.indexOf(L)];
    if (Bn) { Bn.intensity = skyL * w.area * sunSide * IN_LOOK.bounce * sm; Bn.color.copy(IN.skyColor).lerp(new THREE.Color('#f3dcc0'), 0.5); }
  }
  // lampes le soir (≥ 19 h) — et un peu par temps sombre
  const lampK = Math.max(eve, 1 - s.day) * sm;
  // lampes allumées seulement le soir : en journée elles ne coûtent rien (≈ 2,5 ms/image évitées)
  const practOn = on && lampK > 0.005;
  for (const L of [...IN.lamps, ...IN.downs]) if (L.visible !== practOn) L.visible = practOn;
  for (const L of IN.lamps) L.intensity = L.userData.on ? IN_LOOK.lamp * lampK : 0;
  for (const L of IN.downs) L.intensity = L.userData.on ? IN_LOOK.down * lampK : 0;
  // matériaux lumineux (abat-jour, ampoules) : éteints le jour, allumés le soir
  lampGlow(Math.max(eve, 1 - s.day));
  // exposition, ambiance, étalonnage (AgX en intérieur : blancs et bois plus neutres qu'ACES)
  IN.agx = sm;   // fondu ACES → AgX dans la passe de sortie (pas de saut au passage de la baie)
  const base = state.baseExposure ?? renderer.toneMappingExposure;
  // le soir, l'appareil ne « rattrape » plus la baisse du jour : les lampes prennent le relais
  renderer.toneMappingExposure = base * THREE.MathUtils.lerp(1, IN_LOOK.exposure * (IN.roomExpCur ?? 1) * (1 - 0.22 * eve), sm);
  hemi.intensity = state.baseHemi * THREE.MathUtils.lerp(1, IN_LOOK.hemi, sm);
  sun.shadow.normalBias = THREE.MathUtils.lerp(0.035, 0.012, sm);
  sun.shadow.bias = THREE.MathUtils.lerp(-0.0003, -0.0002, sm);
  if (finishPass) {
    const fu = finishPass.uniforms, lerp = THREE.MathUtils.lerp;
    fu.lift.value = lerp(LOOK.lift, IN_LOOK.lift, sm); fu.contrast.value = lerp(LOOK.contrast, IN_LOOK.contrast, sm);
    fu.saturation.value = lerp(LOOK.sat, IN_LOOK.sat, sm); fu.warm.value = lerp(LOOK.warm, IN_LOOK.warm, sm);
    fu.greens.value = lerp(LOOK.greens, 0.4, sm); fu.vignette.value = lerp(0.16, IN_LOOK.vignette, sm);
  }
  invalidate(60);
}

function render() {
  renderer.info.reset();
  if (outputPass && outputPass.uniforms && outputPass.uniforms.uAgx) {
    const u = outputPass.uniforms;
    u.toneMappingExposure.value = renderer.toneMappingExposure;
    u.uAgx.value = IN.agx || 0;
    u.uBaseAgx.value = renderer.toneMapping === THREE.AgXToneMapping ? 1 : 0;
  }
  updateAoRadius();
  composer.render();
}

/* Mesure de fluidité et qualité automatique */
function measure(now) {
  if (state.lastFrame) {
    const dt = now - state.lastFrame;
    if (dt < 250) { state.fpsAcc += dt; state.fpsFrames++; }
  }
  state.lastFrame = now;
  if (state.fpsAcc > 1500) {
    state.fps = (1000 * state.fpsFrames) / state.fpsAcc;
    state.fpsAcc = 0; state.fpsFrames = 0;
    ui.fps.textContent = `${Math.round(state.fps)} i/s`;
    if (state.auto && now - state.qualityChangedAt > 3000) {
      if (state.fps < 40) {
        state.lowFpsStreak++;
        const idx = QUALITY_ORDER.indexOf(state.quality);
        if (state.lowFpsStreak >= 1 && idx < QUALITY_ORDER.length - 1) {
          setQuality(QUALITY_ORDER[idx + 1], true);
          ui.qNote.textContent = `Fluidité mesurée : ${Math.round(state.fps)} i/s. Qualité abaissée automatiquement.`;
        }
      } else state.lowFpsStreak = 0;
    }
  }
}

function setQuality(name, fromAuto = false) {
  const q = QUALITY[name];
  if (!q) return;
  state.quality = name;
  state.qualityChangedAt = performance.now();
  state.fpsAcc = 0; state.fpsFrames = 0; state.lowFpsStreak = 0;
  renderer.setPixelRatio(q.pr);
  composer.renderTarget1.samples = q.msaa; composer.renderTarget2.samples = q.msaa;
  composer.renderTarget1.dispose(); composer.renderTarget2.dispose();
  composer.setPixelRatio(q.pr);
  gtaoPass.enabled = q.ao;
  gtaoPass.updateGtaoMaterial({ samples: q.aoSamples });
  gtaoPass.updatePdMaterial({ samples: q.pdSamples });
  bloomPass.enabled = q.bloom;
  if (sun.shadow.mapSize.x !== q.shadow) {
    sun.shadow.mapSize.set(q.shadow, q.shadow);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  }
  setCheapGlass(q.cheapGlass);
  renderer.shadowMap.needsUpdate = true;
  if (IN.ready && IN.k > 0) applyInterior();
  onResize();
  updateQualityUI(fromAuto);
}
function updateQualityUI(fromAuto) {
  ui.qLabel.textContent = state.auto ? `Auto · ${QUALITY[state.quality].label}` : QUALITY[state.quality].label;
  ui.qPanel.querySelectorAll('.opt').forEach((b) => b.setAttribute('aria-pressed', String(state.auto ? b.dataset.q === 'auto' : b.dataset.q === state.quality)));
  if (!fromAuto) ui.qNote.textContent = state.auto ? 'La qualité s’adapte à la fluidité mesurée.' : `Qualité fixée : ${QUALITY[state.quality].label.toLowerCase()}.`;
}

function onResize() {
  const w = innerWidth, h = innerHeight, q = QUALITY[state.quality];
  camera.aspect = w / h;
  renderer.setSize(w, h, false);
  composer.setPixelRatio(q.pr);
  composer.setSize(w, h);
  gtaoPass.setSize(Math.round(w * q.pr * q.aoScale), Math.round(h * q.pr * q.aoScale));
  finishPass.uniforms.aspect.value = w / h;
  if (state.ready) { updateViewOffsetTarget(); cfg.vo.x = cfg.vo.tx; cfg.vo.y = cfg.vo.ty; }
  applyViewOffset();
  // si l'on est sur un point de vue, on recadre pour le nouvel aspect
  if (state.ready && !state.free && !state.anim && cfg.floor == null && (!nav || nav.mode === 'orbit')) {
    const f = framing(VIEWS[state.view]);
    camera.position.copy(f.pos); controls.target.copy(f.tgt); camera.fov = f.fov; camera.zoom = f.zoom || 1;
    controls.maxDistance = Math.max(90, f.pos.distanceTo(f.tgt) + 1);
  }
  camera.updateProjectionMatrix();
  if (state.ready) controls.update();
  invalidate(100);
}

/* ------------------------------------------------------------------ */
/* Interface                                                            */
/* ------------------------------------------------------------------ */
function buildUI() {
  // vignettes des points de vue
  ui.views.innerHTML = '';
  VIEWS.forEach((v, i) => {
    const b = document.createElement('button');
    b.className = 'vbtn';
    b.type = 'button';
    b.setAttribute('aria-pressed', String(i === state.view));
    b.setAttribute('aria-label', `Vue ${i + 1} : ${v.t}`);
    b.title = `${v.t} (${i + 1})`;
    b.innerHTML = `<img src="../img/${v.id}-thumb.jpg" alt="" loading="lazy" decoding="async"><b>${String(i + 1).padStart(2, '0')}</b><span>${v.t}</span>`;
    b.addEventListener('click', () => goToView(i));
    ui.views.appendChild(b);
  });

  buildConfiguratorUI();

  // curseur d'heure
  const syncHour = () => {
    const h = parseFloat(ui.hour.value);
    const txt = formatHour(h);
    ui.hourOut.textContent = txt;
    ui.hour.setAttribute('aria-valuetext', txt);
    ui.hour.style.setProperty('--p', `${((h - 8) / 12) * 100}%`);
    return h;
  };
  ui.hour.value = String(state.hour);
  ui.seasons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.season === state.season)));
  syncHour();
  ui.hour.addEventListener('input', () => applyHour(syncHour()));
  ui.hour.addEventListener('change', () => { clearTimeout(envTimer); updateEnvironment(); });

  // rotation automatique
  ui.rotate.addEventListener('click', () => toggleRotate());

  // plein écran
  const fsSupported = document.fullscreenEnabled || document.webkitFullscreenEnabled;
  if (!fsSupported) ui.fs.hidden = true;
  ui.fs.addEventListener('click', toggleFullscreen);
  const onFs = () => {
    const on = !!(document.fullscreenElement || document.webkitFullscreenElement);
    ui.fs.setAttribute('aria-pressed', String(on));
    ui.fs.setAttribute('aria-label', on ? 'Quitter le plein écran' : 'Plein écran');
  };
  document.addEventListener('fullscreenchange', onFs);
  document.addEventListener('webkitfullscreenchange', onFs);

  // qualité
  ui.qBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleQPanel(); });
  ui.qPanel.addEventListener('click', (e) => e.stopPropagation());
  ui.qPanel.querySelectorAll('.opt').forEach((b) => b.addEventListener('click', () => {
    const q = b.dataset.q;
    if (q === 'auto') { state.auto = true; setQuality('high'); }
    else { state.auto = false; setQuality(q); }
  }));
  document.addEventListener('click', () => toggleQPanel(false));
  updateQualityUI();

  addEventListener('keydown', onKey);

  addEventListener('resize', onResize);
  // l'indication de navigation s'efface d'elle-même
  setTimeout(hideHint, 6000);
  for (const ev of ['wheel', 'pointerdown', 'touchstart']) addEventListener(ev, hideHint, { passive: true, once: true });
  if (REDUCED_MOTION) ui.rotate.setAttribute('aria-pressed', 'false');
}
function toggleRotate(force) {
  const on = force !== undefined ? force : ui.rotate.getAttribute('aria-pressed') !== 'true';
  ui.rotate.setAttribute('aria-pressed', String(on));
  if (on) { state.anim = null; setFree(true); }
  invalidate(300);
}
function toggleFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  else (el.requestFullscreen || el.webkitRequestFullscreen).call(el).catch?.(() => {});
}
function toggleQPanel(force) {
  const open = force !== undefined ? force : ui.qPanel.hidden;
  ui.qPanel.hidden = !open;
  ui.qBtn.setAttribute('aria-expanded', String(open));
}
let hintHidden = false;
function hideHint() { if (hintHidden) return; hintHidden = true; ui.hint.classList.add('off'); }

/* ================================================================== */
/* Configurateur : lots, étages en coupe, navigation au joystick        */
/* ================================================================== */
let lots = null, nav = null, lotsData = null, navIsStub = true, navFov = 0;
const cfg = {
  cut: { y: 1e4, anim: null, ready: false },
  floor: null,                 // étage en coupe (clé) ou null
  hover: null, selected: null, availability: false,
  filter: { typo: null, status: new Set(), surf: 0, fav: false }, sort: 'dispo',
  favs: new Set(), cmp: [],
  walkFloor: null, viewMode: 'plan', immersive: null,
  pointer: { x: 0, y: 0, dirty: false, down: null, inside: false },
  labels: new Map(), labelSize: new Map(),
  sections: [],
  vo: { x: 0, y: 0, tx: 0, ty: 0 },     // décalage de la vue (centre de la zone libre)
  liftKey: '',
};
// Plans de coupe : horizontal (y > cutY) ET dans l'emprise du bâtiment (clipIntersection) :
// le paysage hors emprise (arbres, sol) n'est jamais découpé, les plantes des balcons le sont.
const CLIP = [];
let hPlane = null;
const FMT_EUR = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const ZONE_LABEL = { A: 'côté rue', B: 'côté jardin' };
const LEVEL_NAME = (k) => (levels && (levels.find((l) => l.key === k) || {}).name) || `Niveau ${k}`;
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isMobile = () => innerWidth <= 760;

function statusOf(st) {
  const s = (lotsData && lotsData.statuts && lotsData.statuts[st]) || {};
  return { label: s.label || st, color: s.color || '#999' };
}
const lotCache = new Map();
function lotData(id) {
  if (!lots || id == null) return null;
  id = String(id);
  if (lotCache.has(id)) return lotCache.get(id);
  let L = null;
  try { L = lots.lot(id) || null; } catch (e) { L = null; }
  if (L) {
    // étiquette ancrée sur le séjour (pièce de vie), à hauteur de lecture
    const sej = (L.rooms || []).find((r) => /séjour/i.test(r.name || '') && Array.isArray(r.poly) && (r.level == null || r.level === L.level));
    if (sej) { const [cx, cz] = polyCentroid(sej.poly); L.labelAnchor = new THREE.Vector3(cx, lots.floorY(L.level) + 1.9, cz); }
    lotCache.set(id, L);
  }
  return L;
}
function allLots() { return (lotsData && lotsData.lots) || []; }
function polyCentroid(P) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0; i < P.length; i++) { const [x0, z0] = P[i], [x1, z1] = P[(i + 1) % P.length], c = x0 * z1 - x1 * z0; a += c; cx += (x0 + x1) * c; cz += (z0 + z1) * c; }
  if (Math.abs(a) < 1e-9) { let x = 0, z = 0; P.forEach((p) => { x += p[0]; z += p[1]; }); return [x / P.length, z / P.length]; }
  a /= 2; return [cx / (6 * a), cz / (6 * a)];
}

async function setupConfigurator(bud) {
  // données (source unique, aussi lue par le site)
  try {
    const r = await fetch('./lots.json', { cache: 'no-cache' });
    lotsData = await r.json();
  } catch (e) {
    console.warn('[viewer] lots.json indisponible', e && e.message);
    lotsData = { lots: [], zones: {}, statuts: {} };
  }
  try { (JSON.parse(localStorage.getItem('canopee-favs') || '[]') || []).forEach((id) => cfg.favs.add(String(id))); } catch (e) { /* stockage indisponible */ }
  const mod = await tryImport('./lots.js');
  lots = await tryCall(mod && mod.createLots, [THREE, M, bud, lotsData], 'createLots');
  if (!lots || !lots.group) lots = createLotsStub(bud, lotsData);
  lots.group.name = lots.group.name || 'lots';
  lots.group.traverse((o) => { o.userData.noClip = true; });
  if (lots.setLabelsVisible && lots.roomLabels) lots.setLabelsVisible(false);
  scene.add(lots.group);
}

/* Remplacement minimal de lots.js (zones en plan + volumes par statut) */
function createLotsStub(bud, data) {
  const group = new THREE.Group(); group.name = 'lots';
  const lv = bud.levels || DEFAULT_LEVELS;
  const lvOf = (k) => lv.find((l) => l.key === k) || { y0: k * 3, y1: k * 3 + 3 };
  const fy = (k) => (k === 0 ? 0.05 : lvOf(k).y0 + 0.4);
  const floors = lv.map((l) => ({ key: l.key, name: l.name, y0: l.y0, cutY: fy(l.key) + 1.2 }));
  const items = new Map(), pickables = [];
  let filter = null, hover = null, sel = null, mode = 'none', floor = null;
  for (const d of data.lots || []) {
    const poly = data.zones && data.zones[d.zone] && data.zones[d.zone].poly;
    if (!poly) continue;
    const st = statusOf(d.status), y = fy(d.level), L = lvOf(d.level);
    const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
    const plan = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: st.color, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }));
    plan.position.y = y + 0.03; plan.renderOrder = 3; plan.visible = false; plan.userData.lotId = d.id; plan.userData.noAO = true;
    const [cx, cz] = polyCentroid(poly);
    const vg = new THREE.ExtrudeGeometry(shape, { depth: L.y1 - L.y0 - 0.3, bevelEnabled: false }).rotateX(-Math.PI / 2);
    vg.translate(-cx, 0, -cz); vg.scale(1.04, 1, 1.04); vg.translate(cx, 0, cz);
    const vol = new THREE.Mesh(vg, new THREE.MeshBasicMaterial({ color: st.color, transparent: true, opacity: 0.4, depthWrite: false }));
    vol.position.y = L.y0 + 0.15; vol.visible = false; vol.userData.lotId = d.id; vol.userData.noAO = true; vol.renderOrder = 4;
    group.add(plan, vol); pickables.push(plan, vol);
    const front = d.zone === 'A';
    items.set(String(d.id), {
      d, plan, vol,
      info: {
        ...d, center: new THREE.Vector3(cx, y + 1.2, cz), labelAnchor: new THREE.Vector3(cx, y + 2.2, cz),
        viewpoint: front ? { pos: [2.6, y + 1.6, 1.0], tgt: [2.2, y + 1.1, 14], fov: 62 } : { pos: [5.3, y + 1.6, -16.5], tgt: [18, y + 1.0, -17], fov: 62 },
        entry: { pos: [cx, y + 1.65, cz], yaw: front ? Math.PI : 0 },
        rooms: [{ name: 'Logement', surface: d.surface, poly }],
      },
    });
  }
  const refresh = () => {
    for (const [id, it] of items) {
      const out = filter && !filter(it.d);
      it.plan.visible = floor === it.d.level;
      it.vol.visible = mode === 'availability';
      const k = id === sel ? 0.75 : id === hover ? 0.62 : out ? 0.1 : 0.42;
      it.plan.material.opacity = k; it.vol.material.opacity = k * 0.85;
    }
  };
  const fp = bud.bounds || DEFAULT_BOUNDS;
  const x0 = fp.floorMinX ?? -6, x1 = fp.floorMaxX ?? 6;
  return {
    group, floors, pickables,
    setFloor(k) { floor = k; refresh(); }, setMode(m) { mode = m; refresh(); },
    setHover(id) { hover = id == null ? null : String(id); refresh(); }, setSelected(id) { sel = id == null ? null : String(id); refresh(); },
    setFilter(p) { filter = p; refresh(); },
    lot: (id) => (items.get(String(id)) || {}).info || null,
    colliders: () => [{ a: [x0, 0], b: [x1, 0] }, { a: [x1, 0], b: [x1, -19] }, { a: [x1, -19], b: [x0, -19] }, { a: [x0, -19], b: [x0, 0] }],
    floorY: fy, update() {}, dispose() {},
  };
}

/* ---------------------- clipping et tranche de coupe ---------------------- */
function setupClipping() {
  const m = 0.4;
  hPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e4);
  CLIP.push(hPlane,
    new THREE.Plane(new THREE.Vector3(1, 0, 0), -(bounds.maxX + m)),
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), bounds.minX - m),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), -(bounds.maxZ + m)),
    new THREE.Plane(new THREE.Vector3(0, 0, -1), bounds.minZ - m));
  renderer.localClippingEnabled = true;
  const interiors = new Set();
  building.traverse((o) => { if (/interieur/i.test(o.name || '')) o.traverse((c) => interiors.add(c)); });
  const lotObjs = new Set(); lots.group.traverse((o) => lotObjs.add(o));
  const done = new Set();
  const visit = (o, section) => {
    if (!o.isMesh || lotObjs.has(o)) return;
    for (const mt of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!mt || done.has(mt)) continue;
      done.add(mt);
      mt.clippingPlanes = CLIP; mt.clipIntersection = true;
      // matériaux opaques de l'enveloppe : faces arrière peintes en « tranche » quand on coupe
      const opaque = !mt.transparent && !(mt.transmission > 0) && !(mt.alphaTest > 0) && mt.side === THREE.FrontSide && !mt.isShaderMaterial;
      if (section && opaque && (mt.isMeshStandardMaterial || mt.isMeshLambertMaterial || mt.isMeshPhongMaterial)) {
        mt.userData.cnpSection = true;
        mt.shadowSide = THREE.BackSide;           // ombres inchangées quand la face devient double
        cfg.sections.push(mt);
      }
      mt.needsUpdate = true;
    }
  };
  building.traverse((o) => visit(o, !interiors.has(o)));
  landscape.traverse((o) => visit(o, false));
}
// faces doubles seulement pendant la coupe (programmes compilés une fois au chargement)
function setSections(on) {
  for (const mt of cfg.sections) {
    const side = on ? THREE.DoubleSide : THREE.FrontSide;
    if (mt.side !== side) { mt.side = side; mt.needsUpdate = true; }
  }
}
async function precompileSections() {
  setSections(true);
  try { if (renderer.compileAsync) await renderer.compileAsync(scene, camera); } catch (e) { /* compilé à la volée */ }
  // variante « visite » : sources intérieures allumées (évite un à-coup à l'entrée dans un logement)
  const inL = [...IN.sky, ...(IN.bounce || [])];
  if (inL.length) {
    inL.forEach((L) => { L.visible = true; });
    try { if (renderer.compileAsync) await renderer.compileAsync(scene, camera); } catch (e) { /* compilé à la volée */ }
    inL.forEach((L) => { L.visible = false; });
  }
  setSections(false);
}
const CUT_TOP = () => bounds.height + 1.6;
function animateCut(to, onEnd) {
  const from = cfg.cut.y > 1e3 ? CUT_TOP() : cfg.cut.y;
  const dur = REDUCED_MOTION ? 1 : THREE.MathUtils.clamp(500 + Math.abs(to - from) * 90, 450, 1400);
  cfg.cut.anim = { from, to, t0: performance.now(), dur, onEnd };
  if (from !== cfg.cut.y) setCutY(from);
  invalidate(dur + 100);
}
function setCutY(y) {
  cfg.cut.y = y;
  hPlane.constant = y;
  renderer.shadowMap.needsUpdate = true;
}
let cutFrame = 0;
function stepCut(now) {
  const an = cfg.cut.anim;
  if (!an) return;
  const t = Math.min(1, (now - an.t0) / an.dur), k = ease(t);
  cfg.cut.y = THREE.MathUtils.lerp(an.from, an.to, k);
  hPlane.constant = cfg.cut.y;
  if ((cutFrame++ & 1) === 0 || t >= 1) renderer.shadowMap.needsUpdate = true;   // ombres une image sur deux pendant l'animation
  invalidate();
  if (t >= 1) { cfg.cut.anim = null; if (an.onEnd) an.onEnd(); }
}

/* ------------------------------ étages ------------------------------ */
function floorInfo(k) { return (lots.floors || []).find((f) => f.key === k) || null; }
function floorCenter(k) {
  const y = lots.floorY(k);
  return new THREE.Vector3(((bounds.floorMinX ?? bounds.minX) + (bounds.floorMaxX ?? bounds.maxX)) / 2, y, (bounds.minZ + Math.min(0, bounds.maxZ)) / 2);
}
// vue plongeante 3/4 sur l'étage, en gardant l'azimut courant (ou avant-gauche par défaut)
function floorPose(k, focus) {
  const tgt = focus ? focus.clone() : floorCenter(k);
  if (focus) { tgt.lerp(floorCenter(k), 0.3); tgt.y = lots.floorY(k); }
  const off = camera.position.clone().sub(controls.target);
  let theta = Math.atan2(off.x, off.z);
  if (!Number.isFinite(theta) || off.lengthSq() < 1) theta = -0.6;
  const portrait = camera.aspect < 1;
  const phi = 0.8;
  // distance qui fait tenir l'emprise de l'étage dans le cadre (zone libre ≈ 62 % de la largeur en desktop)
  const vFov = 40 * DEG, hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const need = portrait ? 15 : 23;                     // diagonale utile de l'étage (m)
  const r = THREE.MathUtils.clamp(need / 2 / Math.tan(Math.min(vFov, hFov * (portrait ? 0.95 : 0.62)) / 2), 22, 62) * (focus ? 0.92 : 1);
  const pos = tgt.clone().add(new THREE.Vector3().setFromSphericalCoords(r, phi, theta));
  return { pos, tgt, fov: 40 };
}
function setFloor(k, { fly = true, focus = null, view = 'plan' } = {}) {
  if (k == null) {
    if (cfg.floor == null && !cfg.cut.anim) return;
    cfg.floor = null; cfg.cut.ready = false;
    lots.setFloor(null);
    if (lots.setViewMode) lots.setViewMode('plan');
    cfg.viewMode = 'plan';
    animateCut(CUT_TOP(), () => { if (cfg.floor == null) { setCutY(1e4); setSections(false); } });
    cfg.walkFloor = null;
    document.body.classList.remove('cut-on');
    syncFloorUI();
    renderMinimapLots();
    if (state.free && !cfg.immersive) setCaption('— / 08', 'Vue extérieure', 'Choisissez une vignette, un étage ou un logement.');
    updateViewOffsetTarget();
    invalidate(1600);
    return;
  }
  const f = floorInfo(k);
  if (!f) return;
  if (cfg.availability) setAvailability(false);
  const changing = cfg.floor !== k;
  cfg.floor = k;
  document.body.classList.add('cut-on');
  setSections(true);
  cfg.viewMode = view;
  if (lots.setViewMode) lots.setViewMode(view);
  const target = view === 'walk' ? walkCeiling(k) : f.cutY;
  const onReady = () => { if (cfg.floor === k) { lots.setFloor(k); cfg.cut.ready = true; updateLabelSet(); applyLotFilter(); invalidate(400); } };
  if (changing || !cfg.cut.ready) {
    // le plan et les étiquettes n'apparaissent qu'une fois la coupe arrivée à l'étage ;
    // en visite à pied, l'étage est affiché tout de suite (on y entre en fondu)
    cfg.cut.ready = false;
    lots.setFloor(view === 'walk' ? k : null);
    updateLabelSet();
    animateCut(target, onReady);
  } else if (Math.abs(cfg.cut.y - target) > 0.01) animateCut(target);
  if (fly) { state.free = true; flyTo(floorPose(k, focus)); }
  if (nav && nav.setHome) nav.setHome(floorCenter(k));
  refreshBoxes();
  if (view !== 'walk') floorCaption(k);
  syncFloorUI();
  renderMinimapLots();
  updateViewOffsetTarget();
  invalidate(1600);
}
const DRONE_ONLY = new Set(['corps', 'socle', 'lame', 'toiture']);
function boxesFor(mode) {
  if (!lots.collisionBoxes) return [];
  try { const all = lots.collisionBoxes() || []; return mode === 'drone' ? all : all.filter((b) => !DRONE_ONLY.has(b.kind)); } catch (e) { return []; }
}
function refreshBoxes(mode) {
  if (!nav || navIsStub || !nav.setColliders) return;
  nav.setColliders({ boxes: boxesFor(mode || nav.mode) });
}
function walkCeiling(k) {
  try { if (lots.walkCeilingY) { const y = lots.walkCeilingY(k); if (Number.isFinite(y)) return y + 0.02; } } catch (e) { /* repli */ }
  return lots.floorY(k) + 2.5;
}
function floorCaption(k) {
  const f = floorInfo(k);
  if (!f) return;
  const fl = allLots().filter((d) => d.level === k);
  const dispo = fl.filter((d) => d.status === 'disponible').length;
  const commun = ((lotsData && lotsData.communs) || []).find((c) => c.level === k);
  setCaption(`${f.name} · en coupe`, fl.length ? `${f.name} — ${fl.length} logement${fl.length > 1 ? 's' : ''}` : (commun ? commun.label : f.name),
    fl.length ? `${dispo} disponible${dispo > 1 ? 's' : ''} · survolez ou touchez un logement pour sa fiche.` : (commun ? commun.items.join(' · ') : ''));
}
function stepFloor(dir) {
  const keys = (lots.floors || []).map((f) => f.key).sort((a, b) => a - b);
  if (!keys.length) return;
  if (cfg.floor == null) { setFloor(dir > 0 ? keys[keys.length - 1] : keys[1] ?? keys[0]); return; }
  const i = keys.indexOf(cfg.floor) + (dir > 0 ? 1 : -1);
  if (i >= 0 && i < keys.length) setFloor(keys[i]);
}
function onFloorButton(k) {
  if (cfg.floor === k) {
    // reclic sur l'étage actif : on ferme la fiche et on recadre l'étage (« Extérieur » sert à sortir)
    closeSheet();
    if (nav && nav.mode !== 'orbit') setNavMode('orbit');
    else { state.free = true; flyTo(floorPose(k)); }
    if (cfg.viewMode === 'walk') setFloor(k, { fly: false, view: 'plan' });
    return;
  }
  setFloor(k);
}
function syncFloorUI() {
  ui.floorList.querySelectorAll('.lvl').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.key === String(cfg.floor ?? 'ext'))));
  updateLabelSet();
}

/* -------------------------- disponibilités -------------------------- */
function setAvailability(on) {
  cfg.availability = !!on;
  if (on && cfg.floor != null) setFloor(null, { fly: false });
  lots.setMode(on ? 'availability' : 'none');
  ui.tAvail.setAttribute('aria-pressed', String(cfg.availability));
  if (on) {
    const n = allLots().filter((d) => d.status === 'disponible').length;
    setCaption('Disponibilités', `${n} logement${n > 1 ? 's' : ''} disponible${n > 1 ? 's' : ''}`, 'Couleurs en façade : disponible, réservé, vendu. Touchez un volume pour sa fiche.');
  } else if (cfg.floor == null && ui.capN.textContent === 'Disponibilités') {
    setCaption('— / 08', 'Vue extérieure', 'Choisissez une vignette, un étage ou un logement.');
  }
  updateLabelSet();
  invalidate(400);
}

/* ------------------------- sélection et fiche ------------------------- */
function selectLot(id, { fly = true, open = true } = {}) {
  const L = lotData(id);
  if (!L) return;
  ui.tip.hidden = true;
  if (cfg.immersive) {
    // sélection pendant la vue depuis un lot : on quitte l'interface immersive
    cfg.immersive = null;
    document.body.classList.remove('immersive');
    if (nav && !navIsStub && nav.mode === 'look') { const pose = floorPose(L.level, L.center); nav.setMode('orbit', { target: pose.tgt.toArray(), position: pose.pos.toArray() }); fly = false; }
  }
  cfg.selected = String(id);
  lots.setSelected(cfg.selected);
  if (open) openSheet(cfg.selected);
  if (cfg.floor !== L.level || cfg.viewMode === 'walk') setFloor(L.level, { fly, focus: L.center });
  else if (fly) { state.free = true; flyTo(floorPose(L.level, L.center)); }
  ui.lotList.querySelectorAll('.lcard').forEach((c) => c.setAttribute('aria-current', String(c.dataset.id === cfg.selected)));
  ui.brand.href = `../index.html?lot=${encodeURIComponent(cfg.selected)}#logements`;
  applyLotFilter();
  updateLabelSet();
  updateViewOffsetTarget();
  invalidate(300);
}
function closeSheet() {
  if (ui.sheet.hidden && !cfg.selected) return;
  ui.sheet.hidden = true;
  document.body.classList.remove('sheet-open');
  cfg.selected = null; lots.setSelected(null);
  ui.brand.href = '../index.html';
  ui.lotList.querySelectorAll('.lcard').forEach((c) => c.setAttribute('aria-current', 'false'));
  applyLotFilter();
  updateLabelSet();
  updateViewOffsetTarget();
  invalidate(200);
}
function planSVG(L, rooms, caption) {
  rooms = (rooms || []).filter((r) => Array.isArray(r.poly) && r.poly.length > 2);
  const zone = lotsData.zones && lotsData.zones[L.zone] && lotsData.zones[L.zone].poly;
  const shapes = rooms.length ? rooms : (zone ? [{ name: `${L.typo} · ${L.surface} m²`, poly: zone }] : []);
  if (!shapes.length) return '';
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const r of shapes) for (const [x, z] of r.poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const pad = 0.8, w = x1 - x0 + pad * 2, h = z1 - z0 + pad * 2 + 1.2, fsMax = Math.max(w, h) / 30;
  const tint = (n) => /séjour|salon|cuisine/i.test(n) ? '#efe2c9' : /chambre|suite/i.test(n) ? '#e7eadf' : /bain|eau|wc|douche/i.test(n) ? '#dce7ee'
    : /balcon|loggia|terrasse/i.test(n) ? '#e3ecd8' : /entrée|dégagement|couloir|palier/i.test(n) ? '#ecebe6' : '#ebe5da';
  const parts = shapes.map((r) => {
    const [cx, cz] = polyCentroid(r.poly);
    let ar = 0; r.poly.forEach(([xa, za], i) => { const [xb, zb] = r.poly[(i + 1) % r.poly.length]; ar += xa * zb - xb * za; });
    const fs = Math.min(fsMax, Math.max(fsMax * 0.55, Math.sqrt(Math.abs(ar / 2)) * 0.2));   // petites pièces : texte réduit
    const pts = r.poly.map(([x, z]) => `${x.toFixed(2)},${z.toFixed(2)}`).join(' ');
    const surf = r.surface ? `<tspan x="${cx.toFixed(2)}" dy="${(fs * 1.15).toFixed(2)}" fill="#6b6a64">${esc(String(r.surface).replace('.', ','))} m²</tspan>` : '';
    return `<polygon points="${pts}" fill="${tint(r.name || '')}" stroke="#2a2b2c" stroke-width="${(fsMax * 0.12).toFixed(3)}" stroke-linejoin="round"/>
      <text x="${cx.toFixed(2)}" y="${(cz - (r.surface ? fs * 0.3 : -fs * 0.3)).toFixed(2)}" font-size="${fs.toFixed(2)}" text-anchor="middle" font-family="Inter,sans-serif" font-weight="600" fill="#2a2b2c">${esc(r.name)}${surf}</text>`;
  }).join('');
  const st = statusOf(L.status);
  return `<svg viewBox="${(x0 - pad).toFixed(2)} ${(z0 - pad).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)}" role="img" aria-label="${esc(caption)} du logement ${esc(L.id)}">
    ${parts}
    <rect x="${(x0 - pad * 0.4).toFixed(2)}" y="${(z0 - pad * 0.4).toFixed(2)}" width="${(x1 - x0 + pad * 0.8).toFixed(2)}" height="${(z1 - z0 + pad * 0.8).toFixed(2)}" fill="none" stroke="${st.color}" stroke-width="${(fsMax * 0.16).toFixed(3)}" stroke-dasharray="${(fsMax * 0.5).toFixed(2)} ${(fsMax * 0.35).toFixed(2)}" rx="${(fsMax * 0.3).toFixed(2)}"/>
    <text x="${((x0 + x1) / 2).toFixed(2)}" y="${(z1 + pad + fsMax * 0.9).toFixed(2)}" font-size="${(fsMax * 0.8).toFixed(2)}" text-anchor="middle" font-family="Inter,sans-serif" letter-spacing="${(fsMax * 0.15).toFixed(2)}" fill="#8a877f">RUE · SUD ↓</text>
  </svg>`;
}
function openSheet(id) {
  const L = lotData(id);
  if (!L) return;
  const st = statusOf(L.status), sold = L.status === 'vendu';
  // pièces de l'étage du lot ; celles d'un autre niveau (toit-terrasse du 302) forment un second plan
  const all = (L.rooms || []).filter((r) => r.name);
  const here = all.filter((r) => r.level == null || r.level === L.level);
  const other = (L.roomsOther && L.roomsOther.length ? L.roomsOther : all.filter((r) => r.level != null && r.level !== L.level));
  const roomRow = (r) => `<li><span>${esc(r.name)}</span><span>${r.surface ? esc(String(r.surface).replace('.', ',')) + ' m²' : ''}</span></li>`;
  const roomsHTML = here.length && here.some((r) => r.surface)
    ? here.map(roomRow).join('') + (other.length ? `<li style="border:0;padding-top:10px;color:rgba(255,255,255,.6);font-size:11px;letter-spacing:.14em;text-transform:uppercase"><span>Niveau toit</span><span></span></li>${other.map(roomRow).join('')}` : '')
    : (L.pieces || []).map((p) => `<li><span>${esc(p)}</span><span></span></li>`).join('');
  const ext = (L.exterieurs || []).map((e) => `<span>${esc(e.type)} · ${esc(e.surface)} m²</span>`).join('');
  const extTotal = (L.exterieurs || []).reduce((a, e) => a + (e.surface || 0), 0);
  const price = sold ? '<div class="price sold"><span>Prix</span><b>Vendu</b></div>'
    : `<div class="price"><span>${L.status === 'reserve' ? 'Réservé · prix' : 'Prix'}</span><b>${L.prix ? FMT_EUR.format(L.prix) : 'Nous consulter'}</b></div>`;
  const fav = cfg.favs.has(String(L.id)), cmp = cfg.cmp.includes(String(L.id));
  const otherLevelName = other.length ? (other[0].level != null ? LEVEL_NAME(other[0].level) : 'Niveau toit') : '';
  const href = sold ? `../index.html?lot=${encodeURIComponent(L.id)}&revente=1#contact` : `../index.html?lot=${encodeURIComponent(L.id)}#contact`;
  ui.sheet.innerHTML = `
    <div class="sh-in" id="sheetBody">
    <div class="sh-top">
      <div>
        <div class="sh-k">${esc(LEVEL_NAME(L.level))} · ${esc(ZONE_LABEL[L.zone] || '')}${L.attique ? ' · attique' : ''}</div>
        <h2 id="shT" tabindex="-1">Lot <em>${esc(L.id)}</em></h2>
        <div class="sh-sub">${esc(L.typo)} · ${esc(L.surface)} m² · <span class="stt" style="--c:${st.color}">${esc(st.label)}</span></div>
      </div>
      <div class="sh-acts">
        <button class="ib star" data-act="fav" aria-pressed="${fav}" aria-label="${fav ? 'Retirer des favoris' : 'Ajouter aux favoris'}" title="Favori"><svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg></button>
        <button class="ib" data-act="cmp" aria-pressed="${cmp}" aria-label="Comparer ce logement" title="Comparer"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="7" height="14" rx="1"/><rect x="14" y="5" width="7" height="14" rx="1"/></svg></button>
        <button class="ib" data-act="close" aria-label="Fermer la fiche" title="Fermer (Échap)"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </div>
    </div>
    ${price}
    <div class="facts">
      <div><b>${esc(L.surface)} m²</b><span>habitables</span></div>
      <div><b>${esc(parseInt(String(L.typo || '').replace(/\D/g, ''), 10) || '—')}</b><span>pièces · ${esc(L.typo)}</span></div>
      <div><b>${extTotal ? extTotal + ' m²' : '—'}</b><span>extérieurs</span></div>
    </div>
    <div class="sh-h">Plan · ${esc(LEVEL_NAME(L.level))}</div>
    <div class="plan">${planSVG(L, here.length ? here : all, 'Plan')}</div>
    ${other.length ? `<div class="sh-h">Plan · ${esc(otherLevelName === 'Toit' ? 'niveau toit' : otherLevelName)}</div><div class="plan">${planSVG(L, other, 'Plan du niveau toit')}</div>` : ''}
    <details class="rooms-d"${isMobile() ? '' : ' open'}><summary>Pièces et surfaces</summary><ul class="rooms">${roomsHTML}</ul></details>
    ${ext ? `<div class="sh-h">Extérieurs</div><div class="exts">${ext}</div>` : ''}
    ${L.orientation ? `<div class="sh-h">Orientation</div><p style="font-size:14px">${esc(L.orientation)}</p>` : ''}
    ${cfg.cmp.length === 2 && cmp ? `<div class="cta" style="margin-top:16px"><button class="btn-l" data-act="cmpgo"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="7" height="14" rx="1"/><rect x="14" y="5" width="7" height="14" rx="1"/></svg>Comparer les lots ${esc(cfg.cmp[0])} et ${esc(cfg.cmp[1])}</button></div>` : ''}
    </div>
    <div class="sh-foot">
      <div class="cta">
        <div class="row2">
          <button class="btn-l" data-act="view"><svg viewBox="0 0 24 24"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/></svg>Vue depuis le lot</button>
          <button class="btn-l" data-act="walk" ${navIsStub ? 'disabled' : ''}><svg viewBox="0 0 24 24"><circle cx="13" cy="4.5" r="1.8"/><path d="M9 21l2.5-6 2.5 2v4M11.5 15l1-5.5 3 3 3 1M12.5 9.5L9 11l-1.5 3"/></svg>Visiter à pied</button>
        </div>
        <a class="btn-l main" href="${href}">${sold ? 'Être prévenu·e d’une revente' : 'Je suis intéressé·e'}<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
      </div>
      <p class="sh-note">Plans, surfaces et prix indicatifs, non contractuels.</p>
    </div>`;
  ui.sheet.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
    const a = b.dataset.act;
    if (a === 'close') closeSheet();
    else if (a === 'fav') { toggleFav(L.id); openSheet(L.id); }
    else if (a === 'cmp') { toggleCmp(L.id); openSheet(L.id); }
    else if (a === 'view') viewFromLot(L.id);
    else if (a === 'walk') visitLot(L.id);
    else if (a === 'cmpgo') openCompare();
  }));
  const wasHidden = ui.sheet.hidden;
  ui.sheet.hidden = false;
  document.body.classList.add('sheet-open');
  if (wasHidden) { const h = $('shT'); if (h) h.focus({ preventScroll: true }); }
  updateViewOffsetTarget();
}
function toggleFav(id) {
  id = String(id);
  if (cfg.favs.has(id)) cfg.favs.delete(id); else cfg.favs.add(id);
  try { localStorage.setItem('canopee-favs', JSON.stringify([...cfg.favs])); } catch (e) { /* stockage indisponible */ }
  renderLotList();
}
function toggleCmp(id) {
  id = String(id);
  const i = cfg.cmp.indexOf(id);
  if (i >= 0) cfg.cmp.splice(i, 1); else { cfg.cmp.push(id); if (cfg.cmp.length > 2) cfg.cmp.shift(); }
  renderCmpBar();
  renderLotList();
}
function renderCmpBar() {
  ui.cmpBar.hidden = cfg.cmp.length === 0;
  ui.cmpTxt.textContent = cfg.cmp.length === 2 ? `Lots ${cfg.cmp.join(' et ')}` : `Lot ${cfg.cmp[0] || ''} · choisissez-en un second`;
  ui.cmpGo.disabled = cfg.cmp.length < 2;
}
function openCompare() {
  const [a, b] = cfg.cmp.map(lotData);
  if (!a || !b) return;
  const ext = (L) => (L.exterieurs || []).map((e) => `${e.type} ${e.surface} m²`).join(', ') || '—';
  const pr = (L) => (L.status === 'vendu' ? 'Vendu' : L.prix ? FMT_EUR.format(L.prix) : '—');
  const ppm = (L) => (L.status !== 'vendu' && L.prix ? FMT_EUR.format(Math.round(L.prix / L.surface)) + ' / m²' : '—');
  const sa = a.surface >= b.surface, sb = b.surface >= a.surface;
  const rows = [
    ['Étage', LEVEL_NAME(a.level), LEVEL_NAME(b.level)],
    ['Typologie', a.typo, b.typo],
    ['Surface', `<span class="${sa ? 'best' : ''}">${a.surface} m²</span>`, `<span class="${sb ? 'best' : ''}">${b.surface} m²</span>`],
    ['Extérieurs', ext(a), ext(b)],
    ['Orientation', a.orientation || '—', b.orientation || '—'],
    ['Statut', `<span class="stt" style="--c:${statusOf(a.status).color}">${statusOf(a.status).label}</span>`, `<span class="stt" style="--c:${statusOf(b.status).color}">${statusOf(b.status).label}</span>`],
    ['Prix', pr(a), pr(b)],
    ['Prix au m²', ppm(a), ppm(b)],
  ];
  ui.cmpTable.innerHTML = `<table><thead><tr><th></th><th scope="col">Lot ${esc(a.id)}</th><th scope="col">Lot ${esc(b.id)}</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><th scope="row">${r[0]}</th><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('')}</tbody></table>`;
  openModal(ui.cmpDlg);
}
function openModal(d) {
  if (!d.open) d.showModal();
  if (nav && nav.setEnabled) nav.setEnabled(false);
}
let toastTimer = 0;
function toast(msg, ms = 4200) {
  ui.toast.textContent = msg;
  ui.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { ui.toast.hidden = true; }, ms);
}

/* --------------------- vue depuis le lot, visite à pied --------------------- */
function viewFromLot(id) {
  const L = lotData(id);
  if (!L || !L.viewpoint) return;
  if (cfg.availability) setAvailability(false);
  const back = { floor: cfg.floor, lot: String(L.id) };
  const pos = new THREE.Vector3(...L.viewpoint.pos), far = new THREE.Vector3(...L.viewpoint.tgt);
  const d = far.clone().sub(pos);
  const yaw = Math.atan2(-d.x, -d.z), pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  // la coupe disparaît : on regarde depuis le vrai balcon
  if (cfg.floor != null) setFloor(null, { fly: false });
  enterImmersive(back);
  setCaption(`Lot ${L.id}`, 'Vue depuis le logement', `${(L.exterieurs || []).map((e) => e.type).join(' et ') || 'Depuis le séjour'} · orientation ${L.orientation || ''}`.trim());
  if (nav && !navIsStub) {
    nav.setMode('look', { pos, yaw, pitch, fov: camera.aspect < 1 ? 75 : THREE.MathUtils.clamp(L.viewpoint.fov || 60, 50, 70), fade: true, onExit: () => exitImmersive() });
  } else {
    const tgt = pos.clone().add(d.normalize().multiplyScalar(3));
    state.free = true;
    flyTo({ pos, tgt, fov: L.viewpoint.fov || 60 });
  }
}
function enterImmersive(back) {
  cfg.immersive = back;
  document.body.classList.add('immersive');
  ui.backBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>Retour au lot ${esc(back.lot)}`;
  ui.backBtn.focus({ preventScroll: true });
  updateViewOffsetTarget();
}
function exitImmersive() {
  const back = cfg.immersive;
  if (!back) return;
  cfg.immersive = null;
  document.body.classList.remove('immersive');
  updateViewOffsetTarget();
  // retour à l'étage du lot, fiche ouverte
  const L = lotData(back.lot);
  if (nav && !navIsStub && nav.mode !== 'orbit') {
    const pose = floorPose(L.level, L.center);
    nav.setMode('orbit', { target: pose.tgt.toArray(), position: pose.pos.toArray() });
  }
  selectLot(back.lot, { fly: !nav || navIsStub });
}
function visitLot(id) {
  const L = lotData(id);
  if (!L || !L.entry || !nav || navIsStub) return;
  setFloor(L.level, { fly: false, view: 'walk' });
  cfg.walkFloor = L.level;
  refreshBoxes('walk');
  nav.teleport({ pos: L.entry.pos, yaw: L.entry.yaw || 0, pitch: 0, mode: 'walk', fade: true });
  setCaption(`Lot ${L.id} · balade`, 'Visite à pied', 'Joystick, ZQSD ou flèches pour marcher · Maj pour courir · Orbite pour revenir au plan.');
  closeSheetKeepSelection();
  toggleLots(false);
  invalidate(2000);
}
function closeSheetKeepSelection() {
  ui.sheet.hidden = true;
  document.body.classList.remove('sheet-open');
  updateViewOffsetTarget();
}

/* ------------------------------ ascenseur ------------------------------ */
function liftStopOf(k) {
  try { if (lots.liftStop) { const s = lots.liftStop(k); if (s && s.pos) return s; } } catch (e) { /* repli */ }
  const pal = lotsData.zones && (lotsData.zones.palier || lotsData.zones.noyau);
  if (!pal) return null;
  const [cx, cz] = polyCentroid(pal.poly);
  return { pos: [cx, lots.floorY(k) + 1.65, cz], yaw: Math.PI };
}
function updateLift() {
  let html = '', key = '';
  if (nav && nav.mode === 'walk' && !cfg.immersive) {
    const p = camera.position;
    for (const f of lots.floors || []) {
      const s = liftStopOf(f.key);
      if (!s) continue;
      if (Math.abs(p.y - s.pos[1]) < 1.2 && Math.hypot(p.x - s.pos[0], p.z - s.pos[2]) < 2.6) {
        key = String(f.key);
        html = (lots.floors || []).filter((g) => g.key !== f.key && liftStopOf(g.key)).sort((a, b) => a.key - b.key)
          .map((g) => `<button type="button" data-k="${g.key}" aria-label="${g.key > f.key ? 'Monter' : 'Descendre'} au ${esc(g.name)}">${esc(g.name)}</button>`).join('');
        break;
      }
    }
  }
  if (key === cfg.liftKey) return;
  cfg.liftKey = key;
  ui.lift.hidden = !key;
  ui.liftBtns.innerHTML = html;
  ui.liftBtns.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => takeLift(+b.dataset.k)));
}
function takeLift(k) {
  const s = liftStopOf(k);
  if (!s || !nav) return;
  setFloor(k, { fly: false, view: 'walk' });
  cfg.walkFloor = k;
  refreshBoxes('walk');
  nav.teleport({ pos: s.pos, yaw: s.yaw ?? Math.PI, pitch: 0, mode: 'walk', fade: true });
  setCaption(`${LEVEL_NAME(k)} · balade`, 'Palier', 'Joystick, ZQSD ou flèches pour marcher · Orbite pour revenir au plan.');
  cfg.liftKey = '';
}

/* ----------------------------- navigation ----------------------------- */
async function setupNavigation() {
  const mod = await tryImport('./nav.js');
  const fp = bounds;
  const sx0 = fp.minX, sx1 = fp.maxX, sz0 = fp.minZ, sz1 = fp.socleMaxZ ?? 0.4;
  // façade de la rue ouverte au droit de la porte du hall (l'intérieur relève de lots.colliders(0))
  const lay = building.userData && building.userData.layout;
  const door = (lay && lay.rdc && lay.rdc.door) || [2.82, 4.14];
  const dA = door[0] - 0.05, dB = door[1] + 0.05;
  const buildingSegs = [
    { a: [sx0, sz1], b: [dA, sz1] }, { a: [dB, sz1], b: [sx1, sz1] }, { a: [sx1, sz1], b: [sx1, sz0] },
    { a: [sx1, sz0], b: [sx0, sz0] }, { a: [sx0, sz0], b: [sx0, sz1] },
  ];
  // garde-corps des balcons (rive avant et retour droit) pour la balade à l'étage
  const fx1 = fp.maxX, bz1 = fp.maxZ;
  const rails = [{ a: [-0.6, bz1], b: [fx1, bz1] }, { a: [fx1, bz1], b: [fx1, -11] }];
  const trees = ((landscape && landscape.userData && landscape.userData.trees) || []).map((t) => ({ x: t.x, z: t.z, radius: t.radius || 2 }));
  const inFoot = (x, z) => x > fp.minX - 0.05 && x < fp.maxX + 0.05 && z > fp.minZ - 0.05 && z < fp.maxZ + 0.05;
  const floorKeyAt = (eyeY) => {
    let best = null, bd = 1.2;
    for (const f of lots.floors || []) { const d = Math.abs(lots.floorY(f.key) + 1.65 - eyeY); if (d < bd) { bd = d; best = f.key; } }
    return best;
  };
  const inDoor = (x, z) => x > dA && x < dB && z > sz1 - 2.5 && z < sz1 + 0.6;
  const colliders = {
    building: buildingSegs, trees, buildingHeight: fp.height,
    groundY: (x, z) => (z > 4.5 && z < 7.5 ? 0.14 : 0),
    indoor: (x, z, y) => {
      const k = y > 2.4 ? floorKeyAt(y) : (inFoot(x, z) || inDoor(x, z) ? 0 : null);
      if (k == null) return null;
      try { return (lots.colliders(k) || []).concat(k > 0 ? rails : []); } catch (e) { return null; }
    },
    floorAt: (x, z, eyeY) => {
      if (cfg.walkFloor == null || !inFoot(x, z) || eyeY < 2.4) return null;
      return lots.floorY(cfg.walkFloor);
    },
    ceilingAt: (x, z, y) => {
      if (!inFoot(x, z)) return null;
      const k = y > 2.4 ? floorKeyAt(y) : 0;
      if (k == null) return null;
      try { return lots.walkCeilingY ? lots.walkCeilingY(k) : lots.floorY(k) + 2.5; } catch (e) { return null; }
    },
  };
  colliders.boxes = boxesFor('orbit');
  if (mod && typeof mod.createNavigation === 'function') {
    try {
      navFov = camera.fov;
      nav = mod.createNavigation({ THREE, camera, controls, domElement: renderer.domElement, uiRoot: ui.navRoot, colliders, onChange: onNavChange, onExit: () => exitImmersive() });
      navIsStub = false;
    } catch (e) { console.warn('[viewer] createNavigation a échoué : orbite seule.', e); nav = null; }
  }
  if (!nav) {
    nav = { mode: 'orbit', setMode() {}, teleport() {}, update: () => false, setEnabled() {}, getState: () => ({ mode: 'orbit' }), setHome() {}, setColliders() {}, dispose() {} };
    ui.navMode.querySelectorAll('[data-mode="drone"],[data-mode="walk"]').forEach((b) => { b.disabled = true; b.title = 'Navigation indisponible'; });
  }
  if (nav.setHome) nav.setHome(new THREE.Vector3((fp.minX + fp.maxX) / 2, 6, (fp.minZ + fp.maxZ) / 2));
  syncModeUI(nav.mode);
}
let lastNavMode = 'orbit';
function onNavChange(st) {
  if (st && st.modeChange && st.mode !== 'orbit' && camera.zoom !== 1) { camera.zoom = 1; camera.updateProjectionMatrix(); }
  if (st && st.modeChange) {
    syncModeUI(st.mode);
    // retour en orbite depuis la balade : l'étage revient en plan (coupe à 1,2 m)
    if (st.mode === 'orbit' && lastNavMode === 'walk' && cfg.floor != null && cfg.viewMode === 'walk') setFloor(cfg.floor, { fly: false, view: 'plan' });
    if (st.mode === 'orbit' && lastNavMode === 'look' && cfg.immersive) exitImmersive();
    lastNavMode = st.mode;
  }
  invalidate();
}
function setNavMode(m) {
  if (!nav || navIsStub) return;
  if (m === nav.mode) return;
  state.anim = null;
  if (cfg.immersive && m !== 'look') { cfg.immersive = null; document.body.classList.remove('immersive'); }
  if (m === 'orbit') {
    cfg.walkFloor = null;
    const tgt = cfg.floor != null ? floorCenter(cfg.floor) : new THREE.Vector3(0, 6, (bounds.minZ + bounds.maxZ) / 2);
    if (cfg.floor != null && cfg.viewMode === 'walk') setFloor(cfg.floor, { fly: false, view: 'plan' });
    const pose = cfg.floor != null ? floorPose(cfg.floor) : null;
    nav.setMode('orbit', pose ? { target: tgt.toArray(), position: pose.pos.toArray() } : { target: tgt.toArray() });
    if (cfg.floor == null) setCaption('— / 08', 'Orbite', 'Glissez pour tourner autour de la résidence.');
    else floorCaption(cfg.floor);
  } else {
    if (m !== 'walk') cfg.walkFloor = null;
    if (m === 'walk' && cfg.floor != null) setFloor(cfg.floor, { fly: false, view: 'walk' });
    refreshBoxes(m);
    nav.setMode(m);
    toggleLots(false);
    setCaption('—', m === 'drone' ? 'Drone' : 'Balade', m === 'drone'
      ? 'Joystick ou ZQSD pour voler · E / C pour monter et descendre · glisser pour regarder.'
      : 'Joystick ou ZQSD pour marcher · Maj pour courir · glisser pour regarder.');
  }
  state.free = true;
  syncModeUI(m);
  hideHint();
}
function syncModeUI(m) {
  refreshBoxes(m);
  ['orbit', 'drone', 'walk', 'look'].forEach((k) => document.body.classList.toggle(`m-${k}`, k === m));
  ui.navMode.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === m)));
  if (m !== 'walk') ui.lift.hidden = true, cfg.liftKey = '';
  updateLabelSet();
  invalidate(200);
}

/* ------------------------- survol (raycasting) ------------------------- */
const raycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
function shown(o) { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; }
function pickAt(x, y) {
  if (!lots || !lots.pickables) return null;
  const objs = lots.pickables.filter(shown);
  if (!objs.length) return null;
  const r = ui.canvas.getBoundingClientRect();
  _ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(_ndc, camera);
  const hit = raycaster.intersectObjects(objs, false)[0];
  return hit ? String(hit.object.userData.lotId ?? '') || null : null;
}
function setupPicking() {
  const c = ui.canvas, P = cfg.pointer;
  c.addEventListener('pointermove', (e) => {
    P.x = e.clientX; P.y = e.clientY; P.inside = true;
    if (e.pointerType === 'mouse' && !e.buttons) P.dirty = true;
  });
  c.addEventListener('pointerleave', () => { P.inside = false; setHover(null); });
  c.addEventListener('pointerdown', (e) => { P.down = { x: e.clientX, y: e.clientY, t: performance.now() }; ui.tip.hidden = true; });
  c.addEventListener('pointerup', (e) => {
    const d = P.down; P.down = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 600) return;
    if (nav && nav.mode !== 'orbit') return;
    if (cfg.floor != null && !cfg.cut.ready) return;
    const id = pickAt(e.clientX, e.clientY);
    ui.tip.hidden = true;
    if (id) selectLot(id, { fly: cfg.floor == null || cfg.availability });
  });
}
function updateHover() {
  const P = cfg.pointer;
  P.dirty = false;
  if (!P.inside || (nav && nav.mode !== 'orbit') || (cfg.floor != null && !cfg.cut.ready)) { setHover(null); return; }
  setHover(pickAt(P.x, P.y), true);
}
function setHover(id, fromPointer = false) {
  id = id == null ? null : String(id);
  if (id === cfg.hover) { if (id && fromPointer) placeTip(); return; }
  cfg.hover = id;
  lots && lots.setHover(id);
  ui.canvas.style.cursor = id ? 'pointer' : '';
  ui.lotList.querySelectorAll('.lcard').forEach((c) => c.classList.toggle('hov', c.dataset.id === id));
  cfg.labels.forEach((el, k) => el.classList.toggle('hov', k === id));
  const L = id && lotData(id);
  if (L && fromPointer) {
    const st = statusOf(L.status);
    ui.tip.innerHTML = `<b>${esc(L.id)}</b>${esc(L.typo)} · ${esc(L.surface)} m² <span class="stt" style="--c:${st.color}">${esc(st.label)}</span>
      <em>${esc(LEVEL_NAME(L.level))} · ${esc(ZONE_LABEL[L.zone] || '')}${L.status !== 'vendu' && L.prix ? ' · ' + FMT_EUR.format(L.prix) : ''} · cliquez pour la fiche</em>`;
    ui.tip.hidden = false;
    placeTip();
  } else ui.tip.hidden = true;
  invalidate(120);
}
function placeTip() {
  const P = cfg.pointer, w = ui.tip.offsetWidth, h = ui.tip.offsetHeight;
  const x = Math.min(innerWidth - w - 8, P.x + 16), y = Math.max(8, P.y - h - 14);
  ui.tip.style.transform = `translate(${x}px, ${y}px)`;
}

/* ------------------------- étiquettes flottantes ------------------------- */
const roomEls = [];
function updateRoomLabels() {
  for (const el of roomEls) el.remove();
  roomEls.length = 0;
  const walking = nav && (nav.mode === 'walk' || nav.mode === 'look');
  if (!lots.roomLabels || cfg.floor == null || !cfg.cut.ready || cfg.viewMode !== 'plan' || walking || cfg.immersive) return;
  let list = [];
  try { list = lots.roomLabels(cfg.floor) || []; } catch (e) { list = []; }
  for (const r of list) {
    const el = document.createElement('span');
    el.className = 'rl hide';
    el.innerHTML = `${esc(r.text)}${r.sub ? ` <small>${esc(r.sub)}</small>` : ''}`;
    el._pos = new THREE.Vector3(...(Array.isArray(r.pos) ? r.pos : [r.pos.x, r.pos.y, r.pos.z]));
    ui.labels.appendChild(el);
    roomEls.push(el);
  }
}
function updateLabelSet() {
  if (!lots) return;
  updateRoomLabels();
  const want = new Set();
  const walking = nav && (nav.mode === 'walk' || nav.mode === 'look');
  if (!walking && !cfg.immersive) {
    for (const d of allLots()) {
      const id = String(d.id);
      if ((cfg.floor != null && cfg.cut.ready && d.level === cfg.floor) || (cfg.availability && cfg.floor == null)) want.add(id);
    }
  }
  for (const [id, el] of cfg.labels) if (!want.has(id)) { el.remove(); cfg.labels.delete(id); cfg.labelSize.delete(id); }
  for (const id of want) {
    let el = cfg.labels.get(id);
    if (!el) {
      const L = lotData(id); if (!L) continue;
      const st = statusOf(L.status);
      el = document.createElement('button');
      el.className = 'l3 hide'; el.type = 'button';
      el.innerHTML = `<span class="dot" style="--c:${st.color}"></span>${esc(L.id)} <small>${esc(L.typo)} · ${esc(L.surface)} m²</small>`;
      el.setAttribute('aria-label', `Lot ${L.id}, ${L.typo}, ${L.surface} m², ${st.label}`);
      el.addEventListener('click', () => selectLot(id, { fly: cfg.availability }));
      el.addEventListener('pointerenter', () => setHover(id));
      el.addEventListener('pointerleave', () => setHover(null));
      ui.labels.appendChild(el);
      cfg.labels.set(id, el);
    }
    el.classList.toggle('sel', id === cfg.selected);
    el.classList.toggle('dim', !!cfg.selected && id !== cfg.selected);
    el.classList.toggle('out', !lotMatches(lotData(id)));
  }
  invalidate();
}
// ancre « disponibilités » : milieu de la face extérieure du lot la plus tournée vers la caméra
const _av = new THREE.Vector3();
function availabilityAnchor(L, out) {
  const poly = lotsData.zones && lotsData.zones[L.zone] && lotsData.zones[L.zone].poly;
  const lv = levels.find((l) => l.key === L.level) || { y0: L.level * 3, y1: L.level * 3 + 3 };
  const y = (lv.y0 + lv.y1) / 2 + 0.2;
  if (!poly) return out.copy(L.labelAnchor);
  const fx0 = bounds.floorMinX ?? -6, fx1 = bounds.floorMaxX ?? 6;
  let best = -Infinity, found = false;
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % poly.length];
    const onFacade = (Math.abs(x0 - x1) < 1e-3 && (Math.abs(x0 - fx0) < 0.05 || Math.abs(x0 - fx1) < 0.05)) || (Math.abs(z0 - z1) < 1e-3 && (Math.abs(z0) < 0.05 || Math.abs(z0 + 19) < 0.05));
    if (!onFacade) continue;
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    const nx = Math.abs(x0 - x1) < 1e-3 ? Math.sign(x0) : 0, nz = Math.abs(z0 - z1) < 1e-3 ? (z0 > -9.5 ? 1 : -1) : 0;
    const vx = camera.position.x - mx, vz = camera.position.z - mz, vl = Math.hypot(vx, vz) || 1;
    const facing = (nx * vx + nz * vz) / vl;
    const score = facing * Math.min(1, Math.hypot(x1 - x0, z1 - z0) / 4);
    if (facing > 0.12 && score > best) { best = score; out.set(mx + nx * 0.4, y, mz + nz * 0.4); found = true; }
  }
  return found ? out : null;
}
const _lv = new THREE.Vector3();
function updateLabels() {
  if (!cfg.labels.size && !roomEls.length) return;
  const W = innerWidth, H = innerHeight;
  const topSafe = isMobile() ? 150 : 84, botSafe = H - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dock-h')) || 110) - 24;
  const placed = [];
  const items = [];
  for (const [id, el] of cfg.labels) {
    const L = lotData(id);
    if (!L) continue;
    let p = null;
    if (cfg.availability && cfg.floor == null) p = availabilityAnchor(L, _lv);
    else p = _lv.copy(L.labelAnchor);
    let vis = !!p;
    let x = 0, y = 0;
    if (p) {
      p.project(camera);
      vis = p.z < 1 && Math.abs(p.x) < 1.05 && Math.abs(p.y) < 1.05;
      x = (p.x + 1) / 2 * W; y = (1 - p.y) / 2 * H;
    }
    let sz = cfg.labelSize.get(id);
    if (!sz && vis) { sz = { w: el.offsetWidth || 120, h: el.offsetHeight || 28 }; cfg.labelSize.set(id, sz); }
    items.push({ id, el, vis, x, y, sz });
  }
  // anti-chevauchement : du haut vers le bas, on décale vers le bas l'étiquette qui en recouvre une autre
  items.sort((a, b) => a.y - b.y);
  for (const it of items) {
    if (!it.vis) { it.el.classList.add('hide'); continue; }
    const w = it.sz.w, h = it.sz.h + 8;
    let x = THREE.MathUtils.clamp(it.x, 12 + w / 2, W - 12 - w / 2), y = it.y;
    for (let k = 0; k < 6; k++) {
      const hit = placed.find((q) => Math.abs(q.x - x) < (q.w + w) / 2 + 4 && Math.abs(q.y - y) < (q.h + h) / 2);
      if (!hit) break;
      y = hit.y + (hit.h + h) / 2 + 2;
    }
    y = THREE.MathUtils.clamp(y, topSafe + h, botSafe);
    placed.push({ x, y, w, h });
    it.el.classList.remove('hide');
    it.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, calc(-100% - 8px))`;
  }
  // noms des pièces : jamais décalés, masqués s'ils chevauchent une étiquette déjà posée
  for (const el of roomEls) {
    _lv.copy(el._pos).project(camera);
    if (!(_lv.z < 1 && Math.abs(_lv.x) < 1 && Math.abs(_lv.y) < 1)) { el.classList.add('hide'); continue; }
    if (!el._w) { el.classList.remove('hide'); el._w = el.offsetWidth || 80; el._h = el.offsetHeight || 20; }
    const x = (_lv.x + 1) / 2 * W, y = (1 - _lv.y) / 2 * H, w = el._w, h = el._h;
    const hit = y < topSafe || y > botSafe || x - w / 2 < 4 || x + w / 2 > W - 4 || placed.some((q) => Math.abs(q.x - x) < (q.w + w) / 2 + 2 && Math.abs((q.y - q.h / 2) - y) < (q.h + h) / 2);
    el.classList.toggle('hide', hit);
    if (hit) continue;
    placed.push({ x, y: y + h / 2, w, h });
    el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
  }
}

/* -------------------- cadrage dans la zone libre (setViewOffset) -------------------- */
function updateViewOffsetTarget() {
  const W = innerWidth, H = innerHeight, vo = cfg.vo;
  if (isMobile() || cfg.immersive || (cfg.floor == null && ui.sheet.hidden)) { vo.tx = 0; vo.ty = 0; invalidate(600); return; }
  let left = 0, right = W, top = 72, bottom = H - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dock-h')) || 110) - 20;
  const rl = document.body.classList.contains('lots-open') ? ui.lotsPanel.getBoundingClientRect() : null;
  if (rl && rl.width) left = rl.right;
  if (!ui.sheet.hidden) right = ui.sheet.getBoundingClientRect().left - 70;
  else if (cfg.floor != null) right = W - 170;
  vo.tx = THREE.MathUtils.clamp(W / 2 - (left + right) / 2, -W * 0.3, W * 0.3);
  vo.ty = THREE.MathUtils.clamp(H / 2 - (top + bottom) / 2, -H * 0.2, H * 0.2);
  invalidate(800);
}
function stepViewOffset() {
  const vo = cfg.vo;
  if (Math.abs(vo.tx - vo.x) < 0.5 && Math.abs(vo.ty - vo.y) < 0.5) {
    if (vo.x !== vo.tx || vo.y !== vo.ty) { vo.x = vo.tx; vo.y = vo.ty; applyViewOffset(); }
    return;
  }
  vo.x += (vo.tx - vo.x) * 0.12; vo.y += (vo.ty - vo.y) * 0.12;
  applyViewOffset();
  invalidate();
}
function applyViewOffset() {
  const vo = cfg.vo, W = innerWidth, H = innerHeight;
  if (Math.abs(vo.x) < 0.5 && Math.abs(vo.y) < 0.5) camera.clearViewOffset();
  else camera.setViewOffset(W, H, vo.x, vo.y, W, H);
  camera.updateProjectionMatrix();
}

/* ------------------------------ mini-carte ------------------------------ */
const _dir = new THREE.Vector3();
let mmLast = '';
function updateMinimap() {
  if (!ui.mmCam || isMobile()) return;
  camera.getWorldDirection(_dir);
  const cx = 0, cz = (bounds.minZ + bounds.maxZ) / 2 - 2;
  let x = camera.position.x - cx, z = camera.position.z - cz;
  const d = Math.hypot(x, z), R = 25;
  if (d > R) { x *= R / d; z *= R / d; }
  const ang = Math.atan2(_dir.x, -_dir.z) / DEG;
  const key = `${x.toFixed(1)}|${z.toFixed(1)}|${ang.toFixed(0)}`;
  if (key === mmLast) return;
  mmLast = key;
  ui.mmCam.setAttribute('transform', `translate(${(x + cx).toFixed(2)} ${(z + cz).toFixed(2)}) rotate(${ang.toFixed(1)})`);
}
function renderMinimapLots() {
  if (!ui.mmLots) return;
  const k = cfg.floor;
  const zonePoly = (d) => lotsData.zones && lotsData.zones[d.zone] && lotsData.zones[d.zone].poly;
  let html = '';
  if (k != null) {
    html = allLots().filter((d) => d.level === k).map((d) => {
      const poly = zonePoly(d);
      return poly ? `<polygon points="${poly.map(([x, z]) => `${x},${z}`).join(' ')}" fill="${statusOf(d.status).color}" fill-opacity="${String(d.id) === cfg.selected ? '.85' : '.55'}" stroke="#fff" stroke-width=".2"/>` : '';
    }).join('');
  } else {
    // hors coupe : emprise des zones de logements (rue / jardin) et lot sélectionné
    const zs = new Set(allLots().map((d) => d.zone));
    html = [...zs].map((z) => { const p = lotsData.zones && lotsData.zones[z] && lotsData.zones[z].poly; return p ? `<polygon points="${p.map(([x, zz]) => `${x},${zz}`).join(' ')}" fill="rgba(216,189,140,.14)" stroke="rgba(216,189,140,.5)" stroke-width=".18"/>` : ''; }).join('');
    const sel = cfg.selected && allLots().find((d) => String(d.id) === cfg.selected);
    const sp = sel && zonePoly(sel);
    if (sp) html += `<polygon points="${sp.map(([x, z]) => `${x},${z}`).join(' ')}" fill="${statusOf(sel.status).color}" fill-opacity=".7"/>`;
  }
  ui.mmLots.innerHTML = html;
}

/* ------------------------------ liste des lots ------------------------------ */
function lotMatches(d) {
  if (!d) return false;
  const f = cfg.filter;
  if (f.typo && d.typo !== f.typo) return false;
  if (f.status.size && !f.status.has(d.status)) return false;
  if (f.surf && d.surface < f.surf) return false;
  if (f.fav && !cfg.favs.has(String(d.id))) return false;
  return true;
}
// filtre des plans et volumes : critères de la liste, et lot sélectionné mis en avant
function applyLotFilter() {
  const f = cfg.filter;
  const active = f.typo || f.status.size || f.surf || f.fav;
  const sel = cfg.selected;
  lots.setFilter(active || sel ? (d) => lotMatches(d) && (!sel || String(d.id) === sel || d.level !== cfg.floor) : null);
}
function applyFilter() {
  applyLotFilter();
  renderLotList();
  updateLabelSet();
  invalidate(200);
}
const STATUS_ORDER = { disponible: 0, reserve: 1, vendu: 2 };
function renderLotList() {
  const list = allLots().slice();
  const by = cfg.sort;
  list.sort((a, b) => {
    if (by === 'prix') return (a.status === 'vendu') - (b.status === 'vendu') || (a.prix || 9e9) - (b.prix || 9e9);
    if (by === 'surface') return b.surface - a.surface;
    if (by === 'etage') return b.level - a.level || String(a.id).localeCompare(String(b.id));
    return (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3) || b.level - a.level || String(a.id).localeCompare(String(b.id));
  });
  const n = list.filter(lotMatches).length, dispo = list.filter((d) => d.status === 'disponible').length;
  ui.lotsCount.textContent = n === list.length ? `${dispo} disponible${dispo > 1 ? 's' : ''} sur ${list.length} logements` : `${n} logement${n > 1 ? 's' : ''} sur ${list.length} correspond${n > 1 ? 'ent' : ''}`;
  ui.lotList.innerHTML = list.map((d) => {
    const st = statusOf(d.status), ok = lotMatches(d), fav = cfg.favs.has(String(d.id));
    return `<li><button class="lcard${ok ? '' : ' out'}" data-id="${esc(d.id)}" style="--sc:${st.color}" aria-current="${String(d.id) === cfg.selected}"
      aria-label="Lot ${esc(d.id)}, ${esc(d.typo)}, ${esc(d.surface)} m², ${esc(LEVEL_NAME(d.level))}, ${esc(st.label)}${fav ? ', favori' : ''}">
      <span class="num">${esc(d.id)}</span>
      <span class="ti">${esc(d.typo)} · ${esc(d.surface)} m²${fav ? ' <span aria-hidden="true" style="color:var(--brass-2)">★</span>' : ''}${cfg.cmp.includes(String(d.id)) ? ' <span aria-hidden="true" style="color:var(--brass-2);font-size:11px">⇆</span>' : ''}</span>
      <span class="pr">${d.status === 'vendu' ? '—' : d.prix ? FMT_EUR.format(d.prix) : ''}<small class="stt" style="--c:${st.color}">${esc(st.label)}</small></span>
      <span class="su">${esc(LEVEL_NAME(d.level))} · ${esc(ZONE_LABEL[d.zone] || '')}${d.attique ? ' · attique' : ''}</span>
    </button></li>`;
  }).join('') || '<li class="lempty">Aucun logement.</li>';
  ui.lotList.querySelectorAll('.lcard').forEach((b) => {
    b.addEventListener('click', () => selectLot(b.dataset.id));
    b.addEventListener('pointerenter', () => { if (cfg.floor != null || cfg.availability) setHover(b.dataset.id); });
    b.addEventListener('pointerleave', () => setHover(null));
  });
  renderFloorCounts();
}
function renderFloorCounts() {
  ui.floorList.querySelectorAll('.lvl[data-key]').forEach((b) => {
    const k = b.dataset.key; if (k === 'ext') return;
    const fl = allLots().filter((d) => String(d.level) === k);
    const n = fl.filter((d) => d.status === 'disponible' && lotMatches(d)).length;
    const small = b.querySelector('small');
    if (small) small.innerHTML = fl.length ? (n ? `<b>${n}</b> dispo. / ${fl.length}` : `0 / ${fl.length} dispo.`) : 'Parties communes';
  });
}
function toggleLots(force) {
  const on = force !== undefined ? !!force : !document.body.classList.contains('lots-open');
  document.body.classList.toggle('lots-open', on);
  ui.tLots.setAttribute('aria-pressed', String(on));
  if (isMobile() && on) showPane('lotsPanel');
  if (nav && nav.setInsets) nav.setInsets(on && !isMobile() ? { left: 352 } : {});
  updateViewOffsetTarget();
  invalidate(100);
}
// mobile : un seul volet ouvert à la fois ; retoucher l'onglet actif replie le volet
function showPane(id) {
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach((x) => x.setAttribute('aria-expanded', String(x.dataset.pane === id)));
  document.querySelectorAll('.dock .pane').forEach((p) => p.classList.toggle('on', p.id === id));
  if (id) closeSheetKeepSelection();
}

/* ------------------------- course du soleil (UI) ------------------------- */
function renderSunBar() {
  const stops = [];
  for (let h = 8; h <= 20.001; h += 0.1) {
    const e = solarPosition(h, state.season).elev;
    const c = e < -6 ? 'rgba(40,50,80,.7)' : e < 0 ? '#7f9fd8' : e < 7 ? '#d8bd8c' : 'rgba(255,255,255,.14)';
    stops.push(`${c} ${(((h - 8) / 12) * 100).toFixed(1)}%`);
  }
  ui.sunBar.style.background = `linear-gradient(90deg, ${stops.join(', ')})`;
}

function buildConfiguratorUI() {
  // étages, du toit au rez-de-chaussée
  ui.floorList.innerHTML = '';
  [...(lots.floors || [])].sort((a, b) => b.key - a.key).forEach((f) => {
    const b = document.createElement('button');
    b.className = 'lvl'; b.type = 'button'; b.dataset.key = String(f.key);
    b.setAttribute('aria-pressed', 'false');
    b.setAttribute('aria-label', `${f.name} en coupe`);
    b.innerHTML = `<span>${esc(f.name)}</span><i aria-hidden="true"></i><small></small>`;
    b.addEventListener('click', () => onFloorButton(f.key));
    ui.floorList.appendChild(b);
  });
  const ext = document.createElement('button');
  ext.className = 'lvl ext'; ext.type = 'button'; ext.dataset.key = 'ext';
  ext.setAttribute('aria-pressed', 'true');
  ext.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V9l8-5 8 5v11z"/></svg>Extérieur';
  ext.setAttribute('aria-label', 'Quitter la coupe : vue extérieure');
  ext.title = 'Vue extérieure (0)';
  ext.addEventListener('click', () => { closeSheet(); setFloor(null); if (nav && nav.mode !== 'orbit') setNavMode('orbit'); });
  ui.floorList.appendChild(ext);

  // légende des statuts et filtres
  const sts = Object.keys((lotsData && lotsData.statuts) || {});
  ui.legend.innerHTML = sts.map((k) => `<span><i class="dot" style="--c:${statusOf(k).color}"></i>${esc(statusOf(k).label)}</span>`).join('');
  const typos = [...new Set(allLots().map((d) => d.typo))].sort();
  ui.fTypo.innerHTML = ['Toutes', ...typos].map((t, i) => `<button class="chip" data-typo="${i ? esc(t) : ''}" aria-pressed="${i === 0}">${esc(t)}</button>`).join('');
  ui.fTypo.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
    cfg.filter.typo = b.dataset.typo || null;
    ui.fTypo.querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    applyFilter();
  }));
  ui.fStatus.innerHTML = sts.map((k) => `<button class="chip" data-st="${esc(k)}" aria-pressed="false"><i class="dot" style="--c:${statusOf(k).color}"></i>${esc(statusOf(k).label)}</button>`).join('');
  ui.fStatus.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.st;
    if (cfg.filter.status.has(k)) cfg.filter.status.delete(k); else cfg.filter.status.add(k);
    b.setAttribute('aria-pressed', String(cfg.filter.status.has(k)));
    applyFilter();
  }));
  const surfs = allLots().map((d) => d.surface);
  if (surfs.length) { ui.fSurf.min = String(Math.floor(Math.min(...surfs) / 2) * 2); ui.fSurf.max = String(Math.ceil(Math.max(...surfs) / 2) * 2); ui.fSurf.value = ui.fSurf.min; }
  const syncSurf = () => {
    const v = +ui.fSurf.value, min = +ui.fSurf.min;
    cfg.filter.surf = v > min ? v : 0;
    ui.fSurfOut.textContent = cfg.filter.surf ? `≥ ${v} m²` : 'Toutes';
    ui.fSurf.setAttribute('aria-valuetext', ui.fSurfOut.textContent);
    ui.fSurf.style.setProperty('--p', `${((v - min) / Math.max(1, +ui.fSurf.max - min)) * 100}%`);
  };
  syncSurf();
  ui.fSurf.addEventListener('input', () => { syncSurf(); applyFilter(); });
  ui.fFav.addEventListener('click', () => {
    cfg.filter.fav = !cfg.filter.fav;
    ui.fFav.setAttribute('aria-pressed', String(cfg.filter.fav));
    applyFilter();
  });
  ui.lSort.addEventListener('change', () => { cfg.sort = ui.lSort.value; renderLotList(); });
  ui.cmpGo.addEventListener('click', openCompare);
  ui.cmpClear.addEventListener('click', () => { cfg.cmp.length = 0; renderCmpBar(); renderLotList(); if (cfg.selected && !ui.sheet.hidden) openSheet(cfg.selected); });
  renderLotList();
  renderCmpBar();

  // outils
  ui.tLots.addEventListener('click', () => toggleLots());
  ui.lotsClose.addEventListener('click', () => toggleLots(false));
  ui.tAvail.addEventListener('click', () => setAvailability(!cfg.availability));
  ui.tHelp.addEventListener('click', () => openModal(ui.help));
  ui.backBtn.addEventListener('click', () => { if (nav && nav.mode === 'look' && nav.exitLook) nav.exitLook(); else exitImmersive(); });
  for (const d of [ui.help, ui.cmpDlg]) {
    d.addEventListener('close', () => { if (nav && nav.setEnabled) nav.setEnabled(true); });
    d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
  }
  ui.navMode.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setNavMode(b.dataset.mode)));

  // saisons (course du soleil)
  ui.seasons.forEach((b) => b.addEventListener('click', () => {
    state.season = b.dataset.season;
    ui.seasons.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    renderSunBar();
    applyHour(state.hour, true);
  }));
  renderSunBar();

  // onglets mobiles : un seul volet, retoucher l'onglet actif le replie
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    const open = t.getAttribute('aria-expanded') === 'true';
    showPane(open ? null : t.dataset.pane);
    if (t.dataset.pane === 'lotsPanel') document.body.classList.toggle('lots-open', !open);
  }));

  // hauteur du dock (pour placer joystick, panneaux et fiche au-dessus)
  const syncDock = () => {
    document.documentElement.style.setProperty('--dock-h', `${Math.round(ui.dock.getBoundingClientRect().height)}px`);
    updateViewOffsetTarget();
  };
  syncDock();
  if (window.ResizeObserver) new ResizeObserver(syncDock).observe(ui.dock);

  setupPicking();
  syncFloorUI();
}

/* ------------------------------ clavier ------------------------------ */
function onKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (ui.help.open || ui.cmpDlg.open) return;
  hideHint();
  const k = e.key, c = e.code || '';
  const dm = /^(?:Digit|Numpad)([0-9])$/.exec(c);
  const digit = dm ? +dm[1] : (k >= '0' && k <= '9' ? +k : -1);
  if (digit >= 1 && digit <= VIEWS.length && !cfg.immersive) goToView(digit - 1);
  else if (digit === 0) { closeSheet(); setFloor(null); setAvailability(false); }
  else if (k === 'PageUp') { e.preventDefault(); stepFloor(1); }
  else if (k === 'PageDown') { e.preventDefault(); stepFloor(-1); }
  else if (k === 'r' || k === 'R') toggleRotate();
  else if (k === 'f' || k === 'F') toggleFullscreen();
  else if (k === 'l' || k === 'L') toggleLots();
  else if (k === 'v' || k === 'V') setAvailability(!cfg.availability);
  else if (k === 'n' || k === 'N') { const ms = ['orbit', 'drone', 'walk']; setNavMode(ms[(ms.indexOf(nav ? nav.mode : 'orbit') + 1) % 3]); }
  else if (k === '?' || k === 'h' || k === 'H') openModal(ui.help);
  else if (k === 'Escape') {
    if (!ui.qPanel.hidden) { toggleQPanel(false); ui.qBtn.focus(); }
    else if (cfg.immersive) { if (!(nav && nav.mode === 'look')) exitImmersive(); }
    else if (!ui.sheet.hidden) closeSheet();
    else if (nav && nav.mode !== 'orbit') setNavMode('orbit');
  }
}

/* API de test / pilotage (console : __viewer) */
function api() {
  return {
    THREE, scene, camera, controls, renderer, composer, M, building, landscape,
    goToView: (i, instant = false) => goToView(i, instant ? { duration: 0 } : {}),
    setHour: (h) => { ui.hour.value = String(h); ui.hour.dispatchEvent(new Event('input')); updateEnvironment(); },
    setLevel, setQuality: (q) => { state.auto = q === 'auto'; setQuality(q === 'auto' ? 'high' : q); },
    render: () => { renderer.shadowMap.needsUpdate = true; render(); },
    get state() { return { ...state, sun: undefined }; },
    stats: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries, programs: renderer.info.programs.length, fps: state.fps, quality: state.quality }),
    views: VIEWS,
    get lots() { return lots; }, get nav() { return nav; }, cfg,
    setFloor: (k, o) => setFloor(k, o), selectLot: (id, o) => selectLot(id, o), closeSheet, setAvailability, setNavMode,
    viewFromLot, visitLot, toggleLots, pickAt, takeLift, exitImmersive, solarPosition, updateLift,
    projectLot: (id) => { const L = lotData(id); if (!L) return null; const v = L.labelAnchor.clone().project(camera); return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, z: v.z }; },
    // éclairage intérieur : état et réglages en direct
    interior: () => ({ k: IN.k, lot: IN.lotId, floor: IN.floor, windows: (IN.skyWins || []).map((w) => ({ axis: w.axis, p: +w.p.toFixed(2), cu: +w.cu.toFixed(2), w: +w.w.toFixed(2), h: +w.h.toFixed(2), inDir: w.inDir, room: w.room && w.room.name })), lamps: IN.lampList, downs: IN.downList, sky: IN.sky.map((L) => +L.intensity.toFixed(3)), look: { ...IN_LOOK } }),
    tuneInterior: (o = {}) => { Object.assign(IN_LOOK, o); IN.roomEnvKey = ''; applyInterior(); return { ...IN_LOOK }; },
    // réglages en direct (mise au point de la lumière)
    tune: (o = {}) => {
      Object.assign(LOOK, o);
      if (o.tm) renderer.toneMapping = o.tm === 'aces' ? THREE.ACESFilmicToneMapping : THREE.AgXToneMapping;
      applyHour(state.hour, true);
      return { ...LOOK };
    },
  };
}
