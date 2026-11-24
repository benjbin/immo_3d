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
