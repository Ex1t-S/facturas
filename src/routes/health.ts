import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../db.js';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health/live', async () => ({ ok: true, service: 'fmh-gestion' }));
  app.get('/health', async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { ok: true, service: 'fmh-gestion', database: 'available' };
    } catch {
      return reply.code(503).send({ ok: false, service: 'fmh-gestion', database: 'unavailable' });
    }
  });
};
