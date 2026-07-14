import { prisma } from '../../db.js';
import { config } from '../../config.js';
import { frustumOfPyramidVolume, rectangularPrism, type CalculationTrace } from '../../domain/engineering/geometry.js';
import { sheetMass } from '../../domain/engineering/materials.js';
import { engineeringAssistantResultSchema, type EngineeringAssistantResult } from './engineeringSchemas.js';
import { searchEngineeringKnowledge } from './engineeringKnowledge.js';

function number(value: string) { return Number(value.replace(',', '.')); }
function sourceLabel(source: { title: string; verified?: boolean; confidence?: number }) { return `${source.title} (${source.verified ? 'verificado' : 'histórico'})`; }
function traceText(calculation: CalculationTrace) { return `${calculation.title}: ${calculation.formula}\nResultado: ${calculation.result.value.toFixed(2)} ${calculation.result.unit}`; }

async function explainWithOpenAI(message: string, result: EngineeringAssistantResult) {
  if (!config.OPENAI_API_KEY) return null;
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.OPENAI_ENGINEERING_MODEL || config.OPENAI_MODEL,
      reasoning: { effort: 'low' },
      text: { verbosity: 'medium' },
      input: [
        { role: 'system', content: [{ type: 'input_text', text: 'Sos el Asistente de Ingeniería interno de FMH. Reescribí una respuesta técnica clara usando únicamente el resultado estructurado entregado. Diferenciá hechos históricos, cálculos, hipótesis y datos faltantes. No inventes perfiles, espesores, precios ni aprobaciones. Indicá que es preliminar cuando corresponda.' }] },
        { role: 'user', content: [{ type: 'input_text', text: JSON.stringify({ question: message, structuredResult: result }) }] }
      ],
      max_output_tokens: 1400,
      store: false
    })
  });
  if (!response.ok) return null;
  const data = await response.json() as { output_text?: string };
  return data.output_text?.trim() || null;
}

function detectTolva(message: string) {
  const values = [...message.matchAll(/(\d+(?:[,.]\d+)?)\s*[×x*]\s*(\d+(?:[,.]\d+)?)\s*(?:m)?/gi)].map((match) => [number(match[1]), number(match[2])] as const);
  const height = message.match(/(?:alto|altura)\s*(?:de|=|:)?\s*(\d+(?:[,.]\d+)?)\s*m/i)?.[1];
  if (values.length < 2 || !height) return null;
  return { top: values[0], bottom: values[1], height: number(height) };
}

function missingForSilo(message: string) {
  const missing = [{ name: 'Producto almacenado', reason: 'define densidad aparente y comportamiento', critical: true }, { name: 'Densidad aparente', reason: 'permite convertir toneladas a volumen', critical: true }, { name: 'Ubicación', reason: 'determina acciones ambientales y criterio de diseño', critical: true }, { name: 'Diámetro o restricciones', reason: 'define la geometría preliminar', critical: false }];
  return message.match(/densidad|trigo|maíz|maiz|soja/i) ? missing.slice(2) : missing;
}

export async function answerEngineering(input: { companyId: string; message: string }): Promise<EngineeringAssistantResult & { mode: 'local' | 'openai' }> {
  const message = input.message.trim();
  const lower = message.toLowerCase();
  const knowledge = await searchEngineeringKnowledge({ companyId: input.companyId, q: message, projectType: lower.includes('silo') ? 'SILO' : undefined, take: 8 });
  const sources = knowledge.sources;
  const calculations: EngineeringAssistantResult['calculations'] = [];
  const missingData: EngineeringAssistantResult['missingData'] = [];
  const assumptions: string[] = [];
  let intent: EngineeringAssistantResult['intent'] = 'GENERAL_QUESTION';
  let subject = message;
  let answer = '';

  const tolva = detectTolva(message);
  if (tolva) {
    intent = 'PRELIMINARY_CALCULATION';
    const topArea = tolva.top[0] * tolva.top[1];
    const bottomArea = tolva.bottom[0] * tolva.bottom[1];
    const calculation = frustumOfPyramidVolume(topArea, bottomArea, tolva.height);
    calculations.push({ title: calculation.title, formula: calculation.formula, inputs: calculation.inputs, result: calculation.result.value, resultUnit: calculation.result.unit, explanation: calculation.explanation });
    answer = `Puedo hacer el cálculo geométrico preliminar de la tolva.\n\n${traceText(calculation)}.`;
    const thickness = message.match(/espesor\s*(?:de|=|:)?\s*(\d+(?:[,.]\d+)?)\s*mm/i)?.[1];
    if (thickness) {
      const mass = sheetMass(2 * Math.sqrt(topArea) * tolva.height, number(thickness), 'acero al carbono');
      calculations.push({ title: mass.title, formula: mass.formula, inputs: mass.inputs, result: mass.result.value, resultUnit: mass.result.unit, explanation: mass.explanation });
      answer += `\n\n${traceText(mass)}.`;
    } else missingData.push({ name: 'Espesor y material de chapa', reason: 'necesarios para estimar masa', critical: false });
    assumptions.push('Se modeló como tronco de pirámide entre dos bocas cuadradas/rectangulares.');
  } else if (lower.includes('silo') && /\d/.test(lower)) {
    intent = 'SIMILAR_PROJECT_SEARCH';
    missingData.push(...missingForSilo(message));
    answer = `Encontré ${knowledge.documents.length} antecedentes potencialmente relacionados. Puedo avanzar con un predimensionamiento cuando confirmes los datos críticos.`;
  } else if (lower.includes('costo') || lower.includes('precio')) {
    intent = 'COST_ESTIMATE';
    answer = knowledge.products.length ? `Encontré ${knowledge.products.length} materiales/productos relacionados. Los precios mostrados deben tratarse como actuales solamente según su fecha de observación.` : 'No encontré un precio asociado. No voy a reemplazarlo silenciosamente por cero.';
  } else if (lower.includes('material') || lower.includes('caño') || lower.includes('perfil') || lower.includes('espesor')) {
    intent = 'MATERIAL_ESTIMATE';
    answer = knowledge.documents.length ? `Encontré ${knowledge.documents.length} antecedentes técnicos para comparar materiales. No los tomo como validación estructural del proyecto nuevo.` : 'No encontré antecedentes directos; puedo revisar la biblioteca cuando esté ingestada.';
  } else {
    answer = knowledge.documents.length || knowledge.projects.length || knowledge.products.length ? 'Encontré antecedentes en la biblioteca FMH y datos operativos relacionados.' : 'No encontré coincidencias directas en la biblioteca FMH.';
  }

  const sourceLines = sources.slice(0, 6).map((source) => `- ${source.title}`).join('\n');
  answer += `\n\nANTECEDENTES FMH\n${sourceLines || '- Sin antecedentes directos.'}`;
  answer += '\n\nEstos antecedentes son referencias históricas y no equivalen a una aprobación de fabricación ni reemplazan la revisión técnica.';
  const result = engineeringAssistantResultSchema.parse({ intent, subject, answer, inputData: [], missingData, assumptions, calculations, materials: [], sources, warnings: ['Verificar hipótesis, unidades y normativa antes de fabricar.'], confidence: sources.length ? 0.65 : 0.35, reviewRequired: true });
  if (input.companyId && calculations.length) await prisma.engineeringCalculation.createMany({ data: calculations.map((calculation) => ({ companyId: input.companyId, title: calculation.title, formula: calculation.formula, inputsJson: JSON.stringify(calculation.inputs), resultJson: JSON.stringify({ result: calculation.result, unit: calculation.resultUnit, explanation: calculation.explanation }), source: 'CALCULATED' })) });
  const aiAnswer = await explainWithOpenAI(message, result).catch(() => null);
  return { ...result, answer: aiAnswer || result.answer, mode: aiAnswer ? 'openai' : 'local' };
}
