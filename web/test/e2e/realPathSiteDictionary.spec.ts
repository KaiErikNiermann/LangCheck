// The site's own dictionary (research/site-dictionaries.md), end to end:
// read in the page, sent to the real core through the native host, used
// there beside LangCheck's own. Overleaf's learned words come from the
// stand-in page's meta tag, which the stand-in server renders as Overleaf
// does and changes on /spelling/learn; Typst's personal dictionary from its
// API, which the test answers.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { configPage, expect, host, hoverMark, marks, pageUrl, setText, status, test, workspaceDir } from './fixtures';

const TEXT = 'Vrije Wrodle went home.';

/**
 * A project of each test's own: the stand-in server keeps learned words per
 * project for the whole run, as Overleaf keeps them per user.
 */
async function openOverleaf(page: Page, learned: readonly string[], project: string): Promise<void> {
    const url = new URL(pageUrl('overleaf', 'current', TEXT, project));
    url.searchParams.set('learned', learned.join(','));
    await page.goto(url.href);
    await expect.poll(() => status(page)).toMatchObject({ state: 'attached' });
}

/** Answers Typst's API as it answers the app: the user's settings, holding `words()`. */
async function typstApi(context: BrowserContext, words: () => readonly string[]): Promise<void> {
    await context.route('https://api.typst.app/v1/graphql', async (route) => {
        const origin = route.request().headers().origin ?? '*';
        const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'content-type' };
        if (route.request().method() === 'OPTIONS') {
            await route.fulfill({ status: 204, headers: cors });
            return;
        }
        const settings = JSON.stringify({ vim: false, spellcheck: true, personalDictionary: words() });
        await route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ data: { user: { settings } } }) });
    });
}

test('overleaf: learned words are not marked, and a word learned in the page stops being marked', async ({ page }) => {
    await openOverleaf(page, ['Vrije'], 'sd-learn');
    await expect(marks(page)).toHaveText(['Wrodle']);
    await host(page, 'learn', 'Wrodle');
    await expect(marks(page)).toHaveCount(0);
});

test('typst: the personal dictionary is used, and read again after the app saves its settings', async ({ page, context }) => {
    let words: readonly string[] = ['Vrije'];
    await typstApi(context, () => words);
    await page.goto(pageUrl('typst', 'current', TEXT, 'sd-typst'));
    await expect.poll(() => status(page)).toMatchObject({ state: 'attached' });
    await expect(marks(page)).toHaveText(['Wrodle']);
    words = ['Vrije', 'Wrodle'];
    await host(page, 'typstSettingsSaved');
    await expect(marks(page)).toHaveCount(0);
});

test('the config page says the site dictionary is registered, without the key in the file', async ({ page, context }) => {
    await openOverleaf(page, ['Vrije', 'two words'], 'sd-config');
    await expect(marks(page)).toHaveText(['Wrodle']);
    const config = await configPage(page, context);
    await expect(config.locator('#site-dictionary')).toHaveText(
        "Overleaf learned words: 1 word, received just now, used beside LangCheck's own; 1 entry left out, not a single word.",
    );
});

test('dictionaries.site: ignore leaves the site dictionary out', async ({ page, dataHome }) => {
    const dir = workspaceDir(dataHome, 'overleaf', 'sd-ignore');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, '.languagecheck.yaml'), 'dictionaries:\n  site: ignore\n');
    await openOverleaf(page, ['Vrije'], 'sd-ignore');
    await expect(marks(page)).toHaveText(['Vrije', 'Wrodle']);
});

test('written in the config, dictionaries.site gets its gutter mark; "only" refuses to add a word to LangCheck\'s', async ({ page, context }) => {
    await openOverleaf(page, ['Vrije'], 'sd-only');
    await expect(marks(page)).toHaveText(['Wrodle']);
    const config = await configPage(page, context);
    await setText(config, 'dictionaries:\n  site: only\n');
    await expect(config.locator('#status')).toHaveText('Saved');
    // The only key written that a probe is about, so the only mark; a probe
    // that found nothing is skipped and draws none.
    await expect(config.locator('[class*="lc-gutter-"]')).toHaveCount(1);
    await expect(config.locator('#site-dictionary')).toContainText("used instead of LangCheck's dictionary.txt");

    const card = await hoverMark(page, 'Wrodle');
    await card.getByRole('button', { name: 'Add "Wrodle" to dictionary' }).click();
    await expect(page.locator('.lc-toast')).toContainText('dictionaries.site: only');
    await expect(marks(page)).toHaveText(['Wrodle']);
});

