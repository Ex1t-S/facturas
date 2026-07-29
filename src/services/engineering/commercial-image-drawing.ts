import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import OpenAI, { toFile } from 'openai';
import { z } from 'zod';
import { config } from '../../config.js';
import { prisma } from '../../db.js';
import { readStoredDocumentFile, safeFileName, writeDocumentFile } from '../documentStorage.js';

export const commercialImageDrawingTypes = [
  'SILO_GENERAL',
  'SILO_PLANT',
  'SILO_ELEVATION',
  'GRAIN_STORAGE_PLANT',
  'BUCKET_ELEVATOR',
  'SCREW_CONVEYOR',
  'HOPPER',
  'FEEDER',
  'DRAG_CONVEYOR',
  'COMPLETE_GRAIN_PLANT'
] as const;

export const commercialImageDrawingInputSchema = z.object({
  companyId: z.string().min(1),
  drawingType: z.enum(commercialImageDrawingTypes),
  equipmentType: z.string().trim().max(120).optional().default(''),
  projectName: z.string().trim().max(180).optional().default('Propuesta comercial FMH'),
  customerName: z.string().trim().max(180).optional().default('Cliente a confirmar'),
  budgetNumber: z.string().trim().max(80).optional().default('PENDIENTE'),
  budgetId: z.string().trim().min(1).optional(),
  title: z.string().trim().max(200).optional().default('Diseño comercial orientativo'),
  product: z.string().trim().max(120).optional().default('Producto a confirmar'),
  capacity: z.string().trim().max(120).optional().default('Capacidad orientativa'),
  equipmentDescription: z.string().trim().max(6000).optional().default(''),
  equipmentList: z.array(z.string().trim().min(1).max(300)).max(40).optional().default([]),
  requestedViews: z.array(z.string().trim().min(1).max(300)).max(30).optional().default([]),
  requestedDetails: z.array(z.string().trim().min(1).max(300)).max(30).optional().default([]),
  approximateDimensions: z.array(z.string().trim().min(1).max(300)).max(30).optional().default([]),
  additionalNotes: z.array(z.string().trim().min(1).max(500)).max(30).optional().default([]),
  layoutDescription: z.string().trim().max(4000).optional().default(''),
  generatedBy: z.string().trim().max(160).optional()
}).strict();

export type CommercialImageDrawingInput = z.infer<typeof commercialImageDrawingInputSchema>;

const scoreKeys = [
  'templateSimilarity',
  'technicalDrawingAppearance',
  'sheetUsage',
  'completeFrame',
  'completeTitleBlock',
  'completeTables',
  'requestedEquipmentPresent',
  'professionalComposition',
  'nonArtisticAppearance',
  'generalLegibility'
] as const;

const alternativeEvaluationSchema = z.object({
  index: z.number().int().min(0).max(1),
  templateSimilarity: z.number().min(0).max(10),
  technicalDrawingAppearance: z.number().min(0).max(10),
  sheetUsage: z.number().min(0).max(10),
  completeFrame: z.number().min(0).max(10),
  completeTitleBlock: z.number().min(0).max(10),
  completeTables: z.number().min(0).max(10),
  requestedEquipmentPresent: z.number().min(0).max(10),
  professionalComposition: z.number().min(0).max(10),
  nonArtisticAppearance: z.number().min(0).max(10),
  generalLegibility: z.number().min(0).max(10),
  summary: z.string().max(800)
}).strict();

export const commercialImageEvaluationSchema = z.object({
  alternatives: z.array(alternativeEvaluationSchema).length(2),
  selectionReason: z.string().max(1200)
}).strict();

export type CommercialImageEvaluation = z.infer<typeof commercialImageEvaluationSchema>;
type EvaluatedAlternative = CommercialImageEvaluation['alternatives'][number] & { overallScore: number };

const mandatoryLegend = 'DISEÑO Y DIMENSIONES ORIENTATIVAS PARA COTIZACIÓN. LAS MEDIDAS DEFINITIVAS PUEDEN MODIFICARSE DURANTE LA ETAPA DE INGENIERÍA Y FABRICACIÓN.';
const templateName = 'plant-silos-a3-reference.png';

export function resolveCommercialImageTemplatePath() {
  return path.resolve(process.cwd(), 'assets', 'engineering-image-templates', templateName);
}

export function commercialImageApiSettings() {
  return {
    model: config.OPENAI_ENGINEERING_IMAGE_MODEL,
    quality: config.OPENAI_ENGINEERING_IMAGE_QUALITY,
    size: config.OPENAI_ENGINEERING_IMAGE_SIZE,
    output_format: 'png' as const,
    background: 'opaque' as const,
    n: 2 as const
  };
}

function clipped(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function bulletList(values: string[], fallback: string, maxLength = 3500) {
  if (!values.length) return fallback;
  const result: string[] = [];
  let used = 0;
  for (const [index, value] of values.entries()) {
    const line = `${index + 1}. ${value}`;
    if (used + line.length > maxLength) {
      result.push('… elementos adicionales registrados en la solicitud.');
      break;
    }
    result.push(line);
    used += line.length;
  }
  return result.join('\n');
}

function defaultDescription(input: CommercialImageDrawingInput) {
  if (input.equipmentDescription) return clipped(input.equipmentDescription, 5000);
  if (input.layoutDescription) return clipped(input.layoutDescription, 4000);
  if (input.drawingType === 'GRAIN_STORAGE_PLANT' || input.drawingType === 'COMPLETE_GRAIN_PLANT') {
    return 'Planta general de almacenamiento de granos vista desde arriba, formada por cuatro silos metálicos circulares de 400 toneladas cada uno, dispuestos en una matriz simétrica de dos filas y dos columnas. Incorporar una noria de cangilones central, transportador horizontal principal, ramales hacia cada silo, tolva de recepción de camiones a la izquierda, salida de despacho a la derecha, sala eléctrica, caminos internos, pasarelas, escaleras y flechas de flujo. Agregar un pequeño corte frontal de la planta en la zona inferior.';
  }
  return `Lámina técnica comercial orientativa de ${input.equipmentType || input.drawingType}, mostrando el conjunto principal, accesos, conexiones, cotas aproximadas, referencias y una vista secundaria esquemática.`;
}

export function buildCommercialEngineeringImagePrompt(input: CommercialImageDrawingInput, retry = false) {
  const retryInstruction = retry
    ? '\n\nEn el intento anterior se perdió la estructura visual. Conservá con mayor fidelidad la plantilla, especialmente el marco, la grilla, las tablas laterales, el corte inferior y la carátula.'
    : '';
  return `Utilizá la imagen proporcionada como plantilla visual obligatoria.

Creá una nueva lámina técnica comercial orientativa basada en la solicitud indicada abajo.

CONSERVAR DE LA PLANTILLA:

* orientación horizontal;
* proporción aproximada de hoja A3;
* fondo blanco;
* dibujo técnico en líneas negras;
* marco exterior;
* grilla con números arriba y abajo;
* grilla con letras a ambos lados;
* título y referencias en el lateral izquierdo;
* vista técnica principal ocupando el centro;
* tabla de equipos en el lateral derecho;
* bloque de datos generales;
* bloque de especificaciones;
* bloque de notas;
* pequeño corte o elevación de referencia en la parte inferior;
* leyenda de flujos;
* carátula técnica FMH en la esquina inferior derecha;
* aspecto visual de plano CAD industrial;
* alta densidad de detalles técnicos;
* composición limpia y profesional.

CAMBIAR:

${defaultDescription(input)}

DATOS DEL PROYECTO:

Proyecto: ${input.projectName}
Cliente: ${input.customerName}
Presupuesto: ${input.budgetNumber}
Producto: ${input.product}
Capacidad: ${input.capacity}
Título del plano: ${input.title}

EQUIPOS SOLICITADOS:

${bulletList(input.equipmentList, `1. ${input.equipmentType || input.drawingType} — representación comercial orientativa.`, 4200)}

DIMENSIONES ORIENTATIVAS:

${bulletList(input.approximateDimensions, 'Usar proporciones visuales razonables y rotular toda medida como orientativa.', 3000)}

VISTAS Y ELEMENTOS VISUALES:

${bulletList([...input.requestedViews, ...input.requestedDetails], 'Vista principal técnica y un corte o elevación secundaria de referencia.', 3200)}

NOTAS ADICIONALES:

${bulletList(input.additionalNotes, 'Documento comercial preliminar. Verificar datos durante la etapa de ingeniería.', 3000)}

REGLAS VISUALES OBLIGATORIAS:

* La imagen debe verse como un plano técnico industrial profesional.
* Vista predominantemente superior o lateral según el tipo de plano solicitado.
* Dibujar los equipos con líneas finas y negras.
* Usar líneas más gruesas para marcos y contornos principales.
* Incluir cotas y líneas auxiliares alrededor de los equipos.
* Incluir referencias circulares numeradas.
* Incluir flechas de circulación o flujo del producto.
* Incluir caminos, camiones, accesos o estructuras cuando sean relevantes.
* Mantener todos los elementos dentro del marco.
* Mantener una composición equilibrada.
* Mantener la carátula completamente visible.
* Mantener las tablas completamente visibles.
* Mantener textos técnicos breves.
* Evitar textos largos y párrafos.
* No generar una fotografía.
* No generar una ilustración artística.
* No generar una vista renderizada en 3D.
* No generar colores.
* No generar fondo oscuro.
* No generar perspectiva cinematográfica.
* No eliminar el marco.
* No eliminar la carátula.
* No eliminar las tablas.
* No agregar objetos decorativos.
* No agregar personas.
* No agregar logos de otras empresas.
* No dejar grandes espacios vacíos.
* No cortar ninguna parte de la hoja.
* No convertir la lámina en un único dibujo grande sin información lateral.
* No alterar la estructura general de la plantilla.

Agregar claramente la leyenda:

“${mandatoryLegend}”

El resultado debe ser una imagen PNG completa de la lámina, lista para adjuntar a un presupuesto.

## Cambiar únicamente los elementos necesarios para representar la nueva solicitud. Mantener todo lo demás visualmente similar a la plantilla.${retryInstruction}`;
}

function evaluationJsonSchema() {
  const properties = Object.fromEntries(scoreKeys.map((key) => [key, { type: 'number', minimum: 0, maximum: 10 }]));
  return {
    type: 'object',
    additionalProperties: false,
    required: ['alternatives', 'selectionReason'],
    properties: {
      alternatives: {
        type: 'array',
        minItems: 2,
        maxItems: 2,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['index', ...scoreKeys, 'summary'],
          properties: {
            index: { type: 'integer', minimum: 0, maximum: 1 },
            ...properties,
            summary: { type: 'string' }
          }
        }
      },
      selectionReason: { type: 'string' }
    }
  };
}

function withOverallScore(evaluation: CommercialImageEvaluation): Array<EvaluatedAlternative> {
  return evaluation.alternatives
    .map((alternative) => ({
      ...alternative,
      overallScore: Number((scoreKeys.reduce((total, key) => total + alternative[key], 0) / scoreKeys.length).toFixed(2))
    }))
    .sort((a, b) => b.overallScore - a.overallScore || a.index - b.index);
}

type ImageEditRequest = {
  template: Buffer;
  prompt: string;
};

type EvaluationRequest = {
  template: Buffer;
  alternatives: Buffer[];
  input: CommercialImageDrawingInput;
};

type PersistRequest = {
  input: CommercialImageDrawingInput;
  image: Buffer;
  prompt: string;
  evaluation: CommercialImageEvaluation;
  score: number;
  attempts: number;
};

export type CommercialImageDrawingDependencies = {
  loadTemplate: () => Promise<Buffer>;
  editImages: (request: ImageEditRequest) => Promise<Buffer[]>;
  evaluateImages: (request: EvaluationRequest) => Promise<CommercialImageEvaluation>;
  persist: (request: PersistRequest) => Promise<{ id: string }>;
};

let openAiClient: OpenAI | null = null;

function client() {
  if (!config.OPENAI_API_KEY.trim()) {
    throw Object.assign(new Error('OPENAI_API_KEY no está configurada. La generación visual con IA requiere saldo y una clave de API en el servidor.'), {
      statusCode: 409,
      code: 'OPENAI_IMAGE_API_NOT_CONFIGURED'
    });
  }
  openAiClient ||= new OpenAI({ apiKey: config.OPENAI_API_KEY });
  return openAiClient;
}

function rethrowOpenAiError(error: unknown): never {
  const apiError = error as { status?: number; code?: string; error?: { code?: string }; message?: string };
  const code = apiError.error?.code || apiError.code;
  if (code === 'billing_hard_limit_reached') {
    throw Object.assign(new Error('La generación visual está configurada, pero la cuenta de OpenAI alcanzó el límite de facturación. Cargá saldo o ampliá el límite para continuar.'), {
      statusCode: 402,
      code: 'OPENAI_BILLING_LIMIT'
    });
  }
  if (apiError.status === 401) {
    throw Object.assign(new Error('La clave de OpenAI configurada no es válida.'), { statusCode: 409, code: 'OPENAI_INVALID_API_KEY' });
  }
  if (apiError.status === 403) {
    throw Object.assign(new Error('La organización de OpenAI no tiene habilitado el modelo de imágenes solicitado. Revisá la verificación y los permisos del proyecto.'), {
      statusCode: 403,
      code: 'OPENAI_IMAGE_MODEL_NOT_ALLOWED'
    });
  }
  if (apiError.status === 429) {
    throw Object.assign(new Error('OpenAI alcanzó temporalmente el límite de solicitudes. Volvé a intentar en unos minutos.'), {
      statusCode: 429,
      code: 'OPENAI_RATE_LIMIT'
    });
  }
  throw Object.assign(new Error('OpenAI no pudo completar la generación visual. Revisá el estado del proyecto y volvé a intentar.'), {
    statusCode: 502,
    code: 'OPENAI_IMAGE_REQUEST_FAILED',
    cause: error
  });
}

async function editImagesWithOpenAi(request: ImageEditRequest) {
  let result;
  try {
    result = await client().images.edit({
      ...commercialImageApiSettings(),
      image: await toFile(request.template, templateName, { type: 'image/png' }),
      prompt: request.prompt
    });
  } catch (error) {
    rethrowOpenAiError(error);
  }
  const images = (result.data ?? [])
    .map((item) => item.b64_json)
    .filter((value): value is string => Boolean(value))
    .map((value) => Buffer.from(value, 'base64'));
  if (images.length !== 2) throw new Error(`OpenAI devolvió ${images.length} alternativas; se esperaban 2.`);
  return images;
}

async function evaluateImagesWithOpenAi(request: EvaluationRequest) {
  const content: Array<{ type: 'input_text'; text: string } | { type: 'input_image'; image_url: string; detail: 'high' }> = [{
    type: 'input_text',
    text: `Evaluá dos alternativas de lámina técnica comercial contra la plantilla original.
Imagen 1: plantilla obligatoria.
Imagen 2: alternativa de índice 0.
Imagen 3: alternativa de índice 1.

Puntuá cada alternativa de 0 a 10 en: similitud con la plantilla, apariencia de plano técnico, uso correcto de la hoja, marco completo, carátula completa, tablas completas, equipos solicitados presentes, composición profesional, ausencia de estilo artístico o fotográfico y legibilidad general.

No verifiques exactitud matemática ni constructiva de las cotas. Elegí por utilidad comercial y fidelidad visual.
Solicitud: ${request.input.title}. Tipo: ${request.input.drawingType}. Equipos: ${request.input.equipmentList.join('; ') || request.input.equipmentType || request.input.drawingType}.`
  }];
  for (const image of [request.template, ...request.alternatives]) {
    content.push({ type: 'input_image', image_url: `data:image/png;base64,${image.toString('base64')}`, detail: 'high' });
  }
  let response;
  try {
    response = await client().responses.create({
      model: config.OPENAI_ENGINEERING_IMAGE_EVALUATION_MODEL,
      input: [{ role: 'user', content }],
      reasoning: { effort: 'low' },
      max_output_tokens: 1600,
      text: {
        format: {
          type: 'json_schema',
          name: 'commercial_engineering_image_evaluation',
          strict: true,
          schema: evaluationJsonSchema()
        }
      }
    });
  } catch (error) {
    rethrowOpenAiError(error);
  }
  if (!response.output_text) throw new Error('GPT-5.6 no devolvió la evaluación visual.');
  return commercialImageEvaluationSchema.parse(JSON.parse(response.output_text));
}

async function persistCommercialImage(request: PersistRequest) {
  const quote = request.input.budgetId
    ? await prisma.quote.findFirst({
        where: { id: request.input.budgetId, companyId: request.input.companyId },
        select: { id: true, customerId: true, number: true, version: true }
      })
    : null;
  if (request.input.budgetId && !quote) {
    throw Object.assign(new Error('El presupuesto indicado no existe en esta empresa.'), { statusCode: 404 });
  }
  const filename = safeFileName(`FMH-${request.input.drawingType}-${Date.now()}.png`);
  const stored = await writeDocumentFile({
    buffer: request.image,
    filename,
    mimeType: 'image/png',
    sourceType: 'engineering-commercial-ai-image',
    companyId: request.input.companyId,
    uploadedBy: request.input.generatedBy
  });
  const drawing = await prisma.engineeringCommercialImageDrawing.create({
    data: {
      companyId: request.input.companyId,
      customerId: quote?.customerId,
      quoteId: quote?.id,
      drawingType: request.input.drawingType,
      projectName: request.input.projectName,
      title: request.input.title,
      budgetNumber: request.input.budgetNumber || (quote ? `${quote.number}/${quote.version}` : null),
      status: quote ? 'ATTACHED_TO_QUOTE' : 'DRAFT',
      model: config.OPENAI_ENGINEERING_IMAGE_MODEL,
      templateName,
      prompt: request.prompt,
      requestJson: JSON.stringify(request.input),
      evaluationJson: JSON.stringify(request.evaluation),
      imageStoragePath: stored.storagePath,
      imageSha256: stored.sha256,
      score: request.score,
      attempts: request.attempts,
      generatedBy: request.input.generatedBy
    }
  });
  return { id: drawing.id };
}

const defaultDependencies: CommercialImageDrawingDependencies = {
  loadTemplate: () => fs.readFile(resolveCommercialImageTemplatePath()),
  editImages: editImagesWithOpenAi,
  evaluateImages: evaluateImagesWithOpenAi,
  persist: persistCommercialImage
};

export async function generateCommercialEngineeringDrawing(
  rawInput: CommercialImageDrawingInput,
  overrides: Partial<CommercialImageDrawingDependencies> = {}
) {
  const input = commercialImageDrawingInputSchema.parse(rawInput);
  const dependencies = { ...defaultDependencies, ...overrides };
  const template = await dependencies.loadTemplate();
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'fmh-commercial-image-'));
  let attempts = 0;
  let selected: { image: Buffer; score: number; prompt: string; evaluation: CommercialImageEvaluation } | null = null;
  const evaluations: Array<{ attempt: number; evaluation: CommercialImageEvaluation; scores: EvaluatedAlternative[] }> = [];
  try {
    while (attempts < 3) {
      attempts += 1;
      const prompt = buildCommercialEngineeringImagePrompt(input, attempts > 1);
      const alternatives = await dependencies.editImages({ template, prompt });
      if (alternatives.length !== 2) throw new Error('El generador debe producir exactamente dos alternativas.');
      await Promise.all(alternatives.map((buffer, index) => fs.writeFile(path.join(temporaryDirectory, `attempt-${attempts}-alternative-${index}.png`), buffer)));
      const evaluation = await dependencies.evaluateImages({ template, alternatives, input });
      const scores = withOverallScore(evaluation);
      evaluations.push({ attempt: attempts, evaluation, scores });
      const best = scores[0];
      const candidate = { image: alternatives[best.index], score: best.overallScore, prompt, evaluation };
      if (!selected || candidate.score > selected.score) selected = candidate;
      if (best.overallScore >= config.OPENAI_ENGINEERING_IMAGE_MIN_SCORE) break;
    }
    if (!selected) throw new Error('No fue posible seleccionar una imagen comercial.');
    const scoreHistory = evaluations.map((item) => ({
      attempt: item.attempt,
      scores: item.scores.map(({ index, overallScore }) => ({ index, overallScore }))
    }));
    const persisted = await dependencies.persist({
      input,
      image: selected.image,
      prompt: selected.prompt,
      evaluation: {
        ...selected.evaluation,
        selectionReason: `${selected.evaluation.selectionReason} Historial: ${JSON.stringify(scoreHistory)}`
      },
      score: selected.score,
      attempts
    });
    return {
      drawingId: persisted.id,
      imageUrl: `/api/engineering/commercial-image-drawings/${persisted.id}/image?companyId=${encodeURIComponent(input.companyId)}`,
      score: selected.score,
      attempts,
      model: config.OPENAI_ENGINEERING_IMAGE_MODEL,
      template: templateName
    };
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function readCommercialEngineeringImage(id: string, companyId: string) {
  const drawing = await prisma.engineeringCommercialImageDrawing.findFirst({
    where: { id, companyId },
    select: {
      imageStoragePath: true,
      drawingType: true,
      title: true,
      score: true,
      attempts: true,
      model: true,
      templateName: true,
      status: true,
      quoteId: true
    }
  });
  if (!drawing) return null;
  return { ...drawing, buffer: await readStoredDocumentFile(drawing.imageStoragePath) };
}

export async function associateCommercialEngineeringImageToQuote(input: { id: string; companyId: string; quoteId: string }) {
  const [drawing, quote] = await Promise.all([
    prisma.engineeringCommercialImageDrawing.findFirst({ where: { id: input.id, companyId: input.companyId }, select: { id: true } }),
    prisma.quote.findFirst({ where: { id: input.quoteId, companyId: input.companyId }, select: { id: true, customerId: true, number: true, version: true } })
  ]);
  if (!drawing) throw Object.assign(new Error('Imagen comercial no encontrada.'), { statusCode: 404 });
  if (!quote) throw Object.assign(new Error('Presupuesto no encontrado.'), { statusCode: 404 });
  return prisma.engineeringCommercialImageDrawing.update({
    where: { id: drawing.id },
    data: {
      quoteId: quote.id,
      customerId: quote.customerId,
      budgetNumber: `${quote.number}/${quote.version}`,
      status: 'ATTACHED_TO_QUOTE'
    },
    select: { id: true, quoteId: true, customerId: true, status: true, budgetNumber: true }
  });
}
