// Soak: a page in use for a long time, with what everything holds sampled
// as it goes, to show whether anything grows with time rather than with the
// document. The work is a seeded mix of what a user does: type a sentence
// with a mistake and take it out again, switch between files (now and then
// to one never opened before), hover a finding, open and close the palette
// and a panel, and take in a collaborator's edit. The document returns to
// the same text after each step, so whatever grows grows with time alone.
//
// Each sample (page heap and DOM counts, the background's heap, the native
// host's and the server's RSS, open files and threads) is appended to
// .bench/soak-<time>.jsonl as it is taken; the growth per hour
// past the warm-up, a least-squares slope, goes to results.jsonl.
//
//     SOAK_MINUTES=60 pnpm run bench soak            # default 10
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { BENCH_CONFIG, latex, rng, seedFor } from '../../../extension/src/test/e2e/bench/corpus';
import { Recorder, type Unit } from '../../../extension/src/test/e2e/bench/measure';
import { expect, host, marks, openPanel, pageUrl, PALETTE_FRAME, popover, status, test, workspaceDir } from '../e2e/fixtures';
import { domCounts, heapMB, ourProcesses, stats, watchCheck, workerHeapMB } from './probe';

test.use({ devtools: true });

const MINUTES = Number(process.env.SOAK_MINUTES ?? 10);
const SAMPLE_EVERY_MS = Number(process.env.SOAK_SAMPLE_SECONDS ?? 30) * 1000;
/** Samples before this share of the run are warm-up (caches filling, code compiling) and left out of the slope. */
const WARM_UP = 0.25;
/** The background lets a page open ten tabs a minute: a panel every two minutes stays far inside that. */
const PANEL_EVERY_MS = 120_000;

interface Sample {
    readonly minutes: number;
    readonly pageMB: number;
    readonly workerMB: number;
    readonly nodes: number;
    readonly listeners: number;
    readonly hostMB: number;
    readonly hostFds: number;
    readonly hostThreads: number;
    readonly serverMB: number;
    readonly serverFds: number;
    readonly serverThreads: number;
    readonly checks: number;
    readonly documents: number;
    readonly pids: string;
}

/** Least-squares slope of `y` over `x`: $\beta = \frac{\sum (x_i - \bar{x})(y_i - \bar{y})}{\sum (x_i - \bar{x})^2}$. */
function slope(points: readonly (readonly [number, number])[]): number {
    const n = points.length;
    const meanX = points.reduce((sum, [x]) => sum + x, 0) / n;
    const meanY = points.reduce((sum, [, y]) => sum + y, 0) / n;
    const numerator = points.reduce((sum, [x, y]) => sum + (x - meanX) * (y - meanY), 0);
    const denominator = points.reduce((sum, [x]) => sum + (x - meanX) ** 2, 0);
    return denominator === 0 ? 0 : numerator / denominator;
}

async function sample(page: Page, dataHome: string, devtoolsPort: number, startedAt: number): Promise<Sample> {
    const dom = await domCounts(page);
    const processes = ourProcesses(dataHome);
    const now = await stats(page);
    return {
        minutes: (Date.now() - startedAt) / 60_000,
        pageMB: await heapMB(page),
        workerMB: await workerHeapMB(devtoolsPort),
        nodes: dom.nodes,
        listeners: dom.listeners,
        hostMB: processes.host?.rssMB ?? NaN,
        hostFds: processes.host?.fds ?? NaN,
        hostThreads: processes.host?.threads ?? NaN,
        serverMB: processes.server?.rssMB ?? NaN,
        serverFds: processes.server?.fds ?? NaN,
        serverThreads: processes.server?.threads ?? NaN,
        checks: now.checks,
        documents: now.documents,
        pids: `${String(processes.host?.pid)}/${String(processes.server?.pid)}`,
    };
}

const FILES = 5;
const fileText = (k: number): string => latex(seedFor('web soak file', k), 32_000);

test('a page in use for a long time holds no more at the end than once warmed up', async ({ page, dataHome, devtoolsPort }) => {
    test.setTimeout((MINUTES + 10) * 60_000);
    const dir = workspaceDir(dataHome, 'overleaf', 'soak');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, '.languagecheck.yaml'), BENCH_CONFIG);
    await page.goto(pageUrl('overleaf', 'current', 'Teh start.', 'soak'));
    await expect.poll(() => status(page)).toMatchObject({ state: 'attached' });

    const out = path.join(process.env.BENCH_OUT ?? '.bench', `soak-${new Date().toISOString().replaceAll(':', '-')}.jsonl`);
    mkdirSync(path.dirname(out), { recursive: true });
    const next = rng(seedFor('web soak', 1));
    const settle = async (act: () => Promise<unknown>): Promise<void> => {
        const settled = await watchCheck(page, { quietMs: 300 });
        await act();
        await settled();
    };
    let file = 0;
    let fresh = 0;
    let typed = 0;
    const open = (id: string, k: number): Promise<void> => settle(() => host(page, 'switchFile', id, 'main.tex', fileText(k)));
    await open('soak-0', 0);

    const actions: readonly { readonly weight: number; readonly run: () => Promise<void> }[] = [
        {
            // A sentence with a mistake, typed and taken out again.
            weight: 50,
            run: async () => {
                const sentence = ` Sentence ${String(++typed)} has a mistake to recieve.`;
                await settle(() => host(page, 'typeAtEnd', sentence));
                await settle(() => page.evaluate((length) => {
                    const { view } = (globalThis as unknown as { __host: { view: { state: { doc: { length: number } }; dispatch: (spec: object) => void } } }).__host;
                    const end = view.state.doc.length;
                    view.dispatch({ changes: { from: end - length, to: end }, userEvent: 'delete' });
                }, sentence.length));
            },
        },
        {
            // Another of the open files; one in five times, a file never opened before.
            weight: 20,
            run: async () => {
                file = (file + 1) % FILES;
                await open(next() < 0.2 ? `soak-fresh-${String(++fresh)}` : `soak-${String(file)}`, file);
            },
        },
        {
            // The card for the first finding in view.
            weight: 15,
            run: async () => {
                const first = marks(page).first();
                if (!(await first.isVisible())) return;
                await page.mouse.move(0, 0);
                await first.hover();
                await expect(popover(page)).toBeVisible();
                await page.mouse.move(0, 0);
                await expect(popover(page)).toBeHidden();
            },
        },
        {
            weight: 10,
            run: async () => {
                await page.keyboard.press('Alt+Shift+KeyP');
                await expect(page.frameLocator(PALETTE_FRAME).locator('ninja-action').first()).toBeVisible();
                await page.keyboard.press('Escape');
                await expect(page.locator(PALETTE_FRAME)).toHaveCount(0);
            },
        },
        {
            // A collaborator's line at the top, then its removal (also theirs).
            weight: 5,
            run: async () => {
                const line = 'A collaborator wrote this line with teh mistake.\n';
                await settle(() => host(page, 'remoteInsert', 0, line));
                await settle(() => page.evaluate((length) => {
                    const { view } = (globalThis as unknown as { __host: { view: { dispatch: (spec: object) => void } } }).__host;
                    view.dispatch({ changes: { from: 0, to: length }, userEvent: 'remote' });
                }, line.length));
            },
        },
    ];
    const total = actions.reduce((sum, action) => sum + action.weight, 0);
    const pick = (): (() => Promise<void>) => {
        let roll = next() * total;
        for (const action of actions) {
            roll -= action.weight;
            if (roll < 0) return action.run;
        }
        return actions[0]?.run ?? (() => Promise.resolve());
    };

    const startedAt = Date.now();
    const samples: Sample[] = [];
    const take = async (): Promise<void> => {
        const taken = await sample(page, dataHome, devtoolsPort, startedAt);
        samples.push(taken);
        appendFileSync(out, `${JSON.stringify(taken)}\n`);
    };
    await take();
    let sampledAt = Date.now();
    let panelAt = Date.now();
    let steps = 0;
    while (Date.now() - startedAt < MINUTES * 60_000) {
        // The page in front, the cursor in the editor: where a user's keys go.
        await page.bringToFront();
        await page.locator('.cm-content').click({ position: { x: 5, y: 5 } });
        await pick()();
        steps++;
        if (Date.now() - panelAt > PANEL_EVERY_MS) {
            const panel = await openPanel(page, 'Open SpeedFix', 'speedFix');
            await panel.locator('#app *').first().waitFor();
            await panel.close();
            panelAt = Date.now();
        }
        if (Date.now() - sampledAt <= SAMPLE_EVERY_MS) continue;
        await take();
        sampledAt = Date.now();
    }
    // The last sample on the file the first was taken on.
    await open('soak-0', 0);
    await take();
    // The page is still right after it all.
    await expect(marks(page).first()).toBeVisible();

    const recorder = new Recorder('web-soak');
    const settledSamples = samples.filter((s) => s.minutes >= MINUTES * WARM_UP);
    const detail = `${String(MINUTES)} min, ${String(steps)} steps, ${String(samples.length)} samples, ${path.basename(out)}`;
    const perHour = (pick_: (s: Sample) => number): number => slope(settledSamples.map((s) => [s.minutes / 60, pick_(s)] as const));
    const series: readonly { readonly metric: string; readonly unit: Unit; readonly of: (s: Sample) => number; readonly ceiling: number }[] = [
        { metric: 'page heap growth per hour', unit: 'MiB', of: (s) => s.pageMB, ceiling: 8 },
        { metric: 'background heap growth per hour', unit: 'MiB', of: (s) => s.workerMB, ceiling: 4 },
        { metric: 'native host RSS growth per hour', unit: 'MiB', of: (s) => s.hostMB, ceiling: 8 },
        { metric: 'core server RSS growth per hour', unit: 'MiB', of: (s) => s.serverMB, ceiling: 64 },
        { metric: 'DOM nodes growth per hour', unit: 'count', of: (s) => s.nodes, ceiling: 500 },
        { metric: 'event listeners growth per hour', unit: 'count', of: (s) => s.listeners, ceiling: 50 },
        { metric: 'native host open files growth per hour', unit: 'count', of: (s) => s.hostFds, ceiling: 1 },
        { metric: 'core server open files growth per hour', unit: 'count', of: (s) => s.serverFds, ceiling: 2 },
        { metric: 'core server threads growth per hour', unit: 'count', of: (s) => s.serverThreads, ceiling: 1 },
    ];
    for (const { metric, unit, of, ceiling } of series) recorder.record({ subject: 'soak', metric, unit, samples: [perHour(of)], ceiling, detail });
    const first = samples[0];
    const last = samples.at(-1);
    console.info(`\n${recorder.table()}\nfirst: ${JSON.stringify(first)}\nlast:  ${JSON.stringify(last)}\n`);
    expect(settledSamples.length, 'enough samples past the warm-up for a slope').toBeGreaterThanOrEqual(3);
    // The same processes throughout: none died and was started again.
    expect(new Set(samples.map((s) => s.pids))).toEqual(new Set([first?.pids]));
    expect(last?.documents).toBe(1);
    recorder.gate();
});
