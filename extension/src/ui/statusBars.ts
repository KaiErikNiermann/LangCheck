/**
 * The two status bar items: the spell-check language, and prose insights
 * (word count and reading level) that double as the checking spinner and the
 * LanguageTool health indicator.
 */
import * as vscode from 'vscode';

import type { CheckResults } from '../checking/results';
import { COMMANDS } from '../commands/ids';
import { proseMetrics } from './readability';

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
            this.insights.text = `$(sync~spin) Checking...`;
        } else {
            this.updateInsights(vscode.window.activeTextEditor);
        }
    }

    updateHealth(): void {
        const ltHealth = this.results.engineHealth.find(e => e.name === 'languagetool');
        if (!ltHealth || ltHealth.status === 'ok') {
            // Remove any health suffix — let updateInsights handle the text
            this.insights.backgroundColor = undefined;
            return;
        }
        if (ltHealth.status === 'degraded') {
            this.insights.text += ' $(warning) LT degraded';
            this.insights.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        } else {
            this.insights.text += ' $(error) LT down';
            this.insights.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        }
    }

    updateInsights(editor?: vscode.TextEditor): void {
        if (this.checking) return; // Don't overwrite spinner

        if (!editor) {
            this.insights.text = '';
            this.insights.hide();
            return;
        }

        // Use extracted prose from cache (markup-free) for accurate metrics.
        // Falls back to raw text if no extraction data is cached yet.
        const cached = this.results.extraction.get(editor.document.uri.toString());
        const proseText = cached
            ? cached.prose.map(r => r.cleanText).join(' ')
            : editor.document.getText();

        const { wordCount, sentenceCount, charCount, readingLevel } = proseMetrics(proseText);

        const rlLabel = readingLevel > 0 ? ` | ARI ${readingLevel.toFixed(1)}` : '';
        this.insights.text = `$(pencil) ${wordCount} words${rlLabel}`;
        this.insights.tooltip = `Words: ${wordCount} | Sentences: ${sentenceCount} | Characters: ${charCount} | Reading Level (ARI): ${readingLevel.toFixed(1)}`;
        this.insights.show();
    }
}
