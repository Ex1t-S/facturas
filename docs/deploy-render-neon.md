# Deploy Render + Neon

Estado actual:

- Render CLI local: `tools/render/render.exe`
- Neon CLI local via `npx neonctl`
- Blueprint inicial: `render.yaml`

Importante:

- Hoy el proyecto sigue usando `SQLite` en Prisma (`provider = "sqlite"`).
- Antes de conectar Neon de verdad hay que migrar Prisma a `PostgreSQL`.
- Sin esa migracion, Render puede correr la app, pero Neon no va a ser la base real.

## Comandos utiles

Render:

```powershell
npm run render:login
npm run render:services
npm run render:blueprint:validate
```

Neon:

```powershell
npm run neon:auth
npm run neon:projects
```

## Flujo recomendado

1. Migrar Prisma de SQLite a PostgreSQL.
2. Crear proyecto Neon.
3. Copiar `DATABASE_URL` de Neon.
4. Crear servicio web en Render usando `render.yaml`.
5. Cargar variables de entorno reales en Render.
6. Probar `/api/health`.
7. Recien despues conectar webhook de Meta y configuracion ARCA.

## Variables que no sirven igual en cloud

- `HISTORICAL_DOCUMENT_ROOT`
  - sirve localmente, no como ruta real en Render
- `UPLOAD_DIR`
  - en free tier queda en filesystem efimero
  - para produccion real conviene storage externo

## Bloqueantes antes de deploy serio

- migracion a Postgres
- estrategia para archivos/documentos
- variables reales de Meta
- variables reales de ARCA
