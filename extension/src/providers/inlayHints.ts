/**
 * Inlay hints: the top suggestion at the end of a finding, and on LaTeX
 * documents, one-click "skip" hints for environments and commands.
 */
import * as vscode from 'vscode';

import { supportedLanguageSelector } from '../checking/languages';
import { COMMANDS, commandLink } from '../commands/ids';
import type { WorkspaceConfigState } from '../config/state';
import { diagId } from '../diagnostics/diagnostic';
import type { DiagnosticStore } from '../diagnostics/store';
import { formatSuggestionLabel } from '../shared/inlayLabels';
import type { Logger } from '../shared/logger';
import { BUILTIN_SKIP_COMMANDS, BUILTIN_SKIP_ENVS, PROSE_COMMANDS, PROSE_ENVS } from './latexLists';

/**
 * How sure an engine has to be before its suggestion is shown inline.
 *
 * Harper and LanguageTool report 0.8, Vale 0.75, proselint 0.7 and Hunspell
 * 0.6, so at this floor the first two reach the hint and the rest stay in the
 * quick fix menu. A hint is applied with one keystroke and sits in the text,
 * which is a different bar from a menu entry someone chose to open.
 */
const HINT_CONFIDENCE_FLOOR = 0.8;

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

    /** Format an inlay hint label and apply-value for a diagnostic suggestion. */
    function formatInlayLabel(
        d: { suggestions?: string[]; range: vscode.Range },
        document: vscode.TextDocument
    ): { label: string; applyValue: string } | null {
        const suggestion = d.suggestions?.[0];
        if (suggestion === undefined) return null;
        return formatSuggestionLabel(document.getText(d.range), suggestion);
    }

    // Register Inlay Hints Provider with invalidation support
    subscriptions.push(vscode.languages.registerInlayHintsProvider(
        supportedLanguageSelector(),
        {
            onDidChangeInlayHints: emitter.event,
            provideInlayHints(document, _range, _token) {
                if (!hintSwitch.enabled) return [];
                const diagnostics = store.get(document.uri.toString());
                if (!diagnostics) return [];

                // Group diagnostics by position to avoid stacking hints
                const byPosition = new Map<string, { diag: typeof diagnostics[number]; idx: number; fmt: { label: string; applyValue: string } }[]>();
                for (let i = 0; i < diagnostics.length; i++) {
                    const d = diagnostics[i]!;
                    if (d.confidence !== undefined && d.confidence >= HINT_CONFIDENCE_FLOOR
                        && d.suggestions && d.suggestions.length > 0) {
                        const fmt = formatInlayLabel(d, document);
                        if (!fmt) continue;
                        const key = `${d.range.end.line}:${d.range.end.character}`;
                        const group = byPosition.get(key);
                        const entry = { diag: d, idx: i, fmt };
                        if (group) {
                            group.push(entry);
                        } else {
                            byPosition.set(key, [entry]);
                        }
                    }
                }

                const hints: vscode.InlayHint[] = [];
                for (const group of byPosition.values()) {
                    if (group.length === 0) continue;
                    const first = group[0]!;
                    let label: string;
                    let tooltip: string;
                    if (group.length === 1) {
                        label = first.fmt.label;
                        tooltip = `Accept suggestion: ${first.fmt.applyValue || '(remove)'}`;
                    } else {
                        label = `${first.fmt.label} (+${group.length - 1} more)`;
                        tooltip = group
                            .map((e, i) => `${i + 1}. ${e.diag.message}: ${e.fmt.applyValue || '(remove)'}`)
                            .join('\n');
                    }
                    const hint = new vscode.InlayHint(
                        first.diag.range.end,
                        [
                            {
                                value: label,
                                command: commandLink(COMMANDS.applyFix, 'Apply Fix', diagId(first.idx), first.fmt.applyValue)
                            }
                        ],
                        vscode.InlayHintKind.Type
                    );
                    hint.tooltip = tooltip;
                    hints.push(hint);
                }
                // Whether a hint appears depends on four things that are
                // invisible from the editor: the provider firing at all, the
                // document having diagnostics, those diagnostics clearing the
                // confidence floor, and the label formatter returning one. A
                // count of each is what tells the four apart without guessing.
                log.debug('provideInlayHints', {
                    language: document.languageId,
                    diagnostics: diagnostics.length,
                    aboveConfidenceFloor: diagnostics.filter(
                        d => d.confidence !== undefined && d.confidence >= HINT_CONFIDENCE_FLOOR
                    ).length,
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
                const diagnostics = store.get(document.uri.toString());
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
