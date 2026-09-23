/**
 * How long a document takes to check, from the editor, for ordinary and
 * pathological documents alike.
 *
 * Each case is generated afresh for every repetition, so each cold check is
 * of text the core has never seen; the check straight after it is of the
 * same text, and is the cached path a reopened document takes.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';

import {
    longLine, malformedHtml, malformedLatex, malformedMarkdown, markdown, mixedLanguages, oddCharacters, paragraph, rng,
} from './corpus';
import { activate, checkActive, closeEditors, diagnosticsWhere, openAndCheck, seedFor, writeDocument } from './editor';
import { REPS, Recorder, timed } from './measure';

interface DocumentCase {
    readonly subject: string;
    readonly extension: string;
    readonly make: (seed: number) => string;
    /** Medians past these are broken, not slow; see measure.ts. */
    readonly coldCeilingMs: number;
    readonly cachedCeilingMs: number;
}

/**
 * Ceilings are 10 to 30 times the medians measured on 2026-09-23 (Ryzen 9
 * 9900X3D, release core, VS Code 1.139): far enough above them that a busy
 * machine does not trip one, near enough that a quadratic path does.
 */
const CASES: readonly DocumentCase[] = [
    // 66 ms cold, 2 ms cached.
    { subject: 'baseline 4 KB', extension: 'md', make: s => markdown(s, 4_000), coldCeilingMs: 2_000, cachedCeilingMs: 1_000 },
    // 11.8 s cold, linear in size: Harper at one finding per 76 bytes. 341 ms cached.
    { subject: 'large 1 MB', extension: 'md', make: s => markdown(s, 1_000_000), coldCeilingMs: 120_000, cachedCeilingMs: 5_000 },
    // 3.2 s cold, 105 ms cached.
    { subject: 'one 256 KB line', extension: 'md', make: s => longLine(s, 256_000), coldCeilingMs: 40_000, cachedCeilingMs: 2_000 },
    // 71-171 ms cold, 6-48 ms cached; each aborted the core before the fixes.
    { subject: 'malformed md', extension: 'md', make: malformedMarkdown, coldCeilingMs: 3_000, cachedCeilingMs: 1_000 },
    { subject: 'malformed tex', extension: 'tex', make: malformedLatex, coldCeilingMs: 3_000, cachedCeilingMs: 1_000 },
    { subject: 'malformed html', extension: 'html', make: malformedHtml, coldCeilingMs: 3_000, cachedCeilingMs: 1_000 },
    // 516 ms cold, 27 ms cached.
    { subject: 'mixed languages 64 KB', extension: 'md', make: s => mixedLanguages(s, 64_000), coldCeilingMs: 8_000, cachedCeilingMs: 1_000 },
    { subject: 'odd characters 64 KB', extension: 'md', make: s => oddCharacters(s, 64_000), coldCeilingMs: 8_000, cachedCeilingMs: 1_000 },
];

function kilobytes(text: string): string {
    return `${(Buffer.byteLength(text) / 1024).toFixed(0)} KB`;
}

suite('bench: documents', () => {
    const recorder = new Recorder('documents');

    suiteSetup(async function () {
        this.timeout(120_000);
        await activate();
        // Discarded: the first check pays for loading the grammars and the
        // dictionaries, which is a startup cost and not the document's.
        await openAndCheck(writeDocument('warmup.md', markdown(seedFor('warmup', 0), 4_000)));
        await closeEditors();
    });

    suiteTeardown(() => {
        console.log(`\n${recorder.table()}\n`);
    });

    for (const c of CASES) {
        test(c.subject, async () => {
            const cold: number[] = [];
            const cached: number[] = [];
            let size = '';
            for (let rep = 1; rep <= REPS; rep++) {
                const text = c.make(seedFor(c.subject, rep));
                size = kilobytes(text);
                const uri = writeDocument(`${c.subject.replace(/\W+/g, '-')}-${rep}.${c.extension}`, text);
                const first = await timed(() => openAndCheck(uri));
                assert.ok(!first.value.servedFromCache, `${c.subject}: a cold check was served from the cache`);
                cold.push(first.ms);
                const again = await timed(checkActive);
                assert.ok(again.value.servedFromCache, `${c.subject}: the re-check was not served from the cache`);
                cached.push(again.ms);
                await closeEditors();
            }
            recorder.record({ subject: c.subject, metric: 'open + cold check', samplesMs: cold, ceilingMs: c.coldCeilingMs, detail: size });
            recorder.record({ subject: c.subject, metric: 'cached re-check', samplesMs: cached, ceilingMs: c.cachedCeilingMs, detail: size });
        });
    }

    test('save to diagnostics, editing a 4 KB document', async () => {
        // The loop a user is in under the default onSave trigger: write a
        // sentence with a mistake in it, save, see it marked.
        const uri = writeDocument('edited.md', markdown(seedFor('edited', 0), 4_000));
        const document = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(document, { preview: false });
        await checkActive();
        const next = rng(seedFor('edited', 1));
        const samples: number[] = [];
        for (let rep = 1; rep <= REPS; rep++) {
            const before = vscode.languages.getDiagnostics(uri).filter(d => d.source === 'language-check').length;
            await editor.edit(edit => edit.insert(
                document.positionAt(document.getText().length),
                `\n${paragraph(next, 'en', 2)} Teh mistake number ${rep} is recieved.\n`,
            ));
            const saved = await timed(async () => {
                await document.save();
                await diagnosticsWhere(uri, count => count > before);
            });
            samples.push(saved.ms);
        }
        await closeEditors();
        // 50 ms.
        recorder.record({ subject: 'edit 4 KB', metric: 'save to diagnostics', samplesMs: samples, ceilingMs: 2_000 });
    });

    test('every median is within its ceiling', () => {
        recorder.gate();
    });
});
