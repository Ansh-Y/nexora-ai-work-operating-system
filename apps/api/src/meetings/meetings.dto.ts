import { IsArray, IsDateString, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateMeetingDto {
  @IsString() @MinLength(2) @MaxLength(180) title!: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsDateString() startsAt?: string | null;
  @IsOptional() @IsInt() @Min(5) @Max(1440) durationMinutes?: number | null;
  @IsOptional() @IsUUID() projectId?: string | null;
  @IsOptional() @IsArray() @IsUUID(undefined, { each: true }) participantIds?: string[];
}

export class UpdateMeetingDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(180) title?: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsDateString() startsAt?: string | null;
  @IsOptional() @IsInt() @Min(5) @Max(1440) durationMinutes?: number | null;
  @IsOptional() @IsUUID() projectId?: string | null;
  @IsOptional() @IsArray() @IsUUID(undefined, { each: true }) participantIds?: string[];
}

export class UpdateMeetingActionDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(180) title?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsUUID() assigneeId?: string | null;
  @IsOptional() @IsUUID() projectId?: string | null;
  @IsOptional() @IsDateString() dueDate?: string | null;
}

export class ConvertMeetingActionDto {
  @IsOptional() @IsUUID() projectId?: string;
  @IsOptional() @IsUUID() assigneeId?: string;
  @IsOptional() @IsDateString() dueDate?: string;
}
