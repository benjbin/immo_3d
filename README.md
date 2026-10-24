# Canopée — site et maquette 3D temps réel

Site vitrine d'une résidence et configurateur 3D (Three.js) : coupe par étage, fiches de lots, disponibilités, visite à pied, drone, course du soleil.

- `index.html` — site vitrine
- `3d/` — maquette 3D temps réel (`3d/index.html`), données des lots dans `3d/lots.json`
- `img/` — visuels
- `video/` — scénarios et scripts de génération des films (les MP4 ne sont pas versionnés)

Aucune étape de compilation : servir le dossier avec n'importe quel serveur statique, par exemple :

```bash
python3 -m http.server 8760
```

Lots, surfaces, prix et disponibilités sont des données d'exemple.
