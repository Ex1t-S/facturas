# Hoja de ruta de mejora

## Completado en esta ronda

- orden mensual y cierre de remitos con totales y confirmación;
- factura borrador idempotente y trazabilidad;
- numeración concurrente con transacciones serializables;
- número único de base de datos usado también en el PDF del remito;
- bot comercial con estado conversacional y 20 escenarios aprobados;
- bandeja de WhatsApp por empresa, dirección, estado, adjuntos y reproceso;
- webhook firmado, allowlist obligatoria y medios acotados;
- BOM, compra, cortes, supuestos y plano orientativo de ingeniería;
- casos de ingeniería reales en la pestaña Casos;
- autenticación Basic de producción, CORS, rate limit y errores seguros;
- documentos privados y acotados por empresa;
- frontend y backend incluidos en `npm run typecheck`;
- dependencias de producción sin vulnerabilidades conocidas.

## Próximo bloque P0

1. Crear un baseline limpio de PostgreSQL en una base vacía y archivar las migraciones SQLite históricas.
2. Auditar datos y agregar unicidad de factura por presupuesto/cierre.
3. Implementar una cola durable para el webhook: `QUEUED`, lease, reintentos, dead-letter y reproceso.
4. Agregar backups y prueba de restauración de base + documentos.
5. Ejecutar prueba de integración del cierre mensual contra PostgreSQL aislado.

## P1

1. Usuarios, sesiones, roles y membresías si habrá más de una empresa real.
2. Separar `frontend/src/App.tsx` en módulos de Remitos, Facturas, Documentos y Configuración.
3. Paginación por cursor para documentos, presupuestos, facturas y mensajes.
4. Índices y claves foráneas de empresa después del baseline.
5. Validar herramientas de ingeniería con casos FMH revisados y perfiles estructurales confirmados.
6. Instalar LibreOffice en el runtime si se exige fidelidad exacta de la plantilla DOCX al PDF.

## Bloqueado por decisión humana

- ARCA: requiere certificados de homologación, punto de venta de prueba, definición contable e implementación WSAA/WSFEv1. No activar producción antes de aprobar casos de prueba y recuperación ante respuestas ambiguas.
- Diseño estructural final: requiere responsable técnico, reglamentos aplicables y firma/revisión profesional.
