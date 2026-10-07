/**
 * SpeedFix's behaviour, written once and run against both hosts of the panel:
 * VS Code's webview (speedFix.spec.ts) and the browser extension's panel tab
 * (web/test/e2e/realPathSpeedFix.spec.ts). Each host supplies a driver; what a
 * user sees and what the keys do must not differ between them.
 *
 * The documents are the files in fixtures/uiSpeedFix. Expectations about the
 * document name the line a key changed, not the whole text: the hosts render
 * a document differently (VS Code collapses blank lines in what it draws).
 *
 * Only `import type` here: each suite brings its own Playwright, and a second
 * copy loaded at run time is an error.
 */
import type { Expect, FrameLocator, Locator } from '@playwright/test';

/** The fixture documents, by file name in fixtures/uiSpeedFix. */
export type SpeedFixFixture = 'apply.md' | 'dictionary.md' | 'ignore.md' | 'markup.md' | 'several.md';

export interface SpeedFixDriver {
    /** Open `fixture`, wait for its findings, open SpeedFix and give it the keyboard. */
    open(fixture: SpeedFixFixture): Promise<Pick<FrameLocator, 'locator'>>;
    /** Press a key in the panel. */
    press(key: string): Promise<void>;
    /** The document's text, as the host's editor holds it. */
    editorText(): Promise<string>;
    /** What the workspace dictionary holds. */
    dictionary(): Promise<string>;
    /** The panel itself (VS Code's editor tab, the browser tab): seen while it is open. */
    panelTab(): Locator | { count(): Promise<number> };
}

export interface SpeedFixScenario {
    readonly name: string;
    run(driver: SpeedFixDriver, expect: Expect): Promise<void>;
}

/** Long enough for a refresh's check to have come back. */
const RECHECK_SETTLE_MS = 3_000;

export const SPEEDFIX_SCENARIOS: readonly SpeedFixScenario[] = [
    {
        name: 'shows the finding with its suggestions first, then the dictionary and ignore actions',
        async run(driver, expect) {
            const panel = await driver.open('apply.md');
            await expect(panel.locator('.error-text')).toHaveText('Teh');
            await expect(panel.locator('.action .action-title')).toHaveText(['The', 'Th', 'Tea', 'Add to Dictionary', 'Ignore']);
            await expect(panel.locator('.progress-text')).toHaveText('1 / 1');
        },
    },
    {
        name: 'the context line is shown as text, markup characters and all, with the finding highlighted',
        async run(driver, expect) {
            const panel = await driver.open('markup.md');
            await expect(panel.locator('.error-text')).toHaveText('teh');
            await expect(panel.locator('.context')).toHaveText('A teh line where 1 < 2 & "quotes" stay.');
            await expect(panel.locator('.context .highlight')).toHaveText('teh');
            await expect(panel.locator('.context > *')).toHaveCount(1);
        },
    },
    {
        name: 'a number key applies that suggestion to the document',
        async run(driver, expect) {
            const panel = await driver.open('apply.md');
            await expect(panel.locator('.error-text')).toHaveText('Teh');
            await driver.press('1');
            await expect.poll(() => driver.editorText()).toContain('The cat sat on the mat.');
            await expect(panel.locator('.all-done-text')).toHaveText('All done! No more issues to fix.');
        },
    },
    {
        name: 'Enter applies the selected action, and the arrow keys move the selection',
        async run(driver, expect) {
            const panel = await driver.open('apply.md');
            await expect(panel.locator('.action.selected .action-title')).toHaveText('The');
            await driver.press('ArrowDown');
            await driver.press('ArrowDown');
            await expect(panel.locator('.action.selected .action-title')).toHaveText('Tea');
            await driver.press('Enter');
            await expect.poll(() => driver.editorText()).toContain('Tea cat sat on the mat.');
        },
    },
    {
        name: 'i ignores the finding, and a refresh does not bring it back',
        async run(driver, expect) {
            const panel = await driver.open('ignore.md');
            await expect(panel.locator('.error-text')).toHaveText('recieve');
            await driver.press('i');
            await expect(panel.locator('.all-done-text')).toBeVisible();
            await driver.press('r');
            await new Promise((resolve) => setTimeout(resolve, RECHECK_SETTLE_MS));
            await expect(panel.locator('.all-done-text')).toBeVisible();
            expect(await driver.editorText()).toContain('recieve');
        },
    },
    {
        name: 'a adds the word to the workspace dictionary',
        async run(driver, expect) {
            const panel = await driver.open('dictionary.md');
            await expect(panel.locator('.error-text')).toHaveText('zorblatt');
            await driver.press('a');
            await expect(panel.locator('.all-done-text')).toBeVisible();
            await expect.poll(() => driver.dictionary()).toContain('zorblatt');
        },
    },
    {
        name: 's skips to the next finding, and h and l move back and forth',
        async run(driver, expect) {
            const panel = await driver.open('several.md');
            const progress = panel.locator('.progress-text');
            const word = panel.locator('.error-text');
            await expect(progress).toHaveText('1 / 3');
            const first = await word.textContent();
            await driver.press('s');
            await expect(progress).toHaveText('2 / 3');
            const second = await word.textContent();
            expect(second).not.toBe(first);
            await driver.press('h');
            await expect(progress).toHaveText('1 / 3');
            await expect(word).toHaveText(first ?? '');
            await driver.press('l');
            await expect(word).toHaveText(second ?? '');
        },
    },
    {
        name: 'Escape closes the panel',
        async run(driver, expect) {
            const panel = await driver.open('apply.md');
            await expect(panel.locator('.error-text')).toHaveText('Teh');
            // Seen first, so the count of zero below cannot come from a
            // selector that matches nothing.
            await expect.poll(() => driver.panelTab().count()).toBe(1);
            await driver.press('Escape');
            await expect.poll(() => driver.panelTab().count()).toBe(0);
        },
    },
    {
        name: '? lists every key, and Escape then closes the list rather than the panel',
        async run(driver, expect) {
            const panel = await driver.open('apply.md');
            const help = panel.locator('dialog.help');
            await expect(help).toBeHidden();
            await driver.press('?');
            await expect(help).toBeVisible();
            await expect(help.locator('dd')).toContainText(['Add to dictionary', 'Close the panel']);
            // A key the panel acts on does nothing behind the list.
            await driver.press('1');
            await driver.press('Escape');
            await expect(help).toBeHidden();
            await expect.poll(() => driver.panelTab().count()).toBe(1);
            await expect(panel.locator('.error-text')).toHaveText('Teh');
        },
    },
];
