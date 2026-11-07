import type { Readable } from 'node:stream';

export type StoredObjectResult = {
  key: string;
  sizeBytes: number;
  sha256: string;
  etag?: string;
};

export type ObjectMetadata = {
  sizeBytes: number;
  mimeType: string;
  updatedAt?: Date;
  customMetadata?: Record<string, string>;
};

export type PresignedUploadResult = {
  url: string;
  method: string;
  headers?: Record<string, string>;
  expiresInSeconds: number;
};

export interface StorageProvider {
  readonly name: string;
  upload(key: string, buffer: Buffer, mimeType: string, metadata?: Record<string, string>): Promise<StoredObjectResult>;
  download(key: string): Promise<Buffer>;
  stream(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  getMetadata(key: string): Promise<ObjectMetadata | null>;
  generatePresignedDownloadUrl(key: string, expiresInSeconds?: number, downloadFilename?: string): Promise<string>;
  generatePresignedUploadUrl(key: string, mimeType: string, expiresInSeconds?: number): Promise<PresignedUploadResult>;
}

export type ValidatedFile = {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
};

export type UploadFilePayload = {
  buffer: Buffer;
  originalname: string;
  size?: number;
  mimetype?: string;
};
