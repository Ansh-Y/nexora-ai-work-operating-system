"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  AlertOctagon,
  ArrowRight,
  Bot,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock,
  ExternalLink,
  History,
  Info,
  Layers,
  LoaderCircle,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  ShieldAlert,
  Sparkles,
  Trash2,
  User,
  X,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";

export interface Citation {
  id: string;
  type: "project" | "task" | "milestone" | "meeting" | "risk" | "health" | "member" | "document";
  title: string;
  snippet?: string;
  url: string;
  metadata?: Record<string, any>;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  citations?: Citation[];
  projectId?: string | null;
  projectName?: string | null;
  provider?: "openai" | "local_expert";
  suggestedFollowUps?: string[];
}

export interface ConversationSession {
  id: string;
  title: string;
  projectId?: string | null;
  projectName?: string | null;
  messages: ChatMessage[];
  updatedAt: string;
}

interface Props {
  projects: Array<{ id: string; name: string }>;
  activeProjectId?: string | null;
  onOpenProject?: (projectId: string) => void;
  onOpenTask?: (projectId: string, taskId: string) => void;
  onNavigate?: (tabName: string) => void;
  notify: (message: string) => void;
  user?: any;
  workspace?: { id: string; name: string } | null;
}

let idCounter = 0;
function createLocalId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

const STARTER_PROMPTS = [
  "Give me an overview of this project.",
  "Which tasks are overdue?",
  "What is blocking project progress?",
  "Why is this project at risk?",
  "What should the team prioritize next?",
  "Summarize the latest meeting.",
  "Which milestones are approaching?",
  "Show me the current team workload.",
];

export function AiAssistantWorkspace({
  projects,
  activeProjectId: initialActiveProjectId,
  onOpenProject,
  onOpenTask,
  onNavigate,
  notify,
  user,
  workspace,
}: Props) {
  const [selectedProjectId, setSelectedProjectId] = useState<string>(initialActiveProjectId || projects[0]?.id || "");
  const [contextData, setContextData] = useState<any>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [savedSessions, setSavedSessions] = useState<ConversationSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>("session-init");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const initialLoadedRef = useRef(false);

  // Storage key scoped to workspace & user
  const storageKey = `nexora_ai_assistant_${workspace?.id || "default"}_${user?.id || "anon"}`;

  // Load saved sessions from localStorage
  useEffect(() => {
    if (initialLoadedRef.current) return;
    initialLoadedRef.current = true;
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as ConversationSession[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setSavedSessions(parsed);
          const latest = parsed[0];
          if (latest) {
            setCurrentSessionId(latest.id);
            setMessages(latest.messages);
            if (latest.projectId) setSelectedProjectId(latest.projectId);
          }
        }
      }
    } catch {
      // Storage unavailable or corrupted
    }
  }, [storageKey]);

  // Persist current session when messages change
  useEffect(() => {
    if (messages.length === 0) return;
    try {
      const sessionTitle = messages.find(m => m.role === "user")?.content.slice(0, 48) || "Conversation";
      const currentProjName = projects.find(p => p.id === selectedProjectId)?.name || "Workspace";
      const updatedSession: ConversationSession = {
        id: currentSessionId,
        title: sessionTitle,
        projectId: selectedProjectId || null,
        projectName: currentProjName,
        messages,
        updatedAt: new Date().toISOString(),
      };

      setSavedSessions(prev => {
        const filtered = prev.filter(s => s.id !== currentSessionId);
        const next = [updatedSession, ...filtered].slice(0, 20); // Keep max 20 sessions
        localStorage.setItem(storageKey, JSON.stringify(next));
        return next;
      });
    } catch {
      // Fallback
    }
  }, [messages, currentSessionId, selectedProjectId, projects, storageKey]);

  // Load context from API
  const loadContext = useCallback(async (projId?: string) => {
    try {
      const q = projId ? `?projectId=${encodeURIComponent(projId)}` : "";
      const res = await api.get(`/ai/assistant/context${q}`);
      setContextData(res);
      if (!selectedProjectId && res?.activeProjectId) {
        setSelectedProjectId(res.activeProjectId);
      }
    } catch {
      // Non-blocking
    }
  }, [selectedProjectId]);

  useEffect(() => {
    loadContext(selectedProjectId);
  }, [selectedProjectId, loadContext]);

  // Auto-scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  // Start new conversation
  const handleNewConversation = () => {
    const newId = createLocalId("session");
    setCurrentSessionId(newId);
    setMessages([]);
    setError(null);
    setInput("");
    notify("Started new AI conversation session.");
  };

  // Clear current conversation
  const handleClearConversation = () => {
    setMessages([]);
    setError(null);
    setInput("");
    // Remove current session from storage
    setSavedSessions(prev => {
      const next = prev.filter(s => s.id !== currentSessionId);
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
    notify("Conversation cleared.");
  };

  // Switch to a past session
  const handleSelectSession = (session: ConversationSession) => {
    setCurrentSessionId(session.id);
    setMessages(session.messages);
    if (session.projectId) setSelectedProjectId(session.projectId);
    setShowHistoryModal(false);
    notify(`Loaded conversation: "${session.title}"`);
  };

  // Delete a saved session
  const handleDeleteSession = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSavedSessions(prev => {
      const next = prev.filter(s => s.id !== sessionId);
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
    if (sessionId === currentSessionId) {
      handleNewConversation();
    }
  };

  // Send message
  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || input).trim();
    if (!text || loading) return;

    const userMsg: ChatMessage = {
      id: createLocalId("usr"),
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
      projectId: selectedProjectId || undefined,
    };

    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setError(null);
    setLoading(true);

    try {
      const historyPayload = messages.slice(-8).map(m => ({
        role: m.role,
        content: m.content,
        projectId: m.projectId || undefined,
        timestamp: m.timestamp,
      }));

      const res: any = await api.post("/ai/assistant/chat", {
        message: text,
        projectId: selectedProjectId || undefined,
        history: historyPayload,
      });

      const assistantMsg: ChatMessage = {
        id: createLocalId("ast"),
        role: "assistant",
        content: res.answer,
        timestamp: res.timestamp || new Date().toISOString(),
        citations: res.citations || [],
        projectId: res.projectId || selectedProjectId || null,
        projectName: res.projectName || null,
        provider: res.provider || "local_expert",
        suggestedFollowUps: res.suggestedFollowUps || [],
      };

      setMessages(prev => [...prev, assistantMsg]);

      // If response dynamically resolved a project, align selector
      if (res.projectId && res.projectId !== selectedProjectId) {
        setSelectedProjectId(res.projectId);
      }
    } catch (err: any) {
      const errMsg = err instanceof ApiError ? err.message : (err?.message || "Failed to generate AI response");
      setError(errMsg);
    } finally {
      setLoading(false);
    }
  };

  // Handle citation click
  const handleCitationClick = (c: Citation) => {
    if (c.type === "project" && onOpenProject) {
      onOpenProject(c.id);
    } else if (c.type === "task" && onOpenTask && selectedProjectId) {
      onOpenTask(selectedProjectId, c.id);
    } else if (c.type === "health" && onNavigate) {
      onNavigate("Project Health");
    } else if (c.type === "meeting" && onNavigate) {
      onNavigate("Meetings");
    } else if (c.type === "risk" && onNavigate) {
      onNavigate("Project Health");
    } else if (c.type === "member" && onNavigate) {
      onNavigate("Settings");
    } else if (onOpenProject && selectedProjectId) {
      onOpenProject(selectedProjectId);
    }
  };

  // Selected project details
  const currentProject = projects.find(p => p.id === selectedProjectId);

  return (
    <div className="ai-assistant-page">
      {/* 1. Header Workspace Bar */}
      <header className="assistant-header">
        <div className="assistant-header-left">
          <div className="assistant-icon-badge">
            <Bot size={22} className="assistant-bot-icon" />
            <span className="assistant-spark-dot"><Sparkles size={11} /></span>
          </div>
          <div>
            <div className="assistant-eyebrow">
              <span className="spark-live-dot" /> NEXORA INTELLIGENCE · RELEASE 4.2.1
            </div>
            <h1 className="assistant-title">AI Project Assistant</h1>
            <p className="assistant-subtitle">
              Contextual, evidence-based conversations grounded in actual workspace, task, and project health data.
            </p>
          </div>
        </div>

        <div className="assistant-header-actions">
          {/* Project Context Selector */}
          <div className="assistant-project-selector-wrapper">
            <span className="selector-label">Context:</span>
            <div className="assistant-select-box">
              <Layers size={14} className="selector-icon" />
              <select
                className="assistant-project-select"
                aria-label="Select project context"
                value={selectedProjectId}
                onChange={e => setSelectedProjectId(e.target.value)}
              >
                <option value="">All Workspace Projects</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} className="selector-chevron" />
            </div>
          </div>

          {/* New Conversation Button */}
          <button
            className="button button-quiet assistant-btn"
            onClick={handleNewConversation}
            title="Start a new conversation"
          >
            <Plus size={15} />
            <span>New Chat</span>
          </button>

          {/* History Button */}
          <button
            className="button button-quiet assistant-btn"
            onClick={() => setShowHistoryModal(true)}
            title="View saved conversations"
          >
            <History size={15} />
            <span>History ({savedSessions.length})</span>
          </button>

          {/* Clear Current Button */}
          {messages.length > 0 && (
            <button
              className="button button-quiet assistant-btn text-danger"
              onClick={handleClearConversation}
              title="Clear current messages"
            >
              <Trash2 size={15} />
              <span>Clear</span>
            </button>
          )}
        </div>
      </header>

      {/* 2. Active Context Strip */}
      <section className="assistant-context-strip" aria-label="Active Context Summary">
        <div className="context-strip-item">
          <span className="context-kicker">Target:</span>
          <b>{currentProject ? currentProject.name : "All Workspace Projects"}</b>
        </div>
        {contextData?.health && (
          <div className="context-strip-item">
            <span className="context-kicker">Health:</span>
            <span
              className={`health-pill health-${(contextData.health.classification || "").toLowerCase()}`}
            >
              {contextData.health.score !== null ? `${contextData.health.score}/100` : "—"}{" "}
              ({contextData.health.classification})
            </span>
          </div>
        )}
        <div className="context-strip-item">
          <span className="context-kicker">Mode:</span>
          <span className="read-only-pill">Read-Only Grounded AI</span>
        </div>
      </section>

      {/* 3. Main Chat Container */}
      <div className="assistant-chat-container">
        {/* Messages Stream */}
        <div className="assistant-messages-scroll" role="log" aria-live="polite">
          {messages.length === 0 ? (
            <div className="assistant-empty-state">
              <div className="assistant-welcome-card">
                <div className="welcome-avatar-wrap">
                  <Bot size={32} />
                  <Sparkles size={14} className="welcome-sparkle" />
                </div>
                <h2>How can I help with your projects today?</h2>
                <p>
                  Ask questions about project deadlines, critical path blockers, project health scores, recent meeting
                  decisions, or team workload. All answers are 100% grounded in your actual workspace data.
                </p>

                {/* Suggested Questions Grid */}
                <div className="starter-questions-section">
                  <div className="starter-label">SUGGESTED QUESTIONS</div>
                  <div className="starter-grid">
                    {STARTER_PROMPTS.map((prompt, idx) => (
                      <button
                        key={idx}
                        className="starter-prompt-card"
                        onClick={() => handleSendMessage(prompt)}
                      >
                        <span className="prompt-text">{prompt}</span>
                        <ArrowRight size={14} className="prompt-arrow" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="assistant-messages-list">
              {messages.map((m, idx) => {
                const isUser = m.role === "user";
                const isLatestAssistant = !isUser && idx === messages.length - 1;

                return (
                  <div
                    key={m.id}
                    className={`assistant-message-row ${isUser ? "user-row" : "assistant-row"}`}
                  >
                    <div className="message-avatar">
                      {isUser ? (
                        <div className="user-avatar-badge" title={user?.name || "User"}>
                          <User size={15} />
                        </div>
                      ) : (
                        <div className="bot-avatar-badge" title="Nexora Assistant">
                          <Bot size={15} />
                        </div>
                      )}
                    </div>

                    <div className="message-body-wrap">
                      <div className="message-meta">
                        <span className="message-author">{isUser ? (user?.name || "You") : "Nexora Assistant"}</span>
                        <span className="message-time">
                          <Clock size={11} /> {new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                        {!isUser && (
                          <span className="message-provider-tag">
                            {m.provider === "openai" ? "OpenAI Grounded" : "Verified Workspace Engine"}
                          </span>
                        )}
                      </div>

                      {/* Content Box */}
                      <div className={`message-bubble ${isUser ? "user-bubble" : "assistant-bubble"}`}>
                        <div className="message-text markdown-render">
                          {renderStructuredMarkdown(m.content)}
                        </div>

                        {/* Citations & Evidence */}
                        {m.citations && m.citations.length > 0 && (
                          <div className="message-citations-block">
                            <div className="citations-header">
                              <CheckCircle2 size={13} className="citations-icon" />
                              <span>Verified Sources & Evidence ({m.citations.length})</span>
                            </div>
                            <div className="citations-grid">
                              {m.citations.map((c, cIdx) => (
                                <button
                                  key={cIdx}
                                  className="citation-pill"
                                  onClick={() => handleCitationClick(c)}
                                  title={`Open ${c.title}`}
                                >
                                  {getCitationIcon(c.type)}
                                  <span className="citation-title">{c.title}</span>
                                  <ExternalLink size={11} className="citation-link-icon" />
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Follow-up Prompts for Latest Assistant Response */}
                      {isLatestAssistant && m.suggestedFollowUps && m.suggestedFollowUps.length > 0 && !loading && (
                        <div className="message-followups">
                          <span className="followups-label">Suggested follow-ups:</span>
                          <div className="followups-chips">
                            {m.suggestedFollowUps.map((fu, fuIdx) => (
                              <button
                                key={fuIdx}
                                className="followup-chip"
                                onClick={() => handleSendMessage(fu)}
                              >
                                <span>{fu}</span>
                                <ArrowRight size={12} />
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Loading thinking indicator */}
              {loading && (
                <div className="assistant-message-row assistant-row">
                  <div className="message-avatar">
                    <div className="bot-avatar-badge pulsing">
                      <Bot size={15} />
                    </div>
                  </div>
                  <div className="message-body-wrap">
                    <div className="message-bubble assistant-bubble loading-bubble">
                      <div className="thinking-indicator">
                        <LoaderCircle size={16} className="spinner" />
                        <span>Consulting verified workspace records & critical path...</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Error banner */}
              {error && (
                <div className="assistant-error-banner" role="alert">
                  <AlertCircle size={16} />
                  <span>{error}</span>
                  <button className="button button-quiet btn-compact" onClick={() => handleSendMessage()}>
                    <RefreshCw size={12} /> Retry
                  </button>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* 4. Chat Input Box */}
        <div className="assistant-input-tray">
          <div className="input-tray-container">
            <textarea
              ref={textareaRef}
              className="assistant-textarea"
              placeholder={
                selectedProjectId
                  ? `Ask anything about ${currentProject?.name || "this project"} (e.g. "What is blocking progress?")...`
                  : "Ask about any workspace project, health score, or meeting decision..."
              }
              value={input}
              rows={1}
              onChange={e => {
                setInput(e.target.value);
                // Auto-resize up to 5 rows
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 130)}px`;
              }}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              disabled={loading}
              aria-label="Ask AI Assistant a question"
            />
            <button
              className="button button-primary send-btn"
              onClick={() => handleSendMessage()}
              disabled={loading || !input.trim()}
              aria-label="Send message"
            >
              {loading ? <LoaderCircle size={16} className="spinner" /> : <Send size={16} />}
            </button>
          </div>
          <div className="input-tray-footer">
            <small className="tray-hint">
              Press <b>Enter</b> to send, <b>Shift + Enter</b> for new line · Read-only grounded intelligence
            </small>
            {currentProject && (
              <span className="tray-context-tag">
                <Layers size={11} /> Context: {currentProject.name}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 5. History Modal */}
      {showHistoryModal && (
        <div className="modal-backdrop" onClick={() => setShowHistoryModal(false)}>
          <div className="modal-content history-modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <History size={18} style={{ color: "var(--accent)" }} />
                <h3>Conversation History</h3>
              </div>
              <button
                className="button button-quiet"
                onClick={() => setShowHistoryModal(false)}
                aria-label="Close history modal"
              >
                <X size={16} />
              </button>
            </div>

            <div className="history-modal-body">
              {savedSessions.length === 0 ? (
                <div className="history-empty">
                  <MessageSquare size={28} style={{ color: "var(--ink-muted)", margin: "0 auto 8px", display: "block" }} />
                  <p>No saved conversations yet.</p>
                  <small className="muted-copy">Your future conversations will appear here.</small>
                </div>
              ) : (
                <div className="history-sessions-list">
                  {savedSessions.map(session => (
                    <div
                      key={session.id}
                      className={`history-session-item ${session.id === currentSessionId ? "active" : ""}`}
                      onClick={() => handleSelectSession(session)}
                    >
                      <div className="session-item-left">
                        <MessageSquare size={16} className="session-icon" />
                        <div>
                          <b className="session-title">{session.title}</b>
                          <div className="session-meta">
                            <span>{session.projectName || "Workspace"}</span>
                            <span>·</span>
                            <span>{session.messages.length} messages</span>
                            <span>·</span>
                            <span>{new Date(session.updatedAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </div>
                      <button
                        className="session-delete-btn"
                        onClick={e => handleDeleteSession(session.id, e)}
                        title="Delete conversation"
                        aria-label="Delete conversation"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button
                className="button button-quiet"
                onClick={() => setShowHistoryModal(false)}
              >
                Close
              </button>
              <button
                className="button button-primary"
                onClick={() => {
                  handleNewConversation();
                  setShowHistoryModal(false);
                }}
              >
                <Plus size={14} /> Start New Chat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Helper: render icon for citation by type
function getCitationIcon(type: string) {
  switch (type) {
    case "project":
      return <Layers size={12} className="type-icon icon-project" />;
    case "task":
      return <CheckCircle2 size={12} className="type-icon icon-task" />;
    case "health":
    case "risk":
      return <ShieldAlert size={12} className="type-icon icon-risk" />;
    case "meeting":
      return <CalendarDays size={12} className="type-icon icon-meeting" />;
    case "member":
      return <User size={12} className="type-icon icon-member" />;
    default:
      return <Info size={12} className="type-icon icon-info" />;
  }
}

// Simple parser for markdown sections (bold, headers, lists, code)
function renderStructuredMarkdown(content: string) {
  if (!content) return null;

  const lines = content.split("\n");
  return (
    <div className="rendered-markdown-body">
      {lines.map((line, idx) => {
        const trimmed = line.trim();

        if (!trimmed) {
          return <div key={idx} className="md-spacer" />;
        }

        if (trimmed.startsWith("### ")) {
          return (
            <h4 key={idx} className="md-h4">
              {trimmed.slice(4)}
            </h4>
          );
        }

        if (trimmed.startsWith("## ")) {
          return (
            <h3 key={idx} className="md-h3">
              {trimmed.slice(3)}
            </h3>
          );
        }

        if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
          return (
            <div key={idx} className="md-bullet">
              <span className="md-bullet-dot">•</span>
              <span className="md-bullet-content">{formatInlineMarkdown(trimmed.slice(2))}</span>
            </div>
          );
        }

        if (/^\d+\.\s/.test(trimmed)) {
          const match = trimmed.match(/^(\d+)\.\s(.*)$/);
          return (
            <div key={idx} className="md-numbered">
              <span className="md-number">{match?.[1]}.</span>
              <span className="md-numbered-content">{formatInlineMarkdown(match?.[2] || "")}</span>
            </div>
          );
        }

        return (
          <p key={idx} className="md-paragraph">
            {formatInlineMarkdown(trimmed)}
          </p>
        );
      })}
    </div>
  );
}

function formatInlineMarkdown(text: string) {
  // Parse bold **text** and code `text`
  const parts: (string | React.ReactNode)[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Bold check using [\s\S] for cross-line/all chars without /s flag
    const boldMatch = remaining.match(/^([\s\S]*?)\*\*([\s\S]*?)\*\*([\s\S]*)$/);
    // Code check
    const codeMatch = remaining.match(/^([\s\S]*?)`([\s\S]*?)`([\s\S]*)$/);

    if (boldMatch && (!codeMatch || boldMatch[1].length <= codeMatch[1].length)) {
      if (boldMatch[1]) parts.push(boldMatch[1]);
      parts.push(<strong key={key++} className="md-bold">{boldMatch[2]}</strong>);
      remaining = boldMatch[3];
    } else if (codeMatch) {
      if (codeMatch[1]) parts.push(codeMatch[1]);
      parts.push(<code key={key++} className="md-code">{codeMatch[2]}</code>);
      remaining = codeMatch[3];
    } else {
      parts.push(remaining);
      break;
    }
  }

  return parts;
}
