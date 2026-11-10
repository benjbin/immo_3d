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
