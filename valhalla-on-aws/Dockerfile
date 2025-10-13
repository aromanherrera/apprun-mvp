# Imagen oficial de Valhalla como base
FROM ghcr.io/valhalla/valhalla:latest
WORKDIR /valhalla

# Config por defecto (ajustes en config/valhalla.json)
COPY config/valhalla.json /valhalla/valhalla.json

# Script de arranque que descarga OSM/elevación de S3, construye tiles (si faltan) y lanza el servicio
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Directorios persistentes (se montarán desde EFS en ECS)
RUN mkdir -p /valhalla/tiles /valhalla/elevation /valhalla/osm /valhalla/admin /valhalla/timezone

EXPOSE 8002
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
