/**
 * First-run help: the welcome walkthrough, and suggesting the Red Hat YAML
 * extension for completion and validation in the config file.
 */
import * as vscode from 'vscode';

import { YAML_EXTENSION_ID, declineYamlSuggestion, shouldSuggestYaml } from '../config/yamlSuggestion';
import type { Logger } from '../shared/logger';
import { otherCopies } from '../shared/otherCopies';

export function registerOnboarding(context: vscode.ExtensionContext): void {
    let offeredThisSession = false;

    // First-run onboarding: show welcome notification once
    const hasSeenWelcome = context.globalState.get<boolean>('language-check.hasSeenWelcome', false);
    if (!hasSeenWelcome) {
        context.globalState.update('language-check.hasSeenWelcome', true);
        vscode.window.showInformationMessage(
            vscode.l10n.t('Welcome to Language Check! Open the Get Started walkthrough to learn the basics.'),
            vscode.l10n.t('Open Walkthrough'),
            vscode.l10n.t('Dismiss')
        ).then(selection => {
            if (selection === vscode.l10n.t('Open Walkthrough')) {
                vscode.commands.executeCommand(
                    'workbench.action.openWalkthrough',
                    // Derive the id from the running extension rather than hardcoding
                    // publisher.name — the literal was wrong (`.extension`) and would
                    // break again under a different registry namespace.
                    `${context.extension.id}#language-check.welcome`,
                    false
                );
            }
        });
    }

    const suggestYamlExtension = async (document: vscode.TextDocument): Promise<void> => {
        const installed = vscode.extensions.getExtension(YAML_EXTENSION_ID) !== undefined;
        if (!shouldSuggestYaml(context.globalState, offeredThisSession, installed, document.uri.fsPath)) return;
        offeredThisSession = true;
        const install = vscode.l10n.t('Install');
        const never = vscode.l10n.t("Don't ask again");
        const choice = await vscode.window.showInformationMessage(
            vscode.l10n.t('Install the Red Hat YAML extension for completion and validation in .languagecheck.yaml?'),
            install,
            vscode.l10n.t('Not now'),
            never,
        );
        if (choice === install) {
            await vscode.commands.executeCommand('workbench.extensions.installExtension', YAML_EXTENSION_ID);
        } else if (choice === never) {
            await declineYamlSuggestion(context.globalState);
        }
    };
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(document => void suggestYamlExtension(document)));
    for (const document of vscode.workspace.textDocuments) void suggestYamlExtension(document);
}

/**
 * Warn when another copy of this extension is installed under a different
 * id, naming it and where it lives: each copy starts its own checker, and
 * the doubled squiggles look like a bug in this one.
 */
export function warnAboutOtherCopies(context: vscode.ExtensionContext, log: Logger): void {
    const installed = Array.isArray(vscode.extensions.all) ? vscode.extensions.all : [];
    const copies = otherCopies(installed, context.extension.id);
    if (copies.length === 0) return;
    for (const copy of copies) {
        log.warn(`Another copy of Language Check is installed: ${copy.id} ${copy.version}, at ${copy.path}`);
    }
    const [first] = copies;
    if (!first) return;
    const showLog = vscode.l10n.t('Show Log');
    void Promise.resolve(vscode.window.showWarningMessage(
        vscode.l10n.t('Another copy of Language Check is installed ({0}, version {1}, at {2}). Each copy starts its own checker; disable one of them.', first.id, first.version, first.path),
        showLog,
    )).then(choice => {
        if (choice === showLog) log.show();
    });
}
