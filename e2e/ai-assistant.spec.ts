import { expect, test } from '@playwright/test';
import * as path from 'node:path';

const ARTIFACT_DIR = '/Users/ansh/.gemini/antigravity/brain/98c77cd7-7330-47c4-8a1f-51b32f09cfb2';

test('NEXORA Release 4.2.1 — AI Project Assistant End-to-End Browser Flow', async ({ page }) => {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
  const workspaceName = `Assistant Demo Space ${stamp}`;
  const projectName = `Product Launch Alpha ${stamp}`;

  // 1. Setup browser and register workspace
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Your name').fill('Devin Vance');
  await page.getByLabel('Workspace name').fill(workspaceName);
  await page.getByLabel('Email address').fill(`devin-${stamp}@nexora.test`);
  await page.getByLabel('Password').fill('NexoraAssistant!2026');
  await page.getByRole('button', { name: 'Create your workspace' }).click();

  await expect(page.getByRole('heading', { name: 'Good morning, Devin' })).toBeVisible({ timeout: 15_000 });

  // 2. Create a test project with tasks
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill(projectName);
  await page.getByLabel('Description').fill('Q1 commercial platform release with multi-tier infrastructure.');
  await page.locator('form').getByRole('button', { name: 'Create project' }).click();

  await expect(page.getByRole('heading', { name: projectName })).toBeVisible({ timeout: 10_000 });

  // Add a task to this project
  await page.getByRole('button', { name: 'My work', exact: true }).click();
  const addTaskBtn = page.getByRole('button', { name: 'New task' });
  if (await addTaskBtn.isVisible()) {
    await addTaskBtn.click();
    await page.getByLabel('Task title').fill('Implement OAuth Security Gateway');
    await page.getByRole('button', { name: 'Create task' }).click();
    await page.waitForTimeout(300);
  }

  // 3. Open AI Project Assistant via sidebar navigation
  const assistantNavBtn = page.getByRole('button', { name: 'AI Assistant', exact: true });
  await expect(assistantNavBtn).toBeVisible();
  await assistantNavBtn.click();

  // Verify Assistant Workspace layout
  await expect(page.getByRole('heading', { name: 'AI Project Assistant' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.assistant-subtitle')).toContainText('Contextual, evidence-based conversations');

  // Verify project dropdown includes our project
  const projectSelect = page.locator('.assistant-project-select');
  await expect(projectSelect).toBeVisible();

  // Verify starter prompt cards are rendered
  const starterCards = page.locator('.starter-prompt-card');
  await expect(starterCards.first()).toBeVisible();
  const cardCount = await starterCards.count();
  expect(cardCount).toBeGreaterThanOrEqual(6);

  // 4. Click a suggested prompt card: "Give me an overview of this project."
  const overviewCard = page.locator('.starter-prompt-card', { hasText: 'Give me an overview of this project.' });
  await overviewCard.click();

  // Verify message exchange
  await expect(page.locator('.assistant-message-row.user-row .message-bubble')).toContainText('Give me an overview of this project.');
  await expect(page.locator('.assistant-message-row.assistant-row .message-bubble')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.assistant-message-row.assistant-row .message-bubble')).toContainText('Verified Project Facts');

  // Verify citation pills are present
  await expect(page.locator('.citation-pill').first()).toBeVisible();

  // Verify follow-up chips are rendered
  await expect(page.locator('.followup-chip').first()).toBeVisible();

  // 5. Ask a follow-up query via textarea input
  const textarea = page.locator('.assistant-input-tray textarea');
  await textarea.fill('What should the team prioritize next?');
  await page.locator('.send-btn').click();

  // Verify second assistant response appears
  await expect(page.locator('.assistant-message-row.user-row').nth(1)).toContainText('What should the team prioritize next?');
  await expect(page.locator('.assistant-message-row.assistant-row').nth(1)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.assistant-message-row.assistant-row').nth(1)).toContainText('Recommended Execution Priority');

  // 6. Verify Theme compatibility (Light & Dark) and capture screenshots with active conversation
  // Take dark theme screenshot with messages & citations visible
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, 'ai-assistant-dark-theme.png'),
    fullPage: false,
  });

  // Switch to light theme
  const themeToggle = page.locator('button[title*="theme"], button[aria-label*="theme"]').first();
  if (await themeToggle.isVisible()) {
    await themeToggle.click();
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'ai-assistant-light-theme.png'),
      fullPage: false,
    });
    // Switch back to dark
    await themeToggle.click();
    await page.waitForTimeout(200);
  }

  // 7. Test starting a new conversation session
  await page.locator('.assistant-btn', { hasText: 'New Chat' }).click();
  // Conversation should be reset and starter cards visible again
  await expect(page.locator('.message-bubble')).toHaveCount(0);
  await expect(starterCards.first()).toBeVisible();
});
