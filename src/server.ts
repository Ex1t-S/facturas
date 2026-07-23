import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import staticPlugin from '@fastify/static';
import Fastify, { type FastifyError } from 'fastify';
import { ZodError } from 'zod';
import { config } from './config.js';
import { prisma } from './db.js';
import { assistantRoutes } from './routes/assistant.js';
import { companyRoutes } from './routes/companies.js';
import { customerRoutes } from './routes/customers.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { documentRoutes } from './routes/documents.js';
import { healthRoutes } from './routes/health.js';
import { invoiceRoutes } from './routes/invoices.js';
import { inventoryRoutes } from './routes/inventory.js';
import { productRoutes } from './routes/products.js';
import { quoteRoutes } from './routes/quotes.js';
import { searchRoutes } from './routes/search.js';
import { supplierRoutes } from './routes/suppliers.js';
import { whatsappRoutes } from './routes/whatsapp.js';
import { engineeringRoutes } from './routes/engineering.js';
import { deliveryNoteRoutes } from './routes/deliveryNotes.js';
import { webRoutes } from './routes/web.js';
import { syncPublicSupplierPrices } from './services/supplierPublicSync.js';
import {
  configuredCorsOrigins,
  createBasicAuthHook,
  validateBasicAuthConfiguration,
  validateWhatsAppSecurityConfiguration
} from './security.js';

export async function buildServer() {
  const production = process.env.NODE_ENV === 'production';
  validateBasicAuthConfiguration({
    username: config.BASIC_AUTH_USERNAME,
    password: config.BASIC_AUTH_PASSWORD,
    production,
    required: config.BASIC_AUTH_REQUIRED
  });
  validateWhatsAppSecurityConfiguration({
    accessToken: config.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: config.WHATSAPP_PHONE_NUMBER_ID,
    verifyToken: config.WHATSAPP_VERIFY_TOKEN,
    appSecret: config.WHATSAPP_APP_SECRET,
    allowedFrom: config.WHATSAPP_ALLOWED_FROM,
    production
  });
  const uploadRoot = path.resolve(config.UPLOAD_DIR);
  const frontendAssetsRoot = path.resolve('frontend/dist/ui-assets');
  await fs.mkdir(uploadRoot, { recursive: true });
  await fs.mkdir(frontendAssetsRoot, { recursive: true });

  const app = Fastify({
    bodyLimit: 1024 * 1024,
    trustProxy: config.TRUST_PROXY,
    logger: {
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers.x-hub-signature-256',
          'headers.authorization',
          'headers.cookie',
          'headers.x-hub-signature-256'
        ],
        censor: '[REDACTED]'
      }
    }
  });
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => {
    try {
      const parsed = JSON.parse(body.toString('utf8')) as Record<string, unknown>;
      Object.defineProperty(parsed, '__rawBody', { value: body, enumerable: false });
      done(null, parsed);
    } catch (error) {
      done(error as Error, undefined);
    }
  });
  await app.register(helmet);
  const isCorsOriginAllowed = configuredCorsOrigins(config.PUBLIC_BASE_URL, config.CORS_ORIGINS, production);
  await app.register(cors, {
    origin: (origin, callback) => callback(null, isCorsOriginAllowed(origin)),
    credentials: true
  });
  await app.register(rateLimit, {
    global: true,
    max: config.API_RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    errorResponseBuilder: (request, context) => ({
      error: 'Demasiadas solicitudes. Intentá nuevamente en unos instantes.',
      requestId: request.id,
      retryAfterSeconds: Math.ceil(context.ttl / 1000)
    })
  });
  app.addHook('onRequest', createBasicAuthHook({
    username: config.BASIC_AUTH_USERNAME,
    password: config.BASIC_AUTH_PASSWORD,
    production,
    required: config.BASIC_AUTH_REQUIRED
  }));
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Request-Id', request.id);
    return payload;
  });
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
  await app.register(staticPlugin, { root: frontendAssetsRoot, prefix: '/ui-assets/', decorateReply: false });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const prismaCode = typeof (error as { code?: unknown }).code === 'string'
      ? String((error as { code: string }).code)
      : undefined;
    const status = error instanceof ZodError
      ? 400
      : prismaCode === 'P2002'
        ? 409
        : prismaCode === 'P2025'
          ? 404
          : typeof error.statusCode === 'number'
            ? error.statusCode
            : 500;
    request.log.error({ err: error, requestId: request.id, prismaCode }, 'request failed');
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: 'Los datos enviados no son válidos.',
        requestId: request.id,
        issues: error.issues.slice(0, 20).map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message
        }))
      });
    }
    const publicMessage = status >= 500
      ? 'No se pudo completar la operación.'
      : prismaCode === 'P2002'
        ? 'Ya existe un registro con esos datos.'
        : prismaCode === 'P2025'
          ? 'No se encontró el registro solicitado.'
          : error.message;
    return reply.code(status).send({ error: publicMessage, requestId: request.id });
  });

  await app.register(healthRoutes, { prefix: '/api' });
  await app.register(assistantRoutes, { prefix: '/api' });
  await app.register(companyRoutes, { prefix: '/api' });
  await app.register(customerRoutes, { prefix: '/api' });
  await app.register(dashboardRoutes, { prefix: '/api' });
  await app.register(productRoutes, { prefix: '/api' });
  await app.register(quoteRoutes, { prefix: '/api' });
  await app.register(searchRoutes, { prefix: '/api' });
  await app.register(documentRoutes, { prefix: '/api' });
  await app.register(invoiceRoutes, { prefix: '/api' });
  await app.register(deliveryNoteRoutes, { prefix: '/api' });
  await app.register(inventoryRoutes, { prefix: '/api' });
  await app.register(supplierRoutes, { prefix: '/api' });
  await app.register(whatsappRoutes);
  await app.register(engineeringRoutes, { prefix: '/api' });
  await app.register(webRoutes);

  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });

  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = await buildServer();
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  if (config.SUPPLIER_PUBLIC_SYNC_ENABLED) {
    const intervalMs = config.SUPPLIER_PUBLIC_SYNC_INTERVAL_HOURS * 60 * 60 * 1000;
    const runSync = async () => {
      const company = await prisma.company.findFirst();
      if (!company) return;
      app.log.info({ companyId: company.id }, 'Running public supplier price sync');
      await syncPublicSupplierPrices(company.id);
    };
    setTimeout(() => runSync().catch((error) => app.log.error(error)), 20_000);
    setInterval(() => runSync().catch((error) => app.log.error(error)), intervalMs);
  }
}
