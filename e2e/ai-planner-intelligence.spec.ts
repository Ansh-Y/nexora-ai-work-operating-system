import { expect, test } from '@playwright/test';
import * as path from 'node:path';

const ARTIFACT_DIR = '/Users/ansh/.gemini/antigravity/brain/98c77cd7-7330-47c4-8a1f-51b32f09cfb2';

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

test('NEXORA Release 4.2 — AI Project Planner Intelligence, Proposal Editing & Execution', async ({ page }) => {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
  const workspaceName = `Trendora Workspace ${stamp}`;

  // 1. Register user
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Your name').fill('Alex Rivera');
  await page.getByLabel('Workspace name').fill(workspaceName);
  await page.getByLabel('Email address').fill(`alex-${stamp}@trendora.test`);
  await page.getByLabel('Password').fill('SecureTrendora!2026');
  await page.getByRole('button', { name: 'Create your workspace' }).click();

  await expect(page.getByRole('heading', { name: 'Good morning, Alex' })).toBeVisible();

  // 2. Open AI Command Center and open Planner modal
  const createPlanBtn = page.getByRole('button', { name: 'Create a project plan' });
  if (!await createPlanBtn.isVisible()) {
    await page.getByRole('button', { name: 'AI command', exact: true }).click();
    await page.waitForTimeout(200);
  }
  await createPlanBtn.click();
  await expect(page.getByRole('heading', { name: 'Start with the brief' })).toBeVisible();

  // 3. Submit Trendora Brief
  await page.getByLabel('What are you planning?').fill(TRENDORA_BRIEF);
  await page.locator('form').getByRole('button', { name: 'Generate plan draft' }).click();

  // 4. Review proposal modal
  const proposalReview = page.locator('.proposal-review');
  await expect(proposalReview).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'Review your proposed plan' })).toBeVisible();

  // 5. Verify Milestones are generated and aligned with the 4-week schedule
  const milestoneItems = page.locator('.proposal-milestone-item');
  const milestoneCount = await milestoneItems.count();
  expect(milestoneCount).toBeGreaterThanOrEqual(4);

  // 6. Verify Tasks: No headings, no objectives, no constraints as tasks
  const taskCards = page.locator('.review-task-card');
  const taskCount = await taskCards.count();
  expect(taskCount).toBeGreaterThanOrEqual(6);

  const forbiddenTerms = [
    'project objective',
    'key deliverables',
    'constraints & assumptions',
    'timeline & milestones',
    'trendora is a direct-to-consumer',
    'launch must be completed within 30 days',
  ];

  for (let i = 0; i < taskCount; i++) {
    const card = taskCards.nth(i);
    const titleInput = card.locator('.review-task-title-input');
    const titleVal = await titleInput.inputValue();
    const titleLower = titleVal.toLowerCase();

    for (const term of forbiddenTerms) {
      expect(titleLower).not.toContain(term);
    }
  }

  // 7. Verify Varied Priorities exist
  const prioritySelects = page.locator('.priority-select');
  const priorities: string[] = [];
  const priorityCount = await prioritySelects.count();
  for (let i = 0; i < priorityCount; i++) {
    priorities.push(await prioritySelects.nth(i).inputValue());
  }
  expect(new Set(priorities).size).toBeGreaterThanOrEqual(2);
  expect(priorities).toContain('HIGH');

  // 8. Capture Proposal Review Screenshot
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'audit-trendora-proposal-review.png') });

  // 9. Interactive Proposal Editing:
  // - Edit title of task #1
  const firstTitleInput = taskCards.first().locator('.review-task-title-input');
  await firstTitleInput.fill('Finalize Trendora architecture and domain specifications');

  // - Change priority of task #2 to URGENT
  const secondPrioritySelect = taskCards.nth(1).locator('.priority-select');
  await secondPrioritySelect.selectOption('URGENT');

  // - Add a new task
  const initialTaskCount = taskCount;
  await page.locator('.add-task-top-btn').click();
  await page.waitForTimeout(200);

  const updatedTaskCards = page.locator('.review-task-card');
  expect(await updatedTaskCards.count()).toBe(initialTaskCount + 1);

  // Set title for the newly added task
  const lastTask = updatedTaskCards.last();
  await lastTask.locator('.review-task-title-input').fill('Configure production CDN caching and SSL certificates');

  // Capture Edited Proposal Screenshot
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'audit-trendora-proposal-edited.png') });

  // 10. Approve and Execute the proposal
  const approveButton = page.locator('.plan-modal-footer').getByRole('button', { name: 'Approve and create' });
  await approveButton.click();

  // 11. Verify modal closes and redirected to Projects
  await expect(page.locator('.proposal-review')).toHaveCount(0, { timeout: 15_000 });
  await page.waitForTimeout(500);

  // 12. Verify Project was created in workspace
  await expect(page.getByRole('heading', { name: 'Trendora E-commerce Launch' })).toBeVisible();

  // Click into the project to view tasks
  await page.getByRole('link', { name: /Trendora E-commerce Launch/ }).click();
  await page.waitForTimeout(400);

  // Verify edited task title exists in project
  await expect(page.getByText('Finalize Trendora architecture and domain specifications')).toBeVisible();
  await expect(page.getByText('Configure production CDN caching and SSL certificates')).toBeVisible();

  // Capture final screenshot of created project
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'audit-trendora-project-created.png') });
});
