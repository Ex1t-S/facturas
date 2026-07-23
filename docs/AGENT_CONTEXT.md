# Contexto operativo de agentes

Actualizado: 2026-07-23

## Producto

FMH Gestión centraliza documentos comerciales, remitos, presupuestos, facturas, inventario, WhatsApp e ingeniería preliminar para FMH. La prioridad actual es que los remitos queden ordenados por mes y cliente, puedan cerrarse en borradores de factura sin duplicación y sean generables por conversación.

## Stack confirmado

- Fastify + TypeScript.
- React + Vite.
- Prisma + PostgreSQL; esquema SQLite auxiliar.
- Vitest.
- Meta WhatsApp Cloud API.
- OpenAI Responses API opcional.
- PDFKit/DOCX y LibreOffice opcional.

## Decisiones

- El cierre mensual crea sólo `PENDING_CONFIRMATION`; ARCA permanece separado.
- Remitos seleccionados se consolidan primero en un `Quote` interno para conservar detalle y origen.
- Un cierre confirmado actualiza presupuesto y remitos a `INVOICED` dentro de la misma transacción.
- Los precios deben ser mayores a cero; no se interpreta cero como precio confirmado.
- El asistente de ingeniería puede usar dimensiones ilustrativas únicamente si las etiqueta como hipótesis.
- Todo plano generado sigue rotulado “NO APTO PARA FABRICACIÓN”.
- Producción exige HTTP Basic; los recursos críticos también requieren `companyId`.
- La numeración comercial usa transacciones serializables y reintentos.
- El migrador SQLite→PostgreSQL está bloqueado hasta crear un baseline seguro.

## Convenciones y comandos

```powershell
npm run typecheck
npm test
npm run build
npm run test:commercial:conversation
npm run test:commercial:stage2
```

## Archivos críticos

- `src/services/deliveryNotes/deliveryNoteService.ts`
- `src/routes/deliveryNotes.ts`
- `src/routes/invoices.ts`
- `src/routes/whatsapp.ts`
- `src/services/assistant.ts`
- `src/services/commercialConversation.ts`
- `src/services/engineering/engineeringConversation.ts`
- `src/services/engineering/engineeringEstimate.ts`
- `frontend/src/App.tsx`
- `frontend/src/features/engineering/EngineeringPage.tsx`
- `prisma/schema.prisma`

## Estado verificado

- Typecheck aprobado.
- Build de producción aprobado.
- 94 tests aprobados y 1 omitido.
- Simulación comercial: 1/1.
- Escenarios comerciales etapa 2: 20/20.
- `npm audit --omit=dev`: 0 vulnerabilidades.
- Smoke HTTP: home 200, liveness 200 y Basic Auth de producción 401/200 verificado.

## Pendientes

- P0: baseline PostgreSQL reproducible y prueba de restauración.
- P0: cola durable y reintentos del webhook.
- P0 externo: ARCA sólo en homologación y con decisión humana.
- P1: prueba de integración transaccional de cierre mensual con base efímera.
- P1: usuarios/roles/membresías si se convierte en servicio multiempresa.
- P1: persistir borradores WhatsApp en columnas consultables.
- P1: asignación humana de secciones estructurales antes de calcular peso/costo definitivo.

## Próxima tarea recomendada

Crear y verificar un baseline PostgreSQL desde cero en un entorno aislado; luego agregar una cola durable para WhatsApp.
