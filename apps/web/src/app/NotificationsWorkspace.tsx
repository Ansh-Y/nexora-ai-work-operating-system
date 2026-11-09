"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  AtSign,
  Bell,
  BellOff,
  Check,
  CheckCircle2,
  Clock,
  Cpu,
  Eye,
  FileText,
  Filter,
  FolderKanban,
  Layers,
  LoaderCircle,
  Mail,
  MailOpen,
  MessageSquare,
  RefreshCw,
  Search,
  Settings,
  Shield,
  ShieldAlert,
  Sparkles,
  Trash2,
  User,
  Users,
  X,
  Zap,
} from "lucide-react";
import { api } from "@/lib/api";

export type NotificationCategory = "PROJECT" | "TASK" | "AI" | "TEAM";
export type NotificationPriority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface SmartNotificationItem {
  id: string;
  organizationId: string;
  userId: string;
  type: string;
  category: NotificationCategory;
  priority: NotificationPriority;
  title: string;
  body: string;
  actionUrl?: string | null;
  metadata?: Record<string, any> | null;
  readAt?: string | null;
  createdAt: string;
}

export interface NotificationPreferences {
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

interface NotificationsWorkspaceProps {
  onNavigate: (page: string, context?: any) => void;
  onOpenTask?: (taskId: string) => void;
  notify?: (message: string) => void;
}

export default function NotificationsWorkspace({
  onNavigate,
  onOpenTask,
  notify,
}: NotificationsWorkspaceProps) {
  const [notifications, setNotifications] = useState<SmartNotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [countsByCategory, setCountsByCategory] = useState<Record<string, number>>({
    PROJECT: 0,
    TASK: 0,
    AI: 0,
    TEAM: 0,
  });
  const [countsByPriority, setCountsByPriority] = useState<Record<string, number>>({
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
  });

  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  // Filters
  const [selectedCategory, setSelectedCategory] = useState<NotificationCategory | "ALL">("ALL");
  const [selectedPriority, setSelectedPriority] = useState<NotificationPriority | "ALL">("ALL");
  const [statusFilter, setStatusFilter] = useState<"all" | "unread">("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Preferences Modal
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [preferencesLoading, setPreferencesLoading] = useState(false);
  const [preferencesSaving, setPreferencesSaving] = useState(false);
  const [preferences, setPreferences] = useState<NotificationPreferences>({
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
  });

  const fetchNotifications = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (selectedCategory !== "ALL") params.append("category", selectedCategory);
      if (selectedPriority !== "ALL") params.append("priority", selectedPriority);
      if (statusFilter === "unread") params.append("status", "unread");
      if (searchQuery.trim()) params.append("search", searchQuery.trim());

      const url = `/notifications${params.toString() ? `?${params.toString()}` : ""}`;
      const res: any = await api.get(url);

      setNotifications(res.items || []);
      setUnreadCount(res.unreadCount || 0);
      if (res.countsByCategory) setCountsByCategory(res.countsByCategory);
      if (res.countsByPriority) setCountsByPriority(res.countsByPriority);
    } catch (err: any) {
      notify?.(err.message || "Failed to load notifications");
    } finally {
      setLoading(false);
    }
  }, [selectedCategory, selectedPriority, statusFilter, searchQuery, notify]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const loadPreferences = async () => {
    setPreferencesLoading(true);
    try {
      const res: any = await api.get("/notifications/preferences");
      if (res) {
        setPreferences({
          projectAlerts: res.projectAlerts ?? true,
          taskAlerts: res.taskAlerts ?? true,
          aiAlerts: res.aiAlerts ?? true,
          teamAlerts: res.teamAlerts ?? true,
          lowPriorityAlerts: res.lowPriorityAlerts ?? true,
          projectHealthAlerts: res.projectHealthAlerts ?? true,
          projectRiskAlerts: res.projectRiskAlerts ?? true,
          taskAssignmentAlerts: res.taskAssignmentAlerts ?? true,
          taskStatusAlerts: res.taskStatusAlerts ?? true,
          taskDeadlineAlerts: res.taskDeadlineAlerts ?? true,
          aiProposalAlerts: res.aiProposalAlerts ?? true,
          weeklyReportAlerts: res.weeklyReportAlerts ?? true,
          teamCommentAlerts: res.teamCommentAlerts ?? true,
          deadlineReminderLeadHours: res.deadlineReminderLeadHours ?? 24,
          inAppAlerts: res.inAppAlerts ?? true,
        });
      }
    } catch {
      notify?.("Could not load preferences");
    } finally {
      setPreferencesLoading(false);
    }
  };

  const savePreferences = async () => {
    setPreferencesSaving(true);
    try {
      await api.patch("/notifications/preferences", preferences);
      notify?.("Notification preferences saved");
      setPreferencesOpen(false);
      fetchNotifications();
    } catch (err: any) {
      notify?.(err.message || "Failed to save preferences");
    } finally {
      setPreferencesSaving(false);
    }
  };

  const handleMarkAsRead = async (id: string, currentlyRead: boolean) => {
    setActionLoadingId(id);
    try {
      if (!currentlyRead) {
        await api.patch(`/notifications/${id}/read`, {});
        setNotifications((prev) =>
          prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n))
        );
        setUnreadCount((c) => Math.max(0, c - 1));
      }
    } catch (err: any) {
      notify?.(err.message || "Failed to update notification");
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      const catParam = selectedCategory !== "ALL" ? `?category=${selectedCategory}` : "";
      await api.patch(`/notifications/read-all${catParam}`, {});
      notify?.(
        selectedCategory !== "ALL"
          ? `All ${selectedCategory} notifications marked read`
          : "All notifications marked read"
      );
      fetchNotifications();
    } catch (err: any) {
      notify?.(err.message || "Failed to mark all as read");
    }
  };

  const handleDismiss = async (id: string) => {
    setActionLoadingId(id);
    try {
      await api.delete(`/notifications/${id}`);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      notify?.("Notification dismissed");
    } catch (err: any) {
      notify?.(err.message || "Failed to dismiss notification");
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDismissAll = async () => {
    try {
      const body = selectedCategory !== "ALL" ? { category: selectedCategory } : {};
      await api.post("/notifications/dismiss-all", body);
      notify?.("Notifications cleared");
      fetchNotifications();
    } catch (err: any) {
      notify?.(err.message || "Failed to clear notifications");
    }
  };

  const handleAction = (item: SmartNotificationItem) => {
    // 1. Mark as read automatically when taking action
    if (!item.readAt) {
      handleMarkAsRead(item.id, false);
    }

    // 2. Navigate contextually
    const actionUrl = item.actionUrl || "";
    const meta = item.metadata || {};

    if (item.category === "TASK" || actionUrl.startsWith("/tasks")) {
      const taskId = meta.taskId || actionUrl.split("id=")[1];
      if (taskId && onOpenTask) {
        onOpenTask(taskId);
      } else {
        onNavigate("Tasks");
      }
    } else if (item.category === "PROJECT" || actionUrl.startsWith("/health") || actionUrl.startsWith("/projects")) {
      const projectId = meta.projectId || actionUrl.split("id=")[1];
      if (actionUrl.startsWith("/health")) {
        onNavigate("Health", { projectId });
      } else {
        onNavigate("Projects", { projectId });
      }
    } else if (item.category === "AI" && actionUrl.startsWith("/automations")) {
      onNavigate("Automations");
    } else if (item.category === "AI" && actionUrl.startsWith("/reports")) {
      const reportId = meta.reportId || actionUrl.split("id=")[1];
      onNavigate("Reports", { reportId });
    } else if (item.category === "TEAM" && actionUrl.startsWith("/meetings")) {
      onNavigate("Meetings");
    } else {
      // Default to Tasks or Projects
      if (meta.taskId) onNavigate("Tasks");
      else if (meta.projectId) onNavigate("Projects");
    }
  };

  const getActionLabel = (item: SmartNotificationItem): string => {
    if (item.type === "DEADLINE" || item.type === "ASSIGNMENT" || item.type === "TASK_COMPLETED") {
      return "Open Task";
    }
    if (item.type === "PROJECT_HEALTH" || item.type === "RISK") {
      return "View Health";
    }
    if (item.type === "WORKFLOW_APPROVAL") {
      return "Review Proposal";
    }
    if (item.type === "WORKFLOW_EXECUTION") {
      return "View Automations";
    }
    if (item.type === "WEEKLY_REPORT") {
      return "View Report";
    }
    if (item.type === "COMMENT" || item.type === "MENTION") {
      return "View Thread";
    }
    return "Open";
  };

  // Group notifications by relative date bucket
  const groupNotifications = (items: SmartNotificationItem[]) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterday = today - 86400000;
    const thisWeek = today - 7 * 86400000;

    const groups: { [key: string]: SmartNotificationItem[] } = {
      Today: [],
      Yesterday: [],
      "Earlier this week": [],
      Older: [],
    };

    items.forEach((item) => {
      const itemTime = new Date(item.createdAt).getTime();
      if (itemTime >= today) {
        groups.Today.push(item);
      } else if (itemTime >= yesterday) {
        groups.Yesterday.push(item);
      } else if (itemTime >= thisWeek) {
        groups["Earlier this week"].push(item);
      } else {
        groups.Older.push(item);
      }
    });

    return Object.entries(groups).filter(([_, list]) => list.length > 0);
  };

  const formatTime = (isoString: string) => {
    const d = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 45) return "Just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHour < 24) return `${diffHour}h ago`;
    if (diffDay === 1) return "Yesterday";
    if (diffDay < 7) return `${diffDay}d ago`;

    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const grouped = groupNotifications(notifications);

  return (
    <div className="smart-notif-workspace">
      {/* 1. HEADER ROW */}
      <div className="smart-notif-header">
        <div>
          <div className="smart-notif-eyebrow">
            <Sparkles size={13} className="text-emerald-500 inline mr-1" />
            AI WORKSPACE INTELLIGENCE
          </div>
          <h1 className="smart-notif-title">Smart Notification Center</h1>
          <p className="smart-notif-subtitle">
            Context-aware notifications, predictive alerts, and team actions with intelligent deduplication.
          </p>
        </div>

        <div className="smart-notif-actions">
          <button
            className="smart-notif-btn smart-notif-btn-secondary"
            onClick={() => {
              loadPreferences();
              setPreferencesOpen(true);
            }}
            title="Notification Preferences"
          >
            <Settings size={15} />
            Preferences
          </button>

          <button
            className="smart-notif-btn smart-notif-btn-secondary"
            onClick={handleMarkAllRead}
            disabled={unreadCount === 0}
            title="Mark all notifications as read"
          >
            <CheckCircle2 size={15} />
            Mark all read
          </button>

          <button
            className="smart-notif-btn smart-notif-btn-ghost"
            onClick={handleDismissAll}
            disabled={notifications.length === 0}
            title="Dismiss all current notifications"
          >
            <Trash2 size={14} />
            Clear
          </button>
        </div>
      </div>

      {/* 2. FILTER & TOOLBAR PANEL */}
      <div className="smart-notif-toolbar">
        {/* Category Tabs */}
        <div className="smart-notif-tabs">
          <button
            className={`smart-notif-tab ${selectedCategory === "ALL" ? "active" : ""}`}
            onClick={() => setSelectedCategory("ALL")}
          >
            <Layers size={14} />
            All Alerts
            {unreadCount > 0 && <span className="smart-notif-badge">{unreadCount}</span>}
          </button>

          <button
            className={`smart-notif-tab ${selectedCategory === "PROJECT" ? "active" : ""}`}
            onClick={() => setSelectedCategory("PROJECT")}
          >
            <FolderKanban size={14} />
            Projects
            {countsByCategory.PROJECT > 0 && (
              <span className="smart-notif-badge project">{countsByCategory.PROJECT}</span>
            )}
          </button>

          <button
            className={`smart-notif-tab ${selectedCategory === "TASK" ? "active" : ""}`}
            onClick={() => setSelectedCategory("TASK")}
          >
            <Clock size={14} />
            Tasks
            {countsByCategory.TASK > 0 && (
              <span className="smart-notif-badge task">{countsByCategory.TASK}</span>
            )}
          </button>

          <button
            className={`smart-notif-tab ${selectedCategory === "AI" ? "active" : ""}`}
            onClick={() => setSelectedCategory("AI")}
          >
            <Sparkles size={14} />
            AI Intelligence
            {countsByCategory.AI > 0 && (
              <span className="smart-notif-badge ai">{countsByCategory.AI}</span>
            )}
          </button>

          <button
            className={`smart-notif-tab ${selectedCategory === "TEAM" ? "active" : ""}`}
            onClick={() => setSelectedCategory("TEAM")}
          >
            <Users size={14} />
            Team
            {countsByCategory.TEAM > 0 && (
              <span className="smart-notif-badge team">{countsByCategory.TEAM}</span>
            )}
          </button>
        </div>

        {/* Secondary Filters Bar */}
        <div className="smart-notif-filter-row">
          {/* Priority Pills */}
          <div className="smart-notif-priority-pills">
            <span className="smart-notif-filter-label">Priority:</span>

            <button
              className={`smart-notif-pill ${selectedPriority === "ALL" ? "active" : ""}`}
              onClick={() => setSelectedPriority("ALL")}
            >
              All
            </button>

            <button
              className={`smart-notif-pill critical ${selectedPriority === "CRITICAL" ? "active" : ""}`}
              onClick={() => setSelectedPriority("CRITICAL")}
            >
              <span className="dot dot-critical" />
              Critical
              {countsByPriority.CRITICAL > 0 && (
                <span className="pill-count">{countsByPriority.CRITICAL}</span>
              )}
            </button>

            <button
              className={`smart-notif-pill high ${selectedPriority === "HIGH" ? "active" : ""}`}
              onClick={() => setSelectedPriority("HIGH")}
            >
              <span className="dot dot-high" />
              High
              {countsByPriority.HIGH > 0 && (
                <span className="pill-count">{countsByPriority.HIGH}</span>
              )}
            </button>

            <button
              className={`smart-notif-pill medium ${selectedPriority === "MEDIUM" ? "active" : ""}`}
              onClick={() => setSelectedPriority("MEDIUM")}
            >
              <span className="dot dot-medium" />
              Medium
            </button>

            <button
              className={`smart-notif-pill low ${selectedPriority === "LOW" ? "active" : ""}`}
              onClick={() => setSelectedPriority("LOW")}
            >
              <span className="dot dot-low" />
              Low
            </button>
          </div>

          {/* Status & Search */}
          <div className="smart-notif-search-group">
            <div className="smart-notif-status-toggle">
              <button
                className={`smart-notif-toggle-btn ${statusFilter === "all" ? "active" : ""}`}
                onClick={() => setStatusFilter("all")}
              >
                All
              </button>
              <button
                className={`smart-notif-toggle-btn ${statusFilter === "unread" ? "active" : ""}`}
                onClick={() => setStatusFilter("unread")}
              >
                Unread
              </button>
            </div>

            <div className="smart-notif-search-box">
              <Search size={14} className="search-icon" />
              <input
                type="text"
                placeholder="Search alerts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="smart-notif-search-input"
              />
              {searchQuery && (
                <button
                  className="clear-search-btn"
                  onClick={() => setSearchQuery("")}
                  title="Clear search"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 3. NOTIFICATION LIST */}
      <div className="smart-notif-content">
        {loading ? (
          <div className="smart-notif-loading">
            <LoaderCircle size={26} className="animate-spin text-emerald-500" />
            <span>Loading workspace notifications...</span>
          </div>
        ) : notifications.length === 0 ? (
          <div className="smart-notif-empty">
            <div className="smart-notif-empty-icon">
              <BellOff size={32} />
            </div>
            <h3>No notifications found</h3>
            <p>
              {statusFilter === "unread"
                ? "You're all caught up! There are no unread notifications matching your filter."
                : searchQuery
                ? `No alerts matching "${searchQuery}". Try adjusting your keywords.`
                : "Your notification inbox is clean. Workspace alerts and intelligent notifications will appear here."}
            </p>
            {(selectedCategory !== "ALL" || selectedPriority !== "ALL" || statusFilter !== "all" || searchQuery) && (
              <button
                className="smart-notif-btn smart-notif-btn-secondary mt-3"
                onClick={() => {
                  setSelectedCategory("ALL");
                  setSelectedPriority("ALL");
                  setStatusFilter("all");
                  setSearchQuery("");
                }}
              >
                Reset Filters
              </button>
            )}
          </div>
        ) : (
          <div className="smart-notif-groups">
            {grouped.map(([groupName, items]) => (
              <div key={groupName} className="smart-notif-group">
                <div className="smart-notif-group-header">
                  <span className="smart-notif-group-title">{groupName}</span>
                  <span className="smart-notif-group-count">{items.length} alerts</span>
                </div>

                <div className="smart-notif-cards">
                  {items.map((item) => {
                    const isUnread = !item.readAt;
                    const actionLabel = getActionLabel(item);

                    return (
                      <div
                        key={item.id}
                        className={`smart-notif-card ${isUnread ? "unread" : "read"} priority-${item.priority.toLowerCase()}`}
                      >
                        {/* Priority Left Stripe */}
                        <div className={`smart-notif-stripe ${item.priority.toLowerCase()}`} />

                        {/* Category Icon */}
                        <div className={`smart-notif-icon-box ${item.category.toLowerCase()}`}>
                          {item.category === "PROJECT" && <Activity size={18} />}
                          {item.category === "TASK" && <Clock size={18} />}
                          {item.category === "AI" && <Sparkles size={18} />}
                          {item.category === "TEAM" && <Users size={18} />}
                        </div>

                        {/* Card Body */}
                        <div className="smart-notif-body">
                          <div className="smart-notif-top-meta">
                            <div className="smart-notif-badges">
                              <span className={`smart-badge-priority ${item.priority.toLowerCase()}`}>
                                {item.priority}
                              </span>
                              <span className={`smart-badge-category ${item.category.toLowerCase()}`}>
                                {item.category}
                              </span>
                              {isUnread && <span className="smart-notif-unread-dot" title="Unread" />}
                            </div>

                            <span className="smart-notif-time">{formatTime(item.createdAt)}</span>
                          </div>

                          <h4 className="smart-notif-card-title">{item.title}</h4>
                          <p className="smart-notif-card-desc">{item.body}</p>

                          {/* Action Footer */}
                          <div className="smart-notif-card-footer">
                            <div className="smart-notif-primary-action">
                              <button
                                className="smart-notif-action-btn"
                                onClick={() => handleAction(item)}
                              >
                                <span>{actionLabel}</span>
                                <ArrowUpRight size={13} />
                              </button>
                            </div>

                            <div className="smart-notif-secondary-actions">
                              <button
                                className={`smart-notif-tool-btn ${isUnread ? "mark-read" : "mark-unread"}`}
                                onClick={() => handleMarkAsRead(item.id, !isUnread)}
                                title={isUnread ? "Mark as read" : "Mark as unread"}
                                disabled={actionLoadingId === item.id}
                              >
                                {isUnread ? <Check size={14} /> : <Mail size={14} />}
                              </button>

                              <button
                                className="smart-notif-tool-btn dismiss"
                                onClick={() => handleDismiss(item.id)}
                                title="Dismiss notification"
                                disabled={actionLoadingId === item.id}
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 4. NOTIFICATION PREFERENCES MODAL */}
      {preferencesOpen && (
        <div className="smart-modal-overlay">
          <div className="smart-modal-dialog">
            <div className="smart-modal-header">
              <div>
                <div className="smart-modal-eyebrow">SETTINGS & NOTIFICATIONS</div>
                <h3 className="smart-modal-title">Smart Notification Preferences</h3>
              </div>
              <button
                className="smart-modal-close"
                onClick={() => setPreferencesOpen(false)}
                disabled={preferencesSaving}
              >
                <X size={16} />
              </button>
            </div>

            <div className="smart-modal-content">
              {preferencesLoading ? (
                <div className="smart-modal-loading">
                  <LoaderCircle size={22} className="animate-spin text-emerald-500" />
                  <span>Loading user preferences...</span>
                </div>
              ) : (
                <div className="smart-pref-sections">
                  {/* Category Alert Toggles */}
                  <div className="smart-pref-group">
                    <h4 className="smart-pref-group-title">Notification Categories</h4>
                    <p className="smart-pref-group-desc">
                      Choose which domain intelligence categories deliver notifications to your inbox.
                    </p>

                    <div className="smart-pref-grid">
                      <label className="smart-pref-toggle">
                        <input
                          type="checkbox"
                          checked={preferences.projectAlerts}
                          onChange={(e) =>
                            setPreferences({ ...preferences, projectAlerts: e.target.checked })
                          }
                        />
                        <span className="smart-pref-label">
                          <b>Project Intelligence</b>
                          <small>Health scores, critical risks, and milestone forecasts</small>
                        </span>
                      </label>

                      <label className="smart-pref-toggle">
                        <input
                          type="checkbox"
                          checked={preferences.taskAlerts}
                          onChange={(e) =>
                            setPreferences({ ...preferences, taskAlerts: e.target.checked })
                          }
                        />
                        <span className="smart-pref-label">
                          <b>Task Notifications</b>
                          <small>Assignments, blocker risks, and deadline updates</small>
                        </span>
                      </label>

                      <label className="smart-pref-toggle">
                        <input
                          type="checkbox"
                          checked={preferences.aiAlerts}
                          onChange={(e) =>
                            setPreferences({ ...preferences, aiAlerts: e.target.checked })
                          }
                        />
                        <span className="smart-pref-label">
                          <b>AI Automation & Reports</b>
                          <small>Workflow approvals, smart assignments, and weekly digests</small>
                        </span>
                      </label>

                      <label className="smart-pref-toggle">
                        <input
                          type="checkbox"
                          checked={preferences.teamAlerts}
                          onChange={(e) =>
                            setPreferences({ ...preferences, teamAlerts: e.target.checked })
                          }
                        />
                        <span className="smart-pref-label">
                          <b>Team & Discussions</b>
                          <small>@mentions, task discussions, and meeting action items</small>
                        </span>
                      </label>
                    </div>
                  </div>

                  {/* Priority Filtering */}
                  <div className="smart-pref-group">
                    <h4 className="smart-pref-group-title">Priority & Delivery Thresholds</h4>
                    <p className="smart-pref-group-desc">
                      Control notification volume and reminder lead times.
                    </p>

                    <div className="smart-pref-grid">
                      <label className="smart-pref-toggle">
                        <input
                          type="checkbox"
                          checked={preferences.lowPriorityAlerts}
                          onChange={(e) =>
                            setPreferences({ ...preferences, lowPriorityAlerts: e.target.checked })
                          }
                        />
                        <span className="smart-pref-label">
                          <b>Receive Low-Priority Alerts</b>
                          <small>Includes routine task completions and healthy recovery notifications</small>
                        </span>
                      </label>

                      <label className="smart-pref-toggle">
                        <input
                          type="checkbox"
                          checked={preferences.inAppAlerts}
                          onChange={(e) =>
                            setPreferences({ ...preferences, inAppAlerts: e.target.checked })
                          }
                        />
                        <span className="smart-pref-label">
                          <b>In-App Realtime Live Alerts</b>
                          <small>Stream live notifications via WebSockets without page reload</small>
                        </span>
                      </label>
                    </div>

                    <div className="smart-pref-select-row mt-3">
                      <div>
                        <span className="smart-pref-select-title">Task Deadline Reminder Lead Time</span>
                        <p className="smart-pref-select-desc">
                          How far in advance to receive deadline alerts before tasks are due.
                        </p>
                      </div>

                      <select
                        className="smart-pref-select"
                        value={preferences.deadlineReminderLeadHours}
                        onChange={(e) =>
                          setPreferences({
                            ...preferences,
                            deadlineReminderLeadHours: Number(e.target.value),
                          })
                        }
                      >
                        <option value={12}>12 hours prior</option>
                        <option value={24}>24 hours prior (Default)</option>
                        <option value={48}>48 hours prior</option>
                        <option value={72}>72 hours prior (3 days)</option>
                      </select>
                    </div>
                  </div>

                  {/* Granular Event Toggles */}
                  <div className="smart-pref-group">
                    <h4 className="smart-pref-group-title">Granular Event Subscriptions</h4>
                    <div className="smart-pref-grid-compact">
                      <label className="smart-pref-toggle-compact">
                        <input
                          type="checkbox"
                          checked={preferences.projectHealthAlerts}
                          onChange={(e) =>
                            setPreferences({ ...preferences, projectHealthAlerts: e.target.checked })
                          }
                        />
                        <span>Health degradation & recovery</span>
                      </label>

                      <label className="smart-pref-toggle-compact">
                        <input
                          type="checkbox"
                          checked={preferences.projectRiskAlerts}
                          onChange={(e) =>
                            setPreferences({ ...preferences, projectRiskAlerts: e.target.checked })
                          }
                        />
                        <span>Predictive risk alerts</span>
                      </label>

                      <label className="smart-pref-toggle-compact">
                        <input
                          type="checkbox"
                          checked={preferences.taskDeadlineAlerts}
                          onChange={(e) =>
                            setPreferences({ ...preferences, taskDeadlineAlerts: e.target.checked })
                          }
                        />
                        <span>Overdue & approaching deadlines</span>
                      </label>

                      <label className="smart-pref-toggle-compact">
                        <input
                          type="checkbox"
                          checked={preferences.aiProposalAlerts}
                          onChange={(e) =>
                            setPreferences({ ...preferences, aiProposalAlerts: e.target.checked })
                          }
                        />
                        <span>AI workflow approval requests</span>
                      </label>

                      <label className="smart-pref-toggle-compact">
                        <input
                          type="checkbox"
                          checked={preferences.weeklyReportAlerts}
                          onChange={(e) =>
                            setPreferences({ ...preferences, weeklyReportAlerts: e.target.checked })
                          }
                        />
                        <span>Weekly intelligence reports</span>
                      </label>

                      <label className="smart-pref-toggle-compact">
                        <input
                          type="checkbox"
                          checked={preferences.teamCommentAlerts}
                          onChange={(e) =>
                            setPreferences({ ...preferences, teamCommentAlerts: e.target.checked })
                          }
                        />
                        <span>Discussion @mentions</span>
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="smart-modal-footer">
              <button
                className="smart-notif-btn smart-notif-btn-ghost"
                onClick={() => setPreferencesOpen(false)}
                disabled={preferencesSaving}
              >
                Cancel
              </button>
              <button
                className="smart-notif-btn smart-notif-btn-primary"
                onClick={savePreferences}
                disabled={preferencesSaving}
              >
                {preferencesSaving ? (
                  <>
                    <LoaderCircle size={14} className="animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Check size={14} />
                    Save Preferences
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
