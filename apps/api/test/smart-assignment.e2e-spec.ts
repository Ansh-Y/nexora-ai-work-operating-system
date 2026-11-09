import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OrganizationRole, Priority, TaskStatus } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { MEETING_ANALYSIS_PROVIDER, SPEECH_TO_TEXT_PROVIDER } from '../src/meetings/meeting-providers';
import { meetingTestAnalysisProvider, meetingTestSpeechProvider } from './meeting-provider-fixtures';

describe('AI Smart Task Assignment (Release 4.2.2 e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let viewerToken: string;
  let foreignOwnerToken: string;
  let orgId: string;
  let foreignOrgId: string;
  let projectId: string;
  let foreignProjectId: string;
  let targetTaskId: string;
  let foreignTaskId: string;
  let devUser1Id: string;
  let devUser2Id: string;

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

    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

    // 1. Setup primary workspace owner
    const regRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        name: 'Assignment Lead',
        email: `assign-owner-${stamp}@nexora.test`,
        password: 'Password!2026',
        organizationName: `Assignment Org ${stamp}`,
      })
      .expect(201);
    ownerToken = regRes.body.accessToken;
    orgId = regRes.body.workspace.id;

    // 2. Setup secondary workspace owner (for multi-tenant isolation)
    const foreignRegRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        name: 'Foreign Owner',
        email: `foreign-owner-${stamp}@nexora.test`,
        password: 'Password!2026',
        organizationName: `Foreign Org ${stamp}`,
      })
      .expect(201);
    foreignOwnerToken = foreignRegRes.body.accessToken;
    foreignOrgId = foreignRegRes.body.workspace.id;

    // 3. Create Additional Team Members in primary org
    // Dev 1: Backend Developer (Will have 0 active tasks -> high capacity)
    const dev1User = await prisma.user.create({
      data: {
        name: 'Dev One (Backend)',
        email: `dev1-${stamp}@nexora.test`,
        passwordHash: 'dummyhash',
      },
    });
    devUser1Id = dev1User.id;
    await prisma.membership.create({
      data: {
        organizationId: orgId,
        userId: dev1User.id,
        role: OrganizationRole.TEAM_MEMBER,
      },
    });

    // Dev 2: Frontend Developer (Will have 4 active tasks -> heavy workload)
    const dev2User = await prisma.user.create({
      data: {
        name: 'Dev Two (Frontend)',
        email: `dev2-${stamp}@nexora.test`,
        passwordHash: 'dummyhash',
      },
    });
    devUser2Id = dev2User.id;
    await prisma.membership.create({
      data: {
        organizationId: orgId,
        userId: dev2User.id,
        role: OrganizationRole.TEAM_MEMBER,
      },
    });

    // Viewer: Read-only user (Should be forbidden from assigning)
    const viewerUser = await prisma.user.create({
      data: {
        name: 'Viewer Person',
        email: `viewer-${stamp}@nexora.test`,
        passwordHash: 'dummyhash',
      },
    });
    await prisma.membership.create({
      data: {
        organizationId: orgId,
        userId: viewerUser.id,
        role: OrganizationRole.VIEWER,
      },
    });

    // Create a login token for viewer using auth login endpoint
    // First update viewer password hash properly so we can log in or create a mock session
    const bcrypt = await import('bcryptjs');
    const hashed = await bcrypt.hash('Password!2026', 10);
    await prisma.user.update({ where: { id: viewerUser.id }, data: { passwordHash: hashed } });

    const viewerLoginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: `viewer-${stamp}@nexora.test`, password: 'Password!2026' })
      .expect(201);
    viewerToken = viewerLoginRes.body.accessToken;

    // 4. Create Project in primary org
    const projRes = await request(app.getHttpServer())
      .post('/api/projects')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Core Platform Refactor',
        description: 'Refactoring database and API services.',
      })
      .expect(201);
    projectId = projRes.body.id;

    // 5. Create Project in foreign org
    const foreignProjRes = await request(app.getHttpServer())
      .post('/api/projects')
      .set('Authorization', `Bearer ${foreignOwnerToken}`)
      .send({
        name: 'Foreign Secret Platform',
        description: 'Unauthorized tenant project.',
      })
      .expect(201);
    foreignProjectId = foreignProjRes.body.id;

    // 6. Create Target Task in primary org (Unassigned)
    const targetTaskRes = await request(app.getHttpServer())
      .post(`/api/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'Implement Redis caching for API queries',
        description: 'Add Redis cache layer to speed up high-frequency database reads.',
        priority: Priority.HIGH,
        status: TaskStatus.TODO,
        labels: ['redis', 'caching', 'backend'],
        dueDate: new Date(Date.now() + 86400000 * 5).toISOString(),
      })
      .expect(201);
    targetTaskId = targetTaskRes.body.id;

    // 7. Create Foreign Task
    const foreignTaskRes = await request(app.getHttpServer())
      .post(`/api/projects/${foreignProjectId}/tasks`)
      .set('Authorization', `Bearer ${foreignOwnerToken}`)
      .send({
        title: 'Foreign Private Task',
        priority: Priority.MEDIUM,
        status: TaskStatus.TODO,
      })
      .expect(201);
    foreignTaskId = foreignTaskRes.body.id;

    // 8. Assign multiple active tasks to Dev 2 to create high workload
    for (let i = 1; i <= 4; i++) {
      await prisma.task.create({
        data: {
          organizationId: orgId,
          projectId,
          assigneeId: devUser2Id,
          title: `Dev 2 Active Task ${i}`,
          priority: Priority.MEDIUM,
          status: TaskStatus.IN_PROGRESS,
        },
      });
    }

    // 9. Assign a completed historical Redis task to Dev 1 to give domain signal
    await prisma.task.create({
      data: {
        organizationId: orgId,
        projectId,
        assigneeId: devUser1Id,
        title: 'Setup Redis Sentinel cluster',
        description: 'High-availability caching setup',
        priority: Priority.HIGH,
        status: TaskStatus.DONE,
        labels: ['redis', 'caching'],
      },
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('rejects unauthenticated requests with 401', async () => {
    await request(app.getHttpServer())
      .get(`/api/ai/tasks/${targetTaskId}/recommend-assignee`)
      .expect(401);
  });

  it('enforces multi-tenant boundary: cannot recommend assignees for foreign organization task', async () => {
    await request(app.getHttpServer())
      .get(`/api/ai/tasks/${foreignTaskId}/recommend-assignee`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(404);
  });

  it('analyzes workload, skills, and schedules to return top 3 grounded recommendations', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/ai/tasks/${targetTaskId}/recommend-assignee`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(res.body).toHaveProperty('taskId', targetTaskId);
    expect(res.body).toHaveProperty('taskTitle', 'Implement Redis caching for API queries');
    expect(res.body).toHaveProperty('recommendations');
    expect(Array.isArray(res.body.recommendations)).toBe(true);
    expect(res.body.recommendations.length).toBeLessThanOrEqual(3);

    // Dev 1 should be recommended top match because Dev 1 has 0 active tasks and historical Redis experience
    const topRec = res.body.recommendations[0];
    expect(topRec.candidate.id).toBe(devUser1Id);
    expect(topRec.tier).toBe('STRONG_MATCH');
    expect(topRec.score).toBeGreaterThanOrEqual(80);
    expect(topRec.reasons.some((r: string) => r.includes('Optimal availability') || r.includes('availability'))).toBe(true);
    expect(topRec.reasons.some((r: string) => r.includes('domain experience') && r.includes('redis'))).toBe(true);

    // Dev 2 should have workload concerns (4 active tasks)
    const dev2Rec = res.body.recommendations.find((r: any) => r.candidate.id === devUser2Id);
    if (dev2Rec) {
      expect(dev2Rec.workload.activeTasks).toBe(4);
      expect(dev2Rec.concerns.some((c: string) => c.includes('4') || c.includes('workload'))).toBe(true);
      expect(dev2Rec.score).toBeLessThan(topRec.score);
    }

    // Read-only check: verify task assignee remains unchanged
    const currentTask = await prisma.task.findUnique({ where: { id: targetTaskId } });
    expect(currentTask?.assigneeId).toBeNull();
  });

  it('enforces RBAC: forbids VIEWER role from applying task assignments', async () => {
    await request(app.getHttpServer())
      .post(`/api/ai/tasks/${targetTaskId}/apply-assignment`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ assigneeId: devUser1Id })
      .expect(403);
  });

  it('enforces multi-tenant boundary: cannot assign member to a foreign organization task', async () => {
    await request(app.getHttpServer())
      .post(`/api/ai/tasks/${foreignTaskId}/apply-assignment`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ assigneeId: devUser1Id })
      .expect(404);
  });

  it('successfully applies and persists approved assignment with audit event and notifications', async () => {
    // Apply assignment to Dev 1
    const res = await request(app.getHttpServer())
      .post(`/api/ai/tasks/${targetTaskId}/apply-assignment`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ assigneeId: devUser1Id })
      .expect(200);

    expect(res.body.id).toBe(targetTaskId);
    expect(res.body.assigneeId).toBe(devUser1Id);

    // Verify persisted in database
    const updated = await prisma.task.findUnique({
      where: { id: targetTaskId },
      include: { assignee: true },
    });
    expect(updated?.assigneeId).toBe(devUser1Id);
    expect(updated?.assignee?.name).toBe('Dev One (Backend)');

    // Verify audit event was logged
    const auditEvents = await prisma.auditEvent.findMany({
      where: { organizationId: orgId, targetId: targetTaskId, action: 'task.updated' },
    });
    expect(auditEvents.length).toBeGreaterThanOrEqual(1);

    // Verify notification was dispatched to Dev 1
    const notifications = await prisma.notification.findMany({
      where: { organizationId: orgId, userId: devUser1Id, type: 'ASSIGNMENT' },
    });
    expect(notifications.length).toBeGreaterThanOrEqual(1);
    expect(notifications[0].title).toBe('A task was assigned to you');
    expect(notifications[0].body).toContain('Implement Redis caching');
  });
});
