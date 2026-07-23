import { describe, expect, it } from 'vitest';
import {
  isOutOfOrderMessage,
  providerTimestamp,
  safeProcessingError
} from './webhookPolicy.js';

describe('WhatsApp webhook processing policy', () => {
  it('parses provider timestamps deterministically', () => {
    expect(providerTimestamp('1784822400')?.toISOString()).toBe('2026-07-23T16:00:00.000Z');
    expect(providerTimestamp('bad')).toBeUndefined();
  });

  it('rejects an older message after a newer completed transition', () => {
    expect(
      isOutOfOrderMessage(
        new Date('2026-07-23T16:00:00Z'),
        new Date('2026-07-23T16:00:01Z')
      )
    ).toBe(true);
    expect(
      isOutOfOrderMessage(
        new Date('2026-07-23T16:00:01Z'),
        new Date('2026-07-23T16:00:00Z')
      )
    ).toBe(false);
  });

  it('does not leak a full phone number in persisted errors', () => {
    expect(safeProcessingError(new Error('falló para +5491100000000'))).toBe(
      'falló para [phone]'
    );
  });
});
