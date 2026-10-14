// A panel opens as its page's split-view partner where the browser makes
// splits (Chrome 155 and later), as VS Code opens it beside the editor.
// Skipped on a browser without `tabs.createSplit`; the pinned Playwright's
// Chromium is older, so run it on a newer build:
//   LC_CHROMIUM=/path/to/chrome pnpm exec playwright test realPathSplit
import type { BrowserContext } from '@playwright/test';
import { expect, marks, openPanel, pageUrl, test } from './fixtures';

/**
 * The split view of each tab, as the extension's background sees them. It
 * has no `tabs` permission, so no URLs: a tab is told by its split alone.
 */
async function splits(context: BrowserContext): Promise<number[]> {
    const worker = context.serviceWorkers()[0];
    if (worker === undefined) throw new Error('no background worker');
    return worker.evaluate(async () => {
        const all = await (globalThis as unknown as { chrome: { tabs: { query: (q: object) => Promise<{ splitViewId?: number }[]> } } }).chrome.tabs.query({});
        return all.map((t) => t.splitViewId ?? -1);
    });
}

/** How many tabs are in each split view. */
const splitSizes = async (context: BrowserContext): Promise<number[]> => {
    const sizes = new Map<number, number>();
    const ids = await splits(context);
    for (const id of ids) if (id !== -1) sizes.set(id, (sizes.get(id) ?? 0) + 1);
    return [...sizes.values()];
};

const knowsSplits = (context: BrowserContext): Promise<boolean> =>
    context.serviceWorkers()[0]?.evaluate(() => typeof (globalThis as unknown as { chrome: { tabs: { createSplit?: unknown } } }).chrome.tabs.createSplit === 'function') ?? Promise.resolve(false);

test('SpeedFix opens split beside its page, and closing it leaves the page whole', async ({ page, context }) => {
    // A browser without split views has nothing to test here.
    test.skip(!(await knowsSplits(context)), 'this browser has no split views (tabs.createSplit)');
    await page.goto(pageUrl('overleaf', 'current', 'I will recieve it.'));
    await expect(marks(page)).toHaveText(['recieve']);
    expect(await splitSizes(context)).toEqual([]);
    await page.locator('.cm-content').click();
    const panel = await openPanel(page, 'Open SpeedFix', 'speedFix');
    await panel.locator('#app *').first().waitFor();
    // The page and its panel: one split of two.
    expect(await splitSizes(context)).toEqual([2]);

    await panel.close();
    await expect.poll(() => splitSizes(context)).toEqual([]);
});

test('a second panel, with the page split already, opens as a plain tab', async ({ page, context }) => {
    // A browser without split views has nothing to test here.
    test.skip(!(await knowsSplits(context)), 'this browser has no split views (tabs.createSplit)');
    await page.goto(pageUrl('overleaf', 'current', 'I will recieve it.'));
    await expect(marks(page)).toHaveText(['recieve']);
    await page.locator('.cm-content').click();
    await openPanel(page, 'Open SpeedFix', 'speedFix');
    const { length: before } = await splits(context);
    await page.bringToFront();
    await page.locator('.cm-content').click();
    const inspector = await openPanel(page, 'Open Inspector', 'inspector');
    await inspector.locator('#app *').first().waitFor();
    expect(await splits(context)).toHaveLength(before + 1);
    expect(await splitSizes(context)).toEqual([2]);
});
