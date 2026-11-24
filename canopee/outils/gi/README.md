# Lumière du ciel précalculée (visite à pied)

Outil maison, sans Blender ni dépendance : Node (≥ 22) + Google Chrome installé.

## Recalculer les trois étages

La maquette doit être servie en local (`http://localhost:8080/3d/`), puis :

```sh
node outils/gi/gi.mjs
```

Cette commande exporte chaque étage depuis Chrome sans interface (configuration « balade »), lance les rayons et écrit
`3d/assets/gi/gi-1.*`, `gi-2.*`, `gi-3.*` (≈ 1 min 30 par étage sur 28 cœurs). Ensuite, incrémenter `GI_V` dans
`3d/viewer.js` (cache des navigateurs). À relancer dès que le mobilier ou les murs changent : un maillage dont le nombre
de sommets ne correspond plus est simplement ignoré par `applyGI` (il garde son occlusion analytique).

Options : `--etages 2,1` · `--url <adresse de la maquette>` · `--sans-export` (reprend le dernier export) ·
`--niveaux` (ne refait que la mise à niveau, instantané) · `--gamma 0.4 --plancher 0.4 --centile 85` (niveaux) ·
`--rayons 192 --rayons-coque 1024 --rebonds 3 --fils N` · `--cache <dossier>` · `CHROME=<chemin>`.

## Méthode

- `export.mjs` : positions monde de tous les maillages opaques de l'étage + enveloppe du bâtiment (vitrages exclus).
- `bvh.mjs` : BVH (SAH par casiers) et parcours ordonné ; `worker.mjs` : fils de calcul (`worker_threads`).
- `trace.mjs` : ciel uniforme (sol extérieur 0,45), albédos approximatifs par matériau (table `ALBEDO`, parquet 0,36).
  Passe 0 : ciel direct ; puis 3 passes de rebonds diffus (chaque rayon lit l'éclairement interpolé de la surface
  touchée), suite des rebonds estimée par série géométrique.
- Robustesse : l'éclairement d'un sommet est la moyenne sur la zone de son triangle proche de lui (rayons partant de
  points répartis, pas du seul sommet) ; les départs enfouis (dans un mur, sous un tapis, derrière un meuble plaqué) sont
  écartés et les points entièrement enfouis reprennent la valeur de leurs voisins : plus de traînées sombres.
  Sommets confondus de même orientation : une seule valeur. Double face (rideaux, linge, feuilles) : face la plus claire.
- Bruit : 3× plus de rayons pour le ciel direct, puis lissage entre voisins limité à l'incertitude mesurée du tirage.
- Niveaux : `f = clamp((E / réf)^gamma, plancher, 1)`, réf = centile 85 des murs, plafonds et parquets ; 1 octet par sommet.

## Éclairage calculé par Blender (les trois étages)

`blender_lm.py` reprend le même export (`floorK.json` + `floorK.pos.bin`) et fait calculer par Cycles, en couleur et à
la résolution d'une texture (4096 px, ≈ 1,5 cm par point), la lumière reçue par les grandes surfaces (murs, plafonds,
sols, plans, meubles en bois ou laqués) : ciel et ses rebonds, puis rebonds du soleil (18 h en été, direction lue dans
la maquette). Le soleil direct reste calculé en temps réel.

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b -P outils/gi/blender_lm.py -- <dossier d'export> 2 <sortie> 4096 4096
cwebp -q 92 <sortie>/lm-2.png -o 3d/assets/gi/lm-2.webp   # + copier lm-2.json et lm-2.uv.bin dans 3d/assets/gi
```

Deux temps : un premier calcul complet (juste en moyenne, mais bruité loin des baies, où la lumière arrive par des
chemins rares), puis une « collecte finale » où chaque point recollecte la lumière de ce qu'il voit, les surfaces
renvoyant le premier calcul débruité. Le bruit se moyenne sur tout l'hémisphère sans flouter les ombres de contact
(6ᵉ argument : échantillons de la collecte, 0 pour s'en passer). Les texels à demi enfouis sous un encadrement ou une
plinthe (occlusion à 5 cm < `LM_BURIED`, 0,45) reprennent la valeur de leurs voisins.

≈ 21 min par étage (M3 Ultra, Metal), puis débruitage OpenImageDenoise par le compositeur de Blender. `LM_REUSE=1` ne
refait que le mélange, le débruitage et le codage (30 s) ; `LM_SKY` et `LM_SUN` règlent la part du ciel et des rebonds
du soleil (13 et 5 par défaut, calés à l’œil).

Les tissus d'ameublement (canapés, fauteuils, coussins, literie) reçoivent le même calcul, mais stocké par sommet
(`lm-K.vc.bin`, 3 octets) : leurs maillages fins et bosselés se déplient mal en îlots de texture.

Côté maquette : `lots.applyLM` + injection dans `walkMat` (lots.js). De jour, la texture remplace tout l'éclairage
diffus temps réel de ces surfaces sauf le soleil direct ; la nuit, elle ne sert plus que de facteur d'ombrage et les
lampes éclairent. Une texture par étage (la partie entière de l'abscisse `cnpLm` la désigne), chargée par `loadLM`
pour les étages de `LM_FLOORS` (viewer.js) : l'étage affiché d'abord, les autres ensuite (à la demande sur écran tactile) ; `?lm=0` la désactive,
`?lm=gris` ne garde que le facteur d'ombrage. Les autres maillages (tissus, plantes, petits objets, modèles scannés)
gardent l'éclairage temps réel et la lumière par sommet.
