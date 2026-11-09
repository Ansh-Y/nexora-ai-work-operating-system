import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotificationCategory, NotificationPriority, NotificationType, OrganizationRole, TaskStatus } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { MEETING_ANALYSIS_PROVIDER, SPEECH_TO_TEXT_PROVIDER } from '../src/meetings/meeting-providers';
import { meetingTestAnalysisProvider, meetingTestSpeechProvider } from './meeting-provider-fixtures';

describe('AI Smart Notifications (Release 4.2.5 e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let notifService: NotificationsService;
  let ownerToken: string;
  let memberToken: string;
  let foreignOwnerToken: string;
  let orgId: string;
  let foreignOrgId: string;
  let ownerId: string;
  let memberId: string;
  let foreignUserId: string;
  let projectId: string;
  let testNotificationId: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SPEECH_TO_TEXT_PROVIDER).useValue(meetingTestSpeechProvider)
      .overrideProvider(MEETING_ANALYSIS_PROVIDER).useValue(meetingTestAnalysisProvider)
      .compile();

    app = module.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);
    notifService = app.get(NotificationsService);

    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

    // 1. Primary workspace owner
    const regRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        name: 'Smart Notif Owner',
        email: `notif-owner-${stamp}@nexora.test`,
        password: 'Password!2026',
        organizationName: `Notif Org ${stamp}`,
      })
      .expect(201);
    ownerToken = regRes.body.accessToken;
    orgId = regRes.body.workspace.id;
    ownerId = regRes.body.user.id;

    // 2. Add Team Member in Primary workspace
    const memberUser = await prisma.user.create({
      data: {
        name: 'Notif Member',
        email: `notif-member-${stamp}@nexora.test`,
        passwordHash: 'hashed_password_placeholder',
      },
    });
    memberId = memberUser.id;
    await prisma.membership.create({
      data: {
        organizationId: orgId,
        userId: memberId,
        role: OrganizationRole.TEAM_MEMBER,
      },
    });

    const jwtService = module.get(JwtService);
    memberToken = jwtService.sign({
      sub: memberId,
      orgId,
      role: OrganizationRole.TEAM_MEMBER,
      email: memberUser.email,
    });

    // 3. Foreign workspace owner (for multi-tenant isolation testing)
    const foreignReg = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        name: 'Foreign Lead',
        email: `foreign-lead-${stamp}@nexora.test`,
        password: 'Password!2026',
        organizationName: `Foreign Notif Org ${stamp}`,
      })
      .expect(201);
    foreignOwnerToken = foreignReg.body.accessToken;
    foreignOrgId = foreignReg.body.workspace.id;
    foreignUserId = foreignReg.body.user.id;

    // 4. Create primary project
    const projRes = await request(app.getHttpServer())
      .post('/api/projects')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Quantum Engine',
        description: 'Next-gen distributed execution runtime',
      })
      .expect(201);
    projectId = projRes.body.id;

    // 5. Seed test smart notifications across categories and priorities
    await notifService.notifyUsers(
      orgId,
      [ownerId],
      NotificationType.PROJECT_HEALTH,
      'Critical Health Alert: Quantum Engine',
      'Project health dropped to CRITICAL (42/100).',
      `test_health_${stamp}`,
      {
        category: NotificationCategory.PROJECT,
        priority: NotificationPriority.CRITICAL,
        actionUrl: `/health?projectId=${projectId}`,
        metadata: { projectId, score: 42 },
      },
    );

    await notifService.notifyUsers(
      orgId,
      [ownerId],
      NotificationType.DEADLINE,
      'Task deadline has passed',
      'Deploy TLS Ingress · Quantum Engine',
      `test_deadline_${stamp}`,
      {
        category: NotificationCategory.TASK,
        priority: NotificationPriority.HIGH,
        actionUrl: `/tasks?id=sample-task`,
        metadata: { overdue: true },
      },
    );

    await notifService.notifyUsers(
      orgId,
      [ownerId],
      NotificationType.WEEKLY_REPORT,
      'Weekly Report Ready: Quantum Engine',
      'Intelligence report for week is compiled.',
      `test_report_${stamp}`,
      {
        category: NotificationCategory.AI,
        priority: NotificationPriority.MEDIUM,
        actionUrl: `/reports?id=sample-report`,
      },
    );

    await notifService.notifyUsers(
      orgId,
      [ownerId],
      NotificationType.TASK_COMPLETED,
      'Task Completed: Setup Database Pool',
      'Completed by team lead.',
      `test_completed_${stamp}`,
      {
        category: NotificationCategory.TASK,
        priority: NotificationPriority.LOW,
      },
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. Rejects unauthenticated requests with 401', async () => {
    await request(app.getHttpServer())
      .get('/api/notifications')
      .expect(401);

    await request(app.getHttpServer())
      .get('/api/notifications/preferences')
      .expect(401);
  });

  it('2. Lists notifications with full unread counts breakdown by category and priority', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/notifications')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(res.body).toHaveProperty('items');
    expect(res.body).toHaveProperty('unreadCount');
    expect(res.body).toHaveProperty('countsByCategory');
    expect(res.body).toHaveProperty('countsByPriority');

    expect(res.body.items.length).toBeGreaterThanOrEqual(4);
    expect(res.body.unreadCount).toBeGreaterThanOrEqual(4);

    expect(res.body.countsByCategory.PROJECT).toBeGreaterThanOrEqual(1);
    expect(res.body.countsByCategory.TASK).toBeGreaterThanOrEqual(2);
    expect(res.body.countsByCategory.AI).toBeGreaterThanOrEqual(1);

    expect(res.body.countsByPriority.CRITICAL).toBeGreaterThanOrEqual(1);
    expect(res.body.countsByPriority.HIGH).toBeGreaterThanOrEqual(1);
    expect(res.body.countsByPriority.MEDIUM).toBeGreaterThanOrEqual(1);
    expect(res.body.countsByPriority.LOW).toBeGreaterThanOrEqual(1);

    testNotificationId = res.body.items[0].id;
  });

  it('3. Filters notifications by category and priority', async () => {
    const projectRes = await request(app.getHttpServer())
      .get('/api/notifications?category=PROJECT')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(projectRes.body.items.every((n: any) => n.category === 'PROJECT')).toBe(true);

    const criticalRes = await request(app.getHttpServer())
      .get('/api/notifications?priority=CRITICAL')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(criticalRes.body.items.every((n: any) => n.priority === 'CRITICAL')).toBe(true);
  });

  it('4. Searches notifications by title/body substring', async () => {
    const searchRes = await request(app.getHttpServer())
      .get('/api/notifications?search=Quantum')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(searchRes.body.items.length).toBeGreaterThanOrEqual(1);
    expect(searchRes.body.items.some((n: any) => n.title.includes('Quantum') || n.body.includes('Quantum'))).toBe(true);
  });

  it('5. Marks a single notification as read and updates readAt', async () => {
    const readRes = await request(app.getHttpServer())
      .patch(`/api/notifications/${testNotificationId}/read`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(readRes.body.id).toBe(testNotificationId);
    expect(readRes.body.readAt).not.toBeNull();

    // Verify unread filter now excludes it
    const unreadRes = await request(app.getHttpServer())
      .get('/api/notifications?status=unread')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(unreadRes.body.items.some((n: any) => n.id === testNotificationId)).toBe(false);
  });

  it('6. Marks all unread notifications as read with category filter', async () => {
    const readAllRes = await request(app.getHttpServer())
      .patch('/api/notifications/read-all?category=AI')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(readAllRes.body).toHaveProperty('updated');

    // Verify AI category unread count is now 0
    const listRes = await request(app.getHttpServer())
      .get('/api/notifications')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(listRes.body.countsByCategory.AI).toBe(0);
  });

  it('7. Soft-dismisses a notification', async () => {
    await request(app.getHttpServer())
      .delete(`/api/notifications/${testNotificationId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    // Verify dismissed notification is omitted from list
    const listRes = await request(app.getHttpServer())
      .get('/api/notifications')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(listRes.body.items.some((n: any) => n.id === testNotificationId)).toBe(false);
  });

  it('8. Retrieves and updates user notification preferences', async () => {
    // Default preferences
    const getPref = await request(app.getHttpServer())
      .get('/api/notifications/preferences')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(getPref.body.projectAlerts).toBe(true);
    expect(getPref.body.taskAlerts).toBe(true);
    expect(getPref.body.deadlineReminderLeadHours).toBe(24);

    // Update preferences: turn off low-priority alerts and AI alerts
    const updatePref = await request(app.getHttpServer())
      .patch('/api/notifications/preferences')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        lowPriorityAlerts: false,
        aiAlerts: false,
        deadlineReminderLeadHours: 48,
      })
      .expect(200);

    expect(updatePref.body.lowPriorityAlerts).toBe(false);
    expect(updatePref.body.aiAlerts).toBe(false);
    expect(updatePref.body.deadlineReminderLeadHours).toBe(48);

    // Verify preference is respected: AI alert dispatch is skipped for owner
    const dispatched = await notifService.notifyUsers(
      orgId,
      [ownerId],
      NotificationType.WEEKLY_REPORT,
      'Another Report',
      'Report summary',
      `unique_evt_${Date.now()}`,
      { category: NotificationCategory.AI, priority: NotificationPriority.MEDIUM },
    );

    expect(dispatched).toBe(0);
  });

  it('9. Enforces multi-tenant isolation: Foreign tenant cannot read or dismiss another tenant notifications', async () => {
    // Foreign user tries to read primary owner's notification
    await request(app.getHttpServer())
      .patch(`/api/notifications/${testNotificationId}/read`)
      .set('Authorization', `Bearer ${foreignOwnerToken}`)
      .expect(404);

    // Foreign user tries to delete primary owner's notification
    await request(app.getHttpServer())
      .delete(`/api/notifications/${testNotificationId}`)
      .set('Authorization', `Bearer ${foreignOwnerToken}`)
      .expect(404);

    // Foreign user lists notifications -> receives 0 items from primary org
    const foreignList = await request(app.getHttpServer())
      .get('/api/notifications')
      .set('Authorization', `Bearer ${foreignOwnerToken}`)
      .expect(200);

    expect(foreignList.body.items.length).toBe(0);
    expect(foreignList.body.unreadCount).toBe(0);
  });
});
