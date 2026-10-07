// Progressive checking (opt-in, on the options page): a long document's
// first check goes a window at a time, the part in view first, and each
// window's findings show as it lands; later checks are whole. What the page
// asks for is read off the wire (the page's MessagePort), what it shows off
// the client's counts: the editor draws only the lines in view.
import type { BrowserContext, Page } from '@playwright/test';
import { configPage, expect, host, longProse, pageUrl, setChecking, setText, status, test } from './fixtures';

/** Records each check the page sends: its window, or "whole". Before any page script runs. */
async function recordChecks(context: BrowserContext): Promise<void> {
    await context.addInitScript(() => {
        const sent: unknown[] = [];
        // eslint-disable-next-line unicorn/no-global-object-property-assignment -- the test's record, read back below
        (globalThis as any).__checksSent = sent;
        // eslint-disable-next-line @typescript-eslint/unbound-method -- called with its port below
        const post = MessagePort.prototype.postMessage;
        MessagePort.prototype.postMessage = function (this: MessagePort, ...args: Parameters<MessagePort['postMessage']>) {
            const check = (args[0] as { request?: { checkProse?: { window?: { startByte: number; endByte: number } } } } | null)?.request?.checkProse;
            if (check !== undefined) sent.push(check.window === undefined ? 'whole' : [check.window.startByte, check.window.endByte]);
            post.apply(this, args);
        } as MessagePort['postMessage'];
    });
}

type Sent = 'whole' | [number, number];
/** The checks the page has sent, from the `from`-th on. */
const checksSent = async (page: Page, from = 0): Promise<Sent[]> => {
    const all: Sent[] = await page.evaluate(() => [...(globalThis as any).__checksSent]);
    return all.slice(from);
};
const findings = (page: Page): Promise<number> => page.evaluate(() => (globalThis as any).__languageCheck.stats().findings as number);

/** The Overleaf stand-in with `text` open in it, as a file switch (too long for the URL). */
async function openLong(page: Page, text: string): Promise<number> {
    await page.goto(pageUrl('overleaf', 'current', 'Start.'));
    await expect.poll(() => status(page)).toMatchObject({ state: 'attached' });
    // The first file's check, whole (it is short), done.
    await expect.poll(() => page.evaluate(() => (globalThis as any).__languageCheck.stats().checks as number)).toBe(1);
    await host(page, 'switchFile', 'doc-long', 'long.tex', text);
    return 1;
}

test('a long document is first checked a window at a time, finding what a whole check finds; then checked whole', async ({ page, context, extensionId }) => {
    await recordChecks(context);
    await setChecking(context, extensionId, { progressive: true, windowKib: 1, maxKib: 0 });
    const { text, misspellings } = longProse(400, 40, '\n\n');
    const before = await openLong(page, text);
    await expect.poll(() => findings(page), { timeout: 30_000 }).toBe(misspellings.length);
    const windows = await checksSent(page, before);
    // A tiling of the text, 1 KiB a window, from the top (the cursor is there).
    const expected: [number, number][] = [];
    for (let start = 0; start < text.length; start += 1024) expected.push([start, Math.min(start + 1024, text.length)]);
    expect(windows).toEqual(expected);

    await host(page, 'typeAtEnd', ' Teh end.');
    await expect.poll(() => findings(page)).toBe(misspellings.length + 1);
    expect(await checksSent(page, before + windows.length)).toEqual(['whole']);
});

test('after a config change, the windows start where the cursor is in view', async ({ page, context, extensionId }) => {
    await recordChecks(context);
    await setChecking(context, extensionId, { progressive: true, windowKib: 1, maxKib: 0 });
    const { text, misspellings } = longProse(400, 40, '\n\n');
    await openLong(page, text);
    await expect.poll(() => findings(page), { timeout: 30_000 }).toBe(misspellings.length);
    // The cursor near the end, scrolled into view.
    const cursor = text.length - 10;
    await page.evaluate((at) => {
        (globalThis as any).__host.view.dispatch({ selection: { anchor: at }, scrollIntoView: true });
    }, cursor);
    // Scrolled: the document's top is above the screen.
    await expect.poll(() => page.evaluate(() => (globalThis as any).__host.view.documentTop as number)).toBeLessThan(0);
    const sent = await checksSent(page);
    const config = await configPage(page, context);
    await setText(config, 'engines:\n  harper: true\n');
    await expect(config.locator('#status')).toHaveText('Saved');
    const sentSince = async (): Promise<number> => {
        const since = await checksSent(page, sent.length);
        return since.length;
    };
    await expect.poll(sentSince, { timeout: 30_000 }).toBeGreaterThan(1);
    // The window holding the cursor first.
    const [first] = await checksSent(page, sent.length);
    expect(first).toEqual([Math.floor(cursor / 1024) * 1024, Math.min(Math.floor(cursor / 1024) * 1024 + 1024, text.length)]);
    await expect.poll(() => findings(page), { timeout: 30_000 }).toBe(misspellings.length);
});

test('maxBytes bounds the check: what starts past it is not checked', async ({ page, context, extensionId }) => {
    await recordChecks(context);
    await setChecking(context, extensionId, { progressive: false, windowKib: 16, maxKib: 4 });
    const { text, misspellings } = longProse(400, 40, '\n\n');
    const before = await openLong(page, text);
    const within = misspellings.filter((at) => at < 4096).length;
    expect(within).toBeGreaterThan(0);
    expect(within).toBeLessThan(misspellings.length);
    await expect.poll(() => findings(page), { timeout: 30_000 }).toBe(within);
    expect(await checksSent(page, before)).toEqual([[0, 4096]]);
});

test('typing while the windows are on their way leaves the findings of the text as it is', async ({ page, context, extensionId }) => {
    await setChecking(context, extensionId, { progressive: true, windowKib: 1, maxKib: 0 });
    const { text, misspellings } = longProse(400, 40, '\n\n');
    await openLong(page, text);
    await host(page, 'typeAtEnd', ' Teh end.');
    await expect.poll(() => findings(page), { timeout: 30_000 }).toBe(misspellings.length + 1);
    // And it stays so: nothing from the first text lands late.
    // eslint-disable-next-line sonarjs/no-fixed-wait-in-tests -- a late answer has no event to wait on
    await page.waitForTimeout(1000);
    expect(await findings(page)).toBe(misspellings.length + 1);
});
