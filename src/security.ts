import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

export type BasicAuthConfiguration = {
  username: string;
  password: string;
  production: boolean;
};

export type WhatsAppSecurityConfiguration = {
  accessToken: string;
  phoneNumberId: string;
  verifyToken: string;
  appSecret: string;
  allowedFrom: string;
  production: boolean;
};

function digest(value: string) {
  return createHash('sha256').update(value, 'utf8').digest();
}

function safeEqual(left: string, right: string) {
  return timingSafeEqual(digest(left), digest(right));
}

export function validateBasicAuthConfiguration(input: BasicAuthConfiguration) {
  const hasUsername = Boolean(input.username.trim());
  const hasPassword = Boolean(input.password);
  if (hasUsername !== hasPassword) {
    throw new Error('BASIC_AUTH_USERNAME y BASIC_AUTH_PASSWORD deben configurarse juntos.');
  }
  if (input.production && (!hasUsername || !hasPassword)) {
    throw new Error('La autenticación básica es obligatoria en producción.');
  }
  if (hasPassword && input.password.length < 12) {
    throw new Error('BASIC_AUTH_PASSWORD debe tener al menos 12 caracteres.');
  }
  return { enabled: hasUsername && hasPassword };
}

export function allowedWhatsAppNumbers(value: string) {
  return new Set(
    value
      .split(',')
      .map((item) => item.replace(/\D/g, ''))
      .filter(Boolean)
  );
}

export function validateWhatsAppSecurityConfiguration(input: WhatsAppSecurityConfiguration) {
  const enabled = Boolean(input.accessToken.trim() || input.phoneNumberId.trim());
  const allowedNumbers = allowedWhatsAppNumbers(input.allowedFrom);
  if (!enabled) return { enabled: false, allowedNumbers, missing: [] as string[] };
  const missing = [
    !input.accessToken.trim() ? 'WHATSAPP_ACCESS_TOKEN' : '',
    !input.phoneNumberId.trim() ? 'WHATSAPP_PHONE_NUMBER_ID' : '',
    !input.verifyToken.trim() || input.verifyToken === 'change-me' ? 'WHATSAPP_VERIFY_TOKEN' : '',
    !input.appSecret.trim() || input.appSecret === 'change-me' ? 'WHATSAPP_APP_SECRET' : '',
    allowedNumbers.size === 0 ? 'WHATSAPP_ALLOWED_FROM' : ''
  ].filter(Boolean);
  if (input.production && missing.length) {
    throw new Error(`Configuración insegura de WhatsApp. Faltan: ${missing.join(', ')}.`);
  }
  return { enabled: true, allowedNumbers, missing };
}

export function validBasicAuthorization(
  authorization: string | undefined,
  expectedUsername: string,
  expectedPassword: string
) {
  if (!authorization?.startsWith('Basic ')) return false;
  try {
    const decoded = Buffer.from(authorization.slice('Basic '.length), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator < 0) return false;
    const username = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);
    return safeEqual(username, expectedUsername) && safeEqual(password, expectedPassword);
  } catch {
    return false;
  }
}

export function isPublicRequestPath(url: string) {
  const path = url.split('?', 1)[0] || '/';
  return path === '/api/health'
    || path === '/api/health/live'
    || path === '/webhooks/whatsapp'
    || /^\/api\/whatsapp\/drafts\/[^/]+\/content$/.test(path);
}

export function createBasicAuthHook(input: BasicAuthConfiguration) {
  const auth = validateBasicAuthConfiguration(input);
  return async function basicAuthHook(request: FastifyRequest, reply: FastifyReply) {
    if (!auth.enabled || isPublicRequestPath(request.url)) return;
    if (validBasicAuthorization(request.headers.authorization, input.username, input.password)) return;
    return reply
      .header('WWW-Authenticate', 'Basic realm="FMH Gestion", charset="UTF-8"')
      .code(401)
      .send({ error: 'Autenticación requerida.', requestId: request.id });
  };
}

export function configuredCorsOrigins(publicBaseUrl: string, extraOrigins: string, production: boolean) {
  const allowed = new Set<string>();
  try {
    allowed.add(new URL(publicBaseUrl).origin);
  } catch {
    // PUBLIC_BASE_URL is already validated by configuration.
  }
  for (const value of extraOrigins.split(',')) {
    const origin = value.trim();
    if (!origin) continue;
    try {
      allowed.add(new URL(origin).origin);
    } catch {
      throw new Error(`Origen CORS inválido: ${origin}`);
    }
  }
  return (origin: string | undefined) => {
    if (!origin) return true;
    if (allowed.has(origin)) return true;
    if (!production) {
      try {
        return ['localhost', '127.0.0.1', '::1'].includes(new URL(origin).hostname);
      } catch {
        return false;
      }
    }
    return false;
  };
}
