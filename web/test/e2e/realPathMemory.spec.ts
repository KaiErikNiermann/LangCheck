// Memory: what the page holds returns to where it was after work that
// should leave nothing behind (re-checks, panels opened and closed, file
// switches), and the background lets go of what closed tabs made. Heap
// sizes are read after forced collections, through the DevTools protocol.
// Figures go to test-results/scale.jsonl with the scale tests'.
import { appendFileSync, mkdirSync } from 'node:fs';
import type { BrowserContext, Page } from '@playwright/test';
import { expect, host, marks, openPanel, pageUrl, status, test } from './fixtures';

const MB = 1024 * 1024;

async function heapMB(page: Page): Promise<number> {
    const cdp = await page.context().newCDPSession(page);
    try {
        // Twice: the first collection can leave what only it made unreachable.
        await cdp.send('HeapProfiler.collectGarbage');
        await cdp.send('HeapProfiler.collectGarbage');
        const { usedSize } = await cdp.send('Runtime.getHeapUsage');
        return usedSize / MB;
    } finally {
        await cdp.detach();
    }
}

function record(name: string, figures: Record<string, number | string[]>): void {
    mkdirSync('test-results', { recursive: true });
    appendFileSync('test-results/scale.jsonl', `${JSON.stringify({ at: new Date().toISOString(), name, ...figures })}\n`);
}

/**
 * Live objects, by their heap id (stable for an object's life) and kind
 * (`type:name` in the heap snapshot), after forced collections.
 */
async function census(page: Page): Promise<Map<number, string>> {
    const cdp = await page.context().newCDPSession(page);
    try {
        // The browser keeps console messages (bounded) for DevTools; they are
        // the page's log lines, not what the extension holds.
        await cdp.send('Runtime.discardConsoleEntries');
        await cdp.send('HeapProfiler.collectGarbage');
        await cdp.send('HeapProfiler.collectGarbage');
        const chunks: string[] = [];
        cdp.on('HeapProfiler.addHeapSnapshotChunk', (event) => {
            chunks.push(event.chunk);
        });
        await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
        const snapshot = JSON.parse(chunks.join('')) as {
            snapshot: { meta: { node_fields: string[]; node_types: [string[]] } };
            nodes: number[];
            strings: string[];
        };
        const fields = snapshot.snapshot.meta.node_fields;
        const types = snapshot.snapshot.meta.node_types[0];
        const [typeAt, nameAt, idAt] = [fields.indexOf('type'), fields.indexOf('name'), fields.indexOf('id')];
        const objects = new Map<number, string>();
        for (let i = 0; i < snapshot.nodes.length; i += fields.length) {
            const kind = `${types[snapshot.nodes[i + typeAt] ?? 0] ?? '?'}:${(snapshot.strings[snapshot.nodes[i + nameAt] ?? 0] ?? '').slice(0, 60)}`;
            objects.set(snapshot.nodes[i + idAt] ?? 0, kind);
        }
        return objects;
    } finally {
        await cdp.detach();
    }
}

/**
 * Kinds of object that are not the engine's own: compiled code and hidden
 * classes warm up and settle, closure scopes are named by heap address,
 * and the browser keeps a bounded timeline of layout shifts.
 */
const NOT_OURS = /^(?:code|object shape|hidden):|^native:system \/|^object:system \/ Context|LayoutShift|DOMRectReadOnly/u;

/**
 * Runs two equal windows of `cycle`. A cache or warm-up fills in the first
 * and holds still in the second; a leak grows in both, so the kinds that
 * grew by a whole object or more a cycle in the second window, with objects
 * made in it still alive, are reported.
 */
async function twoWindows(page: Page, cycles: number, cycle: (i: number) => Promise<void>): Promise<{ heap: Record<string, number>; growing: string[]; top: string[] }> {
    const baselineMB = await heapMB(page);
    for (let i = 0; i < cycles; i++) await cycle(i);
    const firstMB = await heapMB(page);
    const first = await census(page);
    for (let i = 0; i < cycles; i++) await cycle(cycles + i);
    const second = await census(page);
    const secondMB = await heapMB(page);
    // A leak needs both: objects made in the window still alive after it,
    // and more of their kind than before. Either alone misleads: V8 can file
    // an existing object under another name (a total grows, nothing new
    // survives), and the browser rebuilds style objects (new ones survive,
    // old ones go, the total holds).
    const totals = (objects: Map<number, string>): Map<string, number> => {
        const out = new Map<string, number>();
        for (const kind of objects.values()) out.set(kind, (out.get(kind) ?? 0) + 1);
        return out;
    };
    const [before, after] = [totals(first), totals(second)];
    const survivors = new Map<string, number>();
    for (const [id, kind] of second) if (!first.has(id) && !NOT_OURS.test(kind)) survivors.set(kind, (survivors.get(kind) ?? 0) + 1);
    const candidates = [...survivors]
        .map(([kind, survived]) => ({ kind, survived, grew: (after.get(kind) ?? 0) - (before.get(kind) ?? 0) }))
        .toSorted((x, y) => y.grew - x.grew);
    const growing = candidates.filter(({ survived, grew }) => survived >= cycles && grew >= cycles).map(({ kind, grew }) => `${kind} +${String(grew)}`);
    return { heap: { baselineMB, firstMB, secondMB }, growing, top: candidates.slice(0, 8).map(({ kind, survived, grew }) => `${kind} survived ${String(survived)} grew ${String(grew)}`) };
}

const checks = (page: Page): Promise<number> => page.evaluate(() => (globalThis as any).__languageCheck.stats().checks as number);

/** Panels the background holds (test builds expose its counts). */
const backgroundPanels = (context: BrowserContext): Promise<number> => {
    const worker = context.serviceWorkers()[0];
    if (worker === undefined) throw new Error('no background worker');
    return worker.evaluate(() => (globalThis as any).__lcBackground.panels() as number);
};

/** Swaps the document's last character, keeping its length, and waits for the check that follows. */
async function recheck(page: Page, i: number): Promise<void> {
    const before = await checks(page);
    await page.evaluate((odd) => {
        const { view } = (globalThis as any).__host;
        const end = view.state.doc.length;
        view.dispatch({ changes: { from: end - 1, to: end, insert: odd ? '!' : '.' }, userEvent: 'input.type' });
    }, i % 2 === 1);
    await expect.poll(() => checks(page)).toBeGreaterThan(before);
}

async function ready(page: Page): Promise<void> {
    await page.goto(pageUrl('overleaf', 'current', 'Teh cat will recieve the parcel seperately.'));
    await expect.poll(() => status(page)).toMatchObject({ state: 'attached' });
    await expect(marks(page)).toHaveText(['Teh', 'recieve', 'seperately']);
}

test('re-checking leaves the page heap where it was', async ({ page }) => {
    test.setTimeout(150_000);
    await ready(page);
    for (let i = 0; i < 10; i++) await recheck(page, i);
    const { heap, growing, top } = await twoWindows(page, 30, (i) => recheck(page, i));
    record('memory-rechecks', { cyclesPerWindow: 30, ...heap, top });
    await expect(marks(page)).toHaveText(['Teh', 'recieve', 'seperately']);
    expect(growing).toEqual([]);
});

test('opening and closing the panels leaves the page heap where it was, and the background holds no panel', async ({ page, context }) => {
    await ready(page);
    const cycle = async (title: string, viewType: string): Promise<void> => {
        await page.bringToFront();
        await page.locator('.cm-content').click();
        const panel = await openPanel(page, title, viewType);
        await panel.locator('#app *').first().waitFor();
        await panel.close();
        await expect.poll(() => backgroundPanels(context)).toBe(0);
        // And the page has heard: its side of the panel is gone too.
        await expect.poll(() => page.evaluate(() => (globalThis as any).__languageCheck.stats().panels as number)).toBe(0);
    };
    await cycle('Open SpeedFix', 'speedFix');
    await cycle('Open Inspector', 'inspector');
    // Ten opens in all: the background allows a page no more a minute.
    const { heap, growing, top } = await twoWindows(page, 4, (i) => (i % 2 === 0 ? cycle('Open SpeedFix', 'speedFix') : cycle('Open Inspector', 'inspector')));
    record('memory-panels', { cyclesPerWindow: 4, ...heap, top });
    expect(await backgroundPanels(context)).toBe(0);
    expect(growing).toEqual([]);
});

test('switching files leaves the page heap where it was', async ({ page }) => {
    await ready(page);
    const texts = ['Teh one.', 'Recieve two.', 'Seperately three.'];
    const switchTo = async (i: number): Promise<void> => {
        const text = texts[i % texts.length] ?? '';
        await host(page, 'switchFile', `doc-${String(i % texts.length)}`, 'main.tex', text);
        await expect(marks(page)).toHaveText([text.split(' ', 1)[0] ?? '']);
    };
    for (let i = 0; i < 6; i++) await switchTo(i);
    const { heap, growing, top } = await twoWindows(page, 45, switchTo);
    record('memory-file-switches', { cyclesPerWindow: 45, ...heap, top });
    expect(growing).toEqual([]);
});
