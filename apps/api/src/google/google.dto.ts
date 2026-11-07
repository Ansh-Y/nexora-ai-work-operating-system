import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class GoogleOAuthCallbackDto {
  @ApiProperty({ description: 'Authorization code returned by Google' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  code!: string;

  @ApiProperty({ description: 'Cryptographic state token verifying request origin' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  state!: string;
}

export class SyncGoogleCalendarDto {
  @ApiPropertyOptional({ description: 'Whether to force a full resynchronization ignoring existing sync tokens' })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class AssociateCalendarEventDto {
  @ApiProperty({ description: 'The project ID to associate with this calendar event' })
  @IsUUID()
  @IsNotEmpty()
  projectId!: string;

  @ApiPropertyOptional({ description: 'Whether to also create or link a NEXORA meeting record' })
  @IsOptional()
  @IsBoolean()
  createMeeting?: boolean;
}

export class SyncGmailDto {
  @ApiPropertyOptional({ description: 'Maximum number of recent messages to synchronize (1-50)', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  maxMessages?: number;
}

export class ProposeTaskFromEmailDto {
  @ApiPropertyOptional({ description: 'Optional project ID to associate the proposed task with' })
  @IsOptional()
  @IsUUID()
  projectId?: string;
}

export class GoogleCalendarQueryDto {
  @ApiPropertyOptional({ description: 'ISO 8601 start timestamp for event window' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 end timestamp for event window' })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional({ description: 'Filter by associated project ID' })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({ description: 'Maximum number of events to return', default: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
