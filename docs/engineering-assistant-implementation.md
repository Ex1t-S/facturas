# Implementación del Asistente de Ingeniería FMH

## Arquitectura detectada

El repositorio usa Fastify, TypeScript, Prisma, React/Vite y una integración opcional con OpenAI. Ya existían `Document`, `DocumentExtraction`, el importador histórico, `businessKnowledge`, inventario, productos, precios de proveedores y un asistente administrativo. El módulo nuevo reutiliza esas capacidades sin convertir `assistant.ts` en un archivo monolítico.

## Decisiones

- Se creó un dominio separado en `src/services/engineering` y `src/domain/engineering`.
- La biblioteca técnica guarda hash, ruta relativa, estado, extracción, confianza, versión del extractor y revisiones humanas.
- La ingesta es secuencial, incremental, tolerante a errores y segura respecto de las raíces configuradas.
- Los cálculos críticos se ejecutan en TypeScript y devuelven una traza auditable.
- La búsqueda funciona sin API key y sin vector store.
- El modelo Prisma PostgreSQL y el esquema SQLite se mantienen con modelos equivalentes.

## Archivos principales

- `src/services/engineering/engineeringIngestion.ts`
- `src/services/engineering/engineeringKnowledge.ts`
- `src/services/engineering/engineeringAssistant.ts`
- `src/services/engineering/engineeringSchemas.ts`
- `src/domain/engineering/*.ts`
- `src/routes/engineering.ts`
- `frontend/src/App.tsx` y `frontend/src/styles.css`
- `prisma/migrations/20260715000000_engineering_assistant/migration.sql`

## Ejecución

```powershell
npm install
npx prisma generate
npm run engineering:ingest -- "C:\\ruta\\de\\la\\biblioteca"
npm run dev:backend
npm run dev:frontend
```

Después se abre `Ingeniería FMH`, se actualiza la biblioteca y se prueban consultas como `silo aéreo de 200 toneladas`, `galpón 20 x 40 m` o `tolva 4 x 4, boca inferior 0,5 x 0,5 y alto 3 m`.

## Limitaciones conocidas

La migración del repositorio usa PostgreSQL en producción y su archivo histórico de lock indica SQLite; por eso en Neon debe aplicarse la SQL de la migración con `prisma db execute`, igual que las migraciones operativas anteriores. La extracción de imágenes/PDF escaneados requiere una etapa de visión posterior y los perfiles comerciales deben incorporarse desde catálogos reales.
