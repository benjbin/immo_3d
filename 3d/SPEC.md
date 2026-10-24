# Canopée — maquette 3D temps réel : cahier des charges

Objectif : recréer en 3D temps réel, dans le navigateur, le bâtiment des 8 rendus de référence
(`../img/p01-ref.png` … `../img/p08-ref.png`, miniatures 320 px), avec un rendu le plus réaliste possible :
matériaux PBR, soleil de fin d'après-midi, ombres douces, occlusion ambiante, reflets du ciel dans les vitrages,
intérieurs éclairés en lumière chaude, végétation dense.

Stack : Three.js **0.160.0** en modules ES, sans build, chargé par importmap :
```html
<script type="importmap">{"imports":{
  "three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
  "three/addons/":"https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"}}</script>
```
Aucun autre téléchargement : toutes les textures sont **procédurales** (canvas 2D → `THREE.CanvasTexture`),
`colorSpace = THREE.SRGBColorSpace` pour les couleurs, anisotropie 8, `wrapS/wrapT = RepeatWrapping`.
Serveur local : `http://localhost:8760/3d/` (sert le dossier `nouveau-projet`).

## Repère et unités
- Unité : **mètre**. Axe **Y vers le haut**.
- La façade principale (côté rue) regarde **+Z**. Vu depuis la rue, **+X est à droite**.
- Emprise des étages : `x ∈ [-5, 5]` (10 m de large), `z ∈ [-19, 0]` (19 m de profondeur). Sol fini à `y = 0`.
- « Côté gauche » = façade `x = -5` (blanche). « Côté droit » = façade `x = +5` (anthracite). Arrière = `z = -19`.

## Niveaux
| Niveau | y bas | y haut |
|---|---|---|
| RDC (garages) | 0 | 3.0 |
| R+1 | 3.0 | 6.0 |
| R+2 | 6.0 | 9.0 |
| R+3 | 9.0 | 12.0 |
| Toit-terrasse | 12.0 | 13.2 (garde-corps), édicule jusqu'à 14.9 |

Dalles : 0.30 m d'épaisseur, rives blanches visibles.

## Matériaux (clés de l'objet `M`, créé par `materials.js`)
- `renderWhite` : enduit blanc cassé (#efeee9), rugosité 0.9, micro-grain dans la normalMap.
- `cladding` : bardage / panneaux anthracite (#34373b), rugosité 0.6, joints verticaux fins tous les 1.2 m (normalMap + légère variation de teinte).
- `slabWhite` : béton lissé peint blanc des rives de dalles (#f4f3ef), rugosité 0.5.
- `glass` : vitrage de fenêtre, `MeshPhysicalMaterial` sombre réfléchissant (couleur #1d2228, métal 0, rugosité 0.05, `envMapIntensity` 1.2). Opaque, l'effet de profondeur vient de `interiorWarm` posé 25 cm derrière.
- `glassRail` : verre de garde-corps transparent (`transmission` 0.9 ou opacité 0.25, léger teint vert-gris, rugosité 0.05).
- `frameDark` : menuiseries alu noir (#202326), métal 0.6, rugosité 0.35.
- `interiorWarm` : fond d'intérieur, couleur #f3d9a8 avec `emissive` #ffb766 à intensité ~1.2, texture procédurale vague (mur, silhouettes de meubles, plante) pour suggérer la profondeur.
- `woodSoffit` : lames de bois en sous-face des balcons et sur le mur du fond des loggias (#9a6a42).
- `deck` : terrasse en lames de bois (#8a5a3b), lames de 14 cm.
- `garageDoor` : porte sectionnelle anthracite (#2b2e31) avec rainures horizontales tous les 0.5 m (normalMap).
- `doorDark` : porte d'entrée anthracite.
- `paver` : pavés gris clair de l'allée (#b9b8b3), joints.
- `sidewalk` : dalles béton clair (#cfcdc6).
- `asphalt` : enrobé (#5d6064) avec grain.
- `curb` : bordure béton (#bdbbb5).
- `grass` : pelouse (#5f7f3a) avec variation.
- `soil` : terre de massif (#4a3a2a).
- `leafA`, `leafB`, `leafC` : feuillages (verts différents, `alphaTest` 0.5, `side: DoubleSide`, texture de feuille dessinée au canvas), un peu de `transmission` / translucidité simulée si possible.
- `bark` : écorce.
- `planter` : bac de jardinière anthracite.
- `greenRoof` : couvre-sol de toiture végétalisée (mélange vert/ocre/rouille, voir p04 et p08).
- `fabric` : coussins des canapés (lin écru), `metal` : pieds de mobilier.

## Le bâtiment (`building.js`)
Référence principale : p01 (façade rue), p02 (angle avant droit), p03 (survol avant), p08 (vue zénithale), p07 (côté gauche).

### RDC (y 0 → 3.0)
- Socle blanc (`renderWhite`) plus large que les étages : `x ∈ [-5.6, 5.6]`, il avance jusqu'à `z = +0.4`.
- De gauche à droite en façade :
  - mur blanc `x -5.6 → -3.5` avec une petite fenêtre (0.8 × 0.9 m, bas à y = 1.3) éclairée de l'intérieur ;
  - 2 portes de garage sectionnelles `garageDoor`, chacune 2.7 m de large × 2.35 m de haut, séparées d'un trumeau anthracite de 0.15 m (`x -3.35 → -0.65` et `x -0.5 → 2.2`), en retrait de 0.15 m ;
  - porte d'entrée `x 2.35 → 3.45`, hauteur 2.35 m, anthracite avec une bande vitrée verticale étroite et une poignée verticale inox ;
  - jambage blanc à droite `x 3.45 → 5.6`, mais seulement 0.5 m de mur visible avant le retour.
- Linteau blanc continu au-dessus des portes (y 2.4 → 3.0), qui forme un cadre.

### Étages (y 3.0 → 12.0), façade avant (z = 0)
- À gauche, **lame verticale blanche** pleine hauteur du R+1 au toit : deux pilastres blancs `x -5.0 → -4.45` et `x -4.35 → -4.05` (rainure sombre de 0.1 m entre les deux), qui dépassent de 0.25 m en avant.
- **Partie gauche** `x -4.05 → -0.5` : bardage anthracite, une grande baie par étage (2 vantaux), 2.7 m × 2.2 m, bas à y + 0.35, cadre `frameDark` de 6 cm, petite plante d'intérieur visible.
- **Partie droite** `x -0.5 → 5.0` : loggias-balcons. Le mur du fond est en retrait à `z = -1.2`. Il porte des baies coulissantes toute largeur (3 vantaux) avec intérieur chaud, et le plafond de chaque loggia est en `woodSoffit`.
- **Dalles de balcon** blanches épaisses (0.35 m) aux niveaux y = 3.0, 6.0, 9.0, et un **auvent de toit** à y = 12.0 :
  - elles s'étendent de `x = -0.5` à `x = 5.6` (0.6 m au-delà de la façade droite) et de `z = -1.2` à `z = +1.5` ;
  - côté droit, elles **se retournent** sur la façade droite jusqu'à `z = -6` avec une profondeur de 1.4 m (voir p02).
- **Garde-corps** sur chaque balcon : verre `glassRail` de 1.0 m sur toute la rive, profil haut fin `frameDark`.
- **Jardinières** : bacs `planter` de 0.4 × 0.45 m le long du garde-corps. Les plantes y sont posées par `landscape.js` grâce à `userData.planters`.

### Façade droite (x = +5) : anthracite
- Du `z = 0` à `-6` : les retours de balcons décrits ci-dessus, et derrière, le mur du fond des loggias en anthracite avec des baies.
- Du `z = -6` à `-19` : mur plein `cladding`, avec par étage 2 **loggias creusées** (ouvertures de 1.8 m × 2.2 m, profondeur 1.0 m, centrées à z = -10 et z = -15). Dans chacune : fond en bois, baie vitrée, garde-corps vitré et jardinière.
- Une ombre portée d'arbre sur ce mur serait idéale. C'est le rôle du viewer, via les ombres des arbres.

### Façade gauche (x = -5) : blanche (p07)
- Enduit blanc avec **deux bandes verticales anthracite** pleine hauteur (y 3 → 12) :
  - bande 1 : `z -6.4 → -5.2` (1.2 m), pleine ;
  - bande 2 : `z -11.6 → -10.1` (1.5 m), avec par étage un **grand vitrage vertical d'escalier** (1.0 × 2.6 m) au cadre `frameDark` et à l'intérieur chaud.
- **Fenêtres carrées** 0.95 × 1.05 m, cadre `frameDark` saillant de 4 cm, intérieur chaud, bas à y_étage + 0.95. Par étage, centrées à z = -1.6, -3.4, -7.6, -9.0, -13.2, -14.8, -17.4.
- La lame blanche de l'angle avant gauche se lit aussi depuis ce côté.

### Façade arrière (z = -19)
Enduit blanc, 4 fenêtres carrées par étage réparties régulièrement.

### Toit (y = 12.0)
- Acrotère : rive blanche visible en façade de 0.35 m (y 12.0 → 12.35).
- **Garde-corps en verre** de 1.1 m sur tout le périmètre (`glassRail` + main courante fine `frameDark`).
- **Terrasse bois** (`deck`) à l'avant, de `z = -0.3` à `z = -7.5`, sur toute la largeur intérieure. Mobilier simple mais crédible :
  - un canapé 3 places (2.2 m), 2 fauteuils et une table basse au centre-avant ;
  - une table à manger de 2 m et 6 chaises à l'avant droit ;
  - des grands bacs plantés aux angles et le long des rives.
- **Édicule** (escalier et ascenseur), boîte anthracite de 2.4 × 2.6 × 2.7 m (y 12.0 → 14.7) à `x ∈ [-3.0, -0.6]`, `z ∈ [-9.8, -7.2]`. Sa face avant (+Z) est vitrée (porte vitrée et vitrage pleine hauteur), avec un toit plat et un débord de 0.1 m. Une petite dalle grise (pavés) devant.
- **Toiture végétalisée** sur le reste (`z -7.5 → -18.7`) : surface `greenRoof` légèrement bosselée. La végétation dense en touffes est placée par `landscape.js` (zone exposée dans `userData.planters` avec `kind:'greenroof'`).

### Contrat d'interface
```js
// building.js
export function createBuilding(THREE, M) // → THREE.Group nommé "building"
group.userData = {
  levels: [ {key:0,name:"RDC",y0:0,y1:3}, {key:1,name:"R+1",y0:3,y1:6}, {key:2,name:"R+2",y0:6,y1:9},
            {key:3,name:"R+3",y0:9,y1:12}, {key:4,name:"Toit",y0:12,y1:13.2} ],
  planters: [ {x, y, z, w, d, kind} ],  // centre du dessus de la terre, w selon X, d selon Z ; kind ∈ 'balcony'|'loggia'|'roof'|'greenroof'|'indoor'
  bounds: {minX:-5.6, maxX:5.6, minZ:-19, maxZ:1.5, height:14.7}
};
```
Tous les meshes ont `castShadow = receiveShadow = true` (sauf les vitrages de garde-corps : `castShadow = false`). Il faut fusionner ce qui peut l'être (`BufferGeometryUtils.mergeGeometries` par matériau) pour rester sous ~400 draw calls au total.

## Le paysage (`landscape.js` + `materials.js`)
Références : p01 (rue et trottoir devant), p03, p04, p05 et p06 (jardin et bois autour), p07 (massifs côté gauche).
- **Sol** : un grand disque de pelouse de 120 m de rayon, qui s'estompe en sous-bois sombre au loin, sans bord visible.
- **Rue** le long de X : enrobé `z ∈ [+7.5, +15]`, longueur 160 m, avec un léger marquage blanc pointillé au centre. Bordures `curb` de chaque côté.
- **Trottoir** `z ∈ [+4.5, +7.5]` en `sidewalk`, avec des joints tous les 1.5 m.
- **Allée des garages** en pavés `paver` : `x ∈ [-3.5, 2.3]`, `z ∈ [+0.4, +4.5]`. Deux marches devant l'entrée (`x 2.3 → 3.8`).
- **Massifs** : bandes de massifs denses (vivaces, graminées, petits arbustes arrondis, quelques fleurs lavande et blanches) le long des façades latérales et devant le socle, à gauche et à droite de l'allée (p01, p07).
- **Arbres** : 2 jeunes arbres d'alignement sur le trottoir (x = -8 et x = +8, 5–6 m), une dizaine d'arbres caducs de 7–12 m autour et derrière le bâtiment, et un **rideau d'arbres** dense en fond, sur les côtés et à l'arrière, comme dans un parc. Pas d'arbre devant la façade principale.
  - Arbres procéduraux : tronc et branches en tubes effilés (`bark`), houppiers faits de **nombreuses grappes de feuilles en quads** instanciés (`InstancedMesh`, texture de feuille alpha), avec 3 teintes et une variation de taille et de rotation.
  - Les houppiers doivent paraître volumineux et irréguliers, jamais des boules lisses.
- **Plantes de jardinières** (`planters` avec kind 'balcony'/'loggia'/'roof') : plantes tropicales type strelitzia et palmier nain (grandes feuilles allongées), plus des retombantes.
- **Toiture végétalisée** (kind 'greenroof') : couvre-sol dense de touffes basses (graminées, sedums verts, ocre et rouille) et quelques graminées plus hautes, comme sur p04/p08.
- Budget : < 1,5 M triangles au total. Instancier systématiquement.

```js
// materials.js
export function createMaterials(THREE, renderer) // → M (voir liste ci-dessus) ; renderer sert à l'anisotropie max
// landscape.js
export function createLandscape(THREE, M, buildingUserData) // → THREE.Group nommé "landscape"
// expose aussi group.userData.trees = [{x, z, height, radius}] (utile pour le viewer)
```

## Le viewer (`index.html` + `viewer.js`)
- `WebGLRenderer` en antialias, `outputColorSpace` SRGB, `toneMapping = THREE.AgXToneMapping` (ou ACES), exposition ~1.0, `shadowMap` en `PCFSoftShadowMap`, pixelRatio ≤ 2.
- **Ciel** : addon `Sky` (turbidité ~4, rayleigh ~1.5), et environnement généré par PMREM depuis la scène du ciel pour les reflets.
- **Soleil** : `DirectionalLight` chaude (#fff1d6), intensité ~3. Fin d'après-midi : hauteur ~35°, venant de l'avant-gauche (les ombres tombent vers l'arrière-droite, voir p02). Ombre en 4096², avec une caméra d'ombre serrée sur le bâtiment et ses abords, `bias`/`normalBias` réglés pour éviter l'acné.
- Une `HemisphereLight` douce complète l'éclairage.
- **Post-traitement** : `EffectComposer` avec `RenderPass`, puis `GTAOPass` (occlusion ambiante, rayon ~1), puis `OutputPass`. Un léger bloom sur les fenêtres éclairées est optionnel.
- **Navigation** :
  - `OrbitControls` avec amortissement, cible au centre du bâtiment (y ≈ 6) ;
  - `maxPolarAngle` juste sous l'horizon (pas de caméra sous le sol), distances de 8 à 90 m, et une limite de déplacement latéral ;
  - zoom à la molette ou au pincement, rotation au glisser, et déplacement au clic droit ou à deux doigts.
- **8 points de vue** qui reproduisent les rendus, avec transition animée (interpolation douce de la position et de la cible) :
  1. façade rue (p01) ;
  2. angle avant droit (p02) ;
  3. survol avant (p03) ;
  4. trois-quarts aérien gauche (p04) ;
  5. survol côté gauche (p05) ;
  6. survol côté gauche rapproché (p06) ;
  7. façade gauche à hauteur d'homme (p07) ;
  8. zénith (p08).
- **Interface** (style du site : Instrument Serif + Inter, verre dépoli sombre, laiton #d8bd8c) :
  - boutons des 8 points de vue ;
  - rotation automatique ;
  - **sélecteur d'étage** qui met un étage en lumière : un volume translucide laiton autour de l'étage, le reste légèrement atténué ;
  - **curseur d'heure** de 8 h à 20 h qui déplace le soleil et ajuste sa couleur et son intensité ;
  - plein écran ;
  - indicateur de chargement.
- Les **performances** passent avant tout : 60 i/s sur un portable récent. Un réglage « qualité » baisse l'AO et la taille des ombres si le framerate chute.

---
## Révision 2 (après la première passe)
**Largeur ×1.2** : comparées aux références, les façades avant et arrière sont trop étroites. Toutes les coordonnées **X** du bâtiment et des abords proches sont multipliées par **1.2** ; les hauteurs (Y) et les profondeurs (Z) ne changent pas.
- Emprise des étages : `x ∈ [-6, 6]` (12 m). Socle RDC : `x ∈ [-6.72, 6.72]`.
- Portes de garage, porte d'entrée, lame blanche, baies, loggias, retours de dalles, édicule, mobilier, fenêtres de façade arrière : positions X × 1.2. Les ouvertures s'élargissent dans la même proportion (les portes de garage deviennent plus larges, comme sur p01). Les fenêtres carrées des façades latérales gardent leur taille.
- Allée pavée `x ∈ [-4.2, 2.76]`, marches `x 2.76 → 4.56`, arbres d'alignement à `x = ±9.6`.
- `bounds`, `planters` et `levels` restent exposés par `building.js`. Le paysage doit **lire `bounds`** plutôt que de recopier des valeurs en dur.

---
## Révision 3 — Configurateur : lots, étages en coupe, joystick
Objectif utilisateur : « comme le site Kreaction (se déplacer au joystick, voir les lots et les étages) mais mille fois mieux ».
Référence Kreaction : maquette 360° + boutons d'étage + liste des lots + fiche lot (vue, visite, plan). Nous faisons la même chose **en vraie 3D**, plus loin.

### Données : `3d/lots.json` (source unique, aussi lue par le site)
6 lots (R+1 à R+3, zones A côté rue / B côté jardin), polygones de zones en plan (x, z) en mètres dans le repère du bâtiment
(emprise étage x ∈ [-6, 6], z ∈ [-19, 0]), statuts disponible / réservé / vendu, prix fictifs. Ne pas modifier sans prévenir.

### Expérience visée
1. **Étages en coupe** : choisir un étage (R+1, R+2, R+3, Toit, ou RDC) → plan de coupe horizontal animé qui descend jusqu'à ~1,2 m au-dessus du sol fini de l'étage (convention des plans d'architecte) : tout le bâtiment au-dessus disparaît (clipping), l'étage choisi apparaît **en plan 3D** : cloisons coupées à hauteur de coupe (aspect « maquette » : tranche de coupe pleine de couleur sombre), portes, sols différenciés (parquet séjour/chambres, carrelage pièces d'eau), mobilier simplifié, noms et surfaces des pièces, contour et couleur de chaque lot selon son statut.
2. **Lots** : surbrillance au survol (contour lumineux + étiquette flottante n° · typo · surface · statut), clic → fiche (données, extérieurs, prix ou « Vendu », pièces, boutons : *Vue depuis le lot*, *Visiter à pied*, *Je suis intéressé·e* → `../index.html#contact?lot=ID`). Depuis l'extérieur (sans coupe), les lots peuvent aussi être mis en évidence en façade (volumes translucides colorés par statut, mode « Disponibilités »).
3. **Navigation joystick** : joystick virtuel à l'écran (souris, tactile, et clavier ZQSD/WASD + flèches), trois modes :
   - *Orbite* (actuel, amélioré) : joystick = tourner/incliner, curseur ou boutons = zoom ;
   - *Drone* : vol libre, joystick gauche = avancer/strafer, glisser (ou joystick droit sur mobile) = regarder, monter/descendre (E/A, boutons) ; altitude bornée, pas sous le sol ni dans le bâtiment ;
   - *Balade* : à pied à 1,65 m, suivi du sol, collisions (façades, cloisons des plans, arbres, garde-corps), vitesse marche/course (Maj) ; entrée dans un lot via *Visiter à pied* (téléportation dans le séjour du lot, étage en coupe actif pour voir le plan autour) ou à pied par le hall.
   Transitions douces entre modes, mini-carte/boussole indiquant la position et l'orientation, retour à l'orbite en un clic.

### Contrats de modules
```js
// 3d/lots.js — plans 3D et volumes de lots (agent « lots »)
export function createLots(THREE, M, buildingUserData, lotsData) // lotsData = contenu de lots.json
// → objet :
{
  group,                         // THREE.Group "lots" à ajouter à la scène
  floors: [{key, name, y0, cutY}],  // cutY = hauteur du plan de coupe pour cet étage (≈ sol fini + 1,2 m)
  setFloor(key | null),          // affiche le plan 3D de l'étage (null = aucun) ; ne gère PAS le clipping du bâtiment
  setMode('none'|'availability'),// 'availability' : volumes translucides de tous les lots par statut, vus de l'extérieur
  setHover(lotId | null), setSelected(lotId | null),
  setFilter(predicate | null),   // atténue les lots non retenus
  pickables,                     // Mesh[] à raycaster ; mesh.userData.lotId
  lot(id) → { ...donnéesJSON, center: Vector3, labelAnchor: Vector3,
              viewpoint: {pos:[x,y,z], tgt:[x,y,z], fov},   // vue depuis le balcon/la loggia du lot
              entry: {pos:[x,y,z], yaw},                    // point d'arrivée de « Visiter à pied » (séjour, 1,65 m au-dessus du sol fini)
              rooms: [{name, surface, poly}] },
  colliders(key) → [{a:[x,z], b:[x,z]}],  // segments de murs/cloisons de l'étage key pour les collisions de la balade
  floorY(key) → y,                // sol fini de l'étage
  update(dt), dispose()
}
// 3d/nav.js — navigation joystick (agent « navigation »)
export function createNavigation({ THREE, camera, controls, domElement, uiRoot, colliders, onChange })
// colliders = { building: segments extérieurs [{a,b}], trees: [{x,z,radius}], groundY: (x,z)=>y, indoor: (x,z,y)=>segments|null }
// → { mode, setMode('orbit'|'drone'|'walk', opts), teleport({pos, yaw, pitch, mode}), update(dt) → bool (true si la caméra a bougé),
//     setEnabled(bool), joystick (élément DOM inséré dans uiRoot), dispose() }
```
Le viewer (agent « viewer ») branche les deux modules, gère le **clipping** (`renderer.localClippingEnabled = true`, plan de coupe appliqué aux matériaux du bâtiment et des intérieurs — pas au paysage, pas aux plans de `lots.js`), le **raycasting** des lots, toute l'**interface** (sélecteur d'étages, liste et filtres des lots, fiche, étiquettes, mini-carte, légende des statuts, bascule des modes de navigation) et les performances (rendu à la demande : `nav.update(dt)` et les animations déclenchent `invalidate()`).
Chaque agent fournit une page de test autonome et code **avec repli** si un autre module manque encore (stub minimal), pour pouvoir travailler en parallèle.
