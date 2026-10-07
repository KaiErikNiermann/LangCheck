// The whole path, for both sites and for CodeMirror on both sides of the
// 6.39 rewrite: the real core decides what is squiggled, so these assert
// the spans and texts a user would see.
import { docText, expect, host, hoverMark, marks, pageUrl, popover, status, test, type Cm, type Site } from './fixtures';

const CASES: readonly (readonly [Site, Cm])[] = [
    ['overleaf', 'current'],
    ['overleaf', '6.38'],
    ['typst', 'current'],
    ['typst', '6.38'],
];

for (const [site, cm] of CASES) {
    test.describe(`${site} on CodeMirror ${cm}`, () => {
        test('squiggles what the core finds, fixes it, and rechecks', async ({ page }) => {
            await page.goto(pageUrl(site, cm, 'I will recieve teh parcel tomorrow.\nTeh end.'));
            await expect.poll(() => status(page)).toMatchObject({ state: 'attached', languageId: site === 'overleaf' ? 'latex' : 'typst' });
            await expect(marks(page)).toHaveText(['recieve', 'teh', 'Teh']);
            await expect(page.locator('[data-lc-hint]').first()).toHaveAttribute('data-lc-hint', '→ receive');

            const card = await hoverMark(page, 'recieve');
            await expect(card.locator('p').first()).toHaveText('Did you mean to spell `recieve` this way?');
            await card.getByRole('button', { name: 'Fix: "receive"' }).click();
            expect(await docText(page)).toBe('I will receive teh parcel tomorrow.\nTeh end.');
            await expect(marks(page)).toHaveText(['teh', 'Teh']);
        });

        test('a learned word stays learned, across a reload, in that project only', async ({ page, context }) => {
            await page.goto(pageUrl(site, cm, 'Teh zorblax end.'));
            await expect(marks(page)).toHaveText(['Teh', 'zorblax']);
            const card = await hoverMark(page, 'zorblax');
            await card.getByRole('button', { name: 'Add "zorblax" to dictionary' }).click();
            await expect(page.locator('.lc-toast')).toHaveText('Added "zorblax" to dictionary');
            await expect(marks(page)).toHaveText(['Teh']);

            await page.reload();
            await expect.poll(() => status(page)).toMatchObject({ state: 'attached' });
            await expect(marks(page)).toHaveText(['Teh']);

            const other = await context.newPage();
            await other.goto(pageUrl(site, cm, 'Teh zorblax end.', 'p2'));
            await expect(marks(other)).toHaveText(['Teh', 'zorblax']);
        });

        test('typing is checked after a pause, with UTF-16 spans right after non-ASCII text', async ({ page }) => {
            await page.goto(pageUrl(site, cm, 'Café 😀 fine.'));
            await expect.poll(() => status(page)).toMatchObject({ state: 'attached' });
            await host(page, 'typeAtEnd', ' Naïve recieve.');
            await expect(marks(page)).toHaveText(['recieve']);
        });

        test('a file switch is re-attached and checked', async ({ page }) => {
            await page.goto(pageUrl(site, cm, 'Teh end.'));
            await expect(marks(page)).toHaveText(['Teh']);
            await host(page, 'switchFile', 'doc-2', site === 'overleaf' ? 'chapter.tex' : 'chapter.typ', 'Recieve this.');
            await expect(marks(page)).toHaveText(['Recieve']);
        });
    });
}

test('markup is not prose: LaTeX commands and Typst code are not squiggled', async ({ page, context }) => {
    await page.goto(pageUrl('overleaf', 'current', String.raw`\section{Recieve}` + '\n' + String.raw`\tehcommand{x} and Café recieve here.`));
    // The core reads section titles as headings and leaves `Recieve` there
    // alone (observed with the CLI too); the command is not prose at all.
    await expect(marks(page)).toHaveText(['recieve']);
    const typst = await context.newPage();
    await typst.goto(pageUrl('typst', 'current', '= Recieve\n#let teh = 1\nCafé recieve here.'));
    await expect(marks(typst)).toHaveText(['Recieve', 'recieve']);
});

test('an edit closes the open card instead of leaving its fix pointing at moved text', async ({ page }) => {
    await page.goto(pageUrl('overleaf', 'current', 'I will recieve it.'));
    await hoverMark(page, 'recieve');
    await host(page, 'remoteInsert', 0, 'So ');
    await expect(popover(page)).toHaveCount(0);
    // The mark moved with its text and the recheck agrees.
    await expect(marks(page)).toHaveText(['recieve']);
    expect(await docText(page)).toBe('So I will recieve it.');
});

test.describe('without the native host', () => {
    test.use({ hostInstalled: false });
    test('says so once, and keeps the page working', async ({ page }) => {
        await page.goto(pageUrl('overleaf', 'current', 'I will recieve teh parcel.'));
        await expect.poll(() => status(page)).toMatchObject({ state: 'attached' });
        await expect(page.locator('.lc-toast')).toContainText('cannot reach its checker');
        await host(page, 'typeAtEnd', ' More teh text.');
        // Asserting that nothing more appears takes time passing: past the
        // check delay and the host's first backoff.
        // eslint-disable-next-line sonarjs/no-fixed-wait-in-tests
        await page.waitForTimeout(1500);
        await expect(page.locator('.lc-toast')).toHaveCount(1);
        await expect(marks(page)).toHaveCount(0);
    });
});
