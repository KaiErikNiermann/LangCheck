/**
 * The flow a user actually performs: open a workspace that has a config, open
 * a document, wait, and see whether anything was checked.
 *
 * These exist because two failures were reported that no unit test could see.
 * Squiggles sometimes did not appear until the Inspector was opened, and the
 * inline hints appeared inconsistently. Both are races between a document
 * opening and the core finishing its startup, so both need a real editor and a
 * real subprocess to reproduce -- which is what this harness gives.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';

import { eventually, fixture, inlayHints, openInEditor, ourDiagnostics } from './helpers';

const EXTENSION_ID = 'KaiErikNiermann.language-check';

/**
 * What a check is allowed to take before a user calls it broken.
 *
 * Generous, because the first check of a session also pays for starting the
 * core subprocess and loading Harper's dictionary. A failure here is not a
 * slow machine: it is a check that never ran.
 */
const FIRST_CHECK_BUDGET_MS = 30_000;

suite('startup', () => {
    suiteSetup(async function () {
        this.timeout(60_000);
        const extension = vscode.extensions.getExtension(EXTENSION_ID);
        assert.ok(extension, `${EXTENSION_ID} is not installed in the test instance`);
        await extension.activate();
    });

    test('a document open at startup is checked without anything else being opened', async function () {
        this.timeout(FIRST_CHECK_BUDGET_MS + 15_000);
        // The reported failure: squiggles appeared only once the Inspector was
        // opened, because opening it fires a check of its own. So this test
        // opens nothing but the document -- no Inspector, no SpeedFix, no
        // command -- and the assertion is that a check happened anyway.
        const uri = fixture('notes.md');
        await openInEditor(uri);

        const diagnostics = await eventually(
            'diagnostics on notes.md with nothing but the document opened',
            () => {
                const found = ourDiagnostics(uri);
                return found.length > 0 ? found : undefined;
            },
            FIRST_CHECK_BUDGET_MS,
        );

        assert.ok(
            diagnostics.some(d => /recieve|seperate|committe/.test(
                vscode.workspace.textDocuments
                    .find(doc => doc.uri.toString() === uri.toString())!
                    .getText(d.range),
            )),
            `the planted misspellings were not among ${diagnostics.length} diagnostics: ` +
            diagnostics.map(d => d.message).join(' | '),
        );
    });

    test('a document opened later is checked too', async function () {
        this.timeout(FIRST_CHECK_BUDGET_MS);
        // The first check pays for startup; this one should not, so a failure
        // here is the open handler dropping the document rather than a slow
        // core. Same assertion, much tighter budget.
        const uri = fixture('second.md');
        await openInEditor(uri);

        await eventually(
            'diagnostics on a document opened after the core is running',
            () => (ourDiagnostics(uri).length > 0 ? true : undefined),
            15_000,
        );
    });

    test('inline hints appear for the diagnostics that qualify', async function () {
        this.timeout(FIRST_CHECK_BUDGET_MS);
        // The second reported failure. A hint needs a diagnostic above the
        // confidence floor carrying at least one suggestion, so the test first
        // establishes that such a diagnostic exists -- otherwise an empty hint
        // list is correct and the test would be asserting the wrong thing.
        const uri = fixture('notes.md');
        const document = await openInEditor(uri);

        await eventually(
            'diagnostics before asking for hints',
            () => (ourDiagnostics(uri).length > 0 ? true : undefined),
            FIRST_CHECK_BUDGET_MS,
        );

        // Polled rather than read once: the diagnostics landing and the hint
        // provider being re-queried are two separate events, and a hint that
        // arrives on the second query is working, not broken.
        const hints = await eventually(
            'at least one inlay hint',
            async () => {
                const found = await inlayHints(document);
                return found.length > 0 ? found : undefined;
            },
            15_000,
        );

        assert.ok(
            hints.length > 0,
            'the document has diagnostics with suggestions but the provider offered no hint',
        );
    });

    test('reopening a checked document does not lose its diagnostics', async function () {
        this.timeout(FIRST_CHECK_BUDGET_MS);
        // Switching tabs is the other path into the check, and it is guarded
        // by "only if we do not already have diagnostics". A document that
        // goes quiet on the way back is that guard reading a map the check
        // never wrote to.
        const first = fixture('notes.md');
        const second = fixture('second.md');

        await openInEditor(second);
        await openInEditor(first);

        await eventually(
            'diagnostics still present after switching back',
            () => (ourDiagnostics(first).length > 0 ? true : undefined),
            10_000,
        );
    });
});
