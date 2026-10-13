// The page-world half on both engines (Firefox cannot load an extension
// under Playwright, so the full path runs in realPath.spec.ts on Chromium).
// The built page bundle runs against a stub content script whose "core"
// can be held, so the window between an edit and its recheck is testable.
import { expect, test, type Page } from '@playwright/test';
import { gmailUrl, host, hoverPainted, notionUrl, pageUrl, painted, withForeign, type Site } from './fixtures';

const BASE = 'http://127.0.0.1:4180';

async function open(page: Page, site: Site, text: string, cm: 'current' | '6.38' = 'current', foreign: readonly string[] = []): Promise<void> {
    const errors: string[] = [];
    page.on('pageerror', (e) => {
        errors.push(e.message);
    });
    await page.goto(foreign.length === 0 ? pageUrl(site, cm, text) : withForeign(pageUrl(site, cm, text), foreign));
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
        await expect(c.locator('.lc-action')).toHaveText(['Fix: "the"', 'Add "teh" to dictionary', 'Ignore this issue']);
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
    await c.getByRole('button', { name: 'Fix: "receive"' }).click();
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
    await expect(page.getByRole('button', { name: 'Fix: "receive"' })).toBeFocused();
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

test('an unavailable core is reported once and not asked again on every edit, then recovers', async ({ page }) => {
    await page.goto(pageUrl('overleaf', 'current', 'teh'));
    await page.addScriptTag({ url: `${BASE}/stub-content.js` });
    await stub(page, '__stub.unavailable = true');
    await page.addScriptTag({ url: `${BASE}/extension/page-overleaf.js` });
    await expect(page.locator('.lc-toast')).toContainText('cannot reach its checker');
    const asked = await checks(page);
    for (const word of [' one', ' two', ' three']) await host(page, 'typeAtEnd', word);
    // While it is down the Checker does not ask (as with VS Code's core);
    // only the transport's probes reach it.
    // eslint-disable-next-line sonarjs/no-fixed-wait-in-tests -- asserting that nothing more is asked takes time passing
    await page.waitForTimeout(1500);
    expect(await checks(page)).toBe(asked);
    await expect(page.locator('.lc-toast')).toHaveCount(1);
    // The host comes back: the next probe finds it, and the document is checked.
    await stub(page, '__stub.unavailable = false');
    await expect(page.locator('.lc-diag')).toHaveText(['teh'], { timeout: 10_000 });
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

test.describe('Notion (DOM editor, CSS highlights)', () => {
    async function openNotion(page: Page): Promise<void> {
        const errors: string[] = [];
        page.on('pageerror', (e) => {
            errors.push(e.message);
        });
        pageErrors.set(page, errors);
        await page.goto(notionUrl());
        await page.addScriptTag({ url: `${BASE}/stub-content.js` });
        await page.addScriptTag({ url: `${BASE}/extension/page-notion.js` });
        await expect.poll(() => page.evaluate(() => (globalThis as any).__languageCheck?.bridge.getStatus().state)).toBe('attached');
    }

    test('paints prose findings only, and the card opens on hover and closes on Escape', async ({ page }) => {
        await openNotion(page);
        // The stub flags teh/recieve: the heading, bold, italic and the teh
        // after the equation, not the inline code or the code block.
        await expect.poll(() => painted(page)).toEqual(['recieve', 'teh', 'recieve', 'teh']);
        const c = await hoverPainted(page, 'teh', 0);
        // Two "teh" on the page: the client also offers fixing them all, as in VS Code.
        await expect(c.locator('.lc-action')).toHaveText(['Fix: "the"', 'Add "teh" to dictionary', 'Ignore this issue', 'Fix all "teh" in this file', 'Fix all "teh" in workspace']);
        await page.keyboard.press('Escape');
        await expect(card(page)).toHaveCount(0);
    });

    test('a re-render that replaces the text nodes never leaves a span on the wrong words', async ({ page }) => {
        await openNotion(page);
        await expect.poll(() => painted(page)).toHaveLength(4);
        await page.evaluate(() => (globalThis as any).__notion.rerender(true));
        // Straight after, the old ranges are collapsed (nothing painted), and
        // the recheck repaints the same words; at no point anything else.
        const seen = await painted(page);
        expect(seen.filter((w) => w !== '' && !['recieve', 'teh'].includes(w))).toEqual([]);
        await expect.poll(() => painted(page)).toEqual(['recieve', 'teh', 'recieve', 'teh']);
    });

    test('typed text is checked, and the card offers no fix until the recheck lands', async ({ page }) => {
        await openNotion(page);
        await expect.poll(() => painted(page)).toHaveLength(4);
        await stub(page, '__stub.hold = true');
        await page.locator('[data-content-editable-leaf]').first().click();
        await page.keyboard.press('End');
        await page.keyboard.type(' and teh');
        const c = await hoverPainted(page, 'teh', 0);
        await expect(c.locator('.lc-action')).toHaveCount(0);
        await stub(page, '__stub.release()');
        await expect.poll(() => painted(page)).toHaveLength(5);
        await expect(c.locator('.lc-action').first()).toHaveText('Fix: "the"');
    });

    test('Ctrl+. at a finding opens the card with focus on its first action', async ({ page }) => {
        await openNotion(page);
        await expect.poll(() => painted(page)).toHaveLength(4);
        await page.locator('[data-content-editable-leaf]').nth(1).click();
        await page.keyboard.press('End');
        await page.keyboard.press('Control+Period');
        await expect(card(page)).toBeVisible();
        await expect(page.getByRole('button', { name: 'Fix: "receive"' })).toBeFocused();
    });

    test('without the Highlight API it says so instead of attaching', async ({ page }) => {
        await page.goto(notionUrl());
        await page.evaluate(() => {
            Object.defineProperty(globalThis, 'Highlight', { value: undefined });
        });
        await page.addScriptTag({ url: `${BASE}/stub-content.js` });
        await page.addScriptTag({ url: `${BASE}/extension/page-notion.js` });
        await expect
            .poll(() => page.evaluate(() => (globalThis as any).__languageCheck?.bridge.getStatus()))
            .toMatchObject({ state: 'waiting', reason: expect.stringContaining('Highlight API') });
    });

    test('stop() removes every highlight, card and style', async ({ page }) => {
        await openNotion(page);
        await expect.poll(() => painted(page)).toHaveLength(4);
        await page.evaluate(() => (globalThis as any).__languageCheck.stop());
        expect(await page.evaluate(() => [...CSS.highlights.keys()])).toEqual([]);
        await expect(page.locator('.lc-popover, .lc-toast-host')).toHaveCount(0);
    });
});

// The site's own spellchecker (research/foreign-checkers.md): read out of
// the page's CodeMirror, sent with the check, its marks hidden while merged.
// On both engines and both sides of the 6.39 rewrite; the core's half is in
// realPathForeign.spec.ts.
for (const site of ['typst', 'overleaf'] as const) {
    test(`${site}: the site's own spellchecker is read, sent with the check, and hidden (6.38 and current)`, async ({ page }) => {
        for (const cm of ['6.38', 'current'] as const) {
            await open(page, site, 'I recieve teh parcel.', cm, ['teh', 'parcel']);
            await expect(marks(page)).toHaveText(['recieve', 'teh', 'parcel']);
            const sent = await page.evaluate(() => (globalThis as any).__stub.foreign.map((f: { checker: string; startByte: number }) => `${f.checker}@${String(f.startByte)}`));
            expect(sent).toEqual([`${site}@10`, `${site}@14`]);
            await expect(page.locator(`.cm-editor[data-lc-absorb="${site}"]`)).toHaveCount(1);
            const shown = await page.locator(site === 'typst' ? '.cm-lintRange.misspelling' : '.ol-cm-spelling-error').evaluateAll((elements, typst) =>
                elements.map((el) => (typst ? getComputedStyle(el).backgroundImage : getComputedStyle(el).textDecorationLine) !== 'none'), site === 'typst');
            expect(shown.length).toBeGreaterThan(0);
            expect(shown).not.toContain(true);
            const c = await hover(page, 'parcel');
            await expect(c.locator('p').first()).toHaveText(site === 'typst' ? 'the word "parcel" seems to be misspelled' : 'Possible spelling mistake: "parcel" (overleaf)');
            await expect(page.locator('.cm-tooltip-hover')).toBeHidden();
        }
    });
}

// Gmail's compose on both engines: one body, lines as <div>s, the quote and
// the signature left out, and full screen the same body at another size.
// ?tt=0: the stub and the page bundle are injected by script tags here,
// which Gmail's Trusted Types policy (on in the real-path suite) would stop.
test.describe('Gmail (DOM editor, one body)', () => {
    async function openGmail(page: Page): Promise<void> {
        const errors: string[] = [];
        page.on('pageerror', (e) => {
            errors.push(e.message);
        });
        pageErrors.set(page, errors);
        await page.goto(gmailUrl({ tt: '0', quote: 'You wrote wrod.' }));
        await page.addScriptTag({ url: `${BASE}/stub-content.js` });
        await page.addScriptTag({ url: `${BASE}/extension/page-gmail.js` });
        await expect.poll(() => page.evaluate(() => (globalThis as any).__languageCheck?.bridge.getStatus().state)).toBe('attached');
    }

    test('paints the compose only, keeps it through full screen, and a fix lands in the body', async ({ page }) => {
        await openGmail(page);
        await expect.poll(() => painted(page)).toEqual(['recieve', 'teh']);
        await page.evaluate(() => {
            (globalThis as any).__gmail.fullScreen();
        });
        expect(await painted(page)).toEqual(['recieve', 'teh']);
        const c = await hoverPainted(page, 'recieve', 0);
        await c.getByRole('button', { name: 'Fix: "receive"' }).click();
        await expect.poll(() => page.evaluate(() => (globalThis as any).__gmail.text() as string)).toContain('I will receive teh parcel.');
    });
});

