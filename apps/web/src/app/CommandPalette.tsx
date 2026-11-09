"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  Bell,
  Blocks,
  Bot,
  CalendarDays,
  CheckCheck,
  GitBranch,
  LayoutDashboard,
  LogOut,
  Moon,
  Plus,
  Search,
  Settings2,
  ShieldAlert,
  Sparkles,
  Sun,
  Target,
  X,
} from "lucide-react";

export interface CommandItem {
  id: string;
  category: "Navigation" | "Quick Actions" | "Projects" | "System";
  label: string;
  badge?: string;
  icon: React.ReactNode;
  keywords?: string[];
  action: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (page: string) => void;
  onOpenModal: (modal: "project" | "task" | "plan" | "dependency" | "milestone") => void;
  projects: Array<{ id: string; name: string }>;
  onSelectProject: (projectId: string) => void;
  isDark: boolean;
  onToggleTheme: () => void;
  onSignOut: () => void;
}

export default function CommandPalette({
  isOpen,
  onClose,
  onNavigate,
  onOpenModal,
  projects,
  onSelectProject,
  isDark,
  onToggleTheme,
  onSignOut,
}: CommandPaletteProps) {
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const commands = useMemo<CommandItem[]>(() => {
    const list: CommandItem[] = [
      // Navigation
      {
        id: "nav-overview",
        category: "Navigation",
        label: "Go to Dashboard",
        badge: "Overview",
        icon: <LayoutDashboard size={16} />,
        keywords: ["home", "stats", "pulse", "metrics"],
        action: () => { onNavigate("Overview"); onClose(); },
      },
      {
        id: "nav-work",
        category: "Navigation",
        label: "Go to My Work (Kanban & Tasks)",
        badge: "Tasks",
        icon: <CheckCheck size={16} />,
        keywords: ["board", "kanban", "list", "todo", "backlog"],
        action: () => { onNavigate("My work"); onClose(); },
      },
      {
        id: "nav-projects",
        category: "Navigation",
        label: "Go to Projects",
        badge: "Projects",
        icon: <Blocks size={16} />,
        keywords: ["directory", "all projects"],
        action: () => { onNavigate("Projects"); onClose(); },
      },
      {
        id: "nav-health",
        category: "Navigation",
        label: "Project Health & Predictive Risks",
        badge: "Intelligence",
        icon: <ShieldAlert size={16} />,
        keywords: ["health", "risks", "predictive", "audit", "score", "gauge"],
        action: () => { onNavigate("Project Health"); onClose(); },
      },
      {
        id: "nav-calendar",
        category: "Navigation",
        label: "Calendar & Schedule Timeline",
        badge: "Calendar",
        icon: <CalendarDays size={16} />,
        keywords: ["schedule", "timeline", "dates", "events"],
        action: () => { onNavigate("Calendar"); onClose(); },
      },
      {
        id: "nav-meetings",
        category: "Navigation",
        label: "Meetings & Audio Intelligence",
        badge: "Meetings",
        icon: <CalendarDays size={16} />,
        keywords: ["recordings", "transcripts", "action items"],
        action: () => { onNavigate("Meetings"); onClose(); },
      },
      {
        id: "nav-ai-assistant",
        category: "Navigation",
        label: "AI Project Assistant (Chat)",
        badge: "Assistant",
        icon: <Bot size={16} />,
        keywords: ["assistant", "chat", "ask", "q&a", "conversation", "bot", "copilot"],
        action: () => { onNavigate("AI Assistant"); onClose(); },
      },
      {
        id: "nav-ai",
        category: "Navigation",
        label: "AI Command Center & Planner",
        badge: "AI",
        icon: <Sparkles size={16} />,
        keywords: ["planner", "ask", "citations", "brief", "intelligence"],
        action: () => { onNavigate("AI command"); onClose(); },
      },
      {
        id: "nav-inbox",
        category: "Navigation",
        label: "Inbox & Notifications",
        badge: "Inbox",
        icon: <Bell size={16} />,
        keywords: ["alerts", "unread", "notifications"],
        action: () => { onNavigate("Inbox"); onClose(); },
      },
      {
        id: "nav-activity",
        category: "Navigation",
        label: "Workspace Activity & Audit Trail",
        badge: "Audit",
        icon: <Activity size={16} />,
        keywords: ["history", "events", "audit log"],
        action: () => { onNavigate("Activity"); onClose(); },
      },
      {
        id: "nav-settings",
        category: "Navigation",
        label: "Settings & Integrations",
        badge: "Settings",
        icon: <Settings2 size={16} />,
        keywords: ["members", "github", "google", "storage", "retention"],
        action: () => { onNavigate("Settings"); onClose(); },
      },

      // Quick Actions
      {
        id: "action-new-task",
        category: "Quick Actions",
        label: "Create new task",
        badge: "Action",
        icon: <Plus size={16} />,
        keywords: ["add task", "new task", "todo"],
        action: () => { onOpenModal("task"); onClose(); },
      },
      {
        id: "action-new-project",
        category: "Quick Actions",
        label: "Start new project",
        badge: "Action",
        icon: <Plus size={16} />,
        keywords: ["add project", "new project"],
        action: () => { onOpenModal("project"); onClose(); },
      },
      {
        id: "action-milestone",
        category: "Quick Actions",
        label: "Add project milestone",
        badge: "Action",
        icon: <Target size={16} />,
        keywords: ["milestone", "target date", "deadline"],
        action: () => { onOpenModal("milestone"); onClose(); },
      },
      {
        id: "action-dependency",
        category: "Quick Actions",
        label: "Link task dependency",
        badge: "Action",
        icon: <GitBranch size={16} />,
        keywords: ["dependency", "blocker", "blocked by"],
        action: () => { onOpenModal("dependency"); onClose(); },
      },
      {
        id: "action-plan",
        category: "Quick Actions",
        label: "Generate AI project plan",
        badge: "AI Action",
        icon: <Sparkles size={16} />,
        keywords: ["plan", "brief", "draft"],
        action: () => { onOpenModal("plan"); onClose(); },
      },
    ];

    // Projects category
    projects.slice(0, 6).forEach(p => {
      list.push({
        id: `proj-${p.id}`,
        category: "Projects",
        label: `Switch to project: ${p.name}`,
        badge: "Project",
        icon: <Blocks size={16} />,
        keywords: [p.name.toLowerCase()],
        action: () => {
          onSelectProject(p.id);
          onNavigate("My work");
          onClose();
        },
      });
    });

    // System
    list.push({
      id: "sys-theme",
      category: "System",
      label: `Switch to ${isDark ? "Light" : "Dark"} mode`,
      badge: isDark ? "Light theme" : "Dark theme",
      icon: isDark ? <Sun size={16} /> : <Moon size={16} />,
      keywords: ["theme", "dark", "light", "mode", "color"],
      action: () => { onToggleTheme(); onClose(); },
    });

    list.push({
      id: "sys-logout",
      category: "System",
      label: "Sign out of workspace",
      badge: "Account",
      icon: <LogOut size={16} />,
      keywords: ["logout", "exit", "sign out"],
      action: () => { onSignOut(); onClose(); },
    });

    return list;
  }, [projects, isDark, onNavigate, onOpenModal, onSelectProject, onToggleTheme, onSignOut, onClose]);

  const filteredCommands = useMemo(() => {
    if (!search.trim()) return commands;
    const query = search.toLowerCase().trim();
    return commands.filter(cmd =>
      cmd.label.toLowerCase().includes(query) ||
      cmd.category.toLowerCase().includes(query) ||
      cmd.keywords?.some(k => k.includes(query))
    );
  }, [commands, search]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [search]);

  useEffect(() => {
    if (isOpen) {
      setSearch("");
      setSelectedIndex(0);
      window.setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % Math.max(1, filteredCommands.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + filteredCommands.length) % Math.max(1, filteredCommands.length));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filteredCommands[selectedIndex]) {
          filteredCommands[selectedIndex].action();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, selectedIndex, filteredCommands, onClose]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const selectedEl = listRef.current.querySelector(".command-item.selected") as HTMLElement;
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  // Group commands by category for clear visual organization
  const categories = Array.from(new Set(filteredCommands.map(c => c.category)));

  let globalIndexCounter = 0;

  return (
    <div
      className="command-backdrop"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
    >
      <div className="command-dialog">
        <div className="command-search-wrap">
          <Search size={18} />
          <input
            ref={inputRef}
            className="command-search-input"
            placeholder="Type a command or search workspace views..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Search commands"
          />
          {search && (
            <button
              className="icon-button"
              style={{ width: "24px", height: "24px" }}
              onClick={() => setSearch("")}
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
          <kbd>ESC</kbd>
        </div>

        <div className="command-list" ref={listRef}>
          {filteredCommands.length === 0 ? (
            <div className="search-empty">
              No matching commands or actions found for &ldquo;{search}&rdquo;.
            </div>
          ) : (
            categories.map(cat => {
              const catCommands = filteredCommands.filter(c => c.category === cat);
              return (
                <div key={cat} className="command-group">
                  <div className="command-group-title">{cat}</div>
                  {catCommands.map(cmd => {
                    const thisIndex = globalIndexCounter++;
                    const isSelected = thisIndex === selectedIndex;
                    return (
                      <button
                        key={cmd.id}
                        className={`command-item ${isSelected ? "selected" : ""}`}
                        onClick={cmd.action}
                        onMouseEnter={() => setSelectedIndex(thisIndex)}
                      >
                        {cmd.icon}
                        <span className="command-item-label">{cmd.label}</span>
                        {cmd.badge && <span className="command-item-badge">{cmd.badge}</span>}
                        <ArrowRight size={13} style={{ opacity: isSelected ? 0.8 : 0.3 }} />
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        <div className="command-footer">
          <div className="command-footer-hints">
            <span><kbd>↑</kbd> <kbd>↓</kbd> navigate</span>
            <span><kbd>↵</kbd> select</span>
            <span><kbd>esc</kbd> close</span>
          </div>
          <span>Nexora Command System</span>
        </div>
      </div>
    </div>
  );
}
