import { describe, expect, it } from 'vitest';
import { parseMoneyExpression } from './moneyParser.js';

describe('commercial money parser', () => {
  it.each([
    ['20000', 20_000, undefined],
    ['$20000', 20_000, 'ARS'],
    ['20000$', 20_000, 'ARS'],
    ['20.000', 20_000, undefined],
    ['20 mil', 20_000, undefined],
    ['20k', 20_000, undefined],
    ['USD 20000', 20_000, 'USD'],
    ['U$S 20000', 20_000, 'USD'],
    ['20000 dólares', 20_000, 'USD'],
    ['20000 pesos', 20_000, 'ARS'],
    ['0', 0, undefined]
  ])('%s', (message, amount, explicitCurrency) => {
    const result = parseMoneyExpression(message, {
      allowBare: true,
      inheritedCurrency: 'ARS'
    });
    expect(result.amount).toBe(amount);
    expect(result.currency).toBe(explicitCurrency ?? 'ARS');
  });
});
