/**
 * Canopée — mobilier photogrammétrique (Poly Haven, CC0) des logements visitables (Three.js 0.160)
 *
 *   CATALOG                    : modèles disponibles (assets/models/<id>/<id>.gltf, textures 1k), emprise
 *                                naturelle (m, repère du modèle après `rot`) et rôle (meuble, plante, objet)
 *   fitSize(id, fit)           : dimensions finales d'un modèle mis à l'échelle (synchrone : collisions de
 *                                visite calculées à la construction du plan, avant tout chargement)
 *   createModels(THREE)        : gestionnaire paresseux par étage (lots.js : place / bind / request ;
 *                                viewer.js : hooks, tick)
 *
 * Principe : decor.js pose un modèle à l'emplacement d'un meuble procédural, qui sert de doublure tant que le
 * modèle n'est pas chargé (tag 'px'). Rien n'est chargé au démarrage : un étage demande ses modèles quand il
 * devient visible (coupe, visite) ; GLTFLoader lui-même n'est importé qu'à ce moment. Les géométries sont
 * fusionnées par (modèle, matériau) pour l'étage (un appel de dessin par matériau, quel que soit le nombre
 * d'exemplaires) ; les matériaux et textures sont partagés entre étages.
 * Tous les matériaux sont ramenés à DEUX formes de programme (opaque ; feuillage découpé double face) :
 * mêmes cartes (couleur, normales, ARM), cartes neutres 1 × 1 quand il en manque une — les programmes
 * sont donc compilés une fois pour tout le catalogue, et la permutation doublure → modèle n'a lieu qu'au
 * repos (caméra immobile, pas d'animation), après compileAsync et envoi des textures au GPU.
 */

// rot : rotation (autour de Y) qui amène la face avant du modèle vers +Z et sa longueur sur X.
// size : [x, y, z] en mètres, après rot. kind : 'meuble' (ombre portée), 'plante', 'objet' (sans ombre).
export const CATALOG = {
  modern_arm_chair_01:      { size: [0.82, 1.023, 0.987], rot: 0, kind: 'meuble' },
  mid_century_lounge_chair: { size: [1.009, 1.169, 1.19], rot: 0, kind: 'meuble' },
  modern_coffee_table_01:   { size: [1.202, 0.39, 0.6], rot: Math.PI / 2, kind: 'meuble' },
  coffee_table_round_01:    { size: [1.301, 0.491, 1.301], rot: 0, kind: 'meuble' },
  side_table_01:            { size: [0.55, 0.551, 0.45], rot: 0, kind: 'meuble' },
  modern_wooden_cabinet:    { size: [2.44, 0.68, 0.52], rot: 0, kind: 'meuble' },
  small_wooden_table_01:    { size: [0.916, 0.533, 0.44], rot: 0, kind: 'meuble' },
  potted_plant_01:          { size: [0.587, 1.35, 0.634], rot: 0, kind: 'plante' },
  potted_plant_02:          { size: [0.701, 0.841, 0.657], rot: 0, kind: 'plante' },
  ceramic_vase_01:          { size: [0.204, 0.4, 0.204], rot: 0, kind: 'objet' },
  ceramic_vase_02:          { size: [0.218, 0.309, 0.218], rot: 0, kind: 'objet' },
  wicker_basket_02:         { size: [0.375, 0.218, 0.271], rot: 0, kind: 'objet' },
};
const BASE = new URL('./assets/models/', import.meta.url).href;
const TEX = new URL('./assets/textures/', import.meta.url).href;

// fit : { w, h, d } (mètres, une ou plusieurs cotes) ou { s } (échelle uniforme). Cotes absentes : échelle
// moyenne des cotes données (proportions du modèle conservées).
export function fitScale(id, fit = {}) {
  const c = CATALOG[id]; if (!c) return [1, 1, 1];
  if (fit.s) return [fit.s, fit.s, fit.s];
  const t = [fit.w, fit.h, fit.d], s = t.map((v, i) => (v ? v / c.size[i] : null));
  const given = s.filter((v) => v != null), m = given.length ? given.reduce((a, b) => a + b, 0) / given.length : 1;
  return s.map((v) => (v == null ? m : v));
}
export function fitSize(id, fit) { const c = CATALOG[id], s = fitScale(id, fit); return c ? c.size.map((v, i) => v * s[i]) : [0, 0, 0]; }

export function createModels(THREE) {
  const floors = new Map();          // key → { list, root, walk, proxy, state, group }
  const cache = new Map();           // id → Promise<{ parts: [{ geo, mat }] }>
  const matCache = new Map();
  let Loader = null, loaderP = null, mergeFn = null;
  const hooks = { prepare: null, compile: null, busy: null, onSwap: null, anisotropy: 8, renderer: null };
  let armed = false;
  const queue = [];                  // étages demandés, dans l'ordre
  let work = null;                   // étage en cours de préparation
  const camPrev = new THREE.Matrix4(); let stillSince = 0;
  let stillWait = [];
  const whenStill = () => new Promise((r) => stillWait.push(r));   // résolu par tick() au repos

  // cartes neutres : une seule forme de programme pour tous les matériaux
  const px = (r, g, b, a = 255) => { const t = new THREE.DataTexture(new Uint8Array([r, g, b, a]), 1, 1); t.needsUpdate = true; return t; };
  const FLAT_N = px(128, 128, 255), WHITE = px(255, 255, 255), ARM1 = px(255, 255, 0);
  WHITE.colorSpace = THREE.SRGBColorSpace;

  function material(src, foliage) {
    if (matCache.has(src.uuid)) return matCache.get(src.uuid);
    const arm = src.roughnessMap || src.metalnessMap || null;
    const m = new THREE.MeshStandardMaterial({
      name: 'model:' + src.name,
      color: src.color.clone(),
      map: src.map || WHITE,
      normalMap: src.normalMap || FLAT_N,
      roughnessMap: arm || ARM1, metalnessMap: arm || ARM1,
      // canal R de la carte ARM de Poly Haven : occlusion de détail (plis, joints) ; la GTAO fait le reste
      aoMap: arm || WHITE, aoMapIntensity: 0.75,
      roughness: src.roughness, metalness: src.metalness,
      normalScale: src.normalScale ? src.normalScale.clone() : new THREE.Vector2(1, 1),
      side: foliage ? THREE.DoubleSide : THREE.FrontSide,
      alphaTest: foliage ? 0.5 : 0, transparent: false, alphaToCoverage: !!foliage,   // bords de feuilles lissés par le MSAA
      envMapIntensity: 1,
    });
    for (const k of ['map', 'normalMap', 'roughnessMap']) { const t = m[k]; if (t && t.isTexture && !t.isDataTexture) { t.anisotropy = hooks.anisotropy; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; } }
    m.userData.model = true;
    if (hooks.prepare) hooks.prepare(m);
    matCache.set(src.uuid, m);
    return m;
  }

  async function loader() {
    if (Loader) return Loader;
    if (!loaderP) loaderP = Promise.all([import('three/addons/loaders/GLTFLoader.js'), import('three/addons/utils/BufferGeometryUtils.js')]).then(([g, u]) => { Loader = new g.GLTFLoader(); mergeFn = u.mergeGeometries; return Loader; });
    return loaderP;
  }
  function load(id) {
    if (cache.has(id)) return cache.get(id);
    const p = loader().then((L) => L.loadAsync(BASE + id + '/' + id + '.gltf')).then((g) => {
      const c = CATALOG[id], parts = new Map();
      g.scene.updateMatrixWorld(true);
      const rot = new THREE.Matrix4().makeRotationY(c.rot || 0);
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        const src = o.material;
        if (!src || /glass/i.test(src.name || '') || src.transparent) return;          // vitres des cadres : omises
        const foliage = src.alphaTest > 0 || /leaves|leaf|foliage/i.test(src.name || '');
        let geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
        for (const n of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(n)) geo.deleteAttribute(n);
        geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(rot, o.matrixWorld));
        const mat = material(src, foliage);
        if (!parts.has(mat)) parts.set(mat, []);
        parts.get(mat).push(geo);
      });
      // repère normalisé : centré en X/Z, posé sur y = 0
      const box = new THREE.Box3();
      for (const list of parts.values()) for (const g2 of list) { g2.computeBoundingBox(); box.union(g2.boundingBox); }
      const ctr = box.getCenter(new THREE.Vector3());
      const out = [];
      for (const [mat, list] of parts) {
        const geo = list.length > 1 ? mergeFn(list, false) : list[0];
        geo.translate(-ctr.x, -box.min.y, -ctr.z);
        out.push({ geo, mat });
      }
      g.scene.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
      return { parts: out, size: box.getSize(new THREE.Vector3()) };
    });
    cache.set(id, p);
    return p;
  }

  // ----- API côté lots.js
  // placement : { id, world: Matrix4 (pied du modèle au sol), fit, tag: 'common' | 'walk', cast }
  function bind(key, f) { floors.set(key, { list: f.list || [], root: f.root, walk: f.walk, proxy: f.proxy, state: 'idle', group: null }); }
  function request(key) {
    const f = floors.get(key); if (!f || !armed || f.state !== 'idle' || !f.list.length) return;
    f.state = 'queued'; queue.push(key);
  }
  // ----- préparation d'un étage (asynchrone, hors du rendu)
  async function prepare(key) {
    const f = floors.get(key);
    f.state = 'loading';
    const ids = [...new Set(f.list.map((p) => p.id))];
    const res = new Map();
    await Promise.all(ids.map((id) => load(id).then((r) => res.set(id, r)).catch((e) => { console.warn('[models]', id, e && e.message); })));
    await whenStill();
    // fusion par (matériau, tag, ombre) pour tout l'étage
    const buckets = new Map();
    const m4 = new THREE.Matrix4(), sc = new THREE.Matrix4();
    for (const p of f.list) {
      const r = res.get(p.id); if (!r) continue;
      const c = CATALOG[p.id], s = fitScale(p.id, p.fit);
      // échelle sur la taille mesurée (la taille du catalogue ne sert qu'aux collisions)
      const k = [0, 1, 2].map((i) => s[i] * c.size[i] / ([r.size.x, r.size.y, r.size.z][i] || 1));
      sc.makeScale(k[0], k[1], k[2]);
      m4.multiplyMatrices(p.world, sc);
      for (const { geo, mat } of r.parts) {
        const cast = p.cast != null ? p.cast : c.kind !== 'objet';
        const bk = mat.uuid + '|' + p.tag + '|' + (cast ? 1 : 0);
        if (!buckets.has(bk)) buckets.set(bk, { mat, tag: p.tag, cast, list: [] });
        const g = geo.clone(); g.applyMatrix4(m4);
        buckets.get(bk).list.push(g);
      }
    }
    const common = new THREE.Group(), walk = new THREE.Group();
    common.name = 'models:' + key; walk.name = 'models:' + key + ':walk';
    for (const b of buckets.values()) {
      const geo = b.list.length > 1 ? mergeFn(b.list, false) : b.list[0];
      if (b.list.length > 1) for (const g of b.list) g.dispose();
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, b.mat);
      mesh.name = `lots:${key}:model:${b.mat.name.replace('model:', '')}`;
      mesh.castShadow = b.cast; mesh.receiveShadow = true;
      (b.tag === 'walk' ? walk : common).add(mesh);
    }
    // programmes (deux formes pour tout le catalogue) compilés en parallèle, textures envoyées au GPU
    const tmp = new THREE.Group(); tmp.add(common, walk);
    if (hooks.compile) { try { await hooks.compile(tmp); } catch (e) { /* compilé au premier rendu */ } }
    const tex = new Set();
    for (const o of [...common.children, ...walk.children]) for (const k of ['map', 'normalMap', 'roughnessMap']) { const t = o.material[k]; if (t && !t.isDataTexture && !t.userData.cnpUp) tex.add(t); }
    f.pendingTex = [...tex];
    f.group = { common, walk };
    f.state = 'ready';
  }
  // ----- textures photographiques (Poly Haven CC0, assets/textures) des matériaux procéduraux existants :
  // l'image des textures déjà en place (couleur, normales, rugosité) est remplacée au repos — mêmes objets
  // Texture, donc aucun programme à recompiler ; la répétition (m) et la rotation sont des uniformes.
  const upgrades = [];
  let upState = 'idle', upQueue = [];
  function upgrade(mat, key, o = {}) { if (mat && mat.map) upgrades.push({ mat, key, ...o }); }
  async function loadUpgrades() {
    upState = 'loading';
    const img = (url) => { const im = new Image(); im.decoding = 'async'; im.src = url; return im.decode().then(() => im); };
    const byTex = new Map();
    await Promise.all(upgrades.map(async (u) => {
      const [d, n, r] = await Promise.all(['diff', 'nor', 'rough'].map((k) => img(TEX + u.key + '_' + k + '.jpg').catch(() => null)));
      for (const [t, im] of [[u.mat.map, d], [u.mat.normalMap, n], [u.mat.roughnessMap, r]]) if (t && im && !byTex.has(t)) byTex.set(t, { t, im, u });
    }));
    upQueue = [...byTex.values()];
    upState = 'ready';
  }
  function applyUpgrade({ t, im, u }) {
    // nouvelle source + clé de cache différente (unpackAlignment) : three crée une nouvelle texture GL à la
    // taille de l'image (le stockage immuable de l'ancienne ne peut pas changer de dimensions)
    t.source = new THREE.Source(im); t.unpackAlignment = t.unpackAlignment === 1 ? 2 : 1; t.repeat.set(1 / u.tile[0], 1 / (u.tile[1] || u.tile[0])); t.rotation = u.rot || 0;
    t.anisotropy = hooks.anisotropy; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
    t.needsUpdate = true;
    if (hooks.renderer) hooks.renderer.initTexture(t);
    const m = u.mat;
    if (!m.userData.cnpUpg) {
      m.userData.cnpUpg = true;
      if (u.ns && m.normalScale) m.normalScale.set(u.ns, u.ns);
      if (u.rough != null) m.roughness = u.rough;
      if (m.userData.detail && u.detail != null) m.userData.detail.uDetailK.value = m.userData.detail.uDetailK.value.map((v) => v * u.detail);
    }
  }
  function swap(key) {
    const f = floors.get(key);
    const { common, walk } = f.group;
    common.removeFromParent(); walk.removeFromParent();
    f.root.add(common); f.walk.add(walk);
    if (f.proxy) f.proxy.visible = false;
    f.state = 'shown';
    if (hooks.onSwap) hooks.onSwap(key);
  }
  // appelé à chaque image par viewer.js (après le rendu) : un peu de travail, jamais pendant un mouvement
  function tick(camera, now = performance.now()) {
    if (!armed) return;
    if (camera) {
      if (!camPrev.equals(camera.matrixWorld)) { camPrev.copy(camera.matrixWorld); stillSince = now; }
    }
    const still = now - stillSince > 250 && !(hooks.busy && hooks.busy());
    // tout le travail du processeur (décodage lancé, fusion des géométries) démarre au repos : jamais pendant
    // une animation d'étage ou un déplacement (images en retard, baisse de qualité automatique)
    if (!still) return;
    if (stillWait.length) { const w = stillWait; stillWait = []; for (const r of w) r(); }
    if (upState === 'idle' && upgrades.length && (work != null || queue.length)) loadUpgrades().catch((e) => { console.warn('[textures]', e); upState = 'done'; });
    if (!work && queue.length) { const key = queue.shift(); work = key; prepare(key).catch((e) => { console.warn('[models]', e); floors.get(key).state = 'idle'; work = null; }); }
    if (upState === 'ready' && still) { if (upQueue.length) { applyUpgrade(upQueue.shift()); if (hooks.onSwap) hooks.onSwap(null); } else upState = 'done'; return; }
    if (work == null) return;
    const f = floors.get(work);
    if (f.state !== 'ready') return;
    // textures : une par image, au repos (≈ 1 ms chacune en 1k avec mipmaps)
    if (f.pendingTex.length) { if (still && hooks.renderer) { const t = f.pendingTex.shift(); hooks.renderer.initTexture(t); t.userData.cnpUp = true; } return; }
    if (still) { swap(work); work = null; }
  }
  return {
    CATALOG, bind, request, tick, hooks, upgrade,
    get texState() { return upState; },
    arm() { armed = true; },
    get armed() { return armed; },
    idle: () => !work && !queue.length && (upState === 'done' || !upgrades.length),
    state: (k) => (floors.get(k) || {}).state,
    floors,
  };
}
