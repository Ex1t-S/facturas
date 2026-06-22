import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { answerAssistant } from '../services/assistant.js';

const assistantSchema = z.object({
  companyId: z.string().optional(),
  message: z.string().trim().min(1).max(3000),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(3000)
      })
    )
    .max(12)
    .optional()
});

export const assistantRoutes: FastifyPluginAsync = async (app) => {
  app.post('/assistant', async (request) => {
    const body = assistantSchema.parse(request.body);
    return answerAssistant(body);
  });
};

