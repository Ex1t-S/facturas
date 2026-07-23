# Auditoría del repositorio FMH Gestión

Fecha: 2026-07-23

## Objetivo y alcance

FMH Gestión organiza clientes, documentos, presupuestos, remitos, facturas, inventario, WhatsApp y consultas preliminares de ingeniería para una pyme metalúrgica. Esta auditoría priorizó los tres flujos indicados por el usuario:

1. Orden mensual de remitos y preparación del cierre de facturación.
2. Creación conversacional de remitos y presupuestos por WhatsApp.
3. Cómputos preliminares de estructuras, materiales y planos orientativos.

No se accedió a producción, no se emitieron comprobantes ante ARCA y no se modificaron datos reales.

> Actualización de cierre: la segunda ronda implementó autenticación Basic obligatoria en producción, CORS explícito, rate limit, errores seguros, aislamiento por empresa en recursos críticos, documentos privados, medios de WhatsApp validados y numeración serializable. El detalle vigente está en `SECURITY_REVIEW.md`, `ARCHITECTURE.md` e `IMPROVEMENT_ROADMAP.md`.

## Mapa del sistema

| Área | Implementación real | Archivos principales |
|---|---|---|
| Backend | Fastify 5 + TypeScript | `src/server.ts`, `src/routes/` |
| Frontend | React 19 + Vite | `frontend/src/App.tsx`, `frontend/src/features/engineering/EngineeringPage.tsx` |
| Base de datos | Prisma 6 + PostgreSQL; esquema SQLite auxiliar | `prisma/schema.prisma`, `prisma/schema.sqlite.prisma`, `src/db.ts` |
| Documentos | DOCX, PDFKit, conversión opcional con LibreOffice | `src/services/fmh*Document.ts`, `src/services/pdf.ts` |
| WhatsApp | Meta Cloud API, webhook firmado, texto/audio/documentos | `src/routes/whatsapp.ts`, `src/services/whatsapp.ts` |
| IA comercial | OpenAI opcional + resolución local determinística | `src/services/assistant.ts`, `src/services/commercialConversation.ts` |
| Ingeniería | Conversaciones persistentes, herramientas determinísticas, biblioteca y SVG/PDF orientativos | `src/services/engineering/`, `src/domain/engineering/` |
| Facturación | Borradores internos; autorización ARCA deliberadamente deshabilitada | `src/routes/invoices.ts`, `src/services/arca.ts` |
| Despliegue | Docker/Render; Neon previsto | `Dockerfile`, `render.yaml`, `docs/deploy-render-neon.md` |
| Pruebas | Vitest y simulaciones conversacionales | `src/**/*.test.ts`, `scripts/*Simulation.ts` |

## Tabla de flujos críticos

| Flujo | Estado actual | Hallazgo | Riesgo | Mejora aplicada | Prioridad |
|---|---|---|---|---|---|
| Remitos del mes | Implementado | La lista no tenía mes, agrupación práctica ni cierre por cliente | Desorden y omisiones al fin de mes | Filtro mensual/estado, selección por cliente, métricas y revisión | P0 completada |
| Remitos a factura | Implementado | Antes requería pasar manualmente por Presupuestos y Facturas | Doble carga y pérdida de trazabilidad | `POST /api/delivery-notes/close-month` crea presupuesto interno + factura en borrador en una transacción | P0 completada |
| Precios de remitos | Implementado | La vista mostraba “Sin precio” pero no permitía completarlo | El flujo no podía finalizar | Editor de precios y validación positiva antes de consolidar | P0 completada |
| Factura duplicada | Corregido | Repetir `POST /quotes/:id/invoice-draft` generaba duplicados | Facturación duplicada | Reutilización idempotente del borrador existente y actualización de estados | P0 completada |
| Trazabilidad | Corregido | `Quote` y `DeliveryNote` no pasaban a `INVOICED` | Remitos reaparecían como pendientes | Estados sincronizados y `AuditLog` para cierre | P0 completada |
| Menú WhatsApp | Corregido | El historial recuperaba sólo mensajes entrantes y los más antiguos | Una respuesta “1” podía perder el menú | Historial por conversación, ambos sentidos, últimos 20 en orden cronológico | P0 completada |
| Borrador comercial fragmentado | Implementado en cambios locales existentes | Era necesario preservar cliente, ítems, correcciones y cancelación entre mensajes | Documentos incompletos o repetidos | Estado persistente, IDs de línea, selección de clientes, edición y 20 simulaciones | P0 verificada |
| Materiales de ingeniería | Corregido | El motor de BOM existía pero no estaba conectado al orquestador | La respuesta no mostraba el cómputo disponible | Integración con materiales, metros, barras, cortes, peso/costo conocido y supuestos | P1 completada |
| Plano orientativo | Corregido | La función de descarga existía pero no tenía acción visible | Capacidad inaccesible | Botón visible; SVG rotulado como no apto para fabricación y supuestos anotados | P1 completada |
| Autenticación/autorización | Parcial completada | Faltaba una barrera de acceso | Acceso no autorizado a datos y acciones | Basic Auth obligatorio en producción y aislamiento de recursos críticos; roles/sesiones quedan para una futura modalidad multiempresa | P0 mitigada |
| ARCA | Bloqueado deliberadamente | `authorizeInvoiceWithArca` termina con error intencional | No existe facturación electrónica real | Implementar sólo en homologación, con revisión humana y pruebas | Requiere decisión humana |

## Base de datos e integridad

- `DeliveryNote` ya tiene índices por empresa/cliente/estado y por fecha.
- `DeliveryNoteQuote` preserva el origen de cada línea consolidada.
- El cierre nuevo valida empresa, cliente, mes, estado pendiente, moneda única, IDs repetidos y precios positivos.
- El cierre crea presupuesto, factura, estados y auditoría dentro de una sola transacción Prisma.
- La numeración conserva “último número + 1”, pero ahora ocurre en transacciones serializables con reintento ante conflicto. Una secuencia explícita por empresa sigue siendo la evolución ideal después del baseline PostgreSQL.
- `Invoice.quoteId` no es único en el esquema. El servicio evita duplicados de forma idempotente, pero una futura migración puede reforzarlo después de auditar datos existentes.

## Seguridad

Controles existentes:

- Firma `x-hub-signature-256` en webhooks de WhatsApp.
- Lista opcional `WHATSAPP_ALLOWED_FROM`.
- Restricción de rutas de importación a raíces configuradas.
- Helmet, límites de archivo y validación Zod.
- Herramientas de ingeniería determinísticas y planos marcados como preliminares.

Pendiente prioritario: reemplazar Basic Auth por sesiones, usuarios, roles y membresías si el producto va a alojar empresas independientes. En la instalación privada actual, la barrera Basic y el `companyId` obligatorio mitigan la exposición directa.

## Rendimiento y operación

- Las listas principales tienen límites en WhatsApp e ingeniería.
- El cierre mensual trabaja sólo sobre IDs seleccionados y usa transacción.
- `findPendingDraftByToken` recorre hasta 200 conversaciones y parsea JSON; conviene normalizar el token/expiración en columnas indexadas.
- El frontend principal sigue concentrado en `frontend/src/App.tsx`; separar Remitos, Facturas y Documentos reducirá riesgo de regresión.
- Las simulaciones comerciales tardan más por generar documentos y muestran fallback a PDF genérico cuando LibreOffice no está disponible; el comportamiento es recuperable y queda registrado.

## Herramientas y skills

| Herramienta | Problema resuelto | Resultado |
|---|---|---|
| Extracción local de PDF | Lectura de los dos prompts entregados | Completada, sin modificar originales |
| Vitest | Regresión de negocio y conversaciones | 94 aprobadas, 1 omitida |
| TypeScript | Contratos backend/frontend | Sin errores |
| Vite build | Integración del frontend de producción | Build aprobado |
| Simulaciones comerciales | Mensajes fragmentados, edición, preview y cancelación | 20/20 escenarios aprobados |

Se agregaron `@fastify/rate-limit` y una versión corregida de `adm-zip`; la auditoría de dependencias de producción informa 0 vulnerabilidades.

## Riesgos y siguiente orden recomendado

1. Autenticación y autorización por empresa antes de publicar el sistema.
2. Prueba de integración del cierre mensual contra una base aislada con datos sintéticos.
3. Homologación ARCA; nunca activar producción directamente.
4. Reintento seguro para numeraciones concurrentes.
5. Normalizar el estado de borradores WhatsApp y agregar cola/reintentos para respuestas en segundo plano.
6. Validar el cómputo de ingeniería con casos FMH revisados y perfiles asignados explícitamente.
