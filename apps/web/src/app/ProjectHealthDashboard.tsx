"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  ExternalLink,
  HelpCircle,
  Info,
  LoaderCircle,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";

interface Props {
  projects: Array<{ id: string; name: string }>;
  user?: any;
  workspace?: { id: string; name: string; role?: string } | null;
  notify: (message: string) => void;
  onOpenProject?: (projectId: string) => void;
  initialProjectId?: string | null;
}

export default function ProjectHealthDashboard({
  projects,
  user,
  workspace,
  notify,
  onOpenProject,
  initialProjectId,
}: Props) {
  const [overview, setOverview] = useState<any>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(initialProjectId || null);
  const [projectHealth, setProjectHealth] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [risks, setRisks] = useState<any[]>([]);
  const [riskSeverityFilter, setRiskSeverityFilter] = useState<string>("ALL");
  const [riskStatusFilter, setRiskStatusFilter] = useState<string>("ACTIVE");
  const [loading, setLoading] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (initialProjectId && !selectedProjectId) {
      setSelectedProjectId(initialProjectId);
    }
  }, [initialProjectId, selectedProjectId]);

  // Dismiss modal state
  const [dismissModalRisk, setDismissModalRisk] = useState<any>(null);
  const [dismissReason, setDismissReason] = useState("");
  const [dismissBusy, setDismissBusy] = useState(false);

  // AI explanation state
  const [aiLoading, setAiLoading] = useState(false);
  const [aiExplanation, setAiExplanation] = useState<any>(null);

  const canManage =
    workspace?.role === "OWNER" ||
    workspace?.role === "ADMIN" ||
    workspace?.role === "PROJECT_MANAGER";

  // Load workspace overview
  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.get("/health/projects/overview");
      setOverview(data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load project health overview.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Load individual project health details
  const loadProjectDetails = useCallback(async (projectId: string) => {
    setLoading(true);
    setError("");
    setAiExplanation(null);
    try {
      const [health, hist, risksData] = await Promise.all([
        api.get(`/health/projects/${projectId}`),
        api.get(`/health/projects/${projectId}/history?limit=30`),
        api.get(`/health/projects/${projectId}/risks?status=ALL`),
      ]);
      setProjectHealth(health);
      setHistory(hist.history ?? []);
      setRisks(risksData.risks ?? []);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load project health details.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedProjectId) {
      void loadProjectDetails(selectedProjectId);
    } else {
      void loadOverview();
    }
  }, [selectedProjectId, loadOverview, loadProjectDetails]);

  // Recalculate
  async function handleRecalculate(projectId: string) {
    setRecalculating(true);
    try {
      const fresh = await api.post(`/health/projects/${projectId}/recalculate`, { force: true });
      setProjectHealth(fresh);
      notify("Project health recalculation completed.");
      // Reload history and risks
      const [hist, risksData] = await Promise.all([
        api.get(`/health/projects/${projectId}/history?limit=30`),
        api.get(`/health/projects/${projectId}/risks?status=ALL`),
      ]);
      setHistory(hist.history ?? []);
      setRisks(risksData.risks ?? []);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Recalculation failed.");
    } finally {
      setRecalculating(false);
    }
  }

  // Dismiss risk
  async function submitDismissRisk() {
    if (!dismissModalRisk || !selectedProjectId || !dismissReason.trim()) return;
    setDismissBusy(true);
    try {
      await api.post(
        `/health/projects/${selectedProjectId}/risks/${dismissModalRisk.id}/dismiss`,
        { reason: dismissReason.trim() },
      );
      notify("Risk dismissed with audit record.");
      setDismissModalRisk(null);
      setDismissReason("");
      // Refresh risks
      const risksData = await api.get(`/health/projects/${selectedProjectId}/risks?status=ALL`);
      setRisks(risksData.risks ?? []);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to dismiss risk.");
    } finally {
      setDismissBusy(false);
    }
  }

  // Propose AI action from recommendation
  async function handleProposeAction(riskId: string) {
    if (!selectedProjectId) return;
    try {
      await api.post(`/health/projects/${selectedProjectId}/recommendations/${riskId}/propose`, {});
      notify("AI proposal draft created for manager review.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to propose recommendation action.");
    }
  }

  // Explain with AI
  async function handleExplainWithAI(projectId: string) {
    setAiLoading(true);
    try {
      const res = await api.post(`/health/projects/${projectId}/explain`, {});
      setAiExplanation(res);
      notify("Executive health explanation generated.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to generate AI explanation.");
    } finally {
      setAiLoading(false);
    }
  }

  const getScoreColor = (score: number | null, classification: string) => {
    if (classification === "INSUFFICIENT_DATA") return "#94a3b8";
    if (classification === "EXCLUDED") return "#94a3b8";
    if (score === null) return "#94a3b8";
    if (score >= 80) return "#10b981";
    if (score >= 50) return "#f59e0b";
    return "#ef4444";
  };

  const getScoreBadgeClass = (classification: string) => {
    switch (classification) {
      case "HEALTHY":
        return "badge-healthy";
      case "AT_RISK":
        return "badge-at-risk";
      case "CRITICAL":
        return "badge-critical";
      default:
        return "badge-neutral";
    }
  };

  const filteredRisks = risks.filter(r => {
    if (riskStatusFilter !== "ALL" && r.status !== riskStatusFilter) return false;
    if (riskSeverityFilter !== "ALL" && r.severity !== riskSeverityFilter) return false;
    return true;
  });

  return (
    <div className="project-health-workspace">
      {/* Header bar */}
      <div className="welcome-row compact-welcome">
        <div>
          <div className="eyebrow">
            <ShieldAlert size={13} /> PROJECT INTELLIGENCE &amp; RISK ENGINE
          </div>
          <h1>
            {selectedProjectId && projectHealth
              ? projectHealth.projectName
              : "Project health & predictive risk"}
          </h1>
          <p className="page-subtitle">
            {selectedProjectId
              ? "Comprehensive deterministic health breakdown, forecast, and detected risk vectors."
              : "Workspace-wide health metrics, early risk alerts, and explainable forecasting."}
          </p>
        </div>

        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {selectedProjectId && (
            <>
              <button
                className="button button-secondary"
                onClick={() => setSelectedProjectId(null)}
              >
                All projects overview
              </button>
              {canManage && (
                <button
                  className="button button-secondary"
                  disabled={recalculating}
                  onClick={() => handleRecalculate(selectedProjectId)}
                >
                  {recalculating ? (
                    <LoaderCircle size={14} className="spin" />
                  ) : (
                    <RefreshCw size={14} />
                  )}
                  Recalculate health
                </button>
              )}
              <button
                className="button button-primary"
                onClick={() => onOpenProject?.(selectedProjectId)}
              >
                Open project workspace <ArrowRight size={13} />
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="meeting-error" style={{ marginBottom: "16px" }}>
          <span>{error}</span>
          <button onClick={() => setError("")} aria-label="Dismiss error">
            <X size={14} />
          </button>
        </div>
      )}

      {/* VIEW 1: WORKSPACE OVERVIEW */}
      {!selectedProjectId && overview && (
        <>
          {/* Summary Metric Cards */}
          <div className="health-metrics-grid">
            <div className="health-stat-card">
              <span className="health-stat-label">Total Active Projects</span>
              <b className="health-stat-value">{overview.totalActiveProjects}</b>
              <small className="health-stat-sub">Tracked in this workspace</small>
            </div>
            <div className="health-stat-card healthy-border">
              <span className="health-stat-label" style={{ color: "#10b981" }}>
                <CheckCircle2 size={13} /> Healthy (80–100)
              </span>
              <b className="health-stat-value" style={{ color: "#10b981" }}>
                {overview.metrics.healthyCount}
              </b>
              <small className="health-stat-sub">On-track deliverables</small>
            </div>
            <div className="health-stat-card at-risk-border">
              <span className="health-stat-label" style={{ color: "#f59e0b" }}>
                <AlertTriangle size={13} /> At Risk (50–79)
              </span>
              <b className="health-stat-value" style={{ color: "#f59e0b" }}>
                {overview.metrics.atRiskCount}
              </b>
              <small className="health-stat-sub">Require monitoring</small>
            </div>
            <div className="health-stat-card critical-border">
              <span className="health-stat-label" style={{ color: "#ef4444" }}>
                <AlertOctagon size={13} /> Critical (0–49)
              </span>
              <b className="health-stat-value" style={{ color: "#ef4444" }}>
                {overview.metrics.criticalCount}
              </b>
              <small className="health-stat-sub">Immediate action needed</small>
            </div>
            <div className="health-stat-card">
              <span className="health-stat-label" style={{ color: "#ef4444" }}>
                <ShieldAlert size={13} /> High-Severity Risks
              </span>
              <b className="health-stat-value">
                {overview.metrics.activeHighSeverityRisksCount}
              </b>
              <small className="health-stat-sub">Critical / High active vectors</small>
            </div>
          </div>

          {/* Attention Required Banner */}
          {overview.projectsRequiringAttention?.length > 0 && (
            <div className="health-attention-panel">
              <div className="panel-head">
                <div>
                  <div className="eyebrow" style={{ color: "#b45309" }}>
                    <AlertTriangle size={12} /> ATTENTION REQUIRED
                  </div>
                  <h2>Projects requiring immediate leadership focus</h2>
                </div>
              </div>
              <div className="attention-projects-list">
                {overview.projectsRequiringAttention.map((p: any) => (
                  <button
                    key={p.id}
                    className="attention-row"
                    onClick={() => setSelectedProjectId(p.id)}
                  >
                    <div
                      className="health-badge-circle"
                      style={{
                        borderColor: getScoreColor(p.score, p.classification),
                        color: getScoreColor(p.score, p.classification),
                      }}
                    >
                      {p.score !== null ? p.score : "—"}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <b>{p.name}</b>
                      <small>
                        {p.classification.replace("_", " ")} ·{" "}
                        {p.activeRisksCount.critical} critical,{" "}
                        {p.activeRisksCount.high} high risks
                      </small>
                    </div>
                    <span className="text-button">
                      Inspect health <ChevronRight size={14} />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* All Project Health Cards */}
          <div style={{ marginTop: "20px" }}>
            <div className="panel-head" style={{ marginBottom: "12px" }}>
              <div>
                <div className="eyebrow">ALL PROJECTS</div>
                <h2>Project health status cards</h2>
              </div>
            </div>

            <div className="health-cards-grid">
              {overview.projects?.map((p: any) => (
                <div
                  key={p.id}
                  className="health-card"
                  onClick={() => setSelectedProjectId(p.id)}
                >
                  <div className="health-card-head">
                    <span
                      className={`health-pill ${getScoreBadgeClass(p.classification)}`}
                    >
                      {p.classification.replace("_", " ")}
                    </span>
                    <div
                      className="health-score-pill"
                      style={{
                        backgroundColor: `${getScoreColor(p.score, p.classification)}18`,
                        color: getScoreColor(p.score, p.classification),
                        borderColor: getScoreColor(p.score, p.classification),
                      }}
                    >
                      {p.score !== null ? `${p.score} / 100` : "No data"}
                    </div>
                  </div>

                  <h3 className="health-card-title">{p.name}</h3>

                  <div className="health-card-stats">
                    <div>
                      <span>Risks</span>
                      <b>{p.activeRisksCount?.total ?? 0}</b>
                    </div>
                    <div>
                      <span>Critical / High</span>
                      <b style={{ color: p.activeRisksCount?.critical ? "#ef4444" : undefined }}>
                        {(p.activeRisksCount?.critical ?? 0) + (p.activeRisksCount?.high ?? 0)}
                      </b>
                    </div>
                    <div>
                      <span>Target Date</span>
                      <b>
                        {p.dueDate
                          ? new Date(p.dueDate).toLocaleDateString("en", {
                              month: "short",
                              day: "numeric",
                            })
                          : "None"}
                      </b>
                    </div>
                  </div>

                  <div className="health-card-foot">
                    <small>
                      {p.lastCalculatedAt
                        ? `Updated ${new Date(p.lastCalculatedAt).toLocaleDateString()}`
                        : "Not yet calculated"}
                    </small>
                    <span className="text-button">
                      Details <ChevronRight size={13} />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* VIEW 2: PROJECT DETAIL HEALTH VIEW */}
      {selectedProjectId && projectHealth && (
        <div className="health-detail-view">
          {/* Top Score Banner */}
          <div className="health-hero-panel">
            <div className="health-gauge-box">
              <div
                className="health-gauge"
                style={{
                  borderColor: getScoreColor(projectHealth.score, projectHealth.classification),
                }}
              >
                <b style={{ color: getScoreColor(projectHealth.score, projectHealth.classification) }}>
                  {projectHealth.score !== null ? projectHealth.score : "—"}
                </b>
                <small>/ 100</small>
              </div>
              <span className={`health-pill ${getScoreBadgeClass(projectHealth.classification)}`}>
                {projectHealth.classification.replace("_", " ")}
              </span>
            </div>

            <div className="health-hero-info">
              <h2>Project Health Status: {projectHealth.classification.replace("_", " ")}</h2>
              <p className="health-hero-explanation">{projectHealth.explanation}</p>
              <div className="health-hero-meta">
                <span>
                  <Clock3 size={13} /> Calculated:{" "}
                  {new Date(projectHealth.calculatedAt).toLocaleString()}
                </span>
                <span>
                  <ShieldCheck size={13} /> Engine Version: {projectHealth.algorithmVersion}
                </span>
                <span>
                  <Activity size={13} /> Data Completeness:{" "}
                  {Math.round(projectHealth.dataCompleteness * 100)}%
                </span>
              </div>
            </div>

            <div className="health-hero-actions">
              <button
                className="button button-secondary"
                disabled={aiLoading}
                onClick={() => handleExplainWithAI(selectedProjectId)}
              >
                {aiLoading ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />}
                Executive AI Summary
              </button>
            </div>
          </div>

          {/* AI Executive Summary Card */}
          {aiExplanation && (
            <div className="panel ai-explanation-panel">
              <div className="panel-head">
                <div>
                  <div className="eyebrow" style={{ color: "#7c3aed" }}>
                    <Sparkles size={13} /> EXECUTIVE PM INSIGHT
                  </div>
                  <h2>AI Health &amp; Risk Synthesis</h2>
                </div>
                <button
                  className="icon-button"
                  onClick={() => setAiExplanation(null)}
                  aria-label="Dismiss AI summary"
                >
                  <X size={15} />
                </button>
              </div>
              <p className="ai-summary-text">{aiExplanation.summary}</p>
              {aiExplanation.topRisksAnalysis?.length > 0 && (
                <div className="ai-sub-section">
                  <b>Identified Threat Vectors:</b>
                  <ul>
                    {aiExplanation.topRisksAnalysis.map((item: string, idx: number) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {aiExplanation.recommendedPriorities?.length > 0 && (
                <div className="ai-sub-section">
                  <b>Recommended Management Priorities:</b>
                  <ul>
                    {aiExplanation.recommendedPriorities.map((item: string, idx: number) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Dimension Breakdown Grid */}
          <div className="panel dimension-panel">
            <div className="panel-head">
              <div>
                <div className="eyebrow">DETERMINISTIC ANALYSIS</div>
                <h2>Scoring Dimension Breakdown</h2>
              </div>
              <small className="muted-copy">Weights sum to 100%</small>
            </div>

            <div className="dimension-grid">
              {/* Dim 1: Task Completion */}
              <div className="dimension-card">
                <div className="dim-head">
                  <span>Task Completion &amp; Progress (25%)</span>
                  <b>{projectHealth.dimensionScores?.taskCompletion?.score ?? 0}%</b>
                </div>
                <div className="progress-track">
                  <i
                    style={{
                      width: `${projectHealth.dimensionScores?.taskCompletion?.score ?? 0}%`,
                      backgroundColor: getScoreColor(
                        projectHealth.dimensionScores?.taskCompletion?.score,
                        "AT_RISK",
                      ),
                    }}
                  />
                </div>
                <ul className="dim-notes">
                  {projectHealth.dimensionScores?.taskCompletion?.notes?.map((n: string, i: number) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </div>

              {/* Dim 2: Deadline Performance */}
              <div className="dimension-card">
                <div className="dim-head">
                  <span>Deadline Performance (25%)</span>
                  <b>{projectHealth.dimensionScores?.deadlinePerformance?.score ?? 0}%</b>
                </div>
                <div className="progress-track">
                  <i
                    style={{
                      width: `${projectHealth.dimensionScores?.deadlinePerformance?.score ?? 0}%`,
                      backgroundColor: getScoreColor(
                        projectHealth.dimensionScores?.deadlinePerformance?.score,
                        "AT_RISK",
                      ),
                    }}
                  />
                </div>
                <ul className="dim-notes">
                  {projectHealth.dimensionScores?.deadlinePerformance?.notes?.map(
                    (n: string, i: number) => (
                      <li key={i}>{n}</li>
                    ),
                  )}
                </ul>
              </div>

              {/* Dim 3: Blockers and Dependencies */}
              <div className="dimension-card">
                <div className="dim-head">
                  <span>Blockers &amp; Dependencies (25%)</span>
                  <b>{projectHealth.dimensionScores?.blockersAndDependencies?.score ?? 0}%</b>
                </div>
                <div className="progress-track">
                  <i
                    style={{
                      width: `${projectHealth.dimensionScores?.blockersAndDependencies?.score ?? 0}%`,
                      backgroundColor: getScoreColor(
                        projectHealth.dimensionScores?.blockersAndDependencies?.score,
                        "AT_RISK",
                      ),
                    }}
                  />
                </div>
                <ul className="dim-notes">
                  {projectHealth.dimensionScores?.blockersAndDependencies?.notes?.map(
                    (n: string, i: number) => (
                      <li key={i}>{n}</li>
                    ),
                  )}
                </ul>
              </div>

              {/* Dim 4: Milestone Performance */}
              <div className="dimension-card">
                <div className="dim-head">
                  <span>Milestone Performance (15%)</span>
                  <b>{projectHealth.dimensionScores?.milestonePerformance?.score ?? 0}%</b>
                </div>
                <div className="progress-track">
                  <i
                    style={{
                      width: `${projectHealth.dimensionScores?.milestonePerformance?.score ?? 0}%`,
                      backgroundColor: getScoreColor(
                        projectHealth.dimensionScores?.milestonePerformance?.score,
                        "AT_RISK",
                      ),
                    }}
                  />
                </div>
                <ul className="dim-notes">
                  {projectHealth.dimensionScores?.milestonePerformance?.notes?.map(
                    (n: string, i: number) => (
                      <li key={i}>{n}</li>
                    ),
                  )}
                </ul>
              </div>

              {/* Dim 5: Recent Activity & Momentum */}
              <div className="dimension-card">
                <div className="dim-head">
                  <span>Recent Momentum &amp; Activity (10%)</span>
                  <b>{projectHealth.dimensionScores?.recentActivity?.score ?? 0}%</b>
                </div>
                <div className="progress-track">
                  <i
                    style={{
                      width: `${projectHealth.dimensionScores?.recentActivity?.score ?? 0}%`,
                      backgroundColor: getScoreColor(
                        projectHealth.dimensionScores?.recentActivity?.score,
                        "AT_RISK",
                      ),
                    }}
                  />
                </div>
                <ul className="dim-notes">
                  {projectHealth.dimensionScores?.recentActivity?.notes?.map((n: string, i: number) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {/* Explainable Delay Forecasting */}
          {projectHealth.forecast && (
            <div className="panel forecast-panel">
              <div className="panel-head">
                <div>
                  <div className="eyebrow">EXPLAINABLE FORECAST</div>
                  <h2>Project Delay Forecast</h2>
                </div>
                <span
                  className={`forecast-trend-tag trend-${projectHealth.forecast.trend.toLowerCase()}`}
                >
                  {projectHealth.forecast.trend.replace(/_/g, " ")}
                </span>
              </div>

              <div className="forecast-stats">
                <div className="forecast-stat">
                  <span>Projected Completion</span>
                  <b>{projectHealth.forecast.estimatedCompletionDate || "Indeterminate"}</b>
                </div>
                <div className="forecast-stat">
                  <span>Estimated Variance</span>
                  <b>
                    {projectHealth.forecast.daysProjectedVariance !== null
                      ? projectHealth.forecast.daysProjectedVariance > 0
                        ? `+${projectHealth.forecast.daysProjectedVariance} days late`
                        : `${Math.abs(projectHealth.forecast.daysProjectedVariance)} days early`
                      : "No deadline"}
                  </b>
                </div>
                <div className="forecast-stat">
                  <span>Completion Velocity</span>
                  <b>{projectHealth.forecast.completionVelocityWeekly} tasks/week</b>
                </div>
                <div className="forecast-stat">
                  <span>Forecast Confidence</span>
                  <b>{projectHealth.forecast.confidence}</b>
                </div>
              </div>

              <div className="forecast-reasons">
                <b>Forecast Explanation &amp; Contributing Factors:</b>
                <ul>
                  {projectHealth.forecast.reasons?.map((r: string, idx: number) => (
                    <li key={idx}>{r}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Historical Health Trend History */}
          {history.length > 0 && (
            <div className="panel history-panel">
              <div className="panel-head">
                <div>
                  <div className="eyebrow">TRENDS OVER TIME</div>
                  <h2>Historical Health Snapshots</h2>
                </div>
                <small className="muted-copy">{history.length} snapshot(s) retained</small>
              </div>

              <div className="history-sparkline-row">
                {history.map((h, i) => (
                  <div
                    key={h.id || i}
                    className="history-point-col"
                    title={`${new Date(h.createdAt).toLocaleDateString()}: Score ${h.score ?? "—"} (${h.classification})`}
                  >
                    <div
                      className="history-bar"
                      style={{
                        height: `${Math.max(12, (h.score ?? 10) * 0.8)}px`,
                        backgroundColor: getScoreColor(h.score, h.classification),
                      }}
                    />
                    <small>{new Date(h.createdAt).getDate()}</small>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Detected Risks & Recommendations Dashboard */}
          <div className="panel risks-panel">
            <div className="panel-head">
              <div>
                <div className="eyebrow">RISK DETECTION ENGINE</div>
                <h2>Detected Risks &amp; Recommendations ({filteredRisks.length})</h2>
              </div>

              <div className="risk-filters">
                <select
                  aria-label="Filter by status"
                  value={riskStatusFilter}
                  onChange={e => setRiskStatusFilter(e.target.value)}
                >
                  <option value="ACTIVE">Active risks</option>
                  <option value="DISMISSED">Dismissed</option>
                  <option value="RESOLVED">Resolved</option>
                  <option value="ALL">All statuses</option>
                </select>

                <select
                  aria-label="Filter by severity"
                  value={riskSeverityFilter}
                  onChange={e => setRiskSeverityFilter(e.target.value)}
                >
                  <option value="ALL">All severities</option>
                  <option value="CRITICAL">Critical</option>
                  <option value="HIGH">High</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="LOW">Low</option>
                </select>
              </div>
            </div>

            {filteredRisks.length === 0 ? (
              <div className="empty-inline" style={{ padding: "30px 10px" }}>
                <CheckCircle2 size={24} style={{ color: "#10b981", marginBottom: "8px" }} />
                <h3>No risks match the selected filter criteria</h3>
                <p>All monitored risk indicators are within safe thresholds.</p>
              </div>
            ) : (
              <div className="risk-cards-list">
                {filteredRisks.map(risk => (
                  <div
                    key={risk.id}
                    className={`risk-item-card severity-${risk.severity.toLowerCase()}`}
                  >
                    <div className="risk-card-top">
                      <span className={`risk-severity-badge sev-${risk.severity.toLowerCase()}`}>
                        {risk.severity}
                      </span>
                      <span className="risk-type-tag">{risk.riskType.replace(/_/g, " ")}</span>
                      {risk.status === "DISMISSED" && (
                        <span className="risk-dismissed-badge">
                          Dismissed by {risk.dismissedBy?.name || "Manager"}: {risk.dismissReason}
                        </span>
                      )}
                    </div>

                    <h4 className="risk-title">{risk.title}</h4>
                    <p className="risk-explanation">{risk.explanation}</p>

                    <div className="risk-recommendation-box">
                      <div className="rec-header">
                        <Zap size={13} style={{ color: "#f59e0b" }} />
                        <b>Recommended Action:</b>
                      </div>
                      <p>{risk.recommendedAction}</p>
                    </div>

                    {risk.evidence?.sourceReferences?.length > 0 && (
                      <div className="risk-sources">
                        <small>Evidence References:</small>
                        <div className="source-chips">
                          {risk.evidence.sourceReferences.slice(0, 4).map((s: any, idx: number) => (
                            <span key={idx} className="source-chip">
                              {s.title}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="risk-card-actions">
                      {canManage && risk.status === "ACTIVE" && (
                        <>
                          <button
                            className="button button-quiet"
                            onClick={() => {
                              setDismissModalRisk(risk);
                              setDismissReason("");
                            }}
                          >
                            Dismiss risk
                          </button>
                          <button
                            className="button button-secondary"
                            onClick={() => handleProposeAction(risk.id)}
                          >
                            <Sparkles size={13} /> Propose AI Action Plan
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* DISMISS RISK MODAL */}
      {dismissModalRisk && (
        <div
          className="modal-backdrop"
          onMouseDown={e => {
            if (e.target === e.currentTarget && !dismissBusy) setDismissModalRisk(null);
          }}
        >
          <div className="modal-card">
            <div className="modal-head">
              <div>
                <div className="eyebrow">RISK MANAGEMENT</div>
                <h2>Dismiss Detected Risk</h2>
              </div>
              <button
                className="icon-button"
                onClick={() => setDismissModalRisk(null)}
                aria-label="Close dialog"
              >
                <X size={16} />
              </button>
            </div>

            <form
              className="modal-form"
              onSubmit={e => {
                e.preventDefault();
                void submitDismissRisk();
              }}
            >
              <p className="modal-copy">
                Dismissing a risk marks it as acknowledged and accepted. It will not reappear on
                subsequent calculations unless the underlying condition materially worsens.
              </p>

              <div className="dismiss-risk-preview">
                <b>{dismissModalRisk.title}</b>
                <small>{dismissModalRisk.explanation}</small>
              </div>

              <label>
                Reason for dismissal <span className="field-hint">Required for audit trail</span>
                <textarea
                  required
                  rows={3}
                  minLength={3}
                  maxLength={500}
                  value={dismissReason}
                  onChange={e => setDismissReason(e.target.value)}
                  placeholder="e.g. Schedule extension verbally approved by stakeholders; dependency being handled in parallel branch..."
                />
              </label>

              <div className="modal-actions">
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={dismissBusy}
                  onClick={() => setDismissModalRisk(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button button-primary"
                  disabled={dismissBusy || dismissReason.trim().length < 3}
                >
                  {dismissBusy ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}
                  Confirm Dismissal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
