// Canopée — nav.js
// Navigation façon jeu vidéo : joystick virtuel (souris / tactile), clavier, regard à la souris ou au doigt,
// quatre modes : 'orbit' (autour de la cible des OrbitControls), 'drone' (vol libre amorti), 'walk' (à pied, collisions),
// 'look' (caméra fixe, on tourne la tête : « Vue depuis le lot »).
//
//   createNavigation({ THREE, camera, controls, domElement, uiRoot, colliders, onChange, onExit, options })
//   colliders = { building: [{a:[x,z], b:[x,z]}], trees: [{x,z,radius}], groundY: (x,z)=>y,
//                 indoor: (x,z,y)=>segments|null, [buildingHeight], [floorAt: (x,z,eyeY)=>y|null],
//                 [boxes: [{min:[x,y,z], max:[x,y,z]}]], [ceilingAt: (x,z,y)=>y|null] }
//
// Hors mode orbite, les OrbitControls sont désactivés ET leur update() est neutralisée (le viewer peut continuer
// à l'appeler chaque image) ; elle est restaurée au retour en orbite, cible recentrée.

const STYLE_ID = 'cnv-nav-style';
const CSS = `
.cnv-nav{position:absolute;inset:auto 0 0 0;height:0;pointer-events:none;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;z-index:20;-webkit-user-select:none;user-select:none}
.cnv-joy{position:absolute;left:calc(26px + env(safe-area-inset-left) + var(--cnv-il,0px));bottom:calc(26px + env(safe-area-inset-bottom) + var(--cnv-ib,0px));transition:left .35s ease,bottom .35s ease;width:var(--cnv-size,132px);height:var(--cnv-size,132px);pointer-events:auto;touch-action:none;cursor:grab}
.cnv-joy:active{cursor:grabbing}
.cnv-base{position:absolute;inset:0;border-radius:50%;background:radial-gradient(circle at 50% 42%,rgba(46,48,50,.55),rgba(14,15,16,.62) 70%);
  -webkit-backdrop-filter:blur(14px) saturate(1.2);backdrop-filter:blur(14px) saturate(1.2);
  border:1px solid rgba(216,189,140,.38);box-shadow:0 10px 34px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.08),inset 0 0 0 6px rgba(216,189,140,.05);
  transition:border-color .25s,box-shadow .25s}
.cnv-joy.on .cnv-base{border-color:rgba(216,189,140,.75);box-shadow:0 10px 34px rgba(0,0,0,.35),0 0 0 4px rgba(216,189,140,.12),inset 0 1px 0 rgba(255,255,255,.08)}
.cnv-ring{position:absolute;inset:17%;border-radius:50%;border:1px dashed rgba(216,189,140,.22)}
.cnv-tick{position:absolute;left:50%;top:50%;width:0;height:0}
.cnv-tick i{position:absolute;left:-4px;top:calc(var(--cnv-size,132px) * -0.5 + 9px);border:4px solid transparent;border-bottom:5px solid rgba(216,189,140,.55);transition:border-bottom-color .2s}
.cnv-joy.on .cnv-tick i{border-bottom-color:rgba(216,189,140,.9)}
.cnv-knob{position:absolute;left:50%;top:50%;width:42%;height:42%;margin:-21% 0 0 -21%;border-radius:50%;
  background:radial-gradient(circle at 38% 32%,#f3e2bd,#d8bd8c 42%,#a8895a 100%);
  box-shadow:0 6px 16px rgba(0,0,0,.45),inset 0 -3px 6px rgba(80,55,20,.35),inset 0 2px 3px rgba(255,255,255,.6);
  transition:transform .32s cubic-bezier(.34,1.56,.5,1);will-change:transform}
.cnv-knob::after{content:"";position:absolute;inset:30%;border-radius:50%;border:1px solid rgba(90,64,28,.35);background:radial-gradient(circle,rgba(255,255,255,.18),transparent 70%)}
.cnv-joy.drag .cnv-knob{transition:none}
.cnv-cap{position:absolute;left:0;right:0;bottom:-21px;text-align:center;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:rgba(216,189,140,.85);text-shadow:0 1px 3px rgba(0,0,0,.6)}
.cnv-btns{position:absolute;right:calc(26px + env(safe-area-inset-right) + var(--cnv-ir,0px));bottom:calc(30px + env(safe-area-inset-bottom) + var(--cnv-ib,0px));transition:right .35s ease,bottom .35s ease;display:flex;flex-direction:column;gap:10px;pointer-events:auto}
.cnv-btn{width:48px;height:48px;border-radius:50%;display:grid;place-items:center;cursor:pointer;touch-action:none;
  background:rgba(18,19,20,.55);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);border:1px solid rgba(216,189,140,.35);color:#d8bd8c;
  box-shadow:0 8px 24px rgba(0,0,0,.3);transition:transform .15s,background .2s,border-color .2s;padding:0}
.cnv-btn:hover{border-color:rgba(216,189,140,.7)}
.cnv-btn.on,.cnv-btn:active{background:rgba(216,189,140,.22);border-color:#d8bd8c;transform:scale(.94)}
.cnv-btn svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.cnv-btn[hidden]{display:none}
.cnv-lock{font-size:10px;letter-spacing:.08em}
@media (max-width:640px),(pointer:coarse){.cnv-joy{--cnv-size:118px;left:calc(18px + env(safe-area-inset-left) + var(--cnv-il,0px));bottom:calc(22px + env(safe-area-inset-bottom) + var(--cnv-ib,0px))}.cnv-btns{right:calc(16px + env(safe-area-inset-right) + var(--cnv-ir,0px))}.cnv-btn{width:52px;height:52px}}
.cnv-fade{position:fixed;inset:0;background:#0c0c0d;opacity:0;pointer-events:none;z-index:2147483000}
`;
const ICON = {
  up: '<svg viewBox="0 0 24 24"><path d="M6 14l6-6 6 6"/><path d="M12 8v11"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M6 10l6 6 6-6"/><path d="M12 16V5"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M11 8v6M8 11h6M16 16l4 4"/></svg>',
  minus: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M8 11h6M16 16l4 4"/></svg>',
  run: '<svg viewBox="0 0 24 24"><circle cx="14" cy="4.5" r="1.8"/><path d="M8 21l3-6 3 2v5M11 15l1-5 4 3h3M12 10L8 11l-2 3"/></svg>',
};
const CAPTION = { orbit: 'Orbite', drone: 'Drone', walk: 'Balade', look: 'Regard' };

export function createNavigation({ THREE, camera, controls = null, domElement, uiRoot = document.body, colliders = {}, onChange = null, onExit = null, options = {} }) {
  const V3 = THREE.Vector3;
  const opt = {
    eye: 1.65, walkSpeed: 1.4, runSpeed: 3.5, indoorRun: 2.2, indoorFov: 70, droneSpeed: 9, droneRun: 22, climb: 5, droneRadius: 0.65, headroom: 0.25,
    minAlt: 2, maxAlt: 80, radius: 0.32, walkFov: 66, droneFov: 58,
    orbitRotSpeed: 1.6, orbitTiltSpeed: 1.0, zoomSpeed: 1.6, caption: true, ...options,
  };
  const S = {
    mode: 'orbit', enabled: true, flight: null,
    yaw: 0, pitch: 0, tYaw: 0, tPitch: 0,
    vel: new V3(), orbitVel: { az: 0, pol: 0, zoom: 0 },
    keys: new Set(), joy: { x: 0, y: 0 }, btn: { up: 0, down: 0, zin: 0, zout: 0 }, run: false,
    bob: 0, bobAmp: 0, eyeY: null, indoorFloor: null,
    fovTarget: camera.fov, orbitFov: camera.fov,
    home: controls ? { target: controls.target.clone() } : { target: new V3(0, 6, -9) },
    lastPose: new Float64Array(7), changed: true,
    look: null, fade: null, exitCb: onExit, indoor: false,
  };

  // ---------------------------------------------------------------------------
  // OrbitControls : neutralisation hors orbite
  // ---------------------------------------------------------------------------
  const ctlUpdate = controls ? controls.update.bind(controls) : null;
  function orbitControls(on) {
    if (!controls) return;
    controls.enabled = on;
    controls.update = on ? ctlUpdate : () => false;
  }

  // ---------------------------------------------------------------------------
  // Interface : joystick + boutons
  // ---------------------------------------------------------------------------
  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement('style'); st.id = STYLE_ID; st.textContent = CSS; document.head.appendChild(st);
  }
  const root = document.createElement('div'); root.className = 'cnv-nav';
  if (getComputedStyle(uiRoot).position === 'static' && uiRoot !== document.body) uiRoot.style.position = 'relative';
  if (uiRoot === document.body) { root.style.position = 'fixed'; }
  root.innerHTML = `
    <div class="cnv-joy" role="application" aria-label="Joystick de déplacement">
      <div class="cnv-base"></div><div class="cnv-ring"></div>
      ${[0, 90, 180, 270].map(a => `<div class="cnv-tick" style="transform:rotate(${a}deg)"><i></i></div>`).join('')}
      <div class="cnv-knob"></div><div class="cnv-cap"></div>
    </div>
    <div class="cnv-btns">
      <button class="cnv-btn" data-b="up" aria-label="Monter" title="Monter (E / Espace)">${ICON.up}</button>
      <button class="cnv-btn" data-b="down" aria-label="Descendre" title="Descendre (A / C)">${ICON.down}</button>
      <button class="cnv-btn" data-b="zin" aria-label="Rapprocher" title="Rapprocher (+)">${ICON.plus}</button>
      <button class="cnv-btn" data-b="zout" aria-label="Éloigner" title="Éloigner (−)">${ICON.minus}</button>
      <button class="cnv-btn" data-b="run" aria-label="Courir" aria-pressed="false" title="Courir (Maj)">${ICON.run}</button>
    </div>`;
  uiRoot.appendChild(root);
  const fadeEl = document.createElement('div'); fadeEl.className = 'cnv-fade'; document.body.appendChild(fadeEl);
  const joyEl = root.querySelector('.cnv-joy'), knob = root.querySelector('.cnv-knob'), cap = root.querySelector('.cnv-cap');
  const btnEls = Object.fromEntries([...root.querySelectorAll('.cnv-btn')].map(b => [b.dataset.b, b]));

  function refreshUI() {
    root.style.display = S.enabled ? '' : 'none';
    cap.textContent = opt.caption ? CAPTION[S.mode] : '';
    btnEls.up.hidden = btnEls.down.hidden = S.mode !== 'drone';
    btnEls.zin.hidden = btnEls.zout.hidden = S.mode !== 'orbit' && S.mode !== 'look';
    btnEls.run.hidden = S.mode !== 'walk';
    btnEls.run.classList.toggle('on', S.run); btnEls.run.setAttribute('aria-pressed', String(S.run));
  }

  // Joystick : manette qui suit le pointeur, zone morte, réponse progressive, ressort au relâcher
  let joyPtr = null;
  const DEAD = 0.12;
  function joyMove(e) {
    const r = joyEl.getBoundingClientRect(), R = r.width * 0.36;
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy);
    if (d > R) { dx *= R / d; dy *= R / d; }
    knob.style.transform = `translate(${dx.toFixed(1)}px,${dy.toFixed(1)}px)`;
    const m = Math.min(1, d / R), k = m < DEAD ? 0 : Math.pow((m - DEAD) / (1 - DEAD), 1.6);
    S.joy.x = d > 0 ? (dx / Math.max(d, 1e-6)) * k : 0;
    S.joy.y = d > 0 ? (-dy / Math.max(d, 1e-6)) * k : 0;
  }
  function joyEnd() {
    joyPtr = null; S.joy.x = S.joy.y = 0;
    joyEl.classList.remove('drag', 'on'); knob.style.transform = 'translate(0,0)';
  }
  const onJoyDown = e => {
    if (!S.enabled || joyPtr !== null) return;
    e.preventDefault(); e.stopPropagation();
    joyPtr = e.pointerId; joyEl.setPointerCapture?.(e.pointerId);
    joyEl.classList.add('drag', 'on'); joyMove(e);
  };
  const onJoyMove = e => { if (e.pointerId === joyPtr) { e.preventDefault(); joyMove(e); } };
  const onJoyUp = e => { if (e.pointerId === joyPtr) joyEnd(); };
  joyEl.addEventListener('pointerdown', onJoyDown);
  joyEl.addEventListener('pointermove', onJoyMove);
  joyEl.addEventListener('pointerup', onJoyUp);
  joyEl.addEventListener('pointercancel', onJoyUp);
  joyEl.addEventListener('lostpointercapture', onJoyUp);

  // Boutons maintenus (altitude, zoom) et bascule course
  for (const [k, el] of Object.entries(btnEls)) {
    if (k === 'run') { el.addEventListener('click', () => { S.run = !S.run; refreshUI(); }); continue; }
    const set = v => e => { e.preventDefault(); S.btn[k] = v; el.classList.toggle('on', !!v); if (v) el.setPointerCapture?.(e.pointerId); };
    el.addEventListener('pointerdown', set(1));
    el.addEventListener('pointerup', set(0)); el.addEventListener('pointercancel', set(0)); el.addEventListener('lostpointercapture', set(0));
    el.addEventListener('contextmenu', e => e.preventDefault());
  }

  // Clavier (codes physiques : ZQSD sur AZERTY = WASD sur QWERTY)
  const typing = e => { const t = e.target; return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)); };
  const HANDLED = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyC', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract']);
  const onKeyDown = e => {
    if (!S.enabled || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Escape' && S.mode === 'look' && !S.flight && !S.fade) { exitLook(); return; }
    if (!HANDLED.has(e.code)) return;
    S.keys.add(e.code);
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  };
  const onKeyUp = e => S.keys.delete(e.code);
  const onBlur = () => { S.keys.clear(); joyEnd(); };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  // Regard : glisser sur la scène (souris ou doigt), verrouillage du pointeur au clic droit
  let lookPtr = null, lastX = 0, lastY = 0;
  const touches = new Map(); let pinch0 = 0, pinchFov = 0;
  const freeMode = () => S.mode !== 'orbit' && !S.flight && !S.fade && S.enabled;
  const onDown = e => {
    if (!freeMode()) return;
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, [e.clientX, e.clientY]);
      if (touches.size === 2 && S.mode === 'look') {
        const [a, b] = [...touches.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); pinchFov = S.fovTarget; lookPtr = null; return;
      }
    }
    if (lookPtr !== null) return;
    if (e.pointerType === 'mouse' && e.button === 2) { domElement.requestPointerLock?.(); return; }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    lookPtr = e.pointerId; lastX = e.clientX; lastY = e.clientY;
    domElement.setPointerCapture?.(e.pointerId);
  };
  const onMove = e => {
    if (!freeMode()) return;
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
      touches.set(e.pointerId, [e.clientX, e.clientY]);
      if (touches.size >= 2 && S.mode === 'look' && pinch0 > 0) {
        const [a, b] = [...touches.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        S.fovTarget = clamp(pinchFov * pinch0 / Math.max(d, 1), S.look.fovMin, S.look.fovMax); return;
      }
    }
    if (document.pointerLockElement === domElement) { look(e.movementX, e.movementY, 0.0024); return; }
    if (e.pointerId !== lookPtr) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY;
    look(dx, dy, e.pointerType === 'touch' ? 0.0052 : 0.0034);
  };
  const onUp = e => {
    touches.delete(e.pointerId); if (touches.size < 2) pinch0 = 0;
    if (e.pointerId === lookPtr) lookPtr = null;
  };
  const onWheel = e => {
    if (S.mode !== 'look' || !S.enabled || S.flight) return;
    e.preventDefault();
    S.fovTarget = clamp(S.fovTarget * Math.exp(e.deltaY * 0.0012), S.look.fovMin, S.look.fovMax);
  };
  domElement.addEventListener('wheel', onWheel, { passive: false });
  const onCtx = e => { if (S.mode !== 'orbit') e.preventDefault(); };
  domElement.addEventListener('pointerdown', onDown);
  domElement.addEventListener('pointermove', onMove);
  domElement.addEventListener('pointerup', onUp);
  domElement.addEventListener('pointercancel', onUp);
  domElement.addEventListener('contextmenu', onCtx);
  function look(dx, dy, k) {
    if (S.mode === 'look') k *= S.fovTarget / 60;   // plus fin quand on zoome
    S.tYaw -= dx * k;
    S.tPitch = clamp(S.tPitch - dy * k, -1.35, 1.35);
    clampLook();
  }
  function clampLook() {
    const L = S.look; if (S.mode !== 'look' || !L) return;
    S.tYaw = L.yaw0 + clamp(S.tYaw - L.yaw0, -L.range, L.range);
    S.tPitch = clamp(S.tPitch, L.pitchMin, L.pitchMax);
  }

  // ---------------------------------------------------------------------------
  // Outils
  // ---------------------------------------------------------------------------
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  const damp = (k, dt) => 1 - Math.exp(-k * dt);
  const groundY = (x, z) => (colliders.groundY ? colliders.groundY(x, z) : 0) || 0;
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  function readCameraAngles() {
    euler.setFromQuaternion(camera.quaternion, 'YXZ');
    S.yaw = S.tYaw = euler.y; S.pitch = S.tPitch = clamp(euler.x, -1.35, 1.35);
  }
  function applyAngles() { camera.rotation.set(S.pitch, S.yaw, 0, 'YXZ'); }
  const yawToward = (dx, dz) => Math.atan2(-dx, -dz);

  // Boîte englobante du bâtiment (drone) : déduite des segments extérieurs
  let box = null;
  const buildEnvelope = () => {
    const segs = colliders.building || [];
    if (!segs.length) return null;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const s of segs) for (const p of [s.a, s.b]) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    return { x0, x1, z0, z1, h: colliders.buildingHeight ?? 15.2 };
  };
  box = buildEnvelope();
  const inBox = (x, z, m = 0) => box && x > box.x0 - m && x < box.x1 + m && z > box.z0 - m && z < box.z1 + m;

  // Collision cercle / segments avec glissement
  function pushSegs(p, r, segs) {
    let hit = false;
    for (const s of segs) {
      const ax = s.a[0], az = s.a[1], dx = s.b[0] - ax, dz = s.b[1] - az, L2 = dx * dx + dz * dz || 1e-9;
      let t = ((p.x - ax) * dx + (p.z - az) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = ax + dx * t, cz = az + dz * t; let ex = p.x - cx, ez = p.z - cz;
      const d2 = ex * ex + ez * ez;
      if (d2 < r * r) {
        let d = Math.sqrt(d2);
        if (d < 1e-5) { ex = -dz; ez = dx; d = Math.hypot(ex, ez) || 1; }
        p.x = cx + ex / d * r; p.z = cz + ez / d * r; hit = true;
      }
    }
    return hit;
  }
  function pushTrees(p, r) {
    for (const t of colliders.trees || []) {
      const tr = clamp((t.radius || 2) * 0.07, 0.16, 0.45), dx = p.x - t.x, dz = p.z - t.z, d = Math.hypot(dx, dz), R = r + tr;
      if (d < R && d > 1e-6) { p.x = t.x + dx / d * R; p.z = t.z + dz / d * R; }
    }
  }
  // Boîtes 3D (dalles, auvent, socle, édicule, garde-corps…) : cercle horizontal contre rectangle,
  // pour les boîtes qui coupent la tranche verticale du corps [pieds + 0,3 m, tête]
  function pushBoxes2D(p, r, yLo, yHi) {
    let hit = false;
    for (const b of colliders.boxes || []) {
      if (b.max[1] <= yLo || b.min[1] >= yHi) continue;
      const cx = clamp(p.x, b.min[0], b.max[0]), cz = clamp(p.z, b.min[2], b.max[2]);
      let ex = p.x - cx, ez = p.z - cz; const d2 = ex * ex + ez * ez;
      if (d2 >= r * r) continue;
      if (d2 > 1e-10) { const d = Math.sqrt(d2); p.x = cx + ex / d * r; p.z = cz + ez / d * r; }
      else {
        const pen = [[p.x - b.min[0], -1, 0], [b.max[0] - p.x, 1, 0], [p.z - b.min[2], 0, -1], [b.max[2] - p.z, 0, 1]].sort((u, v) => u[0] - v[0])[0];
        if (pen[1]) p.x = pen[1] < 0 ? b.min[0] - r : b.max[0] + r; else p.z = pen[2] < 0 ? b.min[2] - r : b.max[2] + r;
      }
      hit = true;
    }
    return hit;
  }
  // Sphère contre boîtes (drone) ; la vitesse perd sa composante entrante : glissement
  function pushBoxes3D(p, r, vel) {
    for (let it = 0; it < 3; it++) {
      let any = false;
      for (const b of colliders.boxes || []) {
        const cx = clamp(p.x, b.min[0], b.max[0]), cy = clamp(p.y, b.min[1], b.max[1]), cz = clamp(p.z, b.min[2], b.max[2]);
        let nx = p.x - cx, ny = p.y - cy, nz = p.z - cz; const d2 = nx * nx + ny * ny + nz * nz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-10) { const d = Math.sqrt(d2); nx /= d; ny /= d; nz /= d; p.set(cx + nx * r, cy + ny * r, cz + nz * r); }
        else {
          const pen = [[p.x - b.min[0], -1, 0, 0], [b.max[0] - p.x, 1, 0, 0], [p.y - b.min[1], 0, -1, 0], [b.max[1] - p.y, 0, 1, 0], [p.z - b.min[2], 0, 0, -1], [b.max[2] - p.z, 0, 0, 1]].sort((u, v) => u[0] - v[0])[0];
          [, nx, ny, nz] = pen; p.x += nx * (pen[0] + r); p.y += ny * (pen[0] + r); p.z += nz * (pen[0] + r);
        }
        if (vel) { const vn = vel.x * nx + vel.y * ny + vel.z * nz; if (vn < 0) { vel.x -= vn * nx; vel.y -= vn * ny; vel.z -= vn * nz; } }
        any = true;
      }
      if (!any) break;
    }
  }
  function walkResolve(p, eyeY) {
    const indoor = colliders.indoor ? colliders.indoor(p.x, p.z, eyeY) : null;
    const feet = eyeY - opt.eye;
    // aux étages, l'emprise du socle ne s'applique plus (balcons en saillie) : cloisons de l'étage + boîtes
    const ext = feet > 2.5 && indoor ? [] : (colliders.building || []);
    const segs = indoor && indoor.length ? ext.concat(indoor) : ext;
    for (let it = 0; it < 4; it++) {
      const a = pushSegs(p, opt.radius, segs); pushTrees(p, opt.radius);
      const c = pushBoxes2D(p, opt.radius, feet + 0.3, eyeY + 0.12);
      if (!a && !c) break;
    }
  }
  // Hauteur du sol sous le promeneur : plancher d'un lot (si on y est entré) sinon terrain
  function floorAt(x, z, eyeY) {
    S.indoor = true;
    if (colliders.floorAt) { const f = colliders.floorAt(x, z, eyeY); if (f != null) return f; }
    if (S.indoorFloor != null && inBox(x, z, 1.6)) return S.indoorFloor;
    S.indoor = false;
    return groundY(x, z);
  }

  // ---------------------------------------------------------------------------
  // Transitions (vol en arc)
  // ---------------------------------------------------------------------------
  const qTmp = new THREE.Quaternion(), objTmp = new THREE.Object3D();
  function fly({ pos, quat, fov, duration, onEnd }) {
    const p0 = camera.position.clone(), p1 = pos.clone(), dist = p0.distanceTo(p1);
    const pc = p0.clone().lerp(p1, 0.5); pc.y = Math.max(p0.y, p1.y) + Math.min(14, Math.max(1.2, dist * 0.22));
    S.flight = { t: 0, dur: duration ?? clamp(0.7 + dist / 38, 0.7, 2.4), p0, p1, pc, q0: camera.quaternion.clone(), q1: quat, fov0: camera.fov, fov1: fov ?? camera.fov, onEnd };
    S.vel.set(0, 0, 0); S.orbitVel.az = S.orbitVel.pol = S.orbitVel.zoom = 0;
    orbitControls(false);
  }
  const quatFrom = (yaw, pitch) => new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
  const quatLook = (from, to) => { objTmp.position.copy(from); objTmp.up.set(0, 1, 0); objTmp.lookAt(to); return objTmp.quaternion.clone(); };
  const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  function teleport({ pos, yaw, pitch = 0, mode, fov, duration, fade = false, look = null } = {}) {
    const m = mode || (S.mode === 'orbit' ? 'walk' : S.mode);
    const p = Array.isArray(pos) ? new V3(...pos) : pos.clone();
    if (yaw == null) yaw = S.yaw;
    // arrivée en hauteur (appartement, balcon) : on reste sur ce plancher tant qu'on est près du bâtiment
    if (m === 'walk') { const f = p.y - opt.eye; S.indoorFloor = inBox(p.x, p.z, 1.6) && f > groundY(p.x, p.z) + 0.5 ? f : null; }
    const prev = S.mode;
    S.mode = m; S.look = m === 'look' ? look : null; refreshUI();
    const fov1 = fov ?? (m === 'walk' ? (S.indoorFloor != null ? opt.indoorFov : opt.walkFov) : m === 'drone' ? opt.droneFov : S.orbitFov);
    const arrive = () => {
      S.yaw = S.tYaw = yaw; S.pitch = S.tPitch = pitch; S.eyeY = p.y; S.fovTarget = camera.fov; S.vel.set(0, 0, 0);
      if (m === 'orbit') enterOrbit();
    };
    if (fade) {
      S.flight = null; orbitControls(false); S.vel.set(0, 0, 0);
      S.fade = { t: 0, out: 0.14, hold: 0.06, inn: 0.18, done: false,
        apply: () => { camera.position.copy(p); camera.quaternion.copy(quatFrom(yaw, pitch)); camera.fov = fov1; camera.updateProjectionMatrix(); arrive(); } };
    } else fly({ pos: p, quat: quatFrom(yaw, pitch), fov: fov1, duration, onEnd: arrive });
    if (prev !== m) emit(true);
  }

  // Sortie du mode regard : rappel du viewer (bouton « Retour », Échap) ou retour à l'orbite
  function exitLook() {
    const cb = S.exitCb;
    if (cb) cb(getState()); else setMode('orbit');
  }

  function enterOrbit(target) {
    if (target && controls) controls.target.copy(target);
    orbitControls(true);
    if (controls) { camera.lookAt(controls.target); ctlUpdate(); }
    S.fovTarget = S.orbitFov;
  }

  function setMode(mode, o = {}) {
    if (!['orbit', 'drone', 'walk', 'look'].includes(mode)) return;
    if (S.flight) { S.flight = null; }
    const from = S.mode;
    if (mode === 'look') {
      if (from === 'orbit') readCameraAngles();
      if (o.onExit) S.exitCb = o.onExit;
      const pos = o.pos ? o.pos : camera.position.clone();
      const yaw = o.yaw ?? S.yaw, pitch = clamp(o.pitch ?? 0, -35 * Math.PI / 180, 20 * Math.PI / 180);
      const fov = clamp(o.fov ?? 60, 40, 75);
      const look = { yaw0: yaw, range: (o.yawRange ?? 120) * Math.PI / 180, pitchMin: -35 * Math.PI / 180, pitchMax: 20 * Math.PI / 180, fovMin: 40, fovMax: 75 };
      teleport({ pos, yaw, pitch, fov, mode: 'look', look, fade: !!o.fade, duration: o.duration });
      return;
    }
    if (mode === from && !o.pos) return;
    if (from === 'orbit') readCameraAngles();
    if (o.pos) { teleport({ ...o, mode }); return; }
    const cam = camera.position;
    if (mode === 'orbit') {
      const tgt = o.target ? (Array.isArray(o.target) ? new V3(...o.target) : o.target.clone()) : S.home.target.clone();
      const off = new V3(cam.x - tgt.x, 0, cam.z - tgt.z);
      if (off.lengthSq() < 1) off.set(0, 0, 1);
      const minD = controls ? Math.max(controls.minDistance, 22) : 22, maxD = controls ? Math.min(controls.maxDistance, 48) : 48;
      const d = clamp(cam.distanceTo(tgt), minD, maxD), el = 0.32;
      off.normalize().multiplyScalar(d * Math.cos(el)); off.y = d * Math.sin(el);
      const p1 = o.position ? new V3(...o.position) : tgt.clone().add(off);
      S.mode = 'orbit'; S.indoorFloor = null; S.look = null; refreshUI();
      fly({ pos: p1, quat: quatLook(p1, tgt), fov: S.orbitFov, onEnd: () => enterOrbit(tgt) });
    } else if (mode === 'walk') {
      let x, z;
      if ((from === 'drone' || from === 'look') && !inBox(cam.x, cam.z, 0.6)) { x = cam.x; z = cam.z; }
      else { x = clamp(cam.x, -5, 5); z = box ? box.z1 + 6.6 : 7; }   // sur le trottoir, face au bâtiment
      const p = { x, z }; walkResolve(p, opt.eye);
      const tgt = controls ? controls.target : S.home.target;
      const yaw = from === 'drone' ? S.yaw : yawToward(tgt.x - p.x, tgt.z - p.z);
      S.indoorFloor = null;
      teleport({ pos: [p.x, groundY(p.x, p.z) + opt.eye, p.z], yaw, pitch: from === 'drone' ? 0 : 0.12, mode: 'walk' });
    } else {
      const g = groundY(cam.x, cam.z);
      const y = clamp(Math.max(cam.y, g + (from === 'walk' ? 7 : opt.minAlt)), opt.minAlt, opt.maxAlt);
      teleport({ pos: [cam.x, y, cam.z], yaw: S.yaw, pitch: from === 'walk' ? -0.25 : S.pitch, mode: 'drone', duration: from === 'walk' ? 1.1 : 0.6 });
    }
    emit(true);
  }

  // ---------------------------------------------------------------------------
  // Boucle
  // ---------------------------------------------------------------------------
  const fwd = new V3(), right = new V3(), want = new V3(), sph = new THREE.Spherical();
  function axes() {
    const k = S.keys, j = S.joy;
    let mx = j.x, my = j.y, up = 0, turn = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) my += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) my -= 1;
    if (k.has('KeyD')) mx += 1;
    if (k.has('KeyA')) mx -= 1;
    if (k.has('ArrowRight')) turn += 1;
    if (k.has('ArrowLeft')) turn -= 1;
    if (k.has('KeyE') || k.has('Space') || S.btn.up) up += 1;
    if (k.has('KeyQ') || k.has('KeyC') || S.btn.down) up -= 1;
    const len = Math.hypot(mx, my); if (len > 1) { mx /= len; my /= len; }
    let zoom = 0;
    if (k.has('Equal') || k.has('NumpadAdd') || S.btn.zin) zoom -= 1;
    if (k.has('Minus') || k.has('NumpadSubtract') || S.btn.zout) zoom += 1;
    return { mx, my, up, turn, zoom, run: S.run || k.has('ShiftLeft') || k.has('ShiftRight') };
  }

  function update(dtIn) {
    const dt = Math.min(0.05, Math.max(0, dtIn || 0));
    if (S.fade) {
      const f = S.fade; f.t += dt;
      if (!f.done && f.t >= f.out) { f.done = true; f.apply(); }
      const a = f.t < f.out ? f.t / f.out : f.t < f.out + f.hold ? 1 : 1 - (f.t - f.out - f.hold) / f.inn;
      fadeEl.style.opacity = String(clamp(a, 0, 1));
      if (f.t >= f.out + f.hold + f.inn) { S.fade = null; fadeEl.style.opacity = '0'; emit(true); }
      S.changed = true;
      return poseChanged();
    }
    if (S.flight) {
      const f = S.flight; f.t = Math.min(1, f.t + dt / f.dur);
      const e = ease(f.t), u = 1 - e;
      camera.position.set(
        u * u * f.p0.x + 2 * u * e * f.pc.x + e * e * f.p1.x,
        u * u * f.p0.y + 2 * u * e * f.pc.y + e * e * f.p1.y,
        u * u * f.p0.z + 2 * u * e * f.pc.z + e * e * f.p1.z);
      camera.quaternion.slerpQuaternions(f.q0, f.q1, e);
      camera.fov = f.fov0 + (f.fov1 - f.fov0) * e; camera.updateProjectionMatrix();
      if (f.t >= 1) { S.flight = null; f.onEnd && f.onEnd(); emit(true); }
      return poseChanged();
    }
    if (!S.enabled) return poseChanged();
    const a = axes();
    if (S.mode === 'orbit') updateOrbit(a, dt);
    else if (S.mode === 'drone') updateDrone(a, dt);
    else if (S.mode === 'look') updateLook(a, dt);
    else updateWalk(a, dt);
    // focale douce
    if (Math.abs(camera.fov - S.fovTarget) > 0.01) { camera.fov += (S.fovTarget - camera.fov) * damp(5, dt); camera.updateProjectionMatrix(); }
    return poseChanged();
  }

  function updateOrbit(a, dt) {
    if (!controls) return;
    const ov = S.orbitVel, k = damp(6, dt);
    ov.az += ((-a.mx - a.turn) * opt.orbitRotSpeed - ov.az) * k;
    ov.pol += ((a.my) * opt.orbitTiltSpeed - ov.pol) * k;
    ov.zoom += (a.zoom * opt.zoomSpeed - ov.zoom) * k;
    if (Math.abs(ov.az) + Math.abs(ov.pol) + Math.abs(ov.zoom) < 1e-4) return;
    const t = controls.target, off = camera.position.clone().sub(t);
    sph.setFromVector3(off);
    sph.theta += ov.az * dt;
    sph.phi = clamp(sph.phi - ov.pol * dt, Math.max(0.05, controls.minPolarAngle), Math.min(Math.PI - 0.05, controls.maxPolarAngle));
    sph.radius = clamp(sph.radius * Math.exp(ov.zoom * dt), controls.minDistance, controls.maxDistance);
    off.setFromSpherical(sph);
    camera.position.copy(t).add(off);
    const g = groundY(camera.position.x, camera.position.z) + 0.4;
    if (camera.position.y < g) camera.position.y = g;
    camera.lookAt(t);
  }

  // Regard fixe : joystick / flèches = tourner la tête, zoom par la focale, aucune translation
  function updateLook(a, dt) {
    const k = S.fovTarget / 60;
    S.tYaw -= (a.mx + a.turn) * 1.3 * k * dt;
    S.tPitch += a.my * 0.9 * k * dt;
    clampLook();
    if (a.zoom) S.fovTarget = clamp(S.fovTarget * Math.exp(a.zoom * 0.9 * dt), S.look.fovMin, S.look.fovMax);
    const kk = damp(9, dt);
    S.yaw += (S.tYaw - S.yaw) * kk; S.pitch += (S.tPitch - S.pitch) * kk;
    applyAngles();
  }

  function smoothLook(dt, kbTurn) {
    S.tYaw -= kbTurn * 1.7 * dt;
    const k = damp(16, dt);
    S.yaw += (S.tYaw - S.yaw) * k;
    S.pitch += (S.tPitch - S.pitch) * k;
    applyAngles();
  }

  function updateDrone(a, dt) {
    smoothLook(dt, a.turn);
    fwd.set(-Math.sin(S.yaw), 0, -Math.cos(S.yaw)); right.set(-fwd.z, 0, fwd.x);
    const sp = a.run ? opt.droneRun : opt.droneSpeed;
    want.copy(fwd).multiplyScalar(a.my * sp).addScaledVector(right, a.mx * sp); want.y = a.up * opt.climb * (a.run ? 2 : 1);
    S.vel.lerp(want, damp(want.lengthSq() > S.vel.lengthSq() ? 3 : 4.5, dt));
    if (S.vel.lengthSq() < 1e-6) { S.vel.set(0, 0, 0); return; }
    const p = camera.position.addScaledVector(S.vel, dt);
    const g = groundY(p.x, p.z);
    p.y = clamp(p.y, g + opt.minAlt, opt.maxAlt);
    pushBoxes3D(p, opt.droneRadius, S.vel);
    // pas dans le bâtiment : sortie par la face la plus proche
    const m = 1.2;
    if (box && inBox(p.x, p.z, m) && p.y < box.h + m) {
      const pen = [[p.x - (box.x0 - m), 'x0'], [(box.x1 + m) - p.x, 'x1'], [p.z - (box.z0 - m), 'z0'], [(box.z1 + m) - p.z, 'z1'], [(box.h + m) - p.y, 'y']].sort((u, v) => u[0] - v[0])[0];
      if (pen[1] === 'x0') p.x = box.x0 - m; else if (pen[1] === 'x1') p.x = box.x1 + m;
      else if (pen[1] === 'z0') p.z = box.z0 - m; else if (pen[1] === 'z1') p.z = box.z1 + m; else p.y = box.h + m;
    }
  }

  function updateWalk(a, dt) {
    smoothLook(dt, a.turn);
    S.fovTarget = S.indoor ? opt.indoorFov : opt.walkFov;
    fwd.set(-Math.sin(S.yaw), 0, -Math.cos(S.yaw)); right.set(-fwd.z, 0, fwd.x);
    const sp = a.run ? (S.indoor ? opt.indoorRun : opt.runSpeed) : opt.walkSpeed;
    want.copy(fwd).multiplyScalar(a.my * sp).addScaledVector(right, a.mx * sp); want.y = 0;
    S.vel.lerp(want, damp(want.lengthSq() > S.vel.lengthSq() ? 5 : 7, dt));
    if (S.vel.lengthSq() < 1e-6) S.vel.set(0, 0, 0);
    const cam = camera.position, step = S.vel.clone().multiplyScalar(dt), n = Math.max(1, Math.ceil(step.length() / (opt.radius * 0.7)));
    const p = { x: cam.x, z: cam.z };
    const eyeNow = S.eyeY ?? cam.y;
    for (let i = 0; i < n; i++) { p.x += step.x / n; p.z += step.z / n; walkResolve(p, eyeNow); }
    // vitesse réelle (glissement le long des murs)
    const speed = Math.hypot(p.x - cam.x, p.z - cam.z) / Math.max(dt, 1e-4);
    cam.x = p.x; cam.z = p.z;
    let eyeTarget = floorAt(p.x, p.z, eyeNow) + opt.eye;
    const ceil = colliders.ceilingAt ? colliders.ceilingAt(p.x, p.z, eyeNow) : null;
    if (ceil != null) eyeTarget = Math.min(eyeTarget, ceil - opt.headroom);
    S.eyeY = S.eyeY == null ? eyeTarget : S.eyeY + (eyeTarget - S.eyeY) * damp(9, dt);
    if (ceil != null) S.eyeY = Math.min(S.eyeY, ceil - opt.headroom);
    // balancement de marche très discret
    S.bobAmp += (clamp(speed / opt.runSpeed, 0, 1) - S.bobAmp) * damp(6, dt);
    S.bob += dt * (5.2 + speed * 1.6);
    cam.y = S.eyeY + Math.sin(S.bob * 2) * 0.018 * S.bobAmp;
    if (S.bobAmp > 0.01) { camera.rotation.z = Math.sin(S.bob) * 0.0025 * S.bobAmp; }
  }

  const pose = () => [camera.position.x, camera.position.y, camera.position.z, camera.quaternion.x, camera.quaternion.y, camera.quaternion.z, camera.fov];
  function poseChanged() {
    const p = pose(); let moved = false;
    for (let i = 0; i < 7; i++) if (Math.abs(p[i] - S.lastPose[i]) > 1e-6) { moved = true; break; }
    if (moved) { S.lastPose.set(p); emit(false); }
    const ch = moved || S.changed; S.changed = false;
    return ch;
  }
  function getState() {
    euler.setFromQuaternion(camera.quaternion, 'YXZ');
    return { mode: S.mode, pos: camera.position.toArray(), yaw: euler.y, pitch: euler.x, fov: camera.fov, flying: !!(S.flight || S.fade), run: S.run, indoor: S.mode === 'walk' && S.indoor };
  }
  function emit(modeChange) { if (onChange) onChange({ ...getState(), modeChange }); }

  function setEnabled(on) {
    S.enabled = !!on;
    if (!on) { S.keys.clear(); joyEnd(); lookPtr = null; S.vel.set(0, 0, 0); }
    refreshUI();
  }

  function dispose() {
    joyEl.removeEventListener('pointerdown', onJoyDown);
    window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('blur', onBlur);
    domElement.removeEventListener('pointerdown', onDown); domElement.removeEventListener('pointermove', onMove);
    domElement.removeEventListener('pointerup', onUp); domElement.removeEventListener('pointercancel', onUp); domElement.removeEventListener('contextmenu', onCtx);
    domElement.removeEventListener('wheel', onWheel); fadeEl.remove();
    if (controls) { controls.update = ctlUpdate; controls.enabled = true; }
    root.remove();
  }

  refreshUI();
  readCameraAngles();
  S.lastPose.set(pose());

  return {
    get mode() { return S.mode; },
    setMode, teleport, update, setEnabled, dispose, getState,
    joystick: root,
    /** Cible d'orbite par défaut (retour à l'orbite). */
    setHome(target) { S.home.target.copy(Array.isArray(target) ? new V3(...target) : target); },
    /** Collisions remplacées à chaud (ex. cloisons de l'étage affiché). */
    setColliders(c) { Object.assign(colliders, c); if ('building' in c || 'buildingHeight' in c) box = buildEnvelope(); },
    /** Décale joystick et boutons (px) quand un panneau du viewer est ouvert. */
    setInsets({ bottom = 0, left = 0, right = 0 } = {}) {
      root.style.setProperty('--cnv-ib', bottom + 'px'); root.style.setProperty('--cnv-il', left + 'px'); root.style.setProperty('--cnv-ir', right + 'px');
    },
    /** Rappel de sortie du mode regard (Échap) ; sinon retour à l'orbite. */
    setOnExit(fn) { S.exitCb = fn; },
    exitLook,
  };
}
