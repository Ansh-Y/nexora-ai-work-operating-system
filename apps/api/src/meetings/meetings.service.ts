import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { MeetingActionStatus, MeetingProcessingState, MeetingStatus, OrganizationRole, Prisma, TaskStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { Principal } from '../common/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { CreateMeetingDto, ConvertMeetingActionDto, UpdateMeetingActionDto, UpdateMeetingDto } from './meetings.dto';
import { MeetingAudioStorageService, MeetingUploadFile } from './meeting-audio-storage.service';
import { MeetingJobsService } from './meeting-jobs.service';
import { SpeechToTextProvider, SPEECH_TO_TEXT_PROVIDER } from './meeting-providers';

const writers: OrganizationRole[] = [OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.PROJECT_MANAGER, OrganizationRole.TEAM_MEMBER];
const reviewers: OrganizationRole[] = [OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.PROJECT_MANAGER];

@Injectable()
export class MeetingsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private storage: MeetingAudioStorageService,
    private jobs: MeetingJobsService,
    private realtime: RealtimeGateway,
    @Inject(SPEECH_TO_TEXT_PROVIDER) private transcription: SpeechToTextProvider,
  ) {}

  async list(user: Principal, query = '', includeArchived = false) {
    const search = query.trim();
    return this.prisma.meeting.findMany({
      where: {
        organizationId: user.orgId,
        ...(includeArchived ? {} : { archivedAt: null }),
        ...(search ? { OR: [{ title: { contains: search, mode: 'insensitive' } }, { description: { contains: search, mode: 'insensitive' } }, { transcript: { contains: search, mode: 'insensitive' } }, { summary: { contains: search, mode: 'insensitive' } }] } : {}),
      },
      select: {
        id: true, title: true, description: true, startsAt: true, durationMinutes: true, status: true,
        processingState: true, processingError: true, archivedAt: true, projectId: true, summary: true,
        createdAt: true, updatedAt: true,
        project: { select: { id: true, name: true } },
        participants: { select: { user: { select: { id: true, name: true, email: true } } } },
        recordings: { orderBy: { version: 'desc' }, take: 1, select: { id: true, fileName: true, mimeType: true, sizeBytes: true, version: true, processingState: true, processingError: true } },
        _count: { select: { actionItemsReview: true, decisionsEvidence: true } },
      },
      orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });
  }

  async get(user: Principal, id: string) {
    const meeting = await this.prisma.meeting.findFirst({
      where: { id, organizationId: user.orgId, archivedAt: null },
      include: {
        project: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        participants: { where: { organizationId: user.orgId }, include: { user: { select: { id: true, name: true, email: true } } } },
        recordings: { where: { organizationId: user.orgId }, orderBy: { version: 'desc' }, select: { id: true, fileName: true, mimeType: true, sizeBytes: true, version: true, processingState: true, processingError: true, transcriptionProvider: true, createdAt: true } },
        segments: { where: { organizationId: user.orgId }, orderBy: { sequence: 'asc' } },
        decisionsEvidence: { where: { organizationId: user.orgId }, orderBy: { sequence: 'asc' } },
        actionItemsReview: { where: { organizationId: user.orgId }, orderBy: { sequence: 'asc' }, include: { assignee: { select: { id: true, name: true } }, project: { select: { id: true, name: true } }, createdTask: { select: { id: true, title: true, status: true } } } },
      },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');
    return meeting;
  }

  async create(user: Principal, dto: CreateMeetingDto) {
    this.assertWriter(user);
    if (dto.projectId) await this.ensureProject(user.orgId, dto.projectId);
    const participantIds = await this.validateParticipants(user.orgId, dto.participantIds ?? []);
    const meeting = await this.prisma.$transaction(async tx => {
      const created = await tx.meeting.create({ data: {
        organizationId: user.orgId,
        createdById: user.sub,
        title: dto.title.trim(),
        description: dto.description?.trim() ?? '',
        startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
        durationMinutes: dto.durationMinutes,
        projectId: dto.projectId,
      } });
      if (participantIds.length) await tx.meetingParticipant.createMany({ data: participantIds.map(userId => ({ organizationId: user.orgId, meetingId: created.id, userId })) });
      await tx.auditEvent.create({ data: { organizationId: user.orgId, actorType: 'USER', actorId: user.sub, action: 'meeting.created', targetType: 'meeting', targetId: created.id, metadata: { projectId: dto.projectId ?? null, participantCount: participantIds.length } } });
      return created;
    });
    return this.get(user, meeting.id);
  }

  async update(user: Principal, id: string, dto: UpdateMeetingDto) {
    this.assertWriter(user);
    await this.requireMeeting(user.orgId, id);
    if (dto.projectId) await this.ensureProject(user.orgId, dto.projectId);
    const participantIds = dto.participantIds === undefined ? undefined : await this.validateParticipants(user.orgId, dto.participantIds);
    await this.prisma.$transaction(async tx => {
      const updated = await tx.meeting.updateMany({ where: { id, organizationId: user.orgId, archivedAt: null }, data: {
        title: dto.title?.trim(), description: dto.description?.trim(),
        startsAt: dto.startsAt === undefined ? undefined : dto.startsAt ? new Date(dto.startsAt) : null,
        durationMinutes: dto.durationMinutes, projectId: dto.projectId,
      } });
      if (!updated.count) throw new NotFoundException('Meeting not found');
      if (participantIds) {
        await tx.meetingParticipant.deleteMany({ where: { meetingId: id, organizationId: user.orgId } });
        if (participantIds.length) await tx.meetingParticipant.createMany({ data: participantIds.map(userId => ({ organizationId: user.orgId, meetingId: id, userId })) });
      }
      await tx.auditEvent.create({ data: { organizationId: user.orgId, actorType: 'USER', actorId: user.sub, action: 'meeting.updated', targetType: 'meeting', targetId: id, metadata: { changed: Object.keys(dto) } } });
    });
    return this.get(user, id);
  }

  async archive(user: Principal, id: string) {
    this.assertWriter(user);
    const meeting = await this.requireMeeting(user.orgId, id);
    await this.prisma.$transaction(async tx => {
      await tx.meeting.updateMany({ where: { id, organizationId: user.orgId, archivedAt: null }, data: { archivedAt: new Date() } });
      await tx.auditEvent.create({ data: { organizationId: user.orgId, actorType: 'USER', actorId: user.sub, action: 'meeting.archived', targetType: 'meeting', targetId: id, metadata: { title: meeting.title } } });
    });
    return { archived: true };
  }

  async uploadRecording(user: Principal, meetingId: string, file: MeetingUploadFile) {
    this.assertWriter(user);
    const meeting = await this.requireMeeting(user.orgId, meetingId);
    const audio = this.storage.validateUpload(file);
    const latest = await this.prisma.meetingRecording.findFirst({ where: { meetingId, organizationId: user.orgId }, orderBy: { version: 'desc' }, select: { version: true } });
    const recordingId = randomUUID();
    const version = (latest?.version ?? 0) + 1;
    const configured = this.transcription.isConfigured();
    const state = configured ? MeetingProcessingState.QUEUED : MeetingProcessingState.AWAITING_CONFIGURATION;
    const processingError = configured ? null : 'Audio is safely stored. Configure TRANSCRIPTION_API_KEY or OPENAI_API_KEY to start transcription.';
    const storageKey = await this.storage.store(user.orgId, recordingId, audio);
    try {
      await this.prisma.$transaction(async tx => {
        await tx.meetingRecording.create({ data: { id: recordingId, organizationId: user.orgId, meetingId, uploadedById: user.sub, storageKey, fileName: audio.fileName, mimeType: audio.mimeType, sizeBytes: audio.sizeBytes, sha256: audio.sha256, version, processingState: state, processingError, processingGeneration: configured ? 1 : 0 } });
        await tx.meeting.update({ where: { id: meetingId }, data: { processingState: state, processingError, status: configured ? MeetingStatus.PROCESSING : meeting.status, summary: null, summaryEvidence: Prisma.DbNull, analysisRecordingId: null } });
        await tx.auditEvent.create({ data: { organizationId: user.orgId, actorType: 'USER', actorId: user.sub, action: 'meeting.recording.uploaded', targetType: 'meeting', targetId: meetingId, metadata: { recordingId, fileName: audio.fileName, mimeType: audio.mimeType, sizeBytes: audio.sizeBytes, version } } });
      });
    } catch (error) {
      await this.storage.remove(user.orgId, storageKey).catch(() => undefined);
      throw error;
    }
    const queued = configured ? await this.jobs.enqueue({ organizationId: user.orgId, meetingId, recordingId, generation: 1 }) : false;
    const result = await this.get(user, meetingId);
    return { meeting: result, recordingId, queued, configurationRequired: !configured, message: processingError };
  }

  async recordingStream(user: Principal, meetingId: string, recordingId: string) {
    await this.requireMeeting(user.orgId, meetingId);
    const recording = await this.prisma.meetingRecording.findFirst({ where: { id: recordingId, meetingId, organizationId: user.orgId }, select: { storageKey: true, mimeType: true, fileName: true } });
    if (!recording) throw new NotFoundException('Recording not found');
    return { stream: await this.storage.stream(user.orgId, recording.storageKey), mimeType: recording.mimeType, fileName: recording.fileName };
  }

  async retryProcessing(user: Principal, meetingId: string, recordingId: string) {
    this.assertWriter(user);
    await this.requireMeeting(user.orgId, meetingId);
    return this.jobs.retry(user, meetingId, recordingId);
  }

  async updateAction(user: Principal, meetingId: string, actionId: string, dto: UpdateMeetingActionDto) {
    this.assertWriter(user);
    const action = await this.getAction(user.orgId, meetingId, actionId);
    if (action.status !== MeetingActionStatus.EXTRACTED) throw new BadRequestException('Only unreviewed meeting actions can be edited');
    if (dto.assigneeId) await this.ensureMember(user.orgId, dto.assigneeId);
    if (dto.projectId) await this.ensureProject(user.orgId, dto.projectId);
    const updated = await this.prisma.meetingActionItem.updateMany({ where: { id: actionId, meetingId, organizationId: user.orgId, status: MeetingActionStatus.EXTRACTED }, data: {
      title: dto.title?.trim(), description: dto.description?.trim(), assigneeId: dto.assigneeId,
      projectId: dto.projectId, dueDate: dto.dueDate === undefined ? undefined : dto.dueDate ? new Date(dto.dueDate) : null,
    } });
    if (!updated.count) throw new BadRequestException('This meeting action has already been reviewed');
    await this.audit.append({ organizationId: user.orgId, actorType: 'USER', actorId: user.sub, action: 'meeting.action.updated', targetType: 'meeting_action', targetId: actionId, metadata: { changed: Object.keys(dto), meetingId } });
    return this.getAction(user.orgId, meetingId, actionId);
  }

  async approveAction(user: Principal, meetingId: string, actionId: string) {
    this.assertReviewer(user);
    await this.requireMeeting(user.orgId, meetingId);
    const current = await this.getAction(user.orgId, meetingId, actionId);
    if (current.status !== MeetingActionStatus.EXTRACTED) throw new BadRequestException('Meeting action was already reviewed or does not exist');
    if (current.expiresAt && current.expiresAt <= new Date()) {
      await this.markActionExpired(user, meetingId, actionId, [MeetingActionStatus.EXTRACTED]);
      throw new BadRequestException('This meeting action review has expired');
    }
    const result = await this.prisma.$transaction(async tx => {
      const claimed = await tx.meetingActionItem.updateMany({ where: { id: actionId, meetingId, organizationId: user.orgId, status: MeetingActionStatus.EXTRACTED, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, data: { status: MeetingActionStatus.APPROVED, approvedById: user.sub } });
      if (!claimed.count) throw new BadRequestException('Meeting action was already reviewed or does not exist');
      await tx.auditEvent.create({ data: { organizationId: user.orgId, actorType: 'USER', actorId: user.sub, action: 'meeting.action.approved', targetType: 'meeting_action', targetId: actionId, metadata: { meetingId } } });
      return tx.meetingActionItem.findFirstOrThrow({ where: { id: actionId, meetingId, organizationId: user.orgId } });
    });
    return result;
  }

  async rejectAction(user: Principal, meetingId: string, actionId: string) {
    this.assertReviewer(user);
    await this.requireMeeting(user.orgId, meetingId);
    const current = await this.getAction(user.orgId, meetingId, actionId);
    if (current.status !== MeetingActionStatus.EXTRACTED) throw new BadRequestException('Meeting action was already reviewed or does not exist');
    if (current.expiresAt && current.expiresAt <= new Date()) {
      await this.markActionExpired(user, meetingId, actionId, [MeetingActionStatus.EXTRACTED]);
      throw new BadRequestException('This meeting action review has expired');
    }
    return this.prisma.$transaction(async tx => {
      const claimed = await tx.meetingActionItem.updateMany({ where: { id: actionId, meetingId, organizationId: user.orgId, status: MeetingActionStatus.EXTRACTED, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, data: { status: MeetingActionStatus.REJECTED, approvedById: user.sub } });
      if (!claimed.count) throw new BadRequestException('Meeting action was already reviewed or does not exist');
      await tx.auditEvent.create({ data: { organizationId: user.orgId, actorType: 'USER', actorId: user.sub, action: 'meeting.action.rejected', targetType: 'meeting_action', targetId: actionId, metadata: { meetingId } } });
      return tx.meetingActionItem.findFirstOrThrow({ where: { id: actionId, meetingId, organizationId: user.orgId } });
    });
  }

  async convertAction(user: Principal, meetingId: string, actionId: string, dto: ConvertMeetingActionDto) {
    this.assertReviewer(user);
    await this.requireMeeting(user.orgId, meetingId);
    const existing = await this.getAction(user.orgId, meetingId, actionId);
    if (existing.status === MeetingActionStatus.CONVERTED && existing.createdTaskId) return { task: existing.createdTask, duplicate: true };
    if (existing.status !== MeetingActionStatus.APPROVED) throw new BadRequestException('Approve the meeting action before creating a task');
    if (existing.expiresAt && existing.expiresAt <= new Date()) {
      await this.markActionExpired(user, meetingId, actionId, [MeetingActionStatus.APPROVED]);
      throw new BadRequestException('This meeting action approval has expired');
    }
    const projectId = dto.projectId ?? existing.projectId;
    if (!projectId) throw new BadRequestException('Choose a project before converting this meeting action');
    await this.ensureProject(user.orgId, projectId);
    const assigneeId = dto.assigneeId ?? existing.assigneeId;
    if (assigneeId) await this.ensureMember(user.orgId, assigneeId);
    const dueDate = dto.dueDate ? new Date(dto.dueDate) : existing.dueDate;
    const task = await this.prisma.$transaction(async tx => {
      const claimed = await tx.meetingActionItem.updateMany({ where: { id: actionId, meetingId, organizationId: user.orgId, status: MeetingActionStatus.APPROVED, createdTaskId: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, data: { status: MeetingActionStatus.CONVERTED } });
      if (!claimed.count) throw new BadRequestException('This meeting action was converted by another request');
      const created = await tx.task.create({ data: {
        organizationId: user.orgId, projectId, assigneeId, title: existing.title,
        description: `${existing.description}${existing.description ? '\n\n' : ''}Meeting: ${existing.meeting.title}\nEvidence: “${existing.evidence}”`,
        status: TaskStatus.TODO, priority: 'MEDIUM', dueDate: dueDate ?? undefined,
      } });
      await tx.meetingActionItem.update({ where: { id: actionId }, data: { createdTaskId: created.id, projectId, assigneeId, dueDate } });
      await tx.auditEvent.create({ data: { organizationId: user.orgId, actorType: 'USER', actorId: user.sub, action: 'meeting.action.converted', targetType: 'meeting_action', targetId: actionId, metadata: { meetingId, projectId, taskId: created.id, assigneeId, dueDate } } });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    this.realtime.broadcast(user.orgId, 'project.updated', { projectId, action: 'meeting_action_converted', taskId: task.id });
    return { task, duplicate: false };
  }

  private async getAction(organizationId: string, meetingId: string, id: string) {
    const action = await this.prisma.meetingActionItem.findFirst({ where: { id, meetingId, organizationId }, include: { meeting: { select: { title: true } }, createdTask: { select: { id: true, title: true, status: true } } } });
    if (!action) throw new NotFoundException('Meeting action not found');
    return action;
  }

  private async markActionExpired(user: Principal, meetingId: string, actionId: string, statuses: MeetingActionStatus[]) {
    await this.prisma.$transaction(async tx => {
      const updated = await tx.meetingActionItem.updateMany({ where: { id: actionId, meetingId, organizationId: user.orgId, status: { in: statuses }, expiresAt: { lte: new Date() } }, data: { status: MeetingActionStatus.EXPIRED } });
      if (updated.count) await tx.auditEvent.create({ data: { organizationId: user.orgId, actorType: 'SYSTEM', action: 'meeting.action.expired', targetType: 'meeting_action', targetId: actionId, metadata: { meetingId } } });
    });
  }

  private async requireMeeting(organizationId: string, id: string) {
    const meeting = await this.prisma.meeting.findFirst({ where: { id, organizationId, archivedAt: null } });
    if (!meeting) throw new NotFoundException('Meeting not found');
    return meeting;
  }

  private async ensureProject(organizationId: string, projectId: string) {
    if (!await this.prisma.project.findFirst({ where: { id: projectId, organizationId }, select: { id: true } })) throw new NotFoundException('Project not found');
  }

  private async ensureMember(organizationId: string, userId: string) {
    if (!await this.prisma.membership.findFirst({ where: { organizationId, userId }, select: { id: true } })) throw new BadRequestException('Select a current member of this workspace');
  }

  private async validateParticipants(organizationId: string, ids: string[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) return unique;
    const rows = await this.prisma.membership.findMany({ where: { organizationId, userId: { in: unique } }, select: { userId: true } });
    if (rows.length !== unique.length) throw new BadRequestException('Every meeting participant must belong to this workspace');
    return unique;
  }

  private assertWriter(user: Principal) {
    if (!writers.includes(user.role)) throw new ForbiddenException('You do not have permission to change meetings');
  }

  private assertReviewer(user: Principal) {
    if (!reviewers.includes(user.role)) throw new ForbiddenException('A project manager must review meeting actions');
  }
}
