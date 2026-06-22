import { describe, expect, it } from 'vitest';
import { calculateQuoteTotals } from './money.js';

describe('calculateQuoteTotals', () => {
  it('calculates subtotal, tax and total with discounts', () => {
    const totals = calculateQuoteTotals([
      { quantity: 2, unitPrice: 1000, discount: 10, taxRate: 21 },
      { quantity: 1, unitPrice: 500, taxRate: 10.5 }
    ]);

    expect(totals.subtotal).toBe(2300);
    expect(totals.taxTotal).toBe(430.5);
    expect(totals.total).toBe(2730.5);
  });
});
