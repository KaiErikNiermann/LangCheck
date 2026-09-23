/** Acting on findings: fixing, ignoring, adding to the dictionary, silencing a rule. */
import * as vscode from 'vscode';

import { deactivateRule } from '../config/edits';
import { readTextOrEmpty, resolveConfigForEdit, writeConfigText } from '../config/file';
import { ignoreRequest, isSpellingOf, isSpellingRule, ruleIdOf, type DiagId } from '../diagnostics/diagnostic';
import { findOpenDocument, uriKey, type UriKey } from '../shared/documents';
import { spanned } from '../shared/ignoreSpan';
import type { App } from '../services';
import { COMMANDS, type CommandHandlers } from './ids';

export function diagnosticsCommands(app: App) {
    const { log, store, suppression, inspectorLog, fixTarget, core, checker, actions, speedFix } = app;

    return {
        [COMMANDS.ignoreDiagnostic]: async (diagnosticId: DiagId) => {
            await actions.ignore(diagnosticId);
        },
        /**
         * Silence every engine over one span.
         *
         * Each finding is fingerprinted separately, because that is what the
         * ignore store holds and what makes the suppression survive a reload. The
         * span is only how they are chosen.
         *
         * Called with no arguments from the palette, where the editor's own
         * selection is the span.
         */
        [COMMANDS.ignoreSelection]: async (uriText?: UriKey, startOffset?: number, endOffset?: number) => {
            const editor = uriText === undefined
                ? vscode.window.activeTextEditor
                : vscode.window.visibleTextEditors.find(e => uriKey(e.document.uri) === uriText)
                    ?? vscode.window.activeTextEditor;
            if (!editor || !core.client) return;

            const document = editor.document;
            const uri = uriKey(document.uri);
            const diagnostics = store.get(uri);
            if (!diagnostics || diagnostics.length === 0) return;

            const start = startOffset ?? document.offsetAt(editor.selection.start);
            const end = endOffset ?? document.offsetAt(editor.selection.end);
            const chosen = spanned(
                { start, end },
                diagnostics.map((d, index) => ({
                    start: document.offsetAt(d.range.start),
                    end: document.offsetAt(d.range.end),
                    index,
                })),
            );
            if (chosen.length === 0) {
                vscode.window.showInformationMessage(
                    vscode.l10n.t('Nothing to ignore in the selection.'),
                );
                return;
            }

            const text = document.getText();
            for (const { index } of chosen) {
                const diagnostic = diagnostics[index];
                if (!diagnostic) continue;
                await core.client.sendRequest(ignoreRequest(diagnostic, document, text));
            }

            const silenced = new Set(chosen.map(c => c.index));
            const remaining = diagnostics.filter((_, index) => !silenced.has(index));
            store.write(uri, document.uri, remaining);
            store.notify();
            inspectorLog.push(
                'info',
                'ignoreSelection',
                `Ignoring ${chosen.length} issue(s) over the selection`,
            );
        },
        [COMMANDS.fixAllSpellingInFile]: async (uri: UriKey, word: string, replacement: string) => {
            const diagnostics = store.get(uri);
            if (!diagnostics) return;

            const document = findOpenDocument(uri);
            if (!document) return;

            const matching = diagnostics.filter(d => isSpellingOf(document, d, word));
            if (matching.length === 0) return;

            const edit = new vscode.WorkspaceEdit();
            for (const d of matching) {
                edit.replace(document.uri, d.range, replacement);
            }
            await vscode.workspace.applyEdit(edit);

            // Optimistic removal
            const remaining = diagnostics.filter(d => !matching.includes(d));
            store.write(uri, document.uri, remaining);
            store.notify();

            // Re-check for consistency
            await checker.check(document);
        },
        [COMMANDS.fixAllSpellingInWorkspace]: async (word: string, replacement: string) => {
            const edit = new vscode.WorkspaceEdit();
            const affectedUris: UriKey[] = [];

            for (const [uri, diagnostics] of store) {
                const document = findOpenDocument(uri);
                if (!document) continue;

                const matching = diagnostics.filter(d => isSpellingOf(document, d, word));
                if (matching.length === 0) continue;

                for (const d of matching) {
                    edit.replace(document.uri, d.range, replacement);
                }

                // Optimistic removal
                const remaining = diagnostics.filter(d => !matching.includes(d));
                store.write(uri, document.uri, remaining);
                affectedUris.push(uri);
            }

            if (affectedUris.length === 0) return;

            await vscode.workspace.applyEdit(edit);
            store.notify();

            // Re-check all affected files
            for (const uri of affectedUris) {
                const document = findOpenDocument(uri);
                if (document) {
                    await checker.check(document);
                }
            }
        },
        [COMMANDS.addToDictionary]: async (word: string) => {
            if (!core.client) return;
            speedFix.sendLoading(true);
            const t0 = performance.now();
            log.debug('addToDictionary', { word });
            inspectorLog.push('info', 'addToDictionary', `Sending request for "${word}"`);
            try {
                const response = await core.client.sendRequest({
                    addDictionaryWord: { word }
                });
                const rpcMs = performance.now() - t0;
                if (response.ok) {
                    inspectorLog.push('info', 'addToDictionary', `Server confirmed "${word}"`, { durationMs: rpcMs });
                    // Suppress this word in any in-flight check results until the re-check completes
                    const wordLower = word.toLowerCase();
                    suppression.words.add(wordLower);
                    // Optimistic removal: remove all spelling diagnostics for this word immediately
                    const editor = fixTarget.findEditor();
                    let removedCount = 0;
                    if (editor) {
                        const uri = uriKey(editor.document.uri);
                        const diagnostics = store.get(uri);
                        if (diagnostics) {
                            const remaining = diagnostics.filter(d => {
                                const diagWord = editor.document.getText(d.range);
                                const isSpelling = isSpellingRule(ruleIdOf(d, ''));
                                if (isSpelling && diagWord.toLowerCase() === wordLower) {
                                    removedCount++;
                                    return false;
                                }
                                return true;
                            });
                            store.write(uri, editor.document.uri, remaining);
                            store.notify();
                        }
                        inspectorLog.push('debug', 'addToDictionary', `Removed ${removedCount} diagnostics, re-checking`);
                        // Full re-check for consistency (dictionary is now server-side updated)
                        await checker.check(editor.document);
                        suppression.words.delete(wordLower);
                    }
                    const extra = removedCount > 1 ? vscode.l10n.t(' ({0} occurrences resolved)', removedCount) : '';
                    vscode.window.showInformationMessage(vscode.l10n.t('Added "{0}" to dictionary', word) + extra);
                    inspectorLog.push('info', 'addToDictionary', `Done`, { durationMs: performance.now() - t0 });
                } else if (response.error) {
                    inspectorLog.push('error', 'addToDictionary', `Server error: ${response.error.message}`, { durationMs: rpcMs });
                    vscode.window.showErrorMessage(vscode.l10n.t('Failed to add word: {0}', response.error.message ?? ''));
                }
            } catch (err) {
                const errStr = String(err);
                inspectorLog.push('error', 'addToDictionary', errStr, { durationMs: performance.now() - t0 });
                log.error('addToDictionary failed', { word, error: errStr });
                vscode.window.showErrorMessage(vscode.l10n.t('Failed to add word: {0}', errStr));
            } finally {
                speedFix.sendLoading(false);
            }
        },
        [COMMANDS.deactivateRule]: async (ruleId: string) => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) return;

            const targetUri = await resolveConfigForEdit(workspaceFolder);

            try {
                const edit = deactivateRule(await readTextOrEmpty(targetUri), ruleId);
                const alreadyDeactivated = edit.alreadyDeactivated;
                if (!alreadyDeactivated) {
                    await writeConfigText(targetUri, edit.content);
                }

                // Suppress this rule in any in-flight check results
                suppression.rules.add(ruleId);

                // Immediately remove matching diagnostics from all open documents
                for (const [uri, diagnostics] of store) {
                    const remaining = diagnostics.filter(d => {
                        return ruleIdOf(d, '') !== ruleId;
                    });
                    if (remaining.length !== diagnostics.length) {
                        store.write(uri, vscode.Uri.parse(uri), remaining);
                    }
                }
                store.notify();

                vscode.window.showInformationMessage(
                    alreadyDeactivated
                        ? vscode.l10n.t('Rule "{0}" is already deactivated in project config', ruleId)
                        : vscode.l10n.t('Rule "{0}" deactivated in project config', ruleId)
                );

                // The diagnostics for this rule are already gone, filtered out
                // just above. The core still has to learn about the new config,
                // but nothing on screen is waiting on it -- and re-checking here
                // would clear every diagnostic in the window to arrive back at
                // what is already drawn. The file watcher reaches the same
                // conclusion for a config edited by hand.
                await core.initialize();
                suppression.rules.delete(ruleId);
            } catch (err) {
                vscode.window.showErrorMessage(vscode.l10n.t('Failed to deactivate rule: {0}', String(err)));
            }
        },
        [COMMANDS.applyFix]: async (diagnosticId: DiagId, suggestion: string) => {
            await actions.applyFix(diagnosticId, suggestion);
        },
    } satisfies CommandHandlers;
}
