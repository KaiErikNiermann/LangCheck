// Notion through the whole path: the extension, the native host and the real
// core, against the stand-in page. Findings here are CSS highlights, not
// DOM marks, so the assertions read CSS.highlights and drive the real pointer.
import type { Page } from '@playwright/test';
import { expect, hoverPainted, notionSaved, notionUrl, painted, status, test } from './fixtures';

test('paints what the core finds in prose leaves, and leaves code and equations alone', async ({ page }) => {
    await page.goto(notionUrl());
    await expect.poll(() => status(page)).toMatchObject({ state: 'attached', languageId: 'markdown' });
    // The heading's recieve, then bold teh, italic recieve, and the teh after
    // the equation: not the inline code's teh, nor anything in the code block.
    await expect.poll(() => painted(page)).toEqual(['recieve', 'teh', 'recieve', 'teh']);
});

test('a fix from the card reaches the editor as input and is saved, formatting intact', async ({ page }) => {
    await page.goto(notionUrl());
    await expect.poll(() => painted(page)).toHaveLength(4);
    const card = await hoverPainted(page, 'recieve', 1);
    await expect(card.locator('p').first()).toHaveText('Did you mean to spell `recieve` this way?');
    await card.getByRole('button', { name: 'Fix: "receive"' }).click();
    await expect.poll(() => notionSaved(page)).toContain('bold teh and italic receive and inline code teh plus e=mc2e=mc^2 after, teh end.');
    await expect(page.locator('span[style="font-style:italic"]')).toHaveText('italic receive');
    await expect.poll(() => painted(page)).toEqual(['recieve', 'teh', 'teh']);
});

test('"Fix all in file" is refused whole where the editor takes one edit at a time, and the page is untouched', async ({ page }) => {
    const errors: string[] = [];
    // The extension's own errors (the stand-in has no favicon, which the console reports too).
    page.on('console', (message) => {
        if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) errors.push(message.text());
    });
    page.on('pageerror', (error) => {
        errors.push(error.message);
    });
    await page.goto(notionUrl());
    await expect.poll(() => painted(page)).toHaveLength(4);
    const before = await notionSaved(page);
    const checks = (): Promise<number> => page.evaluate(() => (globalThis as any).__languageCheck.stats().checks as number);
    const checked = await checks();
    const card = await hoverPainted(page, 'recieve', 0);
    await card.getByRole('button', { name: 'Fix all "recieve" in this file' }).click();
    // Refused, it re-checks the page as it is.
    await expect.poll(checks).toBeGreaterThan(checked);
    expect(await notionSaved(page)).toEqual(before);
    await expect.poll(() => painted(page)).toEqual(['recieve', 'teh', 'recieve', 'teh']);
    expect(errors).toEqual([]);
});

test('the finding after the equation is placed exactly, past the atom', async ({ page }) => {
    await page.goto(notionUrl());
    await expect.poll(() => painted(page)).toHaveLength(4);
    const card = await hoverPainted(page, 'teh', 1);
    await card.getByRole('button', { name: 'Fix: "the"' }).click();
    await expect.poll(() => notionSaved(page)).toContain('bold teh and italic recieve and inline code teh plus e=mc2e=mc^2 after, the end.');
});

test('moving to another page re-attaches to that page', async ({ page }) => {
    await page.goto(notionUrl());
    await expect.poll(() => painted(page)).toHaveLength(4);
    await page.evaluate(() => (globalThis as any).__notion.navigate('aa24b3e9dafd4deb8617a6a09693570f'));
    await expect.poll(() => status(page)).toMatchObject({ state: 'attached', uri: expect.stringContaining('aa24b3e9dafd4deb8617a6a09693570f') });
    await expect.poll(() => painted(page)).toEqual(['recieve']);
});

// Notion shows a page full size, or peeked over another (side or centre):
// the peeked page is drawn in its own renderer, the page in the path stays
// behind it. Whichever is in front is the one checked.
const OTHER = 'aa24b3e9dafd4deb8617a6a09693570f';
const peek = (page: Page, mode: 's' | 'c') => page.evaluate(([id, m]) => (globalThis as any).__notion.peek(id, m), [OTHER, mode] as const);

for (const [label, mode] of [['side', 's'], ['centre', 'c']] as const) {
    test(`a ${label} peek is checked as its own page, and closing it returns to the page behind`, async ({ page }) => {
        await page.goto(notionUrl());
        await expect.poll(() => painted(page)).toHaveLength(4);
        await peek(page, mode);
        await expect.poll(() => status(page)).toMatchObject({ state: 'attached', uri: expect.stringContaining(OTHER) });
        // Only the peeked page's finding: the page behind is not painted meanwhile.
        await expect.poll(() => painted(page)).toEqual(['recieve']);
        await page.evaluate(() => (globalThis as any).__notion.closePeek());
        await expect.poll(() => status(page)).toMatchObject({ state: 'attached', uri: expect.stringContaining('3f2b8b37e541802f96a1c557a6b01a44') });
        await expect.poll(() => painted(page)).toHaveLength(4);
    });
}

test('a fix in a peek is saved to the peeked page, and the page behind is untouched', async ({ page }) => {
    await page.goto(notionUrl());
    await expect.poll(() => painted(page)).toHaveLength(4);
    const behind = await notionSaved(page);
    await peek(page, 's');
    await expect.poll(() => painted(page)).toEqual(['recieve']);
    const card = await hoverPainted(page, 'recieve');
    await card.getByRole('button', { name: 'Fix: "receive"' }).click();
    await expect.poll(() => notionSaved(page, OTHER)).toContain('Nothing wrong here, only receive once.');
    expect(await notionSaved(page)).toEqual(behind);
});

// Notion is a single-page app: a session can start on a page that names no
// workspace (its home), and move into a page, or to another workspace,
// without a load.
test('starting on Notion\'s home, the page opened from it is checked', async ({ page }) => {
    await page.goto(notionUrl().replace(/\/p\/.*$/u, '/home'));
    await expect.poll(() => status(page)).toMatchObject({ state: 'absent' });
    await page.evaluate(() => (globalThis as any).__notion.navigate('3f2b8b37e541802f96a1c557a6b01a44'));
    await expect.poll(() => status(page), { timeout: 15_000 }).toMatchObject({ state: 'attached' });
    await expect.poll(() => painted(page)).toHaveLength(4);
});

test('a move to another workspace starts over in that workspace, with its own dictionary', async ({ page }) => {
    await page.goto(notionUrl());
    await expect.poll(() => painted(page)).toHaveLength(4);
    // Learned in this workspace...
    const card = await hoverPainted(page, 'recieve');
    await card.getByRole('button', { name: 'Add "recieve" to dictionary' }).click();
    await expect.poll(() => painted(page)).toEqual(['teh', 'teh']);
    // ...and not in the other, which the background must now serve.
    await page.evaluate(() => (globalThis as any).__notion.navigate('aa24b3e9dafd4deb8617a6a09693570f', 'other-workspace'));
    await expect.poll(() => status(page), { timeout: 15_000 }).toMatchObject({ state: 'attached', uri: expect.stringContaining('/other-workspace/') });
    await expect.poll(() => painted(page)).toEqual(['recieve']);
});

// Each start of the page script takes one of the tab's few ports; leaving
// a workspace and coming back must give it back, or a few moves would cut
// the tab off for good.
test('leaving and coming back many times keeps the page checked', async ({ page }) => {
    await page.goto(notionUrl());
    await expect.poll(() => painted(page)).toHaveLength(4);
    for (let round = 0; round < 6; round++) {
        await page.evaluate(() => { history.pushState({}, '', '/home'); });
        await expect.poll(() => status(page), { timeout: 15_000 }).toMatchObject({ state: 'absent' });
        await page.evaluate(() => (globalThis as any).__notion.navigate('3f2b8b37e541802f96a1c557a6b01a44'));
        await expect.poll(() => status(page), { timeout: 15_000 }).toMatchObject({ state: 'attached' });
        await expect.poll(() => painted(page)).toHaveLength(4);
    }
});

// Found validating live: a refused fix's toast sat in the corner of a host
// with no size, and shrank to a column one word wide.
test('a refused fix says so in a toast that reads as a line, not a column', async ({ page }) => {
    await page.goto(notionUrl());
    await expect.poll(() => painted(page)).toHaveLength(4);
    const before = await notionSaved(page);
    // The editor turns the input down, as a page that moved focus or the text in between would.
    await page.evaluate(() => {
        // eslint-disable-next-line sonarjs/deprecation, @typescript-eslint/no-deprecated
        document.execCommand = () => false;
    });
    const card = await hoverPainted(page, 'recieve', 1);
    await card.getByRole('button', { name: 'Fix: "receive"' }).click();
    const toast = page.locator('.lc-toast');
    await expect(toast).toContainText('not applied');
    const box = await toast.boundingBox();
    expect(box).not.toBeNull();
    if (box !== null) expect(box.width).toBeGreaterThan(box.height * 2);
    expect(await notionSaved(page)).toEqual(before);
});
