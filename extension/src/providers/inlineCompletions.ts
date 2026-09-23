import * as vscode from 'vscode';

import { supportedLanguageSelector } from '../checking/languages';
import type { DiagnosticStore } from '../diagnostics/store';

export function registerInlineCompletions(subscriptions: vscode.Disposable[], deps: { readonly store: DiagnosticStore }): void {
    const { store } = deps;

    // Register Inline Completion Provider (ghost text suggestions)
    subscriptions.push(vscode.languages.registerInlineCompletionItemProvider(
        supportedLanguageSelector(),
        {
            provideInlineCompletionItems(document, position, _context, _token) {
                const diagnostics = store.get(document.uri.toString());
                if (!diagnostics) return [];

                const items: vscode.InlineCompletionItem[] = [];
                for (const d of diagnostics) {
                    if (!d.suggestions || d.suggestions.length === 0) continue;
                    if (!d.range.contains(position)) continue;

                    const suggestion = d.suggestions[0];
                    if (!suggestion) continue;

                    items.push(new vscode.InlineCompletionItem(
                        suggestion,
                        d.range
                    ));
                }
                return items;
            }
        }
    ));
}
