import { prisma } from '../../db.js';
import type { PendingDeliveryDraft } from '../assistant.js';
import type { CommercialDraft } from './types.js';

const activeStatuses = new Set([
  'SELECTING_DOCUMENT_TYPE',
  'COLLECTING_CUSTOMER',
  'SELECTING_CUSTOMER',
  'COLLECTING_ITEMS',
  'COLLECTING_PRICES',
  'READY_FOR_PREVIEW',
  'WAITING_CONFIRMATION'
]);

export class CommercialDraftVersionConflictError extends Error {
  constructor() {
    super('El borrador cambió mientras se procesaba el mensaje.');
    this.name = 'CommercialDraftVersionConflictError';
  }
}

function hydrateDraft(record: Awaited<ReturnType<typeof loadCommercialDraftRecord>>): CommercialDraft | null {
  if (!record) return null;
  return {
    schemaVersion: 2,
    id: record.id,
    conversationId: record.conversationId,
    companyId: record.companyId,
    documentType: record.documentType === 'QUOTE' ? 'QUOTE' : 'DELIVERY_NOTE',
    status: record.status as CommercialDraft['status'],
    customerId: record.customerId || undefined,
    customerName: record.customer?.legalName,
    customerSearchQuery: record.customerSearchQuery || undefined,
    currency: record.currency === 'USD' ? 'USD' : record.currency === 'ARS' ? 'ARS' : undefined,
    items: record.items.map((item) => ({
      lineId: item.lineId,
      position: item.position,
      description: item.description,
      quantity: Number(item.quantity),
      unit: item.unit,
      unitPrice: item.unitPrice === null ? undefined : Number(item.unitPrice),
      taxRate: item.taxRate === null ? undefined : Number(item.taxRate),
      sourceMessageId: item.sourceMessageId || undefined
    })),
    suggestedFileName: record.suggestedFileName,
    requestedFileName: record.requestedFileName || undefined,
    draftVersion: record.draftVersion,
    previewVersion: record.previewVersion ?? undefined,
    previewStoragePath: record.previewStoragePath || undefined,
    previewFileName: record.previewFileName || undefined,
    previewMimeType: record.previewMimeType || undefined,
    awaiting: (record.awaiting as CommercialDraft['awaiting']) || undefined,
    finalDocumentId: record.finalDocumentId || undefined,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    expiresAt: record.expiresAt
  };
}

function loadCommercialDraftRecord(conversationId: string) {
  return prisma.commercialDraft.findFirst({
    where: { conversationId },
    include: {
      customer: { select: { legalName: true } },
      items: { orderBy: { position: 'asc' } }
    },
    orderBy: { updatedAt: 'desc' }
  });
}

export async function loadCommercialDraft(conversationId: string) {
  return hydrateDraft(await loadCommercialDraftRecord(conversationId));
}

export async function loadPersistedPendingDraft(conversationId: string): Promise<PendingDeliveryDraft | undefined> {
  const record = await prisma.commercialDraft.findFirst({
    where: { conversationId },
    select: { legacyPayloadJson: true },
    orderBy: { updatedAt: 'desc' }
  });
  if (!record?.legacyPayloadJson) return undefined;
  try {
    const pending = JSON.parse(record.legacyPayloadJson) as PendingDeliveryDraft;
    const status = pending.commercialDraft?.status || pending.status;
    if (status === 'CANCELLED' || status === 'FINALIZED' || status === 'EXPIRED') return undefined;
    return pending;
  } catch {
    return undefined;
  }
}

/**
 * Persists both representations in one serializable transaction. `pendingJson`
 * remains the rollback-compatible read model while CommercialDraft is the
 * normalized source for versioned transitions.
 */
export async function persistCommercialDraftSnapshot(input: {
  conversationId: string;
  pending: PendingDeliveryDraft | undefined;
  expectedDraftVersion?: number;
}) {
  const serialized = input.pending ? JSON.stringify(input.pending) : null;
  const draft = input.pending?.commercialDraft;
  await prisma.$transaction(async (tx) => {
    if (!draft) {
      await tx.whatsAppConversation.update({
        where: { id: input.conversationId },
        data: { pendingJson: serialized }
      });
      return;
    }

    const existing = await tx.commercialDraft.findUnique({
      where: { id: draft.id },
      select: { draftVersion: true }
    });
    const activeSlot = activeStatuses.has(draft.status) ? 1 : null;
    const data = {
      conversationId: input.conversationId,
      companyId: draft.companyId,
      activeSlot,
      documentType: draft.documentType,
      status: draft.status,
      customerId: draft.customerId,
      customerSearchQuery: draft.customerSearchQuery,
      currency: draft.currency,
      suggestedFileName: draft.suggestedFileName,
      requestedFileName: draft.requestedFileName,
      draftVersion: draft.draftVersion,
      previewVersion: draft.previewVersion,
      previewStoragePath: draft.previewStoragePath,
      previewFileName: draft.previewFileName,
      previewMimeType: draft.previewMimeType,
      awaiting: draft.awaiting,
      finalDocumentId: draft.finalDocumentId,
      legacyPayloadJson: serialized,
      expiresAt: draft.expiresAt,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt
    };

    if (existing) {
      const expected = input.expectedDraftVersion ?? existing.draftVersion;
      const updated = await tx.commercialDraft.updateMany({
        where: { id: draft.id, draftVersion: expected },
        data
      });
      if (updated.count !== 1) throw new CommercialDraftVersionConflictError();
      await tx.commercialDraftItem.deleteMany({ where: { draftId: draft.id } });
    } else {
      await tx.commercialDraft.create({ data: { id: draft.id, ...data } });
    }
    if (draft.items.length) {
      await tx.commercialDraftItem.createMany({
        data: draft.items.map((item) => ({
          draftId: draft.id,
          lineId: item.lineId,
          position: item.position,
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          unitPrice: item.unitPrice,
          taxRate: item.taxRate,
          sourceMessageId: item.sourceMessageId
        }))
      });
    }
    await tx.whatsAppConversation.update({
      where: { id: input.conversationId },
      data: { pendingJson: serialized }
    });
  }, { isolationLevel: 'Serializable' });
}
