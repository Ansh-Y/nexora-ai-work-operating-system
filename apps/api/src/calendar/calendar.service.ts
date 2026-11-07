import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MeetingStatus, Prisma, ProjectStatus, TaskStatus } from '@prisma/client';
import { Principal } from '../common/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { calculateCriticalPath } from '../projects/critical-path';
import { CalendarQueryDto } from './calendar.dto';

const acceptedStatuses = new Set([...Object.values(TaskStatus), ...Object.values(MeetingStatus), ...Object.values(ProjectStatus), 'OPEN']);

@Injectable()
export class CalendarService {
  constructor(private prisma: PrismaService) {}

  async events(user: Principal, query: CalendarQueryDto) {
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) throw new BadRequestException('Calendar end must be after its start');
    if (to.getTime() - from.getTime() > 370 * 86400000) throw new BadRequestException('Calendar range cannot exceed 370 days');
    if (query.status && !acceptedStatuses.has(query.status)) throw new BadRequestException('Unknown calendar status');
    const projectWhere = query.projectId ? { projectId: query.projectId } : {};
    if (query.projectId && !await this.prisma.project.findFirst({ where: { id: query.projectId, organizationId: user.orgId }, select: { id: true } })) throw new NotFoundException('Project not found');
    if (query.memberId && !await this.prisma.membership.findFirst({ where: { organizationId: user.orgId, userId: query.memberId }, select: { userId: true } })) throw new NotFoundException('Workspace member not found');

    const interval = { gte: from, lt: to };
    const taskWhere: Prisma.TaskWhereInput = {
      organizationId: user.orgId,
      ...projectWhere,
      ...(query.memberId ? { assigneeId: query.memberId } : {}),
      ...(query.status && Object.values(TaskStatus).includes(query.status as TaskStatus) ? { status: query.status as TaskStatus } : {}),
      OR: [
        { dueDate: interval },
        { startDate: interval },
        { startDate: { lte: from }, dueDate: { gte: from } },
      ],
    };
    const [tasks, projects, milestones, meetings, googleEvents] = await Promise.all([
      this.prisma.task.findMany({ where: taskWhere, take: 2000, include: { project: { select: { id: true, name: true } }, assignee: { select: { id: true, name: true } }, blockedBy: { include: { blockingTask: { select: { id: true, title: true, status: true } } } }, blocks: { select: { blockedTaskId: true } } } }),
      this.prisma.project.findMany({ where: { organizationId: user.orgId, archivedAt: null, ...(query.projectId ? { id: query.projectId } : {}), ...(query.memberId ? { ownerId: query.memberId } : {}), OR: [{ startDate: interval }, { dueDate: interval }, { startDate: { lte: from }, dueDate: { gte: from } }] }, select: { id: true, name: true, status: true, startDate: true, dueDate: true, ownerId: true, owner: { select: { name: true } } }, take: 500 }),
      this.prisma.milestone.findMany({ where: { organizationId: user.orgId, ...projectWhere, ...(query.memberId ? { project: { ownerId: query.memberId } } : {}), targetDate: interval }, include: { project: { select: { id: true, name: true, ownerId: true, owner: { select: { name: true } } } } }, take: 1000 }),
      this.prisma.meeting.findMany({ where: { organizationId: user.orgId, archivedAt: null, ...projectWhere, ...(query.memberId ? { participants: { some: { organizationId: user.orgId, userId: query.memberId } } } : {}), startsAt: interval, ...(query.status && Object.values(MeetingStatus).includes(query.status as MeetingStatus) ? { status: query.status as MeetingStatus } : {}) }, include: { project: { select: { id: true, name: true } }, participants: { where: { organizationId: user.orgId }, include: { user: { select: { id: true, name: true } } } } }, take: 500 }),
      this.prisma.googleCalendarEvent.findMany({ where: { organizationId: user.orgId, status: { not: 'cancelled' }, ...projectWhere, startsAt: interval }, include: { project: { select: { id: true, name: true } } }, take: 500 }),
    ]);

    const scopedProjectIds = [...new Set(tasks.map(task => task.projectId))];
    const [allProjectTasks, edges] = scopedProjectIds.length ? await Promise.all([
      this.prisma.task.findMany({ where: { organizationId: user.orgId, projectId: { in: scopedProjectIds } }, select: { id: true, projectId: true, status: true } }),
      this.prisma.taskDependency.findMany({ where: { organizationId: user.orgId, blockingTask: { projectId: { in: scopedProjectIds } } }, select: { blockingTaskId: true, blockedTaskId: true } }),
    ]) : [[], []];
    const criticalByProject = new Map<string, Set<string>>();
    for (const projectId of scopedProjectIds) {
      const projectTasks = allProjectTasks.filter(task => task.projectId === projectId);
      const projectTaskIds = new Set(projectTasks.map(task => task.id));
      const path = calculateCriticalPath(projectTasks, edges.filter(edge => projectTaskIds.has(edge.blockingTaskId) && projectTaskIds.has(edge.blockedTaskId)));
      criticalByProject.set(projectId, new Set(path.pathIds));
    }

    const output = [
      ...tasks.map(task => ({ id: task.id, type: 'task' as const, title: task.title, date: task.dueDate ?? task.startDate, startDate: task.startDate ?? task.dueDate ?? task.createdAt, endDate: task.dueDate ?? task.startDate ?? task.createdAt, status: task.status, priority: task.priority, projectId: task.projectId, projectName: task.project.name, assigneeId: task.assigneeId, assigneeName: task.assignee?.name ?? null, blockedBy: task.blockedBy.map(edge => ({ id: edge.blockingTask.id, title: edge.blockingTask.title, status: edge.blockingTask.status })), downstreamTaskCount: task.blocks.length, criticalPath: criticalByProject.get(task.projectId)?.has(task.id) ?? false })),
      ...projects.map(project => ({ id: project.id, type: 'project' as const, title: project.name, date: project.dueDate ?? project.startDate, startDate: project.startDate ?? project.dueDate!, endDate: project.dueDate ?? project.startDate!, status: project.status, projectId: project.id, projectName: project.name, assigneeId: project.ownerId, assigneeName: project.owner.name, blockedBy: [], criticalPath: false })),
      ...milestones.map(milestone => ({ id: milestone.id, type: 'milestone' as const, title: milestone.title, date: milestone.targetDate, startDate: milestone.targetDate, endDate: milestone.targetDate, status: milestone.completedAt ? 'COMPLETED' : 'OPEN', projectId: milestone.projectId, projectName: milestone.project.name, assigneeId: milestone.project.ownerId, assigneeName: milestone.project.owner.name, blockedBy: [], criticalPath: false })),
      ...meetings.map(meeting => ({ id: meeting.id, type: 'meeting' as const, title: meeting.title, date: meeting.startsAt, startDate: meeting.startsAt, endDate: meeting.durationMinutes && meeting.startsAt ? new Date(meeting.startsAt.getTime() + meeting.durationMinutes * 60000) : meeting.startsAt, status: meeting.status, projectId: meeting.projectId, projectName: meeting.project?.name ?? 'Workspace', assigneeId: null, assigneeName: null, participantIds: meeting.participants.map(row => row.user.id), participants: meeting.participants.map(row => row.user.name), blockedBy: [], criticalPath: false })),
      ...googleEvents.map(event => ({ id: event.id, type: 'meeting' as const, title: event.summary, date: event.startsAt, startDate: event.startsAt, endDate: event.endsAt, status: event.status.toUpperCase(), projectId: event.projectId, projectName: event.project?.name ?? 'Google Calendar', assigneeId: null, assigneeName: event.organizerEmail ?? null, participantIds: [], participants: Array.isArray(event.attendees) ? (event.attendees as any[]).map(a => a.displayName || a.email).filter(Boolean) : [], blockedBy: [], criticalPath: false, source: 'google_calendar' as const, htmlLink: event.htmlLink })),
    ].filter(event => !query.status || event.status === query.status).sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
    return { from, to, events: output };
  }
}
