import { Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../common/auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { Principal } from '../common/auth.types';
import { OrganizationRole } from '@prisma/client';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications') @ApiBearerAuth() @Controller('notifications') @UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private service: NotificationsService) {}
  @Get() list(@CurrentUser() user: Principal) { return this.service.list(user); }
  @Patch(':id/read') read(@CurrentUser() user: Principal, @Param('id') id: string) { return this.service.read(user, id); }
  @Patch('read-all') readAll(@CurrentUser() user: Principal) { return this.service.readAll(user); }
  @Get('queue-status') @UseGuards(RolesGuard) @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN) queueStatus() { return this.service.queueStatus(); }
}
