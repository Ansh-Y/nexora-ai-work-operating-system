import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';
import { OrganizationRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Principal } from '../common/auth.types';

@Injectable()
export class OrganizationsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}
  current(user: Principal) {
    return this.prisma.organization.findFirst({ where: { id: user.orgId, memberships: { some: { userId: user.sub } } }, include: { _count: { select: { memberships: true, projects: true } } } });
  }
  members(user: Principal) {
    return this.prisma.membership.findMany({ where: { organizationId: user.orgId }, include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: 'asc' } });
  }
  async create(user: Principal, name: string) {
    const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 44) || 'workspace'}-${randomBytes(3).toString('hex')}`;
    const org = await this.prisma.$transaction(async tx => {
      const created = await tx.organization.create({ data: { name, slug } });
      await tx.membership.create({ data: { organizationId: created.id, userId: user.sub, role: OrganizationRole.OWNER } });
      await tx.auditEvent.create({ data: { organizationId: created.id, actorType: 'USER', actorId: user.sub, action: 'workspace.created', targetType: 'organization', targetId: created.id } });
      return created;
    });
    return org;
  }
  async invite(user: Principal, email: string, role: OrganizationRole) {
    if (user.role !== OrganizationRole.OWNER && user.role !== OrganizationRole.ADMIN) throw new ForbiddenException('Only workspace owners and admins can invite members');
    if (role === OrganizationRole.OWNER) throw new ForbiddenException('Ownership can only be transferred through the owner transfer workflow');
    if (user.role === OrganizationRole.ADMIN && role === OrganizationRole.ADMIN) throw new ForbiddenException('Only workspace owners can invite admins');
    const normalized = email.trim().toLowerCase();
    const token = randomBytes(32).toString('hex');
    const invitation = await this.prisma.invitation.create({ data: { organizationId: user.orgId, email: normalized, role, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 7 * 86400000) } });
    await this.audit.append({ organizationId: user.orgId, actorType: 'USER', actorId: user.sub, action: 'member.invited', targetType: 'invitation', targetId: invitation.id, metadata: { email: normalized, role } });
    return { id: invitation.id, email: normalized, role, expiresAt: invitation.expiresAt, token, delivery: 'not_configured' };
  }
  async changeRole(user: Principal, membershipId: string, role: OrganizationRole) {
    if (user.role !== OrganizationRole.OWNER && user.role !== OrganizationRole.ADMIN) throw new ForbiddenException('Only workspace owners and admins can change roles');
    if (role === OrganizationRole.OWNER) throw new ForbiddenException('Ownership can only be transferred through the owner transfer workflow');
    const member = await this.prisma.membership.findFirst({ where: { id: membershipId, organizationId: user.orgId } });
    if (!member) throw new NotFoundException('Member not found');
    if (member.role === OrganizationRole.OWNER) throw new ForbiddenException('Transfer ownership through the owner transfer workflow');
    if (member.userId === user.sub) throw new ForbiddenException('You cannot change your own workspace role');
    if (user.role === OrganizationRole.ADMIN && (member.role === OrganizationRole.ADMIN || role === OrganizationRole.ADMIN)) throw new ForbiddenException('Only workspace owners can manage admin roles');
    const updated = await this.prisma.membership.update({ where: { id: member.id }, data: { role } });
    await this.audit.append({ organizationId: user.orgId, actorType: 'USER', actorId: user.sub, action: 'member.role_changed', targetType: 'membership', targetId: member.id, metadata: { from: member.role, to: role } });
    return updated;
  }
  async acceptInvite(user: Principal, token: string) {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const invite = await this.prisma.invitation.findUnique({ where: { tokenHash }, include: { organization: true } });
    if (!invite || invite.email !== user.email) throw new NotFoundException('Invitation not found for this account');
    const existing = await this.prisma.membership.findUnique({ where: { organizationId_userId: { organizationId: invite.organizationId, userId: user.sub } } });
    if (existing && invite.acceptedAt) return { organizationId: invite.organizationId, organizationName: invite.organization.name, role: existing.role };
    if (invite.acceptedAt || invite.expiresAt <= new Date()) throw new NotFoundException('Invitation has expired or has already been used');
    const membership = await this.prisma.$transaction(async tx => {
      const changed = await tx.invitation.updateMany({ where: { id: invite.id, acceptedAt: null, expiresAt: { gt: new Date() } }, data: { acceptedAt: new Date() } });
      if (!changed.count) throw new NotFoundException('Invitation has expired or has already been used');
      const created = await tx.membership.create({ data: { organizationId: invite.organizationId, userId: user.sub, role: invite.role } });
      await tx.auditEvent.create({ data: { organizationId: invite.organizationId, actorType: 'USER', actorId: user.sub, action: 'member.joined', targetType: 'membership', targetId: created.id, metadata: { via: 'invitation' } } });
      return created;
    });
    return { organizationId: invite.organizationId, organizationName: invite.organization.name, role: membership.role };
  }
}
