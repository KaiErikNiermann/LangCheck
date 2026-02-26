import * as vscode from 'vscode';
import * as path from 'path';
import { LanguageClient } from './client';
import { languagecheck } from './proto/checker';

let client: LanguageClient | null = null;
const diagnosticCollection = vscode.languages.createDiagnosticCollection('language-check');
let speedFixPanel: vscode.WebviewPanel | null = null;

export function activate(context: vscode.ExtensionContext) {
    console.log('Language Check extension activated');

    const binaryPath = context.extensionMode === vscode.ExtensionMode.Development
        ? path.join(context.extensionPath, '..', 'rust-core', 'target', 'debug', 'rust-core')
        : path.join(context.extensionPath, 'bin', 'rust-core');

    client = new LanguageClient(binaryPath);
    client.start();

    context.subscriptions.push(vscode.commands.registerCommand('language-check.checkDocument', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        await checkDocument(editor.document);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('language-check.openSpeedFix', () => {
        if (speedFixPanel) {
            speedFixPanel.reveal(vscode.ViewColumn.Beside);
            return;
        }

        speedFixPanel = vscode.window.createWebviewPanel(
            'speedFix',
            'SpeedFix',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.file(path.join(context.extensionPath, 'webview', 'dist')),
                    vscode.Uri.file(path.join(context.extensionPath, 'webview', 'out')) // fallback for dev
                ]
            }
        );

        const webviewDistPath = path.join(context.extensionPath, 'webview', 'dist');
        const indexHtmlPath = path.join(webviewDistPath, 'index.html');
        
        // In dev mode, we might want to point to the dev server, 
        // but for simplicity let's assume we build the webview.
        // Or we can use a simple HTML with script tags.
        
        speedFixPanel.webview.html = getWebviewContent(speedFixPanel.webview, context.extensionPath);

        speedFixPanel.webview.onDidReceiveMessage(async message => {
            switch (message.type) {
                case 'ready':
                    updateSpeedFixDiagnostics();
                    break;
                case 'applyFix':
                    await applyFix(message.payload.diagnosticId, message.payload.suggestion);
                    break;
            }
        }, undefined, context.subscriptions);

        speedFixPanel.onDidDispose(() => {
            speedFixPanel = null;
        }, null, context.subscriptions);
    }));

    vscode.workspace.onDidSaveTextDocument(async (document) => {
        if (document.languageId === 'markdown') {
            await checkDocument(document);
        }
    });

    context.subscriptions.push(diagnosticCollection);
}

function getWebviewContent(webview: vscode.Webview, extensionPath: string): string {
    // This should ideally read from webview/dist/index.html and adjust paths
    // For now, a placeholder that points to the built assets
    const scriptUri = webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'webview', 'dist', 'assets', 'index.js')));
    const cssUri = webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'webview', 'dist', 'assets', 'index.css')));

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="${cssUri}">
    <title>SpeedFix</title>
</head>
<body class="bg-vscode-editor-bg text-vscode-editor-fg">
    <div id="app"></div>
    <script type="module" src="${scriptUri}"></script>
</body>
</html>`;
}

async function applyFix(diagnosticId: string, suggestion: string) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const diagnostics = diagnosticsMap.get(editor.document.uri.toString());
    if (!diagnostics) return;

    const index = parseInt(diagnosticId.replace('diag-', ''));
    const diagnostic = diagnostics[index];
    if (diagnostic) {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(editor.document.uri, diagnostic.range, suggestion);
        await vscode.workspace.applyEdit(edit);
    }
}

interface ExtendedDiagnostic extends vscode.Diagnostic {
    suggestions?: string[];
}

const diagnosticsMap = new Map<string, ExtendedDiagnostic[]>();

function updateSpeedFixDiagnostics() {
    if (!speedFixPanel || !vscode.window.activeTextEditor) return;
    
    const editor = vscode.window.activeTextEditor;
    const diagnostics = diagnosticsMap.get(editor.document.uri.toString());
    
    if (diagnostics) {
        const payload = diagnostics.map((d, i) => ({
            id: `diag-${i}`,
            message: d.message,
            suggestions: d.suggestions || [],
            context: editor.document.getText(d.range),
            ruleId: d.code as string || 'unknown'
        }));
        speedFixPanel.webview.postMessage({ type: 'setDiagnostics', payload });
    }
}

async function checkDocument(document: vscode.TextDocument) {
    if (!client) return;

    try {
        const response = await client.sendRequest({
            checkProse: {
                text: document.getText(),
                languageId: document.languageId,
                settings: {}
            }
        });

        if (response.checkProse) {
            const extendedDiagnostics: ExtendedDiagnostic[] = response.checkProse.diagnostics!.map(d => {
                const start = document.positionAt(d.startByte as number);
                const end = document.positionAt(d.endByte as number);
                const range = new vscode.Range(start, end);
                
                let severity = vscode.DiagnosticSeverity.Information;
                switch (d.severity) {
                    case languagecheck.Severity.SEVERITY_ERROR: severity = vscode.DiagnosticSeverity.Error; break;
                    case languagecheck.Severity.SEVERITY_WARNING: severity = vscode.DiagnosticSeverity.Warning; break;
                    case languagecheck.Severity.SEVERITY_HINT: severity = vscode.DiagnosticSeverity.Hint; break;
                }

                const diagnostic: ExtendedDiagnostic = new vscode.Diagnostic(range, d.message as string, severity);
                if (d.ruleId) {
                    diagnostic.code = d.ruleId;
                }
                diagnostic.suggestions = d.suggestions || [];
                return diagnostic;
            });

            diagnosticCollection.set(document.uri, extendedDiagnostics);
            diagnosticsMap.set(document.uri.toString(), extendedDiagnostics);
            updateSpeedFixDiagnostics();
        } else if (response.error) {
            vscode.window.showErrorMessage(`Language Check Error: ${response.error.message}`);
        }
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to communicate with language-check core: ${err}`);
    }
}

export function deactivate() {
    if (client) {
        client.stop();
        client = null;
    }
}
