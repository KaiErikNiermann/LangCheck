import * as vscode from 'vscode';

export const GITHUB_REPO = 'KaiErikNiermann/LangCheck';

/** Where a user downloads a core binary by hand. */
export function openReleasesPage(): void {
    vscode.env.openExternal(vscode.Uri.parse(`https://github.com/${GITHUB_REPO}/releases`));
}
