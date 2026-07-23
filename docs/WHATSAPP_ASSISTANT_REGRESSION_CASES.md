# Casos de regresión del asistente de WhatsApp

Fecha: 2026-07-23

## Fixture principal

El fixture está en `src/services/commercialAssistant/conversationRegression.fixture.ts` y su ejecución turno por turno en `conversationRegression.test.ts`.

| Turno | Acción esperada | Comprobaciones |
| --- | --- | --- |
| Hola | fuera del flujo comercial | no crea ni altera borrador |
| Quiero armar un remito | `START_DRAFT` | `COLLECTING_CUSTOMER`, cero ítems |
| Mario Alvarez | `SELECT_CUSTOMER` | cliente único y mismo `draftId` |
| Le mejoramos una batea y limpiamos los cabezales de una noria | `APPEND_ITEMS` | dos líneas limpias, IDs estables |
| Pasame el PDF | `GENERATE_PREVIEW` | no crea documento definitivo, `previewVersion === draftVersion` |
| guardalo como remito-mario-alvarez-2307 | `CONFIRM_DOCUMENT` | mismo cliente, mismos ítems, nombre `.pdf`, un documento |

## Mutaciones

Cubiertas automáticamente:

- `agrega que caminamos sobre un techo`: guarda sólo `Caminamos sobre un techo`.
- `saca el ultimo punto`, `saca el último`: resuelve `LAST`.
- `borra el item uno`, `elimina el primero`: resuelve índice/ordinal.
- `saca que caminamos sobre un techo`: resuelve por texto y no reinyecta el comando.
- `Techado de galpon con 14 metros`: crea una línea.
- `Cambia 14 metros por 16 metros`: reemplazo parcial conservando el resto.
- `Cambia 16 metros por techado de galpon 14 metros`: reemplazo completo de la línea encontrada; no hace append.
- referencias ambiguas: enumera opciones y no muta.

## Precio, moneda y cantidad

Cubiertos:

- `20000`, `$20000`, `20000$`, `20.000`, `20 mil`, `20k`.
- `USD`, `U$S`, dólares, ARS y pesos.
- `$` hereda la moneda activa y no significa USD.
- `al item uno ponle 20000$`.
- `cambia el precio del item 1 a 50000`.
- `precio del item 2 a 20000`.
- `pone 20 mil al segundo`.
- precio desconocido permanece ausente.
- cero explícito se acepta.
- `Silo 500t 20000`: capacidad en descripción, cantidad uno y precio 20.000.

## Resumen y PDF

- `resumen` usa `SHOW_SUMMARY`, muestra cliente, moneda, líneas, cantidades, precios, subtotales, total conocido y faltantes.
- `resumen PDF` y `pasame el PDF` usan `GENERATE_PREVIEW`.
- si faltan precios, sólo enumera descripciones comerciales.
- el buffer de prueba del PDF contiene únicamente las líneas vigentes.
- editar invalida el preview.
- confirmar después de editar regenera.
- confirmar dos veces no ejecuta dos finalizaciones.

## Tipo de documento

- un borrador activo no se reemplaza por `Ahora armame un presupuesto`;
- la respuesta indica el documento y cliente pendientes;
- un documento finalizado permite iniciar otro limpio;
- el caso de una frase única para La Emancipación produce un presupuesto, un cliente y un ítem.

## Webhook y persistencia

- índice único de `providerMessageId`;
- claim por inserción, no por check-then-act;
- estado `PROCESSING`, `COMPLETED`, `FAILED` u `OUT_OF_ORDER`;
- contador de intentos y lease;
- persistencia serializable de snapshot y líneas;
- lock por versión;
- recuperación desde `legacyPayloadJson` después de reinicio;
- finalización única por `commercialDraftId`;
- el estado se persiste antes de intentar enviar el PDF;
- el endpoint manual incrementa intentos y reusa el estado persistido.

## Comandos de verificación

```text
npm install
npx prisma generate
npm run typecheck
npm test
npm run build
```

Pruebas focalizadas:

```text
npx vitest run src/services/commercialAssistant
```

## Archivos de prueba

- `actionClassifier.test.ts`
- `parameterExtractor.test.ts`
- `stateMachine.test.ts`
- `conversationRegression.test.ts`
- `draftRepository.test.ts`
- `webhookPolicy.test.ts`
- tests legacy de `commercialConversation` y `documentConversationResolver`

## Resultado de la ejecución incremental

- caracterización inicial: 6 fallos de 6, confirmando las regresiones.
- parser y máquina de estados: 31 pruebas aprobadas.
- conversación integral: 7 pruebas aprobadas.
- persistencia/política de webhook y compatibilidad: pruebas focalizadas aprobadas.
- suite final: 23 archivos, 159 pruebas aprobadas y 1 omitida previamente existente.
- `npm run typecheck`: aprobado para backend y frontend.
- `npm run build`: aprobado.
