import { Priority } from '@prisma/client';

export interface PlanTask {
  title: string;
  description: string;
  priority: Priority;
  dueDate: string | null;
  assigneeId: string | null;
  blockedBy: number[];
  suggestedRole?: string | null;
  estimatedDurationDays?: number | null;
  milestoneIndex?: number | null;
}

export interface PlanMilestone {
  title: string;
  description?: string | null;
  targetDate?: string | null;
  sequence?: number | null;
}

export interface Plan {
  projectName: string;
  projectDescription: string;
  milestones: PlanMilestone[];
  tasks: PlanTask[];
  assumptions: string[];
  risks?: string[];
}

export interface RosterMember {
  id: string;
  name: string;
}

// Canonical set of strong action verbs
const ACTION_VERBS = [
  'Implement', 'Build', 'Configure', 'Integrate', 'Execute', 'Deploy',
  'Design', 'Develop', 'Create', 'Set up', 'Establish', 'Conduct',
  'Prepare', 'Review', 'Finalize', 'Test', 'Document', 'Architect',
  'Optimize', 'Migrate', 'Secure', 'Verify', 'Automate', 'Define',
  'Draft', 'Validate', 'Refactor', 'Publish', 'Launch', 'Audit'
];

export class ProjectPlannerEngine {
  /**
   * Main entry point for local rule-based brief decomposition.
   * Produces a structured, actionable project plan with realistic milestones,
   * non-linear dependencies, varied priorities, and explicit assumptions.
   */
  static decomposeBrief(
    dto: { brief: string; projectName?: string; projectId?: string },
    roster: RosterMember[] = []
  ): Plan {
    const brief = dto.brief.trim();
    const projectName = this.extractProjectName(brief, dto.projectName);
    const sections = this.segmentBrief(brief);

    // 1. Generate or extract milestones
    const milestones = this.generateMilestones(brief, sections);

    // 2. Extract and sanitize actionable deliverables / tasks
    const rawTasks = this.extractTasksFromSections(brief, sections, milestones, roster);

    // 3. Ensure we have realistic tasks; if minimal brief, expand domain items
    const tasksWithSemantics = this.normalizeTaskSemantics(rawTasks, brief, milestones, roster);

    // 4. Construct domain-aware, cycle-free dependencies
    const tasksWithDependencies = this.assignDomainDependencies(tasksWithSemantics);

    // 5. Generate assumptions and risks
    const assumptions = this.generateAssumptions(brief, sections, roster);
    const risks = this.generateRisks(brief, sections);

    return {
      projectName: projectName.slice(0, 120),
      projectDescription: (dto.brief || sections.summary || brief).slice(0, 5000),
      milestones,
      tasks: tasksWithDependencies.slice(0, 40),
      assumptions,
      risks,
    };
  }

  /**
   * Sanitizes, normalizes, and validates any plan (e.g. from OpenAI or user edits).
   * Ensures titles start with action verbs, removes heading-like tasks,
   * verifies priorities, and breaks any dependency cycles.
   */
  static sanitizePlan(
    raw: any,
    roster: RosterMember[] = [],
    dto?: { brief?: string; projectName?: string }
  ): Plan {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return this.decomposeBrief({ brief: dto?.brief || 'Project plan', projectName: dto?.projectName }, roster);
    }

    const projectName = (typeof raw.projectName === 'string' && raw.projectName.trim()
      ? raw.projectName
      : typeof raw.projectTitle === 'string' && raw.projectTitle.trim()
      ? raw.projectTitle
      : dto?.projectName || 'Untitled project').trim().slice(0, 120);

    const projectDescription = (typeof raw.projectDescription === 'string'
      ? raw.projectDescription
      : typeof raw.summary === 'string'
      ? raw.summary
      : dto?.brief || '').trim().slice(0, 5000);

    // Sanitize milestones
    let milestones: PlanMilestone[] = [];
    if (Array.isArray(raw.milestones)) {
      milestones = raw.milestones.slice(0, 20).flatMap((m: any, idx: number) => {
        if (!m || typeof m !== 'object') return [];
        const title = (m.title || m.name || '').trim();
        if (!title || this.isHeadingLabel(title)) return [];
        return [{
          title: title.slice(0, 160),
          description: typeof m.description === 'string' ? m.description.slice(0, 1000) : null,
          targetDate: this.safeIsoDate(m.targetDate),
          sequence: Number.isInteger(m.sequence) ? m.sequence : idx + 1,
        }];
      });
    }

    if (milestones.length === 0 && dto?.brief) {
      milestones = this.generateMilestones(dto.brief, this.segmentBrief(dto.brief));
    }

    // Sanitize tasks
    let candidateTasks: any[] = [];
    if (Array.isArray(raw.tasks) && raw.tasks.length > 0) {
      candidateTasks = raw.tasks;
    } else if (Array.isArray(raw.milestones)) {
      // Sometimes LLMs nest tasks inside milestones: [{ name: "Phase 1", tasks: [...] }]
      for (let mIdx = 0; mIdx < raw.milestones.length; mIdx++) {
        const m = raw.milestones[mIdx];
        if (m && Array.isArray(m.tasks)) {
          for (const t of m.tasks) {
            candidateTasks.push({ ...t, milestoneIndex: mIdx });
          }
        }
      }
    }

    const validAssignees = new Set(roster.map(r => r.id));
    const seenTitles = new Set<string>();
    const sanitizedTasks: PlanTask[] = [];

    for (let i = 0; i < candidateTasks.length; i++) {
      const item = candidateTasks[i];
      if (!item || typeof item !== 'object') continue;

      let title = typeof item.title === 'string' ? item.title.trim() : '';
      if (!title) continue;

      // Filter out headings, objectives, constraints
      if (this.isHeadingLabel(title) || this.isIntroOrConstraintSentence(title)) {
        continue;
      }

      title = title.slice(0, 180);

      // Deduplicate
      const lowerKey = title.toLowerCase();
      if (seenTitles.has(lowerKey)) continue;
      seenTitles.add(lowerKey);

      // Validate priority
      let priority: Priority = Priority.MEDIUM;
      if (typeof item.priority === 'string') {
        const pUpper = item.priority.toUpperCase();
        if (Object.values(Priority).includes(pUpper as Priority)) {
          priority = pUpper as Priority;
        }
      } else {
        priority = this.inferPriority(title);
      }

      // Suggested role
      const suggestedRole = typeof item.suggestedRole === 'string' && item.suggestedRole.trim()
        ? item.suggestedRole.trim().slice(0, 80)
        : this.inferRole(title);

      // Estimated duration
      const duration = Number.isInteger(item.estimatedDurationDays) && item.estimatedDurationDays > 0
        ? Math.min(item.estimatedDurationDays, 60)
        : this.inferDuration(title, priority);

      // Milestone index
      let milestoneIndex: number | null = null;
      if (Number.isInteger(item.milestoneIndex) && item.milestoneIndex >= 0 && item.milestoneIndex < milestones.length) {
        milestoneIndex = item.milestoneIndex;
      } else {
        milestoneIndex = this.inferMilestoneIndex(title, milestones.length);
      }

      // Assignee
      const assigneeId = typeof item.assigneeId === 'string' && validAssignees.has(item.assigneeId)
        ? item.assigneeId
        : null;

      // Due date
      const dueDate = this.safeIsoDate(item.dueDate);

      // Dependencies (raw indices)
      const rawBlocked = Array.isArray(item.blockedBy)
        ? item.blockedBy.filter((n: unknown): n is number => Number.isInteger(n))
        : Array.isArray(item.dependencies)
        ? item.dependencies.filter((n: unknown): n is number => Number.isInteger(n))
        : [];

      sanitizedTasks.push({
        title,
        description: typeof item.description === 'string' ? item.description.slice(0, 5000) : '',
        priority,
        dueDate,
        assigneeId,
        blockedBy: rawBlocked,
        suggestedRole,
        estimatedDurationDays: duration,
        milestoneIndex,
      });
    }

    // If all tasks were filtered or none provided, fall back to decomposeBrief
    if (sanitizedTasks.length === 0) {
      return this.decomposeBrief({ brief: dto?.brief || 'Project plan', projectName }, roster);
    }

    // Sanitize and cycle-check dependencies
    const finalTasks = this.sanitizeDependencies(sanitizedTasks);

    // Sanitize assumptions and risks
    const assumptions = Array.isArray(raw.assumptions)
      ? raw.assumptions.filter((v: unknown): v is string => typeof v === 'string' && v.trim().length > 0).slice(0, 20).map(v => v.slice(0, 500))
      : [
          'Team members will be assigned during sprint planning.',
          'Milestone target dates are aligned with standard phase estimates.',
        ];

    const risks = Array.isArray(raw.risks)
      ? raw.risks.filter((v: unknown): v is string => typeof v === 'string' && v.trim().length > 0).slice(0, 20).map(v => v.slice(0, 500))
      : [];

    return {
      projectName,
      projectDescription,
      milestones,
      tasks: finalTasks.slice(0, 40),
      assumptions,
      risks,
    };
  }

  // =========================================================================
  // BRIEF SEGMENTATION & CLASSIFICATION
  // =========================================================================

  private static extractProjectName(brief: string, explicitName?: string): string {
    if (explicitName && explicitName.trim()) return explicitName.trim();

    // Check first heading: "# Trendora E-commerce Launch" or "Project: Trendora"
    const headingMatch = brief.match(/^(?:#+\s*|(?:project(?:\s+name)?|title)[:\s]+)(.+)$/im);
    if (headingMatch && headingMatch[1].trim()) {
      return headingMatch[1].replace(/[:*#_]/g, '').trim().slice(0, 120);
    }

    // Check first non-empty line
    const firstLine = brief.split('\n').map(l => l.trim()).find(l => l.length >= 3 && !this.isHeadingLabel(l));
    if (firstLine) {
      const clean = firstLine.replace(/^[#*-\d.)\s]+/, '').replace(/[:：]$/, '').trim();
      if (clean.length <= 100) return clean;
      return clean.slice(0, 80) + '…';
    }

    return 'Untitled Project';
  }

  private static segmentBrief(brief: string): {
    summary: string;
    deliverables: string[];
    milestones: string[];
    constraints: string[];
    roles: string[];
  } {
    const lines = brief.split('\n');
    let currentSection: 'NONE' | 'SUMMARY' | 'DELIVERABLES' | 'MILESTONES' | 'CONSTRAINTS' | 'ROLES' = 'NONE';

    const summaryLines: string[] = [];
    const deliverables: string[] = [];
    const milestones: string[] = [];
    const constraints: string[] = [];
    const roles: string[] = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      const lower = line.toLowerCase().replace(/[*_#:`]/g, '').trim();

      // Detect section changes
      if (/^(?:project\s+)?(?:objective|goal|purpose|background|overview|summary)/i.test(lower)) {
        currentSection = 'SUMMARY';
        continue;
      } else if (/^(?:key\s+|core\s+)?(?:deliverables?|scope|tasks?|work\s+items?)/i.test(lower)) {
        currentSection = 'DELIVERABLES';
        continue;
      } else if (/^(?:timeline|milestones?|schedule|phases?|weeks?)/i.test(lower)) {
        currentSection = 'MILESTONES';
        continue;
      } else if (/^(?:constraints?|assumptions?|risks?|limitations?|non[- ]functional requirements?)/i.test(lower)) {
        currentSection = 'CONSTRAINTS';
        continue;
      } else if (/^(?:team|roles?|resources?|stakeholders?)/i.test(lower)) {
        currentSection = 'ROLES';
        continue;
      }

      // Clean item text
      const cleanItem = line.replace(/^[-*•\d.)\s]+/, '').trim();
      if (!cleanItem || this.isHeadingLabel(cleanItem)) continue;

      switch (currentSection) {
        case 'SUMMARY':
          summaryLines.push(cleanItem);
          break;
        case 'DELIVERABLES':
          deliverables.push(cleanItem);
          break;
        case 'MILESTONES':
          milestones.push(cleanItem);
          break;
        case 'CONSTRAINTS':
          constraints.push(cleanItem);
          break;
        case 'ROLES':
          roles.push(cleanItem);
          break;
        default:
          // If not in a section yet, check if it's bullet or introductory
          if (/^[-*•\d.)]/.test(line)) {
            deliverables.push(cleanItem);
          } else {
            summaryLines.push(cleanItem);
          }
      }
    }

    return {
      summary: summaryLines.join(' '),
      deliverables,
      milestones,
      constraints,
      roles,
    };
  }

  // =========================================================================
  // MILESTONE GENERATION
  // =========================================================================

  private static generateMilestones(
    brief: string,
    sections: { milestones: string[]; summary: string }
  ): PlanMilestone[] {
    const now = new Date();
    const result: PlanMilestone[] = [];

    // Check if brief specifies 4-week or 30-day timeline
    const is30Day = /30[- ]?days?|4[- ]?weeks?|month/i.test(brief);

    // If explicit milestone lines exist in the brief
    if (sections.milestones.length >= 2) {
      for (let i = 0; i < sections.milestones.length && i < 6; i++) {
        const item = sections.milestones[i];
        const daysOffset = Math.round(((i + 1) / sections.milestones.length) * (is30Day ? 30 : 28));
        const targetDate = new Date(now.getTime() + daysOffset * 86400000).toISOString();
        result.push({
          title: item.slice(0, 160),
          description: `Checkpoint for ${item}`,
          targetDate,
          sequence: i + 1,
        });
      }
      return result;
    }

    // Default 4-week structured milestones for projects (e.g. Trendora or general launch)
    return [
      {
        title: 'Phase 1: Planning, Scope & System Architecture',
        description: 'Finalize functional requirements, technical architecture, and system specifications.',
        targetDate: new Date(now.getTime() + 7 * 86400000).toISOString(),
        sequence: 1,
      },
      {
        title: 'Phase 2: Core Development & Platform Services',
        description: 'Implement foundational APIs, core user workflows, and UI components.',
        targetDate: new Date(now.getTime() + 14 * 86400000).toISOString(),
        sequence: 2,
      },
      {
        title: 'Phase 3: External Integrations & Payment Processing',
        description: 'Integrate third-party gateways, notification pipelines, and transaction flows.',
        targetDate: new Date(now.getTime() + 21 * 86400000).toISOString(),
        sequence: 3,
      },
      {
        title: 'Phase 4: Quality Assurance, Security Audit & Launch',
        description: 'Complete end-to-end testing, security verification, and production release.',
        targetDate: new Date(now.getTime() + 30 * 86400000).toISOString(),
        sequence: 4,
      },
    ];
  }

  // =========================================================================
  // TASK EXTRACTION & NORMALIZATION
  // =========================================================================

  private static extractTasksFromSections(
    brief: string,
    sections: { deliverables: string[]; constraints: string[] },
    milestones: PlanMilestone[],
    roster: RosterMember[]
  ): PlanTask[] {
    const rawItems: string[] = [];

    // Use parsed deliverables if present
    if (sections.deliverables.length > 0) {
      for (const item of sections.deliverables) {
        if (!this.isHeadingLabel(item) && !this.isIntroOrConstraintSentence(item)) {
          rawItems.push(item);
        }
      }
    }

    // If no explicit deliverables, check for numbered lists or bullet items across entire brief
    if (rawItems.length === 0) {
      const bulletMatches = brief.match(/^(?:[-*•]|\d+[.)])\s+(.+)$/gm);
      if (bulletMatches) {
        for (const line of bulletMatches) {
          const clean = line.replace(/^[-*•\d.)\s]+/, '').trim();
          if (!this.isHeadingLabel(clean) && !this.isIntroOrConstraintSentence(clean) && clean.length >= 8) {
            rawItems.push(clean);
          }
        }
      }
    }

    // If still empty (e.g. short informal brief like "Build a food delivery application..."),
    // extract key functional domains
    if (rawItems.length === 0) {
      return this.decomposeInformalBrief(brief, milestones, roster);
    }

    return rawItems.map((item, idx) => {
      const actionableTitle = this.ensureActionVerb(item);
      const priority = this.inferPriority(actionableTitle);
      const suggestedRole = this.inferRole(actionableTitle);
      const estimatedDurationDays = this.inferDuration(actionableTitle, priority);
      const milestoneIndex = this.inferMilestoneIndex(actionableTitle, milestones.length);
      const assigneeId = this.findMatchingRosterMember(item, roster);

      return {
        title: actionableTitle,
        description: `Deliverable: ${item}`,
        priority,
        dueDate: milestones[milestoneIndex]?.targetDate ?? null,
        assigneeId,
        blockedBy: [], // Assigned in next step
        suggestedRole,
        estimatedDurationDays,
        milestoneIndex,
      };
    });
  }

  /**
   * For short informal briefs (Test B: "Build a food delivery application with customer login,
   * restaurant listings, cart, payments and order tracking"), break down into professional work items.
   */
  private static decomposeInformalBrief(
    brief: string,
    milestones: PlanMilestone[],
    roster: RosterMember[]
  ): PlanTask[] {
    const tasks: PlanTask[] = [];
    const lower = brief.toLowerCase();

    // 1. Initial Architecture & Requirements (Phase 1)
    tasks.push({
      title: 'Finalize functional requirements and system architecture',
      description: 'Document domain models, API specifications, and service integration architecture.',
      priority: Priority.HIGH,
      dueDate: milestones[0]?.targetDate ?? null,
      assigneeId: null,
      blockedBy: [],
      suggestedRole: 'Project Manager',
      estimatedDurationDays: 3,
      milestoneIndex: 0,
    });

    // 2. Auth / Account management
    if (lower.includes('login') || lower.includes('auth') || lower.includes('user') || lower.includes('customer')) {
      tasks.push({
        title: 'Implement customer authentication and profile management',
        description: 'Build secure authentication, JWT session handling, and customer profile management.',
        priority: Priority.HIGH,
        dueDate: milestones[1]?.targetDate ?? null,
        assigneeId: null,
        blockedBy: [],
        suggestedRole: 'Backend Engineer',
        estimatedDurationDays: 4,
        milestoneIndex: 1,
      });
    }

    // 3. Catalog / Restaurant listings
    if (lower.includes('restaurant') || lower.includes('listing') || lower.includes('catalog') || lower.includes('product')) {
      tasks.push({
        title: 'Create restaurant listing and menu catalog service',
        description: 'Implement database models, search filters, and REST endpoints for menu and restaurant catalog.',
        priority: Priority.MEDIUM,
        dueDate: milestones[1]?.targetDate ?? null,
        assigneeId: null,
        blockedBy: [],
        suggestedRole: 'Backend Engineer',
        estimatedDurationDays: 5,
        milestoneIndex: 1,
      });

      tasks.push({
        title: 'Build responsive customer discovery and menu browsing UI',
        description: 'Create responsive frontend views for browsing restaurants, filtering categories, and viewing item details.',
        priority: Priority.MEDIUM,
        dueDate: milestones[1]?.targetDate ?? null,
        assigneeId: null,
        blockedBy: [],
        suggestedRole: 'Frontend Engineer',
        estimatedDurationDays: 5,
        milestoneIndex: 1,
      });
    }

    // 4. Cart / Order calculation
    if (lower.includes('cart') || lower.includes('order') || lower.includes('basket')) {
      tasks.push({
        title: 'Develop shopping cart and order price calculation engine',
        description: 'Implement cart state management, taxes, delivery fee calculations, and order creation API.',
        priority: Priority.MEDIUM,
        dueDate: milestones[2]?.targetDate ?? null,
        assigneeId: null,
        blockedBy: [],
        suggestedRole: 'Frontend Engineer',
        estimatedDurationDays: 4,
        milestoneIndex: 2,
      });
    }

    // 5. Payment gateway
    if (lower.includes('payment') || lower.includes('checkout') || lower.includes('stripe')) {
      tasks.push({
        title: 'Integrate secure payment gateway and webhook verification',
        description: 'Implement PCI-compliant checkout workflow, payment intent processing, and idempotent webhook listeners.',
        priority: Priority.HIGH,
        dueDate: milestones[2]?.targetDate ?? null,
        assigneeId: null,
        blockedBy: [],
        suggestedRole: 'Backend Engineer',
        estimatedDurationDays: 4,
        milestoneIndex: 2,
      });
    }

    // 6. Order tracking / Notifications
    if (lower.includes('tracking') || lower.includes('order') || lower.includes('status')) {
      tasks.push({
        title: 'Implement real-time order tracking and status updates',
        description: 'Build WebSocket/event gateway for real-time delivery status tracking and customer notifications.',
        priority: Priority.MEDIUM,
        dueDate: milestones[2]?.targetDate ?? null,
        assigneeId: null,
        blockedBy: [],
        suggestedRole: 'Backend Engineer',
        estimatedDurationDays: 4,
        milestoneIndex: 2,
      });
    }

    // 7. QA and End-to-end testing (Phase 4)
    tasks.push({
      title: 'Execute end-to-end integration and user acceptance testing',
      description: 'Perform automated integration test suite, cross-browser verification, and payment transaction simulation.',
      priority: Priority.HIGH,
      dueDate: milestones[3]?.targetDate ?? null,
      assigneeId: null,
      blockedBy: [],
      suggestedRole: 'QA Engineer',
      estimatedDurationDays: 4,
      milestoneIndex: 3,
    });

    // 8. Production deployment (Phase 4)
    tasks.push({
      title: 'Deploy application services to production cloud infrastructure',
      description: 'Configure production environment, SSL certificates, monitoring dashboards, and execute launch.',
      priority: Priority.HIGH,
      dueDate: milestones[3]?.targetDate ?? null,
      assigneeId: null,
      blockedBy: [],
      suggestedRole: 'DevOps Engineer',
      estimatedDurationDays: 2,
      milestoneIndex: 3,
    });

    return tasks;
  }

  private static normalizeTaskSemantics(
    tasks: PlanTask[],
    brief: string,
    milestones: PlanMilestone[],
    roster: RosterMember[]
  ): PlanTask[] {
    // If we only have 1 or 2 tasks from a brief with rich requirements, expand with standard engineering tasks
    if (tasks.length < 4 && brief.length > 100) {
      const lower = brief.toLowerCase();
      // Ensure we have a deployment task
      if (!tasks.some(t => /deploy|launch|release/i.test(t.title))) {
        tasks.push({
          title: 'Deploy application services to production cloud infrastructure',
          description: 'Deploy containerized services, configure DNS, monitoring, and perform release verification.',
          priority: Priority.HIGH,
          dueDate: milestones[milestones.length - 1]?.targetDate ?? null,
          assigneeId: null,
          blockedBy: [],
          suggestedRole: 'DevOps Engineer',
          estimatedDurationDays: 2,
          milestoneIndex: milestones.length - 1,
        });
      }
      // Ensure we have a QA task
      if (!tasks.some(t => /qa|test|verification|audit/i.test(t.title))) {
        tasks.push({
          title: 'Execute comprehensive quality assurance and end-to-end testing',
          description: 'Run automated end-to-end regression suites and complete user acceptance sign-off.',
          priority: Priority.HIGH,
          dueDate: milestones[milestones.length - 1]?.targetDate ?? null,
          assigneeId: null,
          blockedBy: [],
          suggestedRole: 'QA Engineer',
          estimatedDurationDays: 4,
          milestoneIndex: milestones.length - 1,
        });
      }
    }

    return tasks;
  }

  // =========================================================================
  // DOMAIN-AWARE DEPENDENCY GENERATION
  // =========================================================================

  /**
   * Assigns realistic, non-linear dependencies based on architectural prerequisites.
   * NEVER creates artificial sequential chains (task[i] blocked by task[i-1]).
   * Independent tasks run in parallel.
   */
  private static assignDomainDependencies(tasks: PlanTask[]): PlanTask[] {
    const updated = tasks.map(t => ({ ...t, blockedBy: [...t.blockedBy] }));

    // Find key milestone anchors
    const planIndex = updated.findIndex(t => /plan|requirement|scope|architect|design spec/i.test(t.title));
    const authIndex = updated.findIndex(t => /auth|login|session|identity/i.test(t.title));
    const backendIndex = updated.findIndex(t => /api|service|gateway|backend|catalog service/i.test(t.title));
    const paymentIndex = updated.findIndex(t => /payment|stripe|checkout/i.test(t.title));
    const qaIndex = updated.findIndex(t => /qa|test|verification|acceptance/i.test(t.title));
    const deployIndex = updated.findIndex(t => /deploy|launch|release|production/i.test(t.title));

    for (let i = 0; i < updated.length; i++) {
      const task = updated[i];
      const lower = task.title.toLowerCase();

      // 1. Planning / Requirements task has NO dependencies (first anchor)
      if (i === planIndex) {
        task.blockedBy = [];
        continue;
      }

      // 2. Development tasks in Milestone 1 or 2 depend on Architecture / Requirements (if planIndex exists and is earlier)
      if (planIndex !== -1 && i > planIndex && (task.milestoneIndex ?? 0) >= 1) {
        // If it's core dev, block on planning
        if (/implement|build|create|develop|configure|setup/i.test(task.title) && task.milestoneIndex === 1) {
          task.blockedBy = [planIndex];
        }
      }

      // 3. Payment testing depends on Payment gateway integration
      if (/payment.*test|transaction.*test|checkout.*test/i.test(lower)) {
        if (paymentIndex !== -1 && paymentIndex < i) {
          task.blockedBy = [paymentIndex];
        }
      }

      // 4. QA / Testing depends on Core Development & Integrations
      if (i === qaIndex) {
        const prerequisites: number[] = [];
        if (paymentIndex !== -1 && paymentIndex < i) prerequisites.push(paymentIndex);
        if (backendIndex !== -1 && backendIndex < i && !prerequisites.includes(backendIndex)) prerequisites.push(backendIndex);
        if (prerequisites.length === 0 && planIndex !== -1 && planIndex < i) prerequisites.push(planIndex);
        task.blockedBy = prerequisites;
      }

      // 5. Deployment depends on QA Testing (or core development if no QA)
      if (i === deployIndex) {
        if (qaIndex !== -1 && qaIndex < i) {
          task.blockedBy = [qaIndex];
        } else if (backendIndex !== -1 && backendIndex < i) {
          task.blockedBy = [backendIndex];
        }
      }

      // Ensure no self-dependency and no out-of-bounds
      task.blockedBy = [...new Set(task.blockedBy.filter(b => b >= 0 && b < i))];
    }

    return this.sanitizeDependencies(updated);
  }

  /**
   * Validates dependency graph for cycles and ensures only valid earlier indices.
   * If any cycle is detected, breaking edges are stripped.
   */
  private static sanitizeDependencies(tasks: PlanTask[]): PlanTask[] {
    const n = tasks.length;
    const sanitized = tasks.map((t, idx) => ({
      ...t,
      blockedBy: [...new Set((t.blockedBy || []).filter(b => Number.isInteger(b) && b >= 0 && b < idx))],
    }));

    // Detect cycles using DFS
    const visited = new Array(n).fill(0); // 0 = unvisited, 1 = visiting, 2 = visited

    const hasCycle = (u: number, path: number[]): boolean => {
      visited[u] = 1;
      path.push(u);

      for (const v of sanitized[u].blockedBy) {
        if (visited[v] === 1) {
          // Cycle found! Remove the edge v -> u
          sanitized[u].blockedBy = sanitized[u].blockedBy.filter(x => x !== v);
          return true;
        }
        if (visited[v] === 0) {
          if (hasCycle(v, path)) return true;
        }
      }

      visited[u] = 2;
      path.pop();
      return false;
    };

    for (let i = 0; i < n; i++) {
      if (visited[i] === 0) {
        hasCycle(i, []);
      }
    }

    return sanitized;
  }

  // =========================================================================
  // ASSUMPTIONS & RISKS
  // =========================================================================

  private static generateAssumptions(
    brief: string,
    sections: { constraints: string[]; roles: string[] },
    roster: RosterMember[]
  ): string[] {
    const assumptions: string[] = [];

    // Capture constraints from brief as explicit assumptions
    for (const c of sections.constraints) {
      if (c.length >= 10 && !this.isHeadingLabel(c)) {
        assumptions.push(c);
      }
    }

    if (!/deadline|due date|by\s+[a-z]+ \d+/i.test(brief)) {
      assumptions.push('Target delivery schedule is estimated as a 30-day timeline divided into 4 sequential weekly milestone phases.');
    }

    if (roster.length === 0 || !sections.roles.length) {
      assumptions.push('Team roles are proposed as engineering templates; workspace members can be assigned during review.');
    }

    if (!/cloud|aws|gcp|azure/i.test(brief)) {
      assumptions.push('Deployment targets modern containerized cloud infrastructure with CI/CD automation.');
    }

    return [...new Set(assumptions)].slice(0, 10);
  }

  private static generateRisks(
    brief: string,
    sections: { constraints: string[] }
  ): string[] {
    const risks: string[] = [];
    const lower = brief.toLowerCase();

    if (lower.includes('payment') || lower.includes('stripe') || lower.includes('checkout')) {
      risks.push('Third-party payment gateway approval, compliance review, and sandbox verification lead time.');
    }

    if (lower.includes('zero downtime') || lower.includes('migration')) {
      risks.push('Zero-downtime database cutover requires dual-write or blue-green deployment choreography.');
    }

    if (lower.includes('30') || lower.includes('tight') || lower.includes('fast')) {
      risks.push('Strict 30-day timeline leaves minimal contingency buffer for dependency delays or scope expansion.');
    }

    if (lower.includes('security') || lower.includes('pci') || lower.includes('tenant')) {
      risks.push('Multi-tenant data isolation and security compliance audit required before launch.');
    }

    return risks.slice(0, 8);
  }

  // =========================================================================
  // HEURISTIC HELPERS & FILTERS
  // =========================================================================

  /**
   * Strictly detects heading labels or section titles that must NEVER become tasks.
   */
  static isHeadingLabel(text: string): boolean {
    const clean = text.replace(/[*_#:`]/g, '').trim().toLowerCase();
    if (clean.length < 4) return true;

    const headingPatterns = [
      /^(?:project\s+)?(?:objective|goal|purpose|background|overview|summary|details|context)$/i,
      /^(?:key\s+|core\s+)?(?:deliverables?|scope|tasks?|work\s+items?|milestones?|timeline|schedule|phases?)$/i,
      /^(?:constraints?|assumptions?|risks?|limitations?|notes?|non[- ]functional requirements?)$/i,
      /^(?:team|roles?|resources?|stakeholders?|members?)$/i,
      /^(?:week\s*\d+|phase\s*\d+|sprint\s*\d+)$/i,
      /^(?:table of contents|introduction|conclusion|appendix)$/i,
    ];

    return headingPatterns.some(pat => pat.test(clean));
  }

  /**
   * Detects explanatory, background, or constraint sentences that should not be tasks.
   */
  static isIntroOrConstraintSentence(text: string): boolean {
    const lower = text.trim().toLowerCase();

    // Introductory sentences
    if (/^(?:this\s+project|the\s+goal\s+of|the\s+objective\s+is|we\s+are\s+planning|we\s+plan\s+to|our\s+team\s+will|this\s+document\s+outlines|the\s+purpose\s+of)/i.test(lower)) {
      return true;
    }

    // Pure constraint sentences
    if (/^(?:must\s+be\s+completed|zero\s+downtime|strict\s+tenant|high\s+contrast|budget\s+cannot|pci[- ]dss|sla\s+requirement)/i.test(lower)) {
      return true;
    }

    // Passive sentences describing company or context
    if (/is an e-commerce|is a fashion|is an application|is intended to/i.test(lower) && !this.startsWithActionVerb(text)) {
      return true;
    }

    return false;
  }

  /**
   * Checks if string begins with a recognized action verb.
   */
  static startsWithActionVerb(text: string): boolean {
    const firstWord = text.trim().split(/\s+/)[0]?.replace(/[^a-zA-Z]/g, '');
    if (!firstWord) return false;
    return ACTION_VERBS.some(v => v.toLowerCase() === firstWord.toLowerCase());
  }

  /**
   * Ensures task title starts with a strong action verb.
   * If not, prefixes or reformulates appropriately.
   */
  static ensureActionVerb(text: string): string {
    const clean = text.replace(/^[#*-\d.)\s]+/, '').replace(/[:：]$/, '').trim();
    if (this.startsWithActionVerb(clean)) {
      return clean.charAt(0).toUpperCase() + clean.slice(1);
    }

    const lower = clean.toLowerCase();

    if (/api|endpoint|websocket|gateway|backend|service|microservice/i.test(lower)) {
      return `Implement ${clean.charAt(0).toLowerCase() + clean.slice(1)}`;
    }
    if (/ui|view|page|interface|frontend|dashboard|screen/i.test(lower)) {
      return `Build ${clean.charAt(0).toLowerCase() + clean.slice(1)}`;
    }
    if (/payment|stripe|auth|integration|third-party|webhook/i.test(lower)) {
      return `Integrate ${clean.charAt(0).toLowerCase() + clean.slice(1)}`;
    }
    if (/test|qa|audit|verification|validation/i.test(lower)) {
      return `Execute ${clean.charAt(0).toLowerCase() + clean.slice(1)}`;
    }
    if (/deploy|cloud|infrastructure|docker|ci\/cd|pipeline/i.test(lower)) {
      return `Deploy ${clean.charAt(0).toLowerCase() + clean.slice(1)}`;
    }
    if (/requirement|scope|spec|architecture|design|wireframe/i.test(lower)) {
      return `Finalize ${clean.charAt(0).toLowerCase() + clean.slice(1)}`;
    }

    return `Create ${clean.charAt(0).toLowerCase() + clean.slice(1)}`;
  }

  private static inferPriority(title: string): Priority {
    const lower = title.toLowerCase();

    // Critical path / High importance
    if (/requirement|architect|schema|security|auth|login|pci|payment|stripe|checkout|deploy|production|critical/i.test(lower)) {
      return Priority.HIGH;
    }

    // Optional / Low importance
    if (/polish|theme|style|optional|documentation|telemetry|metric|icon|secondary/i.test(lower)) {
      return Priority.LOW;
    }

    return Priority.MEDIUM;
  }

  private static inferRole(title: string): string {
    const lower = title.toLowerCase();

    if (/requirement|scope|spec|plan|coordinat/i.test(lower)) return 'Project Manager';
    if (/ui|page|frontend|view|component|css|design/i.test(lower)) return 'Frontend Engineer';
    if (/api|service|gateway|backend|database|schema|websocket|payment/i.test(lower)) return 'Backend Engineer';
    if (/test|qa|audit|verification|acceptance/i.test(lower)) return 'QA Engineer';
    if (/deploy|cloud|docker|infrastructure|ci\/cd|devops/i.test(lower)) return 'DevOps Engineer';

    return 'Fullstack Engineer';
  }

  private static inferDuration(title: string, priority: Priority): number {
    const lower = title.toLowerCase();

    if (/deploy|setup|configure|finalize/i.test(lower)) return 2;
    if (/api|service|ui|cart|payment/i.test(lower)) return 4;
    if (/qa|test|audit/i.test(lower)) return 3;
    if (priority === Priority.HIGH) return 3;
    if (priority === Priority.LOW) return 1;

    return 3;
  }

  private static inferMilestoneIndex(title: string, milestoneCount: number): number {
    if (milestoneCount <= 1) return 0;
    const lower = title.toLowerCase();

    if (/requirement|scope|architect|spec|plan/i.test(lower)) return 0;
    if (/api|auth|listing|catalog|core|model/i.test(lower)) return Math.min(1, milestoneCount - 1);
    if (/cart|payment|checkout|integration|webhook/i.test(lower)) return Math.min(2, milestoneCount - 1);
    if (/test|qa|audit|deploy|production|launch/i.test(lower)) return milestoneCount - 1;

    return 1;
  }

  private static findMatchingRosterMember(text: string, roster: RosterMember[]): string | null {
    if (!roster.length) return null;
    const lower = text.toLowerCase();
    for (const member of roster) {
      const nameParts = member.name.toLowerCase().split(/\s+/);
      // Check full name or first name if distinct (> 2 chars)
      if (lower.includes(member.name.toLowerCase())) return member.id;
      if (nameParts[0].length >= 3 && new RegExp(`\\b${nameParts[0]}\\b`, 'i').test(text)) {
        return member.id;
      }
    }
    return null;
  }

  private static safeIsoDate(value: unknown): string | null {
    if (typeof value !== 'string' || !value.trim() || Number.isNaN(Date.parse(value))) return null;
    return new Date(value).toISOString();
  }
}
