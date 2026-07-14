import { config } from '../../config.js';
import { prisma } from '../../db.js';
import { calculateNominalLoadPerSupport, calculateVerticalLoad } from '../../domain/engineering/structural.js';
import { searchEngineeringKnowledge } from './engineeringKnowledge.js';
import { engineeringAssistantResultSchema, type EngineeringAssistantResult } from './engineeringSchemas.js';
import { ensureRegulationCandidates } from './regulations.js';
import { activeInputs, engineeringConversationStateSchema, parseConversationState, updateConversationState, type EngineeringConversationState } from './conversationState.js';
import { engineeringToolDefinitions, executeEngineeringTool } from './engineeringTools.js';

type ToolAudit = { name: string; arguments: Record<string, unknown>; result?: unknown; status: string; durationMs?: number };
type OpenAIResponse = { id?: string; output_text?: string; output?: Array<Record<string, any>>; usage?: Record<string, unknown> };

export function engineeringModelConfig() {
  return { model: config.OPENAI_ENGINEERING_MODEL || config.OPENAI_MODEL, fastModel: config.OPENAI_ENGINEERING_FAST_MODEL || config.OPENAI_MODEL, reasoningEffort: config.OPENAI_ENGINEERING_REASONING_EFFORT, webSearchEnabled: config.OPENAI_ENGINEERING_WEB_SEARCH_ENABLED, maxRounds: config.MAX_ENGINEERING_TOOL_ROUNDS };
}

function valueOf(state: EngineeringConversationState, key: string) { return activeInputs(state).find((item) => item.key === key)?.value; }
function compactState(state: EngineeringConversationState) { return { subject: state.subject, projectType: state.projectType, knownInputs: activeInputs(state), assumptions: state.assumptions, missingData: state.missingData, decisions: state.decisions, warnings: state.warnings }; }

async function buildLocalResult(companyId: string, state: EngineeringConversationState, message: string, toolCalls: ToolAudit[] = []) {
  const query = [state.subject, state.projectType, ...activeInputs(state).map((item) => `${item.key} ${item.value}${item.unit || ''}`), message].filter(Boolean).join(' ');
  const knowledge = await searchEngineeringKnowledge({ companyId, q: query, projectType: state.projectType, take: 8 });
  const regulations = state.projectType && ['SILO', 'WAREHOUSE', 'STEEL_STRUCTURE', 'SUPPORT_STRUCTURE'].includes(state.projectType) ? (await ensureRegulationCandidates(companyId)).slice(0, 5).map((row) => ({ code: row.code, title: row.title, status: row.status, sourceUrl: row.sourceUrl || undefined, sourceType: row.status === 'CURRENT' ? 'OFFICIAL' as const : 'INTERNAL' as const })) : [];
  const calculations: EngineeringAssistantResult['calculations'] = [];
  const capacity = Number(valueOf(state, 'capacity')) * (String(activeInputs(state).find((item) => item.key === 'capacity')?.unit).toLowerCase().startsWith('kg') ? 0.001 : 1);
  const supportCount = Number(valueOf(state, 'supportCount'));
  if (state.projectType === 'SILO' && capacity > 0) {
    const vertical = calculateVerticalLoad({ storedMassT: capacity });
    calculations.push({ title: vertical.title, formula: vertical.formula, inputs: vertical.inputs, result: vertical.result.value, resultUnit: vertical.result.unit, explanation: vertical.explanation });
    if (supportCount > 0) {
      const perSupport = calculateNominalLoadPerSupport(vertical.result.value, supportCount);
      calculations.push({ title: perSupport.title, formula: perSupport.formula, inputs: perSupport.inputs, result: perSupport.result.value, resultUnit: perSupport.result.unit, explanation: perSupport.explanation });
    }
    if (state.decisions.some((decision) => /4\s*(contra|vs|versus|y)\s*6|6\s*(contra|vs|versus|y)\s*4/i.test(decision))) {
      for (const alternative of [4, 6]) {
        const perSupport = calculateNominalLoadPerSupport(vertical.result.value, alternative);
        calculations.push({ title: `Carga nominal por apoyo (${alternative} apoyos)`, formula: perSupport.formula, inputs: perSupport.inputs, result: perSupport.result.value, resultUnit: perSupport.result.unit, explanation: perSupport.explanation });
      }
    }
  }
  const missing = [...state.missingData];
  if (state.projectType === 'SILO') {
    const required: Array<[string, string, 'CRITICAL' | 'IMPORTANT' | 'OPTIONAL']> = [['product', 'Define densidad aparente y flujo del producto.', 'CRITICAL'], ['location', 'Permite revisar viento y sismicidad.', 'IMPORTANT'], ['freeHeight', 'Define geometría y longitud de apoyos.', 'IMPORTANT'], ['supportCount', 'Necesario para comparar carga ideal por apoyo.', 'IMPORTANT']];
    for (const [key, reason, criticality] of required) if (valueOf(state, key) === undefined && !missing.some((item) => item.key === key)) missing.push({ key, reason, criticality });
  }
  const sources = knowledge.sources.map((source) => ({ id: source.id, title: source.title, type: source.type, relevance: source.relevance }));
  const answer = state.projectType === 'SILO' && capacity > 0
    ? `PREDIMENSIONAMIENTO PRELIMINAR\n\nConservo los datos de esta conversación: capacidad ${capacity} t${valueOf(state, 'product') ? `, producto ${valueOf(state, 'product')}` : ''}${valueOf(state, 'location') ? `, ubicación ${valueOf(state, 'location')}` : ''}.\n\nLa carga almacenada calculada es ${calculations[0]?.result.toFixed(2)} kN. ${supportCount > 0 ? `Con ${supportCount} apoyos, la carga nominal ideal por apoyo es ${calculations[1]?.result.toFixed(2)} kN.` : 'Todavía falta definir la cantidad de apoyos para repartir la carga.'}\n\nNo selecciono un perfil definitivo: faltan viento, excentricidades, pandeo, arriostramiento, uniones, anclajes y fundación.`
    : `Entendí esta etapa del caso: ${state.subject || message}. Necesito completar los datos técnicos antes de seleccionar una sección.`;
  return engineeringAssistantResultSchema.parse({ intent: state.projectType === 'SILO' ? 'PRELIMINARY_CALCULATION' : 'GENERAL_QUESTION', subject: state.subject || message.slice(0, 100), answer, inputData: activeInputs(state).map((item) => ({ name: item.key, value: String(item.value), unit: item.unit, source: item.source })), missingData: missing.map((item) => ({ name: item.key, reason: item.reason, critical: item.criticality === 'CRITICAL' })), assumptions: state.assumptions.map((item) => item.description), calculations, materials: [], sources, regulations, toolCalls: toolCalls.map((tool) => ({ name: tool.name, status: tool.status, summary: tool.status })), warnings: ['Resultado de predimensionamiento. No es una verificación normativa completa ni aprobación para fabricar.'], confidence: sources.length ? 0.7 : 0.5, reviewRequired: true, level: calculations.length ? 'PRELIMINARY_DESIGN' : 'ORIENTATION', model: engineeringModelConfig().model, capability: calculations.length ? 'SUPPORTED_DETERMINISTIC' : 'PRELIMINARY_ASSISTED' });
}

function systemPrompt() { return `Sos el Asistente de Ingeniería interno de FMH. Trabajás dentro de una conversación persistente y debés recordar datos confirmados, hipótesis, faltantes, cálculos, decisiones y fuentes. Ayudá activamente a resolver problemas metalúrgicos y agroindustriales. Para consultas estructurales, primero recopilá datos, recuperá antecedentes, considerá reglamentos, ejecutá herramientas y separá hechos, cálculos, hipótesis y pendientes. Nunca inventes perfiles, espesores, propiedades, precios, vigencia normativa ni verificaciones. No digas que una estructura verifica si una herramienta real no lo comprobó. Los antecedentes históricos no son validación. Usá unidades explícitas. El resultado debe quedar en nivel ORIENTACIÓN, ESTIMACIÓN, PREDIMENSIONAMIENTO o CÁLCULO VERIFICADO; solo el último requiere una verificación implementada y auditada. No muestres razonamiento interno.`; }

function extractFunctionCalls(response: OpenAIResponse) { return (response.output || []).filter((item) => item.type === 'function_call').map((item) => ({ name: String(item.name), callId: String(item.call_id), arguments: JSON.parse(String(item.arguments || '{}')) as Record<string, unknown> })); }

async function callOpenAI(request: { message: string; state: EngineeringConversationState; history: Array<{ role: string; content: string }>; previousResponseId?: string | null; companyId: string }) {
  if (!config.OPENAI_API_KEY) return { answer: null, responseId: undefined, usage: undefined, toolCalls: [] as ToolAudit[] };
  const toolCalls: ToolAudit[] = [];
  const modelConfig = engineeringModelConfig();
  const tools: any[] = [...engineeringToolDefinitions];
  if (modelConfig.webSearchEnabled) tools.push({ type: 'web_search' });
  let response: OpenAIResponse | null = null;
  let messagesInput: any = [
    { role: 'system', content: [{ type: 'input_text', text: systemPrompt() }] },
    { role: 'system', content: [{ type: 'input_text', text: `Estado técnico persistente:\n${JSON.stringify(compactState(request.state))}` }] },
    ...request.history.slice(-12).map((item) => ({ role: item.role, content: [{ type: 'input_text', text: item.content }] })),
    { role: 'user', content: [{ type: 'input_text', text: request.message }] }
  ];
  for (let round = 0; round < modelConfig.maxRounds; round += 1) {
    const body: Record<string, unknown> = { model: modelConfig.model, reasoning: { effort: modelConfig.reasoningEffort }, input: messagesInput, tools, max_output_tokens: 1800, store: false };
    if (response?.id) { body.previous_response_id = response.id; body.input = messagesInput; }
    const raw = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${config.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!raw.ok) return { answer: null, responseId: response?.id, usage: response?.usage, toolCalls };
    response = await raw.json() as OpenAIResponse;
    const calls = extractFunctionCalls(response);
    if (!calls.length) break;
    messagesInput = [];
    for (const call of calls) {
      const started = Date.now();
      try {
        const result = await executeEngineeringTool(call.name, call.arguments, request.companyId);
        toolCalls.push({ name: call.name, arguments: call.arguments, result, status: 'COMPLETED', durationMs: Date.now() - started });
        messagesInput.push({ type: 'function_call_output', call_id: call.callId, output: JSON.stringify(result) });
      } catch (error) {
        const result = { error: error instanceof Error ? error.message : 'Error de herramienta' };
        toolCalls.push({ name: call.name, arguments: call.arguments, result, status: 'FAILED', durationMs: Date.now() - started });
        messagesInput.push({ type: 'function_call_output', call_id: call.callId, output: JSON.stringify(result) });
      }
    }
  }
  return { answer: response?.output_text?.trim() || null, responseId: response?.id, usage: response?.usage, toolCalls };
}

export async function createEngineeringConversation(companyId: string, title?: string) { return prisma.engineeringConversation.create({ data: { companyId, title: title?.trim() || 'Nuevo caso de Ingeniería' } }); }
export async function getEngineeringConversation(id: string, companyId: string) { return prisma.engineeringConversation.findFirst({ where: { id, companyId }, include: { messages: { orderBy: { createdAt: 'asc' } }, toolCalls: { orderBy: { createdAt: 'asc' } }, engineeringCase: true } }); }
export async function listEngineeringConversations(companyId: string) { return prisma.engineeringConversation.findMany({ where: { companyId, archivedAt: null }, include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } }, orderBy: { updatedAt: 'desc' }, take: 100 }); }

export async function answerEngineeringConversation(conversationId: string, companyId: string, message: string) {
  const conversation = await prisma.engineeringConversation.findFirst({ where: { id: conversationId, companyId }, include: { messages: { orderBy: { createdAt: 'asc' }, take: 80 } } });
  if (!conversation) throw new Error('Conversación de Ingeniería no encontrada.');
  const state = updateConversationState(parseConversationState(conversation.stateJson), message);
  const userMessage = await prisma.engineeringMessage.create({ data: { conversationId, role: 'user', content: message } });
  const history = conversation.messages.map((item) => ({ role: item.role, content: item.content }));
  const modelResult = await callOpenAI({ message, state, history, previousResponseId: conversation.previousResponseId, companyId });
  const local = await buildLocalResult(companyId, state, message, modelResult.toolCalls);
  const answer = modelResult.answer || local.answer;
  const structured = { ...local, answer, toolCalls: modelResult.toolCalls.map((tool) => ({ name: tool.name, status: tool.status, summary: tool.status })) };
  const assistantMessage = await prisma.engineeringMessage.create({ data: { conversationId, role: 'assistant', content: answer, model: modelResult.answer ? engineeringModelConfig().model : 'local', responseId: modelResult.responseId, tokenUsageJson: modelResult.usage ? JSON.stringify(modelResult.usage) : null, structuredResultJson: JSON.stringify(structured) } });
  await prisma.engineeringToolCall.createMany({ data: modelResult.toolCalls.map((tool) => ({ conversationId, messageId: assistantMessage.id, name: tool.name, argumentsJson: JSON.stringify(tool.arguments), resultJson: JSON.stringify(tool.result), status: tool.status, durationMs: tool.durationMs })) });
  await prisma.engineeringConversation.update({ where: { id: conversationId }, data: { stateJson: JSON.stringify(engineeringConversationStateSchema.parse(state)), summaryJson: JSON.stringify(compactState(state)), previousResponseId: modelResult.responseId, model: modelResult.answer ? engineeringModelConfig().model : 'local', title: conversation.title === 'Nuevo caso de Ingeniería' ? (state.subject || message).slice(0, 90) : conversation.title } });
  return { conversationId, userMessage, assistantMessage, result: structured, state };
}

export async function saveEngineeringCase(conversationId: string, companyId: string, name?: string) {
  const conversation = await prisma.engineeringConversation.findFirst({ where: { id: conversationId, companyId } });
  if (!conversation) throw new Error('Conversación no encontrada.');
  const state = parseConversationState(conversation.stateJson);
  const messages = await prisma.engineeringMessage.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' } });
  const calculations = messages.flatMap((message) => { try { return JSON.parse(message.structuredResultJson || '{}').calculations || []; } catch { return []; } });
  return prisma.engineeringCase.upsert({ where: { conversationId }, update: { name: name || conversation.title, projectType: state.projectType || 'OTHER', dataJson: JSON.stringify(state.knownInputs), assumptionsJson: JSON.stringify(state.assumptions), calculationsJson: JSON.stringify(calculations), status: 'PRELIMINARY' }, create: { companyId, conversationId, name: name || conversation.title, projectType: state.projectType || 'OTHER', dataJson: JSON.stringify(state.knownInputs), assumptionsJson: JSON.stringify(state.assumptions), calculationsJson: JSON.stringify(calculations), status: 'PRELIMINARY' } });
}
