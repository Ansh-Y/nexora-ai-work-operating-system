import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NotificationCategory, NotificationPriority, NotificationType } from '@prisma/client';
import { SmartNotificationEngine } from './notifications.engine';
import { NotificationsService } from './notifications.service';
import { Principal } from '../common/auth.types';

describe('SmartNotificationEngine Unit Tests', () => {
  describe('Category Classification (Section 2)', () => {
    it('classifies tasks, deadlines, and completions as TASK category', () => {
      expect(SmartNotificationEngine.classifyCategory(NotificationType.ASSIGNMENT)).toBe(NotificationCategory.TASK);
      expect(SmartNotificationEngine.classifyCategory(NotificationType.DEADLINE)).toBe(NotificationCategory.TASK);
      expect(SmartNotificationEngine.classifyCategory(NotificationType.TASK_COMPLETED)).toBe(NotificationCategory.TASK);
    });

    it('classifies health, risks, and milestones as PROJECT category', () => {
      expect(SmartNotificationEngine.classifyCategory(NotificationType.PROJECT_HEALTH)).toBe(NotificationCategory.PROJECT);
      expect(SmartNotificationEngine.classifyCategory(NotificationType.RISK)).toBe(NotificationCategory.PROJECT);
      expect(SmartNotificationEngine.classifyCategory(NotificationType.MILESTONE)).toBe(NotificationCategory.PROJECT);
    });

    it('classifies workflow automations, reports, and AI insights as AI category', () => {
      expect(SmartNotificationEngine.classifyCategory(NotificationType.WORKFLOW_APPROVAL)).toBe(NotificationCategory.AI);
      expect(SmartNotificationEngine.classifyCategory(NotificationType.WORKFLOW_EXECUTION)).toBe(NotificationCategory.AI);
      expect(SmartNotificationEngine.classifyCategory(NotificationType.WEEKLY_REPORT)).toBe(NotificationCategory.AI);
      expect(SmartNotificationEngine.classifyCategory(NotificationType.AI_INSIGHT)).toBe(NotificationCategory.AI);
    });

    it('classifies comments and mentions as TEAM category', () => {
      expect(SmartNotificationEngine.classifyCategory(NotificationType.COMMENT)).toBe(NotificationCategory.TEAM);
      expect(SmartNotificationEngine.classifyCategory(NotificationType.MENTION)).toBe(NotificationCategory.TEAM);
    });
  });

  describe('Deterministic Prioritization (Section 3)', () => {
    it('classifies CRITICAL project health and critical risks as CRITICAL priority', () => {
      const p1 = SmartNotificationEngine.classifyPriority(
        NotificationType.PROJECT_HEALTH,
        { classification: 'CRITICAL', score: 35 },
        'Critical Health Alert',
      );
      expect(p1).toBe(NotificationPriority.CRITICAL);

      const p2 = SmartNotificationEngine.classifyPriority(
        NotificationType.RISK,
        { severity: 'CRITICAL' },
        'Critical Risk Detected',
      );
      expect(p2).toBe(NotificationPriority.CRITICAL);
    });

    it('classifies AT_RISK health, overdue tasks, mentions, assignments, and approvals as HIGH priority', () => {
      const pHealth = SmartNotificationEngine.classifyPriority(
        NotificationType.PROJECT_HEALTH,
        { classification: 'AT_RISK', score: 55 },
        'Project At Risk',
      );
      expect(pHealth).toBe(NotificationPriority.HIGH);

      const pOverdue = SmartNotificationEngine.classifyPriority(
        NotificationType.DEADLINE,
        { overdue: true },
        'Task deadline has passed',
      );
      expect(pOverdue).toBe(NotificationPriority.HIGH);

      const pMention = SmartNotificationEngine.classifyPriority(NotificationType.MENTION);
      expect(pMention).toBe(NotificationPriority.HIGH);

      const pAssign = SmartNotificationEngine.classifyPriority(NotificationType.ASSIGNMENT);
      expect(pAssign).toBe(NotificationPriority.HIGH);

      const pApproval = SmartNotificationEngine.classifyPriority(NotificationType.WORKFLOW_APPROVAL);
      expect(pApproval).toBe(NotificationPriority.HIGH);
    });

    it('classifies approaching deadlines, comments, reports, and milestones as MEDIUM priority', () => {
      const pDeadline = SmartNotificationEngine.classifyPriority(
        NotificationType.DEADLINE,
        { overdue: false },
        'Task deadline is approaching',
      );
      expect(pDeadline).toBe(NotificationPriority.MEDIUM);

      const pComment = SmartNotificationEngine.classifyPriority(NotificationType.COMMENT);
      expect(pComment).toBe(NotificationPriority.MEDIUM);

      const pReport = SmartNotificationEngine.classifyPriority(NotificationType.WEEKLY_REPORT);
      expect(pReport).toBe(NotificationPriority.MEDIUM);

      const pMilestone = SmartNotificationEngine.classifyPriority(NotificationType.MILESTONE);
      expect(pMilestone).toBe(NotificationPriority.MEDIUM);
    });

    it('classifies routine task completion and healthy recovery as LOW priority', () => {
      const pDone = SmartNotificationEngine.classifyPriority(NotificationType.TASK_COMPLETED);
      expect(pDone).toBe(NotificationPriority.LOW);

      const pRecovered = SmartNotificationEngine.classifyPriority(
        NotificationType.PROJECT_HEALTH,
        { classification: 'ON_TRACK' },
        'Project Healthy Again',
      );
      expect(pRecovered).toBe(NotificationPriority.LOW);
    });
  });

  describe('User Preferences Evaluation (Section 6)', () => {
    const defaultPref = {
      projectAlerts: true,
      taskAlerts: true,
      aiAlerts: true,
      teamAlerts: true,
      lowPriorityAlerts: true,
      projectHealthAlerts: true,
      projectRiskAlerts: true,
      taskAssignmentAlerts: true,
      taskStatusAlerts: true,
      taskDeadlineAlerts: true,
      aiProposalAlerts: true,
      weeklyReportAlerts: true,
      teamCommentAlerts: true,
      deadlineReminderLeadHours: 24,
      inAppAlerts: true,
    };

    it('allows all notifications when preferences are default or null', () => {
      expect(
        SmartNotificationEngine.isEligibleForUser(
          defaultPref,
          NotificationCategory.TASK,
          NotificationPriority.HIGH,
          NotificationType.ASSIGNMENT,
        ),
      ).toBe(true);

      expect(
        SmartNotificationEngine.isEligibleForUser(
          null,
          NotificationCategory.AI,
          NotificationPriority.MEDIUM,
          NotificationType.WEEKLY_REPORT,
        ),
      ).toBe(true);
    });

    it('filters out low-priority alerts when user disables lowPriorityAlerts', () => {
      const pref = { ...defaultPref, lowPriorityAlerts: false };
      expect(
        SmartNotificationEngine.isEligibleForUser(
          pref,
          NotificationCategory.TASK,
          NotificationPriority.LOW,
          NotificationType.TASK_COMPLETED,
        ),
      ).toBe(false);

      // Higher priority still allowed
      expect(
        SmartNotificationEngine.isEligibleForUser(
          pref,
          NotificationCategory.TASK,
          NotificationPriority.HIGH,
          NotificationType.ASSIGNMENT,
        ),
      ).toBe(true);
    });

    it('filters out category alerts when category toggle is disabled', () => {
      const pref = { ...defaultPref, projectAlerts: false };
      expect(
        SmartNotificationEngine.isEligibleForUser(
          pref,
          NotificationCategory.PROJECT,
          NotificationPriority.HIGH,
          NotificationType.PROJECT_HEALTH,
        ),
      ).toBe(false);

      // Task alert still allowed
      expect(
        SmartNotificationEngine.isEligibleForUser(
          pref,
          NotificationCategory.TASK,
          NotificationPriority.HIGH,
          NotificationType.ASSIGNMENT,
        ),
      ).toBe(true);
    });

    it('filters out granular events when event toggle is disabled', () => {
      const pref = { ...defaultPref, weeklyReportAlerts: false };
      expect(
        SmartNotificationEngine.isEligibleForUser(
          pref,
          NotificationCategory.AI,
          NotificationPriority.MEDIUM,
          NotificationType.WEEKLY_REPORT,
        ),
      ).toBe(false);

      // Other AI alerts still allowed
      expect(
        SmartNotificationEngine.isEligibleForUser(
          pref,
          NotificationCategory.AI,
          NotificationPriority.HIGH,
          NotificationType.WORKFLOW_APPROVAL,
        ),
      ).toBe(true);
    });

    it('blocks all alerts when inAppAlerts is disabled', () => {
      const pref = { ...defaultPref, inAppAlerts: false };
      expect(
        SmartNotificationEngine.isEligibleForUser(
          pref,
          NotificationCategory.TASK,
          NotificationPriority.CRITICAL,
          NotificationType.DEADLINE,
        ),
      ).toBe(false);
    });
  });

  describe('Deduplication and Relative Time (Section 8)', () => {
    it('generates consistent dedupe keys', () => {
      const key = SmartNotificationEngine.buildDedupeKey('deadline:t-1:2026-11-09', 'u-123');
      expect(key).toBe('deadline:t-1:2026-11-09:u-123');
    });

    it('formats relative time labels accurately', () => {
      const now = new Date('2026-11-09T12:00:00Z');
      const justNow = new Date('2026-11-09T11:59:30Z');
      const fiveMinAgo = new Date('2026-11-09T11:55:00Z');
      const twoHoursAgo = new Date('2026-11-09T10:00:00Z');
      const yesterday = new Date('2026-11-08T10:00:00Z');
      const older = new Date('2026-11-01T10:00:00Z');

      expect(SmartNotificationEngine.formatRelativeTime(justNow, now)).toBe('Just now');
      expect(SmartNotificationEngine.formatRelativeTime(fiveMinAgo, now)).toBe('5m ago');
      expect(SmartNotificationEngine.formatRelativeTime(twoHoursAgo, now)).toBe('2h ago');
      expect(SmartNotificationEngine.formatRelativeTime(yesterday, now)).toBe('Yesterday');
      expect(SmartNotificationEngine.formatRelativeTime(older, now)).toBe('Nov 1');
    });
  });
});

describe('NotificationsService Unit Tests', () => {
  let service: NotificationsService;
  let mockPrisma: any;
  let mockRealtime: any;
  let mockConfig: any;

  const mockUser: Principal = {
    sub: 'user-123',
    orgId: 'org-456',
    role: 'OWNER' as any,
    email: 'alex@nexora.local',
  };

  beforeEach(() => {
    mockPrisma = {
      notification: {
        findMany: vi.fn(),
        count: vi.fn(),
        groupBy: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        createMany: vi.fn(),
      },
      membership: {
        findMany: vi.fn(),
      },
      notificationPreference: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        upsert: vi.fn(),
        create: vi.fn(),
      },
      task: {
        findMany: vi.fn(),
      },
      milestone: {
        findMany: vi.fn(),
      },
    };

    mockRealtime = {
      broadcastToUsers: vi.fn(),
      broadcast: vi.fn(),
    };

    mockConfig = {
      get: vi.fn().mockReturnValue(null),
    };

    service = new NotificationsService(mockPrisma, mockRealtime, mockConfig);
  });

  it('lists notifications scoped strictly to organization and user with unread aggregations', async () => {
    const mockItems = [
      {
        id: 'n-1',
        organizationId: 'org-456',
        userId: 'user-123',
        type: NotificationType.ASSIGNMENT,
        category: NotificationCategory.TASK,
        priority: NotificationPriority.HIGH,
        title: 'Task Assigned',
        body: 'API Integration',
        readAt: null,
      },
    ];

    mockPrisma.notification.findMany.mockResolvedValue(mockItems);
    mockPrisma.notification.count.mockResolvedValueOnce(1); // total
    mockPrisma.notification.count.mockResolvedValueOnce(1); // unreadCount
    mockPrisma.notification.groupBy.mockResolvedValueOnce([
      { category: NotificationCategory.TASK, _count: { _all: 1 } },
    ]); // category group
    mockPrisma.notification.groupBy.mockResolvedValueOnce([
      { priority: NotificationPriority.HIGH, _count: { _all: 1 } },
    ]); // priority group

    const res = await service.list(mockUser, { category: NotificationCategory.TASK });

    expect(res.items).toEqual(mockItems);
    expect(res.total).toBe(1);
    expect(res.unreadCount).toBe(1);
    expect(res.countsByCategory.TASK).toBe(1);
    expect(res.countsByPriority.HIGH).toBe(1);

    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org-456',
          userId: 'user-123',
          category: NotificationCategory.TASK,
          dismissedAt: null,
        }),
      }),
    );
  });

  it('marks single notification as read and emits realtime event', async () => {
    const existing = {
      id: 'n-1',
      organizationId: 'org-456',
      userId: 'user-123',
      readAt: null,
    };
    mockPrisma.notification.findFirst.mockResolvedValue(existing);
    mockPrisma.notification.update.mockResolvedValue({ ...existing, readAt: new Date() });

    const res = await service.read(mockUser, 'n-1');

    expect(res.readAt).toBeDefined();
    expect(mockRealtime.broadcastToUsers).toHaveBeenCalledWith(
      'org-456',
      ['user-123'],
      'notification.read',
      expect.objectContaining({ id: 'n-1' }),
    );
  });

  it('throws 404 when marking a notification belonging to another user or org', async () => {
    mockPrisma.notification.findFirst.mockResolvedValue(null);

    await expect(service.read(mockUser, 'foreign-id')).rejects.toThrow('Notification not found');
  });

  it('marks all unread notifications as read with optional category filtering', async () => {
    mockPrisma.notification.updateMany.mockResolvedValue({ count: 5 });

    const res = await service.readAll(mockUser, NotificationCategory.AI);

    expect(res.updated).toBe(5);
    expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-456',
        userId: 'user-123',
        readAt: null,
        dismissedAt: null,
        category: NotificationCategory.AI,
      },
      data: expect.objectContaining({ readAt: expect.any(Date) }),
    });
    expect(mockRealtime.broadcastToUsers).toHaveBeenCalledWith(
      'org-456',
      ['user-123'],
      'notification.read_all',
      expect.objectContaining({ category: NotificationCategory.AI }),
    );
  });

  it('dismisses notification soft-deleting with dismissedAt', async () => {
    const existing = { id: 'n-1', organizationId: 'org-456', userId: 'user-123', dismissedAt: null };
    mockPrisma.notification.findFirst.mockResolvedValue(existing);
    mockPrisma.notification.update.mockResolvedValue({ ...existing, dismissedAt: new Date() });

    await service.dismiss(mockUser, 'n-1');

    expect(mockPrisma.notification.update).toHaveBeenCalledWith({
      where: { id: 'n-1' },
      data: expect.objectContaining({ dismissedAt: expect.any(Date) }),
    });
    expect(mockRealtime.broadcastToUsers).toHaveBeenCalledWith(
      'org-456',
      ['user-123'],
      'notification.dismissed',
      { id: 'n-1' },
    );
  });

  it('enforces multi-tenant authorization during dispatch and respects user preferences', async () => {
    // Only user-123 is a member of org-456; foreign-user is not
    mockPrisma.membership.findMany.mockResolvedValue([{ userId: 'user-123' }]);

    // user-123 has disabled task alerts
    mockPrisma.notificationPreference.findMany.mockResolvedValue([
      { userId: 'user-123', taskAlerts: false, inAppAlerts: true },
    ]);

    const dispatched = await service.notifyUsers(
      'org-456',
      ['user-123', 'foreign-user'],
      NotificationType.ASSIGNMENT,
      'Task assigned',
      'Task description',
      'event-123',
    );

    // Filtered out because taskAlerts = false
    expect(dispatched).toBe(0);
    expect(mockPrisma.notification.createMany).not.toHaveBeenCalled();
  });

  it('successfully creates notification when user is member and eligible', async () => {
    mockPrisma.membership.findMany.mockResolvedValue([{ userId: 'user-123' }]);
    mockPrisma.notificationPreference.findMany.mockResolvedValue([
      { userId: 'user-123', taskAlerts: true, inAppAlerts: true, lowPriorityAlerts: true },
    ]);
    mockPrisma.notification.createMany.mockResolvedValue({ count: 1 });

    const dispatched = await service.notifyUsers(
      'org-456',
      ['user-123'],
      NotificationType.ASSIGNMENT,
      'Task assigned',
      'Task description',
      'event-456',
      {
        category: NotificationCategory.TASK,
        priority: NotificationPriority.HIGH,
        actionUrl: '/tasks?id=t-1',
      },
    );

    expect(dispatched).toBe(1);
    expect(mockPrisma.notification.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          organizationId: 'org-456',
          userId: 'user-123',
          type: NotificationType.ASSIGNMENT,
          category: NotificationCategory.TASK,
          priority: NotificationPriority.HIGH,
          actionUrl: '/tasks?id=t-1',
          dedupeKey: 'event-456:user-123',
        }),
      ],
      skipDuplicates: true,
    });
    expect(mockRealtime.broadcastToUsers).toHaveBeenCalledWith(
      'org-456',
      ['user-123'],
      'notification.created',
      expect.objectContaining({ count: 1, category: NotificationCategory.TASK, priority: NotificationPriority.HIGH }),
    );
  });
});
