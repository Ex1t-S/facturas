# Registro de auto-mejora

## 2026-07-23

### Remitos y facturación

- Se agregó navegación operativa por mes y estado.
- Se incorporó selección rápida de remitos pendientes por cliente.
- Se agregó edición de precios durante la revisión.
- Se creó el cierre mensual transaccional a factura A/B en borrador.
- Se sincronizan estados de remitos y presupuesto.
- Se registra auditoría del cierre.
- La creación de factura desde presupuesto es idempotente.

### WhatsApp

- Se verificó el nuevo flujo comercial con 20 escenarios.
- Se corrigió el historial para incluir entradas y salidas de la conversación.
- Se toman los 20 mensajes más recientes en orden cronológico.
- Se agregó prueba de regresión para selección numérica del menú.

### Ingeniería

- Se conectó el cómputo existente de materiales al orquestador.
- Los resultados muestran cantidades, metros, peso, barras, sobrantes, precios faltantes y costo conocido.
- Cuando faltan datos se permiten escenarios ilustrativos con hipótesis visibles.
- Se expuso la descarga del plano orientativo en la interfaz.
- El archivo generado conserva la advertencia de no apto para fabricación.
- El asistente reconoce pedidos naturales y el typo “plaano” para un silo de 200 t.
- La plantilla FMH genera elevación, planta de apoyos, cotas, hipótesis y cajetín con advertencia de anteproyecto.
- Las dimensiones ilustrativas de un silo incompleto se informan siempre y nunca se presentan como deducidas de la capacidad.
- Los planes de corte de chapa se separan de los planos estructurales; el caso 20 piezas de 150 × 150 mm propone 9 + 9 + 2 y exige confirmar si son placas o tubos.
- La búsqueda de planos unifica la biblioteca histórica y `EngineeringKnowledgeDocument`; ya recupera los dos planos Vitabull y no expone rutas internas.

### UI/UX profesional

- Se reemplazó la navegación plana por una arquitectura agrupada en Operación, Gestión y Herramientas.
- Se creó un sistema visual industrial sobrio con tokens, jerarquía tipográfica, estados y controles consistentes.
- Se rediseñaron el dashboard, las métricas, las acciones frecuentes y la actividad reciente.
- Remitos y cierre mensual ahora priorizan mes, cliente, pendientes, precios y preparación de factura.
- Se unificaron tablas, formularios, directorios, documentos, inventario, WhatsApp y configuración.
- El asistente comercial dejó de presentarse como una pantalla genérica de IA.
- Ingeniería se integró como mesa técnica con casos, cálculos, planos, biblioteca y revisión humana.
- El chat de Ingeniería se simplificó como conversación: respuestas sin tarjetas, sin panel “análisis técnico”, logo FMH legible y compositor de ancho útil.
- Se corrigió el estado vacío duplicado en Remitos.
- Se incorporaron foco visible, reducción de movimiento y comportamiento responsive desde 390 px.
- Se documentó el sistema en `docs/UI_SYSTEM.md`.

### Calidad

- `npm run typecheck`: aprobado.
- `npm run build`: aprobado.
- `npm test`: 100 aprobadas, 1 omitida.
- Simulación comercial: aprobada.
- Etapa 2 comercial: 20/20 aprobadas.

### Seguridad, integridad y operación

- Se activó HTTP Basic obligatorio en producción.
- Se restringieron CORS, errores, logs y tasa de solicitudes.
- Los documentos dejaron de exponerse como archivos estáticos y se acotaron por empresa.
- Webhook, operadores y medios de WhatsApp tienen validaciones obligatorias.
- Se agregaron transacciones serializables y reintentos para numeración.
- El número impreso del remito ahora proviene del registro persistido.
- El migrador SQLite a PostgreSQL quedó bloqueado por ser destructivo e incompleto.
- `npm audit --omit=dev`: 0 vulnerabilidades.
