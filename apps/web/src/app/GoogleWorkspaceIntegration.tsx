"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Calendar,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  ExternalLink,
  GitBranch,
  Inbox,
  Link as LinkIcon,
  LoaderCircle,
  Mail,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";

type Project = { id: string; name: string };

type GoogleConnectionStatus = {
  configured: boolean;
  encryptionReady: boolean;
  connected: boolean;
  connection: {
    id: string;
    googleEmail: string;
    scopes: string[];
    status: string;
    lastCalendarSyncAt: string | null;
    calendarSyncStatus: string;
    calendarSyncError: string | null;
    lastGmailSyncAt: string | null;
    gmailSyncStatus: string;
    gmailSyncError: string | null;
    syncedCalendarEventsCount: number;
    syncedGmailMessagesCount: number;
    createdAt: string;
  } | null;
};

type CalendarEvent = {
  id: string;
  googleEventId: string;
  summary: string;
  description?: string | null;
  location?: string | null;
  startsAt: string;
  endsAt: string;
  isAllDay: boolean;
  status: string;
  htmlLink?: string | null;
  attendees?: Array<{ email?: string; displayName?: string }>;
  projectId?: string | null;
  project?: { id: string; name: string } | null;
  suggestedProjectId?: string | null;
  suggestedProject?: { id: string; name: string } | null;
  suggestionReason?: string | null;
};

type GmailMessage = {
  id: string;
  gmailMessageId: string;
  subject: string;
  from: string;
  to?: string | null;
  date?: string | null;
  snippet: string;
  labels: string[];
  projectId?: string | null;
  project?: { id: string; name: string } | null;
  suggestedProjectId?: string | null;
  suggestedProject?: { id: string; name: string } | null;
  suggestionReason?: string | null;
};

export default function GoogleWorkspaceIntegration({
  projects,
  canManage,
  notify,
}: {
  projects: Project[];
  canManage: boolean;
  notify: (message: string) => void;
}) {
  const [tab, setTab] = useState<"calendar" | "gmail" | "intelligence">("calendar");
  const [status, setStatus] = useState<GoogleConnectionStatus | null>(null);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [suggestions, setSuggestions] = useState<CalendarEvent[]>([]);
  const [gmailMessages, setGmailMessages] = useState<GmailMessage[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<Record<string, string>>({});
  const [createMeetingChecked, setCreateMeetingChecked] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refreshStatus = useCallback(async () => {
    try {
      const data = await api.get("/integrations/google/status");
      setStatus(data);
      return data;
    } catch {
      return null;
    }
  }, []);

  const refreshCalendar = useCallback(async () => {
    try {
      const [eventsData, suggestionsData] = await Promise.all([
        api.get("/integrations/google/calendar/events?limit=50"),
        api.get("/integrations/google/calendar/suggestions"),
      ]);
      setCalendarEvents(eventsData.events ?? []);
      setSuggestions(suggestionsData.suggestions ?? []);
    } catch {
      // Ignored if not connected
    }
  }, []);

  const refreshGmail = useCallback(async () => {
    try {
      const data = await api.get("/integrations/google/gmail/messages");
      setGmailMessages(data.messages ?? []);
    } catch {
      // Ignored if not connected
    }
  }, []);

  const reloadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const currentStatus = await refreshStatus();
      if (currentStatus?.connected) {
        await Promise.all([refreshCalendar(), refreshGmail()]);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load Google Workspace status.");
    } finally {
      setLoading(false);
    }
  }, [refreshStatus, refreshCalendar, refreshGmail]);

  useEffect(() => {
    void reloadAll();
  }, [reloadAll]);

  async function handleConnect() {
    setBusy(true);
    setError("");
    try {
      const res = await api.post("/integrations/google/connect", {});
      if (res.authorizationUrl) {
        window.location.href = res.authorizationUrl;
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to initiate Google authorization.");
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    if (!window.confirm("Are you sure you want to disconnect Google Workspace? Synced data will remain preserved.")) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.post("/integrations/google/disconnect", {});
      notify("Google Workspace disconnected.");
      await reloadAll();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to disconnect Google Workspace.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSyncCalendar(force = false) {
    setBusy(true);
    setError("");
    try {
      const res = await api.post("/integrations/google/calendar/sync", { force });
      notify(res.message || "Google Calendar synchronization completed.");
      await reloadAll();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Calendar sync failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSyncGmail() {
    setBusy(true);
    setError("");
    try {
      const res = await api.post("/integrations/google/gmail/sync", { maxMessages: 25 });
      notify(res.message || "Gmail synchronization completed.");
      await reloadAll();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Gmail sync failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAssociateEvent(eventId: string, targetProjectId?: string) {
    const projectId = targetProjectId || selectedProjectId[eventId];
    if (!projectId) {
      setError("Please select a project to associate with this event.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.post(`/integrations/google/calendar/events/${eventId}/associate`, {
        projectId,
        createMeeting: Boolean(createMeetingChecked[eventId]),
      });
      notify("Calendar event associated with project.");
      await refreshCalendar();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to associate calendar event.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDismissSuggestion(eventId: string) {
    try {
      await api.delete(`/integrations/google/calendar/events/${eventId}/suggestion`);
      notify("Suggestion dismissed.");
      await refreshCalendar();
    } catch {
      // Ignore
    }
  }

  async function handleProposeTaskFromEmail(messageId: string, projectId?: string) {
    setBusy(true);
    setError("");
    try {
      const res = await api.post(`/integrations/google/gmail/messages/${messageId}/propose-task`, {
        projectId: projectId || undefined,
      });
      notify(`AI Proposal drafted: "${res.title}". Review in AI Command center.`);
      await refreshGmail();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to extract task proposal from email.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel settings-panel" style={{ marginTop: "16px" }}>
      <div className="panel-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ color: "#4285f4", fontWeight: 700 }}>GOOGLE WORKSPACE</span> · RELEASE 3 STEP 3
          </div>
          <h2 style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" }}>
            Google Calendar Sync &amp; Gmail Intelligence
          </h2>
          <p className="muted-copy" style={{ marginTop: "2px" }}>
            Synchronize project schedules, detect meeting context, and generate human-in-the-loop task proposals from email threads.
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            type="button"
            className="button button-secondary small-button"
            onClick={() => void reloadAll()}
            disabled={loading || busy}
            title="Refresh status and sync records"
          >
            <RefreshCw size={13} className={loading ? "spin" : ""} /> Refresh
          </button>

          {status?.connected ? (
            <button
              type="button"
              className="button button-danger small-button"
              onClick={handleDisconnect}
              disabled={busy || !canManage}
            >
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              className="button button-primary small-button"
              onClick={handleConnect}
              disabled={busy || !canManage || !status?.configured}
            >
              {busy ? <LoaderCircle size={13} className="spin" /> : <LinkIcon size={13} />} Connect Google Account
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="meeting-error" style={{ marginBottom: "12px" }}>
          <span>{error}</span>
          <button onClick={() => setError("")} aria-label="Dismiss error">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Connection Status Banner */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
          gap: "10px",
          marginBottom: "14px",
          padding: "12px",
          background: "var(--panel-wash, #f8f9fa)",
          borderRadius: "8px",
          border: "1px solid var(--line, #e2e8f0)",
          fontSize: "9px",
        }}
      >
        <div>
          <span style={{ color: "#7d8690", display: "block" }}>ACCOUNT STATUS</span>
          <b style={{ color: status?.connected ? "#10b981" : "#64748b", display: "flex", alignItems: "center", gap: "4px", marginTop: "2px" }}>
            {status?.connected ? <CheckCircle2 size={13} /> : <ShieldAlert size={13} />}
            {status?.connected ? `Connected (${status.connection?.googleEmail})` : "Not connected"}
          </b>
        </div>

        <div>
          <span style={{ color: "#7d8690", display: "block" }}>CALENDAR SYNC</span>
          <b style={{ color: "var(--ink)", display: "flex", alignItems: "center", gap: "4px", marginTop: "2px" }}>
            <CalendarDays size={13} style={{ color: "#4285f4" }} />
            {status?.connection?.calendarSyncStatus === "SYNCING"
              ? "Syncing in progress..."
              : status?.connection?.lastCalendarSyncAt
              ? `${status.connection.syncedCalendarEventsCount} event(s) synced`
              : "Not synced"}
          </b>
          {status?.connection?.lastCalendarSyncAt && (
            <small style={{ color: "#94a3b8" }}>
              Last: {new Date(status.connection.lastCalendarSyncAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </small>
          )}
        </div>

        <div>
          <span style={{ color: "#7d8690", display: "block" }}>GMAIL CONTEXT</span>
          <b style={{ color: "var(--ink)", display: "flex", alignItems: "center", gap: "4px", marginTop: "2px" }}>
            <Mail size={13} style={{ color: "#ea4335" }} />
            {status?.connection?.gmailSyncStatus === "SYNCING"
              ? "Syncing in progress..."
              : status?.connection?.lastGmailSyncAt
              ? `${status.connection.syncedGmailMessagesCount} thread(s) synced`
              : "Not synced"}
          </b>
          {status?.connection?.lastGmailSyncAt && (
            <small style={{ color: "#94a3b8" }}>
              Last: {new Date(status.connection.lastGmailSyncAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </small>
          )}
        </div>

        <div>
          <span style={{ color: "#7d8690", display: "block" }}>CREDENTIAL SECURITY</span>
          <b style={{ color: status?.encryptionReady ? "#10b981" : "#f59e0b", display: "flex", alignItems: "center", gap: "4px", marginTop: "2px" }}>
            <ShieldCheck size={13} />
            {status?.encryptionReady ? "AES-256-GCM Encrypted" : "Encryption key missing"}
          </b>
          <small style={{ color: "#94a3b8" }}>One-time CSRF tokens &amp; tenant scoped</small>
        </div>
      </div>

      {!status?.configured && (
        <div style={{ padding: "10px 12px", background: "#fef3c7", color: "#92400e", borderRadius: "6px", fontSize: "9px", marginBottom: "14px" }}>
          <b>Google OAuth not configured:</b> Please configure <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>, and <code>GOOGLE_CALLBACK_URL</code> in your environment to connect Google Workspace.
        </div>
      )}

      {/* Tabs */}
      <div className="segmented" style={{ marginBottom: "12px" }}>
        <button className={tab === "calendar" ? "selected" : ""} onClick={() => setTab("calendar")}>
          <CalendarDays size={12} /> Google Calendar ({calendarEvents.length})
        </button>
        <button className={tab === "intelligence" ? "selected" : ""} onClick={() => setTab("intelligence")}>
          <Sparkles size={12} /> Meeting Intelligence ({suggestions.length})
        </button>
        <button className={tab === "gmail" ? "selected" : ""} onClick={() => setTab("gmail")}>
          <Mail size={12} /> Gmail Actions ({gmailMessages.length})
        </button>
      </div>

      {/* Tab: Calendar Sync */}
      {tab === "calendar" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
            <div>
              <b style={{ fontSize: "11px", color: "var(--ink)" }}>Upcoming Calendar Events</b>
              <p className="muted-copy" style={{ fontSize: "8.5px", margin: 0 }}>
                Synchronized events appear in your workspace calendar and timeline views.
              </p>
            </div>
            {status?.connected && (
              <div style={{ display: "flex", gap: "6px" }}>
                <button
                  type="button"
                  className="button button-secondary small-button"
                  onClick={() => void handleSyncCalendar(false)}
                  disabled={busy}
                >
                  <RefreshCw size={12} className={busy ? "spin" : ""} /> Sync Now
                </button>
                <button
                  type="button"
                  className="button button-secondary small-button"
                  onClick={() => void handleSyncCalendar(true)}
                  disabled={busy}
                  title="Force a full resync ignoring cached sync tokens"
                >
                  Full Resync
                </button>
              </div>
            )}
          </div>

          {calendarEvents.length === 0 ? (
            <div className="comment-empty" style={{ minHeight: "120px" }}>
              <Calendar size={18} />
              <span>
                {status?.connected
                  ? "No upcoming Google Calendar events found in range. Click 'Sync Now' to pull latest events."
                  : "Connect your Google account to automatically import calendar events into your workspace schedule."}
              </span>
            </div>
          ) : (
            <div style={{ display: "grid", gap: "8px", maxHeight: "360px", overflowY: "auto" }}>
              {calendarEvents.map(evt => (
                <div
                  key={evt.id}
                  style={{
                    padding: "9px 12px",
                    border: "1px solid var(--line, #e2e8f0)",
                    borderRadius: "6px",
                    background: "var(--surface, #fff)",
                    fontSize: "9px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span className="calendar-event-chip calendar-meeting" style={{ padding: "2px 6px", fontSize: "8px" }}>
                        Google Event
                      </span>
                      <b style={{ color: "var(--ink)", fontSize: "10px" }}>{evt.summary}</b>
                      {evt.project ? (
                        <span className="status-tag active" style={{ fontSize: "8px" }}>
                          Linked: {evt.project.name}
                        </span>
                      ) : evt.suggestedProject ? (
                        <span className="status-tag at_risk" style={{ fontSize: "8px" }}>
                          Suggested: {evt.suggestedProject.name}
                        </span>
                      ) : null}
                    </div>

                    <div style={{ color: "#7d8690", marginTop: "3px", display: "flex", alignItems: "center", gap: "10px" }}>
                      <span>
                        <Clock3 size={11} style={{ display: "inline", verticalAlign: "-1px", marginRight: "3px" }} />
                        {new Date(evt.startsAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        {" – "}
                        {new Date(evt.endsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                      </span>
                      {evt.location && <span>📍 {evt.location}</span>}
                      {evt.attendees && evt.attendees.length > 0 && (
                        <span>👥 {evt.attendees.length} attendee(s)</span>
                      )}
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    {evt.htmlLink && (
                      <a
                        href={evt.htmlLink}
                        target="_blank"
                        rel="noreferrer"
                        className="button button-secondary small-button"
                        style={{ padding: "3px 6px" }}
                        title="Open in Google Calendar"
                      >
                        <ExternalLink size={11} />
                      </a>
                    )}
                    {!evt.project && (
                      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                        <select
                          value={selectedProjectId[evt.id] || evt.suggestedProjectId || ""}
                          onChange={e => setSelectedProjectId({ ...selectedProjectId, [evt.id]: e.target.value })}
                          style={{ fontSize: "8.5px", padding: "2px 4px", borderRadius: "4px", border: "1px solid var(--line)" }}
                        >
                          <option value="">Select project...</option>
                          {projects.map(p => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="button button-primary small-button"
                          style={{ padding: "3px 8px" }}
                          onClick={() => void handleAssociateEvent(evt.id)}
                          disabled={busy || !(selectedProjectId[evt.id] || evt.suggestedProjectId)}
                        >
                          Link
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab: Calendar-to-Workspace Intelligence */}
      {tab === "intelligence" && (
        <div>
          <div style={{ marginBottom: "10px" }}>
            <b style={{ fontSize: "11px", color: "var(--ink)" }}>Calendar Meeting Suggestions</b>
            <p className="muted-copy" style={{ fontSize: "8.5px", margin: 0 }}>
              AI detected upcoming calendar events that correlate with existing projects. Review and link them to track discussions and action items.
            </p>
          </div>

          {suggestions.length === 0 ? (
            <div className="comment-empty" style={{ minHeight: "120px" }}>
              <Sparkles size={18} />
              <span>No pending meeting suggestions. As you schedule calendar events referencing your projects, recommendations will appear here.</span>
            </div>
          ) : (
            <div style={{ display: "grid", gap: "8px", maxHeight: "360px", overflowY: "auto" }}>
              {suggestions.map(sug => (
                <div
                  key={sug.id}
                  style={{
                    padding: "10px 12px",
                    border: "1px solid #c7d2fe",
                    borderRadius: "6px",
                    background: "#f5f3ff",
                    fontSize: "9px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <Sparkles size={13} style={{ color: "#7c3aed" }} />
                        <b style={{ fontSize: "10.5px", color: "#4c1d95" }}>{sug.summary}</b>
                        <span className="status-tag active" style={{ fontSize: "8px" }}>
                          Suggested: {sug.suggestedProject?.name}
                        </span>
                      </div>
                      {sug.suggestionReason && (
                        <p style={{ margin: "3px 0 0", color: "#6d28d9", fontStyle: "italic", fontSize: "8.5px" }}>
                          💡 {sug.suggestionReason}
                        </p>
                      )}
                      <div style={{ color: "#6b7280", marginTop: "4px" }}>
                        {new Date(sug.startsAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "8.5px", color: "var(--ink)" }}>
                        <input
                          type="checkbox"
                          checked={createMeetingChecked[sug.id] ?? true}
                          onChange={e => setCreateMeetingChecked({ ...createMeetingChecked, [sug.id]: e.target.checked })}
                        />
                        Create tracked meeting
                      </label>

                      <button
                        type="button"
                        className="button button-primary small-button"
                        onClick={() => void handleAssociateEvent(sug.id, sug.suggestedProjectId!)}
                        disabled={busy}
                      >
                        <Check size={11} /> Accept &amp; Link
                      </button>

                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => void handleDismissSuggestion(sug.id)}
                        title="Dismiss suggestion"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab: Gmail Intelligence */}
      {tab === "gmail" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
            <div>
              <b style={{ fontSize: "11px", color: "var(--ink)" }}>Gmail Context &amp; Task Proposals</b>
              <p className="muted-copy" style={{ fontSize: "8.5px", margin: 0 }}>
                Extract action items from authorized email threads into AI proposals for human review.
              </p>
            </div>
            {status?.connected && (
              <button
                type="button"
                className="button button-secondary small-button"
                onClick={() => void handleSyncGmail()}
                disabled={busy}
              >
                <RefreshCw size={12} className={busy ? "spin" : ""} /> Sync Recent Emails
              </button>
            )}
          </div>

          {gmailMessages.length === 0 ? (
            <div className="comment-empty" style={{ minHeight: "120px" }}>
              <Mail size={18} />
              <span>
                {status?.connected
                  ? "No recent emails synchronized yet. Click 'Sync Recent Emails' to pull metadata."
                  : "Connect your Google Workspace account to review email context and extract task proposals."}
              </span>
            </div>
          ) : (
            <div style={{ display: "grid", gap: "8px", maxHeight: "360px", overflowY: "auto" }}>
              {gmailMessages.map(msg => (
                <div
                  key={msg.id}
                  style={{
                    padding: "10px 12px",
                    border: "1px solid var(--line, #e2e8f0)",
                    borderRadius: "6px",
                    background: "var(--surface, #fff)",
                    fontSize: "9px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ flex: 1, paddingRight: "12px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <Mail size={12} style={{ color: "#ea4335" }} />
                        <b style={{ fontSize: "10px", color: "var(--ink)" }}>{msg.subject}</b>
                        {msg.suggestedProject && (
                          <span className="status-tag active" style={{ fontSize: "8px" }}>
                            Relevant to: {msg.suggestedProject.name}
                          </span>
                        )}
                      </div>
                      <div style={{ color: "#7d8690", fontSize: "8px", marginTop: "2px" }}>
                        From: <b>{msg.from}</b>
                        {msg.date && (
                          <span> · {new Date(msg.date).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                        )}
                      </div>
                      {msg.snippet && (
                        <p style={{ margin: "4px 0 0", color: "#475569", fontSize: "8.5px", lineHeight: 1.4 }}>
                          &ldquo;{msg.snippet}&rdquo;
                        </p>
                      )}
                    </div>

                    <div>
                      <button
                        type="button"
                        className="button button-primary small-button"
                        style={{ whiteSpace: "nowrap" }}
                        onClick={() => void handleProposeTaskFromEmail(msg.id, msg.suggestedProjectId || undefined)}
                        disabled={busy}
                      >
                        <Sparkles size={11} /> Propose Task
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="meeting-security-note" style={{ marginTop: "14px" }}>
        <ShieldCheck size={14} /> Tokens are encrypted using AES-256-GCM. Task proposals from emails always require human approval before tasks are added.
      </div>
    </section>
  );
}
