// A site's documents as the workspace's files, end to end: the Inspector's
// Config tab sorts the site's own project (never the native host's
// directory), and "Exclude Current File" writes the open document's path to
// the config, after which the core leaves it unchecked. Overleaf and Typst
// have projects of files, Notion a page hierarchy, Gmail no files at all.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, gmailUrl, marks, notionUrl, openPanel, painted, pageUrl, runPaletteCommand, status, test, workspaceDir } from './fixtures';

const EXCLUDE = 'Exclude Current File from Checking';

/** The Inspector's Config tab, opened from the palette. */
async function configTab(page: Page): Promise<Page> {
    const panel = await openPanel(page, 'Open Inspector', 'inspector');
    await panel.locator('.tab-bar').waitFor({ timeout: 30_000 });
    await panel.locator('.tab', { hasText: 'Config' }).click();
    return panel;
}

const listed = (panel: Page, list: 'checked' | 'skipped') => panel.locator(`[data-list="${list}"] .scope-path`);

/** A project on a stand-in, with these files and this one open (unique per test: the stand-in keeps a project's files). */
function projectUrl(site: 'overleaf' | 'typst', project: string, open: string, files: readonly string[]): string {
    return `${pageUrl(site, 'current', 'I will recieve teh parcel tomorrow.', project, open)}&files=${encodeURIComponent(files.join(','))}`;
}

test("Overleaf: the Config tab sorts the project's files, folders and all", async ({ page }) => {
    await page.goto(projectUrl('overleaf', 'files-list', 'chapters/intro.tex', ['main.tex', 'chapters/intro.tex', 'figures/plot.png']));
    await expect.poll(() => status(page)).toMatchObject({ state: 'attached' });
    await expect(marks(page).first()).toBeVisible();
    const panel = await configTab(page);
    // The image is no grammar's, so it is not listed, as a folder's would not be.
    await expect(listed(panel, 'checked')).toHaveText(['chapters/intro.tex', 'main.tex']);
    await expect(listed(panel, 'skipped')).toHaveCount(0);
    await expect(panel.getByText('would visit no file')).toHaveCount(0);
});

test('Overleaf: excluding the open document writes its path and leaves it unchecked', async ({ page, dataHome }) => {
    await page.goto(projectUrl('overleaf', 'files-exclude', 'chapters/intro.tex', ['main.tex', 'chapters/intro.tex']));
    await expect(marks(page).first()).toBeVisible();
    await page.locator('.cm-content').click();
    await runPaletteCommand(page, EXCLUDE);
    await expect(marks(page)).toHaveCount(0);
    expect(readFileSync(path.join(workspaceDir(dataHome, 'overleaf', 'files-exclude'), '.languagecheck.yaml'), 'utf8')).toContain('chapters/intro.tex');
    const panel = await configTab(page);
    await expect(listed(panel, 'checked')).toHaveText(['main.tex']);
    await expect(listed(panel, 'skipped')).toHaveText(['chapters/intro.tex']);
    await expect(panel.locator('[data-list="skipped"] .scope-reason')).toHaveText(['exclude']);
});

test("Typst: the open file is found among the project's files by its header", async ({ page, context }) => {
    // Typst's API, as the app reads the project's files: a file's name is its path.
    await context.route('https://api.typst.app/v1/graphql', async (route) => {
        const files = route.request().postData()?.includes('files') === true;
        await route.fulfill({ json: { data: files ? { project: { files: [{ name: 'main.typ' }, { name: 'chapters/intro.typ' }] } } : { user: { settings: '{}' } } } });
    });
    await page.goto(projectUrl('typst', 'files-typst', 'chapters/intro.typ', []));
    await expect(marks(page).first()).toBeVisible();
    expect(await page.evaluate(() => (globalThis as any).__languageCheck.bridge.documentPath() as string)).toBe('chapters/intro.typ');
    const panel = await configTab(page);
    await expect(listed(panel, 'checked')).toHaveText(['chapters/intro.typ', 'main.typ']);
});

test('Notion: a page is the file its breadcrumb names, and excluding it stops its checks', async ({ page, dataHome }) => {
    await page.goto(notionUrl());
    await expect.poll(() => painted(page)).toHaveLength(4);
    const panel = await configTab(page);
    // Not "Private": the sharing badge in the breadcrumb row is no crumb.
    await expect(listed(panel, 'checked')).toHaveText(['Courses/Tests.md']);
    await expect(panel.locator('[data-list="note"]')).toContainText('Notion pages are listed as they are opened');
    // A peek is named under the page it opened over.
    await page.bringToFront();
    await page.evaluate(() => (globalThis as any).__notion.peek('aa24b3e9dafd4deb8617a6a09693570f'));
    await expect.poll(() => page.evaluate(() => (globalThis as any).__languageCheck.bridge.documentPath() as string | undefined)).toBe('Courses/Tests/Other page.md');
    await page.evaluate(() => (globalThis as any).__notion.closePeek());
    await expect.poll(() => page.evaluate(() => (globalThis as any).__languageCheck.bridge.documentPath() as string | undefined)).toBe('Courses/Tests.md');
    await page.locator('.notion-frame [data-content-editable-leaf]').first().click();
    await runPaletteCommand(page, EXCLUDE);
    await expect.poll(() => painted(page)).toEqual([]);
    expect(readFileSync(path.join(workspaceDir(dataHome, 'notion', 'test-workspace'), '.languagecheck.yaml'), 'utf8')).toContain('Courses/Tests.md');
});

test('Gmail: no files, and the Config tab says so instead of listing none', async ({ page }) => {
    await page.goto(gmailUrl());
    await expect.poll(() => status(page)).toMatchObject({ state: 'attached' });
    const panel = await configTab(page);
    await expect(panel.locator('[data-list="filesless"]')).toContainText('Gmail has no files');
    await expect(panel.locator('[data-list="checked"]')).toHaveCount(0);
    await expect(panel.getByText('would visit no file')).toHaveCount(0);
});
