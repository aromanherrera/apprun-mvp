# Valhalla on AWS (ECR + CodeBuild + ECS)

Este repo contiene los archivos para construir una imagen de **Valhalla** que:
- En arranque descarga OSM y elevación desde S3
- Construye tiles (solo la primera vez, luego usa EFS)
- Publica el servicio HTTP en `:8002`

## Archivos
- `Dockerfile`: imagen basada en `ghcr.io/valhalla/valhalla`
- `docker-entrypoint.sh`: descarga datos de S3, construye tiles y lanza `valhalla_service`
- `config/valhalla.json`: configuración básica
- `buildspec.yml`: script de **AWS CodeBuild** que construye y sube la imagen a **ECR**

## Flujo recomendado
1. Crea repo **ECR** `valhalla`
2. Crea **CodeBuild** conectado a este repo (GitHub)
3. Ejecuta build → imagen aparece en ECR
4. Despliega en **ECS Fargate** montando **EFS** en `/valhalla`

Variables a inyectar en **ECS** (tarea Valhalla):
- `OSM_S3_BUCKET` (ej. `valhalla-data-miusuario`)
- `OSM_S3_KEY` (ej. `osm/spain-latest.osm.pbf`)
- `ELEVATION_S3_PREFIX` (ej. `elevation/`)
