import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

export type StoredDocumentInput = {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  sourceType: string;
  companyId?: string;
  uploadedBy?: string;
};

export function safeFileName(filename: string) {
  const cleaned = filename.normalize('NFKD').replace(/[^\w.-]+/g, '_');
  return cleaned || 'documento';
}

export function uploadsRoot() {
  return path.resolve(config.UPLOAD_DIR);
}

export function assertInsideUploads(filePath: string) {
  const root = uploadsRoot();
  const resolved = path.resolve(filePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('Invalid document path');
  }
  return resolved;
}

export async function writeDocumentFile(input: StoredDocumentInput) {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const sha256 = crypto.createHash('sha256').update(input.buffer).digest('hex');
  const folder = path.join(uploadsRoot(), 'documents', yyyy, mm, sha256.slice(0, 12));
  await fs.mkdir(folder, { recursive: true });
  const storagePath = path.join(folder, safeFileName(input.filename));
  await fs.writeFile(storagePath, input.buffer);

  return {
    sha256,
    storagePath,
    byteSize: input.buffer.byteLength
  };
}
