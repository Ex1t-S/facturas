# Auditoría del asistente comercial de WhatsApp

Fecha de línea base: 2026-07-23

## Alcance

Esta auditoría cubre el flujo de creación y edición de presupuestos y remitos desde WhatsApp, la persistencia de la conversación, la generación de previsualizaciones, la confirmación y la creación de documentos definitivos.

La línea base se tomó antes de la reparación solicitada.

## Comandos de línea base

| Comando | Resultado inicial |
| --- | --- |
| `npm install` | Correcto. 385 paquetes auditados, 0 vulnerabilidades. |
| `npx prisma generate` | Correcto. Prisma Client 6.19.3 generado. |
| `npm run typecheck` | Correcto para backend y frontend. |
| `npm test` | 15 archivos; 100 tests pasaron y 1 quedó omitido. |
| `npm run build` | Falló con `EPERM` al intentar reemplazar `dist/generated/postgres-client/query_engine-windows.dll.node`; un proceso local `node dist/server.js` mantenía cargado el DLL. No fue un fallo de TypeScript. |

## Flujo actual

```text
POST /webhooks/whatsapp
  -> valida firma de Meta y número permitido
  -> busca providerMessageId
  -> guarda/upsert WhatsAppMessage
  -> crea o actualiza WhatsAppConversation
  -> carga los últimos 20 mensajes como texto
  -> parsea WhatsAppConversation.pendingJson
  -> answerAssistant(...)
  -> vuelve a serializar pendingDeliveryDraft en pendingJson
  -> genera/envía texto o PDF
```

Módulos principales:

- `src/routes/whatsapp.ts`: webhook, deduplicación inicial, persistencia del mensaje, carga de historial, envío y registro de la respuesta.
- `src/services/assistant.ts`: clasificación global, resolución de cliente, mutaciones, creación del borrador, preview, confirmación, persistencia comercial y consultas.
- `src/services/documentConversationResolver.ts`: clasificación gruesa de la acción documental.
- `src/services/commercialConversation.ts`: mutaciones deterministas parciales.
- `src/services/fmhQuoteDocument.ts`, `src/services/fmhDeliveryNoteDocument.ts`, `src/services/pdf.ts`: renderizado.
- `src/services/deliveryNotes/deliveryNoteService.ts`: creación del remito definitivo.
- `prisma/schema.prisma`: `WhatsAppMessage`, `WhatsAppConversation`, `Quote`, `DeliveryNote` y `Document`.

## Estado conversacional actual

El estado comercial no tiene una entidad propia. Se serializa completo en `WhatsAppConversation.pendingJson` mediante `PendingDeliveryDraft`.

`PendingDeliveryDraft` mezcla:

- tipo de documento;
- payload comercial;
- estado;
- cliente y candidatos;
- items;
- nombres de archivo;
- token y ruta del preview;
- versiones;
- expiración;
- datos de diagnóstico del clasificador.

Los estados disponibles son incompletos:

```text
COLLECTING_INFORMATION
READY_FOR_PREVIEW
WAITING_CONFIRMATION
CANCELLED
EXPIRED
```

La fase real se representa además con `awaiting`:

```text
customer
customer_selection
items
prices
review
```

La combinación de ambos campos permite estados contradictorios. No existen estados explícitos para selección de tipo, documento finalizado ni transición entre documentos.

El borrador no tiene ID persistido ni filas de items. Los `lineId` se guardan dentro del JSON y no están protegidos por restricciones de base de datos.

## Orden actual de clasificación

Dentro de `answerAssistant` el orden observado es:

1. Menú y selección numérica.
2. Detección general de tipo de documento.
3. `resolveDocumentConversationMessage`.
4. Acciones no soportadas.
5. Cancelación.
6. Consulta externa.
7. Respuesta esperada para selección de cliente.
8. Respuesta esperada para captura de cliente.
9. Cambio de nombre.
10. Cambio de cliente.
11. `applyCommercialDraftMutation`.
12. Filtro de mensaje ambiguo.
13. Append/update genérico.
14. Confirmación.
15. Preview.
16. Consultas globales y creación de documento nuevo.

Este orden no coincide con el contrato comercial requerido. En particular, resumen, preview, confirmación, precio, cantidad y referencias no comparten una única clasificación tipada.

## Puntos donde se pierde o reinicia el borrador

1. Un pedido explícito de otro tipo de documento reemplaza implícitamente el borrador activo. No existe una transición para guardar, descartar o mantener ambos contextos.
2. La respuesta final de confirmación no devuelve `pendingDeliveryDraft`; la ruta pone `pendingJson = null`. Si el proceso comercial falla a mitad de camino, no existe un estado persistido de confirmación en progreso.
3. Los borradores expirados continúan físicamente en `pendingJson`. La ruta principal no los migra ni limpia antes de usarlos.
4. La versión está en memoria/JSON. Dos mensajes concurrentes pueden leer la misma versión y escribir estados incompatibles.
5. El chat web guarda el estado dentro de `AssistantMessage.sourcesJson`, mientras WhatsApp lo guarda en `WhatsAppConversation.pendingJson`. Hay dos mecanismos de persistencia.
6. La regeneración de preview crea un nuevo objeto `PendingDeliveryDraft` y después copia versiones manualmente. Esto facilita perder campos al agregar nuevas propiedades.

## Órdenes interpretadas como items

- `agrega que caminamos sobre un techo`: el prefijo `agrega que` no se elimina por una función dependiente de la acción; puede terminar dentro de la descripción.
- `resumen`: no está clasificado como estado/resumen y cae en `AMBIGUOUS`.
- `resumen PDF`: depende de que el regex de preview encuentre `pdf`; no existe una acción de resumen con salida PDF.
- `al item uno ponle 20000`: no coincide con el parser de precio actual y el número puede hacer que se considere contenido comercial.
- `precio del item 2 a 20000`: el parser exige inicialmente `cambia`, `corrige`, `pone` o `pon`.
- Mensajes con números o palabras comerciales pasan por `isLikelyCommercialItemEntry` antes de contar con una clasificación estructurada completa.

## Mutaciones interpretadas como append

`documentConversationResolver` clasifica cualquier corrección como `UPDATE_DOCUMENT_DRAFT`, pero si `applyCommercialDraftMutation` no reconoce su forma exacta, la rama posterior procesa `UPDATE_DOCUMENT_DRAFT` con el parser de creación y agrega los items extraídos.

Casos afectados:

- números escritos con palabras (`ítem uno`, `segundo`);
- `último`, `último punto`, `el anterior`;
- órdenes de precio sin verbo;
- referencias textuales como `el de la noria`;
- reemplazos cuyo objetivo no es también una descripción completa de item.

Una mutación fallida no tiene un tipo de error que bloquee de forma definitiva el append.

## Reemplazos incorrectos

`parseCommercialDraftMutation` produce una única mutación `replace`.

`applyCommercialDraftMutation`:

1. usa el texto a reemplazar como referencia para localizar el item;
2. encuentra el item que contiene ese texto;
3. reemplaza la descripción completa por el texto nuevo.

Por eso:

```text
Techado de galpón con 14 metros
Cambia 14 metros por 16 metros
```

puede terminar en:

```text
16 metros
```

No existen operaciones separadas para reemplazo parcial y reemplazo completo.

## Referencias a items

La implementación actual soporta principalmente:

- índice numérico con dígitos;
- coincidencia por tokens de descripción.

No existe un modelo `ItemReference`. No se soportan de forma confiable:

- primero/primer item;
- último/último punto/último item;
- anterior;
- números escritos con palabras;
- `lineId`;
- referencia textual normalizada con una fase explícita de desambiguación.

La descripción se usa de hecho como identificador de búsqueda.

## Preview y confirmación

- El preview se almacena como archivo antes de confirmar, correctamente separado del `Document` definitivo.
- `draftVersion` y `previewVersion` existen, pero no tienen control optimista en base de datos.
- Una edición invalida `previewVersion`, pero el mecanismo está repetido en varias ramas.
- Una confirmación con preview obsoleto se rechaza y exige pedir PDF manualmente; no se regenera de forma automática.
- La creación definitiva no tiene clave idempotente.
- Dos confirmaciones válidas pueden crear dos `Quote`/`DeliveryNote` y dos `Document`.
- El guardado del registro comercial, del PDF y del `Document` no ocurre en una única unidad idempotente.
- Los previews abandonados no tienen un recolector persistente.

## Nombres de archivo

- `ensurePdfFileName` y `safeFileName` ofrecen una defensa parcial.
- `guardalo como ...` se detecta como confirmación y el nombre se extrae más tarde.
- `cambia el nombre ...` se procesa antes que confirmar.
- El nombre solicitado y el nombre sugerido comparten un único campo.
- No existe `requestedFileName` separado.
- Cambiar el nombre no incrementa versión; esto es correcto para contenido, pero no queda registrada una versión de metadatos ni una decisión explícita de confirmación.
- La validación y el rechazo de path traversal dependen de la implementación genérica de `safeFileName`, sin un error comercial específico.

## Precios y moneda

- `parseLocalDraft` asigna ARS aunque el mensaje no especifique moneda.
- No se consulta una moneda predeterminada de empresa.
- Se reconocen algunos números con separadores, pero no hay un parser único para `20 mil`, `20k`, USD/U$S/pesos en todas las acciones.
- `$` y USD están tratados por expresiones diferentes y pueden producir resultados inconsistentes.
- Los items sin precio se crean a menudo con `unitPrice: 0`.
- Las validaciones usan `<= 0` como “precio faltante”, por lo que no distinguen precio desconocido de cero explícito.
- `normalizeDraftItems` convierte un faltante en cero al preparar documentos.
- `500t` puede interpretarse como cantidad o quedar incrustado en texto; no existe una regla de capacidad.
- Cliente, item y precio dentro de una frase dependen del parser LLM o de regex que no comparten el mismo contrato.

## Persistencia, concurrencia e idempotencia

- `providerMessageId` tiene restricción única, lo que evita duplicados persistidos simples.
- Antes del `upsert`, el webhook hace una consulta de duplicado. Dos workers pueden superar esa consulta y ambos continuar después del mismo `upsert`.
- El webhook responde `200` antes de completar el procesamiento asíncrono. Un reinicio puede dejar un mensaje guardado pero sin transición aplicada.
- No existe estado `PROCESSING/PROCESSED/FAILED` usado como claim transaccional.
- No hay control de orden por timestamp de Meta.
- `pendingJson` se actualiza sin comparar `draftVersion`.
- La confirmación definitiva no es idempotente.
- Los logs no incluyen sistemáticamente `providerMessageId`, `draftId`, versión y acción.

## Carencias de pruebas

La suite inicial cubre helpers y escenarios felices, pero no cubre:

- la conversación completa solicitada, turno por turno;
- `resumen` ni `resumen PDF`;
- `último`, palabras ordinales ni `el anterior`;
- reemplazo parcial conservando el resto de la descripción;
- órdenes de precio sin verbo;
- separación obligatoria entre comando y contenido;
- extracción conjunta cliente/item/precio para silo/capacidad;
- persistencia real después de reinicio;
- dos confirmaciones;
- carrera de dos mensajes;
- retry después de fallo;
- fallo al enviar PDF;
- preview abandonado;
- nombre personalizado confirmado en una sola operación;
- cambio de tipo con borrador activo.

Los scripts de simulación no forman parte de `npm test` y varios dependen de una base real.

## Causas concretas en el fixture obligatorio

| Mensaje | Causa actual |
| --- | --- |
| `Hola` | No inicia ni limpia estado; puede conservar un `pendingJson` vencido. |
| `Quiero armar un remito` | Inicia captura, pero el estado sigue siendo un JSON sin ID ni lock. |
| `Mario Alvarez` | La selección funciona si existe una coincidencia única. |
| `Le mejoramos... y limpiamos...` | La separación depende de una lista limitada de verbos y regex. |
| `Pasame el PDF` | Se reconoce, genera archivo preview. |
| `guardalo como ...` | Puede confirmar, pero no es idempotente; un borrador viejo o cliente mal resuelto hace fallar toda la operación. |
| `agrega que ...` | El prefijo puede guardarse literalmente. |
| `saca el ultimo punto` | `ultimo punto` se busca como texto. |
| `Cambia 14 metros por 16 metros` | Se reemplaza la descripción completa. |
| `resumen` | Cae en ambiguo. |
| `al item uno ponle 20000$` | No coincide con la gramática de precio y puede agregarse como item. |
| `precio del item 2 a 20000` | Falta el verbo requerido por el regex. |
| `Emancipacion silo 500t 20000` | No hay separación determinista de cliente, capacidad y precio. |

La regresión principal tiene además una colisión exacta entre clasificadores: para
`guardalo como remito-mario-alvarez-2307`, el resolver devuelve
`CONFIRM_DOCUMENT`, pero `detectDraftIntent()` devuelve `delivery_note` porque
encuentra `guard...` y `remito`. Como el bloque que opera sobre el borrador exige
`intent === "none"`, se omite la confirmación y se inicia un remito nuevo. Ese
nuevo borrador reemplaza el anterior y vuelve a solicitar cliente.

## Arquitectura objetivo

Se implementará una única fuente de verdad en `src/services/commercialAssistant/`:

```text
normalizer
  -> actionClassifier
  -> parameterExtractor / mutationParser
  -> itemReferenceResolver
  -> stateMachine
  -> draftService
  -> responseBuilder
```

La generación de PDF y la confirmación permanecerán detrás de servicios con entradas estructuradas. `assistant.ts` será una fachada para compatibilidad.

## Plan de migración compatible

1. Agregar tablas `CommercialDraft` y `CommercialDraftItem` sin eliminar `pendingJson`.
2. Al cargar una conversación sin `CommercialDraft`, migrar de manera oportunista el JSON vigente.
3. Mantener serialización de compatibilidad durante una versión para el chat web y rollback.
4. Persistir cada transición con `draftVersion` y actualización condicional.
5. Registrar preview y documento final en el draft.
6. Añadir una clave de confirmación/idempotencia.
7. Una vez verificados producción y rollback, dejar `pendingJson` como snapshot de compatibilidad o retirarlo en una migración posterior.

Datos existentes que deben conservarse:

- conversaciones y mensajes;
- `pendingJson` legible;
- `lineId` existentes;
- rutas de previews todavía vigentes;
- `Quote`, `DeliveryNote` y `Document` ya creados.

## Plan de rollback

La primera migración será aditiva. El rollback operativo consiste en:

1. desplegar la versión anterior;
2. continuar leyendo `pendingJson`;
3. dejar las tablas nuevas sin uso;
4. no borrar tablas ni columnas hasta terminar el período de compatibilidad.

No se modificará ni eliminará información comercial existente durante la migración.

## Archivos previstos

Nuevos:

- `src/services/commercialAssistant/types.ts`
- `src/services/commercialAssistant/normalizer.ts`
- `src/services/commercialAssistant/actionClassifier.ts`
- `src/services/commercialAssistant/parameterExtractor.ts`
- `src/services/commercialAssistant/itemReferenceResolver.ts`
- `src/services/commercialAssistant/stateMachine.ts`
- `src/services/commercialAssistant/draftService.ts`
- `src/services/commercialAssistant/responseBuilder.ts`
- `src/services/commercialAssistant/orchestrator.ts`
- tests y fixture bajo el mismo directorio
- migración Prisma aditiva
- documentación de estados y regresiones

Modificados:

- `prisma/schema.prisma`
- `src/services/assistant.ts`
- `src/routes/whatsapp.ts`
- `src/routes/assistant.ts`
- pruebas existentes relacionadas

Los módulos de renderizado se reutilizarán salvo que las pruebas demuestren un defecto específico de contenido.
