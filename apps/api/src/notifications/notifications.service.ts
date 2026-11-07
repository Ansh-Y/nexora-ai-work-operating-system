import { Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationType } from '@prisma/client';
import { Queue, Worker } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { Principal } from '../common/auth.types';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { deadlineReminderEventKey, isDeadlineReminderEligible, nextSchedulerRetryDelay, REMINDER_JOB_OPTIONS, REMINDER_QUEUE_NAME, REMINDER_SCHEDULER_ID, REMINDER_SCHEDULE, reminderJobTemplate, reminderRedisConnection } from './reminder-policy';

@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private queue?: Queue;
  private worker?: Worker;
  private schedulerRetryTimer?: NodeJS.Timeout;
  private schedulerRetryDelay = 1_000;
  private destroying = false;
  constructor(private prisma: PrismaService, private realtime: RealtimeGateway, private config: ConfigService) {}

  async onModuleInit() {
    const value = this.config.get<string>('REDIS_URL');
    if (!value) { this.logger.warn('Deadline reminders are disabled because REDIS_URL is not configured'); return; }
    try {
      const connection = reminderRedisConnection(value);
      this.queue = new Queue(REMINDER_QUEUE_NAME, { connection });
      this.worker = new Worker(REMINDER_QUEUE_NAME, async job => {
        if (job.name === 'deadline-sweep') await this.runDeadlineSweep();
      }, { connection, concurrency: 1, maxStalledCount: 2, stalledInterval: 30_000 });
      this.queue.on('error', error => this.logger.warn(`Reminder queue connection error: ${error.message}`));
      this.worker.on('error', error => this.logger.warn(`Reminder worker connection error: ${error.message}`));
      this.worker.on('failed', (job, error) => this.logger.error(`Deadline reminder job ${job?.id || 'unknown'} failed on attempt ${job?.attemptsMade ?? 0}/${job?.opts.attempts ?? REMINDER_JOB_OPTIONS.attempts}: ${error.message}`));
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
        this.schedulerRetryTimer = setTimeout(() => { void this.ensureScheduler(); }, this.schedulerRetryDelay);
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
        select: { id: true, organizationId: true, assigneeId: true, title: true, dueDate: true, status: true, project: { select: { name: true } } },
        orderBy: [{ dueDate: 'asc' }, { id: 'asc' }], take: 500,
        ...(taskCursor ? { cursor: { id: taskCursor }, skip: 1 } : {}),
      });
      for (const task of tasks) {
        if (!task.assigneeId || !task.dueDate || !isDeadlineReminderEligible(task.status, task.dueDate, now)) continue;
        const overdue = task.dueDate < now;
        await this.notifyUsers(task.organizationId, [task.assigneeId], 'DEADLINE', overdue ? 'Task deadline has passed' : 'Task deadline is approaching', `${task.title} · ${task.project.name}`, deadlineReminderEventKey(task.id, task.dueDate, now));
      }
      if (tasks.length < 500) break;
      taskCursor = tasks.at(-1)?.id;
    }
    let milestoneCursor: string | undefined;
    for (;;) {
      const milestones = await this.prisma.milestone.findMany({
        where: { targetDate: { lte: horizon }, completedAt: null },
        select: { id: true, organizationId: true, title: true, targetDate: true, project: { select: { name: true, ownerId: true } } },
        orderBy: [{ targetDate: 'asc' }, { id: 'asc' }], take: 500,
        ...(milestoneCursor ? { cursor: { id: milestoneCursor }, skip: 1 } : {}),
      });
      for (const milestone of milestones) {
        if (!milestone.targetDate) continue;
        await this.notifyUsers(milestone.organizationId, [milestone.project.ownerId], 'MILESTONE', 'Milestone deadline is approaching', `${milestone.title} · ${milestone.project.name}`, `milestone:${milestone.id}:${milestone.targetDate.toISOString()}:${now.toISOString().slice(0, 10)}`);
      }
      if (milestones.length < 500) break;
      milestoneCursor = milestones.at(-1)?.id;
    }
  }
  async notifyUsers(organizationId: string, userIds: string[], type: NotificationType, title: string, body: string, eventKey: string) {
    const recipients = [...new Set(userIds)].filter(Boolean);
    if (!recipients.length) return 0;
    const members = await this.prisma.membership.findMany({ where: { organizationId, userId: { in: recipients } }, select: { userId: true } });
    const allowedRecipients = members.map(member => member.userId);
    if (!allowedRecipients.length) return 0;
    const result = await this.prisma.notification.createMany({
      data: allowedRecipients.map(userId => ({ organizationId, userId, type, title, body, dedupeKey: `${eventKey}:${userId}` })),
      skipDuplicates: true,
    });
    if (result.count) this.realtime.broadcastToUsers(organizationId, allowedRecipients, 'notification.created', { count: result.count });
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
  async list(user: Principal) {
    const [items, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({ where: { organizationId: user.orgId, userId: user.sub }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.notification.count({ where: { organizationId: user.orgId, userId: user.sub, readAt: null } }),
    ]);
    return { items, unreadCount };
  }
  async read(user: Principal, id: string) {
    const found = await this.prisma.notification.findFirst({ where: { id, organizationId: user.orgId, userId: user.sub } });
    if (!found) throw new NotFoundException('Notification not found');
    return this.prisma.notification.update({ where: { id }, data: { readAt: found.readAt || new Date() } });
  }
  async readAll(user: Principal) {
    const result = await this.prisma.notification.updateMany({ where: { organizationId: user.orgId, userId: user.sub, readAt: null }, data: { readAt: new Date() } });
    return { updated: result.count };
  }
}
