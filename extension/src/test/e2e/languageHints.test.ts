/**
 * The ghost text after a bare language tag, naming what it is checked as.
 *
 * Asserted by the text in front of each hint, not by a count: a `-DE` drawn
 * after the wrong token is still a hint, and only its position says whether
 * it reads as `de-DE`. `fr` resolves to itself and must stay bare.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';

import { eventually, fixture, inlayHints, openInEditor } from './helpers';

const BUDGET_MS = 45_000;

function label(hint: vscode.InlayHint): string {
    return typeof hint.label === 'string' ? hint.label : hint.label.map(part => part.value).join('');
}

/** The text on the hint's line up to the hint, with its label. */
function placed(document: vscode.TextDocument, hint: vscode.InlayHint): string {
    const line = document.lineAt(hint.position.line).text;
    return `${line.slice(0, hint.position.character)}|${label(hint)}`;
}

suite('language resolution hints', () => {
    suiteSetup(async function () {
        this.timeout(90_000);
        const extension = vscode.extensions.getExtension('KaiErikNiermann.language-check');
        assert.ok(extension);
        await extension.activate();
    });

    test('a bare region tag in a document shows its variant', async function () {
        this.timeout(BUDGET_MS + 15_000);
        const document = await openInEditor(fixture('doc.md'));
        const hints = await eventually(
            'the de hint to appear',
            async () => {
                const found = (await inlayHints(document)).filter(h => label(h).startsWith('-'));
                return found.length > 0 ? found : undefined;
            },
            BUDGET_MS,
        );
        assert.deepStrictEqual(hints.map(h => placed(document, h)), ['<!-- lang: de|-DE']);
    });

    test('a bare spell_language in the config shows its variant inside the quotes', async function () {
        this.timeout(BUDGET_MS + 15_000);
        const document = await openInEditor(fixture('.languagecheck.yaml'));
        const hints = await eventually(
            'the spell_language hint to appear',
            async () => {
                const found = (await inlayHints(document)).filter(h => label(h) === '-US');
                return found.length > 0 ? found : undefined;
            },
            BUDGET_MS,
        );
        assert.deepStrictEqual(hints.map(h => placed(document, h)), ['  spell_language: "en|-US']);
    });
});
