import { config } from '../src/config.js';
import { prisma } from '../src/db.js';
import { engineeringModelConfig, runEngineeringOpenAI } from '../src/services/engineering/engineeringRuntime.js';

const startedAt = Date.now();
const model = engineeringModelConfig();
const execution = await runEngineeringOpenAI({
  systemPrompt: 'Respondé únicamente: OK FMH',
  stateText: 'Diagnóstico de conectividad. No hay datos de usuario.',
  history: [],
  message: 'Respondé únicamente: OK FMH',
  tools: [],
  executeTool: async () => ({})
});

let database: { status: 'PASS' | 'FAIL'; error?: string; engineeringDocuments?: number; engineeringConversations?: number; structuralSections?: number } = { status: 'PASS' };
try {
  const [engineeringDocuments, engineeringConversations, structuralSections] = await Promise.all([prisma.engineeringKnowledgeDocument.count(), prisma.engineeringConversation.count(), prisma.structuralSection.count()]);
  database = { status: 'PASS', engineeringDocuments, engineeringConversations, structuralSections };
} catch (error) {
  database = { status: 'FAIL', error: error instanceof Error ? error.message : 'No se pudo consultar la base.' };
}
await prisma.$disconnect().catch(() => undefined);

const output = {
  status: execution.success && database.status === 'PASS' ? 'PASS' : execution.success ? 'WARN' : 'FAIL',
  durationMs: Date.now() - startedAt,
  requestedModel: model.requestedModel,
  modelSource: model.source,
  actualModel: execution.actualModel,
  provider: execution.provider,
  responseId: execution.responseId,
  latencyMs: execution.latencyMs,
  usage: execution.usage,
  openAiKeyConfigured: Boolean(config.OPENAI_API_KEY.trim()),
  openAi: execution.success ? { response: execution.outputText } : { error: execution.error },
  database
};
console.log(JSON.stringify(output, null, 2));
if (output.status === 'FAIL') process.exitCode = 1;
