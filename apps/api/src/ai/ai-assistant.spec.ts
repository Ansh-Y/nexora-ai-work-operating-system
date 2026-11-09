import { describe, expect, it } from 'vitest';
import { Priority } from '@prisma/client';
import { AiAssistantEngine, AssistantContext } from './ai-assistant.engine';

describe('AiAssistantEngine — Release 4.2.1 AI Project Assistant', () => {
  const MOCK_CONTEXT: AssistantContext = {
    organizationId: 'ws-111',
    workspaceId: 'ws-111',
    workspaceName: 'Acme Workspace',
    project: {
      id: 'proj-100',
      name: 'Product Launch 2026',
      description: 'Q1 flagship platform launch and market rollout.',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      startDate: '2026-01-01T00:00:00.000Z',
      dueDate: '2026-03-31T00:00:00.000Z',
      owner: { id: 'u-1', name: 'Alex Morgan', email: 'alex@acme.com' },
    },
    tasks: [
      {
        id: 'task-1',
        title: 'Design high-converting landing page',
        description: 'Create responsive Figma layouts and desktop assets.',
        status: 'COMPLETED',
        priority: Priority.HIGH,
        startDate: null,
        dueDate: '2026-01-15T00:00:00.000Z',
        assignee: { id: 'u-1', name: 'Sarah Miller' },
        blockedBy: [],
        blocks: [],
        labels: [],
      },
      {
        id: 'task-2',
        title: 'PCI-DSS Compliance Certification',
        description: 'Complete security audit with external auditor.',
        status: 'IN_PROGRESS',
        priority: Priority.URGENT,
        startDate: null,
        dueDate: '2026-01-20T00:00:00.000Z', // Overdue
        assignee: { id: 'u-2', name: 'Alex Chen' },
        blockedBy: [],
        blocks: [{ id: 'task-3', title: 'Stripe Payment Gateway Integration', status: 'BLOCKED' }],
        labels: [],
      },
      {
        id: 'task-3',
        title: 'Stripe Payment Gateway Integration',
        description: 'Connect checkout API, webhooks and refund handling.',
        status: 'BLOCKED',
        priority: Priority.URGENT,
        startDate: null,
        dueDate: '2026-01-25T00:00:00.000Z', // Overdue
        assignee: { id: 'u-3', name: 'Jordan Taylor' },
        blockedBy: [{ id: 'task-2', title: 'PCI-DSS Compliance Certification', status: 'IN_PROGRESS' }],
        blocks: [],
        labels: [],
      },
      {
        id: 'task-4',
        title: 'Customer Onboarding Sequence Emails',
        description: 'Set up welcome emails and engagement flows.',
        status: 'TODO',
        priority: Priority.MEDIUM,
        startDate: null,
        dueDate: '2026-04-10T00:00:00.000Z',
        assignee: { id: 'u-1', name: 'Sarah Miller' },
        blockedBy: [],
        blocks: [],
        labels: [],
      },
    ],
    milestones: [
      {
        id: 'ms-1',
        title: 'Design Freeze & Brand Approval',
        description: 'Sign off on UI mocks and brand assets.',
        targetDate: '2026-01-10T00:00:00.000Z',
        completedAt: '2026-01-10T12:00:00.000Z',
      },
      {
        id: 'ms-2',
        title: 'Payment Integration & Security Sign-off',
        description: 'Stripe gateway integration and audit compliance.',
        targetDate: '2026-02-15T00:00:00.000Z',
        completedAt: null,
      },
      {
        id: 'ms-3',
        title: 'Public GA Launch',
        description: 'General availability platform rollout.',
        targetDate: '2026-03-31T00:00:00.000Z',
        completedAt: null,
      },
    ],
    meetings: [
      {
        id: 'mtg-1',
        title: 'Weekly Executive Launch Readiness Sync',
        startsAt: '2026-02-01T10:00:00.000Z',
        status: 'COMPLETED',
        summary: 'Discussed critical blocker on PCI compliance affecting payment gateway completion.',
        decisions: ['Agreed to expedite auditor review'],
        actionItems: [
          'Alex to expedite external auditor review by Friday.',
          'Jordan to prepare sandbox test cards pending certification sign-off.',
        ],
      },
    ],
    health: {
      score: 54,
      classification: 'AT_RISK',
      dataCompleteness: 100,
      activeRisksCount: { total: 2, critical: 1, high: 1, medium: 0, low: 0 },
      risks: [
        {
          id: 'risk-1',
          riskType: 'SCHEDULE_DELAY',
          severity: 'HIGH',
          title: 'Schedule Risk: Overdue critical path dependencies',
          explanation: 'Overdue critical path dependencies blocking payment integration.',
          recommendedAction: 'Prioritize PCI-DSS Compliance Certification to unblock payment integration.',
          affectedTaskIds: ['task-2', 'task-3'],
        },
        {
          id: 'risk-2',
          riskType: 'DEPENDENCY_BOTTLENECK',
          severity: 'HIGH',
          title: 'Dependency Risk',
          explanation: 'Task-3 is blocked by Task-2.',
          recommendedAction: 'Reallocate engineering bandwidth to overdue critical path tasks.',
          affectedTaskIds: ['task-3'],
        },
      ],
      forecast: {
        trend: 'DEGRADING',
        estimatedCompletionDate: '2026-04-15T00:00:00.000Z',
        daysProjectedVariance: 15,
        reasons: ['Critical path bottleneck'],
      },
    },
    members: [
      { id: 'u-1', name: 'Sarah Miller', email: 'sarah@acme.com', role: 'ADMIN', assignedTaskCount: 2 },
      { id: 'u-2', name: 'Alex Chen', email: 'alex@acme.com', role: 'MEMBER', assignedTaskCount: 1 },
      { id: 'u-3', name: 'Jordan Taylor', email: 'jordan@acme.com', role: 'MEMBER', assignedTaskCount: 1 },
    ],
    searchSources: [],
  };

  // 1. Project Overview
  it('generates grounded project overview with metrics, status, and citations', () => {
    const res = AiAssistantEngine.generateDeterministicAnswer(
      'Give me an overview of this project.',
      MOCK_CONTEXT
    );

    expect(res.answer).toContain('Product Launch 2026');
    expect(res.answer).toContain('IN_PROGRESS');
    expect(res.answer).toContain('4 tasks');
    expect(res.answer).toContain('1 of 4 tasks completed');
    expect(res.citations.some(c => c.type === 'project' && c.id === 'proj-100')).toBe(true);
    expect(res.suggestedFollowUps.length).toBeGreaterThanOrEqual(2);
  });

  // 2. Overdue Tasks
  it('correctly identifies overdue tasks with assignees and dates without hallucination', () => {
    const res = AiAssistantEngine.generateDeterministicAnswer(
      'Which tasks are overdue?',
      MOCK_CONTEXT
    );

    expect(res.answer).toContain('PCI-DSS Compliance Certification');
    expect(res.answer).toContain('Stripe Payment Gateway Integration');
    expect(res.answer).toContain('Alex Chen');
    expect(res.answer).toContain('Jordan Taylor');
    expect(res.citations.some(c => c.id === 'task-2')).toBe(true);
    expect(res.citations.some(c => c.id === 'task-3')).toBe(true);
    // Should NOT flag completed task as overdue
    expect(res.answer).not.toContain('Design high-converting landing page (is overdue)');
  });

  // 3. Blockers & Dependency Chains
  it('identifies blocked tasks, blockers, and impact chains', () => {
    const res = AiAssistantEngine.generateDeterministicAnswer(
      'What is blocking project progress?',
      MOCK_CONTEXT
    );

    expect(res.answer).toContain('Stripe Payment Gateway Integration');
    expect(res.answer).toContain('PCI-DSS Compliance Certification');
    expect(res.citations.some(c => c.id === 'task-3')).toBe(true);
    expect(res.suggestedFollowUps.some(f => /block|resolve|unblock/i.test(f))).toBe(true);
  });

  // 4. Project Health & Predictive Risks
  it('explains health diagnosis, risk factors, and actionable recommendations', () => {
    const res = AiAssistantEngine.generateDeterministicAnswer(
      'Why is this project at risk?',
      MOCK_CONTEXT
    );

    expect(res.answer).toContain('AT_RISK');
    expect(res.answer).toContain('54/100');
    expect(res.answer).toContain('Overdue critical path dependencies');
    expect(res.answer).toContain('Schedule Risk');
    expect(res.answer).toContain('Prioritize PCI-DSS Compliance Certification');
    expect(res.citations.some(c => c.type === 'health')).toBe(true);
  });

  // 5. Prioritization & Next Actions
  it('recommends unblocking and high-priority action items next', () => {
    const res = AiAssistantEngine.generateDeterministicAnswer(
      'What should the team prioritize next?',
      MOCK_CONTEXT
    );

    expect(res.answer).toContain('PCI-DSS Compliance Certification');
    expect(res.answer).toContain('Immediate Unblocking');
    expect(res.citations.length).toBeGreaterThan(0);
  });

  // 6. Meeting Summary & Action Items
  it('summarizes the latest meeting with dates and assigned action items', () => {
    const res = AiAssistantEngine.generateDeterministicAnswer(
      'Summarize the latest meeting.',
      MOCK_CONTEXT
    );

    expect(res.answer).toContain('Weekly Executive Launch Readiness Sync');
    expect(res.answer).toContain('critical blocker on PCI compliance');
    expect(res.answer).toContain('Alex to expedite');
    expect(res.citations.some(c => c.type === 'meeting' && c.id === 'mtg-1')).toBe(true);
  });

  // 7. Milestones
  it('reports milestone progress and target completion dates', () => {
    const res = AiAssistantEngine.generateDeterministicAnswer(
      'Which milestones are approaching?',
      MOCK_CONTEXT
    );

    expect(res.answer).toContain('Design Freeze & Brand Approval');
    expect(res.answer).toContain('Payment Integration & Security Sign-off');
    expect(res.answer).toContain('Public GA Launch');
    expect(res.citations.some(c => c.type === 'milestone')).toBe(true);
  });

  // 8. Team Workload
  it('calculates distribution of tasks per team member', () => {
    const res = AiAssistantEngine.generateDeterministicAnswer(
      'Show me the current team workload.',
      MOCK_CONTEXT
    );

    expect(res.answer).toContain('Sarah Miller');
    expect(res.answer).toContain('Alex Chen');
    expect(res.answer).toContain('Jordan Taylor');
    expect(res.citations.some(c => c.type === 'member')).toBe(true);
  });

  // 9. Graceful Missing Information Handling
  it('gracefully states when meeting information is not available instead of fabricating', () => {
    const contextNoMeetings: AssistantContext = {
      ...MOCK_CONTEXT,
      meetings: [],
    };
    const res = AiAssistantEngine.generateDeterministicAnswer(
      'Summarize the latest meeting.',
      contextNoMeetings
    );

    expect(res.answer).toContain('No recorded meetings or transcripts are currently linked');
    expect(res.answer).not.toContain('fabricated meeting');
  });

  // 10. Workspace-level context (No single project selected)
  it('handles workspace-wide queries when no single project is selected', () => {
    const workspaceContext: AssistantContext = {
      ...MOCK_CONTEXT,
      project: null,
      projects: [
        { id: 'proj-1', name: 'Alpha Project', status: 'IN_PROGRESS', priority: 'HIGH', taskCount: 8 },
        { id: 'proj-2', name: 'Beta Rollout', status: 'COMPLETED', priority: 'MEDIUM', taskCount: 4 },
      ],
    };

    const res = AiAssistantEngine.generateDeterministicAnswer(
      'What is the status of our projects?',
      workspaceContext
    );

    expect(res.answer).toContain('Acme Workspace');
    expect(res.answer).toContain('Alpha Project');
    expect(res.answer).toContain('Beta Rollout');
    expect(res.citations.some(c => c.id === 'proj-1')).toBe(true);
  });

  // 11. Multi-turn context preservation and prompt formatting
  it('formats system prompt with structured workspace data for LLM grounding', () => {
    const prompt = AiAssistantEngine.buildSystemPrompt(MOCK_CONTEXT);

    expect(prompt).toContain('NEXORA AI Project Assistant');
    expect(prompt).toContain('Product Launch 2026');
    expect(prompt).toContain('PCI-DSS Compliance Certification');
    expect(prompt).toContain('Weekly Executive Launch Readiness Sync');
    expect(prompt).toContain('Strictly base your answers ONLY on the real project data provided');
  });

  // 12. Non-mutating read-only guarantee
  it('operates as a pure deterministic reader without mutating context', () => {
    const contextCopy = JSON.parse(JSON.stringify(MOCK_CONTEXT));
    AiAssistantEngine.generateDeterministicAnswer('What is blocking project progress?', MOCK_CONTEXT);
    expect(MOCK_CONTEXT).toEqual(contextCopy);
  });
});
