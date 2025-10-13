#!/usr/bin/env bash
set -euo pipefail

CONF=/valhalla/valhalla.json

# Variables de entorno esperadas (las inyectará ECS en tiempo de ejecución)
OSM_S3_BUCKET="${OSM_S3_BUCKET:-valhalla-data-CHANGE-ME}"   # <-- cambia en ECS
OSM_S3_KEY="${OSM_S3_KEY:-osm/spain-latest.osm.pbf}"        # ruta del .pbf en S3
ELEVATION_S3_PREFIX="${ELEVATION_S3_PREFIX:-elevation/}"    # prefijo de hgt en S3

echo "[valhalla] Iniciando entrypoint..."

# Asegura estructura
mkdir -p /valhalla/osm /valhalla/elevation /valhalla/tiles

# Descarga OSM (solo si no existe localmente)
if [ ! -f "/valhalla/osm/data.osm.pbf" ]; then
  echo "[valhalla] Descargando OSM desde s3://${OSM_S3_BUCKET}/${OSM_S3_KEY}"
  aws s3 cp "s3://${OSM_S3_BUCKET}/${OSM_S3_KEY}" /valhalla/osm/data.osm.pbf
fi

# Sincroniza elevación (si hay en S3 y local está vacío)
if [ -z "$(ls -A /valhalla/elevation 2>/dev/null)" ]; then
  echo "[valhalla] Sincronizando elevación desde s3://${OSM_S3_BUCKET}/${ELEVATION_S3_PREFIX} (si existe)"
  aws s3 sync "s3://${OSM_S3_BUCKET}/${ELEVATION_S3_PREFIX}" /valhalla/elevation || true
fi

# Construye tiles si no existen
if [ -z "$(ls -A /valhalla/tiles 2>/dev/null)" ]; then
  echo "[valhalla] No hay tiles. Construyendo tiles (esto puede tardar en el primer arranque)..."
  valhalla_build_tiles -c $CONF /valhalla/osm/data.osm.pbf

  # Añade elevación si hay datos
  if [ -n "$(ls -A /valhalla/elevation 2>/dev/null)" ]; then
    echo "[valhalla] Añadiendo elevación..."
    valhalla_add_elevation -c $CONF
  else
    echo "[valhalla] (Sin elevación — puedes cargarla más tarde y reconstruir)"
  fi
else
  echo "[valhalla] Tiles existentes — arranque rápido."
fi

echo "[valhalla] Lanzando servicio HTTP en :8002"
exec valhalla_service $CONF 2
