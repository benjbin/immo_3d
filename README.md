# Canopée

Site du programme immobilier Canopée et sa maquette 3D temps réel.

- `index.html` — redirige vers `canopee/`
- `canopee/` — site du programme Canopée
- `canopee/3d/` — maquette 3D temps réel (configurateur de lots, visite, drone, soleil) ; données des lots dans `canopee/3d/lots.json`
- `3d/` — redirection de l'ancienne adresse de la maquette
- `video/` — scénarios et scripts de génération des films (les MP4 sources ne sont pas versionnés)

Aucune étape de compilation : servir le dossier avec un serveur statique, par exemple `python3 -m http.server 8760`.
