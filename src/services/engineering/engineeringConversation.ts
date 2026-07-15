import { prisma } from '../../db.js';
import { buildDeterministicEngineeringResult } from './engineeringDeterministic.js';
import { buildMissingData, classifyEngineeringIntent, normalizeEngineeringText } from './engineeringIntelligence.js';
import { activeInputs, engineeringConversationStateSchema, parseConversationState, updateConversationState, type EngineeringConversationState } from './conversationState.js';
import { engineeringAssistantResultSchema } from './engineeringSchemas.js';
import { ensureRegulationCandidates } from './regulations.js';
import { searchEngineeringGoldenLibrary } from './engineeringGoldenLibrary.js';
import { engineeringToolDefinitions, executeEngineeringTool } from './engineeringTools.js';
import { engineeringModelConfig, runEngineeringOpenAI, type EngineeringModelExecution, type EngineeringToolAudit } from './engineeringRuntime.js';

function compactState(state: EngineeringConversationState) {
  return { schemaVersion: state.schemaVersion, subject: state.subject, projectType: state.projectType, currentIntent: state.currentIntent, intentConfidence: state.intentConfidence, knownInputs: activeInputs(state), assumptions: state.assumptions, missingData: state.missingData, decisions: state.decisions, warnings: state.warnings };
}

function stateText(state: EngineeringConversationState, localAnswer: string) {
  return `Estado técnico normalizado (no mostrar claves internas al usuario): ${JSON.stringify(compactState(state))}\nResultado determinístico disponible: ${localAnswer}`;
}

function systemPrompt() {
  return `Sos el Asistente de Ingeniería de FMH, experto en estructuras metálicas, silos y equipos agroindustriales. Respondé en español argentino, con claridad y criterio práctico.\n\nReglas obligatorias:\n- Respondé primero lo que la pregunta permite resolver; no bloquees una respuesta simple por datos de una etapa posterior.\n- Preguntá sólo los datos que desbloquean el siguiente paso y como máximo los indispensables.\n- Usá los cálculos determinísticos disponibles y explicá supuestos.\n- Para cargas, comparaciones y propiedades geométricas, ejecutá la herramienta determinística correspondiente antes de responder.\n- Diferenciá dato aportado por el usuario, hipótesis, cálculo, antecedente histórico y fuente verificada.\n- Nunca inventes perfiles, precios, reglamentos, propiedades o verificaciones.\n- No muestres JSON, enums, nombres de herramientas ni razonamiento interno.\n- No digas que una estructura verifica si sólo hay un cribado preliminar.\n- Si el usuario cambia de tema, atendé la nueva pregunta y no arrastres una intención anterior.\n- Formato preferido: respuesta directa; resultado; supuestos sólo si aportan; qué falta sólo si es necesario; siguiente paso.\n- Los antecedentes FMH sirven como referencia, no como aprobación automática de un diseño.`;
}

function shouldSearch(state: EngineeringConversationState) {
  return ['KNOWLEDGE_SEARCH', 'DRAWING_SEARCH', 'DRAWING_REVIEW', 'SECTION_SELECTION', 'PRELIMINARY_DESIGN', 'SECTION_COMPARISON'].includes(state.currentIntent || '');
}

export function requiredToolForEngineeringIntent(intent?: string) {
  if (intent === 'LOAD_PER_SUPPORT') return 'calculate_load_per_support';
  if (intent === 'SUPPORT_COMPARISON') return 'compare_support_alternatives';
  if (intent === 'SECTION_COMPARISON') return 'get_section_properties';
  if (intent === 'PURCHASE_PLAN') return 'calculate_purchase_plan';
  return undefined;
}

async function loadContext(companyId: string, state: EngineeringConversationState, message: string) {
  if (!shouldSearch(state)) return { sources: [], regulations: [] };
  const query = [message, state.subject, state.projectType, ...activeInputs(state).map((item) => `${item.key} ${item.value}`)].filter(Boolean).join(' ');
  const [golden, regulations] = await Promise.all([
    searchEngineeringGoldenLibrary({ companyId, q: query, take: 8 }).catch(() => ({ fmhPrecedents: [], regulations: [], benchmarks: [], sectionCandidates: [], internationalReferences: [], sources: [], projects: [] })),
    ['PRELIMINARY_DESIGN', 'SECTION_SELECTION'].includes(state.currentIntent || '') ? ensureRegulationCandidates(companyId).then((rows) => rows.filter((row) => row.status === 'CURRENT').map((row) => ({ code: row.code, title: row.title, status: row.status, sourceUrl: row.sourceUrl || undefined, sourceType: 'OFFICIAL' as const }))).catch(() => []) : Promise.resolve([])
  ]);
  const fmhSources = golden.fmhPrecedents.map((item: any) => ({ id: item.id, title: item.title || item.projectName || item.fileName, type: `FMH_PRECEDENT_${item.trustLevel || 'HISTORICAL'}`, relevance: Number(item.confidence) || 0.5, excerpt: item.excerpt }));
  const benchmarkSources = golden.benchmarks.map((item: any) => ({ id: item.id, title: item.title, type: 'WORKED_EXAMPLE_BENCHMARK', relevance: item.verified ? 1 : 0.5, excerpt: item.problemStatement, url: item.source?.sourceUrl }));
  const sectionSources = golden.sectionCandidates.map((item: any) => ({ id: item.id, title: item.designation, type: item.source === 'STRUCTURAL_CATALOG' ? 'VERIFIED_CATALOG_CANDIDATE' : String(item.source || 'SECTION_CANDIDATE'), relevance: item.verified ? 1 : 0.5, excerpt: item.sourceTitle }));
  const internationalSources = golden.internationalReferences.map((item: any) => ({ id: item.id, title: item.title, type: 'INTERNATIONAL_REFERENCE', relevance: 0.35, excerpt: item.publisher, url: item.sourceUrl }));
  return { sources: [...fmhSources, ...benchmarkSources, ...sectionSources, ...internationalSources], regulations, goldenLibrary: { fmhPrecedents: golden.fmhPrecedents, regulations: golden.regulations, benchmarks: golden.benchmarks, sectionCandidates: golden.sectionCandidates, internationalReferences: golden.internationalReferences } };
}

function serializeError(error?: EngineeringModelExecution['error']) {
  return error ? JSON.stringify({ type: error.type, code: error.code, status: error.status, message: error.message, requestId: error.requestId }) : null;
}

type OrchestratorResult = { state: EngineeringConversationState; result: ReturnType<typeof buildDeterministicEngineeringResult>; execution: EngineeringModelExecution };

export async function runEngineeringOrchestrator(input: { companyId: string; message: string; state?: EngineeringConversationState; history?: Array<{ role: 'user' | 'assistant'; content: string }> }): Promise<OrchestratorResult> {
  const previous = input.state || parseConversationState();
  const state = updateConversationState(previous, input.message);
  state.missingData = buildMissingData(state.currentIntent || classifyEngineeringIntent(input.message).intent, activeInputs(state));
  const context = await loadContext(input.companyId, state, input.message);
  const localBase = buildDeterministicEngineeringResult({ state, message: input.message, knowledge: context, provider: 'local' });
  const modelConfig = engineeringModelConfig();
  const execution = await runEngineeringOpenAI({
    systemPrompt: systemPrompt(),
    stateText: stateText(state, localBase.answer),
    history: input.history || [],
    message: input.message,
    tools: [...engineeringToolDefinitions, ...(modelConfig.webSearchEnabled ? [{ type: 'web_search' }] : [])],
    requiredToolName: state.missingData.length ? undefined : requiredToolForEngineeringIntent(state.currentIntent),
    executeTool: (name, args) => executeEngineeringTool(name, args, input.companyId)
  });
  const fallbackUsed = !execution.success;
  const result = engineeringAssistantResultSchema.parse({ ...localBase, answer: execution.outputText || localBase.answer, provider: execution.success ? 'openai' : 'local', requestedModel: execution.requestedModel, actualModel: execution.actualModel, model: execution.success ? (execution.actualModel || execution.requestedModel) : 'local', responseId: execution.responseId, fallbackUsed, latencyMs: execution.latencyMs, executionError: execution.error, toolCalls: execution.toolCalls.map((tool) => ({ name: tool.name, status: tool.status, summary: tool.status })), intent: state.currentIntent, intentConfidence: state.intentConfidence });
  return { state, result, execution };
}

export async function createEngineeringConversation(companyId: string, title?: string) { return prisma.engineeringConversation.create({ data: { companyId, title: title?.trim() || 'Nuevo caso de Ingeniería' } }); }
export async function getEngineeringConversation(id: string, companyId: string) { return prisma.engineeringConversation.findFirst({ where: { id, companyId }, include: { messages: { orderBy: { createdAt: 'asc' } }, toolCalls: { orderBy: { createdAt: 'asc' } }, engineeringCase: true } }); }
export async function listEngineeringConversations(companyId: string) { return prisma.engineeringConversation.findMany({ where: { companyId, archivedAt: null }, include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } }, orderBy: { updatedAt: 'desc' }, take: 100 }); }

export async function answerEngineeringConversation(conversationId: string, companyId: string, message: string) {
  const conversation = await prisma.engineeringConversation.findFirst({ where: { id: conversationId, companyId }, include: { messages: { orderBy: { createdAt: 'asc' }, take: 80 } } });
  if (!conversation) throw new Error('Conversación de Ingeniería no encontrada.');
  const previousState = parseConversationState(conversation.stateJson);
  const userMessage = await prisma.engineeringMessage.create({ data: { conversationId, role: 'user', content: normalizeEngineeringText(message) } });
  const history = conversation.messages.filter((item) => item.role === 'user' || item.role === 'assistant').map((item) => ({ role: item.role as 'user' | 'assistant', content: item.content }));
  const orchestration = await runEngineeringOrchestrator({ companyId, message, state: previousState, history });
  const { result, execution, state } = orchestration;
  const assistantMessage = await prisma.engineeringMessage.create({ data: { conversationId, role: 'assistant', content: result.answer, model: result.model, responseId: execution.responseId, provider: execution.provider, requestedModel: execution.requestedModel, actualModel: execution.actualModel, fallbackUsed: !execution.success, latencyMs: execution.latencyMs, errorJson: serializeError(execution.error), intent: result.intent, intentConfidence: result.intentConfidence, tokenUsageJson: execution.usage ? JSON.stringify(execution.usage) : null, structuredResultJson: JSON.stringify(result) } });
  if (execution.toolCalls.length) await prisma.engineeringToolCall.createMany({ data: execution.toolCalls.map((tool: EngineeringToolAudit) => ({ conversationId, messageId: assistantMessage.id, name: tool.name, argumentsJson: JSON.stringify(tool.arguments), resultJson: JSON.stringify(tool.result), status: tool.status, durationMs: tool.durationMs })) });
  await prisma.engineeringConversation.update({ where: { id: conversationId }, data: { stateJson: JSON.stringify(engineeringConversationStateSchema.parse(state)), summaryJson: JSON.stringify(compactState(state)), previousResponseId: execution.responseId, model: result.model, currentIntent: result.intent, intentConfidence: result.intentConfidence, lastProvider: execution.provider, lastRequestedModel: execution.requestedModel, lastActualModel: execution.actualModel, lastLatencyMs: execution.latencyMs, lastErrorJson: serializeError(execution.error), lastFallbackUsed: !execution.success, promptVersion: engineeringModelConfig().promptVersion, title: conversation.title === 'Nuevo caso de Ingeniería' || conversation.title === 'Nuevo caso de IngenierÃ­a' ? (state.subject || message).slice(0, 90) : conversation.title } });
  return { conversationId, userMessage, assistantMessage, result, state, execution: { success: execution.success, requestedModel: execution.requestedModel, actualModel: execution.actualModel, provider: execution.provider, responseId: execution.responseId, latencyMs: execution.latencyMs, usage: execution.usage, toolCalls: execution.toolCalls.length, fallbackUsed: !execution.success, error: execution.error } };
}

export async function answerEngineeringStandalone(companyId: string, message: string) {
  const result = await runEngineeringOrchestrator({ companyId, message });
  return { ...result.result, mode: result.execution.success ? 'openai' as const : 'local' as const, execution: result.execution };
}

export async function saveEngineeringCase(conversationId: string, companyId: string, name?: string) {
  const conversation = await prisma.engineeringConversation.findFirst({ where: { id: conversationId, companyId } });
  if (!conversation) throw new Error('Conversación no encontrada.');
  const state = parseConversationState(conversation.stateJson);
  const messages = await prisma.engineeringMessage.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' } });
  const details = messages.flatMap((item) => { try { return [JSON.parse(item.structuredResultJson || '{}')]; } catch { return []; } });
  const last = details[details.length - 1] || {};
  return prisma.engineeringCase.upsert({ where: { conversationId }, update: { name: name || conversation.title, projectType: state.projectType || 'OTHER', dataJson: JSON.stringify(state.knownInputs), assumptionsJson: JSON.stringify(state.assumptions), calculationsJson: JSON.stringify(last.calculations || []), bomJson: JSON.stringify(last.materials || []), costsJson: JSON.stringify(last.purchase || {}), sourcesJson: JSON.stringify(last.sources || []), regulationsJson: JSON.stringify(last.regulations || []), status: 'PRELIMINARY' }, create: { companyId, conversationId, name: name || conversation.title, projectType: state.projectType || 'OTHER', dataJson: JSON.stringify(state.knownInputs), assumptionsJson: JSON.stringify(state.assumptions), calculationsJson: JSON.stringify(last.calculations || []), bomJson: JSON.stringify(last.materials || []), costsJson: JSON.stringify(last.purchase || {}), sourcesJson: JSON.stringify(last.sources || []), regulationsJson: JSON.stringify(last.regulations || []), status: 'PRELIMINARY' } });
}
