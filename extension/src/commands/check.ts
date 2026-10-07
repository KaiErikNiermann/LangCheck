/** Running checks and opening the panels. */
import * as vscode from 'vscode';

import type { Checker, CheckOutcome } from '../checking/checker';
import type { CheckResults } from '../checking/results';
import { basename } from '../shared/paths';
import type { InspectorPanel } from '../ui/webviews/inspector';
import type { SpeedFixPanel } from '../ui/webviews/speedFix';
import { COMMANDS, type CommandHandlers } from './ids';

/** What the check and panel commands use: VS Code's App provides it, and so does the web extension. */
export interface CheckCommandDeps {
    readonly results: Pick<CheckResults, 'servedFromCache'>;
    readonly checker: Pick<Checker, 'check'>;
    readonly speedFix: Pick<SpeedFixPanel, 'open'>;
    readonly inspector: Pick<InspectorPanel, 'open'>;
}

export function checkCommands(app: CheckCommandDeps) {
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
                    progress.report({ increment: (1 / files.length) * 100, message: vscode.l10n.t('Checking {0}', basename(file.fsPath)) });

                    const document = await vscode.workspace.openTextDocument(file);
                    await checker.check(document);
                }
            });
        },
        [COMMANDS.openSpeedFix]: () => speedFix.open(),
        [COMMANDS.openInspector]: () => inspector.open(),
    } satisfies CommandHandlers;
}
