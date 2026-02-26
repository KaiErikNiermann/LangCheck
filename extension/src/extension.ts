import * as vscode from 'vscode';
import * as path from 'path';
import { LanguageClient } from './client';
import { languagecheck } from './proto/checker';

let client: LanguageClient | null = null;
const diagnosticCollection = vscode.languages.createDiagnosticCollection('language-check');

export function activate(context: vscode.ExtensionContext) {
    console.log('Language Check extension activated');

    // Path to the Rust core binary
    // For development, we assume it's built and available in the rust-core/target/debug directory
    const binaryPath = context.extensionMode === vscode.ExtensionMode.Development
        ? path.join(context.extensionPath, '..', 'rust-core', 'target', 'debug', 'rust-core')
        : path.join(context.extensionPath, 'bin', 'rust-core');

    client = new LanguageClient(binaryPath);
    client.start();

    context.subscriptions.push(vscode.commands.registerCommand('language-check.checkDocument', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        await checkDocument(editor.document);
    }));

    vscode.workspace.onDidSaveTextDocument(async (document) => {
        if (document.languageId === 'markdown') {
            await checkDocument(document);
        }
    });

    context.subscriptions.push(diagnosticCollection);
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
            const diagnostics: vscode.Diagnostic[] = response.checkProse.diagnostics!.map(d => {
                const start = document.positionAt(d.startByte as number);
                const end = document.positionAt(d.endByte as number);
                const range = new vscode.Range(start, end);
                
                let severity = vscode.DiagnosticSeverity.Information;
                switch (d.severity) {
                    case languagecheck.Severity.SEVERITY_ERROR: severity = vscode.DiagnosticSeverity.Error; break;
                    case languagecheck.Severity.SEVERITY_WARNING: severity = vscode.DiagnosticSeverity.Warning; break;
                    case languagecheck.Severity.SEVERITY_HINT: severity = vscode.DiagnosticSeverity.Hint; break;
                }

                return new vscode.Diagnostic(range, d.message as string, severity);
            });

            diagnosticCollection.set(document.uri, diagnostics);
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
