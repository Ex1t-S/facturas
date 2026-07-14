import { answerEngineeringStandalone } from './engineeringConversation.js';

/** Compatibilidad con el endpoint histórico. Toda la lógica vive en el orquestador persistente. */
export async function answerEngineering(input: { companyId: string; message: string }) {
  return answerEngineeringStandalone(input.companyId, input.message);
}
