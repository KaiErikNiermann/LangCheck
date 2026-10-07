/**
 * Editing the config: "Edit Config" opens the file the core reads, creating
 * one when there is none. The scenarios about what a save does and how the
 * config is marked are shared with the browser extension's config page
 * (configScenarios.ts); what is here besides them is about VS Code's files.
 */
import { expect, test } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { CONFIG_SCENARIOS, type ConfigDriver } from './configScenarios';
import { launchVSCode, runCommand, waitForSquiggles, type VSCodeWindow } from './vscodeWindow';

let window: VSCodeWindow;

test.afterEach(async () => {
    await window?.app.close();
});

const activeTab = (w: VSCodeWindow) => w.page.locator('.tab.active');

/** Counts what the editor in `tab` draws matching `selector`, showing that tab first. */
async function countIn(tab: string, selector: string): Promise<number> {
    await window.page.locator('.tab', { hasText: tab }).click();
    return window.page.locator(`.editor-group-container ${selector}`).count();
}

const driver: ConfigDriver = {
    async open() {
        window = await launchVSCode('uiConfig', 'doc.md');
        await waitForSquiggles(window.page);
        await runCommand(window.page, 'Language Check: Edit Config');
        await expect(activeTab(window)).toContainText('.languagecheck.yaml');
    },
    async setConfig(text) {
        await window.page.locator('.tab', { hasText: '.languagecheck.yaml' }).click();
        await window.page.locator('.editor-group-container .view-lines').first().click();
        // Pasted, not typed: typed YAML gets the editor's auto-indent.
        await window.app.evaluate(({ clipboard }, t) => { clipboard.writeText(t); }, text);
        await window.page.keyboard.press('Control+A');
        await window.page.keyboard.press('Control+V');
        await window.page.keyboard.press('Control+S');
    },
    // Warnings and errors: an information squiggle is a note about the check itself.
    documentFindings: () => countIn('doc.md', '.squiggly-warning, .squiggly-error'),
    configSquiggles: () => countIn('.languagecheck.yaml', '.squiggly-warning, .squiggly-error'),
    // VS Code draws gutter decorations as glyph-margin widgets of class cgmr.
    configGutterMarks: () => countIn('.languagecheck.yaml', '.glyph-margin-widgets .cgmr'),
};

for (const scenario of CONFIG_SCENARIOS) {
    test(scenario.name, () => scenario.run(driver, expect));
}

test('Edit Config opens the config in effect, as it is', async () => {
    // uiInspector has a .languagecheck.yaml (name detection on).
    window = await launchVSCode('uiInspector', 'doc.md');
    await waitForSquiggles(window.page);
    const before = fs.readFileSync(path.join(window.workspace, '.languagecheck.yaml'), 'utf8');
    await runCommand(window.page, 'Language Check: Edit Config');
    await expect(activeTab(window)).toContainText('.languagecheck.yaml');
    await expect(window.page.locator('.editor-group-container .view-lines').first()).toContainText('names:');
    expect(fs.readFileSync(path.join(window.workspace, '.languagecheck.yaml'), 'utf8')).toBe(before);
});

test('with no config, Edit Config creates .languagecheck.yaml with the defaults and opens it', async () => {
    window = await launchVSCode('uiNoConfig', 'doc.md');
    await waitForSquiggles(window.page);
    const config = path.join(window.workspace, '.languagecheck.yaml');
    expect(fs.existsSync(config)).toBe(false);
    await runCommand(window.page, 'Language Check: Edit Config');
    await expect(activeTab(window)).toContainText('.languagecheck.yaml');
    await expect.poll(() => fs.existsSync(config) && fs.readFileSync(config, 'utf8')).toContain('harper: true');
    // What no file meant: the finding is still there.
    await window.page.locator('.tab', { hasText: 'doc.md' }).click();
    await waitForSquiggles(window.page);
});
