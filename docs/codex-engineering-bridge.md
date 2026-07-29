# Puente Codex para Ingeniería FMH

## Alcance

El puente permite usar temporalmente una sesión de Codex autenticada con ChatGPT para interpretar solicitudes de planos comerciales cuando la API de OpenAI no está disponible por saldo.

Codex no genera el plano y no calcula valores técnicos. Su única salida permitida es una extracción estructurada con datos explícitos del usuario y `null` para datos faltantes:

```text
texto del usuario
  -> Codex CLI + JSON Schema estricto
  -> EngineeringDesignRequestV2
  -> DesignPack determinístico
  -> EngineeringDesignResultV2
  -> DrawingScene
  -> SVG / PDF A3
```

## Seguridad

- Ejecución efímera con `codex exec --ephemeral`.
- Sandbox de sólo lectura.
- Directorio temporal aislado, fuera del repositorio.
- No se cargan reglas ni configuración personal.
- El proceso hijo recibe un entorno mínimo: no hereda base de datos, WhatsApp, OpenAI ni otros secretos de la aplicación.
- Una sola ejecución concurrente por defecto.
- Timeout máximo de 120 segundos.
- Prompt por `stdin`; no se construyen comandos de shell con texto del usuario.
- Salida validada por JSON Schema y Zod.
- La autenticación no se guarda en Git ni dentro de la imagen Docker.
- La ruta continúa protegida por la autenticación privada de la aplicación.

## Variables

```text
CODEX_ENGINEERING_BRIDGE_ENABLED=true
CODEX_ENGINEERING_BRIDGE_ALLOW_PRODUCTION=true
CODEX_ENGINEERING_BRIDGE_MODEL=gpt-5.6-sol
CODEX_ENGINEERING_BRIDGE_TIMEOUT_MS=120000
CODEX_ENGINEERING_BRIDGE_MAX_CONCURRENCY=1
CODEX_HOME=/root/.codex
```

En desarrollo `ALLOW_PRODUCTION` puede permanecer en `false`. En la VPS privada debe habilitarse de forma explícita.

## Autenticación en VPS

La imagen instala una versión fijada de Codex CLI. El directorio `/root/.codex` del contenedor debe montarse desde `/opt/fmh-codex-home` en el host para conservar y refrescar la sesión.

Método recomendado para una VPS sin navegador:

```bash
docker exec -it fmh-app codex login --device-auth
```

Abrir la URL indicada en un navegador confiable e ingresar el código de un solo uso. La documentación oficial recomienda device code para equipos remotos o headless.

Alternativamente, en un entorno privado y confiable se puede copiar el archivo local `~/.codex/auth.json` al volumen persistente mediante SSH. Ese archivo debe tratarse como una contraseña:

```bash
install -d -m 700 /opt/fmh-codex-home
# Transferir auth.json por un canal SSH directo, sin imprimirlo.
chmod 600 /opt/fmh-codex-home/auth.json
```

Nunca pegar su contenido en chat, tickets, logs o variables del repositorio.

## Docker Compose de la VPS

El servicio `fmh-app` necesita:

```yaml
environment:
  CODEX_HOME: /root/.codex
volumes:
  - /opt/fmh-gestion-data/uploads:/app/uploads
  - /opt/fmh-codex-home:/root/.codex
```

Las variables del puente se agregan a `/opt/fmh-deploy/app.env`, que no pertenece al repositorio.

## Diagnóstico

```http
GET /api/engineering/v2/ai/status
```

Resultado esperado:

```json
{
  "enabled": true,
  "configured": true,
  "productionAllowed": true,
  "authenticated": true,
  "model": "gpt-5.6-sol",
  "reason": null
}
```

Prueba funcional:

```http
POST /api/engineering/v2/designs/interpret
Content-Type: application/json

{
  "description": "Necesito un silo para 400 toneladas de trigo, fondo cónico, con descarga a 4 metros del piso."
}
```

El resultado debe contener capacidad `400`, material `trigo`, descarga libre `4000` mm y `null`/`missingData` para las dimensiones no aportadas.

## Operación

- Si Codex no está autenticado, el botón de interpretación queda deshabilitado.
- El formulario y el DesignPack determinístico siguen funcionando sin IA.
- Al disponer nuevamente de saldo API, conviene usar Structured Outputs en Responses API como proveedor primario y conservar este puente sólo como contingencia privada.
