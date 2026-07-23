# ADR 0001 — Base segura del MVP estructural y biblioteca técnica trazable

Estado: **Aceptado**  
Fecha: 2026-07-23  
Responsable técnico confirmado: **Ingeniero Civil German Arroyo**  
Identificador profesional: **`03136/5`**

## Contexto

FMH Gestión ya posee una mesa de ingeniería con conversaciones, herramientas deterministas simples, biblioteca documental, planos históricos y generación de esquemas preliminares. El siguiente paso debe incorporar un MVP estructural verificable sin confundir:

1. conversación mediante IA;
2. recuperación de antecedentes;
3. cálculo determinista;
4. validación normativa;
5. plano preliminar;
6. aprobación profesional.

Este ADR registra decisiones confirmadas por el usuario y el estado real de la biblioteca del backend. No autoriza implementar todavía un solver, modificar migraciones, entrenar modelos ni borrar información.

## Decisiones aceptadas

### 1. Normativa base

La base normativa será **CIRSOC Argentina**.

Cada proyecto almacenará como mínimo:

- código y edición;
- jurisdicción;
- estado legal/aplicabilidad;
- fecha de consulta;
- URL o documento oficial;
- alcance de las verificaciones implementadas;
- responsable que confirmó la selección.

La fuente primaria es el catálogo oficial de [INTI-CIRSOC](https://www.inti.gob.ar/areas/serviciosindustriales/construcciones-e-infraestructura/cirsoc/reglamentos). La aplicación no actualizará retrospectivamente análisis históricos cuando aparezca una edición nueva.

### 2. Alcance del primer MVP calculable

El primer flujo determinista abarcará únicamente:

- viga simplemente apoyada;
- voladizo;
- cargas puntuales;
- cargas distribuidas uniformes;
- pórtico plano 2D pequeño;
- apoyos y releases compatibles con el motor inicial;
- análisis lineal estático;
- reacciones, desplazamientos, axial, corte y momento;
- validación de estabilidad y equilibrio dentro de ese alcance.

Losas, fundaciones, diseño completo de hormigón, análisis de cascarones y cálculo estructural detallado de silos quedan fuera de este primer motor.

### 3. Sistema interno de unidades

Las unidades internas del MVP serán:

| Magnitud | Unidad canónica |
|---|---|
| Longitud | `m` |
| Fuerza | `kN` |
| Tensión y módulo elástico | `MPa` |

Las unidades derivadas se documentarán en el ADR del modelo de dominio. Toda entrada y salida declarará su unidad. Las conversiones ocurrirán sólo en los límites; el motor y la persistencia no aceptarán números estructurales ambiguos.

### 4. Motor

Se implementará primero un **motor analítico propio**, pequeño y validado contra soluciones cerradas.

OpenSeesPy u otro solver sólo podrá incorporarse después de:

- estabilizar el modelo canónico;
- aprobar benchmarks y tolerancias;
- implementar aislamiento del worker;
- revisar licencia y redistribución comercial;
- verificar plataformas, convergencia y normalización de resultados.

El modelo FMH será independiente de los IDs, unidades y estructura interna del solver.

### 5. Estado de los planos

Todo plano generado por la plataforma será:

> **PRELIMINAR — NO APTO PARA FABRICACIÓN — REQUIERE REVISIÓN Y APROBACIÓN PROFESIONAL**

La advertencia estará en UI, PDF, SVG, DXF, cajetín y metadatos. No bastará una nota sólo en el chat.

Un plano no podrá pasar a estado revisado si:

- no referencia una versión de modelo;
- el análisis está ausente, fallido u obsoleto;
- existen errores críticos;
- faltan normativa, unidades, hipótesis o responsable;
- no se registró la revisión humana.

### 6. Responsable técnico

La identidad confirmada es:

```json
{
  "name": "German Arroyo",
  "role": "Ingeniero Civil",
  "professionalId": "03136/5"
}
```

`professionalId` se almacenará como **string**, nunca como número, para conservar `/` y cualquier cero o formato institucional.

Esta identidad habilita atribución y revisión, pero no convierte automáticamente un documento en firmado o aprobado. La aprobación seguirá siendo una acción explícita, fechada, versionada y auditable.

### 7. Protección de datos antes de migraciones

Antes de corregir o reemplazar el historial de migraciones se realizará un backup obligatorio de:

- PostgreSQL;
- archivos originales;
- previews y miniaturas;
- plantillas;
- manifiesto con rutas lógicas, tamaños y SHA-256;
- variables de configuración necesarias, sin registrar secretos en documentación.

El backup deberá restaurarse con éxito en un ambiente aislado. No se eliminarán datos comerciales para crear el baseline. Si existe una incompatibilidad, se hará una migración aditiva o una copia transformada y validada.

### 8. Los planos “enseñan” mediante RAG, no fine-tuning

Los planos y documentos FMH se usarán como una **biblioteca recuperable, versionada y citable**.

El flujo será:

```text
archivo original
  → hash + metadatos + extracción
  → chunks con página/zona
  → revisión y nivel de confianza
  → búsqueda léxica/semántica
  → resultados citados en el contexto
  → explicación o propuesta del asistente
  → confirmación humana
```

Esto es RAG: recuperar contenido relevante y añadirlo al contexto antes de generar una respuesta. La guía oficial de OpenAI diferencia RAG —acceso a contexto específico— de fine-tuning —aprender una tarea o conducta—:

- [OpenAI — optimización de precisión y RAG](https://developers.openai.com/api/docs/guides/optimizing-llm-accuracy#retrieval-augmented-generation-rag)
- [OpenAI — retrieval y vector stores](https://developers.openai.com/api/docs/guides/retrieval#vector-stores)

No se hará fine-tuning con planos porque:

- los documentos cambian y deben poder retirarse o versionarse;
- cada respuesta debe citar el origen;
- una corrección humana debe surtir efecto sin reentrenar;
- la procedencia y licencia deben conservarse;
- el contenido técnico no debe quedar incorporado de forma opaca en pesos;
- el fine-tuning no reemplaza el cálculo determinista.

Un vector store es opcional. Primero se estabilizará la búsqueda local híbrida y su evaluación. Subir archivos propietarios a un proveedor externo requiere una decisión separada de privacidad, retención, costos y permisos.

## Evidencia local de la biblioteca

Consulta agregada de sólo lectura realizada el 2026-07-23. No se inspeccionó ni expuso contenido comercial.

### Planos

| Métrica | Resultado |
|---|---:|
| Registros `EngineeringDrawingDocument` | 23 |
| Estado `ANALYZED_LOCAL` | 23 |
| Con texto no vacío | 23 |
| Con texto técnicamente útil | 0 |
| Con ruta de miniatura registrada | 23 |
| Asociados a plantilla | 23 |
| Páginas registradas | 23 |
| Tipo de proyecto clasificado | 0 |
| Cliente/revisión identificados | 0 |
| Originales disponibles por el `sourcePath` persistido | 0 |
| Miniaturas presentes bajo `UPLOAD_DIR` actual | 0 |

Los 23 registros contienen sólo el texto `-- 1 of 1 --` de aproximadamente 16 caracteres y el mismo valor como título. No contienen tipo, cliente ni revisión. Por lo tanto, `ANALYZED_LOCAL` significa que la rutina terminó, no que el plano sea recuperable o esté analizado técnicamente.

Verificación de endpoints sobre ese conjunto:

- metadata: responde;
- apertura del PDF: falla porque el original no existe en la ruta persistida;
- miniatura: responde 404 porque el archivo no existe.

Existe una plantilla:

- código: `FMH_TEMPLATE_SCAN`;
- versión: `detectada localmente`;
- muestras: 23;
- confianza: 0,55;
- marcada como default.

La plantilla y los 23 planos tienen metadata persistida, pero los archivos originales y miniaturas no están disponibles mediante sus rutas actuales. Los endpoints que abren el original requieren una raíz autorizada y que el archivo exista. Antes de cualquier mejora de RAG se deben reconstruir las asociaciones desde una copia autorizada y verificar los hashes.

La carpeta histórica `C:\Users\German\Documents\Adalberto` sí existe y contiene 1.081 archivos, incluidos 530 PDF. Debe tratarse como fuente de recuperación, no reimportarse ciegamente sobre la base.

### Biblioteca de conocimiento

| Métrica | Resultado |
|---|---:|
| `EngineeringKnowledgeDocument` | 992 |
| `EXTRACTED` | 947 |
| `FAILED` | 21 |
| `NEEDS_VISION` | 20 |
| `UNSUPPORTED` | 4 |
| Con texto extraído | 947 |
| Con JSON estructurado no vacío | 967 |
| Verificados por una persona | 0 |
| Índices vectoriales | 0 |
| `OPENAI_VECTOR_STORE_ID` configurado | No |
| Proyectos sugeridos | 11 |
| Proyectos verificados | 0 |
| Revisiones de ingeniería | 0 |

Clasificación heurística observada:

- 590 documentos `SILO`;
- 60 `ELEVATOR`;
- 25 `STEEL_STRUCTURE`;
- 23 `CONVEYOR`;
- el resto distribuido entre otros tipos.

Estos conteos no equivalen a antecedentes estructurales verificados. La clasificación usa nombre de archivo y coincidencias de texto; debe revisarse antes de utilizar dimensiones o soluciones.

Dentro de esta biblioteca existen físicamente y están extraídos dos planos utilizables como primer corpus de prueba:

| Ruta relativa | Tipo | Texto | Confianza | Revisión |
|---|---|---:|---:|---|
| `presupuestos\plano silo vitabull 1.pdf` | `SILO` / `DRAWING` | 613 caracteres | 0,55 | No verificado |
| `presupuestos\plano silo vitabull 2.pdf` | `SILO` / `DRAWING` | 714 caracteres | 0,55 | No verificado |

`searchEngineeringKnowledge` puede encontrarlos. Durante la auditoría, `search_relevant_fmh_drawings` consultaba únicamente la tabla separada de 23 registros defectuosos y no devolvía resultados para `silo 200 toneladas`.

La brecha inmediata quedó corregida: la herramienta ahora combina ambas bibliotecas, prioriza documentos `DRAWING`, excluye antecedentes administrativos irrelevantes y devuelve los dos planos Vitabull mediante un DTO sin rutas internas. Sigue pendiente remapear los 23 archivos rotos, revisar contenido y agregar evidencia por página.

Hay 12 fuentes técnicas registradas:

- 3 `OFFICIAL_CURRENT`;
- 9 `OFFICIAL_HISTORICAL`;
- tipos: reglamentos, comentarios, referencias internacionales, tabla estructural y ejemplos resueltos.

## Pipeline existente

### Ingesta de conocimiento

`engineeringIngestion.ts`:

- recorre una raíz local;
- soporta PDF, DOCX, TXT, CSV e imágenes;
- calcula SHA-256;
- evita reprocesar archivos sin cambios;
- extrae texto localmente;
- clasifica tipo documental/proyecto mediante reglas;
- extrae capacidades y dimensiones con patrones;
- marca imágenes o documentos sin texto como `NEEDS_VISION`;
- registra formatos no procesables como `UNSUPPORTED`;
- no realiza OCR/visión real.

### Ingesta de planos

`drawingLibrary.ts`:

- descubre PDF;
- calcula SHA-256;
- extrae hasta 10.000 caracteres;
- genera miniatura;
- infiere título, número, escala y layout con heurísticas;
- registra confianza baja/moderada;
- mantiene el original fuera de la base por `sourcePath`;
- valida la raíz configurada al intentar leerlo.

### Recuperación actual

`engineeringKnowledge.ts`:

- tokeniza la consulta;
- usa filtros `contains` sobre nombre, proyecto, cliente, texto y JSON;
- aplica ranking local por coincidencias, tipo, confianza y verificación;
- devuelve extractos y nivel de confianza;
- no usa embeddings.

`engineeringGoldenLibrary.ts` combina conocimiento, reglamentos, benchmarks, secciones y fuentes.

`engineeringTools.ts` expone herramientas estrictas:

- `search_relevant_fmh_precedents`;
- `search_relevant_fmh_drawings`;
- búsqueda normativa y de secciones;
- cálculos deterministas separados.

`engineeringConversation.ts`:

- recupera biblioteca para intenciones técnicas seleccionadas;
- entrega contexto al resultado local;
- permite al modelo llamar herramientas;
- registra tool calls;
- mantiene el plano como preliminar.

## Brechas del pipeline

1. Los 23 planos no están disponibles mediante los `sourcePath` persistidos; los archivos históricos deben remapearse por hash.
2. Su estado `ANALYZED_LOCAL` es engañoso: sólo contienen el marcador de página.
3. Las dos bibliotecas continúan separadas en persistencia, aunque la herramienta ya unifica su recuperación.
4. La herramienta `search_relevant_fmh_drawings` depende de que el modelo decida llamarla; el fallback local no la usa.
5. La tabla histórica sólo permite buscar metadatos; el puente con conocimiento aporta texto, pero todavía no evidencia por página.
6. Los dos planos útiles de silo permanecen en `EngineeringKnowledgeDocument` y ya son recuperables mediante la herramienta unificada.
7. La herramienta elimina `sourcePath` y `thumbnailPath`; falta aplicar el mismo contrato seguro a todas las APIs documentales.
8. No hay chunks con página, viewport, coordenadas ni evidencia visual.
9. No hay OCR/visión para planos escaneados complejos.
10. No hay documentos verificados ni revisiones registradas.
11. No hay índices vectoriales ni evaluación de recuperación.
12. No hay vínculo formal entre un plano, su revisión, un proyecto estructural y una versión.
13. No hay mecanismo para invalidar una referencia si el archivo cambia.
14. El runtime puede enviar extractos recuperados al proveedor de IA mediante tool outputs; esto requiere una política explícita para documentos propietarios.

## Siguiente bloque seguro y verificable

No implementar todavía solver ni fine-tuning.

### Paso 1 — Backup y manifiesto

- backup PostgreSQL;
- copia del almacenamiento;
- manifiesto SHA-256;
- restore aislado;
- reporte de faltantes;
- cero borrados.

### Paso 2 — Restaurar originales

- usar la carpeta histórica como fuente autorizada sólo después del backup;
- buscar los 23 PDF por SHA-256 y, secundariamente, nombre/tamaño;
- restaurarlos bajo almacenamiento durable sin duplicar registros;
- regenerar miniaturas;
- comprobar SHA-256 contra DB;
- marcar faltantes como `MISSING_FILE`, sin borrar registros.

### Paso 3 — Unificar recuperación

- crear DTO seguro `EngineeringEvidence`;
- vincular plano y documento de conocimiento por hash;
- indexar texto por página;
- buscar automáticamente planos cuando la intención sea `DRAWING_SEARCH`, `DRAWING_REVIEW`, `PRELIMINARY_DRAWING` o un tipo coincidente;
- incluir `documentId`, página, extracto, confianza, revisión y hash;
- excluir rutas absolutas del DTO.

### Paso 4 — Curación humana

Comenzar por los dos planos Vitabull ya extraídos y ampliar luego hasta cinco planos de silo:

- confirmar tipo de proyecto;
- identificar título, revisión, fecha y cliente;
- marcar cotas como confirmadas, inferidas o ilegibles;
- registrar decisión de German Arroyo;
- no convertir automáticamente líneas a un modelo.

### Paso 5 — Evaluación RAG

Crear preguntas de recuperación conocidas:

- encontrar un plano por número;
- encontrar un silo por capacidad;
- recuperar una cota y su página;
- distinguir revisión antigua/nueva;
- no devolver una factura como fuente estructural;
- no usar un plano no verificado como diseño aprobado.

Medir:

- `Recall@k`;
- precisión de fuente;
- página correcta;
- respuesta con cita;
- abstención cuando falta evidencia.

Sólo después de aprobar la evaluación se decidirá entre:

- búsqueda local híbrida;
- PostgreSQL con extensión vectorial;
- vector store administrado.

## Consecuencias

### Positivas

- evidencia auditable;
- actualizaciones sin reentrenamiento;
- separación entre antecedente y cálculo;
- menor riesgo de inventar cotas;
- compatibilidad con fuentes locales y externas;
- posibilidad de retirar documentos;
- revisión atribuible a un profesional.

### Costos y restricciones

- requiere restaurar archivos;
- exige curación y evaluación;
- agrega metadatos de página/chunk;
- la búsqueda semántica no resuelve por sí sola la calidad;
- el asistente deberá abstenerse cuando la evidencia sea insuficiente;
- el silo de 200 t continuará como esquema preliminar hasta contar con un módulo específico y análisis válido.

## No decisiones

Este ADR no selecciona:

- proveedor de embeddings;
- base vectorial;
- OpenSeesPy;
- motor de cascarones;
- norma específica de silos internacional;
- formato final de firma;
- estrategia de OCR/visión.

Esas decisiones requieren evaluación separada y evidencia.
