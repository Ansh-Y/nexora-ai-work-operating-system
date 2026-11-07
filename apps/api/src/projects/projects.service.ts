import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ProjectStatus, OrganizationRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Principal } from '../common/auth.types';
import { CreateProjectDto, UpdateProjectDto } from './projects.dto';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { calculateCriticalPath } from './critical-path';

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService, private audit: AuditService, private realtime: RealtimeGateway) {}
  list(user: Principal) {
    return this.prisma.project.findMany({ where: { organizationId: user.orgId, status: { not: ProjectStatus.ARCHIVED } }, include: { owner: { select: { id: true, name: true, email: true } }, _count: { select: { tasks: true } }, tasks: { select: { status: true } } }, orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }] });
  }
  async get(user: Principal, id: string) {
    const project = await this.prisma.project.findFirst({ where: { id, organizationId: user.orgId }, include: { owner: { select: { id: true, name: true } }, milestones: { where: { organizationId: user.orgId }, orderBy: { targetDate: 'asc' } }, tasks: { where: { organizationId: user.orgId }, include: { assignee: { select: { id: true, name: true } }, blockedBy: { include: { blockingTask: { select: { id: true, title: true, status: true } } } }, blocks: { include: { blockedTask: { select: { id: true, title: true, status: true } } } } }, orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }] } } });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }
  async create(user: Principal, dto: CreateProjectDto) {
    const project = await this.prisma.project.create({ data: { organizationId: user.orgId, ownerId: user.sub, name: dto.name.trim(), description: dto.description ?? '', priority: dto.priority, startDate: dto.startDate ? new Date(dto.startDate) : undefined, dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined, status: ProjectStatus.ACTIVE } });
    await this.audit.append({ organizationId: user.orgId, actorType: 'USER', actorId: user.sub, action: 'project.created', targetType: 'project', targetId: project.id, metadata: { name: project.name } });
    this.realtime.broadcast(user.orgId, 'project.updated', { projectId: project.id, action: 'created' });
    return project;
  }
  async update(user: Principal, id: string, dto: UpdateProjectDto) {
    const existing = await this.prisma.project.findFirst({ where: { id, organizationId: user.orgId } });
    if (!existing) throw new NotFoundException('Project not found');
    const mutable: OrganizationRole[] = [OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.PROJECT_MANAGER];
    if (!mutable.includes(user.role)) throw new ForbiddenException('Only workspace managers can edit projects');
    const project = await this.prisma.project.update({ where: { id }, data: { ...dto, startDate: dto.startDate ? new Date(dto.startDate) : undefined, dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined, archivedAt: dto.status === ProjectStatus.ARCHIVED ? new Date() : undefined } });
    await this.audit.append({ organizationId: user.orgId, actorType: 'USER', actorId: user.sub, action: 'project.updated', targetType: 'project', targetId: id, metadata: { changed: Object.keys(dto) } });
    this.realtime.broadcast(user.orgId, 'project.updated', { projectId: id, action: 'updated' });
    return project;
  }
  async remove(user: Principal, id: string) {
    if (user.role !== OrganizationRole.OWNER && user.role !== OrganizationRole.ADMIN) throw new ForbiddenException('Only owners and admins can delete projects');
    const project = await this.prisma.project.findFirst({ where: { id, organizationId: user.orgId } });
    if (!project) throw new NotFoundException('Project not found');
    await this.prisma.$transaction(async tx => {
      await tx.auditEvent.create({ data: { organizationId: user.orgId, actorType: 'USER', actorId: user.sub, action: 'project.deleted', targetType: 'project', targetId: id, metadata: { name: project.name } } });
      await tx.project.delete({ where: { id, organizationId: user.orgId } });
    });
    this.realtime.broadcast(user.orgId, 'project.updated', { projectId: id, action: 'deleted' });
    return { deleted: true };
  }
  async health(user: Principal, id: string) {
    const project = await this.get(user, id);
    const now = new Date();
    const late = project.tasks.filter(t => t.dueDate && t.dueDate < now && t.status !== 'DONE' && t.status !== 'CANCELLED');
    const blocked = project.tasks.filter(t => t.status === 'BLOCKED');
    const impacted = new Set(blocked.flatMap(t => t.blocks.map(edge => edge.blockedTaskId)));
    const done = project.tasks.filter(t => t.status === 'DONE').length;
    const total = project.tasks.filter(t => t.status !== 'CANCELLED').length;
    const health = blocked.length || late.length ? 'at_risk' : 'on_track';
    const completedMilestones = project.milestones.filter(m => m.completedAt).length;
    return { projectId: id, health, progress: total ? Math.round(done / total * 100) : 0, completed: done, total, milestones: { completed: completedMilestones, total: project.milestones.length, upcoming: project.milestones.filter(m => !m.completedAt).map(m => ({ id: m.id, title: m.title, targetDate: m.targetDate })) }, overdueTasks: late.map(t => ({ id: t.id, title: t.title, dueDate: t.dueDate })), blockedTasks: blocked.map(t => ({ id: t.id, title: t.title, downstreamCount: t.blocks.length })), impactedTaskCount: impacted.size, generatedAt: now };
  }

  async criticalPath(user: Principal, id: string) {
    const project = await this.prisma.project.findFirst({ where: { id, organizationId: user.orgId }, select: { id: true, tasks: { where: { organizationId: user.orgId }, select: { id: true, title: true, status: true, dueDate: true } } } });
    if (!project) throw new NotFoundException('Project not found');
    const tasks = project.tasks;
    if (!tasks.length) return { projectId: id, estimatedDays: 0, path: [], taskCount: 0 };
    const taskIds = tasks.map(task => task.id);
    const edges = await this.prisma.taskDependency.findMany({ where: { organizationId: user.orgId, blockingTaskId: { in: taskIds }, blockedTaskId: { in: taskIds } }, select: { blockingTaskId: true, blockedTaskId: true } });
    const path = calculateCriticalPath(tasks, edges);
    if (path.cycleDetected) return { projectId: id, cycleDetected: true, estimatedDays: null, path: [], taskCount: 0 };
    const byId = new Map(tasks.map(task => [task.id, task]));
    return { projectId: id, cycleDetected: false, estimatedDays: path.estimatedDays, taskCount: path.pathIds.length, estimateMethod: 'one_workday_per_unfinished_task', path: path.pathIds.map((taskId, index) => ({ position: index + 1, ...byId.get(taskId) })) };
  }
}
