# Deploy Render + Neon

Estado actual:

- Render CLI local: `tools/render/render.exe`
- Neon CLI local via `npx neonctl`
- Blueprint inicial: `render.yaml`

Importante:

- El runtime principal usa PostgreSQL.
- El historial de migraciones contiene etapas antiguas de SQLite y todavía no es un baseline reproducible.
- `scripts/migrateSqliteToPostgres.ts` está bloqueado porque borraba el destino y omitía modelos nuevos.
- No ejecutar `prisma migrate deploy` sobre una base real hasta generar y verificar un baseline en una base vacía.

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

1. Crear un backup verificable de cualquier base existente.
2. Generar un baseline PostgreSQL desde `prisma/schema.prisma` en una base vacía.
3. Probar creación, migración y restauración en un entorno aislado.
4. Crear el proyecto Neon y aplicar únicamente el baseline aprobado.
5. Copiar `DATABASE_URL` de Neon.
6. Configurar secretos, Basic Auth, CORS y almacenamiento persistente.
7. Crear el servicio web usando `render.yaml`.
8. Probar `/api/health/live`, `/api/health` y un flujo comercial sintético.
9. Recién después conectar el webhook de Meta.

## Variables que no sirven igual en cloud

- `HISTORICAL_DOCUMENT_ROOT`
  - sirve localmente, no como ruta real en Render
- `UPLOAD_DIR`
  - en el filesystem efímero se pierden documentos al reiniciar o redesplegar;
  - usar disco persistente o almacenamiento de objetos antes de cargar documentación real.

## Bloqueantes antes de deploy serio

- baseline PostgreSQL reproducible
- estrategia persistente para archivos/documentos y prueba de restauración
- `BASIC_AUTH_USERNAME`, contraseña fuerte y `CORS_ORIGINS`
- variables reales de Meta
- cola durable/reintentos para el webhook

ARCA sigue bloqueado y no forma parte del deploy inicial.
