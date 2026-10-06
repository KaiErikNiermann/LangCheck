/**
 * Turning a CheckProse response into what the editor shows.
 *
 * The core reports UTF-8 byte offsets and protobuf shapes; the editor wants
 * ranges, `vscode.Diagnostic`s and the Inspector's own payloads. Everything
 * here is a function of the response and the text it was computed from.
 */
import * as vscode from 'vscode';

import { languagecheck } from '../proto/checker';
import type { ExtendedDiagnostic } from '../diagnostics/diagnostic';
import type { InspectorExclusion, InspectorNameSpan, InspectorProseRange } from '../ui/webviews/protocol';
import { coreByte, type ByteOffset, type CharOffset } from './offsets';

type ByteToChar = (byteOffset: ByteOffset) => CharOffset;

/** What the conversions need of a document: where a character offset falls. */
export type Positions = Pick<vscode.TextDocument, 'positionAt'>;

/**
 * `positionAt` over `text`, the text a check read.
 *
 * The live document may have moved on by the time the core answers -- typing
 * after a save under the onSave trigger -- and its `positionAt` would put each
 * squiggle wherever the old offset lands in the new text. Line breaks are the
 * editor's: `\r\n`, `\n` and a lone `\r`.
 */
export function positionsIn(text: string): Positions {
    const starts = [0];
    const ends: number[] = [];
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c !== 0x0a && c !== 0x0d) continue;
        ends.push(i);
        if (c === 0x0d && text.charCodeAt(i + 1) === 0x0a) i++;
        starts.push(i + 1);
    }
    ends.push(text.length);
    return {
        positionAt(offset: number): vscode.Position {
            const at = Math.min(Math.max(Math.trunc(offset) || 0, 0), text.length);
            let lo = 0;
            let hi = starts.length - 1;
            while (lo < hi) {
                const mid = (lo + hi + 1) >> 1;
                if ((starts[mid] ?? 0) <= at) lo = mid; else hi = mid - 1;
            }
            const start = starts[lo] ?? 0;
            // An offset inside a line break is the end of its line, as in the editor.
            return new vscode.Position(lo, Math.min(at, ends[lo] ?? at) - start);
        },
    };
}

/** One core diagnostic as a squiggle, carrying what the quick fixes and hints need. */
export function toDiagnostic(
    d: languagecheck.IDiagnostic,
    document: Positions,
    byteToChar: ByteToChar,
): ExtendedDiagnostic {
    const start = document.positionAt(byteToChar(coreByte(d.startByte)));
    const end = document.positionAt(byteToChar(coreByte(d.endByte)));
    const range = new vscode.Range(start, end);

    let severity = vscode.DiagnosticSeverity.Information;
    switch (d.severity) {
        case languagecheck.Severity.SEVERITY_ERROR: severity = vscode.DiagnosticSeverity.Error; break;
        case languagecheck.Severity.SEVERITY_WARNING: severity = vscode.DiagnosticSeverity.Warning; break;
        case languagecheck.Severity.SEVERITY_HINT: severity = vscode.DiagnosticSeverity.Hint; break;
    }

    const diagnostic: ExtendedDiagnostic = new vscode.Diagnostic(range, d.message as string, severity);
    diagnostic.source = 'language-check';
    if (d.ruleId) {
        diagnostic.code = d.ruleId;
    }
    diagnostic.suggestions = d.suggestions || [];
    diagnostic.coreStartByte = coreByte(d.startByte);
    diagnostic.coreEndByte = coreByte(d.endByte);
    if (d.confidence !== null && d.confidence !== undefined) {
        diagnostic.confidence = d.confidence;
    }
    if (d.language) {
        diagnostic.language = d.language;
    }
    diagnostic.packInstallable = d.packInstallable === true;
    if (d.unifiedId) {
        diagnostic.unifiedId = d.unifiedId;
    }
    return diagnostic;
}

/**
 * What an exclusion inside a prose range most likely is, from its text.
 *
 * A heuristic for the Inspector's labels only. Leading and trailing whitespace
 * is ignored because install_skip_exclusions extends exclusion ranges to cover
 * the whitespace around them.
 */
export function exclusionKind(excText: string): string {
    const trimmed = excText.trim();
    let kind = 'unknown';
    if (trimmed.startsWith('##{') || trimmed.startsWith('\\[')) kind = 'display_math';
    else if (trimmed.startsWith('#{') || trimmed.startsWith('$')) kind = 'inline_math';
    else if (/^\\[a-zA-Z]/.test(trimmed)) kind = 'command';
    else if (trimmed.startsWith('\\')) kind = 'escape';
    else if (trimmed.startsWith('%')) kind = 'comment';
    else if (/^\[.*\]\(.*\)$/.test(trimmed)) kind = 'link';
    else if (trimmed.startsWith('[[') && trimmed.endsWith(']]')) kind = 'link';
    else if (/^[{}[\]()]+$/.test(trimmed)) kind = 'delimiter';
    else if (trimmed === '') kind = 'whitespace';
    return kind;
}

/** The core's prose ranges as the Inspector draws them, with exclusions blanked out of `cleanText`. */
export function toInspectorRanges(
    protoRanges: readonly languagecheck.IExtractionProseRange[],
    textContent: string,
    byteToChar: ByteToChar,
): InspectorProseRange[] {
    return protoRanges.map(pr => {
        const startByte = coreByte(pr.startByte);
        const endByte = coreByte(pr.endByte);
        const rawText = textContent.substring(
            byteToChar(startByte),
            byteToChar(endByte),
        );

        const exclusions: InspectorExclusion[] = (pr.exclusions ?? []).map(exc => {
            const excStartByte = coreByte(exc.startByte);
            const excEndByte = coreByte(exc.endByte);
            // Convert document-level byte offsets to char offsets within the range text
            const excStartChar = byteToChar(excStartByte) - byteToChar(startByte);
            const excEndChar = byteToChar(excEndByte) - byteToChar(startByte);
            const excText = rawText.substring(excStartChar, excEndChar);
            return { startChar: excStartChar, endChar: excEndChar, kind: exclusionKind(excText), text: excText };
        });

        // Build clean text: replace exclusion zones with spaces
        let cleanText = rawText;
        if (exclusions.length > 0) {
            const chars = [...cleanText];
            for (const exc of exclusions) {
                for (let i = exc.startChar; i < exc.endChar && i < chars.length; i++) {
                    chars[i] = ' ';
                }
            }
            cleanText = chars.join('');
        }

        return {
            startByte,
            endByte,
            text: rawText,
            cleanText,
            exclusions,
            language: pr.language ?? '',
            declaredLanguage: pr.declaredLanguage ?? '',
            declaredTagEnd: pr.declaredTagEndByte === null || pr.declaredTagEndByte === undefined
                ? null
                : byteToChar(coreByte(pr.declaredTagEndByte)),
        };
    });
}

/**
 * Words the core silenced as names, surfaced so the suppression is visible
 * rather than a silent behaviour change.
 */
export function toNameSpans(
    names: readonly languagecheck.INameSpan[],
    textContent: string,
    document: Positions,
    byteToChar: ByteToChar,
): InspectorNameSpan[] {
    return names.map(n => {
        const startByte = coreByte(n.startByte);
        const endByte = coreByte(n.endByte);
        const startChar = byteToChar(startByte);
        return {
            startByte,
            endByte,
            text: textContent.substring(startChar, byteToChar(endByte)),
            confidence: (n.confidence as number) ?? 0,
            signals: (n.signals ?? '').split(',').filter(Boolean),
            line: document.positionAt(startChar).line + 1,
        };
    });
}
