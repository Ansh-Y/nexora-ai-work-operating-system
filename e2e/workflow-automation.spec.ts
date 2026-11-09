import { expect, test } from '@playwright/test';
import * as path from 'node:path';

const ARTIFACT_DIR = '/Users/ansh/.gemini/antigravity/brain/98c77cd7-7330-47c4-8a1f-51b32f09cfb2';

test('NEXORA Release 4.2.3 — AI Workflow Automation End-to-End Flow', async ({ page }) => {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
  const workspaceName = `Automation Space ${stamp}`;
  const projectName = `Pipeline Ops ${stamp}`;

  // 1. Setup browser and register workspace
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Your name').fill('Morgan Automation Lead');
  await page.getByLabel('Workspace name').fill(workspaceName);
  await page.getByLabel('Email address').fill(`morgan-${stamp}@nexora.test`);
  await page.getByLabel('Password').fill('NexoraAuto!2026');
  await page.getByRole('button', { name: 'Create your workspace' }).click();

  await expect(page.getByRole('heading', { name: 'Good morning, Morgan' })).toBeVisible({ timeout: 15_000 });

  // 2. Create project
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill(projectName);
  await page.getByLabel('Description').fill('Production delivery with automated guardrails');
  await page.locator('form').getByRole('button', { name: 'Create project' }).click();

  await expect(page.getByRole('heading', { name: projectName })).toBeVisible({ timeout: 10_000 });

  // 3. Navigate to Automations Dashboard
  await page.getByRole('button', { name: 'Automations', exact: true }).click();
  await expect(page.getByTestId('automations-workspace')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: 'AI Workflow Automation' })).toBeVisible();

  // Verify KPI stats are present
  await expect(page.getByTestId('stat-total-rules')).toBeVisible();
  await expect(page.getByTestId('stat-active-rules')).toBeVisible();
  await expect(page.getByTestId('stat-pending-approvals')).toBeVisible();

  // 4. Create an Automation Rule
  await page.getByTestId('btn-create-rule').click();
  const ruleModal = page.getByTestId('modal-create-rule');
  await expect(ruleModal).toBeVisible({ timeout: 5_000 });

  await page.getByTestId('input-rule-name').fill('Auto-Recover Blocked Tasks');
  await page.getByTestId('select-rule-trigger').selectOption('TASK_MARKED_BLOCKED');
  await page.getByTestId('select-rule-action').selectOption('AI_TASK_RECOMMENDATION');

  await page.getByTestId('btn-submit-rule').click();
  await expect(ruleModal).not.toBeVisible({ timeout: 5_000 });

  // Verify rule appears in Automation Rules tab
  await page.getByTestId('tab-rules').click();
  await expect(page.getByText('Auto-Recover Blocked Tasks')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.flow-trigger')).toContainText('Task Blocked');
  await expect(page.locator('.flow-action')).toContainText('AI Task Recommendation');

  // 5. Create a task and mark it BLOCKED to trigger automation
  await page.getByRole('button', { name: 'My work', exact: true }).click();
  const addTaskBtn = page.getByRole('button', { name: 'Add task' }).first();
  await expect(addTaskBtn).toBeVisible({ timeout: 10_000 });
  await addTaskBtn.click();

  await page.getByLabel('Task name').fill('Fix Redis Connection Pooling');
  await page.locator('.modal-form').getByRole('button', { name: 'Add task' }).click();
  await expect(page.getByText('Fix Redis Connection Pooling').first()).toBeVisible({ timeout: 10_000 });

  // Update status to Blocked using the status combobox on the card
  const statusCombobox = page.getByRole('combobox', { name: /change .* status/i }).first();
  await expect(statusCombobox).toBeVisible({ timeout: 10_000 });
  await statusCombobox.selectOption('BLOCKED');

  // Brief pause to allow event evaluation to persist
  await page.waitForTimeout(500);

  // 6. Return to Automations -> Pending Approvals
  await page.getByRole('button', { name: 'Automations', exact: true }).click();
  await page.getByTestId('tab-pending').click();

  // Verify pending approval card appears
  const approvalCard = page.locator('.approval-card').first();
  await expect(approvalCard).toBeVisible({ timeout: 12_000 });
  await expect(approvalCard.locator('.approval-rule-title')).toContainText('Auto-Recover Blocked Tasks');
  await expect(approvalCard.locator('.pill-trigger')).toContainText('Task Blocked');
  await expect(approvalCard.locator('.pill-action')).toContainText('AI Task Recommendation');
  await expect(approvalCard.locator('.ai-explanation-box')).toContainText('BLOCKED');

  // Capture screenshot in Dark Theme
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, 'audit-workflow-automations-pending-dark.png'),
    fullPage: false,
  });

  // Switch to Light Theme and capture screenshot
  await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="Toggle theme"]') as HTMLButtonElement;
    btn?.click();
  });
  await page.waitForTimeout(400);
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, 'audit-workflow-automations-pending-light.png'),
    fullPage: false,
  });

  // Switch back to Dark Theme
  await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="Toggle theme"]') as HTMLButtonElement;
    btn?.click();
  });
  await page.waitForTimeout(400);

  // 7. Approve & Execute the proposed action
  const approveBtn = approvalCard.getByRole('button', { name: 'Approve & Execute' });
  await expect(approveBtn).toBeVisible();
  await approveBtn.click();

  // 8. Verify queue is clear
  await expect(page.getByText('Approval Queue is Clear')).toBeVisible({ timeout: 10_000 });

  // 9. Inspect Execution History tab
  await page.getByTestId('tab-history').click();
  await expect(page.getByTestId('history-manager')).toBeVisible();
  const historyRow = page.locator('tbody tr').first();
  await expect(historyRow).toBeVisible({ timeout: 10_000 });
  await expect(historyRow.locator('.status-pill')).toContainText('EXECUTED');
  await expect(historyRow.locator('.cell-rule-name')).toContainText('Auto-Recover Blocked Tasks');

  // Capture Execution History screenshot
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, 'audit-workflow-automations-history.png'),
    fullPage: false,
  });
});
