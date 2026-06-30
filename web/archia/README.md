# ArchIA – portal web

Portal estático (HTML/JS, sin build) para subir ficheros, enviarlos a un backend de
agentes que devuelve recomendaciones de seguridad, y generar un entregable a partir
de una plantilla.

## Páginas
- `index.html` — login con contraseña única (`SecurityArchitecture2026!`) y, opcionalmente,
  API Base URL + token de API cuando estén disponibles.
- `dashboard.html` / `dashboard.js` — carga de ficheros (PDF, Word, Excel, etc.),
  lanzamiento del análisis, listado de recomendaciones, generación del entregable.
- `report.html` — plantilla del entregable, imprimible/exportable a PDF desde el navegador.
- `archia.js` — sesión, cliente API, validación de contraseña.

## Acceso
La contraseña del portal es `SecurityArchitecture2026!` (definida en `archia.js`).
Mientras no se configure la API Base URL + token en "Configuración avanzada", el
panel funciona en modo simulado (recomendaciones de ejemplo) para poder probar
todo el flujo, incluido el entregable PDF. En cuanto se proporcione el token de la
API real, introdúcelo en el login para que las llamadas usen el backend de agentes.

## Contrato de API asumido (a confirmar con el backend real)
Configurable en el login como "API Base URL" (se guarda en `localStorage`).

```
POST /auth/login            {email,password} -> {token, user:{name,email}}
POST /projects               {name} -> {project_id}
POST /projects/:id/files     multipart/form-data (file) -> {file_id,name}
POST /projects/:id/analyze   {} -> {job_id}
GET  /jobs/:id                -> {status: queued|running|done|error, progress, recommendations:[...]}
POST /projects/:id/report    {recommendations:[...], summary, template} -> {report_id, download_url}
```

Cada recomendación: `{ id, severity: critica|alta|media|baja, title, description }`.

Todas las peticiones autenticadas envían `Authorization: Bearer <token>`.

## Pendiente cuando exista el backend real
- Ajustar el contrato anterior a los endpoints definitivos.
- Sustituir la generación de PDF en navegador por un endpoint que rellene una
  plantilla Word/PDF corporativa, si se requiere mayor fidelidad de formato.
