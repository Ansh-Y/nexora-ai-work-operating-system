import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  NotificationCategory,
  NotificationPriority,
  NotificationType,
  OrganizationRole,
} from '@prisma/client';
import { AuthGuard } from '../common/auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { Principal } from '../common/auth.types';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { NotificationsService } from './notifications.service';
import {
  CreateTestNotificationDto,
  DismissNotificationsDto,
  ListNotificationsQueryDto,
  UpdateNotificationPreferencesDto,
} from './notifications.dto';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private service: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List smart notifications with category and priority filtering' })
  list(@CurrentUser() user: Principal, @Query() query: ListNotificationsQueryDto) {
    return this.service.list(user, query);
  }

  @Get('preferences')
  @ApiOperation({ summary: 'Get notification preferences for the current user' })
  getPreferences(@CurrentUser() user: Principal) {
    return this.service.getPreferences(user);
  }

  @Patch('preferences')
  @ApiOperation({ summary: 'Update notification preferences for the current user' })
  updatePreferences(
    @CurrentUser() user: Principal,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    return this.service.updatePreferences(user, dto);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all unread notifications as read' })
  readAll(
    @CurrentUser() user: Principal,
    @Query('category') category?: NotificationCategory,
  ) {
    return this.service.readAll(user, category);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a single notification as read' })
  read(@CurrentUser() user: Principal, @Param('id') id: string) {
    return this.service.read(user, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Dismiss or delete a notification' })
  dismiss(@CurrentUser() user: Principal, @Param('id') id: string) {
    return this.service.dismiss(user, id);
  }

  @Post('test')
  @ApiOperation({ summary: 'Create a test smart notification for current user' })
  createTestNotification(
    @CurrentUser() user: Principal,
    @Body() body: CreateTestNotificationDto,
  ) {
    return this.service.notifyUsers(
      user.orgId,
      [user.sub],
      NotificationType.AI_INSIGHT,
      body.title || 'Smart Alert',
      body.body || 'Workspace intelligence alert message',
      `test:${Date.now()}:${Math.random().toString(16).slice(2, 8)}`,
      {
        category: body.category || NotificationCategory.TASK,
        priority: body.priority || NotificationPriority.MEDIUM,
        actionUrl: body.actionUrl || '/tasks',
        metadata: body.metadata || {},
      },
    );
  }

  @Post('dismiss-all')
  @ApiOperation({ summary: 'Dismiss all notifications by optional category' })
  dismissAll(
    @CurrentUser() user: Principal,
    @Body() dto: DismissNotificationsDto,
  ) {
    return this.service.dismissAll(user, dto.category);
  }

  @Get('queue-status')
  @UseGuards(RolesGuard)
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  @ApiOperation({ summary: 'Inspect BullMQ deadline reminder queue status' })
  queueStatus() {
    return this.service.queueStatus();
  }
}
