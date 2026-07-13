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

export class DocumentStorageError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = 'DocumentStorageError';
    this.statusCode = statusCode;
  }
}

function assertInsideUploads(filePath: string) {
  const root = uploadsRoot();
  const resolved = path.resolve(filePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new DocumentStorageError('Invalid document path', 400);
  }
  return resolved;
}

function relativePathFromLegacyAbsolute(storedPath: string) {
  const normalized = storedPath.replace(/\\/g, '/');
  const lower = normalized.toLowerCase();

  const uploadsIndex = lower.lastIndexOf('/uploads/');
  if (uploadsIndex >= 0) {
    return normalized.slice(uploadsIndex + '/uploads/'.length);
  }

  for (const directory of ['documents', 'generated']) {
    const marker = `/${directory}/`;
    const index = lower.lastIndexOf(marker);
    if (index >= 0) {
      return `${directory}/${normalized.slice(index + marker.length)}`;
    }
  }

  return null;
}

function isWindowsAbsolutePath(storedPath: string) {
  return /^[A-Za-z]:[\\/]/.test(storedPath) || storedPath.startsWith('\\\\');
}

function resolveRelativeStoragePath(storagePath: string) {
  return path.resolve(uploadsRoot(), storagePath.replace(/[\\/]+/g, path.sep));
}

export function resolveStoredDocumentPath(storagePath: string) {
  if (!storagePath.trim()) {
    throw new DocumentStorageError('Document path is empty', 400);
  }

  const root = uploadsRoot();
  if (isWindowsAbsolutePath(storagePath)) {
    const legacyRelativePath = relativePathFromLegacyAbsolute(storagePath);
    if (legacyRelativePath) {
      return assertInsideUploads(resolveRelativeStoragePath(legacyRelativePath));
    }

    throw new DocumentStorageError('Document path points outside current upload storage', 400);
  }

  if (!path.isAbsolute(storagePath)) {
    return assertInsideUploads(resolveRelativeStoragePath(storagePath));
  }

  const resolved = path.resolve(storagePath);
  if (resolved === root || resolved.startsWith(`${root}${path.sep}`)) {
    return resolved;
  }

  const legacyRelativePath = relativePathFromLegacyAbsolute(storagePath);
  if (legacyRelativePath) {
    return assertInsideUploads(resolveRelativeStoragePath(legacyRelativePath));
  }

  throw new DocumentStorageError('Document path points outside current upload storage', 400);
}

export async function readStoredDocumentFile(storagePath: string) {
  const filePath = resolveStoredDocumentPath(storagePath);
  try {
    return await fs.readFile(filePath);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      throw new DocumentStorageError('Document file is missing from storage', 404);
    }
    throw error;
  }
}

export async function writeDocumentFile(input: StoredDocumentInput) {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const sha256 = crypto.createHash('sha256').update(input.buffer).digest('hex');
  const relativeFolder = path.posix.join('documents', yyyy, mm, sha256.slice(0, 12));
  const folder = resolveRelativeStoragePath(relativeFolder);
  await fs.mkdir(folder, { recursive: true });
  const storagePath = path.posix.join(relativeFolder, safeFileName(input.filename));
  await fs.writeFile(resolveRelativeStoragePath(storagePath), input.buffer);

  return {
    sha256,
    storagePath,
    byteSize: input.buffer.byteLength
  };
}
