# Revisión de seguridad

Fecha: 2026-07-23

## Estado actual

La aplicación tiene una barrera de autenticación HTTP Basic para el operador. En producción el servidor no inicia si faltan `BASIC_AUTH_USERNAME` o `BASIC_AUTH_PASSWORD`, o si la contraseña tiene menos de 12 caracteres.

Las únicas rutas anónimas son:

- liveness/readiness;
- webhook firmado de Meta;
- descarga temporal de un borrador de WhatsApp mediante token aleatorio con vencimiento.

Esto es adecuado para una primera instalación privada de una sola empresa. No equivale a un sistema multiusuario con roles: una persona que conozca las credenciales de operador puede elegir otro `companyId`. Antes de ofrecer el sistema a empresas independientes hay que agregar usuarios, sesiones, membresías y autorización derivada de la sesión.

## Controles implementados

- CORS por lista explícita de orígenes.
- rate limit global configurable.
- Helmet, límite de cuerpo y límite de archivos.
- errores de producción sin trazas ni mensajes internos;
- `X-Request-Id` en respuestas y logs con secretos redactados;
- documentos fuera del servidor estático, con autorización por empresa, `no-store` y `nosniff`;
- archivos entrantes limitados a tipos admitidos;
- descargas de medios de WhatsApp limitadas a 25 MB, MIME conocido y hosts HTTPS de Meta;
- firma HMAC obligatoria en el webhook;
- validación del `phone_number_id`;
- lista obligatoria de operadores de WhatsApp en producción;
- vencimiento real de enlaces de borradores;
- conversaciones, mensajes, facturas, presupuestos y adjuntos críticos acotados por empresa;
- ARCA continúa bloqueado hasta completar homologación WSAA/WSFEv1.

## Riesgos abiertos

| Riesgo | Nivel | Mitigación actual | Trabajo pendiente |
|---|---|---|---|
| No hay usuarios/roles/membresías | Alto para SaaS; medio para instalación privada | HTTP Basic y despliegue privado | Sesiones, roles y `companyId` tomado de la identidad |
| Historial de migraciones mixto SQLite/PostgreSQL | Alto operativo | Migrador destructivo bloqueado | Crear baseline PostgreSQL verificada |
| Webhook sin cola durable | Medio | deduplicación por ID de Meta y procesamiento en segundo plano | tabla de jobs, leasing, reintentos y dead-letter |
| Idempotencia de factura no reforzada por índice único | Medio | transacción serializable y replay en servicio | auditar duplicados y agregar restricción |
| Integración ARCA incompleta | Alto fiscal si se habilitara | bloqueo intencional y preflight siempre no apto | homologación, idempotencia fiscal y revisión humana |
| Documentos globales con `companyId = null` | Medio en multiempresa | sólo se aceptan junto a una empresa autenticada | migrar propiedad o definir biblioteca compartida explícita |

## Configuración mínima de producción

```text
BASIC_AUTH_USERNAME=<operador>
BASIC_AUTH_PASSWORD=<secreto de 12+ caracteres>
PUBLIC_BASE_URL=https://dominio
CORS_ORIGINS=https://dominio
TRUST_PROXY=true
WHATSAPP_VERIFY_TOKEN=<secreto>
WHATSAPP_APP_SECRET=<secreto Meta>
WHATSAPP_ACCESS_TOKEN=<token Meta>
WHATSAPP_PHONE_NUMBER_ID=<id>
WHATSAPP_ALLOWED_FROM=54911...,549...
```

No usar `change-me`, no subir `.env`, certificados, claves privadas, bases ni documentos reales.
