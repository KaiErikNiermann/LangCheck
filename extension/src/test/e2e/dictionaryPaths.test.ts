/**
 * Adding a wordlist, and when its words stop being reported.
 *
 * `dictionaries.paths` can be set in two places that take different routes
 * into the core -- the workspace config, which reaches it through a file
 * watcher, and the VS Code setting, which reaches it through a settings
 * listener. Both are meant to apply without a reload, and a user cannot tell
 * which route their edit took, so both are held to the same thing here.
 *
 * The last test asks a different question: whether editing the wordlist itself
 * applies, as opposed to editing the config that names it.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';

import { eventually, fixture, openInEditor, ourDiagnostics } from './helpers';

const BUDGET_MS = 45_000;
const WORDLIST = '.languagecheck/project-terms.txt';
/** In the wordlist from the start. */
const IN_THE_LIST = ['zblorptastic', 'quuxified'];
/** In the document but not the wordlist, so a test can append it. */
const ADDED_LATER = 'wibblified';
/** Reported whatever the dictionaries say. */
const CONTROL = 'recieve';

const WITH_PATHS =
    `engines:\n  harper: true\ndictionaries:\n  paths:\n    - ${WORDLIST}\n`;

function flagged(document: vscode.TextDocument): Set<string> {
    return new Set(
        ourDiagnostics(document.uri).map(d => document.getText(d.range).toLowerCase()),
    );
}

suite('dictionary paths', () => {
    let document: vscode.TextDocument;
    let configUri: vscode.Uri;
    let wordlistUri: vscode.Uri;
    let originalConfig: string;
    let originalWordlist: string;

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

    const read = async (uri: vscode.Uri) =>
        Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    const write = async (uri: vscode.Uri, text: string) =>
        vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'));

    suiteSetup(async function () {
        this.timeout(60_000);
        const extension = vscode.extensions.getExtension('KaiErikNiermann.language-check');
        assert.ok(extension);
        await extension.activate();

        configUri = fixture('.languagecheck.yaml');
        wordlistUri = fixture(WORDLIST);
        originalConfig = await read(configUri);
        originalWordlist = await read(wordlistUri);
        document = await openInEditor(fixture('doc.md'));
    });

    teardown(async function () {
        this.timeout(BUDGET_MS + 15_000);
        await write(wordlistUri, originalWordlist);
        await write(configUri, originalConfig);
        await vscode.workspace.getConfiguration('languageCheck')
            .update('dictionaries.paths', undefined, vscode.ConfigurationTarget.Workspace);
        await settlesTo(
            'the baseline to be back, with the wordlist not in use',
            words =>
                IN_THE_LIST.every(w => words.has(w))
                && words.has(ADDED_LATER)
                && words.has(CONTROL),
        );
    });

    test('without the path, the project words are reported', async function () {
        this.timeout(BUDGET_MS + 15_000);
        // The baseline the rest measures against: if these were accepted
        // already, adding the wordlist could not be shown to do anything.
        await settlesTo(
            'the project words to be reported before the wordlist is added',
            words => IN_THE_LIST.every(w => words.has(w)) && words.has(ADDED_LATER),
        );
    });

    test('adding the path to the workspace config applies without a reload', async function () {
        this.timeout(BUDGET_MS + 15_000);
        await settlesTo('the baseline', words => IN_THE_LIST.every(w => words.has(w)));

        await write(configUri, WITH_PATHS);

        // The control is part of the condition, not an assertion after it:
        // "none of these are reported" is also true of a document that has no
        // diagnostics at all, which is the state a reinitialize passes through
        // before the re-check lands.
        await settlesTo(
            'every word in the list to stop being reported, with checking still running',
            found => IN_THE_LIST.every(w => !found.has(w)) && found.has(CONTROL),
        );
    });

    test('adding the path as a VS Code setting applies without a reload', async function () {
        this.timeout(BUDGET_MS + 15_000);
        await settlesTo('the baseline', words => IN_THE_LIST.every(w => words.has(w)));

        // The other route into the same field. A user setting this in the
        // Settings UI has no way of knowing it is handled by different code
        // from the same key in the YAML.
        await vscode.workspace.getConfiguration('languageCheck')
            .update('dictionaries.paths', [WORDLIST], vscode.ConfigurationTarget.Workspace);

        await settlesTo(
            'every word in the list to stop being reported, with checking still running',
            found => IN_THE_LIST.every(w => !found.has(w)) && found.has(CONTROL),
        );
    });

    test('a word added to the wordlist applies without a reload', async function () {
        this.timeout(BUDGET_MS + 30_000);
        // The config names the list; this edits the list. Editing a wordlist
        // is the ordinary way to use one -- more ordinary than editing the
        // config that names it -- so a word added there has to take effect the
        // same way, or the feature works once and then appears to stop.
        await write(configUri, WITH_PATHS);
        await settlesTo(
            'the wordlist to be in use',
            words => IN_THE_LIST.every(w => !words.has(w)) && words.has(ADDED_LATER),
        );

        // A word the document uses and the list does not yet carry, so its
        // acceptance is an unambiguous consequence of this edit. The control
        // stays in the condition, so an empty document cannot satisfy it.
        await write(wordlistUri, `${originalWordlist}\n${ADDED_LATER}\n`);

        await settlesTo(
            'the newly added word to stop being reported',
            words => !words.has(ADDED_LATER) && words.has(CONTROL),
        );
    });
});
