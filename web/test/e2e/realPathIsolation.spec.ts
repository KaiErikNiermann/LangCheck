// One page, one document: a tab checks only its own editor, and nothing done
// in one tab reaches another, whether the tabs are two projects or the same
// project twice (Overleaf and Typst both allow opening a project twice).
import type { Page } from '@playwright/test';
import { docText, expect, host, marks, openPanel, pageUrl, status, test } from './fixtures';

const checks = (page: Page) => page.evaluate(() => (globalThis as any).__languageCheck.stats().checks as number);

async function attached(page: Page, text: string, project: string, site: 'overleaf' | 'typst' = 'overleaf'): Promise<void> {
    await page.goto(pageUrl(site, 'current', text, project));
    await expect.poll(() => status(page)).toMatchObject({ state: 'attached' });
}

for (const [label, projectB] of [['two projects', 'p2'], ['one project in two tabs', 'p1']] as const) {
    test(`${label}: each tab checks and shows only its own text`, async ({ page, context }) => {
        const other = await context.newPage();
        await attached(page, 'I will recieve it.', 'p1');
        await attached(other, 'Teh end.', projectB);
        await expect(marks(page)).toHaveText(['recieve']);
        await expect(marks(other)).toHaveText(['Teh']);
        const otherChecks = await checks(other);

        await host(page, 'typeAtEnd', ' Seperately.');
        await expect(marks(page)).toHaveText(['recieve', 'Seperately']);
        // The other tab saw no edit and ran no check for it.
        await expect(marks(other)).toHaveText(['Teh']);
        expect(await checks(other)).toBe(otherChecks);
        expect(await docText(other)).toBe('Teh end.');
    });
}

test("SpeedFix opened in one tab lists that tab's findings and fixes only its text", async ({ page, context }) => {
    const other = await context.newPage();
    await attached(other, 'Teh end.', 'p2');
    await expect(marks(other)).toHaveText(['Teh']);
    await attached(page, 'I will recieve it.', 'p1');
    await expect(marks(page)).toHaveText(['recieve']);
    await page.bringToFront();
    await page.locator('.cm-content').click();
    const panel = await openPanel(page, 'Open SpeedFix', 'speedFix');
    await expect(panel.locator('.error-text')).toHaveText('recieve');
    await expect(panel.locator('.progress-text')).toHaveText('1 / 1');
    await panel.locator('.progress-text').click();
    await panel.keyboard.press('1');
    await expect.poll(() => docText(page)).toBe('I will receive it.');
    expect(await docText(other)).toBe('Teh end.');
    await expect(marks(other)).toHaveText(['Teh']);
});

test('Overleaf and Typst tabs side by side stay apart', async ({ page, context }) => {
    const typst = await context.newPage();
    await attached(page, 'I will recieve it.', 'p1');
    await attached(typst, 'Teh end.', 'p1', 'typst');
    await expect(marks(page)).toHaveText(['recieve']);
    await expect(marks(typst)).toHaveText(['Teh']);
    expect(await status(typst)).toMatchObject({ languageId: 'typst' });
    expect(await status(page)).toMatchObject({ languageId: 'latex' });
});
