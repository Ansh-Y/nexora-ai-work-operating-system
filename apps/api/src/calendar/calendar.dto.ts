import { IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CalendarQueryDto {
  @IsDateString() from!: string;
  @IsDateString() to!: string;
  @IsOptional() @IsUUID() projectId?: string;
  @IsOptional() @IsUUID() memberId?: string;
  @IsOptional() @IsString() @MaxLength(24) status?: string;
}
