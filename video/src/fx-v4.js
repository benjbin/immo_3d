// Effets v4, injectés dans la maquette (module ES) : aucun fichier de 3d/ n'est modifié.
// window.__fx(st) est appelé par story-page.js juste avant chaque rendu.
//   st.fx = { mode: 'real'|'wire'|'blueprint', reveal: y (fil de fer visible sous y), cut: y (blueprint au-dessus),
//             land: 0..1 (croissance du paysage), path: 0..1 (trajectoire de caméra lumineuse), proj: [[x,y,z]…] }
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

const V = window.__viewer;
const { THREE, scene, building, landscape, renderer, camera } = V;
const BLUE = new THREE.Color('#5a63ff');

// ---------- arêtes du bâtiment (fil de fer lumineux)
building.updateMatrixWorld(true);
const pos = [];
const v = new THREE.Vector3(), m4 = new THREE.Matrix4();
const isInterior = (o) => { for (let p = o; p; p = p.parent) if (/interieur/i.test(p.name || '')) return true; return false; };
building.traverse((o) => {
  if (!o.isMesh || isInterior(o)) return;
  const mt = Array.isArray(o.material) ? o.material[0] : o.material;
  if (mt && mt.transparent && mt.opacity < 0.5) return;
  const eg = new THREE.EdgesGeometry(o.geometry, 30);
  const a = eg.attributes.position;
  if (a.count > 24000) { eg.dispose(); return; }   // végétation, couvre-sol : trop dense pour un tracé lisible
  const mats = [];
  if (o.isInstancedMesh) { if (o.count > 300) { eg.dispose(); return; } for (let k = 0; k < o.count; k++) { o.getMatrixAt(k, m4); mats.push(m4.clone().premultiply(o.matrixWorld)); } }
  else mats.push(o.matrixWorld);
  for (const M of mats) for (let i = 0; i < a.count; i++) { v.fromBufferAttribute(a, i).applyMatrix4(M); pos.push(v.x, v.y, v.z); }
  eg.dispose();
});
const geo = new LineSegmentsGeometry().setPositions(pos);
const clipBelow = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e4);   // garde y < constant
const clipAbove = new THREE.Plane(new THREE.Vector3(0, 1, 0), 1e4);    // garde y > -constant
const lineMat = new LineMaterial({ color: BLUE, linewidth: 2.6, transparent: true, opacity: 1, depthTest: true, depthWrite: false, toneMapped: false });
lineMat.clippingPlanes = [clipBelow, clipAbove];
const edges = new LineSegments2(geo, lineMat);
edges.computeLineDistances && edges.computeLineDistances();
edges.frustumCulled = false; edges.renderOrder = 30; edges.visible = false;
edges.userData.noAO = true; edges.userData.noClip = true;
scene.add(edges);

// anneau de construction (rectangle lumineux à la hauteur de coupe)
const ringPts = [[-6.9, 1.7], [6.9, 1.7], [6.9, -19.2], [-6.9, -19.2]];
const rp = [];
for (let i = 0; i < 4; i++) { const a = ringPts[i], b = ringPts[(i + 1) % 4]; rp.push(a[0], 0, a[1], b[0], 0, b[1]); }
const ringMat = new LineMaterial({ color: new THREE.Color('#bfc4ff'), linewidth: 5, transparent: true, depthTest: false, toneMapped: false });
const ring = new LineSegments2(new LineSegmentsGeometry().setPositions(rp), ringMat);
ring.visible = false; ring.renderOrder = 31; ring.frustumCulled = false; ring.userData.noAO = true;
scene.add(ring);
// voile lumineux du plan de construction
const sheet = new THREE.Mesh(new THREE.PlaneGeometry(13.8, 20.9).rotateX(-Math.PI / 2).translate(0, 0, -8.75),
  new THREE.MeshBasicMaterial({ color: '#6c74ff', transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
sheet.visible = false; sheet.renderOrder = 29; sheet.userData.noAO = true; scene.add(sheet);

// volume sombre du bâtiment « à venir » (au-dessus de la ligne de construction) : fond de blueprint
const ghost = new THREE.Mesh(new THREE.BoxGeometry(13.6, 1, 20.8).translate(0, 0.5, -8.8),
  new THREE.MeshBasicMaterial({ color: '#070b2a', transparent: true, opacity: 0.72, depthWrite: false, toneMapped: false }));
ghost.visible = false; ghost.renderOrder = 28; ghost.userData.noAO = true; scene.add(ghost);

// ---------- matériaux « silhouette » (mode fil de fer : volumes noirs, arêtes bleues)
const dark = new THREE.MeshBasicMaterial({ color: '#06070c', polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
const saved = new Map();
function setDark(on) {
  building.traverse((o) => {
    if (!o.isMesh) return;
    if (on && !saved.has(o)) { saved.set(o, { m: o.material, vis: o.visible }); o.material = dark; if (isInterior(o)) o.visible = false; }
    else if (!on && saved.has(o)) { const s = saved.get(o); o.material = s.m; o.visible = s.vis; saved.delete(o); }
  });
}

// ---------- trajectoire de caméra lumineuse (plan « films générés »)
let tube = null, markers = [], camIcon = null, pathKey = '';
function buildPath(pts) {
  if (tube) { scene.remove(tube); tube.geometry.dispose(); markers.forEach((mk) => scene.remove(mk)); markers = []; }
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)), false, 'centripetal');
  const tg = new THREE.TubeGeometry(curve, 400, 0.3, 10, false);
  tube = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color: '#7a80ff', toneMapped: false }));
  tube.userData.noAO = true; tube.renderOrder = 32; tube.userData.curve = curve; tube.frustumCulled = false;
  scene.add(tube);
  for (const p of pts) {
    const mk = new THREE.Mesh(new THREE.OctahedronGeometry(0.9), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }));
    mk.position.set(...p); mk.userData.noAO = true; mk.visible = false; scene.add(mk); markers.push(mk);
  }
  if (!camIcon) {
    camIcon = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.4, 4, 1, true).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff', wireframe: true, toneMapped: false }));
    camIcon.userData.noAO = true; scene.add(camIcon);
  }
}

let mode = 'real', hidden = [];
function setMode(m) {
  if (m === mode) return;
  // retour à l'état réel
  setDark(false);
  hidden.forEach((o) => { o.visible = true; }); hidden = [];
  scene.background = V.renderer && scene.userData.bg0 !== undefined ? scene.userData.bg0 : scene.background;
  if (m === 'wire') {
    if (scene.userData.bg0 === undefined) scene.userData.bg0 = scene.background;
    setDark(true);
    for (const o of [landscape, V.lots && V.lots.group].filter(Boolean)) if (o.visible) { o.visible = false; hidden.push(o); }
    scene.background = new THREE.Color('#030409');
  }
  mode = m;
}

window.__fx = (st) => {
  const f = st.fx || {};
  setMode(f.mode || 'real');
  if (mode === 'wire' && scene.fog) scene.fog.density = 0;
  const W = renderer.domElement.width, H = renderer.domElement.height;
  lineMat.resolution.set(W, H); ringMat.resolution.set(W, H);
  lineMat.linewidth = (f.lw || 2.6) * (W / 2160);
  // fil de fer : visible sous « reveal » (dessin de bas en haut) et au-dessus de « cut » (blueprint)
  const showEdges = f.mode === 'wire' || f.mode === 'blueprint';
  edges.visible = showEdges;
  clipBelow.constant = f.reveal != null ? f.reveal : 1e4;
  clipAbove.constant = f.cut != null ? -f.cut : 1e4;
  lineMat.opacity = f.edgeOpacity != null ? f.edgeOpacity : 1;
  lineMat.depthTest = f.mode !== 'blueprint';
  // anneau et voile de construction
  const ry = f.ringY;
  ring.visible = sheet.visible = ry != null;
  if (ry != null) { ring.position.y = ry; sheet.position.y = ry; }
  ghost.visible = f.mode === 'blueprint' && f.cut != null && f.cut < 15.2;
  if (ghost.visible) { const y0 = Math.max(0, f.cut); ghost.position.y = y0; ghost.scale.y = Math.max(0.01, 15.2 - y0); }
  // paysage qui pousse
  if (f.land != null) { landscape.scale.y = Math.max(0.002, f.land); landscape.updateMatrixWorld(true); renderer.shadowMap.needsUpdate = true; }
  else if (landscape.scale.y !== 1) { landscape.scale.y = 1; landscape.updateMatrixWorld(true); }
  // trajectoire
  if (f.path) {
    const key = JSON.stringify(f.path.pts);
    if (key !== pathKey) { buildPath(f.path.pts); pathKey = key; }
    const n = tube.geometry.index.count, pr = Math.max(0, Math.min(1, f.path.progress));
    tube.geometry.setDrawRange(0, Math.floor(n * pr / 6) * 6);
    tube.visible = true;
    markers.forEach((mk, i) => { const at = i / (markers.length - 1); mk.visible = pr >= at - 0.001; mk.rotation.y = st.t * 2 + i; mk.scale.setScalar(pr >= at ? 1 : 0.001); });
    const c = tube.userData.curve, u = Math.max(0.001, Math.min(0.999, f.path.cam ?? pr));
    camIcon.visible = true; camIcon.position.copy(c.getPointAt(u)); camIcon.lookAt(c.getPointAt(Math.min(1, u + 0.01)));
  } else if (tube) { tube.visible = false; markers.forEach((mk) => { mk.visible = false; }); if (camIcon) camIcon.visible = false; }
  // projections demandées (étiquettes, repères HUD)
  window.__story.proj = null;
  if (f.proj) {
    const p = new THREE.Vector3();
    window.__story.proj = f.proj.map((q) => {
      if (typeof q === 'string') { const L = V.lots.lot(q); p.copy(L.labelAnchor); p.y += 1.2; } else p.set(...q);
      p.project(camera); return [(p.x + 1) / 2, (1 - p.y) / 2, p.z];
    });
  }
};
window.__fxReady = true;
