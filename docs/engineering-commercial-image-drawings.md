# Imágenes comerciales orientativas de Ingeniería

## Alcance

Este flujo genera láminas PNG para acompañar presupuestos. No reemplaza el motor paramétrico SVG/PDF existente y no produce documentación apta para fabricación, montaje, cálculo estructural ni certificación.

La imagen de referencia obligatoria está en:

`assets/engineering-image-templates/plant-silos-a3-reference.png`

Una muestra revisada del caso de cuatro silos está en:

`assets/engineering-image-examples/four-silo-400t-example.png`

La plantilla fija la composición visual: hoja horizontal, marco, grilla, referencias, vista principal, tablas, notas, corte esquemático y carátula FMH.

## Arquitectura

```text
Formulario de Ingeniería
  -> POST /api/engineering/commercial-image-drawing
  -> validación estricta con Zod
  -> prompt comercial cerrado
  -> OpenAI Images API / images.edit
     - plantilla original como entrada
     - gpt-image-2-2026-04-21
     - high
     - 2048x1440
     - PNG
     - dos alternativas
  -> evaluación visual con GPT-5.6
  -> promedio determinístico de diez criterios
  -> reintento desde la plantilla original si el puntaje es menor a 7
  -> almacenamiento seguro bajo UPLOAD_DIR
  -> registro persistente y asociación opcional a presupuesto
```

El servicio principal es `src/services/engineering/commercial-image-drawing.ts`. El flujo no importa ni invoca los renderizadores SVG.

## Entidad persistida

`EngineeringCommercialImageDrawing` conserva:

- empresa, cliente y presupuesto;
- tipo, proyecto y título;
- modelo y plantilla;
- solicitud normalizada y prompt final;
- informe de evaluación;
- ruta interna segura y SHA-256 del PNG;
- puntuación e intentos;
- responsable y estado.

La ruta de almacenamiento nunca es aceptada desde el cliente ni expuesta en la respuesta pública.

## Endpoints

- `GET /api/engineering/commercial-image-drawing/status`
- `POST /api/engineering/commercial-image-drawing`
- `GET /api/engineering/commercial-image-drawings/:id/image?companyId=...`
- `POST /api/engineering/commercial-image-drawings/:id/associate-budget`

## Configuración

```dotenv
OPENAI_API_KEY=
OPENAI_ENGINEERING_IMAGE_MODEL=gpt-image-2-2026-04-21
OPENAI_ENGINEERING_IMAGE_SIZE=2048x1440
OPENAI_ENGINEERING_IMAGE_QUALITY=high
OPENAI_ENGINEERING_IMAGE_EVALUATION_MODEL=gpt-5.6
OPENAI_ENGINEERING_IMAGE_MIN_SCORE=7
```

La generación mediante API necesita saldo independiente de ChatGPT/Codex y una organización habilitada para GPT Image. La interfaz permanece visible cuando falta la clave, pero informa el estado y deshabilita la generación.

## Ejemplo de cuatro silos

```json
{
  "companyId": "COMPANY_ID",
  "drawingType": "GRAIN_STORAGE_PLANT",
  "projectName": "Planta de almacenamiento",
  "customerName": "Cliente",
  "budgetNumber": "P-0001",
  "title": "Distribución general en planta",
  "product": "Trigo",
  "capacity": "4 silos de 400 t",
  "equipmentDescription": "Cuatro silos metálicos circulares en matriz 2 x 2, noria central, recepción a la izquierda y despacho a la derecha.",
  "equipmentList": [
    "Silo metálico 1 — 400 t",
    "Silo metálico 2 — 400 t",
    "Silo metálico 3 — 400 t",
    "Silo metálico 4 — 400 t",
    "Noria de cangilones — 150 t/h",
    "Transportador principal — 150 t/h",
    "Tolva de recepción",
    "Salida de despacho"
  ],
  "approximateDimensions": [
    "Diámetro orientativo de silos: 15.000 mm",
    "Superficie aproximada: 68.000 x 60.000 mm",
    "Altura orientativa de silos: 19.500 mm"
  ],
  "requestedViews": [
    "Vista general en planta",
    "Corte frontal esquemático inferior",
    "Tabla de equipos",
    "Flechas de flujo"
  ],
  "additionalNotes": [
    "Imagen comercial preliminar"
  ]
}
```

## Limitaciones

- Los modelos de imagen pueden deformar textos, cifras o símbolos pequeños.
- La evaluación prioriza composición y utilidad comercial, no exactitud técnica.
- Dos generaciones con la misma entrada pueden variar.
- El resultado debe revisarse antes de enviarlo al cliente.
- La generación en vivo depende de saldo, permisos y límites de la cuenta de API.

## Referencias oficiales

- [OpenAI Image generation](https://developers.openai.com/api/docs/guides/image-generation)
- [OpenAI GPT Image 2](https://developers.openai.com/api/docs/models/gpt-image-2)
