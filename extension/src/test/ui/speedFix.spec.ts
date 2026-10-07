/**
 * SpeedFix, driven through its own UI: the keys a user presses, and what the
 * editor and the workspace look like afterwards. The scenarios are shared with
 * the browser extension's panel (speedFixScenarios.ts); what is here besides
 * them is about VS Code's window.
 */
import { expect, test } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { SPEEDFIX_SCENARIOS, type SpeedFixDriver } from './speedFixScenarios';
import { editorText, launchVSCode, openSpeedFix, runCommand, waitForSquiggles, type VSCodeWindow } from './vscodeWindow';

let window: VSCodeWindow;

test.afterEach(async () => {
    await window?.app.close();
});

const driver: SpeedFixDriver = {
    async open(file) {
        window = await launchVSCode('uiSpeedFix', file);
        await waitForSquiggles(window.page);
        return openSpeedFix(window.page);
    },
    press: (key) => window.page.keyboard.press(key),
    editorText: () => editorText(window.page),
    dictionary: async () => {
        const file = path.join(window.workspace, '.languagecheck', 'dictionary.txt');
        return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    },
    panelTab: () => window.page.locator('.tab', { hasText: 'SpeedFix' }),
};

for (const scenario of SPEEDFIX_SCENARIOS) {
    test(scenario.name, () => scenario.run(driver, expect));
}

async function resize(width: number): Promise<void> {
    await window.app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0]!.setSize(w, 700), width);
}

test('a narrow panel keeps the ? button and hides the rest of the legend', async () => {
    window = await launchVSCode('uiSpeedFix', 'apply.md');
    await waitForSquiggles(window.page);
    // Only the two editors share the window, so its width sets the panel's.
    // Before the panel opens: with it focused, the palette's keys reach it.
    await runCommand(window.page, 'View: Close Secondary Side Bar');
    await runCommand(window.page, 'View: Close Primary Side Bar');
    await resize(1600);
    const panel = await openSpeedFix(window.page);
    const legend = panel.locator('.shortcut');
    await expect(legend.first()).toBeVisible();
    await resize(600);
    await expect(legend.first()).toBeHidden();
    await panel.locator('.help-btn').click();
    await expect(panel.locator('dialog.help')).toBeVisible();
});
