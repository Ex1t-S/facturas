import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { classifyCommercialAction } from './actionClassifier.js';
import { processCommercialMessage, type CommercialMessageInput } from './orchestrator.js';
import type { ActionClassification, CommercialProcessResult } from './types.js';

/**
 * LangGraph is deliberately an orchestration layer here. The persisted
 * CommercialDraft and the deterministic transition engine remain the source
 * of truth; the graph never writes Prisma and never invents a document action.
 */
const CommercialGraphState = Annotation.Root({
  input: Annotation<CommercialMessageInput>(),
  classification: Annotation<ActionClassification>(),
  result: Annotation<CommercialProcessResult>()
});

const commercialGraph = new StateGraph(CommercialGraphState)
  .addNode('guard', async (state) => ({
    classification: classifyCommercialAction(state.input.message, state.input.draft)
  }))
  .addNode('transition', async (state) => ({
    result: await processCommercialMessage(state.input)
  }))
  .addEdge(START, 'guard')
  .addEdge('guard', 'transition')
  .addEdge('transition', END)
  .compile();

export async function processCommercialMessageWithGraph(input: CommercialMessageInput) {
  const state = await commercialGraph.invoke({ input });
  if (!state.result) throw new Error('El grafo comercial no devolvió resultado.');
  return state.result;
}

export { CommercialGraphState };
