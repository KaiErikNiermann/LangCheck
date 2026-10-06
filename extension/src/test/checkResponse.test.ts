import { describe, expect, it } from 'vitest';
import type * as vscode from 'vscode';

import { byteToCharConverter } from '../checking/offsets';
import { exclusionKind, positionsIn, toDiagnostic, toInspectorRanges, toNameSpans } from '../checking/response';
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
            declaredLanguage: '',
            declaredTagEnd: null,
        });
    });

    it('places the declared tag end in characters, for the resolution hint', () => {
        const text = 'é #text(lang: "en")[Hi]';
        const toChar = byteToCharConverter(text);
        // "é" is two bytes, so the byte just past `en` is 18 and the char 17.
        const [range] = toInspectorRanges(
            [{ startByte: 21, endByte: 23, language: 'en-US', declaredLanguage: 'en', declaredTagEndByte: 18 }],
            text, toChar);
        expect(range?.declaredLanguage).toBe('en');
        expect(text.slice(0, range?.declaredTagEnd ?? 0)).toBe('é #text(lang: "en');
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

describe('positionsIn', () => {
    const at = (text: string, offset: number) => {
        const p = positionsIn(text).positionAt(offset);
        return [p.line, p.character];
    };

    it('counts lines across every kind of line break', () => {
        const text = 'ab\ncd\r\nef\rgh';
        expect(at(text, 0)).toEqual([0, 0]);
        expect(at(text, text.indexOf('d'))).toEqual([1, 1]);
        expect(at(text, text.indexOf('f'))).toEqual([2, 1]);
        expect(at(text, text.indexOf('h'))).toEqual([3, 1]);
    });

    it('puts an offset inside a CRLF at the end of its line', () => {
        expect(at('ab\r\ncd', 3)).toEqual([0, 2]);
    });

    it('clamps offsets outside the text', () => {
        expect(at('ab\ncd', -4)).toEqual([0, 0]);
        expect(at('ab\ncd', 99)).toEqual([1, 2]);
        expect(at('', 3)).toEqual([0, 0]);
    });
});
