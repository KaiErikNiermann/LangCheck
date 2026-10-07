// The page-world half on both engines (Firefox cannot load an extension
// under Playwright, so the full path runs in realPath.spec.ts on Chromium).
// The built page bundle runs against a stub content script whose "core"
// can be held, so the window between an edit and its recheck is testable.
import { expect, test, type Page } from '@playwright/test';
import { host, pageUrl, type Site } from './fixtures';

const BASE = 'http://127.0.0.1:4180';

async function open(page: Page, site: Site, text: string, cm: 'current' | '6.38' = 'current'): Promise<void> {
    const errors: string[] = [];
    page.on('pageerror', (e) => {
        errors.push(e.message);
    });
    await page.goto(pageUrl(site, cm, text));
    await page.addScriptTag({ url: `${BASE}/stub-content.js` });
    await page.addScriptTag({ url: `${BASE}/extension/page-${site}.js` });
    await expect.poll(() => page.evaluate(() => (globalThis as any).__languageCheck?.bridge.getStatus().state)).toBe('attached');
    test.info().annotations.push({ type: 'errors', description: 'checked after the test' });
    pageErrors.set(page, errors);
}
const pageErrors = new WeakMap<Page, string[]>();
test.afterEach(({ page }) => expect(pageErrors.get(page) ?? []).toEqual([]));

const marks = (page: Page) => page.locator('.lc-diag');
const card = (page: Page) => page.locator('.lc-popover:not([hidden])');
const stub = (page: Page, code: string) => page.evaluate(code);
const checks = (page: Page) => page.evaluate(() => (globalThis as any).__stub.checks as number);

async function hover(page: Page, text: string) {
    await page.mouse.move(0, 0);
    await page.locator('.lc-diag', { hasText: new RegExp(`^${text}$`, 'u') }).hover();
    await expect(card(page)).toBeVisible();
    return card(page);
}

test('squiggles, hints and the card, on the host page’s own CodeMirror (6.38 and current)', async ({ page }) => {
    for (const cm of ['6.38', 'current'] as const) {
        await open(page, 'overleaf', 'Café recieve teh.', cm);
        await expect(marks(page)).toHaveText(['recieve', 'teh']);
        await expect(page.locator('[data-lc-hint]')).toHaveCount(2);
        const c = await hover(page, 'teh');
        await expect(c.locator('.lc-action')).toHaveText(['Replace with "the"', 'Add "teh" to dictionary', 'Ignore this finding']);
    }
});

// Between an edit and its recheck the offered ranges are stale, so no fix is
// offered, and the card reads the finding at its mapped position. Before the
// adapter read the mapped decorations, a lookup here used pre-edit offsets.
test('between an edit and its recheck: the card follows the moved finding and offers no stale fix', async ({ page }) => {
    await open(page, 'typst', 'I will recieve it.');
    await expect(marks(page)).toHaveText(['recieve']);
    await stub(page, '__stub.hold = true');
    await host(page, 'remoteInsert', 0, 'Well, ');
    const c = await hover(page, 'recieve');
    await expect(c.locator('p').first()).toHaveText('Did you mean to spell `recieve` this way?');
    await expect(c.locator('.lc-action')).toHaveCount(0);
    // The recheck lands while the card is open: it refreshes in place.
    await stub(page, '__stub.release()');
    await c.getByRole('button', { name: 'Replace with "receive"' }).click();
    await expect.poll(() => host(page, 'text')).toBe('Well, I will receive it.');
});

test('a recheck that removes the finding closes its card', async ({ page }) => {
    await open(page, 'overleaf', 'teh and teh.');
    await page.locator('.lc-diag').first().hover();
    const c = card(page);
    await expect(c).toBeVisible();
    await c.getByRole('button', { name: 'Add "teh" to dictionary' }).click();
    await expect(marks(page)).toHaveCount(0);
    await expect(card(page)).toHaveCount(0);
});

test('Ctrl+. opens the card at the cursor with focus on the first action; Escape returns to the text', async ({ page }) => {
    await open(page, 'overleaf', 'I recieve.');
    await page.locator('.lc-diag').click();
    await page.keyboard.press('Control+Period');
    await expect(card(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Replace with "receive"' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(card(page)).toHaveCount(0);
    await expect(page.locator('.cm-content')).toBeFocused();
});

test('the card follows its mark when the host reconfigures the layout', async ({ page }) => {
    await open(page, 'overleaf', 'I recieve.');
    const c = await hover(page, 'recieve');
    const gap = async () => {
        const m = (await page.locator('.lc-diag').boundingBox())!;
        const b = (await c.boundingBox())!;
        return [Math.round(b.x - m.x), Math.round(b.y - m.y - m.height)];
    };
    const before = await gap();
    await host(page, 'reconfigure');
    await expect.poll(gap).toEqual(before);
});

test('an unavailable core is reported once, however much is typed', async ({ page }) => {
    await page.goto(pageUrl('overleaf', 'current', 'teh'));
    await page.addScriptTag({ url: `${BASE}/stub-content.js` });
    await stub(page, '__stub.unavailable = true');
    await page.addScriptTag({ url: `${BASE}/extension/page-overleaf.js` });
    await expect(page.locator('.lc-toast')).toContainText('cannot reach its checker');
    for (const word of [' one', ' two', ' three']) {
        const before = await checks(page);
        await host(page, 'typeAtEnd', word);
        // Each edit is checked (and refused) before the next one.
        await expect.poll(() => checks(page)).toBeGreaterThan(before);
    }
    await expect(page.locator('.lc-toast')).toHaveCount(1);
    await expect(page.locator('.lc-toast')).toContainText('cannot reach its checker');
});

test('a file switch, a remount and a re-injected build each leave exactly one layer', async ({ page }) => {
    await open(page, 'overleaf', 'teh one.');
    await host(page, 'switchFile', 'doc-2', 'b.tex', 'teh two teh.');
    await expect(marks(page)).toHaveText(['teh', 'teh']);
    await host(page, 'remount', 'recieve three.');
    await expect(marks(page)).toHaveText(['recieve']);
    await page.addScriptTag({ url: `${BASE}/extension/page-overleaf.js` });
    await expect.poll(() => page.evaluate(() => (globalThis as any).__languageCheck?.bridge.getStatus().state)).toBe('attached');
    await expect(marks(page)).toHaveText(['recieve']);
    await expect(page.locator('.lc-diag .lc-diag')).toHaveCount(0);
});

test('stop() leaves the editor as it found it', async ({ page }) => {
    await open(page, 'typst', 'teh end.');
    await hover(page, 'teh');
    await page.evaluate(() => (globalThis as any).__languageCheck.stop());
    await expect(page.locator('[class*="lc-"]')).toHaveCount(0);
    expect(await host(page, 'text')).toBe('teh end.');
});
