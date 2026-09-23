/**
 * SLS schemas, in the editor.
 *
 * Two things stood between a schema and a squiggle, and fixing either alone
 * would have changed nothing.
 *
 * The extension decided what to check by VS Code's language id, and a schema
 * language has no id there -- a `.toy` file arrives as `plaintext`. So the
 * core, which would have used the schema, was never asked. It now also accepts
 * a document whose file extension the core reports as schema-handled.
 *
 * And the schema directory was read once, at Initialize, so editing a schema
 * did nothing until the next reload. Writing a schema is iterative by nature:
 * run the checker, adjust the patterns, run it again. A reload between every
 * pair of those is the difference between usable and not.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';

import { eventually, fixture, openInEditor, ourDiagnostics } from './helpers';

const BUDGET_MS = 45_000;
const SCHEMA = '.langcheck/schemas/toy.yaml';
/** On a line the schema calls prose. */
const IN_PROSE = 'recieve';
/** On a line the schema skips, until a test widens it. */
const IN_SKIPPED = 'seperate';

function flagged(document: vscode.TextDocument): Set<string> {
    return new Set(
        ourDiagnostics(document.uri).map(d => document.getText(d.range).toLowerCase()),
    );
}

suite('SLS schemas', () => {
    let document: vscode.TextDocument;
    let schemaUri: vscode.Uri;
    let originalSchema: string;

    async function settlesTo(what: string, want: (words: Set<string>) => boolean) {
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

        schemaUri = fixture(SCHEMA);
        originalSchema = Buffer.from(
            await vscode.workspace.fs.readFile(schemaUri),
        ).toString('utf8');
        document = await openInEditor(fixture('doc.toy'));
    });

    teardown(async function () {
        this.timeout(BUDGET_MS + 15_000);
        await vscode.workspace.fs.writeFile(schemaUri, Buffer.from(originalSchema, 'utf8'));
        await settlesTo(
            'the original schema to be back in force',
            words => words.has(IN_PROSE) && !words.has(IN_SKIPPED),
        );
    });

    test('saving a schema-only document re-checks it', async function () {
        // The save handler used to test VS Code's language id against the
        // built-in list, which a schema file never matches, so under the
        // default onSave trigger an edit here was never checked at all.
        //
        // First in the suite on purpose: the teardown rewrites the schema,
        // and the re-check that sets off would land on the unsaved edit and
        // check it for reasons that have nothing to do with saving.
        this.timeout(BUDGET_MS + 30_000);
        await settlesTo('the original findings', words => words.has(IN_PROSE));
        const original = document.getText();
        const editor = await vscode.window.showTextDocument(document, { preview: false });
        try {
            await editor.edit(edit => edit.insert(document.positionAt(original.length), 'PROSE Anothr line.\n'));
            await new Promise(resolve => setTimeout(resolve, 3_000));
            assert.ok(!flagged(document).has('anothr'), 'the unsaved edit was already checked, so this is not testing the save');
            await document.save();
            await settlesTo('the saved line to be checked', words => words.has('anothr'));
        } finally {
            await editor.edit(edit => edit.delete(new vscode.Range(
                document.positionAt(original.length), document.positionAt(document.getText().length))));
            await document.save();
        }
    });

    test('a document only a schema understands is checked', async function () {
        this.timeout(BUDGET_MS + 15_000);
        // VS Code calls this file plaintext. That it is checked at all is the
        // assertion; which lines are checked is the next test.
        assert.notStrictEqual(
            document.languageId,
            'toy',
            'the fixture gained a real language id, so this no longer tests the fallback',
        );
        await settlesTo(
            'the prose line to be checked',
            words => words.has(IN_PROSE),
        );
    });

    test('the schema decides which lines are prose', async function () {
        this.timeout(BUDGET_MS + 15_000);
        // A skipped line must stay skipped, or "the file is checked" would be
        // true of a schema that was never consulted.
        const words = await settlesTo(
            'the prose line checked and the skipped line not',
            found => found.has(IN_PROSE),
        );
        assert.ok(
            !words.has(IN_SKIPPED),
            'a line the schema skips was checked, so the schema was not used',
        );
    });

    test('editing the schema applies without a reload', async function () {
        this.timeout(BUDGET_MS + 30_000);
        await settlesTo('the original schema', words => !words.has(IN_SKIPPED));

        // Widened so the previously skipped line counts as prose. The typo on
        // it is in the document already, so its appearance is an unambiguous
        // consequence of this edit.
        await vscode.workspace.fs.writeFile(
            schemaUri,
            Buffer.from(
                'name: toy\nextensions: [toy]\nprose_patterns:\n'
                + '  - pattern: "^PROSE (.*)$"\n  - pattern: "^SKIP (.*)$"\n',
                'utf8',
            ),
        );

        await settlesTo(
            'the newly-prose line to be checked',
            words => words.has(IN_SKIPPED) && words.has(IN_PROSE),
        );
    });
});
