import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LocalStorageProvider } from './local-storage.provider';
import { S3StorageProvider } from './s3-storage.provider';
import { StorageProvider } from './storage.types';

@Injectable()
export class StorageProviderFactory {
  private readonly logger = new Logger(StorageProviderFactory.name);

  constructor(
    private config: ConfigService,
    private localProvider: LocalStorageProvider,
    private s3Provider: S3StorageProvider,
  ) {}

  getProvider(providerName?: string): StorageProvider {
    const requested = providerName || this.config.get<string>('STORAGE_PROVIDER', 'local');
    if (requested.toLowerCase() === 's3') {
      if (!this.s3Provider.isConfigured()) {
        this.logger.warn('S3 storage requested but bucket or credentials not configured; falling back to local storage provider');
        return this.localProvider;
      }
      return this.s3Provider;
    }
    return this.localProvider;
  }

  getActiveProviderName(): string {
    const requested = this.config.get<string>('STORAGE_PROVIDER', 'local').toLowerCase();
    if (requested === 's3' && this.s3Provider.isConfigured()) return 's3';
    return 'local';
  }
}
