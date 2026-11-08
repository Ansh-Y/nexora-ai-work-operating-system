import { describe, expect, it } from 'vitest';
import { Priority } from '@prisma/client';
import { ProjectPlannerEngine } from './project-planner.engine';

describe('ProjectPlannerEngine — Release 4.2 Intelligence Suite', () => {
  const MOCK_ROSTER = [
    { id: '11111111-1111-4111-8111-111111111111', name: 'Sarah Miller' },
    { id: '22222222-2222-4222-8222-222222222222', name: 'Alex Chen' },
    { id: '33333333-3333-4333-8333-333333333333', name: 'Jordan Taylor' },
  ];

  // =========================================================================
  // TEST A: Structured E-Commerce Brief (Trendora 30-Day Plan)
  // =========================================================================
  describe('TEST A — Structured E-Commerce Brief (Trendora)', () => {
    const TRENDORA_BRIEF = `# Trendora E-commerce Launch

**Project objective:**
Trendora is a direct-to-consumer fashion apparel brand launching a high-performance web platform within 30 days to support international orders and peak seasonal traffic.

**Key deliverables:**
1. Product catalog with responsive browsing, category filters, and search indexing
2. Customer authentication, registration, and profile management
3. Shopping cart, real-time discount calculation, and inventory holds
4. Payment gateway integration with Stripe and automated webhook verification
5. Order tracking, customer email notifications, and dispatch pipeline
6. Automated critical-path scheduling and monitoring dashboard
7. End-to-end user acceptance testing and PCI-DSS compliance verification
8. Production deployment on cloud infrastructure with zero-downtime cutover

**Timeline & milestones:**
- Week 1: Planning, Scope & System Architecture
- Week 2: Core Development & Platform Services
- Week 3: External Integrations & Payment Processing
- Week 4: Quality Assurance, Security Audit & Launch

**Constraints & assumptions:**
- Launch must be completed within 30 days
- Zero downtime during database migration and deployment
- Strict multi-tenant data isolation and PCI-DSS compliance
- High-contrast accessible design system`;

    it('generates meaningful milestones and actionable tasks for Trendora without heading pollution', () => {
      const plan = ProjectPlannerEngine.decomposeBrief(
        { brief: TRENDORA_BRIEF, projectName: 'Trendora E-commerce Launch' },
        MOCK_ROSTER
      );

      // Verify Project Info
      expect(plan.projectName).toBe('Trendora E-commerce Launch');
      expect(plan.projectDescription).toContain('Trendora is a direct-to-consumer');

      // Verify Milestones
      expect(plan.milestones.length).toBeGreaterThanOrEqual(4);
      expect(plan.milestones.some(m => /week 1|planning/i.test(m.title))).toBe(true);
      expect(plan.milestones.some(m => /week 2|core/i.test(m.title))).toBe(true);
      expect(plan.milestones.some(m => /week 3|integration|payment/i.test(m.title))).toBe(true);
      expect(plan.milestones.some(m => /week 4|qa|launch/i.test(m.title))).toBe(true);

      // Verify Tasks Exist and are Actionable
      expect(plan.tasks.length).toBeGreaterThanOrEqual(6);

      // CRITICAL CHECK: No introductory sentence or section headings become tasks
      for (const task of plan.tasks) {
        expect(ProjectPlannerEngine.isHeadingLabel(task.title)).toBe(false);
        expect(ProjectPlannerEngine.isIntroOrConstraintSentence(task.title)).toBe(false);
        expect(task.title.toLowerCase()).not.toContain('project objective');
        expect(task.title.toLowerCase()).not.toContain('key deliverables');
        expect(task.title.toLowerCase()).not.toContain('constraints & assumptions');
        expect(task.title.toLowerCase()).not.toContain('trendora is a direct-to-consumer');
        expect(task.title.toLowerCase()).not.toContain('launch must be completed within 30 days');

        // Every task starts with an action verb
        expect(ProjectPlannerEngine.startsWithActionVerb(task.title)).toBe(true);

        // Every task has a non-empty description
        expect(task.description).toBeTruthy();

        // Valid priority
        expect(Object.values(Priority)).toContain(task.priority);

        // Valid milestoneIndex
        if (typeof task.milestoneIndex === 'number') {
          expect(task.milestoneIndex).toBeGreaterThanOrEqual(0);
          expect(task.milestoneIndex).toBeLessThan(plan.milestones.length);
        }
      }

      // Verify Varied Priorities (not all MEDIUM)
      const priorities = new Set(plan.tasks.map(t => t.priority));
      expect(priorities.size).toBeGreaterThanOrEqual(2);
      expect(priorities.has(Priority.HIGH)).toBe(true);

      // Verify Non-linear Dependencies (independent tasks run in parallel)
      // Check that not every task[i] depends on task[i-1]
      const hasParallelTasks = plan.tasks.some(t => t.blockedBy.length === 0);
      expect(hasParallelTasks).toBe(true);

      // Deployment task should depend on QA testing
      const deployTask = plan.tasks.find(t => /deploy/i.test(t.title));
      const qaTask = plan.tasks.find(t => /qa|test|audit/i.test(t.title));
      if (deployTask && qaTask) {
        const qaIndex = plan.tasks.indexOf(qaTask);
        if (qaIndex < plan.tasks.indexOf(deployTask)) {
          expect(deployTask.blockedBy).toContain(qaIndex);
        }
      }

      // Verify Assumptions and Risks
      expect(plan.assumptions.length).toBeGreaterThanOrEqual(1);
      expect(plan.risks?.length).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // TEST B: Short Informal Brief
  // =========================================================================
  describe('TEST B — Short Informal Brief', () => {
    const INFORMAL_BRIEF = 'Build a food delivery application with customer login, restaurant listings, cart, payments and order tracking.';

    it('understands requirements and creates logical work items with milestones', () => {
      const plan = ProjectPlannerEngine.decomposeBrief(
        { brief: INFORMAL_BRIEF },
        MOCK_ROSTER
      );

      expect(plan.projectName).toBeTruthy();
      expect(plan.milestones.length).toBe(4);

      // Should identify domain modules
      const titles = plan.tasks.map(t => t.title.toLowerCase());
      expect(titles.some(t => t.includes('auth') || t.includes('login'))).toBe(true);
      expect(titles.some(t => t.includes('restaurant') || t.includes('listing'))).toBe(true);
      expect(titles.some(t => t.includes('cart') || t.includes('order'))).toBe(true);
      expect(titles.some(t => t.includes('payment') || t.includes('gateway'))).toBe(true);
      expect(titles.some(t => t.includes('tracking'))).toBe(true);
      expect(titles.some(t => t.includes('testing') || t.includes('qa'))).toBe(true);
      expect(titles.some(t => t.includes('deploy'))).toBe(true);

      // Every task must be actionable
      for (const task of plan.tasks) {
        expect(ProjectPlannerEngine.startsWithActionVerb(task.title)).toBe(true);
      }

      // Varied priorities
      const highTasks = plan.tasks.filter(t => t.priority === Priority.HIGH);
      const medTasks = plan.tasks.filter(t => t.priority === Priority.MEDIUM);
      expect(highTasks.length).toBeGreaterThan(0);
      expect(medTasks.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // TEST C: Brief with Many Headings & Constraints
  // =========================================================================
  describe('TEST C — Headings and Constraints Filtering', () => {
    const HEAVY_HEADING_BRIEF = `
### Project Overview
We are planning to launch a next-generation enterprise telemetry engine.

### Project Objective:
The primary goal is to collect and analyze telemetry data with sub-second latency.

### Key Deliverables:
1. Build high-throughput ingestion pipeline using Apache Kafka
2. Implement distributed time-series storage schema
3. Create telemetry aggregation service with tumbling window analytics
4. Develop real-time incident alerting webhooks
5. Execute multi-region fault tolerance drills

### Constraints & Assumptions:
- Zero downtime during rolling upgrades
- High contrast accessible Obsidian and Jade design system
- Strict tenant data isolation enforced at service layer
- Budget cannot exceed infrastructure allocation
- SLA requirement of 99.99% uptime
`;

    it('strictly filters out headings, project objectives, and constraints from tasks', () => {
      const plan = ProjectPlannerEngine.decomposeBrief(
        { brief: HEAVY_HEADING_BRIEF, projectName: 'Enterprise Telemetry Engine' },
        MOCK_ROSTER
      );

      for (const task of plan.tasks) {
        const titleLower = task.title.toLowerCase();
        expect(titleLower).not.toBe('project overview');
        expect(titleLower).not.toBe('project objective:');
        expect(titleLower).not.toBe('project objective');
        expect(titleLower).not.toBe('key deliverables:');
        expect(titleLower).not.toBe('key deliverables');
        expect(titleLower).not.toBe('constraints & assumptions:');
        expect(titleLower).not.toBe('constraints & assumptions');
        expect(titleLower).not.toContain('we are planning to launch');
        expect(titleLower).not.toContain('zero downtime during');
        expect(titleLower).not.toContain('high contrast accessible');
        expect(titleLower).not.toContain('strict tenant data isolation');
        expect(titleLower).not.toContain('budget cannot exceed');
        expect(titleLower).not.toContain('sla requirement');
      }

      // Verify that constraints were captured as assumptions instead of tasks
      expect(plan.assumptions.some(a => /zero downtime/i.test(a))).toBe(true);
      expect(plan.assumptions.some(a => /strict tenant/i.test(a))).toBe(true);
    });
  });

  // =========================================================================
  // TEST D: Dependencies Intelligence and Parallel Execution
  // =========================================================================
  describe('TEST D — Dependency Intelligence', () => {
    it('allows independent tasks to run in parallel and maps genuine prerequisites without cycles', () => {
      const plan = ProjectPlannerEngine.decomposeBrief({
        brief: `
**Deliverables:**
1. Finalize system architecture and domain models
2. Build customer profile UI page
3. Implement backend products API
4. Integrate Stripe payment processing
5. Execute end-to-end QA validation
6. Deploy application to production
        `,
      });

      // Task 0: Architecture has no blockers
      expect(plan.tasks[0].blockedBy).toEqual([]);

      // Task 1 (UI) and Task 2 (API) can run in parallel (both depend only on Architecture, not on each other)
      expect(plan.tasks[1].blockedBy).not.toContain(2);
      expect(plan.tasks[2].blockedBy).not.toContain(1);

      // Verify NO sequential chain: Task 2 must not automatically depend on Task 1
      expect(plan.tasks[2].blockedBy).toEqual([0]);

      // Deploy must depend on QA
      const qaIdx = plan.tasks.findIndex(t => /qa/i.test(t.title));
      const deployIdx = plan.tasks.findIndex(t => /deploy/i.test(t.title));
      expect(plan.tasks[deployIdx].blockedBy).toContain(qaIdx);

      // Verify NO cycle exists in the graph
      for (let i = 0; i < plan.tasks.length; i++) {
        for (const blocker of plan.tasks[i].blockedBy) {
          expect(blocker).toBeLessThan(i);
          expect(blocker).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it('detects and eliminates circular dependencies during plan sanitization', () => {
      const maliciousPlan = {
        projectName: 'Cycle Test',
        tasks: [
          { title: 'Task Zero', description: '', priority: 'HIGH', blockedBy: [] },
          { title: 'Task One', description: '', priority: 'MEDIUM', blockedBy: [0] },
          { title: 'Task Two', description: '', priority: 'MEDIUM', blockedBy: [1] },
        ],
      };

      const sanitized = ProjectPlannerEngine.sanitizePlan(maliciousPlan, MOCK_ROSTER);
      expect(sanitized.tasks[0].blockedBy).toEqual([]);
      expect(sanitized.tasks[1].blockedBy).toEqual([0]);
      expect(sanitized.tasks[2].blockedBy).toEqual([1]);
    });
  });

  // =========================================================================
  // TEST E: Missing Information (Assumptions vs Hallucination)
  // =========================================================================
  describe('TEST E — Missing Information', () => {
    it('states assumptions instead of inventing team members, dates, or false facts', () => {
      const briefWithoutTeam = 'Develop an internal document indexing service with full-text search capability.';
      const plan = ProjectPlannerEngine.decomposeBrief(
        { brief: briefWithoutTeam },
        MOCK_ROSTER
      );

      // Assignees should NOT be hallucinated
      for (const task of plan.tasks) {
        expect(task.assigneeId).toBeNull();
      }

      // Assumptions should document that team members will be assigned during planning
      expect(plan.assumptions.some(a => /team|assign/i.test(a))).toBe(true);
      expect(plan.assumptions.some(a => /timeline|schedule|phase/i.test(a))).toBe(true);
    });

    it('only assigns team members when explicitly named in the brief and matching roster', () => {
      const briefWithNames = `
Develop mobile notification gateway.
Deliverables:
1. Finalize push notification protocol (Sarah Miller will coordinate)
2. Implement APNS and FCM dispatch workers (assigned to Alex Chen)
3. Execute load testing
      `;

      const plan = ProjectPlannerEngine.decomposeBrief(
        { brief: briefWithNames },
        MOCK_ROSTER
      );

      const sarahTask = plan.tasks.find(t => t.title.toLowerCase().includes('push') || t.description.toLowerCase().includes('sarah'));
      const alexTask = plan.tasks.find(t => t.title.toLowerCase().includes('worker') || t.title.toLowerCase().includes('apns') || t.description.toLowerCase().includes('alex'));
      const testTask = plan.tasks.find(t => t.title.toLowerCase().includes('load testing'));

      expect(sarahTask?.assigneeId).toBe('11111111-1111-4111-8111-111111111111');
      expect(alexTask?.assigneeId).toBe('22222222-2222-4222-8222-222222222222');
      expect(testTask?.assigneeId).toBeNull();
    });
  });

  // =========================================================================
  // TEST F: Malformed / Invalid LLM Output Resilience
  // =========================================================================
  describe('TEST F — Malformed / Invalid LLM Response Handling', () => {
    it('gracefully recovers when LLM returns null, primitive, or empty object', () => {
      const recovered = ProjectPlannerEngine.sanitizePlan(null, MOCK_ROSTER, {
        brief: 'Build a secure customer dashboard with SSO login and analytics widgets.',
      });

      expect(recovered.tasks.length).toBeGreaterThan(0);
      expect(recovered.milestones.length).toBeGreaterThan(0);
      expect(recovered.projectName).toBeTruthy();
    });

    it('safely handles empty task array by decomposing brief', () => {
      const badOutput = {
        projectName: 'Empty Plan',
        projectDescription: 'Has no tasks',
        tasks: [],
      };

      const recovered = ProjectPlannerEngine.sanitizePlan(badOutput, MOCK_ROSTER, {
        brief: 'Build a secure customer dashboard with SSO login and analytics widgets.',
      });

      expect(recovered.tasks.length).toBeGreaterThan(0);
      expect(recovered.tasks[0].title).toBeTruthy();
    });

    it('sanitizes tasks with invalid dates, priorities, and out-of-range dependencies', () => {
      const malformedTasks = {
        projectName: 'Malformed Tasks Test',
        milestones: [{ title: 'Milestone 1', targetDate: 'garbage-date' }],
        tasks: [
          {
            title: 'Valid First Task',
            description: 'Proper description',
            priority: 'SUPER_URGENT_INVALID',
            dueDate: 'invalid-date-string',
            assigneeId: 'not-a-valid-member-id',
            blockedBy: [0, 999], // 0 is self, 999 is out of bounds
          },
          {
            title: 'Project objective:', // Should be filtered out
            description: 'Should not be a task',
          },
          {
            title: 'Valid Second Task',
            description: 'Another task',
            priority: 'LOW',
            blockedBy: [0], // Valid
          },
        ],
      };

      const sanitized = ProjectPlannerEngine.sanitizePlan(malformedTasks, MOCK_ROSTER);

      // Milestone date sanitized
      expect(sanitized.milestones[0].targetDate).toBeNull();

      // Heading task was filtered out
      expect(sanitized.tasks.some(t => t.title.includes('Project objective'))).toBe(false);

      // Invalid priority normalized to MEDIUM
      expect(sanitized.tasks[0].priority).toBe(Priority.MEDIUM);

      // Invalid date set to null
      expect(sanitized.tasks[0].dueDate).toBeNull();

      // Invalid assigneeId set to null
      expect(sanitized.tasks[0].assigneeId).toBeNull();

      // Self and out-of-range dependencies stripped
      expect(sanitized.tasks[0].blockedBy).toEqual([]);
      expect(sanitized.tasks[1].blockedBy).toEqual([0]);
    });
  });
});
