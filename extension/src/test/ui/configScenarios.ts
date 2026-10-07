/**
 * Editing the config, written once and run against both hosts: VS Code
 * (config.spec.ts: the file in an editor, saved) and the browser extension
 * (web/test/e2e/realPathConfig.spec.ts: the config page, saved through the
 * native host). Each host supplies a driver; what a save does to checking,
 * and how the config itself is marked, must not differ between them.
 *
 * The document is fixtures/uiConfig/doc.md, one misspelling and no config
 * at first.
 *
 * Only `import type` here: each suite brings its own Playwright.
 */
import type { Expect } from '@playwright/test';

export interface ConfigDriver {
    /** Open the document, wait for its finding, then open its workspace's config for editing. */
    open(): Promise<void>;
    /** Replace the config's text with `text`, and save it. */
    setConfig(text: string): Promise<void>;
    /** How many findings of warning or error severity the checked document shows (an information note is about the check itself: "nothing checked this"). */
    documentFindings(): Promise<number>;
    /** How many squiggles the config shows. */
    configSquiggles(): Promise<number>;
    /** How many gutter marks the config shows. */
    configGutterMarks(): Promise<number>;
}

export interface ConfigScenario {
    readonly name: string;
    run(driver: ConfigDriver, expect: Expect): Promise<void>;
}

/** Long enough for a save to reload the core and the re-check to land. */
const RELOAD_MS = 30_000;

export const CONFIG_SCENARIOS: readonly ConfigScenario[] = [
    {
        name: 'saving the config changes how the document is checked',
        async run(driver, expect) {
            await driver.open();
            expect(await driver.documentFindings()).toBeGreaterThan(0);
            await driver.setConfig('engines:\n  harper: false\n');
            await expect.poll(() => driver.documentFindings(), { timeout: RELOAD_MS }).toBe(0);
            await driver.setConfig('engines:\n  harper: true\n');
            await expect.poll(() => driver.documentFindings(), { timeout: RELOAD_MS }).toBeGreaterThan(0);
        },
    },
    {
        name: 'a key the config does not have is squiggled',
        async run(driver, expect) {
            await driver.open();
            await driver.setConfig('engines:\n  harper: true\nenginez: {}\n');
            await expect.poll(() => driver.configSquiggles(), { timeout: RELOAD_MS }).toBeGreaterThan(0);
        },
    },
    {
        name: 'a key the core probed gets a gutter mark',
        async run(driver, expect) {
            await driver.open();
            await driver.setConfig('engines:\n  harper: true\n');
            await expect.poll(() => driver.configGutterMarks(), { timeout: RELOAD_MS }).toBeGreaterThan(0);
        },
    },
];
