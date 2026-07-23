import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';

const companySchema = z.object({
  legalName: z.string().min(1),
  tradeName: z.string().optional(),
  cuit: z.string().transform((value) => value.replace(/\D/g, '')).pipe(z.string().length(11)),
  taxCondition: z.string().min(1),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional()
});

export const companyRoutes: FastifyPluginAsync = async (app) => {
  app.get('/companies', async () => prisma.company.findMany({ orderBy: { legalName: 'asc' } }));

  app.post('/companies', async (request, reply) => {
    const body = companySchema.parse(request.body);
    const company = await prisma.company.create({ data: body });
    return reply.code(201).send(company);
  });

  app.patch('/companies/:id', async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = companySchema.partial().parse(request.body);
    const existing = await prisma.company.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!existing) return reply.code(404).send({ error: 'Empresa no encontrada.' });
    return prisma.company.update({ where: { id: params.id }, data: body });
  });
};
