import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, stat, unlink } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';

export type ValidatedAudio = { buffer: Buffer; fileName: string; mimeType: string; sizeBytes: number; sha256: string };
export type MeetingUploadFile = { buffer: Buffer; originalname: string; size?: number };

const SIGNATURES = {
  mp3: { mimeType: 'audio/mpeg', extensions: ['.mp3'] },
  wav: { mimeType: 'audio/wav', extensions: ['.wav'] },
  m4a: { mimeType: 'audio/mp4', extensions: ['.m4a'] },
} as const;

@Injectable()
export class MeetingAudioStorageService {
  constructor(private config: ConfigService) {}

  get maxUploadBytes() {
    const configured = Number(this.config.get('MEETING_MAX_UPLOAD_BYTES', 25 * 1024 * 1024));
    return Number.isSafeInteger(configured) && configured > 0 ? Math.min(configured, 100 * 1024 * 1024) : 25 * 1024 * 1024;
  }

  validateUpload(file: MeetingUploadFile): ValidatedAudio {
    if (!file?.buffer?.length) throw new BadRequestException('Choose a non-empty audio file');
    if (file.buffer.length > this.maxUploadBytes) throw new BadRequestException(`Audio files must be ${Math.floor(this.maxUploadBytes / 1024 / 1024)} MB or smaller`);
    const extension = extname(file.originalname || '').toLowerCase();
    const signature = this.detect(file.buffer);
    if (!signature || !signature.extensions.some(candidate => candidate === extension)) throw new BadRequestException('The audio file type could not be verified. Upload an MP3, WAV, or M4A file.');
    const safeName = (file.originalname || `meeting-audio${extension}`).replace(/[\\/\u0000-\u001f]/g, '_').slice(-180);
    return { buffer: file.buffer, fileName: safeName, mimeType: signature.mimeType, sizeBytes: file.buffer.length, sha256: createHash('sha256').update(file.buffer).digest('hex') };
  }

  async store(organizationId: string, recordingId: string, audio: ValidatedAudio) {
    const extension = extname(audio.fileName).toLowerCase();
    const key = `${organizationId}/${recordingId}${extension}`;
    const target = this.resolveKey(key);
    await mkdir(resolve(target, '..'), { recursive: true, mode: 0o700 });
    const handle = await open(target, 'wx', 0o600);
    try { await handle.writeFile(audio.buffer); } finally { await handle.close(); }
    return key;
  }

  async read(organizationId: string, storageKey: string) {
    const target = this.resolveTenantKey(organizationId, storageKey);
    try { return await readFile(target); } catch { throw new NotFoundException('Recording file not found'); }
  }

  async stream(organizationId: string, storageKey: string): Promise<Readable> {
    const target = this.resolveTenantKey(organizationId, storageKey);
    try { await stat(target); } catch { throw new NotFoundException('Recording file not found'); }
    return createReadStream(target);
  }

  async remove(organizationId: string, storageKey: string) {
    const target = this.resolveTenantKey(organizationId, storageKey);
    try { await unlink(target); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }

  private resolveTenantKey(organizationId: string, key: string) {
    if (!key.startsWith(`${organizationId}/`) || key.includes('..') || key.includes('\\')) throw new NotFoundException('Recording file not found');
    return this.resolveKey(key);
  }

  private resolveKey(key: string) {
    const root = resolve(this.config.get('MEETING_STORAGE_DIR') || resolve(process.cwd(), 'uploads/meetings'));
    const target = resolve(root, key);
    if (!target.startsWith(`${root}${sep}`)) throw new NotFoundException('Recording file not found');
    return target;
  }

  private detect(buffer: Buffer) {
    if (buffer.length >= 12 && buffer.toString('ascii', 0, 3) === 'ID3') return SIGNATURES.mp3;
    if (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return SIGNATURES.mp3;
    if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE') return SIGNATURES.wav;
    if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp' && ['M4A ', 'M4B '].includes(buffer.toString('ascii', 8, 12))) return SIGNATURES.m4a;
    return null;
  }
}
