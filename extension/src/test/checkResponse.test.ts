import { describe, expect, it } from 'vitest';
import type * as vscode from 'vscode';

import { byteToCharConverter } from '../checking/offsets';
import { exclusionKind, toDiagnostic, toInspectorRanges, toNameSpans } from '../checking/response';
import { languagecheck } from '../proto/checker';
import { DiagnosticSeverity, Position } from './__mocks__/vscode';

/** A one-line document: an offset is its column. */
const oneLine = { positionAt: (offset: number) => new Position(0, offset) } as unknown as vscode.TextDocument;

describe('exclusionKind', () => {
    it.each([
        ['##{x}', 'display_math'],
        ['\\[ x \\]', 'display_math'],
        ['$x$', 'inline_math'],
        ['#{x}', 'inline_math'],
        ['\\emph', 'command'],
        ['\\%', 'escape'],
        ['% note', 'comment'],
        ['[text](url)', 'link'],
        ['[[wiki]]', 'link'],
        ['{}', 'delimiter'],
        ['   ', 'whitespace'],
        ['plain', 'unknown'],
    ])('%s is %s', (text, kind) => {
        expect(exclusionKind(text)).toBe(kind);
    });

    it('ignores the whitespace an exclusion was widened over', () => {
        expect(exclusionKind('  $x$  ')).toBe('inline_math');
    });
});

describe('toInspectorRanges', () => {
    it('blanks exclusions out of the clean text, counting in characters', () => {
        const text = 'é is $x$ here';
        const toChar = byteToCharConverter(text);
        // "é is " is 6 bytes; "$x$" spans bytes 6..9.
        const [range] = toInspectorRanges([{ startByte: 0, endByte: 15, exclusions: [{ startByte: 6, endByte: 9 }], language: 'en' }], text, toChar);
        expect(range).toEqual({
            startByte: 0,
            endByte: 15,
            text: 'é is $x$ here',
            cleanText: 'é is     here',
            exclusions: [{ startChar: 5, endChar: 8, kind: 'inline_math', text: '$x$' }],
            language: 'en',
        });
    });
});

describe('toNameSpans', () => {
    it('reads the text, line and signals of each name', () => {
        const text = 'Ada wrote it';
        const [span] = toNameSpans([{ startByte: 0, endByte: 3, confidence: 0.9, signals: 'capital,gazetteer' }], text, oneLine, byteToCharConverter(text));
        expect(span).toEqual({ startByte: 0, endByte: 3, text: 'Ada', confidence: 0.9, signals: ['capital', 'gazetteer'], line: 1 });
    });
});

describe('toDiagnostic', () => {
    it('maps the core severity and keeps what the quick fixes need', () => {
        const text = 'We recieve it';
        const d = toDiagnostic({
            startByte: 3, endByte: 10, message: 'Spelling', ruleId: 'harper.Spelling',
            severity: languagecheck.Severity.SEVERITY_WARNING, suggestions: ['receive'], confidence: 0.8,
        }, oneLine, byteToCharConverter(text));
        expect(d).toMatchObject({
            message: 'Spelling', severity: DiagnosticSeverity.Warning, source: 'language-check', code: 'harper.Spelling',
            suggestions: ['receive'], coreStartByte: 3, coreEndByte: 10, confidence: 0.8, packInstallable: false,
        });
        expect([d.range.start.character, d.range.end.character]).toEqual([3, 10]);
    });

    it('reads an unset or information severity as Information', () => {
        const toChar = byteToCharConverter('x');
        expect(toDiagnostic({ startByte: 0, endByte: 1, message: 'm' }, oneLine, toChar).severity).toBe(DiagnosticSeverity.Information);
        expect(toDiagnostic({ startByte: 0, endByte: 1, message: 'm', severity: languagecheck.Severity.SEVERITY_ERROR }, oneLine, toChar).severity)
            .toBe(DiagnosticSeverity.Error);
    });
});
