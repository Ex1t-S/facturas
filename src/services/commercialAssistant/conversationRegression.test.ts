import { describe, expect, it, vi } from 'vitest';
import { processCommercialMessage } from './orchestrator.js';
import {
  mutationRegressionMessages,
  primaryWhatsAppRegression
} from './conversationRegression.fixture.js';
import type {
  CommercialDraft,
  CommercialOrchestratorAdapters,
  CommercialProcessResult
} from './types.js';

const customers = [
  { id: 'customer-mario', legalName: 'Mario Alvarez' },
  {
    id: 'customer-emancipacion',
    legalName: 'Cooperativa de Provisión, Transformación y Comercialización La Emancipación Ltda.',
    tradeName: 'La Emancipación'
  }
];

function harness() {
  let sequence = 0;
  const generatePreview = vi.fn(async (draft: CommercialDraft, fileName: string) => ({
    buffer: Buffer.from(draft.items.map((item) => item.description).join('\n')),
    storagePath: `preview://${draft.id}/${draft.draftVersion}`,
    fileName,
    mimeType: 'application/pdf'
  }));
  const finalizeDocument = vi.fn(async (draft: CommercialDraft) => ({
    documentId: `document-${draft.id}`
  }));
  const adapters: CommercialOrchestratorAdapters = {
    customers,
    defaultCurrency: 'ARS',
    createId: () => `stable-${++sequence}`,
    now: () => new Date('2026-07-23T16:00:00Z'),
    generatePreview,
    finalizeDocument
  };
  let draft: CommercialDraft | null = null;
  let turn = 0;
  const send = async (message: string) => {
    const result = await processCommercialMessage({
      companyId: 'company-1',
      conversationId: 'conversation-1',
      message,
      messageId: `wamid-${++turn}`,
      draft,
      adapters
    });
    draft = result.draft;
    return result;
  };
  return {
    send,
    get draft() {
      return draft;
    },
    generatePreview,
    finalizeDocument
  };
}

describe('regresión integral de la conversación comercial', () => {
  it('conserva cliente e ítems entre preview y "guardalo como"', async () => {
    const app = harness();
    let previousVersion = 0;
    for (const turn of primaryWhatsAppRegression) {
      const result = await app.send(turn.user);
      if (turn.expected.state === 'IDLE') {
        expect(result.handled).toBe(false);
        expect(result.draft).toBeNull();
        continue;
      }
      expect(result.classification.type).toBe(turn.expected.action);
      expect(result.draft?.status).toBe(turn.expected.state);
      if (turn.expected.customerIncludes) {
        expect(result.draft?.customerName).toContain(turn.expected.customerIncludes);
      }
      expect(result.draft?.items).toHaveLength(turn.expected.itemCount ?? 0);
      if (turn.expected.itemDescriptions) {
        expect(result.draft?.items.map((item) => item.description)).toEqual(turn.expected.itemDescriptions);
      }
      if (turn.expected.requestedFileName) {
        expect(result.draft?.requestedFileName).toBe(turn.expected.requestedFileName);
      }
      expect(result.draft?.draftVersion).toBeGreaterThanOrEqual(previousVersion);
      previousVersion = result.draft?.draftVersion ?? previousVersion;
      if (turn.expected.preview) expect(result.draft?.previewVersion).toBe(result.draft?.draftVersion);
      if (turn.expected.finalized) expect(result.documentId).toBeTruthy();
    }
    expect(app.generatePreview).toHaveBeenCalledTimes(1);
    expect(app.finalizeDocument).toHaveBeenCalledTimes(1);
    expect(app.draft).toMatchObject({
      status: 'FINALIZED',
      customerId: 'customer-mario',
      requestedFileName: 'remito-mario-alvarez-2307.pdf'
    });
    expect(app.draft?.items.map((item) => item.description)).toEqual([
      'Mejoramos una batea',
      'Limpiamos los cabezales de una noria'
    ]);
  });

  it('aplica agregados, referencias, reemplazos y precios sin convertir comandos en ítems', async () => {
    const app = harness();
    await app.send('Quiero armar un remito');
    await app.send('Mario Alvarez');

    const appended = await app.send(mutationRegressionMessages[0]);
    expect(appended.draft?.items.map((item) => item.description)).toEqual(['Caminamos sobre un techo']);

    const deletedLast = await app.send(mutationRegressionMessages[1]);
    expect(deletedLast.draft?.items).toHaveLength(0);

    await app.send(mutationRegressionMessages[0]);
    const deletedByText = await app.send(mutationRegressionMessages[2]);
    expect(deletedByText.draft?.items).toHaveLength(0);
    expect(deletedByText.answer).not.toContain('agrega que');

    await app.send(mutationRegressionMessages[3]);
    expect(app.draft?.items).toHaveLength(1);
    expect(app.draft?.items[0]?.description).toBe('Techado de galpón con 14 metros');
    const stableLineId = app.draft?.items[0]?.lineId;

    await app.send(mutationRegressionMessages[4]);
    expect(app.draft?.items[0]).toMatchObject({
      lineId: stableLineId,
      description: 'Techado de galpón con 16 metros'
    });

    await app.send(mutationRegressionMessages[5]);
    expect(app.draft?.items).toHaveLength(1);
    expect(app.draft?.items[0]).toMatchObject({
      lineId: stableLineId,
      description: 'Techado de galpón 14 metros'
    });

    const summary = await app.send(mutationRegressionMessages[6]);
    expect(summary.answer).toContain('Cliente: Mario Alvarez');
    expect(summary.answer).toContain('Moneda: ARS');
    expect(summary.answer).toContain('1. Techado de galpón 14 metros');

    const summaryPdf = await app.send(mutationRegressionMessages[7]);
    expect(summaryPdf.classification.type).toBe('GENERATE_PREVIEW');
    expect(summaryPdf.draft?.status).toBe('WAITING_CONFIRMATION');

    await app.send(mutationRegressionMessages[8]);
    expect(app.draft?.items[0]?.unitPrice).toBe(20_000);
    expect(app.draft?.items).toHaveLength(1);
    await app.send(mutationRegressionMessages[9]);
    expect(app.draft?.items[0]?.unitPrice).toBe(50_000);
  });

  it('updates item 2 price without appending the instruction and previews current items only', async () => {
    const app = harness();
    await app.send('Presupuesto');
    await app.send('Mario Alvarez');
    await app.send('Instalación de plataforma');
    await app.send('Limpieza de noria');

    const priced = await app.send('precio del item 2 a 20000');
    expect(priced.draft?.items).toHaveLength(2);
    expect(priced.draft?.items[1]?.unitPrice).toBe(20_000);
    expect(priced.draft?.items.map((item) => item.description).join(' ')).not.toContain('precio del item');

    const missing = await app.send('pasame el pdf');
    expect(missing.errorCode).toBe('MISSING_PRICES');
    expect(missing.answer).toContain('1. Instalación de plataforma');
    expect(missing.answer).not.toContain('precio del item 2 a 20000');

    await app.send('al item uno ponle 20000$');
    const preview = await app.send('pasame el pdf');
    expect(preview.draft?.status).toBe('WAITING_CONFIRMATION');
    expect(preview.preview?.buffer?.toString()).toBe('Instalación de plataforma\nLimpieza de noria');
  });

  it('resuelve cliente, capacidad, cantidad, precio y moneda en una respuesta esperada', async () => {
    const app = harness();
    await app.send('Presupuesto');
    const result = await app.send('Emancipacion silo 500t 20000');
    expect(result.draft).toMatchObject({
      customerId: 'customer-emancipacion',
      currency: 'ARS',
      status: 'READY_FOR_PREVIEW',
      items: [
        {
          description: 'Silo 500 t',
          quantity: 1,
          unit: 'unidad',
          unitPrice: 20_000
        }
      ]
    });
  });

  it('extrae un presupuesto completo de un único mensaje', async () => {
    const app = harness();
    const result = await app.send(
      'Armame un presupuesto para la emancipacion de un SILO 200T precio 20000$'
    );
    expect(result.draft).toMatchObject({
      documentType: 'QUOTE',
      customerId: 'customer-emancipacion',
      currency: 'ARS',
      items: [
        {
          description: 'Silo 200 t',
          quantity: 1,
          unitPrice: 20_000
        }
      ]
    });
    expect(result.draft?.items[0]?.description).not.toContain('Armame un presupuesto');
  });

  it('regenera un preview obsoleto y hace la confirmación idempotente', async () => {
    const app = harness();
    await app.send('Presupuesto');
    await app.send('Mario Alvarez');
    await app.send('Instalación precio 20000');
    await app.send('pasame el pdf');
    const previewVersion = app.draft?.previewVersion;
    await app.send('al item uno ponle 50000');
    expect(app.draft?.previewVersion).toBeUndefined();
    expect(app.draft?.draftVersion).toBeGreaterThan(previewVersion ?? 0);

    await app.send('guardalo');
    expect(app.generatePreview).toHaveBeenCalledTimes(2);
    expect(app.finalizeDocument).toHaveBeenCalledTimes(1);
    expect(app.draft?.status).toBe('FINALIZED');

    const duplicated = await app.send('guardalo');
    expect(duplicated.documentId).toBe(`document-${app.draft?.id}`);
    expect(app.finalizeDocument).toHaveBeenCalledTimes(1);
  });

  it('no mezcla dos tipos de documento si hay un borrador activo', async () => {
    const app = harness();
    await app.send('Quiero armar un remito');
    await app.send('Mario Alvarez');
    await app.send('Limpieza de noria');
    const conflict = await app.send('Ahora armame un presupuesto');
    expect(conflict.errorCode).toBe('ACTIVE_DRAFT_CONFLICT');
    expect(conflict.answer).toContain('remito sin guardar para Mario Alvarez');
    expect(conflict.draft?.documentType).toBe('DELIVERY_NOTE');
    expect(conflict.draft?.items.map((item) => item.description)).toEqual(['Limpieza de noria']);
  });
});
