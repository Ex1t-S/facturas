# Asistente de Ingeniería FMH

La sección `Ingeniería FMH` agrega una biblioteca técnica incremental, búsqueda de antecedentes y cálculos determinísticos separados del asistente administrativo existente.

## Configuración

```text
ENGINEERING_KNOWLEDGE_ROOT=C:\\ruta\\a\\la\\biblioteca
HISTORICAL_DOCUMENT_ROOT=C:\\ruta\\de\\respaldo
OPENAI_ENGINEERING_MODEL=
OPENAI_API_KEY=
```

`ENGINEERING_KNOWLEDGE_ROOT` tiene prioridad y puede quedar vacío para usar `HISTORICAL_DOCUMENT_ROOT`. La API no acepta carpetas fuera de esas raíces configuradas.

## Flujo

`npm run engineering:ingest -- "C:\\ruta\\a\\la\\biblioteca"` descubre PDF, DOCX, TXT, CSV e imágenes, calcula SHA-256, evita reprocesar archivos sin cambios, extrae texto localmente y guarda estados `EXTRACTED`, `NEEDS_VISION`, `UNSUPPORTED` o `FAILED`. Los archivos corruptos no cancelan el lote.

La interfaz permite iniciar una actualización, consultar el estado y revisar documentos. El servicio `searchEngineeringKnowledge` combina texto, metadata, tipo de proyecto, documentos técnicos, proyectos y productos/precios existentes.

## Cálculos

Las conversiones, volúmenes, superficies, masa de chapa, masa lineal y secciones huecas viven en `src/domain/engineering`. Cada cálculo devuelve fórmula, entradas, resultado y unidades. No se presentan perfiles comerciales ni verificaciones normativas que no estén en la biblioteca.

## API

- `POST /api/engineering/chat`
- `GET /api/engineering/knowledge?companyId=...&q=...`
- `GET /api/engineering/knowledge/:id?companyId=...`
- `GET /api/engineering/projects?companyId=...`
- `POST /api/engineering/ingestion/start`
- `GET /api/engineering/ingestion/status?companyId=...`
- `POST /api/engineering/knowledge/:id/review?companyId=...`

Las respuestas distinguen antecedentes históricos, datos faltantes, hipótesis, cálculos y advertencias. Una respuesta no constituye aprobación de fabricación ni reemplaza la revisión profesional.

## Limitaciones actuales

- La primera extracción estructurada es local y conservadora; imágenes y PDF escaneados quedan en `NEEDS_VISION`.
- DWG, DOC y XLS/XLSX se registran como `UNSUPPORTED` para no inventar contenido.
- La integración incremental con OpenAI Vector Store queda preparada en el modelo, pero la búsqueda local sigue siendo la fuente operativa.
- La agrupación automática de proyectos todavía es básica; la revisión humana queda disponible sobre documentos.
