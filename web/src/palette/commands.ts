// The client's commands that mean something in a web editor, in the order
// the palette lists them. Ids come from the generated manifest table and
// titles from the client's own strings, so the palette reads like VS Code's.
// An entry is added here when the web gains the command, never before.
import nls from '../../../extension/package.nls.json';
import { commands } from '../../../extension/src/generated/meta';

type CommandKey = keyof typeof commands;

const ON_THE_WEB = ['checkDocument', 'openSpeedFix', 'openInspector', 'editConfig'] as const satisfies readonly CommandKey[];

export type PaletteCommandId = (typeof commands)[(typeof ON_THE_WEB)[number]];

export interface PaletteEntry {
    readonly id: PaletteCommandId;
    readonly title: string;
}

/** "Language Check: Check Current Document" reads as "Check Current Document" under a "Language Check" section. */
const PREFIX = 'Language Check: ';

export const PALETTE: readonly PaletteEntry[] = ON_THE_WEB.map((key) => {
    const title = (nls as Record<string, string | undefined>)[`command.${key}`] ?? key;
    return { id: commands[key], title: title.startsWith(PREFIX) ? title.slice(PREFIX.length) : title };
});

export function isPaletteCommand(value: unknown): value is PaletteCommandId {
    return PALETTE.some((entry) => entry.id === value);
}
