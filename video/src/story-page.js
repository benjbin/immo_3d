// Injecté dans la page de la maquette (http://localhost:8760/3d/?ui=0&intro=0&q=high) après chargement.
// Fige la boucle temps réel du viewer et expose window.__story.frame(state) : pose explicite de la caméra,
// de l'heure, de l'étage en coupe et de la hauteur du plan de coupe, puis rendu et capture du canvas.
// Aucun fichier de 3d/ n'est modifié : tout passe par l'API window.__viewer et des surcharges en mémoire.
(() => {
  const V = window.__viewer;
  if (!V) throw new Error('__viewer absent');
  const { THREE, camera, controls, renderer } = V;
  const cfg = V.cfg;
  const nav = V.nav;

  // 1) boucle rAF du viewer arrêtée : plus rien ne bouge hors de nos appels
  window.requestAnimationFrame = () => 0;
  // 2) contrôles et navigation neutralisés (la caméra est posée à la main)
  controls.update = () => false;
  controls.enabled = false;
  if (nav) nav.update = () => false;
  // état « intérieur » pour le réglage d'AO du viewer (rayon court, blend réduit en visite)
  const S = { indoor: false, walk: false };
  if (nav && nav.getState) {
    const gs0 = nav.getState.bind(nav);
    nav.getState = () => ({ ...gs0(), mode: S.walk ? 'walk' : 'orbit', indoor: S.walk && S.indoor });
  }
  // 3) curseur d'heure élargi (le soir d'été, l'heure bleue tombe vers 22 h 30)
  const hourEl = document.getElementById('hour');
  if (hourEl) { hourEl.min = '4'; hourEl.max = '23.5'; hourEl.step = 'any'; }
  // plan de coupe horizontal = premier plan de la liste partagée par les matériaux du bâtiment
  const hPlane = V.M.renderWhite.clippingPlanes && V.M.renderWhite.clippingPlanes[0];
  if (!hPlane) throw new Error('plan de coupe introuvable');

  const noOffset = () => { cfg.vo.x = cfg.vo.tx = 0; cfg.vo.y = cfg.vo.ty = 0; camera.clearViewOffset(); };
  const finishCutAnim = () => { const an = cfg.cut.anim; cfg.cut.anim = null; if (an && an.onEnd) an.onEnd(); };

  let cur = { hour: null, floor: undefined, view: null, cut: null, look: '' };
  const LOOK0 = V.tune({});   // réglages d'ambiance d'origine (surcharges par plan via st.look)
  function setFloorState(floor, view) {
    if (floor === cur.floor && view === cur.view) return;
    if (floor == null) {
      V.setFloor(null, { fly: false });
      finishCutAnim();
    } else {
      V.setFloor(floor, { fly: false, view });
      finishCutAnim();                       // déclenche onReady : plan de l'étage affiché
      V.lots.setFloor(floor);
      if (V.lots.setViewMode) V.lots.setViewMode(view);
      cfg.cut.ready = true;
    }
    // étiquettes 3D (sprites) des pièces : jamais affichées dans le film
    if (V.lots.setLabelsVisible) V.lots.setLabelsVisible(false);
    V.lots.group.traverse((o) => { if (o.isSprite) o.visible = false; });
    noOffset();
    cur.floor = floor; cur.view = view;
  }

  const _t = new THREE.Vector3();
  function frame(st) {
    // étalonnage du plan (V.tune), puis heure (et environnement PMREM recalculé)
    const lk = JSON.stringify(st.look || {});
    if (lk !== cur.look) { V.tune({ ...LOOK0, ...(st.look || {}) }); cur.look = lk; cur.hour = null; }
    if (st.hour != null && Math.abs((cur.hour ?? -99) - st.hour) > 1e-4) { V.setHour(st.hour); cur.hour = st.hour; }
    setFloorState(st.floor ?? null, st.view || 'plan');
    // hauteur de coupe explicite (sinon : aucune coupe, ou plafond de visite)
    const cut = st.cut != null ? st.cut : (st.floor == null ? 1e4 : null);
    if (cut != null) { cfg.cut.anim = null; cfg.cut.y = cut; hPlane.constant = cut; }
    if (!!st.avail !== !!cur.avail) { V.setAvailability(!!st.avail); cur.avail = !!st.avail; if (V.lots.update) V.lots.update(st.avail ? 0.08 : 10); }
    S.walk = !!st.walk; S.indoor = !!st.indoor;
    // caméra
    camera.position.set(...st.pos);
    controls.target.set(...st.tgt);
    camera.up.set(0, 1, 0);
    camera.lookAt(_t.set(...st.tgt));
    if (st.roll) camera.rotateZ(st.roll);
    camera.fov = st.fov || 40;
    camera.zoom = 1;
    noOffset();
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    // transitions internes des lots (opacités) : pas fixe
    if (V.lots && V.lots.update) V.lots.update(st.dt ?? 1 / 30);
    // teinte des lots plus soutenue que dans l'interface (lisible en vignette verticale)
    if (st.tint != null && st.floor != null) V.lots.group.traverse((o) => { const m = o.material; if (m && m.name && m.name.startsWith('lotTint:')) m.opacity = st.tint; });
    // disponibilités en façade : volumes discrets (l'architecture reste lisible)
    if (st.avail) V.lots.group.traverse((o) => { const m = o.material; if (!m || !m.name) return;
      if (m.name.startsWith('lotVolume:')) m.opacity = Math.min(m.opacity, 0.065);
      else if (m.name.startsWith('lotEdge:')) m.opacity = Math.min(m.opacity, 0.85); });
    // étiquettes de lots (dessinées par le compositeur) : ancres sur les façades visibles, projetées à l'écran
    window.__story.labels = null;
    if (st.avail && st.labels) {
      const W = renderer.domElement.clientWidth, H = renderer.domElement.clientHeight, v = new THREE.Vector3();
      window.__story.labels = st.labels.map((L) => { v.set(...L.p).project(camera); return { id: L.id, x: (v.x + 1) / 2, y: (1 - v.y) / 2, z: v.z }; });
    }
    // effets spéciaux optionnels (fil de fer, blueprint, trajectoires…) : fx-v4.js
    if (window.__fx) window.__fx(st);
    V.render();
    if (st.capture === false) return null;
    return renderer.domElement.toDataURL(st.mime || 'image/png', st.q || 0.95);
  }
  window.__story = { frame, S, hPlane, info: () => ({ w: renderer.domElement.width, h: renderer.domElement.height, floors: V.lots.floors, fy2: V.lots.floorY(2), ceil2: V.lots.walkCeilingY && V.lots.walkCeilingY(2), entry201: V.lots.lot('201').entry, vp201: V.lots.lot('201').viewpoint, trees: (V.landscape.userData.trees || []).filter((t) => Math.hypot(t.x, t.z + 9) < 30) }) };
})();
