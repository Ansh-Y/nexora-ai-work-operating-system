"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  Eye,
  FileDown,
  FileText,
  Filter,
  Layers,
  LoaderCircle,
  Plus,
  RefreshCw,
  Shield,
  ShieldAlert,
  Sparkles,
  Tag,
  Trash2,
  TrendingUp,
  User,
  Users,
  X,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";

export interface CalculatedReportMetrics {
  totalTasks: number;
  completedTasks: number;
  completedThisPeriod: number;
  createdThisPeriod: number;
  pendingTasks: number;
  overdueTasks: number;
  blockedTasks: number;
  completionRate: number;
  healthScore: number;
  healthClassification: string;
  milestonesTotal: number;
  milestonesCompleted: number;
  milestonesApproaching: number;
}

export interface MemberWorkloadSummary {
  memberId: string;
  name: string;
  email: string;
  role: string;
  assignedCount: number;
  activeCount: number;
  completedThisPeriod: number;
  overdueCount: number;
}

export interface WeeklyReportActionRecommendation {
  id: string;
  title: string;
  category: "DELIVERY" | "RISK" | "CAPACITY" | "ALIGNMENT";
  rationale: string;
  priority: "URGENT" | "HIGH" | "MEDIUM";
  targetTaskId?: string;
  targetMilestoneId?: string;
}

export interface WeeklyReportItem {
  id: string;
  projectId: string;
  creatorId: string;
  title: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  executiveSummary: string;
  metrics: CalculatedReportMetrics;
  progressOverview: {
    completedTasks: Array<{ id: string; title: string; completedAt: string }>;
    createdTasks: Array<{ id: string; title: string; priority: string }>;
    upcomingMilestones: Array<{ id: string; title: string; targetDate: string }>;
  };
  blockersAndRisks: {
    blockedTasks: Array<{ id: string; title: string; blockedByTitles: string[] }>;
    overdueTasks: Array<{ id: string; title: string; priority: string; dueDate: string }>;
    projectRisks: Array<{ id: string; title: string; severity: string; action: string }>;
  };
  teamWorkload: {
    members: MemberWorkloadSummary[];
    unassignedHighPriorityCount: number;
  };
  meetingInsights: {
    totalMeetings: number;
    decisionsCount: number;
    decisions: Array<{ meetingTitle: string; title: string }>;
    openActionItemsCount: number;
  };
  recommendations: WeeklyReportActionRecommendation[];
  pdfStorageKey?: string | null;
  createdAt: string;
  project: { id: string; name: string; description?: string | null };
  creator: { id: string; name: string; email: string };
}

interface Props {
  projects: Array<{ id: string; name: string }>;
  notify: (type: "success" | "error" | "info", message: string) => void;
  onOpenProject?: (projectId: string) => void;
}

export default function ReportsWorkspace({ projects, notify, onOpenProject }: Props) {
  const [reports, setReports] = useState<WeeklyReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterProjectId, setFilterProjectId] = useState<string>("ALL");
  const [selectedReport, setSelectedReport] = useState<WeeklyReportItem | null>(null);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Form State
  const [genProjectId, setGenProjectId] = useState<string>("");
  const [periodPreset, setPeriodPreset] = useState<"7_DAYS" | "14_DAYS" | "CUSTOM">("7_DAYS");
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");
  const [customInstructions, setCustomInstructions] = useState<string>("");

  useEffect(() => {
    if (projects.length > 0 && !genProjectId) {
      setGenProjectId(projects[0].id);
    }
  }, [projects, genProjectId]);

  const loadReports = useCallback(async () => {
    setLoading(true);
    try {
      const url = filterProjectId && filterProjectId !== "ALL"
        ? `/ai/reports?projectId=${encodeURIComponent(filterProjectId)}`
        : "/ai/reports";
      const data = await api.get(url);
      setReports(Array.isArray(data) ? data : []);
    } catch (err: any) {
      notify("error", err?.message || "Failed to load weekly reports");
    } finally {
      setLoading(false);
    }
  }, [filterProjectId, notify]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  // Handle PDF Export
  const handleDownloadPdf = async (report: WeeklyReportItem, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setDownloadingId(report.id);
    try {
      const blob = await api.download(`/ai/reports/${report.id}/pdf`);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const sanitized = report.project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const dateStr = report.periodEnd.split("T")[0];
      a.download = `nexora-report-${sanitized}-${dateStr}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      notify("success", "Weekly report PDF downloaded successfully");
    } catch (err: any) {
      notify("error", err?.message || "Failed to download PDF report");
    } finally {
      setDownloadingId(null);
    }
  };

  // Handle Delete
  const handleDeleteReport = async (reportId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this weekly report?")) return;
    setDeletingId(reportId);
    try {
      await api.delete(`/ai/reports/${reportId}`);
      notify("success", "Weekly report deleted");
      if (selectedReport?.id === reportId) {
        setSelectedReport(null);
      }
      loadReports();
    } catch (err: any) {
      notify("error", err?.message || "Failed to delete weekly report");
    } finally {
      setDeletingId(null);
    }
  };

  // Handle Generate Report
  const handleGenerateReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!genProjectId) {
      notify("error", "Please select a target project");
      return;
    }

    setGenerating(true);
    try {
      const now = new Date();
      let startIso: string | undefined = undefined;
      let endIso: string | undefined = undefined;

      if (periodPreset === "7_DAYS") {
        const start = new Date(now.getTime() - 7 * 86400000);
        startIso = start.toISOString();
        endIso = now.toISOString();
      } else if (periodPreset === "14_DAYS") {
        const start = new Date(now.getTime() - 14 * 86400000);
        startIso = start.toISOString();
        endIso = now.toISOString();
      } else if (periodPreset === "CUSTOM") {
        if (!customStart || !customEnd) {
          notify("error", "Please specify both start and end dates for custom period");
          setGenerating(false);
          return;
        }
        startIso = new Date(customStart).toISOString();
        endIso = new Date(customEnd).toISOString();
      }

      const res = await api.post("/ai/reports/generate", {
        projectId: genProjectId,
        periodStart: startIso,
        periodEnd: endIso,
        customInstructions: customInstructions.trim() || undefined,
      });

      notify("success", "Weekly report generated successfully");
      setShowGenerateModal(false);
      setCustomInstructions("");
      setSelectedReport(res);
      loadReports();
    } catch (err: any) {
      notify("error", err?.message || "Failed to generate weekly report");
    } finally {
      setGenerating(false);
    }
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return iso;
    }
  };

  const getHealthBadgeClass = (classification?: string) => {
    const c = (classification || "").toUpperCase();
    if (c.includes("EXCELLENT") || c.includes("ON_TRACK") || c.includes("HEALTHY")) {
      return "badge-jade";
    }
    if (c.includes("AT_RISK") || c.includes("MEDIUM") || c.includes("WARNING")) {
      return "badge-amber";
    }
    return "badge-crimson";
  };

  return (
    <div className="reports-workspace" data-testid="reports-workspace">
      {/* ---------------- TOP BANNER & ACTIONS ---------------- */}
      <div className="reports-header-card">
        <div className="reports-header-left">
          <div className="reports-eyebrow">
            <span className="spark-dot">
              <Sparkles size={11} />
            </span>
            NEXORA WORK INTELLIGENCE
          </div>
          <h1 className="reports-title">AI Weekly Project Reports</h1>
          <p className="reports-subtitle">
            Synthesize verified project activities, deterministic health metrics, team workload, and
            actionable recommendations into professional weekly briefs and downloadable PDF documents.
          </p>
        </div>

        <div className="reports-header-actions">
          <button
            type="button"
            className="btn-primary reports-generate-btn"
            onClick={() => setShowGenerateModal(true)}
          >
            <Sparkles size={16} />
            <span>Generate Weekly Report</span>
          </button>
        </div>
      </div>

      {/* ---------------- FILTER & CONTROLS TOOLBAR ---------------- */}
      <div className="reports-toolbar">
        <div className="reports-filter-group">
          <Filter size={15} className="reports-filter-icon" />
          <span className="reports-filter-label">Filter Project:</span>
          <select
            className="reports-project-select"
            value={filterProjectId}
            onChange={(e) => setFilterProjectId(e.target.value)}
          >
            <option value="ALL">All Projects ({projects.length})</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="reports-stats-strip">
          <div className="reports-stat-chip">
            <Layers size={13} />
            <span>{reports.length} Total Reports</span>
          </div>
          <button
            type="button"
            className="reports-refresh-btn"
            title="Refresh reports"
            onClick={() => loadReports()}
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? "spin-icon" : ""} />
          </button>
        </div>
      </div>

      {/* ---------------- REPORTS LIST / GRID ---------------- */}
      {loading ? (
        <div className="reports-loading-box">
          <LoaderCircle size={28} className="spin-icon" />
          <p>Analyzing project telemetry and compiling reports...</p>
        </div>
      ) : reports.length === 0 ? (
        <div className="reports-empty-box" data-testid="reports-empty-state">
          <FileText size={48} className="reports-empty-icon" />
          <h3>No Weekly Reports Found</h3>
          <p>
            {filterProjectId !== "ALL"
              ? "No weekly reports generated for this selected project yet."
              : "Generate an intelligent weekly report to analyze milestones, blockers, workload distribution, and executive summaries."}
          </p>
          <button
            type="button"
            className="btn-primary"
            onClick={() => setShowGenerateModal(true)}
          >
            <Sparkles size={16} />
            <span>Generate First Report</span>
          </button>
        </div>
      ) : (
        <div className="reports-grid" data-testid="reports-grid">
          {reports.map((report) => {
            const metrics = report.metrics || {};
            const healthClass = metrics.healthClassification || "UNKNOWN";
            return (
              <div
                key={report.id}
                className={`report-card ${selectedReport?.id === report.id ? "selected" : ""}`}
                data-testid={`report-card-${report.id}`}
                onClick={() => setSelectedReport(report)}
              >
                <div className="report-card-header">
                  <div className="report-card-project">
                    <span className="project-tag">{report.project.name}</span>
                    <span className={`health-pill ${getHealthBadgeClass(healthClass)}`}>
                      <Shield size={11} />
                      {metrics.healthScore ?? 0}/100 {healthClass.replace(/_/g, " ")}
                    </span>
                  </div>
                  <span className="report-created-at">
                    {formatDate(report.createdAt)}
                  </span>
                </div>

                <h3 className="report-card-title">{report.title}</h3>

                <div className="report-period-pill">
                  <Calendar size={12} />
                  <span>
                    {formatDate(report.periodStart)} – {formatDate(report.periodEnd)}
                  </span>
                </div>

                <p className="report-card-summary">
                  {report.executiveSummary.slice(0, 180)}...
                </p>

                {/* KPI Metrics Mini Bar */}
                <div className="report-kpi-bar">
                  <div className="kpi-mini-stat">
                    <span className="kpi-mini-val">{metrics.totalTasks ?? 0}</span>
                    <span className="kpi-mini-lbl">Total Tasks</span>
                  </div>
                  <div className="kpi-mini-stat text-jade">
                    <span className="kpi-mini-val">{metrics.completedThisPeriod ?? 0}</span>
                    <span className="kpi-mini-lbl">Completed</span>
                  </div>
                  <div className="kpi-mini-stat text-amber">
                    <span className="kpi-mini-val">{metrics.blockedTasks ?? 0}</span>
                    <span className="kpi-mini-lbl">Blocked</span>
                  </div>
                  <div className="kpi-mini-stat">
                    <span className="kpi-mini-val">{metrics.completionRate ?? 0}%</span>
                    <span className="kpi-mini-lbl">Rate</span>
                  </div>
                </div>

                {/* Card Actions */}
                <div className="report-card-actions">
                  <button
                    type="button"
                    className="btn-secondary report-view-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedReport(report);
                    }}
                  >
                    <Eye size={14} />
                    <span>View Report</span>
                  </button>

                  <button
                    type="button"
                    className="btn-ghost report-pdf-btn"
                    title="Download PDF"
                    disabled={downloadingId === report.id}
                    onClick={(e) => handleDownloadPdf(report, e)}
                  >
                    {downloadingId === report.id ? (
                      <LoaderCircle size={14} className="spin-icon" />
                    ) : (
                      <Download size={14} />
                    )}
                    <span>PDF</span>
                  </button>

                  <button
                    type="button"
                    className="btn-ghost report-delete-btn"
                    title="Delete Report"
                    disabled={deletingId === report.id}
                    onClick={(e) => handleDeleteReport(report.id, e)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ---------------- DETAILED REPORT MODAL ---------------- */}
      {selectedReport && (
        <div
          className="modal-overlay report-detail-overlay"
          onClick={() => setSelectedReport(null)}
          data-testid="report-detail-modal"
        >
          <div
            className="modal-container report-detail-modal"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="report-detail-header">
              <div className="report-detail-title-group">
                <div className="report-modal-eyebrow">
                  <span className="project-tag">{selectedReport.project.name}</span>
                  <span
                    className={`health-pill ${getHealthBadgeClass(
                      selectedReport.metrics.healthClassification
                    )}`}
                  >
                    Health: {selectedReport.metrics.healthScore}/100{" "}
                    {selectedReport.metrics.healthClassification.replace(/_/g, " ")}
                  </span>
                </div>
                <h2>{selectedReport.title}</h2>
                <div className="report-detail-meta">
                  <span>
                    Period: {formatDate(selectedReport.periodStart)} –{" "}
                    {formatDate(selectedReport.periodEnd)}
                  </span>
                  <span>•</span>
                  <span>Generated by {selectedReport.creator?.name || "System"}</span>
                  <span>•</span>
                  <span>{formatDate(selectedReport.createdAt)}</span>
                </div>
              </div>

              <div className="report-detail-header-actions">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={downloadingId === selectedReport.id}
                  onClick={() => handleDownloadPdf(selectedReport)}
                >
                  {downloadingId === selectedReport.id ? (
                    <LoaderCircle size={15} className="spin-icon" />
                  ) : (
                    <Download size={15} />
                  )}
                  <span>Download PDF</span>
                </button>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setSelectedReport(null)}
                  title="Close Report"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Modal Content Scroll Area */}
            <div className="report-detail-body">
              {/* SECTION 1: EXECUTIVE SUMMARY */}
              <div className="report-section">
                <div className="report-section-header">
                  <FileText size={17} className="text-jade" />
                  <h3>1. Executive Summary</h3>
                </div>
                <div className="report-executive-box" data-testid="report-executive-summary">
                  <p>{selectedReport.executiveSummary}</p>
                </div>
              </div>

              {/* SECTION 2: KEY PERFORMANCE METRICS */}
              <div className="report-section">
                <div className="report-section-header">
                  <BarChart3 size={17} className="text-jade" />
                  <h3>2. Key Performance Indicators</h3>
                </div>
                <div className="report-metrics-grid">
                  <div className="report-metric-card">
                    <span className="metric-val">{selectedReport.metrics.totalTasks}</span>
                    <span className="metric-lbl">Total Project Tasks</span>
                  </div>
                  <div className="report-metric-card border-jade">
                    <span className="metric-val text-jade">
                      {selectedReport.metrics.completedThisPeriod}
                    </span>
                    <span className="metric-lbl">Completed This Period</span>
                  </div>
                  <div className="report-metric-card">
                    <span className="metric-val">{selectedReport.metrics.pendingTasks}</span>
                    <span className="metric-lbl">Pending Tasks</span>
                  </div>
                  <div className="report-metric-card border-crimson">
                    <span
                      className={`metric-val ${
                        selectedReport.metrics.overdueTasks > 0 ? "text-crimson" : ""
                      }`}
                    >
                      {selectedReport.metrics.overdueTasks}
                    </span>
                    <span className="metric-lbl">Overdue Tasks</span>
                  </div>
                  <div className="report-metric-card border-amber">
                    <span
                      className={`metric-val ${
                        selectedReport.metrics.blockedTasks > 0 ? "text-amber" : ""
                      }`}
                    >
                      {selectedReport.metrics.blockedTasks}
                    </span>
                    <span className="metric-lbl">Blocked Tasks</span>
                  </div>
                  <div className="report-metric-card border-jade">
                    <span className="metric-val text-jade">
                      {selectedReport.metrics.completionRate}%
                    </span>
                    <span className="metric-lbl">Completion Rate</span>
                  </div>
                </div>
              </div>

              {/* SECTION 3: PROGRESS & MILESTONES */}
              <div className="report-section">
                <div className="report-section-header">
                  <TrendingUp size={17} className="text-jade" />
                  <h3>3. Progress & Milestone Highlights</h3>
                </div>
                <div className="report-two-col">
                  <div className="report-sub-card">
                    <h4>Tasks Completed During Period ({selectedReport.progressOverview.completedTasks.length})</h4>
                    {selectedReport.progressOverview.completedTasks.length === 0 ? (
                      <p className="report-dim-text">No tasks completed during this period.</p>
                    ) : (
                      <ul className="report-item-list">
                        {selectedReport.progressOverview.completedTasks.map((t) => (
                          <li key={t.id} className="report-list-item">
                            <CheckCircle2 size={14} className="text-jade" />
                            <span className="item-title">{t.title}</span>
                            <span className="item-meta">{formatDate(t.completedAt)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="report-sub-card">
                    <h4>Upcoming Milestones ({selectedReport.progressOverview.upcomingMilestones.length})</h4>
                    {selectedReport.progressOverview.upcomingMilestones.length === 0 ? (
                      <p className="report-dim-text">No pending milestones scheduled.</p>
                    ) : (
                      <ul className="report-item-list">
                        {selectedReport.progressOverview.upcomingMilestones.map((m) => (
                          <li key={m.id} className="report-list-item">
                            <Layers size={14} className="text-jade" />
                            <span className="item-title">{m.title}</span>
                            <span className="item-meta">{formatDate(m.targetDate)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>

              {/* SECTION 4: BLOCKERS & PROJECT RISKS */}
              <div className="report-section">
                <div className="report-section-header">
                  <ShieldAlert size={17} className="text-crimson" />
                  <h3>4. Blockers & Identified Risks</h3>
                </div>

                {selectedReport.blockersAndRisks.blockedTasks.length === 0 &&
                selectedReport.blockersAndRisks.overdueTasks.length === 0 &&
                selectedReport.blockersAndRisks.projectRisks.length === 0 ? (
                  <div className="report-clean-status">
                    <CheckCircle2 size={16} className="text-jade" />
                    <span>Zero active blockers, overdue items, or unresolved risk alerts detected.</span>
                  </div>
                ) : (
                  <div className="report-risks-container">
                    {selectedReport.blockersAndRisks.blockedTasks.length > 0 && (
                      <div className="risk-block">
                        <h4 className="text-crimson">
                          Blocked Tasks ({selectedReport.blockersAndRisks.blockedTasks.length})
                        </h4>
                        <ul className="report-item-list">
                          {selectedReport.blockersAndRisks.blockedTasks.map((b) => (
                            <li key={b.id} className="report-risk-item">
                              <AlertCircle size={14} className="text-crimson" />
                              <div className="risk-content">
                                <span className="risk-title">{b.title}</span>
                                <span className="risk-desc">
                                  Waiting on: {b.blockedByTitles.join(", ") || "Unassigned dependencies"}
                                </span>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {selectedReport.blockersAndRisks.overdueTasks.length > 0 && (
                      <div className="risk-block">
                        <h4 className="text-amber">
                          Overdue Tasks ({selectedReport.blockersAndRisks.overdueTasks.length})
                        </h4>
                        <ul className="report-item-list">
                          {selectedReport.blockersAndRisks.overdueTasks.map((t) => (
                            <li key={t.id} className="report-risk-item">
                              <Clock size={14} className="text-amber" />
                              <div className="risk-content">
                                <span className="risk-title">{t.title}</span>
                                <span className="risk-desc">
                                  Priority: {t.priority} • Due: {formatDate(t.dueDate)}
                                </span>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {selectedReport.blockersAndRisks.projectRisks.length > 0 && (
                      <div className="risk-block">
                        <h4>Project Risk Alerts ({selectedReport.blockersAndRisks.projectRisks.length})</h4>
                        <ul className="report-item-list">
                          {selectedReport.blockersAndRisks.projectRisks.map((r) => (
                            <li key={r.id} className="report-risk-item">
                              <AlertTriangle size={14} className="text-amber" />
                              <div className="risk-content">
                                <span className="risk-title">[{r.severity}] {r.title}</span>
                                <span className="risk-desc">{r.action}</span>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* SECTION 5: TEAM WORKLOAD DISTRIBUTION */}
              <div className="report-section">
                <div className="report-section-header">
                  <Users size={17} className="text-jade" />
                  <h3>5. Team Workload & Capacity</h3>
                </div>

                {selectedReport.teamWorkload.members.length === 0 ? (
                  <p className="report-dim-text">No team members registered in project roster.</p>
                ) : (
                  <div className="report-table-wrapper">
                    <table className="report-workload-table">
                      <thead>
                        <tr>
                          <th>Team Member</th>
                          <th>Role</th>
                          <th>Active Tasks</th>
                          <th>Completed This Period</th>
                          <th>Overdue</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedReport.teamWorkload.members.map((m) => (
                          <tr key={m.memberId}>
                            <td>
                              <div className="member-cell">
                                <div className="member-avatar">
                                  <User size={13} />
                                </div>
                                <div>
                                  <span className="member-name">{m.name}</span>
                                  <span className="member-email">{m.email}</span>
                                </div>
                              </div>
                            </td>
                            <td>
                              <span className="role-tag">{m.role}</span>
                            </td>
                            <td className="metric-cell font-semibold">{m.activeCount}</td>
                            <td className="metric-cell text-jade font-semibold">
                              {m.completedThisPeriod}
                            </td>
                            <td
                              className={`metric-cell font-semibold ${
                                m.overdueCount > 0 ? "text-crimson" : ""
                              }`}
                            >
                              {m.overdueCount}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {selectedReport.teamWorkload.unassignedHighPriorityCount > 0 && (
                  <div className="report-unassigned-alert">
                    <AlertTriangle size={15} className="text-amber" />
                    <span>
                      Notice: {selectedReport.teamWorkload.unassignedHighPriorityCount} high or urgent
                      priority tasks currently remain unassigned.
                    </span>
                  </div>
                )}
              </div>

              {/* SECTION 6: MEETING INSIGHTS */}
              <div className="report-section">
                <div className="report-section-header">
                  <Calendar size={17} className="text-jade" />
                  <h3>6. Meeting Decisions & Action Items</h3>
                </div>
                <div className="report-meeting-stats">
                  <span>Total Meetings: {selectedReport.meetingInsights.totalMeetings}</span>
                  <span>•</span>
                  <span>Recorded Decisions: {selectedReport.meetingInsights.decisionsCount}</span>
                  <span>•</span>
                  <span>Open Action Items: {selectedReport.meetingInsights.openActionItemsCount}</span>
                </div>

                {selectedReport.meetingInsights.decisions.length > 0 && (
                  <div className="meeting-decisions-list">
                    <h4>Recorded Strategic Decisions:</h4>
                    <ul>
                      {selectedReport.meetingInsights.decisions.map((d, i) => (
                        <li key={i}>
                          <span className="decision-meeting">[{d.meetingTitle}]</span>{" "}
                          <span className="decision-text">{d.title}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* SECTION 7: AI RECOMMENDATIONS */}
              <div className="report-section">
                <div className="report-section-header">
                  <Sparkles size={17} className="text-jade" />
                  <h3>7. AI Strategic Recommendations for Next Week</h3>
                </div>

                {selectedReport.recommendations.length === 0 ? (
                  <p className="report-dim-text">
                    No critical recommendations generated. Workflow execution is performing within target parameters.
                  </p>
                ) : (
                  <div className="recommendations-stack">
                    {selectedReport.recommendations.map((rec) => {
                      const prioClass =
                        rec.priority === "URGENT"
                          ? "badge-crimson"
                          : rec.priority === "HIGH"
                          ? "badge-amber"
                          : "badge-jade";
                      return (
                        <div key={rec.id} className="rec-card">
                          <div className="rec-card-top">
                            <span className={`rec-priority-badge ${prioClass}`}>
                              {rec.priority}
                            </span>
                            <span className="rec-category-tag">{rec.category}</span>
                            <h4 className="rec-title">{rec.title}</h4>
                          </div>
                          <p className="rec-rationale">{rec.rationale}</p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="report-detail-footer">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setSelectedReport(null)}
              >
                Close View
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={downloadingId === selectedReport.id}
                onClick={() => handleDownloadPdf(selectedReport)}
              >
                <Download size={15} />
                <span>Download PDF Report</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- GENERATE REPORT MODAL ---------------- */}
      {showGenerateModal && (
        <div
          className="modal-overlay"
          onClick={() => !generating && setShowGenerateModal(false)}
          data-testid="generate-report-modal"
        >
          <div
            className="modal-container generate-report-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <div className="reports-eyebrow">
                  <span className="spark-dot">
                    <Sparkles size={11} />
                  </span>
                  INTELLIGENCE COMPILER
                </div>
                <h3>Generate AI Weekly Project Report</h3>
              </div>
              <button
                type="button"
                className="btn-close"
                disabled={generating}
                onClick={() => setShowGenerateModal(false)}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleGenerateReport}>
              <div className="modal-body-form">
                {/* Project Selector */}
                <div className="form-group">
                  <label className="form-label">Target Project *</label>
                  <select
                    className="form-input"
                    value={genProjectId}
                    onChange={(e) => setGenProjectId(e.target.value)}
                    required
                    disabled={generating}
                  >
                    <option value="" disabled>
                      Select a project...
                    </option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Reporting Period */}
                <div className="form-group">
                  <label className="form-label">Reporting Period</label>
                  <div className="period-presets-row">
                    <button
                      type="button"
                      className={`preset-btn ${periodPreset === "7_DAYS" ? "active" : ""}`}
                      onClick={() => setPeriodPreset("7_DAYS")}
                      disabled={generating}
                    >
                      Last 7 Days (Default)
                    </button>
                    <button
                      type="button"
                      className={`preset-btn ${periodPreset === "14_DAYS" ? "active" : ""}`}
                      onClick={() => setPeriodPreset("14_DAYS")}
                      disabled={generating}
                    >
                      Last 14 Days
                    </button>
                    <button
                      type="button"
                      className={`preset-btn ${periodPreset === "CUSTOM" ? "active" : ""}`}
                      onClick={() => setPeriodPreset("CUSTOM")}
                      disabled={generating}
                    >
                      Custom Dates
                    </button>
                  </div>

                  {periodPreset === "CUSTOM" && (
                    <div className="custom-dates-row">
                      <div className="date-field">
                        <span className="field-lbl">Start Date</span>
                        <input
                          type="date"
                          className="form-input"
                          value={customStart}
                          onChange={(e) => setCustomStart(e.target.value)}
                          disabled={generating}
                          required
                        />
                      </div>
                      <div className="date-field">
                        <span className="field-lbl">End Date</span>
                        <input
                          type="date"
                          className="form-input"
                          value={customEnd}
                          onChange={(e) => setCustomEnd(e.target.value)}
                          disabled={generating}
                          required
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Optional Instructions */}
                <div className="form-group">
                  <label className="form-label">
                    Strategic Focus & Directives (Optional)
                  </label>
                  <textarea
                    className="form-textarea"
                    rows={3}
                    placeholder="e.g. Focus on backend stability, cloud migrations, and critical blockers..."
                    value={customInstructions}
                    onChange={(e) => setCustomInstructions(e.target.value)}
                    disabled={generating}
                  />
                  <span className="field-hint">
                    Guiding prompt for executive synthesis and prioritization recommendations.
                  </span>
                </div>
              </div>

              <div className="modal-footer-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={generating}
                  onClick={() => setShowGenerateModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={generating || !genProjectId}
                >
                  {generating ? (
                    <>
                      <LoaderCircle size={15} className="spin-icon" />
                      <span>Synthesizing Report...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles size={15} />
                      <span>Generate Intelligence Report</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
