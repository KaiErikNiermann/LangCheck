/**
 * Config that changes which engines run, and how loudly, while the editor is
 * open.
 *
 * Adding an engine and changing a severity are the two config edits whose
 * effect a user watches for directly -- new squiggles, or the same squiggles
 * in a different colour -- so "takes effect on the next reload" is especially
 * poor here: the edit looks like it did nothing.
 *
 * The WASM plugin is the one this repository ships, loaded from its real
 * location, so the test covers the path resolution as well as the wiring.
 */
import * as assert from 'assert';
import { existsSync } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { eventually, fixture, fixtureRoot, openInEditor, ourDiagnostics } from './helpers';

const BUDGET_MS = 45_000;
/** What the bundled wordiness plugin reports under. */
const WORDINESS_RULE = 'wasm.wordiness-check.wordiness';
/** An ordinary misspelling, present whatever the engines are.  */
const CONTROL = 'recieve';

function ours(uri: vscode.Uri): vscode.Diagnostic[] {
    return ourDiagnostics(uri);
}

function control(document: vscode.TextDocument): vscode.Diagnostic | undefined {
    return ours(document.uri).find(
        d => document.getText(d.range).toLowerCase() === CONTROL,
    );
}

function wordiness(uri: vscode.Uri): vscode.Diagnostic[] {
    return ours(uri).filter(d => d.code === WORDINESS_RULE);
}

suite('engines and severities, changed live', () => {
    let document: vscode.TextDocument;
    let configUri: vscode.Uri;
    let originalConfig: string;
    let wasmPath: string;

    async function settlesTo(what: string, want: () => boolean) {
        await vscode.window.showTextDocument(document, { preview: false });
        return eventually(what, () => (want() ? true : undefined), BUDGET_MS);
    }

    const write = async (text: string) =>
        vscode.workspace.fs.writeFile(configUri, Buffer.from(text, 'utf8'));

    suiteSetup(async function () {
        this.timeout(60_000);
        const extension = vscode.extensions.getExtension('KaiErikNiermann.language-check');
        assert.ok(extension);
        await extension.activate();

        configUri = fixture('.languagecheck.yaml');
        originalConfig = Buffer.from(
            await vscode.workspace.fs.readFile(configUri),
        ).toString('utf8');
        // Resolved at runtime rather than written into the fixture: a relative
        // path from here to the repository root is five levels of `..` that
        // would break silently the moment the fixture moved.
        wasmPath = path.resolve(
            fixtureRoot(), '..', '..', '..', '..', '..',
            'plugins', 'wordiness-check', 'wordiness-check.wasm',
        );
        document = await openInEditor(fixture('doc.md'));
    });

    teardown(async function () {
        this.timeout(BUDGET_MS + 15_000);
        await write(originalConfig);
        await settlesTo(
            'the baseline config to be back in force',
            () => wordiness(document.uri).length === 0
                && control(document)?.severity === vscode.DiagnosticSeverity.Warning,
        );
    });

    test('the plugin is not running until the config names it', async function () {
        this.timeout(BUDGET_MS + 15_000);
        await settlesTo(
            'the control, with nothing from the plugin',
            () => control(document) !== undefined && wordiness(document.uri).length === 0,
        );
    });

    test('adding a WASM plugin activates it without a reload', async function () {
        this.timeout(BUDGET_MS + 15_000);
        assert.ok(
            existsSync(wasmPath),
            `the plugin this repository ships is not at ${wasmPath}`,
        );
        await settlesTo('the baseline', () => control(document) !== undefined);

        await write(
            `engines:\n  harper: true\n  wasm_plugins:\n    - name: wordiness-check\n      path: ${wasmPath}\n`,
        );

        await settlesTo(
            'the plugin to start reporting',
            // The control is in the condition so an empty document -- the
            // state a reinitialize passes through -- cannot satisfy it.
            () => wordiness(document.uri).length > 0 && control(document) !== undefined,
        );
    });

    test('removing the plugin stops it, also without a reload', async function () {
        this.timeout(BUDGET_MS + 15_000);
        await write(
            `engines:\n  harper: true\n  wasm_plugins:\n    - name: wordiness-check\n      path: ${wasmPath}\n`,
        );
        await settlesTo('the plugin to be running', () => wordiness(document.uri).length > 0);

        await write(originalConfig);

        await settlesTo(
            'the plugin to stop reporting while the rest keeps going',
            () => wordiness(document.uri).length === 0 && control(document) !== undefined,
        );
    });

    test('a severity override changes the colour of an existing squiggle', async function () {
        this.timeout(BUDGET_MS + 15_000);
        await settlesTo(
            'the control at its category default, which is a warning',
            () => control(document)?.severity === vscode.DiagnosticSeverity.Warning,
        );

        await write(
            'engines:\n  harper: true\nrules:\n  spelling.typo:\n    severity: error\n',
        );

        await settlesTo(
            'the same diagnostic to be reported as an error',
            () => control(document)?.severity === vscode.DiagnosticSeverity.Error,
        );
    });

    test('a rule switched off stops being reported', async function () {
        this.timeout(BUDGET_MS + 15_000);
        await settlesTo('the control to be present', () => control(document) !== undefined);

        await write(
            'engines:\n  harper: true\nrules:\n  spelling.typo:\n    severity: "off"\n',
        );

        // Something else in the document has to still be reported, or "the
        // rule was switched off" and "checking stopped" look the same. The
        // plugin is not on here, so the anchor is that the document has *some*
        // diagnostic left -- the wordiness prose is flagged by Harper's style
        // rules -- while the spelling one is gone.
        await settlesTo(
            'the spelling diagnostic to go while the document is still checked',
            () => control(document) === undefined && ours(document.uri).length > 0,
        );
    });
});
