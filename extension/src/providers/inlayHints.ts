/**
 * Inlay hints: the top suggestion at the end of a finding, and on LaTeX
 * documents, one-click "skip" hints for environments and commands.
 */
import * as vscode from 'vscode';

import { supportedLanguageSelector } from '../checking/languages';
import { COMMANDS, commandLink } from '../commands/ids';
import type { WorkspaceConfigState } from '../config/state';
import type { DiagnosticStore } from '../diagnostics/store';
import type { Logger } from '../shared/logger';
import { BUILTIN_SKIP_COMMANDS, BUILTIN_SKIP_ENVS, PROSE_COMMANDS, PROSE_ENVS } from './latexLists';
import { uriKey } from '../shared/documents';
import { sureEnough, suggestionHints } from './suggestionHints';

/** Whether the hints are shown at all, flipped by the toggle command. */
export class InlayHintSwitch {
    enabled = true;
}

export interface InlayHintDeps {
    readonly store: DiagnosticStore;
    readonly configState: WorkspaceConfigState;
    readonly log: Logger;
    readonly emitter: vscode.EventEmitter<void>;
    readonly hintSwitch: InlayHintSwitch;
}

/** Register the three providers, in the order VS Code will ask them. */
export function registerInlayHints(subscriptions: vscode.Disposable[], deps: InlayHintDeps): void {
    const { store, configState, log, emitter, hintSwitch } = deps;

    // Register Inlay Hints Provider with invalidation support
    subscriptions.push(vscode.languages.registerInlayHintsProvider(
        supportedLanguageSelector(),
        {
            onDidChangeInlayHints: emitter.event,
            provideInlayHints(document, _range, _token) {
                if (!hintSwitch.enabled) return [];
                const diagnostics = store.get(uriKey(document.uri));
                if (!diagnostics) return [];
                const hints = suggestionHints(document, diagnostics, (i) => store.idOf(uriKey(document.uri), i));
                // Whether a hint appears depends on four things that are
                // invisible from the editor: the provider firing at all, the
                // document having diagnostics, those diagnostics clearing the
                // confidence floor, and the label formatter returning one. A
                // count of each is what tells the four apart without guessing.
                log.debug('provideInlayHints', {
                    language: document.languageId,
                    diagnostics: diagnostics.length,
                    aboveConfidenceFloor: diagnostics.filter(sureEnough).length,
                    hints: hints.length,
                });
                return hints;
            }
        }
    ));

    // Register LaTeX-only Inlay Hints Provider for environment skip hints
    subscriptions.push(vscode.languages.registerInlayHintsProvider(
        [{ language: 'latex' }],
        {
            onDidChangeInlayHints: emitter.event,
            provideInlayHints(document, _range, _token) {
                if (!hintSwitch.enabled) return [];
                const text = document.getText();
                const hints: vscode.InlayHint[] = [];
                const re = /\\begin\{([^}]+)\}/g;
                let m: RegExpExecArray | null;
                while ((m = re.exec(text)) !== null) {
                    const envName = m[1]!;
                    if (BUILTIN_SKIP_ENVS.has(envName) || PROSE_ENVS.has(envName) || configState.skipEnvironments.has(envName) || configState.proseEnvironments.has(envName)) continue;
                    const pos = document.positionAt(m.index + m[0].length);
                    const hint = new vscode.InlayHint(
                        pos,
                        [
                            {
                                value: ' \u2298 skip',
                                command: commandLink(COMMANDS.skipLatexEnv, 'Skip checking this environment', envName)
                            },
                            {
                                value: ' | hide hint',
                                command: commandLink(COMMANDS.hideLatexEnvHint, 'Hide this hint (keep checking)', envName)
                            }
                        ],
                        vscode.InlayHintKind.Parameter
                    );
                    hint.tooltip = `"skip" adds to skip_environments, "hide hint" adds to prose_environments`;
                    hints.push(hint);
                }
                return hints;
            }
        }
    ));

    // Register LaTeX-only Inlay Hints Provider for command skip hints (Approach B: diagnostic-driven)
    subscriptions.push(vscode.languages.registerInlayHintsProvider(
        [{ language: 'latex' }],
        {
            onDidChangeInlayHints: emitter.event,
            provideInlayHints(document, _range, _token) {
                if (!hintSwitch.enabled) return [];
                const diagnostics = store.get(uriKey(document.uri));
                if (!diagnostics || diagnostics.length === 0) return [];
                const text = document.getText();
                const hints: vscode.InlayHint[] = [];
                const seen = new Set<string>();
                const re = /\\([a-zA-Z]+)\{/g;
                let m: RegExpExecArray | null;
                while ((m = re.exec(text)) !== null) {
                    const cmdName = m[1]!;
                    if (
                        BUILTIN_SKIP_COMMANDS.has(cmdName) ||
                        configState.skipCommands.has(cmdName) ||
                        PROSE_COMMANDS.has(cmdName)
                    ) continue;
                    // Find the closing brace to get the full argument span
                    const argStart = m.index + m[0].length - 1; // position of '{'
                    let depth = 1;
                    let argEnd = argStart + 1;
                    while (argEnd < text.length && depth > 0) {
                        if (text[argEnd] === '{') depth++;
                        else if (text[argEnd] === '}') depth--;
                        argEnd++;
                    }
                    // Check if any diagnostic falls inside this command's argument
                    const cmdStartPos = document.positionAt(m.index);
                    const cmdEndPos = document.positionAt(argEnd);
                    const cmdRange = new vscode.Range(cmdStartPos, cmdEndPos);
                    const hasDiag = diagnostics.some(d => cmdRange.contains(d.range));
                    if (!hasDiag) continue;
                    // Only show one hint per command name
                    const key = `${cmdName}:${m.index}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    const pos = document.positionAt(argEnd);
                    const hint = new vscode.InlayHint(
                        pos,
                        [{
                            value: ' \u2298 skip',
                            command: commandLink(COMMANDS.skipLatexCommand, 'Skip this LaTeX command', cmdName)
                        }],
                        vscode.InlayHintKind.Parameter
                    );
                    hint.tooltip = `Add "${cmdName}" to skip_commands in .languagecheck.yaml`;
                    hints.push(hint);
                }
                return hints;
            }
        }
    ));
}
