import * as path from 'path';
import * as vscode from 'vscode';

/** The page each webview loads: a Vite entry under `webview/dist/assets`, and its title. */
export type WebviewEntry = { script: 'index'; title: 'SpeedFix' } | { script: 'inspector'; title: 'Inspector' };

/**
 * A webview panel beside the editor that keeps its state while hidden,
 * allowed to load from the given directories under `webview/`.
 */
export function createBesidePanel(
    extensionPath: string,
    viewType: string,
    title: string,
    assetDirs: readonly string[],
): vscode.WebviewPanel {
    return vscode.window.createWebviewPanel(
        viewType,
        title,
        vscode.ViewColumn.Beside,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: assetDirs.map(dir => vscode.Uri.file(path.join(extensionPath, 'webview', dir))),
        },
    );
}

/** The HTML shell for a webview: one stylesheet, one module script, one mount point. */
export function webviewHtml(webview: vscode.Webview, extensionPath: string, entry: WebviewEntry): string {
    const asset = (file: string) =>
        webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'webview', 'dist', 'assets', file)));
    const scriptUri = asset(`${entry.script}.js`);
    const cssUri = asset(`${entry.script}.css`);

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="${cssUri}">
    <title>${entry.title}</title>
</head>
<body>
    <div id="app"></div>
    <script type="module" src="${scriptUri}"></script>
</body>
</html>`;
}
