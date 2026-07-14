import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import staticPlugin from '@fastify/static';
import Fastify, { type FastifyError } from 'fastify';
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
import { webRoutes } from './routes/web.js';
import { syncPublicSupplierPrices } from './services/supplierPublicSync.js';

export async function buildServer() {
  const uploadRoot = path.resolve(config.UPLOAD_DIR);
  const publicRoot = path.resolve('public');
  const frontendAssetsRoot = path.resolve('frontend/dist/ui-assets');
  await fs.mkdir(uploadRoot, { recursive: true });
  await fs.mkdir(publicRoot, { recursive: true });
  await fs.mkdir(frontendAssetsRoot, { recursive: true });

  const app = Fastify({ logger: true });
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
  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
  await app.register(staticPlugin, { root: uploadRoot, prefix: '/uploads/' });
  await app.register(staticPlugin, { root: frontendAssetsRoot, prefix: '/ui-assets/', decorateReply: false });
  await app.register(staticPlugin, { root: publicRoot, prefix: '/assets/', decorateReply: false });

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    app.log.error(error);
    const status = 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
    reply.code(status).send({ error: error.message });
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
