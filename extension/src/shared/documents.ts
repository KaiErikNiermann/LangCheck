import * as vscode from 'vscode';

/**
 * The open document with this URI, if VS Code has it loaded.
 *
 * Diagnostics are kept by URI string, and a finding is only actionable while
 * its document is open, so this is how a URI key gets back to text.
 */
export function findOpenDocument(uri: string): vscode.TextDocument | undefined {
    return vscode.workspace.textDocuments.find(d => d.uri.toString() === uri);
}
