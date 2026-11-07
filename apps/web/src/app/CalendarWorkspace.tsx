"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Check, Clock3, LoaderCircle, ShieldCheck, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";

type EventKind = "task" | "project" | "milestone" | "meeting";
type CalendarEvent = { id: string; type: EventKind; title: string; date: string | null; startDate: string | null; endDate: string | null; status: string; priority?: string; projectId: string | null; projectName: string; assigneeId: string | null; assigneeName: string | null; blockedBy: { id: string; title: string; status: string }[]; criticalPath: boolean; downstreamTaskCount?: number; participantIds?: string[]; participants?: string[] };
type View = "Month" | "Week" | "Day" | "Timeline";
type Props = { projects: { id: string; name: string }[]; members: { id: string; role: string; user: { id: string; name: string } }[]; notify: (message: string) => void; onOpenProject: (id: string) => void; onOpenMeetings: () => void };
const day = 86400000;
function dayStart(value: Date) { const result = new Date(value); result.setHours(0, 0, 0, 0); return result; }
function weekStart(value: Date) { const result = dayStart(value); result.setDate(result.getDate() - (result.getDay() + 6) % 7); return result; }
function addDays(value: Date, count: number) { const result = new Date(value); result.setDate(result.getDate() + count); return result; }
function dateKey(value: string | Date) { const d = typeof value === "string" ? new Date(value) : value; return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function dateInput(value: string | null) { if (!value) return ""; const d = new Date(value); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
function dateTimeInput(value: string | null) { if (!value) return ""; const d = new Date(value); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); }
function localIso(value: string) { return value ? new Date(value.includes("T") ? value : `${value}T12:00:00`).toISOString() : undefined; }
function monthName(value: Date) { return value.toLocaleDateString([], { month: "long", year: "numeric" }); }
const colorByType: Record<EventKind, string> = { task: "calendar-task", milestone: "calendar-milestone", meeting: "calendar-meeting", project: "calendar-project" };

export default function CalendarWorkspace({ projects, members, notify, onOpenProject, onOpenMeetings }: Props) {
  const [view, setView] = useState<View>("Month");
  const [activeDate, setActiveDate] = useState(() => new Date());
  const [projectId, setProjectId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [status, setStatus] = useState("");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [schedule, setSchedule] = useState({ startDate: "", endDate: "" });

  const windowRange = useMemo(() => {
    if (view === "Month") { const start = weekStart(new Date(activeDate.getFullYear(), activeDate.getMonth(), 1)); return { start, end: addDays(start, 42) }; }
    if (view === "Week") { const start = weekStart(activeDate); return { start, end: addDays(start, 7) }; }
    if (view === "Day") { const start = dayStart(activeDate); return { start, end: addDays(start, 1) }; }
    const start = dayStart(new Date(activeDate.getFullYear(), activeDate.getMonth(), 1)); return { start, end: addDays(start, 35) };
  }, [activeDate, view]);
  const from = windowRange.start.toISOString();
  const to = windowRange.end.toISOString();

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ from, to });
      if (projectId) params.set("projectId", projectId);
      if (memberId) params.set("memberId", memberId);
      if (status) params.set("status", status);
      const result = await api.get(`/calendar/events?${params.toString()}`);
      setEvents(result.events ?? []);
    } catch (e) { setError(e instanceof ApiError ? e.message : "Could not load calendar events."); }
    finally { setLoading(false); }
  }, [from, to, projectId, memberId, status]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (selected) setSchedule({ startDate: selected.type === "meeting" ? dateTimeInput(selected.startDate) : dateInput(selected.startDate), endDate: dateInput(selected.endDate) }); }, [selected]);

  const eventsForDay = (date: Date) => events.filter(item => item.date && dateKey(item.date) === dateKey(date));
  const visibleDays = view === "Day" ? [dayStart(activeDate)] : Array.from({ length: 7 }, (_, i) => addDays(weekStart(activeDate), i));
  const next = (direction: number) => { const increment = view === "Day" ? 1 : view === "Week" ? 7 : view === "Timeline" ? 35 : 1; const nextDate = new Date(activeDate); if (view === "Month") nextDate.setMonth(nextDate.getMonth() + direction); else nextDate.setDate(nextDate.getDate() + direction * increment); setActiveDate(nextDate); };

  async function saveDates() {
    if (!selected) return;
    if (schedule.startDate && schedule.endDate && schedule.startDate > schedule.endDate) { setError("Start date must be on or before the end date."); return; }
    if (selected.type === "task" && selected.downstreamTaskCount && !window.confirm(`This task has ${selected.downstreamTaskCount} downstream dependent task(s). Changing its dates may affect their schedule. Continue without changing dependent dates?`)) return;
    setBusy(true); setError("");
    try {
      const startDate = localIso(schedule.startDate), endDate = localIso(schedule.endDate);
      if (selected.type === "task") await api.patch(`/tasks/${selected.id}`, { startDate: startDate ?? null, dueDate: endDate ?? null });
      else if (selected.type === "meeting") await api.patch(`/meetings/${selected.id}`, { startsAt: localIso(schedule.startDate) ?? null });
      else if (selected.type === "milestone") await api.patch(`/milestones/${selected.id}`, { targetDate: endDate });
      else if (selected.type === "project") await api.patch(`/projects/${selected.id}`, { startDate, dueDate: endDate });
      await refresh(); setSelected(null); notify("Schedule updated");
    } catch (e) { setError(e instanceof ApiError ? e.message : "Could not update this schedule."); }
    finally { setBusy(false); }
  }

  const timelineLength = Math.max(1, Math.ceil((windowRange.end.getTime() - windowRange.start.getTime()) / day));
  const dateOffset = (value: string | null) => value ? Math.max(0, Math.min(timelineLength - 1, (dayStart(new Date(value)).getTime() - windowRange.start.getTime()) / day)) : 0;
  const timelineEvents = events.filter(item => item.type === "task" || item.type === "milestone" || item.type === "project");

  return <div className="calendar-workspace">
    <div className="welcome-row compact-welcome"><div><div className="eyebrow"><CalendarDays size={12}/> WORKSPACE SCHEDULE</div><h1>Calendar &amp; timeline</h1><p className="page-subtitle">Tasks, milestones, project dates, and meetings in one workspace schedule.</p></div><div className="calendar-now"><Clock3 size={14}/>{activeDate.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</div></div>
    {error && <div className="meeting-error"><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss error"><X size={14}/></button></div>}
    <section className="panel calendar-panel"><div className="calendar-toolbar"><div className="calendar-nav"><button className="icon-button" aria-label="Previous date range" onClick={() => next(-1)}><ArrowLeft size={14}/></button><h2>{view === "Day" ? activeDate.toLocaleDateString([], { dateStyle: "full" }) : view === "Week" ? `${visibleDays[0].toLocaleDateString([], { month: "short", day: "numeric" })} – ${visibleDays.at(-1)?.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}` : monthName(activeDate)}</h2><button className="icon-button" aria-label="Next date range" onClick={() => next(1)}><ArrowRight size={14}/></button><button className="text-button calendar-today" onClick={() => setActiveDate(new Date())}>Today</button></div><div className="calendar-filters"><select aria-label="Filter by project" value={projectId} onChange={e => setProjectId(e.target.value)}><option value="">All projects</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><select aria-label="Filter by member" value={memberId} onChange={e => setMemberId(e.target.value)}><option value="">All members</option>{members.map(m => <option key={m.id} value={m.user.id}>{m.user.name}</option>)}</select><select aria-label="Filter by status" value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option>{["TODO", "IN_PROGRESS", "IN_REVIEW", "BLOCKED", "DONE", "CANCELLED", "SCHEDULED", "PROCESSING", "READY", "FAILED", "PLANNING", "ACTIVE", "AT_RISK", "COMPLETED", "OPEN"].map(s => <option key={s}>{s}</option>)}</select></div><div className="calendar-views">{(["Month", "Week", "Day", "Timeline"] as View[]).map(item => <button key={item} className={view === item ? "selected" : ""} onClick={() => setView(item)}>{item}</button>)}</div></div>
      <div className="calendar-legend"><span className="calendar-task">Tasks</span><span className="calendar-milestone">Milestones</span><span className="calendar-meeting">Meetings</span><span className="calendar-project">Projects</span>{loading && <LoaderCircle size={13} className="spin"/>}</div>
      {view === "Month" ? <div className="month-grid"><div className="month-weekdays">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(name => <span key={name}>{name}</span>)}</div><div className="month-days">{Array.from({ length: 42 }, (_, index) => { const date = addDays(windowRange.start, index); const dayEvents = eventsForDay(date); return <div className={`month-day ${date.getMonth() !== activeDate.getMonth() ? "outside" : ""} ${dateKey(date) === dateKey(new Date()) ? "today" : ""}`} key={date.toISOString()}><button className="day-number" onClick={() => { setActiveDate(date); setView("Day"); }}>{date.getDate()}</button><div className="day-event-list">{dayEvents.slice(0, 3).map(event => <button key={`${event.type}:${event.id}`} className={`calendar-event-chip ${colorByType[event.type]}`} onClick={() => setSelected(event)} title={`${event.title} · ${event.projectName}`}><i/>{event.title}</button>)}{dayEvents.length > 3 && <button className="more-events" onClick={() => { setActiveDate(date); setView("Day"); }}>+{dayEvents.length - 3} more</button>}</div></div>; })}</div></div> : view === "Week" || view === "Day" ? <div className={`schedule-columns ${view.toLowerCase()}`}>{visibleDays.map(date => <section className="schedule-day" key={date.toISOString()}><header><b>{date.toLocaleDateString([], { weekday: "short" })}</b><span>{date.toLocaleDateString([], { month: "short", day: "numeric" })}</span></header>{eventsForDay(date).map(event => <button key={`${event.type}:${event.id}`} className={`schedule-card ${colorByType[event.type]}`} onClick={() => setSelected(event)}><span>{event.type}</span><b>{event.title}</b><small>{event.projectName}{event.assigneeName ? ` · ${event.assigneeName}` : ""}</small>{event.status === "BLOCKED" && <em>Blocked</em>}</button>)}{!eventsForDay(date).length && <div className="schedule-empty">No events</div>}</section>)}</div> : <div className="timeline-wrap"><div className="timeline-axis"><div className="timeline-label">Project work</div><div className="timeline-days">{Array.from({ length: timelineLength }, (_, i) => <span key={i}>{addDays(windowRange.start, i).getDate()}</span>)}</div></div>{timelineEvents.length ? timelineEvents.map(event => { const left = dateOffset(event.startDate); const end = dateOffset(event.endDate); const width = Math.max(1, end - left + 1); return <button key={`${event.type}:${event.id}`} className={`timeline-row ${event.criticalPath ? "critical" : ""}`} onClick={() => setSelected(event)}><span className="timeline-event-label"><b>{event.title}</b><small>{event.projectName}{event.blockedBy.length ? ` · blocked by ${event.blockedBy.length}` : ""}{event.criticalPath ? " · critical path" : ""}</small></span><span className="timeline-track"><i className={colorByType[event.type]} style={{ left: `${left / timelineLength * 100}%`, width: `${width / timelineLength * 100}%` }}/></span></button>; }) : <div className="schedule-empty timeline-empty">No dated tasks, milestones, or projects in this range.</div>}{events.filter(e => e.type === "meeting").length > 0 && <button className="text-button timeline-meetings" onClick={onOpenMeetings}>View {events.filter(e => e.type === "meeting").length} meeting(s) in this range <ArrowRight size={13}/></button>}</div>}
    </section>
    <div className="meeting-security-note"><ShieldCheck size={14}/> Dates are workspace-scoped. Changing a task date prompts you before affecting a dependent schedule.</div>
    {selected && <div className="calendar-detail-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setSelected(null); }}><section className="panel calendar-detail" role="dialog" aria-modal="true" aria-labelledby="calendar-event-title"><div className="panel-head"><div><div className="eyebrow">{selected.type.toUpperCase()} · {selected.projectName}</div><h2 id="calendar-event-title">{selected.title}</h2></div><button className="icon-button" aria-label="Close event details" onClick={() => setSelected(null)}><X size={16}/></button></div><p className="calendar-detail-meta">{selected.status.toLowerCase().replaceAll("_", " ")}{selected.assigneeName ? ` · ${selected.assigneeName}` : ""}{selected.participants?.length ? ` · ${selected.participants.join(", ")}` : ""}</p>{selected.blockedBy.length > 0 && <div className="calendar-dependencies"><b>Depends on</b>{selected.blockedBy.map(dependency => <span key={dependency.id}>{dependency.title} · {dependency.status.toLowerCase()}</span>)}</div>}<div className="calendar-date-fields"><label>{selected.type === "meeting" ? "Date and time" : selected.type === "milestone" ? "Target date" : "Start date"}<input aria-label="Event start date" type={selected.type === "meeting" ? "datetime-local" : "date"} value={selected.type === "milestone" ? schedule.endDate : schedule.startDate} onChange={e => setSchedule(selected.type === "milestone" ? { ...schedule, endDate: e.target.value } : { ...schedule, startDate: e.target.value })}/></label>{selected.type !== "meeting" && selected.type !== "milestone" && <label>End date<input aria-label="Event end date" type="date" value={schedule.endDate} onChange={e => setSchedule({ ...schedule, endDate: e.target.value })}/></label>}</div>{selected.type === "task" && <div className="calendar-risk-note">{selected.criticalPath ? "Critical path task." : "Task dates do not automatically move dependent tasks."}{selected.downstreamTaskCount ? ` ${selected.downstreamTaskCount} downstream task(s) may need review.` : ""}</div>}<div className="calendar-detail-actions"><button className="button button-secondary" onClick={() => { setSelected(null); if (selected.type === "meeting") onOpenMeetings(); else if (selected.projectId) onOpenProject(selected.projectId); }}>Open {selected.type === "meeting" ? "meeting workspace" : "project"}</button><button className="button button-primary" disabled={busy} onClick={() => void saveDates()}>{busy ? <LoaderCircle className="spin" size={13}/> : <Check size={13}/>} Save dates</button></div></section></div>}
    <span className="sr-only">{projects.length} projects and {members.length} members available as calendar filters.</span>
  </div>;
}
