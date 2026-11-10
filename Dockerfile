# Canopée : site statique (vitrine + maquettes 3D three.js) servi par nginx, pour Coolify.
# Aucune étape de build : le site est déjà prêt dans canopee/ (three.js chargé depuis jsDelivr).
# Le site est servi à la racine du domaine (sur GitHub Pages il vit sous /immo_3d/canopee/ ; tous les chemins sont relatifs).

FROM nginx:1.27-alpine

# configuration nginx (types MIME, compression, cache) à la place de celle par défaut
RUN rm -f /etc/nginx/conf.d/default.conf
COPY deploy/nginx.conf /etc/nginx/conf.d/canopee.conf

# fichiers du site uniquement (voir .dockerignore : ni vidéos, ni dépôt git, ni outils)
COPY --chown=nginx:nginx canopee/ /usr/share/nginx/html/

EXPOSE 80

# Coolify suit l'état du conteneur via ce contrôle
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
