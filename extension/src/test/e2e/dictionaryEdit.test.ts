/**
 * Adding a word to a wordlist by hand.
 *
 * A dictionary entry can only ever remove spelling findings: the core applies
 * the dictionary as a suppression after the engines have run, exactly as it
 * applies a severity override. Re-running the engines therefore reaches an
 * answer the editor is already holding, and the re-check path clears every
 * diagnostic first -- so the whole file blanks and fills back in to arrive at
 * what was already on screen, minus one word.
 *
 * Asserted the way a user notices it: by watching the findings that are *not*
 * being accepted and requiring that they never go away.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';

import { eventually, fixture, openInEditor, ourDiagnostics } from './helpers';

const BUDGET_MS = 45_000;

suite('dictionary edits', () => {
    let document: vscode.TextDocument;
    let wordsUri: vscode.Uri;
    let originalWords: string;

    const words = () => new Set(
        ourDiagnostics(document.uri).map(d => document.getText(d.range).toLowerCase()),
    );

    suiteSetup(async function () {
        this.timeout(90_000);
        const extension = vscode.extensions.getExtension('KaiErikNiermann.language-check');
        assert.ok(extension);
        await extension.activate();

        wordsUri = fixture('words.txt');
        originalWords = Buffer.from(
            await vscode.workspace.fs.readFile(wordsUri),
        ).toString('utf8');
        document = await openInEditor(fixture('doc.md'));
    });

    teardown(async function () {
        this.timeout(BUDGET_MS);
        await vscode.workspace.fs.writeFile(wordsUri, Buffer.from(originalWords, 'utf8'));
        await eventually(
            'the baseline wordlist to be back in force',
            () => (words().has('zorblat') ? true : undefined),
            BUDGET_MS,
        );
    });

    async function baseline(): Promise<void> {
        await vscode.window.showTextDocument(document, { preview: false });
        await eventually(
            'every made-up word to be reported first',
            () => {
                const found = words();
                return found.has('zorblat') && found.has('quixotrons') && found.has('recieve')
                    ? true
                    : undefined;
            },
            BUDGET_MS,
        );
    }

    test('a word added by hand stops being reported', async function () {
        this.timeout(BUDGET_MS + 30_000);
        await baseline();

        await vscode.workspace.fs.writeFile(
            wordsUri,
            Buffer.from(`${originalWords}zorblat\n`, 'utf8'),
        );

        await eventually(
            'the accepted word to go',
            () => (!words().has('zorblat') ? true : undefined),
            BUDGET_MS,
        );
        const found = words();
        assert.ok(found.has('quixotrons'), 'an unrelated finding was dropped');
        assert.ok(found.has('recieve'), 'an unrelated finding was dropped');
    });

    test('accepting a word does not re-check the document', async function () {
        this.timeout(BUDGET_MS + 60_000);
        await baseline();

        let othersEverGone = false;
        const watching = setInterval(() => {
            if (!words().has('recieve')) othersEverGone = true;
        }, 10);

        try {
            await vscode.workspace.fs.writeFile(
                wordsUri,
                Buffer.from(`${originalWords}zorblat\n`, 'utf8'),
            );
            await eventually(
                'the accepted word to go',
                () => (!words().has('zorblat') ? true : undefined),
                BUDGET_MS,
            );
            // Long enough to cover the check a re-check would have run.
            await new Promise(resolve => setTimeout(resolve, 6_000));
        } finally {
            clearInterval(watching);
        }

        assert.strictEqual(
            othersEverGone,
            false,
            'the other diagnostics disappeared, so the document was re-checked',
        );
    });

    test('several words added at once are all accepted', async function () {
        this.timeout(BUDGET_MS + 30_000);
        await baseline();

        await vscode.workspace.fs.writeFile(
            wordsUri,
            Buffer.from(`${originalWords}zorblat\nquixotrons\n`, 'utf8'),
        );

        await eventually(
            'both accepted words to go',
            () => {
                const found = words();
                return !found.has('zorblat') && !found.has('quixotrons') ? true : undefined;
            },
            BUDGET_MS,
        );
        assert.ok(words().has('recieve'), 'an ordinary misspelling was dropped too');
    });

    test('removing a word brings its findings back, which does need the check', async function () {
        this.timeout(BUDGET_MS + 60_000);
        await baseline();
        await vscode.workspace.fs.writeFile(
            wordsUri,
            Buffer.from(`${originalWords}zorblat\n`, 'utf8'),
        );
        await eventually(
            'the word to be accepted',
            () => (!words().has('zorblat') ? true : undefined),
            BUDGET_MS,
        );

        // The finding was suppressed in the core and never reached the editor,
        // so there is nothing to un-filter: only a real check brings it back.
        // This is the half that breaks if the cheap path is taken for every
        // wordlist edit.
        await vscode.workspace.fs.writeFile(wordsUri, Buffer.from(originalWords, 'utf8'));
        await vscode.window.showTextDocument(document, { preview: false });
        await eventually(
            'the word to be reported again',
            () => (words().has('zorblat') ? true : undefined),
            BUDGET_MS,
        );
    });
});
