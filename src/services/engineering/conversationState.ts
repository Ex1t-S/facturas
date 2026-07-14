import { z } from 'zod';

export const engineeringConversationStateSchema = z.object({
  subject: z.string().optional(),
  projectType: z.string().optional(),
  knownInputs: z.array(z.object({ key: z.string(), value: z.unknown(), unit: z.string().optional(), source: z.enum(['USER', 'DOCUMENT', 'CALCULATION', 'ASSUMPTION']), status: z.enum(['ACTIVE', 'SUPERSEDED']) })).default([]),
  assumptions: z.array(z.object({ description: z.string(), status: z.enum(['ACTIVE', 'CONFIRMED', 'REJECTED']) })).default([]),
  missingData: z.array(z.object({ key: z.string(), reason: z.string(), criticality: z.enum(['CRITICAL', 'IMPORTANT', 'OPTIONAL']) })).default([]),
  selectedReferences: z.array(z.string()).default([]),
  calculationsPerformed: z.array(z.string()).default([]),
  decisions: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([])
});
export type EngineeringConversationState = z.infer<typeof engineeringConversationStateSchema>;

export function parseConversationState(value?: string | null): EngineeringConversationState {
  try { return engineeringConversationStateSchema.parse(value ? JSON.parse(value) : {}); } catch { return engineeringConversationStateSchema.parse({}); }
}

function put(state: EngineeringConversationState, key: string, value: unknown, unit?: string) {
  const active = state.knownInputs.find((item) => item.key === key && item.status === 'ACTIVE');
  if (active && JSON.stringify(active.value) !== JSON.stringify(value)) active.status = 'SUPERSEDED';
  if (!active || JSON.stringify(active.value) !== JSON.stringify(value)) state.knownInputs.push({ key, value, unit, source: 'USER', status: 'ACTIVE' });
}

function resolveMissing(state: EngineeringConversationState, key: string) {
  state.missingData = state.missingData.filter((item) => item.key !== key);
}

function captureDimensions(state: EngineeringConversationState, message: string) {
  const patterns: Array<[string, RegExp]> = [
    ['diameter', /(?:diametro|di[aá]metro|Ø)\s*(?:de|=|:)?\s*(\d+(?:[,.]\d+)?)\s*m/i],
    ['bodyHeight', /(?:cuerpo|alto del cuerpo)\s*(?:de|=|:)?\s*(\d+(?:[,.]\d+)?)\s*m/i],
    ['coneHeight', /(?:cono|alto del cono)\s*(?:de|=|:)?\s*(\d+(?:[,.]\d+)?)\s*m/i]
  ];
  for (const [key, pattern] of patterns) { const match = message.match(pattern); if (match) put(state, key, Number(match[1].replace(',', '.')), 'm'); }
  const reversed = [...message.matchAll(/(\d+(?:[,.]\d+)?)\s*m(?:etros?)?\s*(?:de\s*)?(di[aá]metro|cuerpo|cono|altura)/gi)];
  for (const match of reversed) {
    const label = match[2].toLowerCase();
    const key = label.includes('di') ? 'diameter' : label.includes('cuerpo') ? 'bodyHeight' : label.includes('cono') ? 'coneHeight' : 'height';
    put(state, key, Number(match[1].replace(',', '.')), 'm');
  }
}

export function updateConversationState(previous: EngineeringConversationState, message: string) {
  const state = structuredClone(previous);
  const lower = message.toLowerCase();
  if (lower.includes('silo')) state.projectType = 'SILO';
  else if (lower.includes('galpon') || lower.includes('galpón')) state.projectType = 'WAREHOUSE';
  else if (lower.includes('tolva')) state.projectType = 'HOPPER';
  else if (lower.includes('noria')) state.projectType = 'ELEVATOR';
  else if (lower.includes('estructura')) state.projectType = 'STEEL_STRUCTURE';
  const capacity = message.match(/(\d+(?:[,.]\d+)?)\s*(t|ton|toneladas|kg)\b/i);
  if (capacity) { put(state, 'capacity', Number(capacity[1].replace(',', '.')), capacity[2]); resolveMissing(state, 'capacity'); }
  const freeHeight = message.match(/(?:libres?|altura libre|altura)\s*(?:de|=|:)?\s*(\d+(?:[,.]\d+)?)\s*m/i) || message.match(/(\d+(?:[,.]\d+)?)\s*m(?:etros?)?\s*(?:libres?|libre)/i);
  if (freeHeight) { put(state, 'freeHeight', Number(freeHeight[1].replace(',', '.')), 'm'); resolveMissing(state, 'freeHeight'); }
  const supports = message.match(/(\d+)\s*(?:patas|apoyos|soportes)/i);
  if (supports) { put(state, 'supportCount', Number(supports[1]), 'un'); resolveMissing(state, 'supportCount'); }
  const location = message.match(/(?:va|instalado|instalación|instalacion)\s+(?:en|a)\s+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ .-]{2,60})/i);
  if (location) { put(state, 'location', location[1].trim()); resolveMissing(state, 'location'); }
  if (/maíz|maiz/i.test(message)) { put(state, 'product', 'maíz'); resolveMissing(state, 'product'); }
  if (/trigo/i.test(message)) { put(state, 'product', 'trigo'); resolveMissing(state, 'product'); }
  captureDimensions(state, message);
  const comparison = lower.match(/(\d+)\s*(?:patas|apoyos)\s*(?:contra|vs|versus|y)\s*(\d+)\s*(?:patas|apoyos)|compar(?:ar|a)?\s+(\d+)\s*(?:patas|apoyos)?\s*(?:contra|vs|versus|y)\s*(\d+)/i);
  if (comparison) {
    const first = Number(comparison[1] || comparison[3]);
    const second = Number(comparison[2] || comparison[4]);
    put(state, 'supportAlternatives', [first, second].sort((a, b) => a - b), 'un');
    resolveMissing(state, 'supportCount');
    state.decisions = [...new Set([...state.decisions, `Comparar alternativas de ${first} y ${second} apoyos.`])];
  }
  state.subject ||= message.slice(0, 100);
  if (state.projectType === 'SILO' && !state.knownInputs.some((item) => item.key === 'product' && item.status === 'ACTIVE')) state.missingData = [{ key: 'product', reason: 'Define densidad y comportamiento del material.', criticality: 'CRITICAL' }, ...state.missingData.filter((item) => item.key !== 'product')];
  else resolveMissing(state, 'product');
  return state;
}

export function activeInputs(state: EngineeringConversationState) { return state.knownInputs.filter((item) => item.status === 'ACTIVE'); }
