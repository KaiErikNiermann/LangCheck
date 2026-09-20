/**
 * Phase two: a new window over the same workspace, nothing edited.
 *
 * No text changed, so nothing should need checking again. What a check costs
 * after a reload is the whole point of the workspace index persisting to
 * disk -- otherwise it is written and never read, which is what it was.
 *
 * The assertion is on a reported fact rather than on elapsed time: the
 * `language-check.checkDocument` command returns whether the answer came from
 * the stored one. Timing would pass on a fast machine and fail on a loaded
 * one, and would not distinguish "cached" from "quick".
 */
import * as assert from 'assert';
import * as vscode from 'vscode';

import { eventually, fixture, openInEditor, ourDiagnostics } from './helpers';

/** What `language-check.checkDocument` reports about the check it ran. */
interface CheckOutcome {
    diagnostics: number;
    servedFromCache: boolean;
}

suite('cache reuse, phase two: spend nothing', () => {
    suiteSetup(async function () {
        this.timeout(60_000);
        const extension = vscode.extensions.getExtension('KaiErikNiermann.language-check');
        assert.ok(extension);
        await extension.activate();
    });

    test('an unchanged document is served from the stored result', async function () {
        this.timeout(90_000);
        const uri = fixture('large.md');
        await openInEditor(uri);

        await eventually(
            'diagnostics after the reload',
            () => (ourDiagnostics(uri).length > 0 ? true : undefined),
            60_000,
        );

        const outcome = await vscode.commands.executeCommand<CheckOutcome>(
            'language-check.checkDocument',
        );
        assert.ok(outcome, 'the check command reported nothing');
        assert.strictEqual(
            outcome.servedFromCache,
            true,
            'nothing changed since the last window, so the stored result should have been reused',
        );
        assert.ok(outcome.diagnostics > 10, `the reused result is empty: ${outcome.diagnostics}`);
    });

    test('an edited document is checked again rather than served stale', async function () {
        this.timeout(90_000);
        // The invariant that makes the cache safe. VS Code restores unsaved
        // buffers across a reload -- hot exit -- so a document can come back
        // dirty, with text that never reached disk. A cache keyed on the file
        // path alone would answer that buffer with diagnostics computed from
        // the saved version: right words, wrong offsets, and a squiggle under
        // whatever now occupies those bytes.
        const uri = fixture('large.md');
        const document = await openInEditor(uri);
        const editor = await vscode.window.showTextDocument(document);

        await eventually(
            'diagnostics before editing',
            () => (ourDiagnostics(uri).length > 0 ? true : undefined),
            60_000,
        );

        await editor.edit(edit => {
            edit.insert(new vscode.Position(0, 0), 'An inserted line with a mispelling.\n\n');
        });
        assert.ok(document.isDirty, 'the edit did not make the buffer dirty');

        try {
            const outcome = await vscode.commands.executeCommand<CheckOutcome>(
                'language-check.checkDocument',
            );
            assert.ok(outcome);
            assert.strictEqual(
                outcome.servedFromCache,
                false,
                'an edited buffer was answered from a result computed for the saved file',
            );
        } finally {
            // Revert, so the file on disk and the fixture stay as committed.
            await vscode.commands.executeCommand('workbench.action.files.revert');
        }
    });

    test('a dirty buffer matching the stored text is still consistent', async function () {
        this.timeout(90_000);
        // The other side of hot exit: an edit and its undo leave the buffer
        // dirty by VS Code's reckoning while the text is byte-identical to
        // what was checked. Keying on the text rather than on the path or the
        // dirty flag is what makes this answerable at all, and the answer must
        // match the document either way.
        const uri = fixture('large.md');
        const document = await openInEditor(uri);
        const editor = await vscode.window.showTextDocument(document);

        await editor.edit(edit => {
            edit.insert(new vscode.Position(0, 0), 'x');
        });
        await vscode.commands.executeCommand('undo');

        const outcome = await vscode.commands.executeCommand<CheckOutcome>(
            'language-check.checkDocument',
        );
        assert.ok(outcome);
        assert.ok(
            outcome.diagnostics > 10,
            `the document lost its diagnostics after an edit and undo: ${outcome.diagnostics}`,
        );
    });
});
