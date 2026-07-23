import { describe, expect, it } from 'vitest';
import { billingMonthBounds } from './deliveryNoteService.js';

describe('billingMonthBounds', () => {
  it('builds a half-open interval using the Argentina business timezone', () => {
    const bounds = billingMonthBounds('2026-07');
    expect(bounds.from.toISOString()).toBe('2026-07-01T03:00:00.000Z');
    expect(bounds.to.toISOString()).toBe('2026-08-01T03:00:00.000Z');
  });

  it('handles the December to January boundary', () => {
    const bounds = billingMonthBounds('2026-12');
    expect(bounds.from.toISOString()).toBe('2026-12-01T03:00:00.000Z');
    expect(bounds.to.toISOString()).toBe('2027-01-01T03:00:00.000Z');
  });

  it('rejects ambiguous or impossible month values', () => {
    expect(() => billingMonthBounds('07-2026')).toThrow(/AAAA-MM/);
    expect(() => billingMonthBounds('2026-13')).toThrow(/AAAA-MM/);
  });
});
