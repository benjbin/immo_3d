# Éclairage calculé par Blender (Cycles) à la résolution d'une texture, pour les grandes surfaces d'un étage :
# ciel et ses rebonds + rebonds du soleil, en couleur (le soleil direct reste en temps réel dans la maquette).
#   Blender -b -P outils/gi/blender_lm.py -- <dossier d'export> <étage> <dossier de sortie> [taille] [échantillons] [échantillons de collecte]
# Entrée : floorK.json + floorK.pos.bin (outils/gi/export.mjs). Sorties : lm-K.png (lumière reçue, codage sRGB),
# lm-K.uv.bin (2 × uint16 par sommet, dans l'ordre des maillages listés), lm-K.json ({ max, ref, list: [{ name, n }] }).
import bpy, sys, json, os, math, time
import numpy as np

A = sys.argv[sys.argv.index('--') + 1:]
SRC, K, OUT = A[0], int(A[1]), A[2]
SIZE = int(A[3]) if len(A) > 3 else 4096
SAMPLES = int(A[4]) if len(A) > 4 else 256
BURIED = float(os.environ.get('LM_BURIED', 0.45))             # occlusion à 5 cm sous laquelle un texel est tenu pour enfoui
GATHER = int(A[5]) if len(A) > 5 else SAMPLES            # échantillons de la collecte finale (0 : sans)
REFPCT, REFK = 85, float(os.environ.get('LM_REFK', 1.15))   # plus contrasté que la lumière par sommet (0,4 / 0,4) : la texture porte les ombres fines
LM = r':(wall|ceil|skirt|tile|parquet|concrete|rug|jute|oak|lacquer|stone|travertine|wood|furn|ceramic)$'
# tissus d'ameublement (canapés, fauteuils, coussins, literie ; pas les voilages, double face) : maillages fins et bosselés qui
# se déplient mal en îlots. Même calcul, mais stocké par sommet (lm-K.vc.bin) au lieu de la texture.
LV = r':(boucle|textile|velvet|wool)$|:model:canopee_(?!salon|terrasse)\w+_(tissu|coussin\w*)$'   # + tissus des modèles sculptés (outils/meubles/sofa.py)
ALBEDO = dict(wall=0.78, ceil=0.82, skirt=0.8, parquet=0.36, tile=0.5, oak=0.4, wood=0.3, stone=0.55, black=0.04, ceramic=0.75, lacquer=0.6,
  steel=0.45, brass=0.4, bark=0.2, leafM=0.15, leafG=0.15, shade=0.7, bulb=0.8, paper=0.7, art=0.4, stoneware=0.5, cloth=0.6, soil=0.05,
  zellige=0.4, mirror=0.1, textile=0.5, rug=0.45, jute=0.45, wool=0.6, boucle=0.65, travertine=0.6, concrete=0.4, furn=0.7,
  renderWhite=0.7, slabWhite=0.7, cladding=0.3, frameDark=0.08, woodSoffit=0.3, deck=0.3, paver=0.4, planter=0.3, greenRoof=0.12,
  metal=0.4, fabric=0.4, asphalt=0.1, garageDoor=0.3, doorDark=0.1)
import re
T0 = time.time()
def log(*a): print('[lm %6.1fs]' % (time.time() - T0), *a, flush=True)

def albedo(e):
    k = e['name'].split(':')[-1].split('#')[0]
    if k in ALBEDO: return ALBEDO[k]
    if e['mat'] in ALBEDO: return ALBEDO[e['mat']]
    if 'model:canopee_' in e['name']: return 0.62
    c = e['col']; l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    return 0.45 if (e.get('tex') or l > 0.98) else min(0.8, max(0.04, l * 0.9))

# teinte des matériaux texturés (linéaire) : la lumière renvoyée par le parquet ou le chêne est chaude
TINT = dict(parquet=(0.52, 0.36, 0.21), oak=(0.55, 0.42, 0.27), wood=(0.46, 0.32, 0.2), jute=(0.5, 0.43, 0.33), rug=(0.5, 0.46, 0.4),
  wool=(0.6, 0.56, 0.5), boucle=(0.6, 0.56, 0.5), bark=(0.3, 0.22, 0.15), soil=(0.2, 0.15, 0.1), leafM=(0.1, 0.2, 0.06), leafG=(0.1, 0.2, 0.06),
  brass=(0.6, 0.45, 0.2), travertine=(0.6, 0.55, 0.47), woodSoffit=(0.46, 0.32, 0.2), cladding=(0.4, 0.3, 0.2), stoneware=(0.55, 0.42, 0.34))
def rgb_of(e):
    a = albedo(e); k = e['name'].split(':')[-1].split('#')[0]; c = e['col']
    l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    t = TINT.get(k) or TINT.get(e['mat']) or (c if (0.02 < l < 0.9 and max(c) - min(c) > 0.04) else (1, 1, 1))
    tl = 0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2]
    return tuple(min(0.95, a * x / max(tl, 1e-3)) for x in t)

SUN_DIR = (-0.740, -0.336, 0.583)      # vers le soleil, repère Blender (maquette : 18 h en été, viewer.js)
SUN_I, SUN_COL, SKY_COL = 2.945, (1.0, 0.768, 0.497), (0.80, 0.88, 1.0)
VMAXV = 2.0   # plafond du codage par sommet (commun aux étages)
K_SKY = float(os.environ.get('LM_SKY', 13.0)); K_SUN = float(os.environ.get('LM_SUN', 5.0))   # calés à l'œil sur la clarté de la maquette

lum = lambda X: 0.2126 * X[:, :, 0] + 0.7152 * X[:, :, 1] + 0.0722 * X[:, :, 2]

def clean(E, cov, good, tag='dn'):
    # texels hors îlots ou enfouis : valeur du voisin visible le plus proche (dilatation), avant le débruitage, pour
    # que les bords d'îlots ne tirent pas vers le noir (filtrage, mipmaps)
    E0 = E.copy(); E[~good] = 0; c = good.copy()
    for _ in range(24):
        if c.all(): break
        cf2 = c.astype(np.float32); acc = np.zeros_like(E); cnt = np.zeros((SIZE, SIZE), dtype=np.float32)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            acc += np.roll(E * cf2[:, :, None], (dy, dx), (0, 1)); cnt += np.roll(cf2, (dy, dx), (0, 1))
        new = (~c) & (cnt > 0); E[new] = acc[new] / cnt[new][:, None]; c |= new
    rest = ~c & cov; E[rest] = E0[rest]; E[~c & ~cov] = E[good].mean(0); del E0
    # débruitage : OpenImageDenoise par le compositeur de Blender
    if os.environ.get('LM_DENOISE', '1') == '1':
        scene = bpy.context.scene
        src = bpy.data.images.new('lmsrc', SIZE, SIZE, alpha=True, float_buffer=True); src.colorspace_settings.name = 'Non-Color'
        buf = np.ones((SIZE, SIZE, 4), dtype=np.float32); buf[:, :, :3] = E; src.pixels.foreach_set(buf.ravel())
        tree = bpy.data.node_groups.new('lmdn', 'CompositorNodeTree'); scene.compositing_node_group = tree
        tree.interface.new_socket(name='Image', in_out='OUTPUT', socket_type='NodeSocketColor')
        ni = tree.nodes.new('CompositorNodeImage'); ni.image = src
        nd = tree.nodes.new('CompositorNodeDenoise'); no = tree.nodes.new('NodeGroupOutput')
        tree.links.new(ni.outputs['Image'], nd.inputs['Image']); tree.links.new(nd.outputs['Image'], no.inputs[0])
        scene.render.resolution_x = SIZE; scene.render.resolution_y = SIZE; scene.render.resolution_percentage = 100
        scene.render.image_settings.file_format = 'OPEN_EXR'; scene.render.image_settings.color_depth = '32'
        scene.view_settings.view_transform = 'Raw'
        scene.render.filepath = os.path.join(OUT, 'lm-%d.%s.exr' % (K, tag))
        bpy.ops.render.render(write_still=True)
        r = bpy.data.images.load(scene.render.filepath); r.colorspace_settings.name = 'Non-Color'
        assert r.size[0] == SIZE and r.size[1] == SIZE
        r.pixels.foreach_get(buf.ravel()); D = buf[:, :, :3]
        log('débruitage : moyenne %.4f → %.4f' % (float(lum(E)[good].mean()), float(lum(D)[good].mean())))
        E = np.maximum(D, 0).copy(); del buf
        os.remove(scene.render.filepath); bpy.data.images.remove(r); bpy.data.images.remove(src)
        scene.compositing_node_group = None; bpy.data.node_groups.remove(tree)
    return E

def finish(A, B, cov, good, uv, index, fabric=None):
    # lumière reçue (hors soleil direct, laissé au temps réel) : ciel et ses rebonds + rebonds du soleil, en unités de la maquette
    E = np.empty_like(A)
    for ch in range(3): E[:, :, ch] = K_SKY * SKY_COL[ch] * A[:, :, ch] + K_SUN * SUN_I * SUN_COL[ch] * B[:, :, ch]
    del A, B
    E = clean(E, cov, good)
    L = lum(E)
    # --- référence : centile de la lumière des murs, plafonds et parquets (sert au repli hors plein jour)
    def sample(u):
        x = np.clip((u[:, 0] * SIZE).astype(int), 0, SIZE - 1); y = np.clip((u[:, 1] * SIZE).astype(int), 0, SIZE - 1)
        return L[y, x]
    ref = []; o = 0
    for e in index:
        if re.search(r':(wall|ceil|parquet)$', e['name']): ref.append(sample(uv[o:o + e['n']].reshape(-1, 3, 2).mean(1)))
        o += e['n']
    refE = float(np.percentile(np.concatenate(ref), REFPCT)) * REFK
    # plafond du codage : 4 × la référence. Au-delà (terrasses à ciel ouvert), la valeur est écrêtée : garder toute la
    # dynamique écrasait les intérieurs sur quelques niveaux de gris (grain visible sur les murs)
    vmax = 4.0 * refE
    X = np.clip(E / vmax, 0, 1)
    X = np.where(X <= 0.0031308, 12.92 * X, 1.055 * np.power(np.maximum(X, 1e-9), 1 / 2.4) - 0.055)   # codage sRGB (décodé par la carte graphique)
    log('référence %.4f, maximum codé %.4f, lumière moyenne %.4f, couverture %.1f %%' % (refE, vmax, float(L[good].mean()), 100 * cov.mean()))

    o8 = bpy.data.images.new('lm8', SIZE, SIZE, alpha=False); o8.colorspace_settings.name = 'Non-Color'
    rgba = np.ones((SIZE, SIZE, 4), dtype=np.float32); rgba[:, :, :3] = X
    o8.pixels.foreach_set(rgba.ravel())
    scene = bpy.context.scene
    scene.view_settings.view_transform = 'Standard'
    scene.render.image_settings.file_format = 'PNG'; scene.render.image_settings.color_mode = 'RGB'; scene.render.image_settings.color_depth = '8'
    o8.filepath_raw = os.path.join(OUT, 'lm-%d.png' % K); o8.file_format = 'PNG'; o8.save()
    (np.clip(uv, 0, 1) * 65535 + 0.5).astype(np.uint16).tofile(os.path.join(OUT, 'lm-%d.uv.bin' % K))
    info = {'v': 3, 'max': vmax, 'ref': refE, 'list': index}
    if fabric:
        # tissus : même lumière par sommet, dans l'ordre des maillages de vlist ; 3 octets, racine de (E / VMAXV)
        Av, Bv, vmap, vindex = fabric
        Ev = np.stack([K_SKY * SKY_COL[c] * Av[:, c] + K_SUN * SUN_I * SUN_COL[c] * Bv[:, c] for c in range(3)], axis=1)[vmap]
        (np.sqrt(np.clip(Ev / VMAXV, 0, 1)) * 255 + 0.5).astype(np.uint8).tofile(os.path.join(OUT, 'lm-%d.vc.bin' % K))
        info['vlist'] = vindex; info['vmax'] = VMAXV
        log('tissus : %d sommets, lumière moyenne %.4f' % (len(Ev), float(Ev.mean())))
    json.dump(info, open(os.path.join(OUT, 'lm-%d.json' % K), 'w'))
    log('écrit', OUT)


def main():
    meta = json.load(open(os.path.join(SRC, 'floor%d.json' % K)))
    pos = np.fromfile(os.path.join(SRC, 'floor%d.pos.bin' % K), dtype=np.float32).reshape(-1, 3)
    pos = np.stack([pos[:, 0], -pos[:, 2], pos[:, 1]], axis=1)   # three (y en haut) → Blender (z en haut)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene

    def material(name, a, img=None):
        m = bpy.data.materials.new(name); m.use_nodes = True
        nt = m.node_tree; nt.nodes.clear()
        out = nt.nodes.new('ShaderNodeOutputMaterial'); d = nt.nodes.new('ShaderNodeBsdfDiffuse')
        if not isinstance(a, tuple): a = (a, a, a)
        d.inputs['Color'].default_value = (a[0], a[1], a[2], 1); nt.links.new(d.outputs[0], out.inputs[0])
        if img is not None:
            # collecte finale : pour les rayons qui touchent la surface (tout sauf le point en cours de calcul), elle émet
            # la lumière déjà estimée (texture « est » × teinte) au lieu de relancer des rebonds ; g = 1 : diffus partout
            if img == 'sommets': te = nt.nodes.new('ShaderNodeVertexColor'); te.layer_name = 'est'
            else: te = nt.nodes.new('ShaderNodeTexImage'); te.image = est; te.interpolation = 'Linear'
            mu = nt.nodes.new('ShaderNodeVectorMath'); mu.operation = 'MULTIPLY'; mu.inputs[1].default_value = (a[0], a[1], a[2])
            em = nt.nodes.new('ShaderNodeEmission'); em.inputs['Strength'].default_value = 1
            lp = nt.nodes.new('ShaderNodeLightPath'); g = nt.nodes.new('ShaderNodeValue'); g.name = 'g'; g.outputs[0].default_value = 1
            mx = nt.nodes.new('ShaderNodeMath'); mx.operation = 'MAXIMUM'; mix = nt.nodes.new('ShaderNodeMixShader')
            ge = nt.nodes.new('ShaderNodeNewGeometry'); fr = nt.nodes.new('ShaderNodeMath'); fr.operation = 'SUBTRACT'; fr.inputs[0].default_value = 1
            nt.links.new(ge.outputs['Backfacing'], fr.inputs[1]); nt.links.new(fr.outputs[0], em.inputs['Strength'])   # vue de dos : n'émet rien
            nt.links.new(te.outputs['Color'], mu.inputs[0]); nt.links.new(mu.outputs[0], em.inputs['Color'])
            nt.links.new(lp.outputs['Is Camera Ray'], mx.inputs[0]); nt.links.new(g.outputs[0], mx.inputs[1])
            nt.links.new(mx.outputs[0], mix.inputs[0]); nt.links.new(em.outputs[0], mix.inputs[1]); nt.links.new(d.outputs[0], mix.inputs[2])
            nt.links.new(mix.outputs[0], out.inputs[0])
            m.cycles.emission_sampling = os.environ.get('LM_EMS', 'NONE')
            for n_ in nt.nodes: n_.select = False
            if img != 'sommets': t = nt.nodes.new('ShaderNodeTexImage'); t.image = img; t.select = True; nt.nodes.active = t
        return m

    def mesh_object(name, co, tris, mats, mat_idx):
        me = bpy.data.meshes.new(name)
        n = len(tris)
        me.vertices.add(len(co)); me.vertices.foreach_set('co', co.astype(np.float32).ravel())
        me.loops.add(n * 3); me.loops.foreach_set('vertex_index', tris.astype(np.int32).ravel())
        me.polygons.add(n); me.polygons.foreach_set('loop_start', np.arange(0, n * 3, 3, dtype=np.int32))
        if hasattr(me.polygons[0], 'loop_total'):
            try: me.polygons.foreach_set('loop_total', np.full(n, 3, dtype=np.int32))
            except Exception: pass
        for m in mats: me.materials.append(m)
        me.polygons.foreach_set('material_index', mat_idx.astype(np.int32))
        me.update(calc_edges=True)
        ob = bpy.data.objects.new(name, me); scene.collection.objects.link(ob)
        return ob

    img = bpy.data.images.new('lm', SIZE, SIZE, alpha=True, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'
    est = bpy.data.images.new('est', SIZE, SIZE, alpha=True, float_buffer=True); est.colorspace_settings.name = 'Non-Color'

    # --- maillages : cibles (soudées, pour un dépliage en grands îlots) et occulteurs (soupe de triangles)
    lm_co, lm_tri, lm_mats, lm_mi, index = [], [], [], [], []
    lv_co, lv_tri, lv_mats, lv_mi, vindex, vmap = [], [], [], [], [], []; vbase = 0
    oc_co, oc_mats, oc_mi = [], [], []
    oc_by_alb = {}
    off = 0; base = 0
    for e in meta['list']:
        n = e['n']; P = pos[off:off + n]; off += n
        if 'interiorWarm' in e['name']: continue          # plans lumineux derrière les vitres : ils boucheraient les baies
        a = rgb_of(e)
        isv = bool(e.get('bake') and e.get('side', 0) == 0 and re.search(LV, e['name']))
        if isv or (e.get('bake') and re.search(LM, e['name'])):
            # soudure des sommets confondus (ordre des faces et des coins conservé = ordre de la soupe)
            q = np.round(P / 2e-4).astype(np.int64)
            _, first, inv = np.unique(q, axis=0, return_index=True, return_inverse=True)
            inv = inv.reshape(-1)
            tri = inv.reshape(-1, 3).copy()
            co = P[first]
            deg = (tri[:, 0] == tri[:, 1]) | (tri[:, 1] == tri[:, 2]) | (tri[:, 0] == tri[:, 2])
            if deg.any():                                   # triangles dégénérés : sommets propres (sinon faces invalides)
                nd = int(deg.sum()); extra = P.reshape(-1, 3, 3)[deg].reshape(-1, 3)
                tri[deg] = (len(co) + np.arange(nd * 3)).reshape(-1, 3); co = np.concatenate([co, extra])
            if isv:
                lv_tri.append(tri + vbase); lv_co.append(co); vmap.append(tri.reshape(-1) + vbase); vbase += len(co)
                lv_mi.append(np.full(len(tri), len(lv_mats))); lv_mats.append(material(e['name'], a, 'sommets'))
                vindex.append({'name': e['name'], 'n': n}); continue
            lm_tri.append(tri + base); lm_co.append(co); base += len(co)
            lm_mi.append(np.full(len(tri), len(lm_mats))); lm_mats.append(material(e['name'], a, img))
            index.append({'name': e['name'], 'n': n})
        else:
            key = tuple(round(x, 2) for x in a)
            if key not in oc_by_alb: oc_by_alb[key] = len(oc_mats); oc_mats.append(material('occ%d' % len(oc_mats), a))
            oc_co.append(P); oc_mi.append(np.full(n // 3, oc_by_alb[key]))

    target = mesh_object('cible', np.concatenate(lm_co), np.concatenate(lm_tri), lm_mats, np.concatenate(lm_mi))
    oco = np.concatenate(oc_co)
    occl = mesh_object('occulteurs', oco, np.arange(len(oco)).reshape(-1, 3), oc_mats, np.concatenate(oc_mi))
    nT = len(target.data.polygons)
    fab = mesh_object('tissus', np.concatenate(lv_co), np.concatenate(lv_tri), lv_mats, np.concatenate(lv_mi)) if lv_co else None
    if fab:
        vmap = np.concatenate(vmap); nV = len(fab.data.vertices)
        for nm in ('est', 'cuit'): fab.data.color_attributes.new(nm, 'FLOAT_COLOR', 'POINT')
        fab.data.color_attributes.active_color = fab.data.color_attributes['cuit']
        ed = np.zeros(len(fab.data.edges) * 2, dtype=np.int32); fab.data.edges.foreach_get('vertices', ed); ed = ed.reshape(-1, 2)
        log('tissus', len(fab.data.polygons), 'triangles,', nV, 'sommets')
    log('cible', nT, 'triangles,', len(target.data.vertices), 'sommets ; occulteurs', len(occl.data.polygons), 'triangles')

    # sol extérieur (albédo 0,45) et ciel uniforme
    bpy.ops.mesh.primitive_plane_add(size=4000, location=(0, 0, -0.02))
    bpy.context.object.data.materials.append(material('sol', 0.45))
    w = bpy.data.worlds.new('ciel'); scene.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (1, 1, 1, 1); w.node_tree.nodes['Background'].inputs[1].default_value = 1

    # --- dépliage
    bpy.ops.object.select_all(action='DESELECT')
    target.select_set(True); bpy.context.view_layer.objects.active = target
    target.data.uv_layers.new(name='lm')
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(50), island_margin=0.0, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    log('dépliage fait')
    try: bpy.ops.uv.select_all(action='SELECT')
    except Exception: pass
    bpy.ops.uv.pack_islands(rotate=True, margin_method='ADD', margin=3.0 / SIZE)
    bpy.ops.object.mode_set(mode='OBJECT')
    assert len(target.data.polygons) == nT and len(target.data.loops) == nT * 3
    uv = np.zeros(nT * 6, dtype=np.float32); target.data.uv_layers['lm'].data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
    log('îlots rangés ; uv', uv.min(0), uv.max(0))

    # --- Cycles
    scene.render.engine = 'CYCLES'
    cy = scene.cycles
    try:
        pr = bpy.context.preferences.addons['cycles'].preferences
        pr.compute_device_type = 'METAL'; pr.get_devices()
        for d in pr.devices: d.use = d.type == 'METAL'
        cy.device = 'GPU'
    except Exception as ex: log('GPU indisponible :', ex)
    cy.samples = SAMPLES; cy.use_adaptive_sampling = False
    cy.max_bounces = 12; cy.diffuse_bounces = 12; cy.caustics_reflective = False; cy.caustics_refractive = False
    cy.sample_clamp_indirect = 0
    try: cy.use_denoising = True; cy.denoiser = 'OPENIMAGEDENOISE'
    except Exception as ex: log('débruitage :', ex)
    scene.render.bake.use_pass_direct = True; scene.render.bake.use_pass_indirect = True; scene.render.bake.use_pass_color = False
    scene.render.bake.margin = 6; scene.render.bake.margin_type = 'EXTEND'; scene.render.bake.use_clear = True
    scene.render.bake.target = 'IMAGE_TEXTURES'
    px = np.zeros(SIZE * SIZE * 4, dtype=np.float32)
    def grab(): img.pixels.foreach_get(px); return px.reshape(SIZE, SIZE, 4)
    def bake(kind):
        # même calcul pour la texture (cibles) puis pour les sommets des tissus
        bpy.ops.object.select_all(action='DESELECT'); target.select_set(True); bpy.context.view_layer.objects.active = target
        scene.render.bake.target = 'IMAGE_TEXTURES'; bpy.ops.object.bake(type=kind)
        I = grab().copy(); V = None
        if fab:
            bpy.ops.object.select_all(action='DESELECT'); fab.select_set(True); bpy.context.view_layer.objects.active = fab
            scene.render.bake.target = 'VERTEX_COLORS'; bpy.ops.object.bake(type=kind)
            V = np.zeros(nV * 4, dtype=np.float32); fab.data.color_attributes['cuit'].data.foreach_get('color', V); V = V.reshape(-1, 4)[:, :3].copy()
        return I, V
    def spread(X, mask=None, it=1):
        # moyenne avec les voisins (arêtes du maillage). mask : sommets à remplir depuis les autres (enfouis)
        X = X.copy()
        if mask is not None:
            ok = ~mask
            for _ in range(40):
                if ok.all(): break
                acc = np.zeros_like(X); cnt = np.zeros(len(X))
                for a_, b_ in ((0, 1), (1, 0)):
                    src = ed[:, a_][ok[ed[:, a_]]]; dst = ed[:, b_][ok[ed[:, a_]]]
                    np.add.at(acc, dst, X[src]); np.add.at(cnt, dst, 1)
                new = ~ok & (cnt > 0); X[new] = acc[new] / cnt[new][:, None]; ok |= new
            return X
        for _ in range(it):
            acc = X.copy(); cnt = np.ones(len(X))
            for a_, b_ in ((0, 1), (1, 0)): np.add.at(acc, ed[:, b_], X[ed[:, a_]]); np.add.at(cnt, ed[:, b_], 1)
            X = acc / cnt[:, None]
        return X
    from mathutils import Vector
    sv = lambda f, X: np.save(os.path.join(OUT, 'lm-%d.%s.npy' % (K, f)), X)
    sd = bpy.data.lights.new('soleil', 'SUN'); sd.energy = 1.0; sd.angle = math.radians(0.6)
    so = bpy.data.objects.new('soleil', sd); scene.collection.objects.link(so)
    so.rotation_euler = Vector(SUN_DIR).to_track_quat('Z', 'Y').to_euler(); so.hide_render = True
    sky = w.node_tree.nodes['Background'].inputs[1]
    log('ciel :', SIZE, 'px,', SAMPLES, 'échantillons…')
    g, A0v = bake('DIFFUSE'); A0 = g[:, :, :3].copy(); cov = g[:, :, 3] > 0.5
    # rebonds du soleil seuls (le soleil direct reste calculé en temps réel par la maquette, avec ses ombres)
    sky.default_value = 0; so.hide_render = False
    scene.render.bake.use_pass_direct = False
    log('rebonds du soleil…')
    g, B0v = bake('DIFFUSE'); B0 = g[:, :, :3].copy()
    sky.default_value = 1; so.hide_render = True
    scene.render.bake.use_pass_direct = True
    # texels enfouis (bout de cloison dans un mur, sol sous un meuble posé…) : occlusion à très courte portée nulle.
    # Cycles les rend noirs ; ils reprennent la valeur de leurs voisins visibles (sinon traits sombres aux raccords).
    scene.world.light_settings.distance = 0.05; cy.samples = 64
    g, aov = bake('AO'); ao = g[:, :, 0].copy()
    buried = cov & (ao < BURIED)
    log('texels enfouis : %.1f %%' % (100 * buried.sum() / max(1, cov.sum())))
    good = cov & ~buried
    vbur = aov[:, 0] < 0.15 if fab else None                                # sommets de tissu enfouis (coussin dans l'assise)
    # --- collecte finale : le premier calcul est juste en moyenne mais bruité loin des baies (la lumière y arrive par
    # des chemins rares). Chaque point recollecte donc la lumière de ce qu'il voit : le ciel, et les surfaces qui renvoient
    # la lumière du premier calcul (débruité). Le bruit se moyenne sur tout l'hémisphère, les ombres de contact restent nettes.
    A, B, Av, Bv = A0, B0, A0v, B0v
    if GATHER > 0:
        buf = np.ones((SIZE, SIZE, 4), dtype=np.float32)
        mats = list(target.data.materials) + (list(fab.data.materials) if fab else [])
        def gather(X, Xv, what):
            buf[:, :, :3] = X; est.pixels.foreach_set(buf.ravel()); est.update()
            if fab:
                c4 = np.ones((nV, 4), dtype=np.float32); c4[:, :3] = Xv; fab.data.color_attributes['est'].data.foreach_set('color', c4.ravel()); fab.data.update()
            for m in mats: m.node_tree.nodes['g'].outputs[0].default_value = 0
            scene.render.engine = 'CYCLES'; cy.samples = GATHER
            scene.render.bake.use_pass_direct = True; scene.render.bake.use_pass_indirect = True
            log('collecte finale (%s) : %d échantillons…' % (what, GATHER))
            g, V = bake('DIFFUSE')
            for m in mats: m.node_tree.nodes['g'].outputs[0].default_value = 1
            return g[:, :, :3].copy(), V
        vest = lambda Xv: spread(spread(Xv, vbur), it=3) if fab else None
        A, Av = gather(clean(A0.copy(), cov, good, 'est'), vest(A0v), 'ciel')
        # rebonds du soleil : même collecte. Les surfaces vues renvoient le soleil qu'elles reçoivent en direct (calculé à
        # part, sans bruit) + les rebonds du premier calcul ; le soleil n'éclaire en direct que les occulteurs (liaison de
        # lumière), pour que le résultat ne contienne pas le soleil direct, laissé au temps réel.
        sky.default_value = 0; so.hide_render = False
        scene.render.bake.use_pass_direct = True; scene.render.bake.use_pass_indirect = False; cy.samples = 256
        g, Sv = bake('DIFFUSE'); S = g[:, :, :3].copy(); S[~cov] = 0
        linked = False
        try:
            rc = bpy.data.collections.new('reçoit le soleil')
            for o in scene.objects:
                if o.type == 'MESH' and o is not target and o is not fab: rc.objects.link(o)
            so.light_linking.receiver_collection = rc; linked = True
        except Exception as ex: log('liaison de lumière indisponible :', ex)
        B, Bv = gather(clean(B0.copy(), cov, good, 'est') + S, (vest(B0v) + Sv) if fab else None, 'soleil')
        if not linked: B = np.maximum(B - S, 0); Bv = np.maximum(Bv - Sv, 0) if fab else None
        sky.default_value = 1; so.hide_render = True; del buf
    log('calcul terminé')
    if fab:                                                                # sommets enfouis repris des voisins, léger lissage
        Av = spread(spread(Av, vbur), it=1); Bv = spread(spread(Bv, vbur), it=1)
        sv('Av', Av.astype(np.float16)); sv('Bv', Bv.astype(np.float16)); sv('vmap', vmap)
    sv('good', good); sv('cov', cov); sv('uv', uv); sv('A', A.astype(np.float16)); sv('B', B.astype(np.float16))
    finish(A, B, cov, good, uv, index, (Av, Bv, vmap, vindex) if fab else None)

if os.environ.get('LM_REUSE') == '1':   # ne refait que le débruitage et la mise à niveau, depuis le dernier calcul
    L = lambda f: np.load(os.path.join(OUT, 'lm-%d.%s.npy' % (K, f)))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    J = json.load(open(os.path.join(OUT, 'lm-%d.json' % K)))
    fabric = (L('Av').astype(np.float32), L('Bv').astype(np.float32), L('vmap'), J['vlist']) if J.get('vlist') else None
    finish(L('A').astype(np.float32), L('B').astype(np.float32), L('cov'), L('good'), L('uv'), J['list'], fabric)
else:
    main()
