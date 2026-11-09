import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { UploadFilePayload, ValidatedFile } from './storage.types';

export const ALLOWED_AUDIO_TYPES: Record<string, { mimeType: string; extensions: string[] }> = {
  mp3: { mimeType: 'audio/mpeg', extensions: ['.mp3'] },
  wav: { mimeType: 'audio/wav', extensions: ['.wav'] },
  m4a: { mimeType: 'audio/mp4', extensions: ['.m4a'] },
};

export const ALLOWED_DOCUMENT_TYPES: Record<string, { mimeType: string; extensions: string[] }> = {
  pdf: { mimeType: 'application/pdf', extensions: ['.pdf'] },
  txt: { mimeType: 'text/plain', extensions: ['.txt', '.text'] },
  md: { mimeType: 'text/markdown', extensions: ['.md', '.markdown'] },
  json: { mimeType: 'application/json', extensions: ['.json'] },
  csv: { mimeType: 'text/csv', extensions: ['.csv'] },
};

export class FileValidator {
  static normalizeFilename(originalName: string, fallbackBase = 'file'): string {
    const raw = (originalName || fallbackBase).trim();
    const ext = extname(raw).toLowerCase().replace(/[^a-z0-9.]/g, '');
    const base = raw.slice(0, raw.length - ext.length);
    const safeBase = base
      .replace(/\.{2,}/g, '_')
      .replace(/[\\/!@#$%^&*()+=[\]{}|;:",<>?`~]/g, '_')
      .replace(/[\s\S]/g, (c) => (c.charCodeAt(0) < 32 ? '_' : c))
      .replace(/_{2,}/g, '_')
      .replace(/^_+|_+$/g, '') || fallbackBase;
    const combined = `${safeBase}${ext}`;
    return combined.slice(-180);
  }

  static validateAudio(file: UploadFilePayload, maxBytes = 25 * 1024 * 1024): ValidatedFile {
    if (!file?.buffer?.length) throw new BadRequestException('Choose a non-empty audio file.');
    if (file.buffer.length > maxBytes) {
      throw new BadRequestException(`Audio file exceeds size limit of ${Math.floor(maxBytes / 1024 / 1024)} MB.`);
    }

    const ext = extname(file.originalname || '').toLowerCase();
    const detected = this.detectAudio(file.buffer);
    if (!detected || !detected.extensions.includes(ext)) {
      throw new BadRequestException('The audio file type could not be verified. Allowed types: MP3, WAV, M4A.');
    }

    const safeName = this.normalizeFilename(file.originalname, 'meeting-audio');
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');

    return {
      buffer: file.buffer,
      fileName: safeName,
      mimeType: detected.mimeType,
      sizeBytes: file.buffer.length,
      sha256,
    };
  }

  static validateDocument(file: UploadFilePayload, maxBytes = 15 * 1024 * 1024): ValidatedFile {
    if (!file?.buffer?.length) throw new BadRequestException('Choose a non-empty document file.');
    if (file.buffer.length > maxBytes) {
      throw new BadRequestException(`Document exceeds size limit of ${Math.floor(maxBytes / 1024 / 1024)} MB.`);
    }

    const ext = extname(file.originalname || '').toLowerCase();
    const detected = this.detectDocument(file.buffer, ext);
    if (!detected || !detected.extensions.includes(ext)) {
      throw new BadRequestException('The document type could not be verified. Allowed formats: PDF, TXT, Markdown, JSON, CSV.');
    }

    const safeName = this.normalizeFilename(file.originalname, 'workspace-document');
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');

    return {
      buffer: file.buffer,
      fileName: safeName,
      mimeType: detected.mimeType,
      sizeBytes: file.buffer.length,
      sha256,
    };
  }

  static detectAudio(buffer: Buffer) {
    if (buffer.length >= 12 && buffer.toString('ascii', 0, 3) === 'ID3') return ALLOWED_AUDIO_TYPES.mp3;
    if (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return ALLOWED_AUDIO_TYPES.mp3;
    if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE') return ALLOWED_AUDIO_TYPES.wav;
    if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp' && ['M4A ', 'M4B '].includes(buffer.toString('ascii', 8, 12))) return ALLOWED_AUDIO_TYPES.m4a;
    return null;
  }

  static detectDocument(buffer: Buffer, ext: string) {
    // PDF Magic Number: %PDF-
    if (buffer.length >= 5 && buffer.toString('ascii', 0, 5) === '%PDF-') {
      return ALLOWED_DOCUMENT_TYPES.pdf;
    }

    // JSON Validation
    if (ext === '.json') {
      try {
        const text = buffer.toString('utf8');
        JSON.parse(text);
        return ALLOWED_DOCUMENT_TYPES.json;
      } catch {
        return null;
      }
    }

    // Markdown or Text or CSV
    if (['.txt', '.text', '.md', '.markdown', '.csv'].includes(ext)) {
      if (this.isValidUtf8(buffer)) {
        if (ext === '.md' || ext === '.markdown') return ALLOWED_DOCUMENT_TYPES.md;
        if (ext === '.csv') return ALLOWED_DOCUMENT_TYPES.csv;
        return ALLOWED_DOCUMENT_TYPES.txt;
      }
    }

    return null;
  }

  private static isValidUtf8(buffer: Buffer): boolean {
    // Check if buffer contains null bytes (binary indicator)
    if (buffer.includes(0x00)) return false;
    try {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      return typeof decoded === 'string';
    } catch {
      return false;
    }
  }
}
