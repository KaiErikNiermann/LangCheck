/**
 * Finding, reading and writing the workspace's `.languagecheck` config file.
 *
 * There are two ways of finding it, and they differ on purpose:
 * - A command that edits the config takes the first name that exists and
 *   falls back to creating `.languagecheck.yaml`, so there is always a file to
 *   write to ({@link resolveConfigForEdit}).
 * - A reader that only looks takes the first name that actually reads, and
 *   gets nothing when none does ({@link readFirstConfig}).
 */
import * as vscode from 'vscode';

/** Every name the core accepts for the config, in the order it looks. */
export const CONFIG_FILE_NAMES = ['.languagecheck.yaml', '.languagecheck.yml', '.languagecheck.json'] as const;

/** The file a command should edit: the first config that exists, else a new `.languagecheck.yaml`. */
export async function resolveConfigForEdit(folder: vscode.WorkspaceFolder): Promise<vscode.Uri> {
    for (const name of CONFIG_FILE_NAMES) {
        const uri = vscode.Uri.joinPath(folder.uri, name);
        try {
            await vscode.workspace.fs.stat(uri);
            return uri;
        } catch { /* not found */ }
    }
    return vscode.Uri.joinPath(folder.uri, '.languagecheck.yaml');
}

/**
 * A workspace file's text, or `''` when it cannot be read.
 *
 * For the config, an empty string is what the edits start a new file from; it
 * is also what an unreadable existing file turns into, so an edit then
 * overwrites it. For a wordlist, a missing file simply holds no words.
 */
export async function readTextOrEmpty(uri: vscode.Uri): Promise<string> {
    try {
        return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    } catch {
        return '';
    }
}

export async function writeConfigText(uri: vscode.Uri, content: string): Promise<void> {
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
}

/** The first config that reads, for callers that only look at it. */
export async function readFirstConfig(
    folder: vscode.WorkspaceFolder,
): Promise<{ uri: vscode.Uri; text: string } | undefined> {
    for (const name of CONFIG_FILE_NAMES) {
        const uri = vscode.Uri.joinPath(folder.uri, name);
        try {
            return { uri, text: Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8') };
        } catch { /* not found, try next */ }
    }
    return undefined;
}

/** The folder whose config a command edits, with a warning when no folder is open. */
export function workspaceFolderOrWarn(): vscode.WorkspaceFolder | undefined {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
        vscode.window.showWarningMessage(vscode.l10n.t('No workspace folder open.'));
    }
    return folder;
}

export function showConfigUpdateError(err: unknown): void {
    vscode.window.showErrorMessage(vscode.l10n.t('Failed to update config: {0}', String(err)));
}

/**
 * The config the core reads for this workspace: the first of
 * {@link CONFIG_FILE_NAMES} that exists at the root of the first workspace
 * folder. `undefined` when there is no folder, or no config there yet.
 *
 * See "Where the config is read from" in docs/guide/configuration.md.
 */
export async function configInEffect(): Promise<vscode.Uri | undefined> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return undefined;
    for (const name of CONFIG_FILE_NAMES) {
        const uri = vscode.Uri.joinPath(folder.uri, name);
        try {
            await vscode.workspace.fs.stat(uri);
            return uri;
        } catch { /* not found */ }
    }
    return undefined;
}
