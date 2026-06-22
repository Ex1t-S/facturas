import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';

const companySchema = z.object({
  legalName: z.string().min(1),
  tradeName: z.string().optional(),
  cuit: z.string().min(11).max(11),
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
};
