/**
 * Driving a real VS Code window for the UI tests.
 *
 * The extension-host e2e suite cannot see into a webview: it runs beside the
 * extension, while the webview renders in the window, two iframes deep. This
 * launches VS Code as an Electron app under Playwright instead, the way VS
 * Code's own smoke tests do, so a test can read the panel and type into it.
 */
import { _electron as electron, type ElectronApplication, type FrameLocator, type Page } from '@playwright/test';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const EXTENSION_ROOT = path.resolve(__dirname, '../../..');

export interface VSCodeWindow {
    readonly app: ElectronApplication;
    readonly page: Page;
    /** The throwaway copy of the fixture the window has open. */
    readonly workspace: string;
}

/**
 * Open a fresh copy of a fixture in a new VS Code window, with this extension
 * loaded from source and every other extension off, and `open` in an editor.
 */
export async function launchVSCode(fixture: string, open: string): Promise<VSCodeWindow> {
    // The same build the e2e suite downloaded; this only fetches if missing.
    const executablePath = await downloadAndUnzipVSCode({ cachePath: path.join(EXTENSION_ROOT, '.vscode-test') });
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-ui-workspace-'));
    fs.cpSync(path.join(EXTENSION_ROOT, 'src/test/fixtures', fixture), workspace, { recursive: true });
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-ui-user-'));

    const app = await electron.launch({
        executablePath,
        args: [
            workspace,
            path.join(workspace, open),
            `--extensionDevelopmentPath=${EXTENSION_ROOT}`,
            '--disable-extensions',
            `--user-data-dir=${userData}`,
            '--skip-welcome',
            '--skip-release-notes',
            '--disable-workspace-trust',
            '--new-window',
        ],
        timeout: 60_000,
    });
    const page = await app.firstWindow();
    await page.locator('.monaco-workbench').waitFor({ timeout: 60_000 });
    return { app, page, workspace };
}

/** Wait until the editor draws at least one of this extension's squiggles. */
export async function waitForSquiggles(page: Page): Promise<void> {
    await page.locator('.squiggly-warning, .squiggly-error, .squiggly-info').first().waitFor({ timeout: 60_000 });
}

/** Run a command by its palette title, as a user would. */
export async function runCommand(page: Page, title: string): Promise<void> {
    await page.keyboard.press('F1');
    await page.keyboard.type(title);
    await page.keyboard.press('Enter');
}

/**
 * The document inside the open webview: VS Code's host iframe, then the page
 * it loads. The tests open one panel at a time, so there is only one.
 */
export function webview(page: Page): FrameLocator {
    return page.frameLocator('iframe.webview.ready').frameLocator('iframe#active-frame');
}

/**
 * Open SpeedFix and give its document keyboard focus.
 *
 * Focused by clicking the counter, which does nothing: clicking the panel's
 * middle lands on whichever suggestion button is there and applies it, and
 * the shortcut legend holds the button that opens the key list.
 */
export async function openSpeedFix(page: Page): Promise<FrameLocator> {
    await runCommand(page, 'Language Check: Open SpeedFix');
    const panel = webview(page);
    await panel.locator('.progress-text').click({ timeout: 30_000 });
    return panel;
}

/** Open the Inspector and wait for its tab bar. */
export async function openInspector(page: Page): Promise<FrameLocator> {
    await runCommand(page, 'Language Check: Open Inspector');
    const panel = webview(page);
    await panel.locator('.tab-bar').waitFor({ timeout: 30_000 });
    return panel;
}

/** What is on the system clipboard, read in VS Code's main process. */
export async function clipboardText(window: VSCodeWindow): Promise<string> {
    return window.app.evaluate(({ clipboard }) => clipboard.readText());
}

/** The text of the first editor, as rendered (blank lines collapse). */
export async function editorText(page: Page): Promise<string> {
    const text = await page.locator('.editor-group-container .view-lines').first().innerText();
    return text.replace(/\u00a0/g, ' ');
}
