# Story v3 — Art Exposium (20 s, 1080 × 1920, 30 i/s)

**Problème de la v2** : on voit un bel immeuble, mais on ne comprend pas qu'on vend un **logiciel** : l'interface est masquée (`ui=0`).
**Objectif v3** : en 3 secondes, un promoteur doit comprendre « c'est une maquette 3D interactive, sur mobile et sur mon site, avec laquelle mes acheteurs choisissent leur lot ». On **montre le produit en action** (vraie interface du configurateur, doigt qui touche), dans un habillage motion design haut de gamme.
**Supprimer** toute mention « Projet de démonstration » et « Visuels non contractuels ». Aucune mention de Canopée dans les textes (le nom peut rester visible dans l'interface du produit).

Charte Art Exposium : noir #141414, bleu #332CFD, crème #FBF9F5, Outfit ExtraBold (titres), Inter (texte), logo découpé dans `assets/ax-*.png`.

| # | Temps | Image | Texte |
|---|---|---|---|
| 0 | 0,0–1,6 s | **Ouverture** : fond crème, le pictogramme se construit (noir puis bleu) avec un léger effet de profondeur, le nom se révèle, puis la phrase de positionnement apparaît sous le logo. Sortie par un masque en forme du pictogramme qui s'ouvre sur le plan 1. | « La maquette 3D qui **vend vos programmes sur plan.** » |
| 1 | 1,6–4,0 s | Plan cinéma plein cadre : drone qui monte le long de la façade (heure dorée). | « VOS ACHETEURS / **visitent avant la construction.** » |
| 2 | 4,0–9,5 s | **Démo produit sur téléphone** : un iPhone (maquette dessinée proprement en CSS : bords arrondis, reflet, ombre portée douce) flotte et pivote légèrement en 3D (perspective CSS) devant un fond = le même plan 3D flouté et assombri. Dans l'écran : la **vraie interface mobile** du configurateur (`3d/` avec UI, mise en page mobile) tournée en direct : 1) toucher « Étages » → R+2 ; 2) la coupe descend ; 3) toucher le lot 201 → la fiche monte avec le prix ; un **indicateur de toucher** (cercle bleu qui pulse) montre chaque geste. Un sous-titre change à chaque geste. | « Choisir un étage » → « Toucher un lot » → « Prix, plan, surfaces : **en un geste** » |
| 3 | 9,5–12,5 s | Retour plein cadre, **visite à pied** dans le séjour vers la baie, avec le **joystick** de l'interface visible en bas (l'interface de balade, épurée). | « VISITE À PIED / **en temps réel** » |
| 4 | 12,5–15,0 s | **Disponibilités** : façade en orbite lente, volumes de lots colorés (discrets mais lisibles), étiquettes de lots visibles (UI), puis l'heure qui passe vers l'heure bleue. | « DISPONIBILITÉS / **à jour, en direct** » |
| 5 | 15,0–17,0 s | **Bénéfices** en cartes animées (3 cartes qui s'empilent en cascade, icônes fines) sur fond flou du bâtiment à l'heure bleue. | « Sur votre site et sur mobile » · « Sans application à télécharger » · « Plus de ventes sur plan » |
| 6 | 17,0–20,0 s | **Carte de fin** : volet bleu puis crème, logo complet qui se construit, phrase « Maquettes 3D immobilières temps réel », bouton bleu « Demandez une démo » qui « respire » doucement, « artexposium.tech ». **Aucune mention légale.** | — |

Exigences « haut de gamme » :
- Motion design soigné : courbes d'accélération travaillées (ease-out expo / spring sans rebond excessif), décalages en cascade entre éléments (40–80 ms), masques qui révèlent le texte, un seul langage de transition cohérent (masque pictogramme ou volet bleu), aucune coupe brutale non motivée, aucun flash blanc.
- Légère parallaxe entre texte et image, mise au point (flou) de fond sur les plans « téléphone » et « bénéfices ».
- Typo : gros contrastes d'échelle, interlignage serré, alignement rigoureux sur une grille (marges 72 px), zones sûres 250 px haut / 340 px bas.
- Netteté : suréchantillonnage ×2 conservé ; l'écran du téléphone tourné à la résolution de son affichage final ×2.
- Encodage H.264 High, CRF 18, bt709, ≤ 30 Mo.
