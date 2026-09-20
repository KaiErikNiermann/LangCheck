/**
 * What must stay true across the events that rebuild the extension's state.
 *
 * A config change tears down the client, clears every cache and re-checks; a
 * window reload starts from nothing at all. Both are routine and both have
 * been where checks went missing, so each invariant here is stated as
 * something a user would notice rather than as a call that should not throw.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';

import { eventually, fixture, inlayHints, openInEditor, ourDiagnostics } from './helpers';

const BUDGET_MS = 30_000;

/** Wait for a document to have been checked at all. */
async function checked(uri: vscode.Uri, what: string, timeoutMs = BUDGET_MS) {
    return eventually(what, () => (ourDiagnostics(uri).length > 0 ? true : undefined), timeoutMs);
}

suite('invariants around config changes', () => {
    suiteSetup(async function () {
        this.timeout(60_000);
        const extension = vscode.extensions.getExtension('KaiErikNiermann.language-check');
        assert.ok(extension);
        await extension.activate();
    });

    teardown(async () => {
        // Each test here changes settings, and a setting left behind would
        // make the next test's result depend on the order they ran in.
        const config = vscode.workspace.getConfiguration('languageCheck');
        await config.update('check.trigger', undefined, vscode.ConfigurationTarget.Workspace);
        await config.update('names.enabled', undefined, vscode.ConfigurationTarget.Workspace);
    });

    test('a config change re-checks what is open instead of leaving it stale', async function () {
        this.timeout(90_000);
        const uri = fixture('notes.md');
        await openInEditor(uri);
        await checked(uri, 'the initial check');

        // A setting that rebuilds the client, so the whole teardown-and-recheck
        // path runs rather than just a re-read.
        await vscode.workspace.getConfiguration('languageCheck')
            .update('names.enabled', true, vscode.ConfigurationTarget.Workspace);

        // The rebuild clears diagnostics before re-checking, so the assertion
        // is that they come back -- a config change that leaves a document
        // permanently blank is the failure being guarded against.
        await checked(uri, 'diagnostics to return after the config change', 60_000);
    });

    test('the inspector survives a config change made while it is open', async function () {
        this.timeout(90_000);
        const uri = fixture('notes.md');
        await openInEditor(uri);
        await checked(uri, 'the initial check');

        await vscode.commands.executeCommand('language-check.openInspector');
        // The inspector steals focus, and the check paths key on the active
        // editor, so the document is made active again before anything is
        // asserted about it.
        await openInEditor(uri);

        await vscode.workspace.getConfiguration('languageCheck')
            .update('names.enabled', true, vscode.ConfigurationTarget.Workspace);

        // The inspector reads the same extraction the check produces. If the
        // config change left it holding a cleared cache with nothing to
        // repopulate it, the document stays blank -- which is what an
        // inspector that "broke" on a config edit looks like from outside.
        await checked(uri, 'diagnostics after a config change with the inspector open', 60_000);

        // And it must still be possible to open it again without the previous
        // one having been left in a state that refuses.
        await vscode.commands.executeCommand('language-check.openInspector');
    });

    test('switching to onSave does not blank a document already checked', async function () {
        this.timeout(90_000);
        const uri = fixture('notes.md');
        await openInEditor(uri);
        await checked(uri, 'the initial check');

        await vscode.workspace.getConfiguration('languageCheck')
            .update('check.trigger', 'onSave', vscode.ConfigurationTarget.Workspace);

        await checked(uri, 'diagnostics to survive the trigger change', 60_000);
    });

    test('a document is checked under onSave too, without being saved', async function () {
        this.timeout(90_000);
        // The setting is about re-checking. A document opened for the first
        // time under onSave must still be checked, which is the bug this
        // suite was built around.
        await vscode.workspace.getConfiguration('languageCheck')
            .update('check.trigger', 'onSave', vscode.ConfigurationTarget.Workspace);

        const uri = fixture('third.md');
        await openInEditor(uri);
        await checked(uri, 'a first check under onSave', 60_000);
    });

    test('hints come back after a config change, not only diagnostics', async function () {
        this.timeout(90_000);
        const uri = fixture('notes.md');
        const document = await openInEditor(uri);
        await checked(uri, 'the initial check');

        await vscode.workspace.getConfiguration('languageCheck')
            .update('names.enabled', true, vscode.ConfigurationTarget.Workspace);
        await checked(uri, 'diagnostics after the config change', 60_000);

        await eventually(
            'inlay hints after the config change',
            async () => {
                const found = await inlayHints(document);
                return found.length > 0 ? found : undefined;
            },
            30_000,
        );
    });
});
