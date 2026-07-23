import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';

const optionalCuit = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return value;
    const digits = value.replace(/\D/g, '');
    return digits || undefined;
  },
  z.string().regex(/^\d{11}$/, 'El CUIT debe tener 11 dígitos.').optional()
);

const customerSchema = z.object({
  companyId: z.string(),
  legalName: z.string().min(1),
  tradeName: z.string().optional(),
  cuit: optionalCuit,
  taxCondition: z.string().optional(),
  address: z.string().optional(),
  contactName: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  paymentTerms: z.string().optional(),
  notes: z.string().optional()
});

export const customerRoutes: FastifyPluginAsync = async (app) => {
  app.get('/customers', async (request) => {
    const query = z.object({ companyId: z.string() }).parse(request.query);
    return prisma.customer.findMany({
      where: { companyId: query.companyId },
      orderBy: { legalName: 'asc' }
    });
  });

  app.post('/customers', async (request, reply) => {
    const body = customerSchema.parse(request.body);
    const customer = await prisma.customer.create({ data: body });
    return reply.code(201).send(customer);
  });
};
