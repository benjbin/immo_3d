# Rendu photoréaliste (Cycles, tracé de chemins complet) d'un point de vue de la maquette, à partir de l'export glTF
# de outils/pano/export.mjs. Vue normale (essai) ou panorama 360° équirectangulaire.
#   Blender -b -P outils/pano/pano.py -- <scene.glb> <sortie.jpg> <x> <y> <z> [lacet] [tangage] [mode=vue|pano] [largeur] [échantillons]
# Coordonnées et angles : ceux de la maquette (nav.teleport : pos = [x, y, z], yaw, pitch).
# Variables : PANO_EXP (exposition, EV), PANO_SUN (0 = sans soleil direct), PANO_FOV (degrés, vue normale).
import bpy, sys, os, json, math, time
from mathutils import Vector
A = sys.argv[sys.argv.index('--') + 1:]
GLB, OUT = A[0], A[1]
# lot de vues : Blender -b -P pano.py -- <scene.glb> <dossier de sortie> <vues.json> [mode] [largeur] [échantillons]
#   vues.json = [{"id": "201-sejour", "lot": "201", "name": "Séjour", "pos": [x, y, z] ou "poly": [[x, z], …] + "y", "n": 1}, …]
#   Avec "poly" (contour de la pièce), l'appareil est posé à l'endroit le plus dégagé (loin des murs et des meubles).
#   Écrit <dossier>/<id>.jpg et <dossier>/vues-<étage>.json (positions retenues, lacet, vues visibles l'une de l'autre).
#   Une image déjà écrite est sautée (reprise possible).
BATCH = len(A) > 2 and A[2].endswith('.json')
if BATCH:
    SPEC = json.load(open(A[2])); VIEWS = []
    MODE = A[3] if len(A) > 3 else 'pano'; W = int(A[4]) if len(A) > 4 else 6000; SPP = int(A[5]) if len(A) > 5 else 400
else:
    VIEWS = [(OUT, float(A[2]), float(A[3]), float(A[4]), float(A[5]) if len(A) > 5 else 0.0, float(A[6]) if len(A) > 6 else 0.0)]
    MODE = A[7] if len(A) > 7 else 'vue'; W = int(A[8]) if len(A) > 8 else 1600; SPP = int(A[9]) if len(A) > 9 else 256
EXP = float(os.environ.get('PANO_EXP', '0')); METER = float(os.environ.get('PANO_METER', '0.325')); DAMP = float(os.environ.get('PANO_DAMP', '0.7')); FOV = float(os.environ.get('PANO_FOV', '75'))
T0 = time.time()
def log(*a): print('[pano %6.1fs]' % (time.time() - T0), *a, flush=True)
meta = json.load(open(GLB[:-4] + '.json'))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
scene = bpy.context.scene
log('import', len(bpy.data.objects), 'objets,', len(bpy.data.materials), 'matières')

# --- matières : retouches par nom (les effets propres à la maquette ne passent pas par le glTF)
def principled(m):
    return next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None) if m.use_nodes else None
def thin_glass(m, tint=(1, 1, 1), rough=0.0):
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial'); tr = nt.nodes.new('ShaderNodeBsdfTransparent'); gl = nt.nodes.new('ShaderNodeBsdfGlossy')
    fr = nt.nodes.new('ShaderNodeFresnel'); fr.inputs['IOR'].default_value = 1.5; mix = nt.nodes.new('ShaderNodeMixShader')
    lp = nt.nodes.new('ShaderNodeLightPath'); mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'
    gl.inputs['Roughness'].default_value = rough
    pull = float(os.environ.get('PANO_PULL', '0.62'))       # part de la lumière extérieure vue à travers la vitre
    mc = nt.nodes.new('ShaderNodeMix'); mc.data_type = 'RGBA'
    mc.inputs[6].default_value = (*tint, 1); mc.inputs[7].default_value = (pull, pull, pull, 1)
    nt.links.new(lp.outputs['Is Camera Ray'], mc.inputs[0]); nt.links.new(mc.outputs[2], tr.inputs['Color'])
    nt.links.new(lp.outputs['Is Camera Ray'], mul.inputs[0]); nt.links.new(fr.outputs[0], mul.inputs[1])   # reflet vu par la caméra seulement
    nt.links.new(mul.outputs[0], mix.inputs[0]); nt.links.new(tr.outputs[0], mix.inputs[1]); nt.links.new(gl.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs[0])
kill = []
for m in bpy.data.materials:
    n = m.name
    if not m.use_nodes: continue
    if n.startswith('interiorWarm'): kill.append(m); continue
    if n.startswith('glass') or n.startswith('glassRail') or n.startswith('glassClear'): thin_glass(m, (0.96, 0.98, 0.97)); continue
    p = principled(m)
    if p is None: continue
    if n.startswith('mirror'): p.inputs['Metallic'].default_value = 1; p.inputs['Roughness'].default_value = 0.02; p.inputs['Base Color'].default_value = (0.92, 0.92, 0.92, 1)
    if n.startswith('curtainSheer'):
        p.inputs['Alpha'].default_value = 0.55
        if 'Transmission Weight' in p.inputs: p.inputs['Transmission Weight'].default_value = 0.0
        p.inputs['Roughness'].default_value = 1.0
# plans lumineux derrière les vitres des autres logements : ils boucheraient les baies
for o in list(bpy.data.objects):
    if o.type == 'MESH' and any(s.material in kill for s in o.material_slots): bpy.data.objects.remove(o, do_unlink=True)
    elif o.type not in ('MESH', 'EMPTY'): bpy.data.objects.remove(o, do_unlink=True)
# couleurs par sommet : multipliées à la teinte si l'import ne l'a pas fait
done = set()
for o in bpy.data.objects:
    if o.type != 'MESH' or not o.data.color_attributes or os.environ.get('PANO_VC', '1') == '0': continue   # PANO_VC=0 : sans l'ombrage par sommet de la maquette (référence physique)
    ca = o.data.color_attributes[0].name
    for s in o.material_slots:
        m = s.material
        if m is None or m.name in done or not m.use_nodes: continue
        done.add(m.name); p = principled(m)
        if p is None or any(nd.type in ('VERTEX_COLOR', 'ATTRIBUTE') for nd in m.node_tree.nodes): continue
        nt = m.node_tree; vc = nt.nodes.new('ShaderNodeVertexColor'); vc.layer_name = ca
        mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.inputs[0].default_value = 1
        bc = p.inputs['Base Color']
        if bc.is_linked: nt.links.new(bc.links[0].from_socket, mx.inputs[6])
        else: mx.inputs[6].default_value = bc.default_value
        nt.links.new(vc.outputs['Color'], mx.inputs[7]); nt.links.new(mx.outputs[2], bc)
# --- végétation : feuilles translucides (lumière qui traverse) ; dehors, couleur atténuée pour les rebonds seulement
# (sinon la pelouse et les arbres verdissent les murs) ; bois : relief des textures adouci
import re
LEAF = re.compile(r'^(leaf|grass|flower|sedum|forestEdge|decoLeaf)'); OUTG = re.compile(r'^(leaf|grass|flower|sedum|forestEdge|meadow|ground|greenRoof)')
WOOD = re.compile(r'(Oak|Parquet|Wood|Lacquer|deck|woodSoffit|model:)')
GI_SAT = float(os.environ.get('PANO_GISAT', '0.35')); NRM = float(os.environ.get('PANO_NRM', '0.4')); TRANS = float(os.environ.get('PANO_LEAF', '0.35'))
nveg = 0
for m in bpy.data.materials:
    if not m.use_nodes: continue
    p = principled(m)
    if p is None: continue
    nt = m.node_tree; n = m.name
    if WOOD.search(n):
        for nd in nt.nodes:
            if nd.type == 'NORMAL_MAP': nd.inputs['Strength'].default_value *= NRM
    bc = p.inputs['Base Color']
    def src_color():
        if bc.is_linked: return bc.links[0].from_socket
        rgb = nt.nodes.new('ShaderNodeRGB'); rgb.outputs[0].default_value = bc.default_value; return rgb.outputs[0]
    if OUTG.search(n):
        c = src_color(); hs = nt.nodes.new('ShaderNodeHueSaturation'); hs.inputs['Saturation'].default_value = GI_SAT; hs.inputs['Value'].default_value = 0.9
        lp = nt.nodes.new('ShaderNodeLightPath'); mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'
        nt.links.new(c, hs.inputs['Color']); nt.links.new(lp.outputs['Is Camera Ray'], mx.inputs[0]); nt.links.new(hs.outputs[0], mx.inputs[6]); nt.links.new(c, mx.inputs[7])
        nt.links.new(mx.outputs[2], bc)
    if LEAF.search(n):
        nveg += 1
        outn = next((x for x in nt.nodes if x.type == 'OUTPUT_MATERIAL'), None)
        if outn is None: continue
        c = src_color(); tl = nt.nodes.new('ShaderNodeBsdfTranslucent'); nt.links.new(c, tl.inputs['Color'])
        mix = nt.nodes.new('ShaderNodeMixShader'); mix.inputs[0].default_value = TRANS
        nt.links.new(p.outputs[0], mix.inputs[1]); nt.links.new(tl.outputs[0], mix.inputs[2])
        al = p.inputs['Alpha']; last = mix.outputs[0]
        if al.is_linked:
            a_src = al.links[0].from_socket; nt.links.remove(al.links[0]); al.default_value = 1
            tp = nt.nodes.new('ShaderNodeBsdfTransparent'); m2 = nt.nodes.new('ShaderNodeMixShader')
            nt.links.new(a_src, m2.inputs[0]); nt.links.new(tp.outputs[0], m2.inputs[1]); nt.links.new(last, m2.inputs[2]); last = m2.outputs[0]
        p.inputs['Roughness'].default_value = min(p.inputs['Roughness'].default_value, 0.55) if not p.inputs['Roughness'].is_linked else p.inputs['Roughness'].default_value
        nt.links.new(last, outn.inputs['Surface'])
log('végétation :', nveg, 'matières de feuillage')
log('matières retouchées ;', len(done), 'avec couleur par sommet')

# --- plantes des jardinières : les cartes plates de la maquette (strelitzias, palmes, retombantes) sont remplacées par
# de vraies feuilles modelées (limbe courbe, pli central, pétiole), une variante tirée au hasard par emplacement
if os.environ.get('PANO_PLANTS', '1') != '0':
    import random, numpy as np
    rnd = random.Random(7)
    def blade(V, F, UV, COL, base, az, elev, L, Wd, bend, petiole=0.0, fold=0.25, twist=0.0, nu=6, nv=22, shape='paddle', tone=1.0):
        # limbe le long d'une ligne centrale qui se courbe ; base = point de départ, az = azimut, elev = élévation initiale
        ca, sa = math.cos(az), math.sin(az); i0 = len(V); pos = Vector(base); ang = elev; ds = L / nv
        for j in range(nv + 1):
            v = j / nv
            d = Vector((ca * math.cos(ang), sa * math.cos(ang), math.sin(ang)))        # direction de la ligne centrale
            nrm = Vector((-ca * math.sin(ang), -sa * math.sin(ang), math.cos(ang)))     # normale (dessus de la feuille)
            side = d.cross(nrm).normalized()
            if v < petiole or petiole >= 1: w = (Wd if petiole >= 1 else 0.012 * L)
            else:
                t = (v - petiole) / (1 - petiole)
                if shape == 'paddle': w = Wd * (math.sin(math.pi * min(1, t ** 0.75)) ** 0.55) * (1 - 0.25 * t)
                elif shape == 'heart': w = Wd * (math.sin(math.pi * t ** 0.55) ** 0.8)
                else: w = Wd * (math.sin(math.pi * t ** 0.6) ** 0.9)
                w = max(w, 0.004 * L)
            tw = twist * v; wav = 0.02 * L * math.sin(v * 9 + az * 3) if v >= petiole else 0
            for i in range(nu + 1):
                u = i / nu * 2 - 1
                off = side * (u * w * math.cos(tw)) + nrm * (abs(u) * w * fold + u * w * math.sin(tw) + wav * abs(u))
                V.append(tuple(pos + off)); UV.append((i / nu, v)); COL.append(tone)
            pos = pos + d * ds; ang -= bend / nv * (1.6 * v + 0.2)
        for j in range(nv):
            for i in range(nu):
                a0 = i0 + j * (nu + 1) + i; F.append((a0, a0 + 1, a0 + nu + 2, a0 + nu + 1))
        return pos
    def strelitzia():
        V, F, UV, COL = [], [], [], []
        n = rnd.randint(7, 10)
        for k in range(n):
            az = k * 2.399 + rnd.uniform(-0.3, 0.3); out = rnd.uniform(0.02, 0.06)
            L = rnd.uniform(0.75, 1.02) * (0.7 + 0.3 * k / n)
            blade(V, F, UV, COL, (math.cos(az) * out, math.sin(az) * out, 0), az, math.radians(rnd.uniform(74, 87)), L, rnd.uniform(0.085, 0.12),
                  rnd.uniform(0.7, 1.5), petiole=rnd.uniform(0.42, 0.52), fold=rnd.uniform(0.15, 0.35), twist=rnd.uniform(-0.5, 0.5), tone=rnd.uniform(0.75, 1.15))
        return V, F, UV, COL
    def palm():
        V, F, UV, COL = [], [], [], []
        for k in range(rnd.randint(7, 10)):
            az = k * 2.399 + rnd.uniform(-0.3, 0.3); elev = math.radians(rnd.uniform(48, 80)); L = rnd.uniform(0.8, 1.15); bend = rnd.uniform(1.2, 2.0)
            ca, sa = math.cos(az), math.sin(az); pos = Vector((0, 0, 0)); ang = elev; nseg = 26; tone = rnd.uniform(0.8, 1.15)
            blade(V, F, UV, COL, (0, 0, 0), az, elev, L, 0.006, bend, petiole=1.0, nu=2, nv=nseg, tone=0.7)       # rachis
            for j in range(nseg + 1):
                v = j / nseg
                d = Vector((ca * math.cos(ang), sa * math.cos(ang), math.sin(ang)))
                if v > 0.22:
                    t = (v - 0.22) / 0.78; ll = 0.34 * L * (math.sin(math.pi * t ** 0.7) ** 0.6 + 0.12)
                    for sgn in (-1, 1):
                        la = az + sgn * rnd.uniform(0.95, 1.25)
                        blade(V, F, UV, COL, tuple(pos), la, ang * 0.35 + rnd.uniform(-0.1, 0.25), ll, 0.022 * L, rnd.uniform(0.5, 1.3), fold=0.5, nu=2, nv=6, shape='lance', tone=tone * rnd.uniform(0.9, 1.1))
                pos = pos + d * (L / nseg); ang -= bend / nseg * (1.6 * v + 0.2)
        return V, F, UV, COL
    def trailing():
        V, F, UV, COL = [], [], [], []
        for k in range(rnd.randint(4, 6)):
            az = rnd.uniform(0, 6.28); r = rnd.uniform(0.0, 0.07); pos = Vector((math.cos(az) * r, math.sin(az) * r, 0)); Ls = rnd.uniform(0.3, 0.52); n = int(Ls / 0.028)
            ph = rnd.uniform(0, 6.28); pts = []
            for j in range(n + 1):
                v = j / n; pts.append(Vector((pos.x + 0.03 * math.sin(v * 5 + ph) + 0.05 * v * math.cos(az), pos.y + 0.03 * math.cos(v * 4 + ph) + 0.05 * v * math.sin(az), 0.03 * math.sin(min(1, v * 6) * math.pi) - v * Ls)))
            for j in range(n):                                                     # tige
                a0 = len(V); q0, q1 = pts[j], pts[j + 1]
                for q in (q0, q1):
                    V.append((q.x - 0.0025, q.y, q.z)); V.append((q.x + 0.0025, q.y, q.z)); UV.extend([(0.5, 0), (0.5, 0)]); COL.extend([0.6, 0.6])
                F.append((a0, a0 + 1, a0 + 3, a0 + 2))
                la = j * 2.4 + rnd.uniform(-0.6, 0.6); sz = rnd.uniform(0.038, 0.06) * (1 - 0.35 * j / n)
                blade(V, F, UV, COL, tuple(q0), la, rnd.uniform(-0.9, 0.1), sz, sz * 0.42, rnd.uniform(0.3, 1.0), petiole=0.18, fold=0.3, nu=4, nv=6, shape='heart', tone=rnd.uniform(0.75, 1.2))
        return V, F, UV, COL
    def leaf_mat(name, c0, c1, rough):
        m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
        out = nt.nodes.new('ShaderNodeOutputMaterial'); pb = nt.nodes.new('ShaderNodeBsdfPrincipled'); tl = nt.nodes.new('ShaderNodeBsdfTranslucent'); mix = nt.nodes.new('ShaderNodeMixShader')
        uv = nt.nodes.new('ShaderNodeUVMap'); sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(uv.outputs[0], sep.inputs[0])
        # nervure centrale plus claire, nervures latérales en biais (onde le long de la feuille décalée par |u − 0,5|)
        d = nt.nodes.new('ShaderNodeMath'); d.operation = 'SUBTRACT'; d.inputs[1].default_value = 0.5; nt.links.new(sep.outputs[0], d.inputs[0])
        ab = nt.nodes.new('ShaderNodeMath'); ab.operation = 'ABSOLUTE'; nt.links.new(d.outputs[0], ab.inputs[0])
        rib = nt.nodes.new('ShaderNodeMapRange'); rib.inputs[1].default_value = 0.0; rib.inputs[2].default_value = 0.05; rib.inputs[3].default_value = 0.55; rib.inputs[4].default_value = 0.0; nt.links.new(ab.outputs[0], rib.inputs[0])
        ph = nt.nodes.new('ShaderNodeMath'); ph.operation = 'MULTIPLY_ADD'; ph.inputs[1].default_value = 70.0; nt.links.new(sep.outputs[1], ph.inputs[0])
        k2 = nt.nodes.new('ShaderNodeMath'); k2.operation = 'MULTIPLY'; k2.inputs[1].default_value = -55.0; nt.links.new(ab.outputs[0], k2.inputs[0]); nt.links.new(k2.outputs[0], ph.inputs[2])
        sn = nt.nodes.new('ShaderNodeMath'); sn.operation = 'SINE'; nt.links.new(ph.outputs[0], sn.inputs[0])
        vein = nt.nodes.new('ShaderNodeMapRange'); vein.inputs[1].default_value = 0.8; vein.inputs[2].default_value = 1.0; vein.inputs[3].default_value = 0.0; vein.inputs[4].default_value = 0.12; nt.links.new(sn.outputs[0], vein.inputs[0])
        mxv = nt.nodes.new('ShaderNodeMath'); mxv.operation = 'MAXIMUM'; nt.links.new(rib.outputs[0], mxv.inputs[0]); nt.links.new(vein.outputs[0], mxv.inputs[1])
        vc = nt.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'ton'
        noise = nt.nodes.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 9.0
        ramp = nt.nodes.new('ShaderNodeMix'); ramp.data_type = 'RGBA'; ramp.inputs[6].default_value = (*c0, 1); ramp.inputs[7].default_value = (*c1, 1); nt.links.new(noise.outputs[0], ramp.inputs[0])
        tone = nt.nodes.new('ShaderNodeMix'); tone.data_type = 'RGBA'; tone.blend_type = 'MULTIPLY'; tone.inputs[0].default_value = 1; nt.links.new(ramp.outputs[2], tone.inputs[6]); nt.links.new(vc.outputs['Color'], tone.inputs[7])
        lite = nt.nodes.new('ShaderNodeMix'); lite.data_type = 'RGBA'; lite.inputs[7].default_value = (c1[0] * 1.8 + 0.02, c1[1] * 1.6 + 0.03, c1[2] * 1.4 + 0.01, 1)
        nt.links.new(mxv.outputs[0], lite.inputs[0]); nt.links.new(tone.outputs[2], lite.inputs[6])
        # rebonds : couleur atténuée (comme le reste de la végétation extérieure)
        hs = nt.nodes.new('ShaderNodeHueSaturation'); hs.inputs['Saturation'].default_value = GI_SAT; lp = nt.nodes.new('ShaderNodeLightPath'); cm = nt.nodes.new('ShaderNodeMix'); cm.data_type = 'RGBA'
        nt.links.new(lite.outputs[2], hs.inputs['Color']); nt.links.new(lp.outputs['Is Camera Ray'], cm.inputs[0]); nt.links.new(hs.outputs[0], cm.inputs[6]); nt.links.new(lite.outputs[2], cm.inputs[7])
        bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.25; bump.inputs['Distance'].default_value = 0.004; nt.links.new(mxv.outputs[0], bump.inputs['Height'])
        nt.links.new(cm.outputs[2], pb.inputs['Base Color']); nt.links.new(cm.outputs[2], tl.inputs['Color']); nt.links.new(bump.outputs[0], pb.inputs['Normal'])
        pb.inputs['Roughness'].default_value = rough; mix.inputs[0].default_value = 0.18
        nt.links.new(pb.outputs[0], mix.inputs[1]); nt.links.new(tl.outputs[0], mix.inputs[2]); nt.links.new(mix.outputs[0], out.inputs[0])
        return m
    def plant_mesh(name, data, mat):
        V, F, UV, COL = data
        me = bpy.data.meshes.new(name); me.from_pydata(V, [], F); me.update()
        ul = me.uv_layers.new(name='UVMap'); ca = me.color_attributes.new('ton', 'FLOAT_COLOR', 'POINT')
        for l in me.loops: ul.data[l.index].uv = UV[l.vertex_index]
        for i, c in enumerate(COL): ca.data[i].color = (c, c, c, 1)
        for pl in me.polygons: pl.use_smooth = True
        me.materials.append(mat); return me
    KINDS = {'leafTropical': (strelitzia, leaf_mat('strelitzia', (0.018, 0.06, 0.016), (0.035, 0.105, 0.025), 0.32), 1.0, 2),
             'leafPalm': (palm, leaf_mat('palme', (0.035, 0.10, 0.022), (0.065, 0.16, 0.038), 0.42), 0.62, 2),
             'leafTrail': (trailing, leaf_mat('retombante', (0.028, 0.085, 0.022), (0.05, 0.135, 0.034), 0.38), 0.5, 1)}
    npl = 0
    for key, (fn, mat, href, sub) in KINDS.items():
        variants = [plant_mesh('%s%d' % (key, i), fn(), mat) for i in range(5)]
        for o in list(bpy.data.objects):
            if o.type != 'MESH' or not o.material_slots or o.material_slots[0].material is None or o.material_slots[0].material.name.split('.')[0] != key: continue
            bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
            mn = Vector([min(b_[i] for b_ in bb) for i in range(3)]); mx = Vector([max(b_[i] for b_ in bb) for i in range(3)])
            hgt = mx.z - mn.z
            no = bpy.data.objects.new('plante', rnd.choice(variants)); scene.collection.objects.link(no)
            sc = hgt / href
            if key == 'leafTrail': no.location = ((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mx.z)
            else: no.location = ((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z)
            no.scale = (sc, sc, sc); no.rotation_euler = (0, 0, rnd.uniform(0, 6.28))
            md = no.modifiers.new('lisse', 'SUBSURF'); md.levels = 0; md.render_levels = sub
            bpy.data.objects.remove(o, do_unlink=True); npl += 1
    log('plantes remodelées :', npl)

# --- ciel et soleil physiques (direction du soleil de la maquette)
sx, sy, sz = meta['sun']; sd = Vector((sx, -sz, sy)).normalized()
w = bpy.data.worlds.new('ciel'); scene.world = w; w.use_nodes = True
nt = w.node_tree; bg = nt.nodes['Background']; sky = nt.nodes.new('ShaderNodeTexSky')
for t in ('MULTIPLE_SCATTERING', 'NISHITA', 'SINGLE_SCATTERING'):
    try: sky.sky_type = t; break
    except Exception: pass
sky.sun_elevation = math.asin(sd.z); sky.sun_rotation = math.atan2(sd.x, sd.y)
try: sky.sun_disc = os.environ.get('PANO_SUN', '1') != '0'; sky.sun_size = math.radians(0.545); sky.sun_intensity = 1.0
except Exception: pass
nt.links.new(sky.outputs[0], bg.inputs[0]); bg.inputs[1].default_value = 1.0
log('ciel', sky.sky_type, 'élévation %.1f°' % math.degrees(sky.sun_elevation))

# --- caméra
cam = bpy.data.cameras.new('cam'); co = bpy.data.objects.new('cam', cam); scene.collection.objects.link(co); scene.camera = co
cam.clip_start = 0.02; cam.clip_end = 5000
scene.render.resolution_percentage = 100

# --- Cycles
scene.render.engine = 'CYCLES'; cy = scene.cycles
try:
    pr = bpy.context.preferences.addons['cycles'].preferences
    pr.compute_device_type = 'METAL'; pr.get_devices()
    for d in pr.devices: d.use = d.type == 'METAL'
    cy.device = 'GPU'
except Exception as ex: log('GPU indisponible :', ex)
cy.samples = SPP; cy.use_adaptive_sampling = True; cy.adaptive_threshold = 0.01
cy.max_bounces = 12; cy.diffuse_bounces = 8; cy.glossy_bounces = 6; cy.transmission_bounces = 12; cy.transparent_max_bounces = 16
cy.caustics_reflective = False; cy.caustics_refractive = False; cy.sample_clamp_indirect = 10
cy.use_denoising = True
try: cy.denoiser = 'OPENIMAGEDENOISE'; cy.denoising_input_passes = 'RGB_ALBEDO_NORMAL'
except Exception: pass
vs = scene.view_settings
try: vs.view_transform = os.environ.get('PANO_VIEW', 'AgX'); vs.look = os.environ.get('PANO_LOOK', 'AgX - Medium High Contrast')   # PANO_VIEW=Standard PANO_LOOK=None : image brute, pour mesurer
except Exception as ex: log('rendu de vue :', ex)
vs.exposure = EXP
# balance des blancs : le ciel et la végétation teintent la pièce, comme un appareil photo on la neutralise
try:
    vs.use_white_balance = True
    vs.white_balance_temperature = float(os.environ.get('PANO_WB', '5900')); vs.white_balance_tint = float(os.environ.get('PANO_TINT', '12'))
except Exception as ex: log('balance des blancs indisponible :', ex)
scene.render.image_settings.file_format = 'JPEG'; scene.render.image_settings.quality = 93
if BATCH:
    dg = bpy.context.evaluated_depsgraph_get()
    def hit(o, d, far):
        ok, loc, nrm, idx, ob, mat = scene.ray_cast(dg, Vector(o), Vector(d), distance=far)
        return (loc, ob) if ok else None
    def in_poly(x, z, P):
        c = False; j = len(P) - 1
        for i in range(len(P)):
            xi, zi = P[i]; xj, zj = P[j]
            if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi) + xi: c = not c
            j = i
        return c
    def d_edge(x, z, P):
        m = 1e9; j = len(P) - 1
        for i in range(len(P)):
            ax, az = P[j]; bx, bz = P[i]; dx, dz = bx - ax, bz - az
            t = max(0, min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)))
            m = min(m, math.hypot(x - ax - t * dx, z - az - t * dz)); j = i
        return m
    man = []
    for v in SPEC:          # plafonnier allumé dans les pièces sans fenêtre ("lamp" : puissance en watts)
        if not v.get('lamp') or 'poly' not in v: continue
        xs = [q[0] for q in v['poly']]; zs = [q[1] for q in v['poly']]; cx = (min(xs) + max(xs)) / 2; cz = (min(zs) + max(zs)) / 2; fy = v['y'] - 1.6
        h = hit((cx, -cz, fy + 1.9), (0, 0, 1), 3.0); top = h[0].z if h else fy + 2.5
        ld = bpy.data.lights.new('plafonnier', 'AREA'); ld.shape = 'DISK'; ld.size = 0.45; ld.energy = float(v['lamp']) * float(os.environ.get('PANO_LAMP', '1')); ld.color = (1.0, 0.86, 0.70)
        lo = bpy.data.objects.new('plafonnier', ld); scene.collection.objects.link(lo); lo.location = (cx, -cz, top - 0.04)
        try: lo.visible_camera = False
        except Exception: pass
    bpy.context.view_layer.update(); dg = bpy.context.evaluated_depsgraph_get()
    for v in SPEC:
        if v.get('skip'): continue
        picks = []
        if 'pos' in v: picks = [(v['pos'][0], v['pos'][2], v.get('yaw'))]; ey = v['pos'][1]
        else:
            P = v['poly']; ey = v['y']; fy = ey - 1.6; pts = []
            xs = [q[0] for q in P]; zs = [q[1] for q in P]; x = min(xs) + v.get('edge', 0.3)
            while x < max(xs) - v.get('edge', 0.3) + 0.05:
                z = min(zs) + v.get('edge', 0.3)
                while z < max(zs) - v.get('edge', 0.3) + 0.05:
                    if in_poly(x, z, P):
                        de = d_edge(x, z, P)
                        if de >= v.get('edge', 0.3):
                            h = hit((x, -z, fy + 2.05), (0, 0, -1), 2.2)
                            pts.append([x, z, de, bool(h) and h[0].z < fy + 0.12])
                    z += 0.2
                x += 0.2
            free = [q for q in pts if q[3]]; busy = [q for q in pts if not q[3]]
            for q in free: q.append(min([q[2]] + [math.hypot(q[0] - b_[0], q[1] - b_[1]) for b_ in busy]))
            free.sort(key=lambda q: -q[4])
            if not free: log('!! aucune place libre pour', v['id']); continue
            sel = [free[0]]
            if v.get('n', 1) > 1:
                sec = next((q for q in free if math.hypot(q[0] - free[0][0], q[1] - free[0][1]) > 2.6 and q[4] > 0.45), None)
                if sec: sel.append(sec)
            for q in sel:
                far = max(free, key=lambda r: math.hypot(r[0] - q[0], r[1] - q[1]))      # regard vers la plus grande profondeur
                picks.append((q[0], q[1], math.atan2(-(far[0] - q[0]), -(far[1] - q[1]))))
        for i, (x, z, yaw) in enumerate(picks):
            vid = v['id'] + ('-2' if i else '')
            man.append({'id': vid, 'lot': v['lot'], 'name': v['name'] + (' (2)' if i else ''), 'pos': [round(x, 3), round(ey, 3), round(z, 3)], 'yaw': round(yaw or 0.0, 4), 'out': v.get('out', 1)})
    for a_ in man:          # vues en ligne de mire (les vitrages ne comptent pas) : flèches de passage dans la visite
        a_['links'] = []
        for b_ in man:
            if b_ is a_ or b_['lot'] != a_['lot']: continue
            o = Vector((a_['pos'][0], -a_['pos'][2], a_['pos'][1])); e = Vector((b_['pos'][0], -b_['pos'][2], b_['pos'][1])); d = e - o; L = d.length; d.normalize(); seen = True; t = 0.0
            while t < L:
                h = hit(o + d * (t + 0.01), d, L - t - 0.01)
                if not h: break
                mn = h[1].material_slots[0].material.name if h[1].material_slots and h[1].material_slots[0].material else ''
                if not mn.startswith('glass') and not mn.startswith('curtain'): seen = False; break
                t = (h[0] - o).length + 0.02
            if seen: a_['links'].append(b_['id'])
    json.dump(man, open(os.path.join(OUT, 'vues-' + os.path.basename(A[2])), 'w'), ensure_ascii=False, indent=1)
    for m_ in man: log('vue', m_['id'], m_['pos'], 'lacet %.2f' % m_['yaw'], '→', ' '.join(m_['links']))
    VIEWS = [(os.path.join(OUT, m_['id'] + '.jpg'), m_['pos'][0], m_['pos'][1], m_['pos'][2], 0.0, 0.0) for m_ in man]
    if os.environ.get('PANO_DRY') == '1': VIEWS = []
for OUT, X, Y, Z, YAW, PITCH in VIEWS:
    if len(VIEWS) > 1 and os.path.exists(OUT): continue
    co.location = (X, -Z, Y)
    f = Vector((-math.sin(YAW) * math.cos(PITCH), math.cos(YAW) * math.cos(PITCH), math.sin(PITCH)))   # avant maquette (−sin, ·, −cos) → Blender
    if MODE == 'pano':
        cam.type = 'PANO'; cam.panorama_type = 'EQUIRECTANGULAR'
        co.rotation_euler = (math.pi / 2, 0, -YAW)        # centre de l'image = direction du lacet
        scene.render.resolution_x = W; scene.render.resolution_y = W // 2
    else:
        co.rotation_euler = f.to_track_quat('-Z', 'Y').to_euler()
        cam.sensor_width = 36; cam.lens = 18 / math.tan(math.radians(FOV) / 2) * (9 / 16) if False else 18 / math.tan(math.radians(FOV) / 2)
        scene.render.resolution_x = W; scene.render.resolution_y = W * 9 // 16
        cam.sensor_fit = 'VERTICAL'; cam.sensor_height = 36          # FOV vertical, comme la maquette
    if BATCH:           # mesure de lumière : petit rendu brut, puis exposition qui ramène la moyenne au niveau du séjour de référence
        rx, ry, sp = scene.render.resolution_x, scene.render.resolution_y, cy.samples
        scene.render.resolution_x = 256; scene.render.resolution_y = 128; cy.samples = 32; cy.use_denoising = False
        scene.render.image_settings.file_format = 'OPEN_EXR'; tmp = OUT[:-4] + '-mesure.exr'; scene.render.filepath = tmp
        bpy.ops.render.render(write_still=True)
        im = bpy.data.images.load(tmp); px = list(im.pixels); acc = 0.0; wt = 0.0; lin = 0.0
        for j in range(16, 112):                      # hors pôles
            cw = math.cos((j + 0.5 - 64) / 128 * math.pi)
            for i in range(256):
                k = (j * 256 + i) * 4; lum = 0.2126 * px[k] + 0.7152 * px[k + 1] + 0.0722 * px[k + 2]
                acc += cw * math.log(min(max(lum, 1e-4), 4.0)); lin += cw * min(lum, 2.0); wt += cw
        geo = math.exp(acc / wt); avg = (geo * (lin / wt)) ** 0.5; bpy.data.images.remove(im); os.remove(tmp)   # entre moyenne géométrique et arithmétique
        auto = math.log2(METER / avg); vs.exposure = max(EXP - 0.8, min(EXP + 2.4, EXP + DAMP * (auto - EXP)))
        log('mesure', os.path.basename(OUT), 'géo %.4f lin %.4f' % (geo, lin / wt), 'exposition %.2f' % vs.exposure)
        if os.environ.get('PANO_DRY') == 'mesure':
            scene.render.resolution_x = rx; scene.render.resolution_y = ry; cy.samples = sp; cy.use_denoising = True
            scene.render.image_settings.file_format = 'JPEG'; continue
        scene.render.resolution_x = rx; scene.render.resolution_y = ry; cy.samples = sp; cy.use_denoising = True
        scene.render.image_settings.file_format = 'JPEG'; scene.render.image_settings.quality = 93
    scene.render.filepath = OUT
    log('rendu', OUT, scene.render.resolution_x, 'x', scene.render.resolution_y, SPP, 'éch.')
    bpy.ops.render.render(write_still=True)
    log('écrit', OUT)
