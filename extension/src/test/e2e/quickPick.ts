/**
 * Answering a quick pick without a human to click it.
 *
 * Same trick as `promptMemory.ts`: the tests share the extension's `vscode`
 * module, so replacing `window.showQuickPick` here replaces the function the
 * extension calls.
 */
import * as vscode from 'vscode';

export interface QuickPickStub {
    /** The labels offered each time the pick was shown. */
    readonly offered: string[][];
    /** Put the real function back. Always call it. */
    restore(): void;
}

/**
 * Answer every quick pick by choosing the items whose labels are in `labels`.
 *
 * A single-select pick gets the first match; a multi-select pick gets them all.
 */
export function answerQuickPick(labels: readonly string[]): QuickPickStub {
    const offered: string[][] = [];
    const original = vscode.window.showQuickPick;

    const replacement = async (
        items: readonly vscode.QuickPickItem[] | Thenable<readonly vscode.QuickPickItem[]>,
        options?: vscode.QuickPickOptions,
    ) => {
        const resolved = await items;
        offered.push(resolved.map(i => i.label));
        const chosen = resolved.filter(i => labels.includes(i.label));
        return options?.canPickMany ? chosen : chosen[0];
    };

    (vscode.window as unknown as Record<string, unknown>).showQuickPick = replacement;

    return {
        offered,
        restore: () => {
            (vscode.window as unknown as Record<string, unknown>).showQuickPick = original;
        },
    };
}
