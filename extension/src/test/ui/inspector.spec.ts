/**
 * The Inspector, driven through its own UI: each tab's view of one known
 * document, the range-to-editor link, and the report it copies.
 *
 * doc.md is two prose ranges -- the heading, and a line holding inline code,
 * a misspelling and a name -- and the line's `ł` is two bytes in UTF-8, which
 * is what makes the byte-to-character conversion visible below.
 */
import { expect, test, type FrameLocator } from '@playwright/test';

import { clipboardText, launchVSCode, openInspector, runCommand, waitForSquiggles, type VSCodeWindow } from './vscodeWindow';

let window: VSCodeWindow;

test.afterEach(async () => {
    await window?.app.close();
});

async function open(): Promise<FrameLocator> {
    window = await launchVSCode('uiInspector', 'doc.md');
    await waitForSquiggles(window.page);
    const panel = await openInspector(window.page);
    await panel.locator('.prose-card').first().waitFor();
    return panel;
}

async function showTab(panel: FrameLocator, name: string): Promise<void> {
    await panel.locator('.tab', { hasText: name }).click();
}

test('Extraction shows each prose range the core extracted, with its exclusions', async () => {
    const panel = await open();
    await expect(panel.locator('.tab-filename')).toHaveText('doc.md');
    await expect(panel.locator('.section-count').first()).toHaveText('2 ranges');
    const cards = panel.locator('.prose-card');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0).locator('.prose-text')).toHaveText('# Inspector\n');
    await expect(cards.nth(1).locator('.exclusion-count-badge')).toHaveText('1 excl.');
    await expect(cards.nth(1).locator('.exc-text')).toHaveText('`inline code`');
});

test('Clean Text shows what the checker read, with the exclusion blanked', async () => {
    const panel = await open();
    await showTab(panel, 'Clean Text');
    const clean = panel.locator('.clean-text');
    await expect(clean).toHaveCount(2);
    await expect(clean.nth(1)).toHaveText(
        'The poet Wisława Szymborska wrote beside               and one recieve typo.\n');
});

test('Timing shows the check stages and the checked document', async () => {
    const panel = await open();
    await showTab(panel, 'Timing');
    await expect(panel.locator('.latency-label')).toHaveText(['Read document', 'Core RPC (checkProse)', 'Map diagnostics', 'Update UI']);
    await expect(panel.locator('.check-info-row', { hasText: 'Issues found' }).locator('.check-info-value')).toHaveText('1');
    await expect(panel.locator('.check-info-row', { hasText: 'Prose ranges' }).locator('.check-info-value')).toHaveText('2');
});

test('Issues summarises the findings by severity and by rule', async () => {
    const panel = await open();
    await showTab(panel, 'Issues');
    await expect(panel.locator('.section-count')).toHaveText('1 total');
    await expect(panel.locator('.rule-id')).toHaveText(['harper.Spelling']);
});

test('Names lists the word the name filter silenced', async () => {
    const panel = await open();
    await expect(panel.locator('.tab', { hasText: 'Names' })).toHaveText('Names (1)');
    await showTab(panel, 'Names');
    await expect(panel.locator('.name-token')).toHaveText(['Wisława']);
    await expect(panel.locator('.name-line')).toHaveText(['line 3']);
});

test('Events shows a check run while the Inspector is open, and Clear empties it', async () => {
    const panel = await open();
    await showTab(panel, 'Events');
    await expect(panel.locator('.event-row')).toHaveCount(0);
    // The command checks the active editor, so the editor needs focus back.
    await window.page.locator('.editor-group-container .view-lines').first().click();
    await runCommand(window.page, 'Language Check: Check Current Document');
    await expect(panel.locator('.event-source', { hasText: 'checkDocument' }).first()).toBeVisible();
    await panel.locator('.clear-btn').click();
    await expect(panel.locator('.event-row')).toHaveCount(0);
});

test('Health lists every engine and whether it is on', async () => {
    const panel = await open();
    await showTab(panel, 'Health');
    await expect(panel.locator('.health-name')).toHaveText(['harper', 'languagetool', 'vale', 'proselint'], { ignoreCase: true });
    await expect(panel.locator('.health-card', { hasText: 'harper' }).locator('.health-status')).toHaveText(/ok/i);
    await expect(panel.locator('.health-card', { hasText: 'languagetool' }).locator('.health-status')).toHaveText(/disabled/i);
});

test('Copy Report puts a report about this document on the clipboard', async () => {
    const panel = await open();
    await panel.locator('.health-action-btn', { hasText: 'Copy Report' }).click();
    await expect(panel.locator('.health-action-btn', { hasText: 'Copied!' })).toBeVisible();
    await expect.poll(() => clipboardText(window)).toContain('## Language Check Inspector Report');
    const report = await clipboardText(window);
    expect(report).toContain('- **File:** doc.md');
    expect(report).toContain('harper.Spelling');
});
