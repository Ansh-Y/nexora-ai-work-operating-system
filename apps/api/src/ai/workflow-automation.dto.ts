import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';
import {
  WorkflowActionType,
  WorkflowRunStatus,
  WorkflowTriggerType,
} from '@prisma/client';

export class CreateWorkflowRuleDto {
  @ApiProperty({ description: 'Name of the workflow automation rule', example: 'Escalate Overdue Urgent Tasks' })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  name!: string;

  @ApiPropertyOptional({ description: 'Optional explanation of what this automation enforces' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ enum: WorkflowTriggerType, description: 'Application event that triggers this automation' })
  @IsEnum(WorkflowTriggerType)
  triggerEvent!: WorkflowTriggerType;

  @ApiProperty({ enum: WorkflowActionType, description: 'Action recommended or performed when rule matches' })
  @IsEnum(WorkflowActionType)
  action!: WorkflowActionType;

  @ApiPropertyOptional({ description: 'Scope rule to a specific project UUID' })
  @IsUUID()
  @IsOptional()
  projectId?: string;

  @ApiPropertyOptional({ description: 'Condition filters (priority, status, minDaysOverdue, healthClassification)' })
  @IsObject()
  @IsOptional()
  conditions?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Action configuration options (targetStatus, targetPriority, custom notes)' })
  @IsObject()
  @IsOptional()
  actionConfig?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Whether action requires human-in-the-loop approval before executing', default: true })
  @IsBoolean()
  @IsOptional()
  requiresApproval?: boolean;

  @ApiPropertyOptional({ description: 'Whether the automation rule is actively listening for events', default: true })
  @IsBoolean()
  @IsOptional()
  isEnabled?: boolean;
}

export class UpdateWorkflowRuleDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MinLength(2)
  name?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ enum: WorkflowTriggerType })
  @IsEnum(WorkflowTriggerType)
  @IsOptional()
  triggerEvent?: WorkflowTriggerType;

  @ApiPropertyOptional({ enum: WorkflowActionType })
  @IsEnum(WorkflowActionType)
  @IsOptional()
  action?: WorkflowActionType;

  @ApiPropertyOptional()
  @IsUUID()
  @IsOptional()
  projectId?: string;

  @ApiPropertyOptional()
  @IsObject()
  @IsOptional()
  conditions?: Record<string, any>;

  @ApiPropertyOptional()
  @IsObject()
  @IsOptional()
  actionConfig?: Record<string, any>;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  requiresApproval?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isEnabled?: boolean;
}

export class ApproveWorkflowRunDto {
  @ApiPropertyOptional({ description: 'Optional notes recorded when approving the automation execution' })
  @IsString()
  @IsOptional()
  notes?: string;
}

export class RejectWorkflowRunDto {
  @ApiPropertyOptional({ description: 'Optional reason for rejecting the proposed automation execution' })
  @IsString()
  @IsOptional()
  reason?: string;
}

export class SimulateWorkflowEventDto {
  @ApiProperty({ enum: WorkflowTriggerType })
  @IsEnum(WorkflowTriggerType)
  trigger!: WorkflowTriggerType;

  @ApiPropertyOptional()
  @IsUUID()
  @IsOptional()
  projectId?: string;

  @ApiPropertyOptional()
  @IsUUID()
  @IsOptional()
  taskId?: string;
}
