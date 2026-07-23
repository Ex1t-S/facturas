# Tablero de tareas

| ID | Tarea | Prioridad | Responsable | Estado | Dependencias | Archivos reservados | Criterio/resultado | Próxima acción |
|---|---|---|---|---|---|---|---|---|
| DOC-001 | Leer prompts y mapear repositorio | P0 | Orquestador | Completada | Ninguna | Sólo lectura | Stack y flujos reales identificados | Mantener documentos |
| REM-001 | Orden mensual de remitos | P0 | Backend/Frontend | Completada | Modelo existente | rutas/servicio remitos, `App.tsx` | Mes, estado, cliente y selección verificables | Prueba con base aislada |
| REM-002 | Cierre a factura en borrador | P0 | Backend | Completada | REM-001 | servicio/ruta remitos | Transacción, validaciones y auditoría | Ensayo de usuario |
| INV-001 | Evitar facturas duplicadas | P0 | Backend | Completada | Quote/Invoice | `src/routes/invoices.ts` | Repetición devuelve borrador existente | Índice futuro tras auditar datos |
| WA-001 | Consolidar borrador conversacional | P0 | Comercial | Completada | Cambios locales previos | assistant/commercial resolver | 20/20 escenarios | Probar webhook controlado |
| WA-002 | Corregir historial bidireccional | P0 | Backend | Completada | Conversaciones WhatsApp | `src/routes/whatsapp.ts` | Menú saliente visible para respuesta numérica | Cola/reintentos |
| ENG-001 | Conectar BOM al orquestador | P1 | Ingeniería | Completada | Motor existente | conversación/estimate/UI | Materiales, compra, cortes y supuestos visibles | Validar con caso FMH |
| ENG-002 | Exponer plano orientativo | P1 | Frontend | Completada | Endpoint SVG existente | `EngineeringPage.tsx` | Botón visible y archivo rotulado | Agregar vista previa futura |
| SEC-001 | Autenticación y autorización | P0 | Seguridad/Backend | Parcial completada | Decisión de acceso | servidor y rutas críticas | Basic Auth en producción y recursos críticos por empresa | Sesiones/roles sólo si habrá multiempresa |
| ARCA-001 | Homologar facturación electrónica | P0 | Fiscal/Backend | Requiere decisión humana | Certificados de homologación | `src/services/arca.ts` | CAE de prueba, nunca producción directa | Autorizar fase de homologación |
| DB-001 | Numeración concurrente | P1 | Base de datos | Completada en servicio | Estrategia por empresa | remitos/presupuestos | Serializable + reintentos y PDF usa número persistido | Prueba de carga PostgreSQL |
| SEC-002 | Auditoría global de autenticación y exposición | P0 | security-auth-agent | Completada | SEC-001 | Sólo lectura | Hallazgos incorporados | Ver `SECURITY_REVIEW.md` |
| DB-002 | Auditoría global Prisma/PostgreSQL | P0 | database-integrity-agent | Completada | DB-001 | Sólo lectura | Migrador inseguro bloqueado; riesgos documentados | Baseline PostgreSQL |
| UX-001 | Auditoría completa frontend y accesibilidad | P1 | frontend-ux-agent | Completada | Ninguna | Sólo lectura | Totales, ARCA preflight, casos, búsquedas y errores mejorados | Modularizar frontend |
| DEP-001 | Corregir vulnerabilidades de dependencias | P0 | Orquestador | Completada | Ninguna | `package.json`, `package-lock.json` | `npm audit --omit=dev`: 0 | Mantener actualización |
| OBS-001 | Endurecer errores, request IDs y CORS | P0 | Orquestador | Completada | SEC-002 | `src/server.ts`, `src/config.ts` | Errores seguros, IDs y allowlist | Agregar métricas |
| DB-003 | Baseline limpio PostgreSQL | P0 | Base de datos | Pendiente | Backup + base vacía | `prisma/migrations` | `migrate deploy` reproducible desde cero | Ejecutar en entorno aislado |
| WA-003 | Cola durable de webhook | P0 | Backend | Pendiente | Diseño de jobs | WhatsApp + Prisma | Reintentos y recuperación tras reinicio | Diseñar lease/dead-letter |
