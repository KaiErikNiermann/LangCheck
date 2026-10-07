/**
 * The Inspector, driven through its own UI. The scenarios are shared with the
 * browser extension's panel (inspectorScenarios.ts); what is here besides them
 * is about VS Code's window.
 */
import { expect, test } from '@playwright/test';

import { INSPECTOR_SCENARIOS, type InspectorDriver } from './inspectorScenarios';
import { clipboardText, launchVSCode, openInspector, runCommand, waitForSquiggles, type VSCodeWindow } from './vscodeWindow';

let window: VSCodeWindow;

test.afterEach(async () => {
    await window?.app.close();
});

const driver: InspectorDriver = {
    async open(fixture) {
        window = await launchVSCode(fixture, 'doc.md');
        await waitForSquiggles(window.page);
        return openInspector(window.page);
    },
    async selectedChars() {
        // Read without waiting: there is no such item until something is selected.
        const items = await window.page.locator('.statusbar-item', { hasText: 'selected' }).allTextContents();
        const match = /\((\d+) selected\)/u.exec(items.join(' '));
        return match === null ? 0 : Number(match[1]);
    },
    async checkFromEditor() {
        // The command checks the active editor, so the editor needs focus back.
        await window.page.locator('.editor-group-container .view-lines').first().click();
        await runCommand(window.page, 'Language Check: Check Current Document');
    },
    clipboard: () => clipboardText(window),
};

for (const scenario of INSPECTOR_SCENARIOS) {
    test(scenario.name, () => scenario.run(driver, expect));
}

test('a narrow panel scrolls its tabs rather than squeezing or clipping them', async () => {
    window = await launchVSCode('uiInspector', 'doc.md');
    await waitForSquiggles(window.page);
    // Before the panel opens: with it focused, the palette's keys reach it.
    await runCommand(window.page, 'View: Close Secondary Side Bar');
    await runCommand(window.page, 'View: Close Primary Side Bar');
    await window.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(700, 700));
    const panel = await openInspector(window.page);
    const bar = panel.locator('.tab-bar');
    const heights = await panel.locator('.tab').evaluateAll(tabs => tabs.map(t => t.getBoundingClientRect().height));
    expect(new Set(heights).size, `tab heights ${heights.join(', ')}`).toBe(1);
    expect(await bar.evaluate(b => b.scrollWidth > b.clientWidth)).toBe(true);
    const last = panel.locator('.tab', { hasText: 'Health' });
    await last.scrollIntoViewIfNeeded();
    expect(await bar.evaluate(b => b.scrollLeft)).toBeGreaterThan(0);
    await last.click();
    await expect(last).toHaveClass(/active/);
});
