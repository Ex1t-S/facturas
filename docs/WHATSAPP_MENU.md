# Menú de WhatsApp FMH

El bot muestra este menú cuando recibe `menu`, `inicio` u `opciones`:

1. **Remito**: inicia un borrador y acepta audio transcripto o texto escrito.
2. **Presupuesto**: inicia el flujo comercial existente para cliente, ítems, precios, preview y confirmación.
3. **Clientes**: permite crear un cliente con nombre y datos opcionales (CUIT, teléfono, email y domicilio).
4. **Consultas**: busca presupuestos y remitos por cliente y fecha (`DD/MM/AAAA`).

La selección se guarda en `WhatsAppConversation.pendingJson`, por lo que no depende del historial en memoria ni se pierde si se reinicia el proceso. No requiere migración Prisma: reutiliza `Customer`, `Quote` y `DeliveryNote`.

Ejemplos:

```text
menu
4
Mario Alvarez 23/07/2026
```

Para agregar un cliente:

```text
menu
3
Mario Alvarez, CUIT 20-12345678-9, telefono 2923 555555
```
