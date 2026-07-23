import { describe, expect, it } from 'vitest';
import {
  applyCommercialDraftMutation,
  commercialMenu,
  customerChangeQuery,
  documentNameChangeQuery,
  isCommercialMenuRequest,
  menuSelection,
  parseCommercialDraftMutation
} from './commercialConversation.js';

const items = [
  { lineId: 'a', description: 'Rodamientos de la noria', quantity: 2, unit: 'unidad', unitPrice: 50_000 },
  { lineId: 'b', description: 'Reparación de motor', quantity: 1, unit: 'trabajo', unitPrice: 100_000 },
  { lineId: 'c', description: 'Soldadura de soporte', quantity: 1, unit: 'trabajo', unitPrice: 30_000 }
];

describe('commercial menu', () => {
  it('is deterministic and supports numeric selection only after showing the menu', () => {
    expect(isCommercialMenuRequest('Menú')).toBe(true);
    expect(commercialMenu).toContain('1. Crear presupuesto');
    expect(menuSelection('1', [{ role: 'assistant', content: commercialMenu }])).toBe('quote');
    expect(menuSelection('1', [])).toBeNull();
  });
});

describe('commercial draft mutations', () => {
  it('deletes an item by description', () => {
    const result = applyCommercialDraftMutation('Borrá los rodamientos del presupuesto', items);
    expect(result.status).toBe('applied');
    expect(result.items.map((item) => item.lineId)).toEqual(['b', 'c']);
  });

  it('deletes an item by number', () => {
    const result = applyCommercialDraftMutation('Sacá el item 2', items);
    expect(result.status).toBe('applied');
    expect(result.items.map((item) => item.lineId)).toEqual(['a', 'c']);
  });

  it('changes quantity without replacing the stable line', () => {
    const result = applyCommercialDraftMutation('En vez de dos rodamientos poné cuatro', items);
    expect(result.status).toBe('applied');
    expect(result.items[0]).toMatchObject({ lineId: 'a', quantity: 4 });
  });

  it('changes a price expressed in thousands', () => {
    const result = applyCommercialDraftMutation('Cambiá el precio de la reparación de motor a 120 mil', items);
    expect(result.status).toBe('applied');
    expect(result.items[1]).toMatchObject({ lineId: 'b', unitPrice: 120_000 });
  });

  it('replaces a description and keeps the rest of the line', () => {
    const result = applyCommercialDraftMutation('Reemplazá soldadura de soporte por fabricación de soporte', items);
    expect(result.status).toBe('applied');
    expect(result.items[2]).toMatchObject({ lineId: 'c', description: 'fabricacion de soporte', unitPrice: 30_000 });
  });

  it('asks for disambiguation instead of changing multiple lines', () => {
    const result = applyCommercialDraftMutation('Borrá la reparación', [items[1]!, { ...items[2]!, description: 'Reparación de soporte' }]);
    expect(result.status).toBe('ambiguous');
    expect(result.items).toHaveLength(2);
  });

  it('extracts a customer change independently from item edits', () => {
    expect(customerChangeQuery('Cambiá el cliente a Mario Álvarez')).toBe('mario alvarez');
    expect(parseCommercialDraftMutation('Cambiá el cliente a Mario Álvarez').kind).toBe('none');
  });

  it('extracts a requested document name without changing the item list', () => {
    expect(documentNameChangeQuery('Cambiá el nombre del remito a entrega mario')).toBe('entrega mario');
    expect(documentNameChangeQuery('Renombrá el archivo como presupuesto final.pdf')).toBe('presupuesto final');
  });
});
