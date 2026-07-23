# Roadmap de la plataforma estructural FMH

Fecha base: 2026-07-23  
Documento relacionado: `docs/INITIAL_AUDIT.md`

ADR aceptado: [`docs/DECISIONS/0001-structural-mvp-and-engineering-knowledge.md`](DECISIONS/0001-structural-mvp-and-engineering-knowledge.md)

## Objetivo

Evolucionar FMH Gestión desde una aplicación comercial con asistencia de ingeniería preliminar hacia una plataforma estructural trazable, sin perder los flujos existentes ni confundir orientación generada por IA con cálculo válido.

Este roadmap consolida las mejoras operativas ya identificadas en `docs/IMPROVEMENT_ROADMAP.md` y agrega la secuencia específica del MVP estructural. No propone sustituir Fastify, React o PostgreSQL.

## Evidencia local de partida

Hechos verificados después de la estabilización:

- `npm run typecheck`: aprobado en backend y frontend;
- `npm test`: 100 pruebas aprobadas y 1 omitida;
- `npm run build`: aprobado después de detener únicamente el servidor que bloqueaba el binario Prisma;
- `npx prisma validate`: aprobado;
- `npx prisma migrate status`: 14 migraciones reconocidas y base conectada al día;
- `npm audit --omit=dev`: 0 vulnerabilidades conocidas;
- lint: todavía no configurado.

Los ítems siguientes son recomendaciones y trabajo futuro. No deben interpretarse como capacidades ya implementadas.

## Reglas de avance

1. No avanzar de fase con P0 abiertos en la fase anterior.
2. Todo resultado numérico debe provenir de una función determinista o motor identificado.
3. Ningún análisis existe sin una versión inmutable del modelo y un `inputHash`.
4. El LLM interpreta, propone y explica; no calcula ni escribe directamente en la base.
5. Toda herramienta del agente usa esquema estricto, unidades, permisos y auditoría.
6. Los resultados fallidos, inestables, no convergentes u obsoletos permanecen visibles.
7. Planos y memorias sólo consumen datos persistidos; nunca cifras redactadas libremente.
8. Todo documento técnico es preliminar hasta revisión y firma profesional.
9. Cada bloque termina con typecheck, lint, tests, build y evidencia.
10. Las migraciones se prueban en PostgreSQL vacío antes de producción.

## Estado de partida

### Disponible

- React/Vite y sistema visual FMH;
- Fastify/TypeScript con validación Zod;
- Prisma/PostgreSQL operativo;
- empresas, clientes, presupuestos, remitos, facturas internas e inventario;
- WhatsApp y asistente comercial;
- conversaciones de ingeniería y tool calls persistidas;
- biblioteca, fuentes, reglamentos candidatos, secciones y revisión humana;
- cálculos deterministas simples;
- BOM, barras, cortes, peso y costos conocidos;
- planos históricos;
- plantilla SVG/PDF orientativa con advertencia.

### No disponible

- modelo estructural canónico;
- proyectos/versiones estructurales inmutables;
- solver;
- resultados estructurales normalizados;
- editor 2D/3D;
- diseño normativo;
- memoria de cálculo;
- DXF/IFC estructural;
- proceso aislado de cálculo;
- E2E estructural.

## Fase 0 — Auditoría y estabilización

Estado: **en curso**

### P0.0 — Recuperar una línea base verde

Tareas:

- [x] Resolver la regresión de `engineeringDrawingFlow.test.ts`.
- [x] Confirmar que el texto del flujo con geometría incompleta identifica los valores como ilustrativos.
- [x] Ejecutar build completo sin un servidor que bloquee el binario Prisma.
- [ ] Agregar ESLint para backend y frontend.
- [ ] Crear CI con instalación limpia, generación Prisma, typecheck, lint, tests y build.

Criterios de aceptación:

- 0 pruebas fallidas;
- build reproducible en un directorio limpio;
- lint configurado sin desactivar reglas críticas;
- artefactos y logs guardados en CI.

### P0.1 — Baseline PostgreSQL y recuperación

Tareas:

- [ ] Respaldar la base y los documentos actuales.
- [ ] Generar manifiesto de archivos con ruta lógica, tamaño y SHA-256.
- [ ] Restaurar el backup en un ambiente aislado antes de cambiar migraciones.
- [ ] Generar un baseline PostgreSQL equivalente al esquema vigente.
- [ ] Verificarlo en una base vacía aislada.
- [ ] Auditar datos antes de agregar nuevas unicidades.
- [ ] Archivar explícitamente el historial SQLite sin ejecutarlo sobre PostgreSQL nuevo.
- [ ] Documentar restore de PostgreSQL y almacenamiento documental.
- [ ] Probar una restauración.

Criterios de aceptación:

- una base vacía llega al esquema actual con un solo procedimiento documentado;
- `prisma migrate status` queda limpio;
- seed sintético funciona;
- backup y restore están ensayados;
- no se exponen secretos ni documentos reales.

### P0.2 — Decisiones de seguridad estructural

Crear ADR para:

- [x] sistema interno de unidades: `m`, `kN`, `MPa`;
- [ ] estados `ORIENTATION`, `ESTIMATION`, `PRELIMINARY_DESIGN`, `VERIFIED_CALCULATION`;
- [x] normativa inicial: CIRSOC Argentina;
- [x] alcance inicial: vigas simples y pórtico plano 2D pequeño;
- [x] identidad del responsable técnico: German Arroyo, `03136/5` como string;
- [ ] inmutabilidad de versiones y análisis;
- [ ] tolerancias numéricas;
- [ ] estrategia de proceso aislado;
- [x] política inicial: biblioteca/RAG trazable, no fine-tuning;
- [ ] formato canónico de errores.
- [x] motor analítico propio antes de OpenSeesPy;
- [ ] licencia y condiciones de redistribución de cada motor externo.

Criterios de aceptación:

- las decisiones tienen responsable, fecha y consecuencias;
- la UI y API comparten las mismas etiquetas;
- ningún flujo llama “verificado” a un resultado sin análisis válido.

## Fase 1 — Núcleo del dominio

Objetivo: crear el modelo canónico, versiones, unidades y validación referencial.

### P0.3 — Proyecto y versiones

Entidades:

- `StructuralProject`;
- `StructuralProjectVersion`;
- `StructuralProjectMember`;
- `StructuralChange`;
- `UnitSystem`;
- `DesignCodeSelection`.

Tareas:

- [ ] CRUD de proyecto.
- [ ] Borrador editable.
- [ ] Publicación de versión inmutable.
- [ ] Clonado de versión.
- [ ] Historial manual/importación/IA.
- [ ] Hash SHA-256 estable.
- [ ] Estado de cambios sin sincronizar.

Tests:

- aislamiento por empresa;
- permisos por rol;
- hash estable;
- versión publicada inmutable;
- restauración mediante nueva revisión, sin sobreescritura.

### P0.4 — Modelo canónico

Entidades y contratos:

- `Level`;
- `GridAxis`;
- `StructuralNode`;
- `Material`;
- `StructuralSectionDefinition`;
- `Member`;
- `Slab`;
- `Foundation`;
- `Support`;
- `LoadCase`;
- `NodalLoad`;
- `MemberLoad`;
- `SurfaceLoad`;
- `LoadCombination`.

Tareas:

- [ ] Schemas Zod estrictos.
- [ ] IDs opacos y únicos.
- [ ] relaciones y borrado protegido;
- [ ] ejes locales y releases;
- [ ] metadatos de origen;
- [ ] serialización JSON pública versionada.

No usar `String` JSON como sustituto de relaciones centrales.

### P0.5 — Unidades y cantidades

Tareas:

- [ ] catálogo de dimensiones físicas;
- [ ] normalización al sistema interno;
- [ ] conversión sólo en límites;
- [ ] unidades explícitas en contratos;
- [ ] rechazo de magnitudes incompatibles;
- [ ] redondeo sólo de presentación;
- [ ] pruebas de ida y vuelta.

Criterios:

- no existe número estructural de entrada sin unidad o contexto tipado;
- los valores persistidos declaran la unidad canónica;
- toda salida identifica el sistema mostrado.

### P1.0 — Validación del modelo

Validaciones mínimas:

- nodos duplicados;
- longitud cero;
- elementos desconectados o superpuestos;
- referencias inexistentes;
- secciones/materiales inexistentes;
- cargas sin caso;
- casos ausentes de combinaciones;
- modelo sin apoyos;
- grados de libertad inestables;
- unidades y valores inválidos;
- contornos de losa abiertos;
- elementos fuera de nivel;
- ejes locales inconsistentes;
- combinaciones duplicadas;
- geometría incompatible con el motor.

Contrato:

```json
{
  "code": "MEMBER_ZERO_LENGTH",
  "severity": "ERROR",
  "elementType": "MEMBER",
  "elementId": "uuid",
  "message": "El elemento no tiene longitud.",
  "suggestion": "Separá sus nodos extremos.",
  "quickAction": "SELECT_ELEMENT"
}
```

Criterios de salida de Fase 1:

- proyecto y versión canónicos;
- pórtico pequeño persistido;
- validación estructurada;
- hash reproducible;
- exportación JSON;
- pruebas unitarias y de integración verdes;
- sin cálculo todavía presentado como válido.

## Fase 2 — Editor estructural

Objetivo: editar el modelo canónico sin formularios permanentes.

### P1.1 — Workspace

Componentes:

- barra superior con proyecto, versión, normativa y unidades;
- modos Modelo, Cargas, Análisis, Diseño, Resultados, Planos y Documentos;
- navegador por niveles/categorías;
- lienzo SVG 2D;
- panel contextual de propiedades;
- panel inferior de errores/resultados;
- indicador de guardado.

### P1.2 — Herramientas de edición

- [ ] crear/mover/eliminar nodos;
- [ ] vigas y columnas;
- [ ] apoyos;
- [ ] grilla y snapping;
- [ ] selección simple/múltiple;
- [ ] copiar, pegar y duplicar por nivel;
- [ ] undo/redo basado en comandos;
- [ ] filtros, capas, ocultar y aislar;
- [ ] atajos;
- [ ] confirmación destructiva.

### P2.0 — Vista 3D básica

- [ ] extrusión visual de barras y secciones;
- [ ] vista por nivel;
- [ ] selección sincronizada con 2D;
- [ ] deformada posterior;
- [ ] sin edición 3D compleja en el primer MVP.

Tests:

- tests de reductores/comandos;
- componentes críticos;
- teclado y accesibilidad;
- E2E crear pórtico;
- responsive mínimo;
- errores localizados sobre elementos.

Criterios de salida:

- crear un pórtico desde UI;
- asignar materiales, secciones y apoyos;
- guardar y reabrir sin pérdida;
- ver y corregir validaciones sobre el lienzo.

## Fase 3 — Primer cálculo funcional

Objetivo: completar un flujo determinista de extremo a extremo.

### P0.6 — Contrato de motor

```typescript
interface StructuralAnalysisEngine {
  id: string;
  version: string;
  validateSupport(model: CanonicalStructuralModel): EngineIssue[];
  buildModel(model: CanonicalStructuralModel): Promise<EngineModel>;
  run(model: EngineModel, options: AnalysisOptions): Promise<RawAnalysisResult>;
  normalizeResults(result: RawAnalysisResult): NormalizedAnalysisResult;
  healthCheck(): Promise<EngineHealth>;
}
```

### P0.7 — Registro inmutable de análisis

Persistir:

- `analysisId`;
- versión de proyecto;
- motor y versión;
- estado;
- fecha inicio/fin;
- `inputHash`;
- opciones;
- logs acotados;
- warnings/errores;
- convergencia;
- resumen;
- usuario;
- versión del código.

Estados:

`QUEUED`, `RUNNING`, `COMPLETED`, `FAILED_VALIDATION`, `FAILED_ENGINE`, `NON_CONVERGENT`, `CANCELLED`, `TIMED_OUT`, `STALE`.

### P0.8 — Aislamiento

- [ ] proceso separado;
- [ ] timeout;
- [ ] límite de memoria;
- [ ] cancelación;
- [ ] archivos temporales privados;
- [ ] inputs serializados, nunca código;
- [ ] recolección de logs;
- [ ] recuperación ante caída.

Puede comenzar con una cola PostgreSQL controlada. Redis se incorpora si la carga o múltiples workers lo justifican.

### P1.3 — Motor analítico inicial

Orden:

1. viga simplemente apoyada con carga puntual;
2. viga simplemente apoyada con carga distribuida;
3. voladizo;
4. viga continua básica;
5. pórtico plano pequeño mediante método matricial.

Resultados:

- reacciones;
- desplazamientos nodales;
- esfuerzos de extremo;
- diagramas muestreados;
- equilibrio global;
- advertencias.

Fixtures y tolerancias:

- solución cerrada independiente;
- tolerancia absoluta y relativa explícitas;
- equilibrio de fuerzas y momentos;
- test de mecanismo/inestabilidad;
- unidades alternativas con el mismo resultado físico.

Decisión de alcance:

- el motor inicial es propio, analítico y limitado a casos con solución independiente;
- no se integra OpenSeesPy hasta revisar su licencia de redistribución comercial y aprobar benchmarks;
- el modelo canónico no adopta IDs, unidades ni estructura interna de ningún solver;
- una integración externa siempre se realiza mediante el adaptador `StructuralAnalysisEngine`.

### P1.4 — Resultados en UI

- [ ] deformada;
- [ ] reacciones;
- [ ] axial, corte y momento;
- [ ] combinación seleccionada;
- [ ] escala gráfica;
- [ ] resultados obsoletos al editar;
- [ ] tabla y visualización vinculadas;
- [ ] exportación JSON.

Criterios de salida:

- el usuario crea, valida y analiza un pórtico;
- resultados reproducibles;
- error visible para modelo inestable;
- ninguna convergencia fallida se oculta;
- el asistente sólo consulta el `analysisId` válido.

## Fase 4 — Diseño de hormigón

Requisito previo: normativa y responsable técnico definidos.

La selección normativa debe provenir del catálogo oficial de [INTI-CIRSOC](https://www.inti.gob.ar/areas/serviciosindustriales/construcciones-e-infraestructura/cirsoc/reglamentos). La versión aplicable se decide por proyecto y jurisdicción; no se actualiza automáticamente un cálculo histórico cuando aparece una edición nueva.

### P1.5 — Vigas

- resistencia a flexión;
- corte;
- servicio y deformación;
- armadura mínima/máxima;
- utilización y advertencias;
- salida preliminar.

### P1.6 — Columnas

- axial/flexión dentro del alcance elegido;
- esbeltez;
- cuantías;
- utilización;
- advertencias de segundo orden fuera de alcance.

### P2.1 — Losa unidireccional

- paño y dirección resistente;
- cargas superficiales;
- franja equivalente documentada;
- flexión/servicio dentro del alcance.

### P2.2 — Fundación aislada simple

- reacciones persistidas como entrada;
- presión de suelo ingresada y validada;
- geometría, punzonado/flexión dentro del alcance;
- no inventar parámetros geotécnicos.

Criterios:

- cada chequeo referencia análisis, combinación, norma, cláusula y versión;
- factores de utilización y no cumplimiento visibles;
- tests contra ejemplos independientes revisados.

## Fase 5 — Planos y documentación

### P1.7 — Representación intermedia

Crear:

- `DrawingDocument`;
- `DrawingSheet`;
- capas;
- líneas/arcos/polilíneas;
- símbolos;
- cotas;
- etiquetas;
- viewport;
- cajetín;
- advertencias.

La geometría de documentación no debe mezclarse con el modelo estructural.

### P1.8 — Planta estructural preliminar

- niveles;
- ejes;
- columnas;
- vigas;
- etiquetas de sección;
- cotas principales;
- apoyos;
- cargas opcionales;
- referencias;
- escala;
- fecha, revisión y responsable;
- “PRELIMINAR — REQUIERE REVISIÓN PROFESIONAL”.

### P2.3 — Exportadores

Orden:

1. SVG;
2. PDF;
3. DXF con `ezdxf` o alternativa evaluada;
4. JSON del dibujo.

No implementar IFC en esta fase.

Para DXF, evaluar [ezdxf](https://ezdxf.readthedocs.io/en/stable/) únicamente como adaptador de `DrawingDocument`; la biblioteca soporta creación y lectura/escritura de DXF, pero no debe convertirse en el modelo de dominio.

### P1.9 — Memoria de cálculo

Secciones:

- portada;
- proyecto y alcance;
- normativa y unidades;
- versión/hash;
- materiales y geometría;
- hipótesis;
- cargas y combinaciones;
- motor/método/versión;
- resultados;
- verificaciones;
- incumplimientos;
- advertencias;
- historial.

Regla de aceptación:

- cada cifra se resuelve por ID desde un resultado persistido;
- si falta análisis válido, la generación se bloquea;
- la memoria incluye fecha y usuario responsable.

## Fase 6 — Asistente estructural

El chat existente se reutiliza como interfaz, no como motor.

### P0.9 — Recuperación de planos FMH

Estado real de partida:

- 23 planos registrados como `ANALYZED_LOCAL`;
- los 23 sólo contienen el marcador `-- 1 of 1 --`, sin tipo, cliente ni revisión;
- originales y miniaturas ausentes del almacenamiento actual;
- 992 documentos de conocimiento, 0 verificados;
- dos planos Vitabull `SILO/DRAWING` físicamente disponibles y con texto;
- 11 proyectos `SUGGESTED`, 0 verificados y 0 revisiones;
- 0 índices vectoriales;
- recuperación actual léxica, sin embeddings.
- `searchEngineeringKnowledge` encuentra los dos planos útiles;
- `search_relevant_fmh_drawings` ya unifica la tabla histórica con `EngineeringKnowledgeDocument` y encuentra los dos planos Vitabull sin exponer rutas internas.

Tareas:

- [ ] backup y manifiesto antes de cualquier reparación;
- [ ] remapear originales desde la carpeta histórica por SHA-256, sin borrar metadata;
- [ ] restaurar miniaturas y comprobar los endpoints PDF/thumbnail;
- [ ] comprobar SHA-256;
- [ ] vincular plano/conocimiento por hash;
- [x] crear un DTO inicial sin rutas internas para la herramienta de búsqueda;
- [ ] crear chunks por página con evidencia visual;
- [ ] recuperar planos automáticamente para intenciones relevantes;
- [ ] curar primero los dos planos Vitabull y luego un conjunto de cinco planos de silo;
- [ ] crear evaluación de recuperación y abstención;
- [ ] decidir búsqueda híbrida/vector store sólo con métricas.

No se hará fine-tuning con los planos. La estrategia aprobada es recuperar evidencia citable. OpenAI describe RAG como recuperación de contexto específico antes de generar y separa ese objetivo del aprendizaje de tareas mediante fine-tuning:

- [OpenAI — RAG y optimización](https://developers.openai.com/api/docs/guides/optimizing-llm-accuracy#retrieval-augmented-generation-rag)
- [OpenAI — retrieval y vector stores](https://developers.openai.com/api/docs/guides/retrieval#vector-stores)

### P1.10 — Herramientas tipadas

- `create_project`;
- `define_units`;
- `define_design_code`;
- `create_level`;
- `create_node`;
- `create_member`;
- `create_slab`;
- `create_support`;
- `define_material`;
- `define_section`;
- `assign_load`;
- `create_load_combination`;
- `validate_model`;
- `run_analysis`;
- `run_design_checks`;
- `generate_report`;
- `generate_drawing`;
- `export_json`;
- `export_dxf`.

Cada herramienta:

- recibe versión esperada;
- valida permisos;
- valida unidades;
- genera preview;
- registra origen IA;
- exige confirmación para cambios masivos/destructivos;
- retorna resultado estructurado.

### P1.11 — Consultas seguras

Respuesta obligatoria cuando no hay resultado:

> No existe un análisis válido para esta versión del modelo. Ejecutá o actualizá el cálculo antes de consultar resultados.

Pruebas adversariales:

- pedir al modelo inventar una reacción;
- cambiar unidades por texto;
- actualizar 24 elementos sin confirmación;
- consultar una versión obsoleta;
- intentar acceder a otra empresa;
- inyectar instrucciones desde un documento.

## Fase 7 — Importación y BIM

### P2.4 — Importación estructurada

- JSON canónico;
- CSV de nodos;
- CSV de barras;
- CSV de cargas;
- preview;
- mapeo de columnas/unidades;
- validación y rollback.

### P3.0 — DXF de referencia

- lectura como fondo;
- selección de capas;
- calibración de unidades;
- conversión manual explícita de líneas;
- nunca analizar automáticamente.

### P3.1 — IFC

- evaluar IfcOpenShell;
- niveles, vigas, columnas y losas;
- GUID persistentes;
- mapeo analítico;
- entidades no reconocidas;
- comparación de revisión;
- exportación después de validación.

Referencias de decisión:

- [buildingSMART — especificación oficial IFC 4.3](https://ifc43-docs.standards.buildingsmart.org/)
- [IfcOpenShell — documentación oficial](https://docs.ifcopenshell.org/)

La importación preservará `GlobalId`, unidades y transformaciones como referencias externas, pero mantendrá IDs y versiones FMH. Ninguna geometría importada pasa a análisis sin validación y confirmación.

### P3.2 — PDF/imagen experimental

- OCR/visión;
- detección de líneas/símbolos;
- confianza y evidencia;
- pantalla de revisión;
- confirmación manual obligatoria;
- sin conversión directa a modelo calculable.

## Flujo específico: silo de 200 t

### Etapa actual

Conservar el esquema orientativo, mejorando:

- declaración visible de dimensiones ilustrativas;
- lista de datos faltantes;
- fuente de cada valor;
- botón para confirmar/reemplazar hipótesis;
- vínculo al caso y revisión.

### Etapa de antecedentes

- buscar sólo fuentes oficiales, fabricantes o antecedentes FMH autorizados;
- registrar URL, versión, fecha, hash, jurisdicción y revisor;
- separar referencia geométrica de criterio normativo;
- nunca copiar detalles de fabricación sin licencia/procedencia.

Para normativa argentina, la fuente primaria es [INTI-CIRSOC](https://www.inti.gob.ar/areas/serviciosindustriales/construcciones-e-infraestructura/cirsoc/reglamentos). Las fuentes internacionales sólo pueden registrarse como complementarias cuando el responsable técnico defina su aplicabilidad.

### Etapa estructural futura

El silo requiere un módulo específico posterior:

- propiedades del producto almacenado;
- presiones de llenado/descarga;
- cascarón y rigidizadores;
- viento/sismo/temperatura;
- soporte, arriostramiento y uniones;
- anclajes y fundación;
- método y normativa de silos;
- benchmarks independientes.

Hasta entonces, el resultado permanece como esquema para relevamiento/presupuesto, no plano estructural calculado.

## Backlog transversal por prioridad

### P0

- conservar suite y build verdes;
- CI limpio;
- baseline PostgreSQL;
- backup/restore;
- identidad y autorización de responsables;
- unidades canónicas;
- modelo versionado;
- frontera IA/cálculo;
- análisis inmutable;
- aislamiento del motor;
- errores y no convergencia visibles.

### P1

- validación del modelo;
- editor 2D;
- primer motor;
- resultados;
- memoria/planta;
- herramientas tipadas del agente;
- E2E;
- modularización frontend/backend;
- paginación y contratos compartidos;
- cola durable de WhatsApp.

### P2

- hormigón ampliado;
- losa/fundación;
- vista 3D;
- DXF;
- importación CSV/JSON;
- comparación de versiones;
- observabilidad y métricas;
- almacenamiento de objetos.

### P3

- IFC;
- OCR/visión;
- silos detallados;
- múltiples motores;
- optimización;
- diseño generativo;
- colaboración en tiempo real.

## Archivos previstos por bloque

| Bloque | Archivos nuevos o a modificar |
|---|---|
| Baseline | `prisma/migrations/`, `prisma/schema.prisma`, `docs/DECISIONS/` |
| Dominio | `src/domain/structural/`, `src/services/structural/` |
| API | `src/routes/structuralProjects.ts`, `src/routes/structuralModels.ts`, `src/server.ts` |
| Jobs | `src/services/analysis/`, `src/workers/analysisWorker.ts` |
| Motores | `src/engines/analytical/`, luego `engines/python/` |
| UI | `frontend/src/features/structural/` |
| Planos | `src/services/drawings/` |
| Reportes | `src/services/reports/` |
| Agente | `src/services/engineering/engineeringTools.ts`, nuevos esquemas |
| Fixtures | `tests/fixtures/structural/` o equivalente |
| Documentación | `docs/DOMAIN_MODEL.md`, `ANALYSIS_ENGINE.md`, `AI_AGENT.md`, `TESTING.md`, `DECISIONS/` |

## Matriz mínima de pruebas

| Nivel | Casos |
|---|---|
| Unitarias | unidades, geometría, validaciones, hash, combinaciones, serialización |
| Regresión numérica | carga puntual, UDL, voladizo, viga continua, columna axial, pórtico |
| Integración | proyecto → versión → validar → analizar → persistir → consultar |
| Persistencia | base vacía, migraciones, constraints, concurrencia, rollback |
| Seguridad | empresa, roles, archivos, tool calls, límites y timeout |
| Exportación | JSON, PDF, DXF; contenido y hash |
| E2E | crear pórtico completo, analizar, revisar, documentar y descargar |
| UX/accesibilidad | teclado, foco, errores sobre modelo, 390 px |
| Resiliencia | worker caído, timeout, cancelación, resultado stale, reintento |

## Criterios de aceptación del MVP 1.0

- [ ] Crear proyecto.
- [ ] Seleccionar unidades.
- [ ] Seleccionar normativa.
- [ ] Crear pórtico plano.
- [ ] Definir materiales y secciones.
- [ ] Crear apoyos.
- [ ] Asignar cargas.
- [ ] Crear combinaciones.
- [ ] Validar el modelo.
- [ ] Ejecutar análisis aislado.
- [ ] Visualizar reacciones.
- [ ] Visualizar esfuerzos.
- [ ] Visualizar deformada.
- [ ] Detectar errores sobre elementos.
- [ ] Ejecutar verificación básica.
- [ ] Generar memoria.
- [ ] Generar planta preliminar.
- [ ] Exportar JSON.
- [ ] Exportar DXF o PDF.
- [ ] Consultar resultados mediante el asistente.
- [ ] Cubrir el flujo con E2E.
- [ ] Mostrar normativa, unidades, motor, versión, hipótesis, advertencias, fecha y responsable.
- [ ] Marcar el documento como preliminar hasta revisión profesional.

## Próximo bloque recomendado

Ejecutar en este orden:

1. agregar lint y CI para conservar suite/typecheck/build verdes;
2. crear baseline PostgreSQL reproducible;
3. aprobar ADR de unidades, estados, versionado y licencias;
4. implementar proyecto/versiones y modelo canónico mínimo;
5. implementar validaciones y hash;
6. entregar exportación JSON y un pórtico fixture;
7. recién entonces iniciar el motor analítico.

Este bloque es pequeño, verificable y reduce los riesgos principales sin reescribir la aplicación.

## Fuentes primarias para gates futuros

Estas fuentes respaldan decisiones técnicas futuras y no representan funcionalidad existente:

- [OpenSees — documentación oficial](https://opensees.github.io/OpenSeesDocumentation/)
- [OpenSeesPy — documentación, comandos y licencia](https://openseespydoc.readthedocs.io/en/latest/)
- [INTI-CIRSOC — reglamentos oficiales](https://www.inti.gob.ar/areas/serviciosindustriales/construcciones-e-infraestructura/cirsoc/reglamentos)
- [buildingSMART — especificación IFC 4.3](https://ifc43-docs.standards.buildingsmart.org/)
- [IfcOpenShell — documentación oficial](https://docs.ifcopenshell.org/)
- [ezdxf — documentación oficial](https://ezdxf.readthedocs.io/en/stable/)
