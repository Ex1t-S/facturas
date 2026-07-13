import crypto from 'node:crypto';
import { config } from '../config.js';

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
  documentUrl: string;
  filename: string;
  caption?: string;
};

async function sendWhatsAppMessage(body: Record<string, unknown>): Promise<{ providerMessageId?: string }> {
  if (!config.WHATSAPP_ACCESS_TOKEN || !config.WHATSAPP_PHONE_NUMBER_ID) {
    return {};
  }

  const response = await fetch(`https://graph.facebook.com/v20.0/${config.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
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

export async function sendWhatsAppDocument(input: WhatsAppSendDocumentInput): Promise<{ providerMessageId?: string }> {
  return sendWhatsAppMessage({
    to: input.to,
    type: 'document',
    document: {
      link: input.documentUrl,
      filename: input.filename,
      caption: input.caption
    }
  });
}

export async function getWhatsAppMedia(mediaId: string): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
  if (!config.WHATSAPP_ACCESS_TOKEN) {
    throw new Error('WHATSAPP_ACCESS_TOKEN is required to download WhatsApp media');
  }

  const metadataResponse = await fetch(`https://graph.facebook.com/v20.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${config.WHATSAPP_ACCESS_TOKEN}` }
  });

  if (!metadataResponse.ok) {
    throw new Error(`WhatsApp media metadata failed: ${metadataResponse.status} ${await metadataResponse.text()}`);
  }

  const metadata = (await metadataResponse.json()) as { url: string; mime_type?: string; file_size?: number; sha256?: string };
  const mediaResponse = await fetch(metadata.url, {
    headers: { Authorization: `Bearer ${config.WHATSAPP_ACCESS_TOKEN}` }
  });

  if (!mediaResponse.ok) {
    throw new Error(`WhatsApp media download failed: ${mediaResponse.status} ${await mediaResponse.text()}`);
  }

  const arrayBuffer = await mediaResponse.arrayBuffer();
  const mimeType = metadata.mime_type ?? mediaResponse.headers.get('content-type') ?? 'application/octet-stream';
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
    headers: { Authorization: 'Bearer ' + config.OPENAI_API_KEY },
    body: form
  });
  if (!response.ok) throw new Error('Audio transcription failed: ' + response.status + ' ' + await response.text());
  const data = await response.json() as { text?: string };
  if (!data.text?.trim()) throw new Error('Audio transcription returned no text');
  return data.text.trim();
}
