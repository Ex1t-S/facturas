import { describe, expect, it } from 'vitest';
import { isAllowedMetaMediaUrl, validateInboundMediaMetadata } from './whatsapp.js';

describe('WhatsApp inbound media security', () => {
  it('accepts HTTPS media URLs hosted by Meta', () => {
    expect(isAllowedMetaMediaUrl('https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=123')).toBe(true);
    expect(isAllowedMetaMediaUrl('https://cdn.whatsapp.net/media/123')).toBe(true);
  });

  it('rejects non-HTTPS and lookalike hosts', () => {
    expect(isAllowedMetaMediaUrl('http://lookaside.fbsbx.com/media')).toBe(false);
    expect(isAllowedMetaMediaUrl('https://fbsbx.com.attacker.example/media')).toBe(false);
    expect(isAllowedMetaMediaUrl('https://example.com/media')).toBe(false);
  });

  it('rejects unsupported or oversized media before downloading it', () => {
    expect(() =>
      validateInboundMediaMetadata({
        url: 'https://lookaside.fbsbx.com/media',
        mimeType: 'application/x-msdownload',
        fileSize: 1
      })
    ).toThrow('not supported');

    expect(() =>
      validateInboundMediaMetadata({
        url: 'https://lookaside.fbsbx.com/media',
        mimeType: 'application/pdf',
        fileSize: 25 * 1024 * 1024 + 1
      })
    ).toThrow('25 MB');
  });
});
