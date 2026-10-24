# Story v2 — « Art Exposium » présente sa maquette 3D immobilière (20 s, 1080 × 1920, 30 i/s)

Qui parle : **Art Exposium** (artexposium.tech), société tech qui fabrique des maquettes 3D temps réel pour la promotion immobilière.
Ce qu'on vend : la **solution**, pas l'appartement. Canopée n'est que le projet de démonstration.
Cible : promoteurs, commercialisateurs, agences. Message : « vos acheteurs visitent, choisissent et se projettent avant la construction ».

Charte Art Exposium (logo `assets/art-exposium-logo.png`) : noir #141414, bleu électrique #332CFD, fond crème #FBF9F5, typo grotesque grasse
géométrique en capitales (proche du logo : *Outfit* ou *Lexend* ExtraBold en Google Fonts) + texte courant Inter. Le doré « Canopée » disparaît des titres.
Le pictogramme du logo (deux volumes, noir + bleu) sert de motif d'animation : il se « construit » à l'ouverture et à la fin.

| # | Temps | Image | Texte |
|---|---|---|---|
| 0 | 0,0–1,2 s | **Ouverture marque** : fond crème, le pictogramme se construit (le volume noir glisse, le volume bleu se lève), puis « ART EXPOSIUM » apparaît ; coupe nette sur le plan 1. | logo |
| 1 | 1,2–4,0 s | Drone qui s'élève le long de la façade à l'heure dorée (plan 1 actuel, raccourci). | « VOS ACHETEURS VISITENT / **avant la construction.** » (le mot clé en bleu) |
| 2 | 4,0–7,0 s | Coupe d'étage spectaculaire (plan 3 actuel) : le plan descend, le R+2 meublé apparaît, lots colorés. | « ÉTAGE PAR ÉTAGE / **lot par lot** » + petites pastilles « Disponible · Réservé · Vendu » |
| 3 | 7,0–10,5 s | Entrée dans le séjour **refaite proprement** : plus de traversée de plafond visible. Ex. départ dans la loggia/balcon et entrée par la baie ouverte, ou fondu au noir court (≤ 6 images) puis glissé dans le séjour vers la baie. | « VISITE À PIED / **en temps réel** » |
| 4 | 10,5–13,5 s | Heure qui défile 19 h → 22 h 30, fenêtres qui s'allument (plan 5 actuel). | « LA LUMIÈRE, / **heure par heure** » + horloge |
| 5 | 13,5–16,5 s | Survol du toit-terrasse ou vue des disponibilités en façade (volumes colorés) en orbite lente. | « UN CONFIGURATEUR / **qui vend.** » + 3 puces : « Web & mobile · Sans application · Intégré à votre site » |
| 6 | 16,5–20,0 s | **Carte de fin Art Exposium** sur fond crème : pictogramme animé, logo complet net, « Maquettes 3D immobilières temps réel », bouton bleu « Demandez une démo », « artexposium.tech ». Petite mention : « Projet de démonstration · visuels non contractuels ». | — |

Qualité (exigences) :
- **Netteté** : tourner chaque image en 2160 × 3840 puis réduire en 1080 × 1920 (Lanczos) — suréchantillonnage ×2 ; grain quasi nul (le grain actuel coûte du débit et salit les fins détails) ; pas de vignettage lourd.
- **Raccord séjour** corrigé (aucune image où l'on voit la façade tranchée).
- Mouvements : courbes douces, accélérations/décélérations, pas d'à-coups aux changements de plan.
- Titres : animation masquée ligne par ligne, typo grasse Art Exposium, bleu #332CFD sur le mot clé, contraste lisible (léger dégradé sombre derrière si besoin) ; zones sûres 250 px haut / 340 px bas.
- Encodage : H.264 High, yuv420p, CRF 18, profil Instagram (≤ 30 Mo si possible), +faststart, balises bt709 correctes.
