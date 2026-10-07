/**
 * The Inspector's behaviour, written once and run against both hosts of the
 * panel: VS Code's webview (inspector.spec.ts) and the browser extension's
 * panel tab (web/test/e2e/realPathInspector.spec.ts). Each host supplies a
 * driver; the tabs must read the same for the same document and config.
 *
 * Fixtures: uiInspector/doc.md is two prose ranges -- the heading, and a line
 * holding inline code, a misspelling and a name -- with name detection on;
 * the line's `ł` is two bytes in UTF-8, which is what makes the
 * byte-to-character conversion visible. uiInspectorDown is the same document
 * with LanguageTool pointed at a port nothing listens on.
 *
 * Only `import type` here: each suite brings its own Playwright.
 */
import type { Expect, FrameLocator } from '@playwright/test';

export type InspectorFixture = 'uiInspector' | 'uiInspectorDown';
type Panel = Pick<FrameLocator, 'locator'>;

export interface InspectorDriver {
    /** Open the fixture's doc.md, wait for its findings, and open the Inspector. */
    open(fixture: InspectorFixture): Promise<Panel>;
    /** How many characters the editor has selected. */
    selectedChars(): Promise<number>;
    /** Run "Check Current Document" from the editor, as a user would. */
    checkFromEditor(): Promise<void>;
    /** What is on the clipboard. */
    clipboard(): Promise<string>;
}

export interface InspectorScenario {
    readonly name: string;
    run(driver: InspectorDriver, expect: Expect): Promise<void>;
}

/** Open the Inspector on uiInspector, with its extraction drawn. */
async function open(driver: InspectorDriver): Promise<Panel> {
    const panel = await driver.open('uiInspector');
    await panel.locator('.prose-card').first().waitFor();
    return panel;
}

async function showTab(panel: Panel, name: string): Promise<void> {
    await panel.locator('.tab', { hasText: name }).click();
}

export const INSPECTOR_SCENARIOS: readonly InspectorScenario[] = [
    {
        name: 'Extraction shows each prose range the core extracted, with its exclusions',
        async run(driver, expect) {
            const panel = await open(driver);
            await expect(panel.locator('.tab-filename')).toHaveText('doc.md');
            await expect(panel.locator('.section-count').first()).toHaveText('2 ranges');
            const cards = panel.locator('.prose-card');
            await expect(cards).toHaveCount(2);
            await expect(cards.nth(0).locator('.prose-text')).toHaveText('# Inspector\n');
            await expect(cards.nth(1).locator('.exclusion-count-badge')).toHaveText('1 excl.');
            await expect(cards.nth(1).locator('.exc-text')).toHaveText('`inline code`');
        },
    },
    {
        name: 'clicking a range selects it in the editor, counted in characters not bytes',
        async run(driver, expect) {
            const panel = await open(driver);
            const range = panel.locator('.prose-card').nth(1);
            // 78 bytes on the wire: the `ł` in Wisława is two of them.
            await expect(range.locator('.prose-bytes').last()).toHaveText('bytes 13..91');
            await range.click();
            await expect.poll(() => driver.selectedChars()).toBe(77);
        },
    },
    {
        name: 'Clean Text shows what the checker read, with the exclusion blanked',
        async run(driver, expect) {
            const panel = await open(driver);
            await showTab(panel, 'Clean Text');
            const clean = panel.locator('.clean-text');
            await expect(clean).toHaveCount(2);
            await expect(clean.nth(1)).toHaveText('The poet Wisława Szymborska wrote beside               and one recieve typo.\n');
        },
    },
    {
        name: 'Timing shows the check stages and the checked document',
        async run(driver, expect) {
            const panel = await open(driver);
            await showTab(panel, 'Timing');
            await expect(panel.locator('.latency-label')).toHaveText(['Read document', 'Core RPC (checkProse)', 'Map diagnostics', 'Update UI']);
            await expect(panel.locator('.check-info-row', { hasText: 'Issues found' }).locator('.check-info-value')).toHaveText('1');
            await expect(panel.locator('.check-info-row', { hasText: 'Prose ranges' }).locator('.check-info-value')).toHaveText('2');
        },
    },
    {
        name: 'Issues summarises the findings by severity and by rule',
        async run(driver, expect) {
            const panel = await open(driver);
            await showTab(panel, 'Issues');
            await expect(panel.locator('.section-count')).toHaveText('1 total');
            await expect(panel.locator('.rule-id')).toHaveText(['harper.Spelling']);
        },
    },
    {
        name: 'Names lists the word the name filter silenced',
        async run(driver, expect) {
            const panel = await open(driver);
            await expect(panel.locator('.tab', { hasText: 'Names' })).toHaveText('Names (1)');
            await showTab(panel, 'Names');
            await expect(panel.locator('.name-token')).toHaveText(['Wisława']);
            await expect(panel.locator('.name-line')).toHaveText(['line 3']);
        },
    },
    {
        name: 'Events shows a check run while the Inspector is open, and Clear empties it',
        async run(driver, expect) {
            const panel = await open(driver);
            await showTab(panel, 'Events');
            await expect(panel.locator('.event-row')).toHaveCount(0);
            await driver.checkFromEditor();
            await expect(panel.locator('.event-source', { hasText: 'checkDocument' }).first()).toBeVisible();
            await panel.locator('.clear-btn').click();
            await expect(panel.locator('.event-row')).toHaveCount(0);
        },
    },
    {
        name: 'Health lists every engine and whether it is on',
        async run(driver, expect) {
            const panel = await open(driver);
            await showTab(panel, 'Health');
            await expect(panel.locator('.health-name')).toHaveText(['harper', 'languagetool', 'vale', 'proselint'], { ignoreCase: true });
            await expect(panel.locator('.health-card', { hasText: 'harper' }).locator('.health-status')).toHaveText(/ok/i);
            await expect(panel.locator('.health-card', { hasText: 'languagetool' }).locator('.health-status')).toHaveText(/disabled/i);
        },
    },
    {
        name: 'Copy Report puts a report about this document on the clipboard',
        async run(driver, expect) {
            const panel = await open(driver);
            await panel.locator('.health-action-btn', { hasText: 'Copy Report' }).click();
            await expect(panel.locator('.health-action-btn', { hasText: 'Copied!' })).toBeVisible();
            await expect.poll(() => driver.clipboard()).toContain('## Language Check Inspector Report');
            const report = await driver.clipboard();
            expect(report).toContain('- **File:** doc.md');
            expect(report).toContain('harper.Spelling');
        },
    },
    {
        name: 'the Health tab re-check button checks the inspected document',
        async run(driver, expect) {
            // Offered only while an engine is unhealthy.
            const panel = await driver.open('uiInspectorDown');
            await showTab(panel, 'Health');
            // Degraded after the first failed request, down after several:
            // either is unhealthy, and either offers the button.
            await expect(panel.locator('.health-card', { hasText: 'languagetool' }).locator('.health-status')).toHaveText(/degraded|down/i);
            await showTab(panel, 'Events');
            await expect(panel.locator('.event-row')).toHaveCount(0);
            await showTab(panel, 'Health');
            // The click puts focus in the panel, away from the editor.
            await panel.locator('.health-action-btn', { hasText: /check/i }).first().click();
            await showTab(panel, 'Events');
            await expect(panel.locator('.event-source', { hasText: 'checkDocument' }).first()).toBeVisible();
        },
    },
];
