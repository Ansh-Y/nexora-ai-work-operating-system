import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../common/auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { Principal } from '../common/auth.types';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { OrganizationRole } from '@prisma/client';
import { AcceptInvitationDto, ChangeRoleDto, CreateOrganizationDto, InviteDto } from './organizations.dto';
import { OrganizationsService } from './organizations.service';

@ApiTags('Workspaces') @ApiBearerAuth() @Controller('organizations') @UseGuards(AuthGuard, RolesGuard)
export class OrganizationsController {
  constructor(private service: OrganizationsService) {}
  @Get('current') current(@CurrentUser() user: Principal) { return this.service.current(user); }
  @Get('members') members(@CurrentUser() user: Principal) { return this.service.members(user); }
  @Post() create(@CurrentUser() user: Principal, @Body() dto: CreateOrganizationDto) { return this.service.create(user, dto.name); }
  @Post('invitations') invite(@CurrentUser() user: Principal, @Body() dto: InviteDto) { return this.service.invite(user, dto.email, dto.role); }
  @Post('invitations/accept') acceptInvite(@CurrentUser() user: Principal, @Body() dto: AcceptInvitationDto) { return this.service.acceptInvite(user, dto.token); }
  @Patch('members/:id/role') @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN) changeRole(@CurrentUser() user: Principal, @Param('id') id: string, @Body() dto: ChangeRoleDto) { return this.service.changeRole(user, id, dto.role); }
}
