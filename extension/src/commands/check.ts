/** Running checks and opening the panels. */
import * as path from 'path';
import * as vscode from 'vscode';

import type { CheckOutcome } from '../checking/checker';
import type { App } from '../services';
import { COMMANDS, type CommandHandlers } from './ids';

export function checkCommands(app: App) {
    const { results, checker, speedFix, inspector } = app;

    return {
        [COMMANDS.checkDocument]: async (): Promise<CheckOutcome | undefined> => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return undefined;
            const result = await checker.check(editor.document);
            // Show feedback when invoked manually
            if (result === 0) {
                vscode.window.showInformationMessage(vscode.l10n.t('No language issues found.'));
            } else if (result > 0) {
                vscode.window.showInformationMessage(vscode.l10n.t('Found {0} issue(s).', result));
            }
            // Returned so a caller can see what the check did. A command's return
            // value reaches executeCommand, which is how the end-to-end tests
            // assert that a reload reused the stored result.
            return { diagnostics: result, servedFromCache: results.servedFromCache };
        },
        [COMMANDS.checkWorkspace]: async () => {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: vscode.l10n.t('Checking workspace...'),
                cancellable: true
            }, async (progress, token) => {
                const files = await vscode.workspace.findFiles('**/*.{md,markdown,mdx,html,htm,xhtml,tex,latex,ltx,tree,tiny}');
                for (let i = 0; i < files.length; i++) {
                    if (token.isCancellationRequested) break;

                    const file = files[i];
                    if (!file) continue;
                    progress.report({ increment: (1 / files.length) * 100, message: vscode.l10n.t('Checking {0}', path.basename(file.fsPath)) });

                    const document = await vscode.workspace.openTextDocument(file);
                    await checker.check(document);
                }
            });
        },
        [COMMANDS.openSpeedFix]: () => speedFix.open(),
        [COMMANDS.openInspector]: () => inspector.open(),
    } satisfies CommandHandlers;
}
