// A Chromium with the extension's test build loaded and the real native
// host registered in its profile, so every test drives the whole path:
// page world, content script, background, native host, core server.
// Each test gets its own profile and its own data directory (where the
// host keeps workspaces and dictionaries).
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, expect, test as base, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { EXTENSION_ROOT, RUST_CORE, WEB } from './globalSetup';

export const BASE = 'http://127.0.0.1:4180';
export const EXTENSION = path.join(WEB, 'dist-test');
export const HOST_BINARY = path.join(RUST_CORE, 'target/debug/language-check-native-host');

export type Site = 'overleaf' | 'typst';
export type Cm = 'current' | '6.38';

/**
 * The stand-in page for `site`: Overleaf on 127.0.0.1, Typst on localhost.
 * `name` is the open file's name on Overleaf (its extension sets the language).
 */
export function pageUrl(site: Site, cm: Cm, text?: string, project = 'p1', name?: string): string {
    const origin = site === 'overleaf' ? BASE : BASE.replace('127.0.0.1', 'localhost');
    const query = new URLSearchParams({ cm, ...(text !== undefined && { text }), ...(name !== undefined && { name }) });
    return `${origin}/project/${project}?${query.toString()}`;
}

interface Fixtures {
    context: BrowserContext;
    /** The loaded extension's id (chrome-extension://<id>/...). */
    extensionId: string;
    page: Page;
    /** Where the native host keeps workspaces; shared by every page of the test. */
    dataHome: string;
    /** Registers the native host with this profile (on by default). */
    hostInstalled: boolean;
}

const extensionIds = new WeakMap<BrowserContext, string>();

export const test = base.extend<Fixtures>({
    hostInstalled: [true, { option: true }],
    dataHome: async ({}, use) => {
        const dir = mkdtempSync(path.join(tmpdir(), 'lc-e2e-data-'));
        await use(dir);
        rmSync(dir, { recursive: true, force: true });
    },
    context: async ({ dataHome, hostInstalled }, use) => {
        const profile = mkdtempSync(path.join(tmpdir(), 'lc-e2e-profile-'));
        const context = await chromium.launchPersistentContext(profile, {
            // The full Chromium build: the headless shell cannot load extensions.
            channel: 'chromium',
            args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
            env: { ...process.env, XDG_DATA_HOME: dataHome, RUST_LOG: 'warn' },
        });
        const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
        const extensionId = new URL(worker.url()).host;
        if (hostInstalled) {
            // Chromium on Linux reads user-level host manifests from
            // <profile>/NativeMessagingHosts.
            execFileSync(HOST_BINARY, ['install', '--browser', 'chromium', '--chrome-extension-id', extensionId, '--dir', path.join(profile, 'NativeMessagingHosts')]);
        }
        context.on('page', (opened) => {
            const errors: string[] = [];
            opened.on('pageerror', (e) => {
                errors.push(e.message);
            });
            panelErrors.set(opened, errors);
        });
        extensionIds.set(context, extensionId);
        await use(context);
        await context.close();
        rmSync(profile, { recursive: true, force: true });
    },
    extensionId: async ({ context }, use) => {
        await use(extensionIds.get(context) ?? '');
    },
    page: async ({ context }, use) => {
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('pageerror', (e) => {
            errors.push(e.message);
        });
        await use(page);
        expect(errors, 'uncaught errors in the page').toEqual([]);
    },
});

export { expect } from '@playwright/test';

export const marks = (page: Page): Locator => page.locator('.lc-diag');
export const popover = (page: Page): Locator => page.locator('.lc-popover:not([hidden])');
/** A squiggled span whose text is exactly `text`. */
export const mark = (page: Page, text: string): Locator => page.locator('.lc-diag', { hasText: new RegExp(`^${text}$`, 'u') });

export async function hoverMark(page: Page, text: string): Promise<Locator> {
    await page.mouse.move(0, 0);
    await mark(page, text).hover();
    await expect(popover(page)).toBeVisible();
    return popover(page);
}

/** The document as the editor holds it (the DOM also has hint pseudo-elements). */
export function docText(page: Page): Promise<string> {
    return page.evaluate(() => (globalThis as unknown as { __host: { text(): string } }).__host.text());
}

export function host(page: Page, method: string, ...args: unknown[]): Promise<unknown> {
    return page.evaluate(([m, a]) => (globalThis as any).__host[m](...a), [method, args] as const);
}

export function status(page: Page): Promise<{ state: string; uri?: string; languageId?: string; reason?: string }> {
    return page.evaluate(() => (globalThis as any).__languageCheck?.bridge.getStatus() ?? { state: 'absent' });
}

/** The Notion stand-in: its own loopback origin, Notion's URL shape. */
export function notionUrl(page = '3f2b8b37e541802f96a1c557a6b01a44'): string {
    return `${BASE.replace('127.0.0.1', '127.0.0.2')}/p/test-workspace/tests-${page}`;
}

/** The words painted as findings with the CSS Highlight API (Notion has no marks in the DOM). */
export function painted(page: Page): Promise<string[]> {
    return page.evaluate(() => [...(CSS.highlights.get('lc-warning') ?? [])].map((r) => (r as Range).toString()));
}

/** Moves the real pointer onto the `nth` painted occurrence of `word`. */
export async function hoverPainted(page: Page, word: string, nth = 0): Promise<Locator> {
    const point = await page.evaluate(
        ([w, n]) => {
            const ranges = [...(CSS.highlights.get('lc-warning') ?? [])].filter((r) => (r as Range).toString() === w);
            const rect = (ranges[n] as Range | undefined)?.getBoundingClientRect();
            return rect === undefined ? undefined : { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        },
        [word, nth] as const,
    );
    if (point === undefined) throw new Error(`"${word}" #${String(nth)} is not painted`);
    await page.mouse.move(0, 0);
    await page.mouse.move(point.x, point.y);
    await expect(popover(page)).toBeVisible();
    return popover(page);
}

/** What the stand-in saved for `pageId` (the page in the path by default). */
export function notionSaved(page: Page, pageId?: string): Promise<string[]> {
    return page.evaluate((id) => (globalThis as any).__notion.saved(id), pageId);
}

export const PALETTE_FRAME = 'iframe[title="Language Check commands"]';

/** Runs a client command from the palette, as a user would: the binding, its title, Enter. */
export async function runPaletteCommand(page: Page, title: string): Promise<void> {
    await page.keyboard.press('Control+KeyP');
    const palette = page.frameLocator(PALETTE_FRAME);
    await expect(palette.locator('ninja-action').first()).toBeVisible();
    await page.keyboard.type(title);
    // Enter runs the first entry: wait until the filter has made it this one.
    await expect(palette.locator('ninja-action').first()).toContainText(title);
    await page.keyboard.press('Enter');
    await expect(page.locator(PALETTE_FRAME)).toHaveCount(0);
}

/** The open tabs showing a `viewType` panel (speedFix, inspector). */
export function panelPages(context: BrowserContext, viewType: string): Page[] {
    return context.pages().filter((p) => !p.isClosed() && new URL(p.url()).pathname === `/webview/${viewType}.html`);
}

/** Runs `title` from the palette and returns the `viewType` panel tab it opens. */
export async function openPanel(page: Page, title: string, viewType: string): Promise<Page> {
    const before = new Set(panelPages(page.context(), viewType));
    await runPaletteCommand(page, title);
    // Polled, not a `page` event: a new tab can still be about:blank when the event fires.
    let panel: Page | undefined;
    await expect.poll(() => (panel = panelPages(page.context(), viewType).find((p) => !before.has(p)))).toBeDefined();
    if (panel === undefined) throw new Error(`no ${viewType} panel opened`);
    await panel.waitForLoadState();
    return panel;
}

/** Uncaught errors in each tab the extension opened (panels), recorded from the tab's start. */
export const panelErrors = new WeakMap<Page, string[]>();

/** The native host's directory for a site's project (where its config and dictionary live). */
export function workspaceDir(dataHome: string, site: Site, project = 'p1'): string {
    return path.join(dataHome, 'language-check', 'web', `${site}-${project}`);
}

/** A fixture directory of the VS Code UI tests (extension/src/test/fixtures/<name>). */
export function uiFixture(name: string): string {
    return path.join(EXTENSION_ROOT, 'src/test/fixtures', name);
}

/**
 * Gives the project the VS Code UI fixture's config, so both hosts check
 * under the same settings. Before the page loads: the host reads it when
 * the workspace starts.
 */
export function seedWorkspace(dataHome: string, fixture: string, site: Site = 'overleaf', project = 'p1'): void {
    const config = path.join(uiFixture(fixture), '.languagecheck.yaml');
    if (!existsSync(config)) return;
    const dir = workspaceDir(dataHome, site, project);
    mkdirSync(dir, { recursive: true });
    copyFileSync(config, path.join(dir, '.languagecheck.yaml'));
}

/** Opens a VS Code UI fixture's document on the Overleaf stand-in, under that fixture's config, and waits for its findings. */
export async function openFixture(page: Page, dataHome: string, fixture: string, file: string): Promise<void> {
    seedWorkspace(dataHome, fixture);
    await page.goto(pageUrl('overleaf', 'current', readFileSync(path.join(uiFixture(fixture), file), 'utf8'), 'p1', file));
    await expect.poll(() => status(page)).toMatchObject({ state: 'attached', languageId: languageOf(file) });
    await expect(marks(page).first()).toBeVisible();
    await page.locator('.cm-content').click();
}

const languageOf = (file: string): string => ({ md: 'markdown', tex: 'latex', typ: 'typst' })[file.split('.').pop() ?? ''] ?? 'plaintext';

/** A way to stop the extension's service worker at once, as Chrome does when it is idle: set up ahead, so the stop lands where the test wants it. */
export async function backgroundStopper(page: Page): Promise<() => Promise<void>> {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('ServiceWorker.enable');
    return async () => {
        await cdp.send('ServiceWorker.stopAllWorkers');
        await cdp.detach();
    };
}

/** Stops the extension's service worker, as Chrome does when it is idle. */
export async function stopBackground(page: Page): Promise<void> {
    await (await backgroundStopper(page))();
}

/** The extension's config pages open in `context`. */
export const configPages = (context: BrowserContext): Page[] => context.pages().filter((p) => !p.isClosed() && new URL(p.url()).pathname === '/config.html');

/** The config page of the page's workspace, opened from the palette. */
export async function configPage(page: Page, context: BrowserContext): Promise<Page> {
    await runPaletteCommand(page, 'Edit Config');
    let config: Page | undefined;
    await expect.poll(() => (config = configPages(context)[0])).toBeDefined();
    if (config === undefined) throw new Error('no config page');
    await config.waitForLoadState();
    await expect(config.locator('.monaco-editor')).toBeVisible();
    return config;
}

/** Puts `text` in the config page's editor, as typing would (saved after the typing pause). */
export const setText = (config: Page, text: string) =>
    config.evaluate((t) => {
        (globalThis as any).__configEditor.setValue(t);
    }, text);

/**
 * `lines` lines of ordinary prose, each different, with a misspelling on
 * every `every`-th line (the last line included); with how many, and the
 * offset each starts at (ASCII: characters are bytes). `between` joins the
 * lines: a blank line makes each a paragraph, a prose range of its own.
 */
export function longProse(lines: number, every: number, between = '\n'): { text: string; misspelt: number; misspellings: number[] } {
    const out: string[] = [];
    const misspellings: number[] = [];
    let at = 0;
    for (let i = 1; i <= lines; i++) {
        const wrong = i % every === 0 || i === lines;
        const line = `Line ${String(i)} holds some ordinary words about the weather${wrong ? ' and recieve' : ''} in a sentence.`;
        if (wrong) misspellings.push(at + line.indexOf('recieve'));
        out.push(line);
        at += line.length + between.length;
    }
    return { text: out.join(between), misspelt: misspellings.length, misspellings };
}

/** Sets the checking options on the options page, as the user does. */
export async function setChecking(context: BrowserContext, extensionId: string, options: { progressive: boolean; windowKib: number; maxKib: number }): Promise<void> {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.locator('#progressive').setChecked(options.progressive);
    await page.locator('#window-kib').fill(String(options.windowKib));
    await page.locator('#max-kib').fill(String(options.maxKib));
    await page.getByRole('button', { name: 'Save checking options' }).click();
    await expect(page.locator('#checking-status')).toContainText('Saved');
    await page.close();
}
