# Mobilier sculpté dans Blender

`canape.py` sculpte le canapé et le fauteuil capitonnés par simulation de tissu (housse gonflée épinglée aux coutures,
coussins gonflés puis appuyés contre le dossier), calcule leur ombre propre par sommet et écrit un maillage compact
(`<nom>.json` + `<nom>.bin` : positions sur 16 bits, triangles, ombre sur 8 bits) lu par `3d/furniture.js`
(`loadFurnitureAssets`, puis `channelSofa`). Sans ces fichiers, la version générée par code reste en place.

```sh
B=/Applications/Blender.app/Contents/MacOS/Blender
$B -b -P outils/meubles/canape.py -- 3d/assets/meubles 2.2 canape      # canapé (mis à 2,40 m par étirement dans la maquette)
$B -b -P outils/meubles/canape.py -- 3d/assets/meubles 0.86 fauteuil   # fauteuil
```

Un 4ᵉ argument (`rendu.png`) écrit un rendu de contrôle. Mêmes cotes que `channelSofa()`. Après un changement :
incrémenter `MB_V` dans `3d/furniture.js`, puis recalculer la lumière (`outils/gi`, les deux commandes), car le nombre
de sommets des tissus change.

## Canapé et fauteuil contemporains (modèles texturés)

`sofa.py` construit un canapé droit (socle, accoudoirs et dossier rembourrés, coussins d'assise et de dossier souples à
passepoil, coussins décoratifs, pieds métal) : chaque pièce est une housse simulée (pression + tissu), puis l'ensemble
est « photographié » dans trois textures (couleur du bouclé, relief, occlusion/rugosité/métal) et écrit au format du
catalogue de `3d/models.js` (`assets/models/<nom>/<nom>.gltf`). C'est lui qui est affiché en visite ; l'ancien canapé
capitonné ne sert plus que de doublure pendant le chargement.

```sh
$B -b -P outils/meubles/sofa.py -- 3d/assets/models canopee_sofa 2.2                       # canapé (textures 4k)
SOFA_RES=2048 $B -b -P outils/meubles/sofa.py -- 3d/assets/models canopee_fauteuil 0.98    # fauteuil (textures 2k)
```

Un 4ᵉ argument (`rendu.png`) écrit trois rendus de contrôle ; `SOFA_BAKE=0` saute textures et export (mise au point de
la forme). `SOFA_PS` / `SOFA_PB` : gonflage des coussins d'assise / de dossier (0,7 / 0,9 ; au-delà de 1,5 ils
ballonnent). Après un changement : reporter la taille affichée dans `CATALOG` (`3d/models.js`), puis recalculer la
lumière (`outils/gi`, les deux commandes).
