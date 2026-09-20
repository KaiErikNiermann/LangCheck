/**
 * The optional engines: switching one on, and being told when one cannot run.
 *
 * Vale is skipped when the binary is absent rather than failed, because it is
 * a separate install and a checkout without it should still run the suite.
 * The LanguageTool half needs nothing installed -- the point of it is what
 * happens when the server is *not* reachable, which is the state most users
 * meet first.
 */
import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as vscode from 'vscode';

import { eventually, fixture, openInEditor, ourDiagnostics } from './helpers';
import { recordWarnings } from './promptMemory';

const BUDGET_MS = 45_000;
const CONTROL = 'recieve';

function ours(uri: vscode.Uri) {
    return ourDiagnostics(uri);
}

function hasRulePrefix(uri: vscode.Uri, prefix: string): boolean {
    return ours(uri).some(d => typeof d.code === 'string' && d.code.startsWith(prefix));
}

function control(document: vscode.TextDocument): vscode.Diagnostic | undefined {
    return ours(document.uri).find(
        d => document.getText(d.range).toLowerCase() === CONTROL,
    );
}

/** Whether a binary is on PATH, so a missing optional tool skips rather than fails. */
function onPath(binary: string): boolean {
    try {
        execFileSync('which', [binary], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

suite('optional engines', () => {
    let document: vscode.TextDocument;
    let configUri: vscode.Uri;
    let originalConfig: string;

    async function settlesTo(what: string, want: () => boolean) {
        await vscode.window.showTextDocument(document, { preview: false });
        return eventually(what, () => (want() ? true : undefined), BUDGET_MS);
    }

    const write = async (text: string) =>
        vscode.workspace.fs.writeFile(configUri, Buffer.from(text, 'utf8'));

    suiteSetup(async function () {
        this.timeout(60_000);
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
        this.timeout(BUDGET_MS + 15_000);
        await write(originalConfig);
        await settlesTo(
            'the baseline to be back, with Harper alone and nothing failing',
            () => control(document) !== undefined
                && !hasRulePrefix(document.uri, 'vale.')
                && !hasRulePrefix(document.uri, 'languagecheck.engine-error'),
        );
    });

    test('switching Vale on activates it without a reload', async function () {
        this.timeout(BUDGET_MS + 15_000);
        if (!onPath('vale')) {
            this.skip();
            return;
        }
        await settlesTo(
            'the baseline, with nothing from Vale',
            () => control(document) !== undefined && !hasRulePrefix(document.uri, 'vale.'),
        );

        await write(
            'engines:\n  harper: true\n  vale:\n    enabled: true\n    config: ".vale.ini"\n',
        );

        await settlesTo(
            'Vale to start reporting alongside Harper',
            () => hasRulePrefix(document.uri, 'vale.') && control(document) !== undefined,
        );
    });

    test('switching Vale off again stops it', async function () {
        this.timeout(BUDGET_MS + 15_000);
        if (!onPath('vale')) {
            this.skip();
            return;
        }
        await write(
            'engines:\n  harper: true\n  vale:\n    enabled: true\n    config: ".vale.ini"\n',
        );
        await settlesTo('Vale to be running', () => hasRulePrefix(document.uri, 'vale.'));

        await write(originalConfig);

        await settlesTo(
            'Vale to stop while Harper keeps going',
            () => !hasRulePrefix(document.uri, 'vale.') && control(document) !== undefined,
        );
    });

    test('an unusable LanguageTool url is reported, and says which setting', async function () {
        this.timeout(BUDGET_MS + 30_000);
        // Reported through the health notification, not as a diagnostic on the
        // prose. The `engine-error` diagnostic only appears when a range has
        // nothing from any engine, and Harper is running here -- which is the
        // right design, since the passage *was* checked, but it means the
        // notification is the only place the failure surfaces.
        const warnings = recordWarnings();
        try {
            await write(
                'engines:\n  harper: true\n  languagetool:\n    enabled: true\n    url: ""\n',
            );

            // The notification is an escalation, not the first response. An
            // engine is "degraded" for its first two consecutive failures and
            // only "down" after that, so a transient blip does not raise a
            // dialog -- which means reaching it takes more than one check.
            // The status bar says "LT degraded" in the meantime.
            const raised = await eventually(
                'a warning naming LanguageTool, once the failures have escalated',
                async () => {
                    const found = warnings.seen.filter(w => /LanguageTool/i.test(w.message));
                    if (found.length > 0) return found;
                    await vscode.commands.executeCommand('language-check.checkDocument');
                    return undefined;
                },
                BUDGET_MS,
            );

            // The message has to be actionable. "builder error", which is what
            // this used to say, is not.
            const text = raised.map(w => w.message).join(' | ');
            assert.ok(
                text.includes('engines.languagetool.url'),
                `the warning does not name the setting: ${text}`,
            );
            assert.ok(
                text.includes('http://localhost:8010'),
                `the warning does not give a value that works: ${text}`,
            );
        } finally {
            warnings.restore();
        }
    });

    test('a working engine keeps working while another is misconfigured', async function () {
        this.timeout(BUDGET_MS + 15_000);
        // One engine being down must not take the others with it, or a typo
        // in a url silently stops all checking.
        const warnings = recordWarnings();
        try {
            await write(
                'engines:\n  harper: true\n  languagetool:\n    enabled: true\n    url: "not a url"\n',
            );

            await settlesTo(
                'Harper to keep reporting although LanguageTool cannot run',
                () => control(document) !== undefined,
            );
        } finally {
            warnings.restore();
        }
    });

    test('with nothing else running, the passage is reported as unchecked', async function () {
        this.timeout(BUDGET_MS + 30_000);
        // The other half of the design above. When LanguageTool is the only
        // engine and it cannot run, the prose must not come back looking
        // clean -- that is worse than a wrong answer, because nothing says
        // the passage went unchecked.
        const warnings = recordWarnings();
        try {
            await write(
                'engines:\n  harper: false\n  languagetool:\n    enabled: true\n    url: ""\n',
            );

            await settlesTo(
                'the unchecked-passage report',
                () => hasRulePrefix(document.uri, 'languagecheck.engine-error'),
            );

            const reported = ours(document.uri)
                .filter(d => d.code === 'languagecheck.engine-error')
                .map(d => d.message)
                .join(' | ');
            assert.ok(
                reported.includes('engines.languagetool.url'),
                `the report does not name the setting: ${reported}`,
            );
        } finally {
            warnings.restore();
        }
    });
});
