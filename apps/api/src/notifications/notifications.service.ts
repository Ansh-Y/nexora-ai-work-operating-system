import { Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationCategory, NotificationPriority, NotificationType, Prisma } from '@prisma/client';
import { Queue, Worker } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { Principal } from '../common/auth.types';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import {
  deadlineReminderEventKey,
  isDeadlineReminderEligible,
  nextSchedulerRetryDelay,
  REMINDER_JOB_OPTIONS,
  REMINDER_QUEUE_NAME,
  REMINDER_SCHEDULER_ID,
  REMINDER_SCHEDULE,
  reminderJobTemplate,
  reminderRedisConnection,
} from './reminder-policy';
import { SmartNotificationEngine } from './notifications.engine';
import { ListNotificationsQueryDto, UpdateNotificationPreferencesDto } from './notifications.dto';

export interface SmartNotificationOptions {
  category?: NotificationCategory;
  priority?: NotificationPriority;
  actionUrl?: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private queue?: Queue;
  private worker?: Worker;
  private schedulerRetryTimer?: NodeJS.Timeout;
  private schedulerRetryDelay = 1_000;
  private destroying = false;

  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeGateway,
    private config: ConfigService,
  ) {}

  async onModuleInit() {
    const value = this.config.get<string>('REDIS_URL');
    if (!value) {
      this.logger.warn('Deadline reminders are disabled because REDIS_URL is not configured');
      return;
    }
    try {
      const connection = reminderRedisConnection(value);
      this.queue = new Queue(REMINDER_QUEUE_NAME, { connection });
      this.worker = new Worker(
        REMINDER_QUEUE_NAME,
        async job => {
          if (job.name === 'deadline-sweep') await this.runDeadlineSweep();
        },
        { connection, concurrency: 1, maxStalledCount: 2, stalledInterval: 30_000 },
      );
      this.queue.on('error', error => this.logger.warn(`Reminder queue connection error: ${error.message}`));
      this.worker.on('error', error => this.logger.warn(`Reminder worker connection error: ${error.message}`));
      this.worker.on('failed', (job, error) =>
        this.logger.error(
          `Deadline reminder job ${job?.id || 'unknown'} failed on attempt ${job?.attemptsMade ?? 0}/${
            job?.opts.attempts ?? REMINDER_JOB_OPTIONS.attempts
          }: ${error.message}`,
        ),
      );
      // Do not block API startup while Redis is unavailable. BullMQ reconnects its
      // clients, and this bounded retry ensures the UTC scheduler is installed later.
      void this.ensureScheduler();
    } catch (error) {
      this.logger.error(`Deadline reminders could not start: ${(error as Error).message}`);
    }
  }

  async onModuleDestroy() {
    this.destroying = true;
    if (this.schedulerRetryTimer) clearTimeout(this.schedulerRetryTimer);
    // Worker.close waits for an active processor to finish before closing Redis.
    await this.worker?.close();
    await this.queue?.close();
  }

  private async ensureScheduler() {
    if (!this.queue || this.destroying) return;
    try {
      await this.queue.upsertJobScheduler(REMINDER_SCHEDULER_ID, REMINDER_SCHEDULE, reminderJobTemplate());
      this.schedulerRetryDelay = 1_000;
      this.logger.log('Daily deadline reminder scheduler is ready (09:00 UTC)');
    } catch (error) {
      this.logger.warn(`Could not install deadline reminder scheduler; retrying: ${(error as Error).message}`);
      if (!this.destroying) {
        this.schedulerRetryTimer = setTimeout(() => {
          void this.ensureScheduler();
        }, this.schedulerRetryDelay);
        this.schedulerRetryTimer.unref?.();
        this.schedulerRetryDelay = nextSchedulerRetryDelay(this.schedulerRetryDelay);
      }
    }
  }

  async runDeadlineSweep(now = new Date()) {
    const horizon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    let taskCursor: string | undefined;
    for (;;) {
      const tasks = await this.prisma.task.findMany({
        where: { dueDate: { lte: horizon }, status: { notIn: ['DONE', 'CANCELLED'] }, assigneeId: { not: null } },
        select: {
          id: true,
          projectId: true,
          organizationId: true,
          assigneeId: true,
          title: true,
          dueDate: true,
          status: true,
          priority: true,
          project: { select: { name: true } },
        },
        orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
        take: 500,
        ...(taskCursor ? { cursor: { id: taskCursor }, skip: 1 } : {}),
      });

      for (const task of tasks) {
        if (!task.assigneeId || !task.dueDate || !isDeadlineReminderEligible(task.status, task.dueDate, now)) continue;
        const overdue = task.dueDate < now;
        await this.notifyUsers(
          task.organizationId,
          [task.assigneeId],
          NotificationType.DEADLINE,
          overdue ? 'Task deadline has passed' : 'Task deadline is approaching',
          `${task.title} · ${task.project.name}`,
          deadlineReminderEventKey(task.id, task.dueDate, now),
          {
            category: NotificationCategory.TASK,
            priority: overdue ? NotificationPriority.HIGH : NotificationPriority.MEDIUM,
            actionUrl: `/tasks?id=${task.id}`,
            metadata: {
              taskId: task.id,
              projectId: task.projectId,
              projectName: task.project.name,
              overdue,
              dueDate: task.dueDate.toISOString(),
            },
          },
        );
      }
      if (tasks.length < 500) break;
      taskCursor = tasks.at(-1)?.id;
    }

    let milestoneCursor: string | undefined;
    for (;;) {
      const milestones = await this.prisma.milestone.findMany({
        where: { targetDate: { lte: horizon }, completedAt: null },
        select: {
          id: true,
          projectId: true,
          organizationId: true,
          title: true,
          targetDate: true,
          project: { select: { id: true, name: true, ownerId: true } },
        },
        orderBy: [{ targetDate: 'asc' }, { id: 'asc' }],
        take: 500,
        ...(milestoneCursor ? { cursor: { id: milestoneCursor }, skip: 1 } : {}),
      });

      for (const milestone of milestones) {
        if (!milestone.targetDate) continue;
        await this.notifyUsers(
          milestone.organizationId,
          [milestone.project.ownerId],
          NotificationType.MILESTONE,
          'Milestone deadline is approaching',
          `${milestone.title} · ${milestone.project.name}`,
          `milestone:${milestone.id}:${milestone.targetDate.toISOString()}:${now.toISOString().slice(0, 10)}`,
          {
            category: NotificationCategory.PROJECT,
            priority: NotificationPriority.MEDIUM,
            actionUrl: `/projects?id=${milestone.projectId}`,
            metadata: {
              milestoneId: milestone.id,
              projectId: milestone.projectId,
              projectName: milestone.project.name,
              targetDate: milestone.targetDate.toISOString(),
            },
          },
        );
      }
      if (milestones.length < 500) break;
      milestoneCursor = milestones.at(-1)?.id;
    }
  }

  /**
   * Unified notification dispatcher supporting both legacy callers and Release 4.2.5 smart options.
   * Enforces multi-tenant organization authorization, user preferences, and deduplication.
   */
  async notifyUsers(
    organizationId: string,
    userIds: string[],
    type: NotificationType,
    title: string,
    body: string,
    eventKey: string,
    options?: SmartNotificationOptions,
  ): Promise<number> {
    const recipients = [...new Set(userIds)].filter(Boolean);
    if (!recipients.length) return 0;

    // 1. Multi-tenant authorization boundary: only allow users who are active members of this organization
    const members = await this.prisma.membership.findMany({
      where: { organizationId, userId: { in: recipients } },
      select: { userId: true },
    });
    const allowedRecipients = members.map(member => member.userId);
    if (!allowedRecipients.length) return 0;

    // 2. Classify semantic category and priority deterministically
    const category = options?.category ?? SmartNotificationEngine.classifyCategory(type);
    const priority =
      options?.priority ?? SmartNotificationEngine.classifyPriority(type, options?.metadata, title, body);

    // 3. User Notification Preferences Evaluation
    const preferences = await this.prisma.notificationPreference.findMany({
      where: { organizationId, userId: { in: allowedRecipients } },
    });
    const prefMap = new Map(preferences.map(p => [p.userId, p]));

    const eligibleUserIds = allowedRecipients.filter(userId =>
      SmartNotificationEngine.isEligibleForUser(prefMap.get(userId), category, priority, type),
    );
    if (!eligibleUserIds.length) return 0;

    // 4. Batch creation with stable deduplication key
    const rows = eligibleUserIds.map(userId => ({
      organizationId,
      userId,
      type,
      category,
      priority,
      title,
      body,
      actionUrl: options?.actionUrl || null,
      metadata: options?.metadata ? (options.metadata as any) : undefined,
      dedupeKey: SmartNotificationEngine.buildDedupeKey(eventKey, userId),
    }));

    const result = await this.prisma.notification.createMany({
      data: rows,
      skipDuplicates: true,
    });

    // 5. Broadcast real-time WebSocket event to online user rooms
    if (result.count > 0) {
      this.realtime.broadcastToUsers(organizationId, eligibleUserIds, 'notification.created', {
        count: result.count,
        category,
        priority,
        type,
        title,
        body,
        actionUrl: options?.actionUrl || null,
      });
    }

    return result.count;
  }

  async queueStatus() {
    if (!this.queue) return { configured: false, counts: null };
    const [counts, paused] = await Promise.all([
      this.queue.getJobCounts('wait', 'active', 'completed', 'failed', 'delayed'),
      this.queue.isPaused(),
    ]);
    return { configured: true, counts, paused };
  }

  /**
   * Retrieves user notifications with multi-dimensional filtering, searching, and unread aggregations.
   * Strictly scopes all queries to `organizationId: user.orgId` and `userId: user.sub`.
   */
  async list(user: Principal, query?: ListNotificationsQueryDto) {
    const limit = Math.min(query?.limit ?? 50, 200);
    const offset = query?.offset ?? 0;

    const where: Prisma.NotificationWhereInput = {
      organizationId: user.orgId,
      userId: user.sub,
      dismissedAt: null,
    };

    if (query?.category) {
      where.category = query.category;
    }
    if (query?.priority) {
      where.priority = query.priority;
    }
    if (query?.status === 'unread') {
      where.readAt = null;
    } else if (query?.status === 'read') {
      where.readAt = { not: null };
    }
    if (query?.search && query.search.trim()) {
      const s = query.search.trim();
      where.OR = [
        { title: { contains: s, mode: 'insensitive' } },
        { body: { contains: s, mode: 'insensitive' } },
      ];
    }

    const [items, total, unreadCount, categoryGroup, priorityGroup] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({
        where: { organizationId: user.orgId, userId: user.sub, readAt: null, dismissedAt: null },
      }),
      this.prisma.notification.groupBy({
        by: ['category'],
        where: { organizationId: user.orgId, userId: user.sub, readAt: null, dismissedAt: null },
        _count: { _all: true },
      }),
      this.prisma.notification.groupBy({
        by: ['priority'],
        where: { organizationId: user.orgId, userId: user.sub, readAt: null, dismissedAt: null },
        _count: { _all: true },
      }),
    ]);

    const countsByCategory: Record<string, number> = {
      PROJECT: 0,
      TASK: 0,
      AI: 0,
      TEAM: 0,
    };
    for (const row of categoryGroup) {
      countsByCategory[row.category] = row._count._all;
    }

    const countsByPriority: Record<string, number> = {
      CRITICAL: 0,
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0,
    };
    for (const row of priorityGroup) {
      countsByPriority[row.priority] = row._count._all;
    }

    return {
      items,
      total,
      unreadCount,
      countsByCategory,
      countsByPriority,
    };
  }

  /**
   * Marks a notification as read, validating ownership.
   */
  async read(user: Principal, id: string) {
    const found = await this.prisma.notification.findFirst({
      where: { id, organizationId: user.orgId, userId: user.sub, dismissedAt: null },
    });
    if (!found) throw new NotFoundException('Notification not found');

    const updated = await this.prisma.notification.update({
      where: { id },
      data: { readAt: found.readAt || new Date() },
    });

    this.realtime.broadcastToUsers(user.orgId, [user.sub], 'notification.read', { id, readAt: updated.readAt });
    return updated;
  }

  /**
   * Marks all unread notifications as read, with optional category filtering.
   */
  async readAll(user: Principal, category?: NotificationCategory) {
    const where: Prisma.NotificationWhereInput = {
      organizationId: user.orgId,
      userId: user.sub,
      readAt: null,
      dismissedAt: null,
    };
    if (category) where.category = category;

    const result = await this.prisma.notification.updateMany({
      where,
      data: { readAt: new Date() },
    });

    this.realtime.broadcastToUsers(user.orgId, [user.sub], 'notification.read_all', {
      category,
      updated: result.count,
    });

    return { updated: result.count };
  }

  /**
   * Dismisses (soft deletes) a single notification, validating ownership.
   */
  async dismiss(user: Principal, id: string) {
    const found = await this.prisma.notification.findFirst({
      where: { id, organizationId: user.orgId, userId: user.sub, dismissedAt: null },
    });
    if (!found) throw new NotFoundException('Notification not found');

    const updated = await this.prisma.notification.update({
      where: { id },
      data: { dismissedAt: new Date() },
    });

    this.realtime.broadcastToUsers(user.orgId, [user.sub], 'notification.dismissed', { id });
    return updated;
  }

  /**
   * Dismisses all notifications matching user context and optional category filter.
   */
  async dismissAll(user: Principal, category?: NotificationCategory) {
    const where: Prisma.NotificationWhereInput = {
      organizationId: user.orgId,
      userId: user.sub,
      dismissedAt: null,
    };
    if (category) where.category = category;

    const result = await this.prisma.notification.updateMany({
      where,
      data: { dismissedAt: new Date() },
    });

    this.realtime.broadcastToUsers(user.orgId, [user.sub], 'notification.dismiss_all', {
      category,
      dismissed: result.count,
    });

    return { dismissed: result.count };
  }

  /**
   * Retrieves or creates default notification preferences for the user.
   */
  async getPreferences(user: Principal) {
    let pref = await this.prisma.notificationPreference.findUnique({
      where: { organizationId_userId: { organizationId: user.orgId, userId: user.sub } },
    });
    if (!pref) {
      pref = await this.prisma.notificationPreference.create({
        data: {
          organizationId: user.orgId,
          userId: user.sub,
        },
      });
    }
    return pref;
  }

  /**
   * Updates notification preferences for the current user.
   */
  async updatePreferences(user: Principal, dto: UpdateNotificationPreferencesDto) {
    const updated = await this.prisma.notificationPreference.upsert({
      where: { organizationId_userId: { organizationId: user.orgId, userId: user.sub } },
      create: {
        organizationId: user.orgId,
        userId: user.sub,
        ...dto,
      },
      update: {
        ...dto,
      },
    });

    return updated;
  }
}
