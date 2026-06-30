# ArchIA – portal web

Portal estático (HTML/JS, sin build) para subir ficheros, enviarlos a un backend de
agentes que devuelve recomendaciones de seguridad, y generar un entregable a partir
de una plantilla.

## Páginas
- `index.html` — login (contra API o modo demo).
- `dashboard.html` / `dashboard.js` — carga de ficheros (PDF, Word, Excel, etc.),
  lanzamiento del análisis, listado de recomendaciones, generación del entregable.
- `report.html` — plantilla del entregable, imprimible/exportable a PDF desde el navegador.
- `archia.js` — sesión, cliente API, modo demo.

## Modo demo
Sin backend, pulsa "Entrar en modo demo" en el login. Simula el análisis y genera
recomendaciones de ejemplo para probar todo el flujo, incluido el entregable PDF.

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
