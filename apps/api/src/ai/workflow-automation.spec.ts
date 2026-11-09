import { describe, expect, it } from 'vitest';
import { Priority, TaskStatus, WorkflowActionType, WorkflowTriggerType } from '@prisma/client';
import {
  AutomationEventContext,
  WorkflowAutomationEngine,
} from './workflow-automation.engine';

describe('WorkflowAutomationEngine Unit Tests', () => {
  const baseContext: AutomationEventContext = {
    trigger: WorkflowTriggerType.TASK_OVERDUE,
    organizationId: 'org-123',
    projectId: 'proj-123',
    projectName: 'NEXORA Core',
    projectOwnerId: 'user-lead',
    task: {
      id: 'task-1',
      projectId: 'proj-123',
      projectName: 'NEXORA Core',
      title: 'Fix Redis Connection Pooling',
      status: TaskStatus.TODO,
      priority: Priority.URGENT,
      dueDate: new Date('2026-11-05T00:00:00Z'),
      assigneeId: 'user-dev-1',
      assigneeName: 'Alex Developer',
    },
    now: new Date('2026-11-09T12:00:00Z'),
  };

  describe('Condition matching (checkConditions)', () => {
    it('returns true when no conditions are set', () => {
      expect(WorkflowAutomationEngine.checkConditions({}, baseContext)).toBe(true);
      expect(WorkflowAutomationEngine.checkConditions(null, baseContext)).toBe(true);
      expect(WorkflowAutomationEngine.checkConditions(undefined, baseContext)).toBe(true);
    });

    it('matches when project id matches', () => {
      expect(
        WorkflowAutomationEngine.checkConditions(
          { projectId: 'proj-123' },
          baseContext,
        ),
      ).toBe(true);

      expect(
        WorkflowAutomationEngine.checkConditions(
          { projectId: 'foreign-proj' },
          baseContext,
        ),
      ).toBe(false);
    });

    it('matches when priority condition matches task priority', () => {
      expect(
        WorkflowAutomationEngine.checkConditions(
          { priority: Priority.URGENT },
          baseContext,
        ),
      ).toBe(true);

      expect(
        WorkflowAutomationEngine.checkConditions(
          { priority: Priority.LOW },
          baseContext,
        ),
      ).toBe(false);
    });

    it('matches when task status matches', () => {
      expect(
        WorkflowAutomationEngine.checkConditions(
          { status: TaskStatus.TODO },
          baseContext,
        ),
      ).toBe(true);

      expect(
        WorkflowAutomationEngine.checkConditions(
          { status: TaskStatus.DONE },
          baseContext,
        ),
      ).toBe(false);
    });

    it('evaluates minDaysOverdue correctly', () => {
      // Due Nov 5, now Nov 9 -> 4 days overdue
      expect(
        WorkflowAutomationEngine.checkConditions(
          { minDaysOverdue: 2 },
          baseContext,
          new Date('2026-11-09T12:00:00Z'),
        ),
      ).toBe(true);

      expect(
        WorkflowAutomationEngine.checkConditions(
          { minDaysOverdue: 5 },
          baseContext,
          new Date('2026-11-09T12:00:00Z'),
        ),
      ).toBe(false);
    });

    it('evaluates project health classification condition', () => {
      const healthContext: AutomationEventContext = {
        ...baseContext,
        trigger: WorkflowTriggerType.PROJECT_HEALTH_AT_RISK,
        projectHealth: {
          score: 55,
          classification: 'AT_RISK',
          activeRisksCount: 3,
        },
      };

      expect(
        WorkflowAutomationEngine.checkConditions(
          { healthClassification: 'AT_RISK' },
          healthContext,
        ),
      ).toBe(true);

      expect(
        WorkflowAutomationEngine.checkConditions(
          { healthClassification: 'CRITICAL' },
          healthContext,
        ),
      ).toBe(false);
    });

    it('handles missing task or health context safely without throwing', () => {
      const sparseContext: AutomationEventContext = {
        trigger: WorkflowTriggerType.TASK_CREATED,
        organizationId: 'org-123',
      };

      expect(
        WorkflowAutomationEngine.checkConditions(
          { priority: Priority.HIGH },
          sparseContext,
        ),
      ).toBe(false);

      expect(
        WorkflowAutomationEngine.checkConditions(
          { healthClassification: 'CRITICAL' },
          sparseContext,
        ),
      ).toBe(false);

      expect(
        WorkflowAutomationEngine.checkConditions(
          { minDaysOverdue: 1 },
          sparseContext,
        ),
      ).toBe(false);
    });
  });

  describe('Action proposal generation (generateActionProposal)', () => {
    it('generates AI_TASK_RECOMMENDATION for blocked tasks with mitigation guidance', () => {
      const blockedContext: AutomationEventContext = {
        ...baseContext,
        trigger: WorkflowTriggerType.TASK_MARKED_BLOCKED,
        task: {
          ...baseContext.task!,
          status: TaskStatus.BLOCKED,
        },
      };

      const proposal = WorkflowAutomationEngine.generateActionProposal(
        WorkflowActionType.AI_TASK_RECOMMENDATION,
        blockedContext,
      );

      expect(proposal.action).toBe(WorkflowActionType.AI_TASK_RECOMMENDATION);
      expect(proposal.title).toContain('AI Task Recommendation');
      expect(proposal.explanation).toContain('BLOCKED');
      expect(proposal.payload.taskId).toBe('task-1');
      expect(proposal.requiresApproval).toBe(true);
    });

    it('generates RECOMMEND_TASK_ASSIGNEE selecting the member with lowest workload', () => {
      const assignContext: AutomationEventContext = {
        ...baseContext,
        roster: [
          { id: 'user-busy', name: 'Busy Engineer', email: 'busy@nexora.test', role: 'MEMBER' },
          { id: 'user-free', name: 'Free Engineer', email: 'free@nexora.test', role: 'MEMBER' },
        ],
        workspaceTasks: [
          { id: 't1', assigneeId: 'user-busy', status: TaskStatus.IN_PROGRESS, priority: Priority.HIGH },
          { id: 't2', assigneeId: 'user-busy', status: TaskStatus.TODO, priority: Priority.MEDIUM },
        ],
      };

      const proposal = WorkflowAutomationEngine.generateActionProposal(
        WorkflowActionType.RECOMMEND_TASK_ASSIGNEE,
        assignContext,
      );

      expect(proposal.action).toBe(WorkflowActionType.RECOMMEND_TASK_ASSIGNEE);
      expect(proposal.payload.assigneeId).toBe('user-free');
      expect(proposal.payload.assigneeName).toBe('Free Engineer');
      expect(proposal.explanation).toContain('Free Engineer');
      expect(proposal.requiresApproval).toBe(true);
    });

    it('generates NOTIFY_PROJECT_MANAGER with contextual alert payload', () => {
      const proposal = WorkflowAutomationEngine.generateActionProposal(
        WorkflowActionType.NOTIFY_PROJECT_MANAGER,
        baseContext,
      );

      expect(proposal.action).toBe(WorkflowActionType.NOTIFY_PROJECT_MANAGER);
      expect(proposal.payload.recipientId).toBe('user-lead');
      expect(proposal.payload.title).toContain('Fix Redis Connection Pooling');
      expect(proposal.payload.title).toContain('is overdue');
    });

    it('generates GENERATE_HEALTH_SUMMARY with diagnostic brief', () => {
      const healthContext: AutomationEventContext = {
        ...baseContext,
        projectHealth: {
          score: 62,
          classification: 'AT_RISK',
          activeRisksCount: 2,
        },
      };

      const proposal = WorkflowAutomationEngine.generateActionProposal(
        WorkflowActionType.GENERATE_HEALTH_SUMMARY,
        healthContext,
      );

      expect(proposal.action).toBe(WorkflowActionType.GENERATE_HEALTH_SUMMARY);
      expect(proposal.payload.score).toBe(62);
      expect(proposal.payload.summary).toContain('health stands at 62/100 (AT_RISK)');
    });

    it('generates CREATE_TASK_PROPOSAL with target updates', () => {
      const proposal = WorkflowAutomationEngine.generateActionProposal(
        WorkflowActionType.CREATE_TASK_PROPOSAL,
        baseContext,
        { targetStatus: TaskStatus.IN_PROGRESS, targetPriority: Priority.URGENT },
      );

      expect(proposal.action).toBe(WorkflowActionType.CREATE_TASK_PROPOSAL);
      expect(proposal.payload.targetStatus).toBe(TaskStatus.IN_PROGRESS);
      expect(proposal.payload.targetPriority).toBe(Priority.URGENT);
    });
  });

  describe('Deduplication key generation (buildDedupeKey)', () => {
    it('produces deterministic date-bucketed dedupe keys', () => {
      const date = new Date('2026-11-09T10:00:00Z');
      const key1 = WorkflowAutomationEngine.buildDedupeKey(
        'rule-abc',
        WorkflowTriggerType.TASK_OVERDUE,
        'task-1',
        date,
      );
      const key2 = WorkflowAutomationEngine.buildDedupeKey(
        'rule-abc',
        WorkflowTriggerType.TASK_OVERDUE,
        'task-1',
        date,
      );

      expect(key1).toBe('rule-abc:TASK_OVERDUE:task-1:2026-11-09');
      expect(key1).toBe(key2);
    });

    it('produces distinct keys for different entities or triggers', () => {
      const date = new Date('2026-11-09T10:00:00Z');
      const k1 = WorkflowAutomationEngine.buildDedupeKey('rule-1', WorkflowTriggerType.TASK_OVERDUE, 'task-1', date);
      const k2 = WorkflowAutomationEngine.buildDedupeKey('rule-1', WorkflowTriggerType.TASK_MARKED_BLOCKED, 'task-1', date);
      const k3 = WorkflowAutomationEngine.buildDedupeKey('rule-1', WorkflowTriggerType.TASK_OVERDUE, 'task-2', date);

      expect(k1).not.toBe(k2);
      expect(k1).not.toBe(k3);
    });
  });
});
