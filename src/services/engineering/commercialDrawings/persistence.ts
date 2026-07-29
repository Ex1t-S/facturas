import crypto from 'node:crypto';
import { prisma } from '../../../db.js';
import { readStoredDocumentFile, safeFileName, writeDocumentFile } from '../../documentStorage.js';
import { createCommercialEngineeringPdf } from './service.js';
import type { CommercialDrawingTitleBlock, EngineeringDesignRequestV2 } from './types.js';

export const commercialDrawingStatuses = ['DRAFT', 'ATTACHED_TO_QUOTE', 'SENT_TO_CUSTOMER', 'REVISED', 'ARCHIVED'] as const;
export type CommercialDrawingStatus = (typeof commercialDrawingStatuses)[number];

function revisionLabel(index: number) {
  let value = index;
  let label = '';
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + value % 26) + label;
    value = Math.floor(value / 26);
  }
  return label || 'A';
}

function contentHash(value: unknown) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function saveCommercialEngineeringDrawing(input: {
  companyId: string;
  drawingId?: string;
  request: EngineeringDesignRequestV2;
  titleBlock?: Partial<CommercialDrawingTitleBlock>;
  generatedBy?: string;
  status?: CommercialDrawingStatus;
}) {
  const generated = await createCommercialEngineeringPdf(input.request, input.titleBlock);
  const pdfName = safeFileName(`${generated.result.drawingSpec.drawingNumber}-rev-${input.drawingId ? 'next' : 'A'}.pdf`);
  const stored = await writeDocumentFile({
    buffer: generated.pdf,
    filename: pdfName,
    mimeType: 'application/pdf',
    sourceType: 'engineering-commercial-drawing',
    companyId: input.companyId,
    uploadedBy: input.generatedBy
  });
  return prisma.$transaction(async (tx) => {
    const quote = input.request.sourceBudgetId
      ? await tx.quote.findFirst({ where: { id: input.request.sourceBudgetId, companyId: input.companyId }, select: { id: true, customerId: true } })
      : null;
    if (input.request.sourceBudgetId && !quote) throw Object.assign(new Error('El presupuesto indicado no existe en esta empresa.'), { statusCode: 404 });
    const existing = input.drawingId
      ? await tx.engineeringCommercialDrawing.findFirst({ where: { id: input.drawingId, companyId: input.companyId } })
      : await tx.engineeringCommercialDrawing.findUnique({
          where: { companyId_drawingNumber: { companyId: input.companyId, drawingNumber: generated.result.drawingSpec.drawingNumber } }
        });
    if (input.drawingId && !existing) throw Object.assign(new Error('Plano comercial no encontrado.'), { statusCode: 404 });
    const drawing = existing || await tx.engineeringCommercialDrawing.create({
      data: {
        companyId: input.companyId,
        customerId: quote?.customerId,
        quoteId: quote?.id,
        conversationId: input.request.sourceConversationId,
        projectName: input.request.projectName,
        drawingNumber: generated.result.drawingSpec.drawingNumber,
        status: input.status || (quote ? 'ATTACHED_TO_QUOTE' : 'DRAFT'),
        createdBy: input.generatedBy
      }
    });
    const revisionNumber = drawing.latestRevision + 1;
    const revision = revisionLabel(revisionNumber);
    const hash = contentHash({ request: generated.request, result: generated.result, scene: generated.scene });
    const savedRevision = await tx.engineeringCommercialDrawingRevision.create({
      data: {
        drawingId: drawing.id,
        revisionNumber,
        revision,
        status: input.status || (quote ? 'ATTACHED_TO_QUOTE' : 'DRAFT'),
        designPackId: generated.result.designPackId,
        designPackVersion: generated.result.designPackVersion,
        requestJson: JSON.stringify(generated.request),
        resultJson: JSON.stringify(generated.result),
        sceneJson: JSON.stringify(generated.scene),
        assumptionsJson: JSON.stringify(generated.result.assumedValues),
        svg: generated.svg,
        pdfStoragePath: stored.storagePath,
        pdfSha256: stored.sha256,
        contentHash: hash,
        generatedBy: input.generatedBy
      }
    });
    const updated = await tx.engineeringCommercialDrawing.update({
      where: { id: drawing.id },
      data: {
        latestRevision: revisionNumber,
        status: revisionNumber > 1 ? 'REVISED' : input.status || (quote ? 'ATTACHED_TO_QUOTE' : 'DRAFT'),
        quoteId: quote?.id ?? drawing.quoteId,
        customerId: quote?.customerId ?? drawing.customerId,
        conversationId: input.request.sourceConversationId || drawing.conversationId
      }
    });
    return {
      drawing: updated,
      revision: {
        id: savedRevision.id,
        revision: savedRevision.revision,
        revisionNumber: savedRevision.revisionNumber,
        status: savedRevision.status,
        contentHash: savedRevision.contentHash,
        pdfSha256: savedRevision.pdfSha256,
        generatedAt: savedRevision.generatedAt
      }
    };
  });
}

export async function listCommercialEngineeringDrawings(input: {
  companyId: string;
  quoteId?: string;
  status?: CommercialDrawingStatus;
  take: number;
}) {
  return prisma.engineeringCommercialDrawing.findMany({
    where: { companyId: input.companyId, quoteId: input.quoteId, status: input.status },
    include: {
      customer: { select: { id: true, legalName: true } },
      quote: { select: { id: true, number: true, version: true, status: true } },
      revisions: {
        orderBy: { revisionNumber: 'desc' },
        select: { id: true, revision: true, revisionNumber: true, status: true, designPackVersion: true, contentHash: true, generatedBy: true, generatedAt: true }
      }
    },
    orderBy: { updatedAt: 'desc' },
    take: input.take
  });
}

export async function getCommercialEngineeringDrawing(id: string, companyId: string) {
  return prisma.engineeringCommercialDrawing.findFirst({
    where: { id, companyId },
    include: {
      customer: { select: { id: true, legalName: true } },
      quote: { select: { id: true, number: true, version: true, status: true } },
      revisions: {
        orderBy: { revisionNumber: 'desc' },
        select: {
          id: true,
          revision: true,
          revisionNumber: true,
          status: true,
          designPackId: true,
          designPackVersion: true,
          requestJson: true,
          resultJson: true,
          assumptionsJson: true,
          contentHash: true,
          generatedBy: true,
          generatedAt: true
        }
      }
    }
  });
}

export async function readCommercialDrawingSvg(revisionId: string, companyId: string) {
  return prisma.engineeringCommercialDrawingRevision.findFirst({
    where: { id: revisionId, drawing: { companyId } },
    select: { svg: true, revision: true, drawing: { select: { drawingNumber: true } } }
  });
}

export async function readCommercialDrawingPdf(revisionId: string, companyId: string) {
  const revision = await prisma.engineeringCommercialDrawingRevision.findFirst({
    where: { id: revisionId, drawing: { companyId } },
    select: { pdfStoragePath: true, revision: true, drawing: { select: { drawingNumber: true } } }
  });
  if (!revision?.pdfStoragePath) return null;
  return { ...revision, buffer: await readStoredDocumentFile(revision.pdfStoragePath) };
}

export async function associateCommercialDrawingToQuote(input: {
  drawingId: string;
  companyId: string;
  quoteId: string;
}) {
  const [drawing, quote] = await Promise.all([
    prisma.engineeringCommercialDrawing.findFirst({ where: { id: input.drawingId, companyId: input.companyId } }),
    prisma.quote.findFirst({ where: { id: input.quoteId, companyId: input.companyId }, select: { id: true, customerId: true } })
  ]);
  if (!drawing) throw Object.assign(new Error('Plano comercial no encontrado.'), { statusCode: 404 });
  if (!quote) throw Object.assign(new Error('Presupuesto no encontrado.'), { statusCode: 404 });
  return prisma.engineeringCommercialDrawing.update({
    where: { id: drawing.id },
    data: { quoteId: quote.id, customerId: quote.customerId, status: 'ATTACHED_TO_QUOTE' }
  });
}
