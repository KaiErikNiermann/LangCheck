/**
 * SpeedFix, driven through its own UI: the keys a user presses, and what the
 * editor and the workspace look like afterwards.
 */
import { expect, test, type FrameLocator } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { editorText, launchVSCode, openSpeedFix, waitForSquiggles, type VSCodeWindow } from './vscodeWindow';

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
