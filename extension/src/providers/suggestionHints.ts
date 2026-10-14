/**
 * The suggestion inlay hints: the top suggestion of each finding sure enough
 * to show inline, at the finding's end, as ghost text that Ctrl+click
 * applies. VS Code's provider and the browser client's both build them here.
 */
import * as vscode from 'vscode';

import { COMMANDS, commandLink } from '../commands/ids';
import type { DiagId, ExtendedDiagnostic } from '../diagnostics/diagnostic';
import { formatSuggestionLabel } from '../shared/inlayLabels';

/**
 * How sure an engine has to be before its suggestion is shown inline.
 *
 * Harper and LanguageTool report 0.8, Vale 0.75, proselint 0.7 and Hunspell
 * 0.6, so at this floor the first two reach the hint and the rest stay in the
 * quick fix menu. A hint is applied with one keystroke and sits in the text,
 * which is a different bar from a menu entry someone chose to open.
 */
export const HINT_CONFIDENCE_FLOOR = 0.8;

/** Whether `d` clears the floor (and so may get a hint, when it has a suggestion). */
export const sureEnough = (d: ExtendedDiagnostic): boolean => d.confidence !== undefined && d.confidence >= HINT_CONFIDENCE_FLOOR;

interface Entry {
    readonly diag: ExtendedDiagnostic;
    readonly idx: number;
    readonly fmt: { readonly label: string; readonly applyValue: string };
}

/**
 * One hint per end position: the first finding's suggestion, the others
 * named as "(+N more)" and listed in the tooltip. `idOf` names a finding by
 * its index in `diagnostics`, for the applyFix command.
 */
export function suggestionHints(document: vscode.TextDocument, diagnostics: readonly ExtendedDiagnostic[], idOf: (index: number) => DiagId): vscode.InlayHint[] {
    const byPosition = new Map<string, Entry[]>();
    for (let i = 0; i < diagnostics.length; i++) {
        const d = diagnostics[i]!;
        const suggestion = d.suggestions?.[0];
        if (!sureEnough(d) || suggestion === undefined) continue;
        const fmt = formatSuggestionLabel(document.getText(d.range), suggestion);
        if (!fmt) continue;
        const key = `${d.range.end.line}:${d.range.end.character}`;
        const group = byPosition.get(key);
        const entry = { diag: d, idx: i, fmt };
        if (group) group.push(entry);
        else byPosition.set(key, [entry]);
    }

    const hints: vscode.InlayHint[] = [];
    for (const group of byPosition.values()) {
        const first = group[0];
        if (first === undefined) continue;
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
            [{ value: label, command: commandLink(COMMANDS.applyFix, 'Apply Fix', idOf(first.idx), first.fmt.applyValue) }],
            vscode.InlayHintKind.Type
        );
        hint.tooltip = tooltip;
        hints.push(hint);
    }
    return hints;
}
