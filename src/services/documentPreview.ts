import fs from 'node:fs/promises';
import mammoth from 'mammoth';
import sanitizeHtml from 'sanitize-html';
import { resolveStoredDocumentPath } from './documentStorage.js';

export type DocumentPreview =
  | { type: 'pdf'; url: string }
  | { type: 'image'; url: string }
  | { type: 'html'; html: string }
  | { type: 'unsupported'; message: string };

export function isWordMime(mimeType: string, fileName: string) {
  return (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    fileName.toLowerCase().endsWith('.docx')
  );
}

export function isPdfMime(mimeType: string, fileName: string) {
  return mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');
}

export function isImageMime(mimeType: string, fileName: string) {
  return mimeType.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(fileName);
}

export async function buildPreview(document: { id: string; mimeType: string; fileName: string; storagePath: string }): Promise<DocumentPreview> {
  if (isPdfMime(document.mimeType, document.fileName)) {
    return { type: 'pdf', url: `/api/documents/${document.id}/content` };
  }

  if (isImageMime(document.mimeType, document.fileName)) {
    return { type: 'image', url: `/api/documents/${document.id}/content` };
  }

  if (isWordMime(document.mimeType, document.fileName)) {
    const filePath = resolveStoredDocumentPath(document.storagePath);
    await fs.access(filePath);
    const result = await mammoth.convertToHtml({ path: filePath });
    return {
      type: 'html',
      html: sanitizeHtml(result.value, {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'table', 'thead', 'tbody', 'tr', 'th', 'td']),
        allowedAttributes: {
          ...sanitizeHtml.defaults.allowedAttributes,
          img: ['src', 'alt'],
          '*': ['class']
        }
      })
    };
  }

  return {
    type: 'unsupported',
    message: 'Este tipo de archivo todavía no tiene vista previa inline.'
  };
}
