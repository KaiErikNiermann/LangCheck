// Memory at the edges: what each part of the path holds at its peak for a
// document at the size cap, one with nothing but findings, one long line,
// deep nesting, a million blank lines, and text no editor should have to
// hold (lone surrogates, NULs, lone CRs). Each case gets its own browser,
// native host and core server, so each process's peak (VmHWM) is that
// case's alone. After each, the page goes back to a small file: what the
// page and the background still hold then must be about what they held
// before, and both processes must be the ones that started (nothing
// crashed and was restarted under the test).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { BENCH_CONFIG, latex, longLine, oddCharacters, seedFor, typosOnly } from '../../../extension/src/test/e2e/bench/corpus';
import { Recorder } from '../../../extension/src/test/e2e/bench/measure';
import { expect, host, marks, pageUrl, status, test, workspaceDir } from '../e2e/fixtures';
import { domCounts, heapMB, ourProcesses, watchCheck, workerHeapMB, type ProcessFigures } from './probe';

test.use({ devtools: true });

/** The page protocol's cap (MAX_CHECK_TEXT_CHARS in src/messaging/protocol.ts). */
const CAP_CHARS = 2 * 1024 * 1024;

/** Prose with what no editor should have to hold strewn through it: lone surrogates, NULs, lone CRs, a BOM mid-text. */
function hostileText(seed: number, chars: number): string {
    const oddities = ['\u{D800}', '\u{DFFF}', '\0', '\r', '\u{FEFF}', '\u{DBFF}\u{DBFF}', '\0\0\r\r'];
    const prose = latex(seed, chars);
    const out: string[] = [];
    for (let at = 0, i = 0; at < prose.length; at += 97, i++) out.push(prose.slice(at, at + 97), oddities[i % oddities.length] ?? '');
    return out.join('');
}

interface EdgeCase {
    readonly subject: string;
    readonly file: string;
    readonly make: (seed: number) => string;
    /** Ceilings, in MiB: the server's and the native host's peak, and the page's heap holding the document. */
    readonly ceilings: { readonly server: number; readonly host: number; readonly page: number };
}

/**
 * Measured 2026-10-14 (release core, Chromium 147), server / host / page peak
 * in MiB: at the cap 349 / 28 / 36; misspellings only 306 / 68 / 75 (82 683
 * findings); one 1 MB line 264 / 18 / 20; a million blank lines 153 / 10 /
 * 19; unclosed commands 210 / 9 / 8; odd characters 306 / 17 / 22. What the
 * page and the background kept after was under 1 MiB in every case.
 */
const CASES: readonly EdgeCase[] = [
    { subject: 'latex at the size cap', file: 'main.tex', make: (s) => latex(s, CAP_CHARS - 100_000), ceilings: { server: 2048, host: 256, page: 512 } },
    { subject: 'misspellings only 512 KB', file: 'main.tex', make: (s) => typosOnly(s, 512_000), ceilings: { server: 2048, host: 256, page: 1024 } },
    { subject: 'one 1 MB line', file: 'main.tex', make: (s) => longLine(s, 1_000_000), ceilings: { server: 2048, host: 256, page: 512 } },
    { subject: 'a million blank lines', file: 'main.tex', make: () => `${'\n'.repeat(1_000_000)}Teh end.`, ceilings: { server: 1024, host: 256, page: 512 } },
    { subject: String.raw`100 000 unclosed \textbf{`, file: 'main.tex', make: (s) => String.raw`\textbf{`.repeat(100_000) + latex(s, 4000), ceilings: { server: 1024, host: 256, page: 512 } },
    { subject: 'odd characters 1 MB', file: 'notes.md', make: (s) => oddCharacters(s, 1_000_000), ceilings: { server: 2048, host: 256, page: 512 } },
    { subject: 'lone surrogates, NULs and CRs 256 KB', file: 'main.tex', make: (s) => hostileText(s, 256_000), ceilings: { server: 1024, host: 256, page: 512 } },
];

const recorder = new Recorder('web-memory');

test.afterAll(() => {
    console.info(`\n${recorder.table()}\n`);
});

async function ready(page: Page, dataHome: string, project: string): Promise<void> {
    const dir = workspaceDir(dataHome, 'overleaf', project);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, '.languagecheck.yaml'), BENCH_CONFIG);
    await page.goto(pageUrl('overleaf', 'current', 'Teh start.', project));
    await expect.poll(() => status(page)).toMatchObject({ state: 'attached' });
    await expect(marks(page)).toHaveText(['Teh']);
}

const MB = (figures: ProcessFigures | undefined): number => figures?.peakMB ?? NaN;

for (const c of CASES) {
    test(c.subject, async ({ page, dataHome, devtoolsPort }) => {
        await ready(page, dataHome, 'edge');
        const before = { page: await heapMB(page), worker: await workerHeapMB(devtoolsPort), processes: ourProcesses(dataHome) };
        const text = c.make(seedFor(`web memory ${c.subject}`, 1));
        expect(text.length, 'the case fits under the cap').toBeLessThan(CAP_CHARS);

        const settled = await watchCheck(page, { quietMs: 3000 });
        await host(page, 'switchFile', 'edge-doc', c.file, text);
        const check = await settled();
        const holding = { page: await heapMB(page), worker: await workerHeapMB(devtoolsPort), dom: await domCounts(page) };
        const peak = ourProcesses(dataHome);

        // Still answering: an edit gets its check.
        const edited = await watchCheck(page);
        await host(page, 'typeAtEnd', ' Teh last word.');
        await edited();

        // Back to a small file: the big one's text and findings let go.
        const rested = await watchCheck(page);
        await host(page, 'switchFile', 'edge-rest', 'main.tex', 'Teh rest.');
        await rested();
        const after = { page: await heapMB(page), worker: await workerHeapMB(devtoolsPort), processes: ourProcesses(dataHome) };

        const detail = `${String(text.length)} chars, ${String(check.findings)} findings, ${String(holding.dom.nodes)} DOM nodes`;
        recorder.record({ subject: c.subject, metric: 'open + cold check', samples: [check.settledMs], ceiling: 300_000, detail });
        recorder.record({ subject: c.subject, metric: 'main thread held (TBT)', samples: [check.blockingMs], ceiling: 30_000, detail });
        recorder.record({ subject: c.subject, metric: 'core server peak RSS', unit: 'MiB', samples: [MB(peak.server)], ceiling: c.ceilings.server, detail });
        recorder.record({ subject: c.subject, metric: 'native host peak RSS', unit: 'MiB', samples: [MB(peak.host)], ceiling: c.ceilings.host, detail });
        recorder.record({ subject: c.subject, metric: 'page heap holding it', unit: 'MiB', samples: [holding.page], ceiling: c.ceilings.page, detail });
        recorder.record({ subject: c.subject, metric: 'background heap holding it', unit: 'MiB', samples: [holding.worker], ceiling: 128, detail });
        recorder.record({ subject: c.subject, metric: 'page heap kept after', unit: 'MiB', samples: [after.page - before.page], ceiling: 8, detail });
        recorder.record({ subject: c.subject, metric: 'background heap kept after', unit: 'MiB', samples: [after.worker - before.worker], ceiling: 8, detail });

        // Nothing died and came back under the test.
        expect(after.processes.host?.pid, 'the native host is the one that started').toBe(before.processes.host?.pid);
        expect(after.processes.server?.pid, 'the core server is the one that started').toBe(before.processes.server?.pid);
        // CodeMirror draws only what is near the view: the page's DOM does not grow with the document.
        expect(holding.dom.nodes).toBeLessThan(20_000);
    });
}

test('a document over the cap is not sent: no process grows for it', async ({ page, dataHome }) => {
    await ready(page, dataHome, 'over');
    const before = ourProcesses(dataHome);
    await host(page, 'switchFile', 'over-doc', 'main.tex', latex(seedFor('web memory over cap', 1), CAP_CHARS + 400_000));
    await expect(page.locator('.lc-toast')).toContainText('too long for LangCheck to check');
    const after = ourProcesses(dataHome);
    recorder.record({ subject: 'latex over the cap', metric: 'native host RSS growth', unit: 'MiB', samples: [(after.host?.rssMB ?? 0) - (before.host?.rssMB ?? 0)], ceiling: 4 });
    recorder.record({ subject: 'latex over the cap', metric: 'core server RSS growth', unit: 'MiB', samples: [(after.server?.rssMB ?? 0) - (before.server?.rssMB ?? 0)], ceiling: 16 });
    expect(after.host?.pid).toBe(before.host?.pid);
});

test('every figure is within its ceiling', () => {
    recorder.gate();
});
