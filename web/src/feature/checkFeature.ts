// The web extension's checking path, written against the `vscode` API (the
// shim, in the browser). It reuses the VS Code client's own conversions:
// byte offsets to characters (offsets.ts), core findings to diagnostics
// (response.ts), the fix edit and ignore request (diagnostic.ts), and the
// inlay labels (inlayLabels.ts). What is new is only what the web needs:
// the transport, and checks paced for typing in a browser.
import * as vscode from 'vscode';
import { byteToCharConverter } from '../../../extension/src/checking/offsets';
import { positionsIn, toDiagnostic } from '../../../extension/src/checking/response';
import { Debouncer } from '../../../extension/src/checking/scheduler';
import {
    addSuggestionEdit,
    ignoreRequest,
    isSpellingRule,
    ruleIdOf,
    type ExtendedDiagnostic,
} from '../../../extension/src/diagnostics/diagnostic';
import { languagecheck } from '../../../extension/src/proto/checker';

const SEVERITY = languagecheck.Severity;
import { formatSuggestionLabel } from '../../../extension/src/shared/inlayLabels';
import { CoreError, type CoreClient } from '../messaging/pageClient';
import type { LanguageId } from '../messaging/protocol';

export const SOURCE = 'language-check';
/** Typing pause before a check, as in the VS Code client's default. */
export const CHECK_DELAY_MS = 500;
/** Suggestions offered as fixes per finding. */
const MAX_FIXES = 5;

const COMMAND = {
    applyFix: 'languageCheck.web.applyFix',
    addWord: 'languageCheck.web.addWord',
    ignore: 'languageCheck.web.ignore',
} as const;

/** One document's checking state: what was checked last, and whether a check is running. */
interface DocState {
    checkedVersion: number | undefined;
    checkedText: string;
    diagnostics: readonly ExtendedDiagnostic[];
    running: boolean;
    /** Text changed while a check ran; check again when it lands. */
    stale: boolean;
}

interface FixArgs {
    readonly uri: string;
    readonly range: vscode.Range;
    /** The text the fix replaces, checked again when it runs. */
    readonly expected: string;
    readonly suggestion: string;
}

/** The wire carries the enum as a number; anything unknown reads as unspecified, which shows as information. */
function protoSeverity(value: number): languagecheck.Severity {
    switch (value) {
        case 1:
            return SEVERITY.SEVERITY_INFORMATION;
        case 2:
            return SEVERITY.SEVERITY_WARNING;
        case 3:
            return SEVERITY.SEVERITY_ERROR;
        case 4:
            return SEVERITY.SEVERITY_HINT;
        default:
            return SEVERITY.SEVERITY_UNSPECIFIED;
    }
}

export function activate(context: vscode.ExtensionContext, core: CoreClient, languageOf: (doc: vscode.TextDocument) => LanguageId): void {
    const collection = vscode.languages.createDiagnosticCollection(SOURCE);
    const hintsChanged = new vscode.EventEmitter<void>();
    const states = new Map<string, DocState>();
    const debouncer = new Debouncer();
    let reportedUnavailable = false;

    const stateOf = (doc: vscode.TextDocument): DocState => {
        const key = doc.uri.toString();
        let state = states.get(key);
        if (state === undefined) {
            state = { checkedVersion: undefined, checkedText: '', diagnostics: [], running: false, stale: false };
            states.set(key, state);
        }
        return state;
    };
    const isOpen = (doc: vscode.TextDocument): boolean => vscode.workspace.textDocuments.includes(doc);

    const report = (error: unknown): void => {
        if (error instanceof CoreError && error.code === 'unavailable') {
            // Once per page, not once per keystroke.
            if (reportedUnavailable) return;
            reportedUnavailable = true;
            void vscode.window.showErrorMessage(
                vscode.l10n.t(
                    'LangCheck cannot reach its checker: {0}. Install the native host with "language-check-native-host install --browser <firefox|chrome>".',
                    error.message,
                ),
            );
            return;
        }
        console.error('[language-check]', error);
        if (!(error instanceof CoreError && (error.code === 'busy' || error.code === 'timeout'))) {
            void vscode.window.showErrorMessage(vscode.l10n.t('LangCheck: {0}', error instanceof Error ? error.message : String(error)));
        }
    };

    /**
     * At most one check per document at a time. Text that changes while one
     * runs is checked once it lands, and a result for text that has since
     * changed is never shown: its offsets are for a document that no longer
     * exists.
     */
    const check = async (doc: vscode.TextDocument): Promise<void> => {
        const state = stateOf(doc);
        if (state.running) {
            state.stale = true;
            return;
        }
        state.running = true;
        state.stale = false;
        const version = doc.version;
        const text = doc.getText();
        try {
            const findings = await core.check(text, languageOf(doc));
            reportedUnavailable = false;
            if (!isOpen(doc)) return;
            if (doc.version !== version) {
                state.stale = true;
                return;
            }
            const toChar = byteToCharConverter(text);
            const positions = positionsIn(text);
            state.diagnostics = findings.map((f) =>
                toDiagnostic(
                    {
                        startByte: f.startByte,
                        endByte: f.endByte,
                        message: f.message,
                        severity: protoSeverity(f.severity),
                        ruleId: f.ruleId,
                        unifiedId: f.unifiedId,
                        suggestions: [...f.suggestions],
                        confidence: f.confidence,
                    },
                    positions,
                    toChar,
                ),
            );
            state.checkedVersion = version;
            state.checkedText = text;
            collection.set(doc.uri, [...state.diagnostics]);
            hintsChanged.fire();
        } catch (error) {
            report(error);
        } finally {
            state.running = false;
            if (state.stale && isOpen(doc)) schedule(doc);
        }
    };

    const schedule = (doc: vscode.TextDocument, delay = CHECK_DELAY_MS): void => {
        debouncer.schedule(doc.uri.toString(), delay, () => void check(doc));
    };

    const recheckAll = (): void => { for (const d of vscode.workspace.textDocuments) schedule(d, 0) };

    /** Findings that still describe the document as it is: none while it has changed since the check. */
    const currentDiagnostics = (doc: vscode.TextDocument): readonly ExtendedDiagnostic[] => {
        const state = states.get(doc.uri.toString());
        return state !== undefined && state.checkedVersion === doc.version ? state.diagnostics : [];
    };

    context.subscriptions.push(
        collection,
        hintsChanged,
        { dispose: () => { debouncer.cancelAll(); } },
        vscode.workspace.onDidOpenTextDocument((doc) => { schedule(doc, 0); }),
        vscode.workspace.onDidChangeTextDocument((event) => { schedule(event.document); }),
        vscode.workspace.onDidCloseTextDocument((doc) => {
            debouncer.cancel(doc.uri.toString());
            states.delete(doc.uri.toString());
            collection.delete(doc.uri);
        }),

        vscode.commands.registerCommand(COMMAND.applyFix, async (args: FixArgs) => {
            const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === args.uri);
            // Checked where it is used, not where it was offered: a collaborator
            // may have edited the span since.
            if (doc === undefined || doc.getText(args.range) !== args.expected) {
                void vscode.window.showWarningMessage(vscode.l10n.t('LangCheck: the text changed since this fix was offered; it was not applied.'));
                return;
            }
            const edit = new vscode.WorkspaceEdit();
            addSuggestionEdit(edit, doc.uri, args.range, args.suggestion);
            await vscode.workspace.applyEdit(edit);
        }),
        vscode.commands.registerCommand(COMMAND.addWord, async (word: string) => {
            try {
                await core.addWord(word);
                void vscode.window.showInformationMessage(vscode.l10n.t('Added "{0}" to the dictionary', word));
                recheckAll();
            } catch (error) {
                report(error);
            }
        }),
        vscode.commands.registerCommand(COMMAND.ignore, async (uri: string, version: number, index: number) => {
            const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri);
            const state = doc === undefined ? undefined : states.get(uri);
            // The index is into the findings of the check the action was
            // offered for; after a recheck it would name another finding.
            const diagnostic = state?.checkedVersion === version ? state.diagnostics[index] : undefined;
            if (doc === undefined || state === undefined || diagnostic === undefined) {
                void vscode.window.showWarningMessage(vscode.l10n.t('LangCheck: the document changed since this was offered; nothing was ignored.'));
                return;
            }
            try {
                await core.ignore(ignoreRequest(diagnostic, doc, state.checkedText).ignore);
                recheckAll();
            } catch (error) {
                report(error);
            }
        }),

        vscode.languages.registerCodeActionsProvider([{ language: 'latex' }, { language: 'typst' }, { language: 'bibtex' }, { language: 'markdown' }, { language: 'plaintext' }], {
            provideCodeActions(doc, range) {
                const all = currentDiagnostics(doc);
                return all.flatMap((d, index) => {
                    if (d.range.intersection(range) === undefined) return [];
                    const word = doc.getText(d.range);
                    const fixes = (d.suggestions ?? []).slice(0, MAX_FIXES).map((suggestion) => {
                        const action = new vscode.CodeAction(vscode.l10n.t('Replace with "{0}"', suggestion), vscode.CodeActionKind.QuickFix);
                        const args: FixArgs = { uri: doc.uri.toString(), range: d.range, expected: word, suggestion };
                        action.command = { command: COMMAND.applyFix, title: action.title, arguments: [args] };
                        action.diagnostics = [d];
                        return action;
                    });
                    const extra: vscode.CodeAction[] = [];
                    if (isSpellingRule(ruleIdOf(d, '')) && word.length > 0) {
                        const add = new vscode.CodeAction(vscode.l10n.t('Add "{0}" to dictionary', word), vscode.CodeActionKind.QuickFix);
                        add.command = { command: COMMAND.addWord, title: add.title, arguments: [word] };
                        extra.push(add);
                    }
                    const ignore = new vscode.CodeAction(vscode.l10n.t('Ignore this finding'), vscode.CodeActionKind.QuickFix);
                    ignore.command = { command: COMMAND.ignore, title: ignore.title, arguments: [doc.uri.toString(), doc.version, index] };
                    extra.push(ignore);
                    return [...fixes, ...extra];
                });
            },
        }),

        vscode.languages.registerInlayHintsProvider([{ language: 'latex' }, { language: 'typst' }, { language: 'bibtex' }, { language: 'markdown' }, { language: 'plaintext' }], {
            onDidChangeInlayHints: hintsChanged.event,
            provideInlayHints(doc) {
                return currentDiagnostics(doc).flatMap((d) => {
                    const label = formatSuggestionLabel(doc.getText(d.range), d.suggestions?.[0]);
                    return label === null ? [] : [new vscode.InlayHint(d.range.end, label.label.trim())];
                });
            },
        }),
    );

    for (const doc of vscode.workspace.textDocuments) schedule(doc, 0);
}
