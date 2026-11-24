# Rendus de référence Blender (Cycles)

Ces outils rendent la scène de la maquette par lancer de rayons, en vue simple ou en panorama. Ils servent de
**référence visuelle** pour régler le rendu temps réel (comparer la même vue) : la maquette n'affiche aucune photo,
la visite reste une promenade libre en 3D.

1. Servir la maquette en local (`python3 -m http.server 8080` depuis `canopee/`).
2. Exporter un étage (les deux lots de l'étage sont dans le même export) :
   `node outils/pano/export.mjs /tmp/e2.glb 201`
3. Décrire les vues dans un JSON (`[{id, lot, name, poly | pos, y, n, lamp, skip, edge}]`) : avec `poly` (contour de la
   pièce, tel que `viewer.lots.lot(id).rooms`), l'appareil est posé à l'endroit le plus dégagé ; `lamp` allume un
   plafonnier (watts) dans les pièces sans fenêtre ; `skip` : pièce éclairée mais sans vue.
4. Calculer : `PANO_EXP=2.2 Blender -b -P outils/pano/pano.py -- /tmp/e2.glb /tmp/out 2.json pano 6000 320`
   (≈ 6 min par vue sur GPU Metal ; une image déjà écrite est sautée). L'exposition est mesurée vue par vue.
5. Vue simple pour comparer : `… pano.py -- /tmp/e2.glb ref.jpg <x> <y> <z> <lacet> <tangage> vue 1440 200`.

À refaire quand l'ameublement, les matières ou le bâtiment changent. Lumière figée : 18 h en été.
