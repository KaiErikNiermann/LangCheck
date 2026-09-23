/**
 * The Inspector keeps up without being reopened: the ranges follow the
 * document.
 *
 * uiInspectorLive checks on every change; uiInspector keeps the default of
 * checking on save.
 */
import { expect, test, type FrameLocator } from '@playwright/test';

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
