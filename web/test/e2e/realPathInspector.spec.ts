// The Inspector in the browser: the client's own Inspector panel, in an
// extension tab opened from the palette, describing the page's editor. The
// scenarios are the VS Code UI suite's (extension/src/test/ui/
// inspectorScenarios.ts), run here through a driver for the browser; what is
// here besides them is about the browser's tabs.
import type { Page } from '@playwright/test';
import { INSPECTOR_SCENARIOS, type InspectorDriver } from '../../../extension/src/test/ui/inspectorScenarios';
import { expect, openFixture, openPanel, panelErrors, runPaletteCommand, test } from './fixtures';

function browserDriver(page: Page, dataHome: string): InspectorDriver & { panel(): Page | undefined } {
    let panel: Page | undefined;
    return {
        async open(fixture) {
            await openFixture(page, dataHome, fixture, 'doc.md');
            panel = await openPanel(page, 'Open Inspector', 'inspector');
            await panel.locator('.tab-bar').waitFor({ timeout: 30_000 });
            return panel;
        },
        selectedChars: () =>
            page.evaluate(() => {
                const { main } = (globalThis as any).__host.view.state.selection;
                return main.to - main.from;
            }),
        async checkFromEditor() {
            await page.bringToFront();
            await page.locator('.cm-content').click();
            await runPaletteCommand(page, 'Check Current Document');
        },
        clipboard: () => page.evaluate(() => navigator.clipboard.readText()),
        panel: () => panel,
    };
}

test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
});

for (const scenario of INSPECTOR_SCENARIOS) {
    test(scenario.name, async ({ page, dataHome }) => {
        const driver = browserDriver(page, dataHome);
        await scenario.run(driver, expect);
        const panel = driver.panel();
        expect(panel === undefined ? [] : panelErrors.get(panel), 'uncaught errors in the panel').toEqual([]);
    });
}
