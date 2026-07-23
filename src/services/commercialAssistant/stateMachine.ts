import type {
  CommercialAction,
  CommercialDraft,
  CommercialDraftItem,
  CommercialConversationState,
  DraftItemInput,
  DraftTransition,
  TransitionContext
} from './types.js';
import { normalizeCommercialDescription, replaceNormalizedFragment } from './normalizer.js';
import { resolveItemReference } from './itemReferenceResolver.js';
import { sanitizeRequestedPdfFileName } from './parameterExtractor.js';

const activeStates: CommercialConversationState[] = [
  'SELECTING_DOCUMENT_TYPE',
  'COLLECTING_CUSTOMER',
  'SELECTING_CUSTOMER',
  'COLLECTING_ITEMS',
  'COLLECTING_PRICES',
  'READY_FOR_PREVIEW',
  'WAITING_CONFIRMATION'
];

function nowFrom(context: TransitionContext) {
  return context.now ?? new Date();
}

function cloneDraft(draft: CommercialDraft): CommercialDraft {
  return {
    ...draft,
    createdAt: new Date(draft.createdAt),
    updatedAt: new Date(draft.updatedAt),
    expiresAt: new Date(draft.expiresAt),
    items: draft.items.map((item) => ({ ...item })),
    customerCandidates: draft.customerCandidates?.map((customer) => ({ ...customer }))
  };
}

function isActive(draft: CommercialDraft) {
  return activeStates.includes(draft.status);
}

function deriveCollectionState(draft: CommercialDraft): Pick<CommercialDraft, 'status' | 'awaiting'> {
  if (!draft.customerId || !draft.customerName) return { status: 'COLLECTING_CUSTOMER', awaiting: 'CUSTOMER' };
  if (!draft.items.length) return { status: 'COLLECTING_ITEMS', awaiting: 'ITEMS' };
  if (!draft.currency || (draft.documentType === 'QUOTE' && draft.items.some((item) => item.unitPrice === undefined))) {
    return { status: 'COLLECTING_PRICES', awaiting: 'PRICES' };
  }
  return { status: 'READY_FOR_PREVIEW', awaiting: undefined };
}

function suggestedFileName(documentType: CommercialDraft['documentType'], customerName?: string) {
  const prefix = documentType === 'QUOTE' ? 'presupuesto' : 'remito';
  const customer = (customerName || 'cliente-pendiente')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-AR')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
  return `${prefix}-${customer || 'cliente-pendiente'}.pdf`;
}

function error(
  draft: CommercialDraft | null,
  code: Extract<DraftTransition, { ok: false }>['code'],
  message: string,
  details?: unknown
): DraftTransition {
  return { ok: false, draft, code, message, details };
}

function success(
  previous: CommercialDraft | null,
  draft: CommercialDraft,
  options: { changed: boolean; effects?: Extract<DraftTransition, { ok: true }>['effects']; message?: string }
): DraftTransition {
  return {
    ok: true,
    previous,
    draft,
    changed: options.changed,
    effects: options.effects ?? [],
    message: options.message
  };
}

function reindex(items: CommercialDraftItem[]) {
  return items.map((item, index) => ({ ...item, position: index + 1 }));
}

function newLine(item: DraftItemInput, index: number, context: TransitionContext): CommercialDraftItem {
  const id = context.createId?.() ?? `line-${Date.now().toString(36)}-${index + 1}`;
  return {
    lineId: id,
    position: index + 1,
    description: normalizeCommercialDescription(item.description),
    quantity: item.quantity ?? 1,
    unit: item.unit || 'unidad',
    unitPrice: item.unitPrice,
    taxRate: item.taxRate,
    sourceMessageId: item.sourceMessageId ?? context.messageId
  };
}

function mutateDraft(
  current: CommercialDraft,
  context: TransitionContext,
  mutate: (next: CommercialDraft) => void,
  message?: string
): DraftTransition {
  if (!isActive(current)) return error(current, 'INVALID_STATE', `El borrador está ${current.status.toLocaleLowerCase('es-AR')} y no admite ediciones.`);
  const previous = cloneDraft(current);
  const next = cloneDraft(current);
  mutate(next);
  next.items = reindex(next.items);
  next.draftVersion += 1;
  next.previewVersion = undefined;
  next.previewStoragePath = undefined;
  next.previewFileName = undefined;
  next.previewMimeType = undefined;
  next.updatedAt = nowFrom(context);
  Object.assign(next, deriveCollectionState(next));
  return success(previous, next, { changed: true, message });
}

function resolveReferenceOrError(draft: CommercialDraft, reference: Parameters<typeof resolveItemReference>[0]) {
  const resolution = resolveItemReference(reference, draft.items);
  if (resolution.kind === 'NOT_FOUND') return error(draft, 'ITEM_NOT_FOUND', 'No encontré el ítem indicado. El borrador no cambió.');
  if (resolution.kind === 'AMBIGUOUS') {
    return error(
      draft,
      'ITEM_REFERENCE_AMBIGUOUS',
      ['Encontré más de un ítem posible:', ...resolution.candidates.map((item) => `${item.index + 1}. ${item.description}`), 'Elegí el número correcto.'].join('\n'),
      resolution.candidates
    );
  }
  return resolution;
}

export function transitionCommercialDraft(
  draft: CommercialDraft | null,
  action: CommercialAction,
  context: TransitionContext
): DraftTransition {
  if (draft && context.expectedDraftVersion !== undefined && draft.draftVersion !== context.expectedDraftVersion) {
    return error(draft, 'VERSION_CONFLICT', 'El borrador cambió mientras se procesaba el mensaje. Debe recargarse.');
  }
  if (draft && draft.expiresAt.getTime() <= nowFrom(context).getTime() && !['FINALIZED', 'CANCELLED', 'EXPIRED'].includes(draft.status)) {
    const expired = cloneDraft(draft);
    expired.status = 'EXPIRED';
    expired.awaiting = undefined;
    expired.updatedAt = nowFrom(context);
    if (action.type !== 'START_DRAFT' && action.type !== 'BUSINESS_QUERY') {
      return error(expired, 'INVALID_STATE', 'El borrador venció. Iniciá uno nuevo para continuar.');
    }
    draft = expired;
  }

  if (action.type === 'START_DRAFT') {
    if (draft && isActive(draft)) {
      const label = draft.documentType === 'QUOTE' ? 'presupuesto' : 'remito';
      const customer = draft.customerName ? ` para ${draft.customerName}` : '';
      return error(
        draft,
        'ACTIVE_DRAFT_CONFLICT',
        `Tenés un ${label} sin guardar${customer}. ¿Querés guardarlo, descartarlo o continuar con ese borrador?`
      );
    }
    const now = nowFrom(context);
    const id = context.createId?.() ?? `draft-${now.getTime().toString(36)}`;
    const created: CommercialDraft = {
      schemaVersion: 2,
      id,
      conversationId: context.conversationId,
      companyId: context.companyId,
      documentType: action.documentType,
      status: 'COLLECTING_CUSTOMER',
      currency: context.companyDefaultCurrency,
      items: [],
      suggestedFileName: suggestedFileName(action.documentType),
      draftVersion: 1,
      awaiting: 'CUSTOMER',
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + 48 * 3600_000)
    };
    return success(draft, created, {
      changed: true,
      message: `Empecé un ${action.documentType === 'QUOTE' ? 'presupuesto' : 'remito'}. Decime el cliente.`
    });
  }

  if (!draft) {
    if (action.type === 'BUSINESS_QUERY') {
      return error(null, 'INVALID_STATE', 'La consulta no necesita un borrador comercial.');
    }
    return error(null, 'INVALID_STATE', 'No hay un borrador comercial activo.');
  }

  if (action.type === 'SHOW_SUMMARY') return success(draft, cloneDraft(draft), { changed: false });
  if (action.type === 'BUSINESS_QUERY') {
    return success(draft, cloneDraft(draft), {
      changed: false,
      effects: [{ type: 'ANSWER_BUSINESS_QUERY', query: action.query }]
    });
  }
  if (action.type === 'CANCEL_DRAFT') {
    if (!isActive(draft)) return error(draft, 'INVALID_STATE', `El borrador ya está ${draft.status.toLocaleLowerCase('es-AR')}.`);
    const cancelled = cloneDraft(draft);
    cancelled.status = 'CANCELLED';
    cancelled.awaiting = undefined;
    cancelled.updatedAt = nowFrom(context);
    return success(draft, cancelled, { changed: true, message: 'Cancelé el borrador.' });
  }
  if (action.type === 'SELECT_CUSTOMER' || action.type === 'SELECT_CUSTOMER_CANDIDATE') {
    if (!action.customer) return error(draft, 'CUSTOMER_NOT_FOUND', 'No encontré un cliente único. Probá con razón social, alias o CUIT.');
    return mutateDraft(draft, context, (next) => {
      next.customerId = action.customer!.id;
      next.customerName = action.customer!.legalName;
      next.customerSearchQuery = action.type === 'SELECT_CUSTOMER' ? action.query : undefined;
      next.customerCandidates = undefined;
      next.suggestedFileName = suggestedFileName(next.documentType, action.customer!.legalName);
    }, `Seleccioné a ${action.customer.legalName}.`);
  }
  if (action.type === 'SET_CUSTOMER_CANDIDATES') {
    if (!action.candidates.length) return error(draft, 'CUSTOMER_NOT_FOUND', 'No encontré clientes posibles.');
    const selecting = cloneDraft(draft);
    selecting.status = 'SELECTING_CUSTOMER';
    selecting.awaiting = 'CUSTOMER_SELECTION';
    selecting.customerSearchQuery = action.query;
    selecting.customerCandidates = action.candidates.map((customer) => ({ ...customer }));
    selecting.updatedAt = nowFrom(context);
    return success(draft, selecting, { changed: true, message: 'Necesito que elijas un cliente.' });
  }
  if (action.type === 'APPEND_ITEM' || action.type === 'APPEND_ITEMS') {
    const inputs = action.type === 'APPEND_ITEM' ? [action.item] : action.items;
    if (!inputs.length || inputs.some((item) => !normalizeCommercialDescription(item.description))) {
      return error(draft, 'INVALID_STATE', 'No pude extraer un ítem comercial válido.');
    }
    return mutateDraft(draft, context, (next) => {
      const start = next.items.length;
      next.items.push(...inputs.map((item, index) => newLine(item, start + index, context)));
      const detectedCurrency = inputs.find((item) => item.currency)?.currency;
      if (detectedCurrency) next.currency = detectedCurrency;
    }, inputs.length === 1 ? 'Agregué el ítem.' : `Agregué ${inputs.length} ítems.`);
  }
  if (action.type === 'CLEAR_ITEMS') {
    return mutateDraft(draft, context, (next) => {
      next.items = [];
    }, 'Eliminé todos los ítems.');
  }
  if (action.type === 'DELETE_ITEM') {
    const resolution = resolveReferenceOrError(draft, action.reference);
    if ('ok' in resolution) return resolution;
    const removed = draft.items[resolution.index]!;
    return mutateDraft(draft, context, (next) => {
      next.items.splice(resolution.index, 1);
    }, `Eliminé: ${removed.description}.`);
  }
  if (action.type === 'SET_ITEM_PRICE') {
    if (!Number.isFinite(action.unitPrice) || action.unitPrice < 0) return error(draft, 'INVALID_STATE', 'El precio indicado no es válido.');
    const resolution = resolveReferenceOrError(draft, action.reference);
    if ('ok' in resolution) return resolution;
    return mutateDraft(draft, context, (next) => {
      next.items[resolution.index] = { ...next.items[resolution.index]!, unitPrice: action.unitPrice };
      if (action.currency) next.currency = action.currency;
    }, `Actualicé el precio del ítem ${resolution.index + 1}.`);
  }
  if (action.type === 'SET_ITEM_QUANTITY') {
    if (!Number.isFinite(action.quantity) || action.quantity <= 0) return error(draft, 'INVALID_STATE', 'La cantidad indicada no es válida.');
    const resolution = resolveReferenceOrError(draft, action.reference);
    if ('ok' in resolution) return resolution;
    return mutateDraft(draft, context, (next) => {
      next.items[resolution.index] = { ...next.items[resolution.index]!, quantity: action.quantity };
    }, `Actualicé la cantidad del ítem ${resolution.index + 1}.`);
  }
  if (action.type === 'REPLACE_ITEM_TEXT') {
    const resolution = resolveReferenceOrError(draft, action.reference);
    if ('ok' in resolution) return resolution;
    const replaced = replaceNormalizedFragment(
      draft.items[resolution.index]!.description,
      action.targetText,
      action.replacementText
    );
    if (replaced.status === 'not_found') return error(draft, 'ITEM_NOT_FOUND', 'El texto a reemplazar no aparece en el ítem. No hice cambios.');
    if (replaced.status === 'ambiguous') return error(draft, 'ITEM_REFERENCE_AMBIGUOUS', 'El texto aparece más de una vez. Indicá con más precisión qué parte cambiar.');
    return mutateDraft(draft, context, (next) => {
      next.items[resolution.index] = { ...next.items[resolution.index]!, description: replaced.value };
    }, `Actualicé el ítem ${resolution.index + 1}.`);
  }
  if (action.type === 'REPLACE_DESCRIPTION') {
    const resolution = resolveReferenceOrError(draft, action.reference);
    if ('ok' in resolution) return resolution;
    const description = normalizeCommercialDescription(action.description);
    if (!description) return error(draft, 'INVALID_STATE', 'La nueva descripción está vacía.');
    return mutateDraft(draft, context, (next) => {
      next.items[resolution.index] = { ...next.items[resolution.index]!, description };
    }, `Reemplacé la descripción del ítem ${resolution.index + 1}.`);
  }
  if (action.type === 'SET_CURRENCY') {
    return mutateDraft(draft, context, (next) => {
      next.currency = action.currency;
    }, `Cambié la moneda a ${action.currency}.`);
  }
  if (action.type === 'RENAME_DRAFT') {
    const parsed = sanitizeRequestedPdfFileName(action.fileName);
    if (!parsed.ok) return error(draft, 'INVALID_FILE_NAME', parsed.reason);
    const renamed = cloneDraft(draft);
    renamed.requestedFileName = parsed.fileName;
    renamed.updatedAt = nowFrom(context);
    return success(draft, renamed, { changed: true, message: `Cambié el nombre a ${parsed.fileName}.` });
  }
  if (action.type === 'GENERATE_PREVIEW') {
    if (!draft.customerId || !draft.customerName) return error(draft, 'CUSTOMER_REQUIRED', 'Antes del PDF necesito seleccionar el cliente.');
    if (!draft.items.length) return error(draft, 'ITEMS_REQUIRED', 'Antes del PDF necesito al menos un ítem comercial.');
    if (!draft.currency) return error(draft, 'CURRENCY_REQUIRED', 'Antes del PDF necesito saber si la moneda es ARS o USD.');
    const missing = draft.documentType === 'QUOTE'
      ? draft.items.filter((item) => item.unitPrice === undefined)
      : [];
    if (missing.length) {
      return error(
        draft,
        'MISSING_PRICES',
        ['Antes del PDF faltan precios:', ...missing.map((item) => `${item.position}. ${item.description}`)].join('\n'),
        missing.map((item) => item.lineId)
      );
    }
    const fileName = draft.requestedFileName || draft.suggestedFileName;
    return success(draft, cloneDraft(draft), {
      changed: false,
      effects: [{ type: 'GENERATE_PREVIEW', draftId: draft.id, draftVersion: draft.draftVersion, fileName }]
    });
  }
  if (action.type === 'PREVIEW_GENERATED') {
    if (action.draftVersion !== draft.draftVersion) return error(draft, 'VERSION_CONFLICT', 'El borrador cambió durante la generación del PDF. El preview fue invalidado.');
    const previewed = cloneDraft(draft);
    previewed.status = 'WAITING_CONFIRMATION';
    previewed.awaiting = 'CONFIRMATION';
    previewed.previewVersion = action.draftVersion;
    previewed.previewStoragePath = action.storagePath;
    previewed.previewFileName = action.fileName;
    previewed.previewMimeType = action.mimeType;
    previewed.updatedAt = nowFrom(context);
    return success(draft, previewed, { changed: true, message: 'Generé la previsualización.' });
  }
  if (action.type === 'CONFIRM_DOCUMENT') {
    if (draft.status === 'FINALIZED' && draft.finalDocumentId) {
      return success(draft, cloneDraft(draft), { changed: false, message: 'El documento ya estaba guardado.' });
    }
    if (draft.status !== 'WAITING_CONFIRMATION' || draft.previewVersion !== draft.draftVersion) {
      return error(draft, 'STALE_PREVIEW', 'El preview no está actualizado. Voy a regenerarlo antes de confirmar.');
    }
    let fileName = draft.requestedFileName || draft.previewFileName || draft.suggestedFileName;
    if (action.fileName) {
      const parsed = sanitizeRequestedPdfFileName(action.fileName);
      if (!parsed.ok) return error(draft, 'INVALID_FILE_NAME', parsed.reason);
      fileName = parsed.fileName;
    }
    const confirming = cloneDraft(draft);
    confirming.requestedFileName = fileName;
    confirming.updatedAt = nowFrom(context);
    return success(draft, confirming, {
      changed: Boolean(action.fileName),
      effects: [{ type: 'FINALIZE_DOCUMENT', draftId: draft.id, draftVersion: draft.draftVersion, fileName }]
    });
  }
  if (action.type === 'DOCUMENT_FINALIZED') {
    if (draft.status === 'FINALIZED') {
      return draft.finalDocumentId === action.documentId
        ? success(draft, cloneDraft(draft), { changed: false, message: 'El documento ya estaba guardado.' })
        : error(draft, 'INVALID_STATE', 'El borrador ya fue finalizado con otro documento.');
    }
    const finalized = cloneDraft(draft);
    finalized.status = 'FINALIZED';
    finalized.awaiting = undefined;
    finalized.finalDocumentId = action.documentId;
    finalized.updatedAt = nowFrom(context);
    return success(draft, finalized, { changed: true, message: 'Documento guardado.' });
  }
  if (action.type === 'AMBIGUOUS') {
    return error(draft, 'INVALID_STATE', 'No pude determinar una acción segura. El borrador no cambió.');
  }
  return error(draft, 'INVALID_STATE', 'La acción no está soportada en este estado.');
}
