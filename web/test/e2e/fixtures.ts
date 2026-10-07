// A Chromium with the extension's test build loaded and the real native
// host registered in its profile, so every test drives the whole path:
// page world, content script, background, native host, core server.
// Each test gets its own profile and its own data directory (where the
// host keeps workspaces and dictionaries).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, expect, test as base, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { RUST_CORE, WEB } from './globalSetup';

export const BASE = 'http://127.0.0.1:4180';
export const EXTENSION = path.join(WEB, 'dist-test');
export const HOST_BINARY = path.join(RUST_CORE, 'target/debug/language-check-native-host');

export type Site = 'overleaf' | 'typst';
export type Cm = 'current' | '6.38';

/** The stand-in page for `site`: Overleaf on 127.0.0.1, Typst on localhost. */
export function pageUrl(site: Site, cm: Cm, text?: string, project = 'p1'): string {
    const origin = site === 'overleaf' ? BASE : BASE.replace('127.0.0.1', 'localhost');
    const query = new URLSearchParams({ cm, ...(text !== undefined && { text }) });
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

export function notionSaved(page: Page): Promise<string[]> {
    return page.evaluate(() => (globalThis as any).__notion.saved());
}
