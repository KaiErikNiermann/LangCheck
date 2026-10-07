// The config page: the workspace's config in Monaco, opened from the palette,
// drawn and squiggled by the client's ConfigStatusView, and saved through the
// native host, after which the pages on the workspace check under it. The
// scenarios are the VS Code UI suite's (extension/src/test/ui/
// configScenarios.ts), run here through a driver for the config page; what
// is here besides them is the page's own (its status line, and the host's
// refusal of a config that would run a program).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { CONFIG_SCENARIOS, type ConfigDriver } from '../../../extension/src/test/ui/configScenarios';
import { expect, marks, openFixture, pageUrl, panelErrors, runPaletteCommand, status, stopBackground, test, workspaceDir } from './fixtures';

const configPages = (context: BrowserContext): Page[] => context.pages().filter((p) => !p.isClosed() && new URL(p.url()).pathname === '/config.html');

async function openConfig(page: Page, context: BrowserContext): Promise<Page> {
    await page.goto(pageUrl('overleaf', 'current', 'I will recieve it.'));
    await expect.poll(() => status(page)).toMatchObject({ state: 'attached' });
    await expect(marks(page)).toHaveText(['recieve']);
    await page.locator('.cm-content').click();
    return configPage(page, context);
}

/** The config page of the page's workspace, opened from the palette. */
async function configPage(page: Page, context: BrowserContext): Promise<Page> {
    await runPaletteCommand(page, 'Edit Config');
    let config: Page | undefined;
    await expect.poll(() => (config = configPages(context)[0])).toBeDefined();
    if (config === undefined) throw new Error('no config page');
    await config.waitForLoadState();
    await expect(config.locator('.monaco-editor')).toBeVisible();
    return config;
}

function browserDriver(page: Page, context: BrowserContext, dataHome: string): ConfigDriver {
    let config: Page | undefined;
    const inConfig = (selector: string): Promise<number> => config?.locator(selector).count() ?? Promise.resolve(0);
    return {
        async open() {
            await openFixture(page, dataHome, 'uiConfig', 'doc.md');
            config = await configPage(page, context);
        },
        async setConfig(text) {
            if (config === undefined) throw new Error('open first');
            await setText(config, text);
            // Saved after the typing pause.
            await expect(config.locator('#status')).toHaveText('Saved');
        },
        documentFindings: () => page.locator('.lc-diag.lc-warning, .lc-diag.lc-error').count(),
        configSquiggles: () => inConfig('.squiggly-warning, .squiggly-error'),
        configGutterMarks: () => inConfig('[class*="lc-gutter-"]'),
    };
}

for (const scenario of CONFIG_SCENARIOS) {
    test(scenario.name, async ({ page, context, dataHome }) => {
        await scenario.run(browserDriver(page, context, dataHome), expect);
    });
}

const setText = (config: Page, text: string) =>
    config.evaluate((t) => {
        (globalThis as any).__configEditor.setValue(t);
    }, text);

const savedConfig = (dataHome: string): string | undefined => {
    const file = path.join(workspaceDir(dataHome, 'overleaf'), '.languagecheck.yaml');
    return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
};

test('the status line says whether there is a config yet, and when a save landed', async ({ page, context, dataHome }) => {
    const config = await openConfig(page, context);
    await expect(config.locator('#status')).toContainText('No config yet');
    await setText(config, 'engines:\n  harper: true\n');
    await expect(config.locator('#status')).toHaveText('Saved');
    expect(savedConfig(dataHome)).toBe('engines:\n  harper: true\n');
    expect(panelErrors.get(config) ?? []).toEqual([]);
});

test('a config that would run a program is not saved, and says why', async ({ page, context, dataHome }) => {
    const config = await openConfig(page, context);
    await setText(config, 'engines:\n  harper: true\n');
    await expect(config.locator('#status')).toHaveText('Saved');
    await setText(config, 'engines:\n  external:\n    - name: x\n      command: /bin/sh\n');
    await expect(config.locator('#status')).toContainText('engines.external runs programs');
    expect(savedConfig(dataHome)).toBe('engines:\n  harper: true\n');
});

// MV3 stops the background when idle, and the config page outlives it: a
// save after that must still land, and the pages still reload.
test('a save after the background was stopped still lands, and the page checks under it', async ({ page, context, dataHome }) => {
    const config = await openConfig(page, context);
    await setText(config, 'engines:\n  harper: true\n');
    await expect(config.locator('#status')).toHaveText('Saved');
    await stopBackground(page);
    await setText(config, 'engines:\n  harper: false\n');
    await expect(config.locator('#status')).toHaveText('Saved', { timeout: 15_000 });
    expect(savedConfig(dataHome)).toBe('engines:\n  harper: false\n');
    await expect(marks(page)).toHaveCount(0, { timeout: 15_000 });
});
