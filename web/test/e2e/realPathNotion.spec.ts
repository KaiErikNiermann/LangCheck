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
