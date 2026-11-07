import { IsBoolean, IsEnum, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { GitHubAutomationAction, GitHubAutomationExecutionMode, GitHubAutomationRunStatus, GitHubAutomationTrigger, TaskStatus } from '@prisma/client';

export class LinkGitHubRepositoryDto {
  @IsString() @Matches(/^\d{1,20}$/) repositoryId!: string;
  @IsUUID() projectId!: string;
}

export class WebhookRepositoryDto {
  @IsUUID() repositoryId!: string;
}

export class CreateGitHubAutomationRuleDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsEnum(GitHubAutomationTrigger) triggerEvent!: GitHubAutomationTrigger;
  @IsOptional() @IsEnum(GitHubAutomationAction) action?: GitHubAutomationAction;
  @IsOptional() @IsEnum(TaskStatus) targetStatus?: TaskStatus;
  @IsOptional() @IsEnum(GitHubAutomationExecutionMode) executionMode?: GitHubAutomationExecutionMode;
  @IsOptional() @IsUUID() repositoryId?: string;
  @IsOptional() @IsUUID() projectId?: string;
  @IsOptional() @IsUUID() taskId?: string;
  @IsOptional() @IsObject() conditions?: Record<string, any>;
  @IsOptional() @IsBoolean() isEnabled?: boolean;
}

export class UpdateGitHubAutomationRuleDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsEnum(GitHubAutomationTrigger) triggerEvent?: GitHubAutomationTrigger;
  @IsOptional() @IsEnum(GitHubAutomationAction) action?: GitHubAutomationAction;
  @IsOptional() @IsEnum(TaskStatus) targetStatus?: TaskStatus;
  @IsOptional() @IsEnum(GitHubAutomationExecutionMode) executionMode?: GitHubAutomationExecutionMode;
  @IsOptional() @IsUUID() repositoryId?: string;
  @IsOptional() @IsUUID() projectId?: string;
  @IsOptional() @IsUUID() taskId?: string;
  @IsOptional() @IsObject() conditions?: Record<string, any>;
  @IsOptional() @IsBoolean() isEnabled?: boolean;
}

export class GitHubAutomationRulesQueryDto {
  @IsOptional() @IsUUID() repositoryId?: string;
  @IsOptional() @IsUUID() projectId?: string;
}

export class GitHubAutomationRunsQueryDto {
  @IsOptional() @IsEnum(GitHubAutomationRunStatus) status?: GitHubAutomationRunStatus;
  @IsOptional() @IsUUID() ruleId?: string;
  @IsOptional() @IsUUID() taskId?: string;
}
