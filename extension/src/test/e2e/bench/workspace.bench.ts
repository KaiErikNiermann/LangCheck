/**
 * How a large workspace holds up: getting the core back after a restart,
 * checking a document while the index is being built, and listing what the
 * config selects.
 *
 * Run under two labels in .vscode-test.bench.mjs, over a wide flat workspace
 * and over a deep one full of nested project configs.
 */
import * as assert from 'assert';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { markdown } from './corpus';
import { activate, checkActive, closeEditors, openAndCheck, seedFor, writeDocument } from './editor';
import { fixture, fixtureRoot } from '../helpers';
import { REPS, Recorder, timed } from './measure';

/** Every document the generator wrote, for the table's detail column. */
function countDocuments(dir: string): number {
    return fs.readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter(name => name.endsWith('.md')).length;
}

/** Poll the check command until the core answers it, after a restart. */
async function checkOnceTheCoreIsBack(): Promise<void> {
    for (;;) {
        const outcome = await vscode.commands.executeCommand<{ diagnostics: number } | undefined>('language-check.checkDocument');
        if (outcome && outcome.diagnostics >= 0) return;
        await new Promise(resolve => setTimeout(resolve, 50));
    }
}

suite('bench: workspace', () => {
    const name = path.basename(fixtureRoot());
    const recorder = new Recorder(`workspace ${name}`);
    const detail = `${countDocuments(fixtureRoot())} files`;

    suiteSetup(async function () {
        this.timeout(300_000);
        await activate();
        await openAndCheck(fixture('docs/d0/f0.md'));
        await closeEditors();
    });

    suiteTeardown(() => {
        console.log(`\n${recorder.table()}\n`);
    });

    test('restart to the first check', async () => {
        // A restart re-reads the config and starts indexing the workspace
        // again, which is the work a large workspace makes expensive.
        const samples: number[] = [];
        for (let rep = 1; rep <= REPS; rep++) {
            const uri = writeDocument(`bench-restart-${rep}.md`, markdown(seedFor(`restart-${name}`, rep), 4_000));
            const document = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(document, { preview: false });
            const back = await timed(async () => {
                await vscode.commands.executeCommand('language-check.restartLanguageServer');
                await checkOnceTheCoreIsBack();
            });
            samples.push(back.ms);
            await closeEditors();
        }
        // 343-350 ms measured, over 5,000 and 2,000 files.
        recorder.record({ subject: name, metric: 'restart to first check', samplesMs: samples, ceilingMs: 10_000, detail });
    });

    test('a cold check while the index is being built', async () => {
        await vscode.commands.executeCommand('language-check.restartLanguageServer');
        const samples: number[] = [];
        for (let rep = 1; rep <= REPS; rep++) {
            const uri = writeDocument(`bench-indexing-${rep}.md`, markdown(seedFor(`indexing-${name}`, rep), 4_000));
            const document = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(document, { preview: false });
            if (rep === 1) await checkOnceTheCoreIsBack();
            else samples.push((await timed(checkActive)).ms);
            await closeEditors();
        }
        // 50 ms measured.
        recorder.record({ subject: name, metric: 'cold check, indexing', samplesMs: samples, ceilingMs: 2_000, detail });
    });

    test('listing the files the config selects', () => {
        // The CLI rather than the Inspector: the same function answers both,
        // and this times the walk without a webview in the way.
        const cli = process.env.BENCH_CLI ?? '';
        if (!fs.existsSync(cli)) throw new Error(`no CLI at "${cli}": build rust-core in release first`);
        const samples: number[] = [];
        let listed = 0;
        for (let rep = 1; rep <= REPS; rep++) {
            const start = performance.now();
            const listing: SpawnSyncReturns<string> = spawnSync(cli, ['config', 'files', '--bare'], { cwd: fixtureRoot(), encoding: 'utf8' });
            samples.push(performance.now() - start);
            assert.strictEqual(listing.status, 0, listing.stderr);
            listed = listing.stdout.split('\n').filter(Boolean).length;
        }
        recorder.record({ subject: name, metric: 'config files listing', samplesMs: samples, ceilingMs: 3_000, detail: `${listed} listed` });
    });

    test('every median is within its ceiling', () => {
        recorder.gate();
    });
});
