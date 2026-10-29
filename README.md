# Neokrome .tech

Site de Neokrome, maquettes 3D immobilières temps réel, et de sa réalisation Canopée.

- `index.html`, `solutions.html`, `demo.html`, `contact.html` — site Neokrome (styles et scripts dans `assets/`)
- `canopee/` — site du programme Canopée, réalisé par Neokrome
- `canopee/3d/` — maquette 3D temps réel (configurateur de lots, visite, drone, soleil) ; données des lots dans `canopee/3d/lots.json`
- `3d/` — redirection de l'ancienne adresse de la maquette
- `video/` — scénarios et scripts de génération des films (les MP4 sources ne sont pas versionnés)

Aucune étape de compilation : servir le dossier avec un serveur statique, par exemple `python3 -m http.server 8760`.
