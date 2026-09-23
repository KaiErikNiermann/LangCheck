/**
 * What the benchmarks time: the editor opening a document and the
 * extension checking it, through the same command a user runs.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

import type { CheckOutcome } from '../../../checking/checker';
import { fixtureRoot } from '../helpers';

export async function activate(): Promise<void> {
    const extension = vscode.extensions.getExtension('KaiErikNiermann.language-check');
    if (!extension) throw new Error('the extension is not installed in the test host');
    await extension.activate();
}

/**
 * A seed no earlier run used for this subject and repetition, so the core
 * has never seen the text it generates. BENCH_SALT differs per run.
 */
export function seedFor(subject: string, rep: number): number {
    let hash = Number(process.env.BENCH_SALT ?? 0);
    for (const char of subject) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
    return (hash + rep * 7_919) >>> 0;
}

/** Write a generated document into the workspace. */
export function writeDocument(name: string, text: string): vscode.Uri {
    const file = path.join(fixtureRoot(), name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return vscode.Uri.file(file);
}

/**
 * Run the check command on the active editor and return what it did.
 *
 * Throws on a failed check: a check that errored returns at once, and timing
 * it would report a broken case as the fastest one.
 */
export async function checkActive(): Promise<CheckOutcome> {
    const outcome = await vscode.commands.executeCommand<CheckOutcome | undefined>('language-check.checkDocument');
    if (!outcome) throw new Error('no active editor to check');
    if (outcome.diagnostics < 0) throw new Error('the check failed');
    return outcome;
}

/**
 * Open `uri` in an editor and check it.
 *
 * Opening fires the extension's own check; the command then joins that one
 * rather than starting a second, so this times one check from the moment
 * the document was asked for.
 */
export async function openAndCheck(uri: vscode.Uri): Promise<CheckOutcome> {
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, { preview: false });
    return checkActive();
}

export async function closeEditors(): Promise<void> {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

/** Resolve once `uri`'s diagnostics from this extension satisfy `done`. */
export function diagnosticsWhere(uri: vscode.Uri, done: (count: number) => boolean): Promise<void> {
    const count = () => vscode.languages.getDiagnostics(uri).filter(d => d.source === 'language-check').length;
    if (done(count())) return Promise.resolve();
    return new Promise(resolve => {
        const listener = vscode.languages.onDidChangeDiagnostics(event => {
            if (event.uris.some(u => u.toString() === uri.toString()) && done(count())) {
                listener.dispose();
                resolve();
            }
        });
    });
}
