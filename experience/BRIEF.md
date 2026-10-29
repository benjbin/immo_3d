# « Dans la peau de l'acheteur » — expérience immersive Neokrome

**Pour qui** : les promoteurs immobiliers qui visitent le site Neokrome.
**Ce qu'ils doivent ressentir** : « je suis l'acquéreur, je suis déjà chez moi ». En 60 secondes de défilement, ils vivent le parcours qu'auront leurs clients, puis comprennent que Neokrome leur livre exactement ça.
**Où** : `experience/index.html` (lien principal depuis l'accueil Neokrome), plein écran, sans menu classique.

## Principe technique
- La maquette Canopée (`../canopee/3d/?ui=0&intro=0`) tourne en plein écran dans un iframe de même origine ; la page pilote `iframe.contentWindow.__viewer` (caméra, cible, heure, coupe d'étage, mode visite, lots) **en fonction du défilement** (scrollytelling).
- Le défilement ne fait pas défiler la page visible : il fait avancer une **timeline** (0 → 1). Des chapitres en surimpression (HTML, typographie de la DA Neokrome) apparaissent et disparaissent sur des plages de la timeline. Chaque transition de caméra est interpolée en douceur (spline + amortissement), jamais de saut.
- Molette, trackpad, flèches du clavier, barre d'espace, glisser au doigt : tout fait avancer ou reculer la timeline. Une barre de progression par chapitres (cliquable) permet de sauter à un chapitre.
- Un écran d'accueil (avant chargement complet de la 3D) : « Mettez-vous à la place de vos acquéreurs. » + bouton « Entrer » (le clic débloque aussi le son d'ambiance, optionnel et coupé par défaut).
- `prefers-reduced-motion` : chapitres en fondu, caméra en coupes franches.

## Les chapitres (le promoteur lit à la 2e personne, comme l'acheteur)
| # | Caméra / 3D | Texte |
|---|---|---|
| 1 | Rue, à hauteur d'œil, face à la façade, heure dorée ; léger avancé. | « Vous arrivez devant chez vous. » |
| 2 | Montée le long de la façade jusqu'au balcon du R+2. | « Votre balcon. 31 m² plein sud, au milieu des arbres. » |
| 3 | Vue 3/4 aérienne, la coupe descend au R+2, le lot 201 s'illumine (couleur disponible), les autres s'atténuent. Carte de lot HTML (données de `../canopee/3d/lots.json`). | « Choisissez votre appartement. » |
| 4 | Plongée dans le séjour du 201 (mode visite pleine hauteur), glissé vers la baie. | « Votre séjour. 30,6 m² baignés de lumière. » |
| 5 | Debout sur le balcon, regard vers la vue, l'heure glisse vers le coucher du soleil. | « Le soir, depuis chez vous. » |
| 6 | Extérieur, heure bleue, fenêtres allumées, lent recul. | « Votre future adresse. » |
| 7 | Fondu sur fond nuit Neokrome. | « Voilà ce que vivront vos acquéreurs. » / « Neokrome le construit pour chacun de vos programmes. » Boutons : « Demander une démo » (`../contact.html`), « Explorer librement » (charge la maquette complète avec interface, `../canopee/3d/?lot=201`). |

## Exigences
- DA Neokrome (voir `../assets/styles.css` : bleu nuit #0B214A, bleu électrique #145CFF rare, Outfit ExtraBold capitales, Jost, sections numérotées, facettes). Textes très grands, lisibles sur la 3D (dégradé discret derrière), zones sûres mobiles.
- Fluide à 60 i/s sur ordinateur récent ; qualité « Auto » de la maquette ; sur mobile la même expérience en portrait (cadrages adaptés).
- Accessibilité : les textes des chapitres sont du vrai HTML lisible par les lecteurs d'écran, focus visible, boutons réels, la barre de chapitres est utilisable au clavier.
- Aucune modification de `canopee/3d/` (sauf nécessité absolue, à signaler).
