/**
 * Shared waiting for the end-to-end tests.
 *
 * Everything the extension does after a document opens is asynchronous and
 * none of it is awaitable from outside: a check is fired from an event
 * handler, crosses a subprocess boundary and comes back to a diagnostic
 * collection. A test therefore polls, and the only honest thing it can assert
 * is "within this long". The timeouts here are the budget the feature is held
 * to, so raising one is a decision about the product, not a test fix.
 */
import * as vscode from 'vscode';
import * as path from 'path';

/** The workspace the tests run against, as `.vscode-test.mjs` opened it. */
export function fixtureRoot(): string {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) throw new Error('no workspace folder: the runner opened none');
    return folder.uri.fsPath;
}

export function fixture(name: string): vscode.Uri {
    return vscode.Uri.file(path.join(fixtureRoot(), name));
}

/**
 * Poll `read` until it returns something truthy, or give up.
 *
 * Returns the value so a caller can assert on it, and throws with `what` in
 * the message on timeout -- a bare "expected true, got false" says nothing
 * about which stage of the pipeline stalled.
 */
export async function eventually<T>(
    what: string,
    read: () => T | undefined | Promise<T | undefined>,
    timeoutMs = 20_000,
    intervalMs = 250,
): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    let last: T | undefined;
    for (;;) {
        last = await read();
        // Read as `unknown`: `T` may itself be null or false, which is what the
        // caller's callback signals "not yet" with.
        const seen: unknown = last;
        if (seen !== undefined && seen !== null && seen !== false) return last as T;
        if (Date.now() > deadline) {
            throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
        }
        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
}

/** This extension's diagnostics for a document, ignoring any other source. */
export function ourDiagnostics(uri: vscode.Uri): vscode.Diagnostic[] {
    return vscode.languages
        .getDiagnostics(uri)
        .filter(d => d.source === 'language-check');
}

/** Every inlay hint the providers offer for the whole document. */
export async function inlayHints(document: vscode.TextDocument): Promise<vscode.InlayHint[]> {
    const whole = new vscode.Range(
        new vscode.Position(0, 0),
        document.lineAt(document.lineCount - 1).range.end,
    );
    const hints = await vscode.commands.executeCommand<vscode.InlayHint[]>(
        'vscode.executeInlayHintProvider',
        document.uri,
        whole,
    );
    return hints ?? [];
}

/** Open a document in an editor tab, which is what the extension keys on. */
export async function openInEditor(uri: vscode.Uri): Promise<vscode.TextDocument> {
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, { preview: false });
    return document;
}

/**
 * `text` with each finding id's list generation left out: `diag-7-0` reads
 * `diag-0`. The generation counts every list written since activation, so
 * it depends on what ran before; the index is what a test pins.
 */
export function withoutGeneration(text: string): string {
    return text.replace(/diag-\d+-(\d+)/gu, 'diag-$1');
}
