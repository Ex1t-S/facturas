import { calculateNominalLoadPerSupport, calculateSimpleAxialStress, calculateVerticalLoad } from '../../domain/engineering/structural.js';
import { rectangularHollowSection } from '../../domain/engineering/sections.js';
import { engineeringAssistantResultSchema, type EngineeringAssistantResult } from './engineeringSchemas.js';
import { activeInputs, type EngineeringConversationState } from './conversationState.js';
import { classifyEngineeringIntent, extractEngineeringFacts, normalizeEngineeringText, parseEngineeringNumber, type EngineeringIntent } from './engineeringIntelligence.js';

type KnowledgeLike = { sources?: Array<{ id: string; title: string; type: string; relevance: number; url?: string; excerpt?: string }>; regulations?: Array<{ code: string; title: string; status: string; sourceUrl?: string; sourceType?: 'OFFICIAL' | 'LOCAL_VERIFIED' | 'INTERNAL' | 'SECONDARY' }>; goldenLibrary?: { fmhPrecedents: unknown[]; regulations: unknown[]; benchmarks: unknown[]; sectionCandidates: unknown[]; internationalReferences: unknown[] } };

function valueOf(state: EngineeringConversationState, key: string) { return activeInputs(state).find((item) => item.key === key)?.value; }
function inputOf(state: EngineeringConversationState, key: string) { return activeInputs(state).find((item) => item.key === key); }
function numberOf(value: unknown, unit?: string) { const result = Number(value); if (!Number.isFinite(result)) return 0; return String(unit || '').toLowerCase() === 'kg' ? result / 1000 : result; }
function format(value: number, decimals = 1) { return new Intl.NumberFormat('es-AR', { maximumFractionDigits: decimals, minimumFractionDigits: decimals }).format(value); }
function calculation(title: string, formula: string, inputs: Array<{ name: string; value: number; unit: string }>, result: number, unit: string, explanation: string) { return { title, formula, inputs, result, resultUnit: unit, explanation }; }

function sectionDesignations(message: string) {
  return [...normalizeEngineeringText(message).matchAll(/(\d{2,4})\s*[x×*]\s*(\d{2,4})\s*[x×*]\s*(\d+(?:[.,]\d+)?)\s*(?:mm)?\b/gi)].map((match) => ({ width: Number(match[1]), height: Number(match[2]), thickness: parseEngineeringNumber(match[3]), designation: `${match[1]}x${match[2]}x${match[3]} mm` }));
}

function flexibleSectionDesignations(message: string) {
  const matches = [...normalizeEngineeringText(message).matchAll(/(\d{2,4})\s*[xX×*]\s*(\d{2,4})\s*[xX×*]\s*(\d+(?:[.,]\d+)?)/gi)];
  return matches.map((match) => ({ width: Number(match[1]), height: Number(match[2]), thickness: parseEngineeringNumber(match[3]), designation: `${match[1]}x${match[2]}x${match[3]} mm` }));
}

function sectionComparison(message: string) {
  const parsed = sectionDesignations(message);
  const sections = (parsed.length ? parsed : flexibleSectionDesignations(message)).slice(0, 2);
  if (sections.length < 2) return { text: 'Para comparar dos tubos necesito las dos medidas completas, por ejemplo 150x150x4,75 contra 150x150x6,35.', calculations: [] as EngineeringAssistantResult['calculations'], assumptions: [] as string[] };
  const rows = sections.map((section) => {
    const properties = rectangularHollowSection(section.width, section.height, section.thickness);
    const massPerM = properties.areaMm2 * 0.00785;
    return { ...section, area: properties.areaMm2, ix: properties.ixMm4, iy: properties.iyMm4, massPerM };
  });
  const lighter = rows[0].massPerM <= rows[1].massPerM ? rows[0] : rows[1];
  const heavier = lighter === rows[0] ? rows[1] : rows[0];
  const percentage = (1 - lighter.massPerM / heavier.massPerM) * 100;
  return {
    text: `Comparación geométrica preliminar:\n\n- ${rows[0].designation}: área ${format(rows[0].area, 0)} mm² y masa aproximada ${format(rows[0].massPerM, 2)} kg/m.\n- ${rows[1].designation}: área ${format(rows[1].area, 0)} mm² y masa aproximada ${format(rows[1].massPerM, 2)} kg/m.\n\nEl perfil ${heavier.designation} aporta aproximadamente ${format(percentage, 0)} % más masa por metro. La elección estructural todavía requiere carga, longitud libre, arriostramiento y verificación de pandeo.`,
    calculations: [calculation('Propiedades geométricas de secciones huecas', 'A = B×H − (B−2t)×(H−2t)', rows.flatMap((row) => [{ name: `${row.designation} área`, value: row.area, unit: 'mm²' }, { name: `${row.designation} masa lineal`, value: row.massPerM, unit: 'kg/m' }]), heavier.massPerM, 'kg/m', 'Comparación geométrica; no es una verificación normativa.')],
    assumptions: ['Se interpretaron ambas medidas como tubos rectangulares huecos de acero al carbono.', 'La masa lineal usa densidad aproximada de 7.850 kg/m³.']
  };
}

export function buildDeterministicEngineeringResult(input: { state: EngineeringConversationState; message: string; knowledge?: KnowledgeLike; toolCalls?: Array<{ name: string; status: string; summary?: string }>; provider?: 'local' | 'openai'; execution?: { requestedModel?: string; actualModel?: string; responseId?: string; fallbackUsed?: boolean; latencyMs?: number; error?: { type?: string; code?: string; status?: number; message: string } } }): EngineeringAssistantResult {
  const { state, message, knowledge, toolCalls = [], provider = 'local', execution } = input;
  const classification = classifyEngineeringIntent(message, { projectType: state.projectType, currentIntent: state.currentIntent });
  const intent: EngineeringIntent = state.currentIntent || classification.intent;
  const calculations: EngineeringAssistantResult['calculations'] = [];
  const assumptions: string[] = [];
  const warnings: string[] = [];
  let answer = '';
  let nextAction: { label: string; type: string } | undefined;
  const capacityInput = inputOf(state, 'capacity');
  const capacityT = numberOf(capacityInput?.value, capacityInput?.unit);
  const supportCount = Number(valueOf(state, 'supportCount') || 0);
  const alternatives = Array.isArray(valueOf(state, 'supportAlternatives')) ? (valueOf(state, 'supportAlternatives') as unknown[]).map(Number).filter((value) => Number.isInteger(value) && value > 0) : [];
  const selfWeightInput = inputOf(state, 'selfWeight');
  const selfWeight = selfWeightInput?.unit === 'kN' ? Number(selfWeightInput.value) : Number(selfWeightInput?.value || 0) * 9.80665;
  const totalLoadInput = capacityT > 0 ? calculateVerticalLoad({ storedMassT: capacityT, selfWeightKN: selfWeight || undefined }) : undefined;
  const totalLoad = totalLoadInput?.result.value || 0;

  if (intent === 'GENERAL_QUESTION') {
    const lower = normalizeEngineeringText(message).toLowerCase();
    if (lower.includes('pandeo')) answer = 'El pandeo es la pérdida de estabilidad de un elemento comprimido: una pieza puede desviarse lateralmente antes de que el acero alcance su resistencia. Aumentan el riesgo la longitud libre, la falta de arriostramiento y una sección con bajo radio de giro. Para revisarlo se necesita, como mínimo, la carga, la longitud efectiva y las propiedades de la sección.';
    else if (lower.includes('esbeltez')) answer = 'La esbeltez relaciona la longitud efectiva de un elemento con su radio de giro. Cuanto mayor es, más sensible resulta el elemento al pandeo. Es un indicador preliminar: la clasificación y resistencia final dependen del reglamento y de las condiciones reales de apoyo.';
    else if (lower.includes('carga por apoyo') || lower.includes('carga por pata')) answer = 'La carga nominal por apoyo se obtiene dividiendo la carga vertical total considerada por la cantidad de apoyos. Si me pasás la carga y el número de patas, la calculo directamente.';
    else answer = 'Puedo ayudarte con explicaciones estructurales, cálculos preliminares, comparación de perfiles, antecedentes FMH, cómputos y planes de compra. Decime qué querés resolver y voy directo al cálculo o la referencia que corresponda.';
  } else if (intent === 'LOAD_PER_SUPPORT' || (intent === 'QUICK_CALCULATION' && supportCount > 0 && capacityT > 0)) {
    if (capacityT <= 0 || supportCount <= 0) {
      answer = 'Para calcular la carga nominal por apoyo necesito la capacidad o carga total y la cantidad de apoyos.';
      nextAction = { label: 'Completar carga y apoyos', type: 'REQUEST_INPUT' };
    } else {
      const perSupport = calculateNominalLoadPerSupport(totalLoad, supportCount);
      calculations.push(calculation('Carga vertical total preliminar', totalLoadInput!.formula || 'W = masa × g + peso propio', totalLoadInput!.inputs, totalLoad, 'kN', totalLoadInput!.explanation || 'Cálculo preliminar.'));
      calculations.push(calculation(`Carga nominal por apoyo (${supportCount} apoyos)`, perSupport.formula || 'P = Wtotal / n', perSupport.inputs, perSupport.result.value, 'kN', perSupport.explanation || 'Reparto ideal uniforme.'));
      answer = `Considerando inicialmente ${format(capacityT, 0)} t almacenadas${selfWeight ? ` y ${format(selfWeight / 9.80665, 1)} t de peso propio estimado` : ''}:\n\n- Carga vertical total considerada: **${format(totalLoad, 1)} kN**.\n- Cantidad de apoyos: **${supportCount}**.\n- Carga vertical nominal: **${format(perSupport.result.value, 1)} kN por apoyo**.\n\nEsto supone un reparto uniforme y no incluye viento, excentricidades, redistribución, uniones ni fundaciones.`;
      assumptions.push('Reparto vertical uniforme entre apoyos.');
      if (!selfWeight) assumptions.push('Se consideró sólo el peso del material almacenado; el peso propio queda pendiente.');
      nextAction = { label: 'Analizar patas', type: 'SECTION_SELECTION' };
    }
  } else if (intent === 'SUPPORT_COMPARISON') {
    if (capacityT <= 0 || alternatives.length < 2) answer = 'Para comparar apoyos necesito la capacidad o carga total y dos cantidades de apoyos, por ejemplo 4 contra 6.';
    else {
      const rows = alternatives.slice(0, 2).map((count) => { const result = calculateNominalLoadPerSupport(totalLoad, count); return { count, result: result.result.value }; });
      const reduction = (1 - rows[1].result / rows[0].result) * 100;
      calculations.push(calculation('Carga vertical total preliminar', totalLoadInput!.formula || 'W = masa × g + peso propio', totalLoadInput!.inputs, totalLoad, 'kN', totalLoadInput!.explanation || 'Cálculo preliminar.'));
      for (const row of rows) calculations.push(calculation(`Carga nominal por apoyo (${row.count} apoyos)`, 'P = Wtotal / n', [{ name: 'carga total', value: totalLoad, unit: 'kN' }, { name: 'cantidad de apoyos', value: row.count, unit: 'un' }], row.result, 'kN', 'Reparto ideal uniforme; no contempla acciones horizontales.'));
      answer = `Comparé las dos alternativas con la carga vertical considerada de ${format(totalLoad, 1)} kN:\n\n- **${rows[0].count} apoyos:** ${format(rows[0].result, 1)} kN por apoyo.\n- **${rows[1].count} apoyos:** ${format(rows[1].result, 1)} kN por apoyo.\n\nLa alternativa de ${rows[1].count} apoyos reduce la carga nominal por apoyo aproximadamente un **${format(reduction, 0)} %**. Esto no define por sí solo la mejor solución: también hay que revisar geometría, arriostramiento, uniones, viento y fundaciones.`;
      nextAction = { label: 'Comparar perfiles', type: 'SECTION_SELECTION' };
    }
  } else if (intent === 'SECTION_COMPARISON') {
    const result = sectionComparison(message);
    answer = result.text;
    calculations.push(...result.calculations);
    assumptions.push(...result.assumptions);
  } else if (intent === 'MATERIAL_TAKEOFF') {
    const sheet = valueOf(state, 'sheetDimensions');
    if (Array.isArray(sheet) && sheet.length === 2) answer = `La chapa informada tiene ${format(Number(sheet[0]), 2)} × ${format(Number(sheet[1]), 2)} m. Para definir los cortes todavía necesito las medidas y cantidades de las piezas; con eso puedo devolver un plan de corte y sobrante.`;
    else if (supportCount > 0 && Number(valueOf(state, 'freeHeight') || 0) > 0) {
      const totalLength = supportCount * Number(valueOf(state, 'freeHeight'));
      answer = `Para ${supportCount} patas de ${format(Number(valueOf(state, 'freeHeight')), 2)} m, la longitud neta es **${format(totalLength, 2)} m**. Falta confirmar la sección y los largos comerciales para calcular peso, cortes y barras de compra.`;
      calculations.push(calculation('Longitud neta de patas', 'L = n × largo', [{ name: 'cantidad', value: supportCount, unit: 'un' }, { name: 'largo', value: Number(valueOf(state, 'freeHeight')), unit: 'm' }], totalLength, 'm', 'No incluye desperdicio ni recortes de conexión.'));
    } else answer = 'Puedo preparar el cómputo. Para hacerlo necesito las dimensiones o cantidades de las piezas; si hablamos de patas, indicame cantidad, longitud y sección.';
  } else if (intent === 'SECTION_SELECTION' || intent === 'PRELIMINARY_DESIGN') {
    answer = capacityT > 0 && supportCount > 0 ? `Con ${format(capacityT, 0)} t y ${supportCount} apoyos, la carga vertical nominal inicial es de aproximadamente ${format(totalLoad / supportCount, 1)} kN por apoyo. Para analizar una pata todavía necesito la altura libre, el arriostramiento y un catálogo de secciones con propiedades verificables.` : 'Puedo hacer un predimensionamiento preliminar de las patas. Necesito, como mínimo, la carga, la altura libre y cómo están arriostradas.';
    nextAction = { label: 'Completar datos de patas', type: 'REQUEST_INPUT' };
  } else if (intent === 'PURCHASE_PLAN') {
    answer = 'Puedo calcular barras comerciales y sobrante cuando tenga la longitud neta, los cortes y el largo comercial. No voy a convertir metros en barras sin conocer cómo se distribuyen las piezas.';
  } else if (intent === 'KNOWLEDGE_SEARCH' || intent === 'DRAWING_SEARCH') {
    answer = knowledge?.sources?.length ? `Encontré ${knowledge.sources.length} referencias FMH relacionadas. Las muestro como antecedentes y no como validación automática; conviene revisar los planos o documentos originales antes de reutilizar una medida.` : 'No encontré antecedentes técnicos suficientemente relacionados en la biblioteca FMH.';
  } else if (intent === 'COST_ESTIMATE') {
    answer = 'Puedo estimar el costo cuando exista un cómputo y precios con fuente y fecha. Los precios históricos o en cero se muestran como referencia, no como costo vigente.';
  } else {
    answer = 'Puedo avanzar con una orientación preliminar, pero necesito que me indiques si querés calcular una carga, comparar apoyos, seleccionar una sección, buscar un antecedente o preparar un cómputo.';
  }

  if (!answer.trim()) answer = 'No pude construir una respuesta útil con los datos disponibles.';
  const sources = (knowledge?.sources || []).map((source) => ({ id: source.id, title: source.title, type: source.type, relevance: source.relevance, excerpt: source.excerpt }));
  return engineeringAssistantResultSchema.parse({
    intent, subject: state.subject || message.slice(0, 120), answer, inputData: activeInputs(state).map((item) => ({ name: item.key, value: typeof item.value === 'number' ? item.value : String(item.value), unit: item.unit, source: item.source })), missingData: state.missingData.map((item) => ({ name: item.key, reason: item.reason, critical: item.criticality === 'CRITICAL' })), assumptions: [...state.assumptions.map((item) => item.description), ...assumptions], calculations, materials: [], purchase: [], sources, regulations: knowledge?.regulations || [], goldenLibrary: knowledge?.goldenLibrary, toolCalls, warnings, confidence: sources.length ? 0.75 : 0.7, reviewRequired: true, level: calculations.length ? 'ESTIMATION' : 'ORIENTATION', model: execution?.actualModel || execution?.requestedModel, capability: calculations.length ? 'SUPPORTED_DETERMINISTIC' : 'PRELIMINARY_ASSISTED', provider, requestedModel: execution?.requestedModel, actualModel: execution?.actualModel, responseId: execution?.responseId, fallbackUsed: execution?.fallbackUsed ?? provider === 'local', latencyMs: execution?.latencyMs, intentConfidence: state.intentConfidence, executionError: execution?.error, nextAction
  });
}
