import { technicalTokens } from '../normalize.js';

export const engineeringIntents = [
  'GENERAL_QUESTION',
  'QUICK_CALCULATION',
  'LOAD_PER_SUPPORT',
  'SUPPORT_COMPARISON',
  'SECTION_COMPARISON',
  'SECTION_SELECTION',
  'PRELIMINARY_DESIGN',
  'MATERIAL_TAKEOFF',
  'PURCHASE_PLAN',
  'COST_ESTIMATE',
  'KNOWLEDGE_SEARCH',
  'DRAWING_SEARCH',
  'DRAWING_REVIEW',
  'CASE_SUMMARY',
  'OTHER'
] as const;

export type EngineeringIntent = typeof engineeringIntents[number];

const mojibakeReplacements: Array<[string, string]> = [
  ['Ã¡', 'á'], ['Ã©', 'é'], ['Ã­', 'í'], ['Ã³', 'ó'], ['Ãº', 'ú'], ['Ã±', 'ñ'],
  ['Ã‰', 'É'], ['Ã“', 'Ó'], ['Ãš', 'Ú'], ['Ã‘', 'Ñ'], ['Ã', 'Á'],
  ['Ã¼', 'ü'], ['Ãœ', 'Ü'], ['Â°', '°'], ['Â²', '²'], ['Â³', '³'],
  ['â€“', '–'], ['â€”', '—'], ['â€¦', '…'], ['â†’', '→'], ['�', '']
];

export function normalizeEngineeringText(value: string) {
  let result = value;
  for (const [from, to] of mojibakeReplacements) result = result.split(from).join(to);
  return result.normalize('NFC').replace(/\s+/g, ' ').trim();
}

export function engineeringSearchText(value: string) {
  return normalizeEngineeringText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-AR');
}

export function parseEngineeringNumber(value: string) {
  const raw = value.trim().replace(/\s/g, '');
  if (raw.includes(',') && raw.includes('.')) {
    return raw.lastIndexOf(',') > raw.lastIndexOf('.') ? Number(raw.replace(/\./g, '').replace(',', '.')) : Number(raw.replace(/,/g, ''));
  }
  return Number(raw.replace(',', '.'));
}

export function extractFirstNumber(value: string) {
  const match = value.match(/\d+(?:[.,]\d+)?/);
  return match ? parseEngineeringNumber(match[0]) : undefined;
}

export type EngineeringFact = {
  key: string;
  value: unknown;
  unit?: string;
  source: 'USER';
  confidence: number;
  confirmed: boolean;
};

function fact(key: string, value: unknown, unit?: string): EngineeringFact {
  return { key, value, unit, source: 'USER', confidence: 1, confirmed: true };
}

function matchNumber(message: string, pattern: RegExp) {
  const match = message.match(pattern);
  return match ? parseEngineeringNumber(match[1]) : undefined;
}

export function extractEngineeringFacts(rawMessage: string): EngineeringFact[] {
  const message = normalizeEngineeringText(rawMessage);
  const lower = engineeringSearchText(message);
  const facts: EngineeringFact[] = [];
  const add = (item: EngineeringFact | undefined) => { if (item && !facts.some((current) => current.key === item.key && JSON.stringify(current.value) === JSON.stringify(item.value))) facts.push(item); };

  const capacity = message.match(/(\d+(?:[.,]\d+)?)\s*(t|tn|ton|toneladas|kg)\b/i);
  if (capacity) add(fact('capacity', parseEngineeringNumber(capacity[1]), capacity[2].toLowerCase() === 'tn' ? 't' : capacity[2].toLowerCase()));

  const supports = message.match(/(\d+)\s*(?:patas?|apoyos?|soportes?|columnas?)\b/i);
  if (supports) add(fact('supportCount', Number(supports[1]), 'un'));

  const alternatives = lower.match(/(\d+)\s*(?:patas?|apoyos?|soportes?)\s*(?:contra|vs|versus|o|y)\s*(\d+)\s*(?:patas?|apoyos?|soportes?)?/i)
    || lower.match(/compar(?:ar|a|acion)?[^\d]*(\d+)\s*(?:patas?|apoyos?)?[^\d]+(\d+)\s*(?:patas?|apoyos?)/i);
  if (alternatives) add(fact('supportAlternatives', [Number(alternatives[1]), Number(alternatives[2])].sort((a, b) => a - b), 'un'));

  const productMatch = lower.match(/\b(maiz|trigo|soja|soya|girasol|cebada|sorgo|arroz|producto)\b/);
  if (productMatch && productMatch[1] !== 'producto') {
    const product = productMatch[1] === 'maiz' ? 'maíz' : productMatch[1] === 'soya' ? 'soja' : productMatch[1];
    add(fact('product', product));
  }

  const density = matchNumber(message, /(?:densidad(?: aparente)?|peso especifico)\s*(?:de|=|:)?\s*(\d+(?:[.,]\d+)?)\s*(?:kg\s*\/\s*m3|kg\/m³|kg\/m\^3|t\/m3)?/i);
  if (density) add(fact('density', density, 'kg/m3'));

  const selfWeightT = matchNumber(message, /(?:peso propio|peso de la estructura|estructura pesa)\s*(?:de|=|:)?\s*(\d+(?:[.,]\d+)?)\s*t\b/i);
  if (selfWeightT) add(fact('selfWeight', selfWeightT, 't'));
  const selfWeightKN = matchNumber(message, /(?:peso propio|peso de la estructura)\s*(?:de|=|:)?\s*(\d+(?:[.,]\d+)?)\s*kN\b/i);
  if (selfWeightKN) add(fact('selfWeight', selfWeightKN, 'kN'));

  const freeHeight = matchNumber(message, /(?:altura\s+libre|altura\s+de\s+(?:las\s+)?patas?|largo\s+libre)\s*(?:de|=|:)?\s*(\d+(?:[.,]\d+)?)\s*m(?:etros?)?\b/i)
    ?? matchNumber(message, /(\d+(?:[.,]\d+)?)\s*m(?:etros?)?\s*(?:libres?|libre)\b/i);
  if (freeHeight) add(fact('freeHeight', freeHeight, 'm'));

  const dimensionPatterns: Array<[string, RegExp]> = [
    ['diameter', /(?:di[aá]metro|ø|phi)\s*(?:de|=|:)?\s*(\d+(?:[.,]\d+)?)\s*m\b/i],
    ['bodyHeight', /(?:altura|alto)\s+(?:del\s+)?cuerpo\s*(?:de|=|:)?\s*(\d+(?:[.,]\d+)?)\s*m\b/i],
    ['coneHeight', /(?:altura|alto)\s+(?:del\s+)?cono\s*(?:de|=|:)?\s*(\d+(?:[.,]\d+)?)\s*m\b/i]
  ];
  for (const [key, pattern] of dimensionPatterns) {
    const value = matchNumber(message, pattern);
    if (value) add(fact(key, value, 'm'));
  }
  for (const match of message.matchAll(/(\d+(?:[.,]\d+)?)\s*m(?:etros?)?\s*(?:de\s*)?(di[aá]metro|cuerpo|cono)/gi)) {
    const label = engineeringSearchText(match[2]);
    add(fact(label.includes('diam') ? 'diameter' : label === 'cuerpo' ? 'bodyHeight' : 'coneHeight', parseEngineeringNumber(match[1]), 'm'));
  }
  for (const match of message.matchAll(/(di[aá]metro|cuerpo|cono)\s*(?:de|=|:)\s*(\d+(?:[.,]\d+)?)\s*m(?:etros?)?/gi)) {
    const label = engineeringSearchText(match[1]);
    add(fact(label.includes('diam') ? 'diameter' : label === 'cuerpo' ? 'bodyHeight' : 'coneHeight', parseEngineeringNumber(match[2]), 'm'));
  }

  const section = message.match(/(\d{2,4})\s*[x×*]\s*(\d{2,4})\s*[x×*]\s*(\d+(?:[.,]\d+)?)\s*mm?\b/i);
  if (section) {
    const width = Number(section[1]);
    const height = Number(section[2]);
    const thickness = parseEngineeringNumber(section[3]);
    add(fact('sectionDesignation', `${width}x${height}x${String(thickness).replace('.', ',')} mm`));
    add(fact('sectionWidth', width, 'mm'));
    add(fact('sectionHeight', height, 'mm'));
    add(fact('sectionThickness', thickness, 'mm'));
  }
  if (!section) {
    const fallbackSection = message.match(/(\d{2,4})\s*[xX×*]\s*(\d{2,4})\s*[xX×*]\s*(\d+(?:[.,]\d+)?)/i);
    if (fallbackSection) {
      const width = Number(fallbackSection[1]);
      const height = Number(fallbackSection[2]);
      const thickness = parseEngineeringNumber(fallbackSection[3]);
      add(fact('sectionDesignation', `${width}x${height}x${String(thickness).replace('.', ',')} mm`));
      add(fact('sectionWidth', width, 'mm'));
      add(fact('sectionHeight', height, 'mm'));
      add(fact('sectionThickness', thickness, 'mm'));
    }
  }

  const barLength = matchNumber(message, /(?:barras?|largos?\s+comerciales?|largo\s+de\s+barras?)\s*(?:de|=|:)?\s*(\d+(?:[.,]\d+)?)\s*m\b/i);
  if (barLength) add(fact('commercialLength', barLength, 'm'));

  const location = message.match(/(?:ubicado|instalado|instalacion|va|sera)\s+(?:en|a)\s+([A-Za-zÁÉÍÓÚáéíóúÑñ][A-Za-zÁÉÍÓÚáéíóúÑñ .-]{2,60})/i);
  if (location) add(fact('location', location[1].trim().replace(/[.,;:]$/, '')));

  if (/arriostr|cruzamiento|diagonal|vinculad[oa]/i.test(message)) add(fact('bracing', 'mentioned'));
  if (/una\s+pata\s+(?:por|cada)\s+metro/i.test(lower)) add(fact('supportSpacing', 1, 'm'));

  const sheet = lower.match(/chapa[^\d]*(\d+(?:[.,]\d+)?)\s*m(?:etros?)?\s*[x×*]\s*(\d+(?:[.,]\d+)?)\s*m(?:etros?)?/);
  if (sheet) add(fact('sheetDimensions', [parseEngineeringNumber(sheet[1]), parseEngineeringNumber(sheet[2])], 'm'));
  if (!sheet) {
    const fallbackSheet = lower.match(/chapa[^\d]*(\d+(?:[.,]\d+)?)\s*[xX×*]\s*(\d+(?:[.,]\d+)?)/);
    if (fallbackSheet) add(fact('sheetDimensions', [parseEngineeringNumber(fallbackSheet[1]), parseEngineeringNumber(fallbackSheet[2])], 'm'));
  }

  return facts;
}

export function classifyEngineeringIntent(rawMessage: string, context?: { projectType?: string; currentIntent?: EngineeringIntent }) {
  const message = normalizeEngineeringText(rawMessage);
  const lower = engineeringSearchText(message);
  let intent: EngineeringIntent = 'GENERAL_QUESTION';
  let confidence = 0.78;

  if (/\b(antecedente|biblioteca|referencia|historial|proyecto fmh)\b/.test(lower)) intent = 'KNOWLEDGE_SEARCH';
  else if (/\b(plano|planos|dibujo|dibujos)\b/.test(lower) && /buscar|encontr|mostrar|similar/.test(lower)) intent = 'DRAWING_SEARCH';
  else if (/\b(revisar|analizar)\b/.test(lower) && /plano|dibujo/.test(lower)) intent = 'DRAWING_REVIEW';
  else if (/\b(costo|coste|precio|presupuesto)\b/.test(lower)) intent = 'COST_ESTIMATE';
  else if (/\b(comprar|compro|barras?|sobrante|plan de compra)\b/.test(lower)) intent = 'PURCHASE_PLAN';
  else if (/\b(cortar|corte|cortes|chapa|cmputo|computo|materiales?|metros? lineales?)\b/.test(lower)) intent = 'MATERIAL_TAKEOFF';
  else if (/\b(compar|contra|versus|vs)\b/.test(lower) && /patas?|apoyos?|soportes?/.test(lower)) intent = 'SUPPORT_COMPARISON';
  else if (/\b(compar|contra|versus|vs)\b/.test(lower) && /ca[nñ]o|tubo|perfil|seccion|sección/.test(lower)) intent = 'SECTION_COMPARISON';
  else if (/\b(carga|peso)\b/.test(lower) && /patas?|apoyos?|soportes?|por cada/.test(lower)) intent = 'LOAD_PER_SUPPORT';
  else if (/\b(que patas|qué patas|seleccion|selección|elegir|perfil|tubo|ca[nñ]o)\b/.test(lower) && /usar|utilizar|sirve|recom|analizar|conviene|necesito/.test(lower)) intent = 'SECTION_SELECTION';
  else if (/\b(predimension|dise[nñ]ar|estructura soporte|estructura elevada|base de silo)\b/.test(lower)) intent = 'PRELIMINARY_DESIGN';
  else if (/\b(calcul|cuanto|cuánto|cu[aá]ntas?|resultado|peso|masa)\b/.test(lower) || /\d/.test(lower) && context?.projectType === 'SILO') intent = 'QUICK_CALCULATION';

  if (context?.currentIntent && intent === 'GENERAL_QUESTION' && /^(y|tambien|también|entonces|con eso|para ese caso)\b/.test(lower)) {
    intent = context.currentIntent;
    confidence = 0.68;
  }
  if (intent === 'GENERAL_QUESTION' && /\b(pandeo|esbeltez|tension|tensión|carga|apoyo|perfil|acero)\b/.test(lower)) confidence = 0.9;
  if (!message.trim()) confidence = 0;
  return { intent, confidence };
}

export function buildMissingData(intent: EngineeringIntent, known: Array<{ key: string; value: unknown; status: string }>) {
  const has = (key: string) => known.some((item) => item.key === key && item.status === 'ACTIVE' && item.value !== undefined && item.value !== null);
  const missing: Array<{ key: string; reason: string; criticality: 'CRITICAL' | 'IMPORTANT' | 'OPTIONAL' }> = [];
  const require = (key: string, reason: string, criticality: 'CRITICAL' | 'IMPORTANT' | 'OPTIONAL') => { if (!has(key)) missing.push({ key, reason, criticality }); };
  if (intent === 'LOAD_PER_SUPPORT') { require('capacity', 'Indica la capacidad o carga total.', 'CRITICAL'); require('supportCount', 'Indica la cantidad de apoyos.', 'CRITICAL'); }
  if (intent === 'SUPPORT_COMPARISON') { require('capacity', 'Indica la capacidad o carga total.', 'CRITICAL'); require('supportAlternatives', 'Indica las alternativas de apoyos a comparar.', 'CRITICAL'); }
  if (intent === 'SECTION_SELECTION') {
    require('capacity', 'Permite estimar la carga axial inicial.', 'IMPORTANT');
    require('freeHeight', 'Define la longitud libre del elemento.', 'CRITICAL');
    require('bracing', 'Define si la longitud efectiva puede reducirse.', 'IMPORTANT');
  }
  if (intent === 'MATERIAL_TAKEOFF') { require('supportCount', 'Define la cantidad de elementos.', 'IMPORTANT'); require('freeHeight', 'Define la longitud de cada elemento.', 'IMPORTANT'); }
  if (intent === 'PURCHASE_PLAN') { require('commercialLength', 'Define el largo comercial disponible.', 'IMPORTANT'); }
  if (intent === 'COST_ESTIMATE') { require('costSource', 'Necesito precios vigentes o una fuente de costos.', 'IMPORTANT'); }
  return missing;
}

export function isNewTopic(rawMessage: string, currentIntent?: EngineeringIntent) {
  if (!currentIntent) return false;
  const next = classifyEngineeringIntent(rawMessage, { currentIntent }).intent;
  return next !== currentIntent && next !== 'GENERAL_QUESTION';
}

export function tokensForEngineeringSearch(value: string) {
  return technicalTokens(normalizeEngineeringText(value)).filter((token) => token.length >= 2);
}
