# Plan de planos comerciales orientativos de Ingeniería FMH

Fecha de auditoría: 2026-07-29

## Objetivo

Convertir el módulo Ingeniería FMH existente en un generador paramétrico de planos comerciales preliminares asociados a presupuestos. El resultado debe explicar visualmente el equipo y el espacio requerido, pero nunca presentarse como documentación de fabricación, montaje definitivo, cálculo estructural o certificación.

Leyenda obligatoria:

> DISEÑO Y DIMENSIONES ORIENTATIVAS PARA COTIZACIÓN. LAS MEDIDAS DEFINITIVAS PUEDEN MODIFICARSE DURANTE LA ETAPA DE INGENIERÍA Y FABRICACIÓN.

Advertencia complementaria:

> Este documento representa una propuesta comercial preliminar. Verificar diseño, materiales, estructura, accionamientos, seguridad y normativa antes de fabricar.

## Estado actual

### Base aprovechable

- Fastify + TypeScript en backend, React + Vite en frontend y Prisma + PostgreSQL.
- Conversaciones de ingeniería persistentes, estado técnico, casos guardados, biblioteca y revisión humana.
- Endpoint compatible `POST /api/engineering/drawing` y descarga PDF.
- Generación determinística inicial de geometría de silo vinculada con capacidad.
- Biblioteca histórica y modelos de planos FMH separados del flujo conversacional.
- PDFKit ya está disponible; no hace falta incorporar otra dependencia para el primer hito.
- La base PostgreSQL está conectada y las 15 migraciones existentes estaban aplicadas al comenzar esta tarea.
- Línea base: typecheck correcto; 197 pruebas correctas y 1 omitida.

### Problemas detectados

- `src/services/engineering/drawing.ts` arma el SVG mediante un único bloque de texto y mezcla geometría, layout, estilos y documentación.
- El PDF actual es A4, no A3, y no contiene las mismas vistas del SVG.
- `EngineeringDrawingSpec` no registra origen, confianza, fuente ni estado de verificación de cada valor.
- No hay un modelo persistente específico para diseños comerciales generados, revisiones o asociación con presupuestos.
- La interfaz descarga el SVG directamente desde la conversación, sin una etapa clara de propuesta, edición de medidas, carátula y vista previa.
- Los tipos de equipo, reglas de diseño y fuentes no están encapsulados en DesignPacks versionados.
- El modelo de planos históricos (`EngineeringDrawingDocument`) representa antecedentes importados y no debe reutilizarse como historial de documentos generados.
- El build inicial quedó bloqueado por un proceso local que mantiene abierto el motor Prisma copiado en `dist`; no es un error de TypeScript ni de Vite. Debe detenerse el servidor antes del build final y volver a iniciarse después.

## Arquitectura propuesta

```text
Lenguaje natural / formulario
  -> extracción tipada y validada
  -> EngineeringDesignRequestV2
  -> DesignPack versionado
  -> cálculos TypeScript determinísticos
  -> EngineeringDesignResultV2
  -> geometría paramétrica
  -> DrawingScene (milímetros de papel)
  -> renderSceneToSvg / renderSceneToPdf
  -> vista previa A3
  -> revisión persistida
  -> asociación opcional con presupuesto
```

La IA sólo interpreta texto y propone entradas. No genera entidades gráficas ni valores con origen `CALCULATED`. Los cálculos geométricos se ejecutan en TypeScript y todos los supuestos quedan registrados como `ILLUSTRATIVE_ASSUMPTION`.

Structured Outputs se implementará con un objeto raíz, todos los campos requeridos —usando `null` donde corresponda— y `additionalProperties: false`, siguiendo la documentación oficial de OpenAI. Cuando no exista saldo API, el modo local autorizado podrá usar Codex CLI en un proceso aislado y con esquema estricto; el cálculo y el dibujo seguirán siendo determinísticos.

## Módulos nuevos

```text
src/services/engineering/commercialDrawings/
  types.ts
  schemas.ts
  materials.ts
  designPacks.ts
  siloDesignPack.ts
  drawingScene.ts
  a3Sheet.ts
  siloDrawing.ts
  svgRenderer.ts
  pdfRenderer.ts
  service.ts
  persistence.ts
```

El archivo `drawing.ts` permanecerá como adaptador de compatibilidad de los endpoints actuales.

## Entidades nuevas

### Dominio

- `EngineeringDesignRequestV2`
- `EngineeringDesignResultV2`
- `EngineeringDrawingSpecV2`
- `TechnicalValue`
- `DesignPack`
- `BulkMaterialSpec`
- `DrawingScene`, `DrawingSheet`, `DrawingView`, `DrawingLayer` y `DrawingEntity`

### Persistencia

- `EngineeringCommercialDrawing`: identidad estable del plano generado y sus asociaciones.
- `EngineeringCommercialDrawingRevision`: snapshot inmutable de solicitud, resultado, escena, SVG, PDF almacenado, hipótesis y estado.

Los antecedentes históricos continúan en `EngineeringDrawingDocument`; no se migran ni se mezclan.

## Estrategia de migración

1. Agregar tablas y relaciones nuevas de forma aditiva.
2. No modificar ni borrar columnas existentes.
3. Mantener las rutas actuales mediante un adaptador V1 -> V2.
4. Agregar rutas `/api/engineering/v2/...`.
5. Aplicar la migración con Prisma y comprobar el estado antes de habilitar persistencia.
6. Conservar cada revisión; regenerar nunca sobrescribe un snapshot anterior.

## Archivos inicialmente involucrados

- `src/services/engineering/drawing.ts`
- `src/routes/engineering.ts`
- `src/config.ts`
- `prisma/schema.prisma`
- `prisma/migrations/...`
- `frontend/src/features/engineering/EngineeringPage.tsx`
- `frontend/src/professional.css`
- `.env.example`
- fixtures y pruebas bajo `src/services/engineering/commercialDrawings` y `fixtures/engineering`

## Etapas

### Hito 1 — entrega demostrable

- Contratos V2 y trazabilidad por valor.
- Materiales referenciales mínimos.
- DesignPack de silo en estado `REFERENCE_ONLY`.
- Generación reproducible `createIllustrativeSilo400T`.
- Escena vectorial y hoja A3 horizontal.
- Elevación frontal, lateral, corte, planta y planta de apoyos.
- Cotas, notas, carátula editable y leyendas obligatorias.
- SVG y PDF consumiendo exactamente la misma `DrawingScene`.
- Propuesta, edición y vista previa desde Ingeniería.
- Guardado, revisión y asociación con presupuesto.
- Tests de cálculo, escena, SVG, PDF, trazabilidad y rutas inseguras.

### Hito 2

- DesignPacks completos de tolva y sinfín.
- Formularios dinámicos, catálogo de materiales ampliado y mejoras de asociación.

### Hito 3

- Noria comercial inicial y composición básica de planta con flujo.

### Hito 4

- Biblioteca técnica externa, metadatos, catálogo de componentes y propuestas revisables de cambios a DesignPacks.

### Hito 5

- Refinamiento de layout, nuevos equipos y antecedentes internos corregidos.

## Riesgos

- Una proporción ilustrativa puede ser confundida con una decisión técnica definitiva.
- La densidad aparente cambia con producto, humedad y manejo.
- Los DesignPacks iniciales no están verificados por un ingeniero ni por un fabricante.
- La asociación entre `budgetId` del contrato funcional y `Quote.id` del modelo existente debe quedar explícita.
- Guardar SVG y escena en PostgreSQL aumenta el tamaño de la base; el PDF se almacenará mediante el servicio privado de archivos.
- Codex CLI usa la sesión local de ChatGPT y no debe habilitarse como proveedor público en la VPS.

## Controles

- Estado inicial de cada DesignPack: `REFERENCE_ONLY`.
- Ninguna acción automática puede marcar un plano como apto para fabricación o aprobado.
- Toda dimensión queda clasificada como ingresada, calculada o asumida.
- Las fórmulas geométricas y conversiones tienen pruebas.
- La IA no tiene acceso directo a Prisma ni al constructor geométrico.
- Los nombres de archivo se sanitizan y no se aceptan rutas del cliente.
- Cada revisión conserva hash, DesignPack, fecha y responsable.

## Fuentes técnicas necesarias

Para el primer hito se usarán solamente:

- fórmulas geométricas determinísticas de cilindro y cono;
- densidades referenciales identificadas como tales;
- proporciones internas ilustrativas, con origen y nota visible.

Antes de elevar un DesignPack a `REVIEWED` se necesitan fuentes revisadas para:

- densidad aparente por material y condición;
- ángulo de reposo y comportamiento de flujo;
- criterios comerciales de llenado útil;
- límites de transporte y montaje;
- dimensiones comerciales de componentes;
- requisitos de seguridad, venteo, explosión, acceso y mantenimiento.

No se copiarán carátulas, logotipos ni planos completos de terceros.

## Criterios de aceptación del Hito 1

- El usuario crea un silo de trigo de 400 t, fondo cónico y descarga libre a 4 m.
- El resultado muestra medidas ingresadas, calculadas, asumidas y faltantes.
- El volumen y la capacidad se calculan de forma reproducible.
- El usuario puede editar medidas y recalcular.
- La vista previa es una hoja A3 horizontal con marco, vistas, cotas, notas y carátula.
- El SVG y el PDF se producen desde el mismo `DrawingScene`.
- Las dos leyendas comerciales aparecen de forma visible.
- Se puede guardar el plano, crear una revisión y asociarlo a un presupuesto sin sobrescribir la revisión anterior.
- Los endpoints V1 existentes continúan funcionando.
- Typecheck, pruebas y build finalizan correctamente.

## Limitaciones del primer hito

- No dimensiona espesores, perfiles, soldaduras, anclajes, fundaciones ni accionamientos.
- No verifica viento, sismo, explosión, estabilidad global ni normativa.
- No genera documentación apta para fabricación.
- No interpreta automáticamente CAD externo.
- No aprueba DesignPacks.
- Tolva, sinfín, noria y planta quedan para hitos posteriores, salvo contratos o representaciones de compatibilidad explícitamente marcadas.
