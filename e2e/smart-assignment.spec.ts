import { expect, test } from '@playwright/test';
import * as path from 'node:path';

const ARTIFACT_DIR = '/Users/ansh/.gemini/antigravity/brain/98c77cd7-7330-47c4-8a1f-51b32f09cfb2';

test('NEXORA Release 4.2.2 — AI Smart Task Assignment End-to-End Browser Flow', async ({ page }) => {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
  const workspaceName = `Assignment Space ${stamp}`;
  const projectName = `NextGen Platform ${stamp}`;

  // 1. Setup browser and register workspace
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Your name').fill('Taylor Morgan');
  await page.getByLabel('Workspace name').fill(workspaceName);
  await page.getByLabel('Email address').fill(`taylor-${stamp}@nexora.test`);
  await page.getByLabel('Password').fill('NexoraAssign!2026');
  await page.getByRole('button', { name: 'Create your workspace' }).click();

  await expect(page.getByRole('heading', { name: 'Good morning, Taylor' })).toBeVisible({ timeout: 15_000 });

  // 2. Create a test project
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill(projectName);
  await page.getByLabel('Description').fill('Scalable cloud services with optimized cache and security layers.');
  await page.locator('form').getByRole('button', { name: 'Create project' }).click();

  await expect(page.getByRole('heading', { name: projectName })).toBeVisible({ timeout: 10_000 });

  // 3. Create an unassigned task in "My work"
  await page.getByRole('button', { name: 'My work', exact: true }).click();
  const addTaskBtn = page.getByRole('button', { name: 'Add task' }).first();
  await expect(addTaskBtn).toBeVisible({ timeout: 10_000 });
  await addTaskBtn.click();

  await page.getByLabel('Task name').fill('Implement Redis Sentinel caching');
  await page.locator('.modal-form').getByRole('button', { name: 'Add task' }).click();

  // Wait for task to appear in the table or list
  await expect(page.getByText('Implement Redis Sentinel caching').first()).toBeVisible({ timeout: 10_000 });

  // 4. Verify AI Assign action button is present and click it
  const aiAssignBtn = page.locator('.ai-assign-button').first();
  await expect(aiAssignBtn).toBeVisible({ timeout: 10_000 });
  await aiAssignBtn.click();

  // 5. Verify Smart Assignment Modal opens
  const modal = page.locator('.smart-assign-modal');
  await expect(modal).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.smart-assign-task-title')).toContainText('Implement Redis Sentinel caching');
  await expect(page.locator('.smart-assign-eyebrow')).toContainText('AI SMART TASK ASSIGNMENT');

  // Verify candidate card is rendered with match score
  const candidateCard = page.locator('.smart-assign-card').first();
  await expect(candidateCard).toBeVisible({ timeout: 10_000 });
  await expect(candidateCard.locator('.score-percentage')).toBeVisible();
  await expect(candidateCard.locator('.candidate-name')).toContainText('Taylor Morgan');

  // Verify why recommended block
  await expect(candidateCard.locator('.reasons-heading')).toBeVisible();

  // Capture screenshot of modal in Dark Theme
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, 'audit-smart-assignment-modal-dark.png'),
    fullPage: false,
  });

  // Switch to Light Theme via DOM dispatch to avoid backdrop pointer capture
  await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="Toggle theme"]') as HTMLButtonElement;
    btn?.click();
  });
  await page.waitForTimeout(400);
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, 'audit-smart-assignment-modal-light.png'),
    fullPage: false,
  });

  // Switch back to Dark Theme
  await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="Toggle theme"]') as HTMLButtonElement;
    btn?.click();
  });
  await page.waitForTimeout(400);

  // 6. Approve assignment (Human-in-the-loop)
  const approveBtn = page.getByRole('button', { name: 'Approve & Assign' }).first();
  await expect(approveBtn).toBeVisible();
  await approveBtn.click();

  // 7. Verify modal closes and assignment is persisted
  await expect(modal).not.toBeVisible({ timeout: 5_000 });

  // Switch to List view to verify table display
  await page.getByRole('button', { name: 'List view' }).click();
  await expect(page.locator('.table-assignee').first()).toContainText('Taylor Morgan', { timeout: 10_000 });

  // Capture final screenshot
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, 'audit-smart-assigned-task.png'),
    fullPage: false,
  });
});
