/**
 * The two status bar items: the spell-check language, and prose insights
 * (word count and reading level) that double as the checking spinner and the
 * LanguageTool health indicator.
 */
import * as vscode from 'vscode';

import type { CheckResults } from '../checking/results';
import { COMMANDS } from '../commands/ids';
import { proseMetrics } from './readability';
import { uriKey } from '../shared/documents';

/** The language status bar item's text for a spell-check language. */
export function languageStatusText(language: string): string {
    return `$(book) ${language}`;
}

export class StatusBars {
    // Assigned by create(), which runs at a fixed point in activation; used
    // before that, they throw exactly as the module globals they replace did.
    private language!: vscode.StatusBarItem;
    private insights!: vscode.StatusBarItem;
    /** While a check runs, the insights item shows a spinner and nothing may overwrite it. */
    private checking = false;
    /**
     * The insights text without the health suffix: the spinner, or the word
     * count. Kept apart so the suffix is added exactly once, whichever of the
     * two is showing.
     */
    private base = '';

    constructor(private readonly results: CheckResults) {}

    create(subscriptions: { dispose(): unknown }[]): void {
        this.language = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.language.command = COMMANDS.selectLanguage;
        this.language.text = languageStatusText('en-US');
        this.language.tooltip = 'Language Check: Click to change language';
        this.language.show();
        subscriptions.push(this.language);

        // Prose insights (word count, reading level)
        this.insights = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
        this.insights.tooltip = 'Language Check: Prose Insights';
        this.insights.show();
        subscriptions.push(this.insights);
    }

    setLanguage(language: string): void {
        this.language.text = languageStatusText(language);
    }

    setChecking(active: boolean): void {
        this.checking = active;
        if (active) {
            this.base = `$(sync~spin) Checking...`;
            this.render();
        } else {
            this.updateInsights(vscode.window.activeTextEditor);
        }
    }

    updateHealth(): void {
        const status = this.languageToolStatus();
        this.insights.backgroundColor = status === 'degraded'
            ? new vscode.ThemeColor('statusBarItem.warningBackground')
            : status === 'down'
                ? new vscode.ThemeColor('statusBarItem.errorBackground')
                : undefined;
        this.render();
    }

    private languageToolStatus(): 'ok' | 'degraded' | 'down' | undefined {
        return this.results.engineHealth.find(e => e.name === 'languagetool')?.status;
    }

    /**
     * The insights text, plus LanguageTool's state when it is not fine.
     *
     * The suffix used to be appended to whatever text was there, so the next
     * word-count update erased it -- which, during a check, was the very next
     * thing to happen -- and a second health report appended it twice.
     */
    private render(): void {
        const status = this.languageToolStatus();
        const suffix = status === 'degraded' ? ' $(warning) LT degraded'
            : status === 'down' ? ' $(error) LT down'
            : '';
        this.insights.text = this.base + suffix;
    }

    updateInsights(editor?: vscode.TextEditor): void {
        if (this.checking) return; // Don't overwrite spinner

        if (!editor) {
            this.base = '';
            this.insights.text = '';
            this.insights.hide();
            return;
        }

        // Use extracted prose from cache (markup-free) for accurate metrics.
        // Falls back to raw text if no extraction data is cached yet.
        const cached = this.results.extraction.get(uriKey(editor.document.uri));
        const proseText = cached
            ? cached.prose.map(r => r.cleanText).join(' ')
            : editor.document.getText();

        const { wordCount, sentenceCount, charCount, readingLevel } = proseMetrics(proseText);

        const rlLabel = readingLevel > 0 ? ` | ARI ${readingLevel.toFixed(1)}` : '';
        this.base = `$(pencil) ${wordCount} words${rlLabel}`;
        this.render();
        this.insights.tooltip = `Words: ${wordCount} | Sentences: ${sentenceCount} | Characters: ${charCount} | Reading Level (ARI): ${readingLevel.toFixed(1)}`;
        this.insights.show();
    }
}
