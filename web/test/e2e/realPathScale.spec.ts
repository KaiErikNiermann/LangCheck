// Long documents and memory, through the whole path. The figures each test
// measures are appended to .bench/scale.jsonl, so a run can be
// compared with the last; the ceilings asserted are several times what
// was measured when they were set (see each), so they catch a regression
// in kind (a leak, a quadratic step), not noise.
import type { Page } from '@playwright/test';
import { record } from '../bench/probe';
import { docText, expect, host, longProse, marks, pageUrl, status, test } from './fixtures';

type Stats = { checks: number; findings: number };
const findings = (page: Page): Promise<number> => page.evaluate(() => ((globalThis as any).__languageCheck.stats() as Stats).findings);
const endsWith = async (page: Page, tail: string): Promise<boolean> => {
    const text = await docText(page);
    return text.endsWith(tail);
};

/** Opens the Overleaf stand-in and puts `text` in it (too long for the URL), as a file switch. */
async function openWith(page: Page, text: string): Promise<void> {
    await page.goto(pageUrl('overleaf', 'current', 'Start.'));
    await expect.poll(() => status(page)).toMatchObject({ state: 'attached' });
    await host(page, 'switchFile', 'doc-long', 'long.tex', text);
}

test('a long document is checked whole: findings off screen are held, and drawn when scrolled to', async ({ page }) => {
    const { text, misspelt } = longProse(4000, 200);
    const started = performance.now();
    await openWith(page, text);
    await expect.poll(() => findings(page), { timeout: 40_000 }).toBe(misspelt);
    const firstAnswerMs = performance.now() - started;
    // CodeMirror draws only what is near the viewport: the last line's finding
    // is not in the DOM until scrolled to.
    await page.evaluate(() => {
        const { view } = (globalThis as any).__host;
        view.dispatch({ selection: { anchor: view.state.doc.length }, scrollIntoView: true });
    });
    await expect(page.locator('.cm-line', { hasText: 'Line 4000 ' }).locator('.lc-diag')).toHaveText('recieve');
    record('long-document', { chars: text.length, findings: misspelt, firstAnswerMs });
    // Measured 2026-10-07: 11.0 s for 4000 lines, 275 kB (debug core, one
    // worker). Ceiling 3x: slow enough to show, and what streamed checking
    // (plan step 11) is for.
    expect(firstAnswerMs).toBeLessThan(33_000);
});

test('a document over the size cap is not sent, the page says so once, and editing goes on', async ({ page }) => {
    // Past the 2 Mi character cap of the page protocol.
    const huge = 'word '.repeat(450_000);
    await openWith(page, huge);
    await expect(page.locator('.lc-toast')).toBeVisible({ timeout: 30_000 });
    const message = await page.locator('.lc-toast').textContent();
    record('over-cap', { chars: huge.length });
    expect(message).toContain('too long for LangCheck to check');
    // Typing goes on, and the check after it does not say it again: the
    // toast, gone after its few seconds, stays gone.
    await expect(page.locator('.lc-toast')).toBeHidden({ timeout: 10_000 });
    await host(page, 'typeAtEnd', 'x');
    expect(await endsWith(page, 'word x')).toBe(true);
    // A refused check is silent by design, so there is no event to wait on:
    // past the 500 ms typing pause, with room to spare.
    // eslint-disable-next-line sonarjs/no-fixed-wait-in-tests -- see above
    await page.waitForTimeout(2000);
    await expect(page.locator('.lc-toast')).toBeHidden();
    expect(await marks(page).count()).toBe(0);
});
