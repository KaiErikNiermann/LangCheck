// A site's own spellchecker (research/foreign-checkers.md), end to end: the
// stand-in page runs one (`?foreign=`) the way the live sites do, Typst's
// through @codemirror/lint and Overleaf's as marks of its own, and the
// whole path (page, native host, real core) decides what is drawn. Merged,
// the default: one mark per word, ours; a word only the site marks is ours
// too, under our dictionary; theirs hidden. "ours": theirs hidden and
// ignored. "both": theirs left alone.
import type { Page } from '@playwright/test';
import { expect, hoverMark, host, marks, pageUrl, setForeignCheckers, status, test, withForeign, type Site } from './fixtures';

const TEXT = 'I recieve teh parcel today.';
/** The site marks `teh`, which Harper finds too, and `parcel`, which only it does. */
const SITE_MARKS = ['teh', 'parcel'];

/** The site's own marks, by the class each draws them with. */
const siteMarks = (page: Page, site: Site) => page.locator(site === 'typst' ? '.cm-lintRange.misspelling' : '.ol-cm-spelling-error');

/**
 * Whether each element of the site's marks is drawn: Typst's is a background
 * image, Overleaf's a text decoration. Elements, not words: with our marks
 * nested in, CodeMirror can split one of theirs into pieces.
 */
function siteMarksShown(page: Page, site: Site): Promise<boolean[]> {
    return siteMarks(page, site).evaluateAll(
        (elements, typst) => elements.map((el) => (typst ? getComputedStyle(el).backgroundImage : getComputedStyle(el).textDecorationLine) !== 'none'),
        site === 'typst',
    );
}
const allShown = (page: Page, site: Site): Promise<boolean> => siteMarksShown(page, site).then((shown) => shown.every(Boolean));
const noneShown = (page: Page, site: Site): Promise<boolean> => siteMarksShown(page, site).then((shown) => !shown.some(Boolean));

async function open(page: Page, site: Site): Promise<void> {
    await page.goto(withForeign(pageUrl(site, 'current', TEXT), SITE_MARKS));
    await expect.poll(() => status(page)).toMatchObject({ state: 'attached' });
    // The site has answered: its marks are there for the reader to take.
    await expect.poll(() => siteMarks(page, site).count()).toBeGreaterThanOrEqual(2);
}

for (const site of ['typst', 'overleaf'] as const) {
    test(`${site}: merged, one mark per word and theirs hidden; a word only the site marks is ours, under our dictionary`, async ({ page }) => {
        await open(page, site);
        await expect(marks(page)).toHaveText(['recieve', 'teh', 'parcel']);
        await expect(page.locator(`.cm-editor[data-lc-absorb="${site}"]`)).toHaveCount(1);
        expect(await noneShown(page, site)).toBe(true);

        const card = await hoverMark(page, 'parcel');
        // Only our card: Typst's own lint tooltip opens on hover too, and is hidden.
        await expect(page.locator('.cm-tooltip-hover')).toBeHidden();
        await card.getByRole('button', { name: 'Add "parcel" to dictionary' }).click();
        await expect(marks(page)).toHaveText(['recieve', 'teh']);
        // The site still marks it; our dictionary says it stays hidden.
        await expect(siteMarks(page, site).filter({ hasText: 'parcel' })).not.toHaveCount(0);
    });

    test(`${site}: "both" leaves the site's checker alone, and takes nothing from it`, async ({ page, context, extensionId }) => {
        await setForeignCheckers(context, extensionId, 'both');
        await open(page, site);
        await expect(marks(page)).toHaveText(['recieve', 'teh']);
        await expect(page.locator('.cm-editor[data-lc-absorb]')).toHaveCount(0);
        expect(await allShown(page, site)).toBe(true);
    });
}

test('"ours" hides the site\'s checker and ignores it; a change of mode applies to an open page', async ({ page, context, extensionId }) => {
    await open(page, 'typst');
    await expect(marks(page)).toHaveText(['recieve', 'teh', 'parcel']);
    await setForeignCheckers(context, extensionId, 'ours');
    await expect(marks(page)).toHaveText(['recieve', 'teh']);
    expect(await noneShown(page, 'typst')).toBe(true);
    await setForeignCheckers(context, extensionId, 'both');
    await expect.poll(() => allShown(page, 'typst')).toBe(true);
    await setForeignCheckers(context, extensionId, 'merge');
    await expect(marks(page)).toHaveText(['recieve', 'teh', 'parcel']);
});

test('after an edit, the site answering again brings its findings back for the new text', async ({ page }) => {
    await open(page, 'typst');
    await expect(marks(page)).toHaveText(['recieve', 'teh', 'parcel']);
    const answered = (await host(page, 'foreignAnswers')) as number;
    await host(page, 'typeAtEnd', ' Another parcel.');
    await expect.poll(() => host(page, 'foreignAnswers')).toBeGreaterThan(answered);
    await expect(marks(page)).toHaveText(['recieve', 'teh', 'parcel', 'parcel']);
});
