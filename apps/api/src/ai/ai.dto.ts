import { IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class PlanDto {
  @IsString() @MinLength(20) @MaxLength(8000) brief!: string;
  @IsOptional() @IsUUID() projectId?: string;
  @IsOptional() @IsString() @MaxLength(120) projectName?: string;
}

export class AskDto {
  @IsString() @MinLength(3) @MaxLength(2000) question!: string;
}

export class ApprovePlanDto {
  @IsOptional()
  plan?: any;
}

export class ChatMessageDto {
  @IsString()
  @IsIn(['user', 'assistant', 'system'])
  role!: 'user' | 'assistant' | 'system';

  @IsString()
  @MinLength(1)
  @MaxLength(6000)
  content!: string;

  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsString()
  timestamp?: string;
}

export class AssistantChatDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  message!: string;

  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  history?: ChatMessageDto[];
}

export class ApplyTaskAssignmentDto {
  @IsUUID()
  assigneeId!: string;
}

