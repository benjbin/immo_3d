# Story v4 — « Art Exposium : la puissance technologique » (30 s, 1080 × 1920, 30 i/s)

**Cible** : promoteurs immobiliers. **Message** : Art Exposium transforme quelques images d'architecte en **jumeau numérique 3D temps réel** — configurateur de vente, visites, disponibilités, et **jusqu'aux films marketing générés automatiquement depuis la 3D**.
**Ton** : démonstration technologique spectaculaire (pensée « keynote produit » / générique tech), précise, rapide, haut de gamme. Chaque plan doit montrer une capacité différente, et le spectateur doit se dire « ils savent tout faire ».
Pas de mention légale, pas de « démonstration ». Charte Art Exposium : noir #141414, bleu #332CFD, crème #FBF9F5, Outfit ExtraBold, Inter, JetBrains Mono (ou équivalent Google Fonts) pour les éléments « HUD » techniques, logos dans `assets/`.

Toutes les images 3D viennent de la maquette temps réel `3d/` (aucun fichier de `3d/` modifié : les effets spéciaux — rendu fil de fer, matériau « blueprint », trajectoires de caméra lumineuses, plan de coupe montant — se font à l'exécution via `window.__viewer` : `scene.overrideMaterial`, ajout d'objets temporaires, `cfg.cut`, etc.).

## Repères de montage (imposés : le son est calé dessus)
Coups forts (« hits ») à : **0,0 · 2,0 · 4,5 · 7,5 · 10,5 · 13,5 · 16,5 · 19,5 · 22,5 · 25,5 · 27,0 s** ; fin à 30,0 s.

| # | Temps | Capacité montrée | Image | Texte (Outfit) / HUD (mono) |
|---|---|---|---|---|
| 0 | 0,0–2,0 | **Accroche** | Écran noir, une ligne bleue trace le contour du bâtiment (fil de fer lumineux qui se dessine), puis le logo Art Exposium en un éclair. | « Et si vos programmes se vendaient *avant d'exister ?* » |
| 1 | 2,0–4,5 | **De l'image à la 3D** | La photo d'architecte `img/p01-ref.png` (agrandie) en plein cadre → elle se transforme en fil de fer 3D exactement aligné (vue 1 de la maquette, même cadrage) → le fil de fer se remplit de matières et de lumière (fondu matériau). | « D'une image… » → « …à un *jumeau numérique.* » ; HUD : `SCAN → MESH → PBR` |
| 2 | 4,5–7,5 | **Construction procédurale** | Vue 3/4 aérienne : le bâtiment « se construit » de bas en haut (plan de coupe qui MONTE de 0 à 15 m, rendu « blueprint » bleu sur fond sombre en dessous de la ligne de construction qui passe en matière réelle), le paysage pousse autour (fondu). | « Modélisé au *centimètre.* » ; HUD : `2,3 M polygones · 60 i/s · navigateur` |
| 3 | 7,5–10,5 | **Lumière physique** | Façade sur rue : time-lapse très rapide du soleil 7 h → 22 h 30 (ombres qui balayent la façade, ciel qui change, fenêtres qui s'allument). | « Le soleil *réel*, à toute heure. » ; HUD : `48,9° N · 21 JUIN · 07:00 → 22:30` qui défile |
| 4 | 10,5–13,5 | **Coupe d'étage + lots** | Plongée sur le bâtiment, plan de coupe qui descend R+3 → R+2, lots colorés par statut, étiquettes, prix. | « Chaque lot, *chaque prix.* » ; HUD : `R+2 · LOT 201 · 485 000 €` |
| 5 | 13,5–16,5 | **Configurateur sur tous les écrans** | Trois appareils en perspective (téléphone, tablette, ordinateur portable en CSS) qui affichent la vraie interface (captures réelles du configurateur à différentes tailles, avec gestes), assemblés en cascade. | « Sur votre site. *Sur tous les écrans.* » |
| 6 | 16,5–19,5 | **Immersion** | Visite à pied dans le séjour vers la baie (plein cadre), puis sortie fluide sur le balcon vers la vue. | « Visitez chez vous *avant le premier coup de pelle.* » |
| 7 | 19,5–22,5 | **Drone libre** | Vol de drone rapide et fluide autour du bâtiment et au-dessus du toit (trajectoire cinématographique en S). | « Vol libre, *en temps réel.* » |
| 8 | 22,5–25,5 | **Films générés depuis la 3D** | Vue aérienne : la **trajectoire de caméra** apparaît comme une courbe lumineuse bleue dans la 3D avec des images-clés (petits repères), une interface de montage stylisée (timeline avec clips) se superpose, puis un « RENDER » rapide : des vignettes de plans du film défilent en mosaïque et convergent en un seul écran 9:16. | « Et vos *films marketing,* générés depuis la 3D. » ; HUD : `RENDER 4K · 600 FRAMES · AUTO` |
| 9 | 25,5–27,0 | **Récap énergie** | Montage ultra-rapide (6–8 plans de 4–6 images) des capacités précédentes, en rythme. | — |
| 10 | 27,0–30,0 | **Signature** | Volet bleu, fond crème, logo Art Exposium qui se construit, « Du plan à la vente. », bouton bleu « Demandez une démo », « artexposium.tech ». | — |

## Exigences
- Qualité image : suréchantillonnage ×2 (2160×3840 → 1080×1920), aucun grain, couleurs riches, net.
- Motion design « keynote » : easing expo/spring, cascades 40–80 ms, masques de texte, parallaxe, flous de profondeur, éléments HUD fins (lignes 1 px, coins de visée, compteurs qui défilent) — élégants, jamais kitsch. Une seule famille de transitions (volet bleu / tracé lumineux), toujours calées sur les repères.
- Zones sûres : 250 px haut / 340 px bas.
- Sortie vidéo : `video/art-exposium-tech-v4.mp4` (muet) — le son est produit séparément (`video/audio/v4.wav`) puis mixé : `video/art-exposium-tech-v4-son.mp4`.
