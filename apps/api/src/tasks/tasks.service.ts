import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { OrganizationRole, TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Principal } from '../common/auth.types';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { CommentDto, CreateTaskDto, UpdateTaskDto } from './tasks.dto';
import { wouldCreateCycle } from './dependency-graph';
import { NotificationsService } from '../notifications/notifications.service';

const writers: OrganizationRole[] = [OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.PROJECT_MANAGER, OrganizationRole.TEAM_MEMBER];

@Injectable()
export class TasksService {
  constructor(private prisma: PrismaService, private audit: AuditService, private realtime: RealtimeGateway, private notifications: NotificationsService) {}
  async list(user: Principal, projectId: string) {
    await this.ensureProject(user.orgId, projectId);
    return this.prisma.task.findMany({ where: { organizationId: user.orgId, projectId }, include: { assignee: { select: { id: true, name: true } }, blockedBy: { include: { blockingTask: { select: { id: true, title: true, status: true } } } }, blocks: { include: { blockedTask: { select: { id: true, title: true, status: true, dueDate: true } } } } }, orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }] });
  }
  async create(user: Principal, projectId: string, dto: CreateTaskDto) {
    this.assertWritable(user);
    await this.ensureProject(user.orgId, projectId);
    if (dto.assigneeId) await this.ensureMember(user.orgId, dto.assigneeId);
    const startDate = dto.startDate ? new Date(dto.startDate) : null;
    const dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    if (startDate && dueDate && startDate > dueDate) throw new BadRequestException('Task start date must be on or before its due date');
    const task = await this.prisma.task.create({ data: { organizationId: user.orgId, projectId, title: dto.title.trim(), description: dto.description ?? '', priority: dto.priority, status: dto.status, startDate: startDate ?? undefined, dueDate: dueDate ?? undefined, assigneeId: dto.assigneeId, labels: dto.labels ?? [] }, include: { assignee: { select: { id: true, name: true } } } });
    await this.audit.append({ organizationId: user.orgId, actorType: 'USER', actorId: user.sub, action: 'task.created', targetType: 'task', targetId: task.id, metadata: { projectId, title: task.title } });
    if (task.assigneeId && task.assigneeId !== user.sub) await this.notifications.notifyUsers(user.orgId, [task.assigneeId], 'ASSIGNMENT', 'A task was assigned to you', task.title, `assignment:${task.id}:${task.updatedAt.toISOString()}`);
    this.changed(user.orgId, projectId, task.id, 'created');
    return task;
  }
  async update(user: Principal, id: string, dto: UpdateTaskDto) {
    this.assertWritable(user);
    const current = await this.prisma.task.findFirst({ where: { id, organizationId: user.orgId } });
    if (!current) throw new NotFoundException('Task not found');
    if (dto.assigneeId) await this.ensureMember(user.orgId, dto.assigneeId);
    const startDate = dto.startDate === undefined ? current.startDate : dto.startDate ? new Date(dto.startDate) : null;
    const dueDate = dto.dueDate === undefined ? current.dueDate : dto.dueDate ? new Date(dto.dueDate) : null;
    if (startDate && dueDate && startDate > dueDate) throw new BadRequestException('Task start date must be on or before its due date');
    const task = await this.prisma.task.update({ where: { id }, data: { title: dto.title?.trim(), description: dto.description, status: dto.status, priority: dto.priority, startDate: dto.startDate === undefined ? undefined : startDate, dueDate: dto.dueDate === undefined ? undefined : dueDate, assigneeId: dto.assigneeId, labels: dto.labels, completedAt: dto.status === TaskStatus.DONE ? new Date() : dto.status ? null : undefined } });
    const changed = Object.keys(dto);
    const downstream = await this.downstream(user.orgId, id);
    await this.audit.append({ organizationId: user.orgId, actorType: 'USER', actorId: user.sub, action: 'task.updated', targetType: 'task', targetId: id, metadata: { changed, downstreamImpact: (dto.status || dto.dueDate || dto.startDate) ? downstream.map(t => t.id) : [] } });
    if (dto.assigneeId && dto.assigneeId !== current.assigneeId && dto.assigneeId !== user.sub) await this.notifications.notifyUsers(user.orgId, [dto.assigneeId], 'ASSIGNMENT', 'A task was assigned to you', task.title, `assignment:${task.id}:${task.updatedAt.toISOString()}`);
    if (dto.status === TaskStatus.BLOCKED && current.status !== TaskStatus.BLOCKED) {
      const affectedAssignees = await this.prisma.task.findMany({ where: { organizationId: user.orgId, id: { in: downstream.map(t => t.id) }, assigneeId: { not: null } }, select: { assigneeId: true } });
      await this.notifications.notifyUsers(user.orgId, affectedAssignees.map(row => row.assigneeId!).filter(id => id !== user.sub), 'RISK', 'A dependency is blocked', `${task.title} may affect downstream work.`, `blocker:${task.id}:${task.updatedAt.toISOString()}`);
    }
    this.changed(user.orgId, task.projectId, task.id, 'updated');
    return { ...task, impact: (dto.status || dto.dueDate || dto.startDate) ? { affectedTaskCount: downstream.length, affectedTasks: downstream } : undefined };
  }
  async remove(user: Principal, id: string) {
    this.assertWritable(user);
    const task = await this.prisma.task.findFirst({ where: { id, organizationId: user.orgId } });
    if (!task) throw new NotFoundException('Task not found');
    await this.prisma.$transaction(async tx => {
      await tx.auditEvent.create({ data: { organizationId: user.orgId, actorType: 'USER', actorId: user.sub, action: 'task.deleted', targetType: 'task', targetId: id, metadata: { title: task.title } } });
      await tx.task.delete({ where: { id } });
    });
    this.changed(user.orgId, task.projectId, id, 'deleted');
    return { deleted: true };
  }
  async addDependency(user: Principal, blockingTaskId: string, blockedTaskId: string) {
    this.assertWritable(user);
    let from: { id: string; projectId: string } | null = null;
    let dependency;
    try {
      dependency = await this.prisma.$transaction(async tx => {
        const [source, target] = await Promise.all([
          tx.task.findFirst({ where: { id: blockingTaskId, organizationId: user.orgId }, select: { id: true, projectId: true } }),
          tx.task.findFirst({ where: { id: blockedTaskId, organizationId: user.orgId }, select: { id: true, projectId: true } }),
        ]);
        if (!source || !target) throw new NotFoundException('Task not found in this workspace');
        if (source.projectId !== target.projectId) throw new BadRequestException('Dependencies must stay inside one project');
        if (source.id === target.id) throw new BadRequestException('A task cannot depend on itself');
        const edges = await tx.taskDependency.findMany({ where: { organizationId: user.orgId }, select: { blockingTaskId: true, blockedTaskId: true } });
        if (wouldCreateCycle(edges, blockingTaskId, blockedTaskId)) throw new BadRequestException('This dependency would create a circular chain');
        from = source;
        const created = await tx.taskDependency.create({ data: { organizationId: user.orgId, blockingTaskId, blockedTaskId } });
        await tx.auditEvent.create({ data: { organizationId: user.orgId, actorType: 'USER', actorId: user.sub, action: 'dependency.created', targetType: 'task_dependency', targetId: created.id, metadata: { blockingTaskId, blockedTaskId } } });
        return created;
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2034') throw new BadRequestException('The dependency graph changed concurrently; retry the request');
      throw error;
    }
    this.changed(user.orgId, from!.projectId, blockingTaskId, 'dependency_added');
    return dependency;
  }
  async addComment(user: Principal, taskId: string, dto: CommentDto) {
    this.assertWritable(user);
    const task = await this.prisma.task.findFirst({ where: { id: taskId, organizationId: user.orgId } });
    if (!task) throw new NotFoundException('Task not found');
    const comment = await this.prisma.comment.create({ data: { organizationId: user.orgId, taskId, authorId: user.sub, body: dto.body }, include: { author: { select: { id: true, name: true } } } });
    await this.audit.append({ organizationId: user.orgId, actorType: 'USER', actorId: user.sub, action: 'comment.created', targetType: 'comment', targetId: comment.id, metadata: { taskId } });
    const recipients = new Set<string>();
    const taskAssignee = await this.prisma.task.findFirst({ where: { id: taskId, organizationId: user.orgId }, select: { assigneeId: true } });
    if (taskAssignee?.assigneeId && taskAssignee.assigneeId !== user.sub) recipients.add(taskAssignee.assigneeId);
    if (recipients.size) await this.notifications.notifyUsers(user.orgId, [...recipients], 'COMMENT', 'New comment on your task', task.title, `comment:${comment.id}`);
    const mentionedEmails = [...new Set([...dto.body.matchAll(/@([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi)].map(match => match[1].toLowerCase()))];
    if (mentionedEmails.length) {
      const mentioned = await this.prisma.membership.findMany({ where: { organizationId: user.orgId, user: { email: { in: mentionedEmails } } }, select: { userId: true } });
      await this.notifications.notifyUsers(user.orgId, mentioned.map(member => member.userId).filter(id => id !== user.sub), 'MENTION', 'You were mentioned in a task comment', task.title, `mention:${comment.id}`);
    }
    this.realtime.broadcast(user.orgId, 'comment.created', { projectId: task.projectId, taskId, commentId: comment.id });
    return comment;
  }
  async comments(user: Principal, taskId: string) {
    const task = await this.prisma.task.findFirst({ where: { id: taskId, organizationId: user.orgId }, select: { id: true } });
    if (!task) throw new NotFoundException('Task not found');
    return this.prisma.comment.findMany({ where: { organizationId: user.orgId, taskId }, include: { author: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } });
  }
  async downstream(orgId: string, taskId: string) {
    const all = await this.prisma.taskDependency.findMany({ where: { organizationId: orgId }, include: { blockedTask: { select: { id: true, title: true, status: true, dueDate: true, projectId: true } } } });
    const graph = new Map<string, typeof all>();
    all.forEach(edge => graph.set(edge.blockingTaskId, [...(graph.get(edge.blockingTaskId) ?? []), edge]));
    const queue = [...(graph.get(taskId) ?? [])]; const seen = new Set<string>();
    const result: { id: string; title: string; status: string; dueDate: Date | null; projectId: string }[] = [];
    while (queue.length) {
      const edge = queue.shift()!;
      if (seen.has(edge.blockedTask.id)) continue;
      seen.add(edge.blockedTask.id); result.push(edge.blockedTask); queue.push(...(graph.get(edge.blockedTask.id) ?? []));
    }
    return result;
  }
  private async ensureProject(orgId: string, projectId: string) {
    const found = await this.prisma.project.findFirst({ where: { id: projectId, organizationId: orgId } });
    if (!found) throw new NotFoundException('Project not found');
    return found;
  }
  private async ensureMember(orgId: string, userId: string) {
    if (!await this.prisma.membership.findUnique({ where: { organizationId_userId: { organizationId: orgId, userId } } })) throw new BadRequestException('Assignee must be a member of this workspace');
  }
  private assertWritable(user: Principal) { if (!writers.includes(user.role)) throw new ForbiddenException('Your role cannot edit tasks'); }
  private changed(orgId: string, projectId: string, taskId: string, action: string) { this.realtime.broadcast(orgId, 'project.updated', { projectId, taskId, action }); }
}
