// What a card action does, for the card to tell them apart at a glance: the
// shim hands over a code action's shape (an edit, a command, preferred), and
// the extension's command names say the rest.
import { COMMANDS } from '../../../extension/src/commands/ids';

/** One per look the card gives an action (styles.ts, `[data-kind]`). */
export type ActionKind = 'preferred' | 'fix' | 'fix-all' | 'dictionary' | 'ignore' | 'other';

const BY_COMMAND: ReadonlyMap<string, ActionKind> = new Map<string, ActionKind>([
    [COMMANDS.applyFix, 'fix'],
    [COMMANDS.fixAllSpellingInFile, 'fix-all'],
    [COMMANDS.fixAllSpellingInWorkspace, 'fix-all'],
    [COMMANDS.addToDictionary, 'dictionary'],
    [COMMANDS.installPack, 'dictionary'],
    [COMMANDS.ignoreDiagnostic, 'ignore'],
    [COMMANDS.ignoreSelection, 'ignore'],
    [COMMANDS.deactivateRule, 'ignore'],
]);

export interface ActionShape {
    readonly preferred: boolean;
    readonly edits: boolean;
    readonly command: string | undefined;
}

export function actionKind({ preferred, edits, command }: ActionShape): ActionKind {
    if (preferred) return 'preferred';
    if (edits) return 'fix';
    return (command === undefined ? undefined : BY_COMMAND.get(command)) ?? 'other';
}
