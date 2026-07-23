import { classifyCommercialAction } from './actionClassifier.js';
import { findCustomerInsideMessage, resolveCommercialCustomer } from './customerResolver.js';
import {
  extractCommercialAction,
  extractCommercialContent,
  extractDraftItems
} from './parameterExtractor.js';
import { buildCommercialSummary, buildTransitionAnswer } from './responseBuilder.js';
import { transitionCommercialDraft } from './stateMachine.js';
import type {
  CommercialAction,
  CommercialDraft,
  CommercialOrchestratorAdapters,
  CommercialProcessResult,
  DraftTransition,
  TransitionContext
} from './types.js';
import { foldCommercialText } from './normalizer.js';

function transitionContext(
  companyId: string,
  conversationId: string,
  draft: CommercialDraft | null,
  adapters: CommercialOrchestratorAdapters,
  messageId?: string
): TransitionContext {
  return {
    companyId,
    conversationId,
    expectedDraftVersion: draft?.draftVersion,
    messageId,
    companyDefaultCurrency: adapters.defaultCurrency,
    now: adapters.now?.(),
    createId: adapters.createId
  };
}

function apply(
  draft: CommercialDraft | null,
  action: CommercialAction,
  companyId: string,
  conversationId: string,
  adapters: CommercialOrchestratorAdapters,
  messageId?: string
) {
  return transitionCommercialDraft(draft, action, transitionContext(companyId, conversationId, draft, adapters, messageId));
}

function contentAfterCustomer(message: string, matchedQuery: string) {
  let folded = foldCommercialText(message);
  const query = foldCommercialText(matchedQuery);
  const index = folded.indexOf(query);
  if (index >= 0) folded = folded.slice(index + query.length);
  return folded
    .replace(/^(?:\s*(?:de|para|con)\s+)?(?:un|una|el|la)?\s*/, '')
    .replace(/\b(?:precio|importe|valor)\b/g, ' precio ')
    .trim();
}

function inlineContentAfterStart(message: string, matchedQuery: string) {
  return contentAfterCustomer(
    message
      .replace(/^.*?\b(?:presupuesto|remito)\b\s*(?:para\s+)?/i, ''),
    matchedQuery
  );
}

async function completePreview(
  draft: CommercialDraft,
  companyId: string,
  conversationId: string,
  adapters: CommercialOrchestratorAdapters,
  messageId?: string
) {
  const request = apply(draft, { type: 'GENERATE_PREVIEW' }, companyId, conversationId, adapters, messageId);
  if (!request.ok) return { transition: request };
  const effect = request.effects.find((item) => item.type === 'GENERATE_PREVIEW');
  if (!effect || effect.type !== 'GENERATE_PREVIEW') return { transition: request };
  const preview = adapters.generatePreview
    ? await adapters.generatePreview(request.draft, effect.fileName)
    : {
        storagePath: `preview://${request.draft.id}/${request.draft.draftVersion}`,
        fileName: effect.fileName,
        mimeType: 'application/pdf'
      };
  const completed = apply(
    request.draft,
    {
      type: 'PREVIEW_GENERATED',
      draftVersion: effect.draftVersion,
      storagePath: preview.storagePath,
      fileName: preview.fileName,
      mimeType: preview.mimeType
    },
    companyId,
    conversationId,
    adapters,
    messageId
  );
  return { transition: completed, preview };
}

function resultFromTransition(
  classification: ReturnType<typeof classifyCommercialAction>,
  action: CommercialAction,
  transition: DraftTransition,
  preview?: CommercialProcessResult['preview'],
  documentId?: string
): CommercialProcessResult {
  return {
    handled: true,
    classification,
    action,
    draft: transition.ok ? transition.draft : transition.draft,
    answer: transition.ok ? buildTransitionAnswer(transition) : transition.message,
    preview,
    documentId,
    errorCode: transition.ok ? undefined : transition.code
  };
}

export async function processCommercialMessage(input: {
  companyId: string;
  conversationId: string;
  message: string;
  messageId?: string;
  draft?: CommercialDraft | null;
  adapters: CommercialOrchestratorAdapters;
}): Promise<CommercialProcessResult> {
  let draft = input.draft ?? null;
  const classification = classifyCommercialAction(input.message, draft);
  let action = extractCommercialAction(classification, input.message, draft);

  if (!draft && classification.type === 'AMBIGUOUS') {
    return {
      handled: false,
      classification,
      action,
      draft: null,
      answer: ''
    };
  }

  if (action.type === 'START_DRAFT') {
    const started = apply(draft, action, input.companyId, input.conversationId, input.adapters, input.messageId);
    if (!started.ok) return resultFromTransition(classification, action, started);
    draft = started.draft;
    const customer = findCustomerInsideMessage(input.message, input.adapters.customers);
    if (customer.kind === 'NOT_FOUND') return resultFromTransition(classification, action, started);
    if (customer.kind === 'AMBIGUOUS') {
      const selecting = apply(
        draft,
        { type: 'SET_CUSTOMER_CANDIDATES', query: customer.matchedQuery, candidates: customer.candidates },
        input.companyId,
        input.conversationId,
        input.adapters,
        input.messageId
      );
      return resultFromTransition(classification, action, selecting);
    }
    const selected = apply(
      draft,
      { type: 'SELECT_CUSTOMER', query: customer.matchedQuery, customer: customer.customer },
      input.companyId,
      input.conversationId,
      input.adapters,
      input.messageId
    );
    if (!selected.ok) return resultFromTransition(classification, action, selected);
    draft = selected.draft;
    const content = inlineContentAfterStart(input.message, customer.matchedQuery);
    const items = extractDraftItems(content, draft.currency);
    if (!items.length) return resultFromTransition(classification, action, selected);
    const appended = apply(
      draft,
      { type: 'APPEND_ITEMS', items },
      input.companyId,
      input.conversationId,
      input.adapters,
      input.messageId
    );
    return resultFromTransition(classification, action, appended);
  }

  if (action.type === 'SELECT_CUSTOMER_CANDIDATE') {
    const customer = draft?.customerCandidates?.[action.index - 1];
    action = { ...action, customer };
    const selected = apply(draft, action, input.companyId, input.conversationId, input.adapters, input.messageId);
    return resultFromTransition(classification, action, selected);
  }

  if (action.type === 'SELECT_CUSTOMER') {
    let customer = resolveCommercialCustomer(action.query, input.adapters.customers);
    if (customer.kind === 'NOT_FOUND') customer = findCustomerInsideMessage(input.message, input.adapters.customers);
    if (customer.kind === 'AMBIGUOUS') {
      const selecting = apply(
        draft,
        { type: 'SET_CUSTOMER_CANDIDATES', query: customer.matchedQuery, candidates: customer.candidates },
        input.companyId,
        input.conversationId,
        input.adapters,
        input.messageId
      );
      return resultFromTransition(classification, action, selecting);
    }
    if (customer.kind === 'NOT_FOUND') {
      const failed = apply(draft, action, input.companyId, input.conversationId, input.adapters, input.messageId);
      return resultFromTransition(classification, action, failed);
    }
    const selectedAction: CommercialAction = { ...action, customer: customer.customer, query: customer.matchedQuery };
    const selected = apply(draft, selectedAction, input.companyId, input.conversationId, input.adapters, input.messageId);
    if (!selected.ok) return resultFromTransition(classification, selectedAction, selected);
    draft = selected.draft;
    const content = contentAfterCustomer(input.message, customer.matchedQuery);
    const items = extractDraftItems(content, draft.currency);
    if (!items.length) return resultFromTransition(classification, selectedAction, selected);
    const appended = apply(
      draft,
      { type: 'APPEND_ITEMS', items },
      input.companyId,
      input.conversationId,
      input.adapters,
      input.messageId
    );
    return resultFromTransition(classification, selectedAction, appended);
  }

  if (action.type === 'APPEND_ITEM') {
    const content = extractCommercialContent(input.message, classification);
    const items = extractDraftItems(content, draft?.currency);
    action = items.length === 1 ? { type: 'APPEND_ITEM', item: items[0]! } : { type: 'APPEND_ITEMS', items };
  }

  if (action.type === 'SHOW_SUMMARY' && draft) {
    const summary = apply(draft, action, input.companyId, input.conversationId, input.adapters, input.messageId);
    const result = resultFromTransition(classification, action, summary);
    result.answer = summary.ok ? buildCommercialSummary(summary.draft) : summary.message;
    return result;
  }

  if (action.type === 'GENERATE_PREVIEW' && draft) {
    const generated = await completePreview(draft, input.companyId, input.conversationId, input.adapters, input.messageId);
    const result = resultFromTransition(classification, action, generated.transition, generated.preview);
    if (generated.transition.ok) {
      result.answer = `Generé el PDF de previsualización ${generated.transition.draft.previewFileName}. Revisalo y respondé "guardalo" o pedime cambios.`;
    }
    return result;
  }

  if (action.type === 'CONFIRM_DOCUMENT' && draft) {
    let confirming = apply(draft, action, input.companyId, input.conversationId, input.adapters, input.messageId);
    let preview: CommercialProcessResult['preview'];
    if (!confirming.ok && confirming.code === 'STALE_PREVIEW') {
      const regenerated = await completePreview(draft, input.companyId, input.conversationId, input.adapters, input.messageId);
      if (!regenerated.transition.ok) return resultFromTransition(classification, action, regenerated.transition);
      draft = regenerated.transition.draft;
      preview = regenerated.preview;
      confirming = apply(draft, action, input.companyId, input.conversationId, input.adapters, input.messageId);
    }
    if (!confirming.ok) return resultFromTransition(classification, action, confirming, preview);
    const effect = confirming.effects.find((item) => item.type === 'FINALIZE_DOCUMENT');
    if (!effect || effect.type !== 'FINALIZE_DOCUMENT') {
      return resultFromTransition(classification, action, confirming, preview, confirming.draft.finalDocumentId);
    }
    const finalized = input.adapters.finalizeDocument
      ? await input.adapters.finalizeDocument(confirming.draft, effect.fileName)
      : { documentId: `document-${confirming.draft.id}` };
    const completed = apply(
      confirming.draft,
      { type: 'DOCUMENT_FINALIZED', documentId: finalized.documentId },
      input.companyId,
      input.conversationId,
      input.adapters,
      input.messageId
    );
    const result = resultFromTransition(classification, action, completed, preview, finalized.documentId);
    if (completed.ok) result.answer = `Documento guardado como ${completed.draft.requestedFileName || completed.draft.previewFileName}.`;
    return result;
  }

  const transition = apply(draft, action, input.companyId, input.conversationId, input.adapters, input.messageId);
  return resultFromTransition(classification, action, transition);
}
