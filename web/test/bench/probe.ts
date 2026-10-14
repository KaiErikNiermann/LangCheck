// What the benchmarks and memory tests read off a running extension: the
// page's heap and DOM counters, the service worker's heap, the native host's
// and core server's memory, and how long a check took to settle in the page
// with how long it held the page's main thread.
import { appendFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

const MIB = 1024 * 1024;

/** The page's JS heap after forced collections, in MiB (Chromium, through the DevTools protocol). */
export async function heapMB(page: Page): Promise<number> {
    const cdp = await page.context().newCDPSession(page);
    try {
        // Twice: the first collection can leave what only it made unreachable.
        await cdp.send('HeapProfiler.collectGarbage');
        await cdp.send('HeapProfiler.collectGarbage');
        const { usedSize } = await cdp.send('Runtime.getHeapUsage');
        return usedSize / MIB;
    } finally {
        await cdp.detach();
    }
}

export interface DomCounts {
    readonly nodes: number;
    readonly listeners: number;
}

/** Live DOM nodes and JS event listeners in the page's renderer, after forced collections. */
export async function domCounts(page: Page): Promise<DomCounts> {
    const cdp = await page.context().newCDPSession(page);
    try {
        await cdp.send('HeapProfiler.collectGarbage');
        const counters = await cdp.send('Memory.getDOMCounters');
        return { nodes: counters.nodes, listeners: counters.jsEventListeners };
    } finally {
        await cdp.detach();
    }
}

/**
 * Appends one line of figures to .bench/scale.jsonl, as the e2e scale and
 * memory tests keep them: not under test-results/, which Playwright empties
 * at the start of every run.
 */
export function record(name: string, figures: Record<string, number | string | string[]>): void {
    mkdirSync('.bench', { recursive: true });
    appendFileSync('.bench/scale.jsonl', `${JSON.stringify({ at: new Date().toISOString(), name, ...figures })}\n`);
}

/**
 * Sends one DevTools command to `target` over its own WebSocket and returns
 * the result. For what Playwright cannot attach to: the extension's service
 * worker. Needs the browser's DevTools port (fixture option `devtools`).
 */
async function devtoolsCommands(url: string, commands: readonly { method: string; params?: object }[]): Promise<unknown[]> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
        socket.addEventListener('open', () => {
            resolve();
        });
        socket.addEventListener('error', () => {
            reject(new Error(`DevTools socket ${url} did not open`));
        });
    });
    try {
        const results: unknown[] = [];
        for (const [index, command] of commands.entries()) {
            const answer = new Promise<unknown>((resolve, reject) => {
                const onMessage = (event: MessageEvent): void => {
                    const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string } };
                    if (message.id !== index) return;
                    socket.removeEventListener('message', onMessage);
                    if (message.error === undefined) resolve(message.result);
                    else reject(new Error(`${command.method}: ${message.error.message}`));
                };
                socket.addEventListener('message', onMessage);
            });
            socket.send(JSON.stringify({ id: index, method: command.method, params: command.params ?? {} }));
            results.push(await answer);
        }
        return results;
    } finally {
        socket.close();
    }
}

/** The extension's service worker's JS heap after forced collections, in MiB. */
export async function workerHeapMB(devtoolsPort: number): Promise<number> {
    const listing = await fetch(`http://127.0.0.1:${String(devtoolsPort)}/json/list`);
    const targets = (await listing.json()) as { type: string; url: string; webSocketDebuggerUrl: string }[];
    const worker = targets.find((target) => target.type === 'service_worker' && target.url.startsWith('chrome-extension://'));
    if (worker === undefined) throw new Error('no extension service worker among the DevTools targets');
    const results = await devtoolsCommands(worker.webSocketDebuggerUrl, [
        { method: 'HeapProfiler.collectGarbage' },
        { method: 'HeapProfiler.collectGarbage' },
        { method: 'Runtime.getHeapUsage' },
    ]);
    return (results[2] as { usedSize: number }).usedSize / MIB;
}

/** One of our processes, as Linux reports it. */
export interface ProcessFigures {
    readonly pid: number;
    /** Resident now, and the most it has been, in MiB. */
    readonly rssMB: number;
    readonly peakMB: number;
    readonly fds: number;
    readonly threads: number;
}

const OURS = ['language-check-native-host', 'language-check-server'] as const;
export type OurProcess = 'host' | 'server';

/** `/proc/<pid>/status` fields, in kB where they are sizes. */
function status(pid: number): Map<string, string> {
    const fields = new Map<string, string>();
    for (const line of readFileSync(`/proc/${String(pid)}/status`, 'utf8').split('\n')) {
        const at = line.indexOf(':');
        if (at > 0) fields.set(line.slice(0, at), line.slice(at + 1).trim());
    }
    return fields;
}

/** A `/proc` size field ("1234 kB") in MiB. */
const kB = (value = '0 kB'): number => Number(value.split(' ', 1)[0]) / 1024;

/**
 * The native host and core server one test's browser started: told apart
 * from every other run's by the data directory each inherits
 * (XDG_DATA_HOME), which the test made for itself. Linux only.
 */
export function ourProcesses(dataHome: string): Partial<Record<OurProcess, ProcessFigures>> {
    const found: Partial<Record<OurProcess, ProcessFigures>> = {};
    for (const entry of readdirSync('/proc')) {
        const pid = Number(entry);
        if (!Number.isSafeInteger(pid)) continue;
        try {
            // comm is cut at 15 characters ("language-check-" for both), so the
            // executable's path tells them apart.
            const exe = readFileSync(`/proc/${entry}/cmdline`, 'utf8').split('\0', 1)[0] ?? '';
            const which = OURS.findIndex((name) => exe.endsWith(name));
            if (which === -1 || !readFileSync(`/proc/${entry}/environ`, 'utf8').split('\0').includes(`XDG_DATA_HOME=${dataHome}`)) continue;
            const fields = status(pid);
            found[which === 0 ? 'host' : 'server'] = {
                pid,
                rssMB: kB(fields.get('VmRSS')),
                peakMB: kB(fields.get('VmHWM')),
                fds: readdirSync(`/proc/${entry}/fd`).length,
                threads: Number(fields.get('Threads') ?? 0),
            };
        } catch {
            // Gone between the listing and the read, or not ours to read.
        }
    }
    return found;
}

/** The page's stats handle, as the tests read it. */
export interface Stats {
    readonly checks: number;
    readonly findings: number;
    readonly documents: number;
}

export const stats = (page: Page): Promise<Stats> => page.evaluate(() => (globalThis as unknown as { __languageCheck: { stats: () => Stats } }).__languageCheck.stats());

/** How a check went, seen from the page. */
export interface Settled {
    /** From the start of the wait to the first check that finished (a progressive check's first window). */
    readonly firstMs: number;
    /** To the last change in checks or findings before `quietMs` without one. */
    readonly settledMs: number;
    readonly findings: number;
    /** The page's main thread held for longer than 50 ms: how often, the longest, and the time past 50 ms in all (total blocking time). */
    readonly longTasks: number;
    readonly longestTaskMs: number;
    readonly blockingMs: number;
}

/**
 * Starts watching the page for a check: call before what starts it, then
 * await the returned function. Watching runs in the page (a 10 ms poll of
 * the stats, and Chromium's long-task observer), so the times are the page's
 * own, not the test's round trips.
 */
export async function watchCheck(page: Page, options: { quietMs?: number; timeoutMs?: number } = {}): Promise<() => Promise<Settled>> {
    const { quietMs = 1500, timeoutMs = 300_000 } = options;
    await page.evaluate(() => {
        const read = (): Stats => (globalThis as unknown as { __languageCheck: { stats: () => Stats } }).__languageCheck.stats();
        const tasks: number[] = [];
        const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) tasks.push(entry.duration);
        });
        observer.observe({ type: 'longtask' });
        const start = performance.now();
        const before = read();
        const watch = { start, before, last: before, firstAt: -1, lastAt: start, tasks, observer };
        const timer = setInterval(() => {
            const now = read();
            if (now.checks > watch.before.checks && watch.firstAt < 0) watch.firstAt = performance.now();
            if (now.findings !== watch.last.findings || now.checks !== watch.last.checks) watch.lastAt = performance.now();
            watch.last = now;
        }, 10);
        Object.assign(globalThis, { __benchWatch: { watch, timer } });
    });
    return async () => {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
            const done = await page.evaluate((quiet) => {
                const { watch } = (globalThis as unknown as { __benchWatch: { watch: { before: Stats; last: Stats; lastAt: number } } }).__benchWatch;
                return watch.last.checks > watch.before.checks && performance.now() - watch.lastAt >= quiet;
            }, quietMs);
            if (done) break;
            if (Date.now() > deadline) throw new Error(`no check settled within ${String(timeoutMs)} ms`);
            await page.waitForTimeout(100);
        }
        return page.evaluate(() => {
            const { watch, timer } = (globalThis as unknown as {
                __benchWatch: { watch: { start: number; last: Stats; firstAt: number; lastAt: number; tasks: number[]; observer: PerformanceObserver }; timer: number };
            }).__benchWatch;
            clearInterval(timer);
            watch.observer.disconnect();
            return {
                firstMs: (watch.firstAt < 0 ? watch.lastAt : watch.firstAt) - watch.start,
                settledMs: watch.lastAt - watch.start,
                findings: watch.last.findings,
                longTasks: watch.tasks.length,
                longestTaskMs: Math.max(0, ...watch.tasks),
                blockingMs: watch.tasks.reduce((sum, ms) => sum + Math.max(0, ms - 50), 0),
            };
        });
    };
}
