import { z } from 'zod';

export const engineeringConversationStateSchema = z.object({
  subject: z.string().optional(), projectType: z.string().optional(),
  knownInputs: z.array(z.object({ key: z.string(), value: z.unknown(), unit: z.string().optional(), source: z.enum(['USER', 'DOCUMENT', 'CALCULATION', 'ASSUMPTION']), status: z.enum(['ACTIVE', 'SUPERSEDED']) })).default([]),
  assumptions: z.array(z.object({ description: z.string(), status: z.enum(['ACTIVE', 'CONFIRMED', 'REJECTED']) })).default([]),
  missingData: z.array(z.object({ key: z.string(), reason: z.string(), criticality: z.enum(['CRITICAL', 'IMPORTANT', 'OPTIONAL']) })).default([]),
  selectedReferences: z.array(z.string()).default([]), calculationsPerformed: z.array(z.string()).default([]), decisions: z.array(z.string()).default([]), warnings: z.array(z.string()).default([])
});
export type EngineeringConversationState = z.infer<typeof engineeringConversationStateSchema>;

export function parseConversationState(value?: string | null): EngineeringConversationState { try { return engineeringConversationStateSchema.parse(value ? JSON.parse(value) : {}); } catch { return engineeringConversationStateSchema.parse({}); } }

function put(state: EngineeringConversationState, key: string, value: unknown, unit?: string) {
  const active = state.knownInputs.find((item) => item.key === key && item.status === 'ACTIVE');
  if (active && JSON.stringify(active.value) !== JSON.stringify(value)) active.status = 'SUPERSEDED';
  state.knownInputs.push({ key, value, unit, source: 'USER', status: 'ACTIVE' });
}

export function updateConversationState(previous: EngineeringConversationState, message: string) {
  const state = structuredClone(previous);
  const lower = message.toLowerCase();
  if (lower.includes('silo')) state.projectType = 'SILO';
  else if (lower.includes('galpón') || lower.includes('galpon')) state.projectType = 'WAREHOUSE';
  else if (lower.includes('tolva')) state.projectType = 'HOPPER';
  else if (lower.includes('noria')) state.projectType = 'ELEVATOR';
  else if (lower.includes('estructura')) state.projectType = 'STEEL_STRUCTURE';
  const capacity = message.match(/(\d+(?:[,.]\d+)?)\s*(t|ton|toneladas|kg)\b/i);
  if (capacity) put(state, 'capacity', Number(capacity[1].replace(',', '.')), capacity[2]);
  const freeHeight = message.match(/(?:libres?|altura libre|altura)\s*(?:de|=|:)?\s*(\d+(?:[,.]\d+)?)\s*m/i) || message.match(/(\d+(?:[,.]\d+)?)\s*m(?:etros?)?\s*(?:libres?|libre)/i);
  if (freeHeight) put(state, 'freeHeight', Number(freeHeight[1].replace(',', '.')), 'm');
  const supports = message.match(/(\d+)\s*(?:patas|apoyos|soportes)/i);
  if (supports) put(state, 'supportCount', Number(supports[1]), 'un');
  const location = message.match(/(?:va|instalado|instalación|instalacion)\s+(?:en|a)\s+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ .-]{2,60})/i);
  if (location) put(state, 'location', location[1].trim());
  if (/maíz|maiz/i.test(message)) put(state, 'product', 'maíz');
  if (/trigo/i.test(message)) put(state, 'product', 'trigo');
  if (/4\s*(?:patas|apoyos).{0,30}6\s*(?:patas|apoyos)|compar.*4.*6/i.test(lower)) state.decisions.push('Comparar alternativas de 4 y 6 apoyos.');
  state.subject ||= message.slice(0, 100);
  if (state.projectType === 'SILO' && !state.knownInputs.some((item) => item.key === 'product' && item.status === 'ACTIVE')) state.missingData = [{ key: 'product', reason: 'Define densidad y comportamiento del material.', criticality: 'CRITICAL' }, ...state.missingData.filter((item) => item.key !== 'product')];
  return state;
}

export function activeInputs(state: EngineeringConversationState) { return state.knownInputs.filter((item) => item.status === 'ACTIVE'); }
