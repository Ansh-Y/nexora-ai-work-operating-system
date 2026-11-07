import { BadRequestException, NotFoundException } from '@nestjs/common';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MeetingAudioStorageService } from './meeting-audio-storage.service';

describe('private meeting audio storage', () => {
  let root: string | undefined;
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = undefined; });

  it('validates content signatures and stores files outside public paths with tenant-scoped keys', async () => {
    root = await mkdtemp(join(tmpdir(), 'nexora-audio-'));
    const service = new MeetingAudioStorageService({ get: (key: string, fallback?: unknown) => key === 'MEETING_STORAGE_DIR' ? root : fallback } as never);
    const buffer = Buffer.from('ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000\u0000fixture');
    const audio = service.validateUpload({ buffer, originalname: '../private.mp3' });
    expect(audio.fileName).toBe('.._private.mp3');
    expect(audio.mimeType).toBe('audio/mpeg');
    const key = await service.store('tenant-a', 'recording-1', audio);
    expect(key).toBe('tenant-a/recording-1.mp3');
    expect(await readFile(join(root, key))).toEqual(buffer);
    await expect(service.read('tenant-b', key)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.read('tenant-a', '../secret.mp3')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects spoofed extensions and invalid signatures', () => {
    const service = new MeetingAudioStorageService({ get: (_key: string, fallback?: unknown) => fallback } as never);
    expect(() => service.validateUpload({ buffer: Buffer.from('ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000\u0000'), originalname: 'audio.wav' })).toThrow(BadRequestException);
    expect(() => service.validateUpload({ buffer: Buffer.from('arbitrary data'), originalname: 'audio.mp3' })).toThrow(BadRequestException);
  });
});
