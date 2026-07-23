import { describe, expect, it } from 'vitest';
import {
  allowedWhatsAppNumbers,
  configuredCorsOrigins,
  isPublicRequestPath,
  validateBasicAuthConfiguration,
  validateWhatsAppSecurityConfiguration,
  validBasicAuthorization
} from './security.js';

describe('HTTP security helpers', () => {
  it('accepts only the configured basic credentials', () => {
    const correct = 'Basic ' + Buffer.from('operador:una-clave-larga-y-segura').toString('base64');
    const wrong = 'Basic ' + Buffer.from('operador:otra-clave').toString('base64');
    expect(validBasicAuthorization(correct, 'operador', 'una-clave-larga-y-segura')).toBe(true);
    expect(validBasicAuthorization(wrong, 'operador', 'una-clave-larga-y-segura')).toBe(false);
    expect(validBasicAuthorization(undefined, 'operador', 'una-clave-larga-y-segura')).toBe(false);
  });

  it('requires complete strong credentials in production', () => {
    expect(() => validateBasicAuthConfiguration({ username: '', password: '', production: true })).toThrow(/obligatoria/);
    expect(validateBasicAuthConfiguration({ username: '', password: '', production: true, required: false }).enabled).toBe(false);
    expect(() => validateBasicAuthConfiguration({ username: 'fmh', password: '', production: false })).toThrow(/juntos/);
    expect(() => validateBasicAuthConfiguration({ username: 'fmh', password: 'corta', production: false })).toThrow(/12/);
    expect(validateBasicAuthConfiguration({ username: '', password: '', production: false }).enabled).toBe(false);
  });

  it('keeps only health, Meta webhook and expiring draft links public', () => {
    expect(isPublicRequestPath('/api/health')).toBe(true);
    expect(isPublicRequestPath('/webhooks/whatsapp?hub.mode=subscribe')).toBe(true);
    expect(isPublicRequestPath('/api/whatsapp/drafts/token/content')).toBe(true);
    expect(isPublicRequestPath('/api/health-admin')).toBe(false);
    expect(isPublicRequestPath('/api/whatsapp/drafts/token/metadata')).toBe(false);
    expect(isPublicRequestPath('/api/documents/id/content')).toBe(false);
    expect(isPublicRequestPath('/')).toBe(false);
  });

  it('restricts production CORS to the public origin and explicit additions', () => {
    const allowed = configuredCorsOrigins('https://fmh.example.com', 'https://admin.example.com', true);
    expect(allowed('https://fmh.example.com')).toBe(true);
    expect(allowed('https://admin.example.com')).toBe(true);
    expect(allowed('https://evil.example.com')).toBe(false);
    expect(allowed(undefined)).toBe(true);
  });

  it('requires signed allowlisted WhatsApp operator mode in production', () => {
    expect(() => validateWhatsAppSecurityConfiguration({
      accessToken: 'token',
      phoneNumberId: '123',
      verifyToken: 'change-me',
      appSecret: 'change-me',
      allowedFrom: '',
      production: true
    })).toThrow(/WHATSAPP_APP_SECRET/);
    expect(validateWhatsAppSecurityConfiguration({
      accessToken: 'token',
      phoneNumberId: '123',
      verifyToken: 'verify-secure',
      appSecret: 'app-secret-secure',
      allowedFrom: '+54 9 2923 000000, 5492923111111',
      production: true
    }).allowedNumbers).toEqual(new Set(['5492923000000', '5492923111111']));
    expect(allowedWhatsAppNumbers('')).toEqual(new Set());
  });
});
