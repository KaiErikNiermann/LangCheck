/**
 * Inlay hints that show what a bare language tag is checked as.
 *
 * `lang: "en"` in a document and `spell_language: en` in the config are both
 * checked as `en-US`, since LanguageTool spell-checks no bare `en`. The core
 * does the resolving; these hints put its answer next to the tag, so the
 * language in effect is visible where it was chosen: `en` reads `en-US`.
 */
import * as vscode from 'vscode';

import { supportedLanguageSelector } from '../checking/languages';
import type { CheckResults } from '../checking/results';
import type { ConfigStatusView } from '../config/gutter';
import { isConfigDocument } from '../config/gutter';
import { parseConfigKeys } from '../config/keys';
import { uriKey } from '../shared/documents';
import { resolutionHint } from '../shared/languageHint';
import type { InlayHintSwitch } from './inlayHints';

export interface LanguageHintDeps {
    readonly results: CheckResults;
    readonly configStatus: ConfigStatusView;
    readonly emitter: vscode.EventEmitter<void>;
    readonly hintSwitch: InlayHintSwitch;
}

const SPELL_LANGUAGE_KEY = 'engines.spell_language';
const QUOTES = new Set(['"', "'"]);

function hintAt(position: vscode.Position, label: string, declared: string, resolved: string): vscode.InlayHint {
    const hint = new vscode.InlayHint(position, label);
    hint.tooltip = `"${declared}" is checked as "${resolved}": a bare tag names no spelling `
        + 'variant, so the region is filled in before the engines see it.';
    return hint;
}

/** Hints on the declarations in a checked document, from its last check. */
function documentHints(document: vscode.TextDocument, results: CheckResults): vscode.InlayHint[] {
    const extraction = results.extraction.get(uriKey(document.uri));
    // Offsets from an older version would land on the wrong text.
    if (extraction?.version !== document.version) return [];
    const hints: vscode.InlayHint[] = [];
    // One declaration covers many ranges; it gets one hint.
    const seen = new Set<number>();
    for (const range of extraction.prose) {
        if (range.declaredTagEnd === null || seen.has(range.declaredTagEnd)) continue;
        const label = resolutionHint(range.declaredLanguage, range.language);
        if (label === null) continue;
        seen.add(range.declaredTagEnd);
        hints.push(hintAt(document.positionAt(range.declaredTagEnd), label, range.declaredLanguage, range.language));
    }
    return hints;
}

/** The hint after `spell_language:`'s value, from the config probe's answer. */
function configHints(document: vscode.TextDocument, configStatus: ConfigStatusView): vscode.InlayHint[] {
    const resolved = configStatus.snapshot(uriKey(document.uri))?.resolvedSpellLanguage ?? '';
    if (resolved === '') return [];
    const text = document.getText();
    const span = parseConfigKeys(text).spans.get(SPELL_LANGUAGE_KEY);
    if (span === undefined || span.valueEnd <= span.valueStart) return [];
    // Inside the quotes when there are some, so `"en"` reads `"en-US"`.
    const quoted = QUOTES.has(text[span.valueEnd - 1] ?? '') && QUOTES.has(text[span.valueStart] ?? '');
    const end = quoted ? span.valueEnd - 1 : span.valueEnd;
    const declared = text.slice(quoted ? span.valueStart + 1 : span.valueStart, end);
    const label = resolutionHint(declared, resolved);
    return label === null ? [] : [hintAt(document.positionAt(end), label, declared, resolved)];
}

export function registerLanguageHints(subscriptions: vscode.Disposable[], deps: LanguageHintDeps): void {
    const { results, configStatus, emitter, hintSwitch } = deps;
    subscriptions.push(
        configStatus.onDidRender(() => emitter.fire()),
        vscode.languages.registerInlayHintsProvider(supportedLanguageSelector(), {
            onDidChangeInlayHints: emitter.event,
            provideInlayHints: document => (hintSwitch.enabled ? documentHints(document, results) : []),
        }),
        vscode.languages.registerInlayHintsProvider([{ language: 'yaml' }, { language: 'json' }], {
            onDidChangeInlayHints: emitter.event,
            provideInlayHints: document =>
                hintSwitch.enabled && isConfigDocument(document) ? configHints(document, configStatus) : [],
        }),
    );
}
