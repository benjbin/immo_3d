# Expérience v2 — vraiment immersive

## Verdict de l'utilisateur sur la v1
« Horrible, pas du tout immersif. » Diagnostic (vu dans un vrai navigateur) :
1. **Diaporama** : des vues fixes et lointaines du bâtiment (cadrage brochure), un titre par-dessus, la caméra ne bouge que si l'on défile, on ne peut pas regarder autour, on ne marche jamais. Les fondus au bleu nuit cassent tout sentiment de présence.
2. **Porte d'entrée** : écran bleu, texte, barre de chargement, bouton « Entrer », et l'écran de chargement de la maquette (« Canopée · 60 % ») qui se superpose au titre.
3. Rien à faire de ses mains : aucune décision, aucune interaction.

## Ce que doit être la v2 (référence : sites primés Awwwards / FWA d'immobilier et de marques 3D)
**La première seconde est déjà dans la 3D.** Pas de bouton « Entrer », pas d'écran d'attente : pendant le chargement (quelques secondes), une image fixe du premier plan exact (capture à l'identique, `poster`) occupe l'écran ; la 3D la remplace en fondu imperceptible quand elle est prête. Le chargement de la maquette (son écran « Canopée · % ») ne doit jamais apparaître.

**Présence physique, à la première personne.**
- Caméra à hauteur d'œil (1,65 m) dès qu'on est au sol ou dans l'appartement, focale ~ 28–35 mm équivalent (FOV 55–65°), jamais de plan large « brochure » sauf la toute fin.
- **La caméra vit** même sans défilement : respiration très lente (amplitude 1–2 cm, 0,2 Hz), micro-dérive.
- **La souris (ou l'inclinaison du téléphone / le glisser au doigt) fait tourner la tête** : ±10° en lacet, ±6° en tangage, avec inertie douce ; revient au cap du plan quand on lâche.
- Le défilement est une **marche / un travelling continu** avec inertie (lissage de la timeline façon Lenis : valeur cible + amortissement), sans paliers.

**Un seul plan-séquence, sans fondu ni coupe** (sauf sortie finale) :
1. Rue : on marche sur le trottoir vers la résidence, les arbres défilent au premier plan (parallaxe naturelle), heure dorée.
2. On lève les yeux, la caméra s'élève lentement le long de la façade (drone doux), jusqu'au balcon du R+2.
3. On s'approche de la baie… et **on la traverse** : le plan de coupe / mode visite bascule pendant le passage du vitrage (au moment exact où la caméra est dans l'épaisseur de la baie), sans fondu, de sorte qu'on se retrouve dans le séjour. (Vérifier qu'aucune image ne montre le bâtiment tranché.)
4. Dans le séjour : on avance doucement, on regarde autour (le mouvement de souris compte vraiment ici), la lumière dorée entre par la baie ; un texte minimal.
5. **Moment d'action** : « Et si c'était l'autre ? » — la caméra ressort par la baie et s'élève en vue aérienne pendant que la coupe descend au R+2 ; le visiteur **touche / clique un des deux lots dans la 3D** (vrai raycast sur `lots.pickables`, survol = surbrillance + étiquette) ; la caméra **plonge dans le lot choisi** (201 → séjour côté rue, 202 → séjour côté jardin). Si personne ne clique après 4 s de défilement, le 201 est choisi automatiquement.
6. Sur le balcon, debout, le garde-corps et la jardinière au premier plan, regard vers la vue ; l'heure glisse vers le coucher, puis l'heure bleue ; les fenêtres des voisins… (au moins les autres fenêtres de la résidence visibles) s'allument.
7. Lent recul en contre-plongée depuis la rue à l'heure bleue, puis seulement alors le message Neokrome : « Voilà ce que vivront vos acquéreurs. » + « Demander une démo » / « Explorer librement ».

**Cinéma.**
- Flou de profondeur (BokehPass ou équivalent, mise au point animée) sur les plans rapprochés (feuillage au premier plan, garde-corps), désactivé en qualité basse.
- Légère aberration chromatique et grain **très** discrets, vignettage doux ; pas de voile bleu sur l'image.
- Titres : 3 à 6 mots maximum, gros, qui apparaissent par masque ligne par ligne au bon moment et s'effacent tout seuls ; jamais de pavé de texte sur la 3D. Indicateur de défilement minimal (une ligne fine + « défiler » qui disparaît après le premier geste).
- **Son** : ambiance synthétisée générée dans le navigateur (WebAudio : vent dans les feuilles = bruit filtré modulé, oiseaux = gazouillis FM aléatoires, rumeur de ville lointaine), qui change d'espace : extérieur → intérieur (filtrage, réverbération courte) → balcon ; activée à la première interaction (clic, touche, toucher), avec un bouton son discret. Pas de musique.

**Technique.**
- Tu peux soit continuer avec l'iframe `../canopee/3d/?ui=0&intro=0` (même origine), soit importer directement les modules de la maquette si c'est nécessaire pour la qualité (post-traitement, raycast) — en ne modifiant `canopee/3d/` que si c'est indispensable (et sans casser la maquette ni le site Canopée ; signale chaque modification).
- 60 i/s visés sur ordinateur récent ; mobile : même parcours en portrait, inclinaison du téléphone = regard (DeviceOrientation, avec repli au doigt), qualité adaptée.
- Accessibilité : textes en vrai HTML, `prefers-reduced-motion` (pas de respiration ni de dérive, transitions plus courtes), commandes au clavier (flèches / espace), lien « Passer l'expérience » vers la fin.
- Écris dans `experience/` (remplace la v1 ; garde-la en `experience/v1/` si utile). La page d'accueil du site Neokrome pourra ensuite l'embarquer en plein écran comme hero : prévois `experience/?embed=1` (sans en-tête propre) si c'est simple.

## Vérification exigée
Captures d'un défilement complet en vidéo image par image (au moins 1 image toutes les 0,5 s de timeline) sur ordinateur 1440×900 et mobile 390×844, **regarde-les** et corrige toute image qui fait « brochure », toute coupure, tout bâtiment tranché, tout texte qui masque l'image. Mesure les ms/image. 0 erreur console. Planche contact dans `/private/tmp/claude-501/-Users-benjaminbinet-Desktop-dossier-sans-titre/6b4f8f3c-2011-4e0a-9799-265a2c10864a/scratchpad/xp2-shots/`.
