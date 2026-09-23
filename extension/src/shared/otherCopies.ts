/**
 * Other installed copies of this extension.
 *
 * VS Code loads one extension per id, but a copy under another id -- a fork,
 * a local build, a renamed VSIX -- activates beside this one, starts a checker
 * of its own and draws a second set of squiggles. It is recognised by what it
 * contributes: this extension's own command ids.
 */

export interface InstalledExtension {
    readonly id: string;
    readonly extensionPath: string;
    readonly packageJSON: unknown;
}

export interface OtherCopy {
    readonly id: string;
    readonly version: string;
    readonly path: string;
}

/** The command every copy of this extension contributes. */
const MARKER_COMMAND = 'language-check.checkDocument';

function contributesMarker(packageJSON: unknown): boolean {
    const commands = (packageJSON as { contributes?: { commands?: unknown } } | null)?.contributes?.commands;
    return Array.isArray(commands) && commands.some(c => (c as { command?: unknown } | null)?.command === MARKER_COMMAND);
}

export function otherCopies(installed: readonly InstalledExtension[], ownId: string): OtherCopy[] {
    return installed
        .filter(extension => extension.id.toLowerCase() !== ownId.toLowerCase() && contributesMarker(extension.packageJSON))
        .map(extension => ({
            id: extension.id,
            version: String((extension.packageJSON as { version?: unknown } | null)?.version ?? '?'),
            path: extension.extensionPath,
        }));
}
