import { config } from '../../config.js';
import { prisma } from '../../db.js';
import { calculateNominalLoadPerSupport, calculateVerticalLoad } from '../../domain/engineering/structural.js';
import { buildEngineeringMaterialEstimate } from './engineeringEstimate.js';
import { searchEngineeringKnowledge } from './engineeringKnowledge.js';
import { engineeringAssistantResultSchema, type EngineeringAssistantResult } from './engineeringSchemas.js';
import { ensureRegulationCandidates } from './regulations.js';
import { activeInputs, engineeringConversationStateSchema, parseConversationState, updateConversationState, type EngineeringConversationState } from './conversationState.js';
import { engineeringToolDefinitions, executeEngineeringTool } from './engineeringTools.js';

type ToolAudit = { name: string; arguments: Record<string, unknown>; result?: unknown; status: string; durationMs?: number };
type OpenAIResponse = { id?: string; output_text?: string; output?: Array<Record<string, any>>; usage?: Record<string, unknown> };

export function engineeringModelConfig() { return { model: config.OPENAI_ENGINEERING_MODEL || config.OPENAI_MODEL, fastModel: config.OPENAI_ENGINEERING_FAST_MODEL || config.OPENAI_MODEL, reasoningEffort: config.OPENAI_ENGINEERING_REASONING_EFFORT, webSearchEnabled: config.OPENAI_ENGINEERING_WEB_SEARCH_ENABLED, maxRounds: config.MAX_ENGINEERING_TOOL_ROUNDS }; }
function valueOf(state: EngineeringConversationState, key: string) { return activeInputs(state).find((item) => item.key === key)?.value; }
function compactState(state: EngineeringConversationState) { return { subject: state.subject, projectType: state.projectType, knownInputs: activeInputs(state), assumptions: state.assumptions, missingData: state.missingData, decisions: state.decisions, warnings: state.warnings }; }
function numberOf(value: unknown) { const result = Number(value); return Number.isFinite(result) ? result : 0; }

async function buildLocalResult(companyId: string, state: EngineeringConversationState, message: string, toolCalls: ToolAudit[] = []) {
  const query = [state.subject, state.projectType, ...activeInputs(state).map((item) => `${item.key} ${item.value}${item.unit || ''}`), message].filter(Boolean).join(' ');
  const knowledge = await searchEngineeringKnowledge({ companyId, q: query, projectType: state.projectType, take: 8 });
  const structural = ['SILO', 'WAREHOUSE', 'STEEL_STRUCTURE', 'SUPPORT_STRUCTURE'].includes(state.projectType || '');
  const regulations = structural ? (await ensureRegulationCandidates(companyId)).filter((row) => row.status === 'CURRENT').map((row) => ({ code: row.code, title: row.title, status: row.status, sourceUrl: row.sourceUrl || undefined, sourceType: 'OFFICIAL' as const })) : [];
  const calculations: EngineeringAssistantResult['calculations'] = [];
  const capacityInput = activeInputs(state).find((item) => item.key === 'capacity');
  const capacity = numberOf(valueOf(state, 'capacity')) * (String(capacityInput?.unit || '').toLowerCase().startsWith('kg') ? 0.001 : 1);
  const alternatives = (valueOf(state, 'supportAlternatives') as unknown[] | undefined)?.map(Number).filter((value) => Number.isInteger(value) && value > 0) || [];
  const supportCount = alternatives[alternatives.length - 1] || numberOf(valueOf(state, 'supportCount'));
  if (state.projectType === 'SILO' && capacity > 0) {
    const vertical = calculateVerticalLoad({ storedMassT: capacity });
    calculations.push({ title: vertical.title, formula: vertical.formula, inputs: vertical.inputs, result: vertical.result.value, resultUnit: vertical.result.unit, explanation: vertical.explanation });
    const counts = alternatives.length ? alternatives : supportCount > 0 ? [supportCount] : [];
    for (const count of counts) {
      const perSupport = calculateNominalLoadPerSupport(vertical.result.value, count);
      calculations.push({ title: `Carga nominal por apoyo (${count} apoyos)`, formula: perSupport.formula, inputs: perSupport.inputs, result: perSupport.result.value, resultUnit: perSupport.result.unit, explanation: perSupport.explanation });
    }
    if (counts.length === 2) {
      const low = calculations[1].result;
      const high = calculations[2].result;
      calculations.push({ title: 'Diferencia entre alternativas', formula: 'Diferencia = carga menor - carga mayor', inputs: [{ name: 'alternativa menor', value: low, unit: 'kN' }, { name: 'alternativa mayor', value: high, unit: 'kN' }], result: low - high, resultUnit: 'kN', explanation: `La alternativa de ${counts[1]} apoyos reduce aproximadamente ${((1 - high / low) * 100).toFixed(0)} % la carga nominal por apoyo.` });
    }
  }
  const missing = [...state.missingData];
  if (state.projectType === 'SILO') {
    const required: Array<[string, string, 'CRITICAL' | 'IMPORTANT' | 'OPTIONAL']> = [['product', 'Indica el producto y su densidad aparente.', 'CRITICAL'], ['location', 'Permite revisar acciones climáticas y ubicación.', 'IMPORTANT'], ['freeHeight', 'Define la longitud inicial de los apoyos.', 'IMPORTANT'], ['supportAlternatives', 'Permite comparar la distribución de carga.', 'IMPORTANT']];
    for (const [key, reason, criticality] of required) if (valueOf(state, key) === undefined && !missing.some((item) => item.key === key)) missing.push({ key, reason, criticality });
  }
  const sources = knowledge.sources.map((source) => ({ id: source.id, title: source.title, type: source.type, relevance: source.relevance }));
  const estimate = await buildEngineeringMaterialEstimate(companyId, state);
  const enoughForComparison = state.projectType === 'SILO' && capacity > 0 && alternatives.length === 2;
  let answer: string;
  if (!capacity && missing.length) answer = `Entendí el pedido. Para avanzar necesito ${missing.map((item) => item.reason.toLowerCase()).slice(0, 4).join('; ')}.`;
  else if (!enoughForComparison) answer = `Perfecto. Ya tengo ${activeInputs(state).filter((item) => ['capacity', 'product', 'location', 'freeHeight'].includes(item.key)).map((item) => `${item.key}: ${item.value}${item.unit || ''}`).join(', ')}. Todavía necesito completar los datos marcados para hacer la comparación y preparar el cómputo preliminar.`;
  else answer = `Perfecto. Comparé las alternativas de ${alternatives[0]} y ${alternatives[1]} apoyos con la carga almacenada inicial. La carga vertical del producto es aproximadamente ${calculations[0].result.toFixed(0)} kN y la alternativa de ${alternatives[1]} apoyos reduce la carga nominal por apoyo aproximadamente un ${((1 - calculations[2].result / calculations[1].result) * 100).toFixed(0)} %. Esto es un predimensionamiento: todavía hay que incorporar peso propio, viento, estabilidad, uniones y fundaciones. ${estimate ? `Preparé un cómputo preliminar con ${estimate.materials.length} grupos de materiales.` : 'Puedo preparar el cómputo cuando confirmemos las longitudes o secciones.'}`;
  const materials = estimate?.materials.map((item) => {
    const candidate = estimate.candidateSections.find((section) => section.id === item.candidateId);
    return { ...item, sourceTitle: candidate?.sourceTitle, candidateId: candidate?.id };
  }) || [];
  return engineeringAssistantResultSchema.parse({ intent: state.projectType === 'SILO' ? 'PRELIMINARY_CALCULATION' : 'GENERAL_QUESTION', subject: state.subject || message.slice(0, 100), answer, inputData: activeInputs(state).map((item) => ({ name: item.key, value: String(item.value), unit: item.unit, source: item.source })), missingData: missing.map((item) => ({ name: item.key, reason: item.reason, critical: item.criticality === 'CRITICAL' })), assumptions: [...state.assumptions.map((item) => item.description), ...(estimate?.assumptions || [])], calculations, materials, purchase: estimate?.purchase || [], estimatedCost: estimate && estimate.costKnown > 0 ? { currency: 'ARS', materials: estimate.costKnown, total: estimate.costKnown } : undefined, sources, regulations, toolCalls: toolCalls.map((tool) => ({ name: tool.name, status: tool.status, summary: tool.status })), warnings: enoughForComparison ? ['Las secciones y longitudes son preliminares; requieren revisión de ingeniería.'] : [], confidence: sources.length ? 0.7 : 0.5, reviewRequired: true, level: calculations.length ? 'PRELIMINARY_DESIGN' : 'ORIENTATION', model: engineeringModelConfig().model, capability: calculations.length ? 'SUPPORTED_DETERMINISTIC' : 'PRELIMINARY_ASSISTED' });
}

function systemPrompt() { return 'Sos el Asistente de Ingenieria interno de FMH. Trabajas dentro de una conversacion persistente. Recorda datos, hipotesis, faltantes, calculos y fuentes. Responde claro y breve en espanol argentino. No muestres claves internas, enums ni razonamiento. Busca antecedentes, usa herramientas y prepara computos de materiales cuando haya datos suficientes. Nunca inventes perfiles, precios o verificaciones. Diferencia orientacion, estimacion y predimensionamiento. No digas que una estructura verifica si no existe una herramienta que lo haya comprobado.'; }
function extractFunctionCalls(response: OpenAIResponse) { return (response.output || []).filter((item) => item.type === 'function_call').map((item) => ({ name: String(item.name), callId: String(item.call_id), arguments: JSON.parse(String(item.arguments || '{}')) as Record<string, unknown> })); }

async function callOpenAI(request: { message: string; state: EngineeringConversationState; history: Array<{ role: string; content: string }>; previousResponseId?: string | null; companyId: string }) {
  if (!config.OPENAI_API_KEY) return { answer: null, responseId: undefined, usage: undefined, toolCalls: [] as ToolAudit[] };
  const toolCalls: ToolAudit[] = [];
  const modelConfig = engineeringModelConfig();
  const tools: any[] = [...engineeringToolDefinitions];
  if (modelConfig.webSearchEnabled) tools.push({ type: 'web_search' });
  let response: OpenAIResponse | null = null;
  let input: any = [{ role: 'system', content: [{ type: 'input_text', text: systemPrompt() }] }, { role: 'system', content: [{ type: 'input_text', text: `Estado tecnico: ${JSON.stringify(compactState(request.state))}` }] }, ...request.history.slice(-12).map((item) => ({ role: item.role, content: [{ type: 'input_text', text: item.content }] })), { role: 'user', content: [{ type: 'input_text', text: request.message }] }];
  for (let round = 0; round < modelConfig.maxRounds; round += 1) {
    const body: Record<string, unknown> = { model: modelConfig.model, reasoning: { effort: modelConfig.reasoningEffort }, input, tools, max_output_tokens: 1800, store: false };
    if (response?.id) body.previous_response_id = response.id;
    const raw = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${config.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!raw.ok) return { answer: null, responseId: response?.id, usage: response?.usage, toolCalls };
    response = await raw.json() as OpenAIResponse;
    const calls = extractFunctionCalls(response);
    if (!calls.length) break;
    input = [];
    for (const call of calls) { const started = Date.now(); try { const result = await executeEngineeringTool(call.name, call.arguments, request.companyId); toolCalls.push({ name: call.name, arguments: call.arguments, result, status: 'COMPLETED', durationMs: Date.now() - started }); input.push({ type: 'function_call_output', call_id: call.callId, output: JSON.stringify(result) }); } catch (error) { const result = { error: error instanceof Error ? error.message : 'Error de herramienta' }; toolCalls.push({ name: call.name, arguments: call.arguments, result, status: 'FAILED', durationMs: Date.now() - started }); input.push({ type: 'function_call_output', call_id: call.callId, output: JSON.stringify(result) }); } }
  }
  return { answer: response?.output_text?.trim() || null, responseId: response?.id, usage: response?.usage, toolCalls };
}

export async function createEngineeringConversation(companyId: string, title?: string) { return prisma.engineeringConversation.create({ data: { companyId, title: title?.trim() || 'Nuevo caso de Ingenieria' } }); }
export async function getEngineeringConversation(id: string, companyId: string) { return prisma.engineeringConversation.findFirst({ where: { id, companyId }, include: { messages: { orderBy: { createdAt: 'asc' } }, toolCalls: { orderBy: { createdAt: 'asc' } }, engineeringCase: true } }); }
export async function listEngineeringConversations(companyId: string) { return prisma.engineeringConversation.findMany({ where: { companyId, archivedAt: null }, include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } }, orderBy: { updatedAt: 'desc' }, take: 100 }); }

export async function answerEngineeringConversation(conversationId: string, companyId: string, message: string) {
  const conversation = await prisma.engineeringConversation.findFirst({ where: { id: conversationId, companyId }, include: { messages: { orderBy: { createdAt: 'asc' }, take: 80 } } });
  if (!conversation) throw new Error('Conversacion de Ingenieria no encontrada.');
  const state = updateConversationState(parseConversationState(conversation.stateJson), message);
  const userMessage = await prisma.engineeringMessage.create({ data: { conversationId, role: 'user', content: message } });
  const history = conversation.messages.map((item) => ({ role: item.role, content: item.content }));
  const modelResult = await callOpenAI({ message, state, history, previousResponseId: conversation.previousResponseId, companyId });
  const local = await buildLocalResult(companyId, state, message, modelResult.toolCalls);
  const answer = modelResult.answer || local.answer;
  const structured = { ...local, answer };
  const assistantMessage = await prisma.engineeringMessage.create({ data: { conversationId, role: 'assistant', content: answer, model: modelResult.answer ? engineeringModelConfig().model : 'local', responseId: modelResult.responseId, tokenUsageJson: modelResult.usage ? JSON.stringify(modelResult.usage) : null, structuredResultJson: JSON.stringify(structured) } });
  if (modelResult.toolCalls.length) await prisma.engineeringToolCall.createMany({ data: modelResult.toolCalls.map((tool) => ({ conversationId, messageId: assistantMessage.id, name: tool.name, argumentsJson: JSON.stringify(tool.arguments), resultJson: JSON.stringify(tool.result), status: tool.status, durationMs: tool.durationMs })) });
  await prisma.engineeringConversation.update({ where: { id: conversationId }, data: { stateJson: JSON.stringify(engineeringConversationStateSchema.parse(state)), summaryJson: JSON.stringify(compactState(state)), previousResponseId: modelResult.responseId, model: modelResult.answer ? engineeringModelConfig().model : 'local', title: conversation.title === 'Nuevo caso de Ingenieria' ? (state.subject || message).slice(0, 90) : conversation.title } });
  return { conversationId, userMessage, assistantMessage, result: structured, state };
}

export async function saveEngineeringCase(conversationId: string, companyId: string, name?: string) {
  const conversation = await prisma.engineeringConversation.findFirst({ where: { id: conversationId, companyId } });
  if (!conversation) throw new Error('Conversacion no encontrada.');
  const state = parseConversationState(conversation.stateJson);
  const messages = await prisma.engineeringMessage.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' } });
  const details = messages.flatMap((item) => { try { return [JSON.parse(item.structuredResultJson || '{}')]; } catch { return []; } });
  const last = details[details.length - 1] || {};
  return prisma.engineeringCase.upsert({ where: { conversationId }, update: { name: name || conversation.title, projectType: state.projectType || 'OTHER', dataJson: JSON.stringify(state.knownInputs), assumptionsJson: JSON.stringify(state.assumptions), calculationsJson: JSON.stringify(last.calculations || []), bomJson: JSON.stringify(last.materials || []), costsJson: JSON.stringify(last.purchase || {}), sourcesJson: JSON.stringify(last.sources || []), regulationsJson: JSON.stringify(last.regulations || []), status: 'PRELIMINARY' }, create: { companyId, conversationId, name: name || conversation.title, projectType: state.projectType || 'OTHER', dataJson: JSON.stringify(state.knownInputs), assumptionsJson: JSON.stringify(state.assumptions), calculationsJson: JSON.stringify(last.calculations || []), bomJson: JSON.stringify(last.materials || []), costsJson: JSON.stringify(last.purchase || {}), sourcesJson: JSON.stringify(last.sources || []), regulationsJson: JSON.stringify(last.regulations || []), status: 'PRELIMINARY' } });
}
