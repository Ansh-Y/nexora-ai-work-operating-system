import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';
import { LocalStorageProvider } from './local-storage.provider';
import { S3StorageProvider } from './s3-storage.provider';
import { StorageProviderFactory } from './storage-provider.factory';
import { StorageRetentionService } from './storage-retention.service';

@Module({
  imports: [AuthModule],
  controllers: [StorageController],
  providers: [
    LocalStorageProvider,
    S3StorageProvider,
    StorageProviderFactory,
    StorageRetentionService,
    StorageService,
  ],
  exports: [
    StorageService,
    LocalStorageProvider,
    S3StorageProvider,
    StorageProviderFactory,
    StorageRetentionService,
  ],
})
export class StorageModule {}
