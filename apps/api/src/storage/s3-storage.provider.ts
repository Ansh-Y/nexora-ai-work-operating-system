import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { ObjectMetadata, PresignedUploadResult, StorageProvider, StoredObjectResult } from './storage.types';

@Injectable()
export class S3StorageProvider implements StorageProvider {
  readonly name = 's3';

  constructor(private config: ConfigService) {}

  get bucket(): string {
    return this.config.get<string>('STORAGE_S3_BUCKET') || this.config.get<string>('S3_BUCKET_NAME') || '';
  }

  get region(): string {
    return this.config.get<string>('STORAGE_S3_REGION') || this.config.get<string>('AWS_REGION') || 'us-east-1';
  }

  get accessKeyId(): string {
    return this.config.get<string>('STORAGE_S3_ACCESS_KEY_ID') || this.config.get<string>('AWS_ACCESS_KEY_ID') || '';
  }

  get secretAccessKey(): string {
    return this.config.get<string>('STORAGE_S3_SECRET_ACCESS_KEY') || this.config.get<string>('AWS_SECRET_ACCESS_KEY') || '';
  }

  get endpoint(): string {
    const raw = this.config.get<string>('STORAGE_S3_ENDPOINT');
    if (raw) return raw.replace(/\/+$/, '');
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com`;
  }

  get forcePathStyle(): boolean {
    const val = this.config.get<string>('STORAGE_S3_FORCE_PATH_STYLE');
    return val === 'true' || val === '1';
  }

  isConfigured(): boolean {
    return Boolean(this.bucket && this.accessKeyId && this.secretAccessKey);
  }

  private requireConfig() {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('S3 storage is selected but credentials or bucket name are not configured.');
    }
  }

  private getUrl(key: string): URL {
    const sanitizedKey = key.replace(/^\/+/, '');
    const customEndpoint = this.config.get<string>('STORAGE_S3_ENDPOINT');
    if (customEndpoint) {
      const base = customEndpoint.replace(/\/+$/, '');
      if (this.forcePathStyle) {
        return new URL(`${base}/${this.bucket}/${sanitizedKey}`);
      }
      return new URL(`${base}/${sanitizedKey}`);
    }
    return new URL(`https://${this.bucket}.s3.${this.region}.amazonaws.com/${sanitizedKey}`);
  }

  private getSignatureKey(key: string, dateStamp: string, regionName: string, serviceName: string): Buffer {
    const kDate = createHmac('sha256', `AWS4${key}`).update(dateStamp).digest();
    const kRegion = createHmac('sha256', kDate).update(regionName).digest();
    const kService = createHmac('sha256', kRegion).update(serviceName).digest();
    return createHmac('sha256', kService).update('aws4_request').digest();
  }

  private signRequest(method: string, url: URL, headers: Record<string, string>, payloadSha256: string, amzDate: string): Record<string, string> {
    const dateStamp = amzDate.slice(0, 8);
    const host = url.host;

    const requestHeaders: Record<string, string> = {
      ...headers,
      host,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadSha256,
    };

    const sortedHeaderKeys = Object.keys(requestHeaders)
      .map(k => k.toLowerCase())
      .sort();

    const canonicalHeaders = sortedHeaderKeys
      .map(k => `${k}:${requestHeaders[k].trim()}\n`)
      .join('');

    const signedHeaders = sortedHeaderKeys.join(';');

    // Canonical query string
    const queryEntries: [string, string][] = [];
    url.searchParams.forEach((v, k) => queryEntries.push([k, v]));
    queryEntries.sort((a, b) => a[0].localeCompare(b[0]));
    const canonicalQueryString = queryEntries
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');

    const canonicalRequest = [
      method.toUpperCase(),
      url.pathname,
      canonicalQueryString,
      canonicalHeaders,
      signedHeaders,
      payloadSha256,
    ].join('\n');

    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');

    const signingKey = this.getSignatureKey(this.secretAccessKey, dateStamp, this.region, 's3');
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

    const authorizationHeader = `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return {
      ...requestHeaders,
      Authorization: authorizationHeader,
    };
  }

  async upload(key: string, buffer: Buffer, mimeType: string, metadata?: Record<string, string>): Promise<StoredObjectResult> {
    this.requireConfig();
    const url = this.getUrl(key);
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');

    const extraHeaders: Record<string, string> = {
      'content-type': mimeType,
      'content-length': String(buffer.length),
    };

    if (metadata) {
      for (const [mk, mv] of Object.entries(metadata)) {
        extraHeaders[`x-amz-meta-${mk.toLowerCase()}`] = String(mv);
      }
    }

    const signedHeaders = this.signRequest('PUT', url, extraHeaders, sha256, amzDate);

    const res = await fetch(url.toString(), {
      method: 'PUT',
      headers: signedHeaders,
      body: new Uint8Array(buffer),
    });

    if (!res.ok) {
      throw new Error(`S3 upload failed with status ${res.status}: ${await res.text()}`);
    }

    const etag = res.headers.get('etag') || `"${sha256}"`;
    return {
      key,
      sizeBytes: buffer.length,
      sha256,
      etag,
    };
  }

  async download(key: string): Promise<Buffer> {
    this.requireConfig();
    const url = this.getUrl(key);
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const emptySha256 = createHash('sha256').update('').digest('hex');
    const signedHeaders = this.signRequest('GET', url, {}, emptySha256, amzDate);

    const res = await fetch(url.toString(), { method: 'GET', headers: signedHeaders });
    if (res.status === 404) throw new NotFoundException('Storage file not found');
    if (!res.ok) throw new Error(`S3 download failed with status ${res.status}`);

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async stream(key: string): Promise<Readable> {
    this.requireConfig();
    const url = this.getUrl(key);
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const emptySha256 = createHash('sha256').update('').digest('hex');
    const signedHeaders = this.signRequest('GET', url, {}, emptySha256, amzDate);

    const res = await fetch(url.toString(), { method: 'GET', headers: signedHeaders });
    if (res.status === 404) throw new NotFoundException('Storage file not found');
    if (!res.ok || !res.body) throw new Error(`S3 stream request failed with status ${res.status}`);

    return Readable.fromWeb(res.body as any);
  }

  async delete(key: string): Promise<void> {
    this.requireConfig();
    const url = this.getUrl(key);
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const emptySha256 = createHash('sha256').update('').digest('hex');
    const signedHeaders = this.signRequest('DELETE', url, {}, emptySha256, amzDate);

    const res = await fetch(url.toString(), { method: 'DELETE', headers: signedHeaders });
    if (!res.ok && res.status !== 404) {
      throw new Error(`S3 delete failed with status ${res.status}`);
    }
  }

  async exists(key: string): Promise<boolean> {
    if (!this.isConfigured()) return false;
    try {
      const url = this.getUrl(key);
      const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
      const emptySha256 = createHash('sha256').update('').digest('hex');
      const signedHeaders = this.signRequest('HEAD', url, {}, emptySha256, amzDate);
      const res = await fetch(url.toString(), { method: 'HEAD', headers: signedHeaders });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  async getMetadata(key: string): Promise<ObjectMetadata | null> {
    this.requireConfig();
    try {
      const url = this.getUrl(key);
      const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
      const emptySha256 = createHash('sha256').update('').digest('hex');
      const signedHeaders = this.signRequest('HEAD', url, {}, emptySha256, amzDate);
      const res = await fetch(url.toString(), { method: 'HEAD', headers: signedHeaders });
      if (res.status === 404) return null;
      if (!res.ok) return null;

      const sizeBytes = Number(res.headers.get('content-length') || 0);
      const mimeType = res.headers.get('content-type') || 'application/octet-stream';
      const lastModified = res.headers.get('last-modified');

      const customMetadata: Record<string, string> = {};
      res.headers.forEach((val, k) => {
        if (k.toLowerCase().startsWith('x-amz-meta-')) {
          customMetadata[k.slice(11)] = val;
        }
      });

      return {
        sizeBytes,
        mimeType,
        updatedAt: lastModified ? new Date(lastModified) : undefined,
        customMetadata: Object.keys(customMetadata).length ? customMetadata : undefined,
      };
    } catch {
      return null;
    }
  }

  async generatePresignedDownloadUrl(key: string, expiresInSeconds = 900, downloadFilename?: string): Promise<string> {
    this.requireConfig();
    const url = this.getUrl(key);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;

    url.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
    url.searchParams.set('X-Amz-Credential', `${this.accessKeyId}/${credentialScope}`);
    url.searchParams.set('X-Amz-Date', amzDate);
    url.searchParams.set('X-Amz-Expires', String(expiresInSeconds));
    url.searchParams.set('X-Amz-SignedHeaders', 'host');

    if (downloadFilename) {
      url.searchParams.set('response-content-disposition', `attachment; filename="${downloadFilename.replace(/"/g, '')}"`);
    }

    const host = url.host;
    const canonicalHeaders = `host:${host}\n`;
    const signedHeaders = 'host';

    // Canonical query string
    const queryEntries: [string, string][] = [];
    url.searchParams.forEach((v, k) => queryEntries.push([k, v]));
    queryEntries.sort((a, b) => a[0].localeCompare(b[0]));
    const canonicalQueryString = queryEntries
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');

    const canonicalRequest = [
      'GET',
      url.pathname,
      canonicalQueryString,
      canonicalHeaders,
      signedHeaders,
      'UNSIGNED-PAYLOAD',
    ].join('\n');

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');

    const signingKey = this.getSignatureKey(this.secretAccessKey, dateStamp, this.region, 's3');
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

    url.searchParams.set('X-Amz-Signature', signature);
    return url.toString();
  }

  async generatePresignedUploadUrl(key: string, mimeType: string, expiresInSeconds = 900): Promise<PresignedUploadResult> {
    this.requireConfig();
    const url = this.getUrl(key);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;

    url.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
    url.searchParams.set('X-Amz-Credential', `${this.accessKeyId}/${credentialScope}`);
    url.searchParams.set('X-Amz-Date', amzDate);
    url.searchParams.set('X-Amz-Expires', String(expiresInSeconds));
    url.searchParams.set('X-Amz-SignedHeaders', 'content-type;host');

    const host = url.host;
    const canonicalHeaders = `content-type:${mimeType}\nhost:${host}\n`;
    const signedHeaders = 'content-type;host';

    const queryEntries: [string, string][] = [];
    url.searchParams.forEach((v, k) => queryEntries.push([k, v]));
    queryEntries.sort((a, b) => a[0].localeCompare(b[0]));
    const canonicalQueryString = queryEntries
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');

    const canonicalRequest = [
      'PUT',
      url.pathname,
      canonicalQueryString,
      canonicalHeaders,
      signedHeaders,
      'UNSIGNED-PAYLOAD',
    ].join('\n');

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');

    const signingKey = this.getSignatureKey(this.secretAccessKey, dateStamp, this.region, 's3');
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

    url.searchParams.set('X-Amz-Signature', signature);

    return {
      url: url.toString(),
      method: 'PUT',
      headers: { 'Content-Type': mimeType },
      expiresInSeconds,
    };
  }
}
