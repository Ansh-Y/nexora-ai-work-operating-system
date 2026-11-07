import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OrganizationRole } from '@prisma/client';
import { AuthGuard } from '../common/auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { Principal } from '../common/auth.types';
import { CreateMilestoneDto, UpdateMilestoneDto } from './milestones.dto';
import { MilestonesService } from './milestones.service';

@ApiTags('Milestones') @ApiBearerAuth() @Controller() @UseGuards(AuthGuard, RolesGuard)
export class MilestonesController {
  constructor(private service: MilestonesService) {}
  @Get('projects/:projectId/milestones') list(@CurrentUser() user: Principal, @Param('projectId') projectId: string) { return this.service.list(user, projectId); }
  @Post('projects/:projectId/milestones') @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.PROJECT_MANAGER) create(@CurrentUser() user: Principal, @Param('projectId') projectId: string, @Body() dto: CreateMilestoneDto) { return this.service.create(user, projectId, dto); }
  @Patch('milestones/:id') @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.PROJECT_MANAGER) update(@CurrentUser() user: Principal, @Param('id') id: string, @Body() dto: UpdateMilestoneDto) { return this.service.update(user, id, dto); }
}
