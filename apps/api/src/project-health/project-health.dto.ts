import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class DismissRiskDto {
  @ApiProperty({ description: 'Explanation for why this risk is being dismissed or accepted' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class RecalculateHealthDto {
  @ApiPropertyOptional({ description: 'Whether to force snapshot creation even if score is unchanged' })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class ProjectRisksQueryDto {
  @ApiPropertyOptional({ description: 'Filter by risk severity', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] })
  @IsOptional()
  @IsIn(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'])
  severity?: string;

  @ApiPropertyOptional({ description: 'Filter by risk status', enum: ['ACTIVE', 'DISMISSED', 'RESOLVED', 'ALL'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'DISMISSED', 'RESOLVED', 'ALL'])
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by risk type' })
  @IsOptional()
  @IsString()
  riskType?: string;
}

export class ProposeRiskActionDto {
  @ApiPropertyOptional({ description: 'Custom notes or instructions for the AI plan proposal' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class HealthHistoryQueryDto {
  @ApiPropertyOptional({ description: 'Maximum number of historical snapshots to return (default: 30)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
