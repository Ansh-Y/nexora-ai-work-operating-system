import { NotificationCategory, NotificationPriority, NotificationType } from '@prisma/client';

export interface NotificationPreferenceLike {
  projectAlerts: boolean;
  taskAlerts: boolean;
  aiAlerts: boolean;
  teamAlerts: boolean;
  lowPriorityAlerts: boolean;
  projectHealthAlerts: boolean;
  projectRiskAlerts: boolean;
  taskAssignmentAlerts: boolean;
  taskStatusAlerts: boolean;
  taskDeadlineAlerts: boolean;
  aiProposalAlerts: boolean;
  weeklyReportAlerts: boolean;
  teamCommentAlerts: boolean;
  deadlineReminderLeadHours: number;
  inAppAlerts: boolean;
}

export class SmartNotificationEngine {
  /**
   * Deterministically classifies a notification into its primary semantic category.
   * Adheres strictly to NEXORA Section 2 category definitions.
   */
  static classifyCategory(type: NotificationType): NotificationCategory {
    switch (type) {
      case NotificationType.ASSIGNMENT:
      case NotificationType.DEADLINE:
      case NotificationType.TASK_COMPLETED:
        return NotificationCategory.TASK;

      case NotificationType.RISK:
      case NotificationType.PROJECT_HEALTH:
      case NotificationType.MILESTONE:
        return NotificationCategory.PROJECT;

      case NotificationType.WORKFLOW_APPROVAL:
      case NotificationType.WORKFLOW_EXECUTION:
      case NotificationType.WEEKLY_REPORT:
      case NotificationType.AI_INSIGHT:
        return NotificationCategory.AI;

      case NotificationType.COMMENT:
      case NotificationType.MENTION:
        return NotificationCategory.TEAM;

      default:
        return NotificationCategory.TASK;
    }
  }

  /**
   * Deterministically calculates notification priority (CRITICAL, HIGH, MEDIUM, LOW)
   * without using non-deterministic LLMs. Uses actual event severity and contextual cues.
   */
  static classifyPriority(
    type: NotificationType,
    metadata?: Record<string, any> | null,
    title = '',
    body = '',
  ): NotificationPriority {
    const combinedText = `${title} ${body}`.toUpperCase();

    switch (type) {
      case NotificationType.PROJECT_HEALTH:
        if (
          metadata?.classification === 'CRITICAL' ||
          combinedText.includes('CRITICAL')
        ) {
          return NotificationPriority.CRITICAL;
        }
        if (
          metadata?.classification === 'AT_RISK' ||
          combinedText.includes('AT RISK') ||
          (metadata?.scoreDelta !== undefined && Number(metadata.scoreDelta) <= -10)
        ) {
          return NotificationPriority.HIGH;
        }
        if (
          metadata?.classification === 'ON_TRACK' ||
          combinedText.includes('HEALTHY AGAIN') ||
          combinedText.includes('RECOVERED')
        ) {
          return NotificationPriority.LOW;
        }
        return NotificationPriority.MEDIUM;

      case NotificationType.RISK:
        if (
          metadata?.severity === 'CRITICAL' ||
          combinedText.includes('CRITICAL RISK') ||
          combinedText.includes('CRITICAL PATH')
        ) {
          return NotificationPriority.CRITICAL;
        }
        if (
          metadata?.severity === 'HIGH' ||
          combinedText.includes('HIGH RISK') ||
          combinedText.includes('BLOCKER') ||
          combinedText.includes('BLOCKED')
        ) {
          return NotificationPriority.HIGH;
        }
        return NotificationPriority.MEDIUM;

      case NotificationType.DEADLINE:
        if (
          metadata?.overdue === true ||
          combinedText.includes('PASSED') ||
          combinedText.includes('OVERDUE')
        ) {
          return NotificationPriority.HIGH;
        }
        return NotificationPriority.MEDIUM;

      case NotificationType.MENTION:
      case NotificationType.ASSIGNMENT:
      case NotificationType.WORKFLOW_APPROVAL:
        return NotificationPriority.HIGH;

      case NotificationType.WORKFLOW_EXECUTION:
        if (
          metadata?.status === 'FAILED' ||
          metadata?.error ||
          combinedText.includes('FAILED')
        ) {
          return NotificationPriority.HIGH;
        }
        return NotificationPriority.LOW;

      case NotificationType.WEEKLY_REPORT:
      case NotificationType.AI_INSIGHT:
      case NotificationType.COMMENT:
      case NotificationType.MILESTONE:
        return NotificationPriority.MEDIUM;

      case NotificationType.TASK_COMPLETED:
        return NotificationPriority.LOW;

      default:
        return NotificationPriority.MEDIUM;
    }
  }

  /**
   * Evaluates user notification preferences to determine whether the user is eligible
   * to receive this specific alert.
   */
  static isEligibleForUser(
    preference: NotificationPreferenceLike | null | undefined,
    category: NotificationCategory,
    priority: NotificationPriority,
    type: NotificationType,
  ): boolean {
    if (!preference) return true;

    // 1. In-app delivery switch
    if (preference.inAppAlerts === false) return false;

    // 2. Low-priority filter
    if (priority === NotificationPriority.LOW && preference.lowPriorityAlerts === false) {
      return false;
    }

    // 3. Category-level switches
    switch (category) {
      case NotificationCategory.PROJECT:
        if (preference.projectAlerts === false) return false;
        break;
      case NotificationCategory.TASK:
        if (preference.taskAlerts === false) return false;
        break;
      case NotificationCategory.AI:
        if (preference.aiAlerts === false) return false;
        break;
      case NotificationCategory.TEAM:
        if (preference.teamAlerts === false) return false;
        break;
    }

    // 4. Granular event-level switches
    switch (type) {
      case NotificationType.PROJECT_HEALTH:
        if (preference.projectHealthAlerts === false) return false;
        break;
      case NotificationType.RISK:
        if (preference.projectRiskAlerts === false) return false;
        break;
      case NotificationType.ASSIGNMENT:
        if (preference.taskAssignmentAlerts === false) return false;
        break;
      case NotificationType.DEADLINE:
        if (preference.taskDeadlineAlerts === false) return false;
        break;
      case NotificationType.TASK_COMPLETED:
        if (preference.taskStatusAlerts === false) return false;
        break;
      case NotificationType.WORKFLOW_APPROVAL:
        if (preference.aiProposalAlerts === false) return false;
        break;
      case NotificationType.WEEKLY_REPORT:
        if (preference.weeklyReportAlerts === false) return false;
        break;
      case NotificationType.COMMENT:
      case NotificationType.MENTION:
        if (preference.teamCommentAlerts === false) return false;
        break;
    }

    return true;
  }

  /**
   * Builds an idempotent and stable deduplication key.
   */
  static buildDedupeKey(eventKey: string, userId: string): string {
    return `${eventKey}:${userId}`;
  }

  /**
   * Formats relative timestamps into human readable labels.
   */
  static formatRelativeTime(dateInput: Date | string, now = new Date()): string {
    const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    const diffMs = now.getTime() - d.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 45) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHour < 24) return `${diffHour}h ago`;
    if (diffDay === 1) return 'Yesterday';
    if (diffDay < 7) return `${diffDay}d ago`;

    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}
