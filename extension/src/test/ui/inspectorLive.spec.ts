/**
 * The Inspector keeps up without being reopened: the Config tab follows the
 * config and the files on disk, and the ranges follow the document.
 *
 * uiInspectorLive checks on every change and includes docs/** only, so
 * drafts/idea.md starts out skipped by include. The config and the files are
 * changed on disk, from outside the editor, as a branch switch would.
 */
import { expect, test, type FrameLocator, type Locator } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { launchVSCode, openInspector, replaceText, typeAtEnd, waitForSquiggles, type VSCodeWindow } from './vscodeWindow';

let window: VSCodeWindow;

test.afterEach(async () => {
    await window?.app.close();
});

async function open(fixture: string, file: string): Promise<FrameLocator> {
    window = await launchVSCode(fixture, file);
    await waitForSquiggles(window.page);
    const panel = await openInspector(window.page);
    await panel.locator('.prose-card').first().waitFor();
    return panel;
}

async function openConfigTab(): Promise<FrameLocator> {
    const panel = await open('uiInspectorLive', 'docs/guide.md');
    await panel.locator('.tab', { hasText: 'Config' }).click();
    return panel;
}

const checked = (panel: FrameLocator): Locator => panel.locator('[data-list="checked"] .scope-path');
const skipped = (panel: FrameLocator): Locator => panel.locator('[data-list="skipped"] .scope-file');

function writeConfig(text: string): void {
    fs.writeFileSync(path.join(window.workspace, '.languagecheck.yaml'), `engines:\n  harper: true\n${text}`);
}

test('the Config tab names the config in force and the files it selects', async () => {
    const panel = await openConfigTab();
    await expect(panel.locator('.config-path')).toHaveText(path.join(window.workspace, '.languagecheck.yaml'));
    await expect(checked(panel)).toHaveText(['docs/guide.md', 'docs/notes.md']);
    await expect(skipped(panel)).toHaveCount(1);
    await expect(skipped(panel).locator('.scope-path')).toHaveText('drafts/idea.md');
    await expect(skipped(panel).locator('.scope-reason')).toHaveText('include');
});

test('editing include and exclude re-lists the files while the panel is open', async () => {
    const panel = await openConfigTab();
    await expect(checked(panel)).toHaveText(['docs/guide.md', 'docs/notes.md']);

    writeConfig('include: ["docs/**", "drafts/**"]\n');
    await expect(checked(panel)).toHaveText(['docs/guide.md', 'docs/notes.md', 'drafts/idea.md']);
    await expect(skipped(panel)).toHaveCount(0);

    writeConfig('include: ["docs/**", "drafts/**"]\nexclude: ["docs/notes.md"]\n');
    await expect(checked(panel)).toHaveText(['docs/guide.md', 'drafts/idea.md']);
    const notes = skipped(panel).filter({ hasText: 'docs/notes.md' });
    await expect(notes.locator('.scope-reason')).toHaveText('exclude');
});

test('a file created or deleted under the config is listed or dropped', async () => {
    const panel = await openConfigTab();
    await expect(checked(panel)).toHaveText(['docs/guide.md', 'docs/notes.md']);

    fs.writeFileSync(path.join(window.workspace, 'docs/added.md'), 'Added later.\n');
    await expect(checked(panel)).toHaveText(['docs/added.md', 'docs/guide.md', 'docs/notes.md']);

    fs.rmSync(path.join(window.workspace, 'docs/notes.md'));
    await expect(checked(panel)).toHaveText(['docs/added.md', 'docs/guide.md']);
});

test('deleting the config falls back to the defaults, and says so', async () => {
    const panel = await openConfigTab();
    await expect(checked(panel)).toHaveText(['docs/guide.md', 'docs/notes.md']);

    fs.rmSync(path.join(window.workspace, '.languagecheck.yaml'));
    await expect(panel.locator('.config-path')).toHaveText('No config file, so the defaults apply.');
    await expect(checked(panel)).toHaveText(['docs/guide.md', 'docs/notes.md', 'drafts/idea.md']);
});

test('under onChange, the ranges and the issues follow an edit before any save', async () => {
    const panel = await open('uiInspectorLive', 'docs/guide.md');
    const cards = panel.locator('.prose-card');
    await expect(cards).toHaveCount(2);

    await typeAtEnd(window.page, '\n\nA third paragraph with teh typo.\n');
    await expect(cards).toHaveCount(3);
    await expect(cards.nth(2).locator('.prose-text')).toContainText('A third paragraph with teh typo.');
    await expect(panel.locator('.stale-notice')).toHaveCount(0);

    await panel.locator('.tab', { hasText: 'Issues' }).click();
    await expect(panel.locator('.section-count').first()).toHaveText('2 total');

    // Every issue gone: the summary has to empty, not keep the last count.
    await replaceText(window.page, '# Guide\n\nEvery word here is spelled right.\n');
    await expect(panel.locator('.empty-state')).toHaveText('No diagnostics reported yet.');
});

test('under onSave, an unsaved edit marks the ranges stale until the save checks it', async () => {
    const panel = await open('uiInspector', 'doc.md');
    const cards = panel.locator('.prose-card');
    await expect(cards).toHaveCount(2);
    const notice = panel.locator('.stale-notice');
    await expect(notice).toHaveCount(0);

    await typeAtEnd(window.page, '\n\nA new paragraph.\n');
    await expect(notice).toBeVisible();
    await expect(cards).toHaveCount(2);

    await window.page.keyboard.press('Control+s');
    await expect(notice).toHaveCount(0);
    await expect(cards).toHaveCount(3);
});
