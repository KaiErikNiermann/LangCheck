// Gmail's compose, end to end (research/gmail-editor.md): the stand-in page
// is built to the live one's contract and sent with its Trusted Types
// policy, and the whole path (page, native host, real core) checks it. The
// small and the full-screen compose are one body at two sizes, so findings
// stay through the switch without the editor being joined again.
import type { Page } from '@playwright/test';
import { expect, gmailUrl, hoverPainted, painted, setForeignCheckers, status, test } from './fixtures';

const gmail = (page: Page, method: string, ...args: unknown[]): Promise<unknown> =>
    page.evaluate(([m, a]) => (globalThis as any).__gmail[m](...a), [method, args] as const);

async function open(page: Page, query: Record<string, string> = {}): Promise<void> {
    await page.goto(gmailUrl(query));
    await expect.poll(() => status(page)).toMatchObject({ state: 'attached' });
}

test('the compose is checked; the quoted message and the signature are not', async ({ page }) => {
    await open(page, { quote: 'Earlier you wrote wrod.' });
    await expect.poll(() => painted(page)).toEqual(['recieve', 'teh']);
    // The page holds Gmail's policy, so an HTML-string sink in our code would have thrown above.
    const enforced = await page.evaluate(() => {
        try {
            document.createElement('div').innerHTML = '<b>x</b>';
            return false;
        } catch {
            return true;
        }
    });
    expect(enforced).toBe(true);
});

test("a line's last word and the next line's first are two words", async ({ page }) => {
    // Run together, "endhere" would be a misspelling.
    await open(page, { text: 'These words end|here and fine.' });
    await expect.poll(() => status(page)).toMatchObject({ state: 'attached' });
    await expect.poll(() => page.evaluate(() => (globalThis as any).__languageCheck.stats().checks as number)).toBeGreaterThan(0);
    expect(await painted(page)).toEqual([]);
});

test('full screen and back keep the same editor and its findings', async ({ page }) => {
    await open(page);
    await expect.poll(() => painted(page)).toEqual(['recieve', 'teh']);
    const before = await status(page);
    await gmail(page, 'fullScreen');
    expect(await status(page)).toEqual(before);
    expect(await painted(page)).toEqual(['recieve', 'teh']);
    const card = await hoverPainted(page, 'teh');
    await expect(card.getByRole('button', { name: 'Fix: "the"' })).toBeVisible();
    await gmail(page, 'fullScreen');
    expect(await status(page)).toEqual(before);
});

test('a fix lands in the body as typed text', async ({ page }) => {
    await open(page);
    await expect.poll(() => painted(page)).toEqual(['recieve', 'teh']);
    const card = await hoverPainted(page, 'recieve');
    await card.getByRole('button', { name: 'Fix: "receive"' }).click();
    await expect.poll(() => gmail(page, 'text')).toContain('I will receive teh parcel.');
    await expect.poll(() => painted(page)).toEqual(['teh']);
});

test("the browser's own checker is off while ours absorbs it, and left alone under \"both\"", async ({ page, context, extensionId }) => {
    await open(page);
    await expect.poll(() => gmail(page, 'spellcheck')).toBe('false');
    await setForeignCheckers(context, extensionId, 'both');
    await expect.poll(() => gmail(page, 'spellcheck')).toBe('true');
});

test('with two composes open, the one being written in is checked', async ({ page }) => {
    await open(page, { composes: '2' });
    await gmail(page, 'focus', 1);
    await expect.poll(() => painted(page)).toEqual(['wrod']);
    await gmail(page, 'focus', 0);
    await expect.poll(() => painted(page)).toEqual(['recieve', 'teh']);
});

// The markup Gmail's size, bold and colour tools left in a live compose:
// each finding covers exactly its word, however the word is split.
test("formatted text: a word split by Gmail's size or bold tools is one finding over exactly that word", async ({ page }) => {
    await open(page, { fixture: 'formatted' });
    await expect.poll(() => painted(page)).toEqual(['recieve', 'teh', 'teh', 'recieve']);
    const card = await hoverPainted(page, 'recieve');
    await card.getByRole('button', { name: 'Fix: "receive"' }).click();
    await expect.poll(() => gmail(page, 'text')).toContain('Split by size: receive here.');
    await expect.poll(() => painted(page)).toEqual(['teh', 'teh', 'recieve']);
});
