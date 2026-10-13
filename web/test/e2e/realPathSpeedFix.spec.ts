// SpeedFix in the browser: the client's own SpeedFix panel, in an extension
// tab opened from the palette, fixing the page's editor. The scenarios are
// the VS Code UI suite's (extension/src/test/ui/speedFixScenarios.ts), run
// here through a driver for the browser; what is here besides them is about
// the browser's tabs.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { SPEEDFIX_SCENARIOS, type SpeedFixDriver, type SpeedFixFixture } from '../../../extension/src/test/ui/speedFixScenarios';
import { docText, expect, host, openFixture, openPanel, panelErrors, panelPages, test } from './fixtures';

/** Every dictionary file the native host keeps under `dataHome`, concatenated. */
function dictionaries(dir: string): string {
    return readdirSync(dir, { recursive: true, encoding: 'utf8' })
        .filter((file) => path.basename(file) === 'dictionary.txt')
        .map((file) => readFileSync(path.join(dir, file), 'utf8'))
        .join('\n');
}

async function openSpeedFix(page: Page, dataHome: string, fixture: SpeedFixFixture): Promise<Page> {
    await openFixture(page, dataHome, 'uiSpeedFix', fixture);
    const panel = await openPanel(page, 'Open SpeedFix', 'speedFix');
    // Focus the panel's document without acting: the counter does nothing.
    await panel.locator('.progress-text').click({ timeout: 30_000 });
    return panel;
}

function browserDriver(page: Page, context: BrowserContext, dataHome: string): SpeedFixDriver & { panel(): Page | undefined } {
    let panel: Page | undefined;
    return {
        async open(fixture: SpeedFixFixture) {
            panel = await openSpeedFix(page, dataHome, fixture);
            return panel;
        },
        press: async (key) => {
            try {
                await panel?.keyboard.press(key);
            } catch (error) {
                // A press is a keydown and a keyup; a key that closes the tab
                // (Escape) can close it before the keyup is sent, and the
                // press then throws over a key that did its job. Only that is
                // let through: the tab must really be gone, and the scenario
                // goes on to assert so.
                if (panel?.isClosed() !== true) throw error;
            }
        },
        editorText: () => docText(page),
        dictionary: () => Promise.resolve(dictionaries(dataHome)),
        panelTab: () => ({ count: () => Promise.resolve(panelPages(context, 'speedFix').length) }),
        panel: () => panel,
    };
}

for (const scenario of SPEEDFIX_SCENARIOS) {
    test(scenario.name, async ({ page, context, dataHome }) => {
        const driver = browserDriver(page, context, dataHome);
        await scenario.run(driver, expect);
        const panel = driver.panel();
        expect(panel === undefined ? [] : panelErrors.get(panel), 'uncaught errors in the panel').toEqual([]);
    });
}

// Collaborative editors: text can change under the panel without the user
// typing. A key pressed after a collaborator's edit, before the re-check,
// must not fix by the range the finding had before it.
test("a collaborator's edit before the key is not fixed over: the key waits for the re-check", async ({ page, context, dataHome }) => {
    const driver = browserDriver(page, context, dataHome);
    const panel = await driver.open('apply.md');
    await expect(panel.locator('.error-text')).toHaveText('Teh');
    // Three characters in front of "Teh", on its line, from elsewhere.
    const before = await docText(page);
    await host(page, 'remoteInsert', before.indexOf('Teh'), 'So ');
    await driver.press('1');
    // Refused (the text moved) or applied after the re-check; never "SoThe" or "So Teh" mangled.
    await expect.poll(() => docText(page)).toMatch(/So (?:Teh|The) cat sat on the mat\./u);
    for (let attempt = 0; attempt < 5; attempt++) {
        const now = await docText(page);
        if (!now.includes('So Teh')) break;
        await expect(panel.locator('.error-text')).toHaveText('Teh');
        await driver.press('1');
        // A refused key changes nothing: give it a moment to land, then try again.
        await expect.poll(() => docText(page), { timeout: 1000 }).toContain('So The').catch(() => {});
    }
    expect(await docText(page)).toContain('So The cat sat on the mat.');
});

// A site swaps the file in its editor without an edit the extension sees
// (CodeMirror's setState); until the page notices, the findings are the old
// file's. A key pressed in that window must not apply them to the new one.
test('a key pressed just after the site swaps in another file leaves the new file alone', async ({ page, context, dataHome }) => {
    const driver = browserDriver(page, context, dataHome);
    const panel = await driver.open('apply.md');
    await expect(panel.locator('.error-text')).toHaveText('Teh');
    const other = 'Something else entirely, with no mistakes.';
    await host(page, 'switchFile', 'doc-other', 'other.md', other);
    await driver.press('1');
    // Give a wrongly applied fix every chance to show.
    await expect.poll(() => docText(page), { timeout: 3000 }).not.toBe(other).catch(() => {});
    expect(await docText(page)).toBe(other);
});
