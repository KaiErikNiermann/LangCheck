/**
 * SpeedFix, driven through its own UI: the keys a user presses, and what the
 * editor and the workspace look like afterwards.
 */
import { expect, test, type FrameLocator } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { editorText, launchVSCode, openSpeedFix, runCommand, waitForSquiggles, type VSCodeWindow } from './vscodeWindow';

let window: VSCodeWindow;

test.afterEach(async () => {
    await window?.app.close();
});

async function open(file: string): Promise<FrameLocator> {
    window = await launchVSCode('uiSpeedFix', file);
    await waitForSquiggles(window.page);
    return openSpeedFix(window.page);
}

test('shows the finding with its suggestions first, then the dictionary and ignore actions', async () => {
    const panel = await open('apply.md');
    await expect(panel.locator('.error-text')).toHaveText('Teh');
    await expect(panel.locator('.action .action-title')).toHaveText(['The', 'Th', 'Tea', 'Add to Dictionary', 'Ignore']);
    await expect(panel.locator('.progress-text')).toHaveText('1 / 1');
});

test('a number key applies that suggestion to the document', async () => {
    const panel = await open('apply.md');
    await expect(panel.locator('.error-text')).toHaveText('Teh');
    await window.page.keyboard.press('1');
    await expect.poll(() => editorText(window.page)).toBe('# Apply\nThe cat sat on the mat.');
    await expect(panel.locator('.all-done-text')).toHaveText('All done! No more issues to fix.');
});

test('Enter applies the selected action, and the arrow keys move the selection', async () => {
    const panel = await open('apply.md');
    await expect(panel.locator('.action.selected .action-title')).toHaveText('The');
    await window.page.keyboard.press('ArrowDown');
    await window.page.keyboard.press('ArrowDown');
    await expect(panel.locator('.action.selected .action-title')).toHaveText('Tea');
    await window.page.keyboard.press('Enter');
    await expect.poll(() => editorText(window.page)).toBe('# Apply\nTea cat sat on the mat.');
});

test('i ignores the finding, and a refresh does not bring it back', async () => {
    const panel = await open('ignore.md');
    await expect(panel.locator('.error-text')).toHaveText('recieve');
    await window.page.keyboard.press('i');
    await expect(panel.locator('.all-done-text')).toBeVisible();
    await window.page.keyboard.press('r');
    // Long enough for the refresh's check to have come back.
    await window.page.waitForTimeout(3_000);
    await expect(panel.locator('.all-done-text')).toBeVisible();
    expect(await editorText(window.page)).toContain('recieve');
});

test('a adds the word to the workspace dictionary', async () => {
    const panel = await open('dictionary.md');
    await expect(panel.locator('.error-text')).toHaveText('zorblatt');
    await window.page.keyboard.press('a');
    await expect(panel.locator('.all-done-text')).toBeVisible();
    const dictionary = path.join(window.workspace, '.languagecheck', 'dictionary.txt');
    await expect.poll(() => fs.existsSync(dictionary) && fs.readFileSync(dictionary, 'utf8')).toContain('zorblatt');
});

test('s skips to the next finding, and h and l move back and forth', async () => {
    const panel = await open('several.md');
    const progress = panel.locator('.progress-text');
    const word = panel.locator('.error-text');
    await expect(progress).toHaveText('1 / 3');
    const first = await word.textContent();
    await window.page.keyboard.press('s');
    await expect(progress).toHaveText('2 / 3');
    const second = await word.textContent();
    expect(second).not.toBe(first);
    await window.page.keyboard.press('h');
    await expect(progress).toHaveText('1 / 3');
    await expect(word).toHaveText(first ?? '');
    await window.page.keyboard.press('l');
    await expect(word).toHaveText(second ?? '');
});

test('Escape closes the panel', async () => {
    const panel = await open('apply.md');
    await expect(panel.locator('.error-text')).toHaveText('Teh');
    const tab = window.page.locator('.tab', { hasText: 'SpeedFix' });
    // Seen first, so the count of zero below cannot come from a selector
    // that matches nothing.
    await expect(tab).toHaveCount(1);
    await window.page.keyboard.press('Escape');
    await expect(tab).toHaveCount(0);
});

test('? lists every key, and Escape then closes the list rather than the panel', async () => {
    const panel = await open('apply.md');
    const help = panel.locator('dialog.help');
    await expect(help).toBeHidden();
    await window.page.keyboard.press('?');
    await expect(help).toBeVisible();
    await expect(help.locator('dd')).toContainText(['Add to dictionary', 'Close the panel']);
    // A key the panel acts on does nothing behind the list.
    await window.page.keyboard.press('1');
    await window.page.keyboard.press('Escape');
    await expect(help).toBeHidden();
    await expect(window.page.locator('.tab', { hasText: 'SpeedFix' })).toHaveCount(1);
    await expect(panel.locator('.error-text')).toHaveText('Teh');
});

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
