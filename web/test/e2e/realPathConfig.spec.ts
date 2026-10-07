// The config page: the workspace's config in Monaco, opened from the palette,
// drawn and squiggled by the client's ConfigStatusView, and saved through the
// native host, after which the pages on the workspace check under it.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { expect, marks, pageUrl, panelErrors, runPaletteCommand, status, test, workspaceDir } from './fixtures';

const configPages = (context: BrowserContext): Page[] => context.pages().filter((p) => !p.isClosed() && new URL(p.url()).pathname === '/config.html');

async function openConfig(page: Page, context: BrowserContext): Promise<Page> {
    await page.goto(pageUrl('overleaf', 'current', 'I will recieve it.'));
    await expect.poll(() => status(page)).toMatchObject({ state: 'attached' });
    await expect(marks(page)).toHaveText(['recieve']);
    await page.locator('.cm-content').click();
    await runPaletteCommand(page, 'Edit Config');
    let config: Page | undefined;
    await expect.poll(() => (config = configPages(context)[0])).toBeDefined();
    if (config === undefined) throw new Error('no config page');
    await config.waitForLoadState();
    await expect(config.locator('.monaco-editor')).toBeVisible();
    return config;
}

const setText = (config: Page, text: string) =>
    config.evaluate((t) => {
        (globalThis as any).__configEditor.setValue(t);
    }, text);

const savedConfig = (dataHome: string): string | undefined => {
    const file = path.join(workspaceDir(dataHome, 'overleaf'), '.languagecheck.yaml');
    return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
};

test('Edit Config opens the workspace config, and a save changes how the pages check', async ({ page, context, dataHome }) => {
    const config = await openConfig(page, context);
    await expect(config.locator('#status')).toContainText('No config yet');
    await setText(config, 'engines:\n  harper: false\n');
    await expect(config.locator('#status')).toHaveText('Saved');
    expect(savedConfig(dataHome)).toBe('engines:\n  harper: false\n');
    // Harper off: nothing finds "recieve" any more, in the page beside it.
    await expect(marks(page)).toHaveCount(0);
    await setText(config, 'engines:\n  harper: true\n');
    await expect(config.locator('#status')).toHaveText('Saved');
    await expect(marks(page)).toHaveText(['recieve']);
    expect(panelErrors.get(config) ?? []).toEqual([]);
});

test('a key the config does not have is squiggled, and a probed key gets its gutter mark', async ({ page, context }) => {
    const config = await openConfig(page, context);
    await setText(config, 'engines:\n  harper: true\nenginez: {}\n');
    // Monaco draws markers as squiggles in its view overlays.
    await expect(config.locator('.squiggly-warning, .squiggly-error').first()).toBeVisible();
    await expect(config.locator('.glyph-margin-widgets [class*="lc-gutter-"], .margin-view-overlays [class*="lc-gutter-"]').first()).toBeVisible();
});

test('a config that would run a program is not saved, and says why', async ({ page, context, dataHome }) => {
    const config = await openConfig(page, context);
    await setText(config, 'engines:\n  harper: true\n');
    await expect(config.locator('#status')).toHaveText('Saved');
    await setText(config, 'engines:\n  external:\n    - name: x\n      command: /bin/sh\n');
    await expect(config.locator('#status')).toContainText('engines.external runs programs');
    expect(savedConfig(dataHome)).toBe('engines:\n  harper: true\n');
});
