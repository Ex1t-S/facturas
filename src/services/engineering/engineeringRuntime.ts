import { config } from '../../config.js';

export type EngineeringModelError = { type?: string; code?: string; status?: number; message: string; requestId?: string };
export type EngineeringUsage = { inputTokens?: number; outputTokens?: number; totalTokens?: number };
export type EngineeringToolAudit = { name: string; arguments: Record<string, unknown>; result?: unknown; status: 'COMPLETED' | 'FAILED' | 'SKIPPED'; durationMs?: number };

export type EngineeringModelExecution = {
  success: boolean;
  requestedModel: string;
  actualModel?: string;
  provider: 'openai' | 'local';
  latencyMs: number;
  responseId?: string;
  outputText?: string;
  usage?: EngineeringUsage;
  toolCalls: EngineeringToolAudit[];
  error?: EngineeringModelError;
};

export function resolveEngineeringModel() {
  const configured = config.OPENAI_ENGINEERING_MODEL.trim();
  return { requestedModel: configured || 'gpt-5.6-sol', source: configured ? 'OPENAI_ENGINEERING_MODEL' : 'default' } as const;
}

export function engineeringModelConfig() {
  const resolved = resolveEngineeringModel();
  return {
    ...resolved,
    fastModel: config.OPENAI_ENGINEERING_FAST_MODEL.trim() || resolved.requestedModel,
    reasoningEffort: config.OPENAI_ENGINEERING_REASONING_EFFORT,
    webSearchEnabled: config.OPENAI_ENGINEERING_WEB_SEARCH_ENABLED,
    maxRounds: config.MAX_ENGINEERING_TOOL_ROUNDS,
    maxOutputTokens: config.OPENAI_ENGINEERING_MAX_OUTPUT_TOKENS,
    promptVersion: config.ENGINEERING_PROMPT_VERSION
  };
}

type OpenAIResponse = { id?: string; model?: string; output_text?: string; output?: Array<Record<string, unknown>>; usage?: Record<string, unknown> };

function usageOf(value?: Record<string, unknown>): EngineeringUsage | undefined {
  if (!value) return undefined;
  const number = (key: string) => typeof value[key] === 'number' ? Number(value[key]) : undefined;
  return { inputTokens: number('input_tokens'), outputTokens: number('output_tokens'), totalTokens: number('total_tokens') };
}

function errorFromResponse(status: number, requestId: string | undefined, body: string): EngineeringModelError {
  let parsed: any;
  try { parsed = JSON.parse(body); } catch { parsed = undefined; }
  const error = parsed?.error || parsed;
  return { type: String(error?.type || 'http_error'), code: error?.code ? String(error.code) : undefined, status, message: String(error?.message || body || `OpenAI respondió HTTP ${status}`).slice(0, 1000), requestId };
}

function extractFunctionCalls(response: OpenAIResponse) {
  return (response.output || []).filter((item) => item.type === 'function_call').flatMap((item) => {
    try {
      return [{ name: String(item.name), callId: String(item.call_id), arguments: JSON.parse(String(item.arguments || '{}')) as Record<string, unknown> }];
    } catch {
      return [];
    }
  });
}

export function extractEngineeringResponseText(response: OpenAIResponse) {
  if (response.output_text?.trim()) return response.output_text.trim();
  return (response.output || []).flatMap((item) => {
    const direct = typeof item.text === 'string' ? [item.text] : [];
    const content = Array.isArray(item.content) ? item.content as Array<Record<string, unknown>> : [];
    return [...direct, ...content.flatMap((part) => typeof part.text === 'string' ? [part.text] : [])];
  }).map((text) => text.trim()).filter(Boolean).join('\n\n') || undefined;
}

export async function runEngineeringOpenAI(input: {
  systemPrompt: string;
  stateText: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  message: string;
  tools: any[];
  executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}) : Promise<EngineeringModelExecution> {
  const startedAt = Date.now();
  const modelConfig = engineeringModelConfig();
  if (!config.OPENAI_API_KEY.trim()) {
    return { success: false, requestedModel: modelConfig.requestedModel, provider: 'openai', latencyMs: Date.now() - startedAt, toolCalls: [], error: { type: 'configuration_error', code: 'MISSING_OPENAI_API_KEY', message: 'OPENAI_API_KEY no está configurada en el servidor.' } };
  }

  const toolCalls: EngineeringToolAudit[] = [];
  let response: OpenAIResponse | undefined;
  let inputItems: any[] = [
    { role: 'system', content: [{ type: 'input_text', text: input.systemPrompt }] },
    { role: 'system', content: [{ type: 'input_text', text: input.stateText }] },
    ...input.history.slice(-14).map((item) => ({ role: item.role, content: [{ type: 'input_text', text: item.content }] })),
    { role: 'user', content: [{ type: 'input_text', text: input.message }] }
  ];
  const seenToolCalls = new Set<string>();
  let consecutiveFailures = 0;

  for (let round = 0; round < modelConfig.maxRounds; round += 1) {
    const body: Record<string, unknown> = {
      model: modelConfig.requestedModel,
      reasoning: { effort: modelConfig.reasoningEffort },
      text: { verbosity: 'medium' },
      input: inputItems,
      tools: input.tools,
      max_output_tokens: modelConfig.maxOutputTokens,
      store: false
    };
    if (response?.id) body.previous_response_id = response.id;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    let raw: Response;
    try {
      raw = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${config.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
    } catch (error) {
      clearTimeout(timeout);
      return { success: false, requestedModel: modelConfig.requestedModel, actualModel: response?.model, provider: 'openai', latencyMs: Date.now() - startedAt, responseId: response?.id, usage: usageOf(response?.usage), toolCalls, error: { type: error instanceof DOMException && error.name === 'AbortError' ? 'timeout' : 'network_error', message: error instanceof Error ? error.message : 'No se pudo conectar con OpenAI.' } };
    }
    clearTimeout(timeout);
    if (!raw.ok) {
      const requestId = raw.headers.get('x-request-id') || undefined;
      return { success: false, requestedModel: modelConfig.requestedModel, actualModel: response?.model, provider: 'openai', latencyMs: Date.now() - startedAt, responseId: response?.id, usage: usageOf(response?.usage), toolCalls, error: errorFromResponse(raw.status, requestId, await raw.text()) };
    }
    response = await raw.json() as OpenAIResponse;
    const calls = extractFunctionCalls(response);
    if (!calls.length) break;
    inputItems = [];
    for (const call of calls) {
      const signature = `${call.name}:${JSON.stringify(call.arguments)}`;
      if (seenToolCalls.has(signature)) {
        toolCalls.push({ name: call.name, arguments: call.arguments, status: 'SKIPPED', result: { error: 'Se detectó un ciclo de herramienta.' } });
        inputItems.push({ type: 'function_call_output', call_id: call.callId, output: JSON.stringify({ error: 'No repitas esta herramienta; responde con los datos disponibles.' }) });
        continue;
      }
      seenToolCalls.add(signature);
      const toolStarted = Date.now();
      try {
        const result = await input.executeTool(call.name, call.arguments);
        toolCalls.push({ name: call.name, arguments: call.arguments, result, status: 'COMPLETED', durationMs: Date.now() - toolStarted });
        consecutiveFailures = 0;
        inputItems.push({ type: 'function_call_output', call_id: call.callId, output: JSON.stringify(result) });
      } catch (error) {
        const result = { error: error instanceof Error ? error.message : 'Error de herramienta' };
        toolCalls.push({ name: call.name, arguments: call.arguments, result, status: 'FAILED', durationMs: Date.now() - toolStarted });
        consecutiveFailures += 1;
        inputItems.push({ type: 'function_call_output', call_id: call.callId, output: JSON.stringify(result) });
        if (consecutiveFailures >= 3) break;
      }
    }
    if (consecutiveFailures >= 3) break;
  }

  const outputText = response ? extractEngineeringResponseText(response) : undefined;
  if (!outputText) {
    return { success: false, requestedModel: modelConfig.requestedModel, actualModel: response?.model, provider: 'openai', latencyMs: Date.now() - startedAt, responseId: response?.id, usage: usageOf(response?.usage), toolCalls, error: { type: 'empty_response', code: 'EMPTY_OUTPUT', message: 'OpenAI no devolvió texto utilizable.' } };
  }
  return { success: true, requestedModel: modelConfig.requestedModel, actualModel: response?.model, provider: 'openai', latencyMs: Date.now() - startedAt, responseId: response?.id, outputText, usage: usageOf(response?.usage), toolCalls };
}
