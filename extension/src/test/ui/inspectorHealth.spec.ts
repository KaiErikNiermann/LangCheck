/**
 * The Health tab follows LanguageTool back up, without the panel being
 * reopened or anything re-checked by hand: after the config is pointed at a
 * server that answers, and after the server it names comes back.
 *
 * uiInspectorDown points LanguageTool at a port nothing listens on. The
 * server that answers is a fake (see fakeLanguageTool.ts).
 */
import { expect, test, type FrameLocator, type Locator } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { freePort, startFakeLanguageTool, type FakeLanguageTool } from './fakeLanguageTool';
import { launchVSCode, openInspector, waitForSquiggles, type VSCodeWindow } from './vscodeWindow';

/** Long enough for a config reload, or a recovery poll, and the check after it. */
const RECOVERY_MS = 30_000;

let window: VSCodeWindow;
let languageTool: FakeLanguageTool | undefined;

test.afterEach(async () => {
    await window?.app.close();
    await languageTool?.close();
    languageTool = undefined;
});

const languageToolCard = (panel: FrameLocator): Locator => panel.locator('.health-card', { hasText: 'languagetool' });

async function openHealth(): Promise<FrameLocator> {
    window = await launchVSCode('uiInspectorDown', 'doc.md');
    await waitForSquiggles(window.page);
    const panel = await openInspector(window.page);
    await panel.locator('.tab', { hasText: 'Health' }).click();
    // Degraded after one failed request and down after three: either is the
    // unhealthy state these tests start from.
    await expect(languageToolCard(panel).locator('.health-status')).toHaveText(/degraded|down/i);
    return panel;
}

function pointLanguageToolAt(url: string): void {
    fs.writeFileSync(
        path.join(window.workspace, '.languagecheck.yaml'),
        `engines:\n  harper: true\n  languagetool:\n    enabled: true\n    url: "${url}"\n`,
    );
}

test('pointing the config at a server that answers shows LanguageTool healthy', async () => {
    const panel = await openHealth();
    languageTool = await startFakeLanguageTool();
    pointLanguageToolAt(languageTool.url);
    await expect(languageToolCard(panel).locator('.health-status')).toHaveText(/^ok$/i, { timeout: RECOVERY_MS });
});

test('LanguageTool coming back at the configured address shows it healthy', async () => {
    const panel = await openHealth();
    const port = await freePort();
    pointLanguageToolAt(`http://127.0.0.1:${port}`);
    // The reload re-checks against the new address, which nothing answers
    // yet: the error names it, so this is the new failure and not the old.
    // The card shortens the error, and the whole of it is in the tooltip.
    await expect(languageToolCard(panel).locator(`[title*=":${port}/"]`)).toHaveCount(1, { timeout: RECOVERY_MS });
    await expect(languageToolCard(panel).locator('.health-status')).toHaveText(/degraded|down/i);

    // Nothing in the editor changes from here: no edit, no save, no click.
    languageTool = await startFakeLanguageTool(port);
    await expect(languageToolCard(panel).locator('.health-status')).toHaveText(/^ok$/i, { timeout: RECOVERY_MS });
});
