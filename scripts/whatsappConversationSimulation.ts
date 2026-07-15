import fs from 'node:fs/promises';
import path from 'node:path';
import { answerAssistant, type PendingDeliveryDraft } from '../src/services/assistant.js';
import { prisma } from '../src/db.js';

type SimulatedConversation = {
  phone: string;
  draft?: PendingDeliveryDraft;
};

async function main() {
  const outputDir = path.resolve(process.env.USERPROFILE || process.cwd(), 'Desktop', 'Pruebas Bot WhatsApp');
  await fs.mkdir(outputDir, { recursive: true });
  let documentIds: string[] = [];
  let deliveryNoteIds: string[] = [];

  try {
    const company = await prisma.company.findFirst();
    if (!company) throw new Error('No hay empresa para la simulación.');
    const customer = await prisma.customer.findFirst({
      where: { companyId: company.id, NOT: { legalName: { contains: 'pendiente', mode: 'insensitive' } } },
      orderBy: { createdAt: 'asc' }
    });
    if (!customer) throw new Error('No hay cliente registrado para la simulación.');
    const clientReference = customer.legalName.split('.')[0].trim();

    const first: SimulatedConversation = { phone: '5492923562286' };
    const second: SimulatedConversation = { phone: '5492923648947' };

    const beginFirst = await answerAssistant({ companyId: company.id, message: `Haceme un remito para ${clientReference}.` });
    first.draft = beginFirst.pendingDeliveryDraft;
    if (first.draft?.status !== 'COLLECTING_INFORMATION') throw new Error('El primer teléfono no abrió un borrador.');
    const queryWhileDrafting = await answerAssistant({
      companyId: company.id,
      message: `¿Qué remitos pendientes tiene ${clientReference}?`,
      pendingDeliveryDraft: first.draft
    });
    if (!queryWhileDrafting.pendingDeliveryDraft || queryWhileDrafting.pendingDeliveryDraft.payload.items.length !== 0) {
      throw new Error('La consulta interna cerró o contaminó el borrador activo.');
    }
    const reminder = await answerAssistant({
      companyId: company.id,
      message: 'Recordame mañana que tenemos que ir a trabajar a la planta de silos.',
      pendingDeliveryDraft: queryWhileDrafting.pendingDeliveryDraft
    });
    if (!reminder.answer.includes('no puedo crear recordatorios') || reminder.pendingDeliveryDraft?.payload.items.length !== 0) {
      throw new Error('El recordatorio contaminó el borrador activo.');
    }
    const ambiguous = await answerAssistant({
      companyId: company.id,
      message: 'Eso de mañana quedó más o menos.',
      pendingDeliveryDraft: reminder.pendingDeliveryDraft
    });
    if (!ambiguous.answer.includes('No estoy seguro') || ambiguous.pendingDeliveryDraft?.payload.items.length !== 0) {
      throw new Error('El audio ambiguo no pidió aclaración o modificó el borrador.');
    }
    const firstAudio1 = await answerAssistant({ companyId: company.id, message: 'Cambiamos dos rodamientos de la noria.', pendingDeliveryDraft: ambiguous.pendingDeliveryDraft });
    const firstAudio2 = await answerAssistant({ companyId: company.id, message: 'También soldamos el soporte inferior.', pendingDeliveryDraft: firstAudio1.pendingDeliveryDraft });
    const firstPreviewV1 = await answerAssistant({ companyId: company.id, message: 'Pasame el PDF ya limpio.', pendingDeliveryDraft: firstAudio2.pendingDeliveryDraft });
    if (!firstPreviewV1.previewDocument || firstPreviewV1.pendingDeliveryDraft?.rendererUsed !== 'FMH_TEMPLATE') throw new Error('No se generó el PDF FMH del primer teléfono.');
    const changedAfterPreview = await answerAssistant({
      companyId: company.id,
      message: 'También revisamos el motor.',
      pendingDeliveryDraft: firstPreviewV1.pendingDeliveryDraft
    });
    if (changedAfterPreview.pendingDeliveryDraft?.previewVersion !== undefined) throw new Error('No se invalidó el preview anterior.');
    const staleConfirmation = await answerAssistant({ companyId: company.id, message: 'Guardalo.', pendingDeliveryDraft: changedAfterPreview.pendingDeliveryDraft });
    if (staleConfirmation.action?.documentId || !staleConfirmation.answer.includes('PDF actualizado')) {
      throw new Error('Se permitió confirmar un preview desactualizado.');
    }
    const firstPreview = await answerAssistant({ companyId: company.id, message: 'Ahora sí, pasame el PDF.', pendingDeliveryDraft: staleConfirmation.pendingDeliveryDraft });
    if (!firstPreview.previewDocument || firstPreview.pendingDeliveryDraft?.previewVersion !== firstPreview.pendingDeliveryDraft?.draftVersion) {
      throw new Error('No se regeneró el preview actualizado.');
    }
    const firstPdf = path.join(outputDir, '01-remito-rodamientos-y-soporte.pdf');
    await fs.writeFile(firstPdf, firstPreview.previewDocument.buffer);

    const beginSecond = await answerAssistant({ companyId: company.id, message: `Haceme un remito para ${clientReference}.` });
    second.draft = beginSecond.pendingDeliveryDraft;
    if (second.draft?.status !== 'COLLECTING_INFORMATION') throw new Error('El segundo teléfono no abrió un borrador.');
    const secondAudio = await answerAssistant({ companyId: company.id, message: 'Realizamos una revisión general de la cinta.', pendingDeliveryDraft: second.draft });
    const secondPreview = await answerAssistant({ companyId: company.id, message: 'Quiero que me pases el PDF final.', pendingDeliveryDraft: secondAudio.pendingDeliveryDraft });
    if (!secondPreview.previewDocument || secondPreview.pendingDeliveryDraft?.rendererUsed !== 'FMH_TEMPLATE') throw new Error('No se generó el PDF FMH del segundo teléfono.');
    const secondPdf = path.join(outputDir, '02-remito-revision-de-cinta.pdf');
    await fs.writeFile(secondPdf, secondPreview.previewDocument.buffer);

    const firstText = firstPreview.pendingDeliveryDraft.payload.items.map((item) => item.description).join(' | ');
    const secondText = secondPreview.pendingDeliveryDraft.payload.items.map((item) => item.description).join(' | ');
    if (firstText.includes('revisión general de la cinta') || secondText.includes('rodamientos') || secondText.includes('soporte')) {
      throw new Error('Se mezclaron conversaciones entre teléfonos.');
    }

    for (const pending of [firstPreview.pendingDeliveryDraft, secondPreview.pendingDeliveryDraft]) {
      const saved = await answerAssistant({ companyId: company.id, message: 'Guardalo.', pendingDeliveryDraft: pending });
      if (!saved.action?.documentId) throw new Error('No se guardó el documento de prueba.');
      documentIds.push(saved.action.documentId);
      const note = await prisma.deliveryNote.findFirst({ where: { documentId: saved.action.documentId }, include: { items: true } });
      if (!note || note.status !== 'PENDING') throw new Error('El remito de prueba no quedó pendiente.');
      deliveryNoteIds.push(note.id);
    }

    console.log(JSON.stringify({ ok: true, outputDir, firstPdf, secondPdf, conversationsIsolated: true, savedDeliveryNotes: 2 }));
  } finally {
    for (const id of deliveryNoteIds) await prisma.deliveryNote.delete({ where: { id } });
    for (const id of documentIds) await prisma.document.delete({ where: { id } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
