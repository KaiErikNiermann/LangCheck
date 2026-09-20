/**
 * `exclude`, in the editor.
 *
 * It used to govern the background indexer and nothing else, so a file in an
 * excluded path was skipped while indexing and checked the moment someone
 * opened it. That is the worst of both: the setting appears to do nothing, and
 * the two halves of the same tool disagree about which files this project
 * checks.
 *
 * Excluding means no diagnostics at all -- not fewer, not quieter.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';

import { eventually, fixture, openInEditor, ourDiagnostics } from './helpers';

const BUDGET_MS = 45_000;

suite('excluded paths', () => {
    suiteSetup(async function () {
        this.timeout(60_000);
        const extension = vscode.extensions.getExtension('KaiErikNiermann.language-check');
        assert.ok(extension);
        await extension.activate();
    });

    test('a document outside the excluded paths is checked', async function () {
        this.timeout(BUDGET_MS + 15_000);
        // The anchor for the test below: without this, "no diagnostics" in an
        // excluded file would also be what a broken checker looks like.
        const uri = fixture('kept.md');
        await openInEditor(uri);
        await eventually(
            'the ordinary document to be checked',
            () => (ourDiagnostics(uri).length > 0 ? true : undefined),
            BUDGET_MS,
        );
    });

    test('an excluded document is never checked, not even once', async function () {
        this.timeout(BUDGET_MS + 30_000);
        const kept = fixture('kept.md');
        const excluded = fixture('drafts/skipped.md');

        await openInEditor(kept);
        await eventually(
            'the ordinary document to be checked first, so the core is known to be up',
            () => (ourDiagnostics(kept).length > 0 ? true : undefined),
            BUDGET_MS,
        );

        const document = await openInEditor(excluded);
        // Sampled rather than read once. An exclusion applied after the
        // diagnostics were published would show as a flash, and a single look
        // after a delay would miss it.
        let everReported = false;
        const watching = setInterval(() => {
            if (ourDiagnostics(excluded).length > 0) everReported = true;
        }, 15);
        try {
            await new Promise(resolve => setTimeout(resolve, 8_000));
        } finally {
            clearInterval(watching);
        }

        assert.strictEqual(
            everReported,
            false,
            'a document under an excluded path was checked',
        );
        assert.ok(
            document.getText().includes('recieve'),
            'the fixture no longer contains the typo, so the test proves nothing',
        );
    });

    test('editing an excluded document does not start checking it', async function () {
        this.timeout(BUDGET_MS + 30_000);
        // The open path and the change path are different entry points, and
        // only one of them was being tested above.
        const excluded = fixture('drafts/skipped.md');
        const document = await openInEditor(excluded);
        const editor = await vscode.window.showTextDocument(document);

        try {
            await editor.edit(edit => {
                edit.insert(new vscode.Position(0, 0), 'Another seperate typo.\n\n');
            });
            await vscode.commands.executeCommand('language-check.checkDocument');
            await new Promise(resolve => setTimeout(resolve, 5_000));

            assert.deepStrictEqual(
                ourDiagnostics(excluded).map(d => d.message),
                [],
                'editing an excluded document started checking it',
            );
        } finally {
            await vscode.commands.executeCommand('workbench.action.files.revert');
        }
    });
});
