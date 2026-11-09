import { describe, expect, it } from 'vitest';
import { OrganizationRole, Priority, TaskStatus } from '@prisma/client';
import {
  AssigneeCandidate,
  extractDomainKeywords,
  TaskAssignmentContext,
  TaskAssignmentEngine,
} from './task-assignment.engine';

describe('TaskAssignmentEngine (Release 4.2.2 Smart Task Assignment)', () => {
  const candidate1: AssigneeCandidate = {
    id: 'user-1',
    name: 'Alice Dev',
    email: 'alice@nexora.local',
    role: OrganizationRole.TEAM_MEMBER,
  };

  const candidate2: AssigneeCandidate = {
    id: 'user-2',
    name: 'Bob Lead',
    email: 'bob@nexora.local',
    role: OrganizationRole.PROJECT_MANAGER,
  };

  const candidate3: AssigneeCandidate = {
    id: 'user-3',
    name: 'Charlie Admin',
    email: 'charlie@nexora.local',
    role: OrganizationRole.ADMIN,
  };

  const candidateViewer: AssigneeCandidate = {
    id: 'user-viewer',
    name: 'Dave Viewer',
    email: 'dave@nexora.local',
    role: OrganizationRole.VIEWER,
  };

  it('extracts domain keywords excluding stop words and includes normalized labels', () => {
    const keywords = extractDomainKeywords(
      'Implement OAuth2 authentication and user session management for the project',
      ['Backend', 'Security']
    );

    expect(keywords).toContain('oauth2');
    expect(keywords).toContain('authentication');
    expect(keywords).toContain('session');
    expect(keywords).toContain('backend');
    expect(keywords).toContain('security');
    expect(keywords).not.toContain('the');
    expect(keywords).not.toContain('and');
    expect(keywords).not.toContain('for');
  });

  it('prioritizes candidates with lower active workload and higher capacity', () => {
    const context: TaskAssignmentContext = {
      task: {
        id: 'target-task-1',
        projectId: 'project-1',
        projectName: 'Mobile App',
        title: 'Design API endpoints',
        priority: Priority.HIGH,
        dueDate: new Date(Date.now() + 86400000 * 5),
        labels: ['api'],
      },
      candidates: [candidate1, candidate2],
      workspaceTasks: [
        // Bob has 5 active tasks
        { id: 't1', projectId: 'project-1', assigneeId: 'user-2', title: 'Task 1', status: TaskStatus.IN_PROGRESS, priority: Priority.MEDIUM },
        { id: 't2', projectId: 'project-1', assigneeId: 'user-2', title: 'Task 2', status: TaskStatus.IN_PROGRESS, priority: Priority.MEDIUM },
        { id: 't3', projectId: 'project-1', assigneeId: 'user-2', title: 'Task 3', status: TaskStatus.TODO, priority: Priority.MEDIUM },
        { id: 't4', projectId: 'project-1', assigneeId: 'user-2', title: 'Task 4', status: TaskStatus.TODO, priority: Priority.MEDIUM },
        { id: 't5', projectId: 'project-1', assigneeId: 'user-2', title: 'Task 5', status: TaskStatus.BLOCKED, priority: Priority.MEDIUM },
        // Alice has 0 active tasks
      ],
    };

    const result = TaskAssignmentEngine.analyzeAndRecommend(context);

    expect(result.recommendations.length).toBe(2);
    const aliceRec = result.recommendations.find(r => r.candidate.id === 'user-1')!;
    const bobRec = result.recommendations.find(r => r.candidate.id === 'user-2')!;

    expect(aliceRec.breakdown.workloadCapacityScore).toBeGreaterThan(bobRec.breakdown.workloadCapacityScore);
    expect(aliceRec.reasons.some(r => r.includes('Optimal availability'))).toBe(true);
    expect(bobRec.concerns.some(c => c.includes('Heavy active workload') || c.includes('5 ongoing tasks'))).toBe(true);
    expect(result.recommendations[0].candidate.id).toBe('user-1'); // Alice ranked first
  });

  it('detects schedule conflicts and penalizes direct deadline clashes', () => {
    const targetDue = new Date(Date.now() + 86400000 * 3);

    const context: TaskAssignmentContext = {
      task: {
        id: 'target-task-clash',
        projectId: 'project-1',
        title: 'Deploy microservice',
        priority: Priority.MEDIUM,
        dueDate: targetDue,
      },
      candidates: [candidate1, candidate2],
      workspaceTasks: [
        // Alice has a task due on the exact same date
        {
          id: 't-clash',
          projectId: 'project-1',
          assigneeId: 'user-1',
          title: 'Existing deploy deliverable',
          status: TaskStatus.IN_PROGRESS,
          priority: Priority.MEDIUM,
          dueDate: targetDue,
        },
        // Bob has a task due 10 days later
        {
          id: 't-clear',
          projectId: 'project-1',
          assigneeId: 'user-2',
          title: 'Future documentation',
          status: TaskStatus.IN_PROGRESS,
          priority: Priority.MEDIUM,
          dueDate: new Date(Date.now() + 86400000 * 13),
        },
      ],
    };

    const result = TaskAssignmentEngine.analyzeAndRecommend(context);
    const aliceRec = result.recommendations.find(r => r.candidate.id === 'user-1')!;
    const bobRec = result.recommendations.find(r => r.candidate.id === 'user-2')!;

    expect(aliceRec.breakdown.scheduleCompatibilityScore).toBeLessThan(bobRec.breakdown.scheduleCompatibilityScore);
    expect(aliceRec.concerns.some(c => c.includes('Deadline clash'))).toBe(true);
    expect(bobRec.reasons.some(r => r.includes('Schedule clear'))).toBe(true);
  });

  it('penalizes candidates with overdue tasks and reports capacity risk', () => {
    const overdueDate = new Date(Date.now() - 86400000 * 2); // 2 days ago

    const context: TaskAssignmentContext = {
      task: {
        id: 'target-task-overdue',
        projectId: 'project-1',
        title: 'Security audit checklist',
        priority: Priority.URGENT,
      },
      candidates: [candidate1, candidate2],
      workspaceTasks: [
        // Alice has 1 overdue task
        {
          id: 't-overdue',
          projectId: 'project-1',
          assigneeId: 'user-1',
          title: 'Unfinished migration',
          status: TaskStatus.IN_PROGRESS,
          priority: Priority.HIGH,
          dueDate: overdueDate,
        },
        // Bob has 1 normal on-track task
        {
          id: 't-ontrack',
          projectId: 'project-1',
          assigneeId: 'user-2',
          title: 'Future task',
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,
          dueDate: new Date(Date.now() + 86400000 * 7),
        },
      ],
    };

    const result = TaskAssignmentEngine.analyzeAndRecommend(context);
    const aliceRec = result.recommendations.find(r => r.candidate.id === 'user-1')!;

    expect(aliceRec.workload.overdueTasks).toBe(1);
    expect(aliceRec.concerns.some(c => c.includes('Capacity risk') && c.includes('overdue'))).toBe(true);
  });

  it('matches candidates by historical domain experience and skill labels', () => {
    const context: TaskAssignmentContext = {
      task: {
        id: 'target-task-domain',
        projectId: 'project-1',
        title: 'Setup Redis caching layer and pub-sub queues',
        description: 'Configure Redis connection pool and key expiration policies',
        priority: Priority.MEDIUM,
        labels: ['redis', 'caching', 'infrastructure'],
      },
      candidates: [candidate1, candidate2],
      workspaceTasks: [
        // Alice previously completed Redis and caching tasks
        {
          id: 'hist-1',
          projectId: 'project-1',
          assigneeId: 'user-1',
          title: 'Migrate caching to Redis cluster',
          description: 'Optimized key-value storage',
          status: TaskStatus.DONE,
          priority: Priority.HIGH,
          labels: ['redis', 'performance'],
        },
        // Bob has only UI styling tasks
        {
          id: 'hist-2',
          projectId: 'project-1',
          assigneeId: 'user-2',
          title: 'Adjust button styling and CSS theme',
          status: TaskStatus.DONE,
          priority: Priority.LOW,
          labels: ['css', 'frontend'],
        },
      ],
    };

    const result = TaskAssignmentEngine.analyzeAndRecommend(context);
    const aliceRec = result.recommendations.find(r => r.candidate.id === 'user-1')!;
    const bobRec = result.recommendations.find(r => r.candidate.id === 'user-2')!;

    expect(aliceRec.breakdown.domainSkillScore).toBeGreaterThan(bobRec.breakdown.domainSkillScore);
    expect(aliceRec.reasons.some(r => r.includes('domain experience') && r.includes('redis'))).toBe(true);
    expect(bobRec.reasons.some(r => r.includes('Available for assignment') && r.includes('no prior task history'))).toBe(true);
  });

  it('excludes VIEWER members from assignment recommendations', () => {
    const context: TaskAssignmentContext = {
      task: {
        id: 'target-task-viewer',
        projectId: 'project-1',
        title: 'Review analytics dashboard',
        priority: Priority.MEDIUM,
      },
      candidates: [candidate1, candidateViewer],
      workspaceTasks: [],
    };

    const result = TaskAssignmentEngine.analyzeAndRecommend(context);

    expect(result.totalEligibleMembers).toBe(1);
    expect(result.recommendations.some(r => r.candidate.id === 'user-viewer')).toBe(false);
    expect(result.recommendations[0].candidate.id).toBe('user-1');
  });

  it('caps recommendations at top 3 while reporting total eligible count', () => {
    const candidate4: AssigneeCandidate = { id: 'u4', name: 'Member 4', email: 'm4@test.com', role: OrganizationRole.TEAM_MEMBER };
    const candidate5: AssigneeCandidate = { id: 'u5', name: 'Member 5', email: 'm5@test.com', role: OrganizationRole.TEAM_MEMBER };

    const context: TaskAssignmentContext = {
      task: {
        id: 'target-task-top3',
        projectId: 'project-1',
        title: 'Quarterly review report',
        priority: Priority.MEDIUM,
      },
      candidates: [candidate1, candidate2, candidate3, candidate4, candidate5],
      workspaceTasks: [],
    };

    const result = TaskAssignmentEngine.analyzeAndRecommend(context);

    expect(result.totalEligibleMembers).toBe(5);
    expect(result.recommendations.length).toBe(3);
  });

  it('flags missing information when task lacks due date or skill details', () => {
    const context: TaskAssignmentContext = {
      task: {
        id: 'target-task-nodate',
        projectId: 'project-1',
        title: 'Quick fix',
        priority: Priority.LOW,
        dueDate: null,
        labels: [],
        description: '',
      },
      candidates: [candidate1],
      workspaceTasks: [],
    };

    const result = TaskAssignmentEngine.analyzeAndRecommend(context);

    expect(result.missingInfo.some(m => m.includes('no due date set'))).toBe(true);
    expect(result.missingInfo.some(m => m.includes('no skill labels and minimal description'))).toBe(true);
  });
});
