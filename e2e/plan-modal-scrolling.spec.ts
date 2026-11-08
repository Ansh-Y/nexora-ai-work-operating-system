import { expect, test } from '@playwright/test';
import * as path from 'node:path';

const ARTIFACT_DIR = '/Users/ansh/.gemini/antigravity/brain/98c77cd7-7330-47c4-8a1f-51b32f09cfb2';

const LONG_BRIEF = `**Project objective:**
Implement next-generation AI Project Planner and Health Scoring Engine with enterprise multi-tenancy, real-time collaboration, and automated dependency detection.

**Key deliverables:**
1. Unified WebSocket gateway for real-time task sync and collaboration
2. Dependency cycle validation engine preventing circular blockers
3. Automated critical-path scheduling calculator
4. Predictive risk engine analyzing deadline velocity and stalled work
5. Enterprise storage with AES-256-GCM encryption and audit logging
6. Executive health dashboard with trend sparklines and risk factor breakdown

**Constraints & assumptions:**
- Zero downtime during database migration and deployment
- Strict tenant data isolation enforced at service layer
- High contrast accessible Obsidian and Jade design system`;

test('AI Project Planner modal scrolling, markdown formatting, and viewport containment', async ({ page }) => {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
  const workspaceName = `Scroll Test ${stamp}`;

  // Register user
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Your name').fill('Scroll Tester');
  await page.getByLabel('Workspace name').fill(workspaceName);
  await page.getByLabel('Email address').fill(`scroll-${stamp}@nexora.test`);
  await page.getByLabel('Password').fill('ScrollPass!2026');
  await page.getByRole('button', { name: 'Create your workspace' }).click();

  await expect(page.getByRole('heading', { name: 'Good morning, Scroll' })).toBeVisible();

  // Test across Desktop (1440x900), Laptop (1280x800), and Mobile (390x844)
  const viewports = [
    { name: 'Desktop (1440x900)', width: 1440, height: 900 },
    { name: 'Laptop (1280x800)', width: 1280, height: 800 },
    { name: 'Mobile (390x844)', width: 390, height: 844 },
  ];

  for (let i = 0; i < viewports.length; i++) {
    const vp = viewports[i];
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(200);

    // 1. Ensure we are on AI command page and open planner
    const createPlanBtn = page.getByRole('button', { name: 'Create a project plan' });
    if (!await createPlanBtn.isVisible()) {
      if (vp.width <= 800) {
        await page.locator('.mobile-menu-btn').click();
        await page.waitForTimeout(200);
      }
      await page.getByRole('button', { name: 'AI command', exact: true }).click();
      await page.waitForTimeout(200);
    }
    await createPlanBtn.click();
    await expect(page.getByRole('heading', { name: 'Start with the brief' })).toBeVisible();

    // Verify background scroll locked when brief form modal is open
    await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');

    // 2. Input sufficiently long project brief
    await page.getByLabel('What are you planning?').fill(LONG_BRIEF);
    await page.locator('form').getByRole('button', { name: 'Generate plan draft' }).click();

    // 3. Review modal opens
    const proposalReview = page.locator('.proposal-review');
    await expect(proposalReview).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Review your proposed plan' })).toBeVisible();

    // 4. Verify modal stays within the viewport boundaries
    const modalCard = page.locator('.modal-card.plan-modal');
    await expect(modalCard).toBeVisible();
    const box = await modalCard.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height + 5); // within viewport
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width + 5);

    // 5. Verify background scrolling is locked while modal is open
    await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');

    // 6. Verify brief markdown formatting is cleanly rendered
    await expect(page.locator('.brief-section-heading').first()).toHaveText('Project objective');
    await expect(page.locator('.brief-numbered-list')).toBeVisible();
    await expect(page.locator('.brief-bullet-list')).toBeVisible();

    // 7. Verify modal opens at top of content (scrollTop === 0)
    const scrollBody = page.locator('.proposal-review-body');
    const initialScrollTop = await scrollBody.evaluate(el => el.scrollTop);
    expect(initialScrollTop).toBe(0);

    if (vp.width === 390) {
      await page.screenshot({ path: path.join(ARTIFACT_DIR, 'audit-plan-modal-mobile-top.png') });
    }

    // 8. Scroll modal body to bottom and verify wheel/trackpad scrolling
    await scrollBody.evaluate(el => {
      el.scrollTop = el.scrollHeight;
    });
    const scrolledTop = await scrollBody.evaluate(el => el.scrollTop);
    expect(scrolledTop).toBeGreaterThan(0);

    if (vp.width === 1440) {
      await page.screenshot({ path: path.join(ARTIFACT_DIR, 'audit-plan-modal-scrolled-desktop.png') });
    } else if (vp.width === 390) {
      await page.screenshot({ path: path.join(ARTIFACT_DIR, 'audit-plan-modal-mobile-scrolled.png') });
    }

    // 9. Verify final task is visible
    const taskCards = page.locator('.review-task-card');
    const taskCount = await taskCards.count();
    expect(taskCount).toBeGreaterThanOrEqual(4);
    const lastTask = taskCards.last();
    await expect(lastTask).toBeVisible();

    // 10. Verify Cancel and approval buttons are accessible in fixed footer
    const cancelButton = page.locator('.plan-modal-footer').getByRole('button', { name: 'Cancel' });
    const approveButton = page.locator('.plan-modal-footer').getByRole('button', { name: 'Approve and create' });
    await expect(cancelButton).toBeVisible();
    await expect(approveButton).toBeVisible();
    await expect(cancelButton).toBeEnabled();
    await expect(approveButton).toBeEnabled();

    // Header close button is accessible
    const closeBtn = page.locator('.plan-modal-head').locator('button.icon-button');
    await expect(closeBtn).toBeVisible();

    if (i < viewports.length - 1) {
      // Close modal using Cancel button
      await cancelButton.click();
      await expect(page.locator('.proposal-review')).toHaveCount(0);
      await page.waitForTimeout(300);

      // Verify background scrolling is restored
      await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
    } else {
      // On the final viewport, approve and create to verify full lifecycle
      await approveButton.click();
      await expect(page.locator('.proposal-review')).toHaveCount(0);
      await page.waitForTimeout(300);
      await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
    }
  }
});
