import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { OrganizationRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Principal } from '../common/auth.types';
import { CreateMilestoneDto, UpdateMilestoneDto } from './milestones.dto';

const managers: OrganizationRole[] = [OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.PROJECT_MANAGER];

@Injectable()
export class MilestonesService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}
  async list(user: Principal, projectId: string) {
    if (!await this.prisma.project.findFirst({ where: { id: projectId, organizationId: user.orgId }, select: { id: true } })) throw new NotFoundException('Project not found');
    return this.prisma.milestone.findMany({ where: { organizationId: user.orgId, projectId }, orderBy: [{ targetDate: 'asc' }, { createdAt: 'asc' }] });
  }
  async create(user: Principal, projectId: string, dto: CreateMilestoneDto) {
    this.assertManager(user);
    if (!await this.prisma.project.findFirst({ where: { id: projectId, organizationId: user.orgId }, select: { id: true } })) throw new NotFoundException('Project not found');
    const milestone = await this.prisma.milestone.create({ data: { organizationId: user.orgId, projectId, title: dto.title.trim(), description: dto.description ?? '', targetDate: dto.targetDate ? new Date(dto.targetDate) : undefined } });
    await this.audit.append({ organizationId: user.orgId, actorType: 'USER', actorId: user.sub, action: 'milestone.created', targetType: 'milestone', targetId: milestone.id, metadata: { projectId } });
    return milestone;
  }
  async update(user: Principal, id: string, dto: UpdateMilestoneDto) {
    this.assertManager(user);
    const existing = await this.prisma.milestone.findFirst({ where: { id, organizationId: user.orgId } });
    if (!existing) throw new NotFoundException('Milestone not found');
    const updated = await this.prisma.milestone.update({ where: { id }, data: { title: dto.title?.trim(), description: dto.description, targetDate: dto.targetDate ? new Date(dto.targetDate) : undefined, completedAt: dto.completed === undefined ? undefined : dto.completed ? existing.completedAt ?? new Date() : null } });
    await this.audit.append({ organizationId: user.orgId, actorType: 'USER', actorId: user.sub, action: 'milestone.updated', targetType: 'milestone', targetId: id, metadata: { changed: Object.keys(dto) } });
    return updated;
  }
  private assertManager(user: Principal) { if (!managers.includes(user.role)) throw new ForbiddenException('Only workspace managers can edit milestones'); }
}
