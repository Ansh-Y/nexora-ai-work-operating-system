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

function HealthTrendHistoryChart({ history }: { history: any[] }) {
  if (!history || history.length === 0) {
    return (
      <div className="health-history-empty">
        <Activity size={24} style={{ color: "var(--muted)", margin: "0 auto 8px", display: "block" }} />
        <b style={{ display: "block", marginBottom: "4px" }}>No historical snapshots yet</b>
        <p className="muted-copy">Recalculate project health periodically to track health score velocity over time.</p>
      </div>
    );
  }

  if (history.length === 1) {
    const single = history[0];
    const score = single.score;
    const scoreColor = (score ?? 0) >= 70 ? "#48C9B0" : (score ?? 0) >= 40 ? "#D5A65A" : "#E66D70";

    return (
      <div className="health-history-single">
        <div className="single-snapshot-badge" style={{ borderColor: scoreColor }}>
          <span className="single-score" style={{ color: scoreColor }}>{score !== null ? score : "—"}</span>
          <span className="single-max">/ 100</span>
        </div>
        <div className="single-snapshot-info">
          <b>Initial Baseline Snapshot Recorded</b>
          <p>
            Captured on {new Date(single.createdAt).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}
            {" · "}Classification: <strong>{single.classification.replace("_", " ")}</strong>
          </p>
          <small className="muted-copy">
            A minimum of 2 snapshots are required to plot trend trajectories. Additional snapshots will render as a continuous timeline automatically.
          </small>
        </div>
      </div>
    );
  }

  const sorted = [...history].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const svgWidth = 660;
  const svgHeight = 210;
  const paddingLeft = 45;
  const paddingRight = 30;
  const paddingTop = 25;
  const paddingBottom = 35;
  const plotWidth = svgWidth - paddingLeft - paddingRight;
  const plotHeight = svgHeight - paddingTop - paddingBottom;

  const getY = (score: number | null) => {
    const s = Math.max(0, Math.min(100, score ?? 0));
    return paddingTop + plotHeight - (s / 100) * plotHeight;
  };

  const getX = (index: number) => {
    return paddingLeft + (index / (sorted.length - 1)) * plotWidth;
  };

  const points = sorted.map((h, i) => ({
    x: getX(i),
    y: getY(h.score),
    score: h.score,
    classification: h.classification,
    date: new Date(h.createdAt).toLocaleDateString([], { month: "short", day: "numeric" }),
    fullDate: new Date(h.createdAt).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }),
    color: (h.score ?? 0) >= 70 ? "#48C9B0" : (h.score ?? 0) >= 40 ? "#D5A65A" : "#E66D70",
  }));

  const pathD = points.reduce((acc, p, i) => {
    return `${acc} ${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  }, "");

  const areaD = `${pathD} L ${points[points.length - 1].x.toFixed(1)} ${(paddingTop + plotHeight).toFixed(1)} L ${points[0].x.toFixed(1)} ${(paddingTop + plotHeight).toFixed(1)} Z`;

  return (
    <div className="health-chart-wrapper">
      <div className="health-chart-legend">
        <span className="legend-item"><span className="legend-dot healthy" /> Healthy (≥ 70)</span>
        <span className="legend-item"><span className="legend-dot at-risk" /> At Risk (40–69)</span>
        <span className="legend-item"><span className="legend-dot critical" /> Critical (&lt; 40)</span>
      </div>

      <div className="health-chart-svg-container">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="health-trend-svg"
          preserveAspectRatio="xMidYMid meet"
          aria-label="Historical health score trend"
        >
          <defs>
            <linearGradient id="healthTrendGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#48C9B0" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#48C9B0" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Range threshold background bands */}
          {/* Healthy zone: 70 - 100 */}
          <rect
            x={paddingLeft}
            y={getY(100)}
            width={plotWidth}
            height={getY(70) - getY(100)}
            fill="#48C9B0"
            fillOpacity="0.05"
          />
          {/* At Risk zone: 40 - 70 */}
          <rect
            x={paddingLeft}
            y={getY(70)}
            width={plotWidth}
            height={getY(40) - getY(70)}
            fill="#D5A65A"
            fillOpacity="0.05"
          />
          {/* Critical zone: 0 - 40 */}
          <rect
            x={paddingLeft}
            y={getY(40)}
            width={plotWidth}
            height={getY(0) - getY(40)}
            fill="#E66D70"
            fillOpacity="0.05"
          />

          {/* Grid lines and Y-axis scale markings */}
          {[100, 70, 40, 0].map(val => {
            const y = getY(val);
            return (
              <g key={val} className="chart-grid-line">
                <line
                  x1={paddingLeft}
                  y1={y}
                  x2={svgWidth - paddingRight}
                  y2={y}
                  stroke="var(--line)"
                  strokeDasharray={val === 70 || val === 40 ? "4 4" : "none"}
                  strokeOpacity="0.7"
                />
                <text
                  x={paddingLeft - 8}
                  y={y + 4}
                  textAnchor="end"
                  fontSize="10"
                  fill="var(--muted)"
                  fontFamily="inherit"
                >
                  {val}
                </text>
              </g>
            );
          })}

          {/* Area fill */}
          <path d={areaD} fill="url(#healthTrendGrad)" />

          {/* Trend line */}
          <path
            d={pathD}
            fill="none"
            stroke="var(--primary)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Data Points */}
          {points.map((p, idx) => (
            <g key={idx} className="chart-point-group">
              <title>{`${p.fullDate}: Score ${p.score ?? "—"} (${p.classification.replace("_", " ")})`}</title>
              
              {/* Outer halo */}
              <circle cx={p.x} cy={p.y} r="5.5" fill="var(--panel)" stroke={p.color} strokeWidth="2.5" />
              {/* Center pip */}
              <circle cx={p.x} cy={p.y} r="2" fill={p.color} />

              {/* Score text directly above the point */}
              <text
                x={p.x}
                y={p.y - 10}
                textAnchor="middle"
                fontSize="11"
                fontWeight="700"
                fill={p.color}
                fontFamily="inherit"
              >
                {p.score ?? "—"}
              </text>

              {/* Date label directly below on X-axis */}
              <text
                x={p.x}
                y={paddingTop + plotHeight + 18}
                textAnchor="middle"
                fontSize="10"
                fill="var(--muted)"
                fontFamily="inherit"
              >
                {p.date}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
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
    if (initialProjectId) {
      setSelectedProjectId(initialProjectId);
    }
  }, [initialProjectId]);

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
      const health: any = await api.get(`/health/projects/${projectId}`);
      const [hist, risksData]: any = await Promise.all([
        api.get(`/health/projects/${projectId}/history?limit=30`),
        api.get(`/health/projects/${projectId}/risks?status=ALL`),
      ]);
      setProjectHealth(health);
      setHistory(hist.history ?? []);
      setRisks(risksData.risks?.length ? risksData.risks : (health.risks ?? []));
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
    if (classification === "INSUFFICIENT_DATA") return "#748984";
    if (classification === "EXCLUDED") return "#748984";
    if (score === null) return "#748984";
    if (score >= 80) return "#48B58D";
    if (score >= 50) return "#D5A65A";
    return "#E66D70";
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

        <div className="health-top-actions">
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
              <span className="health-stat-label" style={{ color: "var(--success)" }}>
                <CheckCircle2 size={13} /> Healthy (80–100)
              </span>
              <b className="health-stat-value" style={{ color: "var(--success)" }}>
                {overview.metrics.healthyCount}
              </b>
              <small className="health-stat-sub">On-track deliverables</small>
            </div>
            <div className="health-stat-card at-risk-border">
              <span className="health-stat-label" style={{ color: "var(--warning)" }}>
                <AlertTriangle size={13} /> At Risk (50–79)
              </span>
              <b className="health-stat-value" style={{ color: "var(--warning)" }}>
                {overview.metrics.atRiskCount}
              </b>
              <small className="health-stat-sub">Require monitoring</small>
            </div>
            <div className="health-stat-card critical-border">
              <span className="health-stat-label" style={{ color: "var(--danger)" }}>
                <AlertOctagon size={13} /> Critical (0–49)
              </span>
              <b className="health-stat-value" style={{ color: "var(--danger)" }}>
                {overview.metrics.criticalCount}
              </b>
              <small className="health-stat-sub">Immediate action needed</small>
            </div>
            <div className="health-stat-card">
              <span className="health-stat-label" style={{ color: "var(--danger)" }}>
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
                  <div className="eyebrow" style={{ color: "var(--warning)" }}>
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
                  <div className="eyebrow" style={{ color: "var(--accent)" }}>
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
          <div className="panel history-panel">
            <div className="panel-head">
              <div>
                <div className="eyebrow">TRENDS OVER TIME</div>
                <h2>Historical Health Snapshots</h2>
              </div>
              <small className="muted-copy">{history.length} snapshot(s) retained</small>
            </div>

            <HealthTrendHistoryChart history={history} />
          </div>

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
                <CheckCircle2 size={24} style={{ color: "var(--success)", marginBottom: "8px" }} />
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
                        <Zap size={13} style={{ color: "var(--warning)" }} />
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
