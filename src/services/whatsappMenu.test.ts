import { describe, expect, it } from 'vitest';
import {
  parseWhatsAppCustomerInput,
  parseWhatsAppDocumentQuery,
  whatsappMainMenuInteractive,
  whatsappMainMenu,
  whatsappMenuSelection,
  isWhatsAppMenuRequest
} from './whatsappMenu.js';

describe('WhatsApp menu', () => {
  it('exposes the four requested routes', () => {
    expect(whatsappMainMenu).toContain('1. Remito');
    expect(whatsappMainMenu).toContain('2. Presupuesto');
    expect(whatsappMainMenu).toContain('3. Clientes');
    expect(whatsappMainMenu).toContain('4. Consultas');
  });

  it('maps numeric options only when the menu is active', () => {
    expect(whatsappMenuSelection('1', { mode: 'ROOT' })).toBe('delivery_note');
    expect(whatsappMenuSelection('2', { mode: 'ROOT' })).toBe('quote');
    expect(whatsappMenuSelection('3', { mode: 'ROOT' })).toBe('customers');
    expect(whatsappMenuSelection('4', { mode: 'ROOT' })).toBe('document_query');
    expect(whatsappMenuSelection('1')).toBeNull();
  });

  it('maps official WhatsApp list replies by stable id', () => {
    expect(whatsappMainMenuInteractive.type).toBe('list');
    expect(whatsappMenuSelection('fmh_menu_remito')).toBe('delivery_note');
    expect(whatsappMenuSelection('fmh_menu_presupuesto')).toBe('quote');
    expect(whatsappMenuSelection('fmh_menu_clientes')).toBe('customers');
    expect(whatsappMenuSelection('fmh_menu_consultas')).toBe('document_query');
  });

  it('recognizes greetings as a safe entry point without treating them as items', () => {
    expect(isWhatsAppMenuRequest('Hola')).toBe(true);
    expect(isWhatsAppMenuRequest('buenas')).toBe(true);
  });

  it('extracts customer details without requiring every optional field', () => {
    expect(parseWhatsAppCustomerInput('Mario Alvarez, CUIT 20-12345678-9, telefono 2923 555555, email mario@example.com'))
      .toEqual({ legalName: 'Mario Alvarez', cuit: '20123456789', phone: '2923 555555', email: 'mario@example.com', address: undefined });
  });

  it('extracts customer and date for document lookup', () => {
    expect(parseWhatsAppDocumentQuery('Mario Alvarez 23/07/2026')).toEqual({ customerQuery: 'Mario Alvarez', date: '2026-07-23' });
    expect(parseWhatsAppDocumentQuery('cliente: La Emancipacion fecha 01-08-2026')).toEqual({ customerQuery: 'La Emancipacion', date: '2026-08-01' });
  });
});
