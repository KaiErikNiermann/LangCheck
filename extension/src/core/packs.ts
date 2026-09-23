/**
 * Dictionary packs: offering one for a language nothing could check, and
 * installing it.
 */
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { COMMANDS, executeCommand } from '../commands/ids';
import { getUndeclaredSetting } from '../config/settings';
import type { ExtendedDiagnostic } from '../diagnostics/diagnostic';
import type { Logger } from '../shared/logger';
import type { InspectorLog } from '../ui/inspectorLog';
import type { CoreService } from './coreService';
import {
    declinePack,
    forgetDecline,
    isLanguageTag,
    type LanguageTag,
    languageToolCovers,
    shouldPrompt,
    uncheckedLanguages,
} from './packPrompt';

export interface PackDeps {
    readonly context: vscode.ExtensionContext;
    readonly core: CoreService;
    readonly log: Logger;
    readonly inspectorLog: InspectorLog;
    /** Reinitialize and re-check, once an installed pack is on disk. */
    readonly reload: () => Promise<void>;
}

/** Run `packs install`, capturing whatever it said. */
function runPackInstall(cli: string, language: LanguageTag): Promise<{ ok: boolean; output: string }> {
    return new Promise(resolve => {
        // execFile, not a shell: the tag is validated above and still never
        // reaches a command line where it could be anything but an argument.
        execFile(cli, ['packs', 'install', language], { timeout: 300_000 }, (error, stdout, stderr) => {
            resolve({ ok: !error, output: `${stdout}${stderr}` });
        });
    });
}

export class Packs {
    /**
     * Languages offered this session.
     *
     * Separate from the permanent decline list: dismissing the modal without
     * choosing is not a refusal, so it is not remembered past the session, but it
     * should not re-fire on the next keystroke either.
     */
    private readonly offeredThisSession = new Set<string>();

    constructor(private readonly deps: PackDeps) {}

    /**
     * Offer to install a pack for any language the core could not check.
     *
     * Called after every check, so the guard conditions carry the weight: the
     * language comes from the core rather than from parsing a message, it must be
     * one a pack exists for, and it must not have been asked about this session or
     * refused in any previous one.
     */
    async offer(diagnostics: readonly ExtendedDiagnostic[]): Promise<void> {
        // globalState, not workspaceState: a refusal is about the user's opinion
        // of a language, not about one folder, and it has to outlive a reload.
        const memory = this.deps.context.globalState;

        for (const candidate of uncheckedLanguages(diagnostics)) {
            if (!shouldPrompt(memory, this.offeredThisSession, candidate)) continue;
            // Recorded before awaiting, so a second check finishing while the
            // modal is open cannot raise a second one.
            this.offeredThisSession.add(candidate.language.replace(/_/g, '-').toLowerCase());

            // LanguageTool covers this language too, and covers it better --
            // grammar and style, where Hunspell gives spelling alone. Offering
            // only the narrower one would hide the choice from someone who would
            // have picked the other.
            const ltIsAnOption =
                languageToolCovers(candidate.language) &&
                // Undeclared in package.json, so this is always the fallback
                // unless set by hand in settings.json.
                !getUndeclaredSetting('engines.languagetool', false);

            const install = vscode.l10n.t('Install');
            const setUpLT = vscode.l10n.t('Set up LanguageTool');
            const notNow = vscode.l10n.t('Not now');
            const never = vscode.l10n.t("Don't ask again");

            // "None of your enabled checkers", not "nothing installed": a user
            // whose only engine is their own external checker still has one, it
            // just does not declare this language. Telling them they have
            // nothing is both false and a reason to distrust the rest.
            const message = ltIsAnOption
                ? vscode.l10n.t(
                    'None of your enabled checkers read {0}. Hunspell adds spelling for it; LanguageTool adds grammar and style as well.',
                    candidate.language
                )
                : vscode.l10n.t(
                    'None of your enabled checkers read {0}. Install the Hunspell dictionary for it?',
                    candidate.language
                );

            const choices = ltIsAnOption
                ? [install, setUpLT, notNow, never]
                : [install, notNow, never];
            const choice = await vscode.window.showInformationMessage(message, ...choices);

            if (choice === install) {
                await this.install(candidate.language);
            } else if (choice === setUpLT) {
                // The Docker path already exists and does the whole setup, so this
                // hands over rather than reimplementing it.
                await executeCommand(COMMANDS.restartLTDocker);
            } else if (choice === never) {
                await declinePack(memory, candidate.language);
            }
            // "Not now" and a dismissed modal are the same thing: nothing is
            // remembered past this session, and the quick fix stays available.
        }
    }

    /**
     * Run the core's pack installer and re-check once it lands.
     *
     * Shells out to the CLI beside the server binary rather than adding an RPC:
     * an install is a one-off that writes to disk and prints its own progress,
     * which is what a command line is for.
     */
    async install(language: string): Promise<void> {
        if (!isLanguageTag(language)) {
            this.deps.log.warn('Refusing to install a pack for an implausible tag', { language });
            return;
        }
        // Asking again means the user changed their mind, so the refusal goes.
        await forgetDecline(this.deps.context.globalState, language);

        const cli = this.resolveCliPath();
        if (!cli) {
            void vscode.window.showErrorMessage(
                vscode.l10n.t('Could not find the language-check binary to install the dictionary.')
            );
            return;
        }

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: vscode.l10n.t('Installing the {0} dictionary…', language),
                cancellable: false,
            },
            async () => {
                const result = await runPackInstall(cli, language);
                if (result.ok) {
                    void vscode.window.showInformationMessage(
                        vscode.l10n.t('Installed the {0} dictionary.', language)
                    );
                    this.deps.inspectorLog.push('info', 'packs', `Installed ${language}`, {
                        details: result.output.trim().split('\n').at(-1) ?? '',
                    });
                    await this.deps.reload();
                } else {
                    // The core's message names the file and the reason; passing it
                    // through beats replacing it with something vaguer.
                    void vscode.window.showErrorMessage(
                        vscode.l10n.t('Could not install the {0} dictionary: {1}', language, result.output.trim())
                    );
                    this.deps.inspectorLog.push('error', 'packs', `Install failed for ${language}`, {
                        details: result.output.trim(),
                    });
                }
            }
        );
    }

    /** `language-check`, beside whichever `language-check-server` is in use. */
    private resolveCliPath(): string | null {
        const server = this.deps.core.currentServerPath;
        if (!server) return null;
        const cli = path.join(path.dirname(server), process.platform === 'win32' ? 'language-check.exe' : 'language-check');
        return fs.existsSync(cli) ? cli : null;
    }
}
