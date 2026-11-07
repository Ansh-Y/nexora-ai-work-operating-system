import { OrganizationRole } from '@prisma/client';
import { IsEmail, IsEnum, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateOrganizationDto { @IsString() @MinLength(2) @MaxLength(80) name!: string; }
export class InviteDto { @IsEmail() @MaxLength(254) email!: string; @IsEnum(OrganizationRole) role: OrganizationRole = OrganizationRole.TEAM_MEMBER; }
export class ChangeRoleDto { @IsEnum(OrganizationRole) role!: OrganizationRole; }
export class AcceptInvitationDto { @IsString() @MinLength(20) token!: string; }
