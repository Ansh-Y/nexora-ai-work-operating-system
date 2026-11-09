"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  AlertOctagon,
  ArrowRight,
  Bot,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  Eye,
  Filter,
  History,
  Layers,
  LoaderCircle,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Shield,
  ShieldAlert,
  Sparkles,
  Tag,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  User,
  X,
  Zap,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";

export interface AutomationRule {
  id: string;
  name: string;
  description: string;
  triggerEvent: string;
  action: string;
  projectId?: string | null;
  conditions: Record<string, any>;
  actionConfig: Record<string, any>;
  requiresApproval: boolean;
  isEnabled: boolean;
  lastExecutedAt?: string | null;
  lastExecutionStatus?: string | null;
  createdAt: string;
  project?: { id: string; name: string } | null;
  createdBy?: { id: string; name: string; email: string };
  _count?: { runs: number };
}

export interface AutomationRun {
  id: string;
  ruleId: string;
  projectId?: string | null;
  taskId?: string | null;
  triggerEvent: string;
  action: string;
  status: "PENDING_APPROVAL" | "APPROVED" | "EXECUTED" | "REJECTED" | "FAILED";
  explanation: string;
  proposedAction: {
    action?: string;
    title?: string;
    explanation?: string;
    expectedOutcome?: string;
    targetEntity?: { type: string; id?: string; name?: string };
    payload?: Record<string, any>;
    requiresApproval?: boolean;
  };
  executionResult?: Record<string, any> | null;
  errorMessage?: string | null;
  reviewedById?: string | null;
  reviewedAt?: string | null;
  executedAt?: string | null;
  createdAt: string;
  rule?: { id: string; name: string; triggerEvent: string; action: string };
  project?: { id: string; name: string } | null;
  task?: { id: string; title: string; status: string; priority: string } | null;
  reviewedBy?: { id: string; name: string; email: string } | null;
}

export interface DashboardStats {
  totalRules: number;
  activeRules: number;
  pendingApprovals: number;
  executedActions: number;
  failedExecutions: number;
  recentRuns: AutomationRun[];
}

interface Props {
  projects: Array<{ id: string; name: string }>;
  notify: (type: "success" | "error" | "info", message: string) => void;
  onOpenProject?: (projectId: string) => void;
}

const TRIGGER_LABELS: Record<string, { label: string; desc: string }> = {
  TASK_OVERDUE: { label: "Task Overdue", desc: "Fires when a task passes its deadline" },
  TASK_STATUS_CHANGED: { label: "Task Status Changed", desc: "Fires on any task status transition" },
  TASK_MARKED_BLOCKED: { label: "Task Blocked", desc: "Fires immediately when a task is flagged BLOCKED" },
  PROJECT_HEALTH_AT_RISK: { label: "Health At Risk", desc: "Fires when health degrades to At Risk or Critical" },
  MILESTONE_APPROACHING: { label: "Milestone Approaching", desc: "Fires when a target milestone approaches deadline" },
  TASK_CREATED: { label: "Task Created", desc: "Fires whenever a new task is created" },
};

const ACTION_LABELS: Record<string, { label: string; desc: string }> = {
  AI_TASK_RECOMMENDATION: { label: "AI Task Recommendation", desc: "Suggests unblocking and mitigation steps" },
  RECOMMEND_TASK_ASSIGNEE: { label: "Recommend Assignee", desc: "Smart assignee based on capacity and schedule" },
  NOTIFY_PROJECT_MANAGER: { label: "Notify Project Manager", desc: "Sends alert notice to project leadership" },
  GENERATE_HEALTH_SUMMARY: { label: "Generate Health Summary", desc: "Produces diagnostic brief and risk breakdown" },
  CREATE_TASK_PROPOSAL: { label: "Task Update Proposal", desc: "Proposes priority or status changes for approval" },
};

export default function AutomationsWorkspace({ projects, notify, onOpenProject }: Props) {
  const [activeTab, setActiveTab] = useState<"pending" | "rules" | "history">("pending");
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedRunForDetails, setSelectedRunForDetails] = useState<AutomationRun | null>(null);
  const [rejectingRunId, setRejectingRunId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  // Form State
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formTrigger, setFormTrigger] = useState("TASK_MARKED_BLOCKED");
  const [formAction, setFormAction] = useState("AI_TASK_RECOMMENDATION");
  const [formProjectId, setFormProjectId] = useState<string>("");
  const [formPriority, setFormPriority] = useState<string>("");
  const [formStatus, setFormStatus] = useState<string>("");
  const [formMinDaysOverdue, setFormMinDaysOverdue] = useState<string>("1");
  const [formHealthClass, setFormHealthClass] = useState<string>("");
  const [formRequiresApproval, setFormRequiresApproval] = useState(true);
  const [creatingRule, setCreatingRule] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [statsData, rulesData, runsData] = await Promise.all([
        api.get("/ai/automations/stats"),
        api.get("/ai/automations/rules"),
        api.get("/ai/automations/runs"),
      ]);
      setStats(statsData);
      setRules(rulesData || []);
      setRuns(runsData || []);
    } catch (err) {
      notify("error", (err as Error).message || "Failed to load automations data");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleScanDeadlines = async () => {
    try {
      setScanning(true);
      const res = await api.post("/ai/automations/scan-deadlines", {});
      notify(
        "success",
        `Deadline scan complete: ${res.overdueRunsCount || 0} overdue tasks and ${res.milestoneRunsCount || 0} milestones evaluated`,
      );
      await loadData();
    } catch (err) {
      notify("error", (err as Error).message || "Deadline scan failed");
    } finally {
      setScanning(false);
    }
  };

  const handleApprove = async (runId: string) => {
    try {
      setActionInProgress(runId);
      await api.post(`/ai/automations/runs/${runId}/approve`, {});
      notify("success", "Automation action approved and executed successfully");
      await loadData();
    } catch (err) {
      notify("error", (err as Error).message || "Approval failed");
    } finally {
      setActionInProgress(null);
    }
  };

  const handleReject = async (runId: string) => {
    try {
      setActionInProgress(runId);
      await api.post(`/ai/automations/runs/${runId}/reject`, { reason: rejectionReason || undefined });
      notify("info", "Automation action rejected");
      setRejectingRunId(null);
      setRejectionReason("");
      await loadData();
    } catch (err) {
      notify("error", (err as Error).message || "Rejection failed");
    } finally {
      setActionInProgress(null);
    }
  };

  const handleRetry = async (runId: string) => {
    try {
      setActionInProgress(runId);
      await api.post(`/ai/automations/runs/${runId}/retry`, {});
      notify("success", "Automation retry succeeded");
      await loadData();
    } catch (err) {
      notify("error", (err as Error).message || "Retry failed");
    } finally {
      setActionInProgress(null);
    }
  };

  const handleToggleRule = async (rule: AutomationRule) => {
    try {
      const updated = await api.patch(`/ai/automations/rules/${rule.id}`, {
        isEnabled: !rule.isEnabled,
      });
      setRules(prev => prev.map(r => (r.id === rule.id ? updated : r)));
      notify("info", `Rule "${rule.name}" is now ${updated.isEnabled ? "active" : "paused"}`);
    } catch (err) {
      notify("error", (err as Error).message || "Failed to toggle rule");
    }
  };

  const handleDeleteRule = async (ruleId: string, ruleName: string) => {
    if (!window.confirm(`Are you sure you want to delete automation rule "${ruleName}"?`)) return;
    try {
      await api.delete(`/ai/automations/rules/${ruleId}`);
      notify("success", `Rule "${ruleName}" deleted`);
      await loadData();
    } catch (err) {
      notify("error", (err as Error).message || "Failed to delete rule");
    }
  };

  const handleCreateRuleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      notify("error", "Rule name is required");
      return;
    }

    try {
      setCreatingRule(true);
      const conditions: Record<string, any> = {};
      if (formPriority) conditions.priority = formPriority;
      if (formStatus) conditions.status = formStatus;
      if (formTrigger === "TASK_OVERDUE" && formMinDaysOverdue) {
        conditions.minDaysOverdue = parseInt(formMinDaysOverdue, 10) || 1;
      }
      if (formTrigger === "PROJECT_HEALTH_AT_RISK" && formHealthClass) {
        conditions.healthClassification = formHealthClass;
      }

      await api.post("/ai/automations/rules", {
        name: formName.trim(),
        description: formDescription.trim() || undefined,
        triggerEvent: formTrigger,
        action: formAction,
        projectId: formProjectId || undefined,
        conditions,
        requiresApproval: formRequiresApproval,
        isEnabled: true,
      });

      notify("success", `Automation rule "${formName}" created`);
      setShowCreateModal(false);
      // Reset form
      setFormName("");
      setFormDescription("");
      setFormPriority("");
      setFormStatus("");
      setFormProjectId("");
      await loadData();
      setActiveTab("rules");
    } catch (err) {
      notify("error", (err as Error).message || "Failed to create rule");
    } finally {
      setCreatingRule(false);
    }
  };

  const pendingRuns = runs.filter(r => r.status === "PENDING_APPROVAL");

  return (
    <div className="automations-workspace" data-testid="automations-workspace">
      {/* 1. Header */}
      <div className="automation-header">
        <div className="automation-header-left">
          <div className="automation-icon-badge">
            <Zap size={22} />
            <span className="automation-spark-dot">
              <Sparkles size={10} />
            </span>
          </div>
          <div>
            <div className="automation-eyebrow">
              <span className="automation-pulse-dot" />
              INTELLIGENT WORKFLOW ENGINE · RELEASE 4.2.3
            </div>
            <h1 className="automation-title">AI Workflow Automation</h1>
            <p className="automation-subtitle">
              Event-based proactive intelligence with human-in-the-loop review and execution guardrails
            </p>
          </div>
        </div>

        <div className="automation-header-actions">
          <button
            className="btn btn-secondary automation-btn"
            onClick={handleScanDeadlines}
            disabled={scanning}
            title="Scan projects for overdue tasks or approaching milestones"
          >
            {scanning ? <LoaderCircle size={14} className="spin-icon" /> : <Clock size={14} />}
            <span>{scanning ? "Scanning Deadlines..." : "Scan Deadlines"}</span>
          </button>

          <button
            className="btn btn-secondary automation-btn"
            onClick={loadData}
            disabled={loading}
            title="Refresh automations state"
          >
            <RefreshCw size={14} className={loading ? "spin-icon" : ""} />
            <span>Refresh</span>
          </button>

          <button
            className="btn btn-primary automation-btn"
            onClick={() => setShowCreateModal(true)}
            data-testid="btn-create-rule"
          >
            <Plus size={15} />
            <span>New Rule</span>
          </button>
        </div>
      </div>

      {/* 2. KPI Metrics Bar */}
      <div className="automation-stats-grid">
        <div className="stat-card">
          <div className="stat-card-top">
            <span className="stat-card-label">Total Rules</span>
            <div className="stat-card-icon icon-neutral">
              <Layers size={16} />
            </div>
          </div>
          <div className="stat-card-val" data-testid="stat-total-rules">{stats?.totalRules ?? rules.length}</div>
          <div className="stat-card-sub">Configured automations</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-top">
            <span className="stat-card-label">Active Rules</span>
            <div className="stat-card-icon icon-success">
              <Zap size={16} />
            </div>
          </div>
          <div className="stat-card-val" data-testid="stat-active-rules">{stats?.activeRules ?? rules.filter(r => r.isEnabled).length}</div>
          <div className="stat-card-sub">Listening for workspace events</div>
        </div>

        <div className={`stat-card ${pendingRuns.length > 0 ? "highlight-pending" : ""}`}>
          <div className="stat-card-top">
            <span className="stat-card-label">Pending Approvals</span>
            <div className="stat-card-icon icon-warning">
              <AlertCircle size={16} />
            </div>
          </div>
          <div className="stat-card-val stat-val-accent" data-testid="stat-pending-approvals">
            {pendingRuns.length}
          </div>
          <div className="stat-card-sub">Awaiting human review</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-top">
            <span className="stat-card-label">Executed Actions</span>
            <div className="stat-card-icon icon-accent">
              <CheckCircle2 size={16} />
            </div>
          </div>
          <div className="stat-card-val" data-testid="stat-executed-actions">
            {stats?.executedActions ?? runs.filter(r => r.status === "EXECUTED").length}
          </div>
          <div className="stat-card-sub">Approved and applied safely</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-top">
            <span className="stat-card-label">Failed Runs</span>
            <div className="stat-card-icon icon-danger">
              <AlertOctagon size={16} />
            </div>
          </div>
          <div className="stat-card-val" data-testid="stat-failed-runs">{stats?.failedExecutions ?? runs.filter(r => r.status === "FAILED").length}</div>
          <div className="stat-card-sub">Retryable execution errors</div>
        </div>
      </div>

      {/* 3. Segmented Navigation Tabs */}
      <div className="automation-tabs-bar">
        <button
          className={`automation-tab ${activeTab === "pending" ? "active" : ""}`}
          onClick={() => setActiveTab("pending")}
          data-testid="tab-pending"
        >
          <AlertCircle size={15} />
          <span>Pending Approvals</span>
          {pendingRuns.length > 0 && (
            <span className="tab-badge-accent">{pendingRuns.length}</span>
          )}
        </button>

        <button
          className={`automation-tab ${activeTab === "rules" ? "active" : ""}`}
          onClick={() => setActiveTab("rules")}
          data-testid="tab-rules"
        >
          <Zap size={15} />
          <span>Automation Rules</span>
          <span className="tab-badge-neutral">{rules.length}</span>
        </button>

        <button
          className={`automation-tab ${activeTab === "history" ? "active" : ""}`}
          onClick={() => setActiveTab("history")}
          data-testid="tab-history"
        >
          <History size={15} />
          <span>Execution History</span>
          <span className="tab-badge-neutral">{runs.length}</span>
        </button>
      </div>

      {/* 4. Tab Content */}
      <div className="automation-tab-viewport">
        {/* ====================================================
            TAB 1: PENDING APPROVALS QUEUE
            ==================================================== */}
        {activeTab === "pending" && (
          <div className="pending-queue-container" data-testid="pending-queue">
            {pendingRuns.length === 0 ? (
              <div className="automation-empty-box">
                <div className="empty-icon-circle">
                  <CheckCircle2 size={36} />
                </div>
                <h3>Approval Queue is Clear</h3>
                <p>
                  No automation actions currently require manual approval. When event-driven rules
                  detect matching project conditions, proposed actions will appear here for review.
                </p>
                <div className="empty-actions">
                  <button
                    className="btn btn-secondary"
                    onClick={handleScanDeadlines}
                    disabled={scanning}
                  >
                    <Clock size={14} />
                    <span>Scan for Overdue Tasks</span>
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={() => setShowCreateModal(true)}
                  >
                    <Plus size={14} />
                    <span>Create New Rule</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="pending-cards-grid">
                {pendingRuns.map(run => {
                  const ruleName = run.rule?.name || "Workflow Rule";
                  const trig = TRIGGER_LABELS[run.triggerEvent] || { label: run.triggerEvent };
                  const act = ACTION_LABELS[run.action] || { label: run.action };
                  const isProcessing = actionInProgress === run.id;

                  return (
                    <div key={run.id} className="approval-card" data-testid={`approval-card-${run.id}`}>
                      <div className="approval-card-head">
                        <div className="approval-badges">
                          <span className="pill-trigger">{trig.label}</span>
                          <span className="pill-action">{act.label}</span>
                          <span className="pill-pending">AWAITING APPROVAL</span>
                        </div>
                        <span className="approval-time">
                          {new Date(run.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>

                      <div className="approval-card-body">
                        <h3 className="approval-rule-title">{ruleName}</h3>

                        {/* Affected target strip */}
                        <div className="affected-target-strip">
                          {run.project && (
                            <span
                              className="target-project-chip"
                              onClick={() => onOpenProject?.(run.project!.id)}
                              title="Jump to project"
                            >
                              <Layers size={12} />
                              {run.project.name}
                            </span>
                          )}
                          {run.task && (
                            <span className="target-task-chip" title={run.task.title}>
                              <span className={`task-status-dot ${run.task.status.toLowerCase()}`} />
                              {run.task.title}
                              <span className="task-priority-tag">{run.task.priority}</span>
                            </span>
                          )}
                        </div>

                        {/* AI Grounded Explanation */}
                        <div className="ai-explanation-box">
                          <div className="ai-explanation-head">
                            <Sparkles size={13} />
                            <span>AI Grounded Rationale</span>
                          </div>
                          <p className="ai-explanation-text">{run.explanation}</p>
                          {run.proposedAction?.expectedOutcome && (
                            <div className="expected-outcome-row">
                              <strong>Expected Outcome:</strong>{" "}
                              <span>{run.proposedAction.expectedOutcome}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Card Footer Actions */}
                      <div className="approval-card-footer">
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => setSelectedRunForDetails(run)}
                        >
                          <Eye size={13} />
                          <span>View Details</span>
                        </button>

                        <div className="approval-actions-right">
                          <button
                            className="btn btn-secondary text-danger btn-sm"
                            onClick={() => setRejectingRunId(run.id)}
                            disabled={isProcessing}
                            data-testid={`btn-reject-${run.id}`}
                          >
                            <ThumbsDown size={13} />
                            <span>Reject</span>
                          </button>

                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => handleApprove(run.id)}
                            disabled={isProcessing}
                            data-testid={`btn-approve-${run.id}`}
                          >
                            {isProcessing ? (
                              <LoaderCircle size={13} className="spin-icon" />
                            ) : (
                              <ThumbsUp size={13} />
                            )}
                            <span>Approve &amp; Execute</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ====================================================
            TAB 2: AUTOMATION RULES
            ==================================================== */}
        {activeTab === "rules" && (
          <div className="rules-manager-container" data-testid="rules-manager">
            {rules.length === 0 ? (
              <div className="automation-empty-box">
                <div className="empty-icon-circle">
                  <Zap size={36} />
                </div>
                <h3>No Automation Rules Configured</h3>
                <p>
                  Create your first rule to automate task prioritization, assignee recommendations,
                  risk notifications, and project health updates.
                </p>
                <div className="empty-actions">
                  <button
                    className="btn btn-primary"
                    onClick={() => setShowCreateModal(true)}
                  >
                    <Plus size={14} />
                    <span>Create Your First Rule</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="rules-cards-list">
                {rules.map(rule => {
                  const trig = TRIGGER_LABELS[rule.triggerEvent] || { label: rule.triggerEvent };
                  const act = ACTION_LABELS[rule.action] || { label: rule.action };

                  return (
                    <div key={rule.id} className={`rule-card ${rule.isEnabled ? "enabled" : "disabled"}`} data-testid={`rule-card-${rule.id}`}>
                      <div className="rule-card-top">
                        <div className="rule-info">
                          <div className="rule-title-row">
                            <h3 className="rule-name">{rule.name}</h3>
                            <span className={`rule-status-badge ${rule.isEnabled ? "active" : "paused"}`}>
                              {rule.isEnabled ? "ACTIVE" : "PAUSED"}
                            </span>
                            {rule.requiresApproval && (
                              <span className="rule-approval-badge">
                                <Shield size={11} />
                                Human in the Loop
                              </span>
                            )}
                          </div>
                          {rule.description && (
                            <p className="rule-desc">{rule.description}</p>
                          )}
                        </div>

                        <div className="rule-toggle-action">
                          <label className="toggle-switch" title={rule.isEnabled ? "Pause rule" : "Activate rule"}>
                            <input
                              type="checkbox"
                              checked={rule.isEnabled}
                              onChange={() => handleToggleRule(rule)}
                            />
                            <span className="slider" />
                          </label>
                          <button
                            className="btn-icon text-danger"
                            onClick={() => handleDeleteRule(rule.id, rule.name)}
                            title="Delete rule"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>

                      {/* Visual Trigger-to-Action Flow */}
                      <div className="trigger-action-flow">
                        <div className="flow-node flow-trigger">
                          <span className="flow-label">TRIGGER</span>
                          <span className="flow-val">{trig.label}</span>
                        </div>

                        <div className="flow-connector">
                          <span className="flow-line" />
                          <ArrowRight size={14} />
                        </div>

                        <div className="flow-node flow-conditions">
                          <span className="flow-label">CONDITIONS</span>
                          <span className="flow-val">
                            {Object.keys(rule.conditions || {}).length === 0
                              ? "All Matching Events"
                              : Object.entries(rule.conditions)
                                  .map(([k, v]) => `${k}: ${v}`)
                                  .join(" · ")}
                          </span>
                        </div>

                        <div className="flow-connector">
                          <span className="flow-line" />
                          <ArrowRight size={14} />
                        </div>

                        <div className="flow-node flow-action">
                          <span className="flow-label">ACTION</span>
                          <span className="flow-val">{act.label}</span>
                        </div>
                      </div>

                      {/* Rule Footer Info */}
                      <div className="rule-card-bottom">
                        <div className="rule-meta">
                          {rule.project && (
                            <span className="meta-item">
                              <Layers size={12} />
                              Project: {rule.project.name}
                            </span>
                          )}
                          <span className="meta-item">
                            <Clock size={12} />
                            Created {new Date(rule.createdAt).toLocaleDateString()}
                          </span>
                          {rule.lastExecutedAt && (
                            <span className="meta-item">
                              Last run: {new Date(rule.lastExecutedAt).toLocaleDateString()} (
                              {rule.lastExecutionStatus || "DONE"})
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ====================================================
            TAB 3: EXECUTION HISTORY
            ==================================================== */}
        {activeTab === "history" && (
          <div className="history-manager-container" data-testid="history-manager">
            {runs.length === 0 ? (
              <div className="automation-empty-box">
                <div className="empty-icon-circle">
                  <History size={36} />
                </div>
                <h3>No Execution History Yet</h3>
                <p>
                  As workflow triggers fire and actions are reviewed or executed, complete audit
                  records and state logs will be recorded here.
                </p>
              </div>
            ) : (
              <div className="history-table-wrapper">
                <table className="history-table">
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Rule &amp; Trigger</th>
                      <th>Target</th>
                      <th>Action</th>
                      <th>Reviewer</th>
                      <th>Timestamp</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map(run => {
                      const trig = TRIGGER_LABELS[run.triggerEvent] || { label: run.triggerEvent };
                      const act = ACTION_LABELS[run.action] || { label: run.action };

                      return (
                        <tr key={run.id} data-testid={`history-row-${run.id}`}>
                          <td>
                            <span className={`status-pill pill-${run.status.toLowerCase()}`}>
                              {run.status}
                            </span>
                          </td>
                          <td>
                            <div className="cell-rule-name">{run.rule?.name || "Rule"}</div>
                            <div className="cell-sub">{trig.label}</div>
                          </td>
                          <td>
                            {run.task ? (
                              <div className="cell-target-title" title={run.task.title}>
                                {run.task.title}
                              </div>
                            ) : run.project ? (
                              <div className="cell-target-title">{run.project.name}</div>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                          <td>
                            <span className="cell-action-tag">{act.label}</span>
                          </td>
                          <td>
                            {run.reviewedBy ? (
                              <div className="cell-reviewer">
                                <User size={12} />
                                {run.reviewedBy.name}
                              </div>
                            ) : (
                              <span className="text-muted">Automated</span>
                            )}
                          </td>
                          <td>
                            <div className="cell-date">
                              {new Date(run.createdAt).toLocaleDateString()}
                            </div>
                            <div className="cell-sub">
                              {new Date(run.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </div>
                          </td>
                          <td>
                            <div className="history-actions-cell">
                              <button
                                className="btn-icon"
                                onClick={() => setSelectedRunForDetails(run)}
                                title="View run details"
                              >
                                <Eye size={14} />
                              </button>
                              {run.status === "FAILED" && (
                                <button
                                  className="btn-icon text-accent"
                                  onClick={() => handleRetry(run.id)}
                                  title="Retry execution"
                                >
                                  <RotateCcw size={14} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ====================================================
          MODAL: CREATE WORKFLOW AUTOMATION RULE
          ==================================================== */}
      {showCreateModal && (
        <div className="modal-backdrop" onClick={() => setShowCreateModal(false)}>
          <div
            className="modal-card rule-builder-modal"
            onClick={e => e.stopPropagation()}
            data-testid="modal-create-rule"
          >
            <div className="modal-header">
              <div className="modal-title-wrap">
                <div className="modal-icon-badge">
                  <Zap size={18} />
                </div>
                <div>
                  <h2>Create Automation Rule</h2>
                  <p className="modal-subtitle">
                    Configure triggers, conditions, and AI-suggested actions with execution guardrails
                  </p>
                </div>
              </div>
              <button
                className="btn-icon"
                onClick={() => setShowCreateModal(false)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateRuleSubmit}>
              <div className="modal-body form-grid">
                {/* 1. Rule Name & Description */}
                <div className="form-group full-width">
                  <label className="form-label">
                    Rule Name <span className="req">*</span>
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Auto-Mitigate Blocked Tasks"
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    required
                    data-testid="input-rule-name"
                  />
                </div>

                <div className="form-group full-width">
                  <label className="form-label">Description (Optional)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Evaluates upstream dependencies and suggests mitigation when tasks are flagged BLOCKED"
                    value={formDescription}
                    onChange={e => setFormDescription(e.target.value)}
                  />
                </div>

                {/* 2. Trigger Event */}
                <div className="form-group">
                  <label className="form-label">
                    Trigger Event <span className="req">*</span>
                  </label>
                  <select
                    className="form-select"
                    value={formTrigger}
                    onChange={e => setFormTrigger(e.target.value)}
                    data-testid="select-rule-trigger"
                  >
                    {Object.entries(TRIGGER_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                  <span className="field-hint">
                    {TRIGGER_LABELS[formTrigger]?.desc}
                  </span>
                </div>

                {/* 3. Action */}
                <div className="form-group">
                  <label className="form-label">
                    Action <span className="req">*</span>
                  </label>
                  <select
                    className="form-select"
                    value={formAction}
                    onChange={e => setFormAction(e.target.value)}
                    data-testid="select-rule-action"
                  >
                    {Object.entries(ACTION_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                  <span className="field-hint">
                    {ACTION_LABELS[formAction]?.desc}
                  </span>
                </div>

                {/* 4. Conditions Section */}
                <div className="form-section-divider full-width">
                  <span>Conditions (Optional Filters)</span>
                </div>

                <div className="form-group">
                  <label className="form-label">Project Scope</label>
                  <select
                    className="form-select"
                    value={formProjectId}
                    onChange={e => setFormProjectId(e.target.value)}
                  >
                    <option value="">All Workspace Projects</option>
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Task Priority Filter</label>
                  <select
                    className="form-select"
                    value={formPriority}
                    onChange={e => setFormPriority(e.target.value)}
                  >
                    <option value="">Any Priority</option>
                    <option value="URGENT">URGENT</option>
                    <option value="HIGH">HIGH</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="LOW">LOW</option>
                  </select>
                </div>

                {formTrigger === "TASK_OVERDUE" && (
                  <div className="form-group">
                    <label className="form-label">Minimum Days Overdue</label>
                    <input
                      type="number"
                      min="1"
                      className="form-input"
                      value={formMinDaysOverdue}
                      onChange={e => setFormMinDaysOverdue(e.target.value)}
                    />
                  </div>
                )}

                {formTrigger === "PROJECT_HEALTH_AT_RISK" && (
                  <div className="form-group">
                    <label className="form-label">Health Classification</label>
                    <select
                      className="form-select"
                      value={formHealthClass}
                      onChange={e => setFormHealthClass(e.target.value)}
                    >
                      <option value="">At Risk or Critical</option>
                      <option value="AT_RISK">AT_RISK</option>
                      <option value="CRITICAL">CRITICAL</option>
                    </select>
                  </div>
                )}

                {/* 5. Execution Guardrail */}
                <div className="form-group full-width checkbox-card">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={formRequiresApproval}
                      onChange={e => setFormRequiresApproval(e.target.checked)}
                      data-testid="checkbox-requires-approval"
                    />
                    <div className="checkbox-text">
                      <span className="checkbox-title">Require Human-in-the-Loop Review</span>
                      <span className="checkbox-desc">
                        NEXORA will present the proposed action in the Pending Approvals tab and wait for explicit manager approval before executing.
                      </span>
                    </div>
                  </label>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowCreateModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={creatingRule}
                  data-testid="btn-submit-rule"
                >
                  {creatingRule ? (
                    <LoaderCircle size={14} className="spin-icon" />
                  ) : (
                    <Plus size={14} />
                  )}
                  <span>Create Automation Rule</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ====================================================
          MODAL: REJECT CONFIRMATION WITH REASON
          ==================================================== */}
      {rejectingRunId && (
        <div className="modal-backdrop" onClick={() => setRejectingRunId(null)}>
          <div
            className="modal-card reject-modal"
            onClick={e => e.stopPropagation()}
            data-testid="modal-reject-run"
          >
            <div className="modal-header">
              <h2>Reject Automation Proposal</h2>
              <button className="btn-icon" onClick={() => setRejectingRunId(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              <p className="reject-prompt">
                Please provide an optional reason for rejecting this proposed action. The rejection
                will be permanently recorded in the audit history.
              </p>
              <textarea
                className="form-textarea"
                rows={3}
                placeholder="e.g. Team lead already addressed this during standup"
                value={rejectionReason}
                onChange={e => setRejectionReason(e.target.value)}
                data-testid="textarea-reject-reason"
              />
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => setRejectingRunId(null)}
              >
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={() => handleReject(rejectingRunId)}
                data-testid="btn-confirm-reject"
              >
                Confirm Rejection
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================
          MODAL: RUN DETAILS INSPECTOR
          ==================================================== */}
      {selectedRunForDetails && (
        <div className="modal-backdrop" onClick={() => setSelectedRunForDetails(null)}>
          <div
            className="modal-card run-details-modal"
            onClick={e => e.stopPropagation()}
            data-testid="modal-run-details"
          >
            <div className="modal-header">
              <div className="modal-title-wrap">
                <span className={`status-pill pill-${selectedRunForDetails.status.toLowerCase()}`}>
                  {selectedRunForDetails.status}
                </span>
                <h2>{selectedRunForDetails.rule?.name || "Automation Run Details"}</h2>
              </div>
              <button className="btn-icon" onClick={() => setSelectedRunForDetails(null)}>
                <X size={18} />
              </button>
            </div>

            <div className="modal-body details-body">
              <div className="details-grid">
                <div className="detail-item">
                  <span className="detail-label">Trigger Event</span>
                  <span className="detail-val">{selectedRunForDetails.triggerEvent}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Action</span>
                  <span className="detail-val">{selectedRunForDetails.action}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Project</span>
                  <span className="detail-val">
                    {selectedRunForDetails.project?.name || "All Projects Scope"}
                  </span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Affected Task</span>
                  <span className="detail-val">
                    {selectedRunForDetails.task?.title || "None"}
                  </span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Triggered At</span>
                  <span className="detail-val">
                    {new Date(selectedRunForDetails.createdAt).toLocaleString()}
                  </span>
                </div>
                {selectedRunForDetails.reviewedBy && (
                  <div className="detail-item">
                    <span className="detail-label">Reviewed By</span>
                    <span className="detail-val">
                      {selectedRunForDetails.reviewedBy.name} ({selectedRunForDetails.reviewedBy.email})
                    </span>
                  </div>
                )}
              </div>

              {/* Grounded Rationale */}
              <div className="details-section">
                <h4>AI Explanation</h4>
                <p className="details-text">{selectedRunForDetails.explanation}</p>
              </div>

              {/* Proposed Payload */}
              <div className="details-section">
                <h4>Proposed Action Payload</h4>
                <pre className="code-block">
                  {JSON.stringify(selectedRunForDetails.proposedAction, null, 2)}
                </pre>
              </div>

              {/* Execution Result */}
              {selectedRunForDetails.executionResult && (
                <div className="details-section">
                  <h4>Execution Result</h4>
                  <pre className="code-block">
                    {JSON.stringify(selectedRunForDetails.executionResult, null, 2)}
                  </pre>
                </div>
              )}

              {/* Failure Error */}
              {selectedRunForDetails.errorMessage && (
                <div className="details-section error-section">
                  <h4>Failure / Rejection Reason</h4>
                  <p className="error-text">{selectedRunForDetails.errorMessage}</p>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => setSelectedRunForDetails(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
