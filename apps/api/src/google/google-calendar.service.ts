import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { Principal } from '../common/auth.types';
import { GoogleOAuthService } from './google-oauth.service';
import { AssociateCalendarEventDto, GoogleCalendarQueryDto } from './google.dto';
import { reminderRedisConnection } from '../notifications/reminder-policy';

interface GoogleEventItem {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  htmlLink?: string;
  etag?: string;
  creator?: { email?: string; displayName?: string };
  organizer?: { email?: string; displayName?: string };
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: Array<{ email?: string; displayName?: string; responseStatus?: string }>;
}

interface GoogleEventsListResponse {
  items?: GoogleEventItem[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

@Injectable()
export class GoogleCalendarService implements OnModuleDestroy {
  private readonly logger = new Logger(GoogleCalendarService.name);
  private readonly activeSyncs = new Set<string>();
  private redisClient?: Redis;
  private redisChecked = false;

  constructor(
    private prisma: PrismaService,
    private oauth: GoogleOAuthService,
    private audit: AuditService,
    private realtime: RealtimeGateway,
    private config?: ConfigService,
  ) {}

  async onModuleDestroy() {
    if (this.redisClient) {
      await this.redisClient.quit().catch(() => undefined);
    }
  }

  private getRedisClient(): Redis | null {
    if (this.redisChecked) return this.redisClient ?? null;
    this.redisChecked = true;
    const redisUrl = this.config?.get<string>('REDIS_URL');
    if (!redisUrl) return null;

    try {
      const connOptions = reminderRedisConnection(redisUrl);
      this.redisClient = new Redis({
        ...connOptions,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        lazyConnect: true,
        retryStrategy: () => null,
      });
      this.redisClient.on('error', err => {
        this.logger.debug?.(`Redis calendar lock client error: ${err.message}`);
      });
      return this.redisClient;
    } catch (err) {
      this.logger.warn(`Could not initialize Redis lock client: ${(err as Error).message}`);
      return null;
    }
  }

  private async acquireLock(organizationId: string): Promise<{ acquired: boolean; release: () => Promise<void> }> {
    if (this.activeSyncs.has(organizationId)) {
      return { acquired: false, release: async () => {} };
    }

    const redis = this.getRedisClient();
    const lockKey = `lock:google-sync:cal:${organizationId}`;
    const lockValue = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let redisAcquired = false;

    if (redis) {
      try {
        const res = await redis.set(lockKey, lockValue, 'PX', 60_000, 'NX');
        if (res !== 'OK') {
          return { acquired: false, release: async () => {} };
        }
        redisAcquired = true;
      } catch (err) {
        this.logger.warn(`Redis lock acquisition failed for org ${organizationId}, falling back to in-memory mutex: ${(err as Error).message}`);
      }
    }

    this.activeSyncs.add(organizationId);

    const release = async () => {
      this.activeSyncs.delete(organizationId);
      if (redisAcquired && redis) {
        try {
          const luaScript = `
            if redis.call('get', KEYS[1]) == ARGV[1] then
              return redis.call('del', KEYS[1])
            else
              return 0
            end
          `;
          await redis.eval(luaScript, 1, lockKey, lockValue);
        } catch (err) {
          this.logger.warn(`Failed to release Redis lock: ${(err as Error).message}`);
        }
      }
    };

    return { acquired: true, release };
  }

  async syncCalendar(
    user: Principal | null,
    organizationId: string,
    forceFullSync = false,
  ): Promise<{ syncedCount: number; message: string; fullSync: boolean }> {
    const lock = await this.acquireLock(organizationId);
    if (!lock.acquired) {
      return { syncedCount: 0, message: 'Calendar synchronization is already in progress.', fullSync: false };
    }

    let fullSync = forceFullSync;

    try {
      await this.prisma.googleConnection.update({
        where: { organizationId },
        data: { calendarSyncStatus: 'SYNCING' },
      });

      const connection = await this.prisma.googleConnection.findUnique({
        where: { organizationId },
      });

      if (!connection) {
        throw new NotFoundException('Google Workspace connection not found.');
      }

      let syncToken = !fullSync ? connection.calendarSyncToken : null;
      let accessToken = await this.oauth.getValidAccessToken(organizationId);

      // Fetch projects in workspace for calendar-to-workspace intelligence matching
      const projects = await this.prisma.project.findMany({
        where: { organizationId, archivedAt: null },
        select: { id: true, name: true, description: true },
      });

      let pageToken: string | undefined = undefined;
      let nextSyncToken: string | null = null;
      const allItems: GoogleEventItem[] = [];

      do {
        const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');

        if (pageToken) {
          url.searchParams.set('pageToken', pageToken);
        } else if (syncToken) {
          url.searchParams.set('syncToken', syncToken);
        } else {
          fullSync = true;
          url.searchParams.set('singleEvents', 'true');
          url.searchParams.set('maxResults', '250');
          // Fetch events starting from 30 days in the past up to 365 days in future
          const pastLimit = new Date(Date.now() - 30 * 86400000);
          url.searchParams.set('timeMin', pastLimit.toISOString());
        }

        let resp = await this.fetchWithRetry(url.toString(), accessToken);

        // Handle 410 Gone (invalid or expired sync token) by resetting sync token and doing full sync
        if (resp.status === 410 && syncToken) {
          this.logger.warn(`Sync token expired for org ${organizationId}. Performing full resync.`);
          syncToken = null;
          fullSync = true;
          pageToken = undefined;
          allItems.length = 0;

          await this.prisma.googleConnection.update({
            where: { organizationId },
            data: { calendarSyncToken: null },
          });

          // Re-fetch initial page without syncToken
          const resetUrl = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
          resetUrl.searchParams.set('singleEvents', 'true');
          resetUrl.searchParams.set('maxResults', '250');
          const pastLimit = new Date(Date.now() - 30 * 86400000);
          resetUrl.searchParams.set('timeMin', pastLimit.toISOString());
          resp = await this.fetchWithRetry(resetUrl.toString(), accessToken);
        }

        if (!resp.ok) {
          const errorMsg = await resp.text().catch(() => '');
          throw new ServiceUnavailableException(`Google Calendar API error (HTTP ${resp.status}): ${errorMsg}`);
        }

        const data = (await resp.json()) as GoogleEventsListResponse;
        if (Array.isArray(data.items)) {
          allItems.push(...data.items);
        }

        pageToken = data.nextPageToken;
        if (data.nextSyncToken) {
          nextSyncToken = data.nextSyncToken;
        }
      } while (pageToken);

      // Process and upsert events into database
      let syncedCount = 0;
      await this.prisma.$transaction(async tx => {
        for (const item of allItems) {
          if (!item.id) continue;

          // If cancelled, update status
          if (item.status === 'cancelled') {
            await tx.googleCalendarEvent.updateMany({
              where: { organizationId, googleEventId: item.id },
              data: { status: 'cancelled' },
            });
            syncedCount++;
            continue;
          }

          const isAllDay = Boolean(item.start?.date && !item.start?.dateTime);
          let startsAt: Date;
          let endsAt: Date;
          let originalStartDate: string | null = null;
          let originalEndDate: string | null = null;
          const timeZone: string | null = item.start?.timeZone || item.end?.timeZone || null;

          const startDateStr = item.start?.date;
          const endDateStr = item.end?.date;

          if (isAllDay && startDateStr) {
            originalStartDate = startDateStr;
            startsAt = new Date(`${startDateStr}T00:00:00.000Z`);

            // Google Calendar all-day events use exclusive end dates (e.g. 2026-11-10 to 2026-11-11 for 1 day).
            // Inclusive endsAt must be 2026-11-10T23:59:59.999Z, preventing expansion into following day.
            if (endDateStr && endDateStr > startDateStr) {
              const exclusiveEndUtc = new Date(`${endDateStr}T00:00:00.000Z`);
              endsAt = new Date(exclusiveEndUtc.getTime() - 1);
              originalEndDate = endsAt.toISOString().slice(0, 10);
            } else {
              endsAt = new Date(`${startDateStr}T23:59:59.999Z`);
              originalEndDate = startDateStr;
            }
          } else {
            startsAt = item.start?.dateTime ? new Date(item.start.dateTime) : new Date();
            endsAt = item.end?.dateTime ? new Date(item.end.dateTime) : new Date(startsAt.getTime() + 3600000);
          }

          if (!Number.isFinite(startsAt.getTime())) startsAt = new Date();
          if (!Number.isFinite(endsAt.getTime())) endsAt = new Date(startsAt.getTime() + 3600000);

          const summary = (item.summary || 'Untitled Google Event').trim().slice(0, 300);
          const description = item.description?.slice(0, 5000) ?? null;

          const eventMetadata = {
            originalStartDate,
            originalEndDate,
            timeZone,
            isAllDay,
          };

          // Suggest project association
          const suggestion = this.detectProjectAssociation(summary, description, projects);

          await tx.googleCalendarEvent.upsert({
            where: {
              organizationId_googleEventId: {
                organizationId,
                googleEventId: item.id,
              },
            },
            create: {
              organizationId,
              connectionId: connection.id,
              googleEventId: item.id,
              summary,
              description,
              location: item.location?.slice(0, 500) ?? null,
              startsAt,
              endsAt,
              isAllDay,
              status: item.status || 'confirmed',
              htmlLink: item.htmlLink ?? null,
              attendees: (item.attendees ?? []) as any,
              creatorEmail: item.creator?.email ?? null,
              organizerEmail: item.organizer?.email ?? null,
              etag: item.etag ?? null,
              suggestedProjectId: suggestion?.projectId ?? null,
              suggestionReason: suggestion?.reason ?? null,
              metadata: eventMetadata,
            },
            update: {
              summary,
              description,
              location: item.location?.slice(0, 500) ?? null,
              startsAt,
              endsAt,
              isAllDay,
              status: item.status || 'confirmed',
              htmlLink: item.htmlLink ?? null,
              attendees: (item.attendees ?? []) as any,
              creatorEmail: item.creator?.email ?? null,
              organizerEmail: item.organizer?.email ?? null,
              etag: item.etag ?? null,
              metadata: eventMetadata,
              ...(suggestion?.projectId ? { suggestedProjectId: suggestion.projectId, suggestionReason: suggestion.reason } : {}),
            },
          });

          syncedCount++;
        }

        // Update connection sync state
        await tx.googleConnection.update({
          where: { organizationId },
          data: {
            calendarSyncToken: nextSyncToken ?? connection.calendarSyncToken,
            lastCalendarSyncAt: new Date(),
            calendarSyncStatus: 'SUCCESS',
            calendarSyncError: null,
          },
        });

        await tx.auditEvent.create({
          data: {
            organizationId,
            actorType: user ? 'USER' : 'SYSTEM',
            actorId: user?.sub ?? null,
            action: 'google.calendar.synced',
            targetType: 'google_connection',
            targetId: connection.id,
            metadata: {
              syncedCount,
              fullSync,
            },
          },
        });
      });

      this.realtime.broadcast(organizationId, 'calendar.updated', {
        source: 'google_calendar',
        syncedCount,
      });

      return {
        syncedCount,
        message: `Successfully synchronized ${syncedCount} Google Calendar event(s).`,
        fullSync,
      };
    } catch (error) {
      const message = (error as Error).message || 'Failed to sync Google Calendar';
      this.logger.error(`Google Calendar sync error: ${message}`);

      await this.prisma.googleConnection.updateMany({
        where: { organizationId },
        data: {
          calendarSyncStatus: 'FAILED',
          calendarSyncError: message.slice(0, 500),
        },
      });

      throw error;
    } finally {
      await lock.release();
    }
  }

  async getEvents(user: Principal, query: GoogleCalendarQueryDto) {
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;

    const where: any = {
      organizationId: user.orgId,
      status: { not: 'cancelled' },
    };

    if (from || to) {
      where.OR = [
        {
          startsAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        },
        {
          endsAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        },
      ];
    }

    if (query.projectId) {
      where.projectId = query.projectId;
    }

    const events = await this.prisma.googleCalendarEvent.findMany({
      where,
      orderBy: { startsAt: 'asc' },
      take: query.limit ?? 100,
      include: {
        project: { select: { id: true, name: true } },
        suggestedProject: { select: { id: true, name: true } },
      },
    });

    return { events };
  }

  async getSuggestedAssociations(user: Principal) {
    const unassociated = await this.prisma.googleCalendarEvent.findMany({
      where: {
        organizationId: user.orgId,
        projectId: null,
        status: { not: 'cancelled' },
        suggestedProjectId: { not: null },
      },
      orderBy: { startsAt: 'desc' },
      take: 20,
      include: {
        suggestedProject: { select: { id: true, name: true } },
      },
    });

    return { suggestions: unassociated };
  }

  async associateEventWithProject(user: Principal, eventId: string, dto: AssociateCalendarEventDto) {
    const event = await this.prisma.googleCalendarEvent.findFirst({
      where: { id: eventId, organizationId: user.orgId },
    });

    if (!event) {
      throw new NotFoundException('Calendar event not found.');
    }

    const project = await this.prisma.project.findFirst({
      where: { id: dto.projectId, organizationId: user.orgId },
    });

    if (!project) {
      throw new NotFoundException('Project not found in this workspace.');
    }

    let meetingId: string | null = null;
    if (dto.createMeeting) {
      const durationMinutes = Math.max(15, Math.round((event.endsAt.getTime() - event.startsAt.getTime()) / 60000));
      const meeting = await this.prisma.meeting.create({
        data: {
          organizationId: user.orgId,
          projectId: project.id,
          createdById: user.sub,
          title: event.summary,
          startsAt: event.startsAt,
          durationMinutes,
          status: 'SCHEDULED',
        },
      });
      meetingId = meeting.id;
    }

    const updated = await this.prisma.googleCalendarEvent.update({
      where: { id: eventId },
      data: {
        projectId: project.id,
        suggestedProjectId: null,
        suggestionReason: null,
        ...(meetingId ? { meetingId } : {}),
      },
      include: {
        project: { select: { id: true, name: true } },
      },
    });

    await this.audit.append({
      organizationId: user.orgId,
      actorType: 'USER',
      actorId: user.sub,
      action: 'google.calendar.event_associated',
      targetType: 'google_calendar_event',
      targetId: eventId,
      metadata: {
        projectId: project.id,
        projectName: project.name,
        meetingId,
      },
    });

    this.realtime.broadcast(user.orgId, 'calendar.updated', {
        eventId,
        projectId: project.id,
    });

    return updated;
  }

  async dismissSuggestion(user: Principal, eventId: string) {
    const event = await this.prisma.googleCalendarEvent.findFirst({
      where: { id: eventId, organizationId: user.orgId },
    });

    if (!event) {
      throw new NotFoundException('Calendar event not found.');
    }

    await this.prisma.googleCalendarEvent.update({
      where: { id: eventId },
      data: {
        suggestedProjectId: null,
        suggestionReason: null,
      },
    });

    return { dismissed: true };
  }

  private detectProjectAssociation(
    summary: string,
    description: string | null,
    projects: Array<{ id: string; name: string; description: string }>,
  ): { projectId: string; reason: string } | null {
    if (!projects.length) return null;

    const text = `${summary} ${description || ''}`.toLowerCase();
    for (const project of projects) {
      const name = project.name.toLowerCase().trim();
      if (name.length >= 3 && text.includes(name)) {
        return {
          projectId: project.id,
          reason: `Event title or description mentions project "${project.name}"`,
        };
      }
    }

    return null;
  }

  private async fetchWithRetry(url: string, accessToken: string, retries = 3): Promise<Response> {
    let delay = 1000;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const resp = await fetch(url, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(20_000),
        });

        // 429 Too Many Requests or 503 Service Unavailable -> retry with backoff
        if ((resp.status === 429 || resp.status === 503) && attempt < retries) {
          this.logger.warn(`Google Calendar API rate limited (HTTP ${resp.status}). Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2;
          continue;
        }

        return resp;
      } catch (err) {
        if (attempt === retries) throw err;
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
      }
    }
    throw new ServiceUnavailableException('Google Calendar API request timed out after retries.');
  }
}
