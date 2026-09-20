/**
 * The dictionary offer, from the squiggle to the words it changes.
 *
 * The parts either side of this are covered elsewhere and deliberately not
 * repeated: `packs::install` unit-tests what it refuses -- plain http, a host
 * off the allowlist, a lookalike host, a full disk, an unwritable
 * destination, and content that does not match its pin -- and the Hunspell
 * smoke workflow drives a real install through the CLI on three platforms.
 *
 * What only a running editor shows is the join: that the offer appears for a
 * language nothing can read, that answering it runs the install, that the
 * result is applied without a reload, and that a failure reaches the user with
 * the core's own reason rather than something vaguer.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as assert from 'assert';
import * as vscode from 'vscode';

import { eventually, fixture, openInEditor, ourDiagnostics } from './helpers';
import { recordPrompts, recordWarnings } from './promptMemory';

const BUDGET_MS = 45_000;
/** As `extension.ts` builds them, through `vscode.l10n.t` with no bundle. */
const INSTALL = 'Install';
/** Harper reports this whatever happens to the Hebrew. */
const CONTROL = 'recieve';

/** Where `packs install` puts a pack when no directory is named. */
function packDirectory(): string {
    const data = process.env.XDG_DATA_HOME
        ?? path.join(os.homedir(), '.local', 'share');
    return path.join(data, 'language-check', 'dictionaries');
}

function hebrewPackPresent(): boolean {
    const dir = packDirectory();
    return fs.existsSync(path.join(dir, 'he_IL.dic'));
}

function hasNoProvider(uri: vscode.Uri): boolean {
    return ourDiagnostics(uri).some(d => d.code === 'languagecheck.no-provider');
}

function control(document: vscode.TextDocument): boolean {
    return ourDiagnostics(document.uri).some(
        d => document.getText(d.range).toLowerCase() === CONTROL,
    );
}

/** Whether the catalogue host can be reached, so a no-network run skips. */
function canReachCatalogue(): boolean {
    try {
        execFileSync('curl', [
            '--silent', '--head', '--max-time', '8',
            'https://raw.githubusercontent.com',
        ], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

suite('installing a dictionary pack', () => {
    let document: vscode.TextDocument;

    suiteSetup(async function () {
        this.timeout(60_000);
        const extension = vscode.extensions.getExtension('KaiErikNiermann.language-check');
        assert.ok(extension);
        await extension.activate();
    });

    test('the offer appears, is answered, and the dictionary takes effect', async function () {
        this.timeout(300_000);
        // One test, not three, because the offer is raised once per session:
        // a first test that watched it appear would consume it, and a second
        // one waiting to answer it would wait forever. That is the suppression
        // working, so the flow is asserted as the single story it is.
        const prompts = recordPrompts(INSTALL);
        const warnings = recordWarnings();
        const errors: string[] = [];
        const originalError = vscode.window.showErrorMessage;
        (vscode.window as unknown as Record<string, unknown>).showErrorMessage =
            (message: string) => {
                errors.push(message);
                return Promise.resolve(undefined);
            };
        const fetchable = canReachCatalogue() && !hebrewPackPresent();
        try {
            // Installed before the document opens: the offer is raised from
            // the check that opening triggers.
            document = await openInEditor(fixture('hebrew.md'));

            // Hunspell is enabled for Hebrew and has no dictionary, so the
            // passage reaches no engine and the core says so. That diagnostic
            // is what the offer is keyed on.
            await eventually(
                'the unchecked-language report',
                () => (hasNoProvider(document.uri) ? true : undefined),
                BUDGET_MS,
            );
            assert.ok(control(document), 'the rest of the document went unchecked too');

            const offers = await eventually(
                'an offer naming Hebrew',
                () => {
                    const found = prompts.forLanguage('he');
                    return found.length > 0 ? found : undefined;
                },
                BUDGET_MS,
            );
            assert.ok(
                offers[0]!.items.includes(INSTALL),
                `the offer must carry an install action, got: ${offers[0]!.items.join(', ')}`,
            );

            if (!fetchable) {
                // The pack is fetched from the network by design, and a
                // machine that already has it cannot show the change. The
                // offer half above is still worth asserting, so the test
                // stops here rather than skipping from the start.
                return;
            }

            // The install runs as a subprocess and ends with a reinitialize,
            // so the assertion is on the document rather than on the process:
            // the passage stops being reported as unreadable while the rest
            // of the document goes on being checked.
            //
            // The one failure worth short-circuiting is a missing CLI: the
            // extension shells out to `language-check` beside the server, and
            // a build that made only the server turns this into a four-minute
            // timeout that says nothing about why.
            await eventually(
                'the Hebrew passage to become readable',
                () => {
                    const missing = errors.find(m => /Could not find the language-check binary/.test(m));
                    if (missing) {
                        throw new Error(
                            'the language-check CLI is not beside the server binary, so the '
                            + 'install could never run; build it with '
                            + '`cargo build --release --bin language-check`',
                        );
                    }
                    return !hasNoProvider(document.uri) && control(document) ? true : undefined;
                },
                240_000,
            );

            assert.ok(
                hebrewPackPresent(),
                `the pack is not on disk at ${packDirectory()}`,
            );
        } finally {
            prompts.restore();
            warnings.restore();
            (vscode.window as unknown as Record<string, unknown>)
                .showErrorMessage = originalError;
            // The pack is installed into the user's data directory, so the
            // test puts it back the way it found it.
            if (fetchable) {
                const dir = packDirectory();
                for (const name of ['he_IL.aff', 'he_IL.dic']) {
                    const file = path.join(dir, name);
                    if (fs.existsSync(file)) fs.unlinkSync(file);
                }
            }
        }
    });

    test('an install that cannot succeed says why, in the core\'s words', async function () {
        this.timeout(BUDGET_MS + 30_000);
        // Latin has no published download -- the pack is GPL and cannot be
        // redistributed here -- so this fails the same way offline as on, and
        // the message is the one worth showing: it names the config key that
        // is the way forward.
        const errors = recordWarnings();
        const shown: string[] = [];
        const originalError = vscode.window.showErrorMessage;
        (vscode.window as unknown as Record<string, unknown>).showErrorMessage =
            (message: string) => {
                shown.push(message);
                return Promise.resolve(undefined);
            };

        try {
            await vscode.commands.executeCommand('language-check.installPack', 'la');

            const reported = await eventually(
                'the failure to be reported',
                () => (shown.length > 0 ? shown.join(' | ') : undefined),
                BUDGET_MS,
            );
            assert.ok(
                /no download is published/.test(reported),
                `the core's reason was not passed through: ${reported}`,
            );
            assert.ok(
                /dictionary_paths/.test(reported),
                `the message does not say what to do instead: ${reported}`,
            );
        } finally {
            (vscode.window as unknown as Record<string, unknown>)
                .showErrorMessage = originalError;
            errors.restore();
        }
    });

    test('an implausible language tag is refused before anything is spawned', async function () {
        this.timeout(BUDGET_MS);
        // The tag reaches a subprocess argument, so it is checked first. A
        // value that is not a tag must not become one.
        const shown: string[] = [];
        const originalError = vscode.window.showErrorMessage;
        (vscode.window as unknown as Record<string, unknown>).showErrorMessage =
            (message: string) => {
                shown.push(message);
                return Promise.resolve(undefined);
            };
        try {
            await vscode.commands.executeCommand(
                'language-check.installPack',
                '../../etc/passwd',
            );
            await new Promise(resolve => setTimeout(resolve, 2_000));
            assert.deepStrictEqual(shown, [], 'an implausible tag reached the installer');
        } finally {
            (vscode.window as unknown as Record<string, unknown>)
                .showErrorMessage = originalError;
        }
    });
});
