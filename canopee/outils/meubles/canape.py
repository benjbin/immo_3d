# Canapé et fauteuil « capitonnés » sculptés dans Blender par simulation de tissu (housse gonflée, fronces aux coutures,
# coussins posés par gravité), pour remplacer la version générée par code de 3d/furniture.js.
#   Blender -b -P outils/meubles/canape.py -- <sortie> <largeur> [nom] [rendu.png]
# Repère Blender : x largeur, y profondeur (façade vers −y), z hauteur. Sortie : <nom>.json + <nom>.bin (voir export()).
import bpy, bmesh, sys, os, math, json, time
import numpy as np
from mathutils import Vector

A = sys.argv[sys.argv.index('--') + 1:]
OUT, W = A[0], float(A[1])
NAME = A[2] if len(A) > 2 else 'canape'
SHOT = A[3] if len(A) > 3 else None
STEP = float(os.environ.get('MB_STEP', 0.017))   # maille de la housse : régulière, exportée telle quelle (une maille allégée après coup se froisse)
rng = np.random.default_rng(int(W * 100))
T0 = time.time()
def log(*a): print('[mb %5.1fs]' % (time.time() - T0), *a, flush=True)

D = 0.88 if W < 1.2 else 0.98; SEAT_H = 0.43; TH = 0.2 if W < 1.2 else 0.25; BACK_H = 0.74 if W < 1.2 else 0.76; ARM_H = 0.6
RCMAX = 0.27 if W < 1.2 else 0.3      # mêmes cotes que channelSofa() de 3d/furniture.js (fauteuil : largeur 0,86)
SM = lambda x, a, b: float(np.clip((x - a) / (b - a), 0, 1)) ** 2 * (3 - 2 * float(np.clip((x - a) / (b - a), 0, 1)))

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

def new_object(name, co, faces):
    me = bpy.data.meshes.new(name); me.from_pydata([tuple(c) for c in co], [], faces); me.update()
    ob = bpy.data.objects.new(name, me); scene.collection.objects.link(ob)
    for p in me.polygons: p.use_smooth = True
    return ob

def weld(ob, dist=1e-5, recalc=True):
    bm = bmesh.new(); bm.from_mesh(ob.data); bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=dist)
    if recalc: bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data); bm.free(); ob.data.update()

def simulate(ob, pin, frames=45, pressure=6.0, shrink=-0.06, gravity=0.0, tension=12, bending=0.4, mass=0.25, colliders=False):
    vg = ob.vertex_groups.new(name='pin')
    for i in np.nonzero(pin)[0]: vg.add([int(i)], 1.0, 'REPLACE')
    m = ob.modifiers.new('tissu', 'CLOTH'); s = m.settings
    s.quality = 8; s.mass = mass; s.vertex_group_mass = 'pin'; s.pin_stiffness = 1.0
    s.tension_stiffness = tension; s.compression_stiffness = tension; s.shear_stiffness = tension * 0.4; s.bending_stiffness = bending
    s.tension_damping = 5; s.compression_damping = 5; s.shear_damping = 5; s.bending_damping = 0.5; s.air_damping = 3
    s.use_pressure = pressure > 0; s.uniform_pressure_force = pressure; s.use_pressure_volume = False
    s.shrink_min = shrink; s.effector_weights.gravity = gravity
    m.collision_settings.use_collision = colliders; m.collision_settings.use_self_collision = False
    m.collision_settings.distance_min = 0.006
    m.point_cache.frame_start = 1; m.point_cache.frame_end = frames
    return m

def run(frames):
    for f in range(1, frames + 1): scene.frame_set(f)

def freeze(ob):
    dg = bpy.context.evaluated_depsgraph_get(); ev = ob.evaluated_get(dg)
    co = np.zeros(len(ev.data.vertices) * 3, dtype=np.float32); ev.data.vertices.foreach_get('co', co)
    for m in list(ob.modifiers): ob.modifiers.remove(m)
    ob.data.vertices.foreach_set('co', co); ob.data.update()

# ------------------------------------------------------------------ assise : bloc capitonné
def seat_block():
    bw, bd, h, r = W - 0.1, D - 0.16, SEAT_H - 0.02, 0.085
    ncol = max(3, round(bw / 0.215)); nrow = 3 if W < 1.2 else 4
    # coutures : largeurs de colonnes et de rangs irrégulières
    def cuts(L, n, j):
        w = 1 + (rng.random(n) - 0.5) * j; e = np.concatenate([[0], np.cumsum(w)]) / w.sum() * L - L / 2
        return e
    ex, ey = cuts(bw, ncol, 0.14), cuts(bd, nrow, 0.12)
    def axis(e):
        out, seam = [], []
        for a, b in zip(e[:-1], e[1:]):
            n = max(2, round((b - a) / STEP)); out += list(np.linspace(a, b, n, endpoint=False)); seam += [True] + [False] * (n - 1)
        return np.array(out + [e[-1]]), np.array(seam + [True])
    xs, sx = axis(ex); ys, sy = axis(ey); zs = np.linspace(-h / 2, h / 2, max(3, round(h / STEP)) + 1)
    co, faces, tag = [], [], []       # tag : (couture x, couture y, face)
    def grid(U, V, f, su, sv, face, flip):
        o = len(co); nu, nv = len(U), len(V)
        for j in range(nv):
            for i in range(nu): co.append(f(U[i], V[j])); tag.append((bool(su[i]), bool(sv[j]), face))
        for j in range(nv - 1):
            for i in range(nu - 1):
                a = o + j * nu + i; q = (a, a + 1, a + nu + 1, a + nu); faces.append(q[::-1] if flip else q)
    F = np.zeros(len(zs), bool)
    grid(xs, ys, lambda u, v: (u, v, h / 2), sx, sy, 'top', False)
    grid(xs, zs, lambda u, v: (u, -bd / 2, v), sx, F, 'front', False)
    grid(ys, zs, lambda u, v: (-bw / 2, u, v), sy, F, 'side', True)
    grid(ys, zs, lambda u, v: (bw / 2, u, v), sy, F, 'side', False)
    co = np.array(co, dtype=np.float64)
    # arêtes arrondies (rayon r), sauf en bas (posé au sol)
    inner = np.array([bw / 2 - r, bd / 2 - r, h / 2 - r])
    q = np.clip(co, -inner, inner); q[:, 2] = np.where(co[:, 2] < 0, co[:, 2], q[:, 2]); q[:, 1] = np.where(co[:, 1] > 0, co[:, 1], q[:, 1])
    dv = co - q; L = np.linalg.norm(dv, axis=1); m = L > 1e-9
    co[m] = q[m] + dv[m] / L[m, None] * r
    n0 = len(co); pin = np.zeros(n0, bool); disp = np.zeros((n0, 3))
    for i, (a, b, f) in enumerate(tag):
        seam = (f == 'top' and (a or b)) or (f == 'front' and a) or (f == 'side' and a)
        low = co[i, 2] < -h / 2 + 0.012; back = co[i, 1] > bd / 2 - 0.012
        if seam or low or back: pin[i] = True
        if seam and not low:
            n = co[i] - q[i]; n = n / np.linalg.norm(n) if np.linalg.norm(n) > 1e-9 else np.array({'top': (0, 0, 1), 'front': (0, -1, 0), 'side': (np.sign(co[i, 0]), 0, 0)}[f], float)
            disp[i] = -n * (0.022 if (f == 'top' and a and b) else 0.013)
    # sommets communs à deux faces : même décision des deux côtés (sinon la housse s'ouvre)
    keys = [tuple(k) for k in np.round(co / 2e-4).astype(np.int64)]; grp = {}
    for i, k in enumerate(keys): grp.setdefault(k, []).append(i)
    for ids in grp.values():
        if len(ids) > 1:
            pin[ids] = pin[ids].any(); dd = disp[ids]; nz = np.abs(dd).sum(1) > 0
            disp[ids] = dd[nz].mean(0) if nz.any() else 0
    ob = new_object('assise', co + disp, faces)
    pinned = (co + disp)[pin]
    weld(ob, 1e-4)
    c2 = np.zeros(len(ob.data.vertices) * 3, dtype=np.float32); ob.data.vertices.foreach_get('co', c2); c2 = c2.reshape(-1, 3)
    ks = set(map(tuple, np.round(pinned / 2e-4).astype(np.int64))); pin2 = np.array([tuple(k) in ks for k in np.round(c2 / 2e-4).astype(np.int64)])
    ob.location = (0, -D / 2 + bd / 2 + 0.0, 0.02 + h / 2)
    simulate(ob, pin2, pressure=float(os.environ.get('MB_P', 7)), shrink=float(os.environ.get('MB_SHRINK', -0.045)))
    return ob

# ------------------------------------------------------------------ coque : dossier + accoudoirs, section arrondie le long d'un U
def shell():
    th, RC = TH, min(RCMAX, W / 2 - TH / 2 - 0.005)
    xs_, zb, zf = W / 2 - th / 2, -D / 2 + th / 2, D / 2 - 0.34        # repère de furniture.js (z vers la façade)
    L1 = zf - (zb + RC); La = math.pi * RC / 2; L2 = 2 * (xs_ - RC); LT = 2 * L1 + 2 * La + L2
    def at(s):
        if s < L1: return (-xs_, zf - s, -1, 0)
        s -= L1
        if s < La: t = s / RC; return (-xs_ + RC - RC * math.cos(t), zb + RC - RC * math.sin(t), -math.cos(t), -math.sin(t))
        s -= La
        if s < L2: return (-xs_ + RC + s, zb, 0, -1)
        s -= L2
        if s < La: t = s / RC; return (xs_ - RC + RC * math.sin(t), zb + RC - RC * math.cos(t), math.sin(t), -math.cos(t))
        s -= La; return (xs_, zb + RC + s, 1, 0)
    capL = min(0.2, L1 - 0.03)
    SS = []; seams = set()
    def seg(s0, s1, m):
        seams.add(len(SS))
        for k in range(m): SS.append(s0 + (s1 - s0) * k / m)
    st = STEP * 1.15
    seg(0, capL, 14); seg(capL, L1, max(2, round((L1 - capL) / st))); seg(L1, L1 + La, max(8, round(La / st))); seg(L1 + La, L1 + La + L2, round(L2 / st))
    seg(L1 + La + L2, LT - L1, max(8, round(La / st))); seg(LT - L1, LT - capL, max(2, round((L1 - capL) / st))); seg(LT - capL, LT, 14); SS.append(LT)
    seams.discard(0)
    NS = len(SS) - 1; NT = int(round(2.0 / st / 4)) * 4; e = 0.6; ph = rng.random() * 6
    co, faces, pin = [], [], []
    jp = round(NT * 0.115)
    for i in range(NS + 1):
        s_ = SS[i]; px, pz, nx, nz = at(min(LT - 1e-6, s_))
        de = min(s_, LT - s_)
        cap = 1 if de >= capL else math.sqrt(max(0, 1 - (1 - de / capL) ** 2))
        arm = SM(de, 0, L1 + La * 0.9)
        H = (ARM_H + (BACK_H - ARM_H) * arm) * (0.62 + 0.38 * cap); hw = (th / 2) * (0.25 + 0.75 * cap); y0 = 0.02; hh = (H - y0) / 2
        for j in range(NT):
            a = 2 * math.pi * j / NT; ca, sa = math.cos(a), math.sin(a)
            ox = hw * math.copysign(abs(ca) ** e, ca); oy = hh * math.copysign(abs(sa) ** e, sa)
            ox *= 1 + 0.07 * max(0, sa) * math.sin(math.pi * min(1, max(0, (oy + hh) / (2 * hh)))) + 0.05 * (1 if ca < 0 else 0.4) * (1 - sa * sa) ** 2
            lean = 0.04 * max(0, oy / hh) * arm
            yy = y0 + hh + oy
            seam = (j == jp and de > 0.02) or (i in seams and yy > 0.06) or (j == NT // 2 - jp and de > capL)
            d_ = 0.009 if seam else 0
            co.append((px + nx * (ox + lean - d_ * ca), -(pz + nz * (ox + lean - d_ * ca)), yy - d_ * sa))
            pin.append(seam or yy < 0.05 or i == 0 or i == NS)
    for i in range(NS):
        for j in range(NT):
            a0 = i * NT + j; a1 = i * NT + (j + 1) % NT; faces.append((a0, a1, a1 + NT, a0 + NT))
    for i0, flip in ((0, False), (NS, True)):                               # bouts d'accoudoir fermés
        c0 = len(co); px, pz, _, _ = at(LT - 1e-6 if i0 else 0); co.append((px, -pz, 0.3)); pin.append(True)
        for j in range(NT):
            a0 = i0 * NT + j; a1 = i0 * NT + (j + 1) % NT; faces.append((c0, a0, a1) if flip else (c0, a1, a0))
    ob = new_object('coque', np.array(co), faces)
    bm = bmesh.new(); bm.from_mesh(ob.data); bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(ob.data); bm.free()
    simulate(ob, np.array(pin), pressure=float(os.environ.get('MB_PS', 3.5)), shrink=float(os.environ.get('MB_SHRINK_S', -0.022)), tension=20, bending=1.0)
    return ob

# ------------------------------------------------------------------ coussins libres : deux faces cousues, gonflées, posées par gravité
def cushion(name, x, y, size, tilt, rz, hgt=None, seed=0):
    hgt = hgt or size; nu = max(8, round(size / STEP)); nv = max(8, round(hgt / STEP))
    U = np.linspace(-size / 2, size / 2, nu + 1); V = np.linspace(-hgt / 2, hgt / 2, nv + 1)
    co, faces = [], []
    for side in (-1, 1):
        o = len(co)
        for j in range(nv + 1):
            for i in range(nu + 1):
                # coins arrondis (coussin cousu, pas une boîte)
                u, v = U[i], V[j]; cr = 0.05; qu = max(-size / 2 + cr, min(size / 2 - cr, u)); qv = max(-hgt / 2 + cr, min(hgt / 2 - cr, v))
                du, dv = u - qu, v - qv; L = math.hypot(du, dv)
                if L > cr: u, v = qu + du / L * cr, qv + dv / L * cr
                edge = i in (0, nu) or j in (0, nv)
                co.append((u, 0 if edge else side * 0.012, v))
        for j in range(nv):
            for i in range(nu):
                a = o + j * (nu + 1) + i; q = (a, a + 1, a + nu + 2, a + nu + 1); faces.append(q if side < 0 else q[::-1])
    ob = new_object(name, np.array(co), faces); weld(ob, 1e-5, False)
    simulate(ob, np.zeros(len(ob.data.vertices), bool), pressure=float(os.environ.get('MB_PC', 5)), shrink=-0.05, tension=15, bending=0.8, mass=0.3)
    return ob

def place(ob, x, y, hgt, tilt, rz, yb):
    # coussin gonflé (figé) appuyé contre le dossier, tassé sur l'assise et contre la coque
    me = ob.data; n = len(me.vertices); co = np.zeros(n * 3, dtype=np.float32); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3).astype(np.float64)
    co -= co.mean(0)
    ct, st = math.cos(-tilt), math.sin(-tilt); co = co @ np.array([[1, 0, 0], [0, ct, -st], [0, st, ct]]).T
    cz, sz = math.cos(rz), math.sin(rz); co = co @ np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]]).T
    co += (x, y, 0); zmin = co[:, 2].min(); co[:, 2] += SEAT_H + 0.012 - zmin - 0.035
    lo = co[:, 2] < SEAT_H + 0.012; co[lo, 2] = SEAT_H + 0.012 + (co[lo, 2] - SEAT_H - 0.012) * 0.2
    lim = yb + 0.035 * np.clip((co[:, 2] - SEAT_H) / 0.3, 0, 1.2)                # le dossier penche un peu en arrière
    bk = co[:, 1] > lim; co[bk, 1] = lim[bk] + (co[bk, 1] - lim[bk]) * 0.2
    me.vertices.foreach_set('co', co.astype(np.float32).ravel()); me.update()

def collider(ob):
    m = ob.modifiers.new('col', 'COLLISION'); ob.collision.thickness_outer = 0.012; ob.collision.cloth_friction = 40; ob.collision.damping = 0.9

N = int(os.environ.get('MB_FRAMES', 40))
seat = seat_block(); sh = shell()
log('assise', len(seat.data.vertices), 'sommets, coque', len(sh.data.vertices), '; simulation…')
run(N); freeze(seat); freeze(sh)
log('simulation faite')
xi = W / 2 - TH; yb = D / 2 - TH - 0.02                                    # face intérieure du dossier (y Blender)
CUSH = ([(-xi + 0.29, yb - 0.17, 0.5, 0.26, -0.34), (xi - 0.28, yb - 0.17, 0.48, 0.24, 0.32), (-xi + 0.62, yb - 0.3, 0.42, 0.5, -0.1), (xi - 0.63, yb - 0.3, 0.44, 0.55, 0.1)] if W > 1.7
        else [(-xi + 0.3, yb - 0.17, 0.46, 0.24, -0.3), (xi - 0.3, yb - 0.17, 0.44, 0.26, 0.3)] if W > 1.2 else [(0.03, yb - 0.15, 0.4, 0.3, 0.1)])
cush = [cushion('coussin%d' % k, 0, 0, sz, 0, 0, seed=k) for k, (x, y, sz, tilt, rz) in enumerate(CUSH)]
for k, c in enumerate(cush): c.location = (k * 1.2, 5, 3)
scene.frame_set(0); run(N)
for c, (x, y, sz, tilt, rz) in zip(cush, CUSH): freeze(c); c.location = (0, 0, 0); place(c, x, y, sz, tilt, rz, yb)
log('coussins')

# ------------------------------------------------------------------ allègement, ombre propre par sommet, export
def join(obs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs: o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]; bpy.ops.object.join(); obs[0].name = name; return obs[0]
def decimate(ob, tris):
    n = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    log(ob.name, n, 'triangles')
    if n <= tris * 1.2:
        bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
        tm = ob.modifiers.new('t', 'TRIANGULATE'); bpy.ops.object.modifier_apply(modifier='t'); return
    m = ob.modifiers.new('d', 'DECIMATE'); m.ratio = min(1, tris / n); m.use_collapse_triangulate = True
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier='d')
    for p in ob.data.polygons: p.use_smooth = True
body = join([seat, sh], 'corps')
K = float(os.environ.get('MB_TRIS', 1.0))
decimate(body, int((44000 if W > 1.2 else 22000) * K))
for c in cush: decimate(c, int(2600 * K))
parts = [('corps', body)] + [('c%d' % k, c) for k, c in enumerate(cush)]

def bake_ao():
    scene.render.engine = 'CYCLES'; cy = scene.cycles
    try:
        pr = bpy.context.preferences.addons['cycles'].preferences; pr.compute_device_type = 'METAL'; pr.get_devices()
        for d in pr.devices: d.use = d.type == 'METAL'
        cy.device = 'GPU'
    except Exception: pass
    cy.samples = 256
    w = bpy.data.worlds.new('ao'); scene.world = w; w.light_settings.distance = 0.3
    bpy.ops.mesh.primitive_plane_add(size=30); fl = bpy.context.object
    scene.render.bake.target = 'VERTEX_COLORS'
    out = {}
    for name, ob in parts:
        mat = bpy.data.materials.new('m' + name); ob.data.materials.clear(); ob.data.materials.append(mat)
        ca = ob.data.color_attributes.new('ao', 'FLOAT_COLOR', 'POINT'); ob.data.color_attributes.active_color = ca
        try: ob.data.color_attributes.render_color_index = ob.data.color_attributes.find('ao')
        except Exception: pass
        bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
        bpy.ops.object.bake(type='AO')
        a = np.zeros(len(ob.data.vertices) * 4, dtype=np.float32); ca.data.foreach_get('color', a); out[name] = a.reshape(-1, 4)[:, 0].copy()
    bpy.data.objects.remove(fl)
    return out

def export():
    ao = bake_ao(); meta = {'w': W, 'd': D, 'parts': []}; blob = bytearray()
    for name, ob in parts:
        me = ob.data; me.calc_loop_triangles()
        n = len(me.vertices); co = np.zeros(n * 3, dtype=np.float32); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
        mw = np.array(ob.matrix_world); co = co @ mw[:3, :3].T + mw[:3, 3]
        co = np.stack([co[:, 0], co[:, 2], -co[:, 1]], axis=1)                 # → repère de la maquette (y en haut, façade vers +z)
        tri = np.zeros(len(me.loop_triangles) * 3, dtype=np.int32); me.loop_triangles.foreach_get('vertices', tri)
        assert n < 65536
        lo, hi = co.min(0), co.max(0); q = np.round((co - lo) / (hi - lo) * 65535).astype(np.uint16)
        # ombre propre adoucie : l'éclairage calculé (texture de lumière) porte déjà l'essentiel
        sh = np.clip(0.5 + 0.5 * np.clip(ao[name], 0, 1) ** 0.8, 0, 1); s8 = np.round(sh * 255).astype(np.uint8)
        e = {'slot': name, 'nv': n, 'nt': len(tri) // 3, 'min': [round(float(v), 5) for v in lo], 'max': [round(float(v), 5) for v in hi], 'off': len(blob)}
        blob += q.tobytes() + tri.astype(np.uint16).tobytes() + s8.tobytes()
        if len(blob) % 2: blob += b'\0'
        meta['parts'].append(e)
        log(name, n, 'sommets,', len(tri) // 3, 'triangles, ombre moyenne %.2f' % sh.mean())
    open(os.path.join(OUT, NAME + '.bin'), 'wb').write(blob); json.dump(meta, open(os.path.join(OUT, NAME + '.json'), 'w'))
    log('écrit', NAME, len(blob), 'octets')
export()

# ------------------------------------------------------------------ rendu de contrôle
def preview(path):
    scene.render.engine = 'CYCLES'; cy = scene.cycles
    try:
        pr = bpy.context.preferences.addons['cycles'].preferences; pr.compute_device_type = 'METAL'; pr.get_devices()
        for d in pr.devices: d.use = d.type == 'METAL'
        cy.device = 'GPU'
    except Exception: pass
    cy.samples = 96; cy.use_denoising = True
    scene.render.resolution_x = 1400; scene.render.resolution_y = 800
    scene.view_settings.view_transform = 'Standard'
    w = bpy.data.worlds.new('w'); scene.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.9, 0.95, 1, 1); w.node_tree.nodes['Background'].inputs[1].default_value = 0.5
    sun = bpy.data.objects.new('s', bpy.data.lights.new('s', 'SUN')); sun.data.energy = 2.2; sun.data.angle = math.radians(8)
    sun.rotation_euler = (math.radians(55), 0, math.radians(-40)); scene.collection.objects.link(sun)
    bpy.ops.mesh.primitive_plane_add(size=30); fl = bpy.context.object
    mf = bpy.data.materials.new('sol'); mf.use_nodes = True; mf.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.55, 0.45, 0.35, 1); fl.data.materials.append(mf)
    mt = bpy.data.materials.new('tissu'); mt.use_nodes = True; nt = mt.node_tree; b = nt.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.62, 0.59, 0.54, 1); b.inputs['Roughness'].default_value = 0.95
    nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 900; bp = nt.nodes.new('ShaderNodeBump'); bp.inputs['Strength'].default_value = 0.35; bp.inputs['Distance'].default_value = 0.002
    nt.links.new(nz.outputs[0], bp.inputs['Height']); nt.links.new(bp.outputs[0], b.inputs['Normal'])
    for o in scene.objects:
        if o.type == 'MESH' and o is not fl: o.data.materials.clear(); o.data.materials.append(mt)
    cam = bpy.data.objects.new('c', bpy.data.cameras.new('c')); scene.collection.objects.link(cam); scene.camera = cam
    cam.data.lens = 35; cam.location = (W * 0.5 + 0.3, -1.6 - W * 0.5, 1.25)
    cam.rotation_euler = (Vector((0, -0.1, 0.35)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = path; bpy.ops.render.render(write_still=True)

if SHOT: preview(SHOT); log('rendu', SHOT)
