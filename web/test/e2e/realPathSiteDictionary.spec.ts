// The site's own dictionary (research/site-dictionaries.md), end to end:
// read in the page, sent to the real core through the native host, used
// there beside LangCheck's own. Overleaf's learned words come from the
// stand-in page's meta tag, which the stand-in server renders as Overleaf
// does and changes on /spelling/learn; Typst's personal dictionary from its
// API, which the test answers.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

/** Typst's user settings as its API keeps them: one JSON object, written whole. */
interface TypstUser {
    settings: Record<string, unknown>;
}

/**
 * Answers Typst's API as it answers the app: `{ user { settings } }` reads
 * the settings (a JSON string), `updateUser(settings:)` replaces them.
 */
async function typstApi(context: BrowserContext, user: TypstUser): Promise<void> {
    await context.route('https://api.typst.app/v1/graphql', async (route) => {
        const origin = route.request().headers().origin ?? '*';
        const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'content-type' };
        if (route.request().method() === 'OPTIONS') {
            await route.fulfill({ status: 204, headers: cors });
            return;
        }
        const body = route.request().postDataJSON() as { query?: string; variables?: { settings?: string } } | null;
        if (body?.query?.includes('updateUser') === true && typeof body.variables?.settings === 'string') {
            user.settings = JSON.parse(body.variables.settings) as Record<string, unknown>;
            await route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ data: { updateUser: { id: 'u1' } } }) });
            return;
        }
        await route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ data: { user: { settings: JSON.stringify(user.settings) } } }) });
    });
}

/** Gives a project's workspace `config` before its page loads. */
function seedConfig(dataHome: string, site: 'overleaf' | 'typst', project: string, config: string): void {
    const dir = workspaceDir(dataHome, site, project);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, '.languagecheck.yaml'), config);
}

/** Adds "Wrodle", the word only LangCheck marks in TEXT, from the card, as a user would. */
async function addFromCard(page: Page): Promise<void> {
    const card = await hoverMark(page, 'Wrodle');
    await card.getByRole('button', { name: 'Add "Wrodle" to dictionary' }).click();
}

test('overleaf: learned words are not marked, and a word learned in the page stops being marked', async ({ page }) => {
    await openOverleaf(page, ['Vrije'], 'sd-learn');
    await expect(marks(page)).toHaveText(['Wrodle']);
    await host(page, 'learn', 'Wrodle');
    await expect(marks(page)).toHaveCount(0);
});

test('typst: the personal dictionary is used, and read again after the app saves its settings', async ({ page, context }) => {
    const user: TypstUser = { settings: { vim: false, personalDictionary: ['Vrije'] } };
    await typstApi(context, user);
    await page.goto(pageUrl('typst', 'current', TEXT, 'sd-typst'));
    await expect.poll(() => status(page)).toMatchObject({ state: 'attached' });
    await expect(marks(page)).toHaveText(['Wrodle']);
    user.settings = { ...user.settings, personalDictionary: ['Vrije', 'Wrodle'] };
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
    seedConfig(dataHome, 'overleaf', 'sd-ignore', 'dictionaries:\n  site: ignore\n');
    await openOverleaf(page, ['Vrije'], 'sd-ignore');
    await expect(marks(page)).toHaveText(['Vrije', 'Wrodle']);
});

test('written in the config, dictionaries.site gets its gutter mark; "only" refuses to add a word to LangCheck\'s', async ({ page, context }) => {
    await openOverleaf(page, ['Vrije'], 'sd-only');
    await expect(marks(page)).toHaveText(['Wrodle']);
    const config = await configPage(page, context);
    await setText(config, 'dictionaries:\n  site: only\n');
    await expect(config.locator('#status')).toHaveText('Saved');
    // Two keys a probe is about: `site:` (in use), and add_to, which is not
    // written and so marks `dictionaries:` (adding to LangCheck's own is
    // refused under `only`).
    await expect(config.locator('[class*="lc-gutter-"]')).toHaveCount(2);
    await expect(config.locator('#site-dictionary')).toContainText("used instead of LangCheck's dictionary.txt");

    await addFromCard(page);
    await expect(page.locator('.lc-toast')).toContainText('dictionaries.site: only');
    await expect(marks(page)).toHaveText(['Wrodle']);
});

test('add_to: site on Overleaf learns the word there, so it stays known after a reload', async ({ page, dataHome }) => {
    seedConfig(dataHome, 'overleaf', 'sd-add-overleaf', 'dictionaries:\n  add_to: site\n');
    await openOverleaf(page, ['Vrije'], 'sd-add-overleaf');
    await expect(marks(page)).toHaveText(['Wrodle']);
    await addFromCard(page);
    await expect(marks(page)).toHaveCount(0);
    expect(existsSync(path.join(workspaceDir(dataHome, 'overleaf', 'sd-add-overleaf'), '.languagecheck/dictionary.txt'))).toBe(false);
    // Overleaf has it: the page as the server renders it now carries it.
    await page.reload();
    await expect.poll(() => status(page)).toMatchObject({ state: 'attached' });
    await expect(page.locator('meta[name="ol-learnedWords"]')).toHaveAttribute('content', '["Vrije","Wrodle"]');
    await expect(marks(page)).toHaveCount(0);
});

test('add_to: site on Typst adds the word to the personal dictionary and keeps every other setting', async ({ page, context, dataHome }) => {
    seedConfig(dataHome, 'typst', 'sd-add-typst', 'dictionaries:\n  add_to: site\n');
    const user: TypstUser = { settings: { vim: true, editorFontSize: 15, spellcheck: true, personalDictionary: ['Vrije'] } };
    await typstApi(context, user);
    await page.goto(pageUrl('typst', 'current', TEXT, 'sd-add-typst'));
    await expect.poll(() => status(page)).toMatchObject({ state: 'attached' });
    await expect(marks(page)).toHaveText(['Wrodle']);
    await addFromCard(page);
    await expect(marks(page)).toHaveCount(0);
    expect(user.settings).toEqual({ vim: true, editorFontSize: 15, spellcheck: true, personalDictionary: ['Vrije', 'Wrodle'] });
});

test('add_to: a wordlist path puts the word in that file', async ({ page, dataHome }) => {
    seedConfig(dataHome, 'overleaf', 'sd-add-path', 'dictionaries:\n  add_to: terms/project.txt\n');
    await openOverleaf(page, ['Vrije'], 'sd-add-path');
    await expect(marks(page)).toHaveText(['Wrodle']);
    await addFromCard(page);
    await expect(marks(page)).toHaveCount(0);
    expect(readFileSync(path.join(workspaceDir(dataHome, 'overleaf', 'sd-add-path'), 'terms/project.txt'), 'utf8')).toBe('Wrodle\n');
});

