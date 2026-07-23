import type { Prisma } from '../generated/postgres-client/index.js';
import { prisma } from '../db.js';

type TransactionWork<T> = (tx: Prisma.TransactionClient) => Promise<T>;

function errorCode(error: unknown) {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

export async function runSerializableTransaction<T>(
  work: TransactionWork<T>,
  options: { retryUniqueConflict?: boolean; maxAttempts?: number } = {}
) {
  const maxAttempts = options.maxAttempts ?? 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await prisma.$transaction(work, { isolationLevel: 'Serializable' });
    } catch (error) {
      const code = errorCode(error);
      const retryable = code === 'P2034' || (options.retryUniqueConflict === true && code === 'P2002');
      if (!retryable || attempt === maxAttempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 15));
    }
  }
  throw new Error('Serializable transaction retry limit reached');
}
