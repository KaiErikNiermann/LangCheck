/**
 * The quick-fix lightbulb: suggestions, add to dictionary, ignore, deactivate
 * a rule, fix-all, and ignoring every finding over a selection.
 */
import * as vscode from 'vscode';

import { supportedLanguageSelector } from '../checking/languages';
import { COMMANDS, commandLink } from '../commands/ids';
import {
    addSuggestionEdit,
    diagId,
    getDiagnosticWord,
    insertedText,
    isSpellingOf,
    isSpellingRule,
    ruleIdOf,
} from '../diagnostics/diagnostic';
import type { DiagnosticStore } from '../diagnostics/store';
import { findOpenDocument, uriKey } from '../shared/documents';
import { engines as enginesBehind, spanned } from '../shared/ignoreSpan';

export function registerCodeActions(subscriptions: vscode.Disposable[], deps: { readonly store: DiagnosticStore }): void {
    const { store } = deps;

    // Register Code Action Provider (quickfix lightbulb)
    subscriptions.push(vscode.languages.registerCodeActionsProvider(
        supportedLanguageSelector(),
        {
            provideCodeActions(document, range, context) {
                const diagnostics = store.get(uriKey(document.uri));
                if (!diagnostics) return [];

                const actions: vscode.CodeAction[] = [];
                const relevantDiags = context.diagnostics.filter(
                    d => d.source === 'language-check'
                );

                for (const diag of relevantDiags) {
                    const extDiag = diagnostics.find(
                        ed => ed.range.isEqual(diag.range) && ed.message === diag.message
                    );
                    if (!extDiag) continue;
                    const diagIndex = diagnostics.indexOf(extDiag);

                    // Two groups, emitted in this order. The always-present
                    // actions come first so they keep a stable position: a
                    // misspelling can carry twenty suggestions, and listing
                    // those first pushes "Add to dictionary" — the one most
                    // often reached for — off the bottom of the lightbulb.
                    const singleChoice: vscode.CodeAction[] = [];
                    const replacements: vscode.CodeAction[] = [];

                    const ruleId = ruleIdOf(diag, '');
                    const word = isSpellingRule(ruleId)
                        ? getDiagnosticWord(document, diag)
                        : null;

                    // A language nothing could check. The modal is asked at
                    // most once and never again after a refusal, so this is
                    // where the offer stays reachable afterwards -- it costs
                    // nothing until someone opens the lightbulb.
                    if (ruleId === 'languagecheck.no-provider' && extDiag.packInstallable) {
                        const tag = extDiag.language ?? '';
                        const installAction = new vscode.CodeAction(
                            vscode.l10n.t('Install the {0} dictionary', tag),
                            vscode.CodeActionKind.QuickFix
                        );
                        installAction.command = commandLink(COMMANDS.installPack, vscode.l10n.t('Install dictionary'), tag);
                        installAction.diagnostics = [diag];
                        singleChoice.push(installAction);
                    }

                    // Add "Add to Dictionary" action for spelling rules
                    if (word !== null) {
                        const dictAction = new vscode.CodeAction(
                            `Add "${word}" to dictionary`,
                            vscode.CodeActionKind.QuickFix
                        );
                        dictAction.command = commandLink(COMMANDS.addToDictionary, 'Add to Dictionary', word);
                        dictAction.diagnostics = [diag];
                        singleChoice.push(dictAction);
                    }

                    // Add "Ignore" action
                    const ignoreAction = new vscode.CodeAction(
                        'Ignore this issue',
                        vscode.CodeActionKind.QuickFix
                    );
                    ignoreAction.command = commandLink(COMMANDS.ignoreDiagnostic, 'Ignore', diagId(diagIndex));
                    ignoreAction.diagnostics = [diag];
                    singleChoice.push(ignoreAction);

                    // Add "Deactivate rule" action
                    if (ruleId) {
                        const deactivateAction = new vscode.CodeAction(
                            vscode.l10n.t('Deactivate rule "{0}"', ruleId),
                            vscode.CodeActionKind.QuickFix
                        );
                        deactivateAction.command = commandLink(COMMANDS.deactivateRule, 'Deactivate rule', ruleId);
                        deactivateAction.diagnostics = [diag];
                        singleChoice.push(deactivateAction);
                    }

                    // Add a quickfix for each suggestion
                    if (extDiag.suggestions) {
                        for (const suggestion of extDiag.suggestions) {
                            const inserted = insertedText(suggestion);
                            const isRemove = suggestion === '';
                            const label = isRemove
                                ? 'Fix: Remove text'
                                : inserted !== null
                                    ? `Fix: Insert "${inserted}"`
                                    : `Fix: "${suggestion}"`;
                            const fix = new vscode.CodeAction(
                                label,
                                vscode.CodeActionKind.QuickFix
                            );
                            fix.edit = new vscode.WorkspaceEdit();
                            addSuggestionEdit(fix.edit, document.uri, diag.range, suggestion);
                            fix.diagnostics = [diag];
                            fix.isPreferred = extDiag.suggestions.indexOf(suggestion) === 0;
                            replacements.push(fix);
                        }
                    }

                    // "Fix all" bulk actions (only when first suggestion exists).
                    // They apply the top suggestion, so they stay next to the
                    // list that shows what that suggestion is.
                    if (word !== null && extDiag.suggestions && extDiag.suggestions.length > 0) {
                        const replacement = extDiag.suggestions[0]!;
                        const uri = uriKey(document.uri);

                        // Count matching spelling diagnostics in this file
                        const fileCount = diagnostics.filter(d => isSpellingOf(document, d, word)).length;

                        if (fileCount >= 2) {
                            const fixFileAction = new vscode.CodeAction(
                                vscode.l10n.t('Fix all "{0}" in this file', word),
                                vscode.CodeActionKind.QuickFix
                            );
                            fixFileAction.command = commandLink(COMMANDS.fixAllSpellingInFile, 'Fix all in file', uri, word, replacement);
                            fixFileAction.diagnostics = [diag];
                            replacements.push(fixFileAction);
                        }

                        // Count matching spelling diagnostics across workspace
                        let workspaceCount = 0;
                        for (const [entryUri, entryDiags] of store) {
                            const entryDoc = findOpenDocument(entryUri);
                            if (!entryDoc) continue;
                            workspaceCount += entryDiags.filter(d => isSpellingOf(entryDoc, d, word)).length;
                        }

                        if (workspaceCount >= 2) {
                            const fixWsAction = new vscode.CodeAction(
                                vscode.l10n.t('Fix all "{0}" in workspace', word),
                                vscode.CodeActionKind.QuickFix
                            );
                            fixWsAction.command = commandLink(COMMANDS.fixAllSpellingInWorkspace, 'Fix all in workspace', word, replacement);
                            fixWsAction.diagnostics = [diag];
                            replacements.push(fixWsAction);
                        }
                    }

                    actions.push(...singleChoice, ...replacements);
                }

                // Offered once for the whole selection, not once per
                // diagnostic. "Ignore this issue" is keyed on one finding's
                // message, so a phrase three engines all dislike takes three
                // trips through the lightbulb -- and the second and third
                // only appear once the one above has gone.
                const here = spanned(
                    {
                        start: document.offsetAt(range.start),
                        end: document.offsetAt(range.end),
                    },
                    diagnostics.map(d => ({
                        start: document.offsetAt(d.range.start),
                        end: document.offsetAt(d.range.end),
                        code: ruleIdOf(d, undefined),
                    })),
                );
                if (here.length > 1 && enginesBehind(here.map(d => d.code)).size > 0) {
                    const silenceAll = new vscode.CodeAction(
                        vscode.l10n.t('Ignore all {0} issues here', here.length),
                        vscode.CodeActionKind.QuickFix,
                    );
                    silenceAll.command = commandLink(
                        COMMANDS.ignoreSelection,
                        'Ignore all issues here',
                        uriKey(document.uri),
                        document.offsetAt(range.start),
                        document.offsetAt(range.end),
                    );
                    actions.push(silenceAll);
                }

                return actions;
            }
        },
        { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
    ));
}
