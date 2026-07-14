import { z } from 'zod';
import { buildMissingData, classifyEngineeringIntent, engineeringIntents, extractEngineeringFacts, normalizeEngineeringText, type EngineeringIntent } from './engineeringIntelligence.js';

const inputSources = ['USER', 'DOCUMENT', 'CALCULATION', 'ASSUMPTION', 'FMH_PRECEDENT', 'INVENTORY', 'REGULATION', 'MODEL_INFERENCE'] as const;

export const engineeringConversationStateSchema = z.object({
  schemaVersion: z.number().int().default(2),
  subject: z.string().optional(),
  projectType: z.string().optional(),
  currentIntent: z.enum(engineeringIntents).optional(),
  intentConfidence: z.number().min(0).max(1).optional(),
  knownInputs: z.array(z.object({
    key: z.string(), value: z.unknown(), unit: z.string().optional(), source: z.enum(inputSources), status: z.enum(['ACTIVE', 'SUPERSEDED']),
    confidence: z.number().min(0).max(1).default(1), confirmed: z.boolean().default(false), messageId: z.string().optional(), createdAt: z.string().optional()
  })).default([]),
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

function put(state: EngineeringConversationState, key: string, value: unknown, unit?: string, source: EngineeringConversationState['knownInputs'][number]['source'] = 'USER') {
  const active = state.knownInputs.find((item) => item.key === key && item.status === 'ACTIVE');
  if (active && JSON.stringify(active.value) !== JSON.stringify(value)) active.status = 'SUPERSEDED';
  if (!active || JSON.stringify(active.value) !== JSON.stringify(value)) {
    state.knownInputs.push({ key, value, unit, source, status: 'ACTIVE', confidence: source === 'USER' ? 1 : 0.75, confirmed: source === 'USER' });
  }
}

function resolveMissing(state: EngineeringConversationState, keys: string[]) {
  state.missingData = state.missingData.filter((item) => !keys.includes(item.key));
}

function projectTypeFor(message: string) {
  const lower = normalizeEngineeringText(message).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/\bsilos?\b/.test(lower)) return 'SILO';
  if (/\bgalpon(?:es)?\b/.test(lower)) return 'WAREHOUSE';
  if (/\btolvas?\b/.test(lower)) return 'HOPPER';
  if (/\bnorias?\b/.test(lower)) return 'ELEVATOR';
  if (/\btransportador|sinfin/.test(lower)) return 'CONVEYOR';
  if (/\bestructura|soporte/.test(lower)) return 'STEEL_STRUCTURE';
  return undefined;
}

export function updateConversationState(previous: EngineeringConversationState, message: string) {
  const state = engineeringConversationStateSchema.parse(structuredClone(previous));
  const cleanMessage = normalizeEngineeringText(message);
  const detectedProjectType = projectTypeFor(cleanMessage);
  if (detectedProjectType) state.projectType = detectedProjectType;

  const classification = classifyEngineeringIntent(cleanMessage, { projectType: state.projectType, currentIntent: state.currentIntent });
  state.currentIntent = classification.intent;
  state.intentConfidence = classification.confidence;

  for (const item of extractEngineeringFacts(cleanMessage)) put(state, item.key, item.value, item.unit, item.source);
  const active = activeInputs(state);
  resolveMissing(state, active.map((item) => item.key));
  state.missingData = buildMissingData(classification.intent, active);
  state.subject ||= cleanMessage.slice(0, 120);

  const alternatives = active.find((item) => item.key === 'supportAlternatives')?.value;
  if (Array.isArray(alternatives) && alternatives.length === 2) {
    const decision = `Comparar alternativas de ${alternatives[0]} y ${alternatives[1]} apoyos.`;
    state.decisions = Array.from(new Set([...state.decisions, decision]));
  }
  return state;
}

export function activeInputs(state: EngineeringConversationState) { return state.knownInputs.filter((item) => item.status === 'ACTIVE'); }

export function activeValue(state: EngineeringConversationState, key: string) { return activeInputs(state).find((item) => item.key === key)?.value; }

export type { EngineeringIntent };
