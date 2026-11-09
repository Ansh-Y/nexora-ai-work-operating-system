import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OrganizationRole, Priority, TaskStatus } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { MEETING_ANALYSIS_PROVIDER, SPEECH_TO_TEXT_PROVIDER } from '../src/meetings/meeting-providers';
import { meetingTestAnalysisProvider, meetingTestSpeechProvider } from './meeting-provider-fixtures';

describe('AI Weekly Project Reports (Release 4.2.4 e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let foreignOwnerToken: string;
  let viewerToken: string;
  let orgId: string;
  let foreignOrgId: string;
  let projectId: string;
  let reportId: string;

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

    // 1. Primary workspace owner
    const regRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        name: 'Report Admin',
        email: `report-admin-${stamp}@nexora.test`,
        password: 'Password!2026',
        organizationName: `Report Org ${stamp}`,
      })
      .expect(201);
    ownerToken = regRes.body.accessToken;
    orgId = regRes.body.workspace.id;

    // 2. Secondary workspace owner (tenant isolation)
    const foreignReg = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        name: 'Foreign Org Lead',
        email: `foreign-lead-${stamp}@nexora.test`,
        password: 'Password!2026',
        organizationName: `Foreign Org ${stamp}`,
      })
      .expect(201);
    foreignOwnerToken = foreignReg.body.accessToken;
    foreignOrgId = foreignReg.body.workspace.id;

    // 3. Project and sample tasks in primary org
    const projectRes = await request(app.getHttpServer())
      .post('/api/projects')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Platform Core Services',
        description: 'Multi-tenant cloud infrastructure and data pipelines',
      })
      .expect(201);
    projectId = projectRes.body.id;

    // Task 1: Completed task
    await prisma.task.create({
      data: {
        organizationId: orgId,
        projectId,
        title: 'Complete Distributed Cache Layer',
        status: TaskStatus.DONE,
        priority: Priority.HIGH,
        completedAt: new Date(),
      },
    });

    // Task 2: Blocked task
    const blockerTask = await prisma.task.create({
      data: {
        organizationId: orgId,
        projectId,
        title: 'Provision Cloud Database Instance',
        status: TaskStatus.IN_PROGRESS,
        priority: Priority.URGENT,
      },
    });

    const blockedTask = await prisma.task.create({
      data: {
        organizationId: orgId,
        projectId,
        title: 'Run Schema Migration Pipeline',
        status: TaskStatus.BLOCKED,
        priority: Priority.HIGH,
      },
    });

    await prisma.taskDependency.create({
      data: {
        organizationId: orgId,
        blockingTaskId: blockerTask.id,
        blockedTaskId: blockedTask.id,
      },
    });

    // Milestone
    await prisma.milestone.create({
      data: {
        organizationId: orgId,
        projectId,
        title: 'Beta Release Gate',
        targetDate: new Date(Date.now() + 5 * 86400000),
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. Generates a new comprehensive weekly project report with deterministic metrics', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/ai/reports/generate')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        projectId,
        customInstructions: 'Emphasize cloud infrastructure readiness',
      })
      .expect(201);

    expect(res.body.id).toBeDefined();
    reportId = res.body.id;
    expect(res.body.projectId).toBe(projectId);
    expect(res.body.title).toContain('Weekly Report — Platform Core Services');
    expect(res.body.status).toBe('COMPLETED');
    expect(res.body.executiveSummary).toContain('Platform Core Services');

    // Deterministic metrics check
    const metrics = res.body.metrics;
    expect(metrics.totalTasks).toBe(3);
    expect(metrics.completedThisPeriod).toBe(1);
    expect(metrics.blockedTasks).toBe(1);
    expect(metrics.completionRate).toBe(33);

    // Progress and blockers
    expect(res.body.progressOverview.completedTasks.length).toBe(1);
    expect(res.body.blockersAndRisks.blockedTasks.length).toBe(1);
    expect(res.body.blockersAndRisks.blockedTasks[0].title).toBe('Run Schema Migration Pipeline');

    // Recommendations
    expect(Array.isArray(res.body.recommendations)).toBe(true);
    expect(res.body.recommendations.length).toBeGreaterThan(0);
  });

  it('2. Fails when period start is after period end or project does not exist', async () => {
    // Start after end
    await request(app.getHttpServer())
      .post('/api/ai/reports/generate')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        projectId,
        periodStart: '2026-11-10T00:00:00.000Z',
        periodEnd: '2026-11-01T00:00:00.000Z',
      })
      .expect(400);

    // Non-existent project
    await request(app.getHttpServer())
      .post('/api/ai/reports/generate')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        projectId: '00000000-0000-0000-0000-000000000000',
      })
      .expect(404);
  });

  it('3. Lists historical reports for workspace and filters by project', async () => {
    const listRes = await request(app.getHttpServer())
      .get('/api/ai/reports')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(Array.isArray(listRes.body)).toBe(true);
    expect(listRes.body.length).toBeGreaterThanOrEqual(1);
    expect(listRes.body[0].id).toBe(reportId);

    // Filter by projectId
    const filteredRes = await request(app.getHttpServer())
      .get(`/api/ai/reports?projectId=${projectId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(filteredRes.body.length).toBeGreaterThanOrEqual(1);
    expect(filteredRes.body[0].projectId).toBe(projectId);
  });

  it('4. Retrieves single report details by ID', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/ai/reports/${reportId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(res.body.id).toBe(reportId);
    expect(res.body.project.name).toBe('Platform Core Services');
    expect(res.body.creator.name).toBe('Report Admin');
    expect(res.body.metrics.totalTasks).toBe(3);
  });

  it('5. Exports report as professional binary PDF stream', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/ai/reports/${reportId}/pdf`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain('.pdf');

    // Verify PDF header magic bytes (%PDF-)
    const bodyBuffer = Buffer.from(res.body);
    expect(bodyBuffer.toString('utf8', 0, 5)).toBe('%PDF-');
  });

  it('6. Enforces strict multi-tenant isolation across organizations', async () => {
    // Foreign user cannot view report
    await request(app.getHttpServer())
      .get(`/api/ai/reports/${reportId}`)
      .set('Authorization', `Bearer ${foreignOwnerToken}`)
      .expect(404);

    // Foreign user cannot export PDF
    await request(app.getHttpServer())
      .get(`/api/ai/reports/${reportId}/pdf`)
      .set('Authorization', `Bearer ${foreignOwnerToken}`)
      .expect(404);

    // Foreign user cannot generate report for foreign project
    await request(app.getHttpServer())
      .post('/api/ai/reports/generate')
      .set('Authorization', `Bearer ${foreignOwnerToken}`)
      .send({
        projectId,
      })
      .expect(404);

    // Foreign list reports does not include primary org report
    const foreignList = await request(app.getHttpServer())
      .get('/api/ai/reports')
      .set('Authorization', `Bearer ${foreignOwnerToken}`)
      .expect(200);

    expect(foreignList.body.find((r: any) => r.id === reportId)).toBeUndefined();
  });

  it('7. Deletes report safely and returns 404 afterwards', async () => {
    await request(app.getHttpServer())
      .delete(`/api/ai/reports/${reportId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/ai/reports/${reportId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(404);
  });
});
