/**
 * Which editor a fix, an ignore or a panel update applies to.
 *
 * Not simply the active editor: a webview panel takes focus, leaving no active
 * text editor at all, and SpeedFix may be working through a file other than
 * the one last focused.
 */
import * as vscode from 'vscode';

import type { DiagnosticStore } from './store';

export class FixTarget {
    /** The document SpeedFix is on, preferred while it has diagnostics. */
    uri: string | null = null;

    constructor(private readonly store: DiagnosticStore) {}

    /** Find a text editor that has diagnostics, preferring activeTextEditor.
     *  Falls back to visibleTextEditors when a webview panel has stolen focus.
     *  When a SpeedFix target URI is set, prefer that editor. */
    findEditor(): vscode.TextEditor | undefined {
        // Prefer the SpeedFix target (set by workspace-mode auto-advance)
        if (this.uri) {
            const target = vscode.window.visibleTextEditors.find(
                e => e.document.uri.toString() === this.uri
            );
            if (target && this.store.has(this.uri)) return target;
        }
        const active = vscode.window.activeTextEditor;
        if (active && this.store.has(active.document.uri.toString())) return active;
        // Fallback: find a visible editor that has diagnostics
        return vscode.window.visibleTextEditors.find(e =>
            this.store.has(e.document.uri.toString())
        );
    }
}
