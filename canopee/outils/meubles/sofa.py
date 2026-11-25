# Canapé contemporain droit (coussins d'assise et de dossier à passepoil, accoudoirs et dossier rembourrés, pieds
# métal), sculpté par simulation de tissu puis « photographié » dans des textures : couleur, relief (plis, coutures,
# armure du tissu) et ombres propres. Sortie : un modèle glTF au format du catalogue de 3d/models.js.
#   Blender -b -P outils/meubles/sofa.py -- <dossier 3d/assets/models> [nom=canopee_sofa] [largeur=2.2] [rendu.png]
#   SOFA_BAKE=0 : pas de textures ni d'export (mise au point de la forme avec le rendu de contrôle)
# Repère Blender : x largeur, y profondeur (façade vers −y), z hauteur.
import bpy, bmesh, sys, os, math, json, time, struct
import numpy as np
from mathutils import Vector

A = sys.argv[sys.argv.index('--') + 1:]
OUT = A[0]; NAME = A[1] if len(A) > 1 else 'canopee_sofa'; W = float(A[2]) if len(A) > 2 else 2.2; SHOT = A[3] if len(A) > 3 else None
BAKE = os.environ.get('SOFA_BAKE', '1') != '0'; RES = int(os.environ.get('SOFA_RES', 4096))
STEP = float(os.environ.get('SOFA_STEP', 0.019)); FR = int(os.environ.get('SOFA_FRAMES', 45))
rng = np.random.default_rng(7)
T0 = time.time()
def log(*a): print('[sofa %5.1fs]' % (time.time() - T0), *a, flush=True)

STYLE = os.environ.get('SOFA_STYLE', 'salon')   # 'jardin' : structure en bois (lames de terrasse scannées), coussins en toile, sans coussins décoratifs
D = 0.96; LEG = 0.13; ARM_T = 0.17; BACK_T = 0.19; BASE_T = 0.17; ARM_H = 0.64; BACK_H = 0.70; CUSH_T = 0.17
TER = STYLE == 'terrasse'                   # fauteuil bas d'extérieur : cadre fin en teck (placage de chêne scanné, teinté), claire-voie, coussins de toile
if TER: D = 0.78; LEG = 0.25; ARM_T = 0.05; BACK_T = 0.07; BASE_T = 0.078; ARM_H = 0.58; BACK_H = 0.78; CUSH_T = 0.115
if STYLE == 'jardin': D = 0.9; LEG = 0.10; ARM_T = 0.10; BACK_T = 0.08; BASE_T = 0.12; ARM_H = 0.58; BACK_H = 0.56; CUSH_T = 0.15
SEAT_Z = LEG + BASE_T                      # dessus du socle
IN_W = W - 2 * ARM_T                       # largeur entre accoudoirs
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ---------------------------------------------------------------- boîte de tissu : treillis régulier, sommets partagés
def cloth_box(name, w, d, h, r=0.02, step=STEP):
    nx, ny, nz = max(4, round(w / step)), max(4, round(d / step)), max(3, round(h / step))
    X, Y, Z = np.linspace(-w / 2, w / 2, nx + 1), np.linspace(-d / 2, d / 2, ny + 1), np.linspace(-h / 2, h / 2, nz + 1)
    idx, co = {}, []
    def vid(i, j, k):
        key = (i, j, k)
        if key not in idx: idx[key] = len(co); co.append((X[i], Y[j], Z[k]))
        return idx[key]
    faces, fuv = [], []
    def quad(a, b, c, e, flip): faces.append((e, c, b, a) if flip else (a, b, c, e)); fuv.append(AX[0])
    AX = [None]
    AX[0] = (0, 1, 0)
    for i in range(nx):
        for j in range(ny):
            quad(vid(i, j, nz), vid(i + 1, j, nz), vid(i + 1, j + 1, nz), vid(i, j + 1, nz), False)
            AX[0] = (0, 1, 1); quad(vid(i, j, 0), vid(i + 1, j, 0), vid(i + 1, j + 1, 0), vid(i, j + 1, 0), True); AX[0] = (0, 1, 0)
    for i in range(nx):
        for k in range(nz):
            AX[0] = (0, 2, 2); quad(vid(i, 0, k), vid(i + 1, 0, k), vid(i + 1, 0, k + 1), vid(i, 0, k + 1), False)
            AX[0] = (0, 2, 3); quad(vid(i, ny, k), vid(i + 1, ny, k), vid(i + 1, ny, k + 1), vid(i, ny, k + 1), True)
    for j in range(ny):
        for k in range(nz):
            AX[0] = (1, 2, 4); quad(vid(0, j, k), vid(0, j + 1, k), vid(0, j + 1, k + 1), vid(0, j, k + 1), True)
            AX[0] = (1, 2, 5); quad(vid(nx, j, k), vid(nx, j + 1, k), vid(nx, j + 1, k + 1), vid(nx, j, k + 1), False)
    co = np.array(co, dtype=np.float64); rest = co.copy()
    inner = np.array([w / 2 - r, d / 2 - r, h / 2 - r]); q = np.clip(co, -inner, inner); dv = co - q; L = np.linalg.norm(dv, axis=1); m = L > 1e-9
    co[m] = q[m] + dv[m] / L[m, None] * r
    me = bpy.data.meshes.new(name); me.from_pydata([tuple(c) for c in co], [], faces); me.update()
    for p in me.polygons: p.use_smooth = True
    # dépliage : une île par face de la boîte, à l'échelle réelle (mètres), décalées pour ne pas se chevaucher
    uvl = me.uv_layers.new(name='UVMap'); off = max(w, d, h) + 0.05
    for p_, (a0, a1, isl) in zip(me.polygons, fuv):
        for li in p_.loop_indices:
            c = rest[me.loops[li].vertex_index]; uvl.data[li].uv = (c[a0] + isl * off, c[a1])
    ob = bpy.data.objects.new(name, me); scene.collection.objects.link(ob)
    loops = {}
    for tag, k in (('haut', nz), ('bas', 0)):
        loops[tag] = [idx[(i, 0, k)] for i in range(nx)] + [idx[(nx, j, k)] for j in range(ny)] + [idx[(i, ny, k)] for i in range(nx, 0, -1)] + [idx[(0, j, k)] for j in range(ny, 0, -1)]
    for tag, j in (('avant', 0), ('arriere', ny)):
        loops[tag] = [idx[(i, j, 0)] for i in range(nx)] + [idx[(nx, j, k)] for k in range(nz)] + [idx[(i, j, nz)] for i in range(nx, 0, -1)] + [idx[(0, j, k)] for k in range(nz, 0, -1)]
    ob['loops'] = json.dumps(loops)
    grid = {'bas': [v for (i, j, k), v in idx.items() if k == 0], 'haut': [v for (i, j, k), v in idx.items() if k == nz],
            'arriere': [v for (i, j, k), v in idx.items() if j == ny], 'avant': [v for (i, j, k), v in idx.items() if j == 0]}
    return ob, grid

def simulate(ob, pin, pressure, shrink, tension=30, bending=0.6, foam=0.0):
    vg = ob.vertex_groups.new(name='pin')
    if len(pin): vg.add([int(i) for i in pin], 1.0, 'REPLACE')
    m = ob.modifiers.new('tissu', 'CLOTH'); s = m.settings
    s.quality = 10; s.mass = 0.3; s.vertex_group_mass = 'pin'; s.pin_stiffness = 1.0
    s.tension_stiffness = tension; s.compression_stiffness = tension; s.shear_stiffness = tension * 0.4; s.bending_stiffness = bending
    s.tension_damping = 5; s.compression_damping = 5; s.shear_damping = 5; s.bending_damping = 0.5; s.air_damping = 3
    s.use_pressure = True; s.uniform_pressure_force = pressure; s.shrink_min = shrink; s.effector_weights.gravity = 0
    if foam > 0:
        s.use_internal_springs = True; s.internal_spring_max_length = 0.0; s.internal_spring_max_diversion = math.radians(45)
        s.internal_tension_stiffness = foam; s.internal_compression_stiffness = foam
    m.collision_settings.use_collision = False; m.collision_settings.use_self_collision = False
    m.point_cache.frame_start = 1; m.point_cache.frame_end = FR

def freeze(ob):
    dg = bpy.context.evaluated_depsgraph_get(); ev = ob.evaluated_get(dg)
    co = np.zeros(len(ev.data.vertices) * 3, dtype=np.float32); ev.data.vertices.foreach_get('co', co)
    for m in list(ob.modifiers): ob.modifiers.remove(m)
    ob.data.vertices.foreach_set('co', co); ob.data.update()
def coords(ob):
    co = np.zeros(len(ob.data.vertices) * 3, dtype=np.float32); ob.data.vertices.foreach_get('co', co); return co.reshape(-1, 3).astype(np.float64)
def set_coords(ob, co): ob.data.vertices.foreach_set('co', co.astype(np.float32).ravel()); ob.data.update()

# ---------------------------------------------------------------- pièces
parts = []          # (objet, matière)
def slab(name, w, d, h, loc, pin_face='bas', pressure=3.4, shrink=-0.02, r=0.03):
    ob, g = cloth_box(name, w, d, h, max(r, 0.036), 0.026); ob.location = loc
    simulate(ob, g[pin_face], pressure, shrink, tension=32, bending=1.0, foam=1.0)
    parts.append((ob, 'tissu')); return ob
def plank(name, w, d, h, loc):
    ob, g = cloth_box(name, w, d, h, 0.006, max(w, d, h) / 2); ob.location = loc; parts.append((ob, 'bois'))
    for p_ in ob.data.polygons: p_.use_smooth = False          # bois : arêtes franches
    return ob
frame = []
def beam(name, ln, a, b, loc, rx=0.0, rz=0.0, ry=0.0):
    # pièce de bois : longueur selon x (le fil du bois suit u), puis orientée (ry : debout, rz : en profondeur, rx : inclinaison du dossier)
    ob, g = cloth_box(name, ln, a, b, 0.0035, max(ln, a, b) / 2); co = coords(ob)
    for ang, M in ((ry, lambda c, s_: [[c, 0, s_], [0, 1, 0], [-s_, 0, c]]), (rz, lambda c, s_: [[c, -s_, 0], [s_, c, 0], [0, 0, 1]]), (rx, lambda c, s_: [[1, 0, 0], [0, c, -s_], [0, s_, c]])):
        if ang: co = co @ np.array(M(math.cos(ang), math.sin(ang))).T
    set_coords(ob, co + np.array(loc)); du, dv = rng.random() * 3, rng.random() * 3
    for d_ in ob.data.uv_layers['UVMap'].data: d_.uv = (d_.uv[0] + du, d_.uv[1] + dv)
    for p_ in ob.data.polygons: p_.use_smooth = False
    parts.append((ob, 'bois')); frame.append(ob); return ob
if TER:
    H90 = math.pi / 2; xs = W / 2 - 0.025; yf = -D / 2 + 0.03; yr = D / 2 - 0.03; TILT = 0.2
    for sx in (-1, 1):
        beam('piedAv', ARM_H, 0.05, 0.05, (sx * xs, yf, ARM_H / 2), ry=H90); beam('piedAr', ARM_H, 0.05, 0.05, (sx * xs, yr, ARM_H / 2), ry=H90)
        beam('accoudoir', D + 0.03, 0.07, 0.028, (sx * xs, 0, ARM_H + 0.014), rz=H90)
        beam('longeron', D - 0.11, 0.028, 0.06, (sx * xs, 0, LEG + 0.03), rz=H90)
    for y in (yf, yr): beam('traverse', W - 0.1, 0.028, 0.06, (0, y, LEG + 0.03))
    for k in range(6): beam('latte%d' % k, W - 0.1, 0.085, 0.018, (0, yf + 0.045 + k * (yr - yf - 0.09) / 5, LEG + 0.06 + 0.009))
    # dossier incliné : deux montants et cinq lattes horizontales à claire-voie
    z0 = LEG + 0.05; yb0 = D / 2 - BACK_T + 0.02; hb = BACK_H - z0; cy_ = lambda z: yb0 + (z - z0) * math.tan(TILT)
    for sx in (-1, 1): beam('montant', hb / math.cos(TILT), 0.03, 0.04, (sx * (W / 2 - 0.075), cy_(z0 + hb / 2) + 0.012, z0 + hb / 2), ry=H90, rx=-TILT)
    for k in range(5): z = z0 + 0.13 + k * (hb - 0.16) / 4; beam('dossier%d' % k, W - 0.1, 0.014, 0.055, (0, cy_(z) - 0.006, z), rx=-TILT)
    base = armL = armR = back = None
if STYLE == 'jardin':
    base = plank('socle', W, D, BASE_T, (0, 0, LEG + BASE_T / 2))
    armL = plank('accoudoirG', ARM_T, D, ARM_H - LEG - BASE_T, (-W / 2 + ARM_T / 2, 0, LEG + BASE_T + (ARM_H - LEG - BASE_T) / 2))
    armR = plank('accoudoirD', ARM_T, D, ARM_H - LEG - BASE_T, (W / 2 - ARM_T / 2, 0, LEG + BASE_T + (ARM_H - LEG - BASE_T) / 2))
    back = plank('dossier', IN_W, BACK_T, BACK_H - LEG - BASE_T, (0, D / 2 - BACK_T / 2, LEG + BASE_T + (BACK_H - LEG - BASE_T) / 2))
if STYLE == 'salon': base = slab('socle', IN_W + 0.02, D - BACK_T + 0.01, BASE_T, (0, -BACK_T / 2, LEG + BASE_T / 2), pressure=1.2, shrink=-0.004, r=0.022)
if STYLE == 'salon': armL = slab('accoudoirG', ARM_T, D, ARM_H - LEG, (-W / 2 + ARM_T / 2, 0, LEG + (ARM_H - LEG) / 2), pressure=3.8)
if STYLE == 'salon': armR = slab('accoudoirD', ARM_T, D, ARM_H - LEG, (W / 2 - ARM_T / 2, 0, LEG + (ARM_H - LEG) / 2), pressure=3.8)
if STYLE == 'salon': back = slab('dossier', IN_W + 0.02, BACK_T, BACK_H - LEG, (0, D / 2 - BACK_T / 2, LEG + (BACK_H - LEG) / 2), pressure=3.8)

NS = 1 if W < 1.3 else 2 if W < 2.6 else 3; CW = IN_W / NS - 0.006; CD = D - BACK_T + 0.035
seats, backs = [], []
for k in range(NS):
    x = -IN_W / 2 + IN_W / NS * (k + 0.5)
    ob, g = cloth_box('assise%d' % k, CW, CD, CUSH_T, 0.035); ob.location = (x, -D / 2 + CD / 2 - 0.03, SEAT_Z + CUSH_T / 2 - 0.004)
    simulate(ob, [], float(os.environ.get('SOFA_PS', 0.32 if TER else 0.7)), -0.012, tension=26, bending=0.7, foam=0); seats.append(ob); parts.append((ob, 'tissu'))
    bh = 0.47 + (0.012 if k % 2 else 0)
    if TER: bh = 0.40
    ob, g = cloth_box('dosseret%d' % k, CW - 0.01, 0.12 if TER else 0.17, bh, 0.05); ob.location = (x + k * 3, 6, 3)
    simulate(ob, [], float(os.environ.get('SOFA_PB', 0.45 if TER else 0.9)), -0.03, tension=16, bending=0.2, foam=0); backs.append((ob, x, bh)); parts.append((ob, 'tissu'))
# coussins décoratifs : deux faces cousues (taie)
def pillow(name, size):
    n = max(8, round(size / STEP)); U = np.linspace(-size / 2, size / 2, n + 1); co, faces, idx = [], [], {}
    for side in (-1, 1):
        for j in range(n + 1):
            for i in range(n + 1):
                edge = i in (0, n) or j in (0, n); key = (i, j, 0 if edge else side)
                if key in idx: continue
                u, v = U[i], U[j]; cr = 0.04; qu = max(-size / 2 + cr, min(size / 2 - cr, u)); qv = max(-size / 2 + cr, min(size / 2 - cr, v)); du, dv = u - qu, v - qv; L = math.hypot(du, dv)
                if L > cr: u, v = qu + du / L * cr, qv + dv / L * cr
                idx[key] = len(co); co.append((u, 0 if edge else side * 0.012, v))
        for j in range(n):
            for i in range(n):
                q = [idx[(a, b, 0 if (a in (0, n) or b in (0, n)) else side)] for a, b in ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))]
                faces.append(tuple(q) if side < 0 else tuple(q[::-1]))
    me = bpy.data.meshes.new(name); me.from_pydata(co, [], faces); me.update()
    for p in me.polygons: p.use_smooth = True
    uvl = me.uv_layers.new(name='UVMap'); nf = len(faces) // 2
    for fi, p_ in enumerate(me.polygons):
        for li in p_.loop_indices: c = co[me.loops[li].vertex_index]; uvl.data[li].uv = (c[0] + (size + 0.05) * (fi >= nf), c[2])
    ob = bpy.data.objects.new(name, me); scene.collection.objects.link(ob)
    edge_loop = [idx[(i, 0, 0)] for i in range(n)] + [idx[(n, j, 0)] for j in range(n)] + [idx[(i, n, 0)] for i in range(n, 0, -1)] + [idx[(0, j, 0)] for j in range(n, 0, -1)]
    ob['loops'] = json.dumps({'bord': edge_loop})
    simulate(ob, [], 4.5, -0.06, tension=14, bending=0.3)
    return ob
PIL = [] if STYLE == 'jardin' else [(0.07, 0.34, 0.36, 0.16, 'coussinA')] if TER else [(-IN_W / 2 + 0.27, 0.50, 0.30, -0.22, 'coussinA'), (IN_W / 2 - 0.30, 0.45, 0.26, 0.28, 'coussinB')] if W >= 1.3 else [(0.04, 0.42, 0.26, 0.12, 'coussinA')]
pils = []
for k, (x, size, tilt, rz, mat) in enumerate(PIL):
    ob = pillow('coussin%d' % k, size); ob.location = (k * 2, 9, 3); pils.append(ob); parts.append((ob, mat))
BLEND = os.environ.get('SOFA_BLEND')          # fichier .blend de démonstration : pièces avant et après simulation
if BLEND:
    ca = bpy.data.collections.new('1 - patrons avant gonflage'); scene.collection.children.link(ca)
    for k, (ob, _) in enumerate(parts):
        c = ob.copy(); c.data = ob.data.copy(); c.name = 'patron_' + ob.name
        for m in list(c.modifiers): c.modifiers.remove(m)
        c.location = (-W / 2 + 0.2 + (k % 4) * 1.15, -2.2 - (k // 4) * 1.25, 0.3); ca.objects.link(c)
log('simulation de', len(parts), 'pièces…')
for f in range(1, FR + 1): scene.frame_set(f)
for ob, _ in parts:
    c0 = coords(ob); freeze(ob); c1 = coords(ob); log(ob.name, 'déplacement max %.3f' % np.abs(c1 - c0).max(), 'taille', np.round(c1.max(0) - c1.min(0), 3))
log('simulation faite')

def soft(x, lim, k, band=0.035, above=False):
    # tasse en douceur ce qui dépasse la limite (au-dessous, ou au-dessus si above) : pas de pli vif à la limite
    d = (x - lim) if above else (lim - x); t = np.clip(d / band, 0, 1); f = 1 - (1 - k) * t * t * (3 - 2 * t)
    return np.where(d > 0, lim + (x - lim) * f, x)
def world(ob):
    co = coords(ob) + np.array(ob.location); ob.location = (0, 0, 0); return co
# assises : dessous aplati sur le socle, léger creux d'usage au centre, bord avant tombant
for ob in seats:
    co = world(ob); zc = SEAT_Z
    co[:, 2] = soft(co[:, 2], zc, 0.15)
    cx = co[:, 0].mean(); u = (co[:, 0] - cx) / (CW / 2); v = (co[:, 1] - co[:, 1].mean()) / (CD / 2)
    top = np.clip((co[:, 2] - zc) / CUSH_T, 0, 1)
    co[:, 2] -= 0.012 * top * np.exp(-(u * u * 2.2 + (v - 0.15) ** 2 * 2.0))
    set_coords(ob, co)
# dosserets : appuyés contre le dossier, tassés sur l'assise, un peu de travers
yb = D / 2 - BACK_T
for (ob, x, bh), k in zip(backs, range(NS)):
    co = coords(ob); co -= co.mean(0); ob.location = (0, 0, 0)
    tilt = 0.2 + 0.03 * (k % 2); rz = (rng.random() - 0.5) * 0.05
    ct, st = math.cos(-tilt), math.sin(-tilt); co = co @ np.array([[1, 0, 0], [0, ct, -st], [0, st, ct]]).T
    cz, sz = math.cos(rz), math.sin(rz); co = co @ np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]]).T
    zs = SEAT_Z + CUSH_T - 0.012
    co += (x, yb - (0.075 if TER else 0.115), 0); co[:, 2] += zs - co[:, 2].min() - 0.02
    co[:, 2] = soft(co[:, 2], zs, 0.25)
    lim = yb + 0.02 + 0.05 * np.clip((co[:, 2] - zs) / 0.4, 0, 1.2); co[:, 1] = soft(co[:, 1], lim, 0.25, above=True)
    set_coords(ob, co)
for ob, (x, size, tilt, rz, mat) in zip(pils, PIL):
    co = coords(ob); co -= co.mean(0); ob.location = (0, 0, 0)
    ct, st = math.cos(-tilt), math.sin(-tilt); co = co @ np.array([[1, 0, 0], [0, ct, -st], [0, st, ct]]).T
    cz, sz = math.cos(rz), math.sin(rz); co = co @ np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]]).T
    zs = SEAT_Z + CUSH_T - 0.008
    co += (x, yb - (0.21 if TER else 0.30), 0); co[:, 2] += zs - co[:, 2].min() - 0.03
    co[:, 2] += 0.018
    lim = yb - (0.08 if TER else 0.13) + 0.10 * np.clip((co[:, 2] - zs) / 0.4, 0, 1.2); co[:, 1] = soft(co[:, 1], lim, 0.6, 0.09, above=True)
    lx = IN_W / 2 - 0.01; co[:, 0] = np.clip(co[:, 0], -lx, lx)
    set_coords(ob, co)
for ob in (base, armL, armR, back):
    if ob is not None: set_coords(ob, world(ob))

# ---------------------------------------------------------------- passepoils (cordon cousu le long des arêtes), pieds
def piping(ob, tags, radius=0.0042, sides=6, every=2):
    co = coords(ob); loops = json.loads(ob['loops']); out = []
    me = ob.data; nrm = np.zeros(len(me.vertices) * 3, dtype=np.float32); me.vertices.foreach_get('normal', nrm); nrm = nrm.reshape(-1, 3)
    for t in tags:
        ids = loops[t][::every]; n = len(ids); P = co[ids] + nrm[ids] * radius * 0.55
        T = np.roll(P, -1, 0) - np.roll(P, 1, 0); T /= np.linalg.norm(T, axis=1)[:, None]
        N1 = nrm[ids] - T * (nrm[ids] * T).sum(1)[:, None]; N1 /= np.maximum(np.linalg.norm(N1, axis=1), 1e-9)[:, None]; N2 = np.cross(T, N1)
        seg = np.linalg.norm(np.roll(P, -1, 0) - P, axis=1); arc = np.concatenate([[0], np.cumsum(seg)])
        vs, fs, uvs = [], [], []
        for a in range(n):
            for b in range(sides):
                ang = 2 * math.pi * b / sides; vs.append(tuple(P[a] + radius * (math.cos(ang) * N1[a] + math.sin(ang) * N2[a])))
        for a in range(n):
            a2 = (a + 1) % n
            for b in range(sides):
                b2 = (b + 1) % sides; fs.append((a * sides + b, a2 * sides + b, a2 * sides + b2, a * sides + b2))
                vv = 2 * math.pi * radius / sides; uvs.append(((arc[a], b * vv), (arc[a + 1], b * vv), (arc[a + 1], (b + 1) * vv), (arc[a], (b + 1) * vv)))
        m2 = bpy.data.meshes.new('passepoil'); m2.from_pydata(vs, [], fs); m2.update()
        for p_ in m2.polygons: p_.use_smooth = True
        ul = m2.uv_layers.new(name='UVMap')
        for p_, q in zip(m2.polygons, uvs):
            for li, u_ in zip(p_.loop_indices, q): ul.data[li].uv = u_
        o = bpy.data.objects.new('passepoil', m2); scene.collection.objects.link(o); out.append(o)
    return out
pp = []
PIPING = os.environ.get('SOFA_PIPING', '0') == '1'
for ob in (seats if PIPING else []): pp += piping(ob, ['haut', 'bas'])
for ob, _, _ in (backs if PIPING else []): pp += piping(ob, ['avant', 'arriere'])
for ob in (pils if PIPING else []): pp += piping(ob, ['bord'], 0.0035)
for ob in ((armL, armR) if PIPING else ()): pp += piping(ob, ['avant'], 0.0036)
bpy.context.view_layer.update()
for o in pp: parts.append((o, 'tissu'))
legs = []
for sx in (() if TER else (-1, 1)):
    for sy in (-1, 1):
        bpy.ops.mesh.primitive_cone_add(vertices=20, radius1=0.011, radius2=0.017, depth=LEG + 0.02, location=(sx * (W / 2 - 0.11), sy * (D / 2 - 0.10), (LEG + 0.02) / 2))
        o = bpy.context.object; o.rotation_euler = (sy * 0.10, -sx * 0.10, 0)
        for p in o.data.polygons: p.use_smooth = True
        legs.append(o); parts.append((o, 'pied'))
# dessous : toile noire tendue sous le socle
if not TER: bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, LEG + 0.004)); o = bpy.context.object; o.scale = (W - 0.03, D - 0.03, 1); o.rotation_euler = (math.pi, 0, 0); parts.append((o, 'dessous'))
bpy.context.view_layer.update()
log('pièces :', len(parts), 'triangles :', sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o, _ in parts))

# ---------------------------------------------------------------- matières (servent au rendu de contrôle et à la cuisson)
COL = {'tissu': (0.44, 0.39, 0.32), 'coussinA': (0.27, 0.215, 0.155), 'coussinB': (0.62, 0.57, 0.48)}
def fabric(name, col):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; b = nt.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = 0.92
    try: b.inputs['Sheen Weight'].default_value = 0.35; b.inputs['Sheen Roughness'].default_value = 0.5
    except Exception: pass
    tc = nt.nodes.new('ShaderNodeTexCoord')
    # armure : deux nappes de fils croisés (ondes) + irrégularité des fils (bruit étiré) ; pas de 2,6 mm
    def wave(axis, scale):
        w = nt.nodes.new('ShaderNodeTexWave'); w.wave_type = 'BANDS'; w.bands_direction = axis; w.wave_profile = 'SIN'
        w.inputs['Scale'].default_value = scale; w.inputs['Distortion'].default_value = 1.4; w.inputs['Detail'].default_value = 1.5; w.inputs['Detail Scale'].default_value = 2.5
        nt.links.new(tc.outputs['UV'], w.inputs['Vector']); return w
    return m, nt, b, tc
MATS = {}
def make_materials(uv_scale):
    for name, col in COL.items():
        m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; b = nt.nodes['Principled BSDF']; b.inputs['Roughness'].default_value = 0.93
        try: b.inputs['Sheen Weight'].default_value = 0.3; b.inputs['Sheen Roughness'].default_value = 0.5
        except Exception: pass
        geo = nt.nodes.new('ShaderNodeNewGeometry')
        def noise(scale, detail=2.0, rough=0.5, stretch=None):
            n = nt.nodes.new('ShaderNodeTexNoise'); n.inputs['Scale'].default_value = scale; n.inputs['Detail'].default_value = detail; n.inputs['Roughness'].default_value = rough
            if stretch is None: nt.links.new(geo.outputs['Position'], n.inputs['Vector'])
            else:
                mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = stretch
                nt.links.new(geo.outputs['Position'], mp.inputs['Vector']); nt.links.new(mp.outputs[0], n.inputs['Vector'])
            return n
        # fils : bruit fin étiré dans deux directions (chaîne et trame), mélangé → aspect chiné tissé
        a = noise(1.0, 1.5, 0.6, (330, 60, 330)); c = noise(1.0, 1.5, 0.6, (60, 330, 60)); f = noise(420, 2.0, 0.6); big = noise(7, 3.0, 0.55)
        mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'FLOAT'; mx.inputs[0].default_value = 0.5; nt.links.new(a.outputs[0], mx.inputs[2]); nt.links.new(c.outputs[0], mx.inputs[3])
        mx2 = nt.nodes.new('ShaderNodeMix'); mx2.data_type = 'FLOAT'; mx2.inputs[0].default_value = 0.35; nt.links.new(mx.outputs[0], mx2.inputs[2]); nt.links.new(f.outputs[0], mx2.inputs[3])
        bp = nt.nodes.new('ShaderNodeBump'); bp.inputs['Strength'].default_value = 1.0; bp.inputs['Distance'].default_value = 0.004
        nt.links.new(mx2.outputs[0], bp.inputs['Height']); nt.links.new(bp.outputs[0], b.inputs['Normal'])
        # couleur : chiné (fils clairs et foncés) + nuance large très légère
        r1 = nt.nodes.new('ShaderNodeMapRange'); r1.inputs[1].default_value = 0.3; r1.inputs[2].default_value = 0.7; r1.inputs[3].default_value = 0.70; r1.inputs[4].default_value = 1.18
        r1c = (0.985, 1.015) if BAKE and not SHOT else None
        if r1c: r1.inputs[3].default_value, r1.inputs[4].default_value = r1c
        nt.links.new(mx2.outputs[0], r1.inputs[0])
        r2 = nt.nodes.new('ShaderNodeMapRange'); r2.inputs[1].default_value = 0.3; r2.inputs[2].default_value = 0.7; r2.inputs[3].default_value = 0.95; r2.inputs[4].default_value = 1.05
        nt.links.new(big.outputs[0], r2.inputs[0])
        mm = nt.nodes.new('ShaderNodeMath'); mm.operation = 'MULTIPLY'; nt.links.new(r1.outputs[0], mm.inputs[0]); nt.links.new(r2.outputs[0], mm.inputs[1])
        cm = nt.nodes.new('ShaderNodeMix'); cm.data_type = 'RGBA'; cm.blend_type = 'MULTIPLY'; cm.inputs[0].default_value = 1; cm.inputs[6].default_value = (*col, 1)
        nt.links.new(mm.outputs[0], cm.inputs[7]); nt.links.new(cm.outputs[2], b.inputs['Base Color'])
        MATS[name] = m
    m = bpy.data.materials.new('bois'); m.use_nodes = True; b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.30, 0.13, 0.06, 1); b.inputs['Roughness'].default_value = 0.6; MATS['bois'] = m
    m = bpy.data.materials.new('pied'); m.use_nodes = True; b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.03, 0.03, 0.032, 1); b.inputs['Metallic'].default_value = 1; b.inputs['Roughness'].default_value = 0.38; MATS['pied'] = m
    m = bpy.data.materials.new('dessous'); m.use_nodes = True; b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.02, 0.02, 0.02, 1); b.inputs['Roughness'].default_value = 0.95; MATS['dessous'] = m
make_materials(1)
for o, mat in parts: o.data.materials.clear(); o.data.materials.append(MATS[mat])

def gpu():
    scene.render.engine = 'CYCLES'; cy = scene.cycles
    try:
        pr = bpy.context.preferences.addons['cycles'].preferences; pr.compute_device_type = 'METAL'; pr.get_devices()
        for d in pr.devices: d.use = d.type == 'METAL'
        cy.device = 'GPU'
    except Exception: pass
    return cy

# ---------------------------------------------------------------- rendu de contrôle
def preview(path):
    cy = gpu(); cy.samples = 128; cy.use_denoising = True
    scene.render.resolution_x = 1600; scene.render.resolution_y = 900
    try: scene.view_settings.view_transform = 'AgX'; scene.view_settings.look = 'AgX - Medium High Contrast'
    except Exception: pass
    w = bpy.data.worlds.new('w'); scene.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.9, 0.95, 1, 1); w.node_tree.nodes['Background'].inputs[1].default_value = 0.6
    sun = bpy.data.objects.new('s', bpy.data.lights.new('s', 'SUN')); sun.data.energy = 2.6; sun.data.angle = math.radians(10)
    sun.rotation_euler = (math.radians(55), 0, math.radians(-40)); scene.collection.objects.link(sun)
    bpy.ops.mesh.primitive_plane_add(size=30); fl = bpy.context.object
    mf = bpy.data.materials.new('sol'); mf.use_nodes = True; mf.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.55, 0.45, 0.35, 1); fl.data.materials.append(mf)
    bpy.ops.mesh.primitive_plane_add(size=30, location=(0, D / 2 + 0.02, 0), rotation=(math.pi / 2, 0, 0)); wl = bpy.context.object
    mw = bpy.data.materials.new('mur'); mw.use_nodes = True; mw.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.8, 0.79, 0.77, 1); wl.data.materials.append(mw)
    cam = bpy.data.objects.new('c', bpy.data.cameras.new('c')); scene.collection.objects.link(cam); scene.camera = cam
    views = [((W * 0.5 + 0.5, -2.3, 1.35), (0, 0, 0.42), 35, ''), ((0.35, -1.25, 1.75), (0.5, 0.05, 0.45), 30, '-haut'), ((W / 2 - 0.2, -0.95, 0.85), (W / 2 - 0.5, 0.1, 0.5), 50, '-pres')]
    for loc, tgt, lens, sfx in views:
        cam.data.lens = lens; cam.location = loc; cam.rotation_euler = (Vector(tgt) - cam.location).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = path[:-4] + sfx + path[-4:]; bpy.ops.render.render(write_still=True)
    for o in (fl, wl, sun, cam): bpy.data.objects.remove(o)

if BLEND:
    cb = bpy.data.collections.new('2 - canape assemble'); scene.collection.children.link(cb)
    for o, _ in parts:
        for c in list(o.users_collection): c.objects.unlink(o)
        cb.objects.link(o)
    for o in bpy.data.collections['1 - patrons avant gonflage'].objects:
        o.data.materials.clear(); o.data.materials.append(MATS['tissu'])
    sun = bpy.data.objects.new('soleil', bpy.data.lights.new('soleil', 'SUN')); sun.data.energy = 3; sun.rotation_euler = (math.radians(50), 0, math.radians(-35)); scene.collection.objects.link(sun)
    bpy.ops.mesh.primitive_plane_add(size=12, location=(0, -1.5, 0)); bpy.context.object.name = 'sol'
    scene.frame_set(1); bpy.ops.wm.save_as_mainfile(filepath=BLEND); log('enregistré', BLEND)
if SHOT: preview(SHOT); log('rendu', SHOT)
if not BAKE: sys.exit(0)

# ---------------------------------------------------------------- allègement : copie légère (jeu), l'originale sert de modèle détaillé
def select(obs, active=None):
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs: o.select_set(True)
    bpy.context.view_layer.objects.active = active or obs[0]
for o, _ in parts:
    if not o.data.uv_layers: o.data.uv_layers.new(name='UVMap')
    o.data.uv_layers[0].name = 'UVMap'
select([o for o, _ in parts]); bpy.ops.object.join(); L = bpy.context.object; L.name = 'canape'
FAB = os.environ.get('SOFA_FABRIC', 'curly_teddy_natural')   # matière scannée (Poly Haven, CC0) : assets/models/_tissus/<nom>/
TILE = float(os.environ.get('SOFA_TILE', 0.335))               # côté réel du carré scanné (m)
me = L.data; det = me.uv_layers.new(name='detail'); me.uv_layers.active = me.uv_layers['UVMap']
nl = len(me.loops); uv0 = np.zeros(nl * 2, dtype=np.float32); me.uv_layers['UVMap'].data.foreach_get('uv', uv0); uv0 = uv0.reshape(-1, 2) / TILE
mi = np.zeros(len(me.polygons), dtype=np.int32); me.polygons.foreach_get('material_index', mi)
ls = np.zeros(len(me.polygons), dtype=np.int32); me.polygons.foreach_get('loop_start', ls); lt = np.zeros(len(me.polygons), dtype=np.int32); me.polygons.foreach_get('loop_total', lt)
hard = [i for i, s_ in enumerate(L.material_slots) if s_.material.name.split('.')[0] in ('pied', 'dessous')]
for f in np.nonzero(np.isin(mi, hard))[0]: uv0[ls[f]:ls[f] + lt[f]] = 0.5          # métal, toile du dessous : pas de grain
WOOD_TILE = 0.6 if TER else 1.7
woodi = [i for i, s_ in enumerate(L.material_slots) if s_.material.name.split('.')[0] == 'bois']
for f in np.nonzero(np.isin(mi, woodi))[0]: uv0[ls[f]:ls[f] + lt[f]] *= TILE / WOOD_TILE     # bois : échelle des lames de terrasse
if TER:
    for f in np.nonzero(np.isin(mi, woodi))[0]: uv0[ls[f]:ls[f] + lt[f]] = uv0[ls[f]:ls[f] + lt[f]][:, ::-1]     # placage : le fil du scan est vertical, il suit la longueur des pièces
det.data.foreach_set('uv', uv0.ravel())
select([L]); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.quads_convert_to_tris()
bpy.ops.uv.select_all(action='SELECT'); bpy.ops.uv.average_islands_scale(); bpy.ops.uv.pack_islands(margin=0.004, rotate=True)
bpy.ops.object.mode_set(mode='OBJECT')
log('maille :', len(L.data.polygons), 'triangles')

# ---------------------------------------------------------------- cuisson des textures
cy = gpu(); cy.samples = 24; cy.use_denoising = False
def image(name, res, color):
    im = bpy.data.images.new(name, res, res, alpha=False, float_buffer=False); im.colorspace_settings.name = 'sRGB' if color else 'Non-Color'; return im
def target(im):
    # nœud image actif dans chaque matière du jeu : c'est là que Blender écrit
    for s_ in L.material_slots:
        nt = s_.material.node_tree; n = nt.nodes.get('cuisson') or nt.nodes.new('ShaderNodeTexImage'); n.name = 'cuisson'; n.image = im; nt.nodes.active = n
def bake(kind, im, from_high, **kw):
    target(im); bk = scene.render.bake
    bk.use_selected_to_active = False; bk.margin = 12; bk.margin_type = 'EXTEND'; select([L], L)
    bpy.ops.object.bake(type=kind, **kw); log('cuit', kind)
def tile_normal(n=1024, strength=1.0):
    r = np.random.default_rng(3); fx = np.fft.fftfreq(n)[:, None] * n; fy = np.fft.fftfreq(n)[None, :] * n; fr = np.hypot(fx, fy)
    def band(f0, bw):                           # bruit périodique autour de f0 cycles par motif
        sp = np.fft.fft2(r.standard_normal((n, n))) * np.exp(-((fr - f0) / bw) ** 2); a = np.real(np.fft.ifft2(sp)); return a / a.std()
    loops = 1 - np.abs(band(TILE / 0.0034, 11)); loops = np.clip(loops, 0, 1) ** 1.6      # boucles de 4 mm (bruit en crêtes)
    h = loops + 0.45 * band(TILE / 0.0015, 24) + 0.15 * band(TILE / 0.011, 5)
    px = TILE / n; gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / (2 * px); gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) / (2 * px)
    k = 0.00050 * strength; nx_, ny_ = -gx * k, -gy * k; nz_ = np.ones_like(h); L_ = np.sqrt(nx_ ** 2 + ny_ ** 2 + 1)
    out = np.stack([nx_ / L_ * 0.5 + 0.5, ny_ / L_ * 0.5 + 0.5, nz_ / L_ * 0.5 + 0.5, np.ones_like(h)], -1).astype(np.float32)
    return out, h
# ombres propres : occlusion du modèle détaillé, posé sur un sol
cy.samples = 192
bpy.ops.mesh.primitive_plane_add(size=30); fl = bpy.context.object
w = bpy.data.worlds.new('ao'); scene.world = w; w.light_settings.distance = 0.45
im_a = image('ao', RES // 2, False); bake('AO', im_a, True)
bpy.data.objects.remove(fl)
# rugosité et métal : émis par des matières de service (vert = rugosité, bleu = métal)
cy.samples = 4
for s_ in list(L.material_slots):
    nt = s_.material.node_tree; b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'); out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
    e = nt.nodes.new('ShaderNodeEmission'); e.inputs[0].default_value = (0, b.inputs['Roughness'].default_value, b.inputs['Metallic'].default_value, 1); nt.links.new(e.outputs[0], out.inputs[0])
im_r = image('rm', RES // 2, False); bake('EMIT', im_r, True)

def pixels(im):
    a = np.zeros(im.size[0] * im.size[1] * 4, dtype=np.float32); im.pixels.foreach_get(a); return a.reshape(im.size[1], im.size[0], 4)
ao = pixels(im_a); rm = pixels(im_r); arm = rm.copy(); arm[..., 0] = np.clip(ao[..., 0], 0, 1) ** 0.9; arm[..., 3] = 1
im_arm = image('arm', RES // 2, False); im_arm.pixels.foreach_set(arm.ravel())
tex = os.path.join(OUT, NAME, 'textures'); os.makedirs(tex, exist_ok=True)
def save(im, file, q=90):
    scene.render.image_settings.file_format = 'JPEG'; scene.render.image_settings.quality = q; scene.render.image_settings.color_mode = 'RGB'
    scene.view_settings.view_transform = 'Standard'; scene.view_settings.look = 'None'
    im.filepath_raw = os.path.join(tex, file); im.file_format = 'JPEG'; im.save(quality=q) if bpy.app.version >= (3, 4, 0) else im.save()
K = '%dk' % (RES // 1024)
save(im_arm, f'{NAME}_arm_{K}.jpg', 88)

# ---------------------------------------------------------------- export glTF (y en haut, façade vers +z)
me = L.data; me.calc_loop_triangles()
try: me.calc_normals_split()
except Exception: pass
nl = len(me.loops); lv = np.zeros(nl, dtype=np.int32); me.loops.foreach_get('vertex_index', lv)
co = np.zeros(len(me.vertices) * 3, dtype=np.float32); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)[lv]
try: nr = np.zeros(nl * 3, dtype=np.float32); me.corner_normals.foreach_get('vector', nr)
except Exception: nr = np.zeros(nl * 3, dtype=np.float32); me.loops.foreach_get('normal', nr)
nr = nr.reshape(-1, 3); uv = np.zeros(nl * 2, dtype=np.float32); me.uv_layers['UVMap'].data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
u2 = np.zeros(nl * 2, dtype=np.float32); me.uv_layers['detail'].data.foreach_get('uv', u2); u2 = u2.reshape(-1, 2)
tri = np.zeros(len(me.loop_triangles) * 3, dtype=np.int32); me.loop_triangles.foreach_get('loops', tri)
tm = np.zeros(len(me.loop_triangles), dtype=np.int32); me.loop_triangles.foreach_get('material_index', tm)
P = np.stack([co[:, 0], co[:, 2], -co[:, 1]], 1); Nn = np.stack([nr[:, 0], nr[:, 2], -nr[:, 1]], 1); UV = np.stack([uv[:, 0], 1 - uv[:, 1]], 1); U2 = np.stack([u2[:, 0], 1 - u2[:, 1]], 1); U2 -= np.floor(U2.min(0))
P[:, 0] -= (P[:, 0].max() + P[:, 0].min()) / 2; P[:, 2] -= (P[:, 2].max() + P[:, 2].min()) / 2; P[:, 1] -= P[:, 1].min()
key = np.round(np.concatenate([P * 1e5, Nn * 1e3, UV * 1e5, U2 * 1e4], 1)).astype(np.int64)
_, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
P, Nn, UV, U2 = P[first].astype(np.float32), Nn[first].astype(np.float32), UV[first].astype(np.float32), U2[first].astype(np.float32); idx = inv.ravel()[tri].astype(np.uint32)
# une primitive par matière : le tissu (scan répété, teinté par pièce) et les parties dures (pieds, toile du dessous)
ACC = tuple(float(v) for v in os.environ.get('SOFA_ACCENT', '0.75,0.36,0.24').split(','))
if STYLE == 'jardin': TINT = {'tissu': (1.0, 1.0, 1.0)}
elif TER: TINT = {'tissu': (1.0, 1.0, 1.0), 'coussinA': ACC}
else: TINT = {'tissu': (0.83, 0.85, 0.86), 'coussinA': (0.50, 0.47, 0.43), 'coussinB': (1.0, 1.0, 1.0)}   # le scan tire sur le pêche : teinte ramenée vers le grège
HARD = {'pied': ((0.025, 0.025, 0.027), 0.42), 'dessous': ((0.02, 0.02, 0.02), 0.95)}
names = [s_.material.name.split('.')[0] for s_ in L.material_slots]; tri3 = idx.reshape(-1, 3)
n = len(P); blob = bytearray(P.tobytes() + Nn.tobytes() + UV.tobytes() + U2.tobytes())
views = [{'buffer': 0, 'byteOffset': 0, 'byteLength': n * 12, 'target': 34962}, {'buffer': 0, 'byteOffset': n * 12, 'byteLength': n * 12, 'target': 34962},
         {'buffer': 0, 'byteOffset': n * 24, 'byteLength': n * 8, 'target': 34962}, {'buffer': 0, 'byteOffset': n * 32, 'byteLength': n * 8, 'target': 34962}]
acc = [{'bufferView': 0, 'componentType': 5126, 'count': n, 'type': 'VEC3', 'min': P.min(0).tolist(), 'max': P.max(0).tolist()},
       {'bufferView': 1, 'componentType': 5126, 'count': n, 'type': 'VEC3'}, {'bufferView': 2, 'componentType': 5126, 'count': n, 'type': 'VEC2'}, {'bufferView': 3, 'componentType': 5126, 'count': n, 'type': 'VEC2'}]
mats, prims = [], []
for mi_, nm in enumerate(names):
    sel = tri3[tm == mi_]
    if not len(sel): continue
    views.append({'buffer': 0, 'byteOffset': len(blob), 'byteLength': sel.size * 4, 'target': 34963}); blob += sel.astype(np.uint32).tobytes()
    acc.append({'bufferView': len(views) - 1, 'componentType': 5125, 'count': int(sel.size), 'type': 'SCALAR'})
    if nm == 'bois':
        mats.append({'name': NAME + '_bois', 'normalTexture': {'index': 4, 'texCoord': 1}, 'occlusionTexture': {'index': 2},
                     'pbrMetallicRoughness': {'baseColorFactor': [0.66, 0.5, 0.4, 1] if TER else [0.78, 0.86, 0.9, 1], 'baseColorTexture': {'index': 3, 'texCoord': 1}, 'metallicRoughnessTexture': {'index': 2}}})
    elif nm in HARD:
        col, rough = HARD[nm]; mats.append({'name': NAME + '_' + nm, 'pbrMetallicRoughness': {'baseColorFactor': [*col, 1], 'metallicFactor': 0, 'roughnessFactor': rough}})
    else:
        mats.append({'name': NAME + '_' + nm, 'normalTexture': {'index': 1, 'texCoord': 1}, 'occlusionTexture': {'index': 2},
                     'pbrMetallicRoughness': {'baseColorFactor': [*TINT[nm], 1], 'baseColorTexture': {'index': 0, 'texCoord': 1}, 'metallicRoughnessTexture': {'index': 2}}})
    prims.append({'attributes': {'POSITION': 0, 'NORMAL': 1, 'TEXCOORD_0': 2, 'TEXCOORD_1': 3}, 'indices': len(acc) - 1, 'material': len(mats) - 1})
g = {'asset': {'generator': 'Canopée outils/meubles/sofa.py', 'version': '2.0'}, 'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0, 'name': NAME}],
     'materials': mats, 'meshes': [{'name': NAME, 'primitives': prims}], 'textures': [{'sampler': 0, 'source': i_} for i_ in range(5)],
     'images': [{'mimeType': 'image/jpeg', 'uri': f'../_tissus/{FAB}/{FAB}_diff_2k.jpg'}, {'mimeType': 'image/jpeg', 'uri': f'../_tissus/{FAB}/{FAB}_nor_gl_2k.jpg'},
                {'mimeType': 'image/jpeg', 'uri': f'textures/{NAME}_arm_{K}.jpg'},
                {'mimeType': 'image/jpeg', 'uri': '../../textures/%s_diff.jpg' % ('oak' if TER else 'deck')}, {'mimeType': 'image/jpeg', 'uri': '../../textures/%s_nor.jpg' % ('oak' if TER else 'deck')}],
     'accessors': acc, 'bufferViews': views, 'samplers': [{'magFilter': 9729, 'minFilter': 9987}], 'buffers': [{'byteLength': len(blob), 'uri': NAME + '.bin'}]}
open(os.path.join(OUT, NAME, NAME + '.bin'), 'wb').write(bytes(blob)); json.dump(g, open(os.path.join(OUT, NAME, NAME + '.gltf'), 'w'))
log('écrit', NAME, n, 'sommets,', len(idx) // 3, 'triangles, taille', np.round(P.max(0) - P.min(0), 3).tolist())
