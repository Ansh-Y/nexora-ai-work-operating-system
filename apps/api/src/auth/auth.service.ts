import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { OrganizationRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LoginDto, RegisterDto } from './auth.dto';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService, private config: ConfigService, private audit: AuditService) {}

  private async issue(user: { id: string; email: string; name: string }, organizationId: string, role: OrganizationRole, organizationName?: string) {
    const accessToken = await this.jwt.signAsync({ sub: user.id, email: user.email, name: user.name, orgId: organizationId, role });
    const refreshToken = randomBytes(48).toString('base64url');
    await this.prisma.refreshSession.create({ data: { userId: user.id, organizationId, tokenHash: this.hash(refreshToken), expiresAt: new Date(Date.now() + 30 * 86400000) } });
    return { accessToken, refreshToken, user: { id: user.id, email: user.email, name: user.name }, workspace: { id: organizationId, name: organizationName, role } };
  }

  async rotate(refreshToken: string) {
    if (!refreshToken) throw new UnauthorizedException('Refresh session is missing');
    const tokenHash = this.hash(refreshToken);
    const session = await this.prisma.refreshSession.findUnique({ where: { tokenHash }, include: { user: true, organization: true } });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) throw new UnauthorizedException('Refresh session expired; please sign in again');
    const membership = await this.prisma.membership.findUnique({ where: { organizationId_userId: { organizationId: session.organizationId, userId: session.userId } } });
    if (!membership) throw new UnauthorizedException('Workspace access was removed');
    const nextRefreshToken = randomBytes(48).toString('base64url');
    const now = new Date();
    await this.prisma.$transaction(async tx => {
      const revoked = await tx.refreshSession.updateMany({ where: { id: session.id, revokedAt: null, expiresAt: { gt: now } }, data: { revokedAt: now } });
      if (!revoked.count) throw new UnauthorizedException('Refresh session was already used');
      await tx.refreshSession.create({ data: { userId: session.userId, organizationId: session.organizationId, tokenHash: this.hash(nextRefreshToken), expiresAt: new Date(Date.now() + 30 * 86400000) } });
    });
    const accessToken = await this.jwt.signAsync({ sub: session.userId, email: session.user.email, name: session.user.name, orgId: session.organizationId, role: membership.role });
    return { accessToken, refreshToken: nextRefreshToken, user: { id: session.userId, email: session.user.email, name: session.user.name }, workspace: { id: session.organizationId, name: session.organization.name, role: membership.role } };
  }

  async revoke(refreshToken?: string) {
    if (!refreshToken) return;
    await this.prisma.refreshSession.updateMany({ where: { tokenHash: this.hash(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  private hash(token: string) { return createHash('sha256').update(token).digest('hex'); }

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) throw new ConflictException('An account with this email already exists');
    if (Buffer.byteLength(dto.password, 'utf8') > 72) throw new BadRequestException('Password must be no longer than 72 UTF-8 bytes');
    const organizationName = dto.organizationName?.trim() || 'My workspace';
    const slugBase = organizationName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'workspace';
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const result = await this.prisma.$transaction(async tx => {
      const user = await tx.user.create({ data: { email, name: dto.name.trim(), passwordHash } });
      if (dto.inviteToken) {
        const tokenHash = this.hash(dto.inviteToken);
        const invite = await tx.invitation.findUnique({ where: { tokenHash }, include: { organization: true } });
        if (!invite || invite.acceptedAt || invite.expiresAt <= new Date() || invite.email !== email) throw new UnauthorizedException('This invitation is invalid, expired, or for another email address');
        const membership = await tx.membership.create({ data: { organizationId: invite.organizationId, userId: user.id, role: invite.role } });
        await tx.invitation.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
        await tx.auditEvent.create({ data: { organizationId: invite.organizationId, actorType: 'USER', actorId: user.id, action: 'member.joined', targetType: 'membership', targetId: membership.id, metadata: { via: 'invitation' } } });
        return { user, organization: invite.organization, membership };
      }
      const organization = await tx.organization.create({ data: { name: organizationName, slug: `${slugBase}-${user.id.slice(0, 6)}` } });
      const membership = await tx.membership.create({ data: { userId: user.id, organizationId: organization.id, role: OrganizationRole.OWNER } });
      await tx.auditEvent.create({ data: { organizationId: organization.id, actorType: 'USER', actorId: user.id, action: 'workspace.created', targetType: 'organization', targetId: organization.id } });
      return { user, organization, membership };
    });
    return this.issue(result.user, result.organization.id, result.membership.role, result.organization.name);
  }

  async login(dto: LoginDto) {
    if (Buffer.byteLength(dto.password, 'utf8') > 72) throw new UnauthorizedException('Email or password is incorrect');
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.trim().toLowerCase() }, include: { memberships: { include: { organization: true }, orderBy: { createdAt: 'asc' } } } });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) throw new UnauthorizedException('Email or password is incorrect');
    const membership = user.memberships[0];
    if (!membership) throw new UnauthorizedException('No workspace membership is available');
    await this.audit.append({ organizationId: membership.organizationId, actorType: 'USER', actorId: user.id, action: 'auth.login', targetType: 'user', targetId: user.id });
    return { ...await this.issue(user, membership.organizationId, membership.role, membership.organization.name), workspaces: user.memberships.map(m => ({ id: m.organizationId, name: m.organization.name, role: m.role })) };
  }

  async workspaces(userId: string) {
    const entries = await this.prisma.membership.findMany({ where: { userId }, include: { organization: true }, orderBy: { createdAt: 'asc' } });
    return entries.map(m => ({ id: m.organizationId, name: m.organization.name, role: m.role }));
  }

  async switchWorkspace(userId: string, orgId: string) {
    const membership = await this.prisma.membership.findUnique({ where: { organizationId_userId: { organizationId: orgId, userId } }, include: { user: true, organization: true } });
    if (!membership) throw new UnauthorizedException('You are not a member of that workspace');
    return this.issue(membership.user, orgId, membership.role, membership.organization.name);
  }
}
