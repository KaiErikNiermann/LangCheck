/**
 * Progressive first checks (languageCheck.check.progressive) and the
 * check.maxBytes bound, through the real core: what a long document's
 * windows find together is what a whole check finds, and prose starting
 * past maxBytes is not checked. How the windows are planned is unit-tested
 * (checker.test.ts); the browser's spec reads them off the wire.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as vscode from 'vscode';

import { eventually, fixtureRoot, openInEditor, ourDiagnostics } from './helpers';
import * as path from 'path';

const BUDGET_MS = 60_000;

/** `paragraphs` paragraphs, every `every`-th with "recieve"; with the offset of each. */
function longMarkdown(paragraphs: number, every: number): { text: string; misspellings: number[] } {
    const out: string[] = [];
    const misspellings: number[] = [];
    let at = 0;
    for (let i = 1; i <= paragraphs; i++) {
        const wrong = i % every === 0;
        const line = `Paragraph ${i} holds some ordinary words about the weather${wrong ? ' and recieve' : ''} in a sentence.`;
        if (wrong) misspellings.push(at + line.indexOf('recieve'));
        out.push(line);
        at += line.length + 2;
    }
    return { text: out.join('\n\n'), misspellings };
}

const spelled = (uri: vscode.Uri): number => ourDiagnostics(uri).filter(d => d.message.includes('recieve')).length;

suite('progressive checks and maxBytes', () => {
    const files: string[] = [];
    const write = (name: string, text: string): vscode.Uri => {
        const file = path.join(fixtureRoot(), name);
        fs.writeFileSync(file, text);
        files.push(file);
        return vscode.Uri.file(file);
    };

    suiteSetup(async function () {
        this.timeout(60_000);
        const extension = vscode.extensions.getExtension('KaiErikNiermann.language-check');
        assert.ok(extension);
        await extension.activate();
    });

    teardown(async () => {
        const config = vscode.workspace.getConfiguration('languageCheck');
        for (const key of ['check.progressive', 'check.windowBytes', 'check.maxBytes']) {
            await config.update(key, undefined, vscode.ConfigurationTarget.Workspace);
        }
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        for (const file of files.splice(0)) fs.rmSync(file, { force: true });
    });

    test('a long document checked a window at a time finds what a whole check finds', async function () {
        this.timeout(BUDGET_MS * 2);
        const config = vscode.workspace.getConfiguration('languageCheck');
        await config.update('check.progressive', true, vscode.ConfigurationTarget.Workspace);
        await config.update('check.windowBytes', 1024, vscode.ConfigurationTarget.Workspace);
        const { text, misspellings } = longMarkdown(300, 30);
        const uri = write('progressive-long.md', text);
        await openInEditor(uri);
        await eventually(`every misspelling, from the windows (${misspellings.length})`, () =>
            spelled(uri) === misspellings.length ? true : undefined, BUDGET_MS).catch((error: unknown) => {
            throw new Error(`${String(error)}; found ${spelled(uri)} of ${ourDiagnostics(uri).length}: ${ourDiagnostics(uri).slice(0, 3).map(d => d.message).join(' | ')}`);
        });
        // The next check is whole, and finds the same.
        const outcome = await vscode.commands.executeCommand<{ diagnostics: number }>('language-check.checkDocument');
        assert.ok(outcome !== undefined);
        assert.strictEqual(spelled(uri), misspellings.length);
    });

    test('prose starting past maxBytes is not checked', async function () {
        this.timeout(BUDGET_MS * 2);
        await vscode.workspace.getConfiguration('languageCheck')
            .update('check.maxBytes', 4096, vscode.ConfigurationTarget.Workspace);
        const { text, misspellings } = longMarkdown(300, 30);
        const within = misspellings.filter(at => at < 4096).length;
        assert.ok(within > 0 && within < misspellings.length);
        const uri = write('bounded-long.md', text);
        await openInEditor(uri);
        await eventually('the misspellings within the bound', () =>
            spelled(uri) === within ? true : undefined, BUDGET_MS);
    });
});
