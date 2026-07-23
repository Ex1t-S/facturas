import { describe, expect, it } from 'vitest';
import { buildWhatsAppHistory } from './whatsapp.js';

describe('buildWhatsAppHistory', () => {
  it('keeps both sides of the conversation so numeric menu replies retain context', () => {
    const history = buildWhatsAppHistory([
      { direction: 'INBOUND', body: 'menú' },
      { direction: 'OUTBOUND', body: '1. Crear presupuesto\n2. Crear remito' },
      { direction: 'INBOUND', body: '1' }
    ]);

    expect(history).toEqual([
      { role: 'user', content: 'menú' },
      { role: 'assistant', content: '1. Crear presupuesto\n2. Crear remito' },
      { role: 'user', content: '1' }
    ]);
  });

  it('uses an attachment label when a message has no text', () => {
    expect(buildWhatsAppHistory([
      { direction: 'INBOUND', body: null, mediaDocument: { fileName: 'remito.pdf' } }
    ])).toEqual([{ role: 'user', content: '[Adjunto: remito.pdf]' }]);
  });
});
