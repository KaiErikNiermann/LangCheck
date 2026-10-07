// SpeedFix in the browser: the client's own SpeedFix panel, in an extension
// tab opened from the palette, fixing the page's editor. The scenarios are
// the VS Code UI suite's (extension/src/test/ui/speedFixScenarios.ts), run
// here through a driver for the browser; what is here besides them is about
// the browser's tabs.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { SPEEDFIX_SCENARIOS, type SpeedFixDriver, type SpeedFixFixture } from '../../../extension/src/test/ui/speedFixScenarios';
import { docText, expect, openFixture, openPanel, panelErrors, panelPages, test } from './fixtures';

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
            await panel?.keyboard.press(key);
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
