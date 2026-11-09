import { describe, expect, it } from 'vitest';
import { Priority, TaskStatus } from '@prisma/client';
import { RawProjectData, WeeklyReportEngine } from './weekly-reports.engine';
import { WeeklyReportPdfGenerator } from './weekly-reports.pdf';

describe('WeeklyReportEngine Unit Tests', () => {
  const mockNow = new Date('2026-11-09T12:00:00Z');
  const weekAgo = new Date('2026-11-02T12:00:00Z');

  const sampleProjectData: RawProjectData = {
    id: 'proj-123',
    name: 'NEXORA Cloud Engine',
    description: 'Enterprise multi-tenant orchestration layer',
    tasks: [
      {
        id: 't-1',
        title: 'Complete Distributed Lock Handler',
        status: TaskStatus.DONE,
        priority: Priority.HIGH,
        createdAt: new Date('2026-10-25T10:00:00Z'),
        completedAt: new Date('2026-11-05T15:00:00Z'), // Completed this period!
        assigneeId: 'u-1',
        assignee: { id: 'u-1', name: 'Alex Lead', email: 'alex@nexora.test' },
      },
      {
        id: 't-2',
        title: 'Legacy Redis Cleanup',
        status: TaskStatus.DONE,
        priority: Priority.LOW,
        createdAt: new Date('2026-10-10T10:00:00Z'),
        completedAt: new Date('2026-10-20T10:00:00Z'), // Completed before this period
        assigneeId: 'u-2',
        assignee: { id: 'u-2', name: 'Sam Dev', email: 'sam@nexora.test' },
      },
      {
        id: 't-3',
        title: 'Implement Tenant Storage Quotas',
        status: TaskStatus.IN_PROGRESS,
        priority: Priority.URGENT,
        createdAt: new Date('2026-11-03T09:00:00Z'), // Created this period!
        dueDate: new Date('2026-11-06T18:00:00Z'), // Overdue!
        assigneeId: 'u-1',
        assignee: { id: 'u-1', name: 'Alex Lead', email: 'alex@nexora.test' },
      },
      {
        id: 't-4',
        title: 'Fix Database Connection Exhaustion',
        status: TaskStatus.BLOCKED,
        priority: Priority.URGENT,
        createdAt: new Date('2026-11-04T11:00:00Z'), // Created this period!
        dueDate: new Date('2026-11-12T18:00:00Z'),
        assigneeId: 'u-2',
        assignee: { id: 'u-2', name: 'Sam Dev', email: 'sam@nexora.test' },
        blockedBy: [
          { blockingTask: { id: 't-5', title: 'PostgreSQL Pool Tuning', status: TaskStatus.IN_PROGRESS } },
        ],
      },
      {
        id: 't-5',
        title: 'PostgreSQL Pool Tuning',
        status: TaskStatus.IN_PROGRESS,
        priority: Priority.HIGH,
        createdAt: new Date('2026-11-01T10:00:00Z'),
        dueDate: new Date('2026-11-10T18:00:00Z'),
        assigneeId: null, // Unassigned high-priority!
      },
    ],
    milestones: [
      {
        id: 'm-1',
        title: 'Alpha Architecture Freeze',
        completedAt: new Date('2026-10-30T10:00:00Z'),
      },
      {
        id: 'm-2',
        title: 'Beta Security Audit',
        targetDate: new Date('2026-11-15T18:00:00Z'), // Approaching within 14 days!
        completedAt: null,
      },
    ],
    healthSnapshot: {
      score: 65,
      classification: 'AT_RISK',
      explanation: 'Active blocked task on critical path',
    },
    activeRisks: [
      {
        id: 'r-1',
        title: 'Database connection pool starvation risk',
        severity: 'HIGH',
        recommendedAction: 'Increase PgBouncer pool sizing',
      },
    ],
    meetings: [
      {
        id: 'mtg-1',
        title: 'Weekly Core Standup',
        startsAt: new Date('2026-11-04T14:00:00Z'),
        decisions: [{ id: 'd-1', title: 'Enforce PgBouncer on all microservices' }],
        actionItems: [{ id: 'a-1', title: 'Update Helm chart config', status: 'PENDING' }],
      },
    ],
    roster: [
      { id: 'u-1', name: 'Alex Lead', email: 'alex@nexora.test', role: 'ADMIN' },
      { id: 'u-2', name: 'Sam Dev', email: 'sam@nexora.test', role: 'MEMBER' },
    ],
  };

  describe('Period Resolution', () => {
    it('defaults to a 7-day backward window from current time when unprovided', () => {
      const { periodStart, periodEnd } = WeeklyReportEngine.resolvePeriod(null, null, mockNow);
      expect(periodEnd.toISOString()).toBe(mockNow.toISOString());
      expect(periodEnd.getTime() - periodStart.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
    });

    it('respects explicitly provided period boundaries', () => {
      const customStart = new Date('2026-11-01T00:00:00Z');
      const customEnd = new Date('2026-11-08T00:00:00Z');
      const { periodStart, periodEnd } = WeeklyReportEngine.resolvePeriod(customStart, customEnd);
      expect(periodStart.toISOString()).toBe(customStart.toISOString());
      expect(periodEnd.toISOString()).toBe(customEnd.toISOString());
    });
  });

  describe('Deterministic Metrics Calculations', () => {
    it('accurately counts tasks, completions in period, overdue items and completion percentage', () => {
      const metrics = WeeklyReportEngine.calculateMetrics(sampleProjectData, weekAgo, mockNow);

      expect(metrics.totalTasks).toBe(5);
      expect(metrics.completedTasks).toBe(2);
      expect(metrics.completedThisPeriod).toBe(1); // t-1 only
      expect(metrics.createdThisPeriod).toBe(2); // t-3 and t-4
      expect(metrics.pendingTasks).toBe(3); // t-3, t-4, t-5
      expect(metrics.overdueTasks).toBe(1); // t-3 overdue
      expect(metrics.blockedTasks).toBe(1); // t-4 blocked
      expect(metrics.completionRate).toBe(40); // 2 of 5 = 40%
      expect(metrics.milestonesTotal).toBe(2);
      expect(metrics.milestonesCompleted).toBe(1);
      expect(metrics.milestonesApproaching).toBe(1); // m-2 on Nov 15 is within 14 days
      expect(metrics.healthClassification).toBe('AT_RISK');
      expect(metrics.healthScore).toBe(65);
    });

    it('handles project with zero tasks gracefully without NaN or errors', () => {
      const emptyProject: RawProjectData = {
        id: 'proj-empty',
        name: 'Empty Project',
        tasks: [],
        milestones: [],
      };
      const metrics = WeeklyReportEngine.calculateMetrics(emptyProject, weekAgo, mockNow);
      expect(metrics.totalTasks).toBe(0);
      expect(metrics.completedTasks).toBe(0);
      expect(metrics.completionRate).toBe(0);
      expect(metrics.pendingTasks).toBe(0);
      expect(metrics.overdueTasks).toBe(0);
      expect(metrics.healthClassification).toBe('ON_TRACK');
    });
  });

  describe('Workload Aggregation', () => {
    it('aggregates workload per roster member and flags unassigned high-priority work', () => {
      const workload = WeeklyReportEngine.aggregateWorkload(sampleProjectData, weekAgo, mockNow);

      expect(workload.members.length).toBe(2);

      const alex = workload.members.find(m => m.memberId === 'u-1');
      expect(alex).toBeDefined();
      expect(alex!.assignedCount).toBe(2); // t-1 (done), t-3 (active)
      expect(alex!.activeCount).toBe(1); // t-3
      expect(alex!.completedThisPeriod).toBe(1); // t-1
      expect(alex!.overdueCount).toBe(1); // t-3

      const sam = workload.members.find(m => m.memberId === 'u-2');
      expect(sam).toBeDefined();
      expect(sam!.assignedCount).toBe(2); // t-2, t-4
      expect(sam!.activeCount).toBe(1); // t-4

      // t-5 is unassigned with priority HIGH
      expect(workload.unassignedHighPriorityCount).toBe(1);
    });
  });

  describe('Grounded Executive Summary and Recommendations', () => {
    it('generates grounded executive summary reflecting actual numbers and health', () => {
      const metrics = WeeklyReportEngine.calculateMetrics(sampleProjectData, weekAgo, mockNow);
      const summary = WeeklyReportEngine.generateExecutiveSummary(sampleProjectData, metrics, weekAgo, mockNow);

      expect(summary).toContain('NEXORA Cloud Engine');
      expect(summary).toContain('40%');
      expect(summary).toContain('1 task this week');
      expect(summary).toContain('1 currently blocked task');
      expect(summary).toContain('1 overdue item');
      expect(summary).toContain('AT_RISK');
    });

    it('generates grounded recommendations targeting specific blocked and overdue tasks', () => {
      const metrics = WeeklyReportEngine.calculateMetrics(sampleProjectData, weekAgo, mockNow);
      const workload = WeeklyReportEngine.aggregateWorkload(sampleProjectData, weekAgo, mockNow);
      const recommendations = WeeklyReportEngine.generateRecommendations(sampleProjectData, metrics, workload);

      expect(recommendations.length).toBeGreaterThanOrEqual(3);

      // Blocker recommendation
      const blockerRec = recommendations.find(r => r.category === 'DELIVERY');
      expect(blockerRec).toBeDefined();
      expect(blockerRec!.title).toContain('Fix Database Connection Exhaustion');
      expect(blockerRec!.rationale).toContain('PostgreSQL Pool Tuning');

      // Overdue recommendation
      const overdueRec = recommendations.find(r => r.category === 'RISK');
      expect(overdueRec).toBeDefined();
      expect(overdueRec!.title).toContain('Implement Tenant Storage Quotas');

      // Unassigned recommendation
      const capacityRec = recommendations.find(r => r.category === 'CAPACITY');
      expect(capacityRec).toBeDefined();
      expect(capacityRec!.title).toContain('Assign Owners to 1 High-Priority Task');
    });
  });

  describe('Full Structured Report Assembly', () => {
    it('assembles complete report data object with meeting insights and progress', () => {
      const report = WeeklyReportEngine.buildStructuredReport(sampleProjectData, weekAgo, mockNow);

      expect(report.projectId).toBe('proj-123');
      expect(report.projectName).toBe('NEXORA Cloud Engine');
      expect(report.metrics.completionRate).toBe(40);
      expect(report.progressOverview.completedTasks.length).toBe(1);
      expect(report.blockersAndRisks.blockedTasks.length).toBe(1);
      expect(report.blockersAndRisks.overdueTasks.length).toBe(1);
      expect(report.blockersAndRisks.projectRisks.length).toBe(1);
      expect(report.meetingInsights.decisionsCount).toBe(1);
      expect(report.meetingInsights.openActionItemsCount).toBe(1);
      expect(report.recommendations.length).toBeGreaterThan(0);
    });
  });

  describe('PDF Generation', () => {
    it('successfully compiles structured report data into a binary PDF buffer', async () => {
      const report = WeeklyReportEngine.buildStructuredReport(sampleProjectData, weekAgo, mockNow);
      const pdfBuffer = await WeeklyReportPdfGenerator.generate(report);

      expect(pdfBuffer).toBeInstanceOf(Buffer);
      expect(pdfBuffer.length).toBeGreaterThan(1000);
      // Verify PDF file signature (%PDF-)
      expect(pdfBuffer.toString('utf8', 0, 5)).toBe('%PDF-');
    });
  });
});
