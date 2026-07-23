# Arquitectura operativa

## Componentes

| Capa | Responsabilidad |
|---|---|
| React/Vite | panel, remitos, presupuestos, facturas, WhatsApp e ingeniería |
| Fastify | API, autenticación de operador, validación, archivos y webhooks |
| Prisma/PostgreSQL | estado comercial, trazabilidad, conversaciones y biblioteca técnica |
| almacenamiento privado | originales, PDFs, previews y fuentes técnicas |
| Meta Cloud API | entrada/salida de WhatsApp |
| OpenAI opcional | interpretación comercial y asistencia de ingeniería con fallback local |

## Flujos centrales

```text
Remitos del mes
  -> selección de un cliente y un mes
  -> revisión de líneas y precios
  -> subtotal + IVA + total
  -> confirmación humana
  -> transacción serializable
     -> presupuesto borrador
     -> factura borrador
     -> vínculos con remitos
     -> estados + auditoría

WhatsApp
  -> firma Meta + número de teléfono + operador permitido
  -> deduplicación del mensaje
  -> conversación persistente
  -> borrador editable
  -> preview temporal
  -> confirmación/cancelación
  -> documento y registro comercial

Ingeniería
  -> conversación y datos conocidos
  -> supuestos explícitos cuando faltan datos
  -> herramientas determinísticas
  -> materiales/BOM + barras/cortes + costo conocido
  -> fuentes y nivel de confianza
  -> plano orientativo rotulado como no apto para fabricación
```

## Límites deliberados

- Los planos y cálculos son preliminares; requieren revisión profesional antes de fabricar.
- ARCA no está implementado y permanece bloqueado.
- HTTP Basic cubre una instalación privada, no un producto multiempresa.
- `scripts/migrateSqliteToPostgres.ts` está bloqueado porque la versión histórica era destructiva e incompleta.
- Los documentos no se sirven como carpeta estática; sólo salen por endpoints controlados.

## Reglas de consistencia

- Un cierre no mezcla empresas, clientes, meses ni monedas.
- Un remito sólo puede cerrarse si está pendiente.
- Los precios del cierre deben ser positivos.
- La numeración se calcula dentro de una transacción serializable y reintenta colisiones.
- El número impreso de un remito se obtiene del registro persistido.
- La autorización fiscal es un paso separado del cierre comercial.
