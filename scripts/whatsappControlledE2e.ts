import { answerAssistant } from '../src/services/assistant.js';
import { prisma } from '../src/db.js';

async function main() {
  let documentId: string | undefined;
  let deliveryNoteId: string | undefined;

  try {
    const company = await prisma.company.findFirst();
    if (!company) throw new Error('No hay empresa para la prueba controlada.');
    const customer = await prisma.customer.findFirst({
      where: { companyId: company.id, NOT: { legalName: { contains: 'pendiente', mode: 'insensitive' } } },
      orderBy: { createdAt: 'asc' }
    });
    if (!customer) throw new Error('No hay cliente registrado para la prueba controlada.');
    const customerReference = customer.legalName.split('.')[0].trim();

    const started = await answerAssistant({
      companyId: company.id,
      message: `Haceme un remito para ${customerReference}.`
    });
    if (started.pendingDeliveryDraft?.status !== 'COLLECTING_INFORMATION') {
      throw new Error(`No se creó el borrador inicial (estado=${started.pendingDeliveryDraft?.status ?? 'ninguno'}, acción=${started.action?.type ?? 'ninguna'}, respuesta=${started.answer.slice(0, 180)}).`);
    }

    // These messages are the text obtained after the WhatsApp audio transcription step.
    const appended = await answerAssistant({
      companyId: company.id,
      message: 'Cambiamos dos rodamientos de la noria.',
      pendingDeliveryDraft: started.pendingDeliveryDraft
    });
    const updated = await answerAssistant({
      companyId: company.id,
      message: 'También soldamos el soporte inferior.',
      pendingDeliveryDraft: appended.pendingDeliveryDraft
    });
    const preview = await answerAssistant({
      companyId: company.id,
      message: 'Preparámelo.',
      pendingDeliveryDraft: updated.pendingDeliveryDraft
    });
    if (!preview.previewDocument || preview.pendingDeliveryDraft?.rendererUsed !== 'FMH_TEMPLATE') {
      throw new Error('No se generó el PDF FMH de revisión.');
    }

    const confirmed = await answerAssistant({
      companyId: company.id,
      message: 'Guardalo.',
      pendingDeliveryDraft: preview.pendingDeliveryDraft
    });
    documentId = confirmed.action?.documentId;
    if (!documentId) throw new Error('La confirmación no creó el documento final.');

    const deliveryNote = await prisma.deliveryNote.findFirst({
      where: { documentId },
      include: { items: true }
    });
    if (!deliveryNote || deliveryNote.status !== 'PENDING' || deliveryNote.items.length !== 2) {
      throw new Error('El remito guardado no tiene el estado o los ítems esperados.');
    }
    deliveryNoteId = deliveryNote.id;

    console.log(JSON.stringify({
      ok: true,
      renderer: preview.pendingDeliveryDraft.rendererUsed,
      previewPdfBytes: preview.previewDocument.buffer.length,
      finalDocumentCreated: true,
      deliveryNoteStatus: deliveryNote.status,
      itemCount: deliveryNote.items.length
    }));
  } finally {
    if (deliveryNoteId) await prisma.deliveryNote.delete({ where: { id: deliveryNoteId } });
    if (documentId) await prisma.document.delete({ where: { id: documentId } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
