import { describe, expect, it, vi } from 'vitest';
import { Priority, TaskStatus } from '@prisma/client';
import { ProjectHealthScoringEngine } from './project-health-scoring.engine';
import { PredictiveRiskEngine, ProjectDataForRisk } from './predictive-risk.engine';
import { ProjectForecastEngine } from './project-forecast.engine';
import { ProjectRecommendationsEngine } from './project-recommendations.engine';
import { ProjectHealthQueueService } from './project-health-queue.service';
import { DEFAULT_HEALTH_CONFIG } from './project-health-config';

function createMockProject(overrides?: Partial<ProjectDataForRisk>): ProjectDataForRisk {
  const now = new Date();
  const future = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000); // 14 days later

  return {
    id: 'proj-1',
    name: 'Phoenix Platform',
    status: 'ACTIVE',
    startDate: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000),
    dueDate: future,
    createdAt: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000),
    updatedAt: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000),
    tasks: [
      {
        id: 'task-1',
        title: 'Database schema migration',
        status: TaskStatus.DONE,
        priority: Priority.HIGH,
        dueDate: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
        startDate: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000),
        completedAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
        createdAt: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
        assigneeId: 'user-1',
        blockedBy: [],
        blocks: [],
      },
      {
        id: 'task-2',
        title: 'API endpoint implementation',
        status: TaskStatus.DONE,
        priority: Priority.HIGH,
        dueDate: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
        startDate: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
        completedAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
        createdAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
        assigneeId: 'user-2',
        blockedBy: [],
        blocks: [],
      },
    ],
    milestones: [
      {
        id: 'ms-1',
        title: 'Backend API ready',
        targetDate: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
        completedAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
      },
    ],
    githubEvents: [
      {
        createdAt: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000),
      },
      {
        createdAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
      },
    ],
    comments: [
      {
        createdAt: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000),
      },
    ],
    ...overrides,
  };
}

describe('ProjectHealthScoringEngine', () => {
  const engine = new ProjectHealthScoringEngine();

  it('calculates healthy score for on-track project with good progress', () => {
    const project = createMockProject();
    const result = engine.calculateHealth(project);

    expect(result.classification).toBe('HEALTHY');
    expect(result.score).not.toBeNull();
    expect(result.score!).toBeGreaterThanOrEqual(80);
    expect(result.score!).toBeLessThanOrEqual(100);
    expect(result.dimensionScores.taskCompletion.score).toBeGreaterThan(0);
    expect(result.dimensionScores.deadlinePerformance.score).toBe(100);
    expect(result.dimensionScores.blockersAndDependencies.score).toBe(100);
    expect(result.dimensionScores.milestonePerformance.score).toBe(100);
    expect(result.dimensionScores.recentActivity.score).toBeGreaterThan(50);
  });

  it('penalizes projects with overdue tasks and drops health classification', () => {
    const now = new Date();
    const project = createMockProject({
      tasks: [
        {
          id: 'task-1',
          title: 'Overdue task 1',
          status: TaskStatus.TODO,
          priority: Priority.URGENT,
          dueDate: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), // 7 days overdue
          startDate: null,
          completedAt: null,
          createdAt: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000),
          updatedAt: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000),
          assigneeId: 'user-1',
          blockedBy: [],
          blocks: [],
        },
        {
          id: 'task-2',
          title: 'Overdue task 2',
          status: TaskStatus.IN_PROGRESS,
          priority: Priority.HIGH,
          dueDate: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000), // 4 days overdue
          startDate: null,
          completedAt: null,
          createdAt: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000),
          updatedAt: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000),
          assigneeId: 'user-2',
          blockedBy: [],
          blocks: [],
        },
      ],
    });

    const result = engine.calculateHealth(project);
    expect(['AT_RISK', 'CRITICAL']).toContain(result.classification);
    expect(result.dimensionScores.deadlinePerformance.score).toBeLessThan(70);
  });

  it('penalizes blocked tasks and downstream bottlenecks under Dimension C', () => {
    const now = new Date();
    const project = createMockProject({
      tasks: [
        {
          id: 'task-blocker',
          title: 'Infrastructure provision',
          status: TaskStatus.BLOCKED,
          priority: Priority.URGENT,
          dueDate: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000),
          startDate: null,
          completedAt: null,
          createdAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
          updatedAt: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000),
          assigneeId: 'user-1',
          blockedBy: [],
          blocks: [
            { blockedTaskId: 't2' },
            { blockedTaskId: 't3' },
            { blockedTaskId: 't4' },
          ],
        },
      ],
    });

    const result = engine.calculateHealth(project);
    expect(result.dimensionScores.blockersAndDependencies.score).toBeLessThan(80);
  });

  it('penalizes missed milestones under Dimension D', () => {
    const now = new Date();
    const project = createMockProject({
      milestones: [
        {
          id: 'ms-overdue',
          title: 'Beta Launch',
          targetDate: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000), // 4 days overdue
          completedAt: null,
        },
      ],
    });

    const result = engine.calculateHealth(project);
    expect(result.dimensionScores.milestonePerformance.score).toBeLessThan(70);
  });

  it('classifies project with zero tasks as INSUFFICIENT_DATA and never marks false HEALTHY', () => {
    const project = createMockProject({
      tasks: [],
    });

    const result = engine.calculateHealth(project);
    expect(result.classification).toBe('INSUFFICIENT_DATA');
    expect(result.score).toBeNull();
  });

  it('classifies project with only cancelled tasks as INSUFFICIENT_DATA', () => {
    const project = createMockProject({
      tasks: [
        {
          id: 'cancelled-1',
          title: 'Abandoned scope',
          status: TaskStatus.CANCELLED,
          priority: Priority.LOW,
          dueDate: null,
          startDate: null,
          completedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          assigneeId: null,
          blockedBy: [],
          blocks: [],
        },
      ],
    });

    const result = engine.calculateHealth(project);
    expect(result.classification).toBe('INSUFFICIENT_DATA');
    expect(result.score).toBeNull();
  });

  it('excludes completed and archived projects with EXCLUDED classification', () => {
    const completedProject = createMockProject({ status: 'COMPLETED' });
    const archivedProject = createMockProject({ status: 'ARCHIVED' });

    const resCompleted = engine.calculateHealth(completedProject);
    const resArchived = engine.calculateHealth(archivedProject);

    expect(resCompleted.classification).toBe('EXCLUDED');
    expect(resCompleted.score).toBeNull();
    expect(resArchived.classification).toBe('EXCLUDED');
    expect(resArchived.score).toBeNull();
  });

  it('respects boundary conditions and clamps scores strictly to 0-100', () => {
    const now = new Date();
    const terribleProject = createMockProject({
      tasks: Array.from({ length: 15 }, (_, i) => ({
        id: `bad-task-${i}`,
        title: `Broken task ${i}`,
        status: TaskStatus.BLOCKED,
        priority: Priority.URGENT,
        dueDate: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        startDate: null,
        completedAt: null,
        createdAt: new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000),
        assigneeId: null,
        blockedBy: [],
        blocks: [{ blockedTaskId: 'child' }],
      })),
      milestones: [
        {
          id: 'ms-1',
          title: 'Overdue milestone 1',
          targetDate: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
          completedAt: null,
        },
        {
          id: 'ms-2',
          title: 'Overdue milestone 2',
          targetDate: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000),
          completedAt: null,
        },
      ],
      githubEvents: [],
      comments: [],
    });

    const result = engine.calculateHealth(terribleProject);
    expect(result.score).not.toBeNull();
    expect(result.score!).toBeGreaterThanOrEqual(0);
    expect(result.score!).toBeLessThanOrEqual(100);
    expect(result.classification).toBe('CRITICAL');
  });

  it('supports configurable weights across dimensions', () => {
    const customConfig = {
      ...DEFAULT_HEALTH_CONFIG,
      weights: {
        taskCompletion: 0.5,
        deadlinePerformance: 0.2,
        blockersAndDependencies: 0.1,
        milestonePerformance: 0.1,
        recentActivity: 0.1,
      },
    };

    const customEngine = new ProjectHealthScoringEngine(customConfig);
    const project = createMockProject();
    const result = customEngine.calculateHealth(project);
    expect(result.score).not.toBeNull();
    expect(result.score!).toBeGreaterThan(0);
  });
});

describe('PredictiveRiskEngine', () => {
  const riskEngine = new PredictiveRiskEngine();

  it('detects OVERDUE_TASKS with specific task titles and days overdue', () => {
    const now = new Date();
    const project = createMockProject({
      tasks: [
        {
          id: 'task-overdue',
          title: 'Deploy Auth Service',
          status: TaskStatus.IN_PROGRESS,
          priority: Priority.HIGH,
          dueDate: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
          startDate: null,
          completedAt: null,
          createdAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
          updatedAt: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000),
          assigneeId: 'user-1',
          blockedBy: [],
          blocks: [],
        },
      ],
    });

    const risks = riskEngine.detectRisks(project);
    const overdueRisk = risks.find((r) => r.riskType === 'OVERDUE_TASKS');
    expect(overdueRisk).toBeDefined();
    expect(overdueRisk?.severity).toBe('HIGH');
    expect(overdueRisk?.affectedTaskIds).toContain('task-overdue');
  });

  it('detects INSUFFICIENT_PROGRESS when elapsed time exceeds progress by margin', () => {
    const now = new Date();
    const project = createMockProject({
      tasks: [
        {
          id: 't-impending',
          title: 'Impending high priority task',
          status: TaskStatus.TODO,
          priority: Priority.HIGH,
          dueDate: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000), // Due in 2 days (<= 7 days)
          startDate: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000), // Started 10 days ago (10/12 = 83% elapsed >= 70%)
          completedAt: null,
          createdAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
          updatedAt: new Date(),
          assigneeId: 'u1',
          blockedBy: [],
          blocks: [],
        },
      ],
    });

    const risks = riskEngine.detectRisks(project);
    const progressRisk = risks.find((r) => r.riskType === 'INSUFFICIENT_PROGRESS');
    expect(progressRisk).toBeDefined();
    expect(progressRisk?.affectedTaskIds).toContain('t-impending');
  });

  it('detects BLOCKED_HIGH_PRIORITY risk for urgent or high blocked tasks', () => {
    const now = new Date();
    const project = createMockProject({
      tasks: [
        {
          id: 'blocked-crit',
          title: 'Payment gateway integration',
          status: TaskStatus.BLOCKED,
          priority: Priority.URGENT,
          dueDate: new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000),
          startDate: null,
          completedAt: null,
          createdAt: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000),
          updatedAt: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000),
          assigneeId: 'user-1',
          blockedBy: [],
          blocks: [],
        },
      ],
    });

    const risks = riskEngine.detectRisks(project);
    const blockedRisk = risks.find((r) => r.riskType === 'BLOCKED_HIGH_PRIORITY');
    expect(blockedRisk).toBeDefined();
    expect(blockedRisk?.severity).toBe('CRITICAL');
  });

  it('detects MULTI_DOWNSTREAM_BLOCK when a blocked task blocks 2+ tasks', () => {
    const project = createMockProject({
      tasks: [
        {
          id: 'bottleneck-task',
          title: 'Core database migration',
          status: TaskStatus.BLOCKED,
          priority: Priority.HIGH,
          dueDate: null,
          startDate: null,
          completedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          assigneeId: 'u1',
          blockedBy: [],
          blocks: [
            { blockedTaskId: 'd1' },
            { blockedTaskId: 'd2' },
            { blockedTaskId: 'd3' },
          ],
        },
      ],
    });

    const risks = riskEngine.detectRisks(project);
    const multiBlockRisk = risks.find((r) => r.riskType === 'MULTI_DOWNSTREAM_BLOCK');
    expect(multiBlockRisk).toBeDefined();
    expect(multiBlockRisk?.severity).toBe('HIGH');
  });

  it('detects MILESTONE_AT_RISK when an upcoming milestone has overdue or blocked tasks', () => {
    const now = new Date();
    const project = createMockProject({
      milestones: [
        {
          id: 'ms-at-risk',
          title: 'Q3 Release Candidate',
          targetDate: new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000),
          completedAt: null,
        },
      ],
      tasks: [
        {
          id: 'ms-t1',
          title: 'Bug fix for milestone',
          status: TaskStatus.BLOCKED,
          priority: Priority.HIGH,
          dueDate: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000),
          startDate: null,
          completedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          assigneeId: null,
          blockedBy: [],
          blocks: [],
        },
      ],
    });

    const risks = riskEngine.detectRisks(project);
    const msRisk = risks.find((r) => r.riskType === 'MILESTONE_AT_RISK');
    expect(msRisk).toBeDefined();
  });

  it('detects UNASSIGNED_HIGH_PRIORITY tasks near due date', () => {
    const now = new Date();
    const project = createMockProject({
      tasks: [
        {
          id: 'unassigned-task',
          title: 'Critical Security Patch',
          status: TaskStatus.TODO,
          priority: Priority.URGENT,
          dueDate: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000),
          startDate: null,
          completedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          assigneeId: null, // Unassigned!
          blockedBy: [],
          blocks: [],
        },
      ],
    });

    const risks = riskEngine.detectRisks(project);
    const unassignedRisk = risks.find((r) => r.riskType === 'UNASSIGNED_HIGH_PRIORITY');
    expect(unassignedRisk).toBeDefined();
    expect(unassignedRisk?.severity).toBe('HIGH');
  });

  it('detects STALE_PROJECT when no activity occurred within threshold', () => {
    const now = new Date();
    const project = createMockProject({
      createdAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      updatedAt: new Date(now.getTime() - 25 * 24 * 60 * 60 * 1000),
      tasks: [
        {
          id: 'stale-t1',
          title: 'Forgotten task',
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,
          dueDate: null,
          startDate: null,
          completedAt: null,
          createdAt: new Date(now.getTime() - 25 * 24 * 60 * 60 * 1000),
          updatedAt: new Date(now.getTime() - 25 * 24 * 60 * 60 * 1000),
          assigneeId: 'user-1',
          blockedBy: [],
          blocks: [],
        },
      ],
      githubEvents: [],
      comments: [],
    });

    const risks = riskEngine.detectRisks(project);
    const staleRisk = risks.find((r) => r.riskType === 'STALE_PROJECT');
    expect(staleRisk).toBeDefined();
  });

  it('detects HIGH_WORKLOAD_UPCOMING when project deadline is approaching with high incomplete work', () => {
    const now = new Date();
    const project = createMockProject({
      dueDate: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000), // Project due in 3 days (<= 7 days)
      tasks: Array.from({ length: 5 }, (_, i) => ({
        id: `overload-t-${i}`,
        title: `Heavy duty ${i}`,
        status: TaskStatus.TODO,
        priority: Priority.MEDIUM,
        dueDate: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
        startDate: null,
        completedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        assigneeId: 'super-busy-user',
        blockedBy: [],
        blocks: [],
      })),
    });

    const risks = riskEngine.detectRisks(project);
    const workloadRisk = risks.find((r) => r.riskType === 'HIGH_WORKLOAD_UPCOMING');
    expect(workloadRisk).toBeDefined();
  });

  it('respects risk dismissal: dismissed risk remains dismissed unless condition worsens', () => {
    const now = new Date();
    const project = createMockProject({
      tasks: [
        {
          id: 't1',
          title: 'Overdue 1',
          status: TaskStatus.TODO,
          priority: Priority.HIGH,
          dueDate: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
          startDate: null,
          completedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          assigneeId: 'u1',
          blockedBy: [],
          blocks: [],
        },
      ],
    });

    // Detect risk first
    const initialRisks = riskEngine.detectRisks(project, [], new Set(), now);
    const initialOverdue = initialRisks.find((r) => r.riskType === 'OVERDUE_TASKS')!;
    expect(initialOverdue).toBeDefined();

    // Mock existing dismissed record matching the fingerprint
    const existingDismissed = [
      {
        fingerprint: initialOverdue.fingerprint,
        status: 'DISMISSED',
        severity: 'HIGH',
        dismissReason: 'Known vendor delay, approved by stakeholder',
        dismissedAt: new Date(now.getTime() - 10000),
        dismissedById: 'user-mgr',
      },
    ];

    // Evaluate risks with existing dismissed record
    const risks = riskEngine.detectRisks(project, [], new Set(), now, existingDismissed);
    const overdueRisk = risks.find((r) => r.riskType === 'OVERDUE_TASKS');
    expect(overdueRisk).toBeDefined();
    expect(overdueRisk?.status).toBe('DISMISSED');
    expect(overdueRisk?.dismissalReason).toBe('Known vendor delay, approved by stakeholder');

    // Condition worsens: second overdue task added
    const worsenedProject = createMockProject({
      tasks: [
        {
          id: 't1',
          title: 'Overdue 1',
          status: TaskStatus.TODO,
          priority: Priority.HIGH,
          dueDate: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
          startDate: null,
          completedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          assigneeId: 'u1',
          blockedBy: [],
          blocks: [],
        },
        {
          id: 't2',
          title: 'Overdue 2',
          status: TaskStatus.TODO,
          priority: Priority.URGENT,
          dueDate: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
          startDate: null,
          completedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          assigneeId: 'u2',
          blockedBy: [],
          blocks: [],
        },
      ],
    });

    const worsenedRisks = riskEngine.detectRisks(worsenedProject, [], new Set(), now, existingDismissed);
    const reactivatedRisk = worsenedRisks.find((r) => r.riskType === 'OVERDUE_TASKS');
    expect(reactivatedRisk).toBeDefined();
    // Because affectedTaskIds changed from ['t1'] to ['t1', 't2'], fingerprint changed, new risk is ACTIVE!
    expect(reactivatedRisk?.status).toBe('ACTIVE');
  });
});

describe('ProjectForecastEngine', () => {
  const forecastEngine = new ProjectForecastEngine();

  it('forecasts ON_TRACK when project velocity is healthy and completion is before deadline', () => {
    const now = new Date();
    const project = createMockProject({
      startDate: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000),
      dueDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      tasks: [
        { id: 'c1', title: 'C1', status: TaskStatus.DONE, priority: Priority.MEDIUM, dueDate: null, startDate: null, completedAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000), createdAt: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000), updatedAt: new Date(), assigneeId: null, blockedBy: [], blocks: [] },
        { id: 'c2', title: 'C2', status: TaskStatus.DONE, priority: Priority.MEDIUM, dueDate: null, startDate: null, completedAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000), createdAt: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000), updatedAt: new Date(), assigneeId: null, blockedBy: [], blocks: [] },
        { id: 'c3', title: 'C3', status: TaskStatus.DONE, priority: Priority.MEDIUM, dueDate: null, startDate: null, completedAt: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000), createdAt: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000), updatedAt: new Date(), assigneeId: null, blockedBy: [], blocks: [] },
        { id: 'r1', title: 'R1', status: TaskStatus.IN_PROGRESS, priority: Priority.MEDIUM, dueDate: null, startDate: null, completedAt: null, createdAt: new Date(), updatedAt: new Date(), assigneeId: null, blockedBy: [], blocks: [] },
        { id: 'r2', title: 'R2', status: TaskStatus.TODO, priority: Priority.MEDIUM, dueDate: null, startDate: null, completedAt: null, createdAt: new Date(), updatedAt: new Date(), assigneeId: null, blockedBy: [], blocks: [] },
      ],
    });

    const forecast = forecastEngine.forecastProject(project);
    expect(forecast.trend).toBe('ON_TRACK');
    expect(forecast.estimatedCompletionDate).not.toBeNull();
    expect(forecast.daysProjectedVariance).not.toBeNull();
    expect(['HIGH', 'MEDIUM']).toContain(forecast.confidence);
  });

  it('forecasts LIKELY_DELAYED when remaining work far exceeds velocity before deadline', () => {
    const now = new Date();
    const project = createMockProject({
      startDate: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      dueDate: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000), // Due in 3 days!
      tasks: [
        { id: 'c1', title: 'C1', status: TaskStatus.DONE, priority: Priority.MEDIUM, dueDate: null, startDate: null, completedAt: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000), createdAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), updatedAt: new Date(), assigneeId: null, blockedBy: [], blocks: [] },
        ...Array.from({ length: 10 }, (_, i) => ({
          id: `r-${i}`,
          title: `Remaining ${i}`,
          status: TaskStatus.TODO,
          priority: Priority.HIGH,
          dueDate: null,
          startDate: null,
          completedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          assigneeId: null,
          blockedBy: [],
          blocks: [],
        })),
      ],
    });

    const forecast = forecastEngine.forecastProject(project);
    expect(forecast.trend).toBe('LIKELY_DELAYED');
    expect(forecast.daysProjectedVariance).toBeGreaterThan(0);
  });

  it('provides transparent heuristic fallback labeled confidence: LOW when data is limited', () => {
    const now = new Date();
    // Zero completed tasks: velocity cannot be computed from historical completions
    const project = createMockProject({
      startDate: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
      dueDate: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000),
      tasks: [
        { id: 't1', title: 'Task 1', status: TaskStatus.TODO, priority: Priority.MEDIUM, dueDate: null, startDate: null, completedAt: null, createdAt: new Date(), updatedAt: new Date(), assigneeId: null, blockedBy: [], blocks: [] },
        { id: 't2', title: 'Task 2', status: TaskStatus.TODO, priority: Priority.MEDIUM, dueDate: null, startDate: null, completedAt: null, createdAt: new Date(), updatedAt: new Date(), assigneeId: null, blockedBy: [], blocks: [] },
      ],
    });

    const forecast = forecastEngine.forecastProject(project);
    expect(forecast.confidence).toBe('LOW');
  });
});

describe('ProjectRecommendationsEngine', () => {
  const recommendationsEngine = new ProjectRecommendationsEngine();
  const riskEngine = new PredictiveRiskEngine();

  it('generates actionable recommendations tailored to detected risks', () => {
    const now = new Date();
    const project = createMockProject({
      tasks: [
        {
          id: 'urgent-blocked',
          title: 'Core database lockup',
          status: TaskStatus.BLOCKED,
          priority: Priority.URGENT,
          dueDate: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
          startDate: null,
          completedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          assigneeId: null,
          blockedBy: [],
          blocks: [{ blockedTaskId: 'child' }],
        },
      ],
    });

    const risks = riskEngine.detectRisks(project);
    const recommendations = recommendationsEngine.generateRecommendations(project, risks);

    expect(recommendations.length).toBeGreaterThan(0);
    const rec = recommendations[0];
    expect(rec.suggestedAction).toBeDefined();
    expect(rec.problemDetected).toBeDefined();
    expect(rec.expectedImpact).toBeDefined();
    expect(rec.relatedEntities.projectId).toBe(project.id);
  });
});

describe('ProjectHealthQueueService', () => {
  it('falls back to synchronous execution when Redis queue is offline', async () => {
    const configService = {
      get: vi.fn().mockReturnValue(undefined), // No REDIS_URL
    };
    const healthService = {
      calculateAndPersistProjectHealth: vi.fn().mockResolvedValue({}),
    };

    const queueService = new ProjectHealthQueueService(
      configService as any,
      healthService as any,
    );
    await queueService.onModuleInit();

    await queueService.enqueueProjectRecalculation('org-1', 'proj-1', false);

    expect(healthService.calculateAndPersistProjectHealth).toHaveBeenCalledWith(
      'org-1',
      'proj-1',
      false,
    );
  });

  it('uses deduplicated jobId health-calc-${projectId} when adding to queue', async () => {
    const addMock = vi.fn().mockResolvedValue({});
    const queueService = new ProjectHealthQueueService(
      { get: vi.fn() } as any,
      {} as any,
    );
    (queueService as any).queue = { add: addMock };

    await queueService.enqueueProjectRecalculation('org-1', 'proj-42', true);

    expect(addMock).toHaveBeenCalledWith(
      'project-recalculation',
      { organizationId: 'org-1', projectId: 'proj-42', forceSnapshot: true },
      expect.objectContaining({
        jobId: 'health-calc-proj-42',
      }),
    );
  });
});
