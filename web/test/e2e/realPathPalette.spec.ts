// The command palette: ninja-keys in the extension's own iframe, opened by a
// binding the content script listens for, running the client's commands.
import type { Page } from '@playwright/test';
import { docText, expect, marks, pageUrl, panelPages, status, test } from './fixtures';

const palette = (page: Page) => page.frameLocator('iframe[title="Language Check commands"]');
const checks = (page: Page) => page.evaluate(() => (globalThis as any).__languageCheck.stats().checks as number);

async function ready(page: Page): Promise<void> {
    await page.goto(pageUrl('overleaf', 'current', 'I will recieve it.'));
    await expect.poll(() => status(page)).toMatchObject({ state: 'attached' });
    await expect(marks(page)).toHaveText(['recieve']);
    await page.locator('.cm-content').click();
}

test('Ctrl+P opens the palette over the editor, listing the client commands with their VS Code titles', async ({ page }) => {
    await ready(page);
    await page.keyboard.press('Control+KeyP');
    await expect(palette(page).locator('ninja-action')).toHaveText([/Check Current Document/u, /Open SpeedFix/u, /Open Inspector/u]);
});

test('choosing a command runs it, closes the palette and returns focus to the text', async ({ page }) => {
    await ready(page);
    const before = await checks(page);
    await page.keyboard.press('Control+KeyP');
    await expect(palette(page).locator('ninja-action')).toHaveCount(3);
    await page.keyboard.type('check');
    await page.keyboard.press('Enter');
    await expect(page.locator('iframe[title="Language Check commands"]')).toHaveCount(0);
    await expect.poll(() => checks(page)).toBeGreaterThan(before);
    await expect(page.locator('.cm-content')).toBeFocused();
});

test('Escape, or the binding again, closes it without running anything', async ({ page }) => {
    await ready(page);
    const before = await checks(page);
    await page.keyboard.press('Control+KeyP');
    await expect(palette(page).locator('ninja-action')).toHaveCount(3);
    await page.keyboard.press('Escape');
    await expect(page.locator('iframe[title="Language Check commands"]')).toHaveCount(0);
    await expect(page.locator('.cm-content')).toBeFocused();
    await page.keyboard.press('Control+KeyP');
    await expect(palette(page).locator('ninja-action')).toHaveCount(3);
    await page.keyboard.press('Control+KeyP');
    await expect(page.locator('iframe[title="Language Check commands"]')).toHaveCount(0);
    expect(await checks(page)).toBe(before);
});

test('the binding can be changed on the options page', async ({ page, context, extensionId }) => {
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.getByLabel('Shortcut for the command palette').fill('ctrl+shift+l');
    await options.getByRole('button', { name: 'Save' }).click();
    await expect(options.getByRole('status')).toContainText('ctrl+shift+l');
    await options.getByLabel('Shortcut for the command palette').fill('ctrl+banana');
    await options.getByRole('button', { name: 'Save' }).click();
    await expect(options.getByRole('status')).toContainText('not a shortcut');

    await ready(page);
    await page.keyboard.press('Control+KeyP');
    await expect(page.locator('iframe[title="Language Check commands"]')).toHaveCount(0);
    await page.keyboard.press('Control+Shift+KeyL');
    await expect(palette(page).locator('ninja-action')).toHaveCount(3);
});

test('a command typed and entered straight after the binding runs, and no key reaches the document', async ({ page, context }) => {
    await ready(page);
    const before = await docText(page);
    // No waiting for the palette: a user types the command and Enter at once.
    await page.keyboard.press('Control+KeyP');
    await page.keyboard.type('open sp', { delay: 0 });
    await page.keyboard.press('Enter');
    await expect.poll(() => panelPages(context, 'speedFix').length).toBe(1);
    await expect(page.locator('iframe[title="Language Check commands"]')).toHaveCount(0);
    expect(await docText(page)).toBe(before);
});
