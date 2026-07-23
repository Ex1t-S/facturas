# Cinco propuestas de plantilla FMH

Fecha de preparación: 23/07/2026.

Estas propuestas son muestras A4 editables para elegir una línea visual. Ninguna reemplaza todavía las plantillas activas de producción.

## Recomendación rápida

1. **Industrial Clásica** — recomendada. Es la opción más equilibrada para presupuestos, remitos, impresión y envío por WhatsApp.
2. **Ingeniería Azul** — recomendada si se quiere reforzar la imagen técnica de proyectos, silos y montajes.
3. **Minimal Técnica** — la mejor para impresión frecuente en blanco y negro.
4. **Seguridad Industrial** — la alternativa con mayor impacto visual y carácter de taller.
5. **Campo & Acero** — una identidad industrial más cercana al sector agropecuario.

## Archivos

Cada subcarpeta contiene:

- Un Presupuesto editable en DOCX.
- El mismo Presupuesto convertido a PDF.
- Un Remito editable en DOCX.
- El mismo Remito convertido a PDF.
- Una vista previa PNG de cada documento.

La comparación completa está en `00-comparativa-visual.png`.

## Variante verde con logo

`01-industrial-clasica-verde/` contiene una variante del Modelo 1 con el logo FMH provisto, paleta verde/gris y el mismo bloque de totales simétrico. Incluye DOCX, PDF y vista previa PNG.

## Qué se mejoró respecto de la plantilla actual

- Jerarquía clara entre marca, tipo de documento, número, cliente y fecha.
- Detalle tabular con cantidades, unidades y valores alineados.
- Subtotal, IVA y total separados.
- Condiciones comerciales visibles y ordenadas.
- Sector de firmas para FMH y el cliente.
- Remito con recepción conforme, aclaración, DNI y fecha.
- Tipografía sans serif legible y diseño consistente entre Presupuesto y Remito.
- Una sola página A4 en las diez muestras.
- Compatibilidad comprobada mediante conversión real con LibreOffice.

## Problemas de la plantilla actual observados

- El Presupuesto base se divide en dos páginas y deja el cierre solo en la segunda.
- Usa textos y viñetas como estructura de datos; los precios se alinean con puntos.
- No muestra subtotal, impuestos y total como un bloque inequívoco.
- En el Remito, el rótulo “DETALLE” se corta en dos líneas.
- Hay exceso de bordes, cursivas y áreas vacías sin función.
- Presupuesto y Remito presentan datos de contacto e identidad con criterios diferentes.
- El generador actual encuentra frases dentro del DOCX para reemplazarlas; eso vuelve frágil cualquier cambio de texto.

Cuando se elija una propuesta, el paso siguiente es convertirla en plantilla productiva con marcadores estructurados y adaptar el generador sin depender de frases de ejemplo.
