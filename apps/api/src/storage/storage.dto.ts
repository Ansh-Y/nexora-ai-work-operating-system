import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { RetentionHoldType, StorageUploadStatus } from '@prisma/client';

export class UpdateRetentionPolicyDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  @Type(() => Number)
  recordingRetentionDays?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  @Type(() => Number)
  documentRetentionDays?: number | null;

  @IsOptional()
  @IsBoolean()
  autoDeleteExpired?: boolean;

  @IsOptional()
  @IsBoolean()
  manualDeletionAllowed?: boolean;
}

export class CreateRetentionHoldDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsEnum(RetentionHoldType)
  holdType?: RetentionHoldType;
}

export class ReleaseRetentionHoldDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  releaseReason?: string;
}

export class ListStorageFilesQueryDto {
  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsEnum(StorageUploadStatus)
  status?: StorageUploadStatus;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  hasHold?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  @Type(() => Number)
  expiringDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  @Type(() => Number)
  take?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  skip?: number;
}
