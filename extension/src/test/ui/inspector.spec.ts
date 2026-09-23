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

test('clicking a range selects it in the editor, counted in characters not bytes', async () => {
    const panel = await open();
    const range = panel.locator('.prose-card').nth(1);
    // 78 bytes on the wire: the `ł` in Wisława is two of them.
    await expect(range.locator('.prose-bytes').last()).toHaveText('bytes 13..91');
    await range.click();
    await expect(window.page.locator('.statusbar-item', { hasText: 'selected' })).toContainText('(77 selected)');
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

test('the Health tab re-check button checks the inspected document', async () => {
    // Offered only while an engine is unhealthy, hence a fixture whose
    // LanguageTool points at a port nothing listens on.
    window = await launchVSCode('uiInspectorDown', 'doc.md');
    await waitForSquiggles(window.page);
    const panel = await openInspector(window.page);
    await showTab(panel, 'Health');
    // Degraded after the first failed request, down after several: either
    // is unhealthy, and either offers the button.
    await expect(panel.locator('.health-card', { hasText: 'languagetool' }).locator('.health-status')).toHaveText(/degraded|down/i);
    await showTab(panel, 'Events');
    await expect(panel.locator('.event-row')).toHaveCount(0);
    await showTab(panel, 'Health');
    // The click puts focus in the webview, where there is no active editor.
    await panel.locator('.health-action-btn', { hasText: /check/i }).first().click();
    await showTab(panel, 'Events');
    await expect(panel.locator('.event-source', { hasText: 'checkDocument' }).first()).toBeVisible();
});

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
