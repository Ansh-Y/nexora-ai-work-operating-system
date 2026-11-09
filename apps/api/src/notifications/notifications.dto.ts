import { ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationCategory, NotificationPriority } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ListNotificationsQueryDto {
  @ApiPropertyOptional({ enum: NotificationCategory, description: 'Filter notifications by category' })
  @IsEnum(NotificationCategory)
  @IsOptional()
  category?: NotificationCategory;

  @ApiPropertyOptional({ enum: NotificationPriority, description: 'Filter notifications by priority level' })
  @IsEnum(NotificationPriority)
  @IsOptional()
  priority?: NotificationPriority;

  @ApiPropertyOptional({ enum: ['all', 'unread', 'read'], description: 'Filter by read state', default: 'all' })
  @IsString()
  @IsOptional()
  status?: 'all' | 'unread' | 'read';

  @ApiPropertyOptional({ description: 'Search term across notification title and body' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ description: 'Number of items to retrieve', default: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  limit?: number = 50;

  @ApiPropertyOptional({ description: 'Offset for pagination', default: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  offset?: number = 0;
}

export class UpdateNotificationPreferencesDto {
  @ApiPropertyOptional({ description: 'Receive alerts regarding project health and risks' })
  @IsBoolean()
  @IsOptional()
  projectAlerts?: boolean;

  @ApiPropertyOptional({ description: 'Receive alerts regarding task assignments, status, and deadlines' })
  @IsBoolean()
  @IsOptional()
  taskAlerts?: boolean;

  @ApiPropertyOptional({ description: 'Receive alerts regarding AI workflow approvals and reports' })
  @IsBoolean()
  @IsOptional()
  aiAlerts?: boolean;

  @ApiPropertyOptional({ description: 'Receive alerts regarding mentions and comments' })
  @IsBoolean()
  @IsOptional()
  teamAlerts?: boolean;

  @ApiPropertyOptional({ description: 'Receive low-priority informational alerts' })
  @IsBoolean()
  @IsOptional()
  lowPriorityAlerts?: boolean;

  @ApiPropertyOptional({ description: 'Receive project health degradation and recovery alerts' })
  @IsBoolean()
  @IsOptional()
  projectHealthAlerts?: boolean;

  @ApiPropertyOptional({ description: 'Receive new project risk detection alerts' })
  @IsBoolean()
  @IsOptional()
  projectRiskAlerts?: boolean;

  @ApiPropertyOptional({ description: 'Receive task assignment alerts' })
  @IsBoolean()
  @IsOptional()
  taskAssignmentAlerts?: boolean;

  @ApiPropertyOptional({ description: 'Receive task status and blocker alerts' })
  @IsBoolean()
  @IsOptional()
  taskStatusAlerts?: boolean;

  @ApiPropertyOptional({ description: 'Receive task deadline reminders' })
  @IsBoolean()
  @IsOptional()
  taskDeadlineAlerts?: boolean;

  @ApiPropertyOptional({ description: 'Receive AI workflow approval requests' })
  @IsBoolean()
  @IsOptional()
  aiProposalAlerts?: boolean;

  @ApiPropertyOptional({ description: 'Receive weekly intelligence report generation alerts' })
  @IsBoolean()
  @IsOptional()
  weeklyReportAlerts?: boolean;

  @ApiPropertyOptional({ description: 'Receive task comment and mention alerts' })
  @IsBoolean()
  @IsOptional()
  teamCommentAlerts?: boolean;

  @ApiPropertyOptional({ description: 'Lead hours before task due date for reminder alerts', default: 24 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(168)
  @IsOptional()
  deadlineReminderLeadHours?: number;

  @ApiPropertyOptional({ description: 'Enable real-time in-app WebSocket notifications', default: true })
  @IsBoolean()
  @IsOptional()
  inAppAlerts?: boolean;
}

export class DismissNotificationsDto {
  @ApiPropertyOptional({ enum: NotificationCategory, description: 'Optional category filter to dismiss' })
  @IsEnum(NotificationCategory)
  @IsOptional()
  category?: NotificationCategory;
}

export class CreateTestNotificationDto {
  @ApiPropertyOptional({ description: 'Notification title' })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({ description: 'Notification body description' })
  @IsString()
  @IsOptional()
  body?: string;

  @ApiPropertyOptional({ enum: NotificationCategory, description: 'Smart category' })
  @IsEnum(NotificationCategory)
  @IsOptional()
  category?: NotificationCategory;

  @ApiPropertyOptional({ enum: NotificationPriority, description: 'Smart priority level' })
  @IsEnum(NotificationPriority)
  @IsOptional()
  priority?: NotificationPriority;

  @ApiPropertyOptional({ description: 'Target contextual action URL' })
  @IsString()
  @IsOptional()
  actionUrl?: string;

  @ApiPropertyOptional({ description: 'Custom metadata payload' })
  @IsOptional()
  metadata?: Record<string, any>;
}
