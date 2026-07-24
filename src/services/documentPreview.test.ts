import { describe, expect, it } from 'vitest';
import { isAudioMime, isImageMime, isPdfMime } from './documentPreview.js';

describe('document preview media detection', () => {
  it('recognizes audio files for inline playback', () => {
    expect(isAudioMime('audio/ogg; codecs=opus', 'mensaje.ogg')).toBe(true);
    expect(isAudioMime('application/octet-stream', 'mensaje.webm')).toBe(true);
    expect(isAudioMime('application/pdf', 'documento.pdf')).toBe(false);
  });

  it('keeps existing PDF and image detection', () => {
    expect(isPdfMime('application/pdf', 'documento.pdf')).toBe(true);
    expect(isImageMime('image/jpeg', 'foto.jpg')).toBe(true);
  });
});
