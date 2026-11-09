import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class GenerateWeeklyReportDto {
  @ApiProperty({ description: 'Target project UUID for the report', example: 'a0000000-0000-0000-0000-000000000001' })
  @IsUUID()
  @IsNotEmpty()
  projectId!: string;

  @ApiPropertyOptional({ description: 'Start date of the reporting period (ISO string). Defaults to 7 days prior to periodEnd.', example: '2026-11-02T00:00:00.000Z' })
  @IsDateString()
  @IsOptional()
  periodStart?: string;

  @ApiPropertyOptional({ description: 'End date of the reporting period (ISO string). Defaults to current time.', example: '2026-11-09T00:00:00.000Z' })
  @IsDateString()
  @IsOptional()
  periodEnd?: string;

  @ApiPropertyOptional({ description: 'Optional custom strategic directives or instructions for the AI synthesizer', example: 'Focus on backend stability and payment integration risks' })
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  customInstructions?: string;
}

export class ListWeeklyReportsQueryDto {
  @ApiPropertyOptional({ description: 'Filter reports by project UUID' })
  @IsUUID()
  @IsOptional()
  projectId?: string;
}
