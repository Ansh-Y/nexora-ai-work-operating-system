import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { MEETING_ANALYSIS_PROVIDER, SPEECH_TO_TEXT_PROVIDER } from '../src/meetings/meeting-providers';
import { meetingTestAnalysisProvider, meetingTestSpeechProvider } from './meeting-provider-fixtures';

describe('AI Project Assistant (Release 4.2.1 e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let foreignOwnerToken: string;
  let orgId: string;
  let foreignOrgId: string;
  let projectId: string;
  let foreignProjectId: string;
  let overdueTaskId: string;
  let blockedTaskId: string;
  let blockingTaskId: string;

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

    // 1. Setup primary workspace owner
    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const regRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        name: 'Assistant Owner',
        email: `asst-owner-${stamp}@nexora.test`,
        password: 'Password!2026',
        organizationName: `Assistant Org ${stamp}`,
      })
      .expect(201);
    ownerToken = regRes.body.accessToken;
    orgId = regRes.body.workspace.id;

    // 2. Setup secondary workspace owner (for multi-tenant isolation testing)
    const foreignRegRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        name: 'Foreign Owner',
        email: `asst-foreign-${stamp}@nexora.test`,
        password: 'Password!2026',
        organizationName: `Foreign Org ${stamp}`,
      })
      .expect(201);
    foreignOwnerToken = foreignRegRes.body.accessToken;
    foreignOrgId = foreignRegRes.body.workspace.id;

    // 3. Create Project in Primary Org
    const projRes = await request(app.getHttpServer())
      .post('/api/projects')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Apex Launch Platform',
        description: 'Comprehensive enterprise release project for assistant verification.',
      })
      .expect(201);
    projectId = projRes.body.id;

    // 4. Create Project in Foreign Org
    const foreignProjRes = await request(app.getHttpServer())
      .post('/api/projects')
      .set('Authorization', `Bearer ${foreignOwnerToken}`)
      .send({
        name: 'Confidential Stealth Project',
        description: 'Tenant-isolated project that must never be visible to primary org.',
      })
      .expect(201);
    foreignProjectId = foreignProjRes.body.id;

    // 5. Create tasks for Apex Launch Platform
    const pastDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const futureDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

    // Blocking task (Overdue)
    const t1 = await request(app.getHttpServer())
      .post(`/api/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'Complete OAuth Authentication Flow',
        description: 'Core security authentication module.',
        status: 'IN_PROGRESS',
        priority: 'URGENT',
        dueDate: pastDate,
      })
      .expect(201);
    blockingTaskId = t1.body.id;
    overdueTaskId = t1.body.id;

    // Blocked task
    const t2 = await request(app.getHttpServer())
      .post(`/api/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'Integrate User Dashboard Widgets',
        description: 'Requires OAuth flow to be finished first.',
        status: 'BLOCKED',
        priority: 'HIGH',
        dueDate: futureDate,
      })
      .expect(201);
    blockedTaskId = t2.body.id;

    // Create dependency: t2 depends on t1
    await request(app.getHttpServer())
      .post(`/api/tasks/${blockingTaskId}/dependencies`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ blockedTaskId })
      .expect(201);

    // Completed task
    await request(app.getHttpServer())
      .post(`/api/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'Platform Architecture Specification',
        description: 'Initial architectural design and database schemas.',
        status: 'DONE',
        priority: 'MEDIUM',
      })
      .expect(201);

    // 6. Create Milestone
    await request(app.getHttpServer())
      .post(`/api/projects/${projectId}/milestones`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'Alpha Readiness & Security Review',
        targetDate: futureDate,
      })
      .expect(201);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  // =========================================================================
  // Authentication & Guard Tests
  // =========================================================================
  it('rejects unauthenticated requests with 401', async () => {
    await request(app.getHttpServer())
      .get('/api/ai/assistant/context')
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/ai/assistant/chat')
      .send({ message: 'Hello' })
      .expect(401);
  });

  // =========================================================================
  // Context Retrieval Tests
  // =========================================================================
  it('returns grounded assistant context for authenticated workspace and project', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/ai/assistant/context?projectId=${projectId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(res.body.workspaceId).toBe(orgId);
    expect(res.body.projects.length).toBeGreaterThanOrEqual(1);
    expect(res.body.activeProjectId).toBe(projectId);
    expect(res.body.activeProjectName).toBe('Apex Launch Platform');
    expect(res.body.starterQuestions.length).toBeGreaterThanOrEqual(6);
    expect(res.body.members.length).toBeGreaterThanOrEqual(1);
  });

  // =========================================================================
  // Assistant Chat: Project Overview & Fact Grounding
  // =========================================================================
  it('answers project overview query with accurate metrics, citations, and follow-ups', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/ai/assistant/chat')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        message: 'Give me an overview of this project.',
        projectId,
      })
      .expect(201);

    expect(res.body.answer).toContain('Apex Launch Platform');
    expect(res.body.citations.length).toBeGreaterThan(0);
    expect(res.body.citations.some((c: any) => c.type === 'project' && c.id === projectId)).toBe(true);
    expect(res.body.suggestedFollowUps.length).toBeGreaterThanOrEqual(2);
  });

  // =========================================================================
  // Assistant Chat: Overdue Tasks Identification
  // =========================================================================
  it('identifies overdue tasks without hallucinating non-existent dates', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/ai/assistant/chat')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        message: 'Which tasks are overdue?',
        projectId,
      })
      .expect(201);

    expect(res.body.answer).toContain('Complete OAuth Authentication Flow');
    expect(res.body.citations.some((c: any) => c.id === overdueTaskId)).toBe(true);
  });

  // =========================================================================
  // Assistant Chat: Bottlenecks & Dependency Blocking
  // =========================================================================
  it('explains blockers and dependent relationships with citations', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/ai/assistant/chat')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        message: 'What is blocking project progress?',
        projectId,
      })
      .expect(201);

    expect(res.body.answer).toContain('Integrate User Dashboard Widgets');
    expect(res.body.citations.some((c: any) => c.id === blockedTaskId)).toBe(true);
  });

  // =========================================================================
  // Assistant Chat: Health Diagnosis & Risk Explanations
  // =========================================================================
  it('evaluates project health score and provides diagnostic recommendations', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/ai/assistant/chat')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        message: 'Why is this project at risk?',
        projectId,
      })
      .expect(201);

    expect(res.body.answer).toContain('Project Health Diagnosis');
    expect(res.body.citations.some((c: any) => c.type === 'health')).toBe(true);
  });

  // =========================================================================
  // Assistant Chat: Multi-turn Follow-up Handling
  // =========================================================================
  it('supports multi-turn conversation history and resolves follow-up queries', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/ai/assistant/chat')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        message: 'What should the team prioritize next to fix this?',
        projectId,
        history: [
          { role: 'user', content: 'Give me an overview of this project.' },
          { role: 'assistant', content: 'The project Apex Launch Platform has 1 overdue task and 1 blocker.' },
        ],
      })
      .expect(201);

    expect(res.body.answer).toContain('Complete OAuth Authentication Flow');
    expect(res.body.citations.length).toBeGreaterThan(0);
  });

  // =========================================================================
  // Strict Multi-Tenant Isolation
  // =========================================================================
  it('enforces tenant boundary: user cannot access other organization project context or chat', async () => {
    // 1. Foreign user attempts to query Primary Org's project directly by ID -> rejected with 404
    await request(app.getHttpServer())
      .post('/api/ai/assistant/chat')
      .set('Authorization', `Bearer ${foreignOwnerToken}`)
      .send({
        message: 'Give me an overview of Apex Launch Platform',
        projectId, // Primary org's project
      })
      .expect(404);

    // 2. Foreign user attempts to get assistant context for Primary Org's project -> returns 404
    await request(app.getHttpServer())
      .get(`/api/ai/assistant/context?projectId=${projectId}`)
      .set('Authorization', `Bearer ${foreignOwnerToken}`)
      .expect(404);

    // 3. Workspace level chat for foreign user only sees foreign project
    const foreignChat = await request(app.getHttpServer())
      .post('/api/ai/assistant/chat')
      .set('Authorization', `Bearer ${foreignOwnerToken}`)
      .send({
        message: 'What is the status of our projects?',
      })
      .expect(201);

    expect(foreignChat.body.answer).toContain('Confidential Stealth Project');
    expect(foreignChat.body.answer).not.toContain('Apex Launch Platform');
  });

  // =========================================================================
  // Non-mutating Read-Only Guarantee
  // =========================================================================
  it('verifies that assistant operations perform no state mutations or database writes', async () => {
    const initialTasksCount = await prisma.task.count({ where: { projectId } });
    const initialMilestonesCount = await prisma.milestone.count({ where: { projectId } });

    // Call chat endpoint 3 consecutive times
    await request(app.getHttpServer())
      .post('/api/ai/assistant/chat')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ message: 'What is blocking project progress?', projectId })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/ai/assistant/chat')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ message: 'Which milestones are approaching?', projectId })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/ai/assistant/chat')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ message: 'Show me the team workload.', projectId })
      .expect(201);

    const finalTasksCount = await prisma.task.count({ where: { projectId } });
    const finalMilestonesCount = await prisma.milestone.count({ where: { projectId } });

    expect(finalTasksCount).toBe(initialTasksCount);
    expect(finalMilestonesCount).toBe(initialMilestonesCount);
  });
});
