import { describe, expect, it } from 'vitest';
import { resolveDocumentConversationMessage, unsupportedWhatsAppAnswer } from './documentConversationResolver.js';

function resolve(message: string, hasActiveDraft = true, waitingConfirmation = false) {
  return resolveDocumentConversationMessage({ message, hasActiveDraft, waitingConfirmation });
}

describe('DocumentConversationResolver', () => {
  it.each([
    'Recordame mañana que tenemos que ir a trabajar a la planta de silos.',
    'Poneme una alarma para revisar la noria a las ocho.',
    'Agendame una visita para cambiar rodamientos.'
  ])('rejects unsupported reminder requests before work extraction: %s', (message) => {
    expect(resolve(message).action).toBe('UNSUPPORTED');
  });

  it.each(['Pasame el PDF.', 'Preparámelo.', 'Mostrame cómo quedó.', 'Listo.'])('recognizes preview requests while collecting: %s', (message) => {
    expect(resolve(message).action).toBe('REQUEST_PREVIEW');
  });

  it.each(['Guardalo.', 'Confirmado', 'Ok', 'Listo', 'Guardalo como remito-mario.pdf'])('recognizes confirmations only after a current preview: %s', (message) => {
    expect(resolve(message, true, true).action).toBe('CONFIRM_DOCUMENT');
  });

  it('keeps business queries outside the active document', () => {
    expect(resolve('¿Cuánto stock de chapa de 3 mm tenemos?').action).toBe('QUERY');
    expect(resolve('¿Qué remitos pendientes tiene Pérez?').action).toBe('QUERY');
  });

  it('distinguishes additions and corrections', () => {
    expect(resolve('También soldamos el soporte inferior.').action).toBe('APPEND_TO_DOCUMENT_DRAFT');
    expect(resolve('Perdón, fueron tres rodamientos.').action).toBe('UPDATE_DOCUMENT_DRAFT');
    expect(resolve('Borrá los rodamientos.').action).toBe('UPDATE_DOCUMENT_DRAFT');
    expect(resolve('Cambiá el precio del item 1 a 50000.').action).toBe('UPDATE_DOCUMENT_DRAFT');
  });

  it('accepts clear work evidence but asks about unclear audio', () => {
    expect(resolve('Cambiamos dos rodamientos de la noria.').action).toBe('APPEND_TO_DOCUMENT_DRAFT');
    expect(resolve('Eso de mañana quedó más o menos.').action).toBe('AMBIGUOUS');
  });

  it('understands natural-language refusal to save a finished draft', () => {
    expect(resolve('Al final no lo quiero guardar.').action).toBe('CANCEL_DOCUMENT');
    expect(resolve('Descartalo.').action).toBe('CANCEL_DOCUMENT');
    expect(resolve('cancelar borrador').action).toBe('CANCEL_DOCUMENT');
    expect(resolve('no, dejá').action).toBe('CANCEL_DOCUMENT');
  });

  it('starts an explicit new document instead of appending it', () => {
    expect(resolve('Ahora haceme un remito para Pérez.').action).toBe('START_DOCUMENT_DRAFT');
  });

  it('explains the supported scope without claiming reminder support', () => {
    expect(unsupportedWhatsAppAnswer()).toContain('no puedo crear recordatorios');
    expect(unsupportedWhatsAppAnswer()).toContain('remitos, presupuestos o consultas internas');
  });

  it.each(['Mandale un mensaje a Mario.', 'Enviále un correo al cliente.', 'Hacé una transferencia al proveedor.'])(
    'rejects unsupported external actions: %s',
    (message) => {
      const resolution = resolve(message, false);
      expect(resolution.action).toBe('UNSUPPORTED');
      expect(unsupportedWhatsAppAnswer(resolution.reason)).toContain('no puedo ejecutar esa acción externa');
    }
  );
});
