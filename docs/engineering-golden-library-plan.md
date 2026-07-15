# FMH Engineering Golden Library

## Auditoría de continuidad (2026-07-15)

- Repositorio: `C:\Users\Adalberto\facturas`, rama `main`, árbol limpio.
- Último commit auditado: `e9069c9 fix: rank technical engineering precedents first`.
- Ya operativo: orquestador GPT-5.6 Sol, tool calling stateless, memoria técnica, fallback local, búsqueda histórica, ingesta incremental, `EngineeringRegulation`, `StructuralSection` vacío, `EngineeringDrawingDocument` y generación SVG/PDF preliminar.
- Migraciones relevantes existentes: asistente de ingeniería, conversaciones/regulaciones, planos, observabilidad y catálogo estructural. No se recrean esos modelos.

## Arquitectura incorporada en esta fase

1. `EngineeringSource`: registro trazable de fuentes, jurisdicción, edición, hash, licencia, descarga y verificación. Puede ser global (`companyId = null`) o de una compañía.
2. `EngineeringBenchmark`: caso humano estructurado con referencia de páginas, entradas, resultados esperados, tolerancias y estado de revisión.
3. `EngineeringToolValidation`: resultado reproducible de una herramienta contra un benchmark, con versión, errores y alcance.
4. `EngineeringCurationJob`: jobs reanudables para clasificación, extracción, agrupación y análisis visual.
5. `EngineeringSourceImporter`: descarga pública controlada, allowlist de dominios, redirecciones, hashing, deduplicación y registro explícito de restricciones.
6. `EngineeringMethodContext`: contexto de método que separa jurisdicción/norma primaria de referencias internacionales.

## Primera ingesta controlada

El manifiesto versionado está en `config/engineering-sources.json`. Incluye portal INTI-CIRSOC, CIRSOC 301/302, comentarios, ejemplos 301/302, tablas 301-EL/302-EL, resoluciones de vigencia, un ejemplo AISC público y un informe JRC/EU público. Los documentos INTI se marcan para uso interno conforme al aviso del portal; no se redistribuyen automáticamente.

La sincronización es idempotente y no intenta atravesar paywalls, autenticación ni DRM. Las fuentes no descargables quedan registradas como `ACCESS_RESTRICTED` o `DOWNLOAD_FAILED` con el motivo.

## Separación de normas

Las búsquedas y respuestas conservan `jurisdiction`, `standardCode` y `usagePolicy`. CIRSOC es el contexto primario argentino; AISC y Eurocode/JRC son `INTERNATIONAL_REFERENCE` y nunca se promueven a verificación argentina. Una herramienta sólo puede marcarse `VALIDATED_FOR_SCOPE` cuando existe un benchmark verificable.

## Pendientes explícitos

- Revisión humana de benchmarks y proyectos históricos.
- Importación de tablas estructurales sólo cuando se disponga de extracción verificable a nivel de página.
- Visión multimodal/OCR incremental de los planos existentes.
- Confirmación de vigencia jurisdiccional por municipio/provincia para cada obra.
