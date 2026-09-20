/**
 * When a config edit takes effect, and when it must not.
 *
 * The core reads `.languagecheck.yaml` from disk and the extension watches the
 * file, so a config takes effect on save and not on keystroke. That is worth
 * pinning rather than assuming, because of what hot exit does: VS Code
 * restores unsaved buffers across a reload, so a half-finished config edit
 * comes back on screen looking exactly like the config in force. If an
 * unsaved edit were applied, a reload would silently start checking under a
 * config the user never committed to -- and if a saved one were not, the
 * editor would ignore a change it had clearly been told about.
 *
 * `preimage` is the signal: nothing carries the word and morphology reaches
 * it, so switching morphology off is a config change with exactly one visible
 * consequence. `recieve` is the control, reported under every config, so a
 * quiet document means checking stopped rather than that the config applied.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';

import { eventually, fixture, openInEditor, ourDiagnostics } from './helpers';

const BUDGET_MS = 45_000;
const SIGNAL = 'preimage';
const CONTROL = 'recieve';

const MORPHOLOGY_OFF =
    'engines:\n  harper: true\nmorphology:\n  enabled: false\n  inflections: false\n';

function flagged(document: vscode.TextDocument): Set<string> {
    return new Set(
        ourDiagnostics(document.uri).map(d => document.getText(d.range).toLowerCase()),
    );
}

suite('config edits', () => {
    let document: vscode.TextDocument;
    let configUri: vscode.Uri;
    let originalConfig: string;

    async function settlesTo(what: string, want: (words: Set<string>) => boolean) {
        // Shown first. A config change re-checks what is visible, and these
        // tests open the config file itself, which in a single editor column
        // means the document under test is not. Leaving it hidden would make
        // the test wait for a check that is correctly not being run -- the
        // document is re-checked when it comes back into view.
        await vscode.window.showTextDocument(document, { preview: false });
        return eventually(
            what,
            () => {
                const words = flagged(document);
                return want(words) ? words : undefined;
            },
            BUDGET_MS,
        );
    }

    suiteSetup(async function () {
        this.timeout(60_000);
        const extension = vscode.extensions.getExtension('KaiErikNiermann.language-check');
        assert.ok(extension);
        await extension.activate();

        configUri = fixture('.languagecheck.yaml');
        originalConfig = Buffer.from(
            await vscode.workspace.fs.readFile(configUri),
        ).toString('utf8');
        document = await openInEditor(fixture('doc.md'));
    });

    teardown(async function () {
        this.timeout(BUDGET_MS + 15_000);
        await vscode.workspace.fs.writeFile(configUri, Buffer.from(originalConfig, 'utf8'));
        // Waited for, so the next test starts from the config it expects and
        // not from whatever the last one left in flight.
        await settlesTo(
            'the baseline config to be back in force',
            words => !words.has(SIGNAL) && words.has(CONTROL),
        );
    });

    test('an unsaved config edit changes nothing', async function () {
        this.timeout(BUDGET_MS + 30_000);
        await settlesTo('the baseline', words => !words.has(SIGNAL) && words.has(CONTROL));

        const configDocument = await vscode.workspace.openTextDocument(configUri);
        const configEditor = await vscode.window.showTextDocument(configDocument, { preview: false });
        try {
            await configEditor.edit(edit => {
                edit.insert(
                    new vscode.Position(configDocument.lineCount, 0),
                    'morphology:\n  enabled: false\n  inflections: false\n',
                );
            });
            assert.ok(configDocument.isDirty, 'the config edit was not made, or was saved');

            // This is the state hot exit restores: a config on screen that is
            // not the config on disk. Sampled repeatedly rather than read once,
            // because the failure is the edit being picked up at all.
            let everApplied = false;
            const watching = setInterval(() => {
                if (flagged(document).has(SIGNAL)) everApplied = true;
            }, 25);
            try {
                await new Promise(resolve => setTimeout(resolve, 6_000));
            } finally {
                clearInterval(watching);
            }

            assert.strictEqual(
                everApplied,
                false,
                'an unsaved config edit was applied; after a reload that would check under a config the user never saved',
            );
            assert.ok(flagged(document).has(CONTROL), 'checking stopped altogether');
        } finally {
            await vscode.commands.executeCommand('workbench.action.files.revert');
        }
    });

    test('saving the config applies it', async function () {
        this.timeout(BUDGET_MS + 30_000);
        await settlesTo('the baseline', words => !words.has(SIGNAL) && words.has(CONTROL));

        await vscode.workspace.fs.writeFile(configUri, Buffer.from(MORPHOLOGY_OFF, 'utf8'));

        const words = await settlesTo(
            'the saved config to take effect',
            found => found.has(SIGNAL),
        );
        assert.ok(words.has(CONTROL), 'the control went with it, so checking stopped');
    });

    test('deleting the config falls back to the defaults', async function () {
        this.timeout(BUDGET_MS + 45_000);
        // Put the workspace in a state the defaults do not produce, so that
        // going back to them is observable rather than a coincidence.
        await vscode.workspace.fs.writeFile(configUri, Buffer.from(MORPHOLOGY_OFF, 'utf8'));
        await settlesTo('the morphology-off config to take effect', words => words.has(SIGNAL));

        await vscode.workspace.fs.delete(configUri, { useTrash: false });

        // The defaults are Harper on and morphology on, which accepts the
        // signal again. Leaving the deleted file's config in force means the
        // editor keeps checking under a config that no longer exists.
        await settlesTo(
            'the defaults to come back once the config is gone',
            words => !words.has(SIGNAL) && words.has(CONTROL),
        );
    });
});
