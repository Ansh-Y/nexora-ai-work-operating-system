import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue, Worker } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { reminderRedisConnection } from '../notifications/reminder-policy';
import { GoogleCalendarService } from './google-calendar.service';
import { GmailIntelligenceService } from './gmail-intelligence.service';

interface GoogleSyncJobData {
  organizationId: string;
  syncCalendar?: boolean;
  syncGmail?: boolean;
}

const QUEUE_NAME = 'nexora-google-sync';

@Injectable()
export class GoogleSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GoogleSyncService.name);
  private queue?: Queue<GoogleSyncJobData>;
  private worker?: Worker<GoogleSyncJobData>;
  private stopping = false;
  private intervalTimer?: NodeJS.Timeout;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private calendarService: GoogleCalendarService,
    private gmailService: GmailIntelligenceService,
  ) {}

  async onModuleInit() {
    const redisUrl = this.config.get<string>('REDIS_URL');
    if (!redisUrl) {
      this.logger.warn('Google Workspace background sync scheduler disabled because REDIS_URL is not configured.');
      return;
    }

    try {
      const connection = reminderRedisConnection(redisUrl);
      this.queue = new Queue<GoogleSyncJobData>(QUEUE_NAME, {
        connection: { ...connection, maxRetriesPerRequest: 1, enableOfflineQueue: false },
      });

      this.worker = new Worker<GoogleSyncJobData>(
        QUEUE_NAME,
        job => this.processSyncJob(job),
        { connection, concurrency: 2, stalledInterval: 30_000 },
      );

      this.queue.on('error', err => this.logger.warn(`Google sync queue error: ${err.message}`));
      this.worker.on('error', err => this.logger.warn(`Google sync worker error: ${err.message}`));
      this.worker.on('failed', (job, err) => {
        this.logger.error(`Google sync job ${job?.id} failed on attempt ${job?.attemptsMade}/${job?.opts.attempts ?? 3}: ${err.message}`);
      });

      // Periodic check every 15 minutes to enqueue sync for all active connections
      this.intervalTimer = setInterval(() => {
        void this.enqueueAllActiveConnections();
      }, 15 * 60_000);
      this.intervalTimer.unref?.();

      this.logger.log('Google Workspace background sync queue initialized.');
    } catch (error) {
      this.logger.warn(`Google Workspace sync queue could not start: ${(error as Error).message}`);
    }
  }

  async onModuleDestroy() {
    this.stopping = true;
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }

  async enqueueSync(organizationId: string, options: { syncCalendar?: boolean; syncGmail?: boolean } = {}) {
    if (!this.queue || this.stopping) {
      // If queue is not running, run directly if needed
      return;
    }

    try {
      await this.queue.add(
        'google-sync-org',
        {
          organizationId,
          syncCalendar: options.syncCalendar ?? true,
          syncGmail: options.syncGmail ?? true,
        },
        {
          jobId: `google-sync-${organizationId}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 10_000 },
          removeOnComplete: 100,
          removeOnFail: 200,
        },
      );
    } catch (err) {
      this.logger.warn(`Could not enqueue Google sync job: ${(err as Error).message}`);
    }
  }

  private async enqueueAllActiveConnections() {
    if (this.stopping) return;
    try {
      const activeConnections = await this.prisma.googleConnection.findMany({
        where: { status: 'CONNECTED' },
        select: { organizationId: true },
      });

      for (const conn of activeConnections) {
        await this.enqueueSync(conn.organizationId);
      }
    } catch (err) {
      this.logger.warn(`Error scheduling background Google sync: ${(err as Error).message}`);
    }
  }

  private async processSyncJob(job: Job<GoogleSyncJobData>): Promise<void> {
    const { organizationId, syncCalendar, syncGmail } = job.data;
    this.logger.log(`Processing background Google sync for organization ${organizationId}`);

    if (syncCalendar !== false) {
      try {
        await this.calendarService.syncCalendar(null, organizationId, false);
      } catch (err) {
        this.logger.error(`Background calendar sync failed for org ${organizationId}: ${(err as Error).message}`);
      }
    }

    if (syncGmail !== false) {
      try {
        await this.gmailService.syncRecentEmails(null, organizationId, 20);
      } catch (err) {
        this.logger.error(`Background Gmail sync failed for org ${organizationId}: ${(err as Error).message}`);
      }
    }
  }
}
