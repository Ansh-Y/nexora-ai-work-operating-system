import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OrganizationRole } from '@prisma/client';
import { AuthGuard } from '../common/auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { Principal } from '../common/auth.types';
import { ProjectsService } from './projects.service';
import { CreateProjectDto, UpdateProjectDto } from './projects.dto';

@ApiTags('Projects') @ApiBearerAuth() @Controller('projects') @UseGuards(AuthGuard, RolesGuard)
export class ProjectsController {
  constructor(private service: ProjectsService) {}
  @Get() list(@CurrentUser() user: Principal) { return this.service.list(user); }
  @Get(':id') get(@CurrentUser() user: Principal, @Param('id') id: string) { return this.service.get(user, id); }
  @Get(':id/health') health(@CurrentUser() user: Principal, @Param('id') id: string) { return this.service.health(user, id); }
  @Get(':id/critical-path') criticalPath(@CurrentUser() user: Principal, @Param('id') id: string) { return this.service.criticalPath(user, id); }
  @Post() @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.PROJECT_MANAGER) create(@CurrentUser() user: Principal, @Body() dto: CreateProjectDto) { return this.service.create(user, dto); }
  @Patch(':id') @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.PROJECT_MANAGER) update(@CurrentUser() user: Principal, @Param('id') id: string, @Body() dto: UpdateProjectDto) { return this.service.update(user, id, dto); }
  @Delete(':id') @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN) remove(@CurrentUser() user: Principal, @Param('id') id: string) { return this.service.remove(user, id); }
}
