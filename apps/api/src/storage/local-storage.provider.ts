import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { ObjectMetadata, PresignedUploadResult, StorageProvider, StoredObjectResult } from './storage.types';

@Injectable()
export class LocalStorageProvider implements StorageProvider {
  readonly name = 'local';

  constructor(private config: ConfigService) {}

  private get rootPath(): string {
    const configured = this.config.get<string>('STORAGE_LOCAL_DIR') || this.config.get<string>('MEETING_STORAGE_DIR');
    return resolve(configured || resolve(process.cwd(), 'var/storage'));
  }

  private get secretKey(): string {
    return this.config.get<string>('JWT_SECRET') || 'nexora-local-storage-signing-secret-default';
  }

  private get publicBaseUrl(): string {
    return (this.config.get<string>('API_PUBLIC_URL') || 'http://localhost:4000').replace(/\/+$/, '');
  }

  resolveKey(key: string): string {
    if (!key || typeof key !== 'string') throw new NotFoundException('Storage file not found');
    if (key.includes('..') || key.includes('\\') || key.includes('\0')) {
      throw new NotFoundException('Storage file not found');
    }
    const root = this.rootPath;
    const target = resolve(root, key);
    if (!target.startsWith(`${root}${sep}`) && target !== root) {
      throw new NotFoundException('Storage file not found');
    }
    return target;
  }

  async upload(key: string, buffer: Buffer, mimeType: string, metadata?: Record<string, string>): Promise<StoredObjectResult> {
    const target = this.resolveKey(key);
    await mkdir(resolve(target, '..'), { recursive: true, mode: 0o700 });

    const handle = await open(target, 'w', 0o600);
    try {
      await handle.writeFile(buffer);
    } finally {
      await handle.close();
    }

    if (metadata && Object.keys(metadata).length) {
      const metaTarget = `${target}.meta.json`;
      await writeFile(metaTarget, JSON.stringify({ mimeType, metadata }), { mode: 0o600 }).catch(() => undefined);
    }

    const sha256 = createHash('sha256').update(buffer).digest('hex');
    return {
      key,
      sizeBytes: buffer.length,
      sha256,
      etag: `"${sha256}"`,
    };
  }

  async download(key: string): Promise<Buffer> {
    const target = this.resolveKey(key);
    try {
      return await readFile(target);
    } catch {
      throw new NotFoundException('Storage file not found');
    }
  }

  async stream(key: string): Promise<Readable> {
    const target = this.resolveKey(key);
    try {
      await stat(target);
    } catch {
      throw new NotFoundException('Storage file not found');
    }
    return createReadStream(target);
  }

  async delete(key: string): Promise<void> {
    const target = this.resolveKey(key);
    try {
      await unlink(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    try {
      await unlink(`${target}.meta.json`);
    } catch {
      // ignore missing metadata file
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const target = this.resolveKey(key);
      await stat(target);
      return true;
    } catch {
      return false;
    }
  }

  async getMetadata(key: string): Promise<ObjectMetadata | null> {
    try {
      const target = this.resolveKey(key);
      const s = await stat(target);
      let mimeType = 'application/octet-stream';
      let customMetadata: Record<string, string> | undefined;

      try {
        const rawMeta = await readFile(`${target}.meta.json`, 'utf8');
        const parsed = JSON.parse(rawMeta);
        if (parsed.mimeType) mimeType = parsed.mimeType;
        if (parsed.metadata) customMetadata = parsed.metadata;
      } catch {
        const ext = extname(target).toLowerCase();
        if (ext === '.mp3') mimeType = 'audio/mpeg';
        else if (ext === '.wav') mimeType = 'audio/wav';
        else if (ext === '.m4a') mimeType = 'audio/mp4';
        else if (ext === '.pdf') mimeType = 'application/pdf';
        else if (ext === '.json') mimeType = 'application/json';
        else if (ext === '.txt') mimeType = 'text/plain';
        else if (ext === '.md') mimeType = 'text/markdown';
        else if (ext === '.csv') mimeType = 'text/csv';
      }

      return {
        sizeBytes: s.size,
        mimeType,
        updatedAt: s.mtime,
        customMetadata,
      };
    } catch {
      return null;
    }
  }

  async generatePresignedDownloadUrl(key: string, expiresInSeconds = 900, downloadFilename?: string): Promise<string> {
    const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const payload = JSON.stringify({ key, action: 'download', exp, filename: downloadFilename || undefined });
    const signature = createHmac('sha256', this.secretKey).update(payload).digest('hex');
    const token = Buffer.from(JSON.stringify({ payload, signature })).toString('base64url');
    return `${this.publicBaseUrl}/api/storage/signed-download?token=${token}`;
  }

  async generatePresignedUploadUrl(key: string, mimeType: string, expiresInSeconds = 900): Promise<PresignedUploadResult> {
    const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const payload = JSON.stringify({ key, action: 'upload', mimeType, exp });
    const signature = createHmac('sha256', this.secretKey).update(payload).digest('hex');
    const token = Buffer.from(JSON.stringify({ payload, signature })).toString('base64url');
    return {
      url: `${this.publicBaseUrl}/api/storage/signed-upload?token=${token}`,
      method: 'PUT',
      headers: { 'Content-Type': mimeType },
      expiresInSeconds,
    };
  }

  verifySignedToken(tokenString: string, expectedAction: 'download' | 'upload'): { key: string; filename?: string; mimeType?: string } | null {
    try {
      const decoded = JSON.parse(Buffer.from(tokenString, 'base64url').toString('utf8'));
      if (!decoded.payload || !decoded.signature) return null;
      const expectedSig = createHmac('sha256', this.secretKey).update(decoded.payload).digest('hex');
      const sigBuf = Buffer.from(decoded.signature, 'utf8');
      const expBuf = Buffer.from(expectedSig, 'utf8');
      if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;

      const data = JSON.parse(decoded.payload);
      if (data.action !== expectedAction) return null;
      if (typeof data.exp !== 'number' || data.exp < Math.floor(Date.now() / 1000)) return null;
      return { key: data.key, filename: data.filename, mimeType: data.mimeType };
    } catch {
      return null;
    }
  }
}
