/**
 * Canopée — décoration des appartements visitables (mobilier, objets, textiles, luminaires, plantes).
 *
 *   export function decorMaterials(THREE, M, std, opts) → matériaux propres à la déco (ajoutés à MAT de lots.js)
 *   export function createDecor(THREE, P, ctx)          → { lotA(), lotB(), finishings() } — appelé par lots.js
 *
 * Parti pris (architecte d'intérieur) : « japandi » chaleureux à la française —
 *   chêne clair huilé, lin lavé, bouclé écru, travertin, céramique mate, métal noir, touches de laiton ;
 *   palette sable / greige / blanc cassé, accents terracotta, ocre, sauge et un bleu encre très discret.
 *
 * Conventions : repère « meuble » de lots.js (sol y = 0, face avant vers +z, mètres).
 * Toute la géométrie passe par P.push(mk, geo, {tint, keepUV}) : fusion par matériau dans lots.js,
 * teinte par objet en couleurs de sommet (variantes d'un même matériau dans un seul appel de dessin),
 * occlusion bakée multipliée par lots.js. Tout ce qui dépasse le plan de coupe (1,2 m) est « visite » seulement.
 */
import { createFurniture } from './furniture.js';
import { CATALOG as MODEL_CATALOG, fitSize } from './models.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// aléatoire, bruit périodique et textures peintes : decortex.js (chargeable par les workers de texpool.js)
import { rng, hash2, pn, fbmP, clamp, paintData, DECOR_TASKS } from './decortex.js';
import { take } from './texcache.js';
export { rng };
// boîtes arrondies : mêmes dimensions très fréquentes (chaises, coussins, poignées, d'un logement à l'autre) ;
// le gabarit est construit une fois puis copié
const RB_CACHE = new Map();
function roundedBox(THREE, w, h, d, seg, r) {
  const k = w + ',' + h + ',' + d + ',' + seg + ',' + r;
  let g = RB_CACHE.get(k);
  if (!g) RB_CACHE.set(k, g = new RoundedBoxGeometry(w, h, d, seg, r));
  return new THREE.BufferGeometry().copy(g);
}

// ------------------------------------------------------------------ textures procédurales
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
// carte de hauteur → normal map (convention OpenGL)
function normalCanvas(hgt, w, h, k) {
  const cv = canvas(w, h), g = cv.getContext('2d'), im = g.createImageData(w, h), d = im.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const l = hgt[y * w + ((x - 1 + w) % w)], r = hgt[y * w + ((x + 1) % w)], u = hgt[((y - 1 + h) % h) * w + x], b = hgt[((y + 1) % h) * w + x];
    let nx = (l - r) * k, ny = (b - u) * k, nz = 1; const L = Math.hypot(nx, ny, nz); nx /= L; ny /= L; nz /= L;
    const o = (y * w + x) * 4; d[o] = (nx * 0.5 + 0.5) * 255; d[o + 1] = (ny * 0.5 + 0.5) * 255; d[o + 2] = nz * 255; d[o + 3] = 255;
  }
  g.putImageData(im, 0, 0); return cv;
}
// canvas couleur et rugosité d'une texture peinte (pixels de paintData, decortex.js) ; hauteur en tableau
function paintCanvases(R) {
  const mk = (data) => { const cv = canvas(R.w, R.h); cv.getContext('2d').putImageData(new ImageData(data, R.w, R.h), 0, 0); return cv; };
  return { color: mk(R.col), hgt: R.hgt, rough: mk(R.rough), w: R.w, h: R.h };
}
// remplit un canvas pixel par pixel : f(u, v) → [r, g, b] (0–255) ; renvoie aussi la hauteur si f la fournit
function paint(w, h, f) { return paintCanvases(paintData(w, h, f)); }
// texture peinte de decorMaterials : calculée par un worker si possible (DECOR_TASKS), sinon sur place
const paintOf = (name) => paintCanvases(take(name, DECOR_TASKS[name]));

/** Matériaux de la déco. std(name, color, params) : constructeur de lots.js (MeshStandardMaterial enregistré). */
export function decorMaterials(THREE, M, std, opt = {}) {
  const aniso = opt.anisotropy || 8, list = opt.disposables || [];
  const T = (cv, rx, ry = rx, srgb = true) => {
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / rx, 1 / ry);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = aniso; list.push(t); return t;
  };
  const set = (p, rx, ry, nk, extra = {}) => ({ map: T(p.color, rx, ry), normalMap: nk ? T(normalCanvas(p.hgt, p.w, p.h, nk), rx, ry, false) : null, roughnessMap: T(p.rough, rx, ry, false), ...extra });
  const D = {};

  // --- chêne clair huilé (mobilier) : 1 m × 0,25 m, fil horizontal
  const oak = paintOf('deco:oak');
  D.oak = std('decoOak', 0xffffff, set(oak, 1.0, 0.25, 1.2, { roughness: 1, normalScale: new THREE.Vector2(0.25, 0.25) }));
  // --- textiles : lin lavé neutre (teinté par objet), 0,2 m
  const linen = paintOf('deco:linen');
  const linenSet = set(linen, 0.2, 0.2, 2.5, { roughness: 1, normalScale: new THREE.Vector2(0.55, 0.55) });
  // tissus : MeshPhysicalMaterial avec sheen (velouté rasant, pas de reflet plastique), spéculaire très bas
  const fab = (name, p, extra = {}) => { const m = new THREE.MeshPhysicalMaterial({ name, color: 0xffffff, roughness: 1, metalness: 0, sheen: 1, sheenRoughness: 0.7, sheenColor: new THREE.Color(0x6e6a64), specularIntensity: 0.18, envMapIntensity: 0.7, ...p, ...extra }); list.push(m); return m; };
  D.textile = fab('decoTextile', linenSet);
  D.cloth = fab('decoCloth', linenSet, { side: THREE.DoubleSide });
  // velours mat (canapés, coussins) : même forme de programme que le lin, sheen fort et resserré, relief faible
  D.velvet = fab('decoVelvet', linenSet, { normalScale: new THREE.Vector2(0.12, 0.12), sheenRoughness: 0.45, sheenColor: new THREE.Color(0x8c877e), specularIntensity: 0.04, envMapIntensity: 0.45 });
  // --- bouclé écru : boucles serrées, 0,12 m
  const boucle = paintOf('deco:boucle');
  D.boucle = fab('decoBoucle', set(boucle, 0.12, 0.12, 6, { roughness: 1, normalScale: new THREE.Vector2(1.3, 1.3) }), { sheenRoughness: 0.9, sheenColor: new THREE.Color(0x8a867e) });
  // --- tapis berbère (laine écrue, losanges brun-noir), motif répété tous les 0,8 m
  const rug = paintOf('deco:rug');
  D.rug = fab('decoRug', set(rug, 0.8, 0.8, 4, { roughness: 1, normalScale: new THREE.Vector2(0.8, 0.8) }), { sheenRoughness: 0.9 });
  // laine unie (tapis de chambre, plaids épais)
  const wool = paintOf('deco:wool');
  D.wool = fab('decoWool', set(wool, 0.3, 0.3, 5, { roughness: 1 }), { sheenRoughness: 0.9 });
  // jute tissé à plat (tapis) : natté 2 × 2 en fils épais, 0,16 m par motif
  const jute = paintOf('deco:jute');
  D.jute = fab('decoJute', set(jute, 0.16, 0.16, 5, { roughness: 1, normalScale: new THREE.Vector2(0.65, 0.65) }), { sheenRoughness: 0.95, sheenColor: new THREE.Color(0x7a6a50) });
  // cannage (tête de lit, chaises) : brins de rotin horizontaux, verticaux et diagonaux, jours octogonaux sombres ; 4 cm
  const cane = paintOf('deco:cane');
  D.cane = std('decoCane', 0xffffff, set(cane, 0.04, 0.04, 3, { roughness: 0.7, normalScale: new THREE.Vector2(0.8, 0.8) }));
  // --- travertin (plateaux, vasque, sol de salle de bains) : 1,2 m
  const trav = paintOf('deco:trav');
  D.travertine = std('decoTravertine', 0xffffff, set(trav, 1.2, 1.2, 2.5, { roughness: 1, normalScale: new THREE.Vector2(0.5, 0.5) }));
  // --- pierre claire du plan de travail (quartzite blanc chaud, veines grises douces) : 1,6 m
  const qz = paintOf('deco:qz');
  D.stone = std('decoStone', 0xffffff, set(qz, 1.6, 1.6, 0.6, { roughness: 1, normalScale: new THREE.Vector2(0.15, 0.15) }));   // poli : relief à peine perceptible
  // --- zellige blanc crème (crédence, douche) : carreaux 10 × 10 cm, émail ondulé, tons variés, 0,4 m
  const zel = paintOf('deco:zel');
  D.zellige = std('decoZellige', 0xffffff, set(zel, 0.4, 0.4, 3, { roughness: 1, normalScale: new THREE.Vector2(1.25, 1.25) }));   // joints creusés, émail ondulé
  // --- céramiques
  D.ceramic = std('decoCeramic', 0xffffff, { roughness: 0.12, metalness: 0 });            // sanitaires émaillés, vaisselle
  const grain = paintOf('deco:grain');
  D.stoneware = std('decoStoneware', 0xffffff, set(grain, 0.15, 0.15, 2, { roughness: 1, normalScale: new THREE.Vector2(0.3, 0.3) }));   // grain fin : relief discret (plus de piqué « bruit blanc »)  // grès mat (vases, pieds de lampe, pots)
  D.lacquer = std('decoLacquer', 0xffffff, { roughness: 0.42, metalness: 0 });            // façades laquées mates
  D.skirt = std('decoSkirt', 0xf3f1ec, { roughness: 0.5 });                               // plinthes, chambranles
  // --- métaux
  D.black = std('decoBlack', 0x1d1d1e, { roughness: 0.48, metalness: 0.55 });
  D.brass = std('decoBrass', 0xc9a46a, { roughness: 0.32, metalness: 1 });
  D.steel = std('decoSteel', 0xbfc1c3, { roughness: 0.28, metalness: 1 });
  D.glassBlack = std('decoGlassBlack', 0x0d0e10, { roughness: 0.08, metalness: 0.1 });    // vitrocéramique, porte de four
  D.mirror = std('decoMirror', 0xe2e5e6, { roughness: 0.02, metalness: 1, envMapIntensity: 0.9 });
  D.glassClear = std('decoGlass', 0xeef4f2, { roughness: 0.05, metalness: 0, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
  D.sheer = std('decoSheer', 0xfbf8f2, { ...set(linen, 0.12, 0.12, 0), roughness: 1, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
  // --- abat-jour et papier washi : lumière chaude diffusée (allumés)
  const washi = paintOf('deco:washi');
  D.shade = std('decoShade', 0xffffff, { map: T(washi.color, 0.25, 0.25), emissive: 0xffc98a, emissiveIntensity: 0.9, emissiveMap: T(washi.color, 0.25, 0.25), roughness: 1, side: THREE.DoubleSide });
  D.bulb = std('decoBulb', 0xffffff, { emissive: 0xffd9a8, emissiveIntensity: 3, roughness: 1 });
  // --- terre, écorce
  D.soil = std('decoSoil', 0x3a2c22, { roughness: 1 });
  D.bark = (M && M.bark) ? M.bark.clone() : std('decoBark', 0x6b5a48, { roughness: 0.9 });
  if (M && M.bark) { D.bark.name = 'decoBark'; list.push(D.bark); }
  // --- feuillage d'intérieur : atlas (figuier lyre | rameau d'olivier | sansevieria)
  // feuillage modélisé : atlas opaque de nervures (la découpe vient de la géométrie), envers plus clair
  const lAt = leafAtlas2(THREE, T);
  const leafMat = (name, rough, extra = {}) => {
    const m = std(name, 0xffffff, { map: lAt, side: THREE.DoubleSide, roughness: rough, envMapIntensity: 0.8, ...extra });
    m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n  if (!gl_FrontFacing) diffuseColor.rgb *= vec3(1.32, 1.36, 1.18);'); };
    m.customProgramCacheKey = () => 'decoLeafBack'; return m;
  };
  D.leafG = leafMat('decoLeafGloss', 0.34);
  D.leafM = leafMat('decoLeafMatte', 0.68);
  D.leaf = D.leafM;
  // --- œuvres : atlas 2048 × 1024 (UV propres)
  D.art = std('decoArt', 0xffffff, { map: artAtlas(THREE, T), roughness: 0.85 });
  D.art.map.repeat.set(1, 1);
  // --- tranches de livres (papier)
  D.paper = std('decoPaper', 0xf2ede2, { roughness: 0.9 });
  // ombres de contact (décalques multiplicatifs sous les meubles)
  // empreinte floue d'un meuble vu de dessus (rectangle aux angles arrondis) : noyau serré sous le meuble + pénombre
  // large ; calculée une fois, posée en décalque multiplicatif sous chaque pièce (aucun coût par image)
  const sh = canvas(128, 128), sg = sh.getContext('2d');
  const rr = (x, y, w, h, r) => { sg.beginPath(); sg.roundRect(x, y, w, h, r); sg.fill(); };
  sg.filter = 'blur(14px)'; sg.fillStyle = 'rgba(0,0,0,0.6)'; rr(22, 22, 84, 84, 26);
  sg.filter = 'blur(6px)'; sg.fillStyle = 'rgba(0,0,0,0.75)'; rr(30, 30, 68, 68, 18);
  sg.filter = 'none';
  const shT = new THREE.CanvasTexture(sh); list.push(shT);
  D.contact = new THREE.MeshBasicMaterial({ name: 'decoContact', color: 0x000000, alphaMap: shT, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  list.push(D.contact);
  // matériaux partagés de materials.js quand ils existent (réglés pour l'éclairage intérieur)
  const share = { black: 'blackMetal', brass: 'brassBrushed', steel: 'steelBrushed', mirror: 'mirror', sheer: 'curtainSheer', glassClear: 'glassClear', ceramic: 'ceramicWhite', skirt: 'skirting' };
  for (const [k, mk] of Object.entries(share)) if (M && M[mk]) D[k] = M[mk];
  for (const k of Object.keys(D)) D[k].userData.decor = true;
  D.shade.userData.lamp = true; D.bulb.userData.lamp = true;
  // abat-jour et ampoules hors du G-buffer de la GTAO : plus de halo sombre au plafond autour des suspensions
  D.shade.userData.noAO = true; D.bulb.userData.noAO = true;
  return D;
}

// parquet chêne clair en point de Hongrie (lames 9 × 60 cm à 45°) : tuile 0,84 × 1,0 m, axe du chevron selon z
export function chevronParquet(THREE, opt = {}) {
  const C = 0.42, P = 0.125, TW = 2 * C, TH = 8 * P, W = 1024, Hh = 1024;
  const p = paint(W, Hh, (u, v, o) => {
    const x = u * TW, y = v * TH, k = Math.floor(x / C), lx = x - k * C, even = (k & 1) === 0;
    const s = even ? (y + lx) / P : (y - lx + C) / P, si = Math.floor(s), fs = s - si;
    const id = ((si % 8) + 8) % 8 + k * 8;
    const along = even ? (lx - y) : (lx + y);
    const tone = hash2(id, 3, 7), tone2 = hash2(id, 9, 2);
    const ring = fs * 9 + 1.5 * fbmP(((along / 1.2) % 1 + 1) % 1, tone, 3, 1, 2, id) + tone * 5;
    const g = 0.5 + 0.5 * Math.sin(ring * Math.PI * 2), fine = fbmP(u, v, 300, 300, 1, 4);
    const seam = Math.min(fs, 1 - fs) * P < 0.0012 || Math.min(lx, C - lx) < 0.0011;
    const l = (0.84 + 0.1 * tone + 0.06 * g + 0.04 * fine) * (seam ? 0.62 : 1);
    o[0] = (206 + 10 * tone2) * l; o[1] = (176 + 6 * tone2) * l; o[2] = (136 - 6 * tone2) * l;
    o[3] = seam ? -1 : 0.15 * g + 0.1 * fine; o[4] = 0.58 + 0.12 * (1 - g) + (seam ? 0.3 : 0);
  });
  const mk = (cv, srgb) => { const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / TW, 1 / TH); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = opt.anisotropy || 8; (opt.disposables || []).push(t); return t; };
  return { map: mk(p.color, true), roughnessMap: mk(p.rough, false), normalMap: mk(normalCanvas(p.hgt, W, Hh, 3), false) };
}
// peinture murale mate : très légères irrégularités (rouleau), tuile 2 m
export function wallPaint(THREE, opt = {}) {
  const p = paint(512, 512, (u, v, o) => { const t = fbmP(u, v, 4, 4, 4, 123), s = fbmP(u, v, 128, 128, 2, 9); const l = 0.975 + 0.025 * t; o[0] = o[1] = o[2] = 255 * l; o[3] = s; o[4] = 0.9; });
  const mk = (cv, srgb, r) => { const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / r, 1 / r); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = opt.anisotropy || 8; (opt.disposables || []).push(t); return t; };
  return { map: mk(p.color, true, 2), normalMap: mk(normalCanvas(p.hgt, 512, 512, 0.8), false, 0.5) };
}
// grand carreau effet pierre (60 × 60, joint fin), tuile 1,2 m
export function stoneTile(THREE, opt = {}) {
  const p = paint(1024, 1024, (u, v, o) => {
    const i = Math.floor(u * 2), j = Math.floor(v * 2), fu = u * 2 - i, fv = v * 2 - j, e = Math.min(fu, fv, 1 - fu, 1 - fv);
    const grout = e < 0.004, t = hash2(i, j, 31);
    const band = fbmP(u, v, 2, 10, 4, 33 + i * 3 + j), pore = fbmP(u, v, 50, 200, 2, 40), pit = pore > 0.78 ? (pore - 0.78) / 0.22 : 0;
    const l = grout ? 0.7 : 0.86 + 0.06 * band + 0.04 * t - 0.2 * pit;
    o[0] = (grout ? 200 : 222) * l; o[1] = (grout ? 196 : 212) * l; o[2] = (grout ? 190 : 196) * l; o[3] = grout ? -1 : -pit; o[4] = grout ? 0.9 : 0.5 + 0.3 * pit;
  });
  const mk = (cv, srgb) => { const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / 1.2, 1 / 1.2); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = opt.anisotropy || 8; (opt.disposables || []).push(t); return t; };
  return { map: mk(p.color, true), roughnessMap: mk(p.rough, false), normalMap: mk(normalCanvas(p.hgt, 1024, 1024, 2), false) };
}


// atlas opaque des limbes 1024² : nervure médiane en u = 0,5, base en v = 0, pointe en v = 1
// [0,.5]²: figuier lyre | [.5,1]×[0,.5]: strelitzia | ligne haute : olivier, basilic, sansevieria, feuille séchée
function leafAtlas2(THREE, T) {
  const S = 1024, cv = canvas(S, S), g = cv.getContext('2d'), R = rng(17);
  const cell = (x0, y0, w, h, fn) => { g.save(); g.translate(x0, y0); g.beginPath(); g.rect(0, 0, w, h); g.clip(); fn(w, h); g.restore(); };
  // v (bas → haut) : canvas y inversé ; on dessine pointe en haut (y = 0) donc v = 1 - y/h
  const base = (w, h, c0, c1, c2) => { const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, c0); gr.addColorStop(0.5, c1); gr.addColorStop(1, c2); g.fillStyle = gr; g.fillRect(0, 0, w, h); };
  const mottle = (w, h, n, a, cols) => { for (let k = 0; k < n; k++) { g.fillStyle = cols[k % cols.length].replace('A', (a * R()).toFixed(3)); g.beginPath(); g.ellipse(R() * w, R() * h, 3 + R() * 18, 3 + R() * 26, R() * 3, 0, 7); g.fill(); } };
  // figuier lyre : vert profond brillant, nervure claire, nervures secondaires arquées vers la pointe
  cell(0, 512, 512, 512, (w, h) => {
    base(w, h, '#2c4a1f', '#3f6229', '#2a461d'); mottle(w, h, 700, 0.07, ['rgba(20,40,12,A)', 'rgba(110,140,70,A)']);
    g.strokeStyle = 'rgba(196,208,140,0.95)'; g.lineWidth = 9; g.beginPath(); g.moveTo(w / 2, h); g.lineTo(w / 2, 6); g.stroke();
    g.lineWidth = 3.5; g.strokeStyle = 'rgba(170,190,110,0.7)';
    for (let i = 1; i < 12; i++) { const y = h * (1 - i / 12.5); for (const sd of [-1, 1]) { g.beginPath(); g.moveTo(w / 2, y); g.quadraticCurveTo(w / 2 + sd * w * 0.22, y - h * 0.03, w / 2 + sd * w * 0.48, y - h * 0.1); g.stroke(); } }
    g.lineWidth = 1.2; g.strokeStyle = 'rgba(150,170,95,0.35)'; for (let k = 0; k < 160; k++) { const x = R() * w, y = R() * h; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 30, y - R() * 20); g.stroke(); }
  });
  // strelitzia : vert bleuté, nervures parallèles obliques fines
  cell(512, 512, 512, 512, (w, h) => {
    base(w, h, '#36552c', '#4b6d37', '#36552c'); mottle(w, h, 300, 0.05, ['rgba(30,50,20,A)', 'rgba(140,160,110,A)']);
    g.strokeStyle = 'rgba(205,210,150,0.9)'; g.lineWidth = 10; g.beginPath(); g.moveTo(w / 2, h); g.lineTo(w / 2, 0); g.stroke();
    g.lineWidth = 1.6; g.strokeStyle = 'rgba(160,185,120,0.4)';
    for (let i = -40; i < 80; i++) for (const sd of [-1, 1]) { const y = i * 9; g.beginPath(); g.moveTo(w / 2, y); g.lineTo(w / 2 + sd * w / 2, y - w * 0.45); g.stroke(); }
  });
  // olivier : dessus vert-gris mat (l'envers argenté vient du shader)
  cell(0, 0, 256, 512, (w, h) => { base(w, h, '#5c6748', '#6d7856', '#5c6748'); mottle(w, h, 200, 0.06, ['rgba(40,50,30,A)', 'rgba(170,175,150,A)']); g.strokeStyle = 'rgba(190,195,165,0.7)'; g.lineWidth = 5; g.beginPath(); g.moveTo(w / 2, h); g.lineTo(w / 2, 0); g.stroke(); });
  // basilic : vert tendre brillant, nervures en creux
  cell(256, 0, 256, 512, (w, h) => { base(w, h, '#3f7a26', '#56962f', '#3f7a26'); g.strokeStyle = 'rgba(170,210,120,0.8)'; g.lineWidth = 5; g.beginPath(); g.moveTo(w / 2, h); g.lineTo(w / 2, 0); g.stroke(); g.lineWidth = 2.5; for (let i = 1; i < 7; i++) { const y = h * (1 - i / 7.5); for (const sd of [-1, 1]) { g.beginPath(); g.moveTo(w / 2, y); g.quadraticCurveTo(w / 2 + sd * w * 0.25, y - 20, w / 2 + sd * w * 0.48, y - 60); g.stroke(); } } });
  // sansevieria : bandes zébrées, liseré jaune
  cell(512, 0, 256, 512, (w, h) => {
    for (let y = 0; y < h; y++) { const t = y / h, zig = Math.sin(t * 70 + Math.sin(t * 13) * 2); const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, '#c2ad4c'); gr.addColorStop(0.08, '#3c5a2a'); gr.addColorStop(0.5, zig > 0.35 ? '#6a8a4c' : '#2a4420'); gr.addColorStop(0.92, '#3c5a2a'); gr.addColorStop(1, '#c2ad4c'); g.fillStyle = gr; g.fillRect(0, y, w, 1); }
  });
  // feuille séchée (eucalyptus) : gris-vert poudré, nervure fine
  cell(768, 0, 256, 512, (w, h) => { base(w, h, '#b9bba6', '#cfd0bd', '#b9bba6'); mottle(w, h, 150, 0.08, ['rgba(120,110,90,A)', 'rgba(240,235,220,A)']); g.strokeStyle = 'rgba(150,140,115,0.6)'; g.lineWidth = 3; g.beginPath(); g.moveTo(w / 2, h); g.lineTo(w / 2, 0); g.stroke(); });
  const t = T(cv, 1, 1); t.repeat.set(1, 1); t.flipY = true; return t;
}

// atlas de feuillage 1024² : [0, .5]×[0, 1] feuille de figuier lyre ; [.5, 1]×[.5, 1] rameau d'olivier ; [.5, 1]×[0, .5] sansevieria
function leafAtlas(THREE, T) {
  const S = 1024, cv = canvas(S, S), g = cv.getContext('2d'), R = rng(7);
  g.clearRect(0, 0, S, S);
  // figuier lyre : feuille en violon, nervures claires, bord légèrement ondulé (pointe vers le haut de la case)
  {
    const cx = S * 0.25, top = S * 0.04, bot = S * 0.96, Hh = bot - top;
    const prof = (t) => 0.17 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), 0.7) * (1 - 0.18 * Math.exp(-Math.pow((t - 0.45) / 0.12, 2))) + 0.01;
    g.beginPath();
    for (let i = 0; i <= 60; i++) { const t = i / 60; g.lineTo(cx + prof(t) * S * (1 + 0.03 * Math.sin(t * 40)), top + t * Hh); }
    for (let i = 60; i >= 0; i--) { const t = i / 60; g.lineTo(cx - prof(t) * S * (1 + 0.03 * Math.cos(t * 37)), top + t * Hh); }
    g.closePath();
    const lg = g.createLinearGradient(cx - S * 0.18, 0, cx + S * 0.18, 0);
    lg.addColorStop(0, '#2f4a22'); lg.addColorStop(0.5, '#47672f'); lg.addColorStop(1, '#2c4520');
    g.fillStyle = lg; g.fill();
    g.save(); g.clip();
    for (let k = 0; k < 900; k++) { g.fillStyle = `rgba(${R() < 0.5 ? '20,40,15' : '120,150,80'},${0.05 * R()})`; g.beginPath(); g.arc(cx + (R() - 0.5) * S * 0.4, top + R() * Hh, 4 + R() * 14, 0, 7); g.fill(); }
    g.strokeStyle = 'rgba(190,205,140,0.75)'; g.lineWidth = 7; g.beginPath(); g.moveTo(cx, bot); g.lineTo(cx, top + 10); g.stroke();
    g.lineWidth = 3; g.strokeStyle = 'rgba(175,195,125,0.55)';
    for (let i = 1; i < 11; i++) { const t = i / 11.5, y = top + (1 - t) * Hh; for (const s of [-1, 1]) { g.beginPath(); g.moveTo(cx, y); g.quadraticCurveTo(cx + s * S * 0.07, y - Hh * 0.04, cx + s * S * 0.16, y - Hh * 0.09); g.stroke(); } }
    g.restore();
  }
  // rameau d'olivier : tige fine, feuilles lancéolées vert-gris (dessus) / argentées (dessous)
  {
    const ox = S * 0.5, oy = 0, w = S * 0.5, h = S * 0.5;
    g.strokeStyle = '#6b5f48'; g.lineWidth = 5; g.beginPath(); g.moveTo(ox + w * 0.5, oy + h * 0.98); g.quadraticCurveTo(ox + w * 0.45, oy + h * 0.5, ox + w * 0.52, oy + h * 0.04); g.stroke();
    for (let i = 0; i < 34; i++) {
      const t = 0.06 + 0.9 * (i / 34), y = oy + h * (0.98 - t * 0.94), x = ox + w * (0.5 - 0.05 * Math.sin(t * 3));
      const side = i % 2 ? 1 : -1, ang = side * (0.5 + 0.5 * R()) - Math.PI / 2, L = h * (0.16 + 0.08 * R()), Wd = L * 0.16;
      g.save(); g.translate(x, y); g.rotate(ang + Math.PI / 2 * 0);
      g.rotate(Math.PI / 2 + side * 0.15);
      g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(Wd, -L * 0.5, 0, -L); g.quadraticCurveTo(-Wd, -L * 0.5, 0, 0);
      g.fillStyle = R() < 0.35 ? '#a7ad97' : (R() < 0.5 ? '#5f6d4a' : '#6f7c57'); g.fill();
      g.strokeStyle = 'rgba(210,215,190,0.5)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -L * 0.95); g.stroke();
      g.restore();
    }
  }
  // sansevieria : bande opaque vert sombre à zébrures, liseré jaune
  {
    const ox = S * 0.5, oy = S * 0.5, w = S * 0.5, h = S * 0.5;
    for (let y = 0; y < h; y++) {
      const t = y / h, zig = Math.sin(t * 60 + Math.sin(t * 13) * 2);
      const gr = g.createLinearGradient(ox, 0, ox + w, 0);
      gr.addColorStop(0, '#b9a64a'); gr.addColorStop(0.06, '#3c5a2a'); gr.addColorStop(0.5, zig > 0.4 ? '#5f7f45' : '#2f4a22'); gr.addColorStop(0.94, '#3c5a2a'); gr.addColorStop(1, '#b9a64a');
      g.fillStyle = gr; g.fillRect(ox, oy + y, w, 1);
    }
  }
  const t = T(cv, 1, 1); t.repeat.set(1, 1); return t;
}

// atlas d'œuvres 2048 × 1024 : 4 × 2 cases de 512 × 512 (proportions recadrées par les UV)
export const ART = { arcs: 0, line: 1, dune: 2, enso: 3, leaf: 4, blocks: 5, sea: 6, sketch: 7 };
function artAtlas(THREE, T) {
  const W = 2048, Hh = 1024, cv = canvas(W, Hh), g = cv.getContext('2d'), R = rng(99);
  const cell = (i, fn) => { const x = (i % 4) * 512, y = Math.floor(i / 4) * 512; g.save(); g.translate(x, y); g.beginPath(); g.rect(0, 0, 512, 512); g.clip(); fn(); g.restore(); };
  const paper = (c) => { g.fillStyle = c; g.fillRect(0, 0, 512, 512); for (let k = 0; k < 4000; k++) { g.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '255,255,255'},${0.03 * R()})`; g.fillRect(R() * 512, R() * 512, 1 + R() * 2, 1 + R() * 2); } };
  const brush = (fn, col, w, a = 1) => { g.strokeStyle = col; g.lineWidth = w; g.globalAlpha = a; g.lineCap = 'round'; g.beginPath(); fn(); g.stroke(); g.globalAlpha = 1; };
  // 0 : arcs superposés terracotta / ocre / sable (grand format au-dessus du canapé)
  cell(0, () => {
    paper('#ece4d6');
    const arc = (cx, cy, r, c) => { g.fillStyle = c; g.beginPath(); g.arc(cx, cy, r, Math.PI, 0); g.lineTo(cx + r, cy); g.closePath(); g.fill(); };
    arc(200, 360, 150, '#c0704a'); arc(330, 380, 120, '#d9a55c'); g.fillStyle = '#7d8a6c'; g.beginPath(); g.arc(150, 170, 46, 0, 7); g.fill();
    g.fillStyle = '#3d3a36'; g.fillRect(60, 380, 392, 6);
    for (let k = 0; k < 9000; k++) { g.fillStyle = `rgba(255,250,240,${0.05 * R()})`; g.fillRect(R() * 512, R() * 512, 2, 2); }
  });
  // 1 : dessin au trait (visage, une ligne)
  cell(1, () => {
    paper('#f3efe7');
    brush(() => { g.moveTo(160, 430); g.bezierCurveTo(120, 300, 170, 120, 270, 110); g.bezierCurveTo(380, 100, 400, 260, 330, 300); g.bezierCurveTo(300, 320, 270, 300, 280, 260); g.bezierCurveTo(290, 220, 250, 230, 240, 250); g.moveTo(220, 200); g.quadraticCurveTo(240, 190, 255, 205); g.moveTo(300, 190); g.quadraticCurveTo(320, 180, 335, 195); g.moveTo(330, 300); g.bezierCurveTo(360, 380, 300, 420, 360, 470); }, '#2a2826', 5);
    g.fillStyle = '#c97f5a'; g.globalAlpha = 0.85; g.beginPath(); g.ellipse(330, 380, 60, 90, 0.3, 0, 7); g.fill(); g.globalAlpha = 1;
  });
  // 2 : dune / paysage minéral, aplats doux
  cell(2, () => {
    const gr = g.createLinearGradient(0, 0, 0, 512); gr.addColorStop(0, '#e9e1d2'); gr.addColorStop(1, '#dccbb0'); g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
    const layer = (y0, amp, c, s) => { g.fillStyle = c; g.beginPath(); g.moveTo(0, 512); for (let x = 0; x <= 512; x += 8) g.lineTo(x, y0 + amp * Math.sin(x / 512 * Math.PI * s + y0)); g.lineTo(512, 512); g.fill(); };
    layer(300, 30, '#cdb08a', 1.3); layer(350, 25, '#b98c63', 1.8); layer(410, 20, '#8f6a4c', 2.2); layer(460, 12, '#5f4a3a', 2.8);
    g.fillStyle = '#f6efe2'; g.beginPath(); g.arc(360, 150, 40, 0, 7); g.fill();
  });
  // 3 : ensō à l'encre sur papier de riz
  cell(3, () => {
    paper('#f1ece1');
    for (let k = 0; k < 60; k++) brush(() => { const a0 = -1.2 + k * 0.001, a1 = 4.6; g.arc(256 + R() * 3, 256 + R() * 3, 150 + R() * 18 - k * 0.2, a0 + R() * 0.2, a1 - R() * 0.4); }, '#1f1e1c', 2 + R() * 3, 0.25);
    g.fillStyle = '#a8432f'; g.fillRect(400, 420, 26, 26);
  });
  // 4 : planche botanique (feuille de ginkgo)
  cell(4, () => {
    paper('#f0ebdf');
    g.fillStyle = '#7c8a5a'; g.beginPath(); g.moveTo(256, 380); g.bezierCurveTo(120, 300, 110, 170, 150, 140); g.quadraticCurveTo(256, 190, 362, 140); g.bezierCurveTo(400, 170, 390, 300, 256, 380); g.fill();
    g.strokeStyle = 'rgba(240,235,215,0.6)'; g.lineWidth = 1.5; for (let i = 0; i < 26; i++) { const a = -2.4 + i * 0.065; g.beginPath(); g.moveTo(256, 378); g.lineTo(256 + Math.cos(a) * 230, 378 + Math.sin(a) * 230); g.stroke(); }
    g.strokeStyle = '#6b5a3c'; g.lineWidth = 4; g.beginPath(); g.moveTo(256, 380); g.quadraticCurveTo(262, 430, 250, 470); g.stroke();
    g.fillStyle = '#3d3a36'; g.font = '16px Georgia, serif'; g.fillText('Ginkgo biloba', 200, 495);
  });
  // 5 : blocs de couleur (sauge, sable, ocre, encre)
  cell(5, () => {
    paper('#efe9de');
    g.fillStyle = '#8e9b7c'; g.fillRect(70, 80, 220, 260); g.fillStyle = '#d6b98c'; g.fillRect(240, 200, 200, 230); g.fillStyle = '#c4754e'; g.beginPath(); g.arc(330, 150, 55, 0, 7); g.fill();
    g.fillStyle = '#2f3540'; g.fillRect(70, 360, 120, 70);
  });
  // 6 : photographie de mer (horizon, grain)
  cell(6, () => {
    const gr = g.createLinearGradient(0, 0, 0, 512); gr.addColorStop(0, '#c9d2d4'); gr.addColorStop(0.55, '#e6e2da'); gr.addColorStop(0.56, '#7f9196'); gr.addColorStop(1, '#5b6b70'); g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
    for (let k = 0; k < 20000; k++) { g.fillStyle = `rgba(255,255,255,${0.06 * R()})`; g.fillRect(R() * 512, 286 + R() * 226, 3 * R(), 1); }
  });
  // 7 : esquisse d'architecture (fusain)
  cell(7, () => {
    paper('#f2eee6');
    for (let k = 0; k < 14; k++) brush(() => { g.moveTo(80 + R() * 4, 420 - k * 2); g.lineTo(440, 420 - k * 2 + R() * 3); }, '#3a3835', 1, 0.15);
    brush(() => { g.moveTo(120, 420); g.lineTo(120, 200); g.lineTo(256, 110); g.lineTo(392, 200); g.lineTo(392, 420); g.moveTo(200, 420); g.lineTo(200, 300); g.lineTo(312, 300); g.lineTo(312, 420); }, '#2e2c2a', 3, 0.85);
  });
  const t = T(cv, 1, 1); t.repeat.set(1, 1); return t;
}

// ================================================================== mobilier
/**
 * P : constructeur d'étage de lots.js ({ fy, H, key, at, push, walkOnly, planOnly, flat, cy, ... }).
 * ctx : { CUT, cutMat: 'cut' } — renvoie la bibliothèque d'objets (coordonnées « meuble »).
 */
export function createDecor(THREE, P, ctx = {}) {
  const fy = P.fy, H = P.H || 2.5, CUT = ctx.CUT || 1.2, R = rng(1000 + P.key * 31);
  const V3 = THREE.Vector3, V2 = THREE.Vector2;
  // couleur sRGB → linéaire, avec légère variation (imperfections)
  const C = (hex, j = 0) => { const c = new THREE.Color(hex); if (j) { const k = 1 + (R() - 0.5) * j; c.r *= k * (1 + (R() - 0.5) * j * 0.3); c.g *= k; c.b *= k * (1 + (R() - 0.5) * j * 0.3); } return [c.r, c.g, c.b]; };
  const WHITE = [1, 1, 1];
  let mirrorN = P.key * 100;                         // un maillage par miroir (repéré userData.mirror par lots.js)
  const put = (mk, g, c = WHITE, keepUV = false) => { g.translate(0, fy, 0); P.push(mk, g, { tint: c, keepUV }); };
  const rot = (g, o) => { if (o.rz) g.rotateZ(o.rz); if (o.rx) g.rotateX(o.rx); if (o.ry) g.rotateY(o.ry); return g; };
  // --- primitives (y depuis le sol fini)
  const box = (mk, x0, x1, y0, y1, z0, z1, c, o = {}) => {
    const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0), d = Math.abs(z1 - z0); if (w < 1e-4 || h < 1e-4 || d < 1e-4) return;
    const g = new THREE.BoxGeometry(w, h, d); rot(g, o); g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); put(mk, g, c);
  };
  // boîte arrondie centrée en (x, y, z)
  const rb = (mk, w, h, d, r, x, y, z, c, o = {}) => {
    const g = roundedBox(THREE, w, h, d, o.seg || 2, Math.max(0.001, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)));
    rot(g, o); g.translate(x, y, z); put(mk, g, c);
  };
  // boîte arrondie posée : x0..x1, y0..y1, z0..z1
  const rbb = (mk, x0, x1, y0, y1, z0, z1, r, c, o = {}) => rb(mk, x1 - x0, y1 - y0, z1 - z0, r, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, c, o);
  const cyl = (mk, r0, r1, h, x, y, z, c, o = {}) => {
    const g = new THREE.CylinderGeometry(r1, r0, h, o.seg || 18, 1, !!o.open); g.translate(0, h / 2, 0); rot(g, o); g.translate(x, y, z); put(mk, g, c);
  };
  const lathe = (mk, pts, x, y, z, c, o = {}) => {
    const g = new THREE.LatheGeometry(pts.map(([r, yy]) => new V2(Math.max(0, r), yy)), o.seg || 28); rot(g, o); g.translate(x, y, z); put(mk, g, c);
  };
  const tube = (mk, pts, r, c, o = {}) => {
    const cv = new THREE.CatmullRomCurve3(pts.map(p => new V3(...p)), !!o.closed, 'centripetal');
    const g = new THREE.TubeGeometry(cv, o.seg || Math.max(8, pts.length * 6), r, o.rad || 6, !!o.closed); put(mk, g, c);
  };
  const torus = (mk, R0, r, x, y, z, c, o = {}) => { const g = new THREE.TorusGeometry(R0, r, o.rad || 6, o.seg || 32); g.rotateX(Math.PI / 2); rot(g, o); g.translate(x, y, z); put(mk, g, c); };
  // superquadrique (coussins, matelas, assises) : demi-axes a, b, c ; e1 vertical, e2 horizontal
  const sq = (mk, a, b, cz, x, y, z, col, o = {}) => {
    const e1 = o.e1 ?? 0.3, e2 = o.e2 ?? 0.25, nu = o.nu || 24, nv = o.nv || 14, pos = [], idx = [];
    const Cf = (w, m) => Math.sign(Math.cos(w)) * Math.pow(Math.abs(Math.cos(w)), m), Sf = (w, m) => Math.sign(Math.sin(w)) * Math.pow(Math.abs(Math.sin(w)), m);
    const pinch = o.pinch ?? 0, sag = o.sag ?? 0, puff = o.puff ?? 0, wob = o.wob ?? 0, seed = R() * 10, squash = o.squash ?? 0, dimple = o.dimple ?? 0, crease = o.crease ?? 0;
    // plis (froissés) : quelques sillons doux partant des bords
    const CR = crease ? Array.from({ length: 4 }, () => { const a0 = R() * 6.28; return { px: Math.cos(a0) * 0.85, pz: Math.sin(a0) * 0.85, dx: -Math.cos(a0 + jit(0.9)), dz: -Math.sin(a0 + jit(0.9)), L: 0.35 + R() * 0.4, w: 0.05 + R() * 0.05 }; }) : null;
    for (let j = 0; j <= nv; j++) {
      const ph = -Math.PI / 2 + Math.PI * j / nv;
      for (let i = 0; i <= nu; i++) {
        const th = -Math.PI + 2 * Math.PI * i / nu;
        let px = a * Cf(ph, e1) * Cf(th, e2), py = b * Sf(ph, e1), pz = cz * Cf(ph, e1) * Sf(th, e2);
        const nx = px / a, nz = pz / cz, m = Math.min(1, Math.max(Math.abs(nx), Math.abs(nz)));
        py *= 1 - pinch * Math.pow(m, 5) + puff * (1 - m * m);
        if (py > 0) py -= sag * b * (1 - nx * nx) * (1 - nz * nz);
        if (py < 0) py *= 1 - squash;
        if (py > 0 && dimple) py -= dimple * b * Math.exp(-(nx * nx + nz * nz) / 0.08);
        if (CR) { let cr = 0; for (const c of CR) { const qx = nx - c.px, qz = nz - c.pz, t = qx * c.dx + qz * c.dz; if (t < 0 || t > c.L) continue; const dd = Math.abs(qx * c.dz - qz * c.dx); cr += Math.exp(-Math.pow(dd / c.w, 2)) * (1 - t / c.L); } py -= Math.sign(py) * crease * b * cr; }
        if (wob) { const w = wob * (Math.sin(px * 23 + seed) * Math.cos(pz * 19 + seed) + 0.5 * Math.sin(py * 31 + seed)); px += w * nx; pz += w * nz; py += w * 0.5; }
        pos.push(px, py, pz);
      }
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a0 = j * (nu + 1) + i, b0 = a0 + nu + 1; idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    g.computeVertexNormals(); rot(g, o); g.translate(x, y, z); put(mk, g, col);
  };
  // nappe paramétrique (drapés) : f(u, v) → [x, y, z], u, v ∈ [0, 1]
  const sheet = (mk, nu, nv, f, col, keepUV = false) => {
    const pos = [], uv = [], idx = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const p = f(i / nu, j / nv); pos.push(p[0], p[1], p[2]); uv.push(i / nu, j / nv); }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a0 = j * (nu + 1) + i, b0 = a0 + nu + 1; idx.push(a0, a0 + 1, b0, a0 + 1, b0 + 1, b0); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    g.computeVertexNormals(); put(mk, g, col, keepUV);
  };
  // plaque extrudée à coins arrondis (plateaux), posée en y0, épaisseur t
  const slab = (mk, w, d, t, r, x, y0, z, col, o = {}) => {
    const s = new THREE.Shape(), hw = w / 2, hd = d / 2, rr = Math.min(r, hw, hd);
    s.moveTo(-hw + rr, -hd); s.lineTo(hw - rr, -hd); s.quadraticCurveTo(hw, -hd, hw, -hd + rr); s.lineTo(hw, hd - rr); s.quadraticCurveTo(hw, hd, hw - rr, hd);
    s.lineTo(-hw + rr, hd); s.quadraticCurveTo(-hw, hd, -hw, hd - rr); s.lineTo(-hw, -hd + rr); s.quadraticCurveTo(-hw, -hd, -hw + rr, -hd);
    const bv = Math.min(o.bevel ?? 0.006, t / 2.5);
    const g = new THREE.ExtrudeGeometry(s, { depth: t - 2 * bv, bevelEnabled: true, bevelThickness: bv, bevelSize: bv, bevelSegments: 2, curveSegments: o.curve || 8 });
    g.rotateX(-Math.PI / 2); g.translate(0, bv, 0); if (o.ry) g.rotateY(o.ry); g.translate(x, y0, z); put(mk, g, col);
  };
  const disc = (mk, r, x, y, z, col, seg = 32) => { const g = new THREE.CircleGeometry(r, seg); g.rotateX(-Math.PI / 2); g.translate(x, y, z); put(mk, g, col); };
  // ombre de contact sous un objet (décalque) : centre, demi-largeurs
  const contact = (x, z, w, d, y = 0.007, ry = 0) => { const g = new THREE.PlaneGeometry(w, d); g.rotateX(-Math.PI / 2); if (ry) g.rotateY(ry); g.translate(x, y, z); put('contact', g, WHITE, true); };
  // version « plan » d'un volume haut : boîte coupée à 1,2 m + tranche sombre
  const tallPlan = (mk, x0, x1, z0, z1, c) => P.planOnly(() => { box(mk, x0, x1, 0, CUT - 0.01, z0, z1, c); const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0); g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, CUT + 0.003, (z0 + z1) / 2); put('cut', g); });
  const walk = (fn) => P.walkOnly(fn);
  let kitchenTap = null, fxCushion = null, barHandleFn = null, puffBoxFn = null;   // furniture.js
  const at = (x, z, ry, fn, y) => P.at(x, z, ry, fn, y);
  const pick = (a) => a[Math.floor(R() * a.length) % a.length];
  const jit = (s) => (R() - 0.5) * s;

  // ------------------------------------------------------------ palettes
  const PAL = {
    linenSand: 0xd8ccb8, linenGreige: 0xc9c0b3, linenWhite: 0xf3efe8, linenOat: 0xe4dac8, linenStone: 0xb9b2a6,
    terracotta: 0xb8684a, rust: 0x9c5236, ochre: 0xc89a4b, sage: 0x99a68a, olive: 0x7d7f5a, ink: 0x2f3a48, clay: 0xc79a80, charcoal: 0x4a4744, mustard: 0xb98f3e,
    straw: 0xcdb487, cognac: 0x9a6038, boucle: 0xf2ede4, walnut: 0x6c4a32,
  };

  // ------------------------------------------------------------ livres et petits objets
  const BOOKC = [0xa8432f, 0x2f3a48, 0xd9cdb5, 0x7d8a6c, 0xc89a4b, 0x3d3a36, 0xe8e2d6, 0x9c5236, 0x5f6b72, 0xb8a58a];
  // livre posé à plat (x, y0, z), dimensions w × d × t, rotation ry
  function book(x, y0, z, w, d, t, ry = 0, c = pick(BOOKC)) {
    const cc = C(c, 0.1), ct = 0.0025, g = (mk, x0, x1, y0b, y1, z0, z1, col) => box(mk, x0, x1, y0b, y1, z0, z1, col, { ry });
    const S = Math.sin(ry), Co = Math.cos(ry), tr = (lx, lz) => [x + lx * Co + lz * S, z - lx * S + lz * Co];
    // couvertures et dos, puis bloc de pages en retrait
    const part = (mk, lx0, lx1, ly0, ly1, lz0, lz1, col) => { const [cx, cz] = tr((lx0 + lx1) / 2, (lz0 + lz1) / 2); const gg = new THREE.BoxGeometry(lx1 - lx0, ly1 - ly0, lz1 - lz0); gg.rotateY(ry); gg.translate(cx, y0 + (ly0 + ly1) / 2, cz); put(mk, gg, col); };
    part('lacquer', -w / 2, w / 2, 0, ct, -d / 2, d / 2, cc); part('lacquer', -w / 2, w / 2, t - ct, t, -d / 2, d / 2, cc); part('lacquer', -w / 2, -w / 2 + ct, ct, t - ct, -d / 2, d / 2, cc);
    part('paper', -w / 2 + ct, w / 2 - 0.003, ct, t - ct, -d / 2 + 0.003, d / 2 - 0.003, C(0xf1ebde, 0.06));
    return t;
  }
  function bookStack(x, y0, z, n, ry = 0, big = false) { let y = y0; for (let i = 0; i < n; i++) { const w = big ? 0.26 + R() * 0.08 : 0.15 + R() * 0.05, d = big ? 0.2 + R() * 0.06 : 0.21 + R() * 0.03, t = big ? 0.025 + R() * 0.02 : 0.018 + R() * 0.02; y += book(x + jit(0.02), y, z + jit(0.02), w, d, t, ry + jit(0.25)); } return y; }
  // rangée de livres debout (le long de x local), hauteur ~ 0.2–0.3
  function bookRow(x0, x1, y0, z, ry = 0, lean = true) {
    let x = x0; const S = Math.sin(ry), Co = Math.cos(ry);
    while (x < x1 - 0.03) {
      const t = 0.018 + R() * 0.03, h = 0.18 + R() * 0.11, d = 0.14 + R() * 0.06, cc = C(pick(BOOKC), 0.12);
      if (x + t > x1) break;
      const lx = x + t / 2, wx = z + 0;
      const gg = new THREE.BoxGeometry(t, h, d); gg.translate(0, h / 2, 0); gg.rotateY(ry); gg.translate(lx * Co + wx * S, y0, -lx * S + wx * Co); put('lacquer', gg, cc);
      x += t + 0.001;
      if (lean && R() < 0.04) x += 0.04;
    }
  }
  function vase(x, y0, z, kind = 0, c = 0xe9e2d6, mk = 'stoneware') {
    const prof = [
      [[0, 0], [0.06, 0], [0.085, 0.05], [0.09, 0.12], [0.07, 0.2], [0.035, 0.26], [0.03, 0.3], [0.04, 0.31], [0.0, 0.31]],          // amphore
      [[0, 0], [0.07, 0], [0.11, 0.06], [0.11, 0.1], [0.06, 0.16], [0.05, 0.17], [0, 0.17]],                                          // boule basse
      [[0, 0], [0.04, 0], [0.05, 0.1], [0.045, 0.26], [0.05, 0.38], [0.0, 0.38]],                                                  // soliflore haut
      [[0, 0], [0.1, 0], [0.16, 0.05], [0.17, 0.07], [0, 0.07]],                                                                   // coupe
    ][kind];
    lathe(mk, prof, x, y0, z, C(c, 0.05), { seg: 26 });
    return prof[prof.length - 1][1];
  }
  // branchages secs dans un vase (tiges fines + petits rameaux)
  function bowl(x, y0, z, r = 0.12, c = 0xe8e0d2, mk = 'stoneware') { lathe(mk, [[0, 0], [r * 0.45, 0], [r * 0.85, r * 0.25], [r, r * 0.5], [r * 0.96, r * 0.52], [r * 0.8, r * 0.28], [0, r * 0.1]], x, y0, z, C(c, 0.06), { seg: 30 }); }
  function candle(x, y0, z, h = 0.12) { cyl('lacquer', 0.035, 0.035, h, x, y0, z, C(0xf2ece0)); cyl('black', 0.002, 0.002, 0.01, x, y0 + h, z, WHITE, { seg: 4 }); }
  function tray(x, y0, z, w, d, ry = 0, mk = 'oak', c = WHITE) { slab(mk, w, d, 0.012, 0.05, x, y0, z, c, { ry, bevel: 0.003 }); const t = 0.012; slab(mk, w, d, 0.006, 0.05, x, y0 + 0.012, z, c, { ry }); return y0 + t; }
  function fruitBowl(x, y0, z) { bowl(x, y0, z, 0.16, 0xd8cfc0, 'stoneware'); for (let i = 0; i < 5; i++) { const a = i * 1.3 + R(), r = 0.06 * (i ? 1 : 0); sq('ceramic', 0.035, 0.034, 0.035, x + Math.cos(a) * r, y0 + 0.07 + (i ? 0 : 0.02), z + Math.sin(a) * r, C(pick([0xd8a03a, 0xb3402a, 0xc7c25a]), 0.15), { e1: 1, e2: 1, nu: 10, nv: 6 }); } }

  // ------------------------------------------------------------ végétal modélisé (passe 2)
  // Feuille = bande maillée le long de la nervure (largeur selon x, longueur selon +z, face vers +y),
  // pli en V, courbure, ondulation du limbe, torsion ; UV propres dans l'atlas opaque de nervures.
  // Matériaux : 'leafG' (cuir brillant : figuier, strelitzia, basilic), 'leafM' (mat : olivier, sansevieria, séchés).
  const LEAF = {
    fig: { reg: [0, 0, 0.5, 0.5], nu: 7, nv: 10, w: (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.82)), 0.55) * (1 - 0.16 * Math.exp(-Math.pow((t - 0.42) / 0.12, 2))) * (0.72 + 0.4 * t) * Math.sqrt(Math.max(0, 1 - Math.pow(t, 10))) },
    strelitzia: { reg: [0.5, 0, 1, 0.5], nu: 7, nv: 12, w: (t) => Math.pow(Math.sin(Math.PI * t), 0.45) * (0.85 + 0.15 * Math.sin(t * 3)) },
    olive: { reg: [0, 0.5, 0.25, 1], nu: 3, nv: 3, w: (t) => Math.pow(Math.sin(Math.PI * t), 0.85) * (1 - 0.25 * t) },
    basil: { reg: [0.25, 0.5, 0.5, 1], nu: 5, nv: 5, w: (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.7)), 0.8) },
    snake: { reg: [0.5, 0.5, 0.75, 1], nu: 5, nv: 10, w: (t) => Math.pow(Math.max(0, 1 - Math.pow(t, 1.6)), 0.75) * (0.92 + 0.08 * Math.sin(t * 7)) },
    dried: { reg: [0.75, 0.5, 1, 1], nu: 3, nv: 4, w: (t) => Math.pow(Math.sin(Math.PI * t), 0.55) },
  };
  // p : base de la feuille ; dir : direction [az, élévation] ; o : { L, W, fold, droop, curl, wave, twist, roll }
  function leaf(mk, kind, p, az, el, o, col) {
    const S = LEAF[kind], [u0, v0, u1, v1] = S.reg, nu = S.nu, nv = o.nv || S.nv, L = o.L, Wd = o.W, pos = [], uv = [], idx = [];
    const fold = o.fold ?? 0.25, droop = o.droop ?? 0.2, curl = o.curl ?? 0.1, wave = o.wave ?? 0, twist = o.twist ?? 0, ph = R() * 6;
    for (let j = 0; j <= nv; j++) {
      const t = j / nv, hw = Wd / 2 * S.w(t), dz = droop * L, ang = twist * t;
      for (let i = 0; i < nu; i++) {
        const a = (i / (nu - 1)) * 2 - 1, aa = Math.abs(a);
        let x = a * hw, y = (fold * aa + curl * aa * aa * aa) * hw + wave * hw * aa * Math.sin(t * 13 + ph + a), z = t * L;
        y -= dz * t * t; z -= 0.35 * dz * t * t * t;                          // retombée de la pointe
        const cx = Math.cos(ang), sx = Math.sin(ang); [x, y] = [x * cx - y * sx, x * sx + y * cx];
        pos.push(x, y, z); uv.push(u0 + (u1 - u0) * (a * 0.5 + 0.5), v0 + (v1 - v0) * t);
      }
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu - 1; i++) { const a0 = j * nu + i, b0 = a0 + nu; idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    g.computeVertexNormals();
    g.rotateZ(o.roll || 0); g.rotateX(-el); g.rotateY(az); g.translate(p[0], p[1], p[2]);
    put(mk, g, col, true);
  }
  const dirOf = (d) => { const L = Math.hypot(d[0], d[1], d[2]) || 1; return [Math.atan2(d[0], d[2]), Math.asin(d[1] / L)]; };
  const add3 = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
  const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const curvePts = (pts, n) => { const c = new THREE.CatmullRomCurve3(pts.map(q => new V3(...q)), false, 'centripetal'); return c.getSpacedPoints(n).map(v => [v.x, v.y, v.z]); };
  // tige effilée (rayon r0 → r1) le long d'une polyligne : tube à rayon variable
  function stem(mk, pts, r0, r1, col, rad = 5, seg = null) {
    const c = new THREE.CatmullRomCurve3(pts.map(q => new V3(...q)), false, 'centripetal'), n = seg || Math.max(4, pts.length * 4);
    const g = new THREE.TubeGeometry(c, n, 1, rad, false), p = g.attributes.position;
    const fr = c.computeFrenetFrames(n, false);
    for (let i = 0; i <= n; i++) { const P0 = c.getPointAt(i / n), r = r0 + (r1 - r0) * (i / n); for (let k = 0; k <= rad; k++) { const id = i * (rad + 1) + k, v = new V3(p.getX(id), p.getY(id), p.getZ(id)).sub(P0); p.setXYZ(id, P0.x + v.x * r, P0.y + v.y * r, P0.z + v.z * r); } }
    g.computeVertexNormals(); put(mk, g, col);
  }
  function pot(x, z, r, h, c, kind = 0) {
    const pr = kind === 0 ? [[0, 0], [r * 0.74, 0], [r * 0.8, 0.012], [r * 0.95, h * 0.5], [r, h * 0.96], [r * 1.02, h], [r * 0.95, h], [r * 0.92, h * 0.95], [r * 0.9, h * 0.86], [0, h * 0.86]]
      : [[0, 0], [r * 0.66, 0], [r * 0.72, 0.012], [r * 0.98, h * 0.35], [r * 0.93, h * 0.86], [r * 0.88, h], [r * 0.82, h], [r * 0.8, h * 0.95], [r * 0.8, h * 0.88], [0, h * 0.88]];
    lathe('stoneware', pr, x, 0, z, C(c, 0.05), { seg: 36 });
    // terreau légèrement bombé, grains et quelques cailloux
    const sr = (kind === 0 ? 0.9 : 0.8) * r, sy = h * (kind === 0 ? 0.86 : 0.88);
    lathe('soil', [[sr, 0], [sr * 0.7, 0.008], [sr * 0.35, 0.014], [0, 0.016]], x, sy, z, C(0x5e4a3a, 0.1), { seg: 24 });
    for (let i = 0; i < 7; i++) { const a = R() * 6.28, rr = sr * (0.3 + 0.6 * R()); sq('stoneware', 0.008 + R() * 0.006, 0.005, 0.007 + R() * 0.005, x + Math.cos(a) * rr, sy + 0.01, z + Math.sin(a) * rr, C(pick([0xb9b0a2, 0x8c8274, 0xd8d0c2])), { e1: 0.8, e2: 0.8, nu: 6, nv: 4, ry: R() * 3 }); }
    contact(x, z, r * 3, r * 3, 0.008);
    return sy + 0.012;
  }
  // figuier lyre : tronc élancé + 2 ramifications, grandes feuilles coriaces en spirale (pétiole court)
  function figTree(x, z, h = 1.7, potC = 0xe7dfd1) {
    const y0 = pot(x, z, 0.2, 0.42, potC, 1);
    walk(() => {
      const trunk = curvePts([[x, y0 - 0.02, z], [x + 0.02, 0.8, z - 0.01], [x - 0.02, h * 0.68, z + 0.02], [x + 0.01, h * 0.97, z]], 14);
      stem('bark', trunk, 0.02, 0.008, C(0x7a6b58), 6);
      const br = [trunk];
      for (const [k, a] of [[7, 0.6], [9, 3.4]]) { const b0 = trunk[k], e = [b0[0] + Math.sin(a) * 0.28, b0[1] + 0.42, b0[2] + Math.cos(a) * 0.28]; const pts = curvePts([b0, lerp3(b0, e, 0.5).map((v, i) => v + (i === 1 ? 0.05 : 0)), e], 8); stem('bark', pts, 0.011, 0.005, C(0x7a6b58), 5); br.push(pts); }
      let n = 0;
      for (const pts of br) for (let i = Math.floor(pts.length * (pts === trunk ? 0.35 : 0.15)); i < pts.length; i++, n++) {
        const q = pts[i], t = i / (pts.length - 1), az = n * 2.39996 + jit(0.4), size = (0.27 + 0.13 * (1 - t) + R() * 0.06) * (pts === trunk ? 1 : 0.9);
        const pet = [q[0] + Math.sin(az) * 0.05, q[1] + 0.02, q[2] + Math.cos(az) * 0.05];
        stem('leafG', [q, pet], 0.004, 0.003, C(0x6f7f3e), 3, 2);
        leaf('leafG', 'fig', pet, az, 0.35 + 0.65 * t * R() + 0.15, { L: size, W: size * 0.62, fold: 0.12, droop: 0.12 + 0.12 * (1 - t), curl: -0.18, wave: 0.06, twist: jit(0.3), roll: jit(0.25) }, C(pick([0xffffff, 0xeaf0dc, 0xdfe8cc]), 0.12));
      }
    });
  }
  // olivier : deux troncs tressés, charpentières, rameaux fins portant des paires de feuilles lancéolées gris-vert
  function oliveTree(x, z, h = 1.8, potC = 0xcfc6b8) {
    const y0 = pot(x, z, 0.27, 0.48, potC, 0);
    walk(() => {
      const barkC = C(0x8f8372, 0.06), yTop = h * 0.6;
      for (const s of [0, Math.PI]) { const pts = []; for (let i = 0; i <= 12; i++) { const t = i / 12, a = s + t * Math.PI * 2.6, r = 0.022 * (1 - 0.3 * t); pts.push([x + Math.cos(a) * r + 0.03 * t, y0 - 0.02 + (yTop - y0) * t, z + Math.sin(a) * r - 0.02 * t]); } stem('bark', pts, 0.024, 0.016, barkC, 6, 36); }
      const top = [x + 0.03, yTop, z - 0.02];
      // ramure : 7 charpentières, rameaux et sous-rameaux ; houppier en boule irrégulière (~1 500 feuilles)
      const twig = (q, ta, tl, tu, pairs) => {
        const te = [q[0] + Math.cos(ta) * tl, q[1] + tu, q[2] + Math.sin(ta) * tl];
        const tw = curvePts([q, lerp3(q, te, 0.5).map((v, i) => v + (i === 1 ? 0.02 : 0)), te], pairs);
        stem('bark', tw, 0.0035, 0.0012, C(0x8a8a6a), 3, pairs);
        for (let m = 1; m <= pairs; m++) {
          const p0 = tw[m], d = [tw[m][0] - tw[m - 1][0], tw[m][1] - tw[m - 1][1], tw[m][2] - tw[m - 1][2]], [daz, del] = dirOf(d);
          for (const sd of [-1, 1]) leaf('leafM', 'olive', p0, daz + sd * (0.5 + R() * 0.45), del + 0.1 + jit(0.5), { L: 0.07 + R() * 0.025, W: 0.014 + R() * 0.005, fold: 0.35, droop: 0.18, curl: 0.15, twist: jit(0.6), roll: sd * 0.5 + jit(0.4) }, C(pick([0xffffff, 0xf0f2e6, 0xe2e8d6, 0xd6dccb, 0xc9d1bd]), 0.08));
        }
        leaf('leafM', 'olive', te, ...dirOf([te[0] - tw[pairs - 1][0], te[1] - tw[pairs - 1][1], te[2] - tw[pairs - 1][2]]), { L: 0.06, W: 0.012, fold: 0.3, droop: 0.1 }, C(0xf4f6ee));
        return tw;
      };
      for (let b = 0; b < 7; b++) {
        const a = b * 0.898 + jit(0.35), up = 0.22 + R() * 0.38, len = 0.3 + R() * 0.2;
        const e = [top[0] + Math.cos(a) * len, yTop + up, top[2] + Math.sin(a) * len];
        const bp = curvePts([top, [top[0] + Math.cos(a) * len * 0.45, yTop + up * 0.35 + 0.05, top[2] + Math.sin(a) * len * 0.45], e], 10);
        stem('bark', bp, 0.013, 0.005, barkC, 5);
        for (let k = 2; k <= 10; k++) {
          const tw = twig(bp[k], a + jit(2.2), 0.12 + R() * 0.12, -0.03 + R() * 0.14, 6);
          if (R() < 0.55) twig(tw[3], a + jit(2.5), 0.08 + R() * 0.07, R() * 0.08, 5);
        }
      }
    });
  }
  // oiseau de paradis (Strelitzia nicolai) : longs pétioles en éventail, grandes feuilles en pagaie, pli central marqué
  function strelitzia(x, z, h = 1.7, potC = 0xb8684a) {
    const y0 = pot(x, z, 0.22, 0.44, potC, 1);
    walk(() => {
      const n = 11;
      for (let i = 0; i < n; i++) {
        const az = i * 2.39996 + jit(0.3), lean = 0.1 + R() * 0.25, sh = h * (0.62 + 0.3 * R()) - y0 - 0.4;
        const base = [x + Math.sin(az) * 0.03, y0 - 0.01, z + Math.cos(az) * 0.03], tip = [base[0] + Math.sin(az) * sh * lean, y0 + sh, base[2] + Math.cos(az) * sh * lean];
        const pts = curvePts([base, lerp3(base, tip, 0.5), tip], 8);
        stem('leafG', pts, 0.011, 0.007, C(0x9aa56c), 5);
        const L = 0.42 + R() * 0.16, [daz, del] = dirOf([tip[0] - pts[6][0], tip[1] - pts[6][1], tip[2] - pts[6][2]]);
        leaf('leafG', 'strelitzia', tip, daz, Math.min(1.45, del + jit(0.25)), { L, W: L * 0.36, fold: 0.42, droop: 0.22, curl: -0.05, wave: 0.04, twist: jit(0.6), roll: Math.PI / 2 + jit(0.8) }, C(pick([0xffffff, 0xeef2e2, 0xdde6cc]), 0.1));
      }
    });
  }
  // sansevieria : lames épaisses dressées, légère torsion
  function snakePlant(x, z, h = 0.75, potC = 0xb8684a) {
    const y0 = pot(x, z, 0.14, 0.3, potC, 1);
    walk(() => { for (let i = 0; i < 12; i++) { const a = i * 2.39996, rr = 0.015 + R() * 0.07; leaf('leafM', 'snake', [x + Math.cos(a) * rr, y0 - 0.01, z + Math.sin(a) * rr], a, 1.3 + R() * 0.22, { L: h * (0.5 + 0.55 * R()), W: 0.055 + R() * 0.03, fold: 0.3, droop: 0.04, curl: 0.15, twist: jit(0.9), roll: R() * 3 }, C(0xffffff, 0.15)); } });
  }
  // basilic en pot de terre cuite (plan de travail)
  function herbs(x, y, z, potC = 0xb8684a) {
    lathe('stoneware', [[0, 0], [0.045, 0], [0.06, 0.09], [0.066, 0.1], [0.066, 0.11], [0.058, 0.11], [0.055, 0.1], [0, 0.1]], x, y, z, C(potC, 0.06), { seg: 24 });
    disc('soil', 0.054, x, y + 0.098, z, C(0x4e3c30), 16);
    walk(() => {
      for (let s = 0; s < 5; s++) {
        const a = s * 1.3 + jit(0.4), r = 0.015 + R() * 0.02, top = [x + Math.cos(a) * (r + 0.03), y + 0.2 + R() * 0.08, z + Math.sin(a) * (r + 0.03)];
        const pts = curvePts([[x + Math.cos(a) * r, y + 0.095, z + Math.sin(a) * r], top], 5);
        stem('leafG', pts, 0.0028, 0.0018, C(0x7f9a45), 3, 5);
        for (let k = 1; k <= 5; k++) { const q = pts[k], sz = 0.03 + 0.025 * (1 - k / 6); for (const sd of [-1, 1]) leaf('leafG', 'basil', q, a + sd * 1.4 + k * 0.7, 0.3 + jit(0.4), { L: sz, W: sz * 0.7, fold: 0.3, droop: 0.25, curl: -0.3 }, C(pick([0xffffff, 0xf2ffe0]), 0.1)); }
      }
    });
  }
  // branchages secs dans un vase : tiges ramifiées, petites feuilles rondes séchées (eucalyptus / olivier)
  function branches(x, y0, z, h = 0.6, n = 5) {
    walk(() => {
      for (let i = 0; i < n; i++) {
        const a = R() * 6.28, s = 0.1 + R() * 0.2, top = [x + Math.cos(a) * s, y0 + h * (0.75 + R() * 0.3), z + Math.sin(a) * s];
        const pts = curvePts([[x, y0 - 0.03, z], [x + Math.cos(a) * s * 0.25, y0 + h * 0.4, z + Math.sin(a) * s * 0.25], top], 10);
        stem('bark', pts, 0.0035, 0.0015, C(0x7a6a55), 3, 10);
        const dc = pick([0xe8e0c4, 0xd9ccb0, 0xc9cfbf]);
        for (let k = 4; k <= 10; k++) { const q = pts[k], [daz, del] = dirOf([q[0] - pts[k - 1][0], q[1] - pts[k - 1][1], q[2] - pts[k - 1][2]]); for (const sd of [-1, 1]) leaf('leafM', 'dried', q, daz + sd * 1.2, del - 0.2 + jit(0.4), { L: 0.03 + R() * 0.012, W: 0.024, fold: 0.15, droop: 0.2, curl: 0.2, twist: jit(0.6), roll: sd * 0.6 }, C(dc, 0.1)); }
      }
    });
  }
  // compatibilité : anciennes cartes (non utilisées)
  function leafCard(p, s, az, tilt, reg, col) { leaf('leafM', 'olive', p, az, Math.PI / 2 - tilt, { L: s * 0.5, W: s * 0.12 }, col); }

  // ------------------------------------------------------------ luminaires
  function tableLamp(x, y0, z, kind = 0, baseC = 0xd9cfbf) {
    if (kind === 0) lathe('stoneware', [[0, 0], [0.07, 0], [0.11, 0.08], [0.1, 0.17], [0.05, 0.24], [0.02, 0.27], [0, 0.27]], x, y0, z, C(baseC, 0.05), { seg: 28 });
    else { cyl('brass', 0.07, 0.07, 0.012, x, y0, z, WHITE, { seg: 24 }); cyl('brass', 0.006, 0.006, 0.26, x, y0, z, WHITE, { seg: 8 }); }
    const yb = y0 + 0.25;
    lathe('shade', [[0.17, 0], [0.13, 0.22]], x, yb, z, C(0xf4ecdf), { seg: 40 });
    torus('shade', 0.17, 0.004, x, yb, z, C(0xf4ecdf), { seg: 48, rad: 5 }); torus('shade', 0.13, 0.004, x, yb + 0.22, z, C(0xf4ecdf), { seg: 48, rad: 5 });   // ourlets roulés
    sq('bulb', 0.025, 0.03, 0.025, x, yb + 0.06, z, WHITE, { e1: 1, e2: 1, nu: 8, nv: 6 });
  }
  function floorLamp(x, z, H0 = 1.55) {
    walk(() => {
      for (let i = 0; i < 3; i++) { const a = i * 2.094 + 0.3; tube('black', [[x + Math.cos(a) * 0.26, 0, z + Math.sin(a) * 0.26], [x + Math.cos(a) * 0.02, H0 - 0.3, z + Math.sin(a) * 0.02]], 0.008, WHITE, { seg: 4, rad: 5 }); }
      cyl('black', 0.008, 0.008, 0.3, x, H0 - 0.32, z, WHITE, { seg: 6 });
      lathe('shade', [[0.23, 0], [0.22, 0.3]], x, H0 - 0.12, z, C(0xf0e6d6), { seg: 48 });
      torus('shade', 0.23, 0.004, x, H0 - 0.12, z, C(0xf0e6d6), { seg: 56, rad: 5 }); torus('shade', 0.22, 0.004, x, H0 + 0.18, z, C(0xf0e6d6), { seg: 56, rad: 5 });
      lathe('black', [[0, 0], [0.025, 0], [0.012, 0.03], [0, 0.03]], x, H0 - 0.33, z, WHITE, { seg: 16 });
      sq('bulb', 0.03, 0.035, 0.03, x, H0, z, WHITE, { e1: 1, e2: 1, nu: 8, nv: 6 });
      contact(x, z, 0.7, 0.7);
    });
    P.planOnly(() => disc('black', 0.24, x, 0.02, z));
  }
  // suspension papier type « Akari » (au-dessus de la table) : bas de l'abat-jour à yb
  function akari(x, z, yb = 1.55, r = 0.3, h = 0.42) {
    if (P.markPendant) P.markPendant(x, z, r);
    walk(() => {
      const pts = []; for (let i = 0; i <= 14; i++) { const t = i / 14; pts.push([r * Math.sin(Math.PI * (0.08 + 0.84 * t)), h * t]); }
      lathe('shade', pts, x, yb, z, C(0xf6efe2), { seg: 40 });
      cyl('black', 0.002, 0.002, H - yb - h, x, yb + h, z, WHITE, { seg: 4 });
      cyl('lacquer', 0.04, 0.04, 0.012, x, H - 0.012, z, C(0xf2f0ea), { seg: 20 });
      sq('bulb', 0.04, 0.05, 0.04, x, yb + h * 0.45, z, WHITE, { e1: 1, e2: 1, nu: 10, nv: 6 });
    });
  }
  // petite suspension dôme (îlot) en métal noir, intérieur laiton
  function dome(x, z, yb = 1.7, r = 0.13, shell = 'black') {
    if (P.markPendant) P.markPendant(x, z, r);
    walk(() => {
      lathe(shell, [[r, 0], [r * 0.98, 0.04], [r * 0.85, 0.11], [r * 0.5, 0.16], [0.02, 0.18], [0, 0.18]], x, yb, z, WHITE, { seg: 32 });
      lathe('brass', [[r * 0.97, 0.002], [r * 0.82, 0.1], [r * 0.4, 0.15], [0, 0.16]], x, yb, z, WHITE, { seg: 32 });
      sq('bulb', 0.035, 0.03, 0.035, x, yb + 0.06, z, WHITE, { e1: 1, e2: 1, nu: 8, nv: 6 });
      cyl('black', 0.002, 0.002, H - yb - 0.18, x, yb + 0.18, z, WHITE, { seg: 4 });
      cyl('black', 0.035, 0.035, 0.012, x, H - 0.012, z, WHITE, { seg: 16 });
    });
  }

  // ------------------------------------------------------------ textiles (passe 2)
  // coussin : superquadrique pincée à la couture, ventre bombé, léger tassement côté appui, passepoil de couture
  function pillow(x, y, z, s, t, col, o = {}) {
    const a = s / 2, b = t / 2, ro = { rx: o.rx || 0, ry: o.ry || 0, rz: o.rz || 0 };
    sq(o.mk || 'textile', a, b, a, x, y, z, col, { e1: 0.42, e2: o.e2 ?? 0.2, pinch: 0.82, puff: o.puff ?? 0.22, squash: 0.18, dimple: 0.12, crease: o.crease ?? 0.05, nu: 22, nv: 12, wob: o.wob ?? 0.003, ...ro });
    seamLoop(o.mk || 'textile', a * 0.985, a * 0.985, 0.0035, x, y, z, col.map(v => v * 0.9), ro, 0.2, 40);
  }
  // couture / passepoil en superellipse dans le plan local y = 0, avec les mêmes rotations que l'objet
  function seamLoop(mk, a, c, r, x, y, z, col, o = {}, e = 0.2, n = 64) {
    const pts = []; for (let k = 0; k < n; k++) { const th = -Math.PI + 2 * Math.PI * k / n, cc = Math.cos(th), ss = Math.sin(th); pts.push(new V3(a * Math.sign(cc) * Math.pow(Math.abs(cc), e), 0, c * Math.sign(ss) * Math.pow(Math.abs(ss), e))); }
    const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true, 'centripetal'), n, r, 3, true); rot(g, o); g.translate(x, y, z); put(mk, g, col);
  }
  // tombé d'un textile au-delà d'un bord arrondi (rayon rr) : distance horizontale dd depuis le bord → [débord, chute]
  const fallOf = (dd, rr) => (dd <= 0 ? [0, 0] : dd < rr * Math.PI / 2 ? [rr * Math.sin(dd / rr), -rr + rr * Math.cos(dd / rr)] : [rr, -rr - (dd - rr * Math.PI / 2)]);
  // nappe épaisse : surface f(u, v) + envers décalé de e + ourlets roulés sur les bords libres (u = 0, u = 1, v = 1)
  function thickSheet(mk, nu, nv, f, col, e = 0.012, hems = 'u0 u1 v1') {
    sheet(mk, nu, nv, f, col);
    sheet(mk, nu, nv, (u, v) => { const p = f(u, v), q = f(Math.min(1, u + 1e-3), v), r = f(u, Math.min(1, v + 1e-3)); const ax = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], bx = [r[0] - p[0], r[1] - p[1], r[2] - p[2]]; let n = [ax[1] * bx[2] - ax[2] * bx[1], ax[2] * bx[0] - ax[0] * bx[2], ax[0] * bx[1] - ax[1] * bx[0]]; const L = Math.hypot(...n) || 1; return [p[0] - n[0] / L * e, p[1] - n[1] / L * e, p[2] - n[2] / L * e]; }, col.map(v => v * 0.92));
    const edge = (fn, m) => { const pts = []; for (let k = 0; k <= m; k++) pts.push(new V3(...fn(k / m))); const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'centripetal'), m * 2, e * 0.62, 5, false); put(mk, g, col.map(v => v * 0.95)); };
    const off = (p, u, v) => p;
    if (hems.includes('u0')) edge((t) => off(f(0, t)), nv);
    if (hems.includes('u1')) edge((t) => off(f(1, t)), nv);
    if (hems.includes('v1')) edge((t) => off(f(t, 1)), nu);
    if (hems.includes('v0')) edge((t) => off(f(t, 0)), nu);
  }
  // tapis : plateau souple + franges aux extrémités (selon x local)
  function fringe(w, d, mk = 'rug') {
    for (const s of [-1, 1]) for (let z = -d / 2 + 0.015; z < d / 2 - 0.01; z += 0.024) {
      const L = 0.05 + R() * 0.025, a = jit(0.35), g = new THREE.BoxGeometry(L, 0.003, 0.006);
      g.translate(L / 2, 0.0035, 0); g.rotateY(a); if (s < 0) g.rotateY(Math.PI); g.translate(s * w / 2, 0, z); put(mk, g, C(0xf2ebdd, 0.08));
    }
  }
  function rugF(w, d, mk = 'rug', col = WHITE, withFringe = true) { rbb(mk, -w / 2, w / 2, 0.004, 0.016, -d / 2, d / 2, 0.006, col); if (withFringe) fringe(w, d, mk); contact(0, 0, w + 0.1, d + 0.1, 0.006); }
  // plaid épais drapé sur un accoudoir : profil (x, y) local, largeur selon z, plis souples
  function plaidOverArm(xa, armTop, armW, z0, z1, col) {
    const prof = [[xa - armW / 2 - 0.2, 0.465], [xa - armW / 2 - 0.06, armTop - 0.03], [xa - armW * 0.2, armTop + 0.016], [xa + armW * 0.25, armTop + 0.016], [xa + armW / 2 + 0.015, armTop - 0.045], [xa + armW / 2 + 0.03, armTop - 0.34]];
    const curve = new THREE.CatmullRomCurve3(prof.map(([px, py]) => new V3(px, py, 0)));
    thickSheet('cloth', 18, 30, (u, v) => {
      const p = curve.getPoint(v), z = z0 + (z1 - z0) * u, hangK = Math.max(0, (v - 0.6) / 0.4);
      const fold = Math.sin(u * 9.0 + 1.3) * 0.5 + Math.sin(u * 17.0 + v * 3) * 0.2;
      return [p.x + 0.018 * fold * hangK, p.y + 0.004 * Math.sin(u * 6 + 1) * (1 - hangK), z + 0.03 * hangK * hangK * Math.sin(u * 3.1 + 0.4)];
    }, col, 0.009, 'u0 u1 v1 v0');
  }
  // plaid plié posé (x, y0, z), w × d : trois épaisseurs et pli arrondi
  function foldedThrow(x, y0, z, w, d, col, ry = 0) {
    for (let k = 0; k < 3; k++) sq('cloth', w / 2 - k * 0.004, 0.009, d / 2 - k * 0.003, x, y0 + 0.009 + k * 0.016, z + k * 0.002, col.map(v => v * (1 - 0.03 * k)), { e1: 0.35, e2: 0.12, pinch: 0.1, ry, nu: 20, nv: 6, wob: 0.002 });
  }

  // ------------------------------------------------------------ assises
  // canapé 3 places à coussins séparés (lin), passepoils, pieds en chêne, coussins déco et plaid
  function sofa(w, o = {}) {
    const d = o.d || 0.96, col = C(o.col || PAL.linenSand, 0.02), colD = col.map(v => v * 0.82), seatY = 0.29, armW = 0.17, armH = 0.6, mk = o.mk || 'textile';
    const nLeg = w > 2.1 ? 3 : 2;
    for (const sz of [-1, 1]) for (let i = 0; i < nLeg; i++) { const x = -w / 2 + 0.1 + (w - 0.2) * i / (nLeg - 1); rbb('oak', x - 0.03, x + 0.03, 0, 0.1, sz * (d / 2 - 0.09) - 0.03, sz * (d / 2 - 0.09) + 0.03, 0.006, C(0xf0e6da)); }
    rb(mk, w - 0.02, 0.19, d - 0.04, 0.035, 0, 0.1 + 0.095, 0, col, { seg: 3 });                                  // caisse
    for (const s of [-1, 1]) sq(mk, armW / 2, (armH - 0.1) / 2, d / 2, s * (w / 2 - armW / 2), 0.1 + (armH - 0.1) / 2, 0, col, { e1: 0.18, e2: 0.22, pinch: 0.08, nu: 24, nv: 14 });
    rb(mk, w - 2 * armW + 0.02, 0.42, 0.16, 0.05, 0, 0.29 + 0.21, -d / 2 + 0.09, col, { seg: 3 });                 // dossier
    const n = w > 2.1 ? 3 : 2, inner = w - 2 * armW, cw = inner / n;
    for (let i = 0; i < n; i++) {
      const x = -inner / 2 + cw * (i + 0.5), cd = d - 0.2, cz = 0.085;
      sq(mk, cw / 2 - 0.006, 0.08, cd / 2, x, seatY + 0.08, cz, C(o.col || PAL.linenSand, 0.03), { e1: 0.24, e2: 0.14, pinch: 0.3, puff: 0.18, sag: 0.1, crease: 0.07, nu: 30, nv: 14, wob: 0.002 });
      // passepoil sur l'arête supérieure du coussin
      const pts = []; for (let k = 0; k < 28; k++) { const th = -Math.PI + 2 * Math.PI * k / 28, cc = Math.cos(th), ss = Math.sin(th); pts.push([x + (cw / 2 - 0.006) * Math.sign(cc) * Math.pow(Math.abs(cc), 0.14), seatY + 0.08 + 0.055, cz + cd / 2 * Math.sign(ss) * Math.pow(Math.abs(ss), 0.14)]); }
      tube(mk, pts, 0.0045, colD, { closed: true, seg: 80, rad: 4 });
      sq(mk, cw / 2 - 0.008, 0.21, 0.1, x, seatY + 0.16 + 0.2, -d / 2 + 0.24, C(o.col || PAL.linenSand, 0.03), { e1: 0.27, e2: 0.2, pinch: 0.45, puff: 0.24, crease: 0.08, squash: 0.05, rx: -0.16, nu: 24, nv: 16, wob: 0.003 });
    }
    // coussins décoratifs
    const pc = o.pillows || [PAL.terracotta, PAL.linenOat, PAL.ochre, PAL.sage];
    const spots = [[-inner / 2 + 0.24, 0.12], [-inner / 2 + 0.5, -0.15], [inner / 2 - 0.32, -0.1], [inner / 2 - 0.5, 0.2]];
    pc.forEach((c, i) => { const [x, rz] = spots[i % spots.length]; const s = i === 1 ? 0.42 : 0.5; pillow(x, seatY + 0.16 + s / 2 - 0.04, -d / 2 + 0.36 + (i === 1 ? 0.06 : 0), s, 0.15, C(c, 0.03), { rx: -Math.PI / 2 + 0.32, rz: rz * 0.6 }); });
    if (o.plaid !== false) plaidOverArm(w / 2 - armW / 2, armH, armW, -0.1, 0.4, C(o.plaid || PAL.rust, 0.03));
    contact(0, 0, w + 0.15, d + 0.15);
  }
  // fauteuil enveloppant en bouclé, pieds chêne
  function armchair(o = {}) {
    const col = C(o.col || PAL.boucle, 0.02), mk = o.mk || 'boucle';
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl('oak', 0.022, 0.018, 0.14, sx * 0.29, 0, sz * 0.28, C(0xf0e6da), { seg: 10 });
    sq(mk, 0.39, 0.1, 0.39, 0, 0.14 + 0.1, 0, col, { e1: 0.35, e2: 0.4, pinch: 0.1, nu: 28, nv: 12 });
    sq(mk, 0.39, 0.25, 0.13, 0, 0.5, -0.27, col, { e1: 0.45, e2: 0.5, rx: -0.12, nu: 28, nv: 14 });
    for (const s of [-1, 1]) sq(mk, 0.1, 0.13, 0.34, s * 0.3, 0.42, -0.02, col, { e1: 0.4, e2: 0.4, nu: 20, nv: 12 });
    sq(mk, 0.24, 0.065, 0.3, 0, 0.39, 0.06, col, { e1: 0.3, e2: 0.25, pinch: 0.3, sag: 0.1, nu: 22, nv: 10 });
    if (o.pillow) pillow(0, 0.6, -0.12, 0.4, 0.13, C(o.pillow), { rx: -Math.PI / 2 + 0.35 });
    contact(0, 0, 0.95, 0.95);
  }
  // chaise en chêne, assise en corde de papier tressée (inspiration « wishbone »)
  function chair(o = {}) {
    const oak = C(o.wood || 0xc6a37c, 0.04), sh = 0.44;
    for (const sx of [-1, 1]) {
      tube('oak', [[sx * 0.21, 0, 0.2], [sx * 0.205, sh, 0.19]], 0.016, oak, { seg: 3, rad: 7 });
      tube('oak', [[sx * 0.2, 0, -0.21], [sx * 0.2, sh, -0.17], [sx * 0.2, 0.74, -0.2]], 0.017, oak, { seg: 8, rad: 7 });
    }
    tube('oak', [[-0.25, 0.66, 0.02], [-0.23, 0.72, -0.19], [0, 0.745, -0.27], [0.23, 0.72, -0.19], [0.25, 0.66, 0.02]], 0.014, oak, { seg: 30, rad: 7 });
    rbb('oak', -0.02, 0.02, sh + 0.02, 0.72, -0.25, -0.23, 0.008, oak, { rx: 0.1 });
    for (const s of [-1, 1]) box('oak', -0.21, 0.21, sh - 0.05, sh - 0.01, s * 0.18 - 0.012, s * 0.18 + 0.012, oak);
    sq('textile', 0.225, 0.022, 0.215, 0, sh + 0.012, 0.0, C(o.seat || PAL.straw, 0.05), { e1: 0.2, e2: 0.12, sag: 0.25, nu: 18, nv: 8 });
    if (o.cushion) pillow(0, sh + 0.05, 0.01, 0.38, 0.05, C(o.cushion));
    contact(0, 0, 0.6, 0.6, 0.007);
  }
  function barStool(o = {}) {
    const oak = C(0xfaf3ea, 0.04), sh = 0.65;
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; tube('oak', [[Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2], [Math.cos(a) * 0.13, sh - 0.03, Math.sin(a) * 0.13]], 0.015, oak, { seg: 3, rad: 7 }); }
    torus('black', 0.17, 0.008, 0, 0.25, 0, WHITE, { seg: 28 });
    sq('textile', 0.175, 0.03, 0.175, 0, sh, 0, C(o.seat || PAL.cognac, 0.05), { e1: 0.3, e2: 1, sag: 0.15, nu: 24, nv: 8 });
    contact(0, 0, 0.5, 0.5);
  }

  // ------------------------------------------------------------ tables et rangements
  function coffeeTable(o = {}) {
    const w = o.w || 1.1, d = o.d || 0.6, h = o.h || 0.34;
    if (o.table !== false) {
      slab('travertine', w, d, 0.04, d / 2, 0, h - 0.04, 0, C(0xffffff, 0.02), { curve: 14 });
      for (const s of [-1, 1]) cyl('travertine', 0.12, 0.12, h - 0.04, s * w * 0.26, 0, 0, C(0xf4efe8), { seg: 28 });
      contact(0, 0, w + 0.25, d + 0.25, 0.018);
    }
    if (o.decor === false) return;
    // composition : livres, coupe, soliflore, bougie
    const y = h;
    bookStack(-w * 0.22, y, 0.02, 3, 0.1, true);
    const ty = tray(w * 0.18, y, -0.06, 0.34, 0.22, 0.12, 'oak', C(0xe8d8c2));   // plateau en chêne sous la coupe
    bowl(w * 0.18, ty, -0.06, 0.12, 0x3d3a36, 'stoneware');
    const vh = vase(w * 0.32, y, 0.12, 2, 0xe8dfd0); branches(w * 0.32, y + vh, 0.12, 0.42, 4);
    candle(-w * 0.05, y, -0.14, 0.09);
  }
  function sideTable(x, z, o = {}) { cyl('oak', 0.2, 0.2, 0.025, x, 0.5, z, C(0xfaf3ea), { seg: 32 }); cyl('oak', 0.03, 0.04, 0.5, x, 0, z, C(0xfaf3ea), { seg: 12 }); cyl('oak', 0.15, 0.15, 0.02, x, 0, z, C(0xfaf3ea), { seg: 24 }); if (o.lamp) tableLamp(x, 0.525, z, 1); else bookStack(x, 0.525, z, 2); contact(x, z, 0.5, 0.5); }
  // table ronde (Ø, piétement central)
  function roundTable(r = 0.6, o = {}) {
    const oak = C(0xfaf3ea, 0.03), tm = o.top || 'oak';
    lathe(tm, [[0, 0.72], [r - 0.01, 0.72], [r, 0.728], [r, 0.748], [r - 0.012, 0.755], [0, 0.755]], 0, 0, 0, oak, { seg: 64 });
    if (tm === 'travertine') lathe('travertine', [[0, 0], [0.24, 0], [0.24, 0.03], [0.17, 0.05], [0.15, 0.4], [0.17, 0.7], [0.2, 0.72], [0, 0.72]], 0, 0, 0, C(0xffffff), { seg: 40 });
    else lathe('oak', [[0, 0], [0.3, 0], [0.3, 0.025], [0.12, 0.05], [0.09, 0.3], [0.1, 0.6], [0.16, 0.72], [0, 0.72]], 0, 0, 0, oak, { seg: 40 });
    contact(0, 0, 2 * r + 0.6, 2 * r + 0.6);
  }
  function rectTable(w = 1.6, d = 0.9) {
    const oak = C(0xfaf3ea, 0.03);
    slab('oak', w, d, 0.035, 0.04, 0, 0.72, 0, oak, { bevel: 0.006 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) tube('oak', [[sx * (w / 2 - 0.12), 0, sz * (d / 2 - 0.1)], [sx * (w / 2 - 0.1), 0.72, sz * (d / 2 - 0.08)]], 0.028, oak, { seg: 3, rad: 10 });
    box('oak', -w / 2 + 0.12, w / 2 - 0.12, 0.64, 0.72, -d / 2 + 0.08, -d / 2 + 0.1, oak); box('oak', -w / 2 + 0.12, w / 2 - 0.12, 0.64, 0.72, d / 2 - 0.1, d / 2 - 0.08, oak);
    contact(0, 0, w + 0.6, d + 0.9);
  }
  // table dressée : vase et coupe
  function tableDecor(x, z, y = 0.755) { const vh = vase(x - 0.05, y, z, 0, 0xc9b9a2); branches(x - 0.05, y + vh, z, 0.5, 5); bowl(x + 0.22, y, z + 0.08, 0.13, 0xe9e2d6); }
  // buffet bas en chêne (façades à cannelures), sur plinthe en retrait
  function sideboard(w = 1.6, d = 0.44, h = 0.7, o = {}) {
    const oak = C(0xf6eee4, 0.03), n = Math.max(2, Math.round(w / 0.42));
    if (o.body !== false) {
    box('oak', -w / 2 + 0.06, w / 2 - 0.06, 0, 0.1, -d / 2 + 0.03, d / 2 - 0.06, C(0x8a6a4c));
    rbb('oak', -w / 2, w / 2, 0.1, h, -d / 2, d / 2 - 0.009, 0.006, oak);
    for (let i = 0; i < n; i++) {
      const x0 = -w / 2 + 0.004 + i * w / n, x1 = x0 + w / n - 0.006;
      for (let x = x0 + 0.016; x < x1 - 0.01; x += 0.032) { const sc = C(0xcfae88, 0.03); rbb('lacquer', x - 0.0135, x + 0.0135, 0.11, h - 0.01, d / 2 - 0.01, d / 2 - 0.003, 0.003, sc); }   // tasseaux de 27 mm au pas de 32 mm, relief de 7 mm arrondi : plus de rainures profondes (moiré, occlusion bruitée)   // tasseaux teintés unis : le fil photographique, perpendiculaire aux tasseaux, faisait du moiré
    }
    contact(0, 0, w + 0.2, d + 0.25);
    }
    if (o.decor !== false) {
      tableLamp(-w / 2 + 0.28, h, -0.02, 0, 0xc9b9a2);
      bookStack(0.05, h, 0.02, 2, 0.15, true);
      const vh = vase(w / 2 - 0.25, h, 0, 0, 0xe8dfd0); branches(w / 2 - 0.25, h + vh, 0, 0.55, 5);
      bowl(0.32, h, 0.04, 0.09, 0x6b4a36);
    }
  }
  // armoire / placard toute hauteur, façades laquées, prises de main verticales en chêne
  function wardrobe(w, d = 0.6, o = {}) {
    const hT = H - 0.005, col = C(o.col || 0xece7de, 0.01), n = Math.max(2, Math.round(w / 0.5));
    walk(() => {
      box('lacquer', -w / 2, w / 2, 0, hT, -d / 2, d / 2 - 0.02, col);
      box('lacquer', -w / 2 + 0.01, w / 2 - 0.01, 0, 0.08, d / 2 - 0.05, d / 2 - 0.02, col.map(v => v * 0.7));
      for (let i = 0; i < n; i++) {
        const x0 = -w / 2 + i * w / n + 0.0015, x1 = x0 + w / n - 0.003;
        rbb('lacquer', x0, x1, 0.085, hT - 0.003, d / 2 - 0.02, d / 2, 0.002, col, { seg: 1 });
        const hx = i % 2 ? x0 + 0.045 : x1 - 0.045; if (barHandleFn) barHandleFn('brass', hx, 1.1, d / 2, 0.5, { vertical: true, r: 0.006, off: 0.028 }); else rbb('oak', hx - 0.012, hx + 0.012, 0.9, 1.3, d / 2, d / 2 + 0.02, 0.008, C(0xf6eee4));
      }
    });
    tallPlan('lacquer', -w / 2, w / 2, -d / 2, d / 2, col);
  }
  // étagère murale en chêne avec objets (x local de -w/2 à w/2, profondeur d, fixée au mur z = 0 → z = d)
  function wallShelf(w, y, d = 0.24, o = {}) {
    rbb('oak', -w / 2, w / 2, y, y + 0.03, 0, d, 0.004, C(0xf6eee4, 0.03));
    if (o.objects !== false) {
      bookRow(-w / 2 + 0.05, -w / 2 + 0.05 + w * 0.35, y + 0.03, d / 2, 0);
      vase(w * 0.1, y + 0.03, d / 2, 1, 0xd9cfbf); bowl(w * 0.3, y + 0.03, d / 2, 0.08, 0x9c5236);
    }
  }
  function bench(w, d = 0.38, o = {}) {
    const oak = C(0xf6eee4, 0.03);
    slab('oak', w, d, 0.04, 0.02, 0, 0.4, 0, oak);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) rbb('oak', sx * (w / 2 - 0.06) - 0.022, sx * (w / 2 - 0.06) + 0.022, 0, 0.4, sz * (d / 2 - 0.06) - 0.022, sz * (d / 2 - 0.06) + 0.022, 0.006, oak);
    if (o.cushion) sq('textile', w / 2 - 0.04, 0.03, d / 2 - 0.03, 0, 0.47, 0, C(o.cushion), { e1: 0.2, e2: 0.12, pinch: 0.3, nu: 20, nv: 8 });
    if (o.throw) foldedThrow(w * 0.25, 0.44 + (o.cushion ? 0.06 : 0), 0, 0.45, d - 0.06, C(o.throw));
    contact(0, 0, w + 0.2, d + 0.2);
  }
  function desk(w = 1.2, d = 0.55, o = {}) {
    const oak = C(0xf6eee4, 0.03);
    if (o.body !== false) {
      slab('oak', w, d, 0.03, 0.01, 0, 0.72, 0, oak);
      for (const s of [-1, 1]) { box('black', s * (w / 2 - 0.05) - 0.01, s * (w / 2 - 0.05) + 0.01, 0, 0.72, -d / 2 + 0.05, d / 2 - 0.05); box('black', s * (w / 2 - 0.05) - 0.01, s * (w / 2 - 0.05) + 0.01, 0, 0.02, -d / 2 + 0.03, d / 2 - 0.03); }
      box('black', -w / 2 + 0.05, w / 2 - 0.05, 0.6, 0.62, -d / 2 + 0.06, -d / 2 + 0.08);
    }
    if (o.items === false) return;
    // lampe d'architecte, carnet, ordinateur fermé, pot à crayons
    const y = o.h || 0.75;
    cyl('black', 0.07, 0.07, 0.015, w / 2 - 0.15, y, -0.12, WHITE);
    tube('black', [[w / 2 - 0.15, y, -0.12], [w / 2 - 0.18, y + 0.32, -0.16], [w / 2 - 0.32, y + 0.42, -0.04]], 0.006, WHITE, { seg: 10, rad: 4 });
    lathe('black', [[0.06, 0], [0.04, 0.08], [0.015, 0.1], [0, 0.1]], w / 2 - 0.33, y + 0.3, -0.03, WHITE, { seg: 20 });
    rbb('steel', -0.17, 0.17, y, y + 0.016, -0.12, 0.12, 0.006, C(0x9a9ea3), { ry: 0.1 });
    book(0.25, y, 0.05, 0.15, 0.21, 0.015, -0.3, 0x2f3a48);
    cyl('stoneware', 0.035, 0.035, 0.1, -w / 2 + 0.12, y, -0.15, C(0x9c5236));
    for (let i = 0; i < 4; i++) cyl('lacquer', 0.004, 0.004, 0.16, -w / 2 + 0.12 + jit(0.03), y + 0.02, -0.15 + jit(0.03), C(pick([0x2f3a48, 0xc89a4b, 0x3d3a36])), { rz: jit(0.3), seg: 5 });
    contact(0, 0, w + 0.2, d + 0.2);
  }
  function nightstand(o = {}) {
    const oak = C(0xf6eee4, 0.04), w = o.w || 0.45, d = 0.38, h = o.h || 0.5;
    if (o.body !== false) {
      rbb('oak', -w / 2, w / 2, 0.08, h, -d / 2, d / 2, 0.006, oak);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) rbb('oak', sx * (w / 2 - 0.04) - 0.015, sx * (w / 2 - 0.04) + 0.015, 0, 0.09, sz * (d / 2 - 0.04) - 0.015, sz * (d / 2 - 0.04) + 0.015, 0.004, oak);
      box('oak', -w / 2 + 0.02, w / 2 - 0.02, h - 0.16, h - 0.157, d / 2, d / 2 + 0.002, C(0x7a5a3c));
      rbb('brass', -0.04, 0.04, h - 0.1, h - 0.088, d / 2, d / 2 + 0.018, 0.005);
    }
    if (o.lamp !== false) tableLamp(-0.03, h, -0.03, o.lampKind || 0, o.lampC || 0xd9cfbf);
    if (o.books !== false) bookStack(0.1, h, 0.08, 2, 0.4);
    if (o.cup) cyl('ceramic', 0.04, 0.035, 0.08, 0.13, h, -0.1, C(0xe9e2d6));
    contact(0, 0, w + 0.15, d + 0.15);
  }
  // lit : sommier tapissier, tête de lit capitonnée en lin (côtes verticales), couette, oreillers, plaid au pied
  function bed(w, L = 2.0, o = {}) {
    const hb = C(o.head || PAL.linenGreige, 0.02), sheetC = C(o.sheet || PAL.linenWhite, 0.02), duvetC = C(o.duvet || PAL.linenWhite, 0.02);
    const hbW = o.hbW ?? w + 0.2, hbH = o.hbH ?? 1.12, hm = o.headMk || 'textile', z0 = o.z0 ?? (hm === 'oak' || hm === 'cane' ? 0.06 : 0.09), top = 0.56;
    // tête de lit : panneau + côtes (lin, bouclé), panneau de chêne à joints creux, ou cannage dans un cadre chêne
    if (hm === 'oak') {
      const oc = C(o.headC || 0xf0e4d4, 0.02), n = Math.max(3, Math.round(hbW / 0.3));
      for (let i = 0; i < n; i++) { const x0 = -hbW / 2 + i * hbW / n + 0.002, x1 = x0 + hbW / n - 0.004; rbb('oak', x0, x1, 0.05, hbH - 0.06, 0, 0.04, 0.006, oc); }
      rbb('oak', -hbW / 2 - 0.02, hbW / 2 + 0.02, hbH - 0.06, hbH - 0.02, 0, 0.09, 0.008, oc);            // tablette haute
    } else if (hm === 'cane') {
      const oc = C(o.headC || 0xd9bf98, 0.02), f = 0.045;
      rbb('oak', -hbW / 2, hbW / 2, 0.05, hbH, 0, 0.045, 0.015, oc);
      box('cane', -hbW / 2 + f, hbW / 2 - f, 0.05 + f, hbH - f, 0.045, 0.047, C(0xffffff));
      for (const sx of [-1, 1]) rbb('oak', sx * hbW / 2 - (sx > 0 ? f : 0), sx * hbW / 2 + (sx < 0 ? f : 0), 0.05, hbH, 0.04, 0.055, 0.01, oc);
      rbb('oak', -hbW / 2, hbW / 2, hbH - f, hbH, 0.04, 0.055, 0.01, oc); rbb('oak', -hbW / 2, hbW / 2, 0.05, 0.05 + f, 0.04, 0.055, 0.01, oc);
    } else {
      rbb(hm, -hbW / 2, hbW / 2, 0.08, hbH, 0, 0.06, 0.02, hb.map(v => v * 0.92));
      const nr = Math.round(hbW / 0.2), rw = hbW / nr;
      // côtes capitonnées verticales : boudins rembourrés (boîte arrondie bombée), coutures en creux entre eux
      for (let i = 0; i < nr; i++) {
        const cx = -hbW / 2 + rw * (i + 0.5), ch = hbH - 0.14;
        if (puffBoxFn) { const g = puffBoxFn(rw - 0.006, 0.07, ch, 0.03, { puff: 0.35, side: 0.25, wob: 0.0008, step: 0.03 }); g.rotateX(-Math.PI / 2); g.translate(cx, 0.12 + ch / 2, 0.075); put(hm, g, hb); }
        else sq(hm, rw / 2 - 0.004, ch / 2, 0.035, cx, 0.12 + ch / 2, 0.07, hb, { e1: 0.18, e2: 0.6, pinch: 0.05, nu: 12, nv: 10 });
      }
    }
    // base (sommier gainé) sur socle en retrait
    // sommier tapissé débordant (+4 cm par côté) sur pieds chêne fuselés : 10 cm de vide sous le lit
    for (const sx of [-1, 1]) for (const zz of [z0 + 0.12, z0 + L - 0.1]) cyl('oak', 0.017, 0.024, 0.1, sx * (w / 2 - 0.08), 0, zz, C(0xe6d4bb), { seg: 14 });
    rbb('textile', -w / 2 - 0.04, w / 2 + 0.04, 0.1, 0.34, z0, z0 + L + 0.03, 0.035, hb, { seg: 3 });
    seamLoop('textile', w / 2 + 0.036, (L + 0.03) / 2 - 0.004, 0.004, 0, 0.335, z0 + (L + 0.03) / 2, hb.map(v => v * 0.88), {}, 0.12, 80);
    // matelas 22 cm : boîte arrondie maillée finement, passepoils (furniture.js) ; repli superquadrique sinon
    if (fxCushion) fxCushion('textile', w, 0.22, L, 0, 0.33 + 0.105, z0 + L / 2, sheetC, { r: 0.05, puff: 0.08, sag: 0, step: 0.05 });
    else sq('textile', w / 2, 0.11, L / 2, 0, 0.33 + 0.105, z0 + L / 2, sheetC, { e1: 0.18, e2: 0.1, pinch: 0.1, nu: 24, nv: 10 });
    // couette épaisse : dessus bombé matelassé, arrondi sur l'arête du matelas, chute avec plis verticaux,
    // coins en cône (plus bas), ourlet roulé ; envers décalé (épaisseur visible au bord)
    const hang = 0.2, hangF = o.tuck ? 0.1 : hang, zA = z0 + 0.52, zB = z0 + L + 0.03, len = zB - zA, rr = 0.06, hw = w / 2 + 0.012, ph = R() * 6;
    const duvet = (u, v) => {
      u = Math.min(1, Math.max(0, u)); v = Math.min(1, Math.max(0, v));
      const s = (u - 0.5) * (2 * hw + 2 * hang), t = v * (len + hangF);
      const ex = Math.max(0, Math.abs(s) - hw), ez = Math.max(0, t - len), d = Math.hypot(ex, ez);
      const [o1, oy] = fallOf(d, rr), k = d > 0 ? o1 / d : 0;
      let x = Math.sign(s) * (Math.min(Math.abs(s), hw) + ex * k), z = zA + Math.min(t, len) + ez * k, y = top + 0.05 + oy;
      const inTop = d === 0, hangK = Math.min(1, d / hang);
      // dessus : gonflant, matelassage léger, plis doux (corps couché)
      if (inTop) { const nx = s / hw, nz = t / len; y += 0.025 * (1 - nx * nx) * (0.6 + 0.4 * Math.sin(nz * 3.1)) - 0.003 * Math.pow(Math.cos((t / 0.33) * Math.PI + 0.3 * Math.sin(s * 4)), 16) + 0.012 * Math.sin(s * 7 + t * 3 + ph) * Math.sin(t * 4.3) + 0.016 * Math.exp(-Math.pow((s * 0.8 + t * 0.55 - 0.45) / 0.09, 2)) * (1 - nz * 0.5);
        // passe 2 : froissé fin du lin lavé (rides croisées de 4–8 cm, plus marquées vers le pied et les bords)
        const fr = 0.35 + 0.65 * Math.min(1, nz * 1.3 + Math.abs(nx) * 0.6);
        y += fr * (0.0045 * Math.sin(s * 19 + ph * 2 + 2.6 * Math.sin(t * 4.3 + s * 2)) * Math.sin(t * 13 + s * 5.1 + Math.sin(s * 3)) + 0.002 * Math.sin(s * 9 - t * 27 + ph) * Math.sin(t * 21 + 2.3 * Math.sin(s * 7))); }
      // chute : plis verticaux qui s'ouvrent vers le bas, ondulation de l'ourlet
      const ang = (Math.abs(s) > hw ? t : s), pf = 0.022 * hangK * Math.sin(ang * 11 + ph + (ex > 0 && ez > 0 ? Math.atan2(ez, ex) * 3 : 0)) + 0.007 * hangK * Math.sin(ang * 31 + 2 * ph);
      if (!inTop) { const nxv = ex > 0 ? Math.sign(s) : 0, nzv = ez > 0 ? 1 : 0, L2 = Math.hypot(nxv, nzv) || 1; x += nxv / L2 * pf; z += nzv / L2 * pf; if (ez > 0 && ex === 0) x += pf * 0.6; if (ex > 0 && ez === 0) z += pf * 0.6; }
      y = Math.max(y, 0.1 + 0.015 * Math.sin(s * 20 + t * 13));
      return [x, y, z];
    };
    thickSheet('cloth', 64, 70, duvet, duvetC, 0.02, 'u0 u1 v1');   // maillage fin : rides de quelques centimètres
    // revers de couette en tête : rouleau souple avec housse
    sq('cloth', hw + 0.01, 0.04, 0.12, 0, top + 0.062, zA + 0.04, duvetC.map(v => v * 0.97), { e1: 0.45, e2: 0.1, puff: 0.1, crease: 0.08, nu: 30, nv: 10, wob: 0.004 });
    // oreillers : deux grands carrés contre la tête de lit, deux standard, un coussin
    const np = 2;
    // grands oreillers presque droits, adossés à la tête de lit (≈ 15°), bombés et tassés au centre ; oreillers standard devant
    for (let i = 0; i < np; i++) { const x = (i - (np - 1) / 2) * (w / np); pillow(x + jit(0.02), top + 0.34, z0 + 0.16, Math.min(0.64, w / np - 0.03), 0.27, sheetC, { rx: -Math.PI / 2 + 0.27 + jit(0.05), rz: jit(0.06), e2: 0.24, puff: 0.42, crease: 0.16, wob: 0.006 }); pillow(x + jit(0.03), top + 0.2, z0 + 0.38, Math.min(0.6, w / np - 0.05) * 0.93, 0.19, C(o.pillow2 || PAL.linenOat, 0.03), { rx: -Math.PI / 2 + 0.6, rz: jit(0.05), puff: 0.32, crease: 0.12 }); }
    if (o.bolster) { // traversin : cylindre rembourré, extrémités bombées et passepoilées
      const bl = w - 0.2, br = 0.085, bc = C(o.bolster, 0.03);
      lathe('textile', [[0, -bl / 2], [br * 0.75, -bl / 2 + 0.004], [br * 0.97, -bl / 2 + 0.03], [br, -bl / 2 + 0.06], [br * 1.02, 0], [br, bl / 2 - 0.06], [br * 0.97, bl / 2 - 0.03], [br * 0.75, bl / 2 - 0.004], [0, bl / 2]], 0, top + 0.11, z0 + 0.6, bc, { rz: Math.PI / 2, seg: 28 });
      for (const sx of [-1, 1]) torus('textile', br * 0.97, 0.004, sx * (bl / 2 - 0.03), top + 0.11, z0 + 0.6, bc.map(v => v * 0.88), { rz: Math.PI / 2, seg: 32, rad: 4 });
    } else pillow(0, top + 0.16, z0 + 0.62, 0.44, 0.15, C(o.accent || PAL.terracotta), { rx: -Math.PI / 2 + 0.6, rz: 0.04 });
    // plaid épais plié en travers au pied : épouse la couette (décalé selon sa normale), retombe moins bas qu'elle
    const tW = 2 * hw + 2 * hang, tL = len + hangF, tdrop = 0.19, tz0 = L - 0.52 + z0 - zA, tdz = 0.44;
    const onDuvet = (s, t, e) => {
      const u = s / tW + 0.5, v = t / tL, p = duvet(u, v), q = duvet(u + 2e-3, v), r = duvet(u, v + 2e-3);
      const ax = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], bx = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
      let n = [ax[2] * bx[1] - ax[1] * bx[2], ax[0] * bx[2] - ax[2] * bx[0], ax[1] * bx[0] - ax[0] * bx[1]]; const Ln = Math.hypot(...n) || 1; n = n.map(c => c / Ln); if (n[1] < 0) n = n.map(c => -c);
      return [p[0] + n[0] * e, p[1] + n[1] * e, p[2] + n[2] * e];
    };
    thickSheet('cloth', 48, 10, (u, v) => {
      const s = (u - 0.5) * 2 * (hw + tdrop), t = tz0 + v * tdz;
      const hk = Math.min(1, Math.max(0, Math.abs(s) - hw) / tdrop), q = onDuvet(s, t, 0.018 + 0.016 * hk);
      return [q[0] + 0.006 * hk * Math.sin(v * 9 + u * 5), q[1] + 0.003 * Math.sin(u * 17) * (1 - hk), q[2] + 0.012 * hk * Math.sin(u * 23 + 1)];
    }, C(o.throw || PAL.ochre, 0.02), 0.011, 'u0 u1 v0 v1');
    // prises murales de part et d'autre de la tête de lit (plaque blanche, deux alvéoles)
    (P.untracked || ((f) => f()))(() => walk(() => { for (const sx of (o.sockets || [-1, 1])) { const px = sx * (w / 2 + 0.36); rbb('ceramic', px - 0.042, px + 0.042, 0.26, 0.344, 0, 0.009, 0.004, C(0xf4f2ee)); for (const dx of [-0.011, 0.011]) cyl('black', 0.0035, 0.0035, 0.003, px + dx, 0.302, 0.0085, WHITE, { rx: Math.PI / 2, seg: 8 }); } }));
    contact(0, z0 + L / 2, w + 0.3, L + 0.3);
  }

  // ------------------------------------------------------------ murs : œuvres, miroirs, patères, interrupteurs
  // tableau encadré sur un mur : face vers +z local, dos à z = 0 ; (cx, cy) centre, w × h
  function art(cx, cy, w, h, idx, o = {}) {
    walk(() => {
      const fw = o.fw ?? 0.025, fd = 0.03, mat = o.mat ?? 0.06, frame = o.frame || 'oak', fc = C(o.fc || (frame === 'oak' ? 0xc39d73 : 0xffffff));
      box(frame, cx - w / 2, cx + w / 2, cy - h / 2, cy - h / 2 + fw, 0, fd, fc); box(frame, cx - w / 2, cx + w / 2, cy + h / 2 - fw, cy + h / 2, 0, fd, fc);
      box(frame, cx - w / 2, cx - w / 2 + fw, cy - h / 2 + fw, cy + h / 2 - fw, 0, fd, fc); box(frame, cx + w / 2 - fw, cx + w / 2, cy - h / 2 + fw, cy + h / 2 - fw, 0, fd, fc);
      box('paper', cx - w / 2 + fw, cx + w / 2 - fw, cy - h / 2 + fw, cy + h / 2 - fw, 0.004, fd - 0.008, C(0xf7f4ee));
      // image recadrée selon les proportions
      const iw = w - 2 * fw - 2 * mat, ih = h - 2 * fw - 2 * mat, cell = 0.25, cu = (idx % 4) * cell, cvv = 1 - (Math.floor(idx / 4) + 1) * 0.5;
      const ar = iw / ih; let su = cell, sv = 0.5; if (ar > 1) sv = 0.5 / ar; else su = cell * ar;
      // o.crop = [cx, cy, zoom] : détail recadré (variantes d'une même œuvre) ; o.flip : miroir horizontal
      const [kx, ky, kz] = o.crop || [0.5, 0.5, 1]; su *= kz; sv *= kz;
      const g = new THREE.PlaneGeometry(iw, ih); const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) { const ux = o.flip ? 1 - uv.getX(i) : uv.getX(i); uv.setXY(i, cu + (cell - su) * kx + ux * su, cvv + (0.5 - sv) * ky + uv.getY(i) * sv); }
      g.translate(cx, cy, fd - 0.0075); put('art', g, WHITE, true);
    });
  }
  function roundMirror(cx, cy, r, frame = 'brass') { walk(() => { const g = new THREE.CircleGeometry(r, 48); g.translate(cx, cy, 0.012); put('mirror#' + (++mirrorN), g, WHITE, true); torus(frame, r, 0.012, cx, cy, 0.012, WHITE, { rx: Math.PI / 2, seg: 48, rad: 8 }); }); }
  // miroir à angles très arrondis (rayon w/4), cadre fin en tube, entretoise murale ; maillage plan 'mirror#N'
  // pour les reflets de viewer.js (angles arrondis gérés par makeReflector)
  function rectMirror(cx, cy, w, h, frame = 'black') {
    walk(() => {
      const r = Math.min(w, h) * 0.25, sh = new THREE.Shape(), hw = w / 2 - 0.01, hh = h / 2 - 0.01;
      sh.moveTo(-hw + r, -hh); sh.lineTo(hw - r, -hh); sh.quadraticCurveTo(hw, -hh, hw, -hh + r); sh.lineTo(hw, hh - r); sh.quadraticCurveTo(hw, hh, hw - r, hh); sh.lineTo(-hw + r, hh); sh.quadraticCurveTo(-hw, hh, -hw, hh - r); sh.lineTo(-hw, -hh + r); sh.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
      const g = new THREE.ShapeGeometry(sh, 12); g.translate(cx, cy, 0.03); put('mirror#' + (++mirrorN), g, WHITE, true);
      const pts = sh.getSpacedPoints(96).map((p) => new V3(cx + p.x, cy + p.y, 0.03));
      put(frame === 'oak' ? 'brass' : 'black', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 192, 0.006, 6, true), WHITE);
      // (pas de halo lumineux : un matériau « lampe » ajoute une source ponctuelle contre le mur, qui accuse le relief de la peinture)
      box('black', cx - w / 2 + 0.06, cx + w / 2 - 0.06, cy - h / 2 + 0.06, cy + h / 2 - 0.06, 0, 0.026, C(0x333333));        // entretoise murale
    });
  }
  function pegRail(w, y, n = 4, o = {}) {
    walk(() => {
      rbb('oak', -w / 2, w / 2, y - 0.04, y + 0.04, 0, 0.02, 0.006, C(0xf6eee4));
      for (let i = 0; i < n; i++) { const x = -w / 2 + w * (i + 0.5) / n; cyl('oak', 0.014, 0.012, 0.09, x, y, 0.02, C(0xf6eee4), { rx: Math.PI / 2 - 0.15, seg: 10 }); }
      // un manteau et un sac de toile suspendus
      if (o.coat) { // manteau suspendu par sa bride : épaules tombantes, plis verticaux, manches le long du corps
        const x = -w / 2 + w * 0.5 / n, cc = C(o.coat, 0.03), len = 0.92, y0 = y - 0.02;
        const f = (u, v) => {
          const s = (0.5 - u) * 2, hw = v < 0.12   // sens inversé : face avant tournée vers la pièce
            ? 0.07 + 0.14 * Math.sin(v / 0.12 * Math.PI / 2) : 0.21 + 0.035 * (v - 0.12) / 0.88;
          const bul = (v < 0.12 ? 0.03 + 0.03 * v / 0.12 : 0.06 - 0.012 * v) * Math.sqrt(Math.max(0, 1 - s * s));
          const fold = 0.014 * Math.sin(s * Math.PI * 3.2 + v * 2.5) * Math.min(1, v * 2.2) + (Math.abs(s + 0.08) < 0.06 ? -0.006 : 0);
          return [x + s * hw, y0 - v * len + 0.01 * Math.sin(s * 9) * v * v, 0.035 + bul + fold];
        };
        thickSheet('textile', 26, 22, f, cc, 0.012, 'u0 u1 v1');
        for (const sd of [-1, 1]) stem('textile', curvePts([[x + sd * 0.19, y0 - 0.13, 0.065], [x + sd * 0.215, y0 - 0.38, 0.085], [x + sd * 0.205, y0 - 0.66, 0.09]], 8), 0.05, 0.042, cc.map(v => v * 0.94), 8);
        torus('textile', 0.012, 0.004, x, y0 + 0.01, 0.07, cc, { rx: Math.PI / 2, seg: 10, rad: 4 });
      }
      if (o.bag) { const x = -w / 2 + w * 2.5 / n; sq('cloth', 0.17, 0.2, 0.03, x, y - 0.28, 0.06, C(o.bag, 0.03), { e1: 0.15, e2: 0.2, nu: 12, nv: 10, rx: 0.08 }); tube('cloth', [[x - 0.07, y - 0.1, 0.06], [x, y + 0.02, 0.07], [x + 0.07, y - 0.1, 0.06]], 0.008, C(o.bag)); }
    });
  }
  // rideaux voilage : plis ondulés, x de x0 à x1, plan z (local), rail au plafond
  // rideau à plis : tête plissée (plis plus serrés en haut), tombé lesté par l'ourlet, galon de tête et ourlet roulé
  function pleated(mk, x0, x1, z, col, o = {}) {
    const top = H - 0.045, W0 = x1 - x0, nP = Math.max(3, Math.round(W0 / (o.lam || 0.11))), A = o.amp || 0.04, ph = R() * 6, n = nP * 10, ny = 18;
    const prof = (u, v) => { // phase du pli : profil en « S » arrondi (pas une sinusoïde pure)
      const x = x0 + W0 * u, f = u * nP * Math.PI * 2 + ph, s = Math.sin(f), shaped = Math.sign(s) * Math.pow(Math.abs(s), 0.6);
      const amp = A * (1.3 - 0.5 * v) * (1 + 0.15 * Math.sin(u * 7 + ph)), hemSag = 0.004 * Math.sin(u * nP * 2 * Math.PI * 0.5 + ph);
      const y = 0.012 + (top - 0.012) * v + (v < 0.03 ? hemSag : 0);
      return [x + 0.006 * Math.cos(f) * (1 - v), y, z + amp * shaped];
    };
    sheet(mk, n, ny, (u, v) => prof(u, v), col);
    const hemPts = []; for (let k = 0; k <= n; k++) hemPts.push(new V3(...prof(k / n, 0.004)));
    put(mk, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hemPts), n * 2, 0.005, 4, false), col.map(v => v * 0.96));
    const headPts = []; for (let k = 0; k <= n; k++) headPts.push(new V3(...prof(k / n, 0.985)));
    put(mk, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(headPts), n * 2, 0.007, 4, false), col.map(v => v * 0.97));
  }
  function sheers(x0, x1, z, o = {}) {
    walk(() => {
      pleated('sheer', x0, x1, z, C(0xffffff), { lam: o.lam || 0.1, amp: o.amp || 0.035 });
      box('black', o.r0 ?? x0 - 0.05, o.r1 ?? x1 + 0.05, H - 0.03, H - 0.002, z - 0.012, z + 0.012, C(0xffffff));
    });
  }
  // rideaux en lin épais (chambres)
  function drapes(x0, x1, z, col) { walk(() => pleated('cloth', x0, x1, z, col, { lam: 0.12, amp: 0.045 })); }

  // ------------------------------------------------------------ cuisine
  // linéaire bas : x local -L/2..L/2, dos z = -0.3, façade z = +0.3 ; modules [{w, t:'door'|'drawers'|'dw', sink, hob}]
  function baseRun(L, mods, o = {}) {
    const fr = o.front || 'oak', fc = C(o.frontC || 0xffffff, 0.01), top = o.top || 'stone', topC = C(o.topC || 0xffffff), hY = 0.87, tT = 0.03;
    // caisson sombre (les joints de 3 mm se lisent en ombre), abaissé sous les cuves : on voit l'évier sous le plan
    { let px = -L / 2 + 0.018; let xx = -L / 2; const cut = [];
      for (const m of mods) { if (m.sink) { const sw = m.sinkW || 0.5, cx0 = xx + m.w / 2; cut.push([cx0 - sw / 2, cx0 + sw / 2]); } xx += m.w; }
      for (const [a0, a1] of cut) { box('lacquer', px, a0, 0.1, hY, -0.3, 0.28, C(0x4e4a46)); box('lacquer', a0, a1, 0.1, hY - 0.21, -0.3, 0.28, C(0x4e4a46)); px = a1; }
      box('lacquer', px, L / 2 - 0.018, 0.1, hY, -0.3, 0.28, C(0x4e4a46)); }
    for (const s of [-1, 1]) box(fr, s > 0 ? L / 2 - 0.018 : -L / 2, s > 0 ? L / 2 : -L / 2 + 0.018, 0, hY, -0.3, 0.3, fc);   // joues en façade
    box('lacquer', -L / 2 + 0.018, L / 2 - 0.018, 0, 0.1, -0.3, 0.22, C(0x3e3b38));      // plinthe en retrait
    let x = -L / 2; const sinks = [], hobs = [];
    for (const m of mods) {
      const x0 = x + 0.0015, x1 = x + m.w - 0.0015;
      const fronts = m.t === 'drawers' ? [[0.1, 0.36], [0.36, 0.62], [0.62, hY - 0.003]] : m.t === 'drawers2' ? [[0.1, 0.5], [0.5, hY - 0.003]] : [[0.1, hY - 0.003]];
      for (const [y0, y1] of fronts) {
        rbb(fr, x0, x1, y0 + 0.0015, y1 - 0.0015, 0.28, 0.299, 0.0015, fc, { seg: 1 });
        if (o.handle !== 'none') { const hy = y1 - 0.04, hl = Math.min(0.26, (x1 - x0) * 0.55); if (barHandleFn) barHandleFn(o.handleMk || 'brass', (x0 + x1) / 2, hy, 0.299, hl, { r: 0.0055, off: 0.026 }); else rbb(o.handleMk || 'brass', (x0 + x1) / 2 - hl / 2, (x0 + x1) / 2 + hl / 2, hy - 0.006, hy + 0.006, 0.299, 0.318, 0.004, WHITE); }
      }
      if (m.sink) sinks.push([(x0 + x1) / 2, m.sinkW || 0.5]);
      if (m.hob) hobs.push((x0 + x1) / 2);
      x += m.w;
    }
    // plan de travail (découpe d'évier)
    const ty0 = hY, ty1 = hY + tT, zb = -0.3, zf = 0.32;
    let cx = -L / 2;
    for (const [sx, sw] of sinks) {
      box(top, cx, sx - sw / 2, ty0, ty1, zb, zf, topC); box(top, sx - sw / 2, sx + sw / 2, ty0, ty1, zb, -0.2, topC); box(top, sx - sw / 2, sx + sw / 2, ty0, ty1, 0.22, zf, topC);
      // cuve sous plan en inox + bonde, robinet col de cygne noir mat
      box('steel', sx - sw / 2 + 0.01, sx + sw / 2 - 0.01, ty0 - 0.2, ty0 - 0.19, -0.19, 0.21, C(0xe2e4e6)); for (const s of [-1, 1]) { box('steel', s > 0 ? sx + sw / 2 - 0.012 : sx - sw / 2 + 0.002, s > 0 ? sx + sw / 2 - 0.002 : sx - sw / 2 + 0.012, ty0 - 0.2, ty0, -0.19, 0.21, C(0xd6d9dc)); box('steel', sx - sw / 2 + 0.01, sx + sw / 2 - 0.01, ty0 - 0.2, ty0, s > 0 ? 0.2 : -0.2, s > 0 ? 0.21 : -0.19, C(0xd6d9dc)); }   // inox brossé clair
      cyl('steel', 0.03, 0.03, 0.003, sx, ty0 - 0.19, 0.01, C(0x55585a));
      const tm = o.tap || 'black';
      if (kitchenTap) kitchenTap(sx, ty1, -0.25, tm);
      else { cyl(tm, 0.022, 0.022, 0.06, sx, ty1, -0.25, WHITE, { seg: 14 }); tube(tm, [[sx, ty1 + 0.05, -0.25], [sx, ty1 + 0.3, -0.25], [sx, ty1 + 0.36, -0.17], [sx, ty1 + 0.3, -0.1], [sx, ty1 + 0.25, -0.1]], 0.011, WHITE, { seg: 24, rad: 8 }); }
      cx = sx + sw / 2;
    }
    box(top, cx, L / 2, ty0, ty1, zb, zf, topC);
    for (const hx of hobs) {
      box('glassBlack', hx - 0.29, hx + 0.29, ty1, ty1 + 0.005, -0.25, 0.25);
      for (const [dx, dz, r] of [[-0.14, -0.1, 0.1], [0.14, -0.1, 0.08], [-0.14, 0.12, 0.08], [0.14, 0.12, 0.1]]) { const g = new THREE.RingGeometry(r - 0.003, r, 40); g.rotateX(-Math.PI / 2); g.translate(hx + dx, ty1 + 0.0055, dz); put('steel', g, C(0x6a6e72)); }
      box('steel', hx - 0.1, hx + 0.1, ty1 + 0.0052, ty1 + 0.0058, 0.2, 0.235, C(0x7a7e82));
    }
    return { top: ty1, sinks, hobs };
  }
  // colonne toute hauteur : 'oven' (four + four combiné) ou 'fridge' ; x local -w/2..w/2
  function tallUnit(w, kind, o = {}) {
    const fc = C(o.frontC || 0xe8e3da, 0.01), fr = o.front || 'lacquer', hT = H - 0.005;
    walk(() => {
      box('lacquer', -w / 2, w / 2, 0, hT, -0.3, 0.28, C(0xe9e5dd));
      box('lacquer', -w / 2 + 0.005, w / 2 - 0.005, 0, 0.1, 0.18, 0.28, C(0x4a4744));
      const F = (y0, y1, handle = true) => { rbb(fr, -w / 2 + 0.0015, w / 2 - 0.0015, y0 + 0.0015, y1 - 0.0015, 0.28, 0.299, 0.0015, fc, { seg: 1 }); if (handle) { const hl = Math.min(0.42, y1 - y0 - 0.12), hy = y1 - y0 > 1 ? (y0 < 0.6 ? y1 - 0.1 - hl / 2 : y0 + 0.1 + hl / 2) : (y0 + y1) / 2; if (barHandleFn) barHandleFn(o.handleMk || 'brass', w / 2 - 0.045, hy, 0.299, hl, { vertical: true, r: 0.0055, off: 0.026 }); else rbb(o.handleMk || 'brass', w / 2 - 0.05, w / 2 - 0.038, hy - hl / 2, hy + hl / 2, 0.299, 0.318, 0.004, WHITE); } };
      if (kind === 'oven') {
        F(0.1, 0.5); F(0.5, 0.8);
        // four encastré : cadre inox brossé, porte en verre noir (reflets), bandeau de commande (deux manettes, afficheur), poignée barre
        rbb('steel', -w / 2 + 0.004, w / 2 - 0.004, 0.8, 1.38, 0.268, 0.29, 0.004, C(0xc9ccd0));
        rbb('glassBlack', -w / 2 + 0.02, w / 2 - 0.02, 0.81, 1.26, 0.289, 0.302, 0.006, WHITE);
        box('glassBlack', -w / 2 + 0.02, w / 2 - 0.02, 1.28, 1.37, 0.289, 0.3, C(0x2a2b2d));
        for (const s of [-1, 1]) { cyl('steel', 0.019, 0.019, 0.022, s * (w / 2 - 0.09), 1.325, 0.3, C(0xd0d3d6), { rx: Math.PI / 2, seg: 24 }); box('black', s * (w / 2 - 0.09) - 0.002, s * (w / 2 - 0.09) + 0.002, 1.325, 1.34, 0.32, 0.323); }
        box('bulb', -0.05, 0.05, 1.31, 1.34, 0.3, 0.3015);                                       // afficheur
        if (barHandleFn) barHandleFn('steel', 0, 1.235, 0.302, w - 0.14, { r: 0.007, off: 0.03 }); else tube('steel', [[-w / 2 + 0.06, 1.24, 0.33], [w / 2 - 0.06, 1.24, 0.33]], 0.007, WHITE, { seg: 2 });
        box('glassBlack', -w / 2 + 0.003, w / 2 - 0.003, 1.38, 1.83, 0.27, 0.3); tube('steel', [[-w / 2 + 0.06, 1.75, 0.31], [w / 2 - 0.06, 1.75, 0.31]], 0.006, WHITE, { seg: 2 });
        F(1.83, hT);
      } else { F(0.1, 1.55); F(1.55, hT); }
    });
    tallPlan('lacquer', -w / 2, w / 2, -0.3, 0.3, fc);
  }
  // meubles hauts / hotte : x local, sous-face à y0
  function wallUnits(L, y0, o = {}) {
    const fc = C(o.frontC || 0xe8e3da, 0.01), d = 0.35, y1 = H - 0.005, n = Math.max(1, Math.round(L / 0.6));
    walk(() => {
      box('lacquer', -L / 2, L / 2, y0, y1, -0.3, -0.3 + d - 0.02, C(0xe9e5dd));
      for (let i = 0; i < n; i++) { const x0 = -L / 2 + i * L / n + 0.0015, x1 = x0 + L / n - 0.003; rbb(o.front || 'lacquer', x0, x1, y0 + 0.0015, y1 - 0.0015, -0.3 + d - 0.02, -0.3 + d, 0.0015, fc, { seg: 1 }); }
      // hotte tiroir extra-plate en inox (4,5 cm) sous le meuble haut, deux éclairages
      if (o.hood != null) { const hx = o.hood; rbb('steel', hx - 0.3, hx + 0.3, y0 - 0.045, y0, -0.3, -0.3 + d + 0.01, 0.004, C(0xc9ccd0)); box('steel', hx - 0.28, hx + 0.28, y0 - 0.047, y0 - 0.045, -0.28, -0.3 + d - 0.03, C(0x8e9295)); box('bulb', hx - 0.2, hx - 0.15, y0 - 0.048, y0 - 0.047, -0.05, 0.0); box('bulb', hx + 0.15, hx + 0.2, y0 - 0.048, y0 - 0.047, -0.05, 0.0); }
    });
  }
  function splash(L, y0, y1, mk = 'zellige') { box(mk, -L / 2, L / 2, y0, y1, -0.3, -0.292, C(0xffffff)); }
  // îlot : corps, façades côté cuisine, plan débordant côté séjour (+z) ; w selon x, d profondeur
  function island(w, d, o = {}) {
    const fc = C(o.frontC || 0xffffff, 0.01), fr = o.front || 'oak', over = o.over ?? 0.25, body = d - over;
    box('lacquer', -w / 2 + 0.02, w / 2 - 0.02, 0, 0.1, -d / 2 + 0.06, -d / 2 + body - 0.02, C(0x4a4744));
    rbb(fr, -w / 2, w / 2, 0.1, 0.87, -d / 2, -d / 2 + body, 0.003, fc);
    const n = Math.max(2, Math.round(w / 0.6)); for (let i = 1; i < n; i++) { const x = -w / 2 + i * w / n; box('lacquer', x - 0.0015, x + 0.0015, 0.1, 0.87, -d / 2 - 0.001, -d / 2 + 0.002, C(0x3a3836)); }
    for (let i = 0; i < n; i++) { const x = -w / 2 + (i + 0.5) * w / n; rbb('brass', x - 0.08, x + 0.08, 0.81, 0.822, -d / 2 - 0.018, -d / 2, 0.004); }
    slab(o.top || 'stone', w + 0.04, d, 0.04, 0.01, 0, 0.87, 0, C(o.topC || 0xffffff));
    contact(0, 0, w + 0.3, d + 0.3);
  }
  // vaisselle et objets de plan de travail
  function counterDecor(x, z, y, o = {}) {
    // planche à découper, bocaux, bouteille d'huile, plante aromatique
    rbb('oak', x - 0.2, x + 0.2, y, y + 0.022, z - 0.12, z + 0.08, 0.01, C(0xe6d6c4), { ry: 0.1 });
    for (let i = 0; i < 3; i++) { cyl('glassClear', 0.05, 0.05, 0.14 + i * 0.04, x + 0.32 + i * 0.11, y, z - 0.1, WHITE, { seg: 16 }); cyl('oak', 0.05, 0.05, 0.02, x + 0.32 + i * 0.11, y + 0.14 + i * 0.04, z - 0.1, C(0xf6eee4), { seg: 16 }); cyl('paper', 0.044, 0.044, 0.1 + i * 0.03, x + 0.32 + i * 0.11, y + 0.003, z - 0.1, C(pick([0xe8dcc0, 0x9c6a3a, 0xf3efe6])), { seg: 14 }); }
    lathe('glassBlack', [[0, 0], [0.03, 0], [0.03, 0.18], [0.012, 0.22], [0.012, 0.26], [0, 0.26]], x - 0.32, y, z - 0.15, C(0x4a3a1a), { seg: 14 });
    pot(x - 0.45, z - 0.1, 0.06, 0.1, 0xe9e2d6, 1);
    walk(() => { for (let i = 0; i < 9; i++) leafCard([x - 0.45 + jit(0.05), y + 0.09, z - 0.1 + jit(0.05)], 0.1 + R() * 0.05, R() * 6.3, 0.3 + R() * 0.6, 'olive', C(0x7f9a5a, 0.2)); });
  }
  function dishes(x, z, y) { for (let i = 0; i < 4; i++) cyl('ceramic', 0.12, 0.13, 0.014, x, y + i * 0.016, z, C(0xf2eee6), { seg: 30 }); for (let i = 0; i < 3; i++) lathe('stoneware', [[0, 0], [0.035, 0], [0.045, 0.09], [0.04, 0.09], [0, 0.01]], x + 0.24 + i * 0.1, y, z + jit(0.02), C(pick([0xc4754e, 0xe8e0d2, 0x6b7a8a]), 0.05), { seg: 16 }); }

  // ------------------------------------------------------------ salle de bains
  function vanity(w, o = {}) {
    const oak = C(0xf6eee4, 0.03), d = 0.48, y0 = 0.42, y1 = 0.82;
    rbb('oak', -w / 2, w / 2, y0, y1, 0, d - 0.02, 0.004, oak);
    rbb('oak', -w / 2 + 0.003, w / 2 - 0.003, y0 + 0.003, y1 - 0.003, d - 0.02, d, 0.002, oak);
    box('oak', -w / 2 + 0.01, w / 2 - 0.01, (y0 + y1) / 2 - 0.0015, (y0 + y1) / 2 + 0.0015, d - 0.001, d + 0.0005, C(0x6a4a30));
    slab('travertine', w + 0.01, d + 0.01, 0.025, 0.006, 0, y1, d / 2, C(0xffffff));
    const bx = o.basinX || 0;
    const br = Math.min(0.19, w * 0.3); lathe('ceramic', [[0, 0.004], [br * 0.6, 0.006], [br * 0.92, 0.045], [br, 0.13], [br - 0.006, 0.138], [br * 0.88, 0.06], [br * 0.5, 0.03], [0, 0.026]], bx, y1 + 0.025, d / 2 - 0.02, C(0xf6f4ef), { seg: 40 }); cyl('steel', 0.02, 0.02, 0.003, bx, y1 + 0.052, d / 2 - 0.02, C(0x8a8d90), { seg: 16 });
    // robinet mural noir mat
    walk(() => { tube('black', [[bx, y1 + 0.32, 0], [bx, y1 + 0.32, 0.14]], 0.011, WHITE, { seg: 3, rad: 8 }); cyl('black', 0.03, 0.03, 0.012, bx, y1 + 0.32, 0.0, WHITE, { rx: Math.PI / 2, seg: 16 }); cyl('black', 0.008, 0.008, 0.06, bx + 0.12, y1 + 0.32, 0.0, WHITE, { rx: Math.PI / 2, seg: 8 }); });
    // flacons, porte-savon, serviette roulée
    cyl('stoneware', 0.028, 0.028, 0.13, w / 2 - 0.1, y1 + 0.025, 0.12, C(0x8e6a4a)); cyl('black', 0.008, 0.008, 0.03, w / 2 - 0.1, y1 + 0.155, 0.12);
    cyl('ceramic', 0.03, 0.03, 0.1, w / 2 - 0.17, y1 + 0.025, 0.09, C(0xe9e2d6));
    if (w > 0.7) { const ty = y1 + 0.025; for (let i = 0; i < 2; i++) cyl('textile', 0.05, 0.05, 0.2, -w / 2 + 0.15, ty + 0.05, 0.2 - i * 0.1, C(PAL.linenOat), { rz: Math.PI / 2, seg: 16 }); }
    contact(0, d / 2, w + 0.1, d + 0.1);
  }
  function wc() {
    sq('ceramic', 0.18, 0.16, 0.27, 0, 0.4 - 0.02, 0.29, C(0xf6f4ef), { e1: 0.45, e2: 0.55, nu: 24, nv: 12 });
    sq('ceramic', 0.185, 0.015, 0.27, 0, 0.555, 0.29, C(0xf6f4ef), { e1: 0.3, e2: 0.55, nu: 24, nv: 6 });
    rbb('ceramic', -0.15, 0.15, 0.3, 0.5, 0, 0.06, 0.02, C(0xf6f4ef));
    walk(() => { rbb('black', -0.125, 0.125, 0.96, 1.125, 0, 0.008, 0.005, WHITE); rbb('black', -0.105, -0.004, 0.98, 1.105, 0.006, 0.011, 0.004, C(0x55575a)); rbb('black', 0.004, 0.105, 0.98, 1.105, 0.006, 0.011, 0.004, C(0x55575a)); });   // plaque de commande noire mate, double touche
    contact(0, 0.28, 0.5, 0.65);
  }
  // sèche-serviettes échelle noir mat (sur mur z = 0 local), avec serviettes
  function towelRail(w = 0.5, h = 1.2, y0 = 0.25, col = PAL.linenOat) {
    walk(() => {
      for (const s of [-1, 1]) cyl('black', 0.014, 0.014, h, s * w / 2, y0, 0.05, WHITE, { seg: 10 });
      for (let y = y0 + 0.08; y < y0 + h - 0.02; y += 0.11) cyl('black', 0.009, 0.009, w, -w / 2, y, 0.05, WHITE, { rz: -Math.PI / 2, seg: 8 });
      const ty = y0 + h - 0.12; sheet('cloth', 12, 16, (u, v) => { const x = (u - 0.5) * (w - 0.06); const t = v * 1.0; const y = t < 0.5 ? ty - (0.5 - t) * 0.9 : ty - (t - 0.5) * 0.9; const z = 0.05 + (t < 0.5 ? 0.025 : -0.025) + 0.006 * Math.sin(u * 15); return [x, y, z]; }, C(col));
    });
  }
  // paroi de douche fixe : verre clair + profilés noirs, de (x0, z) à (x1, z) local, hauteur h
  function glassPanel(x0, x1, z, y0 = 0.02, h = 2.0) {
    walk(() => {
      box('glassClear', x0, x1, y0, y0 + h, z - 0.004, z + 0.004);
      // profilés noirs : U mural, traverse haute, seuil bas, barre de stabilisation vers le mur
      rbb('black', x0, x1, y0 + h - 0.022, y0 + h, z - 0.011, z + 0.011, 0.003); rbb('black', x0 - 0.002, x0 + 0.022, y0, y0 + h, z - 0.013, z + 0.013, 0.003);
      if (y0 < 0.1) rbb('black', x0, x1, y0, y0 + 0.012, z - 0.009, z + 0.009, 0.002);   // seuil (douche) ; pas sur un pare-baignoire
    });
    P.planOnly(() => box('black', x0, x1, 0, CUT - 0.02, z - 0.006, z + 0.006));
  }
  function showerHead(x, z, y = 2.15) { walk(() => { tube('black', [[x, y + 0.2, z - 0.35], [x, y + 0.2, z]], 0.01, WHITE, { seg: 2, rad: 8 }); cyl('black', 0.12, 0.12, 0.012, x, y + 0.19, z, WHITE, { seg: 32 }); cyl('black', 0.03, 0.03, 0.012, x, 1.05, z - 0.35, WHITE, { rx: Math.PI / 2, seg: 16 }); rbb('black', x - 0.05, x + 0.05, 0.95, 1.15, z - 0.35, z - 0.33, 0.01); }); }
  // carrelage zellige sur un mur : rectangle (x0..x1, y0..y1) au plan z (local), épaisseur 8 mm
  function tileWall(x0, x1, y0, y1, z) { walk(() => box('zellige', x0, x1, y0, y1, z, z + 0.008, C(0xffffff))); }


  // baignoire encastrée : tablier en zellige, rebord en travertin, cuve émaillée (ouverte)
  function bathTub(L = 1.7, W = 0.75) {
    const h = 0.55, rim = 0.07;
    box('zellige', -L / 2, L / 2, 0.06, h - 0.03, W / 2 - 0.01, W / 2, C(0xffffff));
    box('lacquer', -L / 2, L / 2, 0, 0.06, -W / 2, W / 2 - 0.04, C(0x4a4744));
    for (const [x0, x1, z0, z1] of [[-L / 2, L / 2, -W / 2, -W / 2 + rim], [-L / 2, L / 2, W / 2 - rim, W / 2 + 0.01], [-L / 2, -L / 2 + rim, -W / 2 + rim, W / 2 - rim], [L / 2 - rim, L / 2, -W / 2 + rim, W / 2 - rim]]) box('travertine', x0, x1, h - 0.03, h, z0, z1, WHITE);
    const ix0 = -L / 2 + rim, ix1 = L / 2 - rim, iz0 = -W / 2 + rim, iz1 = W / 2 - rim, yb = 0.12, ce = C(0xf6f4ef);
    box('ceramic', ix0, ix1, yb, yb + 0.01, iz0, iz1, ce);
    box('ceramic', ix0, ix0 + 0.01, yb, h - 0.03, iz0, iz1, ce); box('ceramic', ix1 - 0.01, ix1, yb, h - 0.03, iz0, iz1, ce);
    box('ceramic', ix0, ix1, yb, h - 0.03, iz0, iz0 + 0.01, ce); box('ceramic', ix0, ix1, yb, h - 0.03, iz1 - 0.01, iz1, ce);
    cyl('steel', 0.025, 0.025, 0.004, L / 2 - 0.2, yb + 0.01, 0, C(0x55585a));
    // mitigeur de bain sur le rebord, côté mur
    cyl('black', 0.02, 0.02, 0.06, -L / 2 + 0.25, h, -W / 2 + 0.035, WHITE, { seg: 12 });
    tube('black', [[-L / 2 + 0.25, h + 0.05, -W / 2 + 0.035], [-L / 2 + 0.25, h + 0.1, -W / 2 + 0.09], [-L / 2 + 0.25, h + 0.07, -W / 2 + 0.14]], 0.01, WHITE, { seg: 10 });
    // serviette pliée et savon sur le rebord, bouquet d'eucalyptus
    foldedThrow(L / 2 - 0.2, h, -W / 2 + 0.035, 0.28, 0.06, C(PAL.linenOat));
    const vh = vase(L / 2 - 0.035, h, W / 2 - 0.035, 2, 0x3d3a36); branches(L / 2 - 0.035, h + vh, W / 2 - 0.035, 0.35, 4);
  }
  // console d'entrée : plateau chêne sur cadre en métal noir, lampe, vide-poche, livres
  function consoleTable(w = 1.1, d = 0.32) {
    const h = 0.8; slab('oak', w, d, 0.03, 0.01, 0, h - 0.03, 0, C(0xf6eee4));
    for (const s of [-1, 1]) { box('black', s * (w / 2 - 0.04) - 0.008, s * (w / 2 - 0.04) + 0.008, 0, h - 0.03, -d / 2 + 0.03, -d / 2 + 0.046); box('black', s * (w / 2 - 0.04) - 0.008, s * (w / 2 - 0.04) + 0.008, 0, h - 0.03, d / 2 - 0.046, d / 2 - 0.03); box('black', s * (w / 2 - 0.04) - 0.008, s * (w / 2 - 0.04) + 0.008, 0.12, 0.136, -d / 2 + 0.03, d / 2 - 0.03); }
    slab('oak', w - 0.1, d - 0.06, 0.02, 0.005, 0, 0.136, 0, C(0xf6eee4));
    for (let i = 0; i < 2; i++) sq('cloth', 0.14, 0.09, 0.1, -w / 2 + 0.22 + i * 0.32, 0.156 + 0.09, 0, C(pick([0xcdb487, 0xb9b2a6])), { e1: 0.4, e2: 0.25, nu: 16, nv: 10 });
    tableLamp(w / 2 - 0.2, h, -0.03, 1);
    bowl(-0.05, h, 0.02, 0.1, 0x3d3a36);
    bookStack(-w / 2 + 0.22, h, 0.0, 2, 0.2, true);
    contact(0, 0, w + 0.2, d + 0.2);
  }
  // dressing ouvert : montants chêne, penderie, étagères, piles de linge, boîtes
  function dressing(L, d = 0.55) {
    const oak = C(0xf6eee4, 0.03), n = Math.max(2, Math.round(L / 0.8));
    walk(() => {
      for (let i = 0; i <= n; i++) { const x = -L / 2 + i * L / n; box('oak', x - 0.012, x + 0.012, 0, H - 0.01, 0, d, oak); }
      for (let i = 0; i < n; i++) {
        const x0 = -L / 2 + i * L / n + 0.012, x1 = x0 + L / n - 0.024;
        box('oak', x0, x1, H - 0.32, H - 0.3, 0, d, oak); box('oak', x0, x1, 0.05, 0.07, 0, d, oak);
        if (i % 2 === 0) {
          const yr = H - 0.4;
          tube('steel', [[x0, yr, d / 2], [x1, yr, d / 2]], 0.01, C(0x2a2a2a), { seg: 2 });
          // section courte (chemises, vestes, pantalons pliés) au-dessus des boîtes ; section longue (robes, manteaux)
          const long = i > 0, kinds = long ? ['dress', 'coat', 'dress', 'shirt', 'coat', 'dress'] : ['shirt', 'shirt', 'jacket', 'pants', 'shirt', 'jacket', 'pants', 'shirt'];
          let x = x0 + 0.05, k = 0;
          while (x < x1 - 0.04) { const kd = kinds[k++ % kinds.length]; garment(x, yr, d / 2, kd, C(pick(kd === 'coat' || kd === 'jacket' ? [0x3d3a36, 0x5f6b72, 0x8a7a62, 0x2f3a48] : [0xe8e2d6, 0xc8bba5, 0xf3efe8, 0x9aa3a8, 0xb8684a, 0x7d8a6c, 0xd9b99a]), 0.06)); x += (kd === 'coat' || kd === 'jacket' ? 0.085 : 0.06) + R() * 0.03; }
          if (!long) { // boîtes à chaussures en carton lin et panier en jonc sous les vêtements courts
            for (let b = 0; b < 2; b++) rbb('cloth', x0 + 0.04 + b * 0.3, x0 + 0.31 + b * 0.3, 0.07, 0.25, 0.1, 0.45, 0.01, C(b ? 0xd9cdb5 : 0xc8bba5, 0.04));
            rbb('cloth', x0 + 0.06, x0 + 0.29, 0.25, 0.42, 0.12, 0.43, 0.01, C(0xe4dac8, 0.04));
            basket(x1 - 0.17, d / 2, 0.14, 0.3, { linen: PAL.linenStone });
          } else for (let s2 = 0; s2 < 3; s2++) shoes(x0 + 0.14 + s2 * 0.24, d / 2 + 0.05, Math.PI / 2 + jit(0.3), s2 % 2);
        } else for (let y = 0.07; y < H - 0.5; y += 0.36) { box('oak', x0, x1, y + 0.34, y + 0.36, 0, d, oak); for (let x = x0 + 0.02; x < x1 - 0.2; x += 0.24) { let yy = y + 0.36; const nk = 2 + Math.floor(R() * 4), wv = 0.2 + R() * 0.04, dx = jit(0.02), base = pick([0xe8e2d6, 0xc8bba5, 0x9aa3a8, 0xf3efe8, 0xd9b99a, 0x2f3a48, 0x7d8a6c]); if (R() < 0.18) { basket(x + 0.11, d / 2, 0.1, 0.22, { col: 0xb89a6c }); continue; } for (let k = 0; k < nk; k++) { const t = 0.03 + R() * 0.03; rbb('cloth', x + dx + jit(0.012), x + dx + wv, yy, yy + t, 0.08 + jit(0.02), d - 0.05, 0.012 + R() * 0.008, C(R() < 0.6 ? base : pick([0xe8e2d6, 0xc8bba5, 0xf3efe8]), 0.06)); yy += t; } } }
      }
    });
    tallPlan('oak', -L / 2, L / 2, 0, d, oak);
  }

  // ------------------------------------------------------------ passe 3 : stores, suspensions, plantes retombantes, objets de vie
  // store bateau (« roman ») en lin au-dessus d'une fenêtre carrée : repère local mur z = 0, pièce vers +z,
  // fenêtre centrée en x = 0, largeur w ; tablier plat + 3 plis en cascade, à moitié relevé
  function romanBlind(w, yTop = 1.74, drop = 0.42, col = C(PAL.linenOat)) {
    walk(() => {
      rbb('cloth', -w / 2 - 0.03, w / 2 + 0.03, yTop - 0.01, yTop + 0.03, 0.0, 0.05, 0.008, col.map(v => v * 0.96));
      box('cloth', -w / 2 - 0.02, w / 2 + 0.02, yTop - drop + 0.06, yTop, 0.038, 0.044, col);
      for (let i = 0; i < 3; i++) {
        const y = yTop - drop + 0.035 + i * 0.05;
        sq('cloth', w / 2 + 0.02, 0.034, 0.03, 0, y, 0.06 - i * 0.004, col.map(v => v * (0.95 + 0.02 * i)), { e1: 0.6, e2: 0.14, nu: 36, nv: 10, sag: 0.12, wob: 0.002, pinch: 0.1 });
      }
    });
  }
  // rideaux de lin à plis, repère local mur z = 0 : panneaux [x0, x1] (repliés), rail plafond de r0 à r1
  function linenPanels(spans, r0, r1, col, z = 0.1) {
    walk(() => {
      for (const [x0, x1] of spans) pleated('cloth', x0, x1, z, col, { lam: 0.07, amp: 0.048 });
      box('black', r0, r1, H - 0.03, H - 0.002, z - 0.012, z + 0.012, WHITE);
    });
  }
  // suspension : 0 = tambour en lin (chambres), 1 = globe opalin (dégagements, salles d'eau), 2 = cloche en grès
  function pendant(x, z, yb = 1.95, kind = 0, r = 0.2, col = 0xefe6d6) {
    if (P.markPendant) P.markPendant(x, z, r);
    walk(() => {
      let top = yb;
      if (kind === 3) { // abat-jour plissé en papier de lin (Ø 2r), plis radiaux, galon laiton en tête
        const h = r * 0.62, g = new THREE.CylinderGeometry(r * 0.62, r, h, 96, 3, true), pa = g.attributes.position;
        for (let i = 0; i < pa.count; i++) { const px = pa.getX(i), pz = pa.getZ(i), a = Math.atan2(pz, px), k = 1 + 0.045 * Math.abs(Math.sin(a * 24)); pa.setX(i, px * k); pa.setZ(i, pz * k); }
        g.computeVertexNormals(); g.translate(x, yb + h / 2, z); put('shade', g, C(col));
        torus('brass', r * 0.62, 0.004, x, yb + h, z, WHITE, { seg: 48, rad: 4 });
        sq('bulb', 0.035, 0.045, 0.035, x, yb + h * 0.45, z, WHITE, { e1: 1, e2: 1, nu: 8, nv: 6 });
        top = yb + h;
      } else if (kind === 0) {
        lathe('shade', [[r, 0], [r * 1.002, 0.13], [r, 0.26]], x, yb, z, C(col), { seg: 48 });
        for (const y of [yb + 0.003, yb + 0.257]) torus('brass', r, 0.0035, x, y, z, WHITE, { seg: 48, rad: 4 });
        for (let i = 0; i < 3; i++) { const a = i * 2.094; tube('brass', [[x, yb + 0.2, z], [x + Math.cos(a) * r, yb + 0.257, z + Math.sin(a) * r]], 0.002, WHITE, { seg: 2, rad: 3 }); }
        sq('bulb', 0.03, 0.04, 0.03, x, yb + 0.15, z, WHITE, { e1: 1, e2: 1, nu: 8, nv: 6 });
        top = yb + 0.2;
      } else if (kind === 1) {
        sq('shade', r, r * 0.96, r, x, yb + r, z, C(0xfbf8f2), { e1: 1, e2: 1, nu: 30, nv: 18 });
        cyl('brass', 0.032, 0.026, 0.05, x, yb + 2 * r - 0.02, z, WHITE, { seg: 20 });
        top = yb + 2 * r + 0.03;
      } else {
        lathe('stoneware', [[r, 0], [r * 0.97, 0.03], [r * 0.82, 0.12], [r * 0.45, 0.2], [0.03, 0.23], [0, 0.23]], x, yb, z, C(col, 0.03), { seg: 36 });
        sq('bulb', 0.03, 0.035, 0.03, x, yb + 0.07, z, WHITE, { e1: 1, e2: 1, nu: 8, nv: 6 });
        top = yb + 0.23;
      }
      cyl('black', 0.0025, 0.0025, H - top, x, top, z, WHITE, { seg: 4 });
      cyl('lacquer', 0.045, 0.045, 0.014, x, H - 0.014, z, C(0xf2f0ea), { seg: 24 });
    });
  }
  // pothos en pot sur un plan (étagère, vasque, buffet) : lianes qui retombent vers dir (rad, sens +z local à 0)
  function pothos(x, y, z, o = {}) {
    const n = o.n || 7, reach = o.reach || 0.45, dir = o.dir ?? 0, spread = o.spread ?? 1.3, pc = o.pot || 0xe8e0d2;
    lathe('stoneware', [[0, 0], [0.045, 0], [0.05, 0.01], [0.064, 0.09], [0.068, 0.11], [0.06, 0.11], [0.058, 0.1], [0, 0.1]], x, y, z, C(pc, 0.05), { seg: 28 });
    disc('soil', 0.057, x, y + 0.1, z, C(0x4e3c30), 16);
    walk(() => {
      for (let s = 0; s < n; s++) {
        const a = dir + (s / Math.max(1, n - 1) - 0.5) * 2 * spread + jit(0.25), L = reach * (0.45 + R() * 0.75), ca = Math.sin(a), sa = Math.cos(a);
        const p0 = [x + ca * 0.02, y + 0.1, z + sa * 0.02], p1 = [x + ca * 0.09, y + 0.15 + R() * 0.04, z + sa * 0.09], p2 = [x + ca * 0.15, y + 0.08, z + sa * 0.15];
        const p3 = [x + ca * (0.17 + R() * 0.05), y + 0.1 - L * 0.55, z + sa * (0.18 + R() * 0.04)], p4 = [x + ca * (0.15 + R() * 0.08), y + 0.1 - L, z + sa * (0.2 + R() * 0.05)];
        const pts = curvePts(L > 0.12 ? [p0, p1, p2, p3, p4] : [p0, p1, p2], 12);
        stem('leafG', pts, 0.0025, 0.0018, C(0x7f8f45), 3, 12);
        for (let k = 1; k <= 12; k++) {
          const q = pts[k], d = [q[0] - pts[k - 1][0], q[1] - pts[k - 1][1], q[2] - pts[k - 1][2]], [daz] = dirOf(d), sd = k % 2 ? 1 : -1, sz = 0.045 + 0.03 * R() * (1 - k / 16);
          leaf('leafG', 'basil', q, daz + sd * 1.25 + jit(0.4), 0.15 + jit(0.6), { L: sz, W: sz * 0.85, fold: 0.18, droop: 0.12, curl: -0.12, twist: jit(0.4) }, C(pick([0xffffff, 0xf0f6d8, 0xe4ecc4, 0xfaf8e0]), 0.12));
        }
      }
    });
  }
  // panier tressé (jonc de mer) : parois côtelées, bord roulé ; o.linen : linge qui dépasse
  function basket(x, z, r = 0.2, h = 0.42, o = {}) {
    const col = C(o.col || 0xb89a6c, 0.05), pts = [[0, 0], [r * 0.88, 0]];
    for (let i = 0; i <= 14; i++) { const t = i / 14; pts.push([r * (0.9 + 0.1 * t) + (i % 2 ? 0.004 : 0), 0.01 + t * (h - 0.02)]); }
    pts.push([r + 0.012, h], [r - 0.006, h + 0.008], [r - 0.014, h - 0.01], [r * 0.85, h - 0.04]);
    lathe('textile', pts, x, 0, z, col, { seg: 40 });
    torus('textile', r + 0.002, 0.012, x, h, z, col.map(v => v * 0.9), { seg: 40, rad: 6 });
    if (o.linen) sq('cloth', r * 0.85, 0.07, r * 0.8, x, h - 0.02, z, C(o.linen, 0.03), { e1: 0.6, e2: 0.5, crease: 0.25, wob: 0.006, nu: 20, nv: 10 });
    if (o.throw) sq('cloth', r * 0.75, 0.12, r * 0.6, x + 0.02, h + 0.02, z, C(o.throw, 0.03), { e1: 0.5, e2: 0.4, crease: 0.3, wob: 0.008, rz: 0.4, nu: 20, nv: 10 });
    contact(x, z, r * 2.6, r * 2.6);
  }
  // serviette suspendue à une patère (repère local mur z = 0) ; col
  function hookTowel(x, y, w = 0.32, len = 0.5, col = C(PAL.linenOat)) {
    walk(() => {
      cyl('black', 0.012, 0.012, 0.05, x, y, 0.0, WHITE, { rx: Math.PI / 2, seg: 10 });
      sq('cloth', w / 2, len / 2, 0.022, x, y - len / 2 + 0.02, 0.045, col, { e1: 0.25, e2: 0.35, pinch: -0.05, crease: 0.12, wob: 0.004, nu: 16, nv: 18 });
      torus('cloth', 0.02, 0.006, x, y + 0.01, 0.04, col, { rx: Math.PI / 2, seg: 10, rad: 4 });
    });
  }
  // dérouleur de papier (noir mat) + rouleau, repère local mur z = 0
  function rollHolder(x, y) {
    walk(() => {
      cyl('black', 0.02, 0.02, 0.012, x, y, 0, WHITE, { rx: Math.PI / 2, seg: 14 });
      cyl('black', 0.006, 0.006, 0.14, x, y, 0.06, WHITE, { rz: Math.PI / 2, seg: 6 });
      tube('black', [[x, y, 0.012], [x, y, 0.06]], 0.006, WHITE, { seg: 2, rad: 6 });
      cyl('cloth', 0.055, 0.055, 0.1, x + 0.02, y, 0.06, C(0xf8f6f1), { rz: Math.PI / 2, seg: 20 });
    });
  }
  // paire de chaussures posée (baskets toile ou mocassins), centre (x, z), orientée ry
  function shoes(x, z, ry = 0, kind = 0) {
    const col = C(kind ? 0x5a3e2c : 0xefebe3, 0.04), so = C(kind ? 0x2a2522 : 0xd9d2c4);
    for (const s of [-1, 1]) {
      const dx = s * 0.06, dz = s * 0.02, cs = Math.cos(ry), sn = Math.sin(ry), px = x + dx * cs + dz * sn, pz = z - dx * sn + dz * cs, rr = ry + s * 0.05;
      rbb('ceramic', px - 0.047, px + 0.047, 0, 0.02, pz - 0.132, pz + 0.132, 0.008, so, { ry: rr });
      sq(kind ? 'lacquer' : 'textile', 0.046, kind ? 0.03 : 0.04, 0.125, px, 0.018 + (kind ? 0.026 : 0.036), pz, col, { e1: 0.6, e2: 0.5, pinch: 0.2, nu: 18, nv: 8, ry: rr });
    }
  }

  // vêtement sur cintre : plan du vêtement perpendiculaire à la tringle (le long de x), épaules, tombé, plis
  function garment(x, yr, zc, kind, col) {
    const hw = kind === 'pants' ? 0.16 : 0.2, len = { shirt: 0.78, jacket: 0.72, pants: 0.5, dress: 1.12, coat: 1.04 }[kind] || 0.8, th = kind === 'coat' || kind === 'jacket' ? 0.03 : 0.014, ph = R() * 6;
    const y0 = yr - 0.05, flare = kind === 'dress' ? 0.06 : kind === 'coat' ? 0.03 : 0.005;
    tube('steel', [[x, y0 + 0.02, zc], [x, yr + 0.035, zc + 0.012], [x, yr + 0.03, zc - 0.012]], 0.0025, C(0x2a2a2a), { seg: 8, rad: 3 });
    if (kind !== 'pants') tube('oak', [[x, y0 - 0.03, zc - hw + 0.02], [x, y0 + 0.01, zc], [x, y0 - 0.03, zc + hw - 0.02]], 0.006, C(0xe6d6c4), { seg: 10, rad: 4 });
    else tube('oak', [[x, y0 - 0.05, zc - hw], [x, y0 - 0.05, zc + hw]], 0.006, C(0xe6d6c4), { seg: 2, rad: 4 });
    const f = (sgn) => (u, v) => {
      const sh = kind === 'pants' ? hw : v < 0.1 ? 0.07 + (hw - 0.07) * Math.sin(v / 0.1 * Math.PI / 2) : hw + flare * (v - 0.1) / 0.9;
      const zz = zc + (u - 0.5) * 2 * sh, y = (kind === 'pants' ? y0 - 0.05 : y0 - 0.02) - v * len;
      const bul = th * Math.pow(Math.sin(u * Math.PI), 0.6) * Math.min(1, 0.3 + v * 4), fold = 0.009 * Math.sin(u * Math.PI * 4 + ph + v * 2) * Math.min(1, v * 2);
      return [x + sgn * bul + fold, y, zz];
    };
    sheet('cloth', 8, 10, f(1), col); sheet('cloth', 8, 10, f(-1), col.map(c => c * 0.92));
    if (kind === 'coat' || kind === 'jacket') for (const sd of [-1, 1]) stem('cloth', [[x, y0 - 0.06, zc + sd * (hw - 0.01)], [x + 0.01, y0 - 0.3, zc + sd * (hw + 0.005)], [x + 0.015, y0 - 0.58, zc + sd * (hw - 0.02)]], 0.035, 0.03, col.map(c => c * 0.95), 6);
  }
  // pouf rond (bouclé ou lin)
  function pouf(r = 0.23, h = 0.42, col = PAL.boucle, mk = 'boucle') {
    sq(mk, r, h / 2, r, 0, h / 2, 0, C(col, 0.02), { e1: 0.32, e2: 1, pinch: 0.15, puff: 0.08, sag: 0.05, nu: 32, nv: 14 });
    contact(0, 0, 2 * r + 0.15, 2 * r + 0.15);
  }
  // table ovale (« stade ») en chêne, deux pieds tulipe
  function ovalTable(w = 1.7, d = 0.9) {
    const oak = C(0xfaf3ea, 0.03);
    slab('oak', w, d, 0.035, d / 2 - 0.002, 0, 0.72, 0, oak, { curve: 16 });
    for (const s of [-1, 1]) lathe('oak', [[0, 0], [0.22, 0], [0.22, 0.02], [0.1, 0.05], [0.07, 0.35], [0.09, 0.66], [0.16, 0.72], [0, 0.72]], s * w * 0.27, 0, 0, oak, { seg: 32 });
    contact(0, 0, w + 0.6, d + 0.6);
  }
  // fauteuil bas d'extérieur : cadre teck, dossier en corde tressée, coussins de lin ; face vers +z
  function loungeChair(o = {}) {
    const teak = C(0x9a6a44, 0.04), rope = C(o.rope || 0xcdbb9c, 0.04), W = 0.74, Dp = 0.78;
    for (const sx of [-1, 1]) {
      rbb('oak', sx * W / 2 - 0.025, sx * W / 2 + 0.025, 0, 0.58, Dp / 2 - 0.06, Dp / 2 - 0.01, 0.008, teak);          // pieds avant + accoudoir
      rbb('oak', sx * W / 2 - 0.025, sx * W / 2 + 0.025, 0, 0.74, -Dp / 2 + 0.01, -Dp / 2 + 0.06, 0.008, teak, { rx: -0.12 });
      rbb('oak', sx * W / 2 - 0.03, sx * W / 2 + 0.03, 0.56, 0.6, -Dp / 2, Dp / 2, 0.01, teak);                        // accoudoir
    }
    for (const sz of [-1, 1]) rbb('oak', -W / 2, W / 2, 0.24, 0.28, sz * (Dp / 2 - 0.04) - 0.02, sz * (Dp / 2 - 0.04) + 0.02, 0.006, teak);
    for (let i = 0; i < 9; i++) { const y = 0.32 + i * 0.045; tube('textile', [[-W / 2 + 0.03, y, -Dp / 2 + 0.06 - (y - 0.3) * 0.12], [0, y + 0.004, -Dp / 2 + 0.05 - (y - 0.3) * 0.12], [W / 2 - 0.03, y, -Dp / 2 + 0.06 - (y - 0.3) * 0.12]], 0.009, rope, { seg: 8, rad: 5 }); }
    sq('textile', W / 2 - 0.05, 0.06, Dp / 2 - 0.06, 0, 0.34, 0.02, C(o.col || PAL.linenOat, 0.02), { e1: 0.22, e2: 0.15, pinch: 0.25, puff: 0.15, crease: 0.08, nu: 22, nv: 10 });
    pillow(0, 0.56, -Dp / 2 + 0.17, 0.45, 0.14, C(o.pillow || PAL.ochre), { rx: -Math.PI / 2 + 0.35 });
    contact(0, 0, W + 0.2, Dp + 0.2);
  }
  // chaise bistrot pliante en métal noir, assise et dossier à lattes ; face vers +z
  function bistroChair(o = {}) {
    const c = C(o.col || 0x2b2d2f);
    for (const sx of [-1, 1]) { tube('black', [[sx * 0.2, 0, 0.2], [sx * 0.19, 0.45, 0.0], [sx * 0.18, 0.86, -0.2]], 0.011, c, { seg: 10, rad: 6 }); tube('black', [[sx * 0.2, 0, -0.22], [sx * 0.19, 0.45, 0.02]], 0.011, c, { seg: 4, rad: 6 }); }
    for (let i = 0; i < 4; i++) rbb('black', -0.19, 0.19, 0.44, 0.455, -0.17 + i * 0.09, -0.11 + i * 0.09, 0.004, c);
    for (let i = 0; i < 2; i++) rbb('black', -0.18, 0.18, 0.64 + i * 0.11, 0.7 + i * 0.11, -0.12 - i * 0.05, -0.105 - i * 0.05, 0.004, c, { rx: -0.42 });
    if (o.cushion) sq('textile', 0.17, 0.025, 0.17, 0, 0.48, -0.02, C(o.cushion), { e1: 0.2, e2: 0.15, sag: 0.2, nu: 16, nv: 8 });
    contact(0, 0, 0.55, 0.6);
  }
  // guéridon bistrot (plateau rond, pied central) : métal noir ou teck
  function bistroTable(r = 0.3, h = 0.72, top = 'black') {
    const c = top === 'oak' ? C(0x9a6a44, 0.04) : C(0x2b2d2f);
    cyl(top, r, r, 0.025, 0, h - 0.025, 0, c, { seg: 36 }); cyl('black', 0.018, 0.018, h - 0.03, 0, 0, 0, WHITE, { seg: 10 });
    for (let i = 0; i < 3; i++) { const a = i * 2.094; tube('black', [[0, 0.12, 0], [Math.cos(a) * 0.22, 0.01, Math.sin(a) * 0.22]], 0.012, WHITE, { seg: 3, rad: 5 }); }
    contact(0, 0, 2 * r + 0.3, 2 * r + 0.3);
  }
  // lanterne en métal noir et verre, bougie (s'allume le soir comme les lampes)
  function lantern(x, z, h = 0.42, y0 = 0) {
    const s = h * 0.42;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box('black', x + sx * s / 2 - 0.008, x + sx * s / 2 + 0.008, y0, y0 + h, z + sz * s / 2 - 0.008, z + sz * s / 2 + 0.008);
    box('black', x - s / 2 - 0.01, x + s / 2 + 0.01, y0, y0 + 0.02, z - s / 2 - 0.01, z + s / 2 + 0.01); box('black', x - s / 2 - 0.01, x + s / 2 + 0.01, y0 + h - 0.02, y0 + h, z - s / 2 - 0.01, z + s / 2 + 0.01);
    lathe('black', [[s * 0.55, 0], [s * 0.3, 0.06], [0, 0.08]], x, y0 + h, z, WHITE, { seg: 4 }); torus('black', 0.03, 0.005, x, y0 + h + 0.1, z, WHITE, { rx: Math.PI / 2, seg: 16, rad: 4 });
    box('glassClear', x - s / 2 + 0.005, x + s / 2 - 0.005, y0 + 0.02, y0 + h - 0.02, z - s / 2 + 0.005, z + s / 2 - 0.005);
    cyl('lacquer', 0.04, 0.04, h * 0.32, x, y0 + 0.02, z, C(0xf2ece0), { seg: 16 }); sq('bulb', 0.012, 0.022, 0.012, x, y0 + 0.04 + h * 0.32, z, WHITE, { e1: 1, e2: 1, nu: 8, nv: 6 });
  }
  // applique murale laiton (repère local mur z = 0, pièce vers +z), petit abat-jour en lin
  function sconce(x, y) {
    walk(() => {
      cyl('brass', 0.045, 0.045, 0.012, x, y, 0, WHITE, { rx: Math.PI / 2, seg: 24 });
      tube('brass', [[x, y, 0.012], [x, y + 0.02, 0.12], [x, y + 0.08, 0.17]], 0.006, WHITE, { seg: 8, rad: 6 });
      lathe('shade', [[0.085, 0], [0.06, 0.13]], x, y + 0.02, 0.17, C(0xf4ecdf), { seg: 28 });
      sq('bulb', 0.02, 0.025, 0.02, x, y + 0.08, 0.17, WHITE, { e1: 1, e2: 1, nu: 8, nv: 6 });
    });
  }

  // bibliothèque ouverte en chêne (dos au mur z = 0, façade +z) : livres, céramiques, boîtes, pothos en haut
  function bookcase(w = 1.1, h = 1.85, d = 0.34) {
    const oak = C(0xf6eee4, 0.03), n = 5, t = 0.024, y0 = 0.07, sp = (h - y0 - t) / (n - 1);
    for (const s of [-1, 1]) rbb('oak', s * w / 2 - (s > 0 ? t : 0), s * w / 2 + (s < 0 ? t : 0), 0, h, 0, d, 0.003, oak);
    box('oak', -w / 2 + t, w / 2 - t, 0, y0, 0.03, d - 0.02, C(0x8a6a4c));
    box('oak', -w / 2 + t, w / 2 - t, y0, h, 0, 0.01, oak);
    for (let i = 0; i < n; i++) { const y = y0 + i * sp; rbb('oak', -w / 2 + t, w / 2 - t, y, y + t, 0.01, d, 0.003, oak); }
    const zc = d * 0.5, L = -w / 2 + t + 0.02, Rr = w / 2 - t - 0.02;
    for (let i = 0; i < n - 1; i++) {
      const y = y0 + i * sp + t;
      if (i === 0) { for (const x of [L + 0.2, Rr - 0.2]) { rbb('cloth', x - 0.18, x + 0.18, y, y + 0.25, 0.03, d - 0.02, 0.025, C(0xcdc2ad, 0.04)); rbb('oak', x - 0.04, x + 0.04, y + 0.17, y + 0.2, d - 0.025, d - 0.012, 0.006, C(0x8a6a4c)); } continue; }
      if (i === 1) { bookRow(L, L + w * 0.5, y, zc); const yy = bookStack(Rr - 0.18, y, zc, 3, 0.15, true); vase(Rr - 0.18, yy, zc, 1, 0x9c5236); continue; }
      if (i === 2) { vase(L + 0.12, y, zc, 0, 0xe8dfd0); bookRow(L + 0.3, Rr - 0.05, y, zc); continue; }
      bookStack(L + 0.17, y, zc, 2, -0.1, true); bowl(0.05, y, zc, 0.1, 0x3d3a36); pothos(Rr - 0.12, y, zc + 0.04, { n: 6, reach: 0.5, dir: 0, spread: 1.2 });
    }
    candle(Rr - 0.25, h, zc, 0.1); vase(L + 0.2, h, zc, 2, 0xd9cfbf);
    contact(0, d / 2, w + 0.15, d + 0.2);
  }

  // chemin de table en lin (table de longueur L selon x, plateau à y) : retombe de 18 cm aux deux bouts
  function runner(L, w, y, col) {
    const c = C(col, 0.02), hang = 0.18;
    sheet('cloth', 40, 4, (u, v) => {
      const s = (u - 0.5) * (L + 2 * hang), ex = Math.max(0, Math.abs(s) - L / 2), z = (v - 0.5) * w + 0.004 * Math.sin(u * 31);
      const x = Math.sign(s) * (Math.min(Math.abs(s), L / 2) + Math.min(ex, 0.006));
      return [x, y + 0.004 - ex + 0.002 * Math.sin(u * 17), z];
    }, c);
  }
  // couvert : assiette plate + creuse en grès, verre, serviette pliée ; face vers +z local tourné de ry
  function placeSetting(x, y, z, ry = 0) {
    const cs = Math.cos(ry), sn = Math.sin(ry), T = (lx, lz) => [x + lx * cs + lz * sn, z - lx * sn + lz * cs];
    lathe('stoneware', [[0, 0], [0.09, 0], [0.12, 0.012], [0.135, 0.02], [0.13, 0.022], [0.1, 0.012], [0, 0.008]], x, y, z, C(0xe9e2d6, 0.04), { seg: 36 });
    lathe('stoneware', [[0, 0.008], [0.05, 0.008], [0.08, 0.04], [0.085, 0.058], [0.08, 0.058], [0.07, 0.04], [0, 0.016]], x, y, z, C(0x9c5236, 0.05), { seg: 30 });
    const [gx, gz] = T(0.17, -0.07); lathe('glassClear', [[0, 0], [0.03, 0], [0.034, 0.1], [0.031, 0.1], [0.027, 0.006], [0, 0.006]], gx, y, gz, WHITE, { seg: 20 });
    const [nx, nz] = T(-0.18, 0.0); rbb('cloth', nx - 0.05, nx + 0.05, y, y + 0.012, nz - 0.1, nz + 0.1, 0.004, C(PAL.linenSand), { ry });
    const [fx, fz] = T(-0.18, 0.0); box('steel', fx - 0.006, fx + 0.006, y + 0.012, y + 0.016, fz - 0.09, fz + 0.09, C(0x8e9295), { ry });
  }

  const D0 = {
    garment, pouf, ovalTable, loungeChair, bistroChair, bistroTable, lantern, sconce,
    runner, placeSetting, bookcase, romanBlind, linenPanels, pendant, pothos, basket, hookTowel, rollHolder, shoes,
    bathTub, consoleTable, dressing, strelitzia, herbs, leaf, stem, pleated, thickSheet,
    R, C, PAL, WHITE, box, rb, rbb, cyl, lathe, tube, torus, sq, sheet, slab, disc, contact, walk, at,
    book, bookStack, bookRow, vase, branches, bowl, candle, tray, fruitBowl, leafCard, pot, figTree, oliveTree, snakePlant,
    tableLamp, floorLamp, akari, dome, pillow, rugF, plaidOverArm, foldedThrow,
    sofa, armchair, chair, barStool, coffeeTable, sideTable, roundTable, rectTable, tableDecor, sideboard, wardrobe, wallShelf, bench, desk, nightstand, bed,
    art, roundMirror, rectMirror, pegRail, sheers, drapes,
    baseRun, tallUnit, wallUnits, splash, island, counterDecor, dishes,
    vanity, wc, towelRail, glassPanel, showerHead, tileWall, tallPlan,
    model: (id, o, proxy) => P.model(id, o, proxy),
    put, seamLoop, fallOf,
  };
  // mobilier « catalogue » de furniture.js : canapé, chaise wishbone, table chêne, robinet
  if (typeof location !== 'undefined' && /[?&]fx=0/.test(location.search)) return D0;   // diagnostic : mobilier d'origine
  const FX = createFurniture(THREE, D0);
  Object.assign(D0, { sofa: FX.sofa, chair: FX.chair, rectTable: FX.rectTable, cushion: FX.cushion, strut: FX.strut, ribbon: FX.ribbon,
    vanity: FX.vanity, towelRail: FX.towelRail, showerHead: FX.showerSet, barHandle: FX.barHandle, bathTub: FX.bathTub });
  barHandleFn = FX.barHandle; puffBoxFn = FX.puffBox;
  kitchenTap = FX.kitchenTap; fxCushion = FX.cushion;
  return D0;
}

// ================================================================== aménagement des deux lots d'un étage courant
// Coordonnées absolues (m) issues du plan de lots.js (planUpper). yaw des meubles : 0 = façade vers +z.
// Même implantation par zone (circulation validée), parti décoratif propre à chaque lot (o.level : 1, 2, 3) :
//   zone A — 101 « sauge, encre et jute », 201 « japandi sable » (lot de l'expérience d'accueil), 302 « attique rouille et laiton »
//   zone B — 102 « sauge et encre », 202 « encre et sauge », 301 « encre et ocre »
const PI = Math.PI;
export function furnishUpper(THREE, P, D, o = {}) {
  const { PAL, C, at, walk } = D, ART = { arcs: 0, line: 1, dune: 2, enso: 3, leaf: 4, blocks: 5, sea: 6, sketch: 7 };
  const suite = !!o.suite, lv = o.level || 2;
  const face = (x, z, ry, fn) => at(x, z, ry, fn);          // objets muraux : dos au plan du mur
  const FUR = P.furniture || [];
  // un seul volume de collision pour un ensemble (table + chaises, tabourets) : plus de fente où la caméra se coince
  const one = (fn) => { const n0 = FUR.length; fn(); const parts = FUR.splice(n0); if (!parts.length) return; const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (const b of parts) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], b.min[k]); mx[k] = Math.max(mx[k], b.max[k]); } FUR.push({ kind: 'meuble', min: mn, max: mx }); };
  // meubles hauts (armoires, colonnes, bibliothèques) : marge de 10 cm, la caméra ne voit plus au travers
  // mobilier photogrammétrique (models.js) : le meuble procédural sert de doublure jusqu'au chargement
  const M3 = (id, fit, proxy, o = {}) => {
    D.model(id, { fit, ...o }, proxy);
    // ombre de contact du modèle (celle de la doublure disparaît avec elle) : meubles et plantes posés au sol
    if (o.y == null && MODEL_CATALOG[id] && MODEL_CATALOG[id].kind !== 'objet') { const [fw, , fd] = fitSize(id, fit); D.at(o.x || 0, o.z || 0, o.ry || 0, () => D.contact(0, 0, fw + 0.18, fd + 0.18)); }
  };
  const NS = (w = 0.46, d = 0.4) => (proxy) => M3('side_table_01', { w, h: 0.5, d }, proxy);   // chevet chêne à deux plateaux
  const plantK = (k, h, proxy) => k === 'pp01' ? M3('potted_plant_01', { h: h || 1.55 }, proxy) : k === 'pp02' ? M3('potted_plant_02', { h: h || 0.95 }, proxy) : proxy();
  const tall = (x, z, ry, fn) => { const n0 = FUR.length; at(x, z, ry, fn); for (let i = n0; i < FUR.length; i++) { const b = FUR[i]; b.min[0] -= 0.1; b.min[2] -= 0.1; b.max[0] += 0.1; b.max[2] += 0.1; b.max[1] = Math.max(b.max[1], b.min[1] + 2.0); } };

  // ======================= LOT A (côté rue) =======================
  const VA = {
    1: { // 101 — sauge, bleu encre, jute ; table en travertin
      sofa: { col: PAL.sage, base: 'legs', pillows: [PAL.ink, PAL.ochre, PAL.linenOat], plaid: PAL.linenOat }, arm: { pillow: PAL.ink },
      rug: ['jute', C(0xf2ead8), false], artSofa: () => { D.art(-0.36, 1.58, 0.62, 0.84, ART.sketch, { frame: 'black' }); D.art(0.36, 1.58, 0.62, 0.84, ART.line, { frame: 'black' }); },
      table: 'trav', chairSeat: PAL.linenOat, plantDining: 'snake', plantBay: 'pp01', artWest: [ART.enso, ART.dune],
      ch1: { head: PAL.terracotta, throw: PAL.ink, accent: PAL.ochre, pend: [0, 0.24, 0xe4dac8], art: ART.sea }, ch2: { head: PAL.sage, accent: PAL.mustard, throw: PAL.linenStone, pend: [2, 0.17, 0xa9b39b] },
      ch3: { head: PAL.linenGreige, accent: PAL.ink, throw: PAL.ochre, pend: 'akari' }, domes: 'black',
    },
    2: { // 201 — japandi sable (inchangé : lot de l'expérience d'accueil)
      sofa: { col: PAL.linenSand, pillows: [PAL.terracotta, PAL.linenOat, PAL.ochre, PAL.sage], plaid: PAL.rust }, arm: { pillow: PAL.ochre },
      rug: ['rug', undefined, true], artSofa: () => D.art(0, 1.55, 1.1, 0.8, ART.arcs),
      table: 'oak', chairSeat: PAL.straw, plantDining: 'pp01', plantBay: 'olive', artWest: [ART.leaf, ART.blocks],
      ch1: { head: PAL.linenGreige, throw: PAL.ochre, accent: PAL.terracotta, pend: [0, 0.24, 0xeee5d5], art: ART.line }, ch2: { head: PAL.sage, accent: PAL.ochre, throw: PAL.linenStone, pend: [0, 0.19, 0xe6ddcd] },
      ch3: { head: PAL.linenOat, accent: PAL.sage, throw: PAL.terracotta, pend: [0, 0.19, 0xeee5d5] }, domes: 'black',
    },
    3: { // 302 — attique : bouclé rouille, laiton, grande table ovale, olivier côté baie
      sofa: { col: PAL.linenGreige, mk: 'velvet', pillows: [PAL.rust, PAL.ochre, PAL.linenSand], plaid: PAL.charcoal }, arm: { pillow: PAL.rust },
      rug: ['wool', C(0xe8e1d4), false], artSofa: () => D.art(0, 1.6, 1.4, 1.0, ART.sea, { frame: 'oak', mat: 0.08 }),
      table: 'oval', chairSeat: PAL.linenGreige, plantDining: 'olive', plantBay: 'pp02', artWest: [ART.arcs, ART.sketch],
      ch1: { head: PAL.rust, headMk: 'boucle', throw: PAL.linenSand, accent: PAL.ochre, pend: [3, 0.3, 0xf1e9dc], art: ART.leaf }, ch2: { head: PAL.linenSand, accent: PAL.rust, throw: PAL.clay, pend: [0, 0.19, 0xe6ddcd] },
      ch3: { head: PAL.ink, accent: PAL.ochre, throw: PAL.linenOat, pend: 'akari' }, domes: 'brass',
    },
  }[lv] || {};
  const VAc = VA.sofa ? VA : null;
  if (VAc) furnishA(VAc);
  function furnishA(V) {
    // --- séjour : canapé 2,20 m recentré (passage îlot / canapé ≈ 70 cm), fauteuil tourné vers le canapé près de la baie
    at(3.6, -4.45, 0, () => D.rugF(2.0, 1.8, V.rug[0], V.rug[1], V.rug[2]));
    at(3.6, -5.38, 0, () => D.sofa(2.2, V.sofa));
    // table basse : béton ciré et chêne (101, 201), marbre et métal noir (302) ; composition posée dessus
    at(3.6, -4.22, 0, () => {
      if (lv === 3) M3('coffee_table_round_01', { w: 0.9, d: 0.9, h: 0.36 }, () => D.coffeeTable({ w: 1.1, d: 0.6, decor: false }));
      else M3('modern_coffee_table_01', { w: 1.1, h: 0.36, d: 0.56 }, () => D.coffeeTable({ w: 1.1, d: 0.6, decor: false }));
      D.coffeeTable({ w: lv === 3 ? 0.9 : 1.0, d: 0.56, h: 0.36, table: false });
    });
    // fauteuil : chêne et cuir noir (101, 302), fauteuil pivotant en cuir cognac (201)
    at(4.05, -2.3, -2.88, () => lv === 2 ? M3('mid_century_lounge_chair', { h: 0.95 }, () => D.armchair(V.arm)) : M3('modern_arm_chair_01', { h: 0.9 }, () => D.armchair(V.arm)));
    at(5.2, -5.57, 0, () => D.floorLamp(0, 0));
    const plant = (k, x, z) => at(x, z, 0, () => plantK(k, 0, () => k === 'olive' ? D.oliveTree(0, 0, 1.8, 0xcfc6b8) : k === 'fig' || k === 'pp01' ? D.figTree(0, 0, 1.7, 0xd9cfbf) : D.snakePlant(0, 0, 0.95, 0xe7dfd1)));
    plant(V.plantBay, 5.12, -2.12);
    plant(V.plantDining, -0.6, -1.88);
    face(3.6, -5.86, 0, V.artSofa);
    D.sheers(0.82, 1.45, -1.74, { r0: 0.8, r1: 5.2 });
    D.sheers(4.55, 5.18, -1.74, { r0: 0, r1: 0 });
    // coin repas : un seul volume de collision ; on en fait le tour (≥ 50 cm derrière les chaises)
    const TX = 0.95, TZ = -2.95;
    one(() => at(TX, TZ, V.table === 'oval' ? PI / 2 : 0, () => {
      if (V.table === 'oval') {
        D.ovalTable(1.7, 0.9);
        for (const sx of [-1, 1]) for (const zz of [-0.4, 0.4]) at(zz, sx * 0.63, sx > 0 ? PI : 0, () => D.chair({ seat: V.chairSeat }));
        D.tableDecor(0.1, 0); D.placeSetting(-0.42, 0.755, 0.24, 0); D.placeSetting(0.42, 0.755, -0.24, PI);
      } else {
        const r = V.table === 'trav' ? 0.55 : 0.6, c = V.table === 'trav' ? 0.48 : 0.5;
        D.roundTable(r, { top: V.table === 'trav' ? 'travertine' : 'oak' });
        for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { const px = sx * c, pz = sz * c; at(px, pz, Math.atan2(-px, -pz), () => D.chair({ seat: V.chairSeat })); }
        D.tableDecor(0, 0);
      }
    }));
    if (V.table === 'oval') { D.pendant(TX, TZ - 0.42, 1.62, 3, 0.2, 0xf1e9dc); D.pendant(TX, TZ + 0.42, 1.62, 3, 0.2, 0xf1e9dc); }
    else D.akari(TX, TZ, 1.6, 0.27, 0.38);
    // enfilade : noyer à lattes sur piètement acier (101, 302), chêne à lattes procédural (201)
    if (lv === 2) at(-0.715, -3.05, PI / 2, () => D.sideboard(1.4, 0.42, 0.7));
    else at(-0.715, -3.05, PI / 2, () => { M3('modern_wooden_cabinet', { w: 1.4, h: 0.62, d: 0.42 }, () => D.sideboard(1.4, 0.42, 0.62, { decor: false })); D.sideboard(1.4, 0.42, 0.62, { body: false }); });
    face(-0.93, -3.05, PI / 2, () => { D.art(-0.3, 1.55, 0.5, 0.7, V.artWest[0], { frame: 'oak' }); D.art(0.32, 1.55, 0.5, 0.7, V.artWest[1], { frame: 'black' }); });
    // cuisine en L (façades laquées sauge, plan quartzite, crédence zellige) ; hotte intégrée à un élément haut (plus de « casquette »)
    at(-0.63, -6.13, PI / 2, () => {
      D.baseRun(1.66, [{ w: 0.6, t: 'drawers', hob: true }, { w: 0.46, t: 'door' }, { w: 0.6, t: 'door', sink: true, sinkW: 0.5 }], { front: 'lacquer', frontC: 0xa3ab95, top: 'stone' });
      D.splash(1.66, 0.9, 1.5);
      walk(() => {
        D.at(-0.53, 0, 0, () => D.wallUnits(0.62, 1.5, { hood: 0, frontC: 0xa3ab95 }));
        D.at(0.3, -0.3, 0, () => { D.wallShelf(1.06, 1.62, 0.24, { objects: false }); D.wallShelf(1.06, 1.98, 0.24, { objects: false }); });
        D.dishes(0.05, -0.18, 1.65); D.vase(0.55, 1.65, -0.18, 1, 0xc4754e); D.bowl(0.3, 2.01, -0.18, 0.09, 0xe8e0d2); D.vase(0.6, 2.01, -0.18, 0, 0xd9cfbf); D.bookRow(-0.2, 0.15, 2.01, -0.18, 0);
      });
      D.rbb('oak', -0.1, 0.25, 0.9, 0.922, -0.25, -0.02, 0.01, C(0xe6d6c4), { ry: 0.08 });
      D.herbs(0.62, 0.9, -0.2, 0xb8684a); D.herbs(0.45, 0.9, -0.23, 0xe8e0d2);
    });
    tall(-0.33, -7.26, 0, () => { at(-0.3, 0, 0, () => D.tallUnit(0.6, 'oven')); at(0.3, 0, 0, () => D.tallUnit(0.6, 'fridge')); });
    // îlot 1,30 m remonté de 30 cm (z −5,2) : passage îlot / canapé ≈ 70 cm, tabourets hors du tour de table
    at(1.15, -5.2, 0, () => {
      D.island(1.3, 0.95, { front: 'oak', over: 0.25, top: 'stone' });
      D.fruitBowl(-0.25, 0.91, -0.1); M3(lv === 3 ? 'ceramic_vase_01' : 'ceramic_vase_02', { h: 0.28 }, () => D.vase(0.35, 0.91, -0.1, 0, 0xe8dfd0), { x: 0.35, y: 0.91, z: -0.1, collide: false }); D.branches(0.35, 0.91 + 0.26, -0.1, 0.5, 5);
    });
    one(() => at(1.15, -5.2, 0, () => { for (const x of [-0.3, 0.3]) at(x, 0.62, PI, () => D.barStool({ seat: lv === 1 ? PAL.ink : lv === 3 ? PAL.rust : PAL.cognac })); }));
    D.dome(0.82, -5.2, 1.68, 0.13, V.domes); D.dome(1.48, -5.2, 1.68, 0.13, V.domes);

    // --- chambre 1 / suite : lit face à la baie, banc, armoire, rideaux de lin, garde-corps vitré devant la baie toute hauteur
    {
      const w = suite ? 1.8 : 1.6, bx = suite ? -4.1 : -4.05, off = w / 2 + 0.1 + 0.24, c1 = V.ch1;
      at(bx, -2.55, 0, () => D.rugF(suite ? 2.6 : 2.3, suite ? 2.0 : 1.7, 'wool', C(0xe7dfd0), false));
      at(bx, -3.96, 0, () => D.bed(w, 2.0, { head: c1.head, headMk: c1.headMk, duvet: PAL.linenWhite, accent: c1.accent, throw: c1.throw, bolster: lv === 3 ? PAL.rust : lv === 1 ? PAL.ink : null }));
      for (const s of [-1, 1]) at(bx + s * off, -3.75, 0, () => {
        const o = { lampC: suite ? 0xd9cfbf : 0xc4754e, lamp: !suite, cup: s > 0 };
        if (lv === 2) D.nightstand(o); else { NS(0.46, 0.4)(() => D.nightstand({ ...o, lamp: false, books: false, cup: false })); D.nightstand({ ...o, body: false }); }
      });
      if (suite) for (const s of [-1, 1]) face(bx + s * off, -3.96, 0, () => D.sconce(0, 1.32));   // appliques laiton au-dessus des chevets
      if (suite) face(bx, -3.96, 0, () => { D.art(-0.34, 1.68, 0.55, 0.42, c1.art, { frame: 'oak', crop: [0.3, 0.5, 0.7] }); D.art(0.34, 1.68, 0.55, 0.42, c1.art, { frame: 'oak', crop: [0.7, 0.5, 0.7], flip: true }); });
      else face(bx, -3.96, 0, () => D.art(0, 1.62, 0.9, 0.6, c1.art));
      at(bx, -1.62, 0, () => D.bench(1.2, 0.38, { throw: lv === 1 ? PAL.ink : PAL.sage }));
      if (lv !== 2) D.shoes(bx + off - 0.05, -2.55, 0.35, lv === 3 ? 0 : 1);   // chaussons au pied du lit
      tall(-1.31, -2.5, -PI / 2, () => D.wardrobe(1.6, 0.6, { col: 0xe9e4da }));
      D.drapes(-4.75, -4.18, -0.53, C(PAL.linenOat)); D.drapes(-1.6, -1.06, -0.53, C(PAL.linenOat));
      walk(() => D.box('black', -4.8, -1.03, P.H - 0.03, P.H - 0.002, -0.545, -0.515));
      D.glassPanel(-4.27, -1.04, -0.47, 0.02, 1.0);               // garde-corps vitré (baie toute hauteur)
      at(-5.2, -0.85, 0, () => lv === 1 ? M3('potted_plant_02', { h: 0.8 }, () => D.snakePlant(0, 0, 0.8, 0xe7dfd1)) : D.snakePlant(0, 0, 0.8, 0xe7dfd1));
      face(-5.565, -2.4, PI / 2, () => D.romanBlind(1.0, 1.74, 0.42, C(PAL.linenOat)));
      D.pendant(bx, -2.85, suite ? 1.95 : 1.98, c1.pend[0], c1.pend[1], c1.pend[2]);
      if (suite) { // coin lecture : fauteuil bouclé, lampadaire, guéridon
        at(-2.32, -1.05, -2.68, () => D.armchair({ pillow: PAL.ochre }));
        at(-1.72, -0.7, 0, () => D.floorLamp(0, 0, 1.5));
        D.sideTable(-1.75, -1.35, {});
      }
    }
    // --- chambre 2 : lit 140 (tête 1,46 m) centré, chevets de 40 cm, chaise rentrée sous le bureau
    {
      const c2 = V.ch2;
      at(-4.24, -6.3, 0, () => D.rugF(1.9, 1.5, 'wool', C(0xd9d2c6), false));
      at(-4.24, -7.475, 0, () => D.bed(1.4, 2.0, { hbW: 1.46, head: c2.head, duvet: PAL.linenWhite, pillow2: PAL.linenSand, accent: c2.accent, throw: c2.throw }));
      at(-5.19, -7.265, 0, () => { if (lv === 2) { NS(0.4, 0.38)(() => D.nightstand({ w: 0.4, lamp: false, books: false })); D.nightstand({ w: 0.4, lamp: false, body: false }); } else D.nightstand({ w: 0.4, lamp: false }); D.pothos(-0.08, 0.5, -0.06, { n: 5, reach: 0.32, dir: 0.4 }); });
      at(-3.29, -7.265, 0, () => { if (lv === 2) { NS(0.4, 0.38)(() => D.nightstand({ w: 0.4, lamp: false, books: false })); D.nightstand({ w: 0.4, lampKind: 1, body: false }); } else D.nightstand({ w: 0.4, lampKind: 1 }); });
      face(-4.24, -7.475, 0, () => D.art(0, 1.6, 0.6, 0.8, lv === 3 ? ART.dune : ART.sketch, { frame: 'black' }));
      at(-5.03, -4.315, PI, () => { if (lv === 2) D.desk(1.0, 0.55); else { M3('small_wooden_table_01', { w: 1.0, h: 0.75, d: 0.52 }, () => D.desk(1.0, 0.55, { items: false })); D.desk(1.0, 0.55, { body: false, h: 0.75 }); } });
      at(-5.03, -4.42, 0, () => D.chair({ seat: lv === 1 ? PAL.ink : PAL.linenGreige }));
      face(-5.03, -4.04, PI, () => { walk(() => D.wallShelf(1.0, 1.28, 0.22)); D.art(0.2, 1.78, 0.4, 0.5, ART.enso); });
      for (const zc of [-5.4, -6.9]) face(-5.565, zc, PI / 2, () => D.romanBlind(1.0, 1.74, 0.42, C(PAL.linenSand)));
      face(-2.89, -6.15, -PI / 2, () => { D.art(-0.26, 1.52, 0.42, 0.56, ART.sea, { frame: 'black', fw: 0.02, crop: [0.3, 0.6, 0.55] }); D.art(0.3, 1.4, 0.32, 0.42, ART.leaf, { fw: 0.02, crop: [0.6, 0.4, 0.6], flip: true }); });
      D.pendant(-4.24, -5.85, 2.04, c2.pend[0], c2.pend[1], c2.pend[2]);
    }
    // --- chambre 3 : lit 120 × 190 (passage de 70 cm au pied), armoire de 50 cm, bureau dans l'alcôve est
    {
      const c3 = V.ch3;
      at(3.6, -7.3, 0, () => D.rugF(1.5, 1.1, 'wool', C(0xe2d9c9), false));
      at(2.91, -5.94, PI, () => D.bed(1.2, 1.9, { sockets: [-1], head: c3.head, duvet: PAL.linenWhite, pillow2: PAL.linenGreige, accent: c3.accent, throw: c3.throw, tuck: true }));
      at(3.88, -6.15, PI, () => { if (lv === 3) D.nightstand({ lampKind: 1, cup: true }); else { NS(0.44, 0.38)(() => D.nightstand({ lamp: false, books: false })); D.nightstand({ lampKind: 1, cup: true, body: false }); } });
      face(2.91, -5.94, PI, () => D.art(0, 1.62, 0.7, 0.5, lv === 1 ? ART.blocks : ART.dune));
      face(2.19, -7.05, PI / 2, () => walk(() => { D.wallShelf(0.8, 1.52, 0.17, { objects: false }); D.bookRow(-0.36, 0.0, 1.55, 0.085, 0); D.candle(0.1, 1.55, 0.08, 0.08); D.bowl(0.26, 1.55, 0.085, 0.06, 0x3d3a36); }));
      at(5.33, -6.42, -PI / 2, () => D.desk(0.9, 0.5));
      at(4.86, -6.42, PI / 2, () => D.chair({ seat: PAL.sage }));
      face(5.58, -6.42, -PI / 2, () => { walk(() => { D.wallShelf(0.86, 1.36, 0.2, { objects: false }); D.bookRow(-0.4, -0.05, 1.39, 0.1, 0); D.pothos(0.26, 1.39, 0.1, { n: 6, reach: 0.4 }); }); D.art(0, 1.82, 0.46, 0.32, ART.enso, { frame: 'black', crop: [0.5, 0.5, 0.7] }); });
      tall(3.72, -9.025, 0, () => D.wardrobe(1.0, 0.5, { col: 0xe9e4da }));
      face(4.368, -8.0, -PI / 2, () => D.linenPanels([[-0.86, -0.4]], -0.9, 0.62, C(PAL.linenOat), 0.075));
      if (c3.pend === 'akari') D.akari(3.5, -7.35, 1.98, 0.22, 0.3); else D.pendant(3.5, -7.35, 2.06, c3.pend[0], c3.pend[1], c3.pend[2]);
    }
    // --- salle de bains : baignoire encastrée, vasque sur meuble chêne, sèche-serviettes
    at(-1.96, -7.1, 0, () => D.bathTub(1.7, 0.75));
    at(-1.96, -7.475, 0, () => { D.tileWall(-0.85, 0.85, 0.55, 2.1, 0); D.showerHead(-0.55, 0.35, 1.95); });
    at(-2.81, -7.1, PI / 2, () => D.tileWall(-0.375, 0.375, 0.55, 2.1, 0));
    at(-2.4, -6.725, 0, () => D.glassPanel(-0.41, 0.35, 0.0, 0.55, 1.5));
    at(-1.01, -6.25, -PI / 2, () => { D.vanity(0.8); D.rectMirror(0, 1.62, 0.7, 0.8); });
    at(-2.81, -5.75, PI / 2, () => D.towelRail(0.5, 1.1, 0.3, lv === 3 ? PAL.clay : PAL.linenOat));
    at(-1.95, -6.3, 0, () => D.rugF(0.8, 0.5, 'wool', C(0xe9e2d6), false));
    at(-1.22, -5.5, 0, () => M3('wicker_basket_02', { w: 0.4 }, () => D.basket(0, 0, 0.17, 0.42, { linen: PAL.linenOat }), { ry: 0.3 }));
    // --- salle d'eau · WC
    D.box('travertine', -1.275, -0.375, 0, 0.03, -9.275, -8.375, D.WHITE);
    at(-0.825, -9.275, 0, () => { D.tileWall(-0.45, 0.45, 0.03, 2.1, 0); D.showerHead(0, 0.35); });
    at(-1.275, -8.825, PI / 2, () => D.tileWall(-0.45, 0.45, 0.03, 2.1, 0));
    at(-0.375, -8.94, PI / 2, () => D.glassPanel(-0.335, 0.3, 0, 0.03, 1.95));
    at(0.12, -9.275, 0, () => D.wc());
    at(-0.9, -7.64, PI, () => { D.vanity(0.6); D.roundMirror(0, 1.62, 0.28); });
    face(0.47, -9.0, -PI / 2, () => D.rollHolder(0, 0.72));
    face(-0.3, -7.64, PI, () => D.hookTowel(0, 1.55, 0.3, 0.5, C(lv === 1 ? PAL.ink : PAL.sage)));
    face(0.12, -9.275, 0, () => walk(() => { D.wallShelf(0.5, 1.24, 0.16, { objects: false }); D.pothos(0.12, 1.27, 0.08, { n: 5, reach: 0.34 }); D.candle(-0.12, 1.27, 0.08, 0.09); }));
    at(-0.1, -8.3, 0, () => D.rugF(0.5, 0.36, 'wool', C(0xe9e2d6), false));
    // --- entrée (1,56 × 1,64 m, trois portes) : patères sans banc — la porte palière ouverte laisse 46 cm vers la chambre 3
    face(2.11, -7.95, -PI / 2, () => D.pegRail(0.6, 1.72, 3, { coat: lv === 1 ? PAL.ink : lv === 3 ? PAL.cognac : PAL.charcoal, bag: PAL.linenOat }));
    face(0.55, -9.0, PI / 2, () => D.roundMirror(0, 1.55, 0.2));
    D.akari(1.33, -8.45, 2.1, 0.17, 0.26);
    D.shoes(1.0, -7.8, PI + 0.1, 0); D.shoes(1.25, -7.78, PI - 0.15, 1);
    D.basket(1.97, -7.8, 0.11, 0.48, { col: 0x8f7a5c });
    at(1.12, -9.0, 0, () => D.rugF(0.8, 0.5, 'wool', C(0xb39a74), false));
    // --- dégagement : tapis de passage, œuvre, globe opalin
    at(-1.87, -4.62, 0, () => D.rugF(1.5, 0.62, lv === 1 ? 'jute' : 'rug', C(0xffffff), lv !== 1));
    face(-1.36, -4.04, PI, () => D.art(0, 1.5, 0.45, 0.6, ART.dune, { frame: 'black', crop: [0.25, 0.4, 0.5], flip: true }));
    D.pendant(-1.87, -4.62, 2.02, 1, 0.13);
    // --- loggias A (séjour) et B (chambre 3) : chaise bistrot, lanterne, plante ; la coursive (x > 6) reste libre
    at(5.42, -3.14, PI, () => D.bistroChair({ cushion: lv === 1 ? PAL.ink : lv === 3 ? PAL.rust : PAL.ochre }));
    at(5.0, -4.42, 0, () => D.lantern(0, 0, 0.4));
    at(5.62, -4.4, 0, () => D.snakePlant(0, 0, 0.7, 0xb8684a));
    at(5.4, -7.45, 0, () => D.pouf(0.22, 0.36, lv === 3 ? PAL.linenOat : PAL.linenSand, 'textile'));
    at(5.05, -8.82, 0, () => D.lantern(0, 0, 0.36));
    // --- balcon sud : salon d'extérieur pour le 201 (fin de l'expérience d'accueil), bistrot au 101, olivier et lanternes au 302 ;
    //     l'axe de l'expérience (x 2,6 → 3,4) et la baie restent libres
    if (lv === 2) {
      at(5.05, 0.1, 0, () => D.rugF(2.2, 1.5, 'jute', C(0xe4dccb), false));
      at(4.55, 0.05, 0.32, () => D.loungeChair({ pillow: PAL.terracotta }));
      at(5.6, 0.05, -0.32, () => D.loungeChair({ pillow: PAL.ochre }));
      at(5.08, 0.5, 0, () => { D.bistroTable(0.24, 0.42, 'oak'); D.lantern(0.05, 0, 0.26, 0.42); D.bowl(-0.1, 0.42, 0.06, 0.07, 0x9c5236); });
      at(3.85, 0.72, 0, () => D.lantern(0, 0, 0.5));
      at(6.05, 0.74, 0, () => D.lantern(0, 0, 0.42));
      at(0.72, -0.78, 0, () => D.oliveTree(0, 0, 1.7, 0xb8684a));
    } else if (lv === 1) {
      at(5.2, -0.25, 0, () => D.bistroTable(0.3));
      at(4.72, -0.25, PI / 2, () => D.bistroChair({ cushion: PAL.ink }));
      at(5.68, -0.25, -PI / 2, () => D.bistroChair({ cushion: PAL.ochre }));
      at(5.9, 0.75, 0, () => D.lantern(0, 0, 0.45));
      at(0.72, -0.78, 0, () => D.snakePlant(0, 0, 0.9, 0xb8684a));
    } else {
      at(0.72, -0.78, 0, () => D.oliveTree(0, 0, 1.7, 0xb8684a));
      at(4.6, 0.72, 0, () => D.lantern(0, 0, 0.5)); at(5.9, 0.72, 0, () => D.lantern(0, 0, 0.42));
    }
  }

  // ======================= LOT B (côté jardin) =======================
  const VB = {
    1: { // 102 — sauge et encre
      sofa: { col: PAL.boucle, mk: 'boucle', pillows: [PAL.ink, PAL.sage, PAL.linenOat, PAL.olive], plaid: PAL.sage }, arm: { mk: 'textile', col: PAL.sage },
      rug: ['wool', C(0xd9d1c3), false], artSofa: [ART.blocks, { frame: 'black' }], artEast: [ART.leaf, { frame: 'oak', mat: 0.08 }],
      table: 'rect', seat: PAL.linenOat, plants: ['pp01', 'strelitzia'], domes: 'black',
      ch1: { headMk: 'oak', head: PAL.linenSand, accent: PAL.ink, throw: PAL.sage, pend: [2, 0.2, 0xa9b39b], art: ART.line }, ch2: { head: PAL.ink, accent: PAL.ochre, throw: PAL.linenStone, art: ART.leaf },
      cushion: PAL.sage,
    },
    2: { // 202 — encre et sauge, table ronde
      sofa: { col: PAL.ink, mk: 'velvet', pillows: [PAL.linenWhite, PAL.sage, PAL.ochre], pillowMk: 'textile', plaid: PAL.linenOat }, arm: { mk: 'boucle', col: PAL.boucle },
      rug: ['wool', C(0xbfc5ae), false], artSofa: [ART.blocks, { frame: 'oak' }], artEast: [ART.line, { frame: 'black', mat: 0.08 }],
      table: 'round', seat: PAL.linenGreige, plants: ['fig', 'pp02'], domes: 'black',
      ch1: { head: PAL.linenSand, accent: PAL.sage, throw: PAL.ink, pend: 'akari', art: ART.enso }, ch2: { head: PAL.sage, accent: PAL.ink, throw: PAL.clay, art: ART.dune },
      cushion: PAL.ink,
    },
    3: { // 301 — encre et ocre, canapé sauge, cannage, laiton
      sofa: { col: PAL.sage, base: 'legs', pillows: [PAL.ink, PAL.ochre, PAL.linenWhite], plaid: PAL.ochre }, arm: { mk: 'textile', col: PAL.ochre },
      rug: ['jute', C(0xf0e6d2), false], artSofa: [ART.enso, { frame: 'black', pair: ART.sketch }], artEast: [ART.sea, { frame: 'black', mat: 0.08 }],
      table: 'rect', seat: PAL.straw, plants: ['olive', 'pp01'], domes: 'brass',
      ch1: { headMk: 'cane', head: PAL.linenSand, accent: PAL.ochre, throw: PAL.ink, pend: [0, 0.2, 0xe9dcc4], art: ART.arcs }, ch2: { head: PAL.linenSand, accent: PAL.ochre, throw: PAL.ink, art: ART.sketch },
      cushion: PAL.ochre,
    },
  }[lv];
  if (VB) furnishB(VB);
  function furnishB(V) {
    // --- cuisine linéaire + îlot (allée de travail 93 cm), tabourets, coin repas, salon tourné vers la loggia
    at(3.355, -9.825, PI, () => {
      D.baseRun(2.05, [{ w: 0.8, t: 'drawers', hob: true }, { w: 0.45, t: 'door' }, { w: 0.8, t: 'drawers2', sink: true, sinkW: 0.55 }], { front: 'oak', top: 'travertine', handleMk: 'black', tap: 'brass' });
      D.splash(2.05, 0.9, 1.45);
      D.wallUnits(2.05, 1.45, { hood: -0.625, frontC: 0xd8d0c4 });
      D.dishes(-0.1, -0.15, 0.9); D.fruitBowl(0.55, 0.9, -0.05); D.vase(0.98, 0.9, -0.22, 1, lv === 2 ? 0x6b7a8a : 0xe8e0d2);   // pichet (bout du plan, hors de la cuve) D.herbs(-0.85, 0.9, -0.2, 0xb8684a); D.herbs(-0.98, 0.9, -0.15, 0x3d3a36);
      D.rbb('oak', 0.15, 0.5, 0.92, 0.942, -0.25, -0.02, 0.01, C(0xe6d6c4), { ry: -0.06 });
    });
    tall(4.98, -9.825, PI, () => { at(-0.3, 0, 0, () => D.tallUnit(0.6, 'fridge', { frontC: 0xd8d0c4, handleMk: 'black' })); at(0.3, 0, 0, () => D.tallUnit(0.6, 'oven', { frontC: 0xd8d0c4, handleMk: 'black' })); });
    at(3.8, -11.55, PI, () => { D.island(1.8, 0.9, { front: 'oak', over: 0.2, top: 'travertine' }); const vh = D.vase(-0.4, 0.91, 0.1, 0, lv === 3 ? 0xc89a4b : 0xb8684a); D.branches(-0.4, 0.91 + vh, 0.1, 0.5, 5); D.bookStack(0.3, 0.91, 0.12, 2, 0.2, true); });
    one(() => { for (const x of [3.4, 4.2]) at(x, -12.2, 0, () => D.barStool({ seat: lv === 2 ? PAL.ink : PAL.cognac })); });
    D.dome(3.35, -11.55, 1.7, 0.13, V.domes); D.dome(4.25, -11.55, 1.7, 0.13, V.domes);
    const TX = 3.25, TZ = -13.95;   // décalée vers l'ouest : on contourne la table côté loggia (pilier du retour)
    one(() => at(TX, TZ, 0, () => {
      if (V.table === 'round') {
        D.roundTable(0.6);
        for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { const px = sx * 0.5, pz = sz * 0.5; at(px, pz, Math.atan2(-px, -pz), () => D.chair({ seat: V.seat })); }
        D.tableDecor(0, 0);
      } else {
        D.rectTable(1.6, 0.9);
        for (const x of [-0.4, 0.4]) { at(x, 0.68, PI, () => D.chair({ seat: V.seat })); at(x, -0.68, 0, () => D.chair({ seat: V.seat })); }
        D.runner(1.6, 0.26, 0.755, lv === 3 ? PAL.ochre : PAL.linenOat);
        D.tableDecor(0, 0);
        for (const [x, z, ry] of [[-0.4, 0.27, 0], [0.4, -0.27, PI]]) D.placeSetting(x, 0.755, z, ry);
      }
    }));
    D.akari(TX, TZ, 1.62, 0.25, 0.34);
    at(3.1, -16.4, PI / 2, () => D.rugF(2.4, 1.9, V.rug[0], V.rug[1], V.rug[2]));
    at(1.86, -16.4, PI / 2, () => D.sofa(2.4, V.sofa));
    // table basse : marbre et métal noir (102), béton et chêne (202), travertin procédural (301)
    at(3.15, -16.4, PI / 2, () => {
      if (lv === 1) { M3('coffee_table_round_01', { w: 0.95, d: 0.95, h: 0.36 }, () => D.coffeeTable({ w: 1.1, d: 0.6, decor: false })); D.coffeeTable({ w: 0.95, d: 0.56, h: 0.36, table: false }); }
      else if (lv === 2) { M3('modern_coffee_table_01', { w: 1.1, h: 0.36, d: 0.56 }, () => D.coffeeTable({ w: 1.1, d: 0.6, decor: false })); D.coffeeTable({ w: 1.0, d: 0.56, h: 0.36, table: false }); }
      else D.coffeeTable({ w: 1.1, d: 0.6 });
    });
    at(3.95, -17.95, -0.55, () => lv === 1 ? M3('mid_century_lounge_chair', { h: 0.95 }, () => D.armchair(V.arm)) : lv === 2 ? M3('modern_arm_chair_01', { h: 0.9 }, () => D.armchair(V.arm)) : D.armchair(V.arm));
    at(1.74, -14.9, 0, () => D.floorLamp(0, 0));          // lampadaire au bout du canapé (plus en contre-jour devant la fenêtre)
    D.sideTable(1.66, -17.9, {});
    const plant = (k, x, z) => at(x, z, 0, () => plantK(k, k === 'pp01' ? 1.6 : 1.0, () => k === 'olive' ? D.oliveTree(0, 0, 1.85, 0xb9b2a6) : k === 'fig' || k === 'pp01' ? D.figTree(0, 0, 1.75, 0xd9cfbf) : k === 'snake' || k === 'pp02' ? D.snakePlant(0, 0, 1.0, 0x3d3a36) : D.strelitzia(0, 0, 1.75, 0xb8684a)));
    plant(V.plants[0], 5.15, -18.15); plant(V.plants[1], 5.15, -14.95);
    if (lv === 2) at(5.355, -13.2, -PI / 2, () => D.sideboard(1.6, 0.44, 0.7));
    else at(5.355, -13.2, -PI / 2, () => { M3('modern_wooden_cabinet', { w: 1.6, h: 0.64, d: 0.44 }, () => D.sideboard(1.6, 0.44, 0.64, { decor: false })); D.sideboard(1.6, 0.44, 0.64, { body: false }); });
    face(5.58, -13.2, -PI / 2, () => D.art(0, 1.55, 1.0, 0.72, V.artEast[0], V.artEast[1]));
    face(1.38, -16.4, PI / 2, () => { const [a, ao] = V.artSofa; if (ao.pair != null) { D.art(-0.38, 1.55, 0.62, 0.82, a, ao); D.art(0.38, 1.55, 0.62, 0.82, ao.pair, ao); } else D.art(0, 1.55, 1.2, 0.8, a, ao); });
    tall(2.88, -18.58, 0, () => D.bookcase(1.1, 1.9, 0.34));
    for (const x of [1.5, 4.5]) face(x, -18.565, 0, () => D.romanBlind(1.0, 1.74, 0.42, C(PAL.linenOat)));
    // --- chambre 1 : lit 160 × 195 bordé (55 cm au pied), porte rabattue côté dressing
    {
      const c1 = V.ch1;
      at(-3.95, -17.1, 0, () => D.rugF(2.2, 1.5, 'wool', C(0xd9d2c6), false));
      at(-3.95, -15.95, PI, () => D.bed(1.6, 1.95, { head: c1.head, headMk: c1.headMk, z0: c1.headMk ? 0.05 : 0.08, duvet: PAL.linenWhite, pillow2: PAL.linenStone, accent: c1.accent, throw: c1.throw, tuck: true, bolster: lv === 2 ? PAL.sage : null }));
      for (const [x, cup] of [[-5.09, false], [-2.81, true]]) at(x, -16.16, PI, () => { if (lv === 2) D.nightstand({ lampC: 0x3d3a36, cup }); else { NS(0.46, 0.4)(() => D.nightstand({ lamp: false, books: false })); D.nightstand({ lampC: 0x3d3a36, cup, body: false }); } });
      face(-3.95, -15.95, PI, () => D.art(0, 1.62, 0.7, 0.7, c1.art));
      at(-1.35, -17.85, -1.07, () => D.armchair({ pillow: c1.accent }));
      if (lv !== 3) D.shoes(-2.55, -17.3, PI - 0.4, lv === 1 ? 1 : 0);
      at(-1.05, -18.3, 0, () => lv === 2 ? M3('potted_plant_02', { h: 0.78 }, () => D.snakePlant(0, 0, 0.75, 0x3d3a36)) : D.snakePlant(0, 0, 0.75, 0x3d3a36));
      face(-5.565, -17.6, PI / 2, () => D.romanBlind(1.0, 1.74, 0.42, C(PAL.linenStone)));
      for (const x of [-4.5, -1.5]) face(x, -18.565, 0, () => D.romanBlind(1.0, 1.74, 0.42, C(PAL.linenStone)));
      face(-3.0, -18.58, 0, () => D.art(0, 1.42, 0.9, 0.62, ART.arcs, { frame: 'oak', crop: [0.4, 0.55, 0.75] }));
      if (c1.pend === 'akari') D.akari(-3.95, -17.0, 2.0, 0.24, 0.32); else D.pendant(-3.95, -17.0, 1.98, c1.pend[0], c1.pend[1], c1.pend[2]);
    }
    // --- chambre 2 : lit, bureau sous la fenêtre, armoire d'1 m hors du débattement de la porte
    {
      const c2 = V.ch2;
      at(-4.15, -12.7, 0, () => D.rugF(1.7, 1.2, 'wool', C(0xe2d9c9), false));
      at(-4.15, -11.525, PI, () => D.bed(1.4, 2.0, { head: c2.head, duvet: PAL.linenWhite, pillow2: PAL.linenOat, accent: c2.accent, throw: c2.throw }));
      at(-5.19, -11.735, PI, () => { if (lv === 2) { NS(0.45, 0.38)(() => D.nightstand({ lamp: false, books: false })); D.nightstand({ lamp: false, body: false }); } else D.nightstand({ lamp: false }); });
      at(-3.11, -11.735, PI, () => { if (lv === 2) { NS(0.45, 0.38)(() => D.nightstand({ lamp: false, books: false })); D.nightstand({ lampKind: 1, body: false }); } else D.nightstand({ lampKind: 1 }); });
      face(-4.15, -11.525, PI, () => D.art(0, 1.6, 0.55, 0.75, c2.art, { frame: c2.art === ART.sketch ? 'black' : 'oak' }));
      tall(-3.98, -15.58, 0, () => D.wardrobe(1.0, 0.58, { col: 0xe4ddd1 }));
      at(-5.305, -14.6, PI / 2, () => { if (lv === 2) { M3('small_wooden_table_01', { w: 1.1, h: 0.75, d: 0.52 }, () => D.desk(1.1, 0.55, { items: false })); D.desk(1.1, 0.55, { body: false, h: 0.75 }); } else D.desk(1.1, 0.55); });
      at(-4.75, -14.6, -PI / 2, () => D.chair({ seat: V.cushion }));
      for (const zc of [-12.1, -13.6, -15.2]) face(-5.565, zc, PI / 2, () => D.romanBlind(1.0, 1.74, 0.42, C(PAL.linenSand)));
      D.pendant(-4.15, -13.4, 2.06, 0, 0.19, 0xe6ddcd);
    }
    // --- salle d'eau : douche à l'italienne, vasque, sèche-serviettes
    D.box('travertine', 0.4, 1.3, 0, 0.025, -15.87, -14.97, D.WHITE);
    at(0.85, -15.87, 0, () => { D.tileWall(-0.45, 0.45, 0.025, 2.1, 0); D.showerHead(0, 0.35); });
    at(1.3, -15.42, -PI / 2, () => D.tileWall(-0.45, 0.45, 0.025, 2.1, 0));
    at(0.4, -15.535, PI / 2, () => D.glassPanel(-0.335, 0.3, 0, 0.025, 1.95));
    at(-0.42, -14.9, PI / 2, () => { D.vanity(0.8); D.rectMirror(0, 1.62, 0.6, 0.8, 'oak'); });
    at(1.3, -14.55, -PI / 2, () => D.towelRail(0.45, 1.0, 0.35, lv === 3 ? PAL.ochre : PAL.clay));
    at(-0.2, -14.2, 0, () => lv === 2 ? D.basket(0, 0, 0.15, 0.38, { linen: PAL.linenOat }) : M3('wicker_basket_02', { w: 0.36 }, () => D.basket(0, 0, 0.15, 0.38, { linen: PAL.linenOat }), { ry: -0.4 }));
    at(0.85, -14.75, 0, () => D.rugF(0.6, 0.4, 'wool', C(0xe9e2d6), false));
    // --- WC (porte rabattue côté sud : la cuvette se voit depuis le dégagement)
    at(-1.02, -15.87, 0, () => D.wc());
    face(-1.02, -15.87, 0, () => D.art(0, 1.5, 0.3, 0.4, ART.sketch, { frame: 'black' }));
    face(-0.5, -15.45, -PI / 2, () => D.rollHolder(0, 0.72));
    face(-0.5, -14.6, -PI / 2, () => walk(() => { D.wallShelf(0.4, 1.3, 0.15, { objects: false }); D.pothos(0.05, 1.33, 0.075, { n: 5, reach: 0.3 }); }));
    // --- entrée : placard, console et miroir, banc et patères
    tall(-1.2, -11.775, PI, () => D.wardrobe(1.8, 0.5, { col: 0xe9e4da }));
    at(-0.85, -13.74, 0, () => D.consoleTable(1.1, 0.32));
    face(-0.85, -13.9, 0, () => D.roundMirror(0, 1.55, 0.36));
    at(-2.33, -13.0, PI / 2, () => D.bench(0.9, 0.36, { cushion: lv === 2 ? PAL.sage : PAL.linenSand }));
    face(-2.52, -13.0, PI / 2, () => D.pegRail(0.9, 1.72, 4, { coat: lv === 3 ? PAL.ochre : PAL.ink, bag: PAL.linenOat }));
    D.akari(-0.6, -12.75, 2.08, 0.18, 0.26);
    at(-0.95, -12.85, 0, () => D.rugF(1.8, 0.9, lv === 3 ? 'jute' : 'rug', C(0xffffff), lv !== 3));
    D.shoes(-2.36, -13.25, PI / 2, 1); D.shoes(-2.38, -12.8, PI / 2 - 0.12, 0);
    at(1.06, -11.8, 0, () => D.snakePlant(0, 0, 0.95, 0xe7dfd1));
    at(-2.07, -14.95, PI / 2, () => D.rugF(1.4, 0.6, 'wool', C(0xd9cbb4), false));
    // --- dressing : penderie sur cintres, pouf et panier côté ouest, œuvre sur le mur nu
    tall(1.3, -17.3, -PI / 2, () => D.dressing(2.4, 0.55));
    at(-0.3, -18.12, 0, () => D.pouf(0.22, 0.42, lv === 2 ? PAL.sage : PAL.boucle, lv === 2 ? 'textile' : 'boucle'));
    D.basket(-0.42, -17.45, 0.16, 0.36, { linen: PAL.linenStone });
    face(-0.67, -17.75, PI / 2, () => D.art(0, 1.5, 0.5, 0.7, lv === 1 ? ART.leaf : lv === 2 ? ART.enso : ART.line, { frame: 'oak' }));
    // --- loggia C (dallage + 15 cm) : chaise bistrot et guéridon au nord, lanterne au sud ; la porte reste dégagée
    at(5.05, -17.05, 0, () => D.bistroChair({ cushion: V.cushion }), 0.15);
    at(5.08, -17.42, 0, () => { D.bistroTable(0.19, 0.5, 'oak'); D.candle(0.05, 0.5, 0, 0.1); }, 0.15);
    at(5.0, -15.62, 0, () => D.lantern(0, 0, 0.42), 0.15);
  }
}
