/**
 * Identifier-shaped tokens are not checked, and the setting that says so
 * reaches the core.
 *
 * `rust-core/src/suppression.rs` holds the rule against hand-built
 * diagnostics. This holds it against what Harper actually reports in a real
 * editor, where the span is not the token: for `parse_json_blob` Harper flags
 * `json`, as a capitalisation error rather than a misspelling.
 *
 * Every squiggle below was measured with `language-check check` against the
 * fixture, with the filter on and off, before being written down.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';

import { eventually, fixture, openInEditor, ourDiagnostics } from './helpers';

const BUDGET_MS = 45_000;

/** The text under each squiggle Harper draws inside an identifier. */
const INSIDE_IDENTIFIERS = ['json', 'fooBarBaz', 'getElementById', 'XmlHttpRequest'];
/** An ordinary misspelling, reported under every configuration. */
const CONTROL = 'recieve';
/** A shift-key slip: camel-shaped, but Harper names the word it should be. */
const CASING_SLIP = 'tHe';

/** The text under every diagnostic of ours on the document, of any category. */
function squiggled(document: vscode.TextDocument): Set<string> {
    return new Set(ourDiagnostics(document.uri).map(d => document.getText(d.range)));
}

async function settlesTo(
    document: vscode.TextDocument,
    what: string,
    want: (texts: Set<string>) => boolean,
): Promise<Set<string>> {
    return eventually(
        what,
        () => {
            const texts = squiggled(document);
            return want(texts) ? texts : undefined;
        },
        BUDGET_MS,
    );
}

suite('identifiers', () => {
    let document: vscode.TextDocument;
    let originalConfigYaml: string;
    let configUri: vscode.Uri;

    suiteSetup(async function () {
        this.timeout(60_000);
        const extension = vscode.extensions.getExtension('KaiErikNiermann.language-check');
        assert.ok(extension);
        await extension.activate();

        document = await openInEditor(fixture('words.md'));
        configUri = fixture('.languagecheck.yaml');
        originalConfigYaml = Buffer.from(
            await vscode.workspace.fs.readFile(configUri),
        ).toString('utf8');
    });

    teardown(async function () {
        this.timeout(BUDGET_MS + 15_000);
        await vscode.workspace.fs.writeFile(configUri, Buffer.from(originalConfigYaml, 'utf8'));
        await settlesTo(
            document,
            'the default configuration to be restored',
            texts => texts.has(CONTROL) && !INSIDE_IDENTIFIERS.some(t => texts.has(t)),
        );
    });

    test('out of the box, nothing inside an identifier is squiggled', async function () {
        this.timeout(BUDGET_MS + 15_000);
        // Waiting on the control first: an empty document would also have no
        // squiggle on any identifier.
        const texts = await settlesTo(document, 'the control to be reported', t => t.has(CONTROL));
        for (const text of INSIDE_IDENTIFIERS) {
            assert.ok(!texts.has(text), `\`${text}\` was squiggled inside an identifier`);
        }
        assert.ok(texts.has(CASING_SLIP), 'the casing slip was suppressed as an identifier');
    });

    test('switching the filter off brings every identifier back', async function () {
        this.timeout(BUDGET_MS + 15_000);
        await vscode.workspace.fs.writeFile(
            configUri,
            Buffer.from('engines:\n  harper: true\nidentifiers:\n  enabled: false\n', 'utf8'),
        );
        const texts = await settlesTo(
            document,
            'the identifiers to be reported once the filter is off',
            t => INSIDE_IDENTIFIERS.every(text => t.has(text)),
        );
        assert.ok(texts.has(CONTROL), 'the control stopped being reported');
    });
});
