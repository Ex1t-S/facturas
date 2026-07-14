# Asistente de Ingeniería FMH

La sección `Ingeniería FMH` agrega una biblioteca técnica incremental, búsqueda de antecedentes y cálculos determinísticos separados del asistente administrativo existente.

## Configuración

```text
ENGINEERING_KNOWLEDGE_ROOT=C:\\ruta\\a\\la\\biblioteca
HISTORICAL_DOCUMENT_ROOT=C:\\ruta\\de\\respaldo
OPENAI_ENGINEERING_MODEL=gpt-5.6-sol
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

## Fase 2: conversaciones y predimensionamiento

La API agrega conversaciones persistentes en `EngineeringConversation` y mensajes en `EngineeringMessage`. La memoria técnica se guarda como JSON estructurado: entradas confirmadas, hipótesis, faltantes, decisiones, cálculos y referencias. El historial local es la fuente de verdad; `previous_response_id` se usa únicamente como continuidad opcional de Responses API.

Variables nuevas:

```text
OPENAI_ENGINEERING_MODEL=gpt-5.6-sol
OPENAI_ENGINEERING_FAST_MODEL=
OPENAI_ENGINEERING_REASONING_EFFORT=high
OPENAI_ENGINEERING_WEB_SEARCH_ENABLED=false
MAX_ENGINEERING_TOOL_ROUNDS=8
```

Rutas principales:

- `GET/POST /api/engineering/conversations`
- `GET /api/engineering/conversations/:id?companyId=...`
- `POST /api/engineering/conversations/:id/messages`
- `PATCH /api/engineering/conversations/:id`
- `POST /api/engineering/conversations/:id/save-case`
- `GET /api/engineering/regulations?companyId=...&q=...`
- `POST /api/engineering/drawing`

El ciclo de herramientas tiene límite configurable y registra cada llamada. Incluye búsqueda FMH, candidatos normativos, carga vertical, carga por apoyo, tensión axial, esbeltez y pandeo de Euler de referencia. Estas funciones son de predimensionamiento y no reemplazan combinaciones de acciones, estabilidad global, uniones, anclajes, fundaciones ni verificación normativa completa.

La pantalla Ingeniería funciona como workspace: conversaciones persistentes, chat multiturno, estado de análisis, guardado como caso y pestaña independiente para la biblioteca. El endpoint de esquema devuelve SVG paramétrico para silo, tolva, galpón o estructura soporte, rotulado como no apto para fabricación.

## Biblioteca de Planos FMH

Configurar `ENGINEERING_DRAWINGS_ROOT` con la carpeta local de PDFs o usar el fallback de `ENGINEERING_KNOWLEDGE_ROOT`. La ingesta local `npm run engineering:drawings -- "C:\\ruta\\de\\planos"` calcula SHA-256, evita duplicados, extrae texto disponible, genera una miniatura PNG con `pdf-parse`, guarda una extracción normalizada y registra la plantilla detectada. No realiza llamadas a OpenAI ni envía los PDF a la API.

La interfaz agrega la pestaña `Planos FMH`, búsqueda, miniaturas, estado de análisis y apertura del PDF original cuando la carpeta está disponible en la misma instalación. La plantilla inicial detectada se guarda como `FMH_TEMPLATE_SCAN`; queda marcada como inferida localmente y requiere revisión humana antes de usarla como formato definitivo.

Rutas nuevas: `GET /api/engineering/drawings`, `GET /api/engineering/drawings/status`, `GET /api/engineering/drawings/:id`, `GET /api/engineering/drawings/:id/thumbnail`, `GET /api/engineering/drawings/:id/file`, `POST /api/engineering/drawings/ingestion/start`, `POST /api/engineering/drawing` y `POST /api/engineering/drawing/pdf`.

## Cómputo de materiales

Cuando la conversación tiene altura libre y alternativas de apoyos, el asistente puede generar un despiece preliminar de patas, diagonales y vigas de vinculación, agrupar líneas, estimar metros lineales, calcular kg cuando existe `kgPerM`, convertir metros a barras comerciales de 12 m y mostrar materiales sin precio. Las secciones solo se consideran candidatas si provienen del inventario o antecedentes; no se inventan propiedades faltantes.

La compra usa las longitudes individuales para optimizar cortes simples, calcula barras completas y valora la cantidad efectivamente comprada. Si falta `kgPerM`, stock lineal o precio verificable, el resultado permanece pendiente en lugar de asumir cero.

## Limitaciones actuales

- La primera extracción estructurada es local y conservadora; imágenes y PDF escaneados quedan en `NEEDS_VISION`.
- DWG, DOC y XLS/XLSX se registran como `UNSUPPORTED` para no inventar contenido.
- La integración incremental con OpenAI Vector Store queda preparada en el modelo, pero la búsqueda local sigue siendo la fuente operativa.
- La agrupación automática de proyectos todavía es básica; la revisión humana queda disponible sobre documentos.
