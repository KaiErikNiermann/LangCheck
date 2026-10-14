// How long a document takes to check in the browser, through the whole
// path (page, content script, background, native host, release core), for
// ordinary and pathological documents on the Overleaf and Typst stand-ins:
// the web side of extension/src/test/e2e/bench/documents.bench.ts, on its
// corpus and its recorder (results.jsonl, a table, ceilings).
//
// Each repetition opens text the core has never seen (a cold check), then
// opens the same text as another file (the core answers from its cache),
// then types a sentence at its end (the check an edit makes). Beside the
// times: how long the page's main thread was held while it drew the
// findings, and what the page, the background and the two processes hold
// once it settles.
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import {
    BENCH_CONFIG, latex, longLine, malformedLatex, mixedLanguages, oddCharacters, seedFor, typosOnly, typst,
} from '../../../extension/src/test/e2e/bench/corpus';
import { REPS, Recorder } from '../../../extension/src/test/e2e/bench/measure';
import { expect, host, pageUrl, setChecking, status, test, workspaceDir, type Site } from '../e2e/fixtures';
import { heapMB, ourProcesses, watchCheck, workerHeapMB, type Settled } from './probe';

test.use({ devtools: true });

interface DocumentCase {
    readonly subject: string;
    readonly site: Site;
    /** The open file's name: its extension is the language on Overleaf. */
    readonly file: string;
    readonly make: (seed: number) => string;
    /** Medians past these are broken, not slow (see measure.ts): cold settle, cached settle, edit settle, main thread held by the cold check. */
    readonly ceilings: { readonly cold: number; readonly cached: number; readonly edit: number; readonly blocking: number };
}

/**
 * Ceilings are about ten times the medians measured on 2026-10-14 (Ryzen 9
 * 9900X3D, release core, Chromium 147; in the comments: cold, cached, edit,
 * main thread held), far enough above them that a busy machine does not trip
 * one. Every small case pays the client's 500 ms typing pause on an edit.
 * The 1 MB cached ceilings are tighter on purpose: 4 s is under what a
 * result cache too small for the document cost (4.8 s, e7d6b58).
 */
const CASES: readonly DocumentCase[] = [
    // 482 ms, 396 ms, 513 ms, 0 ms.
    { subject: 'latex 4 KB', site: 'overleaf', file: 'main.tex', make: (s) => latex(s, 4000), ceilings: { cold: 5000, cached: 5000, edit: 5000, blocking: 500 } },
    // 3.6 s, 478 ms, 736 ms, 0 ms.
    { subject: 'latex 256 KB', site: 'overleaf', file: 'main.tex', make: (s) => latex(s, 256_000), ceilings: { cold: 40_000, cached: 5000, edit: 8000, blocking: 1000 } },
    // 13.1 s, 411 ms, 1.37 s, 24 ms: Harper at one finding per 76 bytes, and a
    // full LaTeX parse (685 ms a megabyte) for each edit.
    { subject: 'latex 1 MB', site: 'overleaf', file: 'main.tex', make: (s) => latex(s, 1_000_000), ceilings: { cold: 150_000, cached: 4000, edit: 15_000, blocking: 1000 } },
    // 466 ms, 371 ms, 512 ms, 0 ms.
    { subject: 'typst 4 KB', site: 'typst', file: 'main.typ', make: (s) => typst(s, 4000), ceilings: { cold: 5000, cached: 5000, edit: 5000, blocking: 500 } },
    // 3.7 s, 308 ms, 627 ms, 0 ms.
    { subject: 'typst 256 KB', site: 'typst', file: 'main.typ', make: (s) => typst(s, 256_000), ceilings: { cold: 40_000, cached: 5000, edit: 8000, blocking: 1000 } },
    // 13.3 s, 493 ms, 952 ms, 29 ms. 10 026 prose ranges.
    { subject: 'typst 1 MB', site: 'typst', file: 'main.typ', make: (s) => typst(s, 1_000_000), ceilings: { cold: 150_000, cached: 4000, edit: 10_000, blocking: 1000 } },
    // 3.8 s, 331 ms, 752 ms, 0 ms.
    { subject: 'one 256 KB line', site: 'overleaf', file: 'main.tex', make: (s) => longLine(s, 256_000), ceilings: { cold: 40_000, cached: 5000, edit: 8000, blocking: 1000 } },
    // 1.0 s, 502 ms, 640 ms, 7 ms, for 10 267 findings.
    { subject: 'misspellings only 64 KB', site: 'overleaf', file: 'main.tex', make: (s) => typosOnly(s, 64_000), ceilings: { cold: 15_000, cached: 5000, edit: 8000, blocking: 1000 } },
    // 550 ms, 345 ms, 525 ms, 0 ms.
    { subject: 'malformed tex', site: 'overleaf', file: 'main.tex', make: malformedLatex, ceilings: { cold: 5000, cached: 5000, edit: 5000, blocking: 500 } },
    // 909 ms, 498 ms, 553 ms, 0 ms.
    { subject: 'mixed languages 64 KB', site: 'overleaf', file: 'notes.md', make: (s) => mixedLanguages(s, 64_000), ceilings: { cold: 10_000, cached: 5000, edit: 5000, blocking: 500 } },
    // 1.26 s, 135 ms, 538 ms, 0 ms.
    { subject: 'odd characters 64 KB', site: 'overleaf', file: 'notes.md', make: (s) => oddCharacters(s, 64_000), ceilings: { cold: 15_000, cached: 5000, edit: 5000, blocking: 500 } },
];

/** Gives the project the benchmarks' config (Harper only, nothing on the network) before its page loads. */
function seedConfig(dataHome: string, site: Site, project: string): void {
    const dir = workspaceDir(dataHome, site, project);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, '.languagecheck.yaml'), BENCH_CONFIG);
}

async function openSite(page: Page, dataHome: string, site: Site, project: string): Promise<void> {
    seedConfig(dataHome, site, project);
    await page.goto(pageUrl(site, 'current', 'Start.', project));
    await expect.poll(() => status(page)).toMatchObject({ state: 'attached' });
}

/** Opens `text` as a file not seen before, and waits for its check to settle. */
async function open(page: Page, id: string, file: string, text: string): Promise<Settled> {
    const settled = await watchCheck(page);
    await host(page, 'switchFile', id, file, text);
    return settled();
}

async function typeSentence(page: Page, rep: number): Promise<Settled> {
    const settled = await watchCheck(page);
    await host(page, 'typeAtEnd', `\n\nOne more sentence to recieve, number ${String(rep)}.`);
    return settled();
}

const kilobytes = (text: string): string => `${(Buffer.byteLength(text) / 1024).toFixed(0)} KB`;

const recorder = new Recorder('web-documents');

test.afterAll(() => {
    console.info(`\n${recorder.table()}\n`);
});

for (const c of CASES) {
    test(`${c.site}: ${c.subject}`, async ({ page, dataHome, devtoolsPort }) => {
        const project = `bench-${c.subject.replaceAll(/\W+/gu, '-')}`;
        await openSite(page, dataHome, c.site, project);
        // Discarded: the first check pays for starting the core and loading its dictionaries.
        await open(page, 'warmup', c.file, (c.site === 'typst' ? typst : latex)(seedFor('warmup', 0), 4000));
        const samples = { cold: [] as number[], first: [] as number[], cached: [] as number[], edit: [] as number[], blocking: [] as number[], longest: [] as number[] };
        const memory = { page: [] as number[], worker: [] as number[], host: [] as number[], server: [] as number[] };
        let detail = '';
        for (let rep = 1; rep <= REPS; rep++) {
            const text = c.make(seedFor(`web ${c.site} ${c.subject}`, rep));
            const cold = await open(page, `cold-${String(rep)}`, c.file, text);
            const cached = await open(page, `cached-${String(rep)}`, c.file, text);
            expect(cached.findings, 'the cached check found what the cold one did').toBe(cold.findings);
            const edit = await typeSentence(page, rep);
            samples.cold.push(cold.settledMs);
            samples.first.push(cold.firstMs);
            samples.cached.push(cached.settledMs);
            samples.edit.push(edit.settledMs);
            samples.blocking.push(cold.blockingMs);
            samples.longest.push(cold.longestTaskMs);
            memory.page.push(await heapMB(page));
            memory.worker.push(await workerHeapMB(devtoolsPort));
            const processes = ourProcesses(dataHome);
            memory.host.push(processes.host?.rssMB ?? NaN);
            memory.server.push(processes.server?.rssMB ?? NaN);
            detail = `${kilobytes(text)}, ${String(cold.findings)} findings`;
            // Back to a small file, so the next repetition starts from the same place.
            await open(page, `rest-${String(rep)}`, c.file, 'Rest.');
        }
        const subject = `${c.site} ${c.subject}`;
        recorder.record({ subject, metric: 'open + cold check', samples: samples.cold, ceiling: c.ceilings.cold, detail });
        recorder.record({ subject, metric: 'first answer', samples: samples.first, ceiling: c.ceilings.cold, detail });
        recorder.record({ subject, metric: 'reopen (cached)', samples: samples.cached, ceiling: c.ceilings.cached, detail });
        recorder.record({ subject, metric: 'type to findings', samples: samples.edit, ceiling: c.ceilings.edit, detail });
        recorder.record({ subject, metric: 'main thread held (TBT)', samples: samples.blocking, ceiling: c.ceilings.blocking, detail });
        recorder.record({ subject, metric: 'longest task', samples: samples.longest, ceiling: c.ceilings.blocking, detail });
        // Memory, about ten times the most measured for a 1 MB document
        // (2026-10-14): page 21 MiB, background 3 MiB, host 24 MiB, server 520 MiB.
        recorder.record({ subject, metric: 'page heap', unit: 'MiB', samples: memory.page, ceiling: 256, detail });
        recorder.record({ subject, metric: 'background heap', unit: 'MiB', samples: memory.worker, ceiling: 32, detail });
        recorder.record({ subject, metric: 'native host RSS', unit: 'MiB', samples: memory.host, ceiling: 256, detail });
        recorder.record({ subject, metric: 'core server RSS', unit: 'MiB', samples: memory.server, ceiling: 4096, detail });
    });
}

/** A progressive check: the window around the cursor first, then the rest. */
async function progressiveCase(page: Page, context: BrowserContext, extensionId: string, dataHome: string): Promise<void> {
    await setChecking(context, extensionId, { progressive: true, windowKib: 16, maxKib: 0 });
    await openSite(page, dataHome, 'overleaf', 'bench-progressive');
    await open(page, 'warmup', 'main.tex', latex(seedFor('warmup', 0), 4000));
    const first: number[] = [];
    const settled: number[] = [];
    const blocking: number[] = [];
    let detail = '';
    for (let rep = 1; rep <= REPS; rep++) {
        const text = latex(seedFor('web progressive latex 1 MB', rep), 1_000_000);
        const cold = await open(page, `cold-${String(rep)}`, 'main.tex', text);
        first.push(cold.firstMs);
        settled.push(cold.settledMs);
        blocking.push(cold.blockingMs);
        detail = `${kilobytes(text)}, ${String(cold.findings)} findings, 16 KiB windows`;
        await open(page, `rest-${String(rep)}`, 'main.tex', 'Rest.');
    }
    const subject = 'overleaf latex 1 MB, progressive';
    // 1.4 s to the first window, 17.6 s to the last (2026-10-14). The whole
    // check's ceiling is tight on purpose: each window parsing the whole
    // document again took 61 s (0caad2d).
    recorder.record({ subject, metric: 'first answer', samples: first, ceiling: 15_000, detail });
    recorder.record({ subject, metric: 'open + cold check', samples: settled, ceiling: 45_000, detail });
    recorder.record({ subject, metric: 'main thread held (TBT)', samples: blocking, ceiling: 1000, detail });
}

test('overleaf: latex 1 MB, progressive', async ({ page, context, extensionId, dataHome }) => {
    await progressiveCase(page, context, extensionId, dataHome);
});

test('every median is within its ceiling', () => {
    recorder.gate();
});
