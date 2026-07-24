import crypto from 'node:crypto';
import { config } from '../config.js';

const WHATSAPP_TIMEOUT_MS = 30_000;
const TRANSCRIBE_TIMEOUT_MS = 45_000;
const MAX_INBOUND_MEDIA_BYTES = 25 * 1024 * 1024;
const ALLOWED_INBOUND_MEDIA_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/webp',
  'audio/aac',
  'audio/amr',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'audio/wav',
  'audio/webm'
]);
const META_MEDIA_HOST_SUFFIXES = ['.facebook.com', '.fbcdn.net', '.fbsbx.com', '.whatsapp.net'];

function timeoutSignal(ms: number) {
  return AbortSignal.timeout(ms);
}

export function isAllowedMetaMediaUrl(value: string) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === 'https:' && META_MEDIA_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
  } catch {
    return false;
  }
}

export function validateInboundMediaMetadata(input: { url?: string; mimeType?: string; fileSize?: number }) {
  if (!input.url || !isAllowedMetaMediaUrl(input.url)) {
    throw new Error('WhatsApp media URL is not an allowed Meta host');
  }
  if (!input.mimeType || !ALLOWED_INBOUND_MEDIA_TYPES.has(input.mimeType.toLowerCase())) {
    throw new Error('WhatsApp media type is not supported');
  }
  if (input.fileSize !== undefined && (!Number.isFinite(input.fileSize) || input.fileSize < 0 || input.fileSize > MAX_INBOUND_MEDIA_BYTES)) {
    throw new Error('WhatsApp media exceeds the 25 MB limit');
  }
}

export function verifyMetaSignature(rawBody: Buffer, signatureHeader?: string): boolean {
  if (!signatureHeader || config.WHATSAPP_APP_SECRET === 'change-me') return false;
  const expected = `sha256=${crypto.createHmac('sha256', config.WHATSAPP_APP_SECRET).update(rawBody).digest('hex')}`;
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signatureHeader);
  if (expectedBuffer.length !== signatureBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
}

export type WhatsAppSendTextInput = {
  to: string;
  body: string;
};

export type WhatsAppSendDocumentInput = {
  to: string;
  documentUrl?: string;
  mediaId?: string;
  filename: string;
  caption?: string;
};

export type WhatsAppInteractiveListInput = {
  to: string;
  header?: string;
  body: string;
  footer?: string;
  button: string;
  sections: Array<{ title?: string; rows: Array<{ id: string; title: string; description?: string }> }>;
};

async function sendWhatsAppMessage(body: Record<string, unknown>): Promise<{ providerMessageId?: string }> {
  if (!config.WHATSAPP_ACCESS_TOKEN || !config.WHATSAPP_PHONE_NUMBER_ID) {
    throw new Error('WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are required to send WhatsApp messages');
  }

  const response = await fetch(`https://graph.facebook.com/v20.0/${config.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    signal: timeoutSignal(WHATSAPP_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${config.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...body })
  });

  if (!response.ok) {
    throw new Error(`WhatsApp send failed: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as { messages?: Array<{ id: string }> };
  return { providerMessageId: data.messages?.[0]?.id };
}

export async function sendWhatsAppText(input: WhatsAppSendTextInput): Promise<{ providerMessageId?: string }> {
  return sendWhatsAppMessage({
    to: input.to,
    type: 'text',
    text: { body: input.body }
  });
}

export async function sendWhatsAppInteractiveList(input: WhatsAppInteractiveListInput): Promise<{ providerMessageId?: string }> {
  return sendWhatsAppMessage({
    to: input.to,
    type: 'interactive',
    interactive: {
      type: 'list',
      ...(input.header ? { header: { type: 'text', text: input.header } } : {}),
      body: { text: input.body },
      ...(input.footer ? { footer: { text: input.footer } } : {}),
      action: {
        button: input.button,
        sections: input.sections
      }
    }
  });
}

export async function sendWhatsAppDocument(input: WhatsAppSendDocumentInput): Promise<{ providerMessageId?: string }> {
  if (!input.mediaId && !input.documentUrl) {
    throw new Error('WhatsApp document requires mediaId or documentUrl');
  }

  const document =
    input.mediaId
      ? { id: input.mediaId, filename: input.filename, caption: input.caption }
      : { link: input.documentUrl, filename: input.filename, caption: input.caption };

  return sendWhatsAppMessage({
    to: input.to,
    type: 'document',
    document
  });
}

export async function uploadWhatsAppMedia(input: { buffer: Buffer; mimeType: string; filename: string }): Promise<{ mediaId: string }> {
  if (!config.WHATSAPP_ACCESS_TOKEN || !config.WHATSAPP_PHONE_NUMBER_ID) {
    throw new Error('WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are required to upload WhatsApp media');
  }

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('file', new Blob([new Uint8Array(input.buffer)], { type: input.mimeType }), input.filename);

  const response = await fetch(`https://graph.facebook.com/v20.0/${config.WHATSAPP_PHONE_NUMBER_ID}/media`, {
    method: 'POST',
    signal: timeoutSignal(WHATSAPP_TIMEOUT_MS),
    headers: { Authorization: `Bearer ${config.WHATSAPP_ACCESS_TOKEN}` },
    body: form
  });

  if (!response.ok) {
    throw new Error(`WhatsApp media upload failed: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as { id?: string };
  if (!data.id) throw new Error('WhatsApp media upload returned no media id');
  return { mediaId: data.id };
}

export async function getWhatsAppMedia(mediaId: string): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
  if (!config.WHATSAPP_ACCESS_TOKEN) {
    throw new Error('WHATSAPP_ACCESS_TOKEN is required to download WhatsApp media');
  }

  const metadataResponse = await fetch(`https://graph.facebook.com/v20.0/${mediaId}`, {
    signal: timeoutSignal(WHATSAPP_TIMEOUT_MS),
    headers: { Authorization: `Bearer ${config.WHATSAPP_ACCESS_TOKEN}` }
  });

  if (!metadataResponse.ok) {
    throw new Error(`WhatsApp media metadata failed: ${metadataResponse.status} ${await metadataResponse.text()}`);
  }

  const metadata = (await metadataResponse.json()) as { url?: string; mime_type?: string; file_size?: number; sha256?: string };
  validateInboundMediaMetadata({
    url: metadata.url,
    mimeType: metadata.mime_type,
    fileSize: metadata.file_size
  });
  const mediaResponse = await fetch(metadata.url!, {
    signal: timeoutSignal(WHATSAPP_TIMEOUT_MS),
    headers: { Authorization: `Bearer ${config.WHATSAPP_ACCESS_TOKEN}` }
  });

  if (!mediaResponse.ok) {
    throw new Error(`WhatsApp media download failed: ${mediaResponse.status} ${await mediaResponse.text()}`);
  }

  const arrayBuffer = await mediaResponse.arrayBuffer();
  const mimeType = metadata.mime_type ?? mediaResponse.headers.get('content-type') ?? 'application/octet-stream';
  if (arrayBuffer.byteLength > MAX_INBOUND_MEDIA_BYTES) {
    throw new Error('WhatsApp media exceeds the 25 MB limit');
  }
  if (!ALLOWED_INBOUND_MEDIA_TYPES.has(mimeType.toLowerCase())) {
    throw new Error('WhatsApp media type is not supported');
  }
  const extension = mimeType.includes('pdf') ? 'pdf' : mimeType.includes('image') ? 'jpg' : mimeType.includes('audio') ? 'ogg' : 'bin';

  return {
    buffer: Buffer.from(arrayBuffer),
    mimeType,
    filename: `whatsapp-${mediaId}.${extension}`
  };
}
export async function transcribeWhatsAppAudio(buffer: Buffer, mimeType: string): Promise<string> {
  if (!config.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required to transcribe WhatsApp audio');
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buffer)], { type: mimeType }), 'whatsapp-audio.ogg');
  form.append('model', config.OPENAI_TRANSCRIBE_MODEL);
  form.append('language', 'es');
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    signal: timeoutSignal(TRANSCRIBE_TIMEOUT_MS),
    headers: { Authorization: 'Bearer ' + config.OPENAI_API_KEY },
    body: form
  });
  if (!response.ok) throw new Error('Audio transcription failed: ' + response.status + ' ' + await response.text());
  const data = await response.json() as { text?: string };
  if (!data.text?.trim()) throw new Error('Audio transcription returned no text');
  return data.text.trim();
}
