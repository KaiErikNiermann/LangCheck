/**
 * Silencing a rule, without re-checking the document.
 *
 * The core applies a `severity: "off"` override after the engines have run:
 * the diagnostic is produced and then dropped. Checking again therefore
 * reaches an answer the editor is already holding, so the work is pure cost
 * -- and it is not only slow. The re-check path clears every diagnostic
 * first, so the whole file goes blank and fills back in, for a rule the user
 * silenced precisely because they did not want to look at it.
 *
 * "Did not re-check" is asserted the way a user would notice it: by watching
 * the diagnostics that are *not* being silenced and requiring that they never
 * go away. A re-check makes them vanish for as long as the round trip takes,
 * and a poll that only looked at the end state would miss it.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';

import { eventually, fixture, openInEditor, ourDiagnostics } from './helpers';

const BUDGET_MS = 45_000;
const SILENCED = 'harper.Capitalization';
const SURVIVOR = 'harper.Spelling';

function withRule(uri: vscode.Uri, rule: string): vscode.Diagnostic[] {
    return ourDiagnostics(uri).filter(d => d.code === rule);
}

suite('deactivating a rule', () => {
    let document: vscode.TextDocument;
    let configUri: vscode.Uri;
    let originalConfig: string;

    suiteSetup(async function () {
        this.timeout(90_000);
        const extension = vscode.extensions.getExtension('KaiErikNiermann.language-check');
        assert.ok(extension);
        await extension.activate();

        configUri = fixture('.languagecheck.yaml');
        originalConfig = Buffer.from(
            await vscode.workspace.fs.readFile(configUri),
        ).toString('utf8');
        document = await openInEditor(fixture('doc.md'));
    });

    teardown(async function () {
        this.timeout(BUDGET_MS);
        await vscode.workspace.fs.writeFile(configUri, Buffer.from(originalConfig, 'utf8'));
        await eventually(
            'the baseline config to be back in force',
            () => (withRule(document.uri, SILENCED).length > 0 ? true : undefined),
            BUDGET_MS,
        );
    });

    test('the command removes that rule and leaves the others where they are', async function () {
        this.timeout(BUDGET_MS + 30_000);
        await vscode.window.showTextDocument(document, { preview: false });
        await eventually(
            'both rules to be reported first',
            () => (withRule(document.uri, SILENCED).length > 0
                && withRule(document.uri, SURVIVOR).length > 0
                ? true
                : undefined),
            BUDGET_MS,
        );
        const survivorsBefore = withRule(document.uri, SURVIVOR).length;

        // Sampled across the whole operation. The failure this guards against
        // is a flash of nothing, which a before-and-after look cannot see.
        let survivorsEverGone = false;
        const watching = setInterval(() => {
            if (withRule(document.uri, SURVIVOR).length === 0) survivorsEverGone = true;
        }, 10);

        try {
            await vscode.commands.executeCommand('language-check.deactivateRule', SILENCED);
            await eventually(
                'the silenced rule to go',
                () => (withRule(document.uri, SILENCED).length === 0 ? true : undefined),
                BUDGET_MS,
            );
            // Long enough to cover the check a re-check would have run.
            await new Promise(resolve => setTimeout(resolve, 6_000));
        } finally {
            clearInterval(watching);
        }

        assert.strictEqual(
            survivorsEverGone,
            false,
            'the diagnostics for other rules disappeared, so the document was re-checked',
        );
        assert.strictEqual(
            withRule(document.uri, SURVIVOR).length,
            survivorsBefore,
            'the surviving diagnostics changed in number',
        );
        assert.strictEqual(withRule(document.uri, SILENCED).length, 0);

        const written = Buffer.from(
            await vscode.workspace.fs.readFile(configUri),
        ).toString('utf8');
        assert.match(written, /harper\.Capitalization:\s*\n\s*severity:\s*"off"/);
    });

    test('silencing a rule by hand in the config also skips the re-check', async function () {
        this.timeout(BUDGET_MS + 30_000);
        await vscode.window.showTextDocument(document, { preview: false });
        await eventually(
            'both rules to be reported first',
            () => (withRule(document.uri, SILENCED).length > 0
                && withRule(document.uri, SURVIVOR).length > 0
                ? true
                : undefined),
            BUDGET_MS,
        );

        let survivorsEverGone = false;
        const watching = setInterval(() => {
            if (withRule(document.uri, SURVIVOR).length === 0) survivorsEverGone = true;
        }, 10);

        try {
            await vscode.workspace.fs.writeFile(
                configUri,
                Buffer.from(
                    `${originalConfig}rules:\n  ${SILENCED}:\n    severity: "off"\n`,
                    'utf8',
                ),
            );
            await eventually(
                'the silenced rule to go',
                () => (withRule(document.uri, SILENCED).length === 0 ? true : undefined),
                BUDGET_MS,
            );
            await new Promise(resolve => setTimeout(resolve, 6_000));
        } finally {
            clearInterval(watching);
        }

        assert.strictEqual(
            survivorsEverGone,
            false,
            'the other diagnostics flickered, so the edit took the re-check path',
        );
    });

    test('turning a rule back on does re-check, because the findings were never kept', async function () {
        this.timeout(BUDGET_MS + 60_000);
        await vscode.workspace.fs.writeFile(
            configUri,
            Buffer.from(
                `${originalConfig}rules:\n  ${SILENCED}:\n    severity: "off"\n`,
                'utf8',
            ),
        );
        await eventually(
            'the rule to be silenced',
            () => (withRule(document.uri, SILENCED).length === 0 ? true : undefined),
            BUDGET_MS,
        );

        // The core dropped these before they ever reached the editor, so
        // there is nothing to un-filter and only a real check can bring them
        // back. This is the half that would break if the cheap path were
        // applied to every config edit.
        await vscode.workspace.fs.writeFile(configUri, Buffer.from(originalConfig, 'utf8'));
        await vscode.window.showTextDocument(document, { preview: false });
        await eventually(
            'the rule to come back',
            () => (withRule(document.uri, SILENCED).length > 0 ? true : undefined),
            BUDGET_MS,
        );
    });
});
