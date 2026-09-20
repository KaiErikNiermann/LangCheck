/**
 * Phase one: check a document, so the workspace index has something in it.
 *
 * The pair exists because reuse across a restart is the only kind that
 * matters here. Within one session the core holds an in-memory result cache
 * and a second check is obviously fast; the question is whether closing the
 * window and opening it again costs a full re-check of everything visible.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';

import { eventually, fixture, openInEditor, ourDiagnostics } from './helpers';

suite('cache reuse, phase one: populate it', () => {
    test('the document is checked and the result recorded', async function () {
        this.timeout(90_000);
        const extension = vscode.extensions.getExtension('KaiErikNiermann.language-check');
        assert.ok(extension);
        await extension.activate();

        const uri = fixture('large.md');
        await openInEditor(uri);

        const found = await eventually(
            'the first, cold check',
            () => {
                const diagnostics = ourDiagnostics(uri);
                return diagnostics.length > 0 ? diagnostics : undefined;
            },
            60_000,
        );
        assert.ok(found.length > 10, `expected a document full of typos, got ${found.length}`);

        // Written to the index after the response is sent, so the window must
        // not be allowed to close on top of it.
        await new Promise(resolve => setTimeout(resolve, 3_000));
    });
});
