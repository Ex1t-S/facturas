import fs from 'node:fs/promises';
import { answerAssistant } from '../src/services/assistant.js';
import { prisma } from '../src/db.js';

async function main() {
  const company = await prisma.company.findFirst();
  if (!company) throw new Error('No hay empresa para la simulación comercial.');
  const customer = await prisma.customer.findFirst({
    where: { companyId: company.id, NOT: { legalName: { contains: 'pendiente', mode: 'insensitive' } } },
    orderBy: { createdAt: 'asc' }
  });
  if (!customer) throw new Error('No hay cliente registrado para la simulación comercial.');

  const reference = customer.legalName.split('.')[0].trim();
  let previewPath: string | undefined;
  try {
    const started = await answerAssistant({ companyId: company.id, message: `Haceme un presupuesto para ${reference}.` });
    if (started.pendingDeliveryDraft?.awaiting !== 'items' || started.pendingDeliveryDraft.payload.customerName !== customer.legalName) {
      throw new Error('El presupuesto no resolvió cliente y estado inicial.');
    }

    const withItems = await answerAssistant({
      companyId: company.id,
      message: 'Agregá 2 unidades de rodamientos a 50000.',
      pendingDeliveryDraft: started.pendingDeliveryDraft
    });
    if (withItems.pendingDeliveryDraft?.payload.items.length !== 1) throw new Error('No se agregó el ítem al presupuesto.');

    const changedQuantity = await answerAssistant({
      companyId: company.id,
      message: 'En vez de dos rodamientos poné cuatro.',
      pendingDeliveryDraft: withItems.pendingDeliveryDraft
    });
    if (changedQuantity.pendingDeliveryDraft?.payload.items[0]?.quantity !== 4) throw new Error('No se modificó la cantidad.');

    const changedPrice = await answerAssistant({
      companyId: company.id,
      message: 'Cambiá el precio del ítem 1 a 60000.',
      pendingDeliveryDraft: changedQuantity.pendingDeliveryDraft
    });
    if (changedPrice.pendingDeliveryDraft?.payload.items[0]?.unitPrice !== 60000) throw new Error('No se modificó el precio.');

    const preview = await answerAssistant({
      companyId: company.id,
      message: 'Pasame el PDF.',
      pendingDeliveryDraft: changedPrice.pendingDeliveryDraft
    });
    previewPath = preview.pendingDeliveryDraft?.previewStoragePath;
    if (!preview.previewDocument || preview.pendingDeliveryDraft?.status !== 'WAITING_CONFIRMATION') {
      throw new Error('No se generó el preview versionado del presupuesto.');
    }

    console.log(JSON.stringify({
      ok: true,
      customerMatched: preview.pendingDeliveryDraft.payload.customerName === customer.legalName,
      itemCount: preview.pendingDeliveryDraft.payload.items.length,
      quantity: preview.pendingDeliveryDraft.payload.items[0]?.quantity,
      unitPrice: preview.pendingDeliveryDraft.payload.items[0]?.unitPrice,
      previewReady: true
    }));
  } finally {
    if (previewPath) await fs.rm(previewPath, { force: true });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
