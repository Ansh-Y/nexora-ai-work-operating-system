import { BadRequestException, NotFoundException } from '@nestjs/common';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileValidator } from './file-validator';
import { LocalStorageProvider } from './local-storage.provider';
import { S3StorageProvider } from './s3-storage.provider';

function mockConfig(env: Record<string, string>): any {
  return {
    get: (key: string, fallback?: unknown) => env[key] ?? fallback,
  };
}

describe('Storage security & validation', () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  describe('FileValidator', () => {
    it('validates authentic audio formats with correct magic signatures', () => {
      // MP3 ID3 header
      const mp3Buffer = Buffer.from('ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000\u0000fixture mp3 content');
      const mp3Result = FileValidator.validateAudio({
        buffer: mp3Buffer,
        originalname: 'meeting-recording.mp3',
        size: mp3Buffer.length,
      });
      expect(mp3Result.mimeType).toBe('audio/mpeg');
      expect(mp3Result.fileName).toBe('meeting-recording.mp3');
      expect(mp3Result.sha256).toHaveLength(64);

      // WAV RIFF/WAVE header
      const wavBuffer = Buffer.concat([
        Buffer.from('RIFF'),
        Buffer.alloc(4),
        Buffer.from('WAVE'),
        Buffer.from('audio payload'),
      ]);
      const wavResult = FileValidator.validateAudio({
        buffer: wavBuffer,
        originalname: 'audio.wav',
        size: wavBuffer.length,
      });
      expect(wavResult.mimeType).toBe('audio/wav');
    });

    it('validates authentic document formats (PDF, Markdown, JSON, Text, CSV)', () => {
      // PDF %PDF- header
      const pdfBuffer = Buffer.from('%PDF-1.4 sample pdf content %%EOF');
      const pdfResult = FileValidator.validateDocument({
        buffer: pdfBuffer,
        originalname: 'project-specs.pdf',
        size: pdfBuffer.length,
      });
      expect(pdfResult.mimeType).toBe('application/pdf');

      // Markdown / Text UTF-8
      const mdBuffer = Buffer.from('# Architecture Document\nDetails here');
      const mdResult = FileValidator.validateDocument({
        buffer: mdBuffer,
        originalname: 'README.md',
        size: mdBuffer.length,
      });
      expect(mdResult.mimeType).toBe('text/markdown');

      // JSON UTF-8
      const jsonBuffer = Buffer.from(JSON.stringify({ status: 'healthy', count: 42 }));
      const jsonResult = FileValidator.validateDocument({
        buffer: jsonBuffer,
        originalname: 'config.json',
        size: jsonBuffer.length,
      });
      expect(jsonResult.mimeType).toBe('application/json');
    });

    it('rejects spoofed file extensions and malicious payloads', () => {
      // PDF header pretending to be an MP3
      const fakeMp3 = Buffer.from('%PDF-1.4 malicious fake audio');
      expect(() =>
        FileValidator.validateAudio({
          buffer: fakeMp3,
          originalname: 'exploit.mp3',
          size: fakeMp3.length,
        }),
      ).toThrow(BadRequestException);

      // Executable / shell script pretending to be a document
      const exeBuffer = Buffer.from('MZ\u0090\u0000\u0003\u0000\u0000\u0000DOS executable');
      expect(() =>
        FileValidator.validateDocument({
          buffer: exeBuffer,
          originalname: 'malware.exe',
          size: exeBuffer.length,
        }),
      ).toThrow(BadRequestException);
    });

    it('neutralizes path traversal attempts in original filenames', () => {
      const cleanName = FileValidator.normalizeFilename('../../../etc/passwd.pdf', 'document');
      expect(cleanName).not.toContain('..');
      expect(cleanName).not.toContain('/');
      expect(cleanName).toBe('etc_passwd.pdf');
    });
  });

  describe('LocalStorageProvider', () => {
    it('enforces tenant isolation and rejects directory traversal outside root', async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'nexora-local-storage-'));
      const provider = new LocalStorageProvider(
        mockConfig({
          STORAGE_LOCAL_DIR: tempDir,
          API_PUBLIC_URL: 'https://test.nexora.app',
          JWT_SECRET: 'test-secret-key-32-bytes-minimum',
        }),
      );

      const fileBuffer = Buffer.from('%PDF-1.4 confidential doc');
      const stored = await provider.upload(
        'tenant-alpha/docs/confidential.pdf',
        fileBuffer,
        'application/pdf',
        { originalFileName: 'confidential.pdf' },
      );

      expect(stored.key).toBe('tenant-alpha/docs/confidential.pdf');
      expect(await provider.exists('tenant-alpha/docs/confidential.pdf')).toBe(true);

      // Verification of file content on disk
      const onDisk = await readFile(join(tempDir, 'tenant-alpha/docs/confidential.pdf'));
      expect(onDisk).toEqual(fileBuffer);

      // Traversal attacks must be rejected with NotFoundException
      expect(() => provider.resolveKey('../../../etc/passwd')).toThrow(NotFoundException);
      expect(() => provider.resolveKey('tenant-alpha/../../outside.txt')).toThrow(NotFoundException);
      await expect(provider.delete('../../../etc/passwd')).rejects.toThrow(NotFoundException);
    });

    it('generates and verifies HMAC-SHA256 signed download tokens', async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'nexora-signed-urls-'));
      const secret = 'super-secret-hmac-key-for-nexora-storage-testing';
      const provider = new LocalStorageProvider(
        mockConfig({
          STORAGE_LOCAL_DIR: tempDir,
          API_PUBLIC_URL: 'http://localhost:4000',
          JWT_SECRET: secret,
        }),
      );

      const downloadUrl = await provider.generatePresignedDownloadUrl(
        'tenant-xyz/rec/test.mp3',
        60,
        'downloaded-audio.mp3',
      );

      expect(downloadUrl).toContain('/api/storage/signed-download?token=');

      // Extract token
      const url = new URL(downloadUrl);
      const token = url.searchParams.get('token')!;
      expect(token).toBeTruthy();

      // Valid token verification
      const verified = provider.verifySignedToken(token, 'download');
      expect(verified).not.toBeNull();
      expect(verified?.key).toBe('tenant-xyz/rec/test.mp3');
      expect(verified?.filename).toBe('downloaded-audio.mp3');

      // Verification with wrong action fails
      expect(provider.verifySignedToken(token, 'upload')).toBeNull();

      // Tampered token fails
      expect(provider.verifySignedToken('invalid-base64-token', 'download')).toBeNull();
    });
  });

  describe('S3StorageProvider SigV4 presigned URLs', () => {
    it('generates standard AWS SigV4 signed download and upload URLs without exposing credentials', async () => {
      const s3Provider = new S3StorageProvider(
        mockConfig({
          STORAGE_S3_BUCKET: 'nexora-private-vault',
          STORAGE_S3_REGION: 'us-east-1',
          STORAGE_S3_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
          STORAGE_S3_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        }),
      );

      const downloadUrl = await s3Provider.generatePresignedDownloadUrl(
        'org-123/documents/report.pdf',
        300,
        'final-report.pdf',
      );

      const parsedGet = new URL(downloadUrl);
      expect(parsedGet.origin).toBe('https://nexora-private-vault.s3.us-east-1.amazonaws.com');
      expect(parsedGet.pathname).toBe('/org-123/documents/report.pdf');
      expect(parsedGet.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
      expect(parsedGet.searchParams.get('X-Amz-Credential')).toContain('AKIAIOSFODNN7EXAMPLE');
      expect(parsedGet.searchParams.get('X-Amz-Credential')).toContain('/us-east-1/s3/aws4_request');
      expect(parsedGet.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
      expect(parsedGet.searchParams.get('X-Amz-Signature')).toHaveLength(64);
      // Secret access key must NEVER appear in the query string
      expect(downloadUrl).not.toContain('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');

      const uploadResult = await s3Provider.generatePresignedUploadUrl(
        'org-123/documents/new-upload.pdf',
        'application/pdf',
        600,
      );

      const parsedPut = new URL(uploadResult.url);
      expect(uploadResult.method).toBe('PUT');
      expect(parsedPut.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
      expect(parsedPut.searchParams.get('X-Amz-SignedHeaders')).toContain('host');
      expect(parsedPut.searchParams.get('X-Amz-SignedHeaders')).toContain('content-type');
      expect(uploadResult.headers?.['Content-Type']).toBe('application/pdf');
    });

    it('supports custom S3-compatible endpoints such as Cloudflare R2 and MinIO with force-path-style', async () => {
      const r2Provider = new S3StorageProvider(
        mockConfig({
          STORAGE_S3_BUCKET: 'nexora-cf-bucket',
          STORAGE_S3_REGION: 'auto',
          STORAGE_S3_ENDPOINT: 'https://test-account.r2.cloudflarestorage.com',
          STORAGE_S3_ACCESS_KEY_ID: 'r2-access-key-id',
          STORAGE_S3_SECRET_ACCESS_KEY: 'r2-secret-access-key',
          STORAGE_S3_FORCE_PATH_STYLE: 'true',
        }),
      );

      const signedUrl = await r2Provider.generatePresignedDownloadUrl('org-abc/audio/rec1.mp3', 120);
      const parsed = new URL(signedUrl);
      expect(parsed.origin).toBe('https://test-account.r2.cloudflarestorage.com');
      expect(parsed.pathname).toBe('/nexora-cf-bucket/org-abc/audio/rec1.mp3');
      expect(parsed.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    });
  });
});
