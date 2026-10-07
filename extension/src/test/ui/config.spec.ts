/**
 * Editing the config: "Edit Config" opens the file the core reads, creating
 * one when there is none.
 */
import { expect, test } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { launchVSCode, runCommand, waitForSquiggles, type VSCodeWindow } from './vscodeWindow';

let window: VSCodeWindow;

test.afterEach(async () => {
    await window?.app.close();
});

const activeTab = (w: VSCodeWindow) => w.page.locator('.tab.active');

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
