# FMH Gestión

Aplicación para ordenar documentos históricos, presupuestos, remitos, facturas, clientes, inventario de materiales y costos de proveedores para una pyme metalúrgica/agroindustrial argentina.

## Qué Incluye

- Panel operativo con clientes, productos, documentos y presupuestos.
- Sección Documentos con navegación tipo ficheros:
  - Presupuestos
  - Facturas
  - Remitos
  - agrupación por año y cliente
- Vista previa inline de documentos:
  - PDF embebido
  - imágenes embebidas
  - DOCX convertido a HTML
- Generación de presupuestos FMH en DOCX/PDF.
- Inventario orientado a materiales, separando trabajos/servicios del listado principal.
- Asistente IA con búsqueda en datos internos y fuentes.
- Importación de documentos históricos desde carpeta local.
- Base inicial para sincronizar precios públicos de proveedores.

## Stack

- Backend: Fastify + TypeScript
- Frontend: React + Vite
- Base local: Prisma + SQLite
- Documentos: Mammoth, PDFKit, DOCX
- IA: OpenAI Responses API opcional

## Instalación Local

```powershell
npm install
npx prisma generate
npm run build
npm start
```

Abrir:

```text
http://localhost:3000
```

## Desarrollo

Backend:

```powershell
npm run dev:backend
```

Frontend:

```powershell
npm run dev:frontend
```

Validaciones:

```powershell
npm run typecheck
npm test
npm run build
```

## Variables de Entorno

Copiar `.env.example` a `.env` y completar según el ambiente.

Variables principales:

```text
DATABASE_URL
PORT
PUBLIC_BASE_URL
UPLOAD_DIR
HISTORICAL_DOCUMENT_ROOT
OPENAI_API_KEY
OPENAI_MODEL
OPENAI_VECTOR_STORE_ID
SUPPLIER_PUBLIC_SYNC_ENABLED
SUPPLIER_PUBLIC_SYNC_INTERVAL_HOURS
WHATSAPP_VERIFY_TOKEN
WHATSAPP_APP_SECRET
WHATSAPP_ACCESS_TOKEN
WHATSAPP_PHONE_NUMBER_ID
ARCA_ENVIRONMENT
ARCA_CUIT
ARCA_CERT_PATH
ARCA_KEY_PATH
ARCA_POINT_OF_SALE
```

No subir `.env`, bases SQLite, certificados, claves privadas ni documentos reales.

## Documentos Históricos

La app importa documentos desde:

```text
HISTORICAL_DOCUMENT_ROOT
```

Por defecto:

```text
C:\Users\German\Documents\Adalberto
```

Endpoint:

```http
POST /api/documents/import-historical
```

El importador saltea duplicados por hash y continúa aunque encuentre archivos corruptos o temporales de Word.

## Proveedores y Precios

La app tiene una primera integración de fuentes públicas:

- Sidercon: scraping público de perfiles con precios visibles.
- Chapaferro: scraping público de productos con precios visibles.
- Codimat: catálogo/contacto, no se usan precios públicos en cero como costo real.
- Rattini: proveedor por cotización manual, sin precios públicos.

La sincronización automática se controla con:

```text
SUPPLIER_PUBLIC_SYNC_ENABLED=true
SUPPLIER_PUBLIC_SYNC_INTERVAL_HOURS=4
```

También se puede disparar manualmente desde Inventario o por API:

```http
POST /api/supplier-public-sync
```

Los precios públicos deben tratarse como referencia de costo, no como precio definitivo. Para producción conviene priorizar APIs, CSV o listas autorizadas por proveedor.

## GitHub y Producción

Recomendado crear el repositorio como privado porque el proyecto maneja datos fiscales, documentos y variables sensibles.

```powershell
gh auth login
git init
git branch -M main
git add .
git commit -m "Initial implementation"
gh repo create facturas --private --source . --remote origin
git push -u origin main
```

Antes de producción:

- Usar base administrada, no SQLite local.
- Configurar variables de entorno en el hosting.
- Configurar URL pública para webhooks de WhatsApp.
- Usar certificados ARCA de homologación antes de producción.
- Validar permisos y backups de documentos.

## Render + Neon

Se descargaron herramientas locales para preparar un deploy económico:

- Render CLI: `tools/render/render.exe`
- Neon CLI: `npx neonctl`

Scripts útiles:

```powershell
npm run render:login
npm run render:services
npm run render:blueprint:validate
npm run neon:auth
npm run neon:projects
```

Blueprint inicial:

```text
render.yaml
```

Guía corta:

```text
docs/deploy-render-neon.md
```

Importante: hoy Prisma sigue con `SQLite`, así que antes de usar Neon hay que migrar la aplicación a `PostgreSQL`.
