/**
 * The inline directives, as they behave in an editor.
 *
 * Two questions that only a running editor answers. Whether a directive
 * changes what is reported *live*, when it is typed rather than when the file
 * is next opened. And whether a suppressed region is ever reported at all --
 * suppression that runs after the diagnostics have been published would show
 * as a flash of squiggles that then disappear, which is worse than not
 * suppressing, because it teaches the reader to distrust what they see.
 *
 * The second is why the suppression test polls from the moment the document
 * opens instead of waiting and then looking once. Waiting hides exactly the
 * failure being looked for.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';

import { eventually, fixture, openInEditor, ourDiagnostics } from './helpers';

const BUDGET_MS = 45_000;

/** Words French spelling accepts and English does not. */
const FRENCH_ONLY = ['chien', 'pomme', 'aujourdhui', 'probleme'];
/** Inside `lang-check-begin spelling.typo`. Never reported. */
const SUPPRESSED = 'seperate';
/** Outside every region. Always reported. */
const CONTROL = 'recieve';

function flagged(document: vscode.TextDocument): Set<string> {
    return new Set(
        ourDiagnostics(document.uri).map(d => document.getText(d.range).toLowerCase()),
    );
}

function hasNoProvider(uri: vscode.Uri): boolean {
    return ourDiagnostics(uri).some(d => d.code === 'languagecheck.no-provider');
}

suite('inline directives', () => {
    suiteSetup(async function () {
        this.timeout(60_000);
        const extension = vscode.extensions.getExtension('KaiErikNiermann.language-check');
        assert.ok(extension);
        await extension.activate();
        // The language override is typed rather than saved, so the check has
        // to follow the buffer and not the file.
        await vscode.workspace.getConfiguration('languageCheck')
            .update('check.trigger', 'onChange', vscode.ConfigurationTarget.Workspace);
    });

    suiteTeardown(async () => {
        await vscode.workspace.getConfiguration('languageCheck')
            .update('check.trigger', undefined, vscode.ConfigurationTarget.Workspace);
    });

    test('a suppressed region is never reported, not even briefly', async function () {
        this.timeout(BUDGET_MS + 15_000);
        const uri = fixture('regions.md');
        const document = await openInEditor(uri);

        // Sampled far more often than a check can complete, from before the
        // first one lands. If suppression were applied after publishing, the
        // squiggle would exist for a moment and this would catch it.
        let everFlagged = false;
        const watching = setInterval(() => {
            if (flagged(document).has(SUPPRESSED)) everFlagged = true;
        }, 15);

        try {
            await eventually(
                'the control to be reported, so a check demonstrably ran',
                () => (flagged(document).has(CONTROL) ? true : undefined),
                BUDGET_MS,
            );
            // Keep sampling past the first check: a second one follows any
            // edit or re-check and would have the same opportunity to flash.
            await new Promise(resolve => setTimeout(resolve, 3_000));
        } finally {
            clearInterval(watching);
        }

        assert.strictEqual(
            everFlagged,
            false,
            `${SUPPRESSED} was reported at some point inside a region that switches spelling off`,
        );
    });

    test('without a language override the French reads as English misspellings', async function () {
        this.timeout(BUDGET_MS + 15_000);
        // The baseline the next test moves away from. Asserted rather than
        // assumed, because if these were never reported the override could
        // not be shown to have done anything.
        const uri = fixture('regions.md');
        const document = await openInEditor(uri);

        await eventually(
            'the French words to be reported as English typos',
            () => (FRENCH_ONLY.every(w => flagged(document).has(w)) ? true : undefined),
            BUDGET_MS,
        );
    });

    test('typing a language override changes what is reported, without saving', async function () {
        this.timeout(BUDGET_MS + 30_000);
        const uri = fixture('regions.md');
        const document = await openInEditor(uri);
        const editor = await vscode.window.showTextDocument(document);

        await eventually(
            'the French words to be reported before the override',
            () => (FRENCH_ONLY.every(w => flagged(document).has(w)) ? true : undefined),
            BUDGET_MS,
        );

        // Located by content. `lineCount - 1` is the empty line after the
        // final newline, and a directive inserted there sits after the text it
        // was meant to cover -- which looks exactly like the override being
        // ignored.
        const frenchLine = document.getText()
            .split(/\r?\n/)
            .findIndex(line => line.includes('Le chien'));
        assert.ok(frenchLine >= 0, 'the fixture no longer contains the French line');
        try {
            await editor.edit(edit => {
                edit.insert(
                    new vscode.Position(frenchLine, 0),
                    '<!-- lang-check-begin lang:fr -->\n\n',
                );
            });
            assert.ok(document.isDirty, 'the override was not typed into the buffer');

            // Harper reads English only, so a region declared French reaches
            // no engine: the misspellings go and the core reports the passage
            // as unchecked instead. Both halves matter -- the words
            // disappearing alone would also happen if checking had stopped.
            await eventually(
                'the French misspellings to stop being reported',
                () => {
                    const words = flagged(document);
                    return FRENCH_ONLY.every(w => !words.has(w)) ? true : undefined;
                },
                BUDGET_MS,
            );
            await eventually(
                'the region to be reported as unchecked',
                () => (hasNoProvider(uri) ? true : undefined),
                BUDGET_MS,
            );

            assert.ok(
                flagged(document).has(CONTROL),
                'the control outside the region stopped being reported, so checking stopped',
            );
        } finally {
            // Typed, never saved, so the fixture on disk is untouched either
            // way -- but the buffer has to go back for the next test.
            await vscode.commands.executeCommand('workbench.action.files.revert');
        }
    });

    test('removing the override brings the misspellings back', async function () {
        this.timeout(BUDGET_MS + 30_000);
        // The other direction. A directive that could only ever add
        // suppression would look identical to one that is read once and then
        // cached forever, which is the thing to rule out now that a check
        // result is stored across sessions.
        const uri = fixture('regions.md');
        const document = await openInEditor(uri);

        await eventually(
            'the French words to be reported again after the revert',
            () => (FRENCH_ONLY.every(w => flagged(document).has(w)) ? true : undefined),
            BUDGET_MS,
        );
        assert.ok(!hasNoProvider(uri), 'the unchecked-region report outlived the directive');
    });
});
