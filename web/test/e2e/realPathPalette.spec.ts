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

test('Alt+Shift+P opens the palette over the editor, listing the client commands with their VS Code titles', async ({ page }) => {
    await ready(page);
    await page.keyboard.press('Alt+Shift+KeyP');
    await expect(palette(page).locator('ninja-action')).toHaveText([/Check Current Document/u, /Open SpeedFix/u, /Open Inspector/u, /Edit Config/u]);
});

test('choosing a command runs it, closes the palette and returns focus to the text', async ({ page }) => {
    await ready(page);
    const before = await checks(page);
    await page.keyboard.press('Alt+Shift+KeyP');
    await expect(palette(page).locator('ninja-action')).toHaveCount(4);
    await page.keyboard.type('check');
    await page.keyboard.press('Enter');
    await expect(page.locator('iframe[title="Language Check commands"]')).toHaveCount(0);
    await expect.poll(() => checks(page)).toBeGreaterThan(before);
    await expect(page.locator('.cm-content')).toBeFocused();
});

test('Escape, or the binding again, closes it without running anything', async ({ page }) => {
    await ready(page);
    const before = await checks(page);
    await page.keyboard.press('Alt+Shift+KeyP');
    await expect(palette(page).locator('ninja-action')).toHaveCount(4);
    await page.keyboard.press('Escape');
    await expect(page.locator('iframe[title="Language Check commands"]')).toHaveCount(0);
    await expect(page.locator('.cm-content')).toBeFocused();
    await page.keyboard.press('Alt+Shift+KeyP');
    await expect(palette(page).locator('ninja-action')).toHaveCount(4);
    await page.keyboard.press('Alt+Shift+KeyP');
    await expect(page.locator('iframe[title="Language Check commands"]')).toHaveCount(0);
    expect(await checks(page)).toBe(before);
});

test('the binding can be changed on the options page', async ({ page, context, extensionId }) => {
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.getByLabel('Shortcut for the command palette').fill('ctrl+shift+l');
    await options.getByRole('button', { name: 'Save shortcut' }).click();
    await expect(options.locator('#status')).toContainText('ctrl+shift+l');
    await options.getByLabel('Shortcut for the command palette').fill('ctrl+banana');
    await options.getByRole('button', { name: 'Save shortcut' }).click();
    await expect(options.locator('#status')).toContainText('cannot be the shortcut');
    // Copy stays copy.
    await options.getByLabel('Shortcut for the command palette').fill('ctrl+c');
    await options.getByRole('button', { name: 'Save shortcut' }).click();
    await expect(options.locator('#status')).toContainText('"ctrl+c" cannot be the shortcut');

    await ready(page);
    await page.keyboard.press('Alt+Shift+KeyP');
    await expect(page.locator('iframe[title="Language Check commands"]')).toHaveCount(0);
    await page.keyboard.press('Control+Shift+KeyL');
    await expect(palette(page).locator('ninja-action')).toHaveCount(4);
});

test('a key event the page makes up does not open the palette', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => {
        for (const target of [document.activeElement ?? document.body, document.body]) {
            target.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', code: 'KeyP', keyCode: 80, altKey: true, shiftKey: true, bubbles: true, cancelable: true }));
        }
    });
    // eslint-disable-next-line sonarjs/no-fixed-wait-in-tests -- a palette that does not open has no event to wait on
    await page.waitForTimeout(500);
    await expect(page.locator('iframe[title="Language Check commands"]')).toHaveCount(0);
    // The user's own key still does.
    await page.keyboard.press('Alt+Shift+KeyP');
    await expect(palette(page).locator('ninja-action')).toHaveCount(4);
});

test('a command typed and entered straight after the binding runs, and no key reaches the document', async ({ page, context }) => {
    await ready(page);
    const before = await docText(page);
    // No waiting for the palette: a user types the command and Enter at once.
    await page.keyboard.press('Alt+Shift+KeyP');
    await page.keyboard.type('open sp', { delay: 0 });
    await page.keyboard.press('Enter');
    await expect.poll(() => panelPages(context, 'speedFix').length).toBe(1);
    await expect(page.locator('iframe[title="Language Check commands"]')).toHaveCount(0);
    expect(await docText(page)).toBe(before);
});

// The palette page holds the keyboard from its first moment. It used to
// start only on the content script's init message, and the frame took focus
// before that arrived: a key typed in the gap reached a page with nothing to
// take it, and was lost ("opn sp", so Enter matched nothing; seen as a flake
// under load). Here the gap is made as wide as it gets: every key is typed
// before the init message is sent, standing in for the content script.
test('keys typed into the palette before its init arrives are its search', async ({ page, extensionId }) => {
    await page.goto(`chrome-extension://${extensionId}/palette.html#${encodeURIComponent('alt+shift+p')}`);
    await page.keyboard.type('open sp', { delay: 0 });
    await page.evaluate(() => {
        // The content script's side: send the port, and when the palette is
        // ready, say nothing was typed into the site first.
        const channel = new MessageChannel();
        channel.port1.addEventListener('message', (event: MessageEvent) => {
            if ((event.data as { type?: string } | null)?.type === 'ready') channel.port1.postMessage({ type: 'typed', text: '', submit: false });
        });
        channel.port1.start();
        window.postMessage({ type: 'language-check:palette-init', ids: ['language-check.checkDocument', 'language-check.openSpeedFix'], hotkey: 'alt+shift+p' }, location.origin, [channel.port2]);
    });
    const search = page.locator('ninja-keys').locator('ninja-header').locator('input');
    await expect(search).toHaveValue('open sp');
});
