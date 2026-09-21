/**
 * Which files a project checks, changed while the editor is open.
 *
 * `include`, `file_types` and `exclude` are one decision made in three
 * places -- the indexer, the CLI and the editor -- and the failure they exist
 * to prevent is those three disagreeing. The way a user meets that failure is
 * narrowing the config and watching a file go on being checked anyway, so
 * that is what these pin.
 *
 * Every case edits the config and waits for the squiggles to follow, in the
 * same window. "Takes effect on the next reload" is especially poor for this
 * setting: the edit looks like it did nothing.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';

import { eventually, fixture, openInEditor, ourDiagnostics } from './helpers';

const BUDGET_MS = 45_000;

const BASE = 'engines:\n  harper: true\n  spell_language: "en-US"\n';

suite('what the config selects', () => {
    let configUri: vscode.Uri;
    let docsGuide: vscode.TextDocument;
    let srcNotes: vscode.TextDocument;
    let srcHtml: vscode.TextDocument;

    const reported = (document: vscode.TextDocument) =>
        ourDiagnostics(document.uri).length > 0;

    /** Write the config. The check follows from the watcher, not from here. */
    async function useConfig(yaml: string): Promise<void> {
        await vscode.workspace.fs.writeFile(configUri, Buffer.from(yaml, 'utf8'));
    }

    /**
     * Wait for the three documents to settle, showing each one as we poll.
     *
     * A config change clears every diagnostic and re-checks what is visible,
     * and a single editor column shows one document at a time -- so a
     * document left hidden waits for a check that is correctly not being run.
     * Bringing each into view is what a user does, and it is what makes the
     * three answers comparable.
     */
    async function settles(what: string, want: () => boolean): Promise<void> {
        await eventually(
            what,
            async () => {
                for (const document of [docsGuide, srcNotes, srcHtml]) {
                    await vscode.window.showTextDocument(document, { preview: false });
                }
                return want() ? true : undefined;
            },
            BUDGET_MS,
            500,
        );
    }

    suiteSetup(async function () {
        this.timeout(90_000);
        const extension = vscode.extensions.getExtension('KaiErikNiermann.language-check');
        assert.ok(extension);
        await extension.activate();

        configUri = fixture('.languagecheck.yaml');
        docsGuide = await openInEditor(fixture('docs/guide.md'));
        srcNotes = await openInEditor(fixture('src/notes.md'));
        srcHtml = await openInEditor(fixture('src/notes.html'));
    });

    suiteTeardown(async function () {
        this.timeout(BUDGET_MS);
        await vscode.workspace.fs.writeFile(configUri, Buffer.from(BASE, 'utf8'));
    });

    teardown(async function () {
        this.timeout(BUDGET_MS);
        await useConfig(BASE);
        await settles(
            'the unnarrowed config to be back in force',
            () => reported(docsGuide) && reported(srcNotes) && reported(srcHtml),
        );
    });

    test('with no include, everything the grammars recognise is checked', async function () {
        this.timeout(BUDGET_MS + 30_000);
        await useConfig(BASE);
        await settles(
            'all three files to be checked',
            () => reported(docsGuide) && reported(srcNotes) && reported(srcHtml),
        );
    });

    test('adding an include narrows the project without a reload', async function () {
        this.timeout(BUDGET_MS + 30_000);
        await useConfig(BASE);
        await settles('the baseline', () => reported(srcNotes));

        await useConfig(`${BASE}include:\n  - "docs/**"\n`);
        await settles(
            'the files outside docs/ to stop being checked',
            () => reported(docsGuide) && !reported(srcNotes) && !reported(srcHtml),
        );
    });

    test('widening the include brings the others back, also without a reload', async function () {
        this.timeout(BUDGET_MS + 45_000);
        await useConfig(`${BASE}include:\n  - "docs/**"\n`);
        await settles('the narrowed config', () => !reported(srcNotes));

        await useConfig(`${BASE}include:\n  - "docs/**"\n  - "src/**"\n`);
        await settles(
            'the widened config to reach src/ again',
            () => reported(docsGuide) && reported(srcNotes),
        );
    });

    test('file_types restricts by extension, leaving the same directory split', async function () {
        this.timeout(BUDGET_MS + 30_000);
        await useConfig(BASE);
        await settles('the baseline', () => reported(srcHtml));

        // Same tree, same include: only the type changes.
        await useConfig(`${BASE}file_types:\n  - "md"\n`);
        await settles(
            'the HTML file to stop being checked while the Markdown ones stay',
            () => reported(docsGuide) && reported(srcNotes) && !reported(srcHtml),
        );
    });

    test('exclude subtracts from include, and not the other way round', async function () {
        this.timeout(BUDGET_MS + 30_000);
        await useConfig(`${BASE}include:\n  - "docs/**"\n  - "src/**"\n`);
        await settles('both trees', () => reported(docsGuide) && reported(srcNotes));

        // A path both lists name is excluded: that is what makes "narrow to
        // docs/, minus its build output" expressible at all.
        await useConfig(
            `${BASE}include:\n  - "docs/**"\n  - "src/**"\nexclude:\n  - "src/**"\n`,
        );
        await settles(
            'the excluded tree to go despite being included',
            () => reported(docsGuide) && !reported(srcNotes),
        );
    });

    test('an empty include is no opinion, not an empty selection', async function () {
        this.timeout(BUDGET_MS + 30_000);
        // The opposite reading turns an accidental empty list into a checker
        // that silently does nothing at all.
        await useConfig(`${BASE}include: []\n`);
        await settles(
            'everything to still be checked',
            () => reported(docsGuide) && reported(srcNotes) && reported(srcHtml),
        );
    });
});
