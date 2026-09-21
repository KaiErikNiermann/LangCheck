/**
 * Where the editor draws "nothing reads this language".
 *
 * Two passages in one document, declared two different ways. The Latin is
 * simply written there, so the passage is all there is to point at; the
 * Hebrew is inside a pragma, so the pragma is the thing to change. Both are
 * asserted by the text under the squiggle, not by the count of findings --
 * a report in the wrong place is still a report, and counting cannot tell.
 *
 * Hebrew renders right to left, so the first logical word appears at the
 * visual right of the line. A correct span therefore looks misplaced to
 * anyone reading the screen left to right, which is exactly why this asserts
 * offsets and never appearance.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';

import { eventually, fixture, openInEditor, ourDiagnostics } from './helpers';

const BUDGET_MS = 45_000;

suite('unchecked-language reports', () => {
    let document: vscode.TextDocument;

    function reports(): vscode.Diagnostic[] {
        return ourDiagnostics(document.uri)
            .filter(d => d.code === 'languagecheck.no-provider')
            .sort((a, b) => a.range.start.line - b.range.start.line);
    }

    suiteSetup(async function () {
        this.timeout(90_000);
        const extension = vscode.extensions.getExtension('KaiErikNiermann.language-check');
        assert.ok(extension);
        await extension.activate();
        document = await openInEditor(fixture('doc.md'));
        await eventually(
            'both passages to be reported',
            () => (reports().length >= 2 ? true : undefined),
            BUDGET_MS,
        );
    });

    test('the declared passage is marked on its declaration', async function () {
        this.timeout(BUDGET_MS + 15_000);
        const text = document.getText();
        const pragmaLine = document.positionAt(text.indexOf('<!-- lang-check-begin')).line;
        const onPragma = reports().find(d => d.range.start.line === pragmaLine);
        assert.ok(
            onPragma,
            `nothing marked the pragma; lines: ${reports().map(d => d.range.start.line)}`,
        );
        assert.strictEqual(
            document.getText(onPragma.range),
            'lang:he',
            'the squiggle does not cover the declaration exactly',
        );
    });

    test('the Hebrew prose itself is left unmarked', async function () {
        this.timeout(BUDGET_MS + 15_000);
        const text = document.getText();
        const hebrewLine = document.positionAt(text.indexOf('שלום')).line;
        assert.ok(
            !reports().some(d => d.range.start.line === hebrewLine),
            'the prose was marked instead of the declaration that named its language',
        );
    });

    test('the undeclared passage is marked at its own first word', async function () {
        this.timeout(BUDGET_MS + 15_000);
        const text = document.getText();
        const latin = 'Gallia est omnis divisa in partes tres.';
        const latinLine = document.positionAt(text.indexOf(latin)).line;
        const onLatin = reports().find(d => d.range.start.line === latinLine);
        assert.ok(
            onLatin,
            `nothing marked the Latin; lines: ${reports().map(d => d.range.start.line)}`,
        );
        assert.strictEqual(
            onLatin.range.start.character,
            0,
            'the report should start at the first word of the passage',
        );
    });

    test('a report carries the language it is about, for the install offer', async function () {
        this.timeout(BUDGET_MS + 15_000);
        // The tag is read off the wire rather than parsed out of the message,
        // which is where a spurious offer would come from.
        assert.ok(reports().length >= 2, 'both passages should be reported');
        for (const report of reports()) {
            assert.match(report.message, /No enabled engine reads/);
        }
    });
});
