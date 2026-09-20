/**
 * The same workspace in a second window: does a suppressed region stay
 * suppressed when the answer comes from the stored result?
 *
 * Worth its own launch because the path is different. The first window ran the
 * engines and applied the directives to what they said; this one may be served
 * a result computed in the previous window. Diagnostics are stored *after*
 * suppression, so the stored answer should already exclude the region -- but
 * "should" is the reason to check, and the failure it guards against is the
 * visible one: squiggles appearing on a suppressed region for as long as it
 * takes something to notice and take them away.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';

import { eventually, fixture, openInEditor, ourDiagnostics } from './helpers';

const SUPPRESSED = 'seperate';
const CONTROL = 'recieve';

function flagged(document: vscode.TextDocument): Set<string> {
    return new Set(
        ourDiagnostics(document.uri).map(d => document.getText(d.range).toLowerCase()),
    );
}

suite('inline directives after a reload', () => {
    test('the suppressed region is not reported, on whichever path answers', async function () {
        this.timeout(60_000);
        const extension = vscode.extensions.getExtension('KaiErikNiermann.language-check');
        assert.ok(extension);
        await extension.activate();

        const uri = fixture('regions.md');
        const document = await openInEditor(uri);

        // Sampling starts before the first check of this window, so it covers
        // the window in which a stored result is read and published.
        let everFlagged = false;
        const watching = setInterval(() => {
            if (flagged(document).has(SUPPRESSED)) everFlagged = true;
        }, 15);

        try {
            await eventually(
                'the control to be reported in the new window',
                () => (flagged(document).has(CONTROL) ? true : undefined),
                45_000,
            );
            await new Promise(resolve => setTimeout(resolve, 3_000));
        } finally {
            clearInterval(watching);
        }

        assert.strictEqual(
            everFlagged,
            false,
            `${SUPPRESSED} was reported after a reload, inside a region that switches spelling off`,
        );
    });
});
