"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, CheckCircle2, CircleAlert, Clock3, GitBranch, GitMerge, GitPullRequest, LoaderCircle, MoreHorizontal, Play, Plus, RefreshCw, ShieldAlert, ShieldCheck, Trash2, X, Zap } from "lucide-react";
import { api } from "@/lib/api";

type Project = { id: string; name: string };
type Repository = { id: string; fullName: string; project: Project; _count: { events: number }; webhookSecretCiphertext?: string | null };
type AvailableRepository = { id: string; fullName: string; isPrivate: boolean; defaultBranch: string | null };
type GitHubStatus = { configured: boolean; encryptionReady: boolean; connected: boolean; account?: { githubLogin: string; scopes: string[] }; repositories: Repository[]; webhookBaseUrl: string | null };
type GitHubEvent = { id: string; eventType: string; action?: string | null; title?: string | null; url?: string | null; branch?: string | null; occurredAt: string; repository: { fullName: string; project: Project }; linkedTask?: { id: string; title: string; status: string } | null };

type AutomationTrigger =
  | "PULL_REQUEST_OPENED"
  | "PULL_REQUEST_UPDATED"
  | "PULL_REQUEST_APPROVED"
  | "PULL_REQUEST_MERGED"
  | "PULL_REQUEST_CLOSED"
  | "ISSUE_OPENED"
  | "ISSUE_CLOSED"
  | "COMMIT_PUSHED";

type AutomationAction = "TRANSITION_TASK_STATUS" | "ADD_COMMENT";
type ExecutionMode = "AUTOMATIC" | "APPROVAL_REQUIRED";
type RunStatus = "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "EXECUTED" | "FAILED" | "SKIPPED";

type AutomationRule = {
  id: string;
  name: string;
  description: string;
  triggerEvent: AutomationTrigger;
  action: AutomationAction;
  targetStatus?: string | null;
  executionMode: ExecutionMode;
  conditions: Record<string, any>;
  isEnabled: boolean;
  repositoryId?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  repository?: { id: string; fullName: string } | null;
  project?: { id: string; name: string } | null;
  task?: { id: string; title: string; status: string } | null;
  createdBy?: { id: string; name: string } | null;
  lastExecutedAt?: string | null;
  lastExecutionStatus?: RunStatus | null;
  createdAt: string;
};

type AutomationRun = {
  id: string;
  ruleId: string;
  eventId?: string | null;
  taskId?: string | null;
  triggerEvent: AutomationTrigger;
  action: AutomationAction;
  targetStatus?: string | null;
  status: RunStatus;
  executionMode: ExecutionMode;
  explanation: string;
  payloadSummary: Record<string, any>;
  errorMessage?: string | null;
  reviewedBy?: { id: string; name: string } | null;
  reviewedAt?: string | null;
  executedAt?: string | null;
  createdAt: string;
  rule?: { id: string; name: string } | null;
  task?: { id: string; title: string; status: string; projectId: string } | null;
  event?: { id: string; eventType: string; action?: string | null; title?: string | null; url?: string | null; branch?: string | null } | null;
};

const triggerLabels: Record<AutomationTrigger, string> = {
  PULL_REQUEST_MERGED: "PR Merged",
  PULL_REQUEST_OPENED: "PR Opened",
  PULL_REQUEST_UPDATED: "PR Updated",
  PULL_REQUEST_APPROVED: "PR Approved",
  PULL_REQUEST_CLOSED: "PR Closed (Unmerged)",
  ISSUE_OPENED: "Issue Opened",
  ISSUE_CLOSED: "Issue Closed",
  COMMIT_PUSHED: "Commit Pushed",
};

export default function GitHubIntegration({ projects, canManage, notify }: { projects: Project[]; canManage: boolean; notify: (message: string) => void }) {
  const [tab, setTab] = useState<"repositories" | "automation" | "history">("automation");
  const [status, setStatus] = useState<GitHubStatus | null>(null);
  const [events, setEvents] = useState<GitHubEvent[]>([]);
  const [available, setAvailable] = useState<AvailableRepository[]>([]);
  const [repoId, setRepoId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [webhook, setWebhook] = useState<{ webhookUrl: string; secret: string; events: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Automation state
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [pendingRuns, setPendingRuns] = useState<AutomationRun[]>([]);
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [ruleForm, setRuleForm] = useState<{
    name: string;
    description: string;
    triggerEvent: AutomationTrigger;
    action: AutomationAction;
    targetStatus: string;
    executionMode: ExecutionMode;
    repositoryId: string;
    projectId: string;
    branchCondition: string;
  }>({
    name: "",
    description: "",
    triggerEvent: "PULL_REQUEST_MERGED",
    action: "TRANSITION_TASK_STATUS",
    targetStatus: "DONE",
    executionMode: "AUTOMATIC",
    repositoryId: "",
    projectId: "",
    branchCondition: "",
  });

  const refresh = useCallback(async () => {
    try {
      const next = await api.get("/integrations/github") as GitHubStatus;
      setStatus(next);
      if (next.connected) {
        const [eventRows, ruleRows, runRows] = await Promise.all([
          api.get("/integrations/github/events") as Promise<GitHubEvent[]>,
          api.get("/integrations/github/rules") as Promise<AutomationRule[]>,
          api.get("/integrations/github/runs") as Promise<AutomationRun[]>,
        ]);
        setEvents(eventRows);
        setRules(ruleRows);
        setRuns(runRows);
        setPendingRuns(runRows.filter(r => r.status === "PENDING_APPROVAL"));
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load GitHub connection status."); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function connect() {
    setBusy(true); setError("");
    try { const result = await api.post("/integrations/github/connect", {}); window.location.assign(result.authorizationUrl); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not start GitHub authorization."); setBusy(false); }
  }
  async function loadRepositories() {
    setBusy(true); setError("");
    try { setAvailable(await api.get("/integrations/github/repositories/available") as AvailableRepository[]); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load repositories."); }
    finally { setBusy(false); }
  }
  async function linkRepository() {
    if (!repoId || !projectId) return;
    setBusy(true); setError("");
    try { await api.post("/integrations/github/repositories", { repositoryId: repoId, projectId }); setAvailable([]); await refresh(); notify("GitHub repository linked to project"); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not link repository."); }
    finally { setBusy(false); }
  }
  async function unlinkRepository(id: string) {
    setBusy(true); setError("");
    try { await api.delete(`/integrations/github/repositories/${id}`); await refresh(); notify("Repository unlinked"); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not unlink repository."); }
    finally { setBusy(false); }
  }
  async function createWebhook(id: string) {
    setBusy(true); setError("");
    try { setWebhook(await api.post(`/integrations/github/repositories/${id}/webhook`, {})); await refresh(); notify("Webhook secret created. Copy it before leaving this page."); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not create webhook configuration."); }
    finally { setBusy(false); }
  }
  async function disconnect() {
    if (!window.confirm("Disconnect GitHub and remove linked repositories and stored events from this workspace?")) return;
    setBusy(true); setError("");
    try { const result = await api.post("/integrations/github/disconnect", {}); setEvents([]); setAvailable([]); setWebhook(null); await refresh(); notify(result.remoteRevocation === "revoked" ? "GitHub disconnected and access token revoked" : "GitHub disconnected locally; revoke its OAuth grant in GitHub if needed"); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not disconnect GitHub."); }
    finally { setBusy(false); }
  }

  // Automation Rule Handlers
  function openCreateRule() {
    setEditingRuleId(null);
    setRuleForm({
      name: "Mark Task Done on PR Merge",
      description: "Automatically transition linked task to DONE when pull request merges into main.",
      triggerEvent: "PULL_REQUEST_MERGED",
      action: "TRANSITION_TASK_STATUS",
      targetStatus: "DONE",
      executionMode: "AUTOMATIC",
      repositoryId: "",
      projectId: "",
      branchCondition: "",
    });
    setShowRuleForm(true);
  }

  function openEditRule(rule: AutomationRule) {
    setEditingRuleId(rule.id);
    setRuleForm({
      name: rule.name,
      description: rule.description || "",
      triggerEvent: rule.triggerEvent,
      action: rule.action,
      targetStatus: rule.targetStatus || "DONE",
      executionMode: rule.executionMode,
      repositoryId: rule.repositoryId || "",
      projectId: rule.projectId || "",
      branchCondition: rule.conditions?.branch || "",
    });
    setShowRuleForm(true);
  }

  async function saveRule(e: React.FormEvent) {
    e.preventDefault();
    if (!ruleForm.name.trim()) return;
    setBusy(true); setError("");
    try {
      const payload = {
        name: ruleForm.name.trim(),
        description: ruleForm.description.trim(),
        triggerEvent: ruleForm.triggerEvent,
        action: ruleForm.action,
        targetStatus: ruleForm.action === "TRANSITION_TASK_STATUS" ? ruleForm.targetStatus : undefined,
        executionMode: ruleForm.executionMode,
        repositoryId: ruleForm.repositoryId || undefined,
        projectId: ruleForm.projectId || undefined,
        conditions: ruleForm.branchCondition.trim() ? { branch: ruleForm.branchCondition.trim() } : {},
      };
      if (editingRuleId) {
        await api.patch(`/integrations/github/rules/${editingRuleId}`, payload);
        notify("Automation rule updated");
      } else {
        await api.post("/integrations/github/rules", payload);
        notify("Automation rule created");
      }
      setShowRuleForm(false);
      setEditingRuleId(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save automation rule.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleRule(rule: AutomationRule) {
    setBusy(true); setError("");
    try {
      await api.post(`/integrations/github/rules/${rule.id}/toggle`, {});
      await refresh();
      notify(`Rule "${rule.name}" ${rule.isEnabled ? "disabled" : "enabled"}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not toggle rule state.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteRule(rule: AutomationRule) {
    if (!window.confirm(`Delete rule "${rule.name}"?`)) return;
    setBusy(true); setError("");
    try {
      await api.delete(`/integrations/github/rules/${rule.id}`);
      await refresh();
      notify(`Rule "${rule.name}" deleted`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete rule.");
    } finally {
      setBusy(false);
    }
  }

  async function approveRun(run: AutomationRun) {
    setBusy(true); setError("");
    try {
      await api.post(`/integrations/github/runs/${run.id}/approve`, {});
      await refresh();
      notify("Automation approved and task updated");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not approve automation run.");
    } finally {
      setBusy(false);
    }
  }

  async function rejectRun(run: AutomationRun) {
    setBusy(true); setError("");
    try {
      await api.post(`/integrations/github/runs/${run.id}/reject`, {});
      await refresh();
      notify("Automation proposal rejected");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reject automation run.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel settings-panel github-integration-panel">
      <div className="panel-head">
        <div>
          <div className="eyebrow">CONNECTED TOOLS &amp; WORKFLOWS</div>
          <h2>GitHub</h2>
        </div>
        <span className={`status-tag ${status?.connected ? "active" : "planning"}`}>
          {status?.connected ? "CONNECTED" : "NOT CONNECTED"}
        </span>
      </div>
      <p className="muted-copy">
        Link repositories, capture signed development activity, and configure automated task status transitions. Only explicit <code>NEXORA-TASK:uuid</code> references are linked; tasks transition automatically only when an explicit rule is active.
      </p>

      {error && <div className="form-error github-error" role="alert">{error}</div>}

      {!status ? (
        <div className="empty-inline">Checking GitHub configuration…</div>
      ) : !status.connected && (!status.configured || !status.encryptionReady) ? (
        <div className="github-setup-note">
          <b>GitHub OAuth is not configured.</b>
          <span>Set <code>GITHUB_CLIENT_ID</code>, <code>GITHUB_CLIENT_SECRET</code>, <code>GITHUB_CALLBACK_URL</code>, and a 64-character hex <code>GITHUB_TOKEN_ENCRYPTION_KEY</code>. Configure <code>API_PUBLIC_URL</code> before setting up webhooks.</span>
        </div>
      ) : !status.connected ? (
        <div className="integration-row">
          <div className="integration-icon github-mark">GH</div>
          <span><b>Connect GitHub</b><small>OAuth requests account and repository access only.</small></span>
          <button className="button button-secondary small-button" disabled={!canManage || busy} onClick={() => void connect()}>
            {busy ? "Opening…" : "Connect GitHub"}
          </button>
        </div>
      ) : (
        <>
          {(!status.configured || !status.encryptionReady) && (
            <div className="github-setup-note">
              <b>OAuth configuration is incomplete.</b>
              <span>Repository operations are unavailable. You can still disconnect locally; revocation of the GitHub grant may not be confirmed.</span>
            </div>
          )}

          <div className="github-account-row">
            <span>
              <b>@{status.account?.githubLogin}</b>
              <small>Authorized scopes: {status.account?.scopes.join(", ") || "provider default"}</small>
            </span>
            <div>
              <button className="button button-secondary small-button" disabled={busy || !canManage} onClick={() => void loadRepositories()}>
                Add repository
              </button>
              <button className="button button-secondary small-button" disabled={busy || !canManage} onClick={() => void disconnect()}>
                Disconnect
              </button>
            </div>
          </div>

          {!canManage && (
            <div className="settings-hint">Only workspace owners and admins can manage connected repositories and automation rules.</div>
          )}

          {/* Sub-navigation tabs */}
          <div className="project-tabs" style={{ marginTop: "12px", marginBottom: "12px" }}>
            <button className={tab === "automation" ? "selected" : ""} onClick={() => setTab("automation")}>
              Automation Rules <span>{rules.length}</span>
            </button>
            {pendingRuns.length > 0 && (
              <button className={tab === "automation" ? "" : ""} onClick={() => setTab("automation")}>
                <span style={{ color: "#d98f5c", background: "#fff2df" }}>Pending Approvals ({pendingRuns.length})</span>
              </button>
            )}
            <button className={tab === "history" ? "selected" : ""} onClick={() => setTab("history")}>
              Execution History <span>{runs.length}</span>
            </button>
            <button className={tab === "repositories" ? "selected" : ""} onClick={() => setTab("repositories")}>
              Repositories &amp; Webhooks <span>{status.repositories.length}</span>
            </button>
          </div>

          {/* TAB 1: Automation Rules & Approval Queue */}
          {tab === "automation" && (
            <div className="github-automation-section">
              {/* Pending Approvals Queue */}
              {pendingRuns.length > 0 && (
                <div className="github-pending-approvals" style={{ marginBottom: "16px", padding: "12px", border: "1px solid #ffd8a8", borderRadius: "8px", background: "#fff9f0" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#b77e23", fontWeight: 700, fontSize: "11px" }}>
                      <ShieldAlert size={15} />
                      <span>Pending Automation Approvals ({pendingRuns.length})</span>
                    </div>
                    <small style={{ color: "#998565", fontSize: "9px" }}>Requires Human Approval</small>
                  </div>
                  <div style={{ display: "grid", gap: "8px" }}>
                    {pendingRuns.map(run => (
                      <div key={run.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", padding: "8px 10px", background: "#fff", borderRadius: "6px", border: "1px solid #f0e2d0" }}>
                        <div style={{ display: "grid", gap: "3px", minWidth: 0 }}>
                          <b style={{ fontSize: "10px", color: "var(--ink)" }}>{run.explanation}</b>
                          <small style={{ color: "#8a919b", fontSize: "8.5px" }}>
                            Rule: {run.rule?.name || "Rule"} · Event: {triggerLabels[run.triggerEvent]} · Task: {run.task?.title || "Referenced Task"}
                          </small>
                        </div>
                        <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                          <button className="button button-secondary small-button" disabled={busy} onClick={() => void rejectRun(run)}>
                            <X size={12} /> Reject
                          </button>
                          <button className="button button-primary small-button" disabled={busy} onClick={() => void approveRun(run)}>
                            <Check size={12} /> Approve &amp; Execute
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Rules List Header */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                <div>
                  <h3 style={{ margin: 0, font: "700 11px Manrope", color: "var(--ink)" }}>Configured Rules</h3>
                  <small style={{ color: "#8d959f", fontSize: "9px" }}>Automate task transitions upon verified GitHub webhook events</small>
                </div>
                {canManage && (
                  <button className="button button-primary small-button" disabled={busy} onClick={openCreateRule}>
                    <Plus size={13} /> Add Automation Rule
                  </button>
                )}
              </div>

              {/* Create/Edit Rule Modal/Card */}
              {showRuleForm && (
                <form onSubmit={saveRule} style={{ margin: "12px 0", padding: "14px", border: "1px solid var(--purple)", borderRadius: "8px", background: "var(--surface)", boxShadow: "0 2px 8px #6558d418" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                    <b style={{ font: "700 11px Manrope", color: "var(--ink)" }}>{editingRuleId ? "Edit Automation Rule" : "New Automation Rule"}</b>
                    <button type="button" className="icon-button" onClick={() => setShowRuleForm(false)} aria-label="Close rule form">
                      <X size={15} />
                    </button>
                  </div>

                  <div style={{ display: "grid", gap: "10px" }}>
                    <label style={{ display: "grid", gap: "4px", fontSize: "9px", color: "var(--ink)" }}>
                      Rule Name
                      <input required minLength={2} maxLength={120} value={ruleForm.name} onChange={e => setRuleForm({ ...ruleForm, name: e.target.value })} placeholder="e.g. Move task to DONE when PR merged" style={{ height: "30px", padding: "0 8px", border: "1px solid var(--line)", borderRadius: "6px", fontSize: "9.5px" }} />
                    </label>

                    <label style={{ display: "grid", gap: "4px", fontSize: "9px", color: "var(--ink)" }}>
                      Description (Optional)
                      <input maxLength={500} value={ruleForm.description} onChange={e => setRuleForm({ ...ruleForm, description: e.target.value })} placeholder="Explain when and why this rule executes" style={{ height: "30px", padding: "0 8px", border: "1px solid var(--line)", borderRadius: "6px", fontSize: "9.5px" }} />
                    </label>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                      <label style={{ display: "grid", gap: "4px", fontSize: "9px", color: "var(--ink)" }}>
                        GitHub Trigger Event
                        <select value={ruleForm.triggerEvent} onChange={e => setRuleForm({ ...ruleForm, triggerEvent: e.target.value as AutomationTrigger })} style={{ height: "30px", padding: "0 6px", border: "1px solid var(--line)", borderRadius: "6px", fontSize: "9px" }}>
                          <option value="PULL_REQUEST_MERGED">Pull Request Merged</option>
                          <option value="PULL_REQUEST_OPENED">Pull Request Opened</option>
                          <option value="PULL_REQUEST_UPDATED">Pull Request Updated / Synchronized</option>
                          <option value="PULL_REQUEST_APPROVED">Pull Request Approved</option>
                          <option value="PULL_REQUEST_CLOSED">Pull Request Closed (Unmerged)</option>
                          <option value="ISSUE_OPENED">Issue Opened</option>
                          <option value="ISSUE_CLOSED">Issue Closed</option>
                          <option value="COMMIT_PUSHED">Commit Pushed</option>
                        </select>
                      </label>

                      <label style={{ display: "grid", gap: "4px", fontSize: "9px", color: "var(--ink)" }}>
                        Proposed Task Action
                        <select value={ruleForm.targetStatus} onChange={e => setRuleForm({ ...ruleForm, targetStatus: e.target.value })} style={{ height: "30px", padding: "0 6px", border: "1px solid var(--line)", borderRadius: "6px", fontSize: "9px" }}>
                          <option value="DONE">Transition Status → DONE</option>
                          <option value="IN_REVIEW">Transition Status → IN_REVIEW</option>
                          <option value="IN_PROGRESS">Transition Status → IN_PROGRESS</option>
                          <option value="BLOCKED">Transition Status → BLOCKED</option>
                          <option value="TODO">Transition Status → TODO</option>
                          <option value="CANCELLED">Transition Status → CANCELLED</option>
                        </select>
                      </label>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
                      <label style={{ display: "grid", gap: "4px", fontSize: "9px", color: "var(--ink)" }}>
                        Execution Mode
                        <select value={ruleForm.executionMode} onChange={e => setRuleForm({ ...ruleForm, executionMode: e.target.value as ExecutionMode })} style={{ height: "30px", padding: "0 6px", border: "1px solid var(--line)", borderRadius: "6px", fontSize: "9px" }}>
                          <option value="AUTOMATIC">Automatic Execution</option>
                          <option value="APPROVAL_REQUIRED">Require Human Approval</option>
                        </select>
                      </label>

                      <label style={{ display: "grid", gap: "4px", fontSize: "9px", color: "var(--ink)" }}>
                        Repository Scope
                        <select value={ruleForm.repositoryId} onChange={e => setRuleForm({ ...ruleForm, repositoryId: e.target.value })} style={{ height: "30px", padding: "0 6px", border: "1px solid var(--line)", borderRadius: "6px", fontSize: "9px" }}>
                          <option value="">All Connected Repositories</option>
                          {status.repositories.map(r => (
                            <option key={r.id} value={r.id}>{r.fullName}</option>
                          ))}
                        </select>
                      </label>

                      <label style={{ display: "grid", gap: "4px", fontSize: "9px", color: "var(--ink)" }}>
                        Project Scope
                        <select value={ruleForm.projectId} onChange={e => setRuleForm({ ...ruleForm, projectId: e.target.value })} style={{ height: "30px", padding: "0 6px", border: "1px solid var(--line)", borderRadius: "6px", fontSize: "9px" }}>
                          <option value="">All Workspace Projects</option>
                          {projects.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <label style={{ display: "grid", gap: "4px", fontSize: "9px", color: "var(--ink)" }}>
                      Branch Condition (Optional filter, e.g. main)
                      <input value={ruleForm.branchCondition} onChange={e => setRuleForm({ ...ruleForm, branchCondition: e.target.value })} placeholder="e.g. main (leave blank for any branch)" style={{ height: "30px", padding: "0 8px", border: "1px solid var(--line)", borderRadius: "6px", fontSize: "9.5px" }} />
                    </label>

                    <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "4px" }}>
                      <button type="button" className="button button-secondary small-button" onClick={() => setShowRuleForm(false)}>
                        Cancel
                      </button>
                      <button type="submit" className="button button-primary small-button" disabled={busy}>
                        {busy ? <LoaderCircle className="spin" size={13} /> : <Check size={13} />} {editingRuleId ? "Save Changes" : "Create Rule"}
                      </button>
                    </div>
                  </div>
                </form>
              )}

              {/* Rules List */}
              <div style={{ display: "grid", gap: "8px" }}>
                {rules.map(rule => (
                  <div key={rule.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", padding: "10px 12px", border: "1px solid var(--line)", borderRadius: "7px", background: rule.isEnabled ? "var(--surface)" : "var(--soft-surface)" }}>
                    <div style={{ display: "grid", gap: "4px", minWidth: 0, flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                        <b style={{ fontSize: "10px", color: "var(--ink)" }}>{rule.name}</b>
                        <span className={`status-tag ${rule.isEnabled ? "active" : "planning"}`} style={{ fontSize: "7px" }}>
                          {rule.isEnabled ? "ENABLED" : "DISABLED"}
                        </span>
                        <span className="status-tag completed" style={{ fontSize: "7px" }}>
                          {triggerLabels[rule.triggerEvent]}
                        </span>
                        <span className="status-tag at_risk" style={{ fontSize: "7px" }}>
                          → {rule.targetStatus || "ACTION"}
                        </span>
                        <span style={{ fontSize: "8px", color: rule.executionMode === "AUTOMATIC" ? "#43856d" : "#ac7625" }}>
                          {rule.executionMode === "AUTOMATIC" ? "⚡ Automatic" : "🛡️ Approval Required"}
                        </span>
                      </div>
                      <small style={{ color: "#8d959f", fontSize: "8.5px" }}>
                        {rule.description || "No description provided."}
                        {rule.conditions?.branch ? ` · Branch: ${rule.conditions.branch}` : ""}
                        {rule.repository ? ` · Repo: ${rule.repository.fullName}` : " · All repositories"}
                        {rule.project ? ` · Project: ${rule.project.name}` : " · All projects"}
                        {rule.lastExecutedAt ? ` · Last run: ${new Date(rule.lastExecutedAt).toLocaleString()}` : ""}
                      </small>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                      {canManage && (
                        <>
                          <button className="button button-secondary small-button" disabled={busy} onClick={() => void toggleRule(rule)} title={rule.isEnabled ? "Disable rule" : "Enable rule"}>
                            {rule.isEnabled ? "Disable" : "Enable"}
                          </button>
                          <button className="icon-button" disabled={busy} onClick={() => openEditRule(rule)} title="Edit rule" aria-label="Edit rule">
                            <MoreHorizontal size={14} />
                          </button>
                          <button className="icon-button danger-text" disabled={busy} onClick={() => void deleteRule(rule)} title="Delete rule" aria-label="Delete rule">
                            <Trash2 size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}

                {!rules.length && !showRuleForm && (
                  <div className="empty-inline" style={{ padding: "16px 0" }}>
                    No automation rules defined yet. Create your first rule to automate task transitions when pull requests merge or open.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: Execution History */}
          {tab === "history" && (
            <div className="github-history-section">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                <b style={{ font: "700 11px Manrope", color: "var(--ink)" }}>Recent Automation Executions</b>
                <button className="icon-button" onClick={() => void refresh()} title="Refresh history" aria-label="Refresh history">
                  <RefreshCw size={14} />
                </button>
              </div>

              <div style={{ display: "grid", gap: "6px" }}>
                {runs.slice(0, 20).map(run => (
                  <div key={run.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", padding: "8px 10px", border: "1px solid var(--line)", borderRadius: "6px", background: "var(--surface)" }}>
                    <div style={{ display: "grid", gap: "3px", minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span className={`status-tag ${run.status === "EXECUTED" ? "active" : run.status === "PENDING_APPROVAL" ? "at_risk" : run.status === "REJECTED" ? "planning" : "at_risk"}`} style={{ fontSize: "7px" }}>
                          {run.status.replace("_", " ")}
                        </span>
                        <b style={{ fontSize: "9px", color: "var(--ink)" }}>{run.rule?.name || "Rule"}</b>
                        <span style={{ fontSize: "8px", color: "#8d959f" }}>
                          {triggerLabels[run.triggerEvent]}
                        </span>
                      </div>
                      <small style={{ color: "#7a828e", fontSize: "8.5px" }}>{run.explanation}</small>
                    </div>
                    <time style={{ color: "#8d959f", fontSize: "8px", whiteSpace: "nowrap" }}>
                      {new Date(run.createdAt).toLocaleString()}
                    </time>
                  </div>
                ))}

                {!runs.length && (
                  <div className="empty-inline" style={{ padding: "16px 0" }}>
                    No automation runs recorded yet. Executed and proposed workflow automations will appear here.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: Repositories & Webhooks */}
          {tab === "repositories" && (
            <div className="github-repositories-section">
              {!!available.length && (
                <div className="github-repository-picker">
                  <label>Repository
                    <select aria-label="GitHub repository" value={repoId} onChange={e => setRepoId(e.target.value)}>
                      <option value="">Choose repository</option>
                      {available.map(repo => (
                        <option key={repo.id} value={repo.id}>{repo.fullName}{repo.isPrivate ? " · private" : ""}</option>
                      ))}
                    </select>
                  </label>
                  <label>Link to project
                    <select aria-label="Link repository to project" value={projectId} onChange={e => setProjectId(e.target.value)}>
                      <option value="">Choose project</option>
                      {projects.map(project => (
                        <option key={project.id} value={project.id}>{project.name}</option>
                      ))}
                    </select>
                  </label>
                  <button className="button button-primary small-button" disabled={busy || !repoId || !projectId || !canManage} onClick={() => void linkRepository()}>
                    Link
                  </button>
                </div>
              )}

              <div className="github-linked-list">
                {status.repositories.map(repo => (
                  <div className="integration-row" key={repo.id}>
                    <div className="integration-icon github-mark">GH</div>
                    <span>
                      <b>{repo.fullName}</b>
                      <small>{repo.project.name} · {repo._count.events} captured events</small>
                    </span>
                    <button className="text-button" disabled={busy || !canManage} onClick={() => void createWebhook(repo.id)}>
                      Configure webhook
                    </button>
                    <button className="text-button danger-text" disabled={busy || !canManage} onClick={() => void unlinkRepository(repo.id)}>
                      Unlink
                    </button>
                  </div>
                ))}
                {!status.repositories.length && !available.length && (
                  <div className="empty-inline">No repositories linked. Add a repository to associate its development activity with a project.</div>
                )}
              </div>

              {webhook && (
                <div className="github-webhook-secret">
                  <b>GitHub webhook setup · copy the secret now</b>
                  <label>Payload URL<input readOnly value={webhook.webhookUrl} /></label>
                  <label>Secret<input readOnly value={webhook.secret} /></label>
                  <small>Choose JSON payloads and subscribe to: {webhook.events.join(", ")}. Rotating this secret invalidates the previous hook secret.</small>
                </div>
              )}

              {!!events.length && (
                <div className="github-events">
                  <h3>Recent repository activity</h3>
                  {events.slice(0, 8).map(event => (
                    <div className="github-event-row" key={event.id}>
                      <span>
                        <b>{event.title || event.eventType.replaceAll("_", " ")}</b>
                        <small>{event.repository.fullName} · {event.repository.project.name}{event.action ? ` · ${event.action}` : ""}{event.linkedTask ? ` · linked to ${event.linkedTask.title}` : ""}</small>
                      </span>
                      {event.url ? <a href={event.url} target="_blank" rel="noreferrer">Open</a> : <time>{new Date(event.occurredAt).toLocaleDateString()}</time>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
