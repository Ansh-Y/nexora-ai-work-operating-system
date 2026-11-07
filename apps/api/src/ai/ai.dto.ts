import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class PlanDto {
  @IsString() @MinLength(20) @MaxLength(8000) brief!: string;
  @IsOptional() @IsUUID() projectId?: string;
  @IsOptional() @IsString() @MaxLength(120) projectName?: string;
}

export class AskDto {
  @IsString() @MinLength(3) @MaxLength(2000) question!: string;
}
