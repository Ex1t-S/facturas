# Flujos críticos de usuario

## Cierre mensual de remitos

1. Abrir **Remitos**.
2. Elegir mes y estado.
3. Seleccionar un cliente con el acceso rápido; sólo se habilitan sus remitos pendientes del mismo mes.
4. Pulsar **Revisar cierre**.
5. Completar todos los precios unitarios faltantes.
6. Revisar moneda, subtotal, IVA y total calculados.
7. Elegir:
   - **Sólo presupuesto**, o
   - **Preparar factura A/B**.
8. Confirmar explícitamente cliente, tipo y total.
9. Para factura, el backend valida empresa, cliente, mes, moneda, estado, precios e IDs.
10. En una transacción serializable crea el presupuesto interno, la factura `PENDING_CONFIRMATION`, vínculos, estados y auditoría.
11. ARCA está separado y bloqueado hasta completar homologación.

Recuperación:

- Si un remito cambió de estado, el backend responde conflicto y no crea nada.
- Si falta un precio, no se habilita la acción.
- Si se repite un cierre ya facturado y todos los remitos apuntan a la misma factura, se devuelve el resultado existente.

## Remito o presupuesto por WhatsApp

1. El cliente/operador pide menú o un documento directamente.
2. El bot conserva mensajes entrantes y salientes de la conversación.
3. Resuelve cliente por razón social, alias o CUIT; ante ambigüedad muestra opciones.
4. Recibe ítems en uno o varios mensajes, incluidos audios transcritos.
5. Cada línea mantiene ID estable y puede agregarse, borrarse, reemplazarse o corregirse.
6. En presupuestos exige precios positivos.
7. Genera preview; cualquier edición posterior invalida ese preview.
8. Sólo guarda el documento ante una confirmación inequívoca.
9. “Cancelar”, “descartalo” o equivalentes eliminan el borrador pendiente.

Recuperación:

- El `providerMessageId` evita procesar dos veces el mismo mensaje entrante.
- Los fallos de envío quedan registrados con estado `failed`.
- Si no puede adjuntar el PDF, devuelve una explicación y conserva el borrador.

## Ingeniería con datos incompletos

1. El usuario describe el equipo y el objetivo.
2. El sistema extrae datos confirmados y enumera faltantes.
3. Si se pide cómputo/predimensionamiento de un silo sin todas las dimensiones, genera un escenario orientativo con supuestos explícitos.
4. Devuelve cantidades, metros, barras comerciales, plan de cortes, peso cuando hay `kg/m` y costo sólo cuando existe precio conocido.
5. Nunca asigna automáticamente un perfil como verificado.
6. **Plano orientativo** genera un SVG con vistas generales.
7. El archivo y el plano muestran que no son aptos para fabricación.

Para pasar de orientación a fabricación todavía se requiere revisión profesional de acciones, estabilidad, uniones, anclajes, fundaciones y normativa aplicable.
