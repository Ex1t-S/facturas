# Auditoría de almacenamiento documental — 23/07/2026

## Alcance

Se auditó la base PostgreSQL y el almacenamiento persistente del VPS usado por `fmh.ex1ts-vault.site`.

Se verificaron:

- Registros de `Document`.
- Resolución de `storagePath`.
- Existencia y tamaño de cada archivo.
- Coincidencia SHA-256 con la base.
- Firma binaria según PDF, DOCX, JPEG u OGG.
- Endpoints de contenido, descarga y vista previa.

## Hallazgo inicial

La base contenía 819 registros, pero el VPS sólo tenía un archivo físico accesible. La migración de la base había quedado separada de la migración del directorio de archivos.

## Recuperación realizada

- Se localizaron archivos del repositorio local por SHA-256, independientemente de que su ruta histórica indicara junio o julio.
- Se migraron 784 registros coincidentes al volumen persistente del VPS.
- Se recuperaron cinco medios recientes directamente desde Meta usando su identificador.
- Se regeneró un remito PDF a partir del remito estructurado, su cliente y sus ítems, y se actualizó su hash y ruta.
- Se intentó recuperar los restantes tanto desde Meta como desde el antiguo servicio de Render.

## Resultado final

| Control | Resultado |
|---|---:|
| Registros totales | 819 |
| Archivos legibles y no vacíos | 791 |
| SHA-256 correcto | 791 |
| Firma binaria correcta | 791 |
| PDF accesibles | 406 de 406 |
| DOCX accesibles | 374 de 374 |
| JPEG accesibles | 6 de 7 |
| OGG accesibles | 5 de 32 |
| Archivos comerciales, históricos, demo o generados accesibles | 786 de 786 |
| Medios antiguos de WhatsApp no recuperables | 28 |

Los 28 faltantes son exclusivamente adjuntos de WhatsApp antiguos: 27 audios OGG y una imagen JPEG. No existe copia local por hash; Render responde archivo ausente y Meta ya no expone esos IDs. No se eliminaron sus registros para preservar el historial y la transcripción asociada.

## Verificación de endpoints

Se probaron muestras reales de cada tipo disponible:

| Tipo | Contenido | Descarga | Vista previa |
|---|---|---|---|
| PDF | 200, inline | 200, attachment | `pdf` |
| DOCX | 200, attachment | 200, attachment | `html` |
| JPEG | 200, inline | 200, attachment | `image` |
| OGG | 200, attachment | 200, attachment | `unsupported` |

El audio no tiene reproductor inline en la implementación actual, pero sí se descarga.

## Riesgos y siguientes mejoras

- Mantener copia programada de PostgreSQL y del volumen `/opt/fmh-gestion-data/uploads`.
- Incorporar una auditoría automática que compare base, archivos y SHA-256.
- Considerar almacenamiento de objetos compatible con S3 para evitar que una migración de aplicación omita los binarios.
- Mostrar en la interfaz un estado explícito para los 28 medios históricos no recuperables.
- El limitador global protege el servidor, pero su respuesta masiva se registra como 500; conviene preservar el código 429 en una corrección separada.
