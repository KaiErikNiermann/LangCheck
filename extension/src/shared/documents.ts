import * as vscode from 'vscode';

declare const uriKey_: unique symbol;

/**
 * A document URI as a map key: `uri.toString()`, branded.
 *
 * Diagnostics, the SpeedFix target and the Inspector's caches are all keyed
 * by it. It is a string, but not any string: an `fsPath` or a label passed
 * where a key belongs finds nothing and fails silently, so only
 * {@link uriKey} makes one.
 */
export type UriKey = string & { readonly [uriKey_]: true };

export function uriKey(uri: vscode.Uri): UriKey {
    return uri.toString() as UriKey;
}

/**
 * The open document with this URI, if VS Code has it loaded.
 *
 * Diagnostics are kept by URI string, and a finding is only actionable while
 * its document is open, so this is how a URI key gets back to text.
 */
export function findOpenDocument(uri: UriKey): vscode.TextDocument | undefined {
    return vscode.workspace.textDocuments.find(d => uriKey(d.uri) === uri);
}
